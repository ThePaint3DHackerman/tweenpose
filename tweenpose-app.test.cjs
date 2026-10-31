/* Headless application integration tests. No browser or WebGL context is launched.
 * Run: node tweenpose-app.test.cjs [path/to/three.core.js-or-commonjs]
 * Defaults to the exact THREE r128 application dependency. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function makeDOM(source) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.attributes = {}; this.dataset = {}; this.listeners = {}; this.listenerCaptures = {}; this.style = {setProperty(k,v){this[k]=String(v)},getPropertyValue(k){return this[k]||''}};
      this._value = ''; this._text = ''; this.width = 250; this.height = 230;
      this.checked = false; this.disabled = false; this.hidden = false;
      this.classList = {
        contains: c => this.className.split(/\s+/).includes(c),
        add: (...cs) => this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...cs])].join(' '),
        remove: (...cs) => this.className = this.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '),
        toggle: (c,force) => { const on=force===undefined?!this.classList.contains(c):!!force; this.classList[on?'add':'remove'](c); return on; }
      };
    }
    get id(){ return this.attributes.id||''; } set id(v){this.attributes.id=String(v)}
    get className(){return this.attributes.class||''} set className(v){this.attributes.class=String(v)}
    get value(){if(this.tagName==='SELECT'&&!this._value){const opts=this.querySelectorAll('option');return (opts.find(o=>o.selected)||opts[0])?.value||''}return this._value}
    set value(v){this._value=String(v)}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
    set textContent(v){this.children.forEach(c=>c.parentNode=null);this.children=[];this._text=String(v)}
    get innerHTML(){return this._html||''}
    set innerHTML(v){this.children.forEach(c=>c.parentNode=null);this.children=[];this._text='';this._html=String(v);parse(this._html,this)}
    get lastChild(){return this.children.at(-1)||null}
    get firstChild(){return this.children[0]||null}
    get parentElement(){return this.parentNode}
    get childNodes(){return this.children}
    get options(){return this.querySelectorAll('option')}
    setAttribute(k,v){this.attributes[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);if(['value','min','max','step','type','title','width','height'].includes(k))this[k]=String(v);if(['checked','disabled','hidden','selected'].includes(k))this[k]=true}
    getAttribute(k){return this.attributes[k]??null}
    removeAttribute(k){delete this.attributes[k];if(['checked','disabled','hidden','selected'].includes(k))this[k]=false}
    appendChild(child){if(child.parentNode)child.remove();this.children.push(child);child.parentNode=this;return child}
    append(...children){for(const c of children)this.appendChild(typeof c==='string'?Object.assign(new Element('text'),{textContent:c}):c)}
    prepend(child){if(child.parentNode)child.remove();this.children.unshift(child);child.parentNode=this}
    insertBefore(child,before){if(!before)return this.appendChild(child);if(child.parentNode)child.remove();const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,child);child.parentNode=this}
    replaceChildren(...children){this.textContent='';this.append(...children)}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null}}
    contains(child){return child===this||this.children.some(c=>c.contains(child))}
    matches(selector){return selector.split(',').some(sel=>matchChain(this,sel.trim().split(/\s+(?![^\[]*\])/)))}
    querySelectorAll(selector){const out=[];const visit=n=>{for(const c of n.children){if(c.matches(selector))out.push(c);visit(c)}};visit(this);return out}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    closest(selector){let p=this;while(p){if(p.matches(selector))return p;p=p.parentNode}return null}
    addEventListener(type,fn,options){(this.listeners[type]||=([])).push(fn);(this.listenerCaptures[type]||=new Map()).set(fn,options===true||!!options?.capture)}
    removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);this.listenerCaptures[type]?.delete(fn)}
    dispatchEvent(event){
      event.target||=(this);event.currentTarget=this;event.preventDefault||=()=>{event.defaultPrevented=true};event.stopPropagation||=()=>{};
      let immediate=false;const stop=event.stopImmediatePropagation;
      event.stopImmediatePropagation=()=>{immediate=true;stop?.call(event)};
      const list=this.listeners[event.type]||[],capture=this.listenerCaptures[event.type];
      for(const fn of [...list.filter(fn=>capture?.get(fn)),...list.filter(fn=>!capture?.get(fn))]){fn.call(this,event);if(immediate)break;}
      if(!immediate)this['on'+event.type]?.call(this,event);return !event.defaultPrevented;
    }
    click(){if(!this.disabled)this.dispatchEvent({type:'click'})}
    focus(){document.activeElement=this}
    blur(){document.activeElement=document.body}
    setPointerCapture(){} releasePointerCapture(){} hasPointerCapture(){return false}
    getBoundingClientRect(){return {left:0,top:0,width:960,height:640,right:960,bottom:640}}
    getContext(){return canvasContext}
    toBlob(fn){fn(new Blob(['mock png'],{type:'image/png'}))}
    toDataURL(){return 'data:image/png;base64,'}
    scrollIntoView(){}
  }
  function matchSimple(el,selector){
    if(!selector)return false;
    const tag=selector.match(/^[\w-]+/);if(tag&&tag[0].toUpperCase()!==el.tagName)return false;
    for(const id of selector.matchAll(/#([\w-]+)/g))if(el.id!==id[1])return false;
    for(const cls of selector.matchAll(/\.([\w-]+)/g))if(!el.classList.contains(cls[1]))return false;
    for(const attr of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)){const value=el.getAttribute(attr[1]);if(value===null||attr[2]!==undefined&&value!==attr[2])return false}
    if(selector.includes(':checked')&&!el.checked)return false;
    return true;
  }
  function matchChain(el,chain){if(!matchSimple(el,chain.at(-1)))return false;if(chain.length===1)return true;let p=el.parentNode;while(p){if(matchChain(p,chain.slice(0,-1)))return true;p=p.parentNode}return false}
  function parse(fragment,parent){
    const stack=[parent], tokens=fragment.replace(/<!--[\s\S]*?-->/g,'').match(/<[^>]+>|[^<]+/g)||[];
    for(const token of tokens){
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue}
      if(token.startsWith('<!'))continue;
      if(token.startsWith('<')){
        const tag=token.match(/^<\s*([\w-]+)/)?.[1];if(!tag)continue;
        const el=new Element(tag),attrs=token.slice(token.indexOf(tag)+tag.length,token.length-1);
        for(const a of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))el.setAttribute(a[1],a[2]??a[3]??a[4]??'');
        stack.at(-1).appendChild(el);if(!voidTags.has(tag.toLowerCase())&&!token.endsWith('/>'))stack.push(el);
      }else stack.at(-1)._text+=token;
    }
  }
  const gradient={addColorStop(){}};
  const canvasContext=new Proxy({measureText:s=>({width:String(s).length*7}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,getImageData:()=>({data:new Uint8ClampedArray(4)})},{get:(target,key)=>key in target?target[key]:(()=>{})});
  document=new Element('document');document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.createTextNode=text=>{const node=new Element('text');node.textContent=text;return node;};document.title='TweenPose Studio';
  parse(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),document);
  document.documentElement=document.querySelector('html');document.head=document.querySelector('head');document.body=document.querySelector('body');document.activeElement=document.body;
  return document;
}

async function createApp(THREECore, overrides={}, options={}) {
  const source=options.html||html, sourceRoot=options.root||ROOT;
  const document=makeDOM(source), timers=new Map(), animationFrames=new Map();let timerId=0,rafId=0,clock=100;
  class Renderer {constructor({canvas}){this.domElement=canvas;this.shadowMap={enabled:false,type:THREECore.PCFShadowMap}}setPixelRatio(){}setClearColor(){}setSize(w,h){this.domElement.width=w;this.domElement.height=h}render(){}}
  class OrbitControls {constructor(camera){this.enabled=true;this.object=camera;this.target=new THREECore.Vector3()}update(){this.object.lookAt(this.target);this.object.updateMatrixWorld()}addEventListener(){}dispose(){}}
  class TransformControls extends THREECore.Object3D {constructor(){super();this.space='local';this.mode='translate';this.enabled=true}setSize(){}setSpace(s){this.space=s}setMode(m){this.mode=m}setTranslationSnap(v){this.translationSnap=v}setRotationSnap(v){this.rotationSnap=v}setScaleSnap(v){this.scaleSnap=v}attach(o){this.object=o;return this}detach(){this.object=undefined;return this}getMode(){return this.mode}getSpace(){return this.space}}
  const storage=new Map(), eventListeners={};
  const context={console,THREE:{...THREECore,WebGLRenderer:Renderer,OrbitControls,TransformControls},document,devicePixelRatio:1,
    performance:{now:()=>clock},requestAnimationFrame:fn=>{animationFrames.set(++rafId,fn);return rafId},cancelAnimationFrame:id=>animationFrames.delete(id),
    ResizeObserver:class {constructor(cb){this.cb=cb}observe(){}disconnect(){}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},
    getComputedStyle:el=>({getPropertyValue:k=>el.style.getPropertyValue(k)||({'--bd':'#dddddd','--mu':'#777777','--ac':'#7755ff','--lw':'230px','--rw':'260px','--fh':'230px'}[k]||'')}),
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    addEventListener:(type,fn)=>(eventListeners[type]||=[]).push(fn),removeEventListener(){},
    URL,Blob,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Float64Array,DataView,ArrayBuffer,Event:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}preventDefault(){this.defaultPrevented=true;}stopPropagation(){}},
    navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,alert(){},matchMedia:()=>({matches:false,addEventListener(){}}),
    JSZip:class {file(){}async generateAsync(){return new Blob()}},
  };
  Object.assign(context,overrides);context.window=context;context.globalThis=context;vm.createContext(context);
  for(const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    const src=script[1].match(/\bsrc=["']([^"']+)["']/)?.[1];
    if(src&&(options.skipExternalScripts!==false||/^https?:/.test(src)))continue;
    const code=src?fs.readFileSync(path.join(sourceRoot,src),'utf8'):script[2];
    vm.runInContext(code,context,{filename:src||'index.html:inline',timeout:20000});
  }
  return {context,document,run:code=>vm.runInContext(code,context,{timeout:20000}),stepAnimation(ms=16){clock+=ms;const callbacks=[...animationFrames.values()];animationFrames.clear();callbacks.forEach(fn=>fn(clock));},flush(max=30){for(let i=0;i<max&&timers.size;i++){const [id,timer]=timers.entries().next().value;timers.delete(id);if(timer.ms<1000)timer.fn()}},click(id){const el=document.querySelector('#'+id);assert(el,`Missing #${id}`);el.click()},change(id,value){const el=document.querySelector('#'+id);assert(el,`Missing #${id}`);el.value=value;el.dispatchEvent({type:'change'})}};
}

module.exports={createApp,makeDOM};
if(require.main===module)(async()=>{
  const runtime=process.argv[2]||path.join(ROOT,'tweenpose-tests','three-r128.cjs');
  const THREECore=runtime.endsWith('.cjs')?require(path.resolve(runtime)):await import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(runtime)).toString('base64'));
  const app=await createApp(THREECore), {run}=app;
  assert.equal(run('parts.length'),0,'initial empty scene initializes');
  assert.equal(app.document.querySelectorAll('#sls .sl').length,9,'original transform sliders initialize');
  assert.equal(app.document.querySelectorAll('#pvs .sl').length,3,'original rig sliders initialize');
  assert.equal(app.document.querySelectorAll('#phs .sl').length,7,'original physics sliders initialize');
  if(run('typeof GeometryEditor')==='undefined')throw new Error('GeometryEditor has not been loaded by index.html. Initialization passed; editor integration still required.');
  console.log('PASS: original application initialization with mocked rendering');
  const failures=[];
  async function test(name,fn){try{await fn(await createApp(THREECore));console.log('PASS: '+name)}catch(error){failures.push({name,error});console.error('FAIL: '+name+'\n'+error.stack)}}
  function checkGeometry(a,expr='parts[sel].mesh.geometry'){
    assert(a.run(`(()=>{const g=${expr};return !!g.index&&g.index.count>0&&Array.from(g.attributes.position.array).every(Number.isFinite)&&Array.from(g.attributes.normal.array).every(Number.isFinite)&&Array.from(g.index.array).every(i=>i>=0&&i<g.attributes.position.count)})()`),'finite indexed geometry');
  }
  function add(a,shape='box',detail){a.change('geo-add-shape',shape);a.click('geo-add');if(detail!==undefined){a.change('geo-segments',detail);a.click('geo-replace')}checkGeometry(a)}
  function geometryJSON(a,expr='parts[sel].mesh.geometry'){return a.run(`JSON.stringify(TweenGeometry.serialize(${expr}))`)}
  function event(a,selector,type,value){const el=a.document.querySelector(selector);assert(el,'Missing '+selector);if(value!==undefined)el.value=value;el.dispatchEvent({type});return el}

  await test('all primitive types, detail replacement and per-action undo/redo',a=>{
    for(const shape of ['box','sphere','cylinder','cone','torus','plane','icosphere']){
      add(a,shape);assert.equal(a.run('parts[sel].geom.shape'),shape);
      assert(a.run('keys.every(k=>k.p.length===parts.length)'), 'all keyframe poses include new parts');
      a.run('evalAt(12)');
    }
    assert.equal(a.run('parts.length'),8);
    a.run('commit();doUndo()');assert.equal(a.run('parts.length'),7,'undo removes added shape');
    a.run('doRedo()');assert.equal(a.run('parts.length'),8,'redo recreates shape');
    a.run('selPart(1)');const before=a.run('parts[1].geom.base.attributes.position.count');
    a.change('geo-shape','sphere');a.change('geo-segments',6);a.click('geo-replace');
    assert.equal(a.run('parts[1].geom.shape'),'sphere');assert.equal(a.run('parts[1].geom.segments'),6);
    assert(a.run('parts[1].geom.base.attributes.position.count')>before);checkGeometry(a,'parts[1].mesh.geometry');
    a.run('doUndo()');assert.equal(a.run('parts[1].geom.shape'),'box');
    a.run('doRedo()');assert.equal(a.run('parts[1].geom.shape'),'sphere');
  });

  await test('node controls, bypass, reorder, removal and bake preserve output',a=>{
    add(a,'box',1);a.change('geo-node-type','transform');a.click('geo-add-node');
    event(a,'[aria-label="Transform Move X"]','change',2);
    assert.equal(a.run('parts[sel].mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x'),2);
    a.change('geo-node-type','spherize');a.click('geo-add-node');
    event(a,'[aria-label="Spherize Amount"]','change',1);
    const first=geometryJSON(a);
    const bypass=a.document.querySelector('[aria-label="Enable Spherize"]');bypass.checked=false;bypass.dispatchEvent({type:'change'});
    assert.equal(a.run('parts[sel].geom.nodes[1].enabled'),false);
    assert.equal(a.run('parts[sel].mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x'),2);
    const enable=a.document.querySelector('[aria-label="Enable Spherize"]');enable.checked=true;enable.dispatchEvent({type:'change'});
    a.document.querySelector('[aria-label="Move node left 2"]').click();
    assert.equal(a.run('parts[sel].geom.nodes[0].type'),'spherize');assert.notEqual(geometryJSON(a),first,'noncommutative node order changes output');
    a.document.querySelector('[aria-label="Remove node 1"]').click();assert.equal(a.run('parts[sel].geom.nodes.length'),1);
    a.run('doUndo()');assert.equal(a.run('parts[sel].geom.nodes.length'),2);
    a.run('doRedo()');assert.equal(a.run('parts[sel].geom.nodes.length'),1);
    const baked=geometryJSON(a);a.click('geo-bake');assert.equal(a.run('parts[sel].geom.nodes.length'),0);assert.equal(geometryJSON(a),baked);
    checkGeometry(a);
    for(const type of ['subdivide','twist','noise','smooth','array']){a.run(`GeometryEditor.addNode(${JSON.stringify(type)})`);checkGeometry(a)}
  });

  await test('vertex/edge/face selections, numeric edits, topology operations and history',a=>{
    add(a,'box',1);a.change('geo-mode','edit');assert.equal(a.run('GeometryEditor.isEditing()'),true);
    a.click('geo-select-all');assert.equal(a.run('GeometryEditor.state.selected.size'),8);
    a.change('geo-x',.75);assert(Math.abs(a.run('parts[sel].geom.base.boundingBox.getCenter(new THREE.Vector3()).x')-.75)<1e-6);
    a.change('geo-component','edge');a.run('GeometryEditor.state.selected.add(0);GeometryEditor.sync()');
    const prior=a.run('Array.from(parts[sel].geom.base.attributes.position.array)');
    a.change('geo-y',.8);const moved=a.run('Array.from(parts[sel].geom.base.attributes.position.array)');
    assert(moved.some((v,i)=>v!==prior[i]));assert(moved.filter((v,i)=>v!==prior[i]).length<=2,'only selected edge endpoints move');
    a.change('geo-component','face');a.run('GeometryEditor.state.selected.add(0);GeometryEditor.sync()');
    const faces=a.run('parts[sel].geom.base.index.count/3');a.click('geo-extrude');
    assert(a.run('parts[sel].geom.base.index.count/3')>faces);checkGeometry(a);
    const extruded=geometryJSON(a,'parts[sel].geom.base');a.run('doUndo()');assert.equal(a.run('parts[sel].geom.base.index.count/3'),faces);
    a.run('doRedo()');assert.equal(geometryJSON(a,'parts[sel].geom.base'),extruded);
    a.change('geo-mode','edit');a.change('geo-component','face');a.run('GeometryEditor.state.selected.add(0);GeometryEditor.sync()');
    const beforeDelete=a.run('parts[sel].geom.base.index.count');a.click('geo-delete');assert.equal(a.run('parts[sel].geom.base.index.count'),beforeDelete-3);
    const beforeSubdivide=a.run('parts[sel].geom.base.index.count');a.click('geo-subdivide');assert.equal(a.run('parts[sel].geom.base.index.count'),beforeSubdivide*4);checkGeometry(a);
  });

  await test('topology gizmo dispatch commits mesh deformation and undo',a=>{
    add(a,'plane',1);a.change('geo-mode','edit');a.click('geo-select-all');
    const before=geometryJSON(a,'parts[sel].geom.base');
    a.run("tc.dispatchEvent({type:'dragging-changed',value:true});tc.object.position.z+=.6;tc.dispatchEvent({type:'objectChange'});tc.dispatchEvent({type:'dragging-changed',value:false})");
    assert(Math.abs(a.run('parts[sel].geom.base.boundingBox.getCenter(new THREE.Vector3()).z')-.6)<1e-6);
    assert.notEqual(geometryJSON(a,'parts[sel].geom.base'),before);a.run('doUndo()');assert.equal(geometryJSON(a,'parts[sel].geom.base'),before);
  });

  await test('canvas picking selects vertices, edges and faces with real ray math',a=>{
    add(a,'box',1);a.change('geo-mode','edit');
    a.run('cam.updateMatrixWorld(true);root.updateMatrixWorld(true)');
    const point=a.run('(()=>{const p=parts[sel],v=new THREE.Vector3().fromBufferAttribute(p.geom.base.attributes.position,0).applyMatrix4(p.mesh.matrixWorld).project(cam);return {x:(v.x+1)*480,y:(1-v.y)*320}})()');
    a.run(`GeometryEditor.pick({clientX:${point.x},clientY:${point.y},shiftKey:false})`);assert.equal(a.run('GeometryEditor.state.selected.size'),1,'pick vertex');
    a.change('geo-component','edge');
    const midpoint=a.run('(()=>{const p=parts[sel],e=GeometryEditor.state.edges[0],v=new THREE.Vector3().fromBufferAttribute(p.geom.base.attributes.position,e[0]).add(new THREE.Vector3().fromBufferAttribute(p.geom.base.attributes.position,e[1])).multiplyScalar(.5).applyMatrix4(p.mesh.matrixWorld).project(cam);return {x:(v.x+1)*480,y:(1-v.y)*320}})()');
    a.run(`GeometryEditor.pick({clientX:${midpoint.x},clientY:${midpoint.y},shiftKey:false})`);assert.equal(a.run('GeometryEditor.state.selected.size'),1,'pick edge');
    a.change('geo-component','face');a.run('GeometryEditor.pick({clientX:480,clientY:320,shiftKey:false})');assert.equal(a.run('GeometryEditor.state.selected.size'),1,'raycast face');
    a.run('GeometryEditor.pick({clientX:2,clientY:2,shiftKey:false})');assert.equal(a.run('GeometryEditor.state.selected.size'),0,'empty click clears selection');
  });

  await test('fresh project restores topology, nodes, rig, poses and animation',async a=>{
    add(a,'plane',2);a.run("parts[sel].n='Edited sheet';parts[sel].o.position.x=.6;upsert();setFrame(10);parts[sel].o.rotation.z=.45;upsert()");
    a.change('geo-mode','edit');a.click('geo-select-all');a.change('geo-z',.3);a.change('geo-mode','object');
    a.run("GeometryEditor.addNode('noise');GeometryEditor.mutateNodes(ns=>ns[0].params.amount=.07)");
    add(a,'sphere',2);a.run('parts[2].o.position.y=.9;parts[1].o.add(parts[2].o);parts[2].rest.copy(parts[2].o.position);upsert();commit()');
    const project=a.run('JSON.stringify(projGet())'), target=await createApp(THREECore);
    target.context.testProject=JSON.parse(project);target.run('projSet(testProject)');
    assert.equal(target.run('parts.length'),3);assert.equal(target.run('parts[1].n'),'Edited sheet');
    assert.equal(target.run('parts[1].geom.nodes[0].type'),'noise');assert(target.run('parts[2].o.parent===parts[1].o'));
    assert.equal(target.run('JSON.stringify(projGet().g)'),a.run('JSON.stringify(projGet().g)'),'base geometry and node chain restore exactly');
    assert.equal(target.run('JSON.stringify(keys)'),a.run('JSON.stringify(keys)'));
    assert.equal(target.run('JSON.stringify(snap())'),a.run('JSON.stringify(snap())'),'current pose restores');
    target.run('setFrame(5)');checkGeometry(target,'parts[1].mesh.geometry');checkGeometry(target,'parts[2].mesh.geometry');
  });

  await test('cloth switches to topology editing and restores safely with history',a=>{
    add(a,'plane',2);const base=geometryJSON(a,'parts[sel].geom.base');
    const cloth=a.document.querySelector('#cl');cloth.checked=true;cloth.dispatchEvent({type:'change'});
    assert.equal(a.run('parts[sel].cl.on'),true);assert.equal(a.run('parts[sel].mesh.geometry.attributes.position.count'),169);
    a.run('evalAt(3);commit()');a.change('geo-mode','edit');assert.equal(a.run('parts[sel].cl.on'),false);
    assert.equal(geometryJSON(a,'parts[sel].geom.base'),base);checkGeometry(a);
    a.run('doUndo()');assert.equal(a.run('parts[sel].cl.on'),true,a.run("JSON.stringify({sel,u:undo.map(j=>JSON.parse(j).g?.[1]?.cl?.on),r:redo.map(j=>JSON.parse(j).g?.[1]?.cl?.on),current:JSON.parse(cur).g?.[1]?.cl,actual:{on:parts[sel].cl.on,orig:!!parts[sel].cl.orig},mode:GeometryEditor.state.mode})"));a.run('evalAt(2)');checkGeometry(a);
    a.run('doRedo()');assert.equal(a.run('parts[sel].cl.on'),false);checkGeometry(a);
  });

  await test('imported multi-material model remains renderable after replacement and editing',a=>{
    a.run("(()=>{const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),[new THREE.MeshStandardMaterial({color:0xff0000}),new THREE.MeshStandardMaterial({color:0x00ff00})]));build(model,true);selPart(1)})()");
    a.change('geo-shape','sphere');a.change('geo-segments',2);a.click('geo-replace');
    assert(a.run('parts[1].mesh.geometry.groups.length>0'));assert(a.run('parts[1].mesh.geometry.groups.every(g=>g.materialIndex<parts[1].mesh.material.length)'));
    a.change('geo-mode','edit');a.click('geo-subdivide');checkGeometry(a,'parts[1].mesh.geometry');
    a.change('wm','wire');a.run('wireSync()');assert(a.run('parts[1].wf.geometry===parts[1].mesh.geometry'));
    a.run('GeometryEditor.setExporting(true)');assert(a.run("scene.getObjectByName('Topology helpers').visible===false"));a.run('GeometryEditor.setExporting(false)');
    assert(a.run("scene.getObjectByName('Topology helpers').visible===true"));
  });

  await test('numeric and gizmo edits remain local under transforms and pivot offsets',a=>{
    add(a,'plane',1);a.run('parts[sel].o.position.set(3,2,-1);parts[sel].o.rotation.z=.75;parts[sel].o.scale.set(2,.5,1.3);parts[sel].mesh.position.set(-.35,.2,.1);root.updateMatrixWorld(true)');
    a.change('geo-mode','edit');a.click('geo-select-all');
    assert.equal(+a.document.querySelector('#geo-x').value,0,'displayed coordinates use mesh local space');
    a.change('geo-x',.25);assert.equal(+a.document.querySelector('#geo-x').value,.25);
    assert(Math.abs(a.run('parts[sel].geom.base.boundingBox.getCenter(new THREE.Vector3()).x')-.25)<1e-6);
    assert(a.run('tc.object.position.distanceTo(parts[sel].mesh.localToWorld(parts[sel].geom.base.boundingBox.getCenter(new THREE.Vector3())))<1e-6'),'gizmo anchor uses world space');
    const center=()=>a.run('parts[sel].mesh.localToWorld(parts[sel].geom.base.boundingBox.getCenter(new THREE.Vector3())).toArray()');
    const before=center();a.run("tc.dispatchEvent({type:'dragging-changed',value:true});tc.object.position.x+=.4;tc.dispatchEvent({type:'objectChange'});tc.dispatchEvent({type:'dragging-changed',value:false})");
    const after=center();assert(Math.abs(after[0]-before[0]-.4)<1e-6);assert(Math.abs(after[1]-before[1])<1e-6);checkGeometry(a);
  });

  await test('invalid shape and node parameters leave the scene and history intact',a=>{
    add(a,'box',1);const first=a.run('hsnap()'), history=a.run('undo.length');
    a.change('geo-segments',0);a.click('geo-replace');assert.equal(a.run('hsnap()'),first);assert.equal(a.run('undo.length'),history);
    assert.equal(a.run("GeometryEditor.addShape('unknown-shape')"),false);assert.equal(a.run('hsnap()'),first);
    a.run("GeometryEditor.addNode('transform')");const valid=a.run('hsnap()'), count=a.run('undo.length');
    event(a,'[aria-label="Transform Scale X"]','change',0);assert.equal(a.run('hsnap()'),valid);assert.equal(a.run('undo.length'),count);
    assert(a.document.querySelector('#toast').textContent.includes('collapse'),'invalid edit gives useful feedback');
    assert.equal(a.run('GeometryEditor.mutateNodes(ns=>ns[0].params.x=Infinity)'),false);assert.equal(a.run('hsnap()'),valid);checkGeometry(a);
  });

  await test('project material IDs cannot reuse a different project material cache',async a=>{
    add(a,'box',1);const original=a.run('parts[1].mesh.material.color.getHex()');
    const source=await createApp(THREECore);
    source.run("(()=>{const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xe32954})));build(model,true);selPart(1)})()");
    assert.equal(source.run('parts[1].geom.id'),a.run('parts[1].geom.id'),'both independent projects use the same ID');
    a.context.foreignProject=JSON.parse(source.run('JSON.stringify(projGet())'));a.run('projSet(foreignProject)');
    assert.notEqual(a.run('parts[1].mesh.material.color.getHex()'),original);assert.equal(a.run('parts[1].mesh.material.color.getHex()'),0xe32954);
  });

  await test('enabling cloth exits topology editing and restores valid simulation',a=>{
    add(a,'plane',2);a.change('geo-mode','edit');a.click('geo-select-all');
    const cl=a.document.querySelector('#cl');cl.checked=true;cl.dispatchEvent({type:'change'});
    assert.equal(a.run('GeometryEditor.isEditing()'),false);assert.equal(a.run('parts[sel].cl.on'),true);
    assert.equal(a.run('parts[sel].mesh.geometry.attributes.position.count'),169);a.run('evalAt(4)');checkGeometry(a);
  });

  await test('playback exits edit mode and mutations stop playback',a=>{
    add(a,'box',1);a.run("GeometryEditor.addNode('transform');GeometryEditor.mutateNodes(ns=>ns[0].params.x=.5)");
    a.change('geo-mode','edit');a.click('play');assert.equal(a.run('playing'),true);assert.equal(a.run('GeometryEditor.isEditing()'),false);
    assert.equal(a.run('tc.visible'),false);assert.equal(a.run('parts[sel].mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x'),.5);
    a.run("GeometryEditor.addNode('noise')");assert.equal(a.run('playing'),false);assert.equal(a.run('tc.visible'),true);
    a.click('play');a.run("GeometryEditor.addShape('sphere')");assert.equal(a.run('playing'),false);assert.equal(a.run('parts.length'),3);
    a.click('play');a.run('projSet(projGet())');assert.equal(a.run('playing'),false);
  });

  async function exportSetup(a){
    add(a,'box',1);a.run("GeometryEditor.addNode('transform');GeometryEditor.mutateNodes(ns=>ns[0].params.x=.7);$('#tot').value=2;setFrame(1);upsert();setFrame(0)");
    a.change('geo-mode','edit');a.click('geo-select-all');a.change('wm','both');
    a.run("exportFrames=[];ren.render=()=>exportFrames.push({center:parts[sel].mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x,helper:scene.getObjectByName('Topology helpers').visible,pivot:piv.visible,handles:tc.visible,mode:$('#wm').value,locked:document.querySelector('main').inert})");
  }
  function restoredExportState(a){
    assert.equal(a.run('GeometryEditor.isEditing()'),true);assert.equal(a.run('GeometryEditor.state.exporting'),false);assert.equal(a.run('exportBusy'),false);
    assert.equal(a.run("scene.getObjectByName('Topology helpers').visible"),true);assert.equal(a.run('tc.visible'),true);assert.equal(a.run('piv.visible'),false);
    assert.equal(a.document.querySelector('#wm').value,'both');assert.equal(a.document.querySelector('#exp').disabled,false);assert.equal(a.document.querySelector('main').inert,false);
    assert(Math.abs(a.run('parts[sel].mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x'))<1e-6,'edit cage returns after export');
  }
  await test('PNG export renders node output, hides helpers, then restores edit cage',async a=>{
    await exportSetup(a);await a.run("$('#exp').onclick()");
    assert.equal(a.run('exportFrames.length'),2);
    assert(a.run("exportFrames.every(f=>Math.abs(f.center-.7)<1e-6&&!f.helper&&!f.pivot&&!f.handles&&f.mode==='solid'&&f.locked)"));restoredExportState(a);
  });
  await test('GIF export and missing encoder restore helpers and edit state',async a=>{
    await exportSetup(a);await a.run("$('#gif').onclick()");assert(a.document.querySelector('#toast').textContent.includes('GIF export failed'));restoredExportState(a);
    a.run('exports={GIFEncoder:()=>({writeFrame(){},finish(){},bytes:()=>new Uint8Array([1])}),quantize:()=>[[0,0,0,0]],applyPalette:()=>new Uint8Array([0])}');
    await a.run("$('#gif').onclick()");assert.equal(a.run('exportFrames.length'),2);assert(a.run('exportFrames.every(f=>!f.helper&&!f.handles&&Math.abs(f.center-.7)<1e-6)'));restoredExportState(a);
  });
  await test('PNG renderer failures restore helpers, controls and export lock',async a=>{
    await exportSetup(a);a.run("ren.render=()=>{throw new Error('Injected renderer failure')}");await a.run("$('#exp').onclick()");
    assert(a.document.querySelector('#toast').textContent.includes('Injected renderer failure'));restoredExportState(a);
  });

  await test('invalid restore metadata, cyclic parents and geometry fail before scene mutation',a=>{
    add(a,'box',1);add(a,'sphere',2);a.change('geo-mode','edit');a.click('geo-select-all');
    const valid=JSON.parse(a.run('JSON.stringify(GeometryEditor.capture())')), before=a.run('hsnap()');
    a.run('existingMesh=parts[1].mesh;existingDisposals=0;existingMesh.geometry.addEventListener("dispose",()=>existingDisposals++);existingMesh.userData.marker="preserved"');
    const corruptions=[
      ['null list',()=>null],
      ['invalid name',r=>{r[1].n=null;return r}],
      ['invalid root flag',r=>{r[1].root=true;return r}],
      ['invalid rest',r=>{r[1].rest=[0,NaN,0];return r}],
      ['invalid offset',r=>{r[1].offset=[0,Infinity,0];return r}],
      ['duplicate ID',r=>{r[2].id=r[1].id;return r}],
      ['self parent',r=>{r[1].parent=1;return r}],
      ['out of range parent',r=>{r[1].parent=99;return r}],
      ['cyclic parents',r=>{r[1].parent=2;r[2].parent=1;return r}],
      ['unknown node',r=>{r[1].nodes=[{type:'unknown',params:{}}];return r}],
      ['oversized chain',r=>{r[1].nodes=Array.from({length:17},()=>({type:'noise',params:{}}));return r}],
      ['external material image',r=>{r[1].material[0].map='https://example.com/image.png';return r}],
      ['invalid second geometry',r=>{r[2].base.indices[0]=999999;return r}],
      ['invalid second node parameters',r=>{r[2].nodes=[{type:'transform',params:{sx:0}}];return r}]
    ];
    for(const [label,corrupt] of corruptions){
      a.context.invalidRecords=corrupt(JSON.parse(JSON.stringify(valid)));
      assert.throws(()=>a.run('GeometryEditor.restoreScene(invalidRecords)'),undefined,label+' is rejected');
      assert.equal(a.run('hsnap()'),before,label+' preserves existing model');
      assert.equal(a.run('parts[1].mesh===existingMesh&&existingMesh.userData.marker==="preserved"'),true);
      assert.equal(a.run('existingDisposals'),0,label+' does not dispose live geometry');
      assert.equal(a.run('GeometryEditor.isEditing()'),true,label+' preserves workspace mode');
    }
  });

  await test('frame camera contains transformed array geometry at wide and narrow aspects',a=>{
    add(a,'box',1);a.run("GeometryEditor.addNode('array');GeometryEditor.mutateNodes(ns=>Object.assign(ns[0].params,{count:12,spacing:8,axis:'x'}));parts[sel].o.position.set(15,-2,3);parts[sel].o.rotation.z=.4;parts[sel].o.scale.set(2,1.5,1);root.updateMatrixWorld(true)");
    for(const aspect of [1.5,.4]){
      a.run(`cam.aspect=${aspect};cam.updateProjectionMatrix()`);a.click('geo-focus');
      assert(a.run('ctl.target.distanceTo(new THREE.Box3().setFromObject(parts[sel].mesh).getCenter(new THREE.Vector3()))<1e-6'));
      assert(a.run('(()=>{const b=new THREE.Box3().setFromObject(parts[sel].mesh);cam.updateMatrixWorld(true);return [b.min.x,b.max.x].every(x=>[b.min.y,b.max.y].every(y=>[b.min.z,b.max.z].every(z=>{const v=new THREE.Vector3(x,y,z).project(cam);return Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z>-1&&v.z<1})))})()'),'all output bounds fit camera at aspect '+aspect);
      assert(a.run('cam.far>100'),'far plane expands for large output');
    }
  });

  await test('custom source controls and node-panel scroll survive updates',a=>{
    add(a,'box',1);a.change('geo-mode','edit');a.click('geo-subdivide');
    assert.equal(a.run('parts[sel].geom.shape'),'custom');assert.equal(a.document.querySelector('#geo-replace').disabled,true);assert.equal(a.document.querySelector('#geo-segments').disabled,true);
    const custom=geometryJSON(a,'parts[sel].geom.base');a.click('geo-replace');assert.equal(geometryJSON(a,'parts[sel].geom.base'),custom);
    a.change('geo-shape','plane');assert.equal(a.document.querySelector('#geo-replace').disabled,false);assert.equal(a.document.querySelector('#geo-segments').disabled,false);
    a.change('geo-segments',2);a.click('geo-replace');assert.equal(a.run('parts[sel].geom.shape'),'plane');
    a.run("GeometryEditor.addNode('noise')");const chain=a.document.querySelector('#geo-node-chain');chain.scrollLeft=340;
    event(a,'[aria-label="Noise Amount"]','change',.2);assert.equal(chain.scrollLeft,340,'node updates preserve scroll position');
  });
  if(failures.length)throw new Error(`${failures.length} integration test(s) failed: ${failures.map(f=>f.name).join('; ')}`);
  console.log('All TweenPose integration scenarios passed (no browser, mocked rendering).');
})().catch(error=>{console.error(error);process.exitCode=1});
