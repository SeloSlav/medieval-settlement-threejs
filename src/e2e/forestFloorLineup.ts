import * as THREE from 'three';
import { setForestCardSnowCoverage } from '@seedthree/core/branch-cards.js';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import { WebGPURenderer } from 'three/webgpu';
import {
  FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
  FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
  FOREST_FLOOR_IVY_LAYER_COUNT,
  FOREST_FLOOR_IVY_SEED,
  FOREST_FLOOR_IVY_TEXTURE_PATH,
  createForestFloorIvyMaterial,
  createTerrainConformingIvyGeometry,
  type ForestFloorIvyPlacement,
} from '../props/ForestFloorIvy.ts';
import {
  FOREST_FLOOR_TWIG_VARIANT_COUNT,
  FOREST_FLOOR_TWIG_VARIANTS,
  composeForestFloorTwigMatrix,
  createForestFloorTwigGeometry,
  createForestFloorTwigMaterial,
  loadForestFloorTwigTextures,
  type ForestFloorTwigPlacement,
} from '../props/ForestFloorTwigs.ts';
import {
  FOREST_FLOOR_NETTLE_SEED,
  createForestFloorNettleInstances,
  createForestFloorNettlePlacements,
} from '../props/ForestFloorNettles.ts';
import {
  computeForestTreePlacements,
  type ForestTreePlacement,
} from '../props/forestPlacements.ts';
import {
  createForestCores,
  createForestSpawnConfig,
  mulberry32,
} from '../props/forestField.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import { setWorldAnimationTime } from '../scene/worldAnimationTime.ts';
import { deciduousFoliageForSeasonPreview } from '../world/deciduousFoliagePolicy.ts';
import type { Season } from '../world/seasonPolicy.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  DEFAULT_WORLD_SEED,
  deriveSubSeed,
  resolveWorldDimensions,
} from '../world/worldGenerationSettings.ts';

type ForestFloorCaptureMode = 'baseline' | 'nettles' | 'twigs' | 'final';

type ForestFloorRenderEvidence = {
  mode: ForestFloorCaptureMode;
  nettleGroupAttached: boolean;
  twigGroupAttached: boolean;
  nettleSubmissions: number;
  twigSubmissions: number;
  renderCalls: number;
  triangles: number;
};

declare global {
  interface Window {
    __FOREST_FLOOR_LINEUP_READY__?: boolean;
    __FOREST_FLOOR_SET_CAPTURE_MODE__?: (
      mode: ForestFloorCaptureMode,
    ) => Promise<ForestFloorRenderEvidence>;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Forest-floor lineup host is missing.');

const query = new URLSearchParams(window.location.search);
const view = query.get('view') ?? 'design';
const requestedSeason = query.get('season');
const season: Season = requestedSeason === 'autumn' || requestedSeason === 'winter'
  ? requestedSeason
  : 'summer';
const deciduousFoliage = deciduousFoliageForSeasonPreview(season);
const ivySnowCoverage = season === 'winter' ? 0.86 : 0;
const requestedTimeValue = query.get('time');
const requestedTime = Number(requestedTimeValue);
const fixedAnimationTime = requestedTimeValue !== null && Number.isFinite(requestedTime)
  ? requestedTime
  : null;
document.body.dataset.clean = String(query.get('clean') === '1');

const defaultDimensions = resolveWorldDimensions(DEFAULT_WORLD_GENERATION_SETTINGS.mapSize);
const defaultSpawnConfig = createForestSpawnConfig(
  defaultDimensions.generationSize,
  defaultDimensions.terrainSize,
  1,
);
const defaultForestCores = createForestCores(
  mulberry32(deriveSubSeed(DEFAULT_WORLD_SEED, 'forest')),
  defaultSpawnConfig,
);
const defaultTreeSeed = deriveSubSeed(DEFAULT_WORLD_SEED, 'trees');
const defaultTreePlacements = computeForestTreePlacements(
  defaultDimensions.generationSize,
  defaultDimensions.terrainSize,
  undefined,
  { treeSeed: defaultTreeSeed, forestCores: defaultForestCores },
);
const defaultNettlePlacements = createForestFloorNettlePlacements(
  defaultTreePlacements,
  (defaultTreeSeed ^ FOREST_FLOOR_NETTLE_SEED) >>> 0,
);
const defaultNettleSourceIndices = new Set(
  defaultNettlePlacements.map((placement) => placement.sourceTreeIndex),
);
const defaultNettleVariantCounts = [0, 1, 2].map(
  (variant) => defaultNettlePlacements.filter(
    (placement) => placement.prototypeIndex === variant,
  ).length,
);

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
await renderer.init();
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6f7768);
scene.fog = new THREE.Fog(0x6f7768, 23, 48);
scene.add(new THREE.HemisphereLight(0xdce4d4, 0x30291f, 1.72));
const sun = new THREE.DirectionalLight(0xffe6bf, 2.65);
sun.position.set(-9, 15, 7);
scene.add(sun);

function terrainHeightAt(x: number, z: number): number {
  return x * 0.018
    + Math.sin(x * 0.28 + 0.35) * 0.075
    + Math.cos(z * 0.34 - 0.2) * 0.045
    + Math.sin((x + z) * 0.19) * 0.035;
}

const terrainSurface = { getHeightAt: terrainHeightAt } as Terrain;
const placements: ForestFloorIvyPlacement[] = [
  { x: 0, z: 0.25, sourceTreeIndex: 0, scale: 1.28, yaw: -0.18, radiusX: 3.35, radiusZ: 1.86, reliefHeight: 0.22, reliefPhase: 0.42 },
  { x: -4.75, z: -1.85, sourceTreeIndex: 1, scale: 1.1, yaw: 0.61, radiusX: 2.85, radiusZ: 1.58, reliefHeight: 0.2, reliefPhase: 2.2 },
  { x: 4.65, z: -1.55, sourceTreeIndex: 2, scale: 1.02, yaw: -0.72, radiusX: 2.72, radiusZ: 1.48, reliefHeight: 0.18, reliefPhase: 4.1 },
  { x: -3.35, z: 2.3, sourceTreeIndex: 3, scale: 1.0, yaw: -0.48, radiusX: 2.6, radiusZ: 1.43, reliefHeight: 0.19, reliefPhase: 1.34 },
  { x: 3.35, z: 2.55, sourceTreeIndex: 4, scale: 1.12, yaw: 0.44, radiusX: 2.92, radiusZ: 1.62, reliefHeight: 0.21, reliefPhase: 5.3 },
  { x: -7.25, z: 1.2, sourceTreeIndex: 5, scale: 0.93, yaw: 0.16, radiusX: 2.45, radiusZ: 1.36, reliefHeight: 0.17, reliefPhase: 3.2 },
  { x: 7.1, z: 1.15, sourceTreeIndex: 6, scale: 0.96, yaw: -0.12, radiusX: 2.5, radiusZ: 1.4, reliefHeight: 0.18, reliefPhase: 0.9 },
];

const ivyGeometry = createTerrainConformingIvyGeometry(
  placements,
  terrainSurface,
  placements.length,
  FOREST_FLOOR_IVY_SEED,
).geometry;
const ivyTextures = await loadSeedThreeGroundCoverTextures(
  { albedo: FOREST_FLOOR_IVY_TEXTURE_PATH },
  renderer.getMaxAnisotropy(),
);
const ivyMaterial = createForestFloorIvyMaterial(
  'SeedThree layered forest-floor ivy lineup',
  ivyTextures,
  'webgpu',
);
setForestCardSnowCoverage(ivyMaterial, ivySnowCoverage);
windStrength.value = 0.5;
windSpeed.value = 0.84;
const ivy = new THREE.Mesh(ivyGeometry, ivyMaterial);
ivy.name = 'Four-strata terrain-conforming ivy lineup';
ivy.frustumCulled = false;
ivy.renderOrder = 2;
scene.add(ivy);

const nettleSourceTrees: ForestTreePlacement[] = Array.from(
  { length: 35 },
  (_, index) => {
    const column = index % 7;
    const row = Math.floor(index / 7);
    return {
      x: -7.2 + column * 2.4 + (row % 2) * 0.55,
      z: -4.1 + row * 2.15,
      species: 'beech',
      form: 'broad',
      scale: 1,
    };
  },
);
const [nettles, twigTextures] = await Promise.all([
  createForestFloorNettleInstances(
    nettleSourceTrees,
    terrainSurface,
    renderer.getMaxAnisotropy(),
    'webgpu',
    0x7572_7469,
  ),
  loadForestFloorTwigTextures(undefined, renderer.getMaxAnisotropy()),
]);
nettles.setDeciduousFoliage(deciduousFoliage);
scene.add(nettles.group);

const twigPlacements: ForestFloorTwigPlacement[] = Array.from(
  { length: 18 },
  (_, index) => {
    const variantIndex = index % FOREST_FLOOR_TWIG_VARIANT_COUNT;
    const scale = 0.86 + (index % 5) * 0.065;
    const tone = new THREE.Color().setHSL(
      0.075 + (index % 4) * 0.009,
      0.055 + (index % 3) * 0.018,
      0.64 + (index % 5) * 0.035,
    );
    return {
      x: -7.4 + (index % 6) * 2.95 + (Math.floor(index / 6) % 2) * 0.42,
      z: -2.95 + Math.floor(index / 6) * 3.05 + (index % 2) * 0.24,
      sourceTreeIndex: index % nettleSourceTrees.length,
      variantIndex,
      yaw: ((index * 0.381966) % 1) * Math.PI * 2,
      scale,
      thicknessScale: 0.9 + (index % 4) * 0.065,
      length: FOREST_FLOOR_TWIG_VARIANTS[variantIndex]!.length * scale,
      tint: [tone.r, tone.g, tone.b],
    };
  },
);
const twigMaterial = createForestFloorTwigMaterial(twigTextures);
const twigGroup = new THREE.Group();
twigGroup.name = 'Deterministic textured forest-floor twig lineup';
const twigMeshes: THREE.InstancedMesh[] = [];
for (let variantIndex = 0; variantIndex < FOREST_FLOOR_TWIG_VARIANT_COUNT; variantIndex++) {
  const variantPlacements = twigPlacements.filter(
    (placement) => placement.variantIndex === variantIndex,
  );
  const geometry = createForestFloorTwigGeometry(variantIndex);
  const mesh = new THREE.InstancedMesh(geometry, twigMaterial, variantPlacements.length);
  mesh.name = `Lineup textured twig variant ${variantIndex + 1}`;
  mesh.count = variantPlacements.length;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  const tint = new THREE.Color();
  for (const [instanceIndex, placement] of variantPlacements.entries()) {
    mesh.setMatrixAt(instanceIndex, composeForestFloorTwigMatrix(placement, terrainSurface));
    tint.setRGB(...placement.tint);
    mesh.setColorAt(instanceIndex, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  twigGroup.add(mesh);
  twigMeshes.push(mesh);
}
scene.add(twigGroup);

let nettleSubmissions = 0;
let twigSubmissions = 0;
for (const bucket of nettles.buckets) {
  bucket.mesh.onBeforeRender = () => {
    nettleSubmissions += 1;
  };
}
for (const mesh of twigMeshes) {
  mesh.onBeforeRender = () => {
    twigSubmissions += 1;
  };
}

const groundGeometry = new THREE.PlaneGeometry(34, 24, 96, 72);
groundGeometry.rotateX(-Math.PI * 0.5);
const groundPositions = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
for (let index = 0; index < groundPositions.count; index++) {
  groundPositions.setY(
    index,
    terrainHeightAt(groundPositions.getX(index), groundPositions.getZ(index)),
  );
}
groundPositions.needsUpdate = true;
groundGeometry.computeVertexNormals();

const textureLoader = new THREE.TextureLoader();
const [leafAlbedo, leafNormal, leafRoughness] = await Promise.all([
  textureLoader.loadAsync('/assets/textures/terrain/gorski_forest_litter_primary_v1/albedo.png'),
  textureLoader.loadAsync('/assets/textures/terrain/gorski_forest_litter_primary_v1/normal.png'),
  textureLoader.loadAsync('/assets/textures/terrain/gorski_forest_litter_primary_v1/roughness.png'),
]);
leafAlbedo.colorSpace = THREE.SRGBColorSpace;
for (const texture of [leafAlbedo, leafNormal, leafRoughness]) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6.8, 4.8);
  texture.anisotropy = renderer.getMaxAnisotropy();
}
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x75634d,
  map: leafAlbedo,
  normalMap: leafNormal,
  normalScale: new THREE.Vector2(0.48, 0.48),
  roughnessMap: leafRoughness,
  roughness: 1,
  metalness: 0,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.name = 'Leaf-litter terrain validation surface';
scene.add(ground);

const trunkGeometry = new THREE.CylinderGeometry(0.23, 0.37, 6.2, 10);
const trunkMaterial = new THREE.MeshStandardMaterial({
  color: 0x3c3327,
  roughness: 1,
});
for (const [x, z, scale] of [
  [-7.8, -3.9, 1.05], [-2.9, -4.7, 0.92], [3.8, -4.5, 1.12],
  [8.1, -3.1, 0.96], [-8.8, 4.4, 1.08], [7.9, 4.8, 0.9],
] as const) {
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.scale.setScalar(scale);
  trunk.position.set(x, terrainHeightAt(x, z) + 3.1 * scale, z);
  scene.add(trunk);
}

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 90);
if (view === 'near') {
  camera.position.set(1.35, 1.28, 5.05);
  camera.lookAt(0.05, 0.19, 0.15);
} else if (view === 'grazing') {
  camera.position.set(3.15, 0.62, 4.45);
  camera.lookAt(-0.25, 0.2, 0.05);
} else if (view === 'far') {
  camera.position.set(0.4, 15.8, 24.5);
  camera.lookAt(0, 0.02, 0.35);
} else {
  camera.position.set(0.25, 7.2, 12.8);
  camera.lookAt(0, 0.12, 0.35);
}

let running = true;
let capturePaused = false;
const animationStartedAt = performance.now();
function prepareFrame(now: number): void {
  setWorldAnimationTime(
    fixedAnimationTime ?? Math.max(0, (now - animationStartedAt) / 1_000),
  );
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render(now = performance.now()): void {
  if (!running) return;
  if (!capturePaused) {
    prepareFrame(now);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(render);
}

window.__FOREST_FLOOR_SET_CAPTURE_MODE__ = async (mode) => {
  capturePaused = true;
  nettles.group.visible = mode === 'nettles' || mode === 'final';
  twigGroup.visible = mode === 'twigs' || mode === 'final';
  nettleSubmissions = 0;
  twigSubmissions = 0;
  prepareFrame(performance.now());
  renderer.info.reset();
  renderer.render(scene, camera);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return {
    mode,
    nettleGroupAttached: nettles.group.parent === scene,
    twigGroupAttached: twigGroup.parent === scene,
    nettleSubmissions,
    twigSubmissions,
    renderCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
window.__FOREST_FLOOR_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.view = view;
document.body.dataset.season = season;
document.body.dataset.animationTime = fixedAnimationTime === null
  ? 'live'
  : fixedAnimationTime.toFixed(2);
document.body.dataset.ivyLayers = String(FOREST_FLOOR_IVY_LAYER_COUNT);
document.body.dataset.ivyPatches = String(placements.length);
document.body.dataset.ivyAnimatedLeaves = String(
  placements.length * FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
);
document.body.dataset.ivyDrawCalls = '1';
document.body.dataset.ivyMaxHeight = FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX.toFixed(2);
document.body.dataset.ivySnowCoverage = ivySnowCoverage.toFixed(2);
document.body.dataset.nettleInstances = String(nettles.stats.instances);
document.body.dataset.nettleDrawCalls = String(nettles.stats.drawCalls);
document.body.dataset.nettleTriangles = String(nettles.stats.triangles);
document.body.dataset.nettleSpringFlush = deciduousFoliage.springFlush.toFixed(2);
document.body.dataset.nettleAutumnColor = deciduousFoliage.autumnColor.toFixed(2);
document.body.dataset.nettleDormancy = deciduousFoliage.dormancy.toFixed(2);
document.body.dataset.nettleDefaultTreeCount = String(defaultTreePlacements.length);
document.body.dataset.nettleDefaultCount = String(defaultNettlePlacements.length);
document.body.dataset.nettleDefaultUniqueSources = String(defaultNettleSourceIndices.size);
document.body.dataset.nettleDefaultMaximumSourceIndex = String(
  Math.max(...defaultNettleSourceIndices),
);
document.body.dataset.nettleDefaultVariantCounts = defaultNettleVariantCounts.join(',');
document.body.dataset.twigInstances = String(twigPlacements.length);
document.body.dataset.twigDrawCalls = String(twigMeshes.length);
document.body.dataset.twigPrototypeVertices = String(
  twigMeshes.reduce(
    (sum, mesh) => sum + mesh.geometry.getAttribute('position').count,
    0,
  ),
);
document.body.dataset.twigSubmittedTriangles = String(
  twigMeshes.reduce(
    (sum, mesh) => sum + (mesh.geometry.getIndex()?.count ?? 0) / 3 * mesh.count,
    0,
  ),
);
document.body.dataset.forestFloorSignature = [
  season,
  fixedAnimationTime === null ? 'live' : fixedAnimationTime.toFixed(2),
  placements.length,
  nettles.stats.instances,
  nettles.stats.triangles,
  twigPlacements.length,
  ivySnowCoverage.toFixed(2),
  deciduousFoliage.springFlush.toFixed(2),
  deciduousFoliage.autumnColor.toFixed(2),
  deciduousFoliage.dormancy.toFixed(2),
  defaultNettlePlacements.length,
  defaultNettleSourceIndices.size,
  defaultNettleVariantCounts.join(','),
].join(':');

window.addEventListener('beforeunload', () => {
  running = false;
  nettles.dispose();
  for (const mesh of twigMeshes) mesh.geometry.dispose();
  twigMaterial.dispose();
  twigTextures.albedo.dispose();
  twigTextures.normal.dispose();
  twigTextures.roughness.dispose();
  twigGroup.clear();
  ivyGeometry.dispose();
  ivyMaterial.dispose();
  disposeSeedThreeGroundCoverTextures(ivyTextures);
  groundGeometry.dispose();
  groundMaterial.dispose();
  trunkGeometry.dispose();
  trunkMaterial.dispose();
  leafAlbedo.dispose();
  leafNormal.dispose();
  leafRoughness.dispose();
  renderer.dispose();
});
