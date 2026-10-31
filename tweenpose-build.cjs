/* Keep the distributable HTML self-contained while maintaining separate editor sources. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const target=path.join(__dirname,'index.html');
let html=fs.readFileSync(target,'utf8');
for(const [name,file] of [['geometry-kernel','tweenpose-geometry-kernel.js'],['geometry-editor','tweenpose-editor.js'],['faces','tweenpose-faces.js'],['timeline','tweenpose-timeline.js'],['face-panel','tweenpose-face-panel.js'],['motion-paths','tweenpose-motion-paths.js'],['motion-panel','tweenpose-motion-panel.js'],['motion-blur','tweenpose-motion-blur.js'],['interpolation','tweenpose-interpolation.js'],['direct-manipulation','tweenpose-direct-manipulation.js']]){
  if(!fs.existsSync(path.join(__dirname,file)))continue;
  const start='<!-- tweenpose:'+name+' -->',end='<!-- /tweenpose:'+name+' -->';
  const block=start+'\n<script>\n'+fs.readFileSync(path.join(__dirname,file),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>\n'+end;
  if(html.includes(start))html=html.slice(0,html.indexOf(start))+block+html.slice(html.indexOf(end)+end.length);
  else if(name==='geometry-kernel')html=html.replace('<script>\r\nconst $=',block+'\n<script>\r\nconst $=').replace('<script>\nconst $=',block+'\n<script>\nconst $=');
  else html=html.replace('</body>',block+'\n</body>');
}
const storagePath=path.join(__dirname,'tweenpose-storage.js');
if(fs.existsSync(storagePath)){
  const start='/* tweenpose:backup-storage */',end='/* /tweenpose:backup-storage */';
  const block=start+'\n'+fs.readFileSync(storagePath,'utf8')+'\n'+end;
  if(html.includes(start))html=html.slice(0,html.indexOf(start))+block+html.slice(html.indexOf(end)+end.length);
  else {const from=html.indexOf("const SK='pts_snaps_'"),to=html.indexOf('function gizmoEnd()',from);if(from<0||to<0)throw new Error('Could not locate the original backup module.');html=html.slice(0,from)+block+'\n'+html.slice(to);}
}
const lightingPath=path.join(__dirname,'tweenpose-lighting.html');
if(fs.existsSync(lightingPath)){
  const start='<!-- tweenpose:lighting -->',end='<!-- /tweenpose:lighting -->';
  const from=html.indexOf(start),to=html.indexOf(end,from);
  if(from<0||to<from)throw new Error('The LightingPlus source block is missing.');
  html=html.slice(0,from)+start+'\n'+fs.readFileSync(lightingPath,'utf8')+end+html.slice(to+end.length);
}
fs.writeFileSync(target,html);console.log('Updated self-contained TweenPose index.html');
