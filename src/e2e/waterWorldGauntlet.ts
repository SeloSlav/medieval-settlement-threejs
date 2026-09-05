import * as THREE from 'three';
import { SceneManager } from '../scene/SceneManager.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../world/worldGenerationSettings.ts';
import { seedForTerrainPreset, type WorldTerrainPreset } from '../world/worldTerrainPresets.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { computeDayNightState } from '../world/dayNightPresentation.ts';
import { environmentFor } from '../world/seasonPolicy.ts';
import { getStillWaterSurfaceY } from '../rivers/RiverWaterLevel.ts';
import { createRiverChannelRockPlacements } from '../rivers/RiverChannelRocks.ts';
import type { RiverSystem } from '../rivers/RiverSystem.ts';
import { getWaterMaterialInputs } from '../rivers/RiverWaterMaterial.ts';
import { createRiverWaterMaterial as createBaselineMaterial } from '../rivers/WaterBaseline.ts';
import { createWaterBaselineSimulation } from './waterBaselineSimulation.ts';
import { createVisualGpuTimestampProfiler } from './webGpuTimestampProfiler.ts';

// A real SceneManager, including sky, post processing, shadows, groundcover,
// wildlife and horizon. Only settlement entities/database are omitted.
const query = new URLSearchParams(location.search);
const profile = query.get('profile') ?? 'river';
const terrainPreset:WorldTerrainPreset = profile==='coastal'?'vinodol_coast':profile==='inland'?'delnice_meadow':'kupa_valley';
const settings = {...DEFAULT_WORLD_GENERATION_SETTINGS,terrainPreset,
  seed:seedForTerrainPreset(Number(query.get('seed') ?? 1907),terrainPreset),mapSize:'medium' as const};
const status = document.querySelector('#status')!;
const manager = await SceneManager.create(document.querySelector('#world')!,settings,p=>{status.textContent=`${p.label} · ${p.detail ?? ''}`;});
manager.resize({width:innerWidth,height:innerHeight});
manager.renderer.setPixelRatio(Number(query.get('dpr') ?? 1));
manager.resize({width:innerWidth,height:innerHeight});
manager.setIllustratedMapActive(false);
const clock={...gameClock(0),month:7,monthDay:15,hour:13,minute:0,preciseHour:13};
manager.setEnvironment(environmentFor(settings.seed,50,clock,false,100));
manager.applyDayNight(computeDayNightState(clock,false));
const field=(manager as unknown as {riverSystem:RiverSystem}).riverSystem.field,layout=field.layout;
let target = new THREE.Vector3(),normal=new THREE.Vector3(1,0,0),flow=new THREE.Vector3(0,0,1);
let radius=35;
if(profile==='coastal') {
  target.set((layout.getCoastalShoreX(0) ?? 0)-24,0,0);normal.set(1,0,0);radius=46;
} else if(profile==='inland'&&layout.inlandWaterBodies.length) {
  const lake=[...layout.inlandWaterBodies].sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0]!;
  target.set(lake.x,0,lake.z);radius=Math.max(lake.radiusX,lake.radiusZ)*0.95;
} else {
  const rocks=createRiverChannelRockPlacements(field);
  const rock=rocks.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
  const point=layout.corridors.flatMap(c=>c.points).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
  target.set(rock?.x ?? point?.x ?? 0,0,rock?.z ?? point?.z ?? 0);
  const f=layout.sampleFlowDirection(target.x,target.z);
  flow.set(f?.dx??0,0,f?.dz??1);normal.set(-flow.z,0,flow.x);
  radius=Math.max(30,(point?.halfWidth??20)*0.8);
}
target.y=getStillWaterSurfaceY(manager.terrain,field,target.x,target.z);
let view='near';
function setView(value:string) {
  view=value;
  const tier=value==='far'?2:value==='design'?1:0;
  const distance=radius*[1,1.7,3.4][tier]!;
  const position=target.clone().addScaledVector(normal,distance).addScaledVector(flow,-distance*0.45);
  position.y=Math.max(target.y+[6,24,90][tier]!,manager.terrain.getHeightAt(position.x,position.z)+[4,14,40][tier]!);
  manager.camera.position.copy(position);manager.cameraTarget.copy(target);manager.camera.lookAt(target);
  manager.camera.updateMatrixWorld();
}
setView('near');
status.textContent='Building the production forest and grass…';
await manager.finishVegetation();
const variants:Array<{mesh:THREE.Mesh;current:THREE.Material;baseline:THREE.Material}>=[];
manager.scene.traverse(object=>{
  if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
  const inputs=getWaterMaterialInputs(object.material);
  if(inputs)variants.push({mesh:object,current:object.material,baseline:createBaselineMaterial(inputs.maps,inputs.profile)});
});
let baseline=false;
const primaryWater=variants.find(v=>v.mesh.userData.water);
const oldSimulation=primaryWater?createWaterBaselineSimulation(manager.terrain,field,primaryWater.mesh.geometry):null;
const riverSystem=(manager as unknown as {riverSystem:RiverSystem}).riverSystem;
const tick=riverSystem.tick;
riverSystem.tick=(dt,time)=>{tick(dt,time);if(baseline)oldSimulation?.tick(dt);};
for(const v of variants)if(!v.mesh.geometry.getAttribute('simDelta'))v.mesh.geometry.setAttribute('simDelta',new THREE.BufferAttribute(new Float32Array(v.mesh.geometry.getAttribute('position').count),1));
const switchBaseline=(value:boolean)=>{baseline=value;for(const v of variants)v.mesh.material=value?v.baseline:v.current;};
switchBaseline(query.get('baseline')==='1');
const timedRenderer=manager.renderer as unknown as {backend:{trackTimestamp:boolean};resolveTimestampsAsync(kind?:string):Promise<number|undefined>};
timedRenderer.backend.trackTimestamp=true;
let gpuPending=false;
const gpu:number[]=[],computeGpu:number[]=[];
const gpuProfiler=createVisualGpuTimestampProfiler({kind:'webgpu',renderer:manager.renderer} as never);
const postRender=manager.postProcessor.render.bind(manager.postProcessor);
let frameTimestamp=0;
let colorCopies=0,depthCopies=0;
const copyRenderer=manager.renderer as any;
const copyFramebuffer=copyRenderer.copyFramebufferToTexture.bind(copyRenderer);
copyRenderer.copyFramebufferToTexture=(texture:THREE.Texture,...args:unknown[])=>{
  if((texture as THREE.DepthTexture).isDepthTexture)depthCopies++;else colorCopies++;
  return copyFramebuffer(texture,...args);
};
const frameTimes:number[]=[];
manager.postProcessor.render=(dt:number)=>{
  const handle=gpuProfiler.beginFrame(frameTimestamp);
  postRender(dt);gpuProfiler.endFrame(handle);
};
let frames=0,previous=0,playing=true;
const intervals:number[]=[],cpu:number[]=[];
function frame(now:number) {
  frameTimestamp=now;
  colorCopies=depthCopies=0;
  const dt=previous?now-previous:16.67;previous=now;
  const started=performance.now();
  manager.render(playing?Math.min(dt*0.001,0.05):0,manager.camera.position.distanceTo(manager.cameraTarget));
  if(!gpuPending){gpuPending=true;Promise.all([timedRenderer.resolveTimestampsAsync(),timedRenderer.resolveTimestampsAsync('compute')]).then(([render,compute])=>{
    if(typeof render==='number'&&render>0){gpu.push(render);if(gpu.length>300)gpu.shift();}
    if(typeof compute==='number'&&compute>0){computeGpu.push(compute);if(computeGpu.length>300)computeGpu.shift();}
  }).finally(()=>{gpuPending=false;});}
  if(frames++>60){intervals.push(dt);cpu.push(performance.now()-started);frameTimes.push(now);if(intervals.length>300){intervals.shift();cpu.shift();frameTimes.shift();}}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]??0;
const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)*p)]??0;
const waitFrames=(count:number)=>new Promise<void>(resolve=>{let n=0;function wait(){if(++n>=count)resolve();else requestAnimationFrame(wait);}requestAnimationFrame(wait);});
function evidence(){return {profile,settings,view,baseline,camera:manager.camera.position.toArray(),target:target.toArray(),
  fps:1000/median(intervals),p95FrameMs:percentile(intervals,0.95),p99FrameMs:percentile(intervals,0.99),
  medianCpuMs:median(cpu),p95CpuMs:percentile(cpu,0.95),samples:intervals.length,
  gpuMedianMs:median(frameTimes.flatMap(t=>{const timing=gpuProfiler.getFrameTiming(t);return timing.status==='available'&&timing.durationMs!==null?[timing.durationMs]:[]})),
  gpuTiming:gpuProfiler.getEvidence(),sampledPassGpuMedianMs:gpu.length?median(gpu):null,computeGpuMedianMs:baseline?0:median(computeGpu),
  framebufferCopies:{color:colorCopies,depth:depthCopies},
  renderer:manager.getPerformanceStats(),adapter:manager.getRendererAdapterEvidence(),
  included:'Production SceneManager: terrain, horizon, forest, grass, river details, sky, shadows, post, wildlife',
  omitted:'Settlement entities, database and game UI'};}
await waitFrames(300);
document.body.dataset.clean=String(query.get('clean')==='1');
status.textContent='Production scene ready';
const api={evidence,async capture(options:{view?:string;hour?:number;rain?:boolean}={}){
  if(options.view)setView(options.view);
  if(options.hour!==undefined)manager.applyDayNight(computeDayNightState({...clock,hour:options.hour,preciseHour:options.hour},false));
  if(options.rain!==undefined)manager.setLightingReviewEnvironment(options.rain?'rain':'summer');
  playing=true;await waitFrames(240);intervals.length=cpu.length=0;await waitFrames(300);return evidence();
},async compare(value:string){
  setView(value);playing=true;
  // Warm both shader variants, then interleave short ABBA blocks. This keeps
  // thermal drift from being mistaken for the effect of changing materials.
  for(const old of [true,false]){switchBaseline(old);await waitFrames(120);}
  const buckets=Array.from({length:2},()=>({intervals:[] as number[],cpu:[] as number[],gpu:[] as number[],compute:[] as number[],color:0,depth:0}));
  for(let cycle=0;cycle<4;cycle++)for(const old of [true,false,false,true]){
    switchBaseline(old);await waitFrames(6);
    intervals.length=cpu.length=gpu.length=computeGpu.length=frameTimes.length=0;
    await waitFrames(45);
    const bucket=buckets[old?0:1]!;
    bucket.color=Math.max(bucket.color,colorCopies);bucket.depth=Math.max(bucket.depth,depthCopies);
    bucket.intervals.push(...intervals);bucket.cpu.push(...cpu);
    bucket.gpu.push(...frameTimes.flatMap(t=>{const timing=gpuProfiler.getFrameTiming(t);return timing.status==='available'&&timing.durationMs!==null?[timing.durationMs]:[]}));
    if(!old)bucket.compute.push(...computeGpu);
  }
  const cohorts=buckets.map((b,i)=>({...evidence(),baseline:i===0,protocol:'4 cycles of interleaved ABBA / 45 measured frames per block',
    fps:1000/median(b.intervals),p95FrameMs:percentile(b.intervals,0.95),medianCpuMs:median(b.cpu),p95CpuMs:percentile(b.cpu,0.95),
    gpuMedianMs:median(b.gpu),computeGpuMedianMs:median(b.compute),samples:b.intervals.length,
    framebufferCopies:{color:b.color,depth:b.depth}}));
  switchBaseline(false);await waitFrames(2);
  return cohorts;
},play(value:boolean){playing=value;},manager};
(window as unknown as {__WATER_WORLD_GAUNTLET__:typeof api}).__WATER_WORLD_GAUNTLET__=api;
window.addEventListener('resize',()=>manager.resize({width:innerWidth,height:innerHeight}));
window.addEventListener('pagehide',()=>{gpuProfiler.dispose();manager.dispose();});
