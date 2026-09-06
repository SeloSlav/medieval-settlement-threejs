import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const output = 'output/church-progression';
mkdirSync(output, { recursive: true });
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page = await browser.newPage({viewport:{width:1500,height:850},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/church-progression-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><div id="caption" style="position:absolute;top:24px;left:30px;color:#ede5cc;font:20px sans-serif"></div></body></html>'}));
  await page.goto(new URL('church-progression-probe',server.resolvedUrls.local[0]).href);
  const metrics=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createBuildingMesh}=await import('/src/buildings/BuildingMeshes.ts');
    const {initializeBuildingMaterialLibrary}=await import('/src/buildings/buildingMaterials.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const backend = await createPreferredRenderer();
    const renderer=backend.renderer;renderer.setSize(1500,850);renderer.setPixelRatio(1);
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
    document.body.append(renderer.domElement);await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#253036');
    scene.add(new THREE.HemisphereLight(0xe0efff,0x66563a,2));
    const sun=new THREE.DirectionalLight(0xffedce,3);sun.position.set(-40,65,35);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-90,right:90,top:70,bottom:-70,near:1,far:180});sun.shadow.camera.layers.enable(1);sun.shadow.normalBias=.035;scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(230,140),new THREE.MeshStandardMaterial({color:0x6b7051,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;ground.receiveShadow=true;scene.add(ground);
    const camera=new THREE.PerspectiveCamera(40,1500/850,.1,400);
    const roots=[1,2,3,4].map((tier,i)=>{const root=createBuildingMesh('chapel',tier);root.position.x=(i-1.5)*30;scene.add(root);return root;});
    const stats=roots.map((root,i)=>{let triangles=0,meshes=0;root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});const model=root.getObjectByName(root.name+' procedural model');const size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());return{tier:i+1,triangles,meshes,size:size.toArray()};});
    const render=async(view)=>{
      roots.forEach((r,i)=>{r.visible=view==='lineup'||i===3;});
      const center=view==='lineup'?0:45;
      ground.visible=view!=='silhouette';
      scene.background.set(view==='silhouette' ? '#d9d5c8' : '#253036');
      scene.overrideMaterial=view==='clay'?new THREE.MeshStandardMaterial({color:0xb9b3a6,roughness:1}):view==='silhouette'?new THREE.MeshBasicMaterial({color:0x151a1d}):null;
      const views={lineup:[24,63,133],front:[0,17,66],rear:[-40,28,-52],near:[26,14,29],far:[58,51,88],clay:[36,27,48],silhouette:[36,27,48]};
      const v=views[view];camera.position.set(center+v[0],v[1],v[2]);camera.lookAt(center,view==='lineup'?4:12,0);camera.updateMatrixWorld(true);
      document.getElementById('caption').textContent=view==='lineup'?'Church progression · I Wooden · II Stone · III Parish · IV Cathedral':`Cathedral · ${view} · no post processing`;
      await renderer.renderAsync(scene,camera);
      return {draws:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles};
    };
    window.churchProbe={render,renderer,scene,camera,roots};await render('lineup');return stats;
  });
  const renderStats={};
  for(const view of ['lineup','front','rear','near','far','clay','silhouette']){
    renderStats[view]=await page.evaluate(view=>window.churchProbe.render(view),view);
    await page.screenshot({path:`${output}/${view}.png`});
  }
  assert.deepEqual(errors,[],'Church gallery browser errors');
  assert(metrics[3].size[1]>29,'The cathedral must be a monumental landmark');
  assert(metrics[3].size[0]>metrics[2].size[0]*1.5,'Cathedral mass must be significantly wider');
  writeFileSync(`${output}/metrics.json`,JSON.stringify({seed:1550,viewport:[1500,850],backend:'preferred renderer, no-post diagnostic',metrics,renderStats},null,2));
  console.log(JSON.stringify(metrics));
} finally {await browser?.close();await server.close();}
