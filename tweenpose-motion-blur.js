/* Temporal exposure rendering. Scene samples are averaged in linear light;
   transparent pixels stay premultiplied until the final canvas conversion. */
const TweenMotionBlur = (() => {
  'use strict';
  const defaults={enabled:false,preview:true,exports:true,shutter:180,samples:8};
  let settings={...defaults},targets=null,passScene=null,passCamera=null,quad=null,average=null,output=null;
  let previewBlocked=false,rendering=false,width=0,height=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function validate(data={}){
    const shutter=Number(data.shutter??defaults.shutter),samples=Number(data.samples??defaults.samples);
    if(!Number.isFinite(shutter)||shutter<0||shutter>720||!Number.isInteger(samples)||samples<2||samples>24)throw new Error('Use a shutter from 0–720° and 2–24 motion blur samples.');
    return {enabled:!!data.enabled,preview:data.preview!==false,exports:data.exports!==false,shutter,samples};
  }
  function snapshot(){return {...settings};}
  function restoreSettings(data){settings=validate(data||defaults);previewBlocked=false;syncUI();}
  function setSettings(patch,record=true){
    if(exportBusy)return false;
    let proposed;try{proposed=validate({...settings,...patch});}catch(e){toast(e.message);return false;}
    if(JSON.stringify(proposed)===JSON.stringify(settings)){syncUI();return true;}
    if(record)commit();settings=proposed;previewBlocked=false;syncUI();if(record){commit();window.TweenPoseBackups?.markDirty();}return true;
  }
  function sampleTimes(time,count=settings.samples){
    const end=clamp(Number.isFinite(+time)?+time:frame,0,last()),span=settings.shutter/360;
    if(span<=0||count<2)return [end];
    const times=[];
    for(let i=0;i<count;i++){const t=clamp(end-span+(i+.5)*span/count,0,last());if(!times.length||Math.abs(t-times[times.length-1])>1e-9)times.push(t);}
    return times;
  }
  function samplePose(time){
    const f=clamp(time,0,last()),cloth=parts.filter(p=>p.cl?.on),lo=Math.floor(f),hi=Math.min(last(),lo+1),fraction=f-lo;
    if(!cloth.length){poseAt(f,{silent:true});root.updateMatrixWorld(true);return;}
    evalAt(lo,{silent:true});
    if(fraction>1e-7&&hi!==lo){
      const start=cloth.map(p=>p.mesh.geometry.attributes.position.array.slice());
      evalAt(hi,{silent:true});
      cloth.forEach((p,i)=>{const g=p.mesh.geometry,a=g.attributes.position;for(let k=0;k<a.array.length;k++)a.array[k]=start[i][k]+(a.array[k]-start[i][k])*fraction;a.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();});
    }
    poseAt(f,{silent:true});root.updateMatrixWorld(true);
  }
  function signature(){
    root.updateMatrixWorld(true);const result=[];
    for(const p of parts){result.push(...p.o.matrixWorld.elements);if(!p.mesh)continue;
      for(const m of [].concat(p.mesh.material))result.push(m.opacity,m.visible,m.map?.uuid||'');
      if(p.face){const v=TweenFaces.evaluated(p);result.push(v.expression,v.nextExpression,v.opacity,v.weight);}
      if(p.cl?.on)for(const v of p.mesh.geometry.attributes.position.array)result.push(v);
    }return result;
  }
  function different(a,b){if(a.length!==b.length)return true;for(let i=0;i<a.length;i++){if(typeof a[i]==='number'&&typeof b[i]==='number'){if(Math.abs(a[i]-b[i])>1e-7)return true;}else if(a[i]!==b[i])return true;}return false;}
  function hasMotion(times,restoreTime){
    let first=null;
    try{for(const t of times){samplePose(t);const current=signature();if(first&&different(first,current))return true;first=current;}return false;}
    finally{samplePose(restoreTime);}
  }
  const vertex='varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  function initialize(w,h){
    if(!targets){
      const options={minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,type:THREE.UnsignedByteType,generateMipmaps:false,stencilBuffer:false};
      targets=[new THREE.WebGLRenderTarget(w,h,{...options,depthBuffer:true}),new THREE.WebGLRenderTarget(w,h,{...options,depthBuffer:false}),new THREE.WebGLRenderTarget(w,h,{...options,depthBuffer:false})];
      targets.forEach((target,i)=>{target.texture.encoding=THREE.LinearEncoding;target.texture.name='TweenPose exposure '+i;});
      average=new THREE.ShaderMaterial({name:'TweenPose linear exposure average',uniforms:{previous:{value:null},current:{value:null},weight:{value:1}},vertexShader:vertex,
        fragmentShader:'varying vec2 vUv;uniform sampler2D previous;uniform sampler2D current;uniform float weight;void main(){gl_FragColor=mix(texture2D(previous,vUv),texture2D(current,vUv),weight);}',depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
      output=new THREE.ShaderMaterial({name:'TweenPose transparent exposure output',uniforms:{image:{value:null}},vertexShader:vertex,
        fragmentShader:'varying vec2 vUv;uniform sampler2D image;void main(){vec4 c=texture2D(image,vUv);if(c.a>0.000001)c.rgb/=c.a;else c.rgb=vec3(0.0);gl_FragColor=c;\n#include <encodings_fragment>\ngl_FragColor.rgb*=gl_FragColor.a;}',depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
      passScene=new THREE.Scene();passScene.name='TweenPose motion exposure pass';passCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),average);quad.frustumCulled=false;passScene.add(quad);
    }
    if(width!==w||height!==h){targets.forEach(t=>t.setSize(w,h));width=w;height=h;}
  }
  function editorHelpers(){
    const found=[tc,piv];
    for(const object of scene.children)if(object.userData?.tweenEditorHelper||/^(Topology helpers|Motion path|Motion drawing)/i.test(object.name||''))found.push(object);
    return [...new Set(found)];
  }
  function renderHelpers(objects){
    const visible=objects.filter(o=>o.visible);if(!visible.length)return;
    const previousMask=cam.layers.mask,records=[];
    try{
      for(const o of visible)o.traverse(child=>{records.push([child,child.layers.mask]);child.layers.set(31);});
      cam.layers.set(31);ren.autoClear=false;ren.clearDepth?.();ren.render(scene,cam);
    }finally{cam.layers.mask=previousMask;records.forEach(([o,mask])=>o.layers.mask=mask);}
  }
  function render(time=frame,options={}){
    const exporting=options.exporting===true,center=clamp(Number.isFinite(+time)?+time:frame,0,last());
    const active=settings.enabled&&!window.TweenInterpolation?.isHold()&&settings.shutter>0&&(exporting?settings.exports:settings.preview&&!previewBlocked&&playing);
    if(!active||rendering){ren.render(scene,cam);return false;}
    const times=sampleTimes(center,exporting?settings.samples:Math.min(6,settings.samples));
    if(times.length<2||!hasMotion(times,center)){ren.render(scene,cam);return false;}
    const saved={target:ren.getRenderTarget(),autoClear:ren.autoClear,color:ren.getClearColor(new THREE.Color()).clone(),alpha:ren.getClearAlpha()},helpers=editorHelpers().map(o=>[o,o.visible]);
    rendering=true;
    try{
      const size=ren.getDrawingBufferSize(new THREE.Vector2());initialize(Math.max(1,size.x|0),Math.max(1,size.y|0));
      helpers.forEach(([o])=>o.visible=false);ren.setClearColor(0,0);ren.autoClear=true;
      for(const target of targets){ren.setRenderTarget(target);ren.clear();}
      let previous=targets[2];
      for(let i=0;i<times.length;i++){
        samplePose(times[i]);ren.setRenderTarget(targets[0]);ren.clear();ren.render(scene,cam);
        const target=targets[1+i%2];average.uniforms.previous.value=previous.texture;average.uniforms.current.value=targets[0].texture;average.uniforms.weight.value=1/(i+1);quad.material=average;
        ren.setRenderTarget(target);ren.clear();ren.render(passScene,passCamera);previous=target;
      }
      samplePose(center);output.uniforms.image.value=previous.texture;quad.material=output;ren.setRenderTarget(saved.target);ren.clear();ren.render(passScene,passCamera);
      helpers.forEach(([o,visible])=>o.visible=visible);
      if(!exporting)renderHelpers(helpers.map(([o])=>o));
      return true;
    }catch(e){
      if(exporting)throw e;
      previewBlocked=true;$('#motion-blur-status').textContent='Preview paused. Lower blur quality or leave blur for exports.';toast('Motion blur preview could not render. You can still edit and export without preview blur.');
      ren.setRenderTarget(saved.target);samplePose(center);ren.render(scene,cam);return false;
    }finally{
      samplePose(center);helpers.forEach(([o,visible])=>o.visible=visible);ren.setRenderTarget(saved.target);ren.setClearColor(saved.color,saved.alpha);ren.autoClear=saved.autoClear;rendering=false;
    }
  }
  function dispose(){targets?.forEach(t=>t.dispose());targets=null;average?.dispose();output?.dispose();quad?.geometry.dispose();passScene=null;width=height=0;}
  const section=document.createElement('section');section.className='geometry-section';section.id='motion-blur-panel';
  section.innerHTML='<h3>Motion blur</h3><label><input id="motion-blur-enabled" type="checkbox"> Enable motion blur</label><div class="row"><label><input id="motion-blur-preview" type="checkbox" checked> Playback preview</label><label><input id="motion-blur-exports" type="checkbox" checked> Exports</label></div><label>Shutter <input id="motion-blur-shutter" type="range" min="0" max="720" step="15" value="180" style="flex:1;min-width:40px"><output id="motion-blur-angle">180°</output></label><label>Quality <select id="motion-blur-samples"><option value="4">Fast · 4 samples</option><option value="8" selected>Balanced · 8 samples</option><option value="12">High · 12 samples</option><option value="16">Ultra · 16 samples</option><option value="24">Maximum · 24 samples</option></select></label><small id="motion-blur-status" class="geometry-note">Larger shutter angles make longer trails. Preview uses up to 6 samples; exports use your chosen quality.</small>';
  $('#R').prepend(section);
  function syncUI(){
    $('#motion-blur-enabled').checked=settings.enabled;$('#motion-blur-preview').checked=settings.preview;$('#motion-blur-exports').checked=settings.exports;$('#motion-blur-shutter').value=settings.shutter;$('#motion-blur-angle').textContent=settings.shutter+'°';
    const quality=$('#motion-blur-samples');if(!Array.from(quality.options).some(o=>+o.value===settings.samples)){const o=document.createElement('option');o.value=settings.samples;o.textContent=settings.samples+' samples';quality.append(o);}quality.value=settings.samples;
    if(!previewBlocked)$('#motion-blur-status').textContent=window.TweenInterpolation?.isHold()?'Hold mode keeps pose changes crisp. Motion blur resumes when pose interpolation is set to Tween.':'Larger shutter angles make longer trails. Preview uses up to 6 samples; exports use your chosen quality.';
  }
  for(const [id,key]of [['enabled','enabled'],['preview','preview'],['exports','exports']])$('#motion-blur-'+id).onchange=e=>setSettings({[key]:e.target.checked});
  let shutterGesture=false;
  $('#motion-blur-shutter').oninput=e=>{if(!shutterGesture){commit();shutterGesture=true;}setSettings({shutter:+e.target.value},false);};
  function finishShutter(e){if(shutterGesture){shutterGesture=false;commit();}else if(e?.target)setSettings({shutter:+e.target.value});}
  $('#motion-blur-shutter').onchange=finishShutter;$('#motion-blur-shutter').onpointerup=()=>{if(shutterGesture)finishShutter();};$('#motion-blur-shutter').onblur=()=>{if(shutterGesture)finishShutter();};
  $('#motion-blur-samples').onchange=e=>setSettings({samples:+e.target.value});
  ren.domElement.addEventListener('webglcontextlost',dispose);syncUI();
  return {render,sampleTimes,samplePose,hasMotion,settings:snapshot,restoreSettings,setSettings,validate,dispose,sync:syncUI,get blocked(){return previewBlocked;}};
})();
window.TweenMotionBlur=TweenMotionBlur;
