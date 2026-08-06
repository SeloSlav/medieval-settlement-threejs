import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  createMineralDepositSystem,
  type MineralDepositSystem,
} from '../minerals/MineralDepositSystem.ts';
import type {
  MineralDepositLayout,
  MineralDepositSite,
} from '../minerals/MineralDepositLayout.ts';
import { createQuarrySystem, type QuarrySystem } from '../quarries/QuarrySystem.ts';
import { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { loadMossyRockTextures } from '../utils/propTextureLoad.ts';

declare global {
  interface Window {
    __MINERAL_LINEUP_READY__?: boolean;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Mineral lineup host is missing.');

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
await renderer.init();
root.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x899278);
scene.fog = new THREE.Fog(0x899278, 28, 55);
scene.add(new THREE.HemisphereLight(0xdde5d4, 0x493a29, 2.3));
const sun = new THREE.DirectionalLight(0xffe5ba, 4.1);
sun.position.set(-8, 14, 9);
sun.castShadow = true;
scene.add(sun);

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x65714b, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 19), groundMaterial);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const terrain = { getHeightAt: () => 0 } as unknown as Terrain;
const mineralSites: MineralDepositSite[] = [
  {
    x: -9,
    z: 0,
    rotation: 0.24,
    resource: 'iron',
    grade: 'rich',
    formation: 'bedrock',
    radiusX: 4.4,
    radiusZ: 3.3,
  },
  {
    x: 9,
    z: 0,
    rotation: -0.18,
    resource: 'salt',
    grade: 'rich',
    formation: 'rock_salt',
    radiusX: 4.4,
    radiusZ: 3.3,
  },
];
const mineralLayout = {
  sites: mineralSites,
  isBlockedForProps: () => false,
  isBlockedForGrass: () => false,
} as unknown as MineralDepositLayout;
const minerals: MineralDepositSystem = createMineralDepositSystem(terrain, mineralLayout);
scene.add(minerals.group);

const quarryLayout = QuarryLayout.fromSerialized({
  seed: 0x71a2e0d,
  sites: [{
    x: 0,
    z: 0,
    rotation: 0.1,
    kind: 'small',
    radiusX: 5.1,
    radiusZ: 4.1,
    pitDepth: 0.4,
  }],
});
const rockTextures = await loadMossyRockTextures(renderer.getMaxAnisotropy());
const quarry: QuarrySystem = createQuarrySystem(terrain, quarryLayout, rockTextures);
scene.add(quarry.group);
await quarry.finishDetails();

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
camera.position.set(0, 10.8, 18.5);
camera.lookAt(0, 0.35, 0);

function render(): void {
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => {
  render();
  resolve();
}));
window.__MINERAL_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';

window.addEventListener('resize', render);
window.addEventListener('beforeunload', () => {
  minerals.dispose();
  quarry.dispose();
  ground.geometry.dispose();
  groundMaterial.dispose();
  renderer.dispose();
});
