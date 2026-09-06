import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen(); let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/instance-selection-probe', r => r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('instance-selection-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { GpuInstanceDrawCompaction } = await import('/src/scene/GpuInstanceDrawCompaction.ts');
    const { renderer } = await createPreferredRenderer(); renderer.setSize(480,320);
    const geometry = new THREE.SphereGeometry(.9, 8, 5);
    const n = 400, offsets = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    for (let i=0;i<n;i++) { offsets.set([Math.sin(i),.5*Math.cos(i),Math.sin(i*.31)],i*3); colors.set([(i%5)/5,.3+(i%7)/10,.2+(i%3)/3],i*3); }
    geometry.setAttribute('offset',new THREE.InstancedBufferAttribute(offsets,3));
    geometry.setAttribute('tint',new THREE.InstancedBufferAttribute(colors,3));
    const clock = TSL.uniform(.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = TSL.positionLocal.add(TSL.attribute('offset','vec3').mul(clock));
    material.colorNode = TSL.attribute('tint','vec3');
    const actual = new THREE.InstancedMesh(geometry,material,n), expected = new THREE.InstancedMesh(geometry.clone(),material,n);
    actual.frustumCulled = expected.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    for(let i=0;i<n;i++) { matrix.makeTranslation((i%20-10)*4,Math.sin(i), (Math.floor(i/20)-10)*4);actual.setMatrixAt(i,matrix);expected.setMatrixAt(i,matrix); }
    actual.instanceMatrix.needsUpdate = expected.instanceMatrix.needsUpdate = true;
    const scenes = [new THREE.Scene(),new THREE.Scene()]; scenes[0].add(actual);scenes[1].add(expected);
    scenes.forEach(s => s.background = new THREE.Color(.1,.1,.1));
    const compaction = new GpuInstanceDrawCompaction(actual,2);
    const target = new THREE.RenderTarget(480,320), camera = new THREE.PerspectiveCamera(45,1.5,.1,110);
    const pixels = async scene => {renderer.setRenderTarget(target);renderer.render(scene,camera);return renderer.readRenderTargetPixelsAsync(target,0,0,480,320);};
    const frames = [];
    for(let frame=0;frame<16;frame++) {
      const angle=frame*.43;clock.value=Math.sin(frame);
      camera.position.set(Math.sin(angle)*38,22,Math.cos(angle)*38);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
      if(frame===5) { matrix.makeTranslation(1,2,3);actual.setMatrixAt(30,matrix);expected.setMatrixAt(30,matrix);actual.instanceMatrix.needsUpdate=expected.instanceMatrix.needsUpdate=true; }
      if(frame===7) actual.count=expected.count=170;
      if(frame===9) actual.count=expected.count=n;
      if(frame===12) { actual.geometry.getAttribute('offset').setXYZ(14,1,2,0); expected.geometry.getAttribute('offset').setXYZ(14,1,2,0);actual.geometry.getAttribute('offset').needsUpdate=expected.geometry.getAttribute('offset').needsUpdate=true; }
      const a=await pixels(scenes[0]), b=await pixels(scenes[1]);let difference=0;
      for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)difference++;
      for(const input of compaction.inputs) {
        const data=new Uint32Array(await renderer.getArrayBufferAsync(input.attribute));
        const canonical=new Uint32Array(input.attribute.array.buffer);
        for(let row=0;row<compaction.submittedInstances;row++)for(let k=0;k<input.attribute.itemSize;k++) {
          if(data[row*input.attribute.itemSize+k]!==canonical[compaction.selected[row]*input.attribute.itemSize+k])throw new Error('Compaction changed an authored attribute bit');
        }
      }
      frames.push({frame,submitted:compaction.submittedInstances,total:actual.count,difference});
    }
    actual.removeFromParent();
    const retired = compaction.inputs.map(input => input.attribute);
    compaction.dispose();
    if(retired.some(attribute => renderer._attributes.has(attribute)))throw new Error('Disposed compaction retained GPU buffers');
    renderer.dispose();return {frames};
  });
  mkdirSync('artifacts/city-performance',{recursive:true});writeFileSync('artifacts/city-performance/instance-compaction-parity.json',JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({result,errors}));
  assert.deepEqual(errors,[]);assert.ok(result.frames.every(f=>f.difference<=10));assert.ok(result.frames.every(f=>f.submitted<f.total));
} finally {await browser?.close();await server.close();}
