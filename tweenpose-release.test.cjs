/* Clean itch.io package checks. Uses real THREE mathematics with a mock DOM/renderer;
 * no browser or GPU context is opened. Build first: node tweenpose-release.cjs */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const zlib=require('node:zlib');
const {createApp}=require('./tweenpose-app.test.cjs');
const THREE=require('./tweenpose-tests/three-r128.cjs');
const ROOT=__dirname, RELEASE=path.join(ROOT,'tweenpose-itch-release');
const ZIP=path.join(ROOT,'TweenPose-itchio.zip');
const EXPECTED=[
  'index.html','LICENSE','THIRD_PARTY_LICENSES.txt','vendor/three-r128.min.js',
  'vendor/OBJLoader.js','vendor/MTLLoader.js','vendor/GLTFLoader.js',
  'vendor/OrbitControls.js','vendor/TransformControls.js',
  'vendor/jszip-3.10.1.min.js','vendor/gifenc-1.0.3.js'
].sort();

function filesIn(dir,prefix=''){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    assert(!entry.isSymbolicLink(),'Release assets cannot be symlinks');
    const name=prefix+entry.name;
    return entry.isDirectory()?filesIn(path.join(dir,entry.name),name+'/'):[name];
  });
}
function crc32(buffer){
  let crc=0xffffffff;
  for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function readZip(bytes){
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}}
  assert(end>=0,'ZIP has an end-of-directory record');
  assert.equal(bytes.readUInt16LE(end+4),0,'Single-disk ZIP');
  assert.equal(bytes.readUInt16LE(end+6),0,'Single-disk directory');
  const count=bytes.readUInt16LE(end+10), result=new Map();
  let cursor=bytes.readUInt32LE(end+16);
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(cursor),0x02014b50,'Central ZIP header');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10);
    const expectedCRC=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32);
    const name=bytes.toString('utf8',cursor+46,cursor+46+nameLength),local=bytes.readUInt32LE(cursor+42);
    assert.equal(flags&1,0,'ZIP entries are not encrypted');
    assert(!result.has(name),'No duplicate ZIP entries');
    assert(!name.startsWith('/')&&!name.includes('..')&&!name.includes('\\'),'ZIP entries are safe relative paths');
    assert.equal(bytes.readUInt32LE(local),0x04034b50,'Local ZIP header');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    const payload=bytes.subarray(start,start+compressed);
    const data=method===8?zlib.inflateRawSync(payload):method===0?payload:null;
    assert(data,'Only ordinary ZIP compression is used');
    assert.equal(data.length,size,'ZIP uncompressed size matches');
    assert.equal(crc32(data),expectedCRC,'ZIP checksum matches');
    result.set(name,data);cursor+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(cursor,end,'ZIP has no unlisted directory entries');
  return result;
}

// A same-origin database deliberately contains another scope's private work.
// The release must neither import that work nor delete it when making its own backups.
function makeDatabase(){
  const snapshots=new Map([['private-snapshot',{id:'private-snapshot',scope:'TweenPose Studio',t:1,l:'My private animation',refs:['private-asset'],data:JSON.stringify({r:['PRIVATE'],k:[]}),encoding:'json',bytes:30}]]);
  const assets=new Map([['private-asset',{id:'private-asset',scope:'TweenPose Studio',data:'"PRIVATE DRAWING"',encoding:'json',bytes:17}]]);
  const writes=[],opens=[];
  const stores={snapshots,assets};
  const db={objectStoreNames:{contains:name=>name in stores},close(){},transaction(names,mode){
    const tx={objectStore(name){const values=stores[name];return{
      getAll(){const request={};queueMicrotask(()=>{request.result=[...values.values()];request.onsuccess?.();});return request;},
      put(record){writes.push({type:'put',store:name,record});values.set(record.id,record);},
      delete(id){writes.push({type:'delete',store:name,id});values.delete(id);}
    };},abort(){}};
    if(mode==='readwrite')queueMicrotask(()=>tx.oncomplete?.());
    return tx;
  }};
  return{snapshots,assets,writes,opens,indexedDB:{open(name,version){opens.push({name,version});const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}}};
}

(async()=>{
  assert(fs.existsSync(RELEASE)&&fs.existsSync(ZIP),'Run node tweenpose-release.cjs before these checks');
  const html=fs.readFileSync(path.join(RELEASE,'index.html'),'utf8'), failures=[];
  let passed=0;
  async function test(name,fn){try{await fn();passed++;console.log('PASS: '+name);}catch(error){failures.push(name);console.error('FAIL: '+name+'\n'+error.stack);}}
  const makeApp=overrides=>createApp(THREE,overrides,{html,root:RELEASE,skipExternalScripts:true});

  await test('release directory and ZIP use an explicit runtime-only allowlist',()=>{
    assert.deepEqual(filesIn(RELEASE).sort(),EXPECTED);
    const zip=readZip(fs.readFileSync(ZIP));
    assert.deepEqual([...zip.keys()].sort(),EXPECTED);
    for(const [name,data] of zip)assert.deepEqual(data,fs.readFileSync(path.join(RELEASE,name)),name+' matches the inspected release');
    assert(![...zip.keys()].some(name=>/test|project|snapshot|backup|\.json$|\.gif$|\.png$|\.glb$|\.obj$/i.test(name)),'No project, animation export, backup, or test file is shipped');
  });

  await test('all runtime dependencies are local, present, and valid JavaScript',()=>{
    const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const sources=scripts.map(match=>match[1].match(/\bsrc=["']([^"']+)["']/)?.[1]).filter(Boolean);
    assert.deepEqual(sources.slice().sort(),EXPECTED.filter(name=>name.startsWith('vendor/')));
    for(const src of sources){assert(!/^(?:[a-z]+:|\/)/i.test(src));new vm.Script(fs.readFileSync(path.join(RELEASE,src),'utf8'),{filename:src});}
    for(const script of scripts.filter(match=>!match[1].includes('src=')))new vm.Script(script[2]);
    assert(!/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:/i.test(html),'No remote page dependency');
    assert(!/https?:\/\/[^\s"']+\.(?:js|css)(?:["'?\s]|$)/i.test(html),'No remote lazy script dependency');
  });

  await test('bundled libraries load together with the expected import and export APIs',()=>{
    const runtime={console,setTimeout,clearTimeout,TextEncoder,TextDecoder,Blob};
    runtime.window=runtime;runtime.self=runtime;runtime.globalThis=runtime;vm.createContext(runtime);
    const bootstrap=html.slice(0,html.indexOf('<!-- tweenpose:geometry-kernel -->'));
    for(const match of bootstrap.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      const src=match[1].match(/\bsrc=["']([^"']+)["']/)?.[1];
      vm.runInContext(src?fs.readFileSync(path.join(RELEASE,src),'utf8'):match[2],runtime,{filename:src||'release bootstrap'});
    }
    assert.equal(runtime.THREE.REVISION,'128');
    for(const name of ['OBJLoader','MTLLoader','GLTFLoader','OrbitControls','TransformControls'])assert.equal(typeof runtime.THREE[name],'function',name+' bundled');
    assert.equal(typeof runtime.JSZip,'function');
    for(const name of ['GIFEncoder','quantize','applyPalette'])assert.equal(typeof runtime.exports[name],'function',name+' export API used by the app');
  });

  await test('package contains release configuration and no personal embedded media or machine paths',()=>{
    assert.match(html,/window\.TweenPoseRelease\s*=\s*\{/);
    assert(html.indexOf('window.TweenPoseRelease')<html.indexOf('const $='),'Release configuration precedes application startup');
    assert(!/C:(?:\\|\/)+(?:Users|users)(?:\\|\/)/.test(html),'No personal absolute filesystem path');
    assert(!/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{32}/.test(html),'No imported face drawings or texture payloads embedded in the app');
    assert(!/<script\b[^>]*type=["']application\/json/.test(html),'No embedded project JSON');
    const licenses=fs.readFileSync(path.join(RELEASE,'THIRD_PARTY_LICENSES.txt'),'utf8');
    for(const name of ['Three','JSZip','gifenc'])assert(licenses.toLowerCase().includes(name.toLowerCase()),name+' license attribution');
    assert.match(licenses,/MIT/);
  });

  await test('first launch opens an empty scene and animation with every editing feature available',async()=>{
    const app=await makeApp();await app.run('TweenPoseBackups.store.ready');app.flush();
    assert.equal(app.run('parts.length'),0);assert.equal(app.run('keys.length'),0);assert.equal(app.run('frame'),0);
    assert.equal(app.run('sget().length'),0);
    assert.equal(app.run("TweenPoseRelease.backupScope"),'TweenPose itch.io');
    assert.equal(app.run('TweenPoseRelease.legacyBackups'),false);
    for(const name of ['GeometryEditor','TweenFaces','TweenMotionPaths','TweenMotionBlur','TweenDirectManipulation','TweenInterpolation','TweenTimeline'])assert.equal(app.run('typeof '+name),'object',name+' available');
    assert.equal(app.run('TweenMotionBlur.settings().enabled'),false);
    assert.equal(app.run('JSON.stringify(projGet().g)'),'[]');
    assert.equal(app.run('JSON.stringify(projGet().k)'),'[]');
    assert.match(app.document.querySelector('#bkn').textContent,/No backups yet/);
  });

  await test('release never reads, writes, or deletes legacy localStorage backups',async()=>{
    const calls=[];
    const app=await makeApp({localStorage:{getItem:key=>{calls.push(['get',key]);return JSON.stringify([{t:1,l:'Personal project',d:{r:['private'],k:[]}}]);},setItem:(...args)=>calls.push(['set',...args]),removeItem:key=>calls.push(['remove',key])}});
    await app.run('TweenPoseBackups.store.ready');app.flush();
    assert.equal(app.run('sget().length'),0);
    app.run("GeometryEditor.addShape('box',1)");app.flush();
    assert.equal(await app.run("snapNow('Manual')"),true);
    assert.deepEqual(calls,[],'Author backups are left untouched');
  });

  await test('same-origin author backup records are isolated and survive release saves',async()=>{
    const db=makeDatabase(), privateSnapshot=JSON.stringify(db.snapshots.get('private-snapshot')),privateAsset=JSON.stringify(db.assets.get('private-asset'));
    const app=await makeApp({indexedDB:db.indexedDB});await app.run('TweenPoseBackups.store.ready');app.flush();
    assert.equal(app.run('sget().length'),0,'Another scope does not appear in public backups');
    assert.equal(db.writes.length,0,'Startup never clears the shared database');
    app.run("GeometryEditor.addShape('sphere',8)");app.flush();
    assert.equal(await app.run("snapNow('My new animation')"),true);
    assert.equal(app.run('sget().length'),1);
    for(const write of db.writes)if(write.type==='put')assert.equal(write.record.scope,'TweenPose itch.io');else assert(!write.id.startsWith('private-'));
    assert.equal(JSON.stringify(db.snapshots.get('private-snapshot')),privateSnapshot);
    assert.equal(JSON.stringify(db.assets.get('private-asset')),privateAsset);
    assert(db.writes.some(write=>write.type==='put'&&write.store==='snapshots'),'New backup is persisted');
  });

  await test('new users can create, animate, save, and restore their own project',async()=>{
    const app=await makeApp();await app.run('TweenPoseBackups.store.ready');app.flush();
    app.run("GeometryEditor.addShape('box',1);keys=[];frame=0;parts[1].o.position.x=0;upsert();frame=24;parts[1].o.position.x=6;upsert();evalAt(12)");
    assert(Math.abs(app.run('parts[1].o.position.x')-3)<1e-4,'New keys interpolate');
    assert.equal(await app.run("snapNow('My first animation')"),true);
    assert.equal(app.run('sget().length'),1);
    const saved=app.run('JSON.stringify(projGet())');
    app.run('parts[1].o.position.x=99');
    app.run('projSet(TweenPoseBackups.store.restore(sget()[0].id))');
    assert.equal(app.run('parts.length'),2);assert.equal(app.run('keys.length'),2);
    assert.equal(app.run('JSON.stringify(projGet())'),saved,'Project survives its backup round trip');
  });

  await test('returning release users keep their own backups and still start with an empty scene',async()=>{
    const db=makeDatabase();
    const first=await makeApp({indexedDB:db.indexedDB});await first.run('TweenPoseBackups.store.ready');first.flush();
    first.run("GeometryEditor.addShape('box',1)");first.flush();await first.run("snapNow('Public user project')");
    const second=await makeApp({indexedDB:db.indexedDB});await second.run('TweenPoseBackups.store.ready');second.flush();
    assert.equal(second.run('parts.length'),0);assert.equal(second.run('keys.length'),0);
    assert.equal(second.run('sget().length'),1,'The user backup remains available');
    assert.equal(second.run('sget()[0].l'),'Public user project');
    assert(db.snapshots.has('private-snapshot')&&db.assets.has('private-asset'));
  });

  console.log(`${passed} release checks passed${failures.length?', '+failures.length+' failed':''}. Rendering uses a mock WebGL renderer; GPU visuals are not tested.`);
  if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
