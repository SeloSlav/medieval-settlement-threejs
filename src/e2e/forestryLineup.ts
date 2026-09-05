// @ts-nocheck -- Local deterministic verification using the full game renderer.
import * as THREE from 'three';
import { SceneManager } from '../scene/SceneManager.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../world/worldGenerationSettings.ts';
import { setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { parseVisualQaConditions, standaloneVisualQaEnvironment, applyVisualQaClock } from '../app/visualQaConditions.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { computeDayNightState } from '../world/dayNightPresentation.ts';
import { createVisualGpuTimestampProfiler } from './webGpuTimestampProfiler.ts';
import { treeFallDirection, timberLogDimensions } from '../forestry/forestry.ts';
import { ForestryAudio } from '../audio/ForestryAudio.ts';
import { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { OxenRenderer } from '../settlement/OxenRenderer.ts';
import { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { windStrength } from '@seedthree/core/wind.js';
const settings = {...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize:'small', terrainPreset:'mrkopalj_polje', seed:420042, topography:12, hydrology:0};
setDraftWorldGeneration(settings);
const manager = await SceneManager.create(document.querySelector('#world'), settings, p => document.querySelector('#status').textContent = p.label);
manager.resize({width:1280,height:720});
await manager.finishVegetation(); await manager.materials.whenTexturesReady(); await manager.sky.ready;
const conditions = parseVisualQaConditions('?visualQa=daylight');
manager.setEnvironment(standaloneVisualQaEnvironment(conditions));
manager.applyDayNight(computeDayNightState(applyVisualQaClock(gameClock(0),conditions),false));
windStrength.value = 0;
const forest = manager.getForestManager();
const layouts = forest.getTreeLayouts();
const candidates = ['beech','silverFir','sessileOak'].map(species => layouts.find(t => t.species===species && t.scale>1 && Math.abs(t.x)<200 && Math.abs(t.z)<200)).filter(Boolean);
let tree = candidates[0]; let distance=28;
let cameraDirection = new THREE.Vector3(0.6,0.55,0.7);
const audio = new ForestryAudio();
const agentsRoot = new THREE.Group(); manager.scene.add(agentsRoot);
let haulers, oxen, villagers;
let agentTick = () => {};
const crowdView = () => ({centerX:tree.x,centerZ:tree.z,viewRadius:120,orbitDistance:distance});
const gpu = createVisualGpuTimestampProfiler({ kind: manager.rendererBackend, renderer: manager.renderer });
const frames = async (n=12,dt=1/60) => { for(let i=0;i<n;i++) { await new Promise(requestAnimationFrame); agentTick(dt); manager.render(dt,distance); } };
function view(d=28) {
  distance=d; const yaw=treeFallDirection(tree.layoutIndex);
  const x=tree.x+Math.sin(yaw)*3, z=tree.z+Math.cos(yaw)*3;
  manager.cameraTarget.set(x,manager.terrain.getHeightAt(x,z)+2,z);
  manager.camera.position.copy(manager.cameraTarget).add(cameraDirection.clone().normalize().multiplyScalar(d));
  manager.camera.lookAt(manager.cameraTarget); manager.camera.updateMatrixWorld(true);
}
function phase(phase,progress=0,health=1) {
  const yaw=treeFallDirection(tree.layoutIndex);
  const logs=phase==='logs' ? [0,1,2].map(i=>({x:tree.x+Math.sin(yaw)*(2+i*3),z:tree.z+Math.cos(yaw)*(2+i*3),health:20*health,maxHealth:20,firewood:health<1?2:0})) : [];
  forest.applyTreePhases([{layoutIndex:tree.layoutIndex,phase,growthProgress:phase==='mature'?1:0,harvestProgress:progress,logs}]);
}
function select(species) {
  cameraDirection.set(0.6,0.55,0.7);
  haulers?.syncTrips([]); oxen?.sync({oxen:[],buildings:new Map(),deliveryTrips:[],disabledBuildingIds:new Set(),roadNetwork:null});
  villagers?.sync({residences:[],buildings:[],quarries:[],foragingNodes:[],trees:new Map(),treeRegistry:null,farmFields:[],pastures:[],roadNetwork:null});
  agentTick = () => {};
  tree=candidates.find(t=>t.species===species)??candidates[0];
  forest.syncAuthoritativeTreeLayouts([tree.layoutIndex]); phase('mature'); view();
}
select('beech'); await frames(50);
document.querySelector('#status').textContent='Forestry ready';
window.__FORESTRY_QA__={
  settings,candidates,select,phase,view,frames,
  haul:async(commodity='timber',loaded=true)=>{
    select('beech'); phase('logs',0,0.5);
    if(!haulers) {
      haulers=new DeliveryAgentRenderer({parent:agentsRoot,terrain:manager.terrain,getGameSpeed:()=>1});
      oxen=new OxenRenderer({parent:agentsRoot,getGameSpeed:()=>1,getHeightAt:(x,z)=>manager.terrain.getHeightAt(x,z),getWorkerPose:()=>null,getDeliveryPose:id=>haulers.getOxFollowPose(id)});
      await oxen.ready;
      for(let i=0;i<600 && (!haulers.cartSource || !haulers.workerSources);i++) await frames(1);
      if(!haulers.workerSources) throw new Error('Cart worker assets failed to load');
    }
    const x=tree.x+3,z=tree.z+4;
    const trip={id:'trip-1',buildingId:'building-1',laborBuildingId:'building-1',residenceId:null,targetBuildingId:null,
      destinationKind:'forestry',cargoKind:commodity,amount:loaded?2:0,phase:loaded?'inbound':'outbound',x,z,progress:0.5,
      speedMps:1,unloadSeconds:2,unloadRemaining:0,deliveryWorkers:1,freeHaulerWorkers:0,
      oxId:commodity==='timber'?'ox-1':null,pathDistance:12,travelSpeedMultiplier:1,
      routePolylineJson:JSON.stringify([{x:x-6,z},{x:x+6,z}]),
      forestrySource:{treeId:'qa-tree',layoutIndex:tree.layoutIndex,logIndex:0,capacity:4,logMaxHealth:40}};
    haulers.syncTrips([trip]);
    oxen.sync({oxen:commodity==='timber'?[{id:'ox-1',stableId:'building-2',slot:0,assignedBuildingId:null}]:[],
      buildings:new Map([['building-2',{id:'building-2',kind:'stable',x,z,constructionComplete:true,assignedLabor:0,yaw:0}]]),
      deliveryTrips:[trip],disabledBuildingIds:new Set(),roadNetwork:null});
    agentTick=dt=>{haulers.update(dt,crowdView());oxen.tick(dt,crowdView());};
    await frames(30); manager.invalidateStaticShadows();
    const mesh=haulers.visuals.get(trip.id).mesh;
    return {oxen:oxen.getVisualCount(),workers:haulers.visuals.get(trip.id).workers.length,
      cargo:mesh.children.filter(c=>c.userData.sharedGeometry).map(c=>({name:c.name,length:c.scale.y})),
      expectedLength:timberLogDimensions(tree).length*0.5};
  },
  workers:async()=>{
    select('beech'); phase('fallen');
    const yaw = treeFallDirection(tree.layoutIndex);
    cameraDirection.set(Math.cos(yaw)-Math.sin(yaw),0.5,-Math.sin(yaw)-Math.cos(yaw));
    if(!villagers) {villagers=new VillagerRenderer({parent:agentsRoot,getGameSpeed:()=>1,getHeightAt:(x,z)=>manager.terrain.getHeightAt(x,z)}); await villagers.visualAssetsReady;}
    const camp={id:'building-1',kind:'lumber_mill',x:tree.x-10,z:tree.z-8,workRadius:60,assignedLabor:2,constructionComplete:true,timber:0,ironwork:0};
    villagers.setSchedule({...gameClock(0),hour:10,minute:0},false,false);
    villagers.sync({residences:[],buildings:[camp],quarries:[],foragingNodes:[],farmFields:[],pastures:[],roadNetwork:null,
      trees:new Map([['qa-tree',{treeId:'qa-tree',layoutIndex:tree.layoutIndex,phase:'fallen',growthProgress:0,workBuildingId:camp.id}]]),
      treeRegistry:{treesInRadius:()=>[{id:'qa-tree',...tree}]}});
    agentTick=dt=>villagers.tick(dt,crowdView());
    for(let i=0;i<2400;i++) {
      villagers.tick(1/30,crowdView());
      if([...villagers.agents.values()].some(a=>a.mode==='chop')) break;
      if(i%60===0) await frames(1);
    }
    await frames(8); manager.invalidateStaticShadows();
    return [...villagers.agents.values()].filter(a=>a.role==='worker').map(a=>({mode:a.mode,x:a.x,z:a.z,target:a.workTarget}));
  },
  diagnostics:()=>({tree,dimensions:timberLogDimensions(tree),forest:forest.getSeedThreeStructuralStats?.(),render:manager.renderer.info.render}),
  capture:async(d=28,diagnostic='final')=>{
    view(d); manager.setLightingDiagnostic(diagnostic); await frames(20);
    const samples=[];
    for(let i=0;i<24;i++) { const now=await new Promise(requestAnimationFrame); const h=gpu.beginFrame(now); manager.render(1/60,distance); if(h) gpu.endFrame(h); samples.push(now); }
    await frames(8); document.querySelector('#status').style.display='none';
    const result={png:manager.renderer.domElement.toDataURL('image/png'),tree,dimensions:timberLogDimensions(tree),diagnostic,distance,render:manager.renderer.info.render,gpu:gpu.getEvidence(),gpuMs:samples.map(t=>gpu.getFrameTiming(t).durationMs)};
    return result;
  },
  fall:async()=>{
    forest.drainForestrySoundEvents();
    phase('mature'); await frames(2); phase('falling',0); const events=[];
    for(let i=0;i<=210;i++) {
      phase('falling',i/210); await frames(1);
      const next=forest.drainForestrySoundEvents(); events.push(...next);
      audio.tick(next,{centerX:tree.x,centerZ:tree.z,listenerX:tree.x,listenerZ:tree.z,orbitDistance:20},manager.camera);
    }
    phase('fallen'); await frames(30); const impact=forest.drainForestrySoundEvents(); events.push(...impact);
    audio.tick(impact,{centerX:tree.x,centerZ:tree.z,listenerX:tree.x,listenerZ:tree.z,orbitDistance:20},manager.camera);
    return events;
  },
  dispose:()=>audio.dispose(),
};
