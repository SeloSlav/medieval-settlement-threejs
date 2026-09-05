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
const audio = new ForestryAudio();
const gpu = createVisualGpuTimestampProfiler(manager.renderer);
const frames = async (n=12,dt=1/60) => { for(let i=0;i<n;i++) { await new Promise(requestAnimationFrame); manager.render(dt,distance); } };
function view(d=28) {
  distance=d; const yaw=treeFallDirection(tree.layoutIndex);
  const x=tree.x+Math.sin(yaw)*3, z=tree.z+Math.cos(yaw)*3;
  manager.cameraTarget.set(x,manager.terrain.getHeightAt(x,z)+2,z);
  manager.camera.position.copy(manager.cameraTarget).add(new THREE.Vector3(0.6,0.55,0.7).normalize().multiplyScalar(d));
  manager.camera.lookAt(manager.cameraTarget); manager.camera.updateMatrixWorld(true);
}
function phase(phase,progress=0,health=1) {
  const yaw=treeFallDirection(tree.layoutIndex);
  const logs=phase==='logs' ? [0,1,2].map(i=>({x:tree.x+Math.sin(yaw)*(2+i*3),z:tree.z+Math.cos(yaw)*(2+i*3),health:20*health,maxHealth:20,firewood:health<1?2:0})) : [];
  forest.applyTreePhases([{layoutIndex:tree.layoutIndex,phase,growthProgress:phase==='mature'?1:0,harvestProgress:progress,logs}]);
}
function select(species) {
  tree=candidates.find(t=>t.species===species)??candidates[0];
  forest.syncAuthoritativeTreeLayouts([tree.layoutIndex]); phase('mature'); view();
}
select('beech'); await frames(50);
document.querySelector('#status').textContent='Forestry ready';
window.__FORESTRY_QA__={
  settings,candidates,select,phase,view,frames,
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
    phase('mature'); await frames(2); phase('falling',0); const events=[];
    for(let i=0;i<=210;i++) {
      phase('falling',i/210); await frames(1);
      const next=forest.drainForestrySoundEvents(); events.push(...next);
      audio.tick(next,{centerX:tree.x,centerZ:tree.z,listenerX:tree.x,listenerZ:tree.z,orbitDistance:20},manager.camera);
    }
    phase('fallen'); await frames(30); events.push(...forest.drainForestrySoundEvents());
    return events;
  },
  dispose:()=>audio.dispose(),
};
