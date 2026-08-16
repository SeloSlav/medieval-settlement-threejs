import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { windStrength } from '@seedthree/core/wind.js';
import {
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from '../residences/backyardGardenMesh.ts';
import {
  createBackyardChickenModel,
  disposeBackyardChickenSource,
  loadBackyardChickenSource,
  removeBackyardChickenFallbacks,
} from '../residences/backyardChickenAssets.ts';
import {
  createBackyardGoatModel,
  disposeBackyardGoatModel,
  disposeBackyardGoatSource,
  loadBackyardGoatSource,
  removeBackyardGoatFallbacks,
} from '../residences/backyardGoatAssets.ts';
import { mulberry32 } from '../utils/random.ts';
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
const focusHerb = view === 'herb-close';
const focusHen = view === 'hen-close';
const focusApple = view === 'apple-close';
const focusCherry = view === 'cherry-close';
const focusOrchard = focusApple || focusCherry;
const focusSingle = focusFlower || focusVegetable || focusHerb || focusHen || focusOrchard;
const plants = focusVegetable || focusHerb || focusHen
  ? null
  : await loadBackyardPlantCatalog(renderer.getMaxAnisotropy());
const chickenSource = focusFlower || focusVegetable || focusHerb || focusOrchard
  ? null
  : await loadBackyardChickenSource().catch((error: unknown) => {
    console.warn('[Backyard lineup] Could not load the Quaternius chicken pack.', error);
    return null;
  });
const goatSource = focusFlower || focusVegetable || focusHerb || focusHen || focusOrchard
  ? null
  : await loadBackyardGoatSource().catch((error: unknown) => {
    console.warn('[Backyard lineup] Could not load the sheep-derived CC0 goat source.', error);
    return null;
  });
if (plants) windStrength.value = 0.85;
const allSpecs = [
  { kind: 'apple_orchard', label: 'Apple orchard' },
  { kind: 'cherry_orchard', label: 'Cherry orchard' },
  { kind: 'vegetable_garden', label: 'Vegetable garden' },
  { kind: 'flower_garden', label: 'Flower garden' },
  { kind: 'herb_garden', label: 'Herb garden' },
  { kind: 'hen_yard', label: 'Hen yard' },
  { kind: 'goat_pen', label: 'Goat pen' },
  { kind: 'backyard_apiary', label: 'Backyard apiary' },
] as const;
const specs = focusFlower
  ? allSpecs.slice(3)
  : focusApple
    ? allSpecs.slice(0, 1)
    : focusCherry
      ? allSpecs.slice(1, 2)
  : focusVegetable
    ? allSpecs.slice(2, 3)
    : focusHerb
      ? allSpecs.slice(4, 5)
      : focusHen
        ? allSpecs.slice(5, 6)
        : allSpecs;
labels.style.gridTemplateColumns = focusSingle
  ? '1fr'
  : 'repeat(4, minmax(0, 1fr))';
labels.style.gridTemplateRows = focusSingle
  ? '1fr'
  : 'repeat(2, minmax(0, 1fr))';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa6b29a);
scene.add(new THREE.HemisphereLight(0xdbe5df, 0x4c3b2b, 2.3));
const sun = new THREE.DirectionalLight(0xfff0cf, 3.4);
sun.position.set(-9, 16, 11);
scene.add(sun);

let focusedFlowerY = 0.28;
const chickenMixers: THREE.AnimationMixer[] = [];
const gardens = specs.map((spec, index) => {
  const garden = createBackyardGardenMesh(spec.kind, {
    width: 6.2,
    depth: 5.4,
    seed: 4271 + index * 97,
    plants,
  });
  if (focusSingle) {
    garden.position.x = 0;
  } else {
    garden.position.x = (index % 4 - 1.5) * 7.2;
    garden.position.z = (Math.floor(index / 4) - 0.5) * 6.4;
  }
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
  if (spec.kind === 'hen_yard' && chickenSource) {
    removeBackyardChickenFallbacks(garden);
    for (let chickenIndex = 0; chickenIndex < 5; chickenIndex++) {
      const random = mulberry32(4271 ^ Math.imul(chickenIndex + 1, 0x45d9f3b));
      const model = createBackyardChickenModel(
        chickenSource,
        0.45 * THREE.MathUtils.lerp(0.88, 1.08, random()),
      );
      const root = new THREE.Group();
      root.name = 'Rigged lineup hen';
      root.position.set(
        THREE.MathUtils.lerp(-0.3, 2.25, random()),
        0,
        THREE.MathUtils.lerp(-0.9, 1.8, random()),
      );
      root.rotation.y = random() * Math.PI * 2;
      root.add(model);
      garden.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const idle = mixer.clipAction(chickenSource.idle, model);
      idle.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      idle.play();
      idle.time = random() * Math.max(0.01, chickenSource.idle.duration);
      chickenMixers.push(mixer);
    }
    garden.userData.usesQuaterniusChickenPack = true;
  }
  if (spec.kind === 'goat_pen' && goatSource) {
    removeBackyardGoatFallbacks(garden);
    for (let goatIndex = 0; goatIndex < 3; goatIndex++) {
      const random = mulberry32(8171 ^ Math.imul(goatIndex + 1, 0x27d4eb2d));
      const model = createBackyardGoatModel(goatSource, 0.86 * THREE.MathUtils.lerp(0.9, 1.08, random()));
      const root = new THREE.Group();
      root.name = 'Rigged lineup goat';
      root.position.set(THREE.MathUtils.lerp(-1.1, 1.8, random()), 0, THREE.MathUtils.lerp(-0.4, 1.5, random()));
      root.rotation.y = random() * Math.PI * 2;
      root.add(model);
      garden.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const graze = mixer.clipAction(goatIndex === 0 ? goatSource.idle : goatSource.graze, model);
      graze.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      graze.play();
      chickenMixers.push(mixer);
      garden.userData.goatModels = [...(garden.userData.goatModels ?? []), model];
    }
    garden.userData.usesQuaterniusFarmPackGoatDerivative = true;
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
  new THREE.PlaneGeometry(29, 19),
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
} else if (focusHerb) {
  camera.position.set(4.6, 3.9, 6.1);
  camera.lookAt(0, 0.42, -0.15);
} else if (focusHen) {
  camera.position.set(5.4, 3.7, 7.2);
  camera.lookAt(0, 0.65, 0.05);
} else if (focusOrchard) {
  camera.position.set(5.8, 4.6, 7.8);
  camera.lookAt(0, 1.85, 0);
} else {
  camera.position.set(0, 13.4, 27.5);
  camera.lookAt(0, 1.25, 0);
}

let running = true;
let previousElapsedSeconds = performance.now() * 0.001;
function render(): void {
  if (!running) return;
  const elapsedSeconds = performance.now() * 0.001;
  const dtSeconds = Math.min(0.08, Math.max(0, elapsedSeconds - previousElapsedSeconds));
  previousElapsedSeconds = elapsedSeconds;
  for (const garden of gardens) animateBackyardGardenMesh(garden, elapsedSeconds);
  for (const mixer of chickenMixers) mixer.update(dtSeconds);
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
  for (const mixer of chickenMixers) mixer.stopAllAction();
  for (const garden of gardens) disposeBackyardGardenMesh(garden);
  for (const garden of gardens) {
    for (const model of garden.userData.goatModels ?? []) disposeBackyardGoatModel(model);
  }
  if (chickenSource) disposeBackyardChickenSource(chickenSource.scene);
  if (goatSource) disposeBackyardGoatSource(goatSource.scene);
  renderer.dispose();
});
