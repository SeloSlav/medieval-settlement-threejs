import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';

const output='artifacts/city-performance/delivery-worker-gpu';mkdirSync(output,{recursive:true});
const server=await createServer({cacheDir:'artifacts/delivery-worker-gpu-vite',server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/delivery-worker-gpu-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('delivery-worker-gpu-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {DeliveryWorkerBatches}=await import('/src/logistics/DeliveryWorkerBatches.ts');
    const workerModule=await import('/src/logistics/deliveryCartWorker.ts');
    const sources=await workerModule.loadDeliveryCartWorkerSources();
    const {renderer,adapterEvidence}=await createPreferredRenderer();renderer.setSize(480,320);renderer.shadowMap.enabled=true;
    const roots=[new THREE.Group(),new THREE.Group()],scenes=roots.map(root=>{
      const scene=new THREE.Scene();scene.add(root,new THREE.HemisphereLight(0xffffff,0x444444,2));
      scene.background=new THREE.Color(0x222831);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardNodeMaterial({color:0x887c67}));
      ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
      const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(15,30,10);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
      Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:.1,far:100});sun.shadow.camera.updateProjectionMatrix();scene.add(sun);return scene;
    });
    const batches=[new DeliveryWorkerBatches(roots[0],sources),new DeliveryWorkerBatches(roots[1],sources,{gpuAnimation:false})];
    const workers=Array.from({length:48},(_,i)=>batches.map((batch,side)=>{
      const cart=new THREE.Group();cart.position.set(i%8*2-7,0,Math.floor(i/8)*2-5);cart.rotation.y=i*.17;roots[side].add(cart);
      const worker=workerModule.createDeliveryCartWorkerVisual(i*523+47,sources,i%3,i%2===0);cart.add(worker.root);batch.register(worker);return worker;
    }));
    batches.forEach(batch=>batch.reserve(workers.length));
    const camera=new THREE.PerspectiveCamera(45,480/320,.1,200);camera.position.set(15,14,22);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
    const target=new THREE.RenderTarget(480,320);renderer.setRenderTarget(target);
    const prepare=(side,frame,dt)=>{
      batches[side].begin();const order=frame%2?workers.slice().reverse():workers;
      for(let i=0;i<order.length;i++){
        const worker=order[i][side];worker.root.parent.rotation.y+=.007;worker.root.parent.position.y=Math.sin(frame*.1)*.03;
        workerModule.updateDeliveryCartWorkerVisual(worker,dt,frame%8<4,1.1+frame%3*.4);
        if(frame===6&&i%4===0)continue;
        batches[side].add(worker);
      }
      batches[side].finish();
    };
    const render=async side=>{renderer._nodes.nodeFrame.update();renderer.render(scenes[side],camera);return renderer.readRenderTargetPixelsAsync(target,0,0,480,320);};
    const frames=[];let maxPaletteError=0,maxWorldVertexError=0,vertexChecks=0,gpuSamples=0;const observer=()=>{};
    for(let frame=0;frame<16;frame++){
      if(frame===10)for(const worker of workers[1])worker.mixer.addEventListener('loop',observer);
      if(frame===11)for(const worker of workers[1])worker.mixer.removeEventListener('loop',observer);
      if(frame===2)batches.forEach(batch=>batch.reserve(128));
      for(let side=0;side<2;side++){if(frame===9){roots[side].position.set(1,.3,-2);roots[side].rotation.y=.2;roots[side].scale.set(1.2,.8,1.1);}prepare(side,frame,frame===5?0:1/60);}
      const firstActual=await render(0),firstReference=await render(1);
      if(frame===0){for(let i=0;i<3;i++){await render(0);await render(1);}}
      const a=await render(0),b=await render(1);
      let changedPixels=0,significantPixels=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d)changedPixels++;if(d>6)significantPixels++;}
      let evaluated=0,cpuOnly=0;
      for(const variant of ['man','woman']){
        const actual=batches[0].batches[variant],reference=batches[1].batches[variant];
        const values=new Float32Array(await renderer.getArrayBufferAsync(actual.posePalette)),expected=reference.posePalette.array;
        evaluated+=actual.diagnostics().gpuEvaluatedInstances;cpuOnly+=actual.count-actual.diagnostics().gpuEvaluatedInstances;
        for(let i=0;i<actual.count*actual.boneCount*16;i++)maxPaletteError=Math.max(maxPaletteError,Math.abs(values[i]-expected[i]));
        const geometry=actual.sourceLayers[0].geometry,bind=actual.sourceLayers[0].bindMatrix,p=geometry.attributes.position,indices=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
        const vertex=new THREE.Vector3(),value=new THREE.Vector3(),pa=new THREE.Vector3(),pb=new THREE.Vector3(),bone=new THREE.Matrix4();
        for(let slot=0;slot<actual.count;slot++){
          const matrix=new THREE.Matrix4().fromArray(actual.instanceMatrices.array,slot*16).premultiply(actual.group.matrixWorld);
          for(let v=0;v<p.count;v+=101){vertex.fromBufferAttribute(p,v).applyMatrix4(bind);pa.set(0,0,0);pb.set(0,0,0);
            for(let k=0;k<4;k++){const index=indices.getComponent(v,k),weight=weights.getComponent(v,k);if(!weight)continue;
              pa.addScaledVector(value.copy(vertex).applyMatrix4(bone.fromArray(values,(slot*actual.boneCount+index)*16)),weight);
              pb.addScaledVector(value.copy(vertex).applyMatrix4(bone.fromArray(expected,(slot*actual.boneCount+index)*16)),weight);}
            maxWorldVertexError=Math.max(maxWorldVertexError,pa.applyMatrix4(matrix).distanceTo(pb.applyMatrix4(matrix)));vertexChecks++;}
        }
      }
      gpuSamples+=evaluated;
      frames.push({frame,changedPixels,significantPixels,evaluated,cpuOnly});
      if(frame===12){
        const worker=workers[1][0];batches[0].unregister(worker);
        if(worker.advanceAnimation)throw Error('Unregistration retained GPU animation ownership');
        // Re-register after restoring its current CPU pose and colour binding.
        batches[0].register(worker);
      }
    }
    const arms=[];
    for(let cycle=0;cycle<6;cycle++){
      const side=cycle%2,samples=[],renderSamples=[];
      for(let frame=0;frame<30;frame++){
        const start=performance.now();prepare(side,frame,1/60);samples.push(performance.now()-start);
        renderer._nodes.nodeFrame.update();const renderStart=performance.now();renderer.render(scenes[side],camera);renderSamples.push(performance.now()-renderStart);await new Promise(requestAnimationFrame);
      }
      arms.push({cycle,gpu:side===0,meanUpdateMs:samples.reduce((a,b)=>a+b,0)/samples.length,
        meanRenderCpuMs:renderSamples.reduce((a,b)=>a+b,0)/renderSamples.length});
    }
    batches.forEach(batch=>batch.dispose());for(const pair of workers)pair.forEach(worker=>workerModule.disposeDeliveryCartWorkerVisual(worker));
    workerModule.disposeDeliveryCartWorkerSources(sources);target.dispose();renderer.dispose();
    return {adapterEvidence,frames,maxPaletteError,maxWorldVertexError,vertexChecks,gpuSamples,arms};
  });
  writeFileSync(`${output}/report.json`,JSON.stringify({result,errors},null,2));console.log(JSON.stringify({output,errors,...result,adapterEvidence:undefined}));
  assert.deepEqual(errors,[]);assert(result.gpuSamples>300);assert(result.vertexChecks>10000);assert(result.maxWorldVertexError<.0001);
  assert(result.frames.every(f=>f.evaluated>0&&f.cpuOnly>0),'Both GPU animation and CPU-constrained haulers must be exercised');
  assert(result.frames[10].cpuOnly>result.frames[9].cpuOnly,'An observed mixer must fall back to CPU evaluation');
  assert.equal(result.frames[11].evaluated,result.frames[9].evaluated,'Removed observers must restore GPU evaluation');
  assert(result.frames.every(f=>f.significantPixels<=10),'GPU animation must preserve the rendered bodies and shadows');
}finally{await browser?.close();await server.close();}
