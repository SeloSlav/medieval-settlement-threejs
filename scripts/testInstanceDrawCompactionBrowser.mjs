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
    for (const gpu of [false,true]) for (const n of [400, 1601]) for (const indexed of [true, false]) for (const grouped of [false, true]) {
    const sourceGeometry = new THREE.SphereGeometry(.9, 8, 5);
    const geometry = indexed ? sourceGeometry : sourceGeometry.toNonIndexed();
    const offsets = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    for (let i=0;i<n;i++) { offsets.set([Math.sin(i),.5*Math.cos(i),Math.sin(i*.31)],i*3); colors.set([(i%5)/5,.3+(i%7)/10,.2+(i%3)/3],i*3); }
    geometry.setAttribute('offset',new THREE.InstancedBufferAttribute(offsets,3));
    geometry.setAttribute('tint',new THREE.InstancedBufferAttribute(colors,3));
    const byteColors = new Uint8Array(n*3);
    for(let i=0;i<byteColors.length;i++)byteColors[i]=40+(i*47)%216;
    const byteTint = new THREE.InstancedBufferAttribute(byteColors,3,true);
    geometry.setAttribute('byteTint',byteTint);geometry.setAttribute('byteTintAlias',byteTint);geometry.setAttribute('color',byteTint);
    const clock = TSL.uniform(.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.vertexColors=true;material.alphaTest=.25;
    material.positionNode = TSL.positionLocal.add(TSL.attribute('offset','vec3').mul(clock));
    material.colorNode = TSL.attribute('tint','vec3').mul(TSL.attribute('byteTint','vec3'));
    const otherMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xc4a627 });
    if (grouped) {
      geometry.clearGroups(); const count = geometry.index?.count ?? geometry.getAttribute('position').count;
      const split = Math.floor(count / 6) * 3; geometry.addGroup(0,split,0); geometry.addGroup(split,count-split,1);
    }
    const drawMaterial = grouped ? [material,otherMaterial] : material;
    const actual = new THREE.InstancedMesh(geometry,drawMaterial,n), expected = new THREE.InstancedMesh(geometry.clone(),drawMaterial,n);
    expected.geometry.setAttribute('color',expected.geometry.getAttribute('byteTint'));
    expected.geometry.setAttribute('byteTintAlias',expected.geometry.getAttribute('byteTint'));
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
    const shadowSource = new THREE.InstancedMesh(actual.geometry, drawMaterial, n);
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
    const compaction = new InstanceDrawCompaction(actual,2,{skipCollapsed:true,instanceGroupSize:16,renderer:gpu?renderer:undefined});
    if(!!compaction.gather !== (gpu&&n>=1024))throw Error('Use the same hardware/capacity selection in every mode');
    if(compaction.gather && compaction.draw.geometry.getAttribute('byteTint')!==compaction.draw.geometry.getAttribute('byteTintAlias'))throw Error('Retain aliased plant attributes');
    const shadowCompaction = new InstanceDrawCompaction(shadowSource,2,{skipCollapsed:true,instanceGroupSize:16});
    if(compaction.draw.count!==0||shadowCompaction.draw.count!==0)throw new Error('Uninitialized draws must be empty');
    const target = new THREE.RenderTarget(480,320), camera = new THREE.PerspectiveCamera(45,1.5,.1,110);
    const pixels = async scene => {renderer._nodes.nodeFrame.update();renderer.setRenderTarget(target);renderer.render(scene,camera);return renderer.readRenderTargetPixelsAsync(target,0,0,480,320);};
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
      if(frame===18) for(const mesh of [actual,expected]) {
        mesh.setMatrixAt(n-1,new THREE.Matrix4().makeTranslation(0,2,3));
        mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange((n-1)*16,16);mesh.instanceMatrix.needsUpdate=true;
        const tint=mesh.geometry.getAttribute('byteTint');tint.array[(n-1)*3]=239;
        tint.clearUpdateRanges();tint.addUpdateRange((n-1)*3,1);tint.needsUpdate=true;
      }
      shadowSource.count=actual.count;
      const uploadBefore=compaction.gather?.stats.sourceUploadBytes ?? 0;
      compaction.prepare(camera);shadowCompaction.prepare(null);
      if(compaction.gather&&frame>0&&frame<5&&compaction.gather.stats.sourceUploadBytes!==uploadBefore)throw Error('Camera movement reuploaded canonical plant data');
      if(frame===16) for(const row of [7,8]) {
        for(const mesh of [actual,expected]) {
          const tint=mesh.geometry.getAttribute('byteTint');
          tint.array[row*3]=row*19;tint.clearUpdateRanges();tint.addUpdateRange(row*3,1);tint.needsUpdate=true;
          mesh.instanceMatrix.array[row*16+12]+=.25;mesh.instanceMatrix.clearUpdateRanges();
          mesh.instanceMatrix.addUpdateRange(row*16+12,1);mesh.instanceMatrix.needsUpdate=true;
        }
        compaction.prepare(camera);shadowCompaction.prepare(null);
      }
      if(frame===16) { expected.geometry.getAttribute('byteTint').clearUpdateRanges();expected.instanceMatrix.clearUpdateRanges(); }
      if(frame===10)actual.instanceMatrix.clearUpdateRanges();
      const a=await pixels(scenes[0]), b=await pixels(scenes[1]);let difference=0;
      for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)difference++;
      const selected = [];
      for(let range=0;range<compaction.copyRanges.length;range+=3) {
        const start=compaction.copyRanges[range],length=compaction.copyRanges[range+2];
        for(let i=0;i<length;i++)selected.push(start+i);
      }
      for(const pair of compaction.gather?.pairs ?? compaction.pairs) {
        const raw = compaction.gather ? new Float32Array(await renderer.getArrayBufferAsync(pair.output)) : pair.output.array;
        const floats=pair.source.array instanceof Float32Array;
        const data=floats?new Uint32Array(raw.buffer,raw.byteOffset,raw.byteLength/4):raw;
        const canonical=floats?new Uint32Array(pair.source.array.buffer,pair.source.array.byteOffset,pair.source.array.length):pair.source.array;
        for(let row=0;row<compaction.submittedInstances;row++)for(let k=0;k<pair.source.itemSize;k++) {
          const expected=canonical[selected[row]*pair.source.itemSize+k];
          const difference=compaction.gather&&!floats ? Math.abs(data[row*pair.output.itemSize+k] - expected/(pair.source.normalized?255:1))
            : data[row*pair.output.itemSize+k]===expected?0:1;
          if(difference>1e-7)throw new Error(`Compaction changed an authored attribute: gpu=${gpu}, n=${n}, frame=${frame}, row=${row}, component=${k}, delta=${difference}`);
        }
      }
      frames.push({frame,submitted:compaction.submittedInstances,shadowSubmitted:shadowCompaction.submittedInstances,total:actual.count,difference});
      if(frame===14&&selected.includes(23))throw new Error('Collapsed cleared-tree slot was submitted');
      if(frame===15&&!selected.includes(23))throw new Error('Restored tree did not re-enter the draw');
    }
    compaction.dispose();
    shadowCompaction.dispose();shadowSource.removeFromParent();actual.castShadow=true;
    const a=await pixels(scenes[0]),b=await pixels(scenes[1]);let restoredDifference=0;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])restoredDifference++;
    reports.push({gpu,n,indexed,grouped,frames,restoredDifference});
    target.dispose();actual.dispose();expected.dispose();geometry.dispose();sourceGeometry.dispose();expected.geometry.dispose();material.dispose();otherMaterial.dispose();
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
