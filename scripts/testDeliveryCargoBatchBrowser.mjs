import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const reference=execFileSync('git',['show','83887b25:src/logistics/deliveryCartMesh.ts'],{encoding:'utf8',windowsHide:true});
const output='artifacts/city-performance/delivery-cargo-batch';mkdirSync(output,{recursive:true});
const server=await createServer({cacheDir:'artifacts/delivery-cargo-batch-vite',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'cargo-reference',enforce:'pre',transform(_code,id){
    if(id.replaceAll('\\','/').endsWith('/src/logistics/deliveryCartMesh.ts?cargoReference'))return reference;
  },
}]});await server.listen();let browser;
try {
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/cargo-batch-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('cargo-batch-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const actual=await import('/src/logistics/deliveryCartMesh.ts'),reference=await import('/src/logistics/deliveryCartMesh.ts?cargoReference');
    const {DELIVERY_CARGO_KINDS}=await import('/src/logistics/deliveryTrips.ts');
    const {ExactMountedAttachmentBatch}=await import('/src/settlement/ExactMountedAttachmentBatch.ts');
    const {renderer,adapterEvidence}=await createPreferredRenderer();renderer.setSize(480,320);renderer.shadowMap.enabled=true;renderer.info.autoReset=false;
    const catalog=new actual.DeliveryCargoCatalog(),source=await actual.loadDeliveryCartModelSource();
    const roots=[new THREE.Group(),new THREE.Group()],scenes=roots.map(root=>{
      const scene=new THREE.Scene();scene.background=new THREE.Color(.08,.14,.18);scene.fog=new THREE.FogExp2(0x8a9aab,.006);scene.add(root);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardNodeMaterial({color:0x777555,roughness:.95}));
      ground.rotation.x=-Math.PI/2;ground.position.set(24,-.1,20);ground.receiveShadow=true;
      const box=new THREE.Mesh(new THREE.BoxGeometry(1,6,1),new THREE.MeshStandardNodeMaterial({color:0xaa7755}));box.position.set(1,3,1);box.castShadow=true;
      scene.add(ground,box,new THREE.AmbientLight(0xc5d5e2,.8));
      const sun=new THREE.DirectionalLight(0xffe6c8,2.2);sun.position.set(25,55,25);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
      Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,near:.1,far:160});sun.shadow.camera.updateProjectionMatrix();scene.add(sun);return scene;
    });
    const batch=new ExactMountedAttachmentBatch(roots[0],{initialCapacity:2,name:'Exact native cargo',separateShadows:true}),carts=[[],[]];
    const make=(side,index,loaded=true)=>{
      const kind=DELIVERY_CARGO_KINDS[Math.floor(index/2)%DELIVERY_CARGO_KINDS.length],regionalImport=index%2===1;
      const cart=(side===0?actual:reference).createDeliveryCartMesh(kind,{source,loaded,regionalImport,...(side===0?{cargoCatalog:catalog}:{})});
      // This comparison isolates cargo; unchanged authored cart bodies are
      // verified separately by the body regression and full-world capture.
      cart.userData.deliveryCartModel.removeFromParent();
      cart.position.set(index%12*4,0,Math.floor(index/12)*4);cart.rotation.y=index*.37;
      roots[side].add(cart);if(side===0&&cart.userData.deliveryCartCargo)batch.registerTool(cart.userData.deliveryCartCargo);return cart;
    };
    for(let index=0;index<DELIVERY_CARGO_KINDS.length*2;index++)for(let side=0;side<2;side++)carts[side].push(make(side,index));
    const replace=(side,index,loaded)=>{const old=carts[side][index];if(side===0&&old.userData.deliveryCartCargo)batch.unregisterTool(old.userData.deliveryCartCargo);
      old.removeFromParent();(side===0?actual:reference).disposeDeliveryCartMesh(old);carts[side][index]=make(side,index,loaded);};
    let camera=new THREE.PerspectiveCamera(46,480/320,.1,300);camera.position.set(24,65,66);camera.lookAt(24,0,22);camera.updateMatrixWorld(true);
    const target=new THREE.RenderTarget(480,320);renderer.setRenderTarget(target);
    const render=async side=>{if(side===0)batch.update(undefined,camera);renderer._nodes.nodeFrame.update();renderer.info.reset();renderer.render(scenes[side],camera);
      return {draws:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles,pixels:await renderer.readRenderTargetPixelsAsync(target,0,0,480,320)};};
    const diff=(a,b)=>{let changedPixels=0,significantPixels=0,maxDifference=0;const points=[];for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d){changedPixels++;if(points.length<10)points.push({x:i/4%480,y:Math.floor(i/4/480),actual:[...a.slice(i,i+3)],reference:[...b.slice(i,i+3)]});}if(d>6)significantPixels++;maxDifference=Math.max(maxDifference,d);}return {changedPixels,significantPixels,maxDifference,points};};
    for(let i=0;i<3;i++){await render(0);await render(1);}
    const matrixBuffers=new Set();batch.group.traverse(o=>{if(o.isInstancedMesh){const buffer=renderer.backend.get(o.instanceMatrix).buffer;if(buffer)matrixBuffers.add(buffer);}});
    let matrixWrites=0;const queue=renderer.backend.device.queue,writeBuffer=queue.writeBuffer;
    queue.writeBuffer=function(buffer,...args){if(matrixBuffers.has(buffer))matrixWrites++;return writeBuffer.call(this,buffer,...args);};
    const frames=[];
    for(let frame=0;frame<12;frame++){
      for(let side=0;side<2;side++){
        if(frame===1)for(let i=0;i<carts[side].length;i++){carts[side][i].rotation.y+=.13;carts[side][i].position.z+=.15;}
        if(frame===2)for(let i=0;i<carts[side].length;i+=5){carts[side][i].visible=false;const cargo=carts[side][i].userData.deliveryCartCargo;
          // The immutable reference lacks this metadata; its original root
          // visibility still owns every unbatched descendant.
          if(cargo)cargo.visible=false;}
        if(frame===3)for(let i=0;i<carts[side].length;i+=5){carts[side][i].visible=true;if(carts[side][i].userData.deliveryCartCargo)carts[side][i].userData.deliveryCartCargo.visible=true;}
        if(frame===4||frame===5)for(let i=0;i<20;i++)replace(side,i,frame===5);
        if(frame===6){roots[side].position.set(2,.2,-1);roots[side].rotation.y=.17;roots[side].scale.set(1.2,.8,1.1);}
        if(frame===11)for(let i=0;i<carts[side].length;i++)replace(side,i,false);
      }
      if(frame===7){camera.position.set(1,3,7);camera.lookAt(1,.7,1);}
      if(frame===8){camera=new THREE.OrthographicCamera(-25,25,17,-17,.1,300);camera.position.set(26,45,40);camera.lookAt(24,0,20);}
      if(frame===9){camera.position.set(90,20,90);camera.lookAt(160,20,160);}
      if(frame===10){camera=new THREE.PerspectiveCamera(46,480/320,.1,300);camera.position.set(24,65,66);camera.lookAt(24,0,22);}
      camera.updateMatrixWorld(true);
      const firstActual=await render(0),firstReference=await render(1);
      for(let i=0;i<2;i++){await render(0);await render(1);}
      const a=await render(0),b=await render(1);
      const before=matrixWrites;await render(0);
      frames.push({frame,...diff(a.pixels,b.pixels),firstFrame:diff(firstActual.pixels,firstReference.pixels),draws:a.draws,referenceDraws:b.draws,
        triangles:a.triangles,referenceTriangles:b.triangles,instances:batch.diagnostics().visibleMeshInstances,unchangedMatrixWrites:matrixWrites-before});
    }
    // Separate alternating CPU-render arms, excluding readback and diagnostics.
    for(let side=0;side<2;side++)for(let i=0;i<carts[side].length;i++)replace(side,i,true);
    roots.forEach(root=>{root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.set(1,1,1);});
    for(let i=0;i<3;i++){await render(0);await render(1);}
    const arms=[];
    for(let cycle=0;cycle<6;cycle++){
      const side=cycle%2,samples=[];
      for(let frame=0;frame<20;frame++){
        for(const cart of carts[side])cart.rotation.y+=.003;
        renderer._nodes.nodeFrame.update();renderer.info.reset();const start=performance.now();
        if(side===0)batch.update(undefined,camera);renderer.render(scenes[side],camera);samples.push(performance.now()-start);
        await new Promise(requestAnimationFrame);
      }
      arms.push({cycle,batched:side===0,meanCpuMs:samples.reduce((a,b)=>a+b,0)/samples.length,draws:renderer.info.render.drawCalls});
    }
    const populated=await render(0);batch.group.visible=false;const empty=await render(0);const presence=diff(populated.pixels,empty.pixels);batch.group.visible=true;
    for(const cart of carts[0])if(cart.userData.deliveryCartCargo)batch.unregisterTool(cart.userData.deliveryCartCargo);
    queue.writeBuffer=writeBuffer;batch.dispose();catalog.dispose();actual.disposeDeliveryCartModelSource(source);target.dispose();renderer.dispose();
    return {adapterEvidence,kinds:DELIVERY_CARGO_KINDS.length,provenanceVariants:2,matrixBuffers:matrixBuffers.size,frames,arms,presence};
  });
  writeFileSync(`${output}/report.json`,JSON.stringify({result,errors},null,2));console.log(JSON.stringify({output,errors,frames:result.frames,arms:result.arms,presence:result.presence}));
  assert.deepEqual(errors,[]);assert(result.presence.changedPixels>1000,'Probe must actually display cargo');
  // Instanced transforms and normal math introduce a few float-rounding or
  // intersecting-surface depth ties. Keep their small pixel count explicit,
  // alongside exact source-byte and per-pass triangle checks.
  for(const f of result.frames){assert(f.changedPixels<=8,`Native cargo pixels frame ${f.frame}`);assert(f.significantPixels<=3,`Cargo surface differences frame ${f.frame}`);
    assert(f.firstFrame.changedPixels<=8,`First cargo frame ${f.frame}`);assert(f.firstFrame.significantPixels<=3);
    assert.equal(f.triangles,f.referenceTriangles,`Exact colour and shadow triangles frame ${f.frame}`);assert.equal(f.unchangedMatrixWrites,0,`Idle matrix uploads frame ${f.frame}`);}
  assert(result.frames[0].draws<result.frames[0].referenceDraws/3,'Shared cargo must remove most render objects');
  assert.equal(result.frames[11].instances,0,'Empty returns must leave no active cargo instance');
  assert.equal(result.frames[9].draws,0,'Looking away must submit no colour or shadow cargo draws');
} finally {await browser?.close();await server.close();}
