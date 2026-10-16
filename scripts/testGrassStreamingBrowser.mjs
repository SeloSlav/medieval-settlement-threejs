import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/vegetation-culling/grass-streaming';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/grass-stream-probe?*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('/grass-stream-probe?mode=singleplayer', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { createGrassBladeField } = await import('/src/grass/GrassBladeField.ts');
    const { unculledInstanceReference } = await import('/scripts/fixtures/unculledInstanceReference.ts');
    const { setWorldAnimationTime } = await import('/src/scene/worldAnimationTime.ts');
    const { windStrength } = await import('/vendor/seedthree/src/core/wind.js');
    const { renderer } = await createPreferredRenderer(); renderer.setSize(320, 192);
    const geometry = new THREE.PlaneGeometry(1240, 1240, 2, 2); geometry.rotateX(-Math.PI / 2);
    const terrain = { generationSize: 1240, size: 1240, resolution: 3, mesh: { geometry },
      bounds: { minX: -620, maxX: 620, minZ: -620, maxZ: 620 }, getHeightAt: () => 0 };
    const camera = new THREE.PerspectiveCamera(50, 320 / 192, .1, 500), target = new THREE.RenderTarget(320, 192);
    const hash = arrays => {
      let value = 2166136261;
      for (const array of arrays) for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) value = Math.imul(value ^ byte, 16777619) >>> 0;
      return value;
    };
    const capture = async scene => {
      renderer._nodes.nodeFrame.update(); renderer.setRenderTarget(target); renderer.render(scene, camera);
      return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 320, 192));
    };
    const reports = [], images = [];
    const states = [
      [0,10,8.8,true], [0,10,8.8,true], [18,8,8.8,true], [18,28,32,false],
      [0,10,8.8,true], [0,10,8.8,true], [0,10,8.8,true], [130,-110,8.8,true],
      [0,10,8.8,true], [610,10,8.8,true], [0,10,240,false], [0,10,8.8,true],
    ];
    for (const mode of ['singleplayer', 'multiplayer']) {
      history.replaceState({}, '', `/grass-stream-probe?mode=${mode}`);
      const field = await createGrassBladeField(terrain, { rendererBackend: 'webgpu', renderer });
      const scene = new THREE.Scene(); scene.background = new THREE.Color(.13,.17,.21);
      scene.add(field.group, new THREE.AmbientLight(0xffffff,.8));
      const sun = new THREE.DirectionalLight(0xfff1d4,2); sun.position.set(20,40,10); scene.add(sun);
      const sources = field.group.children.filter(object => /^SeedThree grass (meadow|clump)$/.test(object.name));
      for (let step = 0; step < states.length; step++) {
        const [x,z,distance,walking] = states[step];
        camera.position.set(x,step===3?12:1.6,z);
        const focus = new THREE.Vector3(x+(step===1?12:0),0,z-10);
        camera.lookAt(focus); camera.updateMatrixWorld(true);
        setWorldAnimationTime(12.5 + step*.7); windStrength.value = step===0?0:2;
        if (step===4) field.syncPlacementClearance([[{x:-6,z:-6},{x:6,z:-6},{x:6,z:6},{x:-6,z:6}]]);
        if (step===6) field.syncPlacementClearance([]);
        field.setEnvironment({deciduousFoliage:{springFlush:step===5?0:1,autumnColor:step===5?.8:0,dormancy:step===5?1:0},snowCoverage:step===5?.8:0});
        field.primeAndFreezeStream(camera.position,focus,distance,walking);
        field.updateCameraState(camera.position,focus,distance,walking);
        for (let iteration=0; field.group.userData.lodFadeVisible && !field.isStreamSettled(); iteration++) {
          if(iteration>3000)throw Error('Grass streaming failed to converge');
          field.updateCameraState(camera.position,focus,distance,walking);
          if(iteration%32===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        field.prepareRender(camera);
        for(const object of field.group.children)if(!sources.includes(object))object.visible=false;
        // This reference includes ALL canonical slots, including their parked
        // unused tails, exactly as the original grass renderer submitted them.
        const pairs = sources.map(source => unculledInstanceReference({source,
          draw:source.children.find(child=>child.userData.instanceCompactionDraw)??source}));
        const canonical = [], live = [];
        for(const source of sources) {
          let count=0;
          for(let row=0;row<source.count;row++)if(source.instanceMatrix.array[row*16+13]>-4000) {
            count++;
            canonical.push(source.instanceMatrix.array.subarray(row*16,row*16+16));
            for(const attribute of [source.instanceColor,source.geometry.getAttribute('aTint'),source.geometry.getAttribute('aAnchorPos')])
              canonical.push(attribute.array.subarray(row*attribute.itemSize,(row+1)*attribute.itemSize));
          }
          live.push(count);
        }
        const firstImage=await capture(scene);
        await capture(scene);
        const a=await capture(scene);
        for(const pair of pairs) {pair.draw.visible=false;pair.reference.visible=true;}
        const b=await capture(scene);
        for(const pair of pairs) {pair.draw.visible=true;pair.reference.visible=false;}
        const recovered=await capture(scene);
        let maxDelta=0, firstFrameMaxDelta=0, changed=0, stability=0;
        for(let i=0;i<a.length;i++) {
          const delta=Math.abs(a[i]-b[i]);maxDelta=Math.max(maxDelta,delta);
          firstFrameMaxDelta=Math.max(firstFrameMaxDelta,Math.abs(firstImage[i]-b[i]));
          if(delta>2)changed++;
          if(a[i]!==recovered[i])stability++;
        }
        const submitted=sources.reduce((sum,source)=>sum+(source.visible?(source.children.find(child=>child.userData.instanceCompactionDraw)?.count??source.count):0),0);
        reports.push({mode,step,hash:hash([a]),canonicalHash:hash(canonical),live,submitted,
          uploads:sources.reduce((sum,source)=>({canonicalBytes:sum.canonicalBytes+(source.userData.instanceGatherUploads?.sourceUploadBytes??0),
            selectionBytes:sum.selectionBytes+(source.userData.instanceGatherUploads?.selectionUploadBytes??0)}),{canonicalBytes:0,selectionBytes:0}),
          originalSubmitted:sources.reduce((sum,source)=>sum+(source.visible?source.count:0),0),maxDelta,firstFrameMaxDelta,changed,stability});
        if(mode==='singleplayer'&&[0,3,5,9].includes(step)) {
          const canvas=document.createElement('canvas');canvas.width=320;canvas.height=192;
          for(const [label,pixels] of [['optimized',a],['reference',b]]) {
            canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),320,192),0,0);
            images.push({name:`${step}-${label}`,png:canvas.toDataURL('image/png').split(',')[1]});
          }
        }
        for(const pair of pairs)pair.dispose();
      }
      field.dispose();
    }
    geometry.dispose();target.dispose();renderer.dispose();return {reports,images};
  });
  for(const {name,png} of result.images)writeFileSync(`${output}/${name}.png`,Buffer.from(png,'base64'));
  delete result.images;
  writeFileSync(`${output}/validation.json`,JSON.stringify({...result,errors},null,2));
  assert.deepEqual(errors,[]);
  assert.ok(result.reports.every(frame=>frame.maxDelta===0&&frame.firstFrameMaxDelta===0&&frame.stability===0),JSON.stringify(result.reports));
  for(let step=0;step<12;step++) {
    assert.equal(result.reports[step].hash,result.reports[step+12].hash,`Identical mode images at step ${step}`);
    assert.equal(result.reports[step].canonicalHash,result.reports[step+12].canonicalHash,`Identical mode density/attributes at step ${step}`);
  }
  // Recorded from the original grass generator before changing submission.
  // These hash every live matrix, both RGB attributes and the wind anchor;
  // stale slots outside the current disc are deliberately included as before.
  const originalCanonicalHashes=[2209949556,2209949556,3341258248,3745195679,1305951030,1305951030,
    3745195679,2655931899,2503367739,344878703,344878703,1458400834];
  assert.deepEqual(result.reports.slice(0,12).map(frame=>frame.canonicalHash),originalCanonicalHashes,'Preserve original grass density and attributes through every streaming state');
  const frames=result.reports;
  for(const first of [0,12]) {
    assert.ok(frames[first].uploads.canonicalBytes>0,'Exercise the GPU gather');
    assert.equal(frames[first+1].uploads.canonicalBytes,frames[first].uploads.canonicalBytes,'Camera-only movement retains resident grass buffers');
    assert.ok(frames[first+1].uploads.selectionBytes>frames[first].uploads.selectionBytes,'Camera movement updates selected row IDs');
  }
  assert.ok(frames[0].live.reduce((sum,n)=>sum+n,0)>10000,'Exercise dense grass');
  assert.ok(frames[4].live[0]<frames[3].live[0],'Placement clearance removes grass');
  assert.equal(frames[6].canonicalHash,frames[3].canonicalHash,'Clearance undo restores every authored attribute');
  assert.ok(frames.some(frame=>frame.submitted>100&&frame.submitted<frame.originalSubmitted/2),'Submit less work while preserving the image');
  console.log(JSON.stringify(result));
} finally {await browser?.close();await server.close();}
