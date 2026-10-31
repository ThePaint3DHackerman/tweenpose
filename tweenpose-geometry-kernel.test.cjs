/* Run: node tweenpose-geometry-kernel.test.cjs [path/to/three.cjs]
 * Accepts a CommonJS THREE build or standalone ESM core, without WebGL. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async function () {
  const runtime = path.resolve(process.argv[2] || path.join(__dirname,'tweenpose-tests','three-r128.cjs'));
  global.THREE = path.extname(runtime) === '.cjs' ? require(runtime)
    : await import('data:text/javascript;base64,' + fs.readFileSync(runtime).toString('base64'));
  const T = global.THREE, G = require('./tweenpose-geometry-kernel.js');
  function valid(g) {
    assert(g.index, 'output is indexed');
    assert(g.attributes.position.count <= G.MAX_VERTICES);
    for (const n of g.attributes.position.array) assert(Number.isFinite(n));
    for (const n of g.attributes.normal.array) assert(Number.isFinite(n));
    for (const index of g.index.array) assert(index < g.attributes.position.count);
    assert(Number.isFinite(g.boundingSphere.radius));
    return g;
  }
  function edgeUses(g) {
    const uses = new Map(), indices = g.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      for (const [a,b] of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]) {
        const key = a < b ? a+':'+b : b+':'+a;
        uses.set(key, (uses.get(key)||0)+1);
      }
    }
    return [...uses.values()];
  }
  function volume(g) {
    const p=g.attributes.position, index=g.index, a=new T.Vector3(), b=new T.Vector3(), c=new T.Vector3();
    let total=0;
    for(let f=0;f<index.count;f+=3) {
      a.fromBufferAttribute(p,index.getX(f)); b.fromBufferAttribute(p,index.getX(f+1)); c.fromBufferAttribute(p,index.getX(f+2));
      total+=a.dot(b.cross(c))/6;
    }
    return total;
  }
  const box = valid(G.primitive('box',1));
  assert.equal(G.topology(box).vertices,8);
  assert.equal(G.topology(box).faces,12);
  assert.equal(G.topology(box).edges.length,18);
  assert(edgeUses(box).every(n=>n===2), 'box is a closed manifold');
  assert(Math.abs(volume(box)-8)<1e-8,'box triangles face outward');
  for (const shape of ['box','sphere','cylinder','cone','torus','plane','icosphere']) {
    valid(G.primitive(shape,1)); valid(G.primitive(shape,8));
    const dense = valid(G.primitive(shape,32));
    if(shape !== 'plane') assert(edgeUses(dense).every(n=>n===2),shape+' keeps its caps and seams closed');
    else assert.equal(edgeUses(dense).filter(n=>n===1).length,128,'plane keeps its perimeter boundary');
  }
  const weldedSource = new T.BufferGeometry();
  weldedSource.setAttribute('position',new T.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0.000009,0,0, 0,1,0, 0,0,1, 0,0,0,0,0,0,1,0,0],3));
  const welded = valid(G.canonicalize(weldedSource));
  assert.equal(welded.attributes.position.count,4,'near positions weld across buckets');
  assert.equal(welded.index.count,6,'degenerate triangles are removed');
  const acrossBucket = new T.BufferGeometry();
  acrossBucket.setAttribute('position',new T.Float32BufferAttribute([0.000009999,0,0, 1,0,0, 0,1,0, 0.000010001,0,0, 0,1,0, 0,0,1],3));
  assert.equal(G.canonicalize(acrossBucket).attributes.position.count,4,'weld searches adjacent spatial buckets');
  const split = valid(G.subdivide(box));
  assert.equal(split.attributes.position.count,26,'midpoints are shared across edges');
  assert.equal(split.index.count/3,48);
  assert(edgeUses(split).every(n=>n===2),'subdivision keeps a closed manifold');
  const plane = G.primitive('plane',1), extruded = valid(G.extrudeFaces(plane,[0,1],0.4));
  assert.equal(extruded.attributes.position.count,8);
  assert.equal(extruded.index.count/3,10,'two top triangles and boundary walls only');
  assert.equal(edgeUses(extruded).filter(n=>n===1).length,4,'base boundary remains open');
  const topFaces=[];
  for(let f=0;f<box.index.count/3;f++) {
    const ids=[box.index.getX(f*3),box.index.getX(f*3+1),box.index.getX(f*3+2)];
    if(ids.every(i=>box.attributes.position.getZ(i)>0.9)) topFaces.push(f);
  }
  assert.equal(topFaces.length,2);
  const boxExtrude=valid(G.extrudeFaces(box,topFaces,0.3));
  assert.equal(boxExtrude.index.count/3,20);
  assert(edgeUses(boxExtrude).every(n=>n===2),'extruded box stays closed');
  assert(Math.abs(volume(boxExtrude)-9.2)<1e-6,'extrusion keeps outward side winding');
  const inset=valid(G.extrudeFaces(box,topFaces,-0.3));
  assert(edgeUses(inset).every(n=>n===2),'negative extrusion stays closed');
  assert(Math.abs(volume(inset)-6.8)<1e-6,'negative extrusion preserves consistent winding');
  function materialAt(g,face) {
    const group=g.groups.find(group=>face*3>=group.start && face*3<group.start+group.count);
    return group ? group.materialIndex : 0;
  }
  for(let f=0;f<box.index.count/3;f++) assert.equal(materialAt(boxExtrude,f),materialAt(box,f),'original and extruded top faces retain materials');
  for(let f=box.index.count/3;f<boxExtrude.index.count/3;f++) assert.equal(materialAt(boxExtrude,f),materialAt(box,topFaces[0]),'side walls inherit the selected material');
  const hole=valid(G.deleteFaces(box,topFaces));
  assert.equal(hole.index.count/3,10);
  assert.equal(edgeUses(hole).filter(n=>n===1).length,4);
  const empty=valid(G.deleteFaces(plane,[0,1]));
  assert.equal(empty.attributes.position.count,0);
  assert.equal(empty.index.count,0);
  const sourceJSON=JSON.stringify(G.serialize(box));
  for(const node of [
    {type:'transform',params:{x:2,ry:45,sx:2}},
    {type:'transform',params:{sx:-1}},
    {type:'twist',params:{angle:120}},
    {type:'noise',params:{amount:0.2,scale:3,seed:42}},
    {type:'smooth',params:{iterations:2,strength:0.2}},
    {type:'subdivide',params:{level:2}},
    {type:'spherize',params:{amount:0.5,radius:1}},
    {type:'array',params:{count:4,axis:'x',spacing:3}}
  ]) { valid(G.applyNode(box,node)); valid(G.applyNode(empty,node)); }
  assert.deepEqual(G.serialize(G.deserialize(G.serialize(empty))),G.serialize(empty),'empty geometry persists with finite bounds');
  assert(Math.abs(volume(G.applyNode(box,{type:'transform',params:{sx:-1}}))-8)<1e-8,'mirrored transform keeps outward winding');
  assert.equal(JSON.stringify(G.serialize(box)),sourceJSON,'node evaluation never mutates its input');
  const noiseA=G.applyNode(split,{type:'noise',params:{seed:42}});
  const noiseB=G.applyNode(split,{type:'noise',params:{seed:42}});
  assert.deepEqual(noiseA.attributes.position.array,noiseB.attributes.position.array,'noise is deterministic');
  const noiseC=G.applyNode(split,{type:'noise',params:{seed:43}});
  assert.notDeepEqual(noiseA.attributes.position.array,noiseC.attributes.position.array);
  const subdividedPlane=G.subdivide(plane), smoothedPlane=G.applyNode(subdividedPlane,{type:'smooth'});
  function sortedVertices(g) { const p=g.attributes.position; return Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].join(',')).sort(); }
  assert.deepEqual(sortedVertices(smoothedPlane),sortedVertices(subdividedPlane),'plane boundaries and symmetric center are preserved');
  const sphere=G.applyNode(split,{type:'spherize',params:{amount:1,radius:2}});
  const sp=sphere.attributes.position;
  for(let i=0;i<sp.count;i++) assert(Math.abs(Math.hypot(sp.getX(i),sp.getY(i),sp.getZ(i))-2)<1e-6);
  assert.deepEqual(G.serialize(G.deserialize(G.serialize(boxExtrude))),G.serialize(boxExtrude),'geometry persistence round trips exactly');
  assert.deepEqual(G.serialize(G.deserialize(G.serialize(split))),G.serialize(split),'subdivided vertex IDs survive persistence and undo');
  const painted=plane.clone();
  const paint=[];
  for(let i=0;i<painted.attributes.position.count;i++) paint.push((painted.attributes.position.getX(i)+1)/2,(painted.attributes.position.getY(i)+1)/2,.25);
  painted.setAttribute('color',new T.Float32BufferAttribute(paint,3));
  const authoredNormals=new Float32Array(painted.attributes.position.count*3);
  for(let i=0;i<authoredNormals.length;i+=3) { authoredNormals[i]=.3;authoredNormals[i+1]=.4;authoredNormals[i+2]=.5; }
  painted.setAttribute('normal',new T.Float32BufferAttribute(authoredNormals,3));
  assert.deepEqual(G.serialize(G.deserialize(G.serialize(painted))),G.serialize(painted),'vertex colors and authored normals persist exactly');
  const paintSplit=G.subdivide(painted);
  for(let i=0;i<paintSplit.attributes.position.count;i++) {
    const pos=paintSplit.attributes.position,color=paintSplit.attributes.color;
    assert.equal(color.getX(i),(pos.getX(i)+1)/2,'new midpoint colors interpolate');
    assert.equal(color.getY(i),(pos.getY(i)+1)/2);
    assert.equal(color.getZ(i),.25);
  }
  for(const operation of [g=>G.extrudeFaces(g,[0,1],.3),g=>G.deleteFaces(g,[0]),g=>G.applyNode(g,{type:'array',params:{count:2}}),g=>G.applyNode(g,{type:'smooth'})]) {
    const result=operation(painted);valid(result);
    assert.equal(result.attributes.color.count,result.attributes.position.count,'color attributes follow topology');
  }
  const bytePaint=painted.clone();
  bytePaint.setAttribute('color',new T.Uint8BufferAttribute([255,128,0, 0,255,64, 128,0,255, 64,128,255],3,true));
  const byteSaved=G.deserialize(G.serialize(bytePaint));
  assert.equal(byteSaved.attributes.color.getX(0),1);
  assert(Math.abs(byteSaved.attributes.color.getY(0)-128/255)<1e-7,'normalized byte colors retain intensity');
  const rgba=painted.clone();rgba.setAttribute('color',new T.Float32BufferAttribute(Array.from({length:4},()=>[1,.5,.25,.8]).flat(),4));
  assert.deepEqual(G.serialize(G.deserialize(G.serialize(rgba))),G.serialize(rgba),'RGBA vertex colors persist');
  const seamed=new T.BoxGeometry(2,2,2,1,1,1), seamUV=seamed.attributes.uv.array.slice(), seamNormal=seamed.attributes.normal.array.slice();
  seamed.setAttribute('color',new T.Float32BufferAttribute(Array.from({length:seamed.attributes.position.count},()=>[.2,.4,.6]).flat(),3));
  for(const node of [{type:'transform',params:{x:1}},{type:'twist',params:{angle:35}},{type:'noise',params:{amount:.1}},{type:'spherize',params:{amount:.25}}]) {
    const result=G.applyNode(seamed,node);valid(result);
    assert.equal(result.attributes.position.count,24,node.type+' preserves seam vertices');
    assert.deepEqual(result.attributes.uv.array,seamUV,node.type+' preserves UV seams');
    assert.deepEqual(result.attributes.color.array,seamed.attributes.color.array,node.type+' preserves color attributes');
    if(node.type==='transform') assert.deepEqual(result.attributes.normal.array,seamNormal,'translation preserves authored normals');
  }
  const raw=seamed.toNonIndexed(), mirrored=G.applyNode(raw,{type:'transform',params:{sx:-1}});
  assert.equal(mirrored.index,null,'mirrored non-indexed mesh keeps topology');
  const mi=mirrored.clone();mi.setIndex(Array.from({length:mi.attributes.position.count},(_,i)=>i));
  assert(Math.abs(volume(mi)-8)<1e-8,'mirrored non-indexed mesh keeps outward winding');
  assert.throws(()=>G.applyNode(G.primitive('box',8),{type:'subdivide',params:{level:5}}),/limit/);
  assert.throws(()=>G.applyNode(box,{type:'noise',params:{amount:Infinity}}),/between/);
  assert.throws(()=>G.applyNode(box,{type:'transform',params:{sx:0}}),/collapse/);
  assert.throws(()=>G.deleteFaces(box,[-1]),/between/);
  assert.throws(()=>G.extrudeFaces(box,Array.from({length:12},(_,i)=>i),0.2),/direction/);
  assert.throws(()=>G.deserialize({positions:[NaN,0,0],indices:[0,0,0]}),/vertex/);
  assert.throws(()=>G.deserialize({positions:[0,0,0],indices:[0,1,2]}),/between/);
  assert.throws(()=>G.deserialize({positions:[0,0,0],indices:[0,0,0],color:[1,2]}),/colors/);
  assert.throws(()=>G.deserialize({positions:[0,0,0],indices:[0,0,0],normal:[1,2]}),/normals/);
  console.log('TweenPose geometry checks passed (THREE '+T.REVISION+'): primitives, welding, manifold subdivision/extrusion, deletion, nodes, persistence, bounds.');
})().catch(error=>{ console.error(error); process.exitCode=1; });
