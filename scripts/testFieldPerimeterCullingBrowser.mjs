import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const reference=execFileSync('git',['show','75bc1212:src/farming/FarmFieldPerimeterShrubs.ts'],{encoding:'utf8',windowsHide:true});
const output='artifacts/city-performance/field-perimeter-culling';mkdirSync(output,{recursive:true});
const server=await createServer({cacheDir:'artifacts/field-perimeter-culling-vite',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'hedge-reference',enforce:'pre',transform(_code,id){
    if(id.replaceAll('\\','/').endsWith('/src/farming/FarmFieldPerimeterShrubs.ts?hedgeReference'))return reference;
  },
}]});await server.listen();let browser;
try {
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/hedge-cull-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('hedge-cull-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {createFieldPerimeterShrubCatalog}=await import('/src/props/ForestUndergrowth.ts');
    const {createFieldPerimeterShrubGroup:actualGroup}=await import('/src/farming/FarmFieldPerimeterShrubs.ts');
    const {createFieldPerimeterShrubGroup:referenceGroup}=await import('/src/farming/FarmFieldPerimeterShrubs.ts?hedgeReference');
    const {setWorldAnimationTime}=await import('/src/scene/worldAnimationTime.ts');
    const {windStrength}=await import('/vendor/seedthree/src/core/wind.js');
    const {renderer,adapterEvidence}=await createPreferredRenderer();renderer.setSize(400,280);renderer.shadowMap.enabled=true;renderer.info.autoReset=false;
    const fields=Array.from({length:100},(_,i)=>({id:`native-hedge-${i}`,corners:[{x:i%10*24,z:Math.floor(i/10)*24},
      {x:i%10*24+18,z:Math.floor(i/10)*24},{x:i%10*24+18,z:Math.floor(i/10)*24+18},{x:i%10*24,z:Math.floor(i/10)*24+18}]}));
    const catalogs=await Promise.all([createFieldPerimeterShrubCatalog(4,'webgpu'),createFieldPerimeterShrubCatalog(4,'webgpu')]);
    const roots=[actualGroup(fields,()=>0,catalogs[0]),referenceGroup(fields,()=>0,catalogs[1])];
    const scenes=roots.map(root=>{
      const scene=new THREE.Scene();scene.background=new THREE.Color(.08,.14,.18);scene.fog=new THREE.FogExp2(0x8a9aab,.001);scene.add(root);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.MeshStandardNodeMaterial({color:0x777555,roughness:.95}));
      ground.rotation.x=-Math.PI/2;ground.position.set(120,-.2,120);ground.receiveShadow=true;
      const box=new THREE.Mesh(new THREE.BoxGeometry(3,10,3),new THREE.MeshStandardNodeMaterial({color:0xaa7755}));box.position.set(9,5,9);box.castShadow=true;
      scene.add(ground,box,new THREE.AmbientLight(0xc5d5e2,.8));
      const sun=new THREE.DirectionalLight(0xffe6c8,2.2);sun.position.set(25,55,25);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
      Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:.1,far:160});sun.shadow.camera.updateProjectionMatrix();scene.add(sun);return scene;
    });
    let camera=new THREE.PerspectiveCamera(46,400/280,.1,2000);camera.position.set(120,240,270);camera.lookAt(120,0,120);camera.updateMatrixWorld(true);
    const target=new THREE.RenderTarget(400,280);renderer.setRenderTarget(target);
    const render=async side=>{renderer._nodes.nodeFrame.update();renderer.info.reset();renderer.render(scenes[side],camera);return {draws:renderer.info.render.drawCalls,
      triangles:renderer.info.render.triangles,pixels:await renderer.readRenderTargetPixelsAsync(target,0,0,400,280)};};
    const diff=(a,b)=>{let changedPixels=0,maxDifference=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d)changedPixels++;maxDifference=Math.max(maxDifference,d);}return {changedPixels,maxDifference};};
    for(let i=0;i<3;i++){await render(0);await render(1);}
    const nativeBuffers=()=>{const result=new Set();roots[0].traverse(o=>{if(o.geometry)for(const a of [o.geometry.index,...Object.values(o.geometry.attributes),o.instanceMatrix,o.instanceColor]){
      if(a){const b=renderer.backend.get(a.isInterleavedBufferAttribute?a.data:a).buffer;if(b)result.add(b);}}});return result;};
    const initial=nativeBuffers(),frames=[];
    let hedgeWrites=0;const queue=renderer.backend.device.queue,writeBuffer=queue.writeBuffer;
    queue.writeBuffer=function(buffer,...args){if(initial.has(buffer))hedgeWrites++;return writeBuffer.call(this,buffer,...args);};
    for(let frame=0;frame<16;frame++){
      setWorldAnimationTime(frame*.7);windStrength.value=frame%3===0?0:frame%3===1?1:3;
      if(frame===1||frame===5||frame===10){camera.position.set(9,5,25);camera.lookAt(9,.5,9);}
      if(frame===2){camera.position.set(205,6,190);camera.lookAt(205,0,205);}
      if(frame===3){camera.position.set(18,3,-10);camera.lookAt(9,1,9);}
      if(frame===4){camera.position.set(900,100,900);camera.lookAt(1600,100,1600);}
      if(frame===6)for(const root of roots){root.position.set(3,1,-5);root.rotation.y=.2;root.scale.set(1.4,.8,1.1);}
      if(frame===7){camera.position.set(200,130,230);camera.lookAt(80,0,80);}
      if(frame===8){camera=new THREE.OrthographicCamera(-25,25,18,-18,.1,2000);camera.position.set(35,25,45);camera.lookAt(20,0,15);}
      if(frame===9){camera.position.set(230,20,190);camera.lookAt(220,0,210);}
      if(frame===11){camera=new THREE.PerspectiveCamera(46,400/280,.1,2000);camera.position.set(120,360,400);camera.lookAt(120,0,120);}
      if(frame===12)for(const root of roots){root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.set(1,1,1);}
      if(frame===13){camera.position.set(18,1.2,19);camera.lookAt(30,1.2,15);}
      if(frame===14){camera.position.set(9,5,25);camera.lookAt(9,.5,9);}
      camera.updateMatrixWorld(true);
      // Every camera transition is checked before any settling render.
      const firstActual=await render(0),firstReference=await render(1);
      for(let i=0;i<3;i++){await render(0);await render(1);}
      const actual=await render(0),expected=await render(1),before=hedgeWrites;
      await render(0);const current=nativeBuffers();
      frames.push({frame,...diff(actual.pixels,expected.pixels),firstFrame:diff(firstActual.pixels,firstReference.pixels),
        firstActualVsSettled:diff(firstActual.pixels,actual.pixels),firstReferenceVsSettled:diff(firstReference.pixels,expected.pixels),
        draws:actual.draws,referenceDraws:expected.draws,triangles:actual.triangles,referenceTriangles:expected.triangles,
        activeInstances:roots[0].children.reduce((n,o)=>n+o.count,0),nativeBuffers:current.size,retainedBuffers:[...initial].filter(b=>current.has(b)).length,
        unchangedViewHedgeWrites:hedgeWrites-before});
    }
    const populated=await render(0);roots[0].visible=false;const empty=await render(0);const presence=diff(populated.pixels,empty.pixels);roots[0].visible=true;
    queue.writeBuffer=writeBuffer;for(const root of roots)for(const mesh of root.children)mesh.dispose();catalogs.forEach(c=>c.dispose());target.dispose();renderer.dispose();
    return {adapterEvidence,sourceInstances:roots[0].userData.placementCount,initialBuffers:initial.size,frames,presence};
  });
  writeFileSync(`${output}/report.json`,JSON.stringify({result,errors},null,2));console.log(JSON.stringify({result,errors}));
  assert.deepEqual(errors,[]);assert(result.sourceInstances>5000);assert(result.presence.changedPixels>1000,'Probe must actually display hedges');
  for(const f of result.frames){assert.equal(f.changedPixels,0,`Settled pixels frame ${f.frame}`);assert.equal(f.firstFrame.changedPixels,0,`First camera frame ${f.frame}`);
    assert(f.draws<=f.referenceDraws);assert(f.triangles<=f.referenceTriangles);assert.equal(f.retainedBuffers,result.initialBuffers);assert.equal(f.unchangedViewHedgeWrites,0);}
  assert(result.frames[1].triangles<result.frames[1].referenceTriangles*.3,'Close view must remove most off-screen geometry');
  assert.equal(result.frames[4].activeInstances,0);assert(result.frames[5].activeInstances>0);
} finally {await browser?.close();await server.close();}
