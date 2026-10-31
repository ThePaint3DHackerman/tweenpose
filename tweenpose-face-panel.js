/* TweenPose face drawing, placement and animation workspace. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || window.TweenFacePanel) return;
  const $ = selector => document.querySelector(selector);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const state = {part:null, keyTime:null, open:false, zoom:1, contentWidth:400, dragging:null, curveDrag:null, current:0, expressionSignature:'', trackSignature:'', partsSignature:'', activeExpression:null};
  const allParts = () => typeof parts !== 'undefined' ? parts : [];
  const clock = () => typeof frame !== 'undefined' ? frame : state.current;
  const endFrame = () => Math.max(1, typeof last === 'function' ? last() : num($('#tot')?.value,30)-1);
  const core = () => window.TweenFaces;
  const presets = [
    ['Linear',[0,0,1,1]], ['Ease in',[.42,0,1,1]], ['Ease out',[0,0,.58,1]],
    ['Ease in-out',[.42,0,.58,1]], ['Overshoot',[.34,1.56,.64,1]]
  ];
  const style = document.createElement('style');
  style.textContent = `
  #face-panel{border-bottom:1px solid var(--bd);padding-bottom:14px;margin-bottom:14px}
  #face-panel h3{display:flex;align-items:center;gap:6px}#face-panel h3::before{content:'◉';color:var(--ac);font-size:14px}
  #face-panel p{font-size:12px;color:var(--mu);line-height:1.5;margin:5px 0 9px}#face-panel button{font-size:12px}
  #face-panel .face-full{width:100%;margin-top:6px}#face-select{width:100%;font-size:12px;margin-top:8px}
  #face-section-summary{display:block;font-size:11px;margin-top:7px;line-height:1.5}
  #face-editor{position:absolute;z-index:7;left:10px;right:10px;bottom:48px;max-height:min(400px,80%);background:var(--pn);border:1px solid var(--bd);border-radius:12px;box-shadow:0 12px 45px #0003;display:flex;flex-direction:column;overflow:hidden}
  .face-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
  .face-head h3{margin:0;color:var(--tx);white-space:nowrap}.face-head small{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.face-head button{font-size:11px}
  .face-body{display:grid;grid-template-columns:minmax(170px,210px) minmax(0,1fr);min-height:0;overflow:auto}
  .face-library{padding:10px;border-right:1px solid var(--bd);overflow:auto;max-height:330px}.face-library h4{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);margin:2px 0 7px}
  .face-attach{display:grid;grid-template-columns:1fr auto;gap:5px}.face-attach label{grid-column:1/-1;display:flex}.face-attach select{width:100%;min-width:0;font-size:11px;padding:4px}.face-attach button{font-size:11px;padding:4px 8px}
  #face-axis{width:68px}.face-depth{display:flex;gap:5px;align-items:center;margin:6px 0}.face-depth label{flex:1}.face-depth input{width:65px;font-size:11px;padding:4px}
  .face-expression-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:8px 0;max-height:116px;overflow:auto}
  .face-expression{padding:4px;border-radius:6px;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;background:var(--bg);border:1px solid var(--bd);position:relative}
  .face-expression img{width:100%;height:39px;object-fit:contain;background:repeating-conic-gradient(var(--cv) 0 25%,transparent 0 50%) 0 0/9px 9px;border-radius:3px}.face-expression span{display:block;width:100%;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.face-expression[aria-pressed=true]{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
  .face-empty{font-size:11px;color:var(--mu);line-height:1.5;margin:8px 0}.face-library input[type=text]{font-size:11px;padding:4px 6px}
  .face-toggles{display:flex;flex-direction:column;gap:5px;margin-top:9px}.face-toggles label{font-size:11px}.face-toggles input{accent-color:var(--ac)}
  .face-library details{margin-top:9px;font-size:11px;color:var(--mu)}.face-library summary{cursor:pointer;margin-bottom:6px}
  .face-vector{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:5px 0}.face-vector b{grid-column:1/-1;font-size:10px;font-weight:500;color:var(--mu)}.face-vector label{font-size:10px;gap:2px}.face-vector input[type=number]{min-width:0;width:100%;font-size:10px;padding:3px}
  .face-opacity{display:flex;gap:5px;align-items:center;margin:7px 0}.face-opacity label{font-size:11px}.face-opacity input{width:100%;min-width:30px;accent-color:var(--ac)}.face-opacity output{font-size:10px;color:var(--mu);min-width:30px}
  .face-animation{padding:10px 12px;min-width:0}.face-key-tools,.face-zoom-tools{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.face-key-tools button,.face-zoom-tools button,.face-key-tools input,.face-key-tools select{font-size:11px;padding:4px 7px}.face-key-tools input{width:54px}.face-key-tools .push{flex:1}.face-key-tools label{font-size:11px;gap:4px}
  .face-zoom-tools{margin:6px 0;color:var(--mu);font-size:10px}.face-zoom-tools input{width:70px;accent-color:var(--ac)}.face-zoom-tools small{font-size:10px;margin-left:auto}
  #face-track{position:relative;height:77px;overflow-x:auto;overflow-y:hidden;background:var(--bg);border:1px solid var(--bd);border-radius:7px;touch-action:none;cursor:ew-resize;scrollbar-width:thin;outline-offset:2px}
  #face-track-content{position:relative;height:60px;min-width:100%}.face-tick{position:absolute;top:0;height:100%;border-left:1px solid var(--bd);font-size:9px;color:var(--mu);padding:3px 0 0 4px;pointer-events:none}.face-tick.minor{height:8px;top:16px}.face-key-marker{position:absolute;top:30px;transform:translateX(-50%);width:24px;height:24px;padding:0;border:1px solid var(--ac);border-radius:5px;background:var(--pn);box-shadow:0 1px 3px #0002;touch-action:none}.face-key-marker::after{content:'◆';font-size:12px;color:var(--ac);display:block}.face-key-marker.on{background:var(--ac);color:white}.face-key-marker.on::after{color:white}.face-key-marker.ghost{opacity:.55;box-shadow:0 0 0 2px #ff9f1a}
  #face-playhead{position:absolute;top:0;bottom:0;width:2px;transform:translateX(-1px);background:#f26a68;pointer-events:none;z-index:3}#face-playhead::before{content:'';position:absolute;top:0;left:-4px;border:5px solid transparent;border-top-color:#f26a68}
  .face-curve-area{display:grid;grid-template-columns:minmax(140px,1fr) minmax(120px,.8fr);gap:10px;margin-top:8px;min-width:0}#face-graph{display:block;width:100%;height:159px;background:var(--bg);border:1px solid var(--bd);border-radius:7px;touch-action:none;cursor:crosshair}
  .face-curve-options{font-size:11px;min-width:0}.face-curve-options label{display:flex;font-size:11px;margin-bottom:6px;gap:5px}.face-curve-options select{font-size:11px;padding:4px;max-width:100%;min-width:0;flex:1}.face-curve-options p{font-size:10px;color:var(--mu);line-height:1.5;margin:6px 0}
  #face-curve-title{display:block;font-size:11px;font-weight:600;color:var(--tx);margin-bottom:7px}.face-bezier-values{display:grid;grid-template-columns:1fr 1fr;gap:4px}.face-bezier-values label{font-size:10px;color:var(--mu);display:flex;margin:0;gap:3px}.face-bezier-values input{width:100%;min-width:0;font-size:10px;padding:3px}
  #face-transition-preview{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ac);font-size:10px;min-height:16px;margin-top:5px}#face-status{font-size:10px;color:var(--mu);min-height:15px;margin-top:5px;line-height:1.5}
  @media(max-width:1150px){.face-body{grid-template-columns:160px minmax(0,1fr)}.face-curve-area{grid-template-columns:1fr;gap:5px}.face-curve-options{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.face-curve-options>label{flex:1;margin:0;min-width:100px}.face-curve-options p,.face-bezier-values{display:none}#face-curve-title{font-size:10px;margin:0;flex:1}.face-library{padding:8px}.face-animation{padding:8px}#face-graph{height:135px}.face-head small{display:none}.face-key-tools{gap:4px}.face-key-tools button{padding:4px}}
  @media(max-width:760px){#face-editor{left:5px;right:5px;max-height:76%;bottom:40px}.face-body{grid-template-columns:145px minmax(0,1fr)}.face-head{padding:7px;gap:4px}.face-head button{padding:4px}.face-key-tools label{display:none}.face-zoom-tools small{display:none}.face-library{max-height:330px}.face-expression-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
  const section = document.createElement('section');
  section.id = 'face-panel';
  section.innerHTML = `<h3>Faces</h3><p>Give your head a drawn face. Import transparent art as a 3D plane, then key its expressions.</p>
    <button class="p face-full" id="face-import">+ Import face art…</button>
    <select id="face-select" aria-label="Face plane"><option value="">No face planes yet</option></select>
    <button class="face-full" id="face-open" aria-expanded="false" aria-controls="face-editor">◉ Open face editor</button>
    <small id="face-section-summary">PNG transparency keeps only your drawing visible.</small>
    <input id="face-files" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple hidden>`;
  $('#L')?.prepend(section);
  const toggle = document.createElement('button');
  toggle.id = 'face-editor-toggle'; toggle.textContent = '◉ Faces'; toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls','face-editor');
  $('#gz')?.appendChild(toggle);
  const dock = document.createElement('section');
  dock.id = 'face-editor'; dock.hidden = true; dock.setAttribute('aria-label','Face animation editor');
  dock.innerHTML = `<div class="face-head"><h3>◉ Face studio</h3><small id="face-editor-name">Drawings on a 3D plane</small><button id="face-new" title="Import drawings onto a new face plane">New face…</button><button id="face-add-expression" class="p">+ Expressions…</button><button id="face-close" aria-label="Close face editor">×</button></div>
  <div class="face-body">
    <div class="face-library"><h4>On your character</h4>
      <div class="face-attach"><label for="face-parent">Head <select id="face-parent" aria-label="Attach face to head"></select></label><select id="face-axis" aria-label="Head front direction"><option value="+Z">+Z front</option><option value="-Z">−Z front</option><option value="+X">+X front</option><option value="-X">−X front</option><option value="+Y">+Y front</option><option value="-Y">−Y front</option></select><button id="face-fit">Fit to head</button></div>
      <div class="face-depth"><label>Offset <input id="face-depth" type="number" value=".015" step=".01" title="Distance in front of the head surface"></label><button id="face-attach" title="Parent the face while preserving its placement">Attach</button></div>
      <h4>Expressions</h4><div id="face-expressions" class="face-expression-list" role="group" aria-label="Face expressions"></div>
      <p id="face-expression-empty" class="face-empty">Import one or more drawings. Each image becomes an expression on the same face plane.</p>
      <label>Rename <input id="face-expression-name" type="text" placeholder="Expression name" aria-label="Expression name"></label>
      <div class="face-opacity"><label for="face-opacity">Opacity</label><input id="face-opacity" type="range" min="0" max="1" step=".01" value="1"><output id="face-opacity-value">100%</output></div>
      <div class="face-toggles"><label><input id="face-crossfade" type="checkbox" checked> Blend expressions between keys</label><label title="Uses the global Auto-key setting"><input id="face-auto-key" type="checkbox" checked> Auto-key face edits</label></div>
      <details><summary>Plane position, rotation & size</summary><div id="face-placement"></div><small>Viewport handles and the main Transform panel also move this face.</small></details>
    </div>
    <div class="face-animation">
      <div class="face-key-tools"><button id="face-prev-key" aria-label="Previous face key">◀◆</button><button id="face-next-key" aria-label="Next face key">◆▶</button><label>Frame <input id="face-frame" type="number" min="0" value="0"></label><button id="face-set-key" class="p">◆ Set face key</button><button id="face-delete-key" title="Delete the selected face key">Delete</button><span class="push"></span><label>Key at <input id="face-key-time" type="number" min="0" aria-label="Selected face key frame"></label></div>
      <div class="face-zoom-tools"><button id="face-zoom-out" aria-label="Zoom out face timeline">−</button><label>Zoom <input id="face-zoom" type="range" min="0" max="6" step=".05" value="0"></label><button id="face-zoom-in" aria-label="Zoom in face timeline">+</button><button id="face-zoom-fit">Fit</button><output id="face-zoom-value">1×</output><small>Drag keys · Ctrl + scroll to zoom</small></div>
      <div id="face-track" tabindex="0" role="group" aria-label="Face keyframes; drag to scrub, drag a key to retime"><div id="face-track-content"><div id="face-playhead"></div></div></div>
      <div class="face-curve-area"><canvas id="face-graph" width="440" height="215" tabindex="0" role="img" aria-label="Face easing graph. Drag the two control points to change easing."></canvas><div class="face-curve-options"><span id="face-curve-title">Easing to the next face key</span><label>Curve <select id="face-curve-preset" aria-label="Face easing preset"></select></label><div class="face-bezier-values"><label>X₁ <input id="face-ease-x1" type="number" min="0" max="1" step=".01"></label><label>Y₁ <input id="face-ease-y1" type="number" min="-.75" max="1.75" step=".01"></label><label>X₂ <input id="face-ease-x2" type="number" min="0" max="1" step=".01"></label><label>Y₂ <input id="face-ease-y2" type="number" min="-.75" max="1.75" step=".01"></label></div><p>The outgoing curve eases the face plane, opacity and expression blend. Turn blending off for drawn pose changes on each key.</p></div></div>
      <div id="face-transition-preview"></div><div id="face-status" role="status" aria-live="polite">Import your drawings to start a face animation.</div>
    </div>
  </div>`;
  $('#wrap')?.appendChild(dock);
  const track = $('#face-track'), content = $('#face-track-content'), graph = $('#face-graph'), ctx = graph.getContext('2d');
  const graphSize = {w:440,h:215,p:25}, GX = x => graphSize.p + x*(graphSize.w-graphSize.p*2), GY = y => graphSize.h-graphSize.p-(y+.75)/2.5*(graphSize.h-graphSize.p*2);
  let importMode = 'new', importParent = -1, resizePending = false;
  const report = message => { $('#face-status').textContent = message; };
  const error = err => { const message = err?.message || String(err); report(message); if (typeof toast === 'function') toast(message); };
  function run(action) { try { const result = action(); if (result?.catch) result.catch(error); return result; } catch (err) { error(err); } }
  function currentPart() {
    const selected = core()?.selected?.();
    if (selected?.face && allParts().includes(selected)) state.part = selected;
    if (!state.part?.face || !allParts().includes(state.part)) state.part = allParts().find(p => p.face) || null;
    return state.part;
  }
  function useFace(action) {
    const p = currentPart();
    if (!p) { report('Import a face drawing first.'); return; }
    const i = allParts().indexOf(p);
    if (typeof selPart === 'function' && core()?.selected?.() !== p) selPart(i);
    return run(() => action(p));
  }
  function selectedKey(p = currentPart()) { return p?.face.keys.find(k => k.t === state.keyTime) || null; }
  function segment(p = currentPart(), t = clock()) {
    const keys = p?.face.keys || [];
    return keys.slice().reverse().find(k => k.t <= t) || keys[0] || null;
  }
  function nextKey(p = currentPart(), key = selectedKey(p)) { return key ? p.face.keys.find(k => k.t > key.t) : null; }
  function preview(p = currentPart()) {
    if (!p) return null;
    return core()?.evaluated?.(p) || p.face.rest;
  }
  function expression(p = currentPart(), id = preview(p)?.expression) { return p?.face.expressions.find(e => e.id === id) || null; }
  function setOpen(value = true) {
    state.open = !!value; dock.hidden = !state.open;
    [toggle,$('#face-open')].forEach(b => b.setAttribute('aria-expanded',String(state.open)));
    if (state.open) {
      const nodes = $('#geo-node-panel'); if (nodes) nodes.hidden = true;
      $('#geo-nodes-toggle')?.setAttribute('aria-expanded','false');
      sync(); renderTrack(true); drawGraph();
    }
    return state.open;
  }
  function chooseFiles(mode) {
    importMode = mode;
    const p = typeof sel !== 'undefined' ? allParts()[sel] : core()?.selected?.(); importParent = p && !p.face ? allParts().indexOf(p) : num($('#face-parent').value,-1);
    if (mode === 'expressions' && currentPart()) useFace(() => {});
    $('#face-files').value = ''; $('#face-files').click();
  }
  $('#face-import').onclick = $('#face-new').onclick = () => chooseFiles('new');
  $('#face-add-expression').onclick = () => chooseFiles(currentPart() ? 'expressions' : 'new');
  $('#face-files').onchange = async event => {
    const files = Array.from(event.target.files || []); if (!files.length) return;
    if (!core()) return report('Face tools are still loading.');
    const button = $('#face-import'); button.disabled = true;
    try {
      const adding = importMode === 'expressions' && !!currentPart();
      if (adding) useFace(() => {});
      const imported = await core().importFiles(files,{asExpressions:adding,parentIndex:importParent});
      if (!imported?.face) { report('The face drawing could not be imported. Try a PNG, JPEG or WebP image.'); return; }
      state.part = imported; state.keyTime = null; state.expressionSignature = ''; sync(); setOpen(true);
      report(adding ? `${files.length} expression${files.length === 1 ? '' : 's'} added. Click a drawing at a new frame to animate it.` : 'Face art imported. Choose your head and click Fit to head, then set face keys.');
    } catch (err) { error(err); }
    finally { button.disabled = false; event.target.value = ''; }
  };
  toggle.onclick = $('#face-open').onclick = () => setOpen(!state.open);
  $('#face-close').onclick = () => setOpen(false);
  $('#geo-nodes-toggle')?.addEventListener('click',() => { if (!$('#geo-node-panel')?.hidden) setOpen(false); });
  $('#face-select').onchange = event => {
    const p = allParts()[num(event.target.value,-1)]; if (!p?.face) return;
    state.part = p; state.keyTime = null; state.expressionSignature = '';
    if (typeof selPart === 'function') selPart(allParts().indexOf(p));
    sync(); if (state.open) renderTrack(true);
  };
  $('#face-parent').onchange = () => report('Click Attach to preserve the placement, or Fit to head to place the drawing in front.');
  $('#face-attach').onclick = () => useFace(() => { core().attach(num($('#face-parent').value,-1)); sync(); report('Face attached. It will follow this head through the animation.'); });
  function fitHead() {
    useFace(() => {
      const index = num($('#face-parent').value,-1); if (index < 0) return report('Choose a head mesh first.');
      core().fitToHead(index,$('#face-axis').value,num($('#face-depth').value,.015)); sync();
      report('Face fitted in front of the head. Use the viewport handles for final placement.');
    });
  }
  $('#face-fit').onclick = fitHead;
  $('#face-depth').onchange = () => { if (num($('#face-parent').value,-1) >= 0) fitHead(); };
  $('#face-expressions').onclick = event => {
    const button = event.target.closest('[data-expression]'); if (!button) return;
    useFace(p => { core().setExpression(button.dataset.expression); if ($('#ak')?.checked && p.face.keys.some(k => k.t === clock())) state.keyTime = clock(); sync(); report($('#ak')?.checked ? 'Expression keyed at frame '+clock()+'.' : 'Expression changed. Click Set face key to record this pose.'); });
  };
  $('#face-expression-name').onchange = event => useFace(p => { const item = expression(p); if (item) { core().renameExpression(item.id,event.target.value.trim() || 'Expression'); state.expressionSignature = ''; sync(); } });
  $('#face-crossfade').onchange = event => useFace(() => { core().setCrossfade(event.target.checked); drawGraph(); report(event.target.checked ? 'Expressions blend using the easing curve between keys.' : 'Expressions switch exactly on each face key. Plane movement and opacity still ease.'); });
  $('#face-auto-key').onchange = event => { if ($('#ak')) { $('#ak').checked = event.target.checked; $('#ak').dispatchEvent(new Event('change',{bubbles:true})); } report(event.target.checked ? 'Face edits record a key at the current frame.' : 'Auto-key is off. Set a face key to record your edits.'); };
  $('#ak')?.addEventListener('change',() => { $('#face-auto-key').checked = $('#ak').checked; });
  function commitChange() { if (typeof commit === 'function') commit(); }
  function holdCommit() { if (typeof ct !== 'undefined') clearTimeout(ct); }
  $('#face-opacity').addEventListener('pointerdown',() => commitChange());
  $('#face-opacity').oninput = event => useFace(p => { core().setOpacity(num(event.target.value,1),{record:false}); holdCommit(); if ($('#ak')?.checked && p.face.keys.some(k => k.t === clock())) state.keyTime = clock(); $('#face-opacity-value').value = Math.round(num(event.target.value,1)*100)+'%'; updateClock(clock()); });
  $('#face-opacity').onchange = () => { commitChange(); sync(); };
  $('#face-opacity').addEventListener('pointerup',() => { commitChange(); sync(); });
  $('#face-opacity').addEventListener('pointercancel',() => { commitChange(); sync(); });
  ['position','rotation','scale'].forEach((kind,group) => {
    const vector = document.createElement('div'); vector.className = 'face-vector';
    const title = document.createElement('b'); title.textContent = kind === 'rotation' ? 'Rotation °' : kind[0].toUpperCase()+kind.slice(1); vector.appendChild(title);
    ['X','Y','Z'].forEach((axis,i) => {
      const label = document.createElement('label'); label.textContent = axis;
      const input = document.createElement('input'); input.type = 'number'; input.id = 'face-'+kind+'-'+axis.toLowerCase(); input.step = group === 1 ? '1' : '.01'; input.setAttribute('aria-label','Face '+kind+' '+axis); if (group === 2) input.min = '.001';
      input.onchange = () => useFace(p => { const values = (preview(p)?.p || p.face.rest.p).slice(group*3,group*3+3); values[i] = num(input.value,group === 2 ? 1 : 0); core().setPose({[kind]:values}); if ($('#ak')?.checked && p.face.keys.some(k => k.t === clock())) state.keyTime = clock(); sync(); });
      label.appendChild(input); vector.appendChild(label);
    });
    $('#face-placement').appendChild(vector);
  });
  function selectKey(key, seek = true) {
    const p = currentPart(); if (!key || !p?.face.keys.includes(key)) return false;
    state.keyTime = key.t;
    if (seek) { useFace(() => {}); window.TweenTimeline?.seek(key.t,{follow:true}); }
    updateClock(seek ? key.t : clock()); updateKeyControls(); drawGraph(); updateMarkers(); return true;
  }
  function seekTo(value) {
    const t = clamp(Math.round(num(value,clock())),0,endFrame()); useFace(() => {});
    if (window.TweenTimeline) window.TweenTimeline.seek(t,{follow:true}); else if (typeof setFrame === 'function') setFrame(t);
    state.keyTime = segment(currentPart(),t)?.t ?? null;
    updateClock(t); updateKeyControls(); updateMarkers(); drawGraph(); return t;
  }
  $('#face-frame').onchange = event => seekTo(event.target.value);
  $('#face-set-key').onclick = () => useFace(() => { const key = core().setKey(clock()); state.keyTime = key?.t ?? clock(); sync(); report('Face key set at frame '+clock()+'. Move to another frame and choose a new expression.'); });
  $('#face-delete-key').onclick = () => useFace(p => {
    const key = selectedKey(p); if (!key) return;
    core().deleteKey(key.t); state.keyTime = segment(p)?.t ?? null; sync(); report('Face key deleted.');
  });
  $('#face-key-time').onchange = event => useFace(p => {
    const key = selectedKey(p); if (!key) return;
    const target = clamp(Math.round(num(event.target.value,key.t)),0,endFrame());
    if (target !== key.t && p.face.keys.some(k => k !== key && k.t === target)) { event.target.value = key.t; return report('That frame already has a face key. Choose an empty frame.'); }
    const old = key.t; core().retimeKey(old,target); state.keyTime = target; sync(); seekTo(target); report('Face key moved to frame '+target+'.');
  });
  function stepKey(direction) {
    const keys = currentPart()?.face.keys || [], now = clock();
    const key = direction < 0 ? keys.slice().reverse().find(k => k.t < now) : keys.find(k => k.t > now);
    if (key) selectKey(key); else seekTo(direction < 0 ? 0 : endFrame());
  }
  $('#face-prev-key').onclick = () => stepKey(-1); $('#face-next-key').onclick = () => stepKey(1);
  function viewportWidth() { return track.clientWidth || 400; }
  function xAt(t) { return 18 + t/endFrame()*(state.contentWidth-36); }
  function frameAt(clientX) { return clamp(Math.round((clientX-track.getBoundingClientRect().left+track.scrollLeft-18)/(state.contentWidth-36)*endFrame()),0,endFrame()); }
  function setZoom(value, anchorFrame = clock(), anchorX = viewportWidth()/2) {
    state.zoom = clamp(num(value,1),1,64); state.trackSignature = ''; renderTrack(true);
    track.scrollLeft = clamp(xAt(anchorFrame)-anchorX,0,Math.max(0,state.contentWidth-viewportWidth()));
    $('#face-zoom').value = Math.log2(state.zoom); $('#face-zoom-value').value = (Math.round(state.zoom*10)/10)+'×';
    return state.zoom;
  }
  $('#face-zoom-in').onclick = () => setZoom(state.zoom*1.5); $('#face-zoom-out').onclick = () => setZoom(state.zoom/1.5);
  $('#face-zoom-fit').onclick = () => { setZoom(1,0,18); track.scrollLeft = 0; };
  $('#face-zoom').oninput = event => setZoom(Math.pow(2,num(event.target.value)));
  function renderTrack(force = false) {
    const p = currentPart(), keys = p?.face.keys || [];
    const width = Math.max(180,viewportWidth());
    const signature = width+':'+endFrame()+':'+state.zoom+':'+keys.map(k => k.t+','+k.expression).join('|')+':'+allParts().indexOf(p);
    if (!force && signature === state.trackSignature) { updateMarkers(); return; }
    state.trackSignature = signature; state.contentWidth = Math.max(width,(width-36)*state.zoom+36); content.style.width = state.contentWidth+'px';
    content.querySelectorAll('.face-tick,.face-key-marker').forEach(node => node.remove());
    const frameWidth = (state.contentWidth-36)/endFrame(), desired = 45/frameWidth;
    const step = [1,2,5,10,20,25,50,100,200,500].find(n => n >= desired) || 500;
    for (let t = 0; t <= endFrame(); t += step) {
      const node = document.createElement('span'); node.className = 'face-tick'; node.style.left = xAt(t)+'px'; node.textContent = t; content.appendChild(node);
    }
    if (frameWidth > 7 && step > 1) for (let t=0;t<=endFrame();t++) {
      if (t%step === 0) continue; const node = document.createElement('span'); node.className = 'face-tick minor'; node.style.left = xAt(t)+'px'; content.appendChild(node);
    }
    keys.forEach(key => {
      const node = document.createElement('button'); node.className = 'face-key-marker'; node.style.left = xAt(key.t)+'px'; node.dataset.frame = key.t; node._faceKey = key;
      const ex = p.face.expressions.find(e => e.id === key.expression);
      node.title = 'Frame '+key.t+' · '+(ex?.name || 'Face key')+' · Drag to retime'; node.setAttribute('aria-label',node.title); node.onclick = event => { if (state.suppressClick) { state.suppressClick=false; return; } event.stopPropagation(); selectKey(key); }; content.appendChild(node);
    });
    updateMarkers(); updateClock(clock());
  }
  function updateMarkers() { content.querySelectorAll('.face-key-marker').forEach(node => { node.classList.toggle('on',num(node.dataset.frame,-1) === state.keyTime); node.setAttribute('aria-pressed',String(num(node.dataset.frame,-1) === state.keyTime)); }); }
  track.addEventListener('pointerdown',event => {
    if (event.button > 1) return; event.preventDefault(); window.TweenTimeline?.stop();
    const node = event.target.closest('.face-key-marker');
    if (event.altKey || event.button === 1) state.dragging = {kind:'pan',x:event.clientX,scroll:track.scrollLeft};
    else if (node?._faceKey) { selectKey(node._faceKey); state.dragging = {kind:'key',node,key:node._faceKey,from:node._faceKey.t,to:node._faceKey.t,x:event.clientX}; }
    else { state.dragging = {kind:'scrub'}; seekTo(frameAt(event.clientX)); }
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener('pointermove',event => {
    const drag = state.dragging; if (!drag) return;
    if (drag.kind === 'pan') { track.scrollLeft = clamp(drag.scroll+drag.x-event.clientX,0,state.contentWidth-viewportWidth()); return; }
    if (drag.kind === 'key') {
      if (Math.abs(event.clientX-drag.x) < 3 && !drag.moved) return;
      drag.moved = true; drag.to = frameAt(event.clientX); drag.node.style.left=xAt(drag.to)+'px'; drag.node.classList.add('ghost'); $('#face-key-time').value=drag.to; report('Move face key to frame '+drag.to); return;
    }
    seekTo(frameAt(event.clientX));
  });
  function finishTrackDrag(event,cancel) {
    const drag = state.dragging; if (!drag) return; state.dragging = null;
    if (drag.kind === 'key' && drag.moved) {
      state.suppressClick = true;
      if (!cancel && drag.to !== drag.from) useFace(p => {
        if (p.face.keys.some(k => k !== drag.key && k.t === drag.to)) report('That frame already has a face key. Choose an empty frame.');
        else { core().retimeKey(drag.from,drag.to); state.keyTime=drag.to; seekTo(drag.to); report('Face key moved to frame '+drag.to+'.'); }
      });
      renderTrack(true); updateKeyControls();
    }
    try { track.releasePointerCapture(event.pointerId); } catch (_) {}
  }
  track.addEventListener('pointerup',event => finishTrackDrag(event,false)); track.addEventListener('pointercancel',event => finishTrackDrag(event,true));
  track.addEventListener('lostpointercapture',event => { if (state.dragging) finishTrackDrag(event,false); });
  track.addEventListener('wheel',event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const anchorX = event.clientX-track.getBoundingClientRect().left, anchor = (anchorX+track.scrollLeft-18)/(state.contentWidth-36)*endFrame();
      setZoom(state.zoom*Math.exp(-event.deltaY*.008),anchor,anchorX);
    } else track.scrollLeft += event.deltaX || event.deltaY;
  },{passive:false});
  track.addEventListener('keydown',event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(state.zoom*1.5); }
    else if (event.key === '-') { event.preventDefault(); setZoom(state.zoom/1.5); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); $('#face-delete-key').click(); }
  });
  presets.forEach(([name,values]) => { const option=document.createElement('option'); option.value=values.join(','); option.textContent=name; $('#face-curve-preset').appendChild(option); });
  const customOption=document.createElement('option'); customOption.value='custom'; customOption.textContent='Custom curve'; $('#face-curve-preset').appendChild(customOption);
  function setEasing(values, options = {}) {
    if(window.TweenInterpolation?.isHold())return false;
    return useFace(p => {
      const key=selectedKey(p); if (!key || !nextKey(p,key)) return false;
      const curve=values.map((v,i) => clamp(num(v,i<2?0:1),i%2?-.75:0,i%2?1.75:1));
      core().setEasing(curve,key.t,options); if (options.record === false) holdCommit(); updateCurveControls(); drawGraph(); return true;
    });
  }
  $('#face-curve-preset').onchange=event => { if (event.target.value !== 'custom') { setEasing(event.target.value.split(',').map(Number)); report('Face easing updated. Play or scrub to preview.'); } };
  const easeIds=['#face-ease-x1','#face-ease-y1','#face-ease-x2','#face-ease-y2'];
  easeIds.forEach(id => { $(id).onchange=() => setEasing(easeIds.map(id => num($(id).value))); });
  function updateCurveControls() {
    const p=currentPart(), key=selectedKey(p), next=nextKey(p,key), curve=key?.e || [.42,0,.58,1], held=window.TweenInterpolation?.isHold(), enabled=!!next&&!held;
    $('#face-curve-preset').disabled=!enabled;
    const matching=presets.find(([,values]) => values.every((v,i) => Math.abs(v-curve[i])<.0001));
    $('#face-curve-preset').value=matching?matching[1].join(','):'custom';
    easeIds.forEach((id,i) => { $(id).disabled=!enabled; if (document.activeElement!==$(id)) $(id).value=Math.round(curve[i]*1000)/1000; });
    $('#face-curve-title').textContent=held?'Hold · no tweening':key&&next?'Easing · '+key.t+' → '+next.t:'Easing to the next face key';
  }
  function bezierY(x,e) {
    const component=(t,a,b) => 3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3;
    let lo=0,hi=1,t=x;
    for(let i=0;i<16;i++){ const px=component(t,e[0],e[2]); if(px<x)lo=t;else hi=t; t=(lo+hi)/2; }
    return component(t,e[1],e[3]);
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function drawGraph() {
    if (!ctx) return;
    const {w,h,p:padding}=graphSize, part=currentPart(), key=selectedKey(part), next=nextKey(part,key);
    ctx.clearRect(0,0,w,h); ctx.lineWidth=1; ctx.strokeStyle=css('--bd');
    [0,.25,.5,.75,1].forEach(value => { ctx.beginPath(); ctx.moveTo(GX(value),GY(-.75));ctx.lineTo(GX(value),GY(1.75));ctx.moveTo(GX(0),GY(value));ctx.lineTo(GX(1),GY(value));ctx.stroke(); });
    ctx.fillStyle=css('--mu');ctx.font='11px system-ui';ctx.textAlign='left';ctx.fillText('progress',7,13);ctx.textAlign='right';ctx.fillText('time →',w-7,h-6);
    if (!key || !next) {
      ctx.textAlign='center';ctx.fillText(!part?'Import your face drawings to begin.':!key?'Set two face keys to shape the timing.':'Add a later face key to edit this curve.',w/2,h/2-4);
      ctx.fillText('Then drag the two orange handles.',w/2,h/2+14);return;
    }
    if(window.TweenInterpolation?.isHold()){ctx.strokeStyle=css('--ac');ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(GX(0),GY(0));ctx.lineTo(GX(1),GY(0));ctx.lineTo(GX(1),GY(1));ctx.stroke();ctx.textAlign='center';ctx.fillText('Hold this face until frame '+next.t,w/2,30);return;}
    const e=key.e || [.42,0,.58,1];
    ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(GX(0),GY(0));ctx.lineTo(GX(1),GY(1));ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle=css('--mu');ctx.beginPath();ctx.moveTo(GX(0),GY(0));ctx.lineTo(GX(e[0]),GY(e[1]));ctx.moveTo(GX(1),GY(1));ctx.lineTo(GX(e[2]),GY(e[3]));ctx.stroke();
    ctx.strokeStyle=css('--ac');ctx.lineWidth=3;ctx.beginPath();
    for(let i=0;i<=64;i++){const t=i/64,x=3*(1-t)**2*t*e[0]+3*(1-t)*t*t*e[2]+t**3,y=3*(1-t)**2*t*e[1]+3*(1-t)*t*t*e[3]+t**3;i?ctx.lineTo(GX(x),GY(y)):ctx.moveTo(GX(x),GY(y));}ctx.stroke();
    [[0,0],[1,1]].forEach(q => {ctx.fillStyle=css('--ac');ctx.beginPath();ctx.arc(GX(q[0]),GY(q[1]),4,0,Math.PI*2);ctx.fill();});
    [[e[0],e[1]],[e[2],e[3]]].forEach((q,i) => {ctx.fillStyle='#ffad45';ctx.beginPath();ctx.arc(GX(q[0]),GY(q[1]),8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#352000';ctx.textAlign='center';ctx.fillText(String(i+1),GX(q[0]),GY(q[1])+4);});
    const t=(state.current-key.t)/(next.t-key.t);
    if (t>=0&&t<=1) {const y=bezierY(t,e);ctx.strokeStyle='#ef6b69';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(GX(t),h-padding);ctx.lineTo(GX(t),GY(y));ctx.stroke();ctx.fillStyle='#ef6b69';ctx.beginPath();ctx.arc(GX(t),GY(y),5,0,Math.PI*2);ctx.fill();}
  }
  graph.addEventListener('pointerdown',event => {
    if(window.TweenInterpolation?.isHold())return;
    const key=selectedKey(), next=nextKey();if(!key||!next)return;event.preventDefault();window.TweenTimeline?.stop();useFace(() => {});commitChange();
    const rect=graph.getBoundingClientRect(),x=(event.clientX-rect.left)*graphSize.w/rect.width,y=(event.clientY-rect.top)*graphSize.h/rect.height,e=key.e || [.42,0,.58,1];
    const distances=[Math.hypot(x-GX(e[0]),y-GY(e[1])),Math.hypot(x-GX(e[2]),y-GY(e[3]))];
    state.curveDrag={handle:distances[0]<distances[1]?0:1,original:e.slice()};graph.setPointerCapture(event.pointerId);moveGraph(event);
  });
  function moveGraph(event) {
    if(window.TweenInterpolation?.isHold())return;
    if(!state.curveDrag)return;const rect=graph.getBoundingClientRect(),x=(event.clientX-rect.left)*graphSize.w/rect.width,y=(event.clientY-rect.top)*graphSize.h/rect.height;
    const key=selectedKey();if(!key)return;const values=(key.e || [.42,0,.58,1]).slice(),offset=state.curveDrag.handle*2;
    values[offset]=clamp((x-graphSize.p)/(graphSize.w-graphSize.p*2),0,1);values[offset+1]=clamp((graphSize.h-graphSize.p-y)/(graphSize.h-graphSize.p*2)*2.5-.75,-.75,1.75);
    setEasing(values,{record:false});
  }
  graph.addEventListener('pointermove',moveGraph);
  function finishGraph(event,cancel) {
    if(!state.curveDrag)return;const original=state.curveDrag.original;state.curveDrag=null;
    if(cancel)setEasing(original,{record:false});commitChange();sync();
    try{graph.releasePointerCapture(event.pointerId);}catch(_){}
  }
  graph.addEventListener('pointerup',event=>finishGraph(event,false));graph.addEventListener('pointercancel',event=>finishGraph(event,true));graph.addEventListener('lostpointercapture',event=>{if(state.curveDrag)finishGraph(event,false);});
  function updateKeyControls() {
    const key=selectedKey();$('#face-key-time').disabled=!key;$('#face-delete-key').disabled=!key;
    if(document.activeElement!==$('#face-key-time'))$('#face-key-time').value=key?.t??'';
    $('#face-key-time').max=endFrame();$('#face-frame').max=endFrame();updateCurveControls();
  }
  function renderExpressions(p) {
    const list=$('#face-expressions'),items=p?.face.expressions || [];
    const signature=allParts().indexOf(p)+':'+items.map(e=>e.id+':'+e.name).join('|');
    if(signature===state.expressionSignature)return;state.expressionSignature=signature;state.activeExpression=null;list.replaceChildren();
    items.forEach(item=>{const button=document.createElement('button');button.className='face-expression';button.setAttribute('data-expression',item.id);button.title=item.name;button.setAttribute('aria-label','Use expression '+item.name);button.setAttribute('aria-pressed','false');const img=document.createElement('img');img.src=item.src;img.alt='';img.loading='lazy';const name=document.createElement('span');name.textContent=item.name;button.append(img,name);list.appendChild(button);});
    $('#face-expression-empty').hidden=items.length>0;
  }
  function renderParts(p) {
    const list=allParts(),signature=list.map((part,i)=>i+':'+part.n+':'+!!part.face).join('|');
    if(signature===state.partsSignature){$('#face-select').value=p?String(list.indexOf(p)):'';return;}
    state.partsSignature=signature;
    const faces=$('#face-select');faces.replaceChildren();
    if(!list.some(part=>part.face)){const option=document.createElement('option');option.value='';option.textContent='No face planes yet';faces.appendChild(option);}
    list.forEach((part,i)=>{if(!part.face)return;const option=document.createElement('option');option.value=i;option.textContent=part.n;faces.appendChild(option);});
    faces.value=p?String(list.indexOf(p)):'';
    const parent=$('#face-parent'),old=parent.value;parent.replaceChildren();
    const none=document.createElement('option');none.value='-1';none.textContent='Choose head…';parent.appendChild(none);
    list.forEach((part,i)=>{if(part.face||!part.mesh)return;const option=document.createElement('option');option.value=i;option.textContent=part.n;parent.appendChild(option);});
    parent.value=Array.from(parent.options).some(option=>option.value===old)?old:'-1';
  }
  function sync() {
    const previous=state.part,p=currentPart();
    const faceSelected=!!core()?.selected?.();
    $('#addk').textContent=faceSelected?'◆ Set face key':'◆ Set key';
    $('#delk').textContent=faceSelected?'Delete face key':'Delete key';
    if(p!==previous){state.keyTime=null;state.expressionSignature='';state.trackSignature='';}
    if(state.keyTime===null || (p&&!selectedKey(p)))state.keyTime=segment(p)?.t??null;
    renderParts(p);renderExpressions(p);
    $('#face-select').disabled=!p;$('#face-add-expression').disabled=!p;
    const disabled=!p;
    ['#face-parent','#face-axis','#face-depth','#face-attach','#face-fit','#face-expression-name','#face-opacity','#face-crossfade','#face-set-key'].forEach(id=>{$(id).disabled=disabled;});
    $('#face-crossfade').disabled=disabled||!!window.TweenInterpolation?.isHold();
    $('#face-placement').querySelectorAll('input').forEach(input=>input.disabled=disabled);
    $('#face-editor-name').textContent=p?p.n+' · independent expression keys':'Drawings on a 3D plane';
    $('#face-section-summary').textContent=p?`${p.face.expressions.length} expression${p.face.expressions.length===1?'':'s'} · ${p.face.keys.length} face key${p.face.keys.length===1?'':'s'}`:'PNG transparency keeps only your drawing visible.';
    if(p){
      const parentIndex=allParts().findIndex(q=>q.o===p.o?.parent && q!==p);if(parentIndex>=0&&allParts()[parentIndex]?.mesh)$('#face-parent').value=parentIndex;
      $('#face-crossfade').checked=p.face.crossfade!==false;
      const data=preview(p)||p.face.rest;
      ['position','rotation','scale'].forEach((kind,group)=>['x','y','z'].forEach((axis,i)=>{const input=$('#face-'+kind+'-'+axis);if(document.activeElement!==input)input.value=Math.round(num(data.p?.[group*3+i],group===2?1:0)*1000)/1000;}));
    }
    $('#face-auto-key').checked=$('#ak')?.checked!==false;
    renderTrack();updateKeyControls();updateClock(clock());drawGraph();
  }
  function updateClock(value) {
    state.current=num(value,clock());const p=currentPart(),data=preview(p),item=expression(p,data?.expression);
    if(state.open&&data?.p) ['position','rotation','scale'].forEach((kind,group)=>['x','y','z'].forEach((axis,i)=>{const input=$('#face-'+kind+'-'+axis);if(document.activeElement!==input)input.value=Math.round(data.p[group*3+i]*1000)/1000;}));
    if(document.activeElement!==$('#face-frame'))$('#face-frame').value=Math.floor(state.current);
    $('#face-playhead').style.left=xAt(state.current)+'px';
    if(state.open&&window.TweenTimeline?.playing){
      const next=segment(p,state.current);if(next?.t!==state.keyTime){state.keyTime=next?.t??null;updateKeyControls();updateMarkers();}
      const x=xAt(state.current);if(x<track.scrollLeft+12||x>track.scrollLeft+viewportWidth()-18)track.scrollLeft=clamp(x-viewportWidth()/3,0,Math.max(0,state.contentWidth-viewportWidth()));
    }
    if(state.activeExpression!==data?.expression){state.activeExpression=data?.expression;$('#face-expressions').querySelectorAll('[data-expression]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.expression===data?.expression)));}
    if(document.activeElement!==$('#face-expression-name')&&$('#face-expression-name').value!==(item?.name||''))$('#face-expression-name').value=item?.name||'';
    if(document.activeElement!==$('#face-opacity')&&num($('#face-opacity').value)!==num(data?.opacity,1))$('#face-opacity').value=num(data?.opacity,1);
    $('#face-opacity-value').value=Math.round(num(data?.opacity,1)*100)+'%';
    const key=segment(p,state.current),next=key&&nextKey(p,key),from=expression(p,key?.expression),to=expression(p,next?.expression);
    if(key&&next&&state.current>=key.t&&state.current<next.t){const progress=clamp((state.current-key.t)/(next.t-key.t),0,1),amount=clamp(bezierY(progress,key.e||[.42,0,.58,1]),0,1),blend=p.face.crossfade!==false&&!window.TweenInterpolation?.isHold();$('#face-transition-preview').textContent=(blend?'Blend ':'Hold ')+(from?.name||'Face')+' → '+(to?.name||'Face')+(blend?' · '+Math.round(amount*100)+'%':' at frame '+next.t);}
    else $('#face-transition-preview').textContent=item?'Expression: '+item.name+' · frame '+Math.floor(state.current):'';
    if(state.open)drawGraph();
  }
  function resize() {if(resizePending)return;resizePending=true;requestAnimationFrame(()=>{resizePending=false;if(state.open)renderTrack(true);});}
  if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(track);
  window.TweenFacePanel={sync,updateClock,selectKey,open:()=>setOpen(true),close:()=>setOpen(false),setZoom,seek:seekTo,renderTrack,drawGraph,setEasing,
    state,graph:{canvas:graph,size:graphSize,xAt:GX,yAt:GY,setEasing,presets},get selectedKey(){return selectedKey();},get activePart(){return currentPart();}};
  sync();
})();
