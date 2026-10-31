/* TweenPose topology workspace. Kept inline in index.html for file:// portability. */
const GeometryEditor = (() => {
  'use strict';
  const K = TweenGeometry, V = THREE.Vector3;
  const state = { mode: 'object', component: 'vertex', selected: new Set(), edges: [], drag: null, uid: 0, exporting: false };
  const materialCache = new Map();
  const helpers = new THREE.Group(); helpers.name = 'Topology helpers'; scene.add(helpers);
  const anchor = new THREE.Object3D(); scene.add(anchor);
  const SCHEMAS = {
    transform: { label: 'Transform', color: '#668cff', fields: [['x','Move X',0,-10,10,.05],['y','Move Y',0,-10,10,.05],['z','Move Z',0,-10,10,.05],['rx','Rotate X',0,-360,360,5],['ry','Rotate Y',0,-360,360,5],['rz','Rotate Z',0,-360,360,5],['sx','Scale X',1,.01,10,.1],['sy','Scale Y',1,.01,10,.1],['sz','Scale Z',1,.01,10,.1]] },
    subdivide: { label: 'Subdivide', color: '#ab83f5', fields: [['level','Levels',1,1,3,1]] },
    twist: { label: 'Twist', color: '#f2b45e', fields: [['angle','Angle °',90,-720,720,5]] },
    noise: { label: 'Noise', color: '#e88ca9', fields: [['amount','Amount',.12,0,2,.01],['scale','Frequency',2,.01,20,.1],['seed','Seed',1,0,9999,1]] },
    smooth: { label: 'Smooth', color: '#65c4a9', fields: [['iterations','Iterations',2,1,20,1],['strength','Strength',.35,0,1,.05]] },
    spherize: { label: 'Spherize', color: '#62bdde', fields: [['amount','Amount',.5,0,1,.05],['radius','Radius',1,.01,10,.05]] },
    array: { label: 'Array', color: '#ebc778', fields: [['count','Copies',3,1,24,1],['spacing','Spacing',2.2,-10,10,.1]], axis: true }
  };
  const EFFECTS = {
    smooth: { label: 'Smooth surface', description: 'Add detail and soften the surface.', primary: 'strength' },
    twist: { label: 'Twist', description: 'Turn the mesh gradually from bottom to top.', primary: 'angle' },
    noise: { label: 'Organic texture', description: 'Add soft, repeatable bumps.', primary: 'amount' },
    spherize: { label: 'Round into sphere', description: 'Pull the surface toward a sphere.', primary: 'amount' },
    array: { label: 'Repeat', description: 'Make a row of evenly spaced copies.', primary: 'count' },
    subdivide: { label: 'Surface detail', description: 'Add vertices for finer deformations.', primary: 'level' },
    transform: { label: 'Transform', description: 'Move, rotate, or scale the geometry.', primary: 'x' }
  };
  let liveEdit = null, liveTimer = 0, advancedNodes = false;
  const selectedPart = () => parts[sel]?.mesh ? parts[sel] : null;
  const isEditing = () => state.mode === 'edit';
  const copy = o => JSON.parse(JSON.stringify(o));
  function ensure(p) {
    if (!p?.mesh) return null;
    if (!p.geom) {
      const source = p.cl?.on && p.cl.orig ? p.cl.orig : p.mesh.geometry;
      p.geom = { id: 'mesh-' + (++state.uid), base: source.clone(), nodes: [], shape: 'custom', segments: 3, welded: false };
    }
    return p.geom;
  }
  function safe(action) { try { return action(); } catch (e) { toast(e.message || String(e)); return false; } }
  function transaction(action) {
    if (exportBusy) return false;
    endLive();
    if (playing) $('#play').click();
    commit(); if (!cur) cur = hsnap();
    const result = safe(action);
    if (result !== false) { simDirty(); sync(); drawAll(); commit(); }
    return result === false ? false : true;
  }
  function normalizeGroups(geometry, material) {
    if (!Array.isArray(material)) return;
    if (!geometry.groups.length) geometry.addGroup(0, geometry.index?.count || geometry.attributes.position.count, 0);
    geometry.groups.forEach(g => { if (g.materialIndex >= material.length) g.materialIndex = 0; });
  }
  // Predict growth before allocating a result. Edge counts are needed only for
  // subdivision; deformation sliders can skip that relatively expensive scan.
  function preflight(base, nodes) {
    let vertices = base.attributes.position.count, faces = (base.index?.count || vertices) / 3;
    let edges = nodes.some(n => n.enabled !== false && n.type === 'subdivide') ? K.topology(base).edges.length : 0;
    for (const node of nodes) if (node.enabled !== false) {
      const params = node.params || node;
      if (node.type === 'subdivide') for (let level = 0; level < (params.level === undefined ? 1 : +params.level); level++) {
        vertices += edges; edges = edges * 2 + faces * 3; faces *= 4;
        if (vertices > K.MAX_VERTICES || faces > K.MAX_FACES) throw new Error('This effect would add too much geometry. Lower Surface detail or Copies first.');
      }
      if (node.type === 'array') { const copies = params.count === undefined ? 3 : +params.count; vertices *= copies; faces *= copies; edges *= copies; }
      if (vertices > K.MAX_VERTICES || faces > K.MAX_FACES) throw new Error('This effect would add too much geometry. Lower Surface detail or Copies first.');
    }
    return {vertices, faces};
  }
  function evaluate(base, nodes) {
    preflight(base, nodes);
    let result = base.clone();
    try {
      for (const node of nodes) if (node.enabled !== false) {
        const next = K.applyNode(result, node); result.dispose(); result = next;
      }
      return result;
    } catch (e) { result.dispose(); throw e; }
  }
  function replaceRendered(p, geometry) {
    normalizeGroups(geometry, p.mesh.material);
    const old = p.mesh.geometry;
    p.mesh.geometry = geometry;
    if (p.wf) p.wf.geometry = geometry;
    if (old !== geometry && old !== p.geom?.base && old !== p.cl?.orig) old.dispose();
    wireApply();
  }
  function rebuild(p) {
    const g = ensure(p); if (!g) return;
    const result = evaluate(g.base, isEditing() && p === selectedPart() ? [] : g.nodes);
    replaceRendered(p, result);
  }
  function stopCloth(p) {
    if (!p?.cl?.on) return;
    const cloth = p.mesh.geometry;
    p.mesh.geometry = p.cl.orig; p.cl.orig = null; p.cl.on = p.cl.wind = false;
    p.mesh.frustumCulled = true; if (cloth !== p.mesh.geometry) cloth.dispose(); syncPhys();
  }
  function focus() {
    const p=selectedPart();if(!p)return;
    p.mesh.updateWorldMatrix(true,false);const box=new THREE.Box3().setFromObject(p.mesh);
    if(box.isEmpty())return;
    const center=box.getCenter(new V()),radius=Math.max(.1,box.getSize(new V()).length()/2);
    const angle=Math.min(cam.fov*Math.PI/360,Math.atan(Math.tan(cam.fov*Math.PI/360)*cam.aspect));
    const distance=radius/Math.sin(angle)*1.2,direction=cam.position.clone().sub(ctl.target).normalize();
    if(!direction.lengthSq())direction.set(0,.15,1).normalize();
    ctl.target.copy(center);cam.position.copy(center).addScaledVector(direction,distance);cam.far=Math.max(100,distance+radius*4);cam.updateProjectionMatrix();ctl.update();
  }
  function clearHelpers() {
    while (helpers.children.length) {
      const o = helpers.children[0]; helpers.remove(o); o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach(m => m.dispose());
    }
  }
  function verticesOfSelection(p) {
    const g = ensure(p).base, indices = g.index, found = new Set();
    for (const id of state.selected) {
      if (state.component === 'vertex') found.add(id);
      else if (state.component === 'edge') (state.edges[id] || []).forEach(v => found.add(v));
      else if (id < indices.count / 3) for (let k = 0; k < 3; k++) found.add(indices.getX(id * 3 + k));
    }
    return [...found].filter(i => i < g.attributes.position.count);
  }
  function lineGeometry(points) { return new THREE.BufferGeometry().setFromPoints(points); }
  function updateHelpers() {
    clearHelpers();
    const p = selectedPart(); helpers.visible = isEditing() && !state.exporting;
    if (!p || !isEditing()) return;
    const g = ensure(p).base, pos = g.attributes.position;
    state.edges = K.topology(g).edges;
    p.mesh.updateWorldMatrix(true, false);
    helpers.matrixAutoUpdate = false; helpers.matrix.copy(p.mesh.matrixWorld);
    const all = new THREE.Points(g, new THREE.PointsMaterial({ color: '#a7c7e7', size: 4, sizeAttenuation: false, depthTest: false, transparent: true, opacity: .8 }));
    // Helpers own only cloned attributes; disposing them must never dispose the source mesh.
    all.geometry = new THREE.BufferGeometry(); all.geometry.setAttribute('position', pos.clone());
    all.renderOrder = 1000; helpers.add(all);
    const verts = verticesOfSelection(p), selectedPositions = verts.map(i => new V().fromBufferAttribute(pos, i));
    if (verts.length) {
      const dots = new THREE.Points(lineGeometry(selectedPositions), new THREE.PointsMaterial({ color: '#ffb355', size: 9, sizeAttenuation: false, depthTest: false }));
      dots.renderOrder = 1002; helpers.add(dots);
      if (state.component === 'edge') {
        const points = []; for (const id of state.selected) for (const i of state.edges[id] || []) points.push(new V().fromBufferAttribute(pos, i));
        const lines = new THREE.LineSegments(lineGeometry(points), new THREE.LineBasicMaterial({ color: '#ffb355', depthTest: false })); lines.renderOrder = 1001; helpers.add(lines);
      }
      if (state.component === 'face') {
        const points = []; for (const f of state.selected) for (let k = 0; k < 3; k++) points.push(new V().fromBufferAttribute(pos, g.index.getX(f * 3 + k)));
        const faces = new THREE.Mesh(lineGeometry(points), new THREE.MeshBasicMaterial({ color: '#ffb355', side: THREE.DoubleSide, transparent: true, opacity: .4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        faces.renderOrder = 998; helpers.add(faces);
      }
      const center = selectedPositions.reduce((a,b) => a.add(b), new V()).multiplyScalar(1 / verts.length);
      anchor.position.copy(p.mesh.localToWorld(center.clone())); p.mesh.getWorldQuaternion(anchor.quaternion); anchor.scale.set(1,1,1); anchor.updateMatrixWorld(true);
      tc.attach(anchor);
      ['x','y','z'].forEach((axis, i) => { const el = $('#geo-' + axis); if (document.activeElement !== el) el.value = center.getComponent(i).toFixed(3); el.disabled = false; });
    } else {
      tc.detach(); ['x','y','z'].forEach(axis => { $('#geo-' + axis).value = ''; $('#geo-' + axis).disabled = true; });
    }
    $('#geo-selection').textContent = state.selected.size + ' ' + ({vertex:'vertices',edge:'edges',face:'faces'}[state.component]) + ' selected';
    $('#geo-extrude').disabled = state.component !== 'face' || !state.selected.size;
    $('#geo-delete').disabled = state.component !== 'face' || !state.selected.size;
    gzUpdate();
  }
  function sync() {
    const p = selectedPart(), g = ensure(p);
    $('#geo-empty').hidden = !!p; $('#geo-controls').hidden = !p;
    $('#geo-edit-tools').hidden = !isEditing() || !p;
    $('#geo-mode').value = state.mode; $('#geo-component').value = state.component;
    $('#geo-component').hidden = !isEditing();
    $('#geo-mode').disabled = !parts.some(p => p.mesh);
    $('#geo-stage-label').textContent = isEditing() ? 'EDIT TOPOLOGY' : 'OBJECT MODE';
    $('#geo-stage-help').textContent = isEditing() ? 'Click to select · Shift to add · W / E / R transform · A select all' : 'Drag to orbit · Scroll to zoom · W / E / R transform';
    if (p) {
      const t = K.topology(p.mesh.geometry), base = K.topology(g.base);
      $('#geo-stats').textContent = `${t.vertices.toLocaleString()} vertices · ${t.edges.length.toLocaleString()} edges · ${t.faces.toLocaleString()} faces`;
      $('#geo-shape').value = g.shape; $('#geo-segments').value = g.segments;
      $('#geo-replace').disabled = $('#geo-segments').disabled = g.shape === 'custom';
      $('#geo-base-stats').textContent = `${base.vertices} vertices / ${base.faces} triangles in base mesh`;
      $('#geo-node-name').textContent = p.n;
      $('#geo-node-note').textContent = isEditing() ? 'Editing the base mesh. Switch to Object mode to preview nodes.' : 'Geometry flows left to right. Changes update the mesh immediately.';
    } else {
      $('#geo-stats').textContent = 'No mesh selected'; $('#geo-node-name').textContent = 'Select a mesh';
    }
    renderNodes(); updateHelpers();window.TweenDirectManipulation?.sync();
  }
  function setMode(mode, record = true) {
    window.TweenDirectManipulation?.cancel();
    endLive();
    if (mode === 'edit' && !selectedPart()) {
      const i = parts.findIndex(p => p.mesh); if (i < 0) return; selPart(i);
    }
    const p = selectedPart(); if (!p) return;
    if (playing) $('#play').click();
    if (mode === 'edit') {
      if(record)commit(); const g = ensure(p);
      if (!g.welded) { const clean = K.canonicalize(g.base); g.base.dispose(); g.base = clean; g.welded = true; }
      stopCloth(p);
      if ($('#wm').value === 'solid') { $('#wm').value = 'both'; wireApply(); }
      piv.visible = false;
    } else { piv.visible = true; tc.attach(p.o); }
    state.mode = mode; state.selected.clear(); rebuild(p); sync(); if(record)commit();
  }
  function onSelect() {
    endLive();
    state.selected.clear(); state.drag = null;
    if (isEditing()) { state.mode = 'object'; piv.visible = true; }
    // Restore node output on the previously edited part, too.
    parts.forEach(p => { if (p.mesh && p.geom && !p.cl?.on) rebuild(p); });
    sync();
  }
  function changeBase(operation) {
    const p = selectedPart(); if (!p) return false;
    return transaction(() => {
      const g = ensure(p), next = operation(g.base);let preview;
      try{preview=evaluate(next,g.nodes);}catch(e){next.dispose();throw e;}
      if(isEditing()){preview.dispose();preview=next.clone();}
      stopCloth(p);
      g.base.dispose(); g.base = next; g.welded = true; g.shape = 'custom';
      state.selected.clear(); replaceRendered(p, preview);
    });
  }
  function addShape(shape = $('#geo-add-shape').value) {
    return transaction(() => {
      const geometry = K.primitive(shape, 3);
      if (!parts.length) parts.push({ n: 'Whole model', o: root, rest: new V() });
      const group = new THREE.Group(), mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#b7a5f3', roughness: .55, metalness: .08, side: THREE.DoubleSide }));
      group.add(mesh); root.add(group);
      const n = parts.filter(p => p.geom?.shape === shape).length + 1;
      const part = { n: shape.charAt(0).toUpperCase() + shape.slice(1) + (n > 1 ? ' ' + n : ''), o: group, mesh, rest: new V() };
      parts.push(part); part.geom = { id: 'mesh-' + (++state.uid), base: geometry.clone(), nodes: [], shape, segments: 3, welded: true };
      keys.forEach(key => { while (key.p.length < parts.length) key.p.push(get(parts[key.p.length].o)); });
      if (!keys.length) upsert();
      $('#hint').style.display = 'none'; state.mode = 'object'; selPart(parts.length - 1); gzUpdate();
    });
  }
  function replaceShape() {
    const shape = $('#geo-shape').value, p = selectedPart(); if (!p || shape === 'custom') return;
    return transaction(() => {
      const g = ensure(p), segments = +$('#geo-segments').value;
      const base = K.primitive(shape, segments);let result;
      try{result=evaluate(base,g.nodes);}catch(e){base.dispose();throw e;}
      if(isEditing()){result.dispose();result=base.clone();}
      stopCloth(p); g.base.dispose(); Object.assign(g, { base, shape, segments, welded: true });
      state.selected.clear(); replaceRendered(p, result);
    });
  }
  function mutateNodes(change) {
    const p = selectedPart(); if (!p) return false;
    return transaction(() => {
      const g = ensure(p), proposed = copy(g.nodes); change(proposed);
      const result = evaluate(g.base, proposed); stopCloth(p);
      state.mode = 'object'; state.selected.clear(); piv.visible = true; tc.attach(p.o);
      g.nodes = proposed; replaceRendered(p, result);
    });
  }
  function addNode(type = $('#geo-node-type').value) {
    if (!SCHEMAS[type]) return false;
    if ((selectedPart()?.geom?.nodes.length || 0) >= 16) return toast('Use up to 16 nodes per mesh.');
    return mutateNodes(nodes => nodes.push({ id: 'node-' + (++state.uid), type, enabled: true, params: Object.fromEntries(SCHEMAS[type].fields.map(f => [f[0],f[2]])) }));
  }
  function makeNode(type, params = {}) {
    return {id:'node-' + (++state.uid), type, enabled:true, params:{...Object.fromEntries(SCHEMAS[type].fields.map(f => [f[0],f[2]])), ...params}};
  }
  function applyPreset(type) {
    if (!EFFECTS[type] || type === 'transform' || type === 'subdivide') return addNode(type);
    const p = selectedPart(); if (!p) return false;
    endLive();
    return safe(() => {
      const g = ensure(p), output = evaluate(g.base, g.nodes), additions = [];
      try {
        output.computeBoundingBox(); const size = output.boundingBox.getSize(new V()), extent = Math.max(size.x, size.y, size.z, .01);
        const faces = (output.index?.count || output.attributes.position.count) / 3;
        // Presets supply a useful surface density on simple meshes, without
        // repeatedly subdividing meshes that already have enough detail.
        if (type !== 'array' && faces > 0 && faces < 1200) {
          let levels = Math.min(2, Math.ceil(Math.log(1200 / faces) / Math.log(4)));
          while (levels > 0) {
            try { preflight(output, [makeNode('subdivide',{level:levels})]); break; } catch (_) { levels--; }
          }
          if (levels) { const detail = makeNode('subdivide',{level:levels}); detail.presetDetail = true; additions.push(detail); }
        }
        const params = type === 'smooth' ? {iterations:4, strength:.4} : type === 'noise' ? {amount:Math.min(2,extent * .08), scale:Math.max(.01,Math.min(20,3 / extent))} : type === 'spherize' ? {amount:.8, radius:Math.min(1000,extent / 2)} : type === 'array' ? {count:3, spacing:Math.min(1000,Math.max(size.x * 1.25,.1)), axis:'x'} : {angle:90};
        additions.push(makeNode(type, params));
        if (g.nodes.length + additions.length > 16) { toast('Use up to 16 nodes per mesh. Remove an effect or apply the chain to the base mesh first.'); return false; }
        return mutateNodes(nodes => nodes.push(...additions));
      } finally { output.dispose(); }
    });
  }
  function nodeIndex(value, p = selectedPart()) {
    return typeof value === 'string' ? ensure(p)?.nodes.findIndex(n => n.id === value) : value;
  }
  function updatePreviewStats(p, final = false) {
    if (p !== selectedPart()) return;
    const geometry = p.mesh.geometry, vertices = geometry.attributes.position.count, faces = (geometry.index?.count || vertices) / 3;
    $('#geo-stats').textContent = final ? `${vertices.toLocaleString()} vertices · ${K.topology(geometry).edges.length.toLocaleString()} edges · ${faces.toLocaleString()} faces` : `${vertices.toLocaleString()} vertices · ${faces.toLocaleString()} faces · live preview`;
    $('#geo-mode').value = state.mode; $('#geo-component').hidden = true; $('#geo-edit-tools').hidden = true;
    $('#geo-stage-label').textContent = 'OBJECT MODE'; $('#geo-stage-help').textContent = 'Drag to orbit · Scroll to zoom · W / E / R transform';
    $('#geo-node-note').textContent = 'Drag a slider to preview. Each adjustment is one undo step. More settings are in Advanced chain.';
  }
  function startLive(index) {
    const p = selectedPart(); if (!p || exportBusy || !ensure(p).nodes[index]) return false;
    if (liveEdit?.p === p && liveEdit.index === index) return true;
    endLive();
    if (playing) $('#play').click();
    commit(); if (!cur) cur = hsnap();
    const g = ensure(p);
    let prefix; try { prefix = evaluate(g.base, g.nodes.slice(0,index)); } catch (e) { toast(e.message); return false; }
    stopCloth(p); state.mode = 'object'; state.selected.clear(); piv.visible = true; tc.attach(p.o); clearHelpers(); helpers.visible = false;
    liveEdit = {p,index,id:g.nodes[index].id,prefix,pending:{},changed:false,rendered:false,lastAt:0,error:''};
    return true;
  }
  function syncNodeInputs(node) {
    for (const el of document.querySelectorAll('[data-geo-node]')) if (el.dataset.geoNode === node.id) {
      const value = node.params[el.dataset.geoParam];
      if (el.tagName === 'OUTPUT') el.textContent = formatNodeValue(value);
      else if (document.activeElement !== el) el.value = value;
    }
  }
  function formatNodeValue(value) { return Number.isInteger(+value) ? String(value) : (+value).toFixed(3).replace(/0+$/,'').replace(/\.$/,''); }
  function flushLive() {
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
    const live = liveEdit; if (!live || !Object.keys(live.pending).length) return true;
    const g = ensure(live.p), current = g.nodes[live.index];
    if (!current || current.id !== live.id) { cancelLive(); return false; }
    const proposed = copy(g.nodes), pending = live.pending; live.pending = {};
    Object.assign(proposed[live.index].params,pending);
    try {
      const output = evaluate(live.prefix,proposed.slice(live.index));
      g.nodes = proposed; replaceRendered(live.p,output); live.changed = true; live.rendered = true; live.lastAt = performance.now(); live.error = '';
      simDirty(); updatePreviewStats(live.p); syncNodeInputs(proposed[live.index]); return true;
    } catch (e) { if (live.error !== e.message) toast(e.message); live.error = e.message; syncNodeInputs(current); return false; }
  }
  function updateNodeLive(value, key, valueToSet) {
    const p = selectedPart(), index = nodeIndex(value,p), node = p && ensure(p).nodes[index]; if (!node) return false;
    const field = SCHEMAS[node.type].fields.find(f => f[0] === key); if (!field) return false;
    let next = Number(valueToSet); if (!Number.isFinite(next)) return false;
    next = Math.max(field[3],Math.min(field[4],next)); if (field[5] === 1) next = Math.round(next);
    if (!liveEdit && next === +(node.params[key] ?? field[2])) return true;
    if (!startLive(index)) return false;
    liveEdit.pending[key] = next;
    if (!liveEdit.rendered || performance.now() - liveEdit.lastAt >= 32) return flushLive();
    if (!liveTimer) liveTimer = setTimeout(flushLive,32);
    return true;
  }
  function cancelLive() {
    if (liveTimer) clearTimeout(liveTimer); liveTimer = 0;
    if (liveEdit) liveEdit.prefix.dispose(); liveEdit = null;
  }
  function endLive() {
    if (!liveEdit) return;
    flushLive(); const live = liveEdit; if (!live) return;
    live.prefix.dispose(); liveEdit = null;
    updatePreviewStats(live.p,true);
    if (live.changed) { drawAll(); commit(); }
  }
  function resetNode(index) {
    return mutateNodes(nodes => { const node = nodes[index]; node.params = Object.fromEntries(SCHEMAS[node.type].fields.map(f => [f[0],f[2]])); });
  }
  function installNodeUI() {
    const style = document.createElement('style'); style.textContent = `
      #geo-node-panel{max-height:min(460px,75%)}#geo-node-panel [hidden]{display:none!important}
      #geo-node-quick{padding:10px 12px 12px;overflow:auto;min-height:0}.geo-quick-caption{margin:0 0 8px;font-size:11px;color:var(--mu);line-height:1.5}
      .geo-preset-list{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.geo-preset-list button{font-size:11px;padding:6px 9px}
      .geo-effects{display:flex;flex-direction:column;gap:7px}.geo-effect{border:1px solid var(--bd);border-left:3px solid var(--effect-color);background:var(--bg);padding:8px 10px;border-radius:6px}
      .geo-effect-head{display:flex;gap:6px;align-items:center;font-size:12px}.geo-effect-head b{flex:1}.geo-effect-head button{font-size:10px;padding:2px 5px}.geo-effect-head input{margin:0;accent-color:var(--effect-color)}
      .geo-effect>small{display:block;font-size:10px;line-height:1.5;color:var(--mu);margin:3px 0 6px}.geo-effect-slider{display:flex;gap:10px;align-items:center;font-size:11px}.geo-effect-slider input{flex:1;width:80px;min-width:60px;accent-color:var(--effect-color)}.geo-effect-slider output{min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
      .geo-quick-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}.geo-quick-footer small{font-size:10px;color:var(--mu)}#geo-advanced-toggle{font-size:11px}.geo-node-description{color:var(--mu)}
      .node-field-group summary{font-size:11px;cursor:pointer;margin:3px 0 5px}.node-field-group label{margin-bottom:4px}.geo-node-reset{font-size:10px;padding:4px 6px;margin-top:4px;align-self:flex-start}
      #geo-node-chain{max-height:230px;flex-shrink:0}.node-body{max-height:150px}.geo-node-detail{font-size:10px;color:var(--mu);align-self:center}
    `; document.head.append(style);
    const quick = document.createElement('div'); quick.id = 'geo-node-quick';
    const caption = document.createElement('p'); caption.className = 'geo-quick-caption'; caption.textContent = 'Add an effect, then drag its slider. Presets add surface detail when needed; every effect stays editable.';
    const presets = document.createElement('div'); presets.className = 'geo-preset-list';
    for (const type of ['smooth','twist','noise','spherize','array']) {
      const button = document.createElement('button'); button.textContent = '+ ' + EFFECTS[type].label; button.title = EFFECTS[type].description; button.dataset.geoPreset = type;
      button.onclick = () => applyPreset(type); presets.append(button);
    }
    const effects = document.createElement('div'); effects.id = 'geo-effects'; effects.className = 'geo-effects';
    const footer = document.createElement('div'); footer.className = 'geo-quick-footer';
    const note = document.createElement('small'); note.textContent = 'Effects run from top to bottom. Undo restores any change.';
    const advanced = document.createElement('button'); advanced.id = 'geo-advanced-toggle'; advanced.textContent = 'Advanced chain'; advanced.setAttribute('aria-expanded','false');
    advanced.onclick = () => { endLive(); advancedNodes = !advancedNodes; showNodeView(); };
    footer.append(note,advanced); quick.append(caption,presets,effects,footer); $('#geo-node-panel').insertBefore(quick,$('#geo-node-chain'));
  }
  function showNodeView() {
    $('#geo-node-chain').hidden = !advancedNodes; $('#geo-node-type').hidden = $('#geo-add-node').hidden = !advancedNodes;
    $('#geo-advanced-toggle').textContent = advancedNodes ? 'Hide advanced chain' : 'Advanced chain'; $('#geo-advanced-toggle').setAttribute('aria-expanded',String(advancedNodes));
    $('#geo-node-note').textContent = isEditing() ? 'Editing the base mesh. Applying an effect switches to its live preview.' : advancedNodes ? 'Geometry flows left to right. Drag the sliders above or enter exact values below.' : 'Drag a slider to preview. Each adjustment is one undo step. More settings are in Advanced chain.';
  }
  function renderQuickNodes(p) {
    const list = $('#geo-effects'), scroll = $('#geo-node-quick').scrollTop; list.replaceChildren();
    for (const button of document.querySelectorAll('[data-geo-preset]')) button.disabled = !p;
    const nodes = p ? ensure(p).nodes : [];
    if (!nodes.length) { const empty = document.createElement('small'); empty.className = 'geo-quick-caption'; empty.textContent = p ? 'Choose an effect above to start.' : 'Select or add a mesh to use effects.'; list.append(empty); }
    for (const [index,node] of nodes.entries()) {
      const schema = SCHEMAS[node.type], effect = EFFECTS[node.type]; if (!schema || !effect) continue;
      const card = document.createElement('div'); card.className = 'geo-effect'; card.style.setProperty('--effect-color',schema.color);
      const title = document.createElement('div'); title.className = 'geo-effect-head';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = node.enabled !== false; toggle.setAttribute('aria-label','Preview ' + effect.label + ' ' + (index + 1)); toggle.onchange = () => mutateNodes(ns => ns[index].enabled = toggle.checked);
      const name = document.createElement('b'); name.textContent = effect.label;
      const reset = document.createElement('button'); reset.textContent = 'Reset'; reset.title = 'Reset this effect to its default settings'; reset.onclick = () => resetNode(index);
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label','Remove effect ' + (index + 1)); remove.onclick = () => mutateNodes(ns => ns.splice(index,1));
      title.append(toggle,name,reset,remove); const description = document.createElement('small'); description.textContent = node.presetDetail ? 'Added by the preset so the next effect has enough vertices.' : effect.description;
      const field = schema.fields.find(f => f[0] === effect.primary), [key,label,def,min,max,step] = field;
      const row = document.createElement('label'); row.className = 'geo-effect-slider'; const labelText = document.createElement('span'); labelText.textContent = label;
      const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = node.params[key] ?? def; input.disabled = node.enabled === false;
      input.setAttribute('aria-label',effect.label + ' ' + label + ' slider'); input.setAttribute('data-geo-node',node.id); input.setAttribute('data-geo-param',key);
      const output = document.createElement('output'); output.textContent = formatNodeValue(input.value); output.setAttribute('data-geo-node',node.id); output.setAttribute('data-geo-param',key);
      input.oninput = () => { output.textContent = formatNodeValue(input.value); updateNodeLive(node.id,key,+input.value); };
      input.onchange = () => { updateNodeLive(node.id,key,+input.value); endLive(); }; input.onpointerup = input.onpointercancel = input.onblur = () => endLive();
      row.append(labelText,input,output); card.append(title,description,row); list.append(card);
    }
    $('#geo-node-quick').scrollTop = scroll; showNodeView();
  }
  function renderNodes() {
    renderQuickNodes(selectedPart());
    const p = selectedPart(), list = $('#geo-node-chain'), scroll = list.scrollLeft; list.replaceChildren();
    const source = document.createElement('div'); source.className = 'geometry-node source-node';
    source.innerHTML = '<div class="node-title"><span class="node-socket"></span><b>Mesh source</b></div><div class="node-body"><b class="node-source-name"></b><small>Editable base topology</small></div>';
    source.querySelector('.node-source-name').textContent = p ? (ensure(p).shape === 'custom' ? 'Custom mesh' : ensure(p).shape) : 'Add or select a shape'; list.append(source);
    for (const [index,node] of (p ? ensure(p).nodes : []).entries()) {
      const schema = SCHEMAS[node.type]; if (!schema) continue;
      const card = document.createElement('div'); card.className = 'geometry-node' + (node.enabled === false ? ' node-bypassed' : ''); card.style.setProperty('--node-color', schema.color);
      const title = document.createElement('div'); title.className = 'node-title';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = node.enabled !== false; toggle.setAttribute('aria-label', 'Enable ' + schema.label); toggle.onchange = () => mutateNodes(ns => ns[index].enabled = toggle.checked);
      const name = document.createElement('b'); name.textContent = schema.label; title.append(toggle, name);
      for (const [label,text,delta] of [['Move node left','‹',-1],['Move node right','›',1],['Remove node','×',0]]) {
        const button = document.createElement('button'); button.textContent = text; button.title = label; button.setAttribute('aria-label', label + ' ' + (index + 1));
        button.disabled = delta < 0 && index === 0 || delta > 0 && index === ensure(p).nodes.length - 1;
        button.onclick = () => mutateNodes(ns => { if (!delta) ns.splice(index,1); else [ns[index],ns[index + delta]] = [ns[index + delta],ns[index]]; }); title.append(button);
      }
      card.append(title); const body = document.createElement('div'); body.className = 'node-body';
      const description = document.createElement('small'); description.className = 'geo-node-description'; description.textContent = EFFECTS[node.type]?.description || ''; body.append(description);
      const groups = {};
      if (node.type === 'transform') for (const group of ['Position','Rotation','Scale']) {
        const details = document.createElement('details'); details.className = 'node-field-group'; details.open = group === 'Position';
        const summary = document.createElement('summary'); summary.textContent = group; details.append(summary); groups[group] = details; body.append(details);
      }
      for (const [key,label,def,min,max,step] of schema.fields) {
        const row = document.createElement('label'), input = document.createElement('input'); row.textContent = label;
        input.type = 'number'; input.value = node.params[key] ?? def; input.min = min; input.max = max; input.step = step; input.setAttribute('aria-label', schema.label + ' ' + label);
        input.setAttribute('data-geo-node',node.id); input.setAttribute('data-geo-param',key);
        input.onchange = () => { if (!mutateNodes(ns => ns[index].params[key] = +input.value)) sync(); }; row.append(input);
        (node.type === 'transform' ? groups[key.startsWith('r') ? 'Rotation' : key.startsWith('s') ? 'Scale' : 'Position'] : body).append(row);
      }
      if (schema.axis) {
        const row = document.createElement('label'), axis = document.createElement('select'); row.textContent = 'Axis';
        for (const a of ['x','y','z']) { const option = document.createElement('option'); option.value = a; option.textContent = a.toUpperCase(); axis.append(option); }
        axis.value = node.params.axis || 'x'; axis.setAttribute('aria-label', 'Array axis'); axis.onchange = () => mutateNodes(ns => ns[index].params.axis = axis.value); row.append(axis); body.append(row);
      }
      const reset = document.createElement('button'); reset.className = 'geo-node-reset'; reset.textContent = 'Reset settings'; reset.setAttribute('aria-label','Reset ' + schema.label + ' settings'); reset.onclick = () => resetNode(index); body.append(reset);
      card.append(body); list.append(card);
    }
    const output = document.createElement('div'); output.className = 'geometry-node output-node'; output.innerHTML = '<div class="node-title"><b>Output</b><span class="node-socket"></span></div><div class="node-body"><small>Viewport · Animation · Export</small></div>'; list.append(output);
    $('#geo-add-node').disabled = !p; $('#geo-bake').disabled = !p || !ensure(p).nodes.length;
    list.scrollLeft = scroll;
  }
  function componentMode(mode) { state.component = mode; state.selected.clear(); updateHelpers(); }
  function selectAll(clear = false) {
    const p = selectedPart(); if (!p || !isEditing()) return;
    const g = ensure(p).base;
    const count = state.component === 'vertex' ? g.attributes.position.count : state.component === 'edge' ? state.edges.length : g.index.count / 3;
    state.selected = clear ? new Set() : new Set(Array.from({length:count},(_,i) => i)); updateHelpers();
  }
  function pick(e) {
    if (!isEditing()) return false;
    const p = selectedPart(); if (!p) return true;
    const box = ren.domElement.getBoundingClientRect(), mouse = new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-((e.clientY-box.top)/box.height)*2+1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, cam);
    const g = ensure(p).base, pos = g.attributes.position;
    p.mesh.updateWorldMatrix(true,false); cam.updateMatrixWorld(true);
    let id = -1, best = state.component === 'vertex' ? 12 : 9;
    const mx = e.clientX-box.left, my = e.clientY-box.top;
    function project(i) { const v = new V().fromBufferAttribute(pos,i).applyMatrix4(p.mesh.matrixWorld).project(cam); return { x:(v.x+1)*box.width/2, y:(1-v.y)*box.height/2, z:v.z }; }
    if (state.component === 'face') id = ray.intersectObject(p.mesh,false)[0]?.faceIndex ?? -1;
    else if (state.component === 'vertex') {
      for (let i=0;i<pos.count;i++) { const v=project(i), d=Math.hypot(v.x-mx,v.y-my); if(v.z>=-1&&v.z<=1&&d<best){best=d;id=i;} }
    } else {
      state.edges.forEach(([a,b],i) => { const A=project(a),B=project(b); if(A.z<-1||A.z>1||B.z<-1||B.z>1)return;
        const dx=B.x-A.x,dy=B.y-A.y,t=Math.max(0,Math.min(1,((mx-A.x)*dx+(my-A.y)*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(mx-A.x-t*dx,my-A.y-t*dy); if(d<best){best=d;id=i;} });
    }
    if (!e.shiftKey) state.selected.clear();
    if (id >= 0) { if (e.shiftKey && state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); }
    updateHelpers(); return true;
  }
  function beginDrag() {
    if (!isEditing()) return false;
    const p = selectedPart(), ids = p ? verticesOfSelection(p) : []; if (!ids.length) return true;
    commit(); anchor.updateMatrixWorld(true); p.mesh.updateWorldMatrix(true,false);
    state.drag = { p, ids, positions: ensure(p).base.attributes.position.array.slice(), inverse: anchor.matrixWorld.clone().invert(), local: p.mesh.matrixWorld.clone().invert(), world: p.mesh.matrixWorld.clone() }; return true;
  }
  function dragChange() {
    if (!isEditing() || !state.drag) return false;
    const d=state.drag, g=ensure(d.p).base, pos=g.attributes.position;
    anchor.updateMatrixWorld(true);
    const transform=d.local.clone().multiply(anchor.matrixWorld).multiply(d.inverse).multiply(d.world), v=new V();
    for(const i of d.ids){v.fromArray(d.positions,i*3).applyMatrix4(transform);pos.setXYZ(i,v.x,v.y,v.z);}
    pos.needsUpdate=true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    replaceRendered(d.p,g.clone());
    // Redraw the cage without moving the active transform anchor mid-drag.
    const saved={position:anchor.position.clone(),quaternion:anchor.quaternion.clone(),scale:anchor.scale.clone()};
    updateHelpers(); anchor.position.copy(saved.position);anchor.quaternion.copy(saved.quaternion);anchor.scale.copy(saved.scale);anchor.updateMatrixWorld(true);
    return true;
  }
  function endDrag() {
    if(!isEditing())return false;
    if(state.drag){state.drag.p.geom.shape='custom';state.drag=null;sync();commit();} return true;
  }
  function moveSelection(axis,value) {
    const p=selectedPart(); if(!p||!Number.isFinite(value))return false;
    if(Math.abs(value)>10000)throw new Error('Selection position must be between -10,000 and 10,000.');
    return transaction(()=>{
      const g=ensure(p).base, ids=verticesOfSelection(p);if(!ids.length)return false;
      const getValue=i=>g.attributes.position[['getX','getY','getZ'][axis]](i),setValue=(i,v)=>g.attributes.position[['setX','setY','setZ'][axis]](i,v);
      const center=ids.reduce((a,i)=>a+getValue(i),0)/ids.length,delta=value-center;
      ids.forEach(i=>setValue(i,getValue(i)+delta));
      g.attributes.position.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();p.geom.shape='custom';rebuild(p);
    });
  }
  function captureMaterial(mat) {
    const result={color:mat.color?.getHex()??0xb8b8c8,roughness:mat.roughness??.6,metalness:mat.metalness??0,opacity:mat.opacity??1,transparent:!!mat.transparent,alphaTest:mat.alphaTest||0,vertexColors:!!mat.vertexColors};
    if(mat.map?.image) {
      const image=mat.map.image;
      try { const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);result.map=c.toDataURL('image/png');result.flipY=mat.map.flipY; } catch(_) { /* Existing textures are retained in the session cache. */ }
    }
    return result;
  }
  function makeMaterial(data) {
    const {map,flipY,...settings}=data;
    const m=new THREE.MeshStandardMaterial({...settings,side:THREE.DoubleSide});
    if(data.map){m.map=new THREE.TextureLoader().load(data.map);m.map.flipY=data.flipY!==false;m.map.encoding=THREE.sRGBEncoding;}return m;
  }
  function capture() {
    flushLive();
    return parts.map((p,i)=>{
      if(!p.mesh)return {n:p.n,root:true,rest:p.rest.toArray(),motion:window.TweenMotionPaths?.capturePart(p)||undefined};
      const g=ensure(p);
      let entry=materialCache.get(g.id);
      if(p.face){entry={material:p.mesh.material,data:[{color:0xffffff,roughness:1,metalness:0,opacity:1,transparent:true,alphaTest:0,vertexColors:false}],array:false};materialCache.set(g.id,entry);}
      else if(!entry){entry={material:p.mesh.material,data:[].concat(p.mesh.material).map(captureMaterial),array:Array.isArray(p.mesh.material)};materialCache.set(g.id,entry);}
      else [].concat(p.mesh.material).forEach((m,i)=>{if(!entry.data[i]?.map&&m.map?.image?.width)entry.data[i]=captureMaterial(m);});
      return {n:p.n,id:g.id,rest:p.rest.toArray(),parent:parts.findIndex(q=>q.o===p.o.parent),offset:p.mesh.position.toArray(),base:K.serialize(g.base),nodes:copy(g.nodes),shape:g.shape,segments:g.segments,welded:g.welded,material:entry.data,materialArray:entry.array,
        face:window.TweenFaces?.capturePart(p)||undefined,
        motion:window.TweenMotionPaths?.capturePart(p)||undefined,
        cl:p.cl?Object.fromEntries(Object.keys(CLD()).map(k=>[k,p.cl[k]])):null};
    });
  }
  function restoreScene(records) {
    window.TweenDirectManipulation?.cancel();
    cancelLive();
    if(!Array.isArray(records)||records.length>1000)throw new Error('Invalid project mesh list.');
    const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e10);
    const ids=new Set();
    records.forEach((q,i)=>{
      if(!q||!vector(q.rest)||typeof q.n!=='string'||!!q.root!==(i===0))throw new Error('Invalid project part.');
      if(q.motion){if(!window.TweenMotionPaths)throw new Error('Motion paths are unavailable.');TweenMotionPaths.validate(q.motion);}
      if(q.root)return;
      if(typeof q.id!=='string'||ids.has(q.id)||!vector(q.offset)||!Number.isInteger(q.parent)||q.parent<0||q.parent>=records.length||q.parent===i)throw new Error('Invalid project mesh or parent.');
      ids.add(q.id);
      if(!Array.isArray(q.nodes)||q.nodes.length>16||q.nodes.some(n=>!n||!SCHEMAS[n.type]))throw new Error('Invalid geometry node chain.');
      if(!Array.isArray(q.material)||!q.material.length||q.material.length>256||q.material.some(m=>!m||typeof m!=='object'||m.map&&(!/^data:image\/(png|jpeg|webp);base64,/.test(m.map)||m.map.length>40000000)))throw new Error('Invalid saved material.');
      if(q.face){if(!window.TweenFaces)throw new Error('Face tools are unavailable.');TweenFaces.validate(q.face);}
      const seen=new Set([i]);let ancestor=q.parent;
      while(ancestor>0){if(seen.has(ancestor)||!records[ancestor]||!Number.isInteger(records[ancestor].parent))throw new Error('Project parents contain a cycle.');seen.add(ancestor);ancestor=records[ancestor].parent;}
    });
    const previous=parts[sel]?.geom?.id;
    // Validate all geometry before changing the current scene.
    const prepared=[];
    try{records.forEach(q=>{if(q.root){prepared.push(null);return;}const base=K.deserialize(q.base);try{prepared.push({base,geometry:evaluate(base,q.nodes||[])});}catch(e){base.dispose();throw e;}});}catch(e){prepared.forEach(g=>{g?.base.dispose();g?.geometry.dispose();});throw e;}
    window.TweenMotionPaths?.beforeSceneClear();window.TweenFaces?.beforeSceneClear?.();clearHelpers();tc.detach();state.mode='object';state.selected.clear();state.drag=null;piv.visible=true;
    parts.forEach(p=>{if(p.mesh){p.mesh.geometry.dispose();p.geom?.base.dispose();if(p.wf)p.wf.material.dispose();}});
    root.clear();parts=[];
    records.forEach((q,i)=>{
      if(q.root){const p={n:q.n,o:root,rest:new V().fromArray(q.rest)};if(q.motion)TweenMotionPaths.restorePart(p,q.motion);parts.push(p);return;}
      let entry=materialCache.get(q.id);
      if(entry&&(JSON.stringify(entry.data)!==JSON.stringify(q.material)||entry.array!==q.materialArray))entry=null;
      if(!entry){const mats=(q.material||[{}]).map(makeMaterial);entry={material:q.materialArray?mats:mats[0],data:q.material,array:q.materialArray};materialCache.set(q.id,entry);}
      const mesh=new THREE.Mesh(prepared[i].geometry,entry.material),o=new THREE.Group();mesh.position.fromArray(q.offset||[0,0,0]);o.add(mesh);root.add(o);
      normalizeGroups(mesh.geometry,mesh.material);
      const p={n:q.n,o,mesh,rest:new V().fromArray(q.rest),geom:{id:q.id,base:prepared[i].base,nodes:copy(q.nodes||[]),shape:q.shape||'custom',segments:q.segments||3,welded:!!q.welded}};
      if(q.face)TweenFaces.restorePart(p,q.face);
      if(q.motion)TweenMotionPaths.restorePart(p,q.motion);
      parts.push(p);state.uid=Math.max(state.uid,+(q.id||'').split('-').pop()||0,...p.geom.nodes.map(n=>+(n.id||'').split('-').pop()||0));
      if(q.cl){p.cl=Object.assign(CLD(),q.cl,{on:false});if(q.cl.on&&toCloth(p))p.cl.on=true;}
    });
    records.forEach((q,i)=>{if(i&&parts[q.parent]&&q.parent!==i)parts[q.parent].o.add(parts[i].o);});
    window.TweenFaces?.afterSceneRestore();
    window.TweenMotionPaths?.afterSceneRestore();
    sel=Math.max(0,parts.findIndex(p=>p.geom?.id===previous));
    $('#hint').style.display=parts.length?'none':'grid';wireApply();
  }
  function setExporting(on){if(on)endLive();state.exporting=on;helpers.visible=!on&&isEditing();const p=selectedPart();if(p&&isEditing()){if(on)replaceRendered(p,evaluate(ensure(p).base,ensure(p).nodes));else{rebuild(p);updateHelpers();}}}
  // Editor controls deliberately use existing history and rendering infrastructure.
  $('#geo-add').onclick=()=>addShape();
  $('#geo-focus').onclick=focus;
  $('#geo-mode').onchange=e=>safe(()=>setMode(e.target.value));
  $('#geo-component').onchange=e=>componentMode(e.target.value);
  $('#geo-replace').onclick=replaceShape;
  $('#geo-shape').onchange=e=>{$('#geo-replace').disabled=$('#geo-segments').disabled=e.target.value==='custom';};
  $('#geo-select-all').onclick=()=>selectAll();$('#geo-deselect').onclick=()=>selectAll(true);
  $('#geo-subdivide').onclick=()=>changeBase(g=>K.subdivide(g));
  $('#geo-extrude').onclick=()=>changeBase(g=>K.extrudeFaces(g,[...state.selected],+$('#geo-distance').value));
  $('#geo-delete').onclick=()=>changeBase(g=>K.deleteFaces(g,[...state.selected]));
  ['x','y','z'].forEach((axis,i)=>$('#geo-'+axis).onchange=e=>safe(()=>moveSelection(i,+e.target.value)));
  $('#geo-add-node').onclick=()=>addNode();
  $('#geo-bake').onclick=()=>transaction(()=>{const p=selectedPart();if(!p)return false;stopCloth(p);const g=ensure(p),next=evaluate(g.base,g.nodes);g.base.dispose();g.base=next;g.nodes=[];g.shape='custom';g.welded=false;state.mode='object';piv.visible=true;tc.attach(p.o);rebuild(p);});
  $('#geo-nodes-toggle').onclick=()=>{const open=$('#geo-node-panel').hidden;$('#geo-node-panel').hidden=!open;$('#geo-nodes-toggle').setAttribute('aria-expanded',String(open));};
  $('#geo-nodes-close').onclick=()=>{endLive();$('#geo-node-panel').hidden=true;$('#geo-nodes-toggle').setAttribute('aria-expanded','false');};
  addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches?.('input,select,textarea'))return;
    if(e.key.toLowerCase()==='f'){e.preventDefault();focus();return;}
    if(!isEditing())return;
    if(e.key.toLowerCase()==='a'){e.preventDefault();selectAll(e.altKey);}
    if(e.key==='Escape')selectAll(true);
    if(['1','2','3'].includes(e.key)){componentMode(['vertex','edge','face'][+e.key-1]);$('#geo-component').value=state.component;}
  });
  installNodeUI(); sync(); gzUpdate();
  return {isEditing,sync,onSelect,setMode,addShape,replaceShape,addNode,applyPreset,updateNodeLive,endLive,mutateNodes,changeBase,selectAll,componentMode,moveSelection,pick,beginDrag,dragChange,endDrag,capture,restoreScene,setExporting,focus,state};
})();
window.GeometryEditor=GeometryEditor;
