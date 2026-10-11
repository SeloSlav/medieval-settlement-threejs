import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';

const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();let browser;
try {
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/streamed-batch-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('streamed-batch-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE,TSL}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {StreamedInstanceBatches}=await import('/src/scene/StreamedInstanceBatches.ts');
    const {setExactInstancePrototype}=await import('/src/scene/ExactInstancePrototype.ts');
    const {renderer}=await createPreferredRenderer();renderer.setSize(400,280);renderer.shadowMap.enabled=true;renderer.info.autoReset=false;
    const batches=new StreamedInstanceBatches(),roots=[new THREE.Group(),new THREE.Group()],scenes=roots.map(root=>{const s=new THREE.Scene();s.add(root);return s;});
    roots[0].add(batches.root);
    const prototypes=[new THREE.ConeGeometry(.6,2,6),new THREE.BoxGeometry(.5,1.7,.5)];
    const time=TSL.uniform(0),season=TSL.uniform(.3),snow=TSL.uniform(0);
    const material=new THREE.MeshStandardNodeMaterial({roughness:.85});
    material.positionNode=TSL.positionLocal.add(TSL.attribute('aWindVec','vec3').mul(time).mul(TSL.positionGeometry.y.max(0)));
    material.colorNode=TSL.mix(TSL.vec3(.22,.55,.16),TSL.vec3(.75,.36,.08),season).mix(TSL.vec3(1),snow).mul(TSL.attribute('aThickness','float'));
    const alternative=material.clone();alternative.roughness=.5;
    const matrix=new THREE.Matrix4(),chunks=[],pairs=[];
    for(let chunk=0;chunk<6;chunk++) {
      const groups=roots.map(root=>{const g=new THREE.Group();root.add(g);return g;});chunks.push(groups);
      for(let type=0;type<2;type++) {
        const pair=groups.map(g=>{
          const geo=prototypes[type].clone();setExactInstancePrototype(geo,prototypes[type]);
          const n=24,wind=new Float32Array(n*3),thickness=new Float32Array(n);
          for(let i=0;i<n;i++){wind.set([.1*Math.sin(i+chunk),0,.1*Math.cos(i+chunk)],i*3);thickness[i]=.8+.2*Math.sin(i*.8+chunk);}
          geo.setAttribute('aWindVec',new THREE.InstancedBufferAttribute(wind,3));geo.setAttribute('aThickness',new THREE.InstancedBufferAttribute(thickness,1));
          const mesh=new THREE.InstancedMesh(geo,material,n);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
          mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(n,16);
          // Exercise RGB sources copied into WGSL's padded vec4 storage.
          mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
          for(let i=0;i<n;i++) {
            matrix.makeTranslation((chunk%3-1)*8+(i%4-1.5)*1.25+type*.55,1+type*.1,(Math.floor(chunk/3)-.5)*8+(Math.floor(i/4)-2.5)*1.25);
            mesh.setMatrixAt(i,matrix);mesh.instanceColor.array.set([.7+(i%3)*.1,.8+(i%2)*.1,.75+type*.2],i*3);
          }
          mesh.instanceMatrix.needsUpdate=mesh.instanceColor.needsUpdate=true;g.add(mesh);return mesh;
        });pairs.push(pair);
      }
      batches.add(groups[0]);
    }
    for(const scene of scenes) {
      scene.background=new THREE.Color(.08,.1,.12);scene.fog=new THREE.FogExp2(0x778899,.01);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.MeshStandardNodeMaterial({color:0x786f63}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;
      const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(14,25,8);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
      Object.assign(sun.shadow.camera,{left:-23,right:23,top:23,bottom:-23,near:.1,far:80});sun.shadow.camera.updateProjectionMatrix();
      scene.add(ground,sun,new THREE.AmbientLight(0xffffff,.6));
    }
    const camera=new THREE.PerspectiveCamera(48,400/280,.1,120);camera.position.set(22,19,28);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const target=new THREE.RenderTarget(400,280),frames=[];
    const render=async scene=>{renderer.info.reset();renderer.setRenderTarget(target);renderer.render(scene,camera);return {calls:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles,pixels:await renderer.readRenderTargetPixelsAsync(target,0,0,400,280)};};
    for(let frame=0;frame<21;frame++) {
      time.value=Math.sin(frame*.7)*.6;season.value=frame<3?.3:.8;snow.value=frame<4?0:.4;
      if(frame===4)for(const mesh of pairs[0])mesh.count=3;
      if(frame===5)for(const mesh of pairs[0])mesh.count=24;
      if(frame===6)for(const mesh of pairs[1]){matrix.makeTranslation(0,4,0);mesh.setMatrixAt(3,matrix);mesh.instanceMatrix.needsUpdate=true;}
      if(frame===7)for(const mesh of pairs[2]){mesh.geometry.getAttribute('aThickness').setX(4,.2);mesh.geometry.getAttribute('aThickness').needsUpdate=true;}
      if(frame===8)for(const group of chunks[1])group.visible=false;
      if(frame===9)for(const group of chunks[1])group.visible=true;
      if(frame===10){batches.remove(chunks[2][0]);for(const group of chunks[2])group.removeFromParent();}
      if(frame===11){for(let side=0;side<2;side++)roots[side].add(chunks[2][side]);batches.add(chunks[2][0]);}
      if(frame===12)for(const mesh of pairs[3])mesh.material=alternative;
      if(frame===13)for(const root of roots)root.position.set(1,0,-2);
      if(frame===14)for(const mesh of pairs[4])mesh.castShadow=false;
      if(frame===15)for(const mesh of pairs[5])mesh.count=0;
      if(frame===16)for(const mesh of pairs[5])mesh.count=24;
      if(frame===17)for(const group of chunks[3])group.position.x=1; // Unsupported model matrix must retain exact original draws.
      if(frame===18)for(const mesh of pairs[6])mesh.geometry.setDrawRange(0,12);
      if(frame===19)for(const mesh of pairs[7]) {
        const positions=mesh.geometry.getAttribute('position');positions.setY(0,positions.getY(0)+1);positions.needsUpdate=true;
      }
      if(frame===20)for(const mesh of pairs[8]) {
        const index=mesh.geometry.index.clone();index.setX(0,index.getX(1));mesh.geometry.setIndex(index);
      }
      scenes.forEach(scene=>scene.updateMatrixWorld(true));
      const before=batches.stats().uploads,state=batches.prepare();
      const actual=await render(scenes[0]),reference=await render(scenes[1]);
      let changedPixels=0,maxDifference=0;
      for(let i=0;i<actual.pixels.length;i+=4) {
        const d=Math.abs(actual.pixels[i]-reference.pixels[i])+Math.abs(actual.pixels[i+1]-reference.pixels[i+1])+Math.abs(actual.pixels[i+2]-reference.pixels[i+2]);
        maxDifference=Math.max(maxDifference,d);if(d>6)changedPixels++;
      }
      frames.push({frame,changedPixels,maxDifference,actualDraws:actual.calls,referenceDraws:reference.calls,actualTriangles:actual.triangles,referenceTriangles:reference.triangles,
        uploads:batches.stats().uploads-before,batchState:state,stats:batches.stats()});
    }
    batches.dispose();
    const restored=pairs.every(pair=>pair[0].layers.mask===1&&!pair[0].userData.streamedInstanceBatchSource);
    target.dispose();renderer.dispose();return {frames,restored};
  });
  mkdirSync('artifacts/city-performance',{recursive:true});writeFileSync('artifacts/city-performance/streamed-instance-batch-parity.json',JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({result,errors}));assert.deepEqual(errors,[]);assert(result.restored);
  for(const frame of result.frames) {
    assert(frame.changedPixels<=10,`Frame ${frame.frame}: combined instances changed pixels`);
    assert.equal(frame.actualTriangles,frame.referenceTriangles,`Frame ${frame.frame}: exact triangle workload`);
    assert(frame.actualDraws<frame.referenceDraws,`Frame ${frame.frame}: compatible draws were not combined`);
  }
  assert(result.frames.slice(1,4).every(f=>f.uploads===0),'Wind/season/snow changes must reuse instance buffers');
} finally {await browser?.close();await server.close();}
