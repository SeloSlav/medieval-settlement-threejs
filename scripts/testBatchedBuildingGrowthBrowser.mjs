import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const label = process.argv[2] ?? 'current';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  await page.route('**/batch-growth-probe', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('http://127.0.0.1:5173/batch-growth-probe');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { BuildingStaticBatches } = await import('/src/buildings/BuildingStaticBatches.ts');
    const { createBuildingMesh } = await import('/src/buildings/BuildingMeshes.ts');
    const { batchCompletedBuildingStaticMeshes } = await import('/src/buildings/staticBuildingBatch.ts');
    const { initializeBuildingMaterialLibrary } = await import('/src/buildings/buildingMaterials.ts');
    const backend = await createPreferredRenderer();
    const renderer = backend.renderer;
    await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
    renderer.setSize(640, 480); renderer.setPixelRatio(1);
    document.body.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(45, 640/480, .1, 1000);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x222222);
    const parent = new THREE.Group(); scene.add(parent);
    const batches = new BuildingStaticBatches(parent);
    const reference = new THREE.Scene(); reference.background = scene.background;
    for (const s of [scene, reference]) { s.add(new THREE.HemisphereLight(0xffffff,0x777777,3)); const light=new THREE.DirectionalLight(0xffffff,3); light.position.set(10,25,10); s.add(light); }
    const material = new THREE.MeshBasicMaterial({ color: 0xe8c281 });
    const target = new THREE.Vector3(0, 0, 0);
    const renderTarget = new THREE.RenderTarget(640,480);
    const pixels = async s => {
      await new Promise(requestAnimationFrame);
      renderer.setRenderTarget(renderTarget);
      renderer.render(s, camera);
      return renderer.readRenderTargetPixelsAsync(renderTarget,0,0,640,480);
    };
    const errors = [], images = [];
    const encode = data => { const c=document.createElement('canvas'); c.width=640;c.height=480;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),640,480),0,0);return c.toDataURL(); };
    const kinds=['stable','carpenter','smokehouse','weaver','potter_kiln','bakery','tannery','lumber_mill','guardhouse','chapel','village_storehouse','apiary'];
    for (let count = 0; count < kinds.length; count++) {
      const root = createBuildingMesh(kinds[count]);
      root.position.set((count%4-1.5)*20, 0, (Math.floor(count/4)-1)*20);
      parent.add(root);
      batchCompletedBuildingStaticMeshes(root);
      const original = root.clone(true); original.traverse(o=>{if(o.isMesh) o.geometry=o.geometry.clone();}); reference.add(original);
      batches.registerBuilding(`growing-${count}`, root); batches.finalizeGeometryBuffers();
      for (let view = 0; view < 5; view++) {
        const angle = view * Math.PI * .4;
        camera.position.set(Math.sin(angle)*60, 32, Math.cos(angle)*60); camera.lookAt(target); camera.updateMatrixWorld(true);
        const actual = await pixels(scene); const expected = await pixels(reference);
        let changed=0, settledChanged=0;
        const settled = await pixels(scene);
        for(let i=0;i<actual.length;i+=4) if(Math.abs(actual[i]-expected[i])+Math.abs(actual[i+1]-expected[i+1])+Math.abs(actual[i+2]-expected[i+2])>12) changed++;
        for(let i=0;i<actual.length;i+=4) if(Math.abs(settled[i]-expected[i])+Math.abs(settled[i+1]-expected[i+1])+Math.abs(settled[i+2]-expected[i+2])>12) settledChanged++;
        errors.push({count:count+1,view,changed,settledChanged});
        if ((count===1&&view===0)||(count===8&&view===1)) images.push({name:`${count+1}-${view}`,actual:encode(actual),expected:encode(expected),settled:encode(settled)});
      }
    }
    renderer.dispose();
    return {adapter:backend.adapterEvidence,errors,images};
  });
  mkdirSync('artifacts/city-performance', { recursive: true });
  for(const image of result.images)for(const kind of ['actual','expected','settled'])writeFileSync(`artifacts/city-performance/${label}-${image.name}-${kind}.png`,Buffer.from(image[kind].split(',')[1],'base64'));
  delete result.images;
  writeFileSync(`artifacts/city-performance/batch-growth-${label}.json`, JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  // Cross-building transforms can move a few rasterized edge pixels at float
  // precision. Missing walls affect thousands; the original growth defect
  // changed 30,000–64,000 pixels after nine buildings in these same views.
  assert.ok(result.errors.every(x=>x.changed<250), 'Growing camera-sorted building batches must match individual mesh pixels');
} finally { await browser.close(); }
