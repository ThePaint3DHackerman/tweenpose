/* Stepped pose interpolation, project history and temporal exposure integration. */
'use strict';
const assert=require('node:assert/strict');
const {createApp}=require('./tweenpose-app.test.cjs');
const THREE=require('./tweenpose-tests/three-r128.cjs');
const drawings=[
  {id:'neutral',name:'Neutral',src:'data:image/png;base64,AAAA',width:64,height:64},
  {id:'smile',name:'Smile',src:'data:image/png;base64,BBBB',width:64,height:64}
];
const close=(actual,expected)=>assert(Math.abs(actual-expected)<.00001,`${actual} differs from ${expected}`);
function body(a){
  a.run("GeometryEditor.addShape('box',1);keys=[{t:0,p:snap(),e:[0,0,1,1]},{t:10,p:snap(),e:[0,0,1,1]},{t:20,p:snap(),e:[.34,1.56,.64,1]}];keys[1].p[1][0]=10;keys[2].p[1][0]=20;selKey=keys[0];frame=0;evalAt(0);TweenTimeline.render();drawGraph();resetHist()");
}
function face(a){
  a.context._holdDrawings=structuredClone(drawings);
  a.run("THREE.TextureLoader=class {load(src,onLoad){const t=new THREE.Texture();Promise.resolve().then(()=>onLoad?.(t));return t;}};TweenFaces.addPlane(_holdDrawings,1);frame=10;TweenFaces.setPose({position:[3,2,1],rotation:[10,20,30],scale:[2,2,2],expression:'smile',opacity:.25},{key:true,record:false});frame=0;evalAt(0);resetHist()");
}
(async()=>{
  let passed=0;const failures=[];
  async function test(name,fn){try{await fn(await createApp(THREE));passed++;console.log('PASS: '+name);}catch(error){failures.push(name);console.error('FAIL: '+name+'\n'+error.stack);}}
  await test('default tween mode and selector leave existing animation behavior intact',a=>{
    body(a);assert.equal(a.run('TweenInterpolation.settings().mode'),'tween');
    a.run('poseAt(5)');close(a.run('parts[1].o.position.x'),5);
    assert.equal(a.document.querySelector('#pose-interpolation').value,'tween');
    assert.equal(a.document.querySelector('#pre').disabled,false);
  });
  await test('hold poses switch exactly at body keys, including subframes and clip boundaries',a=>{
    body(a);a.change('pose-interpolation','hold');
    for(const [time,x] of [[-1,0],[0,0],[.5,0],[9.999,0],[10,10],[15.75,10],[19.999,10],[20,20],[30,20]]){
      a.run('poseAt('+time+')');close(a.run('parts[1].o.position.x'),x);
    }
    assert.equal(a.document.querySelector('#pre').disabled,true);
    a.change('pose-interpolation','tween');a.run('poseAt(5)');close(a.run('parts[1].o.position.x'),5);
  });
  await test('hold faces preserve the outgoing drawing, transform and opacity without crossfading',a=>{
    body(a);face(a);const original=a.run('JSON.stringify(parts[sel].face.keys[0].p)');
    a.run("TweenInterpolation.setMode('hold');poseAt(9.75)");
    assert.equal(a.run('JSON.stringify(get(parts[sel].o))'),original);
    assert.equal(a.run('TweenFaces.evaluated().expression'),'neutral');
    assert.equal(a.run('TweenFaces.evaluated().nextExpression'),null);
    assert.equal(a.run('TweenFaces.evaluated().opacity'),1);
    a.run('poseAt(10)');assert.equal(a.run('TweenFaces.evaluated().expression'),'smile');
    close(a.run('parts[sel].o.position.x'),3);close(a.run('TweenFaces.evaluated().opacity'),.25);
    a.run("TweenInterpolation.setMode('tween');poseAt(5)");
    assert.equal(a.run('TweenFaces.evaluated().nextExpression'),'smile');
  });
  await test('interpolation mode is one undo action and preserves all key values',a=>{
    body(a);const before=a.run('JSON.stringify(keys)');
    a.run("TweenInterpolation.setMode('hold')");
    assert.equal(a.run('undo.length'),1);assert.equal(a.run('JSON.stringify(keys)'),before);
    a.run('doUndo()');assert.equal(a.run('TweenInterpolation.settings().mode'),'tween');
    a.run('doRedo()');assert.equal(a.run('TweenInterpolation.settings().mode'),'hold');
    assert.equal(a.run('JSON.stringify(keys)'),before);
    a.run("TweenInterpolation.setMode('hold');commit()");assert.equal(a.run('undo.length'),1,'reselecting the same mode is not a change');
  });
  await test('projects restore hold mode before evaluation and old files default to tween',a=>{
    body(a);a.run("TweenInterpolation.setMode('hold');TweenTimeline.seek(5);window._holdProject=JSON.parse(JSON.stringify(projGet()));TweenInterpolation.setMode('tween');projSet(_holdProject)");
    assert.equal(a.run('TweenInterpolation.settings().mode'),'hold');close(a.run('parts[1].o.position.x'),0);
    a.run('delete _holdProject.interpolation;projSet(_holdProject)');
    assert.equal(a.run('TweenInterpolation.settings().mode'),'tween');
    a.run('evalAt(5)');close(a.run('parts[1].o.position.x'),5);
  });
  await test('invalid interpolation metadata is rejected before changing scene data',a=>{
    body(a);const before=a.run('JSON.stringify(GeometryEditor.capture())');
    a.run("window._badHold=projGet();_badHold.interpolation={mode:'invalid'}");
    assert.throws(()=>a.run('projSet(_badHold)'),/interpolation/);
    assert.equal(a.run('JSON.stringify(GeometryEditor.capture())'),before);
    assert.equal(a.run("TweenInterpolation.setMode('invalid')"),false);
    assert.equal(a.run('TweenInterpolation.settings().mode'),'tween');
  });
  await test('changing mode pauses playback, cancels manipulation and creates no playback history churn',a=>{
    body(a);a.run('window._holdCancelCount=0;window._holdPriorDirect=window.TweenDirectManipulation;window.TweenDirectManipulation={sync(){},..._holdPriorDirect,cancel(){_holdCancelCount++;_holdPriorDirect?.cancel()}}');
    a.click('play');a.stepAnimation(120);assert.equal(a.run('playing'),true);const beforeCancel=a.run('_holdCancelCount');
    a.run("TweenInterpolation.setMode('hold')");assert.equal(a.run('playing'),false);assert.equal(a.run('_holdCancelCount'),beforeCancel+1);
    a.run('TweenTimeline.seek(0);resetHist()');a.click('play');
    for(let i=0;i<8;i++)a.stepAnimation(100);
    a.click('play');a.run('commit()');assert.equal(a.run('undo.length'),0);
  });
  await test('hold mode bypasses temporal blur in preview and export and retains blur preferences',a=>{
    body(a);a.run("TweenMotionBlur.setSettings({enabled:true,shutter:720,samples:12},false);TweenInterpolation.setMode('hold');window._holdRenders=0;ren.render=()=>_holdRenders++;ren.getRenderTarget=()=>{throw new Error('Temporal target must not be used in Hold mode')};playing=true");
    assert.equal(a.run('TweenMotionBlur.render(10)'),false);
    assert.equal(a.run('TweenMotionBlur.render(10,{exporting:true})'),false);
    assert.equal(a.run('_holdRenders'),2);
    assert.equal(a.run('TweenMotionBlur.settings().enabled'),true);
    assert.equal(a.run('TweenMotionBlur.settings().samples'),12);
    assert.match(a.document.querySelector('#motion-blur-status').textContent,/Hold mode/);
  });
  await test('motion paths retain their own curve timing in hold pose mode',a=>{
    body(a);a.run("TweenMotionPaths.attachPath([[0,0,0],[10,0,0]],{start:0,end:10,smooth:false,e:[0,0,1,1],record:false});TweenInterpolation.setMode('hold');poseAt(5)");
    close(a.run('parts[1].o.position.x'),5);
  });
  console.log(`${passed} interpolation tests passed${failures.length?', '+failures.length+' failed':''}.`);
  if(failures.length)process.exitCode=1;
})();
