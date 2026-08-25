import * as THREE from 'three';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import { WebGPURenderer } from 'three/webgpu';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import { setWorldAnimationTime } from '../scene/worldAnimationTime.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  createSeedThreeForest,
  createSeedThreeForestController,
  getSeedThreeForestStructuralStats,
} from '../vegetation/seedthree/seedThreeForestBuilder.ts';
import {
  deciduousFoliageForSeasonPreview,
  type DeciduousFoliagePresentation,
} from '../world/deciduousFoliagePolicy.ts';
import type { Season } from '../world/seasonPolicy.ts';

type ForestSeasonCaptureLayer =
  | 'ground'
  | 'branches'
  | 'cards'
  | 'deciduous-cards'
  | 'evergreen-cards'
  | 'final';

type ForestSeasonCaptureRequest = {
  layer?: ForestSeasonCaptureLayer;
  season?: Season;
  foliage?: DeciduousFoliagePresentation;
  snowCoverage?: number;
};

type ForestSeasonRenderEvidence = {
  layer: ForestSeasonCaptureLayer;
  season: Season;
  springFlush: number;
  autumnColor: number;
  dormancy: number;
  snowCoverage: number;
  retainedLeafSnow: boolean;
  visibleBranchMeshes: number;
  visibleCardMeshes: number;
  visibleDeciduousCardMeshes: number;
  visibleEvergreenCardMeshes: number;
  renderCalls: number;
  triangles: number;
};

declare global {
  interface Window {
    __FOREST_SEASON_LINEUP_READY__?: boolean;
    __FOREST_SEASON_LINEUP_CAPTURE__?: (
      request: ForestSeasonCaptureRequest,
    ) => Promise<ForestSeasonRenderEvidence>;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Forest-season lineup host is missing.');

const query = new URLSearchParams(window.location.search);
const requestedSeason = query.get('season');
const initialSeason: Season = requestedSeason === 'spring'
  || requestedSeason === 'autumn'
  || requestedSeason === 'winter'
  ? requestedSeason
  : 'summer';
const requestedTime = Number(query.get('time'));
const fixedAnimationTime = Number.isFinite(requestedTime) ? Math.max(0, requestedTime) : 4;
document.body.dataset.clean = String(query.get('clean') === '1');

const placements: ForestTreePlacement[] = [
  { species: 'beech', form: 'broad', scale: 0.85, x: -17.5, z: 0.2 },
  { species: 'sessileOak', form: 'broad', scale: 0.98, x: -12.5, z: -0.25 },
  { species: 'sycamoreMaple', form: 'broad', scale: 0.96, x: -7.5, z: 0.3 },
  { species: 'ash', form: 'narrow', scale: 0.78, x: -2.5, z: -0.15 },
  { species: 'larch', form: 'narrow', scale: 0.47, x: 2.5, z: 0.18 },
  { species: 'silverFir', form: 'narrow', scale: 0.47, x: 7.5, z: -0.2 },
  { species: 'norwaySpruce', form: 'narrow', scale: 0.56, x: 12.5, z: 0.26 },
  { species: 'scotsPine', form: 'narrow', scale: 0.51, x: 17.5, z: -0.12 },
];

const deciduousSpecies = ['beech', 'sessileOak', 'sycamoreMaple', 'ash', 'larch'] as const;
const evergreenSpecies = ['silverFir', 'norwaySpruce', 'scotsPine'] as const;
const deciduousPresetNames = ['americanBeech', 'whiteOak', 'redMaple', 'sweetgum'];
const evergreenPresetNames = ['douglasFir', 'loblolly', 'pine'];
const treeSeed = 0x7365_6173;

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
await renderer.init();
root.prepend(renderer.domElement);

const rendererBackend = (
  renderer as unknown as {
    backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
  }
).backend;
const rendererBackendName = rendererBackend?.isWebGPUBackend
  ? 'webgpu'
  : rendererBackend?.isWebGLBackend
    ? 'webgl2-node'
    : 'unknown';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x879585);
scene.fog = new THREE.Fog(0x879585, 48, 88);
scene.add(new THREE.HemisphereLight(0xe7eee4, 0x342d25, 2.1));
const sun = new THREE.DirectionalLight(0xffe6bc, 3.35);
sun.position.set(-18, 28, 19);
scene.add(sun);

function terrainHeightAt(x: number, z: number): number {
  return Math.sin(x * 0.17) * 0.08 + Math.cos(z * 0.31) * 0.035;
}

const terrain = {
  generationSize: 96,
  getHeightAt: terrainHeightAt,
} as unknown as Terrain;

const groundGeometry = new THREE.PlaneGeometry(52, 24, 1, 1);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x4d513c,
  roughness: 1,
  metalness: 0,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.name = 'Fixed neutral forest-season ground';
ground.rotation.x = -Math.PI * 0.5;
ground.position.set(0, -0.075, 0);
scene.add(ground);

const forest = await createSeedThreeForest(
  placements,
  terrain,
  renderer.getMaxAnisotropy(),
  treeSeed,
  renderer,
);
const controller = createSeedThreeForestController(forest);
controller.setShadows(false);
controller.setDistantCanopyCardsEnabled(false);
scene.add(forest.group);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 120);
camera.position.set(0, 9.4, 39.5);
camera.lookAt(0, 5.25, 0);
camera.updateMatrixWorld(true);

// This fixture compares biology, not motion. SeedThree's shared wind clock is
// wall-time based, so zero amplitude is the only true fixed-time visual
// contract across asynchronous GPU readbacks.
windStrength.value = 0;
windSpeed.value = 0.84;
setWorldAnimationTime(fixedAnimationTime);

type LineupMesh = THREE.InstancedMesh & { userData: Record<string, unknown> };
const colorMeshes: LineupMesh[] = [];
forest.group.traverse((object) => {
  const mesh = object as LineupMesh;
  if (!mesh.isInstancedMesh || mesh.userData.seedThreeShadowOnly === true) return;
  colorMeshes.push(mesh);
});

const branchMeshes = colorMeshes.filter((mesh) => mesh.name.includes('branches'));
const cardMeshes = colorMeshes.filter((mesh) => mesh.name.includes('cards'));
const deciduousCardMeshes = cardMeshes.filter((mesh) => (
  deciduousPresetNames.some((preset) => mesh.name.startsWith(preset))
));
const evergreenCardMeshes = cardMeshes.filter((mesh) => (
  evergreenPresetNames.some((preset) => mesh.name.startsWith(preset))
));
const snowMaterials = new Set(forest.snowCardMaterials);
const barkSnowMaterials = new Set(
  branchMeshes
    .flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .filter((material) => snowMaterials.has(material)),
);

let activeSeason = initialSeason;
let activeFoliage = deciduousFoliageForSeasonPreview(initialSeason);
let activeSnowCoverage = initialSeason === 'winter' ? 0.86 : 0;
let capturePaused = false;
let running = true;

function updateDataset(): void {
  const structural = getSeedThreeForestStructuralStats(forest);
  document.body.dataset.season = activeSeason;
  document.body.dataset.animationTime = fixedAnimationTime.toFixed(2);
  document.body.dataset.windStrength = windStrength.value.toFixed(2);
  document.body.dataset.springFlush = activeFoliage.springFlush.toFixed(2);
  document.body.dataset.autumnColor = activeFoliage.autumnColor.toFixed(2);
  document.body.dataset.dormancy = activeFoliage.dormancy.toFixed(2);
  document.body.dataset.snowCoverage = activeSnowCoverage.toFixed(2);
  document.body.dataset.retainedLeafSnow = String(
    activeSnowCoverage > 0 && activeFoliage.dormancy > 0 && activeFoliage.dormancy < 1,
  );
  document.body.dataset.rendererBackend = rendererBackendName;
  document.body.dataset.supportedSeasons = 'spring,summer,autumn,winter';
  document.body.dataset.species = placements.map((placement) => placement.species).join(',');
  document.body.dataset.deciduousSpecies = deciduousSpecies.join(',');
  document.body.dataset.evergreenSpecies = evergreenSpecies.join(',');
  document.body.dataset.treeCount = String(placements.length);
  document.body.dataset.deciduousTreeCount = String(deciduousSpecies.length);
  document.body.dataset.evergreenTreeCount = String(evergreenSpecies.length);
  document.body.dataset.branchMeshes = String(branchMeshes.length);
  document.body.dataset.cardMeshes = String(cardMeshes.length);
  document.body.dataset.seasonalMaterials = String(forest.seasonalCardMaterials.length);
  document.body.dataset.snowMaterials = String(forest.snowCardMaterials.length);
  document.body.dataset.barkSnowMaterials = String(barkSnowMaterials.size);
  document.body.dataset.draws = String(structural.draws);
  document.body.dataset.triangles = String(structural.triangles);
  document.body.dataset.cameraSignature = '38:0.00,9.40,39.50:0.00,5.25,0.00';
  document.body.dataset.scaleSignature = placements
    .map((placement) => `${placement.species}:${placement.scale.toFixed(2)}`)
    .join(',');
  document.body.dataset.lineupSignature = [
    treeSeed.toString(16),
    fixedAnimationTime.toFixed(2),
    placements.map((placement) => placement.species).join(','),
    placements.map((placement) => placement.scale.toFixed(2)).join(','),
    branchMeshes.length,
    cardMeshes.length,
    structural.triangles,
  ].join(':');
}

function applyPresentation(request: ForestSeasonCaptureRequest): void {
  if (request.season) {
    activeSeason = request.season;
    activeFoliage = deciduousFoliageForSeasonPreview(activeSeason);
    activeSnowCoverage = activeSeason === 'winter' ? 0.86 : 0;
  }
  if (request.foliage) activeFoliage = { ...request.foliage };
  if (request.snowCoverage !== undefined) {
    activeSnowCoverage = THREE.MathUtils.clamp(request.snowCoverage, 0, 1);
  }
  controller.setDeciduousFoliage(activeFoliage);
  controller.setSnowCoverage(activeSnowCoverage);
  updateDataset();
}

function meshBelongsToLayer(mesh: LineupMesh, layer: ForestSeasonCaptureLayer): boolean {
  if (layer === 'ground') return false;
  if (layer === 'branches') return branchMeshes.includes(mesh);
  if (layer === 'cards') return cardMeshes.includes(mesh);
  if (layer === 'deciduous-cards') return deciduousCardMeshes.includes(mesh);
  if (layer === 'evergreen-cards') return evergreenCardMeshes.includes(mesh);
  return true;
}

function prepareFrame(): void {
  setWorldAnimationTime(fixedAnimationTime);
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function render(): void {
  if (!running) return;
  if (!capturePaused) {
    prepareFrame();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(render);
}

window.__FOREST_SEASON_LINEUP_CAPTURE__ = async (request) => {
  capturePaused = true;
  applyPresentation(request);
  const layer = request.layer ?? 'final';
  for (const mesh of colorMeshes) mesh.visible = meshBelongsToLayer(mesh, layer);
  prepareFrame();
  renderer.info.reset();
  renderer.render(scene, camera);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const visibleBranches = branchMeshes.filter((mesh) => mesh.visible).length;
  const visibleCards = cardMeshes.filter((mesh) => mesh.visible).length;
  return {
    layer,
    season: activeSeason,
    springFlush: activeFoliage.springFlush,
    autumnColor: activeFoliage.autumnColor,
    dormancy: activeFoliage.dormancy,
    snowCoverage: activeSnowCoverage,
    retainedLeafSnow: activeSnowCoverage > 0
      && activeFoliage.dormancy > 0
      && activeFoliage.dormancy < 1,
    visibleBranchMeshes: visibleBranches,
    visibleCardMeshes: visibleCards,
    visibleDeciduousCardMeshes: deciduousCardMeshes.filter((mesh) => mesh.visible).length,
    visibleEvergreenCardMeshes: evergreenCardMeshes.filter((mesh) => mesh.visible).length,
    renderCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};

applyPresentation({ season: initialSeason });
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
window.__FOREST_SEASON_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';

window.addEventListener('beforeunload', () => {
  running = false;
  controller.dispose();
  groundGeometry.dispose();
  groundMaterial.dispose();
  renderer.dispose();
});
