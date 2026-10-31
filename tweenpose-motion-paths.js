/* Drawn motion paths: compact project data, parent-local curves, and viewport controls. */
const TweenMotionPaths = (() => {
  'use strict';
  const V = THREE.Vector3, MAX_POINTS = 256, LIMIT = 1000000;
  const DEFAULT_EASE = [.42,0,.58,1], FORWARD = new V(0,0,1);
  let caches = new WeakMap();
  const state = { visible:true, exporting:false, part:null, pointIndex:0, editing:false, drag:null, savedControl:null };
  const helpers = new THREE.Group(); helpers.name = 'Motion path guides'; helpers.matrixAutoUpdate = false;
  helpers.userData.tweenMotionHelper = true; scene.add(helpers);
  const anchor = new THREE.Object3D(); anchor.name = 'Motion path point'; anchor.userData.tweenMotionHelper = true; scene.add(anchor);
  const dotGeometry = new THREE.SphereGeometry(1,10,8);
  const lineMaterial = new THREE.LineBasicMaterial({color:0x9c85ff,transparent:true,opacity:.9,depthTest:false,depthWrite:false});
  const dotMaterials = [0x60d6a0,0xff987c,0x9c85ff,0xffcc55].map(color => new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,transparent:true,opacity:.95}));
  let visualPart = null, visualMotion = null, markers = [], line = null;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), world = new V(), scale = new V();
  const copy = value => JSON.parse(JSON.stringify(value));
  const selected = () => parts[sel]?.o ? parts[sel] : null;
  const data = (p = selected()) => p?.motion || null;
  function number(value,min,max,label) {
    if(typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)throw new Error('Invalid '+label+'.');
    return value;
  }
  function vector(point) {
    const array = Array.isArray(point) ? point : point?.isVector3 ? point.toArray() : null;
    if(!array || array.length !== 3)throw new Error('Each path point needs X, Y and Z.');
    return array.map(n => number(n,-LIMIT,LIMIT,'path coordinate'));
  }
  function pointList(points) {
    if(!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS)throw new Error('Use between 2 and 256 path points.');
    const list = points.map(vector);
    if(!list.some(p => p.some((v,i) => Math.abs(v-list[0][i]) > 1e-8)))throw new Error('Draw a path with two different points.');
    return list;
  }
  function easing(e = DEFAULT_EASE) {
    if(!Array.isArray(e) || e.length !== 4)throw new Error('Path easing needs four curve values.');
    return e.map((v,i) => number(v,i%2?-4:0,i%2?4:1,'path easing'));
  }
  function restPose(pose) {
    if(pose == null)return null;
    if(!Array.isArray(pose) || pose.length !== 9)throw new Error('Invalid path rest pose.');
    return pose.map((n,i) => number(n,i>5?.000001:-LIMIT,i>5?10000:LIMIT,'path rest pose'));
  }
  function validate(value) {
    if(!value || value.v !== 1)throw new Error('Invalid motion path data.');
    const start = number(value.start,0,598,'path start frame'), end = number(value.end,1,599,'path end frame');
    if(!Number.isInteger(start) || !Number.isInteger(end) || end <= start)throw new Error('The path end must be a whole frame after its start.');
    const result = {v:1,enabled:value.enabled !== false,points:pointList(value.points),smooth:value.smooth !== false,
      closed:!!value.closed,start,end,e:easing(value.e),orient:!!value.orient};
    const rest = restPose(value.rest);if(rest)result.rest = rest;
    return result;
  }
  function curveFor(p) {
    const motion = data(p);if(!motion)return null;
    let cached = caches.get(p);if(cached?.source === motion)return cached;
    const points = motion.points.map(point => new V().fromArray(point));
    let curve;
    if(motion.smooth && points.length >= 3)curve = new THREE.CatmullRomCurve3(points,motion.closed,'centripetal',.5);
    else {
      curve = new THREE.CurvePath();
      for(let i=1;i<points.length;i++)if(points[i].distanceToSquared(points[i-1]) > 1e-16)curve.add(new THREE.LineCurve3(points[i-1],points[i]));
      if(motion.closed && points[points.length-1].distanceToSquared(points[0]) > 1e-16)curve.add(new THREE.LineCurve3(points[points.length-1],points[0]));
      // CurvePath.getPoint already measures distance along its line segments.
      // A second sampled arc-length remap introduces speed changes at corners.
      curve.getPointAt = curve.getPoint;
      curve.getTangentAt = curve.getTangent;
    }
    curve.arcLengthDivisions = Math.max(200,Math.min(2048,points.length*24));
    curve.updateArcLengths();
    cached = {source:motion,curve,length:curve.getLength()};caches.set(p,cached);return cached;
  }
  function pointAt(p,t) {
    const cached = curveFor(p);if(!cached)return null;
    return cached.curve.getPointAt(Math.max(0,Math.min(1,Number(t)||0)));
  }
  function progress(motion,f) {
    if(f <= motion.start)return 0;
    if(f >= motion.end)return 1;
    return Math.max(0,Math.min(1,bez((f-motion.start)/(motion.end-motion.start),motion.e)));
  }
  function sample(p,f) {
    if(typeof p === 'number' || p === undefined){f = p === undefined ? frame : p;p = selected();}
    const motion = data(p);return motion ? pointAt(p,progress(motion,Number(f)||0)) : null;
  }
  function evaluate(f) {
    for(const p of parts) {
      const motion = data(p);if(!motion?.enabled || !p.o)continue;
      const cached = curveFor(p), t = progress(motion,f), position = cached.curve.getPointAt(t);
      if(!position || !Number.isFinite(position.x+position.y+position.z))continue;
      p.o.position.copy(position);
      if(motion.orient) {
        const tangent = cached.curve.getTangentAt(t);
        if(tangent.lengthSq() > 1e-14 && Number.isFinite(tangent.x+tangent.y+tangent.z))p.o.quaternion.setFromUnitVectors(FORWARD,tangent.normalize());
      }
    }
  }
  function worldToLocal(point,p = selected()) {
    const result = point?.isVector3 ? point.clone() : new V().fromArray(vector(point));
    const parent = p?.o?.parent;
    if(parent){parent.updateWorldMatrix(true,false);parent.worldToLocal(result);}
    return result;
  }
  function localToWorld(point,p = selected()) {
    const result = point?.isVector3 ? point.clone() : new V().fromArray(vector(point));
    const parent = p?.o?.parent;
    if(parent){parent.updateWorldMatrix(true,false);parent.localToWorld(result);}
    return result;
  }
  function planeAtSelected(camera = cam) {
    const p = selected();if(!p)return null;
    p.o.updateWorldMatrix(true,false);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new V()).normalize(),p.o.getWorldPosition(new V()));
  }
  function refresh() {
    if(typeof simDirty === 'function')simDirty();
    if(typeof evalAt === 'function')evalAt(frame);else evaluate(frame);
    syncVisuals();if(typeof syncSl === 'function')syncSl();
    window.TweenMotionPanel?.sync();
  }
  function transaction(action,options = {}) {
    if(state.exporting || typeof exportBusy !== 'undefined' && exportBusy)return false;
    if(playing)$('#play').click();
    const record = options.record !== false;
    if(record){commit();if(!cur)cur = hsnap();}
    try {
      const result = action();if(result === false)return false;
      refresh();if(record)commit();return result === undefined ? true : result;
    } catch(error) {toast(error.message || String(error));return false;}
  }
  function attachPath(points,options = {}) {
    const p = options.part || selected();if(!p){toast('Select a part before drawing its path.');return false;}
    let motion;
    try {
      const coords = options.world ? points.map(point => worldToLocal(point,p).toArray()) : points;
      const start = options.start === undefined ? 0 : options.start;
      const end = options.end === undefined ? Math.max(start+1,Math.min(599,last())) : options.end;
      motion = validate({v:1,enabled:options.enabled !== false,points:coords,start,end,smooth:options.smooth !== false,
        closed:!!options.closed,orient:!!options.orient,e:options.e || DEFAULT_EASE,rest:data(p)?.rest || get(p.o)});
    } catch(error) {toast(error.message);return false;}
    return transaction(() => {stopEditing();p.motion = motion;caches.delete(p);state.part = p;state.pointIndex = 0;state.visible = true;return p;},options);
  }
  function update(patch,options = {}) {
    const p = options.part || selected();if(!p?.motion)return false;
    let motion;try{motion = validate({...p.motion,...patch});}catch(error){toast(error.message);return false;}
    return transaction(() => {
      const wasOrient = p.motion.orient;
      if((motion.enabled === false || wasOrient && !motion.orient) && p.motion.rest)put(p.o,p.motion.rest);
      p.motion = motion;caches.delete(p);state.pointIndex = Math.max(0,Math.min(state.pointIndex,motion.points.length-1));
    },options);
  }
  const setTiming = (start,end,options) => update({start,end},options);
  const setEasing = (e,options) => update({e},options);
  const setEnabled = (enabled,options) => update({enabled:!!enabled},options);
  const setSmooth = (smooth,options) => update({smooth:!!smooth},options);
  const setClosed = (closed,options) => update({closed:!!closed},options);
  const setOrient = (orient,options) => update({orient:!!orient},options);
  function setPoints(points,options = {}) {
    const p = options.part || selected();
    try{return update({points:options.world ? points.map(point => worldToLocal(point,p).toArray()) : points},options);}
    catch(error){toast(error.message);return false;}
  }
  function setPoint(index,point,options = {}) {
    const p = options.part || selected(), motion = data(p);
    if(!motion || !Number.isInteger(index) || index < 0 || index >= motion.points.length)return false;
    const points = motion.points.map(q => q.slice());
    try{points[index] = options.world ? worldToLocal(point,p).toArray() : point;}
    catch(error){toast(error.message);return false;}
    return setPoints(points,{...options,world:false});
  }
  function insertPoint(index,point,options = {}) {
    const p = options.part || selected(), motion = data(p);
    if(!motion || !Number.isInteger(index) || index < 0 || index > motion.points.length)return false;
    const points = motion.points.map(q => q.slice());
    try{points.splice(index,0,options.world ? worldToLocal(point,p).toArray() : point);}
    catch(error){toast(error.message);return false;}
    return setPoints(points,{...options,world:false});
  }
  function removePoint(index,options = {}) {
    const p = options.part || selected(), motion = data(p);
    if(!motion || !Number.isInteger(index) || index < 0 || index >= motion.points.length)return false;
    const points = motion.points.map(q => q.slice());points.splice(index,1);return setPoints(points,{...options,world:false});
  }
  function clear(options = {}) {
    const p = options.part || selected();if(!p?.motion)return false;
    return transaction(() => {stopEditing();if(p.motion.rest)put(p.o,p.motion.rest);delete p.motion;caches.delete(p);},options);
  }
  function clearVisuals() {
    if(line)line.geometry.dispose();helpers.clear();line = null;markers = [];visualPart = visualMotion = null;
  }
  function rebuildVisuals(p,motion) {
    clearVisuals();visualPart = p;visualMotion = motion;
    if(!p || !motion)return;
    const count = Math.max(48,Math.min(512,motion.points.length*8)), points = [];
    const cached = curveFor(p);
    for(let i=0;i<=count;i++)points.push(cached.curve.getPointAt(i/count));
    line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),lineMaterial);line.renderOrder = 1000;helpers.add(line);
    markers = motion.points.map((point,i) => {
      const dot = new THREE.Mesh(dotGeometry,dotMaterials[i === 0 ? 0 : i === motion.points.length-1 ? 1 : 2]);
      dot.position.fromArray(point);dot.userData.motionPoint = i;dot.renderOrder = 1001;helpers.add(dot);return dot;
    });
  }
  function syncVisuals() {
    const p = selected(), motion = data(p);
    if(state.editing && (p !== state.part || !motion || window.GeometryEditor?.isEditing() || tc.object !== anchor))stopEditing(false);
    if(p !== visualPart || motion !== visualMotion)rebuildVisuals(p,motion);
    helpers.visible = !state.exporting && state.visible && !!motion;
    if(!p || !motion)return;
    const parent = p.o.parent;if(parent){parent.updateWorldMatrix(true,false);helpers.matrix.copy(parent.matrixWorld);}else helpers.matrix.identity();
    helpers.matrixWorldNeedsUpdate = true;helpers.updateMatrixWorld(true);helpers.getWorldScale(scale);
    const distance = Math.max(.01,cam.getWorldPosition(world).distanceTo(p.o.getWorldPosition(new V())));
    const height = ren.domElement.clientHeight || ren.domElement.getBoundingClientRect?.().height || 600;
    const radius = Math.max(.004,distance*Math.tan((cam.fov || 40)*Math.PI/360)*11/Math.max(100,height));
    for(let i=0;i<markers.length;i++) {
      const dot = markers[i];dot.scale.set(radius/Math.max(.00001,Math.abs(scale.x)),radius/Math.max(.00001,Math.abs(scale.y)),radius/Math.max(.00001,Math.abs(scale.z)));
      dot.material = dotMaterials[i === state.pointIndex ? 3 : i === 0 ? 0 : i === markers.length-1 ? 1 : 2];
    }
    if(state.editing && !state.drag){anchor.position.copy(localToWorld(motion.points[state.pointIndex],p));anchor.updateMatrixWorld(true);}
  }
  function selectPoint(index) {
    const p = selected(), motion = data(p);if(!motion)return false;
    if(!Number.isInteger(index) || index < 0 || index >= motion.points.length)return false;
    state.part = p;state.pointIndex = index;syncVisuals();window.TweenMotionPanel?.sync();return true;
  }
  function editPoint(index = state.pointIndex) {
    if(state.exporting || !selectPoint(index))return false;
    if(playing)$('#play').click();
    if(window.GeometryEditor?.isEditing())GeometryEditor.setMode('object',false);
    if(!state.editing)state.savedControl = {mode:tc.mode,space:tc.space};
    state.editing = true;state.visible = true;
    anchor.position.copy(localToWorld(data().points[state.pointIndex]));anchor.rotation.set(0,0,0);anchor.scale.set(1,1,1);anchor.updateMatrixWorld(true);
    tc.setMode('translate');tc.setSpace('world');tc.attach(anchor);if(typeof gzUpdate === 'function')gzUpdate();
    syncVisuals();window.TweenMotionPanel?.sync();return true;
  }
  function stopEditing(restoreControl = true) {
    const editing = state.editing, saved = state.savedControl, attached = tc.object === anchor;
    state.editing = false;
    if(state.drag)endDrag();
    state.drag = null;
    if(editing && restoreControl && attached) {
      if(selected())tc.attach(selected().o);else tc.detach();
      if(typeof gzUpdate === 'function')gzUpdate();
    }
    if(editing && saved?.mode)tc.setMode(saved.mode);
    if(editing && saved?.space)tc.setSpace(saved.space);
    state.savedControl = null;return editing;
  }
  function isEditingPoint() {return state.editing && tc.object === anchor;}
  function beginDrag() {
    if(!isEditingPoint())return false;
    if(playing)$('#play').click();commit();if(!cur)cur = hsnap();
    state.drag = {part:state.part,index:state.pointIndex,motion:state.part.motion};return true;
  }
  function dragChange() {
    if(!isEditingPoint())return false;
    const drag = state.drag;if(!drag)return true;
    const points = drag.part.motion.points.map(q => q.slice()), point = worldToLocal(anchor.position,drag.part).toArray();
    if(point.some(n => !Number.isFinite(n) || Math.abs(n) > LIMIT))return true;
    points[drag.index] = point;
    try{drag.part.motion = validate({...drag.part.motion,points});caches.delete(drag.part);refresh();}catch(error){/* Keep the last valid path while coincident points pass one another. */}
    return true;
  }
  function endDrag() {
    if(!state.editing && !state.drag)return false;
    if(state.drag){state.drag = null;refresh();commit();}return true;
  }
  function pick(event) {
    if(state.exporting || playing || !state.visible || !data() || window.GeometryEditor?.isEditing())return false;
    syncVisuals();if(!helpers.visible)return false;
    const bounds = ren.domElement.getBoundingClientRect();if(!bounds.width || !bounds.height)return false;
    pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);
    ray.setFromCamera(pointer,cam);helpers.updateMatrixWorld(true);
    const hit = ray.intersectObjects(markers,false)[0];if(!hit)return false;
    return editPoint(hit.object.userData.motionPoint);
  }
  function setVisible(visible) {if(!visible)stopEditing();state.visible = !!visible;syncVisuals();return state.visible;}
  function setExporting(exporting) {if(exporting)stopEditing();state.exporting = !!exporting;syncVisuals();}
  function onSelect() {if(state.part !== selected()){stopEditing(false);state.part = selected();state.pointIndex = 0;}syncVisuals();window.TweenMotionPanel?.sync();}
  function capturePart(p) {return p?.motion ? copy(p.motion) : null;}
  function restorePart(p,motion) {if(!motion){delete p.motion;caches.delete(p);return p;}p.motion = validate(motion);caches.delete(p);return p;}
  function beforeSceneClear() {stopEditing(false);state.part = null;state.pointIndex = 0;caches = new WeakMap();clearVisuals();window.TweenMotionPanel?.cancelDraw?.();}
  function afterSceneRestore() {parts.forEach(p => {if(p.motion)p.motion = validate(p.motion);});caches = new WeakMap();evaluate(frame);onSelect();}
  function curveInfo(p = selected()) {const cached = curveFor(p);return {length:cached?.length || 0,count:data(p)?.points.length || 0};}
  function getState() {return {part:selected(),motion:data(),pointIndex:state.pointIndex,editing:isEditingPoint(),visible:state.visible};}
  const selectedPoint = () => data()?.points[state.pointIndex]?.slice() || null;
  const sync = () => {syncVisuals();window.TweenMotionPanel?.sync();};
  return {MAX_POINTS,selected,data,validate,capturePart,restorePart,evaluate,afterSceneRestore,beforeSceneClear,
    attachPath,setPoints,setPoint,insertPoint,removePoint,setTiming,setEasing,setEnabled,setSmooth,setClosed,setOrient,clear,
    pointAt,sample,curveInfo,worldToLocal,localToWorld,planeAtSelected,getState,selectedPoint,
    selectPoint,editPoint,stopEditing,isEditingPoint,beginDrag,dragChange,endDrag,pick,onSelect,sync,syncVisuals,setVisible,setExporting};
})();
window.TweenMotionPaths = TweenMotionPaths;
