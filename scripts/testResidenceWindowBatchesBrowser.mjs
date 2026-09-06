import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen(); let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/window-batch-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('window-batch-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { initializeBuildingMaterialLibrary } = await import('/src/buildings/buildingMaterials.ts');
    const { createResidenceMesh, applyResidenceWindowGlow } = await import('/src/residences/ResidenceMarkers.ts');
    const { batchResidenceStaticMeshes } = await import('/src/residences/staticResidenceBatch.ts');
    const { ResidenceWindowBatches } = await import('/src/residences/ResidenceWindowBatches.ts');
    const backend = await createPreferredRenderer(), renderer = backend.renderer;
    await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
    renderer.setSize(640,480); renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(), parent = new THREE.Group(); scene.add(parent);
    scene.background = new THREE.Color(.07,.08,.09);
    scene.add(new THREE.HemisphereLight(0xffffff,0x888888,1));
    const sun = new THREE.DirectionalLight(0xffffff,3); sun.position.set(20,40,30); scene.add(sun);
    sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:130});
    const batches = new ResidenceWindowBatches(parent), homes = [];
    for (let i=0;i<12;i++) {
      const home = createResidenceMesh(13+i*97, i%4+1, i%4===3);
      home.position.set((i%4-1.5)*12,0,(Math.floor(i/4)-1)*14);
      home.rotation.y = (i%3-1)*.15;
      batchResidenceStaticMeshes(home); parent.add(home); homes.push(home); batches.register(String(i),home);
    }
    const camera = new THREE.PerspectiveCamera(43,4/3,.1,250), target = new THREE.RenderTarget(640,480);
    const pixels = async () => { renderer.setRenderTarget(target);renderer.render(scene,camera);return renderer.readRenderTargetPixelsAsync(target,0,0,640,480); };
    const reports = []; let worst;
    for (let state=0;state<7;state++) {
      for(let i=0;i<homes.length;i++) {
        const home=homes[i];
        applyResidenceWindowGlow(home.userData.windowMaterial, state===0?0:((i%5+1)/5)*(state/6),i%4!==0);
        home.visible = !(state===3 && i%3===0);
        if(state===4&&i===0){home.position.set(7,-.1,8);home.rotation.set(.01,.6,-.03);home.scale.set(.99,.95,.985);}
        batches.update(String(i),home,home.visible);batches.updateMaterial(String(i));
      }
      if(state===5) {batches.remove('11'); homes[11].visible=false;}
      if(state===6) {homes[11].visible=true;batches.register('11',homes[11]);}
      batches.flush();
      for(let view=0;view<4;view++) {
        const angle=view*Math.PI*.5+.2; camera.position.set(Math.sin(angle)*54,29,Math.cos(angle)*54);camera.lookAt(0,2,0);camera.updateMatrixWorld(true);
        sun.position.set(20+view*3,40,30-view*5);sun.updateMatrixWorld(true);
        batches.group.visible=true;
        for(const home of batches.homes.values())for(const part of home.parts)part.source.layers.mask=0;
        await pixels(); const a=await pixels();
        batches.group.visible=false;
        for(const home of batches.homes.values())for(const part of home.parts)part.source.layers.mask=part.layers;
        await pixels(); const b=await pixels();
        let changed=0,maxError=0;
        for(let i=0;i<a.length;i+=4) {const diff=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(diff>12)changed++;maxError=Math.max(maxError,diff);}
        reports.push({state,view,changed,maxError,draws:batches.group.children.length});
        if (!worst || changed > worst.changed) {
          const encode = data => {const c=document.createElement('canvas');c.width=640;c.height=480;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),640,480),0,0);return c.toDataURL();};
          worst={state,view,changed,actual:encode(a),expected:encode(b)};
        }
      }
    }
    batches.dispose();
    for(const home of homes)home.traverse(o=>{if(o.isMesh&&o.material===home.userData.windowMaterial&&o.layers.mask===0)throw new Error('Disposal failed to restore canonical windows');});
    target.dispose();renderer.dispose();return {reports,worst};
  });
  mkdirSync('artifacts/city-performance',{recursive:true});
  for(const name of ['actual','expected']) {
    writeFileSync(`artifacts/city-performance/window-batch-${name}.png`,Buffer.from(result.worst[name].split(',')[1],'base64'));
    delete result.worst[name];
  }
  writeFileSync('artifacts/city-performance/window-batch-parity.json',JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({result,errors}));
  assert.deepEqual(errors,[]);
  assert.ok(result.reports.every(r=>r.changed<=100), 'Household window geometry/lighting changed');
  assert.ok(result.reports.every(r=>r.draws<=4), 'Identical window materials did not combine by district');
} finally {await browser?.close();await server.close();}
