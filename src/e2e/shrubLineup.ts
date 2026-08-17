import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  buildUndergrowthInstances,
  createUndergrowthMaterials,
  disposeUndergrowthInstances,
  type UndergrowthPlacement,
} from '../props/ForestUndergrowth.ts';
import { createBerryPatchVisuals } from '../foraging/BerryPatchVisuals.ts';
import { berryPatchMaxYield } from '../foraging/foragingYields.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import { mulberry32 } from '../utils/random.ts';

declare global {
  interface Window {
    __SHRUB_LINEUP_READY__?: boolean;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Shrub lineup host is missing.');
const query = new URLSearchParams(window.location.search);
const isRichBerryPatch = query.get('rich') === '1';
const focus = query.get('focus') ?? 'berries';
const requestedStock = Number(query.get('stock') ?? '1');
const stockRatio = THREE.MathUtils.clamp(Number.isFinite(requestedStock) ? requestedStock : 1, 0, 1);

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
for (const [kind, centerX] of [
  ['bush', -7.2],
  ['fern', -2.6],
  ['juniper', 2.7],
] as const) {
  for (let variant = 0; variant < 3; variant++) {
    placements.push({
      kind,
      x: centerX + (variant - 1) * (kind === 'juniper' ? 1.15 : 0.82),
      z: variant === 1 ? 0.42 : -0.18,
      scale: kind === 'bush' ? 0.92 : kind === 'fern' ? 1.0 : 0.72,
      yaw: variant * 2.07 + 0.3,
      prototypeIndex: variant,
      meshIndex: -1,
    });
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

const berries = await createBerryPatchVisuals(
  terrain,
  [{ kind: 'berries', x: 8, z: 0, isRich: isRichBerryPatch }],
  renderer.getMaxAnisotropy(),
  'webgpu',
  0x72617370,
);
scene.add(berries.group);
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
  if (focus === 'bilberry') {
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
  camera.position.set(0, 14.5, 31);
  camera.lookAt(0.5, 0.75, 0);
} else {
  camera.position.set(0.5, 7.8, 19.5);
  camera.lookAt(0.5, 0.82, 0);
}

windStrength.value = 0.38;
let running = true;
function render(): void {
  if (!running) return;
  windSpeed.value = performance.now() * 0.001;
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
window.__SHRUB_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.view = view;
document.body.dataset.focus = focus;
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

window.addEventListener('beforeunload', () => {
  running = false;
  berries.dispose();
  disposeUndergrowthInstances(undergrowth, materials);
  (ground.material as THREE.Material).dispose();
  ground.geometry.dispose();
  renderer.dispose();
});
