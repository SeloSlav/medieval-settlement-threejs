// @ts-nocheck -- Opt-in local visual gauntlet; uses the complete game renderer.
import * as THREE from 'three';
import { SceneManager } from '../scene/SceneManager.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../world/worldGenerationSettings.ts';
import { setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { parseVisualQaConditions, standaloneVisualQaEnvironment, applyVisualQaClock } from '../app/visualQaConditions.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { computeDayNightState } from '../world/dayNightPresentation.ts';
import { createVisualGpuTimestampProfiler } from './webGpuTimestampProfiler.ts';
import { windStrength } from '@seedthree/core/wind.js';
import { GORSKI_KOTAR_SPECIES } from '../vegetation/seedthree/gorskiKotarPresets.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { loadSeedThreeGrassTextures } from '../vegetation/seedthree/seedThreeGrass.ts';

const params = new URLSearchParams(location.search);
if (params.get('conifers') === 'baseline') {
  for (const [key, values] of Object.entries({
    douglasFir: { leavesPerBranch: 10, size: 0.6, startFrac: 0.15 },
    loblolly: { leavesPerBranch: 8, size: 0.85, startFrac: 0.2 },
    pine: { leavesPerBranch: 9, size: 0.7, startFrac: 0.15 },
  })) {
    Object.assign(GORSKI_KOTAR_SPECIES[key].foliage, values);
    delete GORSKI_KOTAR_SPECIES[key].foliage.cardCoverage;
  }
}
const settings = { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'small', terrainPreset: 'mrkopalj_polje', seed: Number(params.get('seed') ?? 0x4d5a2e0d), topography: 12, hydrology: 40 };
setDraftWorldGeneration(settings);
const manager = await SceneManager.create(document.querySelector('#world'), settings, progress => {
  document.querySelector('#status').textContent = `${progress.label} · ${progress.detail}`;
});
manager.resize({ width: 1280, height: 720 });
await manager.finishVegetation();
await manager.materials.whenTexturesReady();
await manager.sky.ready;
windStrength.value = 0;
let conditions = parseVisualQaConditions(`?visualQa=${params.get('season') ?? 'daylight'}`);
manager.setEnvironment(standaloneVisualQaEnvironment(conditions));
manager.applyDayNight(computeDayNightState(applyVisualQaClock(gameClock(0), conditions), false));
manager.setIllustratedMapActive(false);
const network = new RoadNetwork();
for (const points of [
  [[166, -8], [177, -12], [189, -23], [210, -28]],
  [[189, -23], [191, -40], [184, -54]],
]) network.addRoadPath(points.map(([x,z]) => manager.terrain.getPointAt(x,z)), 4.2);
manager.syncRoadNetwork(network);
const views = {
  strategic: { target: [145, -36], distance: 185 },
  design: { target: [190, -20], distance: 75 },
  edge: { target: [190, -20], distance: 25 },
  ground: { target: [190, -20], distance: 13.54 },
  meadow: { target: [210, -5], distance: 18 },
  cap: { target: [210, -28], distance: 16 },
};
const trees = manager.getForestManager().getTreeLayouts();
const survey = [];
for (let x = 105; x <= 190; x += 5) for (let z = -85; z <= -5; z += 5) {
  const blend = manager.terrain.getForestBlendAt(x, z);
  if (blend < 0.08 || blend > 0.55 || manager.riverSystem.isBlockedAt(x, z)) continue;
  const nearest = Math.min(...trees.map(t => Math.hypot(t.x - x, t.z - z)));
  if (nearest > 4) survey.push({ x, z, blend, nearest });
}
let activeView = 'design';
let orbitDistance = 60;
function setView(id) {
  const view = views[id];
  activeView = id;
  orbitDistance = view.distance;
  const [x, z] = view.target;
  manager.cameraTarget.set(x, manager.terrain.getHeightAt(x, z), z);
  manager.camera.position.copy(manager.cameraTarget).add(new THREE.Vector3(0.3, 0.72, 0.63).normalize().multiplyScalar(orbitDistance));
  manager.camera.lookAt(manager.cameraTarget);
  manager.camera.updateMatrixWorld(true);
}
const nextFrame = () => new Promise(requestAnimationFrame);
const summarize = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  return { median: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
};
async function frames(count, collect = false, dt = 0) {
  const samples = [];
  let last;
  for (let i = 0; i < count; i++) {
    const time = await nextFrame();
    const start = performance.now();
    const handle = collect ? gpu.beginFrame(time) : null;
    manager.render(dt, orbitDistance);
    if (handle) gpu.endFrame(handle);
    if (collect && last !== undefined) samples.push({ time, frameMs: time - last, cpuMs: performance.now() - start });
    last = time;
  }
  return samples;
}
const gpu = createVisualGpuTimestampProfiler({ kind: manager.rendererBackend, renderer: manager.renderer });
setView(activeView);
await frames(90);
window.__ENVIRONMENT_GAUNTLET__ = {
  survey,
  views: Object.keys(views),
  async setGrassImage(dataUrl) {
    const source = await new THREE.TextureLoader().loadAsync(dataUrl);
    const { albedo } = await loadSeedThreeGrassTextures(1);
    albedo.image = source.image;
    albedo.needsUpdate = true;
    source.dispose();
  },
  async setConditions(preset) {
    conditions = parseVisualQaConditions(`?visualQa=${preset}`);
    manager.setEnvironment(standaloneVisualQaEnvironment(conditions));
    manager.applyDayNight(computeDayNightState(applyVisualQaClock(gameClock(0), conditions), false));
    await frames(360, false, 1 / 30);
    windStrength.value = 0;
  },
  async captureMotion({ sampleCount = 720 } = {}) {
    setView('design');
    manager.setLightingDiagnostic('final');
    await frames(120, false, 1 / 60);
    const samples = [];
    const lod = [];
    let last;
    for (let i = 0; i < sampleCount; i++) {
      // Out-and-back logarithmic zoom crosses all existing near/overview
      // handoffs without changing their thresholds or resident capacities.
      const phase = (1 - Math.cos(i / (sampleCount - 1) * Math.PI * 2)) * .5;
      orbitDistance = Math.exp(Math.log(185) * (1 - phase) + Math.log(13.54) * phase);
      manager.camera.position.copy(manager.cameraTarget).add(new THREE.Vector3(.3, .72, .63).normalize().multiplyScalar(orbitDistance));
      manager.camera.lookAt(manager.cameraTarget);
      manager.camera.updateMatrixWorld(true);
      const time = await nextFrame();
      const start = performance.now();
      const handle = gpu.beginFrame(time);
      manager.render(1 / 60, orbitDistance);
      if (handle) gpu.endFrame(handle);
      if (last !== undefined) samples.push({ time, frameMs: time-last, cpuMs: performance.now()-start });
      if (i % 30 === 0) lod.push({ frame: i, distance: orbitDistance, renderer: manager.getPerformanceStats(), grass: manager.grassField?.getStreamTelemetry() });
      last = time;
    }
    await manager.waitForSubmittedWork();
    await nextFrame();
    for (const sample of samples) sample.gpuMs = gpu.getFrameTiming(sample.time).durationMs;
    return { settings, conditions, samples, lod, adapter: manager.getRendererAdapterEvidence(), gpuEvidence: gpu.getEvidence(), frameMs: summarize(samples.map(s => s.frameMs)), cpuMs: summarize(samples.map(s => s.cpuMs)), gpuMs: summarize(samples.map(s => s.gpuMs)) };
  },
  async capture({ view, diagnostic = 'final', sampleCount = 240 }) {
    setView(view);
    manager.setLightingDiagnostic(diagnostic);
    await frames(150);
    const samples = await frames(sampleCount, true);
    await manager.waitForSubmittedWork();
    await nextFrame();
    for (const sample of samples) sample.gpuMs = gpu.getFrameTiming(sample.time).durationMs;
    // Native drawing-buffer capture after the GPU queue settles avoids stale compositor frames.
    manager.render(0, orbitDistance);
    await manager.waitForSubmittedWork();
    return {
      png: manager.renderer.domElement.toDataURL('image/png'),
      view: activeView, diagnostic, settings, conditions,
      camera: manager.camera.matrixWorld.toArray(), projection: manager.camera.projectionMatrix.toArray(),
      renderer: manager.getPerformanceStats(), adapter: manager.getRendererAdapterEvidence(),
      forest: manager.getForestManager().getSeedThreeStructuralStats(),
      grass: manager.grassField?.getStreamTelemetry(),
      frameMs: summarize(samples.map(s => s.frameMs)), cpuMs: summarize(samples.map(s => s.cpuMs)),
      gpuMs: summarize(samples.map(s => s.gpuMs).filter(v => v !== null)), gpuEvidence: gpu.getEvidence(), samples,
    };
  },
  manager,
};
document.body.classList.add('ready');
