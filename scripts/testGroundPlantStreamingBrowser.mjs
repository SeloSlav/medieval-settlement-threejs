import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output='artifacts/vegetation-culling/ground-streaming';mkdirSync(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/ground-plant-probe?*',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('/ground-plant-probe?mode=singleplayer',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {createGrassBladeField}=await import('/src/grass/GrassBladeField.ts');
    const {setWorldAnimationTime}=await import('/src/scene/worldAnimationTime.ts');
    const {windStrength}=await import('/vendor/seedthree/src/core/wind.js');
    const {renderer}=await createPreferredRenderer();renderer.setSize(320,192);
    const geometry=new THREE.PlaneGeometry(1240,1240,2,2);geometry.rotateX(-Math.PI/2);
    const terrain={generationSize:1240,size:1240,resolution:3,mesh:{geometry},bounds:{minX:-620,maxX:620,minZ:-620,maxZ:620},getHeightAt:()=>0};
    const camera=new THREE.PerspectiveCamera(50,320/192,.1,500),target=new THREE.RenderTarget(320,192);
    const hash=pixels=>{let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619)>>>0;return hash;};
    const capture=async scene=>{renderer._nodes.nodeFrame.update();renderer.setRenderTarget(target);renderer.render(scene,camera);
      return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,320,192));};
    const reports=[];
    for(const mode of ['singleplayer','multiplayer']) {
      history.replaceState({},'',`/ground-plant-probe?mode=${mode}`);
      // Both environments enter exactly the same factory and selection code.
      const fields=[await createGrassBladeField(terrain,{rendererBackend:'webgpu',renderer}),
        await createGrassBladeField(terrain,{rendererBackend:'webgpu'})];
      const scenes=fields.map(field=>{const scene=new THREE.Scene();scene.background=new THREE.Color(.13,.17,.21);
        scene.add(field.group,new THREE.AmbientLight(0xffffff,.8));const sun=new THREE.DirectionalLight(0xfff1d4,2);sun.position.set(20,40,10);scene.add(sun);return scene;});
      for(let step=0;step<6;step++) {
        const [x,z,distance]=[[0,10,8.8],[18,8,8.8],[18,28,32],[0,10,8.8],[0,10,8.8],[0,10,8.8]][step];
        camera.position.set(x,step===2?12:1.6,z);const focus=new THREE.Vector3(x,0,z-10);camera.lookAt(focus);camera.updateMatrixWorld(true);
        setWorldAnimationTime(12.5+step*.7);windStrength.value=step===0?0:1.3;
        for(const field of fields) {
          if(step===3)field.syncPlacementClearance([[{x:-6,z:-6},{x:6,z:-6},{x:6,z:6},{x:-6,z:6}]]);
          if(step===5)field.syncPlacementClearance([]);
          field.setEnvironment({deciduousFoliage:{springFlush:step===4?0:1,autumnColor:step===4?.8:0,dormancy:step===4?1:0},snowCoverage:step===4?.8:0});
          field.primeAndFreezeStream(camera.position,focus,distance,true);
          for(let iteration=0;!field.isStreamSettled();iteration++) {
            if(iteration>3000)throw Error('Flower streaming failed to converge');
            field.updateCameraState(camera.position,focus,distance,true);
            if(iteration%32===0)await new Promise(resolve=>setTimeout(resolve,0));
          }
          field.prepareRender(camera);
          for(const object of field.group.children)if(/^SeedThree grass (meadow|clump)$/.test(object.name))object.visible=false;
        }
        const sources=fields.map(field=>field.group.children.filter(object=>object.name.startsWith('SeedThree streamed ')));
        for(let i=0;i<sources[0].length;i++) {
          const a=sources[0][i],b=sources[1][i];if(a.count!==b.count)throw Error('Flower LOD instance counts changed');
          for(let c=0;c<a.count*16;c++)if(a.instanceMatrix.array[c]!==b.instanceMatrix.array[c])throw Error('Flower stream changed canonical transforms');
        }
        const a=await capture(scenes[0]),b=await capture(scenes[1]);let changed=0,maxDelta=0;
        for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);maxDelta=Math.max(maxDelta,delta);if(delta>2)changed++;}
        reports.push({mode,step,hash:hash(a),changedChannels:changed,maxDelta,
          flowers:fields[0].getStreamTelemetry().wildflowerLiveInstances,submitted:fields[0].getStreamTelemetry().wildflowerSubmittedInstances});
      }
      for(const field of fields)field.dispose();
    }
    geometry.dispose();target.dispose();renderer.dispose();return reports;
  });
  writeFileSync(`${output}/validation.json`,JSON.stringify({result,errors},null,2));
  assert.deepEqual(errors,[]);assert.ok(result.every(frame=>frame.changedChannels===0));
  for(let step=0;step<6;step++)assert.equal(result[step].hash,result[step+6].hash,`Both modes must render identically at stream step ${step}`);
  assert.ok(result.some(frame=>frame.flowers>1000));console.log(JSON.stringify({result,errors}));
  assert.ok(result.some(frame=>frame.submitted>100),'Compare visible flower draws');
  assert.ok(result[3].flowers<result[0].flowers,'Placement clearance must actually remove flowers');
  assert.equal(result[5].flowers,result[0].flowers,'Removing clearance must restore the deterministic plants');
} finally {await browser?.close();await server.close();}
