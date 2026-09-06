import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const output='output/dressed-stone';mkdirSync(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/mason-probe',r=>r.fulfill({contentType:'text/html',body:`<html><body style="margin:0;background:#27332f;color:#eee7d1;font:18px sans-serif"><div style="position:absolute;left:24px;top:20px;z-index:2">Stonemason’s Yard · rough stone → dressed stone</div><img src="/assets/ui/build-menu/cards/stone-mason.webp" style="position:absolute;right:24px;top:24px;width:160px;border-radius:12px;z-index:2"><img src="/assets/ui/icons/materials/dressed-stone.svg" style="position:absolute;right:78px;top:280px;width:56px;z-index:2"></body></html>`}));
  await page.goto(new URL('mason-probe',server.resolvedUrls.local[0]).href);
  const stats=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createBuildingMesh}=await import('/src/buildings/BuildingMeshes.ts');
    const {syncBulkStockpileVisuals}=await import('/src/buildings/bulkStockpileVisuals.ts');
    const {initializeBuildingMaterialLibrary}=await import('/src/buildings/buildingMaterials.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const backend=await createPreferredRenderer();const renderer=backend.renderer;renderer.setSize(1400,900);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;document.body.append(renderer.domElement);await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#27332f');scene.add(new THREE.HemisphereLight(0xe5efff,0x6a5840,2));
    const sun=new THREE.DirectionalLight(0xffedce,3);sun.position.set(-15,25,16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-14,right:14,top:14,bottom:-14,near:1,far:70});sun.shadow.camera.layers.enable(1);scene.add(sun);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.MeshStandardMaterial({color:0x737556,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);
    const yard=createBuildingMesh('stone_mason');scene.add(yard);
    const filled={kind:'stone_mason',stone:96,dressedStone:64,firewood:0};syncBulkStockpileVisuals(yard,filled);
    const camera=new THREE.PerspectiveCamera(38,1400/900,.1,150);
    const render=async(view)=>{
      scene.overrideMaterial=view==='clay'?new THREE.MeshStandardMaterial({color:0xbfb9a9,roughness:1}):null;
      syncBulkStockpileVisuals(yard,view==='empty'?{...filled,stone:0,dressedStone:0}:filled);
      const views={front:[13,11,18],rear:[-14,10,-17],near:[8,5,10],far:[24,20,34],clay:[13,11,18],empty:[13,11,18]};camera.position.set(...views[view]);camera.lookAt(0,1.4,0);camera.updateMatrixWorld(true);await renderer.renderAsync(scene,camera);
      return {draws:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles};
    };
    window.masonProbe={render,yard};await render('front');return yard.userData.proceduralArchitectureMetrics;
  });
  const views={};for(const view of ['front','rear','near','far','clay','empty']){views[view]=await page.evaluate(v=>window.masonProbe.render(v),view);await page.screenshot({path:`${output}/${view}.png`});}
  assert.deepEqual(errors,[]);assert(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)));
  assert(views.front.triangles>views.empty.triangles,'empty stockpiles remove actual visible blocks');
  writeFileSync(`${output}/visual-metrics.json`,JSON.stringify({stats,views},null,2));console.log(JSON.stringify({stats,views}));
}finally{await browser?.close();await server.close();}
