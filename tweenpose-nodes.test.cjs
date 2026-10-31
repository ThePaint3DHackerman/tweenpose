/* Focused geometry effect workflows, using the application harness without WebGL. */
'use strict';
const assert = require('node:assert/strict');
const {createApp} = require('./tweenpose-app.test.cjs');
const THREE = require('./tweenpose-tests/three-r128.cjs');

function event(app, selector, type, value) {
  const input = app.document.querySelector(selector); assert(input, 'Missing ' + selector);
  if (value !== undefined) input.value = value;
  input.dispatchEvent({type}); return input;
}
function add(app, shape = 'box', detail) {
  assert.equal(app.run(`GeometryEditor.addShape('${shape}')`),true);
  if (detail !== undefined) { app.change('geo-shape',shape); app.change('geo-segments',detail); app.click('geo-replace'); }
}
const geometry = app => app.run('JSON.stringify(TweenGeometry.serialize(parts[sel].mesh.geometry))');

(async () => {
  let total = 0;
  async function test(name, fn) { const app = await createApp(THREE); await fn(app); total++; console.log('PASS: ' + name); }

  await test('empty scene initializes the simple effect surface and rejects edits safely', app => {
    assert(app.document.querySelector('#geo-node-quick'));
    assert.equal(app.document.querySelector('#geo-node-chain').hidden,true);
    assert.equal(app.document.querySelector('#geo-node-type').hidden,true);
    assert.equal(app.run("GeometryEditor.applyPreset('twist')"),false);
    assert.equal(app.run("GeometryEditor.updateNodeLive(0,'angle',45)"),false);
    app.run('GeometryEditor.endLive()'); assert.equal(app.run('parts.length'),0);
  });

  await test('one-click deformation presets add useful detail and preview from topology mode', app => {
    add(app); const base = app.run('parts[sel].geom.base.attributes.position.count');
    app.change('geo-mode','edit'); app.click('geo-select-all');
    assert.equal(app.run("GeometryEditor.applyPreset('twist')"),true);
    assert.equal(app.run('GeometryEditor.isEditing()'),false);
    assert.equal(app.run('parts[sel].geom.nodes[0].type'),'subdivide');
    assert.equal(app.run('parts[sel].geom.nodes.at(-1).type'),'twist');
    assert(app.run('parts[sel].mesh.geometry.attributes.position.count') > base);
    assert.equal(app.run('parts[sel].geom.base.attributes.position.count'),base,'base stays editable');
    const count = app.run('parts[sel].geom.nodes.length');
    app.run("GeometryEditor.applyPreset('noise')");
    assert.equal(app.run('parts[sel].geom.nodes.length'),count + 1,'adequately detailed output is reused');
    assert(app.document.querySelector('#geo-effects [data-geo-param]'));
    assert(app.document.querySelector('[aria-label="Noise Amount"]'),'exact advanced controls remain available');
  });

  await test('all supplied presets create finite geometry with sensible defaults', async app => {
    for (const effect of ['smooth','twist','noise','spherize','array']) {
      const fresh = await createApp(THREE); add(fresh);
      assert.equal(fresh.run(`GeometryEditor.applyPreset('${effect}')`),true,effect);
      assert.equal(fresh.run('Array.from(parts[sel].mesh.geometry.attributes.position.array).every(Number.isFinite)'),true,effect);
      assert.equal(fresh.run('parts[sel].geom.nodes.at(-1).type'),effect);
    }
  });

  await test('live strength changes update the mesh, preserve the input, and create one undo step', app => {
    add(app); app.run("GeometryEditor.applyPreset('noise')");
    const before = geometry(app), history = app.run('undo.length');
    const selector = '[aria-label="Organic texture Amount slider"]', input = app.document.querySelector(selector);
    input.focus(); app.document.querySelector('#geo-node-quick').scrollTop = 70;
    event(app,selector,'input',.22); assert.notEqual(geometry(app),before,'first input changes the mesh immediately');
    for (const value of [.25,.28,.3,.33,.36]) event(app,selector,'input',value);
    assert.equal(app.run('undo.length'),history,'no per-input snapshots');
    app.flush(); assert.equal(app.run('parts[sel].geom.nodes.at(-1).params.amount'),.36);
    assert.equal(app.run('undo.length'),history,'timer preview does not commit');
    event(app,selector,'change',.36);
    assert.equal(app.run('undo.length'),history + 1,'one completed drag is one history entry');
    assert.equal(app.document.querySelector(selector),input,'live updates keep the same control');
    assert.equal(app.document.activeElement,input,'focus remains on the control');
    assert.equal(app.document.querySelector('#geo-node-quick').scrollTop,70);
    app.run('doUndo()'); assert.equal(geometry(app),before,'undo restores geometry before the complete drag');
    app.run('doRedo()'); assert.equal(app.run('parts[sel].geom.nodes.at(-1).params.amount'),.36);
  });

  await test('live evaluation coalesces queued changes and commits the final value on pointer release', app => {
    add(app); app.run("GeometryEditor.applyPreset('twist'); window.nodeEvaluations=0; window.originalNodeApply=TweenGeometry.applyNode; TweenGeometry.applyNode=function(...args){nodeEvaluations++;return originalNodeApply(...args)}");
    const history = app.run('undo.length');
    for (let angle = 100; angle <= 180; angle += 10) app.run(`GeometryEditor.updateNodeLive(1,'angle',${angle})`);
    assert(app.run('nodeEvaluations') < 9,'queued movement is coalesced');
    assert.equal(app.run('parts[sel].geom.nodes[1].params.angle'),100,'first value is immediate');
    event(app,'[aria-label="Twist Angle ° slider"]','pointerup');
    assert.equal(app.run('parts[sel].geom.nodes[1].params.angle'),180,'release flushes latest queued value');
    assert.equal(app.run('undo.length'),history + 1);
    app.flush(); assert.equal(app.run('undo.length'),history + 1,'stale timer cannot add another snapshot');
  });

  await test('geometry budget failures preserve the chain and rendered output', app => {
    add(app,'box',4); const before = geometry(app), nodes = app.run('JSON.stringify(parts[sel].geom.nodes)'), history = app.run('undo.length');
    assert.equal(app.run("GeometryEditor.mutateNodes(ns=>ns.push({id:'too-dense',type:'subdivide',params:{level:5},enabled:true}))"),false);
    assert.equal(app.run('JSON.stringify(parts[sel].geom.nodes)'),nodes); assert.equal(geometry(app),before); assert.equal(app.run('undo.length'),history);
    assert.match(app.document.querySelector('#toast').textContent,/too much geometry/i);
    // A dense but valid mesh also rejects an oversized live repetition before
    // replacing either the parameters or the visible mesh.
    app.change('geo-segments',32); app.click('geo-replace'); app.run("GeometryEditor.applyPreset('array')");
    const repeated = geometry(app), repeatedHistory = app.run('undo.length');
    assert.equal(app.run("GeometryEditor.updateNodeLive(0,'count',24)"),false); app.run('GeometryEditor.endLive()');
    assert.equal(app.run('parts[sel].geom.nodes[0].params.count'),3); assert.equal(geometry(app),repeated); assert.equal(app.run('undo.length'),repeatedHistory);
  });

  await test('simple bypass, per-node reset, and grouped advanced transforms remain available', app => {
    add(app); app.run("GeometryEditor.applyPreset('noise')"); const active = geometry(app);
    const bypass = app.document.querySelector('[aria-label="Preview Organic texture 2"]'); bypass.checked = false; bypass.dispatchEvent({type:'change'});
    assert.notEqual(geometry(app),active); assert.equal(app.run('parts[sel].geom.nodes[1].enabled'),false);
    event(app,'[aria-label="Reset Noise settings"]','click');
    assert.equal(app.run('parts[sel].geom.nodes[1].params.amount'),.12);
    app.click('geo-advanced-toggle'); assert.equal(app.document.querySelector('#geo-node-chain').hidden,false);
    assert.equal(app.document.querySelector('#geo-add-node').hidden,false);
    app.run("GeometryEditor.addNode('transform')");
    const groups = app.document.querySelectorAll('.node-field-group'); assert.equal(groups.length,3);
    assert.equal(groups[0].open,true); assert.equal(groups[1].open,false); assert.equal(groups[2].open,false);
    assert(app.document.querySelector('[aria-label="Transform Rotate Y"]'));
  });

  await test('selection changes and export finish pending live edits without stale cross-mesh updates', app => {
    add(app); app.run("GeometryEditor.applyPreset('noise')"); add(app,'sphere'); app.run('selPart(1)');
    const other = app.run('JSON.stringify(TweenGeometry.serialize(parts[2].mesh.geometry))');
    app.run("GeometryEditor.updateNodeLive(1,'amount',.3);GeometryEditor.updateNodeLive(1,'amount',.4);selPart(2)");
    assert.equal(app.run('parts[1].geom.nodes[1].params.amount'),.4); app.flush();
    assert.equal(app.run('JSON.stringify(TweenGeometry.serialize(parts[2].mesh.geometry))'),other);
    app.run("selPart(1);GeometryEditor.updateNodeLive(1,'amount',.5);GeometryEditor.updateNodeLive(1,'amount',.6);GeometryEditor.setExporting(true)");
    assert.equal(app.run('parts[1].geom.nodes[1].params.amount'),.6);
    const history = app.run('undo.length'); app.flush(); assert.equal(app.run('undo.length'),history);
    app.run('GeometryEditor.setExporting(false)');
  });

  console.log(`All ${total} geometry effect scenarios passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
