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
    const { InstanceDrawCompaction } = await import('/src/scene/InstanceDrawCompaction.ts');
    const { renderer } = await createPreferredRenderer(); renderer.setSize(480,320);
    renderer.shadowMap.enabled = true;
    const reports = [];
    // Exercise both uniform-backed and large interleaved instance matrices.
    for (const n of [400, 1600]) for (const indexed of [true, false]) {
    const sourceGeometry = new THREE.SphereGeometry(.9, 8, 5);
    const geometry = indexed ? sourceGeometry : sourceGeometry.toNonIndexed();
    const offsets = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    for (let i=0;i<n;i++) { offsets.set([Math.sin(i),.5*Math.cos(i),Math.sin(i*.31)],i*3); colors.set([(i%5)/5,.3+(i%7)/10,.2+(i%3)/3],i*3); }
    geometry.setAttribute('offset',new THREE.InstancedBufferAttribute(offsets,3));
    geometry.setAttribute('tint',new THREE.InstancedBufferAttribute(colors,3));
    const clock = TSL.uniform(.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = TSL.positionLocal.add(TSL.attribute('offset','vec3').mul(clock));
    material.colorNode = TSL.attribute('tint','vec3');
    const actual = new THREE.InstancedMesh(geometry,material,n), expected = new THREE.InstancedMesh(geometry.clone(),material,n);
    // The full reference must upload this frame's matrices independently of
    // Three's deferred interleaved-version synchronization for large forests.
    actual.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    expected.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    actual.instanceColor = new THREE.InstancedBufferAttribute(colors.slice(),3).setUsage(THREE.DynamicDrawUsage);
    expected.instanceColor = actual.instanceColor.clone();
    actual.frustumCulled = expected.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    for(let i=0;i<n;i++) { matrix.makeTranslation((i%20-10)*4,Math.sin(i), (Math.floor(i/20)-10)*4);actual.setMatrixAt(i,matrix);expected.setMatrixAt(i,matrix); }
    actual.instanceMatrix.needsUpdate = expected.instanceMatrix.needsUpdate = true;
    const scenes = [new THREE.Scene(),new THREE.Scene()]; scenes[0].add(actual);scenes[1].add(expected);
    scenes.forEach(s => s.background = new THREE.Color(.1,.1,.1));
    const shadowSource = new THREE.InstancedMesh(actual.geometry, material, n);
    shadowSource.instanceMatrix = actual.instanceMatrix;
    shadowSource.instanceColor = actual.instanceColor;
    shadowSource.castShadow = true; shadowSource.frustumCulled = false;
    shadowSource.layers.set(1); scenes[0].add(shadowSource);
    expected.castShadow = true;
    for (const scene of scenes) {
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(25, 45, 15); sun.castShadow = true;
      Object.assign(sun.shadow.camera, {left:-65,right:65,top:65,bottom:-65,near:.1,far:160});
      sun.shadow.camera.layers.enable(1); sun.shadow.mapSize.set(1024,1024);
      sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(180,180), new THREE.MeshStandardNodeMaterial({color:0x888888}));
      ground.rotation.x=-Math.PI/2;ground.position.y=-3;ground.receiveShadow=true;scene.add(ground);
      scene.add(new THREE.AmbientLight(0xffffff,.4));
    }
    const compaction = new InstanceDrawCompaction(actual,2,{skipCollapsed:true});
    const shadowCompaction = new InstanceDrawCompaction(shadowSource,2,{skipCollapsed:true});
    if(compaction.draw.count!==0||shadowCompaction.draw.count!==0)throw new Error('Uninitialized draws must be empty');
    const target = new THREE.RenderTarget(480,320), camera = new THREE.PerspectiveCamera(45,1.5,.1,110);
    const pixels = async scene => {renderer.setRenderTarget(target);renderer.render(scene,camera);return renderer.readRenderTargetPixelsAsync(target,0,0,480,320);};
    const frames = [];
    for(let frame=0;frame<20;frame++) {
      const angle=frame*.43;clock.value=Math.sin(frame);
      camera.position.set(Math.sin(angle)*38,22,Math.cos(angle)*38);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
      if(frame===16) { camera.position.set(500,300,500);camera.lookAt(600,300,600);camera.updateMatrixWorld(true); }
      if(frame===18) actual.count=expected.count=0;
      if(frame===19) actual.count=expected.count=n;
      if(frame===5) { matrix.makeTranslation(1,2,3);actual.setMatrixAt(30,matrix);expected.setMatrixAt(30,matrix);actual.instanceMatrix.needsUpdate=expected.instanceMatrix.needsUpdate=true; }
      if(frame===7) actual.count=expected.count=170;
      if(frame===9) actual.count=expected.count=n;
      if(frame===10) {
        // Simulate sparse edits separated by a consumed upload range. Bounds
        // must include both edits when prepare() observes a version jump.
        for(const index of [15,16]) {
          matrix.makeTranslation(index-15,1,0);
          for(const mesh of [actual,expected]) {
            mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(index*16,16);mesh.instanceMatrix.needsUpdate=true;
          }
        }
        // The full reference uses complete uploads, independently of selection.
        expected.instanceMatrix.clearUpdateRanges();
      }
      if(frame===12) { actual.geometry.getAttribute('offset').setXYZ(14,1,2,0); expected.geometry.getAttribute('offset').setXYZ(14,1,2,0);actual.geometry.getAttribute('offset').needsUpdate=expected.geometry.getAttribute('offset').needsUpdate=true; }
      if(frame===13) {
        for(const mesh of [actual,expected]) {mesh.instanceColor.setXYZ(14,1,.1,.9);mesh.instanceColor.needsUpdate=true;}
      }
      if(frame===14||frame===15) { if(frame===14)matrix.makeScale(0,0,0);else matrix.makeTranslation(0,1,0);actual.setMatrixAt(23,matrix);expected.setMatrixAt(23,matrix);actual.instanceMatrix.needsUpdate=expected.instanceMatrix.needsUpdate=true; }
      shadowSource.count=actual.count;
      compaction.prepare(camera);shadowCompaction.prepare(null);
      if(frame===10)actual.instanceMatrix.clearUpdateRanges();
      const a=await pixels(scenes[0]), b=await pixels(scenes[1]);let difference=0;
      for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)difference++;
      for(const pair of compaction.pairs) {
        const data=new Uint32Array(pair.output.array.buffer);
        const canonical=new Uint32Array(pair.source.array.buffer);
        for(let row=0;row<compaction.submittedInstances;row++)for(let k=0;k<pair.source.itemSize;k++) {
          if(data[row*pair.source.itemSize+k]!==canonical[compaction.selected[row]*pair.source.itemSize+k])throw new Error('Compaction changed an authored attribute bit');
        }
      }
      frames.push({frame,submitted:compaction.submittedInstances,shadowSubmitted:shadowCompaction.submittedInstances,total:actual.count,difference});
      if(frame===14&&compaction.selected.slice(0,compaction.submittedInstances).includes(23))throw new Error('Collapsed cleared-tree slot was submitted');
      if(frame===15&&!compaction.selected.slice(0,compaction.submittedInstances).includes(23))throw new Error('Restored tree did not re-enter the draw');
    }
    compaction.dispose();
    shadowCompaction.dispose();shadowSource.removeFromParent();actual.castShadow=true;
    const a=await pixels(scenes[0]),b=await pixels(scenes[1]);let restoredDifference=0;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])restoredDifference++;
    reports.push({n,indexed,frames,restoredDifference});
    target.dispose();actual.dispose();expected.dispose();geometry.dispose();sourceGeometry.dispose();expected.geometry.dispose();material.dispose();
    }
    renderer.dispose();return reports;
  });
  mkdirSync('artifacts/city-performance',{recursive:true});writeFileSync('artifacts/city-performance/instance-compaction-parity.json',JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({result,errors}));
  assert.deepEqual(errors,[]);
  for(const report of result) {
    assert.ok(report.frames.every(f=>f.difference<=10));
    assert.ok(report.frames.every(f=>f.submitted<=f.total));
    assert.equal(report.frames[16].submitted,0);assert.equal(report.frames[18].submitted,0);
    assert.ok(report.frames[17].submitted>0);assert.ok(report.frames[19].submitted>0);
    assert.equal(report.restoredDifference,0);
  }
} finally {await browser?.close();await server.close();}
