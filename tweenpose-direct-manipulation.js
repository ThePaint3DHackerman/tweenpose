/* Move objects by dragging their visible surfaces, with one undo step per gesture. */
const TweenDirectManipulation = (() => {
  'use strict';
  const canvas = ren.domElement, ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const state = {enabled:true,drag:null};
  const toggle = document.createElement('button');
  toggle.id = 'direct-drag-toggle'; toggle.type = 'button'; toggle.textContent = 'Drag objects';
  toggle.title = 'Drag an object to move it. Alt-drag or drag empty space to orbit. Hold Shift for precision.';
  toggle.setAttribute('aria-pressed','true');
  const toolbar = $('#gz'); toolbar?.insertBefore(toggle,$('#gsp'));
  const selected = () => parts[sel] || null;
  const mode = () => tc.getMode ? tc.getMode() : tc.mode;
  const blocked = () => !state.enabled || playing || exportBusy || mode() !== 'translate' ||
    window.GeometryEditor?.isEditing() || window.TweenMotionPanel?.drawing || window.TweenMotionPaths?.isEditingPoint();
  const stop = event => {event?.preventDefault?.();event?.stopImmediatePropagation?.();event?.stopPropagation?.();};
  const pointerId = event => event?.pointerId ?? 1;
  const samePointer = event => !event || pointerId(event) === state.drag?.pointer;
  function rayAt(event) {
    const bounds = canvas.getBoundingClientRect();
    if(!bounds.width || !bounds.height)return false;
    pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);
    cam.updateWorldMatrix(true,false); ray.setFromCamera(pointer,cam); return true;
  }
  function historyState() {
    return {undo:undo.slice(),redo:redo.slice(),cur,navigationPose,navigationFrame};
  }
  function restoreHistory(history) {
    if(!history)return;
    clearTimeout(ct); undo=history.undo; redo=history.redo; cur=history.cur;
    navigationPose=history.navigationPose; navigationFrame=history.navigationFrame;
  }
  function restoreControls(drag) {
    ctl.enabled=drag.controls.orbit; tc.enabled=drag.controls.transform;
    canvas.style.cursor=drag.controls.cursor;
    try {if(canvas.hasPointerCapture?.(drag.pointer))canvas.releasePointerCapture(drag.pointer);} catch(error) {/* Capture may already have ended. */}
  }
  function updateHint() {
    toggle.classList.toggle('p',state.enabled); toggle.setAttribute('aria-pressed',String(state.enabled));
    if(window.GeometryEditor?.isEditing() || window.TweenMotionPanel?.drawing || window.TweenMotionPaths?.isEditingPoint())return;
    const hint=$('#geo-stage-help'); if(!hint)return;
    if(state.drag?.started)hint.textContent='Moving '+(state.drag.motion?'object and motion path':'object')+' · Shift for precision · Esc cancels';
    else if(state.enabled && mode()==='translate')hint.textContent='Drag object to move · Empty space or Alt-drag to orbit · Shift for precision';
    else if(state.enabled)hint.textContent='Drag handles to '+(mode()==='rotate'?'rotate':'scale')+' · W to drag objects · Empty space to orbit';
    else hint.textContent='Click to select · Drag to orbit · W / E / R transform handles';
  }
  function sync() {
    if(state.drag && (selected()!==state.drag.part || blocked()))cancel();
    if(state.drag){ctl.enabled=false;tc.enabled=false;}
    updateHint(); return state.enabled;
  }
  function setEnabled(enabled) {if(!enabled)cancel();state.enabled=!!enabled;sync();return state.enabled;}
  function begin(event) {
    if(state.drag || blocked() || tc.axis || tc.dragging || event?.altKey || event?.isPrimary===false ||
       event?.button!==undefined && event.button!==0 || !rayAt(event))return false;
    scene.updateMatrixWorld(true);
    // Path dots remain available for their own point editor even over a mesh surface.
    const markers=[];scene.traverse(object=>{
      if(object.isMesh && Number.isInteger(object.userData.motionPoint) && object.visible && object.parent?.visible)markers.push(object);
    });
    if(markers.length && ray.intersectObjects(markers,false).length)return false;
    const meshes=parts.filter(p=>p.mesh && p.o.visible!==false && p.mesh.visible!==false).map(p=>p.mesh);
    const hit=ray.intersectObjects(meshes,false)[0];if(!hit)return false;
    let index=parts.findIndex(p=>p.mesh===hit.object);if(index<0)return false;
    // The Whole model entry has no surface of its own: use any descendant surface.
    const prior=selected();
    if(prior?.o && !prior.mesh) {
      let ancestor=hit.object;
      while(ancestor && ancestor!==prior.o)ancestor=ancestor.parent;
      if(ancestor===prior.o)index=sel;
    }
    if(index!==sel)selPart(index);
    const part=selected();if(!part?.o)return false;
    part.o.updateWorldMatrix(true,false);
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new THREE.Vector3()).normalize(),hit.point);
    const origin=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!origin)return false;
    state.drag={part,index,pointer:pointerId(event),x:event.clientX,y:event.clientY,plane,origin,
      world:part.o.getWorldPosition(new THREE.Vector3()),pose:get(part.o),quaternion:part.o.quaternion.clone(),
      motion:part.motion?.enabled ? part.motion : null,started:false,history:null,previousG0:g0,
      controls:{orbit:ctl.enabled,transform:tc.enabled,cursor:canvas.style.cursor||''}};
    ctl.enabled=false;tc.enabled=false;canvas.style.cursor='grab';
    try {canvas.setPointerCapture?.(state.drag.pointer);} catch(error) {/* Some pointer types do not support capture. */}
    stop(event);updateHint();return true;
  }
  function move(event) {
    const drag=state.drag;if(!drag || !samePointer(event))return false;
    stop(event);
    if(selected()!==drag.part || blocked()){cancel();return false;}
    if(!drag.started && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<3)return true;
    if(!rayAt(event))return true;
    const hit=ray.ray.intersectPlane(drag.plane,new THREE.Vector3());if(!hit)return true;
    if(!drag.started) {
      drag.history=historyState();clearTimeout(ct);commit();if(!cur)cur=hsnap();
      drag.started=true;g0=drag.pose.slice();canvas.style.cursor='grabbing';updateHint();
    }
    const delta=hit.sub(drag.origin).multiplyScalar(event.shiftKey ? .1 : 1),world=drag.world.clone().add(delta);
    const parent=drag.part.o.parent;parent?.updateWorldMatrix(true,false);
    let local=parent?parent.worldToLocal(world.clone()):world.clone();
    const step=Number(tc.translationSnap);
    // Holding Shift gives a continuous fine adjustment, independent of coarse grid spacing.
    if(!event.shiftKey && Number.isFinite(step) && step>0) {
      if(tc.space==='world') {
        world.set(Math.round(world.x/step)*step,Math.round(world.y/step)*step,Math.round(world.z/step)*step);
        local=parent?parent.worldToLocal(world):world;
      } else {
        local.applyQuaternion(drag.quaternion.clone().invert());
        local.set(Math.round(local.x/step)*step,Math.round(local.y/step)*step,Math.round(local.z/step)*step);
        local.applyQuaternion(drag.quaternion);
      }
    }
    if(!Number.isFinite(local.x+local.y+local.z))return true;
    drag.part.o.position.copy(local);drag.part.o.updateWorldMatrix(false,true);
    syncSl();return true;
  }
  function cancel(event) {
    const drag=state.drag;if(!drag || !samePointer(event))return false;
    state.drag=null;stop(event);
    if(drag.started) {put(drag.part.o,drag.pose);drag.part.o.updateWorldMatrix(true,true);restoreHistory(drag.history);}
    g0=drag.previousG0;restoreControls(drag);syncSl();window.TweenMotionPaths?.syncVisuals();updateHint();return true;
  }
  function finish(event) {
    const drag=state.drag;if(!drag || !samePointer(event))return false;
    stop(event);
    if(selected()!==drag.part || blocked())return cancel();
    if(!drag.started)return cancel();
    const pose=get(drag.part.o),delta=pose.slice(0,3).map((v,i)=>v-drag.pose[i]);
    if(delta.every(v=>Math.abs(v)<1e-9))return cancel();
    const actualCommit=commit;
    try {
      // Face edits use a transaction internally. This enclosing gesture supplies its single history entry.
      commit=()=>{clearTimeout(ct);};
      if(drag.motion) {
        const points=drag.motion.points.map(point=>point.map((v,i)=>v+delta[i]));
        if(!window.TweenMotionPaths?.setPoints(points,{part:drag.part,record:false}))throw new Error('The motion path could not be moved.');
      }
      g0=drag.pose.slice();gizmoEnd();clearTimeout(ct);
    } catch(error) {
      if(drag.motion)window.TweenMotionPaths?.restorePart(drag.part,drag.motion);
      commit=actualCommit;cancel();toast(error.message||String(error));return false;
    } finally {commit=actualCommit;}
    state.drag=null;g0=drag.previousG0;restoreControls(drag);
    clearTimeout(ct);commit();syncSl();window.TweenMotionPaths?.syncVisuals();updateHint();return true;
  }
  canvas.addEventListener('pointerdown',begin,true);
  canvas.addEventListener('pointermove',move,true);
  canvas.addEventListener('pointerup',finish,true);
  canvas.addEventListener('pointercancel',cancel,true);
  canvas.addEventListener('lostpointercapture',cancel,true);
  addEventListener('keydown',event=>{if(event.key==='Escape' && state.drag){stop(event);cancel();}},true);
  addEventListener('blur',()=>cancel());
  toggle.onclick=()=>setEnabled(!state.enabled);
  updateHint();
  return {get active(){return !!state.drag;},get pending(){return !!state.drag && !state.drag.started;},
    get enabled(){return state.enabled;},setEnabled,sync,cancel,begin,move,finish};
})();
window.TweenDirectManipulation=TweenDirectManipulation;
