/* Face planes, independent animation and persistence against THREE r128 math. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createApp}=require('./tweenpose-app.test.cjs');
const THREE=require('./tweenpose-tests/three-r128.cjs');
const drawings=[
  {id:'neutral',name:'Neutral',src:'data:image/png;base64,AAAA',width:512,height:256},
  {id:'smile',name:'Smile',src:'data:image/png;base64,BBBB',width:512,height:256}
];
async function app(){
  const a=await createApp(THREE);
  a.run('THREE.TextureLoader=class {load(src,onLoad){const t=new THREE.Texture();t.userData={source:src};Promise.resolve().then(()=>onLoad?.(t));return t;}}');
  if(!a.run('!!window.TweenFaces'))a.run(fs.readFileSync(path.join(__dirname,'tweenpose-faces.js'),'utf8'));
  if(!a.run('!!window.TweenFacePanel')&&fs.existsSync(path.join(__dirname,'tweenpose-face-panel.js')))a.run(fs.readFileSync(path.join(__dirname,'tweenpose-face-panel.js'),'utf8'));
  return a;
}
function close(actual,expected,tolerance=.00001){assert(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);}
function face(a,head=true){
  if(head)a.run("GeometryEditor.addShape('sphere',2)");
  a.context._drawings=structuredClone(drawings);
  assert(a.run('!!TweenFaces.addPlane(_drawings,'+(head?1:0)+')'),'plane created');
  return a.run('parts.length-1');
}
function animate(a){
  a.run("frame=0;TweenFaces.setEasing([0,0,1,1],0,{record:false});frame=20;const v=get(parts[sel].o);v[0]+=2;TweenFaces.setPose({p:v,expression:'smile',opacity:.25},{key:true,record:false});frame=0;evalAt(0);resetHist()");
}
(async()=>{
  let passed=0;const failures=[];
  async function test(name,fn){try{await fn(await app());passed++;console.log('PASS: '+name);}catch(error){failures.push(name);console.error('FAIL: '+name+'\n'+error.stack);}}
  await test('imports a transparent unlit plane with preserved drawing aspect and head attachment',a=>{
    face(a);
    assert(a.run('parts[sel].o.parent===parts[1].o'));
    assert.equal(a.run('parts[sel].mesh.material.type'),'MeshBasicMaterial');
    assert.equal(a.run('parts[sel].mesh.material.transparent'),true);
    assert.equal(a.run('parts[sel].mesh.material.depthWrite'),false);
    close(a.run('parts[sel].geom.base.computeBoundingBox();const size=parts[sel].geom.base.boundingBox.getSize(new THREE.Vector3());size.x/size.y'),2);
    assert(a.run('parts[sel].o.position.z>parts[1].mesh.geometry.boundingBox.max.z'));
    const before=a.run('root.updateMatrixWorld(true);parts[sel].o.getWorldPosition(new THREE.Vector3()).x');
    a.run('parts[1].o.position.x+=3;root.updateMatrixWorld(true)');
    close(a.run('parts[sel].o.getWorldPosition(new THREE.Vector3()).x'),before+3);
  });
  await test('batch imports downsize large drawings within the shared image budget',async a=>{
    a.run("GeometryEditor.addShape('sphere',2)");
    let closed=0;const canvases=[],create=a.document.createElement;
    a.document.createElement=tag=>{const el=create(tag);if(tag==='canvas'){el.toDataURL=()=>drawings[0].src;canvases.push(el);}return el;};
    a.context.createImageBitmap=async()=>({width:4096,height:4096,close(){closed++;}});
    a.run('window._faceImportErrors=[];toast=message=>_faceImportErrors.push(message)');
    a.context._faceFiles=Array.from({length:5},(_,i)=>({name:'face-'+i+'.png',type:'image/png',size:250000}));
    assert(await a.run('TweenFaces.importFiles(_faceFiles,{parentIndex:1})'),a.run('_faceImportErrors.join("; ")'));
    assert.equal(closed,5,'decoded bitmap resources close after canvas conversion');
    assert.equal(a.run('parts[sel].face.expressions.length'),5);
    assert(a.run('parts[sel].face.expressions.reduce((sum,ex)=>sum+ex.width*ex.height,0)<=TweenFaces.PIXEL_BUDGET'));
    assert(canvases.every(c=>c.width<=2048&&c.height<=2048));
  });
  await test('face keys animate transforms, opacity and drawings independently of body keys',a=>{
    face(a);const body=a.run('JSON.stringify(keys)');animate(a);
    assert.equal(a.run('JSON.stringify(keys)'),body);
    assert.equal(a.run('parts[sel].face.keys.length'),2);
    a.run('evalAt(10)');close(a.run('parts[sel].o.position.x'),1);
    close(a.run('TweenFaces.evaluated().opacity'),.625);
    assert.equal(a.run('TweenFaces.evaluated().expression'),'neutral');
    assert.equal(a.run('TweenFaces.evaluated().nextExpression'),'smile');
    close(a.run('TweenFaces.evaluated().weight'),.5);
    close(a.run('parts[sel].mesh.material.opacity'),.3125);
    close(a.run('parts[sel].mesh.children.find(c=>c.userData.tweenFaceOverlay).material.opacity'),.3125);
    a.run('evalAt(20)');assert.equal(a.run('TweenFaces.evaluated().expression'),'smile');close(a.run('TweenFaces.evaluated().opacity'),.25);
  });
  await test('custom easing changes the evaluated pose while hold mode switches drawings at the key',a=>{
    face(a);animate(a);a.run('TweenFaces.setEasing([.42,0,1,1],0,{record:false});evalAt(5)');
    assert(a.run('parts[sel].o.position.x<.5'));
    close(a.run('parts[sel].o.position.x'),a.run('2*bez(.25,parts[sel].face.keys[0].e)'));
    a.run('TweenFaces.setCrossfade(false,{record:false});evalAt(19)');
    assert.equal(a.run('TweenFaces.evaluated().nextExpression'),null);
    assert.equal(a.run('TweenFaces.evaluated().expression'),'neutral');
    a.run('evalAt(20)');assert.equal(a.run('TweenFaces.evaluated().expression'),'smile');
  });
  await test('face evaluation remains available without any body keys and does not mutate project data',a=>{
    face(a);animate(a);a.run('keys=[]');
    const stored=a.run('JSON.stringify(GeometryEditor.capture())');
    for(const f of [0,1.5,7.25,10,19.5,20])a.run('poseAt('+f+')');
    assert.equal(a.run('JSON.stringify(GeometryEditor.capture())'),stored);
    a.run('poseAt(10)');close(a.run('parts[sel].o.position.x'),1);
    assert(!a.run('JSON.stringify(GeometryEditor.capture()).includes("tweenFaceOverlay")'));
  });
  await test('wire view and export synchronize both expression layers',a=>{
    face(a);animate(a);a.run('evalAt(10)');
    a.change('wm','wire');
    assert.equal(a.run('parts[sel].mesh.material.visible'),false);
    assert.equal(a.run('parts[sel].mesh.children.find(c=>c.userData.tweenFaceOverlay).visible'),false);
    a.change('wm','solid');
    assert.equal(a.run('parts[sel].mesh.material.visible'),true);
    assert.equal(a.run('parts[sel].mesh.children.find(c=>c.userData.tweenFaceOverlay).visible'),true);
    a.run('window._finishFaceExport=beginExport();evalAt(10)');
    assert.equal(a.run('parts[sel].mesh.children.find(c=>c.userData.tweenFaceOverlay).visible'),true);
    a.run('_finishFaceExport()');
  });
  await test('exports wait for every drawing texture and report decode failures',async a=>{
    a.run('window._pendingFaceTextures=[];THREE.TextureLoader=class {load(src,onLoad,progress,onError){const t=new THREE.Texture();_pendingFaceTextures.push({src,t,onLoad,onError});return t;}}');
    face(a);assert.equal(a.run('_pendingFaceTextures.length'),2);
    let complete=false;const ready=a.run('TweenFaces.ready()').then(()=>{complete=true;});
    await Promise.resolve();assert.equal(complete,false);
    a.run('_pendingFaceTextures[0].onLoad(_pendingFaceTextures[0].t)');
    await Promise.resolve();assert.equal(complete,false,'the later expression must also finish decoding');
    a.run('_pendingFaceTextures[1].onLoad(_pendingFaceTextures[1].t)');
    await ready;assert.equal(complete,true);
    a.context._badDrawing=[{...drawings[0],id:'bad',src:'data:image/png;base64,CCCC'}];
    a.run('TweenFaces.addPlane(_badDrawing,1)');
    const rejected=a.run('TweenFaces.ready()');
    a.run('_pendingFaceTextures[2].onError(new Error("Image decode failed"))');
    await assert.rejects(rejected,/could not be decoded/);
  });
  await test('PNG export waits for drawing loads and unlocks cleanly after a decode failure',async first=>{
    for(const fail of [false,true]){
      const a=fail?await app():first;
      a.run('window._pendingFaceTextures=[];THREE.TextureLoader=class {load(src,onLoad,progress,onError){const t=new THREE.Texture();_pendingFaceTextures.push({src,t,onLoad,onError});return t;}}');
      face(a);a.change('wm','wire');
      a.run('window._faceExportFrames=[];ren.render=()=>_faceExportFrames.push(frame);window._faceExportErrors=[];toast=message=>_faceExportErrors.push(message);$("#tot").value=2;TweenFaces.setKey(1,{record:false});resetHist()');
      const exported=a.document.querySelector('#exp').onclick();
      assert.equal(a.run('exportBusy'),true);assert.equal(a.run('_faceExportFrames.length'),0);
      assert.equal(a.document.querySelector('#exp').disabled,true);
      a.run('_pendingFaceTextures[0].onLoad(_pendingFaceTextures[0].t)');
      await Promise.resolve();assert.equal(a.run('_faceExportFrames.length'),0,'no frame renders with a later expression still loading');
      if(fail)a.run('_pendingFaceTextures[1].onError(new Error("Image decode failed"))');
      else a.run('_pendingFaceTextures[1].onLoad(_pendingFaceTextures[1].t)');
      await exported;
      assert.equal(a.run('exportBusy'),false);assert.equal(a.document.querySelector('#exp').disabled,false);
      assert.equal(a.document.querySelector('#gif').disabled,false);assert.equal(a.document.querySelector('#wm').value,'wire');
      assert.equal(a.run('_faceExportFrames.length'),fail?0:2);
      if(fail)assert.match(a.run('_faceExportErrors.join("; ")'),/PNG export failed.*could not be decoded/);
    }
  });
  await test('project files restore face drawings, keys, material and evaluated pose',a=>{
    face(a);animate(a);a.run('TweenTimeline.seek(10)');
    const saved=a.run('JSON.stringify(projGet())');a.run('window._savedFaceProject=JSON.parse('+JSON.stringify(saved)+')');
    a.run('TweenFaces.setPose({opacity:.9},{key:true});projSet(_savedFaceProject)');
    assert.equal(a.run('parts[sel].face.keys.length'),2);
    assert.equal(a.run('parts[sel].face.expressions[1].src'),drawings[1].src);
    assert.equal(a.run('parts[sel].mesh.material.type'),'MeshBasicMaterial');
    close(a.run('parts[sel].o.position.x'),1);close(a.run('TweenFaces.evaluated().opacity'),.625);
    assert.equal(a.run('parts[sel].o.parent===parts[1].o'),true);
  });
  await test('face retiming is collision safe and undo restores its independent animation',a=>{
    face(a);animate(a);
    assert.equal(a.run('TweenFaces.retimeKey(20,0)'),false);
    assert(a.run('!!TweenFaces.retimeKey(20,26)'));
    assert.equal(a.run('parts[sel].face.keys[1].t'),26);
    a.run('doUndo()');assert.equal(a.run('parts[sel].face.keys[1].t'),20);
    assert.equal(a.run('cur===hsnap()'),true,'restore preserves a canonical history snapshot');
    a.run('doRedo()');assert.equal(a.run('parts[sel].face.keys[1].t'),26);
  });
  await test('smooth playback and scrubbing create no undo entries for independent face animation',a=>{
    face(a);animate(a);a.run('TweenTimeline.seek(0)');
    a.click('play');a.stepAnimation(125);
    assert.equal(a.run('frame'),1);assert(a.run('parts[sel].o.position.x>.1'));
    a.stepAnimation(600);a.click('play');a.run('TweenTimeline.seek(10);commit()');
    assert.equal(a.run('undo.length'),0);
    close(a.run('parts[sel].o.position.x'),1);
  });
  await test('invalid face project records are rejected before clearing the current scene',a=>{
    face(a);const count=a.run('parts.length'),before=a.run('JSON.stringify(GeometryEditor.capture())');
    a.run('window._badFaces=GeometryEditor.capture();_badFaces[parts.length-1].face.keys[0].expression="missing"');
    assert.throws(()=>a.run('GeometryEditor.restoreScene(_badFaces)'),/missing drawing/);
    assert.equal(a.run('parts.length'),count);assert.equal(a.run('JSON.stringify(GeometryEditor.capture())'),before);
  });
  await test('face studio graph handles edit its outgoing curve and undo in one action',a=>{
    face(a);animate(a);a.run('TweenFacePanel.open();TweenFacePanel.selectKey(parts[sel].face.keys[0]);resetHist()');
    const graph=a.document.querySelector('#face-graph');assert(graph);
    const x=v=>a.run('TweenFacePanel.graph.xAt('+v+')')*960/440;
    const y=v=>a.run('TweenFacePanel.graph.yAt('+v+')')*640/215;
    graph.dispatchEvent({type:'pointerdown',clientX:x(0),clientY:y(0),pointerId:31});
    graph.dispatchEvent({type:'pointermove',clientX:x(.65),clientY:y(.12),pointerId:31});
    graph.dispatchEvent({type:'pointerup',pointerId:31});
    close(a.run('parts[sel].face.keys[0].e[0]'),.65);close(a.run('parts[sel].face.keys[0].e[1]'),.12);
    assert.equal(a.run('undo.length'),1);
    a.run('TweenTimeline.seek(10)');assert(a.run('parts[sel].o.position.x<1'));
    a.run('doUndo()');assert.equal(a.run('parts[sel].face.keys[0].e.join(",")'),'0,0,1,1');
    a.run('doRedo()');close(a.run('parts[sel].face.keys[0].e[0]'),.65);
    a.change('face-curve-preset','0,0,0.58,1');
    assert.equal(a.run('parts[sel].face.keys[0].e.join(",")'),'0,0,0.58,1');
  });
  await test('zoomed face timeline scrubs global animation and retimes a key on pointer release',a=>{
    face(a);animate(a);a.run('TweenFacePanel.open();TweenFacePanel.setZoom(6);resetHist()');
    const track=a.document.querySelector('#face-track');track.scrollLeft=0;
    const xAt=t=>a.run('18+'+t+'/last()*(TweenFacePanel.state.contentWidth-36)');
    assert(a.run('TweenFacePanel.state.contentWidth>2000'));
    track.dispatchEvent({type:'pointerdown',clientX:xAt(10),button:0,pointerId:32,target:track});
    track.dispatchEvent({type:'pointerup',pointerId:32,target:track});
    assert.equal(a.run('frame'),10);close(a.run('parts[sel].o.position.x'),1);
    const key=a.document.querySelectorAll('.face-key-marker').find(n=>n._faceKey.t===20);assert(key);
    track.dispatchEvent({type:'pointerdown',clientX:xAt(20),button:0,pointerId:33,target:key});
    track.dispatchEvent({type:'pointermove',clientX:xAt(24),pointerId:33,target:key});
    assert.equal(a.run('parts[sel].face.keys[1].t'),20,'drag preview leaves stored timing unchanged');
    track.dispatchEvent({type:'pointerup',pointerId:33,target:key});
    assert.equal(a.run('parts[sel].face.keys[1].t'),24);assert.equal(a.run('frame'),24);
    a.run('doUndo()');assert.equal(a.run('parts[sel].face.keys[1].t'),20);
  });
  await test('reparenting preserves face world pose and animation while changing its head',a=>{
    face(a);animate(a);
    a.run("GeometryEditor.addShape('box',1);parts[sel].o.position.x=3;const other=sel;selPart(2);evalAt(10);root.updateMatrixWorld(true);window._faceWorld=parts[sel].o.matrixWorld.clone();TweenFaces.attach(other);root.updateMatrixWorld(true)");
    assert(a.run('parts[sel].o.matrixWorld.elements.every((v,i)=>Math.abs(v-_faceWorld.elements[i])<.00001)'));
    assert.equal(a.run('parts[sel].o.parent===parts[3].o'),true);
    a.run('evalAt(10);root.updateMatrixWorld(true)');
    assert(a.run('parts[sel].o.matrixWorld.elements.every((v,i)=>Math.abs(v-_faceWorld.elements[i])<.00001)'));
  });
  await test('main transform and key controls edit the face clip without deleting body animation',a=>{
    face(a);animate(a);a.run('TweenTimeline.seek(10);resetHist()');
    const body=a.run('JSON.stringify(keys)'),slider=a.document.querySelector('#sls input');
    slider.value=.7;slider.dispatchEvent({type:'input'});a.run('commit()');
    close(a.run('parts[sel].face.keys.find(k=>k.t===10).p[0]'),.7);
    assert.equal(a.run('JSON.stringify(keys)'),body);
    a.click('delk');assert.equal(a.run('parts[sel].face.keys.some(k=>k.t===10)'),false);
    assert.equal(a.run('JSON.stringify(keys)'),body,'deleting a face key preserves body keys');
    a.run('TweenTimeline.seek(15)');a.click('addk');
    assert.equal(a.run('parts[sel].face.keys.some(k=>k.t===15)'),true);
    assert.equal(a.run('JSON.stringify(keys)'),body);
  });
  await test('viewport handles can offset every face key and the face panel follows playback values',a=>{
    face(a);animate(a);a.run('TweenTimeline.seek(10);resetHist();savedFaceXs=parts[sel].face.keys.map(k=>k.p[0]);$("#allk").checked=true;tc.dispatchEvent({type:"dragging-changed",value:true});parts[sel].o.position.x+=.4;tc.dispatchEvent({type:"objectChange"});tc.dispatchEvent({type:"dragging-changed",value:false})');
    assert(a.run('parts[sel].face.keys.every((k,i)=>Math.abs(k.p[0]-savedFaceXs[i]-.4)<.00001)'));
    a.run('doUndo()');assert(a.run('parts[sel].face.keys.every((k,i)=>Math.abs(k.p[0]-savedFaceXs[i])<.00001)'));
    a.run('TweenFacePanel.open();TweenTimeline.seek(10)');
    close(+a.document.querySelector('#face-position-x').value,1,.001);
  });
  console.log(passed+' face integration tests passed.');
  if(failures.length)throw new Error(failures.length+' face tests failed: '+failures.join('; '));
})().catch(error=>{console.error(error);process.exitCode=1});
