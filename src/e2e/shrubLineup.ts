import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  buildUndergrowthInstances,
  createUndergrowthMaterials,
  createUndergrowthPlacements,
  DOGWOOD_MAX_SCALE,
  DOGWOOD_MIN_SCALE,
  disposeUndergrowthInstances,
  type UndergrowthPlacement,
} from '../props/ForestUndergrowth.ts';
import { createBerryPatchVisuals } from '../foraging/BerryPatchVisuals.ts';
import { berryPatchMaxYield } from '../foraging/foragingYields.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import { mulberry32 } from '../utils/random.ts';
import { setWorldAnimationTime } from '../scene/worldAnimationTime.ts';
import {
  deciduousFoliageForSeasonPreview,
  type DeciduousFoliagePresentation,
} from '../world/deciduousFoliagePolicy.ts';
import type { Season } from '../world/seasonPolicy.ts';
import {
  createForestCores,
  createForestSpawnConfig,
} from '../props/forestField.ts';
import { computeForestTreePlacements } from '../props/forestPlacements.ts';
import { createRockPlacements } from '../props/ForestProps.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  DEFAULT_WORLD_SEED,
  deriveSubSeed,
  resolveWorldDimensions,
} from '../world/worldGenerationSettings.ts';

type DogwoodCaptureMode = 'baseline' | 'stems' | 'foliage' | 'final';

type DogwoodRenderEvidence = {
  mode: DogwoodCaptureMode;
  groupAttached: boolean;
  stemSubmissions: number;
  foliageSubmissions: number;
  renderCalls: number;
  timeSeconds: number;
  windStrength: number;
  variant: number | null;
};

type DogwoodCaptureOptions = {
  timeSeconds?: number;
  windStrength?: number;
  variant?: number | null;
};

type DogwoodPlacementSweep = {
  targetCount: number;
  acceptedCount: number;
  treeCount: number;
  rockCount: number;
  dogwoodCount: number;
  dogwoodMinimumScale: number;
  dogwoodMaximumScale: number;
  signature: string;
};

function createDefaultDogwoodPlacementSweep(worldSeed: number): DogwoodPlacementSweep {
  const dimensions = resolveWorldDimensions(DEFAULT_WORLD_GENERATION_SETTINGS.mapSize);
  const spawnConfig = createForestSpawnConfig(
    dimensions.generationSize,
    dimensions.terrainSize,
    1,
  );
  const forestCores = createForestCores(
    mulberry32(deriveSubSeed(worldSeed, 'forest')),
    spawnConfig,
  );
  const treeSeed = deriveSubSeed(worldSeed, 'trees');
  const treePlacements = computeForestTreePlacements(
    spawnConfig.playableSize,
    spawnConfig.terrainSize,
    undefined,
    { treeSeed, forestCores },
  );
  const placementRandom = mulberry32(treeSeed);
  const rockPlacements = createRockPlacements(
    placementRandom,
    forestCores,
    treePlacements,
    spawnConfig,
  );
  const accepted = createUndergrowthPlacements(
    placementRandom,
    forestCores,
    spawnConfig,
    undefined,
    treePlacements,
  );
  const dogwoods = accepted.filter((placement) => placement.kind === 'dogwood');
  let hash = 0x811c9dc5;
  for (const placement of accepted) {
    const token = [
      placement.kind,
      placement.x.toFixed(5),
      placement.z.toFixed(5),
      placement.scale.toFixed(5),
      placement.yaw.toFixed(5),
      placement.prototypeIndex,
    ].join(':');
    for (let index = 0; index < token.length; index++) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return {
    targetCount: spawnConfig.undergrowthTargetCount,
    acceptedCount: accepted.length,
    treeCount: treePlacements.length,
    rockCount: rockPlacements.length,
    dogwoodCount: dogwoods.length,
    dogwoodMinimumScale: Math.min(...dogwoods.map((placement) => placement.scale)),
    dogwoodMaximumScale: Math.max(...dogwoods.map((placement) => placement.scale)),
    signature: (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

declare global {
  interface Window {
    __SHRUB_LINEUP_READY__?: boolean;
    __DOGWOOD_LINEUP_CAPTURE__?: (
      mode: DogwoodCaptureMode,
      options?: DogwoodCaptureOptions,
    ) => Promise<DogwoodRenderEvidence>;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Shrub lineup host is missing.');
const query = new URLSearchParams(window.location.search);
const isRichBerryPatch = query.get('rich') === '1';
const focus = query.get('focus') ?? 'berries';
const isDogwoodFocus = focus === 'dogwood';
const requestedSeason = query.get('season');
const season: Season = requestedSeason === 'autumn' || requestedSeason === 'winter'
  ? requestedSeason
  : 'summer';
const foliagePresentation = deciduousFoliageForSeasonPreview(season);
const requestedTimeValue = query.get('time');
const requestedTime = Number(requestedTimeValue);
const fixedAnimationTime = requestedTimeValue !== null && Number.isFinite(requestedTime)
  ? requestedTime
  : null;
const requestedDogwoodScale = Number(query.get('scale') ?? '1');
const dogwoodScale = THREE.MathUtils.clamp(
  Number.isFinite(requestedDogwoodScale) ? requestedDogwoodScale : 1,
  DOGWOOD_MIN_SCALE,
  DOGWOOD_MAX_SCALE,
);
const requestedStock = Number(query.get('stock') ?? '1');
const stockRatio = THREE.MathUtils.clamp(Number.isFinite(requestedStock) ? requestedStock : 1, 0, 1);
const dogwoodPlacementSweep = isDogwoodFocus
  ? createDefaultDogwoodPlacementSweep(DEFAULT_WORLD_SEED)
  : null;
const repeatedDogwoodPlacementSweep = isDogwoodFocus
  ? createDefaultDogwoodPlacementSweep(DEFAULT_WORLD_SEED)
  : null;
if (
  dogwoodPlacementSweep
  && repeatedDogwoodPlacementSweep
  && dogwoodPlacementSweep.signature !== repeatedDogwoodPlacementSweep.signature
) {
  throw new Error('Default dogwood placement sweep is not seed-stable.');
}

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
await renderer.init();
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeb9a2);
scene.fog = new THREE.Fog(0xaeb9a2, 34, 68);
scene.add(new THREE.HemisphereLight(0xe6eee1, 0x4a3d2c, 2.4));
const sun = new THREE.DirectionalLight(0xffefd1, 3.8);
sun.position.set(-8, 15, 10);
scene.add(sun);

const terrain = { getHeightAt: () => 0 } as unknown as Terrain;
const placements: UndergrowthPlacement[] = [];
const lineupKinds = isDogwoodFocus
  ? [['dogwood', 0] as const]
  : [
    ['bush', -7.2] as const,
    ['fern', -2.6] as const,
    ['juniper', 2.7] as const,
  ];
for (const [kind, centerX] of lineupKinds) {
  for (let variant = 0; variant < 3; variant++) {
    placements.push({
      kind,
      x: centerX + (variant - 1) * (kind === 'dogwood' ? 2.65 : kind === 'juniper' ? 1.15 : 0.82),
      z: kind === 'dogwood' ? (variant === 1 ? 0.35 : -0.22) : variant === 1 ? 0.42 : -0.18,
      scale: kind === 'dogwood'
        ? dogwoodScale
        : kind === 'bush'
          ? 0.92
          : kind === 'fern'
            ? 1.0
            : 0.72,
      yaw: variant * 2.07 + 0.3,
      prototypeIndex: variant,
      meshIndex: -1,
    } as UndergrowthPlacement);
  }
}

const random = mulberry32(0x6f72736b);
const materials = await createUndergrowthMaterials(
  renderer.getMaxAnisotropy(),
  'webgpu',
  [],
);
const undergrowth = buildUndergrowthInstances(placements, terrain, materials, random);
scene.add(undergrowth.group);
const seasonalUndergrowth = undergrowth as typeof undergrowth & {
  setDeciduousFoliage?: (presentation: DeciduousFoliagePresentation) => boolean;
};
if (isDogwoodFocus) {
  if (!seasonalUndergrowth.setDeciduousFoliage) {
    throw new Error('Dogwood lineup requires the live undergrowth seasonal lifecycle.');
  }
  seasonalUndergrowth.setDeciduousFoliage(foliagePresentation);
}

const berries = await createBerryPatchVisuals(
  terrain,
  [{ kind: 'berries', x: 8, z: 0, isRich: isRichBerryPatch }],
  renderer.getMaxAnisotropy(),
  'webgpu',
  0x72617370,
);
scene.add(berries.group);
berries.group.visible = !isDogwoodFocus;
const berryCapacity = berryPatchMaxYield(isRichBerryPatch);
const berryNode: ForagingNodeState = {
  nodeId: 'foraging-berries-0',
  kind: 'berries',
  resource: 'berries',
  remaining: berryCapacity * stockRatio,
  maxYield: berryCapacity,
  x: 8,
  z: 0,
  isRich: isRichBerryPatch,
};
berries.sync([berryNode], 7);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 12),
  new THREE.MeshStandardMaterial({ color: 0x65784f, roughness: 1 }),
);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.035;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
const view = query.get('view') ?? 'design';
if (view === 'near') {
  if (isDogwoodFocus) {
    camera.position.set(0.2, 2.9, 7.1);
    camera.lookAt(0, 1.58, 0);
  } else if (focus === 'bilberry') {
    camera.position.set(-7.2, 1.2, 2.05);
    camera.lookAt(-7.2, 0.55, 0);
  } else if (focus === 'fern') {
    camera.position.set(-2.6, 1.55, 4.2);
    camera.lookAt(-2.6, 0.48, 0);
  } else if (focus === 'juniper-detail') {
    camera.position.set(2.7, 1.2, 2.15);
    camera.lookAt(2.7, 0.72, 0);
  } else if (focus === 'juniper') {
    camera.position.set(2.7, 1.75, 4.6);
    camera.lookAt(2.7, 0.72, 0);
  } else {
    camera.position.set(11.2, 2.7, 6.3);
    camera.lookAt(8, 1.0, 0);
  }
} else if (view === 'far') {
  if (isDogwoodFocus) {
    camera.position.set(0.4, 9.2, 21.2);
    camera.lookAt(0, 1.65, 0);
  } else {
    camera.position.set(0, 14.5, 31);
    camera.lookAt(0.5, 0.75, 0);
  }
} else {
  if (isDogwoodFocus) {
    camera.position.set(0.35, 5.8, 13.2);
    camera.lookAt(0, 1.65, 0);
  } else {
    camera.position.set(0.5, 7.8, 19.5);
    camera.lookAt(0.5, 0.82, 0);
  }
}

windStrength.value = 0.38;
windSpeed.value = 0.84;
let running = true;
let capturePaused = false;
let stemSubmissions = 0;
let foliageSubmissions = 0;
const dogwoodMaterials = (
  materials as typeof materials & { dogwood?: [THREE.Material, THREE.Material] }
).dogwood;
const dogwoodBuckets = (
  undergrowth.buckets as typeof undergrowth.buckets & {
    dogwood?: Array<(typeof undergrowth.buckets.bush)[number]>;
  }
).dogwood;
if (isDogwoodFocus && (!dogwoodMaterials || !dogwoodBuckets)) {
  throw new Error('Dogwood lineup requires live dogwood materials and prototype buckets.');
}
for (const bucket of dogwoodBuckets ?? []) {
  const previousOnBeforeRender = bucket.mesh.onBeforeRender;
  bucket.mesh.onBeforeRender = function (...args) {
    previousOnBeforeRender.call(this, ...args);
    const group = args[5] as unknown as { materialIndex?: number } | null;
    if (group?.materialIndex === 0) stemSubmissions += 1;
    if (group?.materialIndex === 1) foliageSubmissions += 1;
  };
}

function prepareFrame(now: number, animationTimeOverride?: number): number {
  const animationTime = animationTimeOverride ?? fixedAnimationTime ?? now * 0.001;
  setWorldAnimationTime(animationTime);
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return animationTime;
}

function render(now = performance.now()): void {
  if (!running) return;
  if (!capturePaused) {
    prepareFrame(now);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(render);
}

if (isDogwoodFocus && dogwoodMaterials) {
  window.__DOGWOOD_LINEUP_CAPTURE__ = async (mode, options = {}) => {
    capturePaused = true;
    const requestedVariant = options.variant;
    const variant = Number.isInteger(requestedVariant)
      && Number(requestedVariant) >= 0
      && Number(requestedVariant) < (dogwoodBuckets?.length ?? 0)
      ? Number(requestedVariant)
      : null;
    for (let index = 0; index < (dogwoodBuckets?.length ?? 0); index++) {
      const visible = variant === null || index === variant;
      dogwoodBuckets![index]!.mesh.visible = visible;
      dogwoodBuckets![index]!.shadowMesh.visible = visible;
    }
    dogwoodMaterials[0].visible = mode === 'stems' || mode === 'final';
    dogwoodMaterials[1].visible = foliagePresentation.dormancy < 1
      && (mode === 'foliage' || mode === 'final');
    const captureWindStrength = typeof options.windStrength === 'number'
      && Number.isFinite(options.windStrength)
      ? THREE.MathUtils.clamp(Number(options.windStrength), 0, 1)
      : 0.38;
    windStrength.value = captureWindStrength;
    stemSubmissions = 0;
    foliageSubmissions = 0;
    const captureTime = prepareFrame(
      performance.now(),
      typeof options.timeSeconds === 'number' && Number.isFinite(options.timeSeconds)
        ? options.timeSeconds
        : undefined,
    );
    renderer.info.reset();
    renderer.render(scene, camera);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      mode,
      groupAttached: undergrowth.group.parent === scene,
      stemSubmissions,
      foliageSubmissions,
      renderCalls: renderer.info.render.calls,
      timeSeconds: captureTime,
      windStrength: captureWindStrength,
      variant,
    };
  };
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
window.__SHRUB_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.view = view;
document.body.dataset.focus = focus;
document.body.dataset.season = season;
document.body.dataset.animationTime = fixedAnimationTime === null
  ? 'live'
  : fixedAnimationTime.toFixed(2);
document.body.dataset.dogwoodSpringFlush = foliagePresentation.springFlush.toFixed(2);
document.body.dataset.dogwoodAutumnColor = foliagePresentation.autumnColor.toFixed(2);
document.body.dataset.dogwoodDormancy = foliagePresentation.dormancy.toFixed(2);
document.body.dataset.dogwoodScale = dogwoodScale.toFixed(2);
if (dogwoodPlacementSweep && repeatedDogwoodPlacementSweep) {
  document.body.dataset.dogwoodDefaultTarget = String(dogwoodPlacementSweep.targetCount);
  document.body.dataset.dogwoodDefaultAccepted = String(dogwoodPlacementSweep.acceptedCount);
  document.body.dataset.dogwoodDefaultTreeCount = String(dogwoodPlacementSweep.treeCount);
  document.body.dataset.dogwoodDefaultRockCount = String(dogwoodPlacementSweep.rockCount);
  document.body.dataset.dogwoodDefaultCount = String(dogwoodPlacementSweep.dogwoodCount);
  document.body.dataset.dogwoodDefaultMinimumScale = dogwoodPlacementSweep.dogwoodMinimumScale.toFixed(6);
  document.body.dataset.dogwoodDefaultMaximumScale = dogwoodPlacementSweep.dogwoodMaximumScale.toFixed(6);
  document.body.dataset.dogwoodDefaultSignature = dogwoodPlacementSweep.signature;
  document.body.dataset.dogwoodRepeatedSignature = repeatedDogwoodPlacementSweep.signature;
}
document.body.dataset.berryRich = String(isRichBerryPatch);
document.body.dataset.berryStockRatio = stockRatio.toFixed(2);
document.body.dataset.visibleRaspberryFruit = String(
  berries.group.userData.visibleRaspberryFruit ?? 0,
);
document.body.dataset.raspberryFruitCapacity = String(
  berries.group.userData.raspberryFruitCapacity ?? 0,
);
document.body.dataset.raspberryClumpCount = String(
  berries.group.userData.raspberryClumpCount ?? 0,
);
document.body.dataset.raspberryCaneHeightMultiplier = String(
  berries.group.userData.raspberryCaneHeightMultiplier ?? 0,
);
document.body.dataset.ordinaryTriangles = String(
  Object.values(materials.prototypes).flat().reduce((sum, prototype) => sum + prototype.triangleCount, 0),
);
const dogwoodHeights: number[] = [];
const dogwoodGroundContacts: number[] = [];
const dogwoodGroundOrigins: number[] = [];
const dogwoodStemCounts: number[] = [];
const dogwoodWidthsX: number[] = [];
const dogwoodWidthsZ: number[] = [];
let dogwoodTriangles = 0;
for (const bucket of dogwoodBuckets ?? []) {
  bucket.mesh.geometry.computeBoundingBox();
  const localBounds = bucket.mesh.geometry.boundingBox;
  dogwoodStemCounts.push(Number(bucket.mesh.geometry.userData.dogwoodStemCount));
  dogwoodTriangles += Number(bucket.mesh.userData.prototypeTriangleCount ?? 0);
  if (!localBounds) continue;
  for (const matrix of bucket.matrices) {
    const worldBounds = localBounds.clone().applyMatrix4(matrix);
    dogwoodGroundOrigins.push(matrix.elements[13]!);
    dogwoodGroundContacts.push(worldBounds.min.y);
    dogwoodHeights.push(worldBounds.max.y - worldBounds.min.y);
    dogwoodWidthsX.push(worldBounds.max.x - worldBounds.min.x);
    dogwoodWidthsZ.push(worldBounds.max.z - worldBounds.min.z);
  }
}
document.body.dataset.dogwoodInstances = String(
  (dogwoodBuckets ?? []).reduce((sum, bucket) => sum + bucket.mesh.count, 0),
);
document.body.dataset.dogwoodStemCounts = dogwoodStemCounts.join(',');
document.body.dataset.dogwoodFinalHeights = dogwoodHeights
  .map((height) => height.toFixed(6))
  .join(',');
document.body.dataset.dogwoodGroundContacts = dogwoodGroundContacts
  .map((height) => height.toFixed(6))
  .join(',');
document.body.dataset.dogwoodGroundOrigins = dogwoodGroundOrigins
  .map((height) => height.toFixed(6))
  .join(',');
document.body.dataset.dogwoodFinalWidthsX = dogwoodWidthsX
  .map((width) => width.toFixed(6))
  .join(',');
document.body.dataset.dogwoodFinalWidthsZ = dogwoodWidthsZ
  .map((width) => width.toFixed(6))
  .join(',');
document.body.dataset.dogwoodTriangles = String(dogwoodTriangles);
document.body.dataset.dogwoodLeafyDrawCalls = String(
  undergrowth.stats.dogwood.leafyDrawCalls,
);
document.body.dataset.dogwoodBareDrawCalls = String(
  undergrowth.stats.dogwood.bareDrawCalls,
);
document.body.dataset.dogwoodShadowWidths = (dogwoodBuckets ?? [])
  .map((bucket) => Number(bucket.shadowMesh.geometry.userData.dogwoodShadowWidth ?? 1).toFixed(4))
  .join(',');
document.body.dataset.dogwoodSignature = [
  view,
  season,
  fixedAnimationTime === null ? 'live' : fixedAnimationTime.toFixed(2),
  dogwoodScale.toFixed(2),
  dogwoodStemCounts.join(','),
  dogwoodHeights.map((height) => height.toFixed(6)).join(','),
  dogwoodGroundContacts.map((height) => height.toFixed(6)).join(','),
  dogwoodGroundOrigins.map((height) => height.toFixed(6)).join(','),
  dogwoodWidthsX.map((width) => width.toFixed(6)).join(','),
  dogwoodWidthsZ.map((width) => width.toFixed(6)).join(','),
  dogwoodTriangles,
].join(':');

if (isDogwoodFocus) {
  const labels = document.querySelector<HTMLElement>('#labels');
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `Common dogwood · Cornus sanguinea · ${season}`;
  labels?.replaceChildren(label);
}

window.addEventListener('beforeunload', () => {
  running = false;
  berries.dispose();
  disposeUndergrowthInstances(undergrowth, materials);
  (ground.material as THREE.Material).dispose();
  ground.geometry.dispose();
  renderer.dispose();
});
