/* Face artwork is a textured scene part. Animation data stays plain and portable;
   textures, crossfade meshes and evaluated values live outside saved projects. */
const TweenFaces = (() => {
  'use strict';
  const MAX_EXPRESSIONS = 64, MAX_SIDE = 2048, PIXEL_BUDGET = 16 * 1024 * 1024;
  const MAX_SOURCE_BYTES = 32 * 1024 * 1024, IDENTITY = [0,0,0,0,0,0,1,1,1];
  const EASE = [.42,0,.58,1], textures = new Map(), textureLoads = new Map();
  let renderStates = new WeakMap(), uid = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const isFace = (p = parts[sel]) => !!(p?.mesh && p.face);
  const selected = () => isFace(parts[sel]) ? parts[sel] : null;
  const number = (n, min, max, label) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error('Invalid ' + label + '.');
    return n;
  };
  function pose(a) {
    if (!Array.isArray(a) || a.length !== 9) throw new Error('Face transforms need nine values.');
    return a.map((n,i) => number(n, i > 5 ? .000001 : -1000000, i > 5 ? 10000 : 1000000, 'face transform'));
  }
  function easing(e = EASE) {
    if (!Array.isArray(e) || e.length !== 4) throw new Error('Face easing needs four curve values.');
    return e.map((n,i) => number(n, i % 2 ? -4 : 0, i % 2 ? 4 : 1, 'face easing'));
  }
  function expressionList(list) {
    if (!Array.isArray(list) || !list.length || list.length > MAX_EXPRESSIONS) throw new Error('Use between 1 and 64 face drawings.');
    const ids = new Set(); let pixels = 0, bytes = 0;
    return list.map((ex,i) => {
      if (!ex || typeof ex.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(ex.src)) throw new Error('Face drawings must be embedded PNG, JPEG or WebP images.');
      const width = number(ex.width,1,MAX_SIDE,'drawing width'), height = number(ex.height,1,MAX_SIDE,'drawing height');
      if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Face image dimensions must be whole pixels.');
      pixels += width * height; bytes += ex.src.length;
      if (pixels > PIXEL_BUDGET || bytes > MAX_SOURCE_BYTES) throw new Error('These face drawings are too large. Use fewer drawings or smaller images.');
      const id = ex.id === undefined ? 'expression-' + i : String(ex.id);
      if (!id || id.length > 120 || ids.has(id)) throw new Error('Face drawing IDs must be unique.');
      ids.add(id);
      return {id, name:String(ex.name || 'Drawing ' + (i+1)).slice(0,120), src:ex.src, width, height};
    });
  }
  function validate(data) {
    if (!data || data.v !== 1) throw new Error('Invalid face animation data.');
    const expressions = expressionList(data.expressions), ids = new Set(expressions.map(ex=>ex.id));
    function sample(s, key) {
      if (!s || !ids.has(s.expression)) throw new Error('A face key references a missing drawing.');
      const values=pose(s.p), opacity=number(s.opacity,0,1,'face opacity');
      if (key) {
        const time=number(s.t,0,599,'face key time');
        if(!Number.isInteger(time))throw new Error('Face key times must be whole frames.');
        return {t:time,p:values,expression:s.expression,opacity,e:easing(s.e)};
      }
      return {p:values,expression:s.expression,opacity};
    }
    if (!Array.isArray(data.keys) || data.keys.length > 600) throw new Error('Invalid face key list.');
    const ks = data.keys.map(k=>sample(k,true)).sort((a,b)=>a.t-b.t);
    if (ks.some((k,i)=>i && k.t === ks[i-1].t)) throw new Error('Face keys must have different frame times.');
    return {v:1,expressions,rest:sample(data.rest,false),keys:ks,crossfade:data.crossfade !== false};
  }
  function texture(src) {
    if (textures.has(src)) return textures.get(src);
    let resolve;
    // Loading promises always resolve. ready() reports failures explicitly, so
    // an import that fails before export never creates an unhandled rejection.
    const load={done:false,error:null,promise:new Promise(done=>{resolve=done;})};
    textureLoads.set(src,load);
    function finish(error) {
      if(load.done)return;
      load.done=true;load.error=error||null;resolve();
      if(error&&typeof toast==='function')toast('A face drawing could not be decoded. Import that drawing again.');
    }
    let tx;
    try {
      tx = new THREE.TextureLoader().load(src, loaded => {
        if(loaded)loaded.needsUpdate=true;
        finish(null);
      }, undefined, () => finish(new Error('A face drawing could not be decoded. Import that drawing again before exporting.')));
    } catch(error) {finish(error);throw error;}
    tx.encoding = THREE.sRGBEncoding; tx.minFilter = THREE.LinearFilter;
    tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = false;
    textures.set(src,tx); return tx;
  }
  async function ready() {
    const sources=new Set();
    parts.forEach(p=>{if(isFace(p))p.face.expressions.forEach(ex=>sources.add(ex.src));});
    sources.forEach(src=>texture(src));
    const loads=Array.from(sources,src=>textureLoads.get(src));
    await Promise.all(loads.map(load=>load.promise));
    if(loads.some(load=>load.error))throw new Error('A face drawing could not be decoded. Import that drawing again before exporting.');
    return true;
  }
  function material() {
    const m = new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    m.userData.tweenFaceMaterial = true; return m;
  }
  function ensureRender(p) {
    let state = renderStates.get(p);
    if (state) return state;
    if (Array.isArray(p.mesh.material) || !p.mesh.material?.userData?.tweenFaceMaterial) p.mesh.material = material();
    const secondary = new THREE.Mesh(p.mesh.geometry,material());
    secondary.name = 'Face expression blend'; secondary.userData.tweenFaceOverlay = true;
    secondary.position.z = .0004; secondary.visible = false; secondary.renderOrder = 3;
    p.mesh.renderOrder = 2; p.mesh.add(secondary);
    state = {secondary,expression:p.face.rest.expression,nextExpression:null,weight:0,opacity:p.face.rest.opacity};
    renderStates.set(p,state); return state;
  }
  function render(p, expression, opacity, nextExpression = null, weight = 0) {
    const state = ensureRender(p);
    let ex = p.face.expressions.find(ex=>ex.id===expression) || p.face.expressions[0];
    const next = p.face.expressions.find(ex=>ex.id===nextExpression);
    if (next && weight >= 1) ex = next;
    const blend = !!next && next.id !== ex.id && weight > 0 && weight < 1;
    const main = p.mesh.material, overlay = state.secondary;
    if (main.map !== texture(ex.src)) { main.map = texture(ex.src); main.needsUpdate = true; }
    main.opacity = opacity * (blend ? 1-weight : 1);
    if (overlay.geometry !== p.mesh.geometry) overlay.geometry = p.mesh.geometry;
    overlay.visible = blend && opacity > 0 && main.visible;
    if (blend) {
      if (overlay.material.map !== texture(next.src)) { overlay.material.map = texture(next.src); overlay.material.needsUpdate = true; }
      overlay.material.opacity = opacity * weight;
    }
    state.expression = ex.id; state.nextExpression = blend ? next.id : null;
    state.weight = blend ? weight : 0; state.opacity = opacity;
  }
  function evaluated(p = selected()) {
    if (!isFace(p)) return null;
    const state = ensureRender(p);
    return {p:get(p.o),expression:state.expression,opacity:state.opacity,nextExpression:state.nextExpression,weight:state.weight};
  }
  function evaluate(f) {
    parts.forEach(p => {
      if (!isFace(p)) return;
      const list = p.face.keys; let a = p.face.rest, b = a;
      if (list.length) {
        a = b = list[0];
        if (f >= list[list.length-1].t) a = b = list[list.length-1];
        else if (f > list[0].t) for (let i=0;i<list.length-1;i++) if (f >= list[i].t && f < list[i+1].t) { a=list[i]; b=list[i+1]; break; }
      }
      if (a === b || window.TweenInterpolation?.isHold()) { put(p.o,a.p); render(p,a.expression,a.opacity); return; }
      const amount = bez((f-a.t)/(b.t-a.t),a.e);
      put(p.o,a.p.map((n,i)=>n+(b.p[i]-n)*amount));
      // Easing may overshoot transforms; texture weights and opacity stay bounded.
      const weight = Math.max(0,Math.min(1,amount));
      render(p,a.expression,Math.max(0,Math.min(1,a.opacity+(b.opacity-a.opacity)*amount)),p.face.crossfade ? b.expression : null,weight);
    });
  }
  function sync() {
    window.TweenFacePanel?.sync();
  }
  function changed() {
    if (typeof simDirty === 'function') simDirty();
    if (typeof syncSl === 'function') syncSl();
    if (typeof drawParts === 'function') drawParts();
    if (typeof drawAll === 'function') drawAll();
    sync();
  }
  function transaction(action, options = {}) {
    if (typeof exportBusy !== 'undefined' && exportBusy) return false;
    if (typeof playing !== 'undefined' && playing) $('#play').click();
    if (options.record !== false) commit();
    let result;
    try { result = action(); }
    catch (e) { toast(e.message || String(e)); return false; }
    if (result !== false) { changed(); if (options.record !== false) commit(); }
    return result === undefined ? true : result;
  }
  const autoKey = options => options.key === undefined ? !!$('#ak')?.checked : !!options.key;
  const atTime = time => Math.max(0,Math.min(599,typeof last==='function'?last():599,Math.round(Number.isFinite(time) ? time : frame)));
  function sampleCurrent(p, time) {
    const state = evaluated(p);
    return {t:atTime(time),p:pose(state.p),expression:state.expression,opacity:state.opacity,e:easing($('#pre')?.value?.split(',').map(Number) || EASE)};
  }
  function writeKey(p,time) {
    const key = sampleCurrent(p,time), prior = p.face.keys.find(k=>k.t===key.t);
    if (prior) { key.e = prior.e.slice(); Object.assign(prior,key); return prior; }
    p.face.keys.push(key); p.face.keys.sort((a,b)=>a.t-b.t); return key;
  }
  function setKey(time = frame, options = {}) {
    const p = options.part || selected(); if (!isFace(p)) return false;
    return transaction(()=>writeKey(p,time),options);
  }
  function deleteKey(key = frame, options = {}) {
    const p = options.part || selected(); if (!isFace(p)) return false;
    const time = typeof key === 'object' ? key?.t : key;
    return transaction(()=>{
      const i = p.face.keys.findIndex(k=>k.t===time); if (i<0) return false;
      if (p.face.keys.length === 1) { const lastKey=p.face.keys[0]; p.face.rest={p:lastKey.p.slice(),expression:lastKey.expression,opacity:lastKey.opacity}; }
      p.face.keys.splice(i,1); evaluate(frame); return true;
    },options);
  }
  function retimeKey(from, to, options = {}) {
    const p = options.part || selected(); if (!isFace(p)) return false;
    from = typeof from === 'object' ? from?.t : from;
    to = atTime(to); const key = p.face.keys.find(k=>k.t===from);
    if (!key || p.face.keys.some(k=>k!==key && k.t===to)) return false;
    return transaction(()=>{key.t=to;p.face.keys.sort((a,b)=>a.t-b.t);evaluate(frame);return key;},options);
  }
  function setEasing(e, time = frame, options = {}) {
    const p = options.part || selected(); if (!isFace(p)) return false;
    return transaction(()=>{const values=easing(e),key=p.face.keys.find(k=>k.t===time);if(!key)return false;key.e=values;evaluate(frame);return key;},options);
  }
  function setPose(patch, options = {}) {
    const p = options.part || selected(); if (!isFace(p)) return false;
    return transaction(()=>{
      const state=evaluated(p), values=patch.p ? pose(patch.p) : state.p.slice();
      [['position',0],['rotation',3],['scale',6]].forEach(([field,offset])=>{
        if (patch[field] !== undefined) {
          if (!Array.isArray(patch[field]) || patch[field].length!==3) throw new Error('Use three '+field+' values.');
          patch[field].forEach((n,i)=>values[offset+i]=n);
        }
      });
      pose(values);
      const expression=patch.expression===undefined?state.expression:patch.expression;
      if (!p.face.expressions.some(ex=>ex.id===expression)) throw new Error('Choose an existing face drawing.');
      const opacity=patch.opacity===undefined?state.opacity:number(patch.opacity,0,1,'face opacity');
      if (options.allKeys) {
        const baseline=options.fromPose?pose(options.fromPose):state.p;
        const delta=values.map((n,i)=>n-baseline[i]);
        const shift=s=>({p:pose(s.p.map((n,i)=>n+delta[i])),expression:patch.expression===undefined?s.expression:expression,
          opacity:patch.opacity===undefined?s.opacity:opacity});
        // Prepare every pose before mutation so an invalid scale leaves the clip intact.
        const rest=shift(p.face.rest),shifted=p.face.keys.map(shift);
        p.face.rest=rest;p.face.keys.forEach((k,i)=>Object.assign(k,shifted[i]));
        put(p.o,values);render(p,expression,opacity);
      } else {
        put(p.o,values);render(p,expression,opacity);
        if (autoKey(options)) writeKey(p,frame);
        else p.face.rest={p:values.slice(),expression,opacity};
      }
      return true;
    },options);
  }
  const setExpression = (id,options={}) => setPose({expression:id},options);
  const setOpacity = (value,options={}) => setPose({opacity:Number(value)},options);
  function setCrossfade(value,options={}) {
    const p=options.part||selected();if(!isFace(p))return false;
    return transaction(()=>{p.face.crossfade=!!value;evaluate(frame);},options);
  }
  function renameExpression(id,name,options={}) {
    const p=options.part||selected();if(!isFace(p))return false;
    return transaction(()=>{const ex=p.face.expressions.find(ex=>ex.id===id);if(!ex)return false;ex.name=String(name).trim().slice(0,120)||'Drawing';},options);
  }
  function localMatrix(values) {
    const o=new THREE.Object3D();put(o,values);o.updateMatrix();return o.matrix;
  }
  function transformPose(values,matrix) {
    const transformed=new THREE.Object3D();matrix.clone().multiply(localMatrix(values)).decompose(transformed.position,transformed.quaternion,transformed.scale);
    return pose(get(transformed));
  }
  function rebase(p,matrix) {
    const current=transformPose(get(p.o),matrix),rest=transformPose(p.face.rest.p,matrix);
    const poses=p.face.keys.map(k=>transformPose(k.p,matrix));
    p.face.rest.p=rest;p.face.keys.forEach((k,i)=>k.p=poses[i]);put(p.o,current);p.rest.fromArray(rest.slice(0,3));
  }
  function parentPart(index,p) {
    const head=parts[index];
    if (!head || head===p || isFace(head)) throw new Error('Choose a head mesh or Whole model.');
    let ancestor=head.o;while(ancestor){if(ancestor===p?.o)throw new Error('A face cannot attach to one of its own children.');ancestor=ancestor.parent;}
    return head;
  }
  function rawAttach(p,index) {
    const head=parentPart(index,p);root.updateMatrixWorld(true);
    if(p.o.parent===head.o)return head;
    const old=p.o.parent?.matrixWorld || new THREE.Matrix4();
    const conversion=head.o.matrixWorld.clone().invert().multiply(old);
    rebase(p,conversion);head.o.add(p.o);
    // Global pose arrays retain their shape when a face is reparented as well.
    const partIndex=parts.indexOf(p);keys.forEach(k=>{if(k.p[partIndex])k.p[partIndex]=transformPose(k.p[partIndex],conversion);});
    root.updateMatrixWorld(true);return head;
  }
  function attach(parentIndex,options={}) {
    const p=options.part||selected();if(!isFace(p))return false;
    return transaction(()=>{rawAttach(p,Number(parentIndex));fillPar();return true;},options);
  }
  function rawFit(p,parentIndex,axis='+Z',offset=.015) {
    const head=parentPart(parentIndex,p);
    if(!head.mesh)throw new Error('Choose a head mesh to fit the face.');
    if(!/^[+-][XYZ]$/.test(axis))throw new Error('Choose a face direction.');
    number(offset,-10,10,'face surface offset');
    head.mesh.updateMatrix();head.mesh.geometry.computeBoundingBox();
    const box=head.mesh.geometry.boundingBox.clone().applyMatrix4(head.mesh.matrix),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    if(box.isEmpty() || !box.min.toArray().concat(box.max.toArray()).every(Number.isFinite))throw new Error('This head has no usable geometry bounds.');
    const ai='XYZ'.indexOf(axis[1]),sign=axis[0]==='-'?-1:1;
    const widthAxis=ai===0?2:0,heightAxis=ai===1?2:1;
    if(size.getComponent(widthAxis)<=0 || size.getComponent(heightAxis)<=0)throw new Error('This head has no surface in that direction.');
    rawAttach(p,parentIndex);
    const source=p.face.expressions[0],aspect=source.width/source.height;
    const scale=Math.max(.001,Math.min(size.getComponent(widthAxis)*.86/aspect,size.getComponent(heightAxis)*.86));
    const normal=new THREE.Vector3();normal.setComponent(ai,sign);
    center.setComponent(ai,(sign>0?box.max:box.min).getComponent(ai)+sign*offset);
    const target=new THREE.Object3D();target.position.copy(center);target.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);target.scale.setScalar(scale);target.updateMatrix();
    const delta=target.matrix.clone().multiply(localMatrix(get(p.o)).invert());rebase(p,delta);
    const pi=parts.indexOf(p);keys.forEach(k=>{if(k.p[pi])k.p[pi]=transformPose(k.p[pi],delta);});
    root.updateMatrixWorld(true);return true;
  }
  function fitToHead(parentIndex,axis='+Z',offset=.015,options={}) {
    const p=options.part||selected();if(!isFace(p))return false;
    if(parentIndex===undefined)parentIndex=parts.findIndex(q=>q.o===p.o.parent);
    return transaction(()=>rawFit(p,Number(parentIndex),axis,Number(offset)),options);
  }
  function addPlane(expressions,parentIndex) {
    // Validate all image metadata before touching scene or history.
    let list;try{list=expressionList(expressions);list.forEach(ex=>texture(ex.src));}catch(e){toast(e.message);return false;}
    let result;
    const ok=transaction(()=>{
      if(!parts.length)parts.push({n:'Whole model',o:root,rest:new THREE.Vector3()});
      const proposed=parentIndex===undefined?sel:Number(parentIndex);
      const host=parts[proposed]?.mesh&&!isFace(parts[proposed])?proposed:0;
      const geometry=new THREE.PlaneGeometry(list[0].width/list[0].height,1),mesh=new THREE.Mesh(geometry,material()),o=new THREE.Group();
      o.add(mesh);root.add(o);
      const face={v:1,expressions:list,rest:{p:IDENTITY.slice(),expression:list[0].id,opacity:1},keys:[],crossfade:true};
      const count=parts.filter(isFace).length;
      const p={n:'Face art'+(count?' '+(count+1):''),o,mesh,rest:new THREE.Vector3(),face,
        geom:{id:'face-'+Date.now().toString(36)+'-'+(++uid),base:geometry.clone(),nodes:[],shape:'plane',segments:1,welded:false}};
      parts.push(p);ensureRender(p);render(p,list[0].id,1);
      if(host>0)rawFit(p,host);else o.position.z=.03;
      p.face.rest={p:get(o),expression:list[0].id,opacity:1};p.rest.copy(o.position);writeKey(p,0);
      keys.forEach(key=>{while(key.p.length<parts.length)key.p.push(get(parts[key.p.length].o));});
      if(!keys.length)keys.push({t:0,p:snap(),e:EASE.slice()});
      if(window.GeometryEditor?.isEditing())GeometryEditor.setMode('object',false);
      $('#hint').style.display='none';selPart(parts.length-1);gzUpdate();wireApply();result=p;
      return true;
    });
    return ok?result:false;
  }
  async function readImage(file) {
    if(!file || !/\.(png|jpe?g|webp)$/i.test(file.name || '') && !/^image\/(png|jpeg|webp)$/.test(file.type || ''))throw new Error('Choose PNG, JPEG or WebP face drawings.');
    if(file.size>40*1024*1024)throw new Error('That face image is too large. Use an image smaller than 40 MB.');
    if(typeof createImageBitmap==='function') {
      try { return await createImageBitmap(file); } catch(e) { /* Fall back for browsers without bitmap decoding. */ }
    }
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.readAsDataURL(file);});
    return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not decode '+file.name));image.src=src;});
  }
  async function importFiles(files,options={}) {
    const list=Array.from(files||[]);if(!list.length)return false;
    const importParent=options.parentIndex===undefined?sel:Number(options.parentIndex);
    const existing=options.asExpressions?selected():null;
    if(options.asExpressions&&!existing){toast('Select a face plane before adding expressions.');return false;}
    if(list.length+(existing?.face.expressions.length||0)>MAX_EXPRESSIONS){toast('Use no more than 64 drawings per face.');return false;}
    try {
      const drawings=[];
      let width=existing?.face.expressions[0].width,height=existing?.face.expressions[0].height;
      for(let i=0;i<list.length;i++) {
        const image=await readImage(list[i]);
        try {
          const iw=image.width||image.naturalWidth,ih=image.height||image.naturalHeight;
          if(!iw||!ih)throw new Error('This drawing has no image dimensions.');
          if(!width){const down=Math.min(1,MAX_SIDE/iw,MAX_SIDE/ih,Math.sqrt(PIXEL_BUDGET/Math.max(1,list.length)/iw/ih));width=Math.max(1,Math.floor(iw*down));height=Math.max(1,Math.floor(ih*down));}
          if(width*height*(list.length+(existing?.face.expressions.length||0))>PIXEL_BUDGET)throw new Error('These drawings exceed the face image budget. Import fewer drawings.');
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas image import is unavailable.');
          const scale=Math.min(width/iw,height/ih),w=iw*scale,h=ih*scale;
          ctx.clearRect(0,0,width,height);ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);
          drawings.push({id:'drawing-'+Date.now().toString(36)+'-'+(++uid),name:list[i].name.replace(/\.[^.]+$/,''),src:canvas.toDataURL('image/png'),width,height});
        } finally {if(typeof image.close==='function')image.close();}
      }
      if(existing) {
        // Async decoding must not redirect an import if selection changes meanwhile.
        if(!parts.includes(existing))throw new Error('The destination face was removed while its drawings loaded.');
        const combined=expressionList(existing.face.expressions.concat(drawings));
        combined.forEach(ex=>texture(ex.src));
        return transaction(()=>{existing.face.expressions=combined;return existing;});
      }
      return addPlane(drawings,importParent);
    } catch(e){toast(e.message||String(e));return false;}
  }
  function capturePart(p) {return isFace(p)?copy(p.face):null;}
  function restorePart(p,data) {
    if(!data){delete p.face;return;}
    const face=validate(data);face.expressions.forEach(ex=>texture(ex.src));
    p.face=face;ensureRender(p);render(p,p.face.rest.expression,p.face.rest.opacity);return p;
  }
  function afterSceneRestore() {
    parts.forEach(p=>{if(isFace(p)){p.face=validate(p.face);ensureRender(p);}});evaluate(frame);sync();
  }
  function beforeSceneClear() {
    parts.forEach(p=>{const state=renderStates.get(p);if(state){state.secondary.parent?.remove(state.secondary);state.secondary.material.dispose();}});
    renderStates=new WeakMap();
  }
  function trimKeys(lastFrame) {
    const end=Math.max(0,Math.min(599,Number(lastFrame)||0));
    parts.forEach(p=>{if(isFace(p))p.face.keys=p.face.keys.filter(k=>k.t<=end);});
    evaluate(frame);sync();
  }
  function displaySync(mode) {
    const wire=(mode===undefined?$('#wm')?.value:mode)==='wire';
    parts.forEach(p=>{if(isFace(p)){const state=ensureRender(p);state.secondary.visible=!wire&&state.weight>0&&state.weight<1&&state.opacity>0;}});
  }
  function onSelect(){sync();}
  return {isFace,selected,evaluated,validate,capturePart,restorePart,afterSceneRestore,beforeSceneClear,
    importFiles,addPlane,setKey,deleteKey,retimeKey,setEasing,setPose,setExpression,setOpacity,setCrossfade,renameExpression,
    evaluate,ready,attach,fitToHead,trimKeys,displaySync,sync,onSelect,MAX_EXPRESSIONS,MAX_SIDE,PIXEL_BUDGET};
})();
window.TweenFaces = TweenFaces;
