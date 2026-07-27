import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { windStrength } from '@seedthree/core/wind.js';
import {
  createSeedThreeWildflowerGeometry,
  createSeedThreeWildflowerMaterial,
  loadSeedThreeWildflowerAtlas,
  SEEDTHREE_WILDFLOWER_VARIANTS,
} from '../vegetation/seedthree/seedThreeWildflowers.ts';

declare global {
  interface Window {
    __WILDFLOWER_LINEUP_READY__?: boolean;
    __WILDFLOWER_LINEUP_METRICS__?: {
      vertexCount: number;
      flowerVertexCount: number;
      baseHeightM: number;
      tallestVariantM: number;
    };
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Wildflower lineup host is missing.');

const renderer = new WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
await renderer.init();
root.prepend(renderer.domElement);

const atlas = await loadSeedThreeWildflowerAtlas(renderer.getMaxAnisotropy());
const geometry = createSeedThreeWildflowerGeometry(0.9);
const anchorAttribute = new THREE.InstancedBufferAttribute(
  new Float32Array(SEEDTHREE_WILDFLOWER_VARIANTS.length * 4),
  4,
);
geometry.setAttribute('aAnchorPos', anchorAttribute);
const material = createSeedThreeWildflowerMaterial(atlas, 'Gorski Kotar wildflower atlas');
const flowers = new THREE.InstancedMesh(
  geometry,
  material,
  SEEDTHREE_WILDFLOWER_VARIANTS.length,
);
flowers.name = 'AAA wildflower scale lineup';
flowers.count = SEEDTHREE_WILDFLOWER_VARIANTS.length;

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const spacing = 0.78;
const centerOffset = (SEEDTHREE_WILDFLOWER_VARIANTS.length - 1) * 0.5;
for (let index = 0; index < SEEDTHREE_WILDFLOWER_VARIANTS.length; index++) {
  const variant = SEEDTHREE_WILDFLOWER_VARIANTS[index]!;
  const x = (index - centerOffset) * spacing;
  const heightScale = (variant.heightScale[0] + variant.heightScale[1]) * 0.5;
  const widthScale = (variant.widthScale[0] + variant.widthScale[1]) * 0.5;
  position.set(x, 0, 0);
  scale.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scale);
  flowers.setMatrixAt(index, matrix);
  anchorAttribute.setXYZW(index, x, 0, 0, variant.atlasOffset[0]);

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = variant.label;
  labels.append(label);
}
flowers.instanceMatrix.needsUpdate = true;
anchorAttribute.needsUpdate = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeb69f);
scene.add(new THREE.HemisphereLight(0xe6ece5, 0x51422e, 2.1));
const sun = new THREE.DirectionalLight(0xffefcf, 3.6);
sun.position.set(-5, 8, 5);
scene.add(sun, flowers);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 2.2),
  new THREE.MeshStandardMaterial({ color: 0x5e7047, roughness: 1 }),
);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.008;
scene.add(ground);

const rulerMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c89f, roughness: 0.86 });
const ruler = new THREE.Group();
ruler.position.set(-2.25, 0, 0.05);
const upright = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), rulerMaterial);
upright.position.y = 0.5;
ruler.add(upright);
for (let tick = 0; tick <= 10; tick++) {
  const tickMark = new THREE.Mesh(
    new THREE.BoxGeometry(tick % 5 === 0 ? 0.15 : 0.09, 0.008, 0.018),
    rulerMaterial,
  );
  tickMark.position.set(0.06, tick * 0.1, 0);
  ruler.add(tickMark);
}
scene.add(ruler);

const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 50);
const closeUp = new URLSearchParams(window.location.search).get('view') === 'close';
if (closeUp) {
  camera.position.set(0, 0.42, 0.82);
  camera.lookAt(0, 0.24, 0);
  labels.hidden = true;
} else {
  camera.position.set(0, 0.92, 3.4);
  camera.lookAt(0, 0.3, 0);
}
windStrength.value = 0.32;

let running = true;
function render(): void {
  if (!running) return;
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  if (!closeUp) {
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const distance = Math.max(
      3.4,
      2.55 / (Math.tan(halfVerticalFov) * camera.aspect),
    );
    camera.position.set(0, 0.92 + (distance - 3.4) * 0.055, distance);
    camera.lookAt(0, 0.3, 0);
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
geometry.computeBoundingBox();
const flowerMask = geometry.getAttribute('flowerMask');
let flowerVertexCount = 0;
for (let index = 0; index < flowerMask.count; index++) {
  if (flowerMask.getX(index) > 0.5) flowerVertexCount += 1;
}
const baseHeightM = geometry.boundingBox?.max.y ?? 0;
window.__WILDFLOWER_LINEUP_METRICS__ = {
  vertexCount: geometry.getAttribute('position').count,
  flowerVertexCount,
  baseHeightM,
  tallestVariantM: baseHeightM * Math.max(
    ...SEEDTHREE_WILDFLOWER_VARIANTS.map((variant) => variant.heightScale[1]),
  ),
};
window.__WILDFLOWER_LINEUP_READY__ = true;
document.body.dataset.metrics = JSON.stringify(window.__WILDFLOWER_LINEUP_METRICS__);
document.body.dataset.ready = 'true';

window.addEventListener('beforeunload', () => {
  running = false;
  geometry.dispose();
  material.dispose();
  rulerMaterial.dispose();
  renderer.dispose();
});
