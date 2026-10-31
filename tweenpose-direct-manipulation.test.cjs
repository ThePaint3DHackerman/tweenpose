/* Native-pointer integration and real THREE r128 ray/plane math for object dragging.
 * No browser or GPU context is launched. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createApp}=require('./tweenpose-app.test.cjs');
const THREE=require('./tweenpose-tests/three-r128.cjs');

const plain=value=>JSON.parse(JSON.stringify(value));
function close(actual,expected,tolerance=1e-6){assert(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);}
function vector(actual,expected,tolerance=1e-6){actual.forEach((n,i)=>close(n,expected[i],tolerance));}
async function app(){
  const listeners={};
  const a=await createApp(THREE,{addEventListener(type,fn,options){(listeners[type]||=[]).push({fn,capture:options===true||!!options?.capture});},removeEventListener(type,fn){listeners[type]=(listeners[type]||[]).filter(x=>x.fn!==fn);}});
  a.fireWindow=(type,extra={})=>{
    let stopped=false;const event={type,target:a.document.body,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},stopImmediatePropagation(){stopped=true;},...extra};
    const list=listeners[type]||[];
    for(const listener of [...list.filter(x=>x.capture),...list.filter(x=>!x.capture)]){listener.fn(event);if(stopped)break;}
    return event;
  };
  a.run('THREE.TextureLoader=class {load(src,onLoad){const t=new THREE.Texture();Promise.resolve().then(()=>onLoad?.(t));return t;}}');
  if(!a.run('!!window.TweenDirectManipulation')){
    const file=path.join(__dirname,'tweenpose-direct-manipulation.js');
    assert(fs.existsSync(file),'Direct manipulation source is available');
    a.run(fs.readFileSync(file,'utf8'));
  }
  return a;
}
function setup(a,shape='box'){
  a.run(`GeometryEditor.addShape(${JSON.stringify(shape)});keys=[];selKey=null;$('#ak').checked=false;$('#sn').checked=false;applySnap();cam.position.set(0,0,8);ctl.target.set(0,0,0);ctl.update();scene.updateMatrixWorld(true);resetHist()`);
}
function pixel(a,part='parts[sel]'){
  return plain(a.run(`(()=>{scene.updateMatrixWorld(true);cam.updateMatrixWorld(true);const p=${part}.o.getWorldPosition(new THREE.Vector3()).project(cam);return {x:(p.x+1)*480,y:(1-p.y)*320};})()`));
}
function fire(a,type,point,extra={}){
  const event={type,clientX:point.x,clientY:point.y,pointerId:1,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,isPrimary:true,...extra};
  a.document.querySelector('#cv').dispatchEvent(event);return event;
}
function target(point,dx=64,dy=-32){return {x:point.x+dx,y:point.y+dy};}
function drag(a,point,to,extra={}){fire(a,'pointerdown',point,extra);fire(a,'pointermove',to,extra);fire(a,'pointerup',to,extra);}
function delta(a,point,to,part='parts[sel]'){
  a.context._directRayTest={point,to};
  return plain(a.run(`(()=>{scene.updateMatrixWorld(true);const ray=new THREE.Raycaster(),first=_directRayTest.point;ray.setFromCamera(new THREE.Vector2(first.x/480-1,1-first.y/320),cam);const touched=ray.intersectObjects(parts.filter(p=>p.mesh&&p.o.visible!==false&&p.mesh.visible!==false).map(p=>p.mesh),false)[0];if(!touched)throw new Error('Expected a touched surface');const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new THREE.Vector3()),touched.point),v=[];for(const p of [_directRayTest.point,_directRayTest.to]){ray.setFromCamera(new THREE.Vector2(p.x/480-1,1-p.y/320),cam);v.push(ray.ray.intersectPlane(plane,new THREE.Vector3()));}return v[1].sub(v[0]).toArray();})()`));
}
function checkBox(a,id,on){a.document.querySelector('#'+id).checked=on;}
function face(a){
  a.context._directDrawings=[{id:'neutral',name:'Neutral',src:'data:image/png;base64,AAAA',width:512,height:256},{id:'smile',name:'Smile',src:'data:image/png;base64,BBBB',width:512,height:256}];
  a.run('TweenFaces.addPlane(_directDrawings,1);keys=[];frame=0;resetHist()');
}

(async()=>{
  let passed=0;const failures=[];
  async function test(name,fn){try{await fn(await app());passed++;console.log('PASS: '+name);}catch(error){failures.push(name);console.error('FAIL: '+name+'\n'+error.stack);}}

  await test('native pointer drag selects the touched mesh and moves it without sliders',a=>{
    setup(a);a.run("GeometryEditor.addShape('sphere');parts[2].o.position.x=2.2;keys=[];selPart(1);resetHist()");
    const p=pixel(a,'parts[2]'),to=target(p),movement=delta(a,p,to,'parts[2]');
    const start=plain(a.run('get(parts[2].o)'));
    const down=fire(a,'pointerdown',p);assert.equal(a.run('sel'),2);assert.equal(down.defaultPrevented,true,'native orbit handling is consumed for a hit');
    fire(a,'pointermove',to);fire(a,'pointerup',to);
    vector(plain(a.run('parts[2].o.position.toArray()')),start.slice(0,3).map((v,i)=>v+movement[i]));
    vector(plain(a.run('get(parts[2].o).slice(3)')),start.slice(3));
    vector(plain(a.run('parts[1].o.position.toArray()')),[0,0,0]);
    assert.equal(a.run('TweenDirectManipulation.active'),false);assert.equal(a.run('ctl.enabled'),true);
    assert.equal(a.run('undo.length'),1);
  });

  await test('simple click and tiny hand jitter select without creating an edit',a=>{
    setup(a);a.run("GeometryEditor.addShape('sphere');parts[2].o.position.x=2.2;keys=[];selPart(1);resetHist()");
    const p=pixel(a,'parts[2]'),before=a.run('JSON.stringify(snap())');
    fire(a,'pointerdown',p);fire(a,'pointermove',target(p,1,1));fire(a,'pointerup',target(p,1,1));
    assert.equal(a.run('sel'),2);assert.equal(a.run('JSON.stringify(snap())'),before);assert.equal(a.run('undo.length'),0);assert.equal(a.run('keys.length'),0);
  });

  await test('screen-plane movement converts correctly through a rotated and nonuniformly scaled parent',a=>{
    setup(a);a.run("GeometryEditor.addShape('sphere');keys=[];parts[1].o.add(parts[2].o);parts[1].o.position.set(.3,-.2,.1);parts[1].o.rotation.set(.2,.4,.65);parts[1].o.scale.set(1.5,.7,1.2);parts[2].o.position.set(0,0,1.5);parts[2].o.rotation.set(.3,-.4,.2);parts[2].o.scale.set(.4,.5,.3);cam.position.set(5,3,7);ctl.update();scene.updateMatrixWorld(true);resetHist()");
    const p=pixel(a),to=target(p,55,-29),movement=delta(a,p,to);
    a.context._expectedWorldDelta=movement;
    const expected=plain(a.run('parts[2].o.parent.worldToLocal(parts[2].o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3().fromArray(_expectedWorldDelta))).toArray()'));
    const rotationScale=plain(a.run('get(parts[sel].o).slice(3)'));
    drag(a,p,to);vector(plain(a.run('parts[2].o.position.toArray()')),expected);
    vector(plain(a.run('get(parts[sel].o).slice(3)')),rotationScale);
  });

  await test('Shift permits fine direct movement and grid snapping remains available',a=>{
    setup(a);const p=pixel(a),to=target(p,66,0),movement=delta(a,p,to);
    drag(a,p,to,{shiftKey:true});close(a.run('parts[sel].o.position.x'),movement[0]*.1);
    a.run('doUndo();tc.setSpace("world");tc.setTranslationSnap(.25);resetHist()');
    const next=pixel(a),end=target(next,66,0),raw=delta(a,next,end);
    drag(a,next,end);close(a.run('parts[sel].o.position.x'),Math.round(raw[0]/.25)*.25);
    close(a.run('parts[sel].o.position.y'),0);close(a.run('parts[sel].o.position.z'),0);
  });

  await test('empty space, Alt-drag, secondary buttons and disabled mode pass through for camera navigation',a=>{
    setup(a);const p=pixel(a),before=a.run('JSON.stringify(snap())');
    for(const [point,extra] of [[{x:2,y:2},{}],[p,{altKey:true}],[p,{button:1,buttons:4}],[p,{button:2,buttons:2}],[p,{isPrimary:false}]]){
      const e=fire(a,'pointerdown',point,extra);assert(!e.defaultPrevented);assert.equal(a.run('TweenDirectManipulation.pending'),false);assert.equal(a.run('ctl.enabled'),true);fire(a,'pointerup',point,extra);
    }
    a.run('TweenDirectManipulation.setEnabled(false)');const e=fire(a,'pointerdown',p);assert(!e.defaultPrevented);assert.equal(a.run('TweenDirectManipulation.pending'),false);
    assert.equal(a.run('JSON.stringify(snap())'),before);assert.equal(a.run('undo.length'),0);
  });

  await test('gizmo handles and rotate/scale modes retain their existing pointer interactions',a=>{
    setup(a);const p=pixel(a);
    for(const state of ["tc.axis='X'","tc.axis=null;tc.dragging=true","tc.dragging=false;gzMode('rotate')","gzMode('scale')"]){
      a.run(state);const e=fire(a,'pointerdown',p);assert(!e.defaultPrevented);assert.equal(a.run('TweenDirectManipulation.pending'),false);fire(a,'pointerup',p);
    }
    a.run("gzMode('translate');tc.axis=null;tc.dragging=false");const e=fire(a,'pointerdown',p);assert(e.defaultPrevented);a.run('TweenDirectManipulation.cancel()');
  });

  await test('topology, path drawing, path handles, playback and export guard against accidental object drags',a=>{
    setup(a);const p=pixel(a);
    const rejected=()=>{const e=fire(a,'pointerdown',p);assert.equal(a.run('TweenDirectManipulation.pending'),false);return e;};
    a.run("GeometryEditor.setMode('edit',false)");rejected();a.run("GeometryEditor.setMode('object',false)");
    a.run("TweenMotionPanel.armDrawing('freehand')");rejected();a.run('TweenMotionPanel.cancelDrawing()');
    a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,record:false});TweenMotionPaths.editPoint(0)');rejected();a.run('TweenMotionPaths.stopEditing()');
    a.run('playing=true');rejected();a.run('playing=false');
    a.run('window._finishDirectExport=beginExport()');rejected();a.run('_finishDirectExport()');
    assert.equal(a.run('TweenDirectManipulation.active'),false);
  });

  await test('a long drag commits one undoable edit with no backup or history churn during movement',a=>{
    setup(a);a.flush();a.run('window._directDirtyCount=0;TweenPoseBackups.markDirty=()=>_directDirtyCount++;resetHist()');
    const p=pixel(a),before=a.run('JSON.stringify(snap())');fire(a,'pointerdown',p);
    for(let i=1;i<=12;i++){fire(a,'pointermove',target(p,i*7,-i*2));a.stepAnimation();}
    assert.equal(a.run('undo.length'),0);assert.equal(a.run('_directDirtyCount'),0);
    fire(a,'pointerup',target(p,84,-24));assert.equal(a.run('undo.length'),1);assert.equal(a.run('_directDirtyCount'),1);
    const after=a.run('JSON.stringify(snap())');assert.notEqual(after,before);
    a.run('doUndo()');assert.equal(a.run('JSON.stringify(snap())'),before);
    a.run('doRedo()');assert.equal(a.run('JSON.stringify(snap())'),after);
  });

  await test('Escape and pointer cancellation restore the pose and preserve keyframes and redo history',a=>{
    setup(a);let p=pixel(a);drag(a,p,target(p));a.run('doUndo()');
    for(const type of ['Escape','pointercancel','lostpointercapture']){
      const before=a.run('hsnap()'),keys=a.run('JSON.stringify(keys)'),redo=a.run('JSON.stringify(redo)');p=pixel(a);fire(a,'pointerdown',p);fire(a,'pointermove',target(p,90,-20));
      assert(a.run('TweenDirectManipulation.active'));
      if(type==='Escape')a.fireWindow('keydown',{key:'Escape'});else fire(a,type,target(p,90,-20));
      assert.equal(a.run('hsnap()'),before);assert.equal(a.run('JSON.stringify(keys)'),keys);assert.equal(a.run('JSON.stringify(redo)'),redo);
      assert.equal(a.run('undo.length'),0);assert.equal(a.run('TweenDirectManipulation.active'),false);assert.equal(a.run('ctl.enabled'),true);
    }
  });

  await test('only the owning pointer controls a drag and window blur cancels it safely',a=>{
    setup(a);const p=pixel(a),before=a.run('JSON.stringify(snap())');fire(a,'pointerdown',p);
    fire(a,'pointermove',target(p,70,0),{pointerId:2});fire(a,'pointerup',target(p,70,0),{pointerId:2});assert.equal(a.run('JSON.stringify(snap())'),before);
    fire(a,'pointermove',target(p,70,0));assert(a.run('TweenDirectManipulation.active'));a.fireWindow('blur');
    assert.equal(a.run('JSON.stringify(snap())'),before);assert.equal(a.run('undo.length'),0);assert.equal(a.run('TweenDirectManipulation.pending'),false);
  });

  await test('auto-key writes the current body pose only when the drag is released',a=>{
    setup(a);a.run('frame=7');checkBox(a,'ak',true);a.run('resetHist()');
    const p=pixel(a),to=target(p,74,-20);fire(a,'pointerdown',p);fire(a,'pointermove',to);assert.equal(a.run('keys.length'),0);fire(a,'pointerup',to);
    assert.equal(a.run('keys.length'),1);assert.equal(a.run('keys[0].t'),7);assert.equal(a.run('JSON.stringify(keys[0].p)'),a.run('JSON.stringify(snap())'));
    assert.equal(a.run('undo.length'),1);a.run('doUndo()');assert.equal(a.run('keys.length'),0);
  });

  await test('apply-to-all shifts every body key by the drag delta while preserving other parts and timing',a=>{
    setup(a);a.run("GeometryEditor.addShape('sphere');parts[2].o.position.x=3;selPart(1);frame=0;keys=[];upsert();frame=20;parts[1].o.position.x=2;upsert();frame=0;evalAt(0);$('#allk').checked=true;resetHist()");
    const before=plain(a.run('keys')),p=pixel(a),to=target(p,59,-21),movement=delta(a,p,to);drag(a,p,to);
    const after=plain(a.run('keys'));assert.deepEqual(after.map(k=>k.t),before.map(k=>k.t));assert.deepEqual(after.map(k=>k.e),before.map(k=>k.e));
    after.forEach((k,i)=>{vector(k.p[1].slice(0,3),before[i].p[1].slice(0,3).map((v,j)=>v+movement[j]));assert.deepEqual(k.p[2],before[i].p[2]);});
    assert.equal(a.run('undo.length'),1);a.run('doUndo()');assert.deepEqual(plain(a.run('keys')),before);
  });

  await test('face dragging records an independent face key without writing body keys',a=>{
    setup(a,'sphere');face(a);checkBox(a,'ak',true);a.run('frame=8;resetHist()');
    const before=plain(a.run('parts[sel].face.keys')),p=pixel(a),to=target(p,55,-14),movement=delta(a,p,to),start=plain(a.run('get(parts[sel].o)'));
    drag(a,p,to);const key=plain(a.run('parts[sel].face.keys.find(k=>k.t===8)'));
    assert(key);vector(key.p.slice(0,3),start.slice(0,3).map((v,i)=>v+movement[i]));assert.equal(key.expression,'neutral');assert.equal(a.run('keys.length'),0);assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');assert.deepEqual(plain(a.run('parts[sel].face.keys')),before);
  });

  await test('apply-to-all face movement preserves expression and opacity animation',a=>{
    setup(a,'sphere');face(a);a.run("frame=20;TweenFaces.setPose({position:[1,0,parts[sel].o.position.z],expression:'smile',opacity:.3},{key:true,record:false});frame=0;evalAt(0);$('#allk').checked=true;resetHist()");
    const before=plain(a.run('parts[sel].face.keys')),p=pixel(a),to=target(p,50,17),movement=delta(a,p,to);drag(a,p,to);
    const after=plain(a.run('parts[sel].face.keys'));
    after.forEach((k,i)=>{vector(k.p.slice(0,3),before[i].p.slice(0,3).map((v,j)=>v+movement[j]));assert.equal(k.expression,before[i].expression);assert.equal(k.opacity,before[i].opacity);assert.deepEqual(k.e,before[i].e);});
    assert.equal(a.run('undo.length'),1);assert.equal(a.run('keys.length'),0);
  });

  await test('dragging an object with a motion path translates its entire trajectory and supports undo',a=>{
    setup(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,1,0],[3,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});TweenMotionPaths.setVisible(false);frame=10;evalAt(frame);resetHist()');
    const before=plain(a.run('parts[sel].motion')),p=pixel(a),to=target(p,60,-20),movement=delta(a,p,to);drag(a,p,to);
    const after=plain(a.run('parts[sel].motion'));
    after.points.forEach((v,i)=>vector(v,before.points[i].map((n,j)=>n+movement[j])));
    assert.equal(after.start,before.start);assert.equal(after.end,before.end);assert.deepEqual(after.e,before.e);
    a.run('TweenTimeline.seek(20)');vector(plain(a.run('parts[sel].o.position.toArray()')),before.points.at(-1).map((v,i)=>v+movement[i]));
    a.run('doUndo()');assert.deepEqual(plain(a.run('parts[sel].motion')),before);
    assert.equal(a.run('redo.length'),1);
  });

  await test('a selected Whole model can move the complete model directly from a visible mesh',a=>{
    setup(a);a.run("GeometryEditor.addShape('sphere');parts[2].o.position.x=2.1;keys=[];selPart(0);resetHist()");
    const before=plain(a.run('snap()')),p=pixel(a,'parts[1]'),to=target(p,67,-23),movement=delta(a,p,to,'parts[0]');
    drag(a,p,to);assert.equal(a.run('sel'),0);vector(plain(a.run('root.position.toArray()')),movement);
    assert.deepEqual(plain(a.run('snap().slice(1)')),before.slice(1));
    const world=plain(a.run('parts[2].o.getWorldPosition(new THREE.Vector3()).toArray()'));vector(world,before[2].slice(0,3).map((v,i)=>v+movement[i]));
    assert.equal(a.run('undo.length'),1);
  });

  if(failures.length){console.error(`\n${failures.length} direct-manipulation checks failed: ${failures.join('; ')}`);process.exitCode=1;}else console.log(`\nAll ${passed} direct-manipulation integration checks passed.`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
