import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/uniform-upload-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('uniform-upload-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { installUniformUploadCoalescing } = await import('/src/scene/UniformUploadCoalescing.ts');
    const { StaticRenderBundle } = await import('/src/scene/StaticRenderBundle.ts');
    const { renderer, adapterEvidence } = await createPreferredRenderer();
    renderer.setSize(400, 280); renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;
    const scene = new THREE.Scene(), root = new StaticRenderBundle(); scene.add(root);
    scene.background = new THREE.Color(0x293238); scene.fog = new THREE.FogExp2(0x778899, .008);
    const wind = TSL.uniform(0), season = TSL.uniform(.2), snow = TSL.uniform(0);
    const material = new THREE.MeshStandardNodeMaterial({ roughness: .8 });
    material.positionNode = TSL.positionLocal.add(TSL.vec3(wind.mul(TSL.positionLocal.y), 0, 0));
    material.colorNode = TSL.mix(TSL.vec3(.2,.65,.1), TSL.vec3(.8,.2,.04), season).mix(TSL.vec3(.9), snow);
    const geometry = new THREE.ConeGeometry(.7, 2, 7), meshes = [];
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((i % 6 - 2.5) * 3, 1, (Math.floor(i / 6) - 1.5) * 3);
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); meshes.push(mesh);
    }
    const groundMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x8c816d });
    const groundGeometry = new THREE.PlaneGeometry(60,60), ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground, new THREE.AmbientLight(0xffffff,.5));
    const sun = new THREE.DirectionalLight(0xffffff,2); sun.position.set(12,25,10); sun.castShadow = true;
    sun.shadow.mapSize.set(512,512);
    Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:.1,far:100});
    sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48,400/280,.1,120), target = new THREE.RenderTarget(400,280);
    let writes = 0;
    const queue = renderer.backend.device.queue, write = queue.writeBuffer;
    queue.writeBuffer = function(...args) { writes++; return write.apply(this,args); };
    const frames = [];
    const capture = async () => {
      // Direct renders can occur several times between Three's own animation
      // callbacks. Each capture is a distinct frame with fresh frame uniforms
      // and shadows, regardless of asynchronous readback timing.
      renderer._nodes.nodeFrame.update();
      writes = 0; renderer.info.reset(); renderer.setRenderTarget(target); renderer.render(scene,camera);
      return { writes, calls: renderer.info.render.drawCalls,
        pixels: await renderer.readRenderTargetPixelsAsync(target,0,0,400,280) };
    };
    let animatedPixels = 0, previous;
    for (let frame = 0; frame < 12; frame++) {
      meshes[0].visible = frame%4 !== 1;
      for (let view = 0; view < 2; view++) {
        const arm = async optimized => {
          const restore = installUniformUploadCoalescing(renderer);
          if(!optimized)restore();
          // First render a different state so both arms must upload the same
          // subsequent edits, even when reusing this frame's draw commands.
          wind.value=-.45; season.value=.11; snow.value=.37; sun.intensity=.9;
          root.position.x=-2; root.invalidateTransforms();
          camera.position.set(45,30,-20); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
          sun.shadow.needsUpdate=true; await capture();
          wind.value=Math.sin(frame*.8)*.3; season.value=frame/12; snow.value=frame%3*.12;
          sun.intensity=1.8+Math.sin(frame*.5)*.2;
          root.position.x=Math.sin(frame*.6)*.7; root.invalidateTransforms();
          camera.position.set(view ? -22 : 22,19,28); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
          sun.shadow.needsUpdate=true;
          return capture();
        };
        const reference=await arm(false), actual=await arm(true);
        let changedPixels = 0, maxDifference = 0;
        for (let i = 0; i < actual.pixels.length; i += 4) {
          const difference = Math.abs(actual.pixels[i]-reference.pixels[i])
            + Math.abs(actual.pixels[i+1]-reference.pixels[i+1]) + Math.abs(actual.pixels[i+2]-reference.pixels[i+2]);
          maxDifference = Math.max(maxDifference,difference); if(difference>6)changedPixels++;
          if(view===0 && previous && Math.abs(actual.pixels[i]-previous[i])>6)animatedPixels++;
        }
        if(view===0)previous=actual.pixels;
        frames.push({frame,view,changedPixels,maxDifference,referenceWrites:reference.writes,actualWrites:actual.writes,
          referenceDraws:reference.calls,actualDraws:actual.calls});
      }
    }
    queue.writeBuffer = write;
    target.dispose(); geometry.dispose(); material.dispose(); groundMaterial.dispose(); groundGeometry.dispose(); renderer.dispose();
    return {frames,animatedPixels,adapterEvidence};
  });
  mkdirSync('artifacts/city-performance',{recursive:true});
  writeFileSync('artifacts/city-performance/uniform-upload-parity.json',JSON.stringify({result,errors},null,2));
  assert.deepEqual(errors,[]);
  for(const frame of result.frames) {
    assert.equal(frame.changedPixels,0,`Frame ${frame.frame}, view ${frame.view}: image parity`);
    assert.equal(frame.actualDraws,frame.referenceDraws,'Draw workload remains exact');
    assert(frame.actualWrites<=frame.referenceWrites,'Uploads must not increase');
  }
  assert(result.animatedPixels>1000,'Changing uniforms must change the scene');
  const saved=result.frames.reduce((sum,frame)=>sum+frame.referenceWrites-frame.actualWrites,0);
  assert(saved>0,'The native scene must exercise separated dirty uniform ranges');
  console.log(JSON.stringify({frames:result.frames.length,changedPixels:0,avoidedWrites:saved,animatedPixels:result.animatedPixels,errors}));
} finally { await browser?.close(); await server.close(); }
