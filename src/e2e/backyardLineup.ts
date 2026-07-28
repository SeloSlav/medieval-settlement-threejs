import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { windStrength } from '@seedthree/core/wind.js';
import {
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from '../residences/backyardGardenMesh.ts';
import { loadBackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';

declare global {
  interface Window {
    __BACKYARD_LINEUP_READY__?: boolean;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Backyard lineup host is missing.');

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
await renderer.init();
root.prepend(renderer.domElement);

const view = new URLSearchParams(window.location.search).get('view');
const focusFlower = view === 'flower-close';
const focusVegetable = view === 'vegetable-close';
const plants = focusVegetable
  ? null
  : await loadBackyardPlantCatalog(renderer.getMaxAnisotropy());
if (plants) windStrength.value = 0.85;
const allSpecs = [
  { kind: 'apple_orchard', label: 'Apple orchard' },
  { kind: 'cherry_orchard', label: 'Cherry orchard' },
  { kind: 'vegetable_garden', label: 'Cabbage · carrots · turnips' },
  { kind: 'flower_garden', label: 'Flower garden' },
] as const;
const specs = focusFlower
  ? allSpecs.slice(3)
  : focusVegetable
    ? allSpecs.slice(2, 3)
    : allSpecs;
labels.style.gridTemplateColumns = focusFlower || focusVegetable
  ? '1fr'
  : `repeat(${specs.length}, minmax(0, 1fr))`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa6b29a);
scene.add(new THREE.HemisphereLight(0xdbe5df, 0x4c3b2b, 2.3));
const sun = new THREE.DirectionalLight(0xfff0cf, 3.4);
sun.position.set(-9, 16, 11);
scene.add(sun);

let focusedFlowerY = 0.28;
const gardens = specs.map((spec, index) => {
  const garden = createBackyardGardenMesh(spec.kind, {
    width: 6.2,
    depth: 5.4,
    seed: 4271 + index * 97,
    plants,
  });
  garden.position.x = focusFlower || focusVegetable
    ? 0
    : (index - (specs.length - 1) * 0.5) * 7.2;
  if (focusFlower) {
    const cottageFlower = garden.children.find((child) => child.name.startsWith('Swaying cottage flower'));
    if (cottageFlower) {
      garden.position.x = -cottageFlower.position.x;
      garden.position.z = -cottageFlower.position.z;
      for (const child of garden.children) child.visible = child === cottageFlower;
      const headAnchor = cottageFlower.children.find((child) => child.type === 'Group');
      focusedFlowerY = cottageFlower.position.y + (headAnchor?.position.y ?? focusedFlowerY);
    }
  }
  scene.add(garden);

  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = spec.label;
  cell.append(label);
  labels.append(cell);
  return garden;
});

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(29, 14),
  new THREE.MeshStandardMaterial({ color: 0x65794a, roughness: 1 }),
);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.04;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(38, 1, focusFlower ? 0.01 : 0.1, 100);
if (focusFlower) {
  camera.position.set(0, focusedFlowerY + 0.3, 0.38);
  camera.lookAt(0, focusedFlowerY, 0);
} else if (focusVegetable) {
  camera.position.set(4.9, 4.7, 6.4);
  camera.lookAt(0, 0.38, -0.1);
} else {
  camera.position.set(0, 7.7, 19.8);
  camera.lookAt(0, 1.8, 0);
}

let running = true;
function render(): void {
  if (!running) return;
  const elapsedSeconds = performance.now() * 0.001;
  for (const garden of gardens) animateBackyardGardenMesh(garden, elapsedSeconds);
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setClearColor(0x1a1e16, 1);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
window.__BACKYARD_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';

window.addEventListener('beforeunload', () => {
  running = false;
  for (const garden of gardens) disposeBackyardGardenMesh(garden);
  renderer.dispose();
});
