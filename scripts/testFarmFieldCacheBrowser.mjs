import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// Immutable pre-change implementation; imports resolve beside the live module.
const reference=execFileSync('git',['show','c05bd44f:src/farming/FarmFieldMarkers.ts'],{encoding:'utf8',windowsHide:true});
const referenceFirst=process.env.FARM_CACHE_REFERENCE_FIRST==='1';
const output=referenceFirst?'artifacts/city-performance/farm-field-cache-reference-first':'artifacts/city-performance/farm-field-cache';mkdirSync(output,{recursive:true});
const server=await createServer({cacheDir:'artifacts/farm-field-cache-vite',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'farm-field-reference',enforce:'pre',transform(code,id){
    if(id.replaceAll('\\','/').endsWith('/src/farming/FarmFieldMarkers.ts?cacheReference'))return reference;
  },
}]});await server.listen();let browser;
try {
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.route('**/field-cache-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('field-cache-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async(referenceFirst)=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {FarmFieldMarkers}=await import('/src/farming/FarmFieldMarkers.ts');
    const {FarmFieldMarkers:Reference}=await import('/src/farming/FarmFieldMarkers.ts?cacheReference');
    const {setWorldAnimationTime}=await import('/src/scene/worldAnimationTime.ts');
    const {windStrength}=await import('/vendor/seedthree/src/core/wind.js');
    const {renderer,adapterEvidence}=await createPreferredRenderer();renderer.setSize(400,280);renderer.shadowMap.enabled=true;renderer.info.autoReset=false;
    const scenes=[new THREE.Scene(),new THREE.Scene()],parents=[new THREE.Group(),new THREE.Group()];let terrainRevision=0;
    const height=(x,z)=>Math.sin(x*.07)*.08+Math.cos(z*.06)*.06+terrainRevision*.1;
    for(let i=0;i<2;i++){
      const s=scenes[i];s.background=new THREE.Color(.08,.14,.18);s.fog=new THREE.FogExp2(0x8a9aab,.002);s.add(parents[i]);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardNodeMaterial({color:0x777555,roughness:.95}));
      ground.rotation.x=-Math.PI/2;ground.position.y=-.2;ground.receiveShadow=true;s.add(ground,new THREE.AmbientLight(0xc5d5e2,.8));
      const sun=new THREE.DirectionalLight(0xffe6c8,2.2);sun.position.set(25,55,25);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
      Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,near:.1,far:160});sun.shadow.camera.updateProjectionMatrix();s.add(sun);
    }
    const options={rendererBackend:'webgpu',maxAnisotropy:4,useSeedThreeCrops:true,useSeedThreePerimeterShrubs:true,getHeightRevision:()=>[terrainRevision]};
    const markers=[new FarmFieldMarkers(parents[0],height,options),new Reference(parents[1],height,options)];
    const makeField=i=>({id:`native-field-${i}`,farmsteadId:'barn',corners:[{x:(i%4)*12-24,z:Math.floor(i/4)*12-24},
      {x:(i%4)*12-16,z:Math.floor(i/4)*12-24},{x:(i%4)*12-16,z:Math.floor(i/4)*12-16},{x:(i%4)*12-24,z:Math.floor(i/4)*12-16}],
      area:64,averageSlopeDegrees:0,moisture:.5,fertility:.8,crop:['rye','oats','barley','flax','wheat','fallow'][i%6],nextCrop:'fallow',
      stage:'ploughing',stageProgress:.5,priority:1,harvestCount:0,lastYield:0,currentYield:0});
    let fields=Array.from({length:16},(_,i)=>makeField(i));markers.forEach(m=>m.syncFields(fields));
    await Promise.all(markers.flatMap(m=>[m.whenCropsReady(),m.whenPerimeterReady()]));
    const camera=new THREE.PerspectiveCamera(46,400/280,.1,500);camera.position.set(38,36,42);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const target=new THREE.RenderTarget(400,280);renderer.setRenderTarget(target);
    const render=async side=>{renderer._nodes.nodeFrame.update();renderer.info.reset();renderer.render(scenes[side],camera);
      return {draws:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles,
        pixels:await renderer.readRenderTargetPixelsAsync(target,0,0,400,280)};};
    const warm=async()=>{for(let i=0;i<3;i++){await render(0);await render(1);}};await warm();
    const nativeBuffers=node=>{const result=new Set();node.traverse(o=>{if(o.geometry)for(const a of [o.geometry.index,...Object.values(o.geometry.attributes),o.instanceMatrix,o.instanceColor]){
      if(a){const b=renderer.backend.get(a.isInterleavedBufferAttribute?a.data:a).buffer;if(b)result.add(b);}}});return result;};
    const retainedField=parents[0].getObjectByName('Field native-field-10'),retainedHedges=parents[0].getObjectByName('SeedThree field-perimeter shrubs');
    const referenceField=parents[1].getObjectByName('Field native-field-10'),referenceHedges=parents[1].getObjectByName('SeedThree field-perimeter shrubs');
    const initialBuffers=nativeBuffers(retainedField),hedgeBuffers=nativeBuffers(retainedHedges);
    const frames=[];
    for(let frame=0;frame<15;frame++){
      setWorldAnimationTime(frame*.8);windStrength.value=frame===1?0:.75;
      if(frame===1)fields=fields.map((f,i)=>i===0?{...f,stageProgress:.85}:f);
      if(frame===2)fields=fields.map((f,i)=>i===0?{...f,stage:'sowing',stageProgress:.6}:f);
      if(frame===3)fields=fields.map((f,i)=>i===0?{...f,stage:'growing',stageProgress:.76}:f);
      if(frame===4)fields=fields.map((f,i)=>i===0?{...f,stage:'harvesting',stageProgress:.6}:f);
      if(frame===5)fields=fields.map((f,i)=>i===1?{...f,stageProgress:.5001}:i===2?{...f,stageProgress:.9}:f);
      if(frame===6)fields=fields.map((f,i)=>i===3?{...f,fertility:.45}:f);
      if(frame===7){camera.position.set(-21,5,-11);camera.lookAt(-20,.5,-20);camera.updateMatrixWorld(true);}
      if(frame===8){camera.position.set(115,90,130);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);}
      if(frame===9){terrainRevision++;fields=fields.map((f,i)=>i===0?{...f,stageProgress:.9}:f);}
      if(frame===10)fields=fields.filter(f=>f.id!=='native-field-4');
      if(frame===11)fields=[...fields,{...makeField(18),stage:'growing',stageProgress:.8}];
      if(frame===12)fields=fields.map(f=>f.id==='native-field-18'?{...f,corners:f.corners.map(p=>({x:p.x+.5,z:p.z+.75}))}:f);
      if(frame===13)fields=[...fields].reverse();
      if(frame===14)fields=[];
      markers.forEach(m=>m.syncFields(fields));
      let firstActual,firstReference;
      if(referenceFirst){firstReference=await render(1);firstActual=await render(0);}else{firstActual=await render(0);firstReference=await render(1);}
      await warm();
      const actual=await render(0),expected=await render(1);
      const diff=(a,b)=>{let changedPixels=0,maxDifference=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d)changedPixels++;maxDifference=Math.max(maxDifference,d);}return {changedPixels,maxDifference};};
      frames.push({frame,...diff(actual.pixels,expected.pixels),firstFrame:diff(firstActual.pixels,firstReference.pixels),
        firstActualVsSettled:diff(firstActual.pixels,actual.pixels),firstReferenceVsSettled:diff(firstReference.pixels,expected.pixels),
        draws:actual.draws,referenceDraws:expected.draws,triangles:actual.triangles,referenceTriangles:expected.triangles});
      if(frame===1)frames.at(-1).referenceRebuilt=parents[1].getObjectByName('Field native-field-10')!==referenceField
        &&parents[1].getObjectByName('SeedThree field-perimeter shrubs')!==referenceHedges;
      if(frame===3){let authored=0;parents[0].traverse(o=>{if(o.userData.fieldCropSharedMaterial&&o.isInstancedMesh)authored+=o.count;});frames.at(-1).authoredCropInstances=authored;}
      if(frame===6){frames.at(-1).retainedField=parents[0].getObjectByName('Field native-field-10')===retainedField;
        frames.at(-1).retainedHedges=parents[0].getObjectByName('SeedThree field-perimeter shrubs')===retainedHedges;
        const current=nativeBuffers(retainedField),hedges=nativeBuffers(retainedHedges);
        frames.at(-1).nativeFieldBuffers=initialBuffers.size;frames.at(-1).retainedNativeFieldBuffers=[...initialBuffers].filter(b=>current.has(b)).length;
        frames.at(-1).nativeHedgeBuffers=hedgeBuffers.size;frames.at(-1).retainedNativeHedgeBuffers=[...hedgeBuffers].filter(b=>hedges.has(b)).length;}
    }
    const arms=[];
    for(let cycle=0;cycle<4;cycle++){
      const side=cycle%2;let input=Array.from({length:100},(_,i)=>({...makeField(i),crop:'fallow',stage:'ploughing'}));
      markers[side].syncFields(input);const samples=[];
      for(let step=0;step<8;step++){input=input.map((f,i)=>i===0?{...f,stageProgress:(step%4)*.25}:f);
        const start=performance.now();markers[side].syncFields(input);samples.push(performance.now()-start);await new Promise(requestAnimationFrame);}
      arms.push({cycle,cached:side===0,meanSyncMs:samples.reduce((a,b)=>a+b,0)/samples.length,samples});
    }
    markers.forEach(m=>m.dispose());target.dispose();renderer.dispose();return {adapterEvidence,frames,arms};
  },referenceFirst);
  writeFileSync(`${output}/report.json`,JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({result,errors}));assert.deepEqual(errors,[]);assert(result.frames[0].triangles>100000);
  assert(result.frames[1].referenceRebuilt,'Reference must execute the former whole-list rebuild');assert(result.frames[3].authoredCropInstances>0);
  for(const f of result.frames){assert.equal(f.changedPixels,0,`Native field pixel parity frame ${f.frame}`);assert.equal(f.draws,f.referenceDraws);assert.equal(f.triangles,f.referenceTriangles);}
  const retained=result.frames[6];assert(retained.retainedField&&retained.retainedHedges);assert(retained.nativeFieldBuffers>0&&retained.nativeHedgeBuffers>0);
  assert.equal(retained.retainedNativeFieldBuffers,retained.nativeFieldBuffers);assert.equal(retained.retainedNativeHedgeBuffers,retained.nativeHedgeBuffers);
} finally {await browser?.close();await server.close();}
