'use strict';
const assert = require('node:assert/strict');
const {createTweenPoseBackupStore} = require('./tweenpose-storage.js');

// An atomic in-memory adapter exercises the exact production retention and error paths.
function adapter() {
  const db = {snapshots:new Map(),assets:new Map(),calls:0,failures:0};
  db.read = async () => ({snapshots:[...db.snapshots.values()],assets:[...db.assets.values()]});
  db.apply = async delta => {
    db.calls++;
    if (db.failures) { db.failures--; const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error; }
    delta.deleteSnapshots.forEach(id => db.snapshots.delete(id));
    delta.deleteAssets.forEach(id => db.assets.delete(id));
    delta.putAssets.forEach(r => db.assets.set(r.id,r));
    delta.putSnapshots.forEach(r => db.snapshots.set(r.id,r));
  };
  return db;
}
const plain = {
  encode:async data => ({data,encoding:'json',bytes:Buffer.byteLength(data)}),
  decode:async record => record.data
};
function project(n=0, material='red', baseSize=30) {
  return {v:2,tot:'120',fps:'24',frame:n,pose:[[n,0,0]],s:0,timeline:{zoom:n},
    r:[{n:'Root'}],k:[{t:n,p:[[n,0,0]],e:'linear'}],
    g:[{root:true,n:'Root'},{id:'mesh-1',n:'Mesh',base:{positions:Array.from({length:baseSize},(_,i)=>i/3)},material:[{color:material}],nodes:[{type:'Twist',amount:n}]}]};
}
let time=100;
function store(db, extra={}) { return createTweenPoseBackupStore({...plain,adapter:db,now:()=>++time,...extra}); }
async function run() {
  let tests=0;
  async function test(name, fn) { await fn(); tests++; console.log('ok '+tests+' - '+name); }
  await test('shares geometry and materials across animation backups', async () => {
    const db=adapter(), s=store(db); await s.ready;
    for(let i=0;i<5;i++) await s.save('Manual',project(i));
    assert.equal(db.snapshots.size,5); assert.equal(db.assets.size,2);
    const entries=s.list(); assert.equal(entries[0].d.g[1].base,entries[4].d.g[1].base);
    assert.deepEqual(entries[4].d.k,project(4).k);
  });
  await test('splits materials from geometry when either changes', async () => {
    const db=adapter(), s=store(db); await s.ready;
    await s.save('Manual',project(0)); await s.save('Manual',project(1,'blue'));
    assert.equal(db.assets.size,3);
    await s.save('Manual',project(2,'blue',31)); assert.equal(db.assets.size,4);
  });
  await test('shares face expression images across faces, key edits, and repeated backups', async () => {
    const db=adapter(), s=store(db); await s.ready;
    const src='data:image/png;base64,'+'AAAB'.repeat(20000), p=project();
    const face={v:1,expressions:[{id:'smile',name:'Smile',src,width:512,height:512}],rest:{p:[0,0,1,0,0,0,1,1,1],expression:'smile',opacity:1},keys:[],crossfade:true};
    p.g[1].face=structuredClone(face);
    p.g.push({...structuredClone(p.g[1]),id:'mesh-2',n:'Another face'});
    for(let i=0;i<6;i++){
      p.g[1].face.keys.push({t:i,p:[i,0,1,0,0,0,1,1,1],expression:'smile',opacity:1,e:[.42,0,.58,1]});
      await s.save('Manual',p);
    }
    assert.equal(db.assets.size,3,'geometry, material, and one image asset');
    const imageAssets=[...db.assets.values()].filter(r=>JSON.parse(r.data)===src);
    assert.equal(imageAssets.length,1,'one image asset serves every face and key snapshot');
    for(const record of db.snapshots.values()){
      const manifest=JSON.parse(record.data);
      assert.equal(record.data.includes(src),false,'snapshot manifests exclude large image text');
      assert.equal(manifest.g[1].face.expressions[0].src.$tweenposeAsset,imageAssets[0].id);
      assert.equal(manifest.g[2].face.expressions[0].src.$tweenposeAsset,imageAssets[0].id);
    }
    const reopened=store(db); await reopened.ready;
    assert.deepEqual(reopened.restore(reopened.list().at(-1).id),p,'reopened project hydrates images and independent keys');
    const oldest=reopened.restore(reopened.list()[0].id);assert.equal(oldest.g[1].face.keys.length,1);
    oldest.g[1].face.expressions[0].src='changed';
    assert.equal(reopened.restore(reopened.list()[0].id).g[1].face.expressions[0].src,src,'restores are independent');
    await reopened.keep([reopened.list().at(-1).id]);assert.equal(db.assets.size,3);
    await reopened.keep([]);assert.equal(db.assets.size,0,'image garbage collection follows snapshot references');
  });
  await test('new face images add only image assets and retain other expression metadata', async () => {
    const db=adapter(),s=store(db);await s.ready;const p=project();
    p.g[1].face={v:1,expressions:[{id:'a',name:'A',src:'data:image/png;base64,AAAA',width:8,height:4}],keys:[]};
    await s.save('Manual',p);p.g[1].face.expressions.push({id:'b',name:'B',src:'data:image/png;base64,BBBB',width:8,height:4});
    await s.save('Manual',p);assert.equal(db.assets.size,4);
    assert.deepEqual(s.restore(s.list().at(-1).id),p);
  });
  await test('takes immutable keyframe snapshots and restores independent copies', async () => {
    const db=adapter(), s=store(db); await s.ready;
    const p=project(1); await s.save('Manual',p); p.k[0].p[0][0]=99;
    const restored=s.restore(s.list()[0].id); assert.equal(restored.k[0].p[0][0],1);
    restored.k[0].p[0][0]=100; assert.equal(s.restore(s.list()[0].id).k[0].p[0][0],1);
  });
  await test('reopens saved manifests and assets as a complete portable project', async () => {
    const db=adapter(), s=store(db); await s.ready; await s.save('Manual',project(3));
    const reopened=store(db); await reopened.ready;
    assert.deepEqual(reopened.list()[0].d,project(3)); assert.equal(reopened.list()[0].persistent,true);
  });
  await test('retains eight recent automatic backups and all recent manual backups', async () => {
    const db=adapter(), s=store(db); await s.ready; await s.save('Manual',project(-1));
    for(let i=0;i<15;i++) await s.save('Auto',project(i));
    assert.equal(s.list().filter(x=>x.l==='Auto').length,8); assert.equal(s.list().filter(x=>x.l==='Manual').length,1);
    assert.equal(s.list().at(-1).d.k[0].t,14);
  });
  await test('applies the byte budget and garbage collects unused assets', async () => {
    const db=adapter(), s=store(db,{budgetBytes:3600}); await s.ready;
    for(let i=0;i<10;i++) await s.save('Manual',project(i,'color-'+i,130+i));
    assert.ok(s.status().bytes<=3600); assert.ok(db.snapshots.size<10);
    const referenced=new Set([...db.snapshots.values()].flatMap(r=>r.refs)); assert.equal(db.assets.size,referenced.size);
    assert.equal(s.list().at(-1).d.k[0].t,9);
  });
  await test('retries a quota failure once after removing old automatic backups', async () => {
    const db=adapter(), s=store(db); await s.ready;
    await s.save('Manual',project(0)); await s.save('Auto',project(1)); await s.save('Auto',project(2));
    const before=db.calls; db.failures=1;
    const result=await s.save('Manual',project(3));
    assert.equal(result.persistent,true); assert.equal(db.calls,before+2);
    assert.equal(s.list().some(x=>x.l==='Auto'),false); assert.equal(s.list().filter(x=>x.l==='Manual').length,2);
  });
  await test('pauses persistent writes after a repeated quota failure without popups', async () => {
    const db=adapter(), states=[], s=store(db,{onStatus:x=>states.push(x)}); await s.ready;
    db.failures=10; const before=db.calls;
    const first=await s.save('Manual',project(0)); assert.equal(first.saved,true); assert.equal(first.persistent,false);
    for(let i=1;i<5;i++) await s.save('Auto',project(i));
    assert.equal(db.calls,before+2); assert.equal(s.status().mode,'paused'); assert.equal(s.list().at(-1).d.k[0].t,4);
    assert.ok(states.every(x=>typeof x.message==='string'));
  });
  await test('uses session backups when IndexedDB is blocked or unavailable', async () => {
    const s=createTweenPoseBackupStore({...plain,indexedDB:null}); await s.ready;
    assert.equal(s.status().mode,'session'); assert.equal((await s.save('Manual',project())).saved,true);
    assert.equal(s.list().length,1); assert.equal(s.list()[0].persistent,false);
  });
  await test('explicit deletion frees persisted data and resumes a paused database', async () => {
    const db=adapter(),s=store(db);await s.ready;await s.save('Manual',project(0));await s.save('Auto',project(1));
    db.failures=2;await s.save('Manual',project(2));assert.equal(s.status().mode,'paused');
    await s.keep([]);assert.equal(db.snapshots.size,0);assert.equal(db.assets.size,0);assert.equal(s.status().mode,'saved');
    assert.equal((await s.save('Manual',project(3))).persistent,true);
  });
  await test('migrates legacy localStorage only after durable database commits', async () => {
    const db=adapter(), events=[];
    const storage={getItem:key=>JSON.stringify([{t:1,l:'Manual',d:project(1)}]),removeItem:key=>{assert.equal(db.snapshots.size,1);events.push(key)},setItem:()=>assert.fail('Heavy localStorage writes are forbidden')};
    const s=store(db,{localStorage:storage,legacyKey:'legacy'}); await s.ready;
    assert.deepEqual(events,['legacy']); assert.deepEqual(s.list()[0].d,project(1));
  });
  await test('preserves legacy backups if migration cannot be committed', async () => {
    const db=adapter(); db.failures=10; let removed=false;
    const s=store(db,{localStorage:{getItem:()=>JSON.stringify([{t:1,l:'Manual',d:project(1)}]),removeItem:()=>removed=true},legacyKey:'legacy'});
    await s.ready; assert.equal(removed,false); assert.equal(s.list().length,1); assert.equal(s.status().mode,'paused');
  });
  await test('keeps remaining legacy backups accessible in this session after migration quota failure', async () => {
    const db=adapter();db.failures=2;let removed=false;
    const legacy=[1,2,3].map(t=>({t,l:'Manual',d:project(t)}));
    const s=store(db,{localStorage:{getItem:()=>JSON.stringify(legacy),removeItem:()=>removed=true},legacyKey:'legacy'});
    await s.ready;assert.equal(removed,false);assert.equal(s.status().mode,'paused');assert.equal(db.calls,2);
    assert.deepEqual(s.list().map(x=>x.d.k[0].t),[1,2,3]);assert.equal(s.list().every(x=>!x.persistent),true);
  });
  await test('frame, selected key, pose evaluation, and timeline view do not change edit signature', async () => {
    const s=store(adapter()); await s.ready; const p=project(0), q=structuredClone(p);
    q.frame=50; q.s=7; q.pose=[[50,30,20]]; q.timeline={zoom:12,scroll:7};
    assert.equal(s.signature(p),s.signature(q));
    q.k[0].t=15; assert.notEqual(s.signature(p),s.signature(q));
  });
  await test('duplicate automatic snapshots are skipped but a deliberate pose edit can be saved', async () => {
    const s=store(adapter()); await s.ready; const p=project(1); await s.save('Manual',p);
    assert.equal((await s.save('Auto',p)).saved,false);
    p.pose=[[15,20,30]]; assert.equal((await s.save('Auto',p,{poseChanged:true})).saved,true);
  });
  await test('deleting backups removes only unreferenced static assets', async () => {
    const db=adapter(),s=store(db);await s.ready;await s.save('Manual',project(0));await s.save('Manual',project(1,'blue'));
    await s.keep([s.list()[1].id]);assert.equal(db.snapshots.size,1);assert.equal(db.assets.size,2);
    assert.equal(s.list()[0].d.g[1].material[0].color,'blue');
    await s.keep([]);assert.equal(db.assets.size,0);assert.equal(db.snapshots.size,0);
  });
  await test('gzip records decode across a new store when browser compression is available', async () => {
    const db=adapter(), s=createTweenPoseBackupStore({adapter:db});await s.ready;
    await s.save('Manual',project(0,'red',8000));
    const reopened=createTweenPoseBackupStore({adapter:db});await reopened.ready;
    assert.deepEqual(reopened.list()[0].d,project(0,'red',8000));
    if(typeof CompressionStream==='function')assert.ok([...db.assets.values()].some(r=>r.encoding==='gzip'));
  });
  console.log(tests+' storage tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
