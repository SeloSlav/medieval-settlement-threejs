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
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import { createResidenceMesh } from '../residences/ResidenceMarkers.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { computeBurgageLayout } from '../residences/burgageLayout.ts';
import { setActivePlacedBuildingLayout, sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { updateTerrainBuildingPads } from '../terrain/TerrainBuildingPads.ts';
import { batchStaticFixtureMeshes } from './staticFixtureBatch.ts';

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
const settlement = { buildings: [], residences: [], parcels: [], batches: null };
if (params.get('settlement') === '1') {
  // Existing production assets and clearance/pad/access systems. This optional
  // fixture adds context without changing the established forest-only views.
  const zones = [
    { id: 'north', corners: [[228,14],[196,14],[196,32],[228,32]] },
    { id: 'south', corners: [[196,6],[228,6],[228,-12],[196,-12]] },
  ].map(({ id, corners }) => {
    const [cornerA, cornerB, cornerC, cornerD] = corners.map(([x,z]) => ({ x,z }));
    return { id, cornerA, cornerB, cornerC, cornerD, frontageEdge: 0, plotCount: 4 };
  });
  for (const zone of zones) {
    const layout = computeBurgageLayout({ a: zone.cornerA, b: zone.cornerB, c: zone.cornerC, d: zone.cornerD }, 0, 4);
    if (!layout) throw new Error(`Invalid environment review parcel: ${zone.id}`);
    settlement.parcels.push(...layout.parcels.map(parcel => parcel.polygon));
    settlement.residences.push(...layout.residences.map(placement => ({ ...placement, id: `${zone.id}-${placement.parcelIndex}`, zoneId: zone.id })));
  }
  settlement.buildings = [
    { id: 'village-well', kind: 'well', x: 231, z: 3, yaw: 0 },
    { id: 'forest-forager', kind: 'foragers_shed', x: 241, z: 20, yaw: Math.PI },
    { id: 'village-smithy', kind: 'smithy', x: 247, z: 0, yaw: 0 },
  ];
  const pads = BuildingTerrainLayout.fromSettlement(settlement.buildings, settlement.residences, sampleNaturalTerrainHeight);
  setActivePlacedBuildingLayout(pads);
  updateTerrainBuildingPads(manager.terrain, pads);
  network.addRoadPath([[189,-23],[190,-2],[196,10],[232,10],[253,10]].map(([x,z]) => manager.terrain.getPointAt(x,z)), 4.2);
  await initializeBuildingMaterialLibrary(manager.maxAnisotropy);
  const root = new THREE.Group();
  root.name = 'Environment review settlement';
  manager.scene.add(root);
  for (const [index, source] of [...settlement.residences, ...settlement.buildings].entries()) {
    const mesh = source.kind ? createBuildingMesh(source.kind) : createResidenceMesh((settings.seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0, 1);
    mesh.position.copy(manager.terrain.getPointAt(source.x, source.z));
    mesh.rotation.y = source.yaw;
    root.add(mesh);
  }
  new BurgageFencing(root, network).syncZones(zones, settlement.residences, (x,z) => manager.terrain.getHeightAt(x,z));
  settlement.batches = batchStaticFixtureMeshes(root, 'Environment review settlement batches').stats;
  manager.setForestClearanceSources(settlement.buildings, settlement.parcels, []);
}
manager.syncRoadNetwork(network);
if (settlement.buildings.length) manager.syncBuildingAccessRoads(settlement.buildings);
const views = {
  strategic: { target: [145, -36], distance: 185 },
  design: { target: [190, -20], distance: 75 },
  edge: { target: [190, -20], distance: 25 },
  ground: { target: [190, -20], distance: 13.54 },
  meadow: { target: [210, -5], distance: 18 },
  cap: { target: [210, -28], distance: 16 },
  village: { target: [219, 7], distance: 105 },
  lane: { target: [215, 10], distance: 42 },
  approach: { target: [238, 10], distance: 22 },
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
await frames(150, false, 1 / 60);
window.__ENVIRONMENT_GAUNTLET__ = {
  survey,
  settlement,
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
  async captureCanopyLayers(view = 'meadow') {
    setView(view);
    manager.setLightingDiagnostic('final');
    await frames(150, false, 1 / 60);
    windStrength.value = 0;
    const meshes = [];
    manager.scene.traverse(object => {
      if (object.isMesh && /^(americanBeech|whiteOak|redMaple|sweetgum|douglasFir|loblolly|pine) /.test(object.name)) meshes.push(object);
    });
    const masks = meshes.map(mesh => mesh.layers.mask);
    const catalog = meshes.map(mesh => {
      let shown = true;
      for (let object = mesh; object; object = object.parent) shown &&= object.visible;
      return { name: mesh.name, crownUnderlay: mesh.userData.crownUnderlay === true, shown, layerMask: mesh.layers.mask, count: mesh.count ?? 1 };
    });
    const results = {};
    const exclusions = {
      all: () => false,
      'without-crown-underlay': mesh => mesh.userData.crownUnderlay === true,
      'without-overview-cards': mesh => mesh.name.includes(' overview '),
      'without-detail-cards': mesh => mesh.name.endsWith(' cards') && !mesh.name.includes(' overview ') && !mesh.userData.crownUnderlay,
    };
    try {
      for (const [name, exclude] of Object.entries(exclusions)) {
        meshes.forEach((mesh, i) => { mesh.layers.mask = masks[i]; if (exclude(mesh)) mesh.layers.disable(0); });
        manager.render(0, orbitDistance);
        await manager.waitForSubmittedWork();
        results[name] = manager.renderer.domElement.toDataURL('image/png');
      }
    } finally {
      meshes.forEach((mesh, i) => { mesh.layers.mask = masks[i]; });
    }
    return { view, catalog, images: results };
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
    // Advance the existing time-based visibility fades before freezing the
    // authored screenshot. dt=0 here leaves overview cards resident after a
    // retreat and falsely adds their submissions to the next close view.
    await frames(150, false, 1 / 60);
    windStrength.value = 0;
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
