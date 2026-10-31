/* Motion paths and temporal rendering against the application's exact THREE r128 math.
 * WebGL calls are recorded without launching a browser or claiming GPU visual QA. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createApp}=require('./tweenpose-app.test.cjs');
const THREE=require('./tweenpose-tests/three-r128.cjs');

function close(actual,expected,tolerance=.00001){assert(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);}
function plain(value){return JSON.parse(JSON.stringify(value));}
async function app(){
  const a=await createApp(THREE);
  a.run('THREE.TextureLoader=class {load(src,onLoad){const t=new THREE.Texture();t.userData={source:src};Promise.resolve().then(()=>onLoad?.(t));return t;}}');
  for(const [global,file] of [['TweenMotionPaths','tweenpose-motion-paths.js'],['TweenMotionPanel','tweenpose-motion-panel.js'],['TweenMotionBlur','tweenpose-motion-blur.js']]){
    if(!a.run('!!window.'+global)&&fs.existsSync(path.join(__dirname,file)))a.run(fs.readFileSync(path.join(__dirname,file),'utf8'));
  }
  return a;
}
function add(a,shape='box'){a.run('GeometryEditor.addShape('+JSON.stringify(shape)+',2)');return a.run('sel');}
function keyAnimation(a){
  add(a);a.run("$('#tot').value=21;keys=[{t:0,p:snap(),e:[0,0,1,1]},{t:20,p:snap(),e:[0,0,1,1]}];keys[1].p[sel][0]=4;selKey=keys[0];frame=0;evalAt(0);resetHist()");
}
function renderSpy(a){
  a.run(`window._renderCalls=[];window._targetCalls=[];window._target=null;window._renderThrowAt=-1;window._sceneRenderCount=0;window._clearColor=new THREE.Color(0);window._clearAlpha=0;
    ren.autoClear=true;
    ren.getRenderTarget=()=>_target;
    ren.setRenderTarget=t=>{_target=t;_targetCalls.push(t)};
    ren.getDrawingBufferSize=v=>v.set(ren.domElement.width,ren.domElement.height);
    ren.getSize=v=>v.set(ren.domElement.width,ren.domElement.height);
    ren.getPixelRatio=()=>1;
    ren.getClearColor=v=>(v||new THREE.Color()).copy(_clearColor);
    ren.getClearAlpha=()=>_clearAlpha;
    ren.setClearColor=(color,alpha)=>{_clearColor.set(color);if(alpha!==undefined)_clearAlpha=alpha;};
    ren.clear=()=>{};
    ren.clearDepth=()=>{};
    ren.render=(s,c)=>{
      const isScene=s===scene;
      if(isScene&&_sceneRenderCount++===_renderThrowAt)throw new Error('Synthetic render failure');
      const fullscreen=s.children.find(o=>o.material?.uniforms);
      _renderCalls.push({scene:isScene,target:_target,frame,pose:snap(),pivot:piv.visible,handles:tc.visible,
        pathHelpers:scene.children.filter(o=>/motion.*path|path.*helper/i.test(o.name)).map(o=>({name:o.name,visible:o.visible})),
        uniforms:fullscreen?Object.fromEntries(Object.entries(fullscreen.material.uniforms).map(([k,u])=>[k,typeof u.value==='number'||typeof u.value==='boolean'?u.value:u.value?.isTexture?'texture':null])):null,
        fragment:fullscreen?.material.fragmentShader||''});
    };`);
}

async function main(){
  let passed=0;const failures=[];
  async function test(name,fn){try{await fn(await app());passed++;console.log('PASS: '+name);}catch(error){failures.push({name,error});console.error('FAIL: '+name+'\n'+error.stack);}}

  await test('path timing clamps endpoints and uses distance rather than control-point spacing',a=>{
    add(a);
    assert(a.run('!!TweenMotionPaths.attachPath([[0,0,0],[1,0,0],[5,0,0]],{start:4,end:14,smooth:false,e:[0,0,1,1],record:false})'));
    const pos=f=>plain(a.run('TweenMotionPaths.sample(parts[sel],'+f+').toArray()'));
    assert.deepEqual(pos(0),[0,0,0]);assert.deepEqual(pos(4),[0,0,0]);assert.deepEqual(pos(14),[5,0,0]);assert.deepEqual(pos(30),[5,0,0]);
    close(pos(9)[0],2.5,.0001);
    close(a.run('TweenMotionPaths.curveInfo().length'),5);
    a.run('TweenMotionPaths.evaluate(9)');close(a.run('parts[sel].o.position.x'),2.5,.0001);
    a.run('TweenMotionPaths.attachPath([[0,0,0],[4,0,0],[4,3,0]],{start:0,end:14,smooth:false,e:[0,0,1,1],record:false})');
    const corner=plain(a.run('TweenMotionPaths.sample(parts[sel],8).toArray()'));
    close(corner[0],4,.0001);close(corner[1],0,.0001);
    const later=plain(a.run('TweenMotionPaths.sample(parts[sel],10).toArray()'));
    close(later[0],4,.0001);close(later[1],1,.0001);
  });
  await test('path easing and fractional frames drive smooth motion between timeline frames',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[4,0,0]],{start:0,end:20,smooth:false,e:[.42,0,1,1],record:false})');
    a.run('poseAt(5.5)');
    close(a.run('parts[sel].o.position.x'),a.run('4*bez(5.5/20,parts[sel].motion.e)'),.0001);
    assert(a.run('parts[sel].o.position.x<1.1'));
    const before=a.run('parts[sel].o.position.x');a.run('TweenMotionPaths.setEasing([0,0,.58,1],{record:false});poseAt(5.5)');
    assert(a.run('parts[sel].o.position.x')>before);
  });
  await test('smooth closed curves join their endpoints and orient forward along their tangent',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0],[2,2,0],[0,2,0]],{start:0,end:20,closed:true,smooth:true,orient:true,e:[0,0,1,1],record:false})');
    const first=plain(a.run('TweenMotionPaths.sample(parts[sel],0).toArray()')),last=plain(a.run('TweenMotionPaths.sample(parts[sel],20).toArray()'));
    first.forEach((v,i)=>close(v,last[i]));
    a.run('poseAt(6);window._pathForward=new THREE.Vector3(0,0,1).applyQuaternion(parts[sel].o.quaternion);window._pathTangent=TweenMotionPaths.sample(parts[sel],6.001).sub(TweenMotionPaths.sample(parts[sel],5.999)).normalize()');
    assert(a.run('_pathForward.dot(_pathTangent)>.999'));
    assert(a.run('parts[sel].o.position.toArray().every(Number.isFinite)'));
  });
  await test('drawn world positions convert to parent coordinates and follow animated parent transforms',a=>{
    add(a);add(a,'sphere');
    a.run('keys=[];parts[1].o.add(parts[2].o);parts[1].o.position.set(2,1,-1);parts[1].o.rotation.z=Math.PI/2;parts[1].o.scale.set(2,2,2);root.updateMatrixWorld(true)');
    assert(a.run('!!TweenMotionPaths.attachPath([[2,1,-1],[2,5,-1]],{world:true,start:0,end:20,smooth:false,e:[0,0,1,1],record:false})'));
    const points=plain(a.run('parts[sel].motion.points'));
    points[0].forEach(v=>close(v,0));close(points[1][0],2);close(points[1][1],0);close(points[1][2],0);
    a.run('TweenMotionPaths.evaluate(10);root.updateMatrixWorld(true)');
    const before=plain(a.run('parts[sel].o.getWorldPosition(new THREE.Vector3()).toArray()'));
    close(before[0],2);close(before[1],3);close(before[2],-1);
    a.run('parts[1].o.position.x+=3;TweenMotionPaths.evaluate(10);root.updateMatrixWorld(true)');
    close(a.run('parts[sel].o.getWorldPosition(new THREE.Vector3()).x'),before[0]+3);
    close(a.run('parts[sel].o.position.x'),1);
  });
  await test('invalid path edits preserve existing data and reject bad saved projects before clearing',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,record:false})');
    const before=a.run('JSON.stringify(parts[sel].motion)');
    assert.equal(a.run('TweenMotionPaths.setTiming(8,8)'),false);
    assert.equal(a.run('TweenMotionPaths.setPoints([[1,1,1],[1,1,1]])'),false);
    assert.equal(a.run('TweenMotionPaths.setPoint(0,[Infinity,0,0])'),false);
    assert.equal(a.run('JSON.stringify(parts[sel].motion)'),before);
    a.run('window._invalidPathProject=GeometryEditor.capture();_invalidPathProject[sel].motion.points[0][0]=Infinity');
    assert.throws(()=>a.run('GeometryEditor.restoreScene(_invalidPathProject)'),/path coordinate/);
    assert.equal(a.run('JSON.stringify(parts[sel].motion)'),before);
    assert.equal(a.run('parts.length'),2);
  });
  await test('path edits, undo and redo restore both curve data and evaluated position',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});TweenTimeline.seek(10);resetHist()');
    assert(a.run('!!TweenMotionPaths.setPoint(1,[4,0,0])'));
    close(a.run('parts[sel].o.position.x'),2,.0001);assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');close(a.run('parts[sel].motion.points[1][0]'),2);close(a.run('parts[sel].o.position.x'),1,.0001);
    a.run('doRedo()');close(a.run('parts[sel].motion.points[1][0]'),4);close(a.run('parts[sel].o.position.x'),2,.0001);
    assert.equal(a.run('cur===hsnap()'),true);
  });
  await test('project files preserve whole-model paths, individual paths and stored rest poses',a=>{
    add(a);a.run('keys=[];parts[sel].o.position.set(.25,.5,1);TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});selPart(0);TweenMotionPaths.attachPath([[0,0,0],[0,3,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});TweenTimeline.seek(10)');
    const saved=plain(a.run('projGet()'));assert(saved.g[0].motion,'root path is saved');assert(saved.g[1].motion);
    a.context._savedMotionProject=saved;
    a.run('TweenMotionPaths.clear({record:false});projSet(_savedMotionProject)');
    close(a.run('parts[0].o.position.y'),1.5,.0001);close(a.run('parts[1].o.position.x'),1,.0001);
    assert.deepEqual(plain(a.run('parts[1].motion.rest.slice(0,3)')),[.25,.5,1]);
    a.run('selPart(1);TweenMotionPaths.clear({record:false})');
    assert.deepEqual(plain(a.run('get(parts[sel].o).slice(0,3)')),[.25,.5,1]);
  });
  await test('path playback and scrubbing leave animation data, backups and undo history stable',async a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[4,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});TweenTimeline.seek(0);resetHist()');
    a.flush();await Promise.resolve();
    a.run('window._motionDirtyCount=0;TweenPoseBackups.markDirty=()=>_motionDirtyCount++');
    const data=a.run('JSON.stringify(GeometryEditor.capture())'),keys=a.run('JSON.stringify(keys)');
    a.click('play');a.stepAnimation(125);
    assert.equal(a.run('frame'),1);close(a.run('parts[sel].o.position.x'),.3,.0001);
    a.stepAnimation(450);a.click('play');a.run('TweenTimeline.seek(12);commit()');
    assert.equal(a.run('undo.length'),0);assert.equal(a.run('_motionDirtyCount'),0);
    assert.equal(a.run('JSON.stringify(GeometryEditor.capture())'),data);assert.equal(a.run('JSON.stringify(keys)'),keys);
  });
  await test('face expressions remain independent while a path moves the attached head',a=>{
    add(a,'sphere');
    a.context._motionDrawings=[{id:'neutral',name:'Neutral',src:'data:image/png;base64,AAAA',width:512,height:256},{id:'smile',name:'Smile',src:'data:image/png;base64,BBBB',width:512,height:256}];
    a.run('TweenFaces.addPlane(_motionDrawings,1);frame=0;TweenFaces.setEasing([0,0,1,1],0,{record:false});frame=20;TweenFaces.setPose({expression:"smile",opacity:.4},{key:true,record:false});selPart(1);TweenMotionPaths.attachPath([[0,0,0],[4,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});poseAt(10);root.updateMatrixWorld(true)');
    close(a.run('parts[1].o.position.x'),2,.0001);
    close(a.run('TweenFaces.evaluated(parts[2]).weight'),.5,.0001);close(a.run('TweenFaces.evaluated(parts[2]).opacity'),.7,.0001);
    close(a.run('parts[2].o.getWorldPosition(new THREE.Vector3()).x-parts[2].o.position.x'),2,.0001);
    assert(a.run('!!canExportAnimation()'),'path-only body motion and independent face clips are exportable');
  });
  await test('viewport path handles select and move control points through a single undoable gizmo drag',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});resetHist();TweenMotionPaths.editPoint(1)');
    assert.equal(a.run('TweenMotionPaths.isEditingPoint()'),true);assert.equal(a.run('tc.space'),'world');assert.equal(a.run('tc.mode'),'translate');
    a.run("tc.dispatchEvent({type:'dragging-changed',value:true});tc.object.position.x=3;tc.dispatchEvent({type:'objectChange'});tc.dispatchEvent({type:'dragging-changed',value:false})");
    close(a.run('parts[sel].motion.points[1][0]'),3);assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');close(a.run('parts[sel].motion.points[1][0]'),2);
    a.run('TweenMotionPaths.stopEditing();TweenMotionPaths.syncVisuals();cam.updateMatrixWorld(true);window._pickPath=TweenMotionPaths.localToWorld(parts[sel].motion.points[0]).project(cam)');
    assert(a.run('TweenMotionPaths.pick({clientX:(_pickPath.x+1)*480,clientY:(1-_pickPath.y)*320})'));
    assert.equal(a.run('TweenMotionPaths.getState().pointIndex'),0);
    assert.equal(a.run('TweenMotionPaths.isEditingPoint()'),true);
  });
  await test('export hides path guides and restores editor controls after completion',a=>{
    add(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[2,0,0]],{start:0,end:20,record:false});TweenMotionPaths.editPoint(1);TweenMotionPaths.syncVisuals()');
    assert(a.run('scene.children.some(o=>o.userData.tweenMotionHelper&&o.visible&&o.children.length)'));
    a.run('window._finishMotionExport=beginExport()');
    assert.equal(a.run('scene.children.some(o=>o.userData.tweenMotionHelper&&o.visible&&o.children.length)'),false);
    assert.equal(a.run('tc.visible'),false);assert.equal(a.run('piv.visible'),false);
    assert.equal(a.run('JSON.stringify(GeometryEditor.capture()).includes("Motion path guides")'),false);
    a.run('_finishMotionExport()');
    assert.equal(a.run('exportBusy'),false);assert(a.run('scene.children.some(o=>o.userData.tweenMotionHelper&&o.visible&&o.children.length)'));
    assert.equal(a.run('tc.object===parts[sel].o'),true);
  });
  await test('freehand viewport strokes create compact editable paths and restore camera controls',a=>{
    add(a);a.run('cam.updateMatrixWorld(true);resetHist()');a.click('motion-draw');
    assert.equal(a.run('TweenMotionPanel.drawing'),true);assert.equal(a.run('ctl.enabled'),false);assert.equal(a.run('tc.enabled'),false);
    const canvas=a.document.querySelector('#cv');
    const event=(type,x,y)=>canvas.dispatchEvent({type,clientX:x,clientY:y,button:0,pointerId:71});
    event('pointerdown',350,350);event('pointermove',410,300);event('pointermove',480,280);event('pointermove',550,300);
    const expected=plain(a.run('TweenMotionPanel.state.drawing.points[0].local'));
    event('pointerup',610,350);
    assert.equal(a.run('TweenMotionPanel.drawing'),false);assert.equal(a.run('ctl.enabled'),true);assert.equal(a.run('tc.enabled'),true);
    assert(a.run('parts[sel].motion.points.length>=2&&parts[sel].motion.points.length<=128'));
    plain(a.run('parts[sel].motion.points[0]')).forEach((v,i)=>close(v,expected[i]));
    close(a.run('parts[sel].o.position.x'),expected[0]);assert.equal(a.run('undo.length'),1);
    assert.equal(a.document.querySelector('#motion-controls').hidden,false);
    a.change('motion-point',1);a.change('motion-x',1.5);close(a.run('parts[sel].motion.points[1][0]'),1.5);
    a.run('TweenMotionPanel.armDrawing();TweenMotionPanel.cancelDrawing()');assert.equal(a.run('ctl.enabled'),true);
  });
  await test('point drawing keeps exact clicks and graph handles make one undoable easing edit',a=>{
    add(a);a.run('cam.updateMatrixWorld(true);TweenMotionPanel.armDrawing("points")');
    const canvas=a.document.querySelector('#cv');
    const event=(type,x,y)=>canvas.dispatchEvent({type,clientX:x,clientY:y,button:0,pointerId:72});
    for(const [x,y] of [[360,360],[480,250],[600,350]]){event('pointerdown',x,y);event('pointerup',x,y);}
    assert(a.run('TweenMotionPanel.finishDrawing()'));assert.equal(a.run('parts[sel].motion.points.length'),3);
    a.run('TweenMotionPaths.setEasing([0,0,1,1],{record:false});resetHist()');
    const graph=a.document.querySelector('#motion-graph');
    const x=v=>a.run('TweenMotionPanel.graph.xAt('+v+')')*960/280;
    const y=v=>a.run('TweenMotionPanel.graph.yAt('+v+')')*640/180;
    graph.dispatchEvent({type:'pointerdown',clientX:x(0),clientY:y(0),button:0,pointerId:73});
    graph.dispatchEvent({type:'pointermove',clientX:x(.6),clientY:y(.15),button:0,pointerId:73});
    graph.dispatchEvent({type:'pointerup',pointerId:73});
    close(a.run('parts[sel].motion.e[0]'),.6);close(a.run('parts[sel].motion.e[1]'),.15);assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');assert.deepEqual(plain(a.run('parts[sel].motion.e')),[0,0,1,1]);
  });
  await test('drawing freezes camera damping and every playback entry cancels drawing before animating',a=>{
    keyAnimation(a);
    a.run('window._orbitUpdates=0;ctl.update=()=>_orbitUpdates++;TweenMotionPanel.armDrawing("points")');
    a.stepAnimation(16);
    assert.equal(a.run('_orbitUpdates'),0);
    assert.equal(a.run('ctl.enabled'),false);
    a.click('tl-play');
    assert.equal(a.run('TweenMotionPanel.drawing'),false);
    assert.equal(a.run('ctl.enabled'),true);
    assert.equal(a.run('playing'),true);
    a.stepAnimation(16);
    assert.equal(a.run('_orbitUpdates'),1);
    a.run('TweenTimeline.stop();TweenMotionPanel.armDrawing("free");TweenTimeline.start()');
    assert.equal(a.run('TweenMotionPanel.drawing'),false);
    a.run('TweenTimeline.stop();window._finishMotionExport=beginExport();_orbitUpdates=0');
    a.stepAnimation(16);
    assert.equal(a.run('_orbitUpdates'),0,'async exports keep their camera fixed');
    a.run('_finishMotionExport()');
    a.stepAnimation(16);
    assert.equal(a.run('_orbitUpdates'),1);
  });
  await test('path simplification preserves endpoints within a bounded saved point count',a=>{
    a.context._longStroke=Array.from({length:4096},(_,i)=>({x:i/2,y:Math.sin(i/7)*80,local:[i/500,Math.sin(i/7),0]}));
    const points=plain(a.run('TweenMotionPanel.simplifyPoints(_longStroke)'));
    assert(points.length<=128&&points.length>=2);assert.deepEqual(points[0],a.context._longStroke[0].local);assert.deepEqual(points.at(-1),a.context._longStroke.at(-1).local);
  });
  await test('temporal export accumulates actual subframe poses into GPU targets then restores scene state',a=>{
    keyAnimation(a);renderSpy(a);
    a.run('TweenMotionBlur.setSettings({enabled:true,exports:true,shutter:360,samples:4},false);frame=10;poseAt(10);ren.autoClear=false;ren.setClearColor(0x112233,.37);window._originalTarget=new THREE.WebGLRenderTarget(16,16);ren.setRenderTarget(_originalTarget);TweenMotionBlur.render(10,{exporting:true})');
    const samples=plain(a.run('_renderCalls.filter(c=>c.scene).map(c=>c.pose[1][0])'));
    assert.equal(samples.length,4);[9.125,9.375,9.625,9.875].forEach((f,i)=>close(samples[i],4*f/20,.0001));
    assert(a.run('_renderCalls.filter(c=>c.scene).every(c=>c.target?.isWebGLRenderTarget&&!c.pivot&&!c.handles)'));
    assert.equal(a.run('_renderCalls.filter(c=>!c.scene).length'),5,'four running-average passes and a final output pass');
    assert.deepEqual(plain(a.run('_renderCalls.filter(c=>!c.scene&&c.uniforms.weight!==undefined).map(c=>c.uniforms.weight)')),[1,.5,1/3,.25]);
    assert.equal(a.run('_renderCalls.at(-1).target===_originalTarget'),true);
    assert.equal(a.run('ren.getRenderTarget()===_originalTarget'),true);assert.equal(a.run('ren.autoClear'),false);
    assert.equal(a.run('ren.getClearColor(new THREE.Color()).getHex()'),0x112233);close(a.run('ren.getClearAlpha()'),.37);
    assert.equal(a.run('frame'),10);close(a.run('parts[sel].o.position.x'),2,.0001);assert.equal(a.run('tc.visible'),true);assert.equal(a.run('piv.visible'),true);
    assert(a.run('_targetCalls.filter(Boolean).every(t=>t.texture.encoding===THREE.LinearEncoding)'),'intermediate targets use linear encoding');
    assert(a.run('_renderCalls.at(-1).fragment.includes("c.rgb/=c.a")&&_renderCalls.at(-1).fragment.includes("encodings_fragment")'),'output converts premultiplied linear exposure once');
  });
  await test('shutter samples clamp to the clip and zero exposure skips offscreen rendering',a=>{
    keyAnimation(a);renderSpy(a);
    a.run('TweenMotionBlur.setSettings({enabled:true,shutter:720,samples:8},false)');
    const times=plain(a.run('TweenMotionBlur.sampleTimes(.25)'));assert(times.every(f=>f>=0&&f<=20));assert.equal(times[0],0);assert.equal(new Set(times).size,times.length);
    assert(plain(a.run('TweenMotionBlur.sampleTimes(999)')).every(f=>f<=20));
    a.run('TweenMotionBlur.setSettings({shutter:0},false);frame=10;poseAt(10)');
    assert.equal(a.run('TweenMotionBlur.render(10,{exporting:true})'),false);assert.equal(a.run('_renderCalls.length'),1);assert.equal(a.run('_targetCalls.length'),0);
    assert.equal(a.run('TweenMotionBlur.setSettings({shutter:721},false)'),false);assert.equal(a.run('TweenMotionBlur.settings().shutter'),0);
  });
  await test('static poses and camera movement do not leave temporal trails',a=>{
    add(a);renderSpy(a);a.run('TweenMotionBlur.setSettings({enabled:true,shutter:360,samples:8},false);frame=10;poseAt(10);cam.position.x=3;cam.updateMatrixWorld(true)');
    assert.equal(a.run('TweenMotionBlur.render(10,{exporting:true})'),false);assert.equal(a.run('_targetCalls.length'),0);assert.equal(a.run('_renderCalls.length'),1);
    assert.equal(a.run('frame'),10);
  });
  await test('playback blur hides editor guides during sampling and draws their overlay sharply',a=>{
    keyAnimation(a);a.run('TweenMotionPaths.attachPath([[0,0,0],[4,0,0]],{start:0,end:20,smooth:false,e:[0,0,1,1],record:false});TweenTimeline.seek(10);TweenMotionPaths.syncVisuals()');renderSpy(a);
    a.run('TweenMotionBlur.setSettings({enabled:true,preview:true,shutter:360,samples:12},false);playing=true');
    assert.equal(a.run('TweenMotionBlur.render(10)'),true);
    assert.equal(a.run('_renderCalls.filter(c=>c.scene&&c.target).length'),6,'preview caps temporal cost at six samples');
    assert(a.run('_renderCalls.filter(c=>c.scene&&c.target).every(c=>c.pathHelpers.every(h=>!h.visible))'));
    assert.equal(a.run('_renderCalls.at(-1).scene'),true);assert.equal(a.run('_renderCalls.at(-1).target'),null,'editor overlay renders on the final canvas');
    assert(a.run('scene.children.filter(o=>o.userData.tweenMotionHelper&&o.children.length).every(o=>o.visible)'));
    assert.equal(a.run('cam.layers.mask'),1);assert.equal(a.run('tc.layers.mask'),1);
    a.run('playing=false;_renderCalls=[];_targetCalls=[]');
    assert.equal(a.run('TweenMotionBlur.render(10)'),false);assert.equal(a.run('_targetCalls.length'),0,'paused editing stays sharp');
  });
  await test('temporal render failures restore transforms, helper visibility and renderer state',a=>{
    keyAnimation(a);renderSpy(a);
    a.run('TweenMotionBlur.setSettings({enabled:true,shutter:360,samples:4},false);frame=10;poseAt(10);ren.autoClear=false;ren.setClearColor(0x345678,.5);_renderThrowAt=1');
    assert.throws(()=>a.run('TweenMotionBlur.render(10,{exporting:true})'),/Synthetic render failure/);
    close(a.run('parts[sel].o.position.x'),2,.0001);assert.equal(a.run('frame'),10);
    assert.equal(a.run('ren.getRenderTarget()'),null);assert.equal(a.run('ren.autoClear'),false);assert.equal(a.run('ren.getClearColor(new THREE.Color()).getHex()'),0x345678);close(a.run('ren.getClearAlpha()'),.5);
    assert.equal(a.run('piv.visible'),true);assert.equal(a.run('tc.visible'),true);
    a.run('_renderThrowAt=-1;_renderCalls=[]');assert.equal(a.run('TweenMotionBlur.render(10,{exporting:true})'),true,'a failed frame does not leave rendering locked');
  });
  await test('face crossfades trigger exposure sampling even while every transform is still',a=>{
    add(a,'sphere');a.context._stillFaceDrawings=[{id:'neutral',name:'Neutral',src:'data:image/png;base64,AAAA',width:64,height:64},{id:'smile',name:'Smile',src:'data:image/png;base64,BBBB',width:64,height:64}];
    a.run('TweenFaces.addPlane(_stillFaceDrawings,1);frame=0;TweenFaces.setEasing([0,0,1,1],0,{record:false});frame=20;TweenFaces.setPose({expression:"smile"},{key:true,record:false});frame=10;poseAt(10)');renderSpy(a);
    a.run('TweenMotionBlur.setSettings({enabled:true,shutter:360,samples:4},false)');
    assert.equal(a.run('TweenMotionBlur.render(10,{exporting:true})'),true);assert.equal(a.run('_renderCalls.filter(c=>c.scene).length'),4);
    close(a.run('TweenFaces.evaluated().weight'),.5,.0001);assert.equal(a.run('frame'),10);
  });
  await test('fractional cloth exposure uses integer caches and restores the current subframe',a=>{
    add(a,'plane');a.document.querySelector('#cl').checked=true;a.document.querySelector('#cl').dispatchEvent({type:'change'});
    a.run('keys[0].e=[0,0,1,1];keys.push({t:20,p:snap(),e:[0,0,1,1]});keys[1].p[sel][0]=2;frame=10;evalAt(10);window._clothIntegerCalls=[];window._originalEvalAt=evalAt;evalAt=(f,o)=>{_clothIntegerCalls.push(f);return _originalEvalAt(f,o)}');
    renderSpy(a);a.run('TweenMotionBlur.setSettings({enabled:true,shutter:360,samples:4},false);TweenMotionBlur.render(10.5,{exporting:true})');
    assert(a.run('_clothIntegerCalls.length>0&&_clothIntegerCalls.every(Number.isInteger)'));
    assert(a.run('Object.keys(parts[sel].cl.cache).every(k=>String(Math.floor(+k))===k)'));
    close(a.run('parts[sel].o.position.x'),1.05,.0001);assert.equal(a.run('frame'),10);
    assert(a.run('Array.from(parts[sel].mesh.geometry.attributes.position.array).every(Number.isFinite)'));
  });
  await test('motion blur preferences persist and remain undoable without baking sample poses',a=>{
    keyAnimation(a);a.run('resetHist();TweenMotionBlur.setSettings({enabled:true,shutter:270,samples:12});commit()');
    assert.equal(a.run('undo.length'),1);a.run('doUndo()');assert.equal(a.run('TweenMotionBlur.settings().enabled'),false);
    a.run('doRedo()');assert.equal(a.run('TweenMotionBlur.settings().shutter'),270);
    const saved=plain(a.run('projGet()'));a.context._blurProject=saved;
    a.run('TweenMotionBlur.setSettings({enabled:false},false);projSet(_blurProject)');
    assert.deepEqual(plain(a.run('TweenMotionBlur.settings()')),{enabled:true,preview:true,exports:true,shutter:270,samples:12});
    const data=a.run('JSON.stringify(GeometryEditor.capture())'),keys=a.run('JSON.stringify(keys)');renderSpy(a);
    a.run('window._blurDirty=0;TweenPoseBackups.markDirty=()=>_blurDirty++;TweenMotionBlur.render(10,{exporting:true})');
    assert.equal(a.run('JSON.stringify(GeometryEditor.capture())'),data);assert.equal(a.run('JSON.stringify(keys)'),keys);assert.equal(a.run('_blurDirty'),0);assert.equal(a.run('undo.length'),0);
  });
  await test('PNG export routes each frame through selected temporal quality and restores project state',async a=>{
    keyAnimation(a);a.run("$('#tot').value=3;keys[1].t=2;TweenMotionBlur.setSettings({enabled:true,exports:true,shutter:360,samples:4},false);frame=1;evalAt(1);resetHist()");renderSpy(a);
    const before=a.run('JSON.stringify(keys)');await a.document.querySelector('#exp').onclick();
    assert.equal(a.run('_renderCalls.filter(c=>c.scene&&c.target).length'),8,'first frame is sharp and the later two frames use four shutter samples');
    assert.equal(a.run('exportBusy'),false);assert.equal(a.run('frame'),1);close(a.run('parts[sel].o.position.x'),2,.0001);
    assert.equal(a.run('JSON.stringify(keys)'),before);assert.equal(a.document.querySelector('#exp').disabled,false);assert.equal(a.document.querySelector('#gif').disabled,false);
    assert.equal(a.run('ren.getRenderTarget()'),null);assert.equal(a.run('piv.visible'),true);assert.equal(a.run('tc.visible'),true);
  });

  console.log(`${passed} motion integration tests passed.`);
  if(failures.length)throw new Error(failures.length+' motion tests failed: '+failures.map(f=>f.name).join('; '));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={app,add,keyAnimation,renderSpy,close,plain};
