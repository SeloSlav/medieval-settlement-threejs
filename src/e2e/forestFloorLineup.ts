import * as THREE from 'three';
import { normalViewGeometry, positionLocal } from 'three/tsl';
import { WebGPURenderer } from 'three/webgpu';
import {
  FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
  FOREST_FLOOR_IVY_LAYER_COUNT,
  FOREST_FLOOR_IVY_SEED,
  FOREST_FLOOR_IVY_TEXTURE_PATH,
  createTerrainConformingIvyGeometry,
  type ForestFloorIvyPlacement,
} from '../props/ForestFloorIvy.ts';
import {
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverPositionNode,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';

declare global {
  interface Window {
    __FOREST_FLOOR_LINEUP_READY__?: boolean;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Forest-floor lineup host is missing.');

const query = new URLSearchParams(window.location.search);
const view = query.get('view') ?? 'design';
document.body.dataset.clean = String(query.get('clean') === '1');

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

const terrainSurface = { getHeightAt: terrainHeightAt };
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
const ivyMaterial = createSeedThreeGroundCoverMaterial(
  'SeedThree layered forest-floor ivy lineup',
  ivyTextures,
  'webgpu',
  [0.07, 0.13, 0.04],
  0,
  positionLocal as SeedThreeGroundCoverPositionNode,
);
ivyMaterial.alphaTest = 0.31;
(ivyMaterial as THREE.Material & { normalNode: typeof normalViewGeometry }).normalNode = normalViewGeometry;
const ivy = new THREE.Mesh(ivyGeometry, ivyMaterial);
ivy.name = 'Four-strata terrain-conforming ivy lineup';
ivy.frustumCulled = false;
ivy.renderOrder = 2;
scene.add(ivy);

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
  textureLoader.loadAsync('/assets/textures/terrain/forest_leaf_litter/albedo.png'),
  textureLoader.loadAsync('/assets/textures/terrain/forest_leaf_litter/normal.png'),
  textureLoader.loadAsync('/assets/textures/terrain/forest_leaf_litter/roughness.png'),
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
function render(): void {
  if (!running) return;
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
window.__FOREST_FLOOR_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.view = view;
document.body.dataset.ivyLayers = String(FOREST_FLOOR_IVY_LAYER_COUNT);
document.body.dataset.ivyPatches = String(placements.length);
document.body.dataset.ivyDrawCalls = '1';
document.body.dataset.ivyMaxHeight = FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX.toFixed(2);

window.addEventListener('beforeunload', () => {
  running = false;
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
