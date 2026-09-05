import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRiverWaterMaterial, setSharedRiverWaterNightAmount, setSharedWaterRainAmount } from '../rivers/RiverWaterMaterial.ts';
import { WATER_OPTICAL_MODES, type WaterOpticalMode } from '../rivers/WaterOptics.ts';
import { COASTAL_WATER_PROFILE, INLAND_WATER_PROFILE, RIVER_WATER_PROFILE, type WaterSurfaceProfileId } from '../rivers/WaterSurfaceProfile.ts';
import { computeWaterFeatherAlpha, encodeWaterFlowDirection } from '../rivers/riverWaterShoreMaps.ts';
import { deflectWaterAroundRock, waterBankVelocityScale } from '../rivers/WaterHydraulics.ts';
import { computeRiverRockRapidFoam, type RiverChannelRockPlacement } from '../rivers/RiverChannelRocks.ts';
import { setWorldAnimationTime } from '../scene/worldAnimationTime.ts';
import { updateWaterSpectra } from '../rivers/WaterSpectrumRuntime.ts';

const query = new URLSearchParams(location.search);
const productionAssets=query.get('production')==='1';
const profileId = (query.get('profile') ?? 'river') as WaterSurfaceProfileId;
const profiles = {river:RIVER_WATER_PROFILE,inland:INLAND_WATER_PROFILE,coastal:COASTAL_WATER_PROFILE};
const profile = profiles[profileId] ?? RIVER_WATER_PROFILE;
const seed = Number(query.get('seed') ?? 1907);
let randomState = seed;
function random():number {randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;}
document.body.dataset.clean = String(query.get('clean')==='1');
const renderer = new WebGPURenderer({antialias:true,trackTimestamp:true} as ConstructorParameters<typeof WebGPURenderer>[0]);
renderer.setPixelRatio(Number(query.get('dpr') ?? 1));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.02;
await renderer.init();
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background=new THREE.Color(0x92aead);
scene.fog=new THREE.FogExp2(0x92aead,0.003);
const camera = new THREE.PerspectiveCamera(48,innerWidth/innerHeight,0.1,500);
const controls = new OrbitControls(camera,renderer.domElement);
const sun=new THREE.DirectionalLight(0xffe7bd,3.1);
const hemi=new THREE.HemisphereLight(0xcadedd,0x414829,1.8);
sun.position.set(-25,42,-35);scene.add(sun,sun.target,hemi);
const waterY=0;
const span=200,resolution=256;
function signedShore(x:number,z:number):number {
  if(profile.id==='coastal') return z+15+Math.sin(x*0.09)*3+Math.sin(x*0.23)*0.6;
  if(profile.id==='inland') return 28-Math.hypot(x*0.85,z)+Math.sin(x*0.17)*1.3+Math.cos(z*0.13)*1.1;
  return 12+Math.sin(z*0.035)*2-Math.abs(x-Math.sin(z*0.045)*5);
}
function bed(x:number,z:number):number {
  const sdf=signedShore(x,z);
  return sdf>0 ? -Math.min(profile.id==='coastal'?8:3.6,sdf*(profile.id==='coastal'?0.13:0.30))
    : Math.min(9,-sdf*0.21)+Math.sin(x*0.12)*Math.sin(z*0.17)*Math.min(0.4,-sdf*0.06);
}
const rocks:RiverChannelRockPlacement[]=[];
for(const [x,z,scale] of [[-3,4,1.55],[4,13,1.1],[-4,20,1.25],[2,-8,1.9],[7,-15,0.85]]) {
  if(profile.id!=='river')continue;
  rocks.push({x,z,scale,flowX:0,flowZ:-1,flowSpeed:1.5,rapidEnergy:0.9,halfWidth:12,side:1,corridor:0,station:rocks.length});
}
const packed=new Uint8Array(resolution*resolution*4),hydraulic=new Uint16Array(resolution*resolution*4);
for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++) {
  const wx=x/(resolution-1)*span-span/2,wz=z/(resolution-1)*span-span/2,sdf=signedShore(wx,wz);
  const flow=profile.id==='river'?{dx:Math.cos(wz*0.045)*-0.2,dz:-1}:null;
  let vx=(flow?.dx??0)*1.4*waterBankVelocityScale(sdf),vz=(flow?.dz??0)*1.4*waterBankVelocityScale(sdf),foam=0;
  for(const rock of rocks){[vx,vz]=deflectWaterAroundRock(vx,vz,wx,wz,rock);foam=Math.max(foam,computeRiverRockRapidFoam(rock,wx,wz));}
  const i=(z*resolution+x)*4,encoded=encodeWaterFlowDirection(flow);
  packed.set([Math.round(computeWaterFeatherAlpha(sdf)*255),Math.round(foam*255),...encoded],i);
  hydraulic.set([vx,vz,Math.max(0,-bed(wx,wz)),sdf].map(THREE.DataUtils.toHalfFloat),i);
}
const shoreTexture=new THREE.DataTexture(packed,resolution,resolution,THREE.RGBAFormat);
const hydraulicTexture=new THREE.DataTexture(hydraulic,resolution,resolution,THREE.RGBAFormat,THREE.HalfFloatType);
for(const tx of [shoreTexture,hydraulicTexture]){tx.minFilter=tx.magFilter=THREE.LinearFilter;tx.needsUpdate=true;}
const maps={shoreTexture,hydraulicTexture,originX:-span/2,originZ:-span/2,invSpanX:1/span,invSpanZ:1/span,channelRockCount:rocks.length,meshSpacing:span/192,hasFlow:profile.id==='river'};
const material=query.get('baseline')==='1'
  ? (await import('../rivers/WaterBaseline.ts')).createRiverWaterMaterial(maps,profile)
  : createRiverWaterMaterial(maps,profile);
const waterGeometry=new THREE.PlaneGeometry(span,span,192,192);waterGeometry.rotateX(-Math.PI/2);
const waterVertices=waterGeometry.getAttribute('position');
waterGeometry.setAttribute('simDelta',new THREE.BufferAttribute(new Float32Array(waterVertices.count),1));
waterGeometry.setAttribute('featherAlpha',new THREE.BufferAttribute(new Float32Array(waterVertices.count).fill(1),1));
const water=new THREE.Mesh(waterGeometry,material);water.position.y=waterY;water.renderOrder=1.25;scene.add(water);
const terrainGeometry=new THREE.PlaneGeometry(span,span,200,200);terrainGeometry.rotateX(-Math.PI/2);
const tp=terrainGeometry.getAttribute('position'),tc=new Float32Array(tp.count*3),c=new THREE.Color();
for(let i=0;i<tp.count;i++) {
  const x=tp.getX(i),z=tp.getZ(i),sdf=signedShore(x,z);tp.setY(i,bed(x,z));
  c.set(sdf>-3?0x807b62:0x46583a).multiplyScalar(0.86+random()*0.26);
  tc.set([c.r,c.g,c.b],i*3);
}
terrainGeometry.setAttribute('color',new THREE.BufferAttribute(tc,3));terrainGeometry.computeVertexNormals();
const groundMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
scene.add(new THREE.Mesh(terrainGeometry,groundMaterial));
const rockGeometry=new THREE.IcosahedronGeometry(1,2);
const rockMat=new THREE.MeshStandardMaterial({color:0x6e7765,roughness:0.94,flatShading:false});
for(const rock of rocks){const mesh=new THREE.Mesh(rockGeometry,rockMat);mesh.position.set(rock.x,-0.08,rock.z);mesh.scale.set(rock.scale*1.65,rock.scale*0.88,rock.scale*1.4);mesh.rotation.y=random()*6;scene.add(mesh);}
for(let i=0;i<180;i++) {
  const x=(random()-0.5)*150,z=(random()-0.5)*150,sdf=signedShore(x,z);
  if(sdf>0.3||sdf<-3)continue;
  const mesh=new THREE.Mesh(rockGeometry,rockMat),s=0.18+random()*0.55;
  mesh.position.set(x,bed(x,z)+s*0.25,z);mesh.scale.set(s*1.5,s,s);mesh.rotation.set(random(),random()*6,random());scene.add(mesh);
}
// Deliberately simple fixture vegetation gives reflections real silhouettes.
// These meshes belong only to the gauntlet; game vegetation is unchanged.
const trunkGeo=new THREE.CylinderGeometry(0.12,0.23,1,7),trunkMat=new THREE.MeshStandardMaterial({color:0x514431,roughness:1});
const crownGeo=new THREE.IcosahedronGeometry(1,1),crownMat=new THREE.MeshStandardMaterial({color:0x344b32,roughness:1});
const treePositions:THREE.Vector3[]=[];
for(let i=0;i<650;i++) {
  const x=(random()-0.5)*150,z=(random()-0.5)*150,sdf=signedShore(x,z);
  if(sdf>-4||sdf<-37)continue;
  // Keep the authored camera lane unobstructed across all fixture profiles.
  if(z<-12&&Math.abs(x)<42)continue;
  treePositions.push(new THREE.Vector3(x,bed(x,z),z));
}
const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,treePositions.length),crowns=new THREE.InstancedMesh(crownGeo,crownMat,treePositions.length*3);
const transform=new THREE.Object3D();
treePositions.forEach((p,i)=>{
  const h=6+random()*6;
  transform.position.copy(p).add(new THREE.Vector3(0,h*0.5,0));transform.scale.set(1,h,1);transform.updateMatrix();trunks.setMatrixAt(i,transform.matrix);
  for(let j=0;j<3;j++) {transform.position.copy(p).add(new THREE.Vector3((j-1)*1.5,h*(0.68+j*0.10),j%2));transform.scale.set(2.5+random(),2.2+random()*1.5,2.8);transform.rotation.y=random()*6;transform.updateMatrix();crowns.setMatrixAt(i*3+j,transform.matrix);}
});scene.add(trunks,crowns);
if(productionAssets) {
  const [{createSeedThreeForest,createSeedThreeForestController},{loadRiverRockTextures},wind]=await Promise.all([
    import('../vegetation/seedthree/seedThreeForestBuilder.ts'),import('../utils/propTextureLoad.ts'),import('@seedthree/core/wind.js'),
  ]);
  scene.remove(trunks,crowns);
  const placements=treePositions.map((p,i)=>({x:p.x,z:p.z,species:i%4===0?'silverFir' as const:'beech' as const,form:i%4===0?'narrow' as const:'broad' as const,scale:0.62+random()*0.35}));
  const forest=await createSeedThreeForest(placements,{getHeightAt:bed,generationSize:span},renderer.getMaxAnisotropy(),seed,renderer);
  const forestController=createSeedThreeForestController(forest);
  forestController.setShadows(false);forestController.setDistantCanopyCardsEnabled(false);
  scene.add(forest.group);wind.windStrength.value=0;
  const stone=await loadRiverRockTextures(renderer.getMaxAnisotropy());
  rockMat.map=stone.map;rockMat.normalMap=stone.normalMap;rockMat.roughnessMap=stone.roughnessMap;rockMat.color.set(0xffffff);rockMat.needsUpdate=true;
  const groundMap=await new THREE.TextureLoader().loadAsync('/assets/textures/terrain/forest_leaf_litter/albedo.png');
  groundMap.colorSpace=THREE.SRGBColorSpace;groundMap.wrapS=groundMap.wrapT=THREE.RepeatWrapping;groundMap.repeat.set(50,50);groundMap.anisotropy=4;
  groundMaterial.map=groundMap;groundMaterial.needsUpdate=true;
}
let view=query.get('view')??'near',debug:WaterOpticalMode='final';
function cameraView(value:string) {
  view=value;
  const target=profile.id==='river'?new THREE.Vector3(0,0,5):profile.id==='coastal'?new THREE.Vector3(0,0,0):new THREE.Vector3(0,0,0);
  const positions=profile.id==='river'?{near:[9,4,-22],design:[23,17,-42],far:[55,70,-90]}
    :profile.id==='coastal'?{near:[18,5,-29],design:[35,19,-45],far:[65,80,-92]}
      :{near:[22,4,-27],design:[41,23,-43],far:[65,83,-90]};
  camera.position.fromArray(positions[value as keyof typeof positions]??positions.near);controls.target.copy(target);controls.update();
}
cameraView(view);
const profileSelect=document.querySelector<HTMLSelectElement>('#profile')!;profileSelect.value=profile.id;
profileSelect.onchange=()=>{query.set('profile',profileSelect.value);location.search=query.toString();};
const viewSelect=document.querySelector<HTMLSelectElement>('#view')!;viewSelect.value=view;viewSelect.onchange=()=>cameraView(viewSelect.value);
const debugSelect=document.querySelector<HTMLSelectElement>('#debug')!;
for(const mode of WATER_OPTICAL_MODES)debugSelect.add(new Option(mode,mode));
function setDebug(mode:WaterOpticalMode){debug=mode;material.fragmentNode=material.userData.waterFragmentNodes[mode];material.needsUpdate=true;}
debugSelect.onchange=()=>setDebug(debugSelect.value as WaterOpticalMode);
let time=Number(query.get('time')??6.25),playing=query.get('play')!=='0',previous=0,frames=0,gpuPending=false;
let colorCopies=0,depthCopies=0;
const copyRenderer=renderer as any,copyFramebuffer=copyRenderer.copyFramebufferToTexture.bind(renderer);
copyRenderer.copyFramebufferToTexture=(tx:THREE.Texture,...args:unknown[])=>{
  if((tx as THREE.DepthTexture).isDepthTexture)depthCopies++;else colorCopies++;
  return copyFramebuffer(tx,...args);
};
const intervals:number[]=[],cpu:number[]=[],gpu:number[]=[],computeGpu:number[]=[];
document.querySelector<HTMLButtonElement>('#play')!.onclick=()=>{playing=!playing;document.querySelector('#play')!.textContent=playing?'Pause':'Play';};
document.querySelector<HTMLButtonElement>('#reset')!.onclick=()=>{time=0;};
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]??0;
const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)*p)]??0;
function evidence(){return {profile:profile.id,seed,productionAssets,view,debug,time,camera:camera.position.toArray(),target:controls.target.toArray(),width:innerWidth,height:innerHeight,dpr:renderer.getPixelRatio(),noPost:true,
  fps:1000/median(intervals),p95FrameMs:percentile(intervals,0.95),cpuMedianMs:median(cpu),gpuMedianMs:gpu.length?median(gpu):null,
  computeGpuMedianMs:computeGpu.length?median(computeGpu):0,framebufferCopies:{color:colorCopies,depth:depthCopies},renderer:JSON.parse(JSON.stringify(renderer.info)),samples:intervals.length};}
const timedRenderer=renderer as unknown as {resolveTimestampsAsync(type?:string):Promise<number|undefined>;setAnimationLoop(callback:(now:number)=>void):void};
timedRenderer.setAnimationLoop((now:number)=>{
  const dt=previous?now-previous:16.67;previous=now;if(playing)time+=Math.min(dt*0.001,0.05);
  colorCopies=depthCopies=0;
  setWorldAnimationTime(time);renderer.info.reset();const start=performance.now();updateWaterSpectra(renderer,time);renderer.render(scene,camera);
  if(frames++>40){intervals.push(dt);cpu.push(performance.now()-start);if(intervals.length>180){intervals.shift();cpu.shift();}}
  if(!gpuPending){gpuPending=true;Promise.all([timedRenderer.resolveTimestampsAsync(),timedRenderer.resolveTimestampsAsync('compute')]).then(([value,compute])=>{
    if(typeof value==='number'&&value>0&&frames>40){gpu.push(value);if(gpu.length>180)gpu.shift();}
    if(typeof compute==='number'&&compute>0&&frames>40){computeGpu.push(compute);if(computeGpu.length>180)computeGpu.shift();}
  }).finally(()=>{gpuPending=false;});}
  if(frames%30===0)document.querySelector('#metrics')!.textContent=`${(1000/median(intervals)).toFixed(1)} FPS · GPU ${median(gpu).toFixed(3)} ms · ${(renderer.info.render as unknown as {drawCalls:number}).drawCalls} draws`;
});
const api={evidence, async capture(options:{view?:string;debug?:WaterOpticalMode;time?:number;night?:number;rain?:number}={}){
  playing=false;if(options.view)cameraView(options.view);if(options.debug)setDebug(options.debug);time=options.time??time;
  setSharedRiverWaterNightAmount(options.night??0);setSharedWaterRainAmount(options.rain??0);intervals.length=cpu.length=gpu.length=computeGpu.length=0;
  const night=options.night??0,rain=options.rain??0;
  sun.intensity=THREE.MathUtils.lerp(3.1*(1-rain*0.55),0.08,night);
  sun.color.set(night>0.5?0xbccfed:0xffe7bd);hemi.intensity=THREE.MathUtils.lerp(1.8,0.08,night);
  scene.background=new THREE.Color(rain>0.5?0x758588:0x92aead).lerp(new THREE.Color(0x16232f),night);
  scene.fog!.color.copy(scene.background);
  await new Promise<void>(resolve=>{let n=0;function wait(){if(++n>=100)resolve();else requestAnimationFrame(wait);}requestAnimationFrame(wait);});
  return evidence();
},play(value:boolean){playing=value;}};
Object.assign(api,{async benchmark(){playing=true;intervals.length=cpu.length=gpu.length=computeGpu.length=0;
  await new Promise<void>(resolve=>{let n=0;function wait(){if(++n>=240)resolve();else requestAnimationFrame(wait);}requestAnimationFrame(wait);});
  playing=false;return evidence();
}});
(window as unknown as {__WATER_GAUNTLET__:typeof api}).__WATER_GAUNTLET__=api;
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
