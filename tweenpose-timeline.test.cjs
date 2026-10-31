/* Timeline behavior checks against the application's real THREE r128 dependency. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createApp } = require('./tweenpose-app.test.cjs');
const THREE = require('./tweenpose-tests/three-r128.cjs');
const extension = fs.readFileSync(require('node:path').join(__dirname, 'tweenpose-timeline.js'),'utf8');
async function app() {
  const a = await createApp(THREE);
  if (!a.run('!!window.TweenTimeline')) a.run(extension);
  return a;
}
function close(actual, expected, tolerance=1e-6) { assert(Math.abs(actual-expected)<tolerance, `${actual} differs from ${expected}`); }
function scene(a) {
  a.click('geo-add');
  a.run('TweenTimeline.seek(20);parts[sel].o.position.x=2;upsert();commit();TweenTimeline.seek(0);resetHist()');
}
(async () => {
  let passed=0;
  async function test(name, fn) { const a=await app();await fn(a);passed++;console.log('PASS: '+name); }
  await test('larger accessible timeline and all original controls remain available',a=>{
    for(const id of ['fl','addk','delk','track','ph','tl-zoom','tl-frame','tl-key-time','tl-height','tl-units'])assert(a.document.querySelector('#'+id),id);
    assert.equal(a.run('TweenTimeline.state.height'),306);
    assert.equal(a.document.querySelector('#track').getAttribute('role'),'region');
    assert.equal(a.document.querySelector('#tl-prev-frame').getAttribute('aria-label'),'Previous frame');
  });
  await test('zoom changes content width and retains the frame under the pointer',a=>{
    a.change('tot',120);a.run('TweenTimeline.fit()');
    const before=a.run('TweenTimeline.frameAt(300)');
    a.run('TweenTimeline.setZoom(8,undefined,300)');
    assert(a.run('TweenTimeline.state.contentWidth>TweenTimeline.state.viewportWidth*7'));
    close(a.run('TweenTimeline.frameAt(300)'),before);
    assert(a.run('TweenTimeline.state.pixelsPerFrame>40'));
    a.run('TweenTimeline.fit()');assert.equal(a.run('TweenTimeline.state.zoom'),1);assert.equal(a.document.querySelector('#track').scrollLeft,0);
  });
  await test('600 frames fit a narrow viewport and maximum zoom preserves frame mapping',a=>{
    const track=a.document.querySelector('#track');
    Object.defineProperty(track,'clientWidth',{value:320,configurable:true});
    a.change('tot',600);a.run('TweenTimeline.fit()');
    close(a.run('TweenTimeline.state.contentWidth'),320);
    assert(a.run('TweenTimeline.state.pixelsPerFrame<1'));
    close(a.run('TweenTimeline.xAt(599)'),296);
    a.run('TweenTimeline.setZoom(64,300,160)');
    assert.equal(a.run('TweenTimeline.state.zoom'),64);
    close(a.run('TweenTimeline.frameAt(160)'),300);
    a.run('TweenTimeline.seek(Math.round(TweenTimeline.frameAt(160)))');assert.equal(a.run('frame'),300);
  });
  await test('horizontal scrolling maps scrubbing to the zoomed frame correctly',a=>{
    a.change('tot',120);a.run('TweenTimeline.setZoom(8)');
    a.document.querySelector('#track').scrollLeft=600;
    const expected=a.run('Math.round(TweenTimeline.frameAt(250))');
    const t=a.document.querySelector('#track');
    t.dispatchEvent({type:'pointerdown',button:0,clientX:250,pointerId:1,target:t});
    t.dispatchEvent({type:'pointerup',pointerId:1});
    assert.equal(a.run('frame'),expected);
    assert.equal(a.run('TweenTimeline.playing'),false);
  });
  await test('fine frame and key navigation updates the animated transform immediately',a=>{
    scene(a);a.change('tl-frame',10);close(a.run('parts[sel].o.position.x'),1,0.0001);
    a.click('tl-next-frame');assert.equal(a.run('frame'),11);assert(a.run('parts[sel].o.position.x>1'));
    a.click('tl-prev-frame');assert.equal(a.run('frame'),10);
    a.click('tl-next-key');assert.equal(a.run('frame'),20);close(a.run('parts[sel].o.position.x'),2);
    a.click('tl-prev-key');assert.equal(a.run('frame'),0);close(a.run('parts[sel].o.position.x'),0);
  });
  await test('retiming is collision safe and its animation change is undoable in one step',a=>{
    scene(a);assert.equal(a.run('TweenTimeline.retime(keys[1],0)'),false);
    assert.equal(a.run('keys[1].t'),20);
    assert.equal(a.run('TweenTimeline.retime(keys[1],24)'),true);assert.equal(a.run('keys[1].t'),24);
    a.run('TweenTimeline.seek(12)');close(a.run('parts[sel].o.position.x'),1,0.0001);
    a.run('doUndo()');assert.equal(a.run('keys[1].t'),20);
    a.run('doRedo()');assert.equal(a.run('keys[1].t'),24);
    a.run('TweenTimeline.selectKey(keys[1])');a.change('tl-key-time',25);assert.equal(a.run('keys[1].t'),25);
  });
  await test('dragging a key edits timing, seeks its pose, and commits a single undo step',a=>{
    scene(a);a.run('TweenTimeline.setZoom(3);TweenTimeline.selectKey(keys[1])');
    const t=a.document.querySelector('#track'),key=a.document.querySelectorAll('.tl-key')[1];
    const x=a.run('TweenTimeline.xAt(20)')-(t.scrollLeft||0),target=a.run('TweenTimeline.xAt(23)')-(t.scrollLeft||0);
    t.dispatchEvent({type:'pointerdown',button:0,clientX:x,pointerId:3,target:key});
    t.dispatchEvent({type:'pointermove',clientX:target,pointerId:3,target:key});
    t.dispatchEvent({type:'pointerup',pointerId:3,target:key});
    assert.equal(a.run('keys[1].t'),23);assert.equal(a.run('frame'),23);close(a.run('parts[sel].o.position.x'),2);
    assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');assert.equal(a.run('keys[1].t'),20);
  });
  await test('undoing an earlier key timing restores its original evaluated pose',a=>{
    scene(a);a.run('TweenTimeline.retime(keys[1],12)');
    assert.equal(a.run('frame'),12);close(a.run('parts[sel].o.position.x'),2);
    a.run('doUndo()');assert.equal(a.run('keys[1].t'),20);assert.equal(a.run('frame'),12);
    close(a.run('parts[sel].o.position.x'),a.run('2*bez(12/20,keys[0].e)'),0.0001);
    a.run('doRedo()');assert.equal(a.run('keys[1].t'),12);close(a.run('parts[sel].o.position.x'),2);
  });
  await test('elapsed-time playback updates pose and easing without rebuilding key DOM',a=>{
    scene(a);a.run('TweenTimeline.setZoom(3);TweenTimeline.seek(0)');
    const renders=a.run('TweenTimeline.state.staticRenders'),node=a.document.querySelector('.tl-key');
    a.click('play');a.stepAnimation(500);assert.equal(a.run('frame'),6);
    close(a.run('parts[sel].o.position.x'),a.run('2*bez(0.3,keys[0].e)'),0.0001);
    a.stepAnimation(750);assert.equal(a.run('frame'),15);
    assert.equal(a.run('TweenTimeline.state.staticRenders'),renders);
    assert.equal(a.document.querySelector('.tl-key'),node);
    assert.equal(a.run('selKey===keys[0]'),true);
    assert(a.document.querySelector('#track').scrollLeft>0,'follow pans to visible frame');
    a.stepAnimation(500);assert.equal(a.run('frame'),21);assert.equal(a.run('selKey===keys[1]'),true);
    a.click('play');assert.equal(a.run('playing'),false);
    a.run('commit()');assert.equal(a.run('undo.length'),0,'playback creates no undo entries');
  });
  await test('smooth interpolation uses subframes while cloth receives integer frames',a=>{
    scene(a);a.click('play');a.stepAnimation(125);
    assert.equal(a.run('frame'),1);close(a.run('TweenTimeline.state.playhead'),1.5);
    assert(a.run('parts[sel].o.position.x>2*bez(1/20,keys[0].e)'));
    a.click('play');a.run("TweenTimeline.seek(0);parts[sel].cl={on:true};window._evalFrames=[];evalAt=f=>_evalFrames.push(f)");
    a.click('play');a.stepAnimation(125);assert.equal(a.run('_evalFrames.every(Number.isInteger)'),true);
  });
  await test('seek pauses playback and changes no history or keyframe content',a=>{
    scene(a);const before=a.run('JSON.stringify(keys)');a.click('play');a.stepAnimation(625);a.change('tl-frame',8);
    assert.equal(a.run('playing'),false);assert.equal(a.run('frame'),8);assert.equal(a.run('JSON.stringify(keys)'),before);
    a.run('commit()');assert.equal(a.run('undo.length'),0);
  });
  await test('FPS changes during playback keep time continuous and advance at the new speed',a=>{
    scene(a);a.click('play');a.stepAnimation(250);assert.equal(a.run('frame'),3);
    a.change('fps',24);a.stepAnimation(250);assert.equal(a.run('frame'),9);
    a.change('fps',6);a.stepAnimation(500);assert.equal(a.run('frame'),12);
    a.click('play');a.click('play');a.stepAnimation(250);assert.equal(a.run('frame'),13);
  });
  await test('stopping a fractional preview creates no history while later manual edits remain undoable',a=>{
    scene(a);a.click('play');a.stepAnimation(125);a.click('play');a.run('commit()');
    assert.equal(a.run('frame'),1);assert.equal(a.run('undo.length'),0);
    const pose=a.run('parts[sel].o.position.x');
    a.run('parts[sel].o.position.x=1.25;upsert();commit()');assert.equal(a.run('undo.length'),1);
    a.run('doUndo()');close(a.run('parts[sel].o.position.x'),pose,0.0001);
  });
  await test('timeline preferences restore with bounds and optional seconds ruler',a=>{
    a.change('tot',120);
    a.run("TweenTimeline.restoreSettings({zoom:6,pan:420,follow:false,smooth:false,height:410,laneHeight:135,timeUnits:'seconds'})");
    const pref=JSON.parse(a.run('JSON.stringify(TweenTimeline.settings())'));
    assert.deepEqual(pref,{zoom:6,pan:420,follow:false,smooth:false,height:410,laneHeight:135,timeUnits:'seconds'});
    assert(a.document.querySelector('#tl-ruler').textContent.includes('s'));
    a.run('TweenTimeline.restoreSettings({zoom:999,height:-10,laneHeight:999,pan:-20})');
    assert.equal(a.run('TweenTimeline.state.height'),230);assert.equal(a.run('TweenTimeline.state.laneHeight'),180);
    assert.equal(a.document.querySelector('#track').scrollLeft,0);assert(a.run('TweenTimeline.state.pixelsPerFrame<=120'));
  });
  console.log(`${passed} timeline scenarios passed.`);
})().catch(error=>{console.error(error);process.exitCode=1});
