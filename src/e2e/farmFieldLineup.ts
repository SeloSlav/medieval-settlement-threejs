import * as THREE from 'three';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import type { FarmCrop, FarmFieldState } from '../resources/types.ts';

declare global {
  interface Window {
    __FARM_FIELD_LINEUP_READY__?: boolean;
    __FARM_FIELD_LINEUP_METRICS__?: {
      standingTufts: number;
      grainHeadTufts: number;
      stubbleTufts: number;
      barleyHeads: number;
      oatPanicles: number;
      flaxBlossoms: number;
      maslinHeads: number;
      drawCalls: number;
      triangles: number;
    };
  }
}

const root = document.querySelector<HTMLElement>('#field-root');
if (!root) throw new Error('Farm field lineup host is missing.');

const params = new URLSearchParams(window.location.search);
const cropView = params.get('view') === 'crops';
document.body.classList.toggle('clean', params.get('clean') === '1');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa6c8df);
scene.fog = new THREE.FogExp2(0xb1c8cc, 0.0075);

function getHeightAt(x: number, z: number): number {
  return Math.sin(x * 0.055) * 0.5
    + Math.cos(z * 0.048) * 0.35
    + Math.sin((x + z) * 0.028) * 0.24;
}

const terrainGeometry = new THREE.PlaneGeometry(180, 150, 140, 120);
terrainGeometry.rotateX(-Math.PI * 0.5);
const terrainPositions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
const terrainColors: number[] = [];
const grassA = new THREE.Color(0x62734d);
const grassB = new THREE.Color(0x75815a);
for (let index = 0; index < terrainPositions.count; index += 1) {
  const x = terrainPositions.getX(index);
  const z = terrainPositions.getZ(index);
  terrainPositions.setY(index, getHeightAt(x, z));
  const variation = (Math.sin(x * 0.17) + Math.cos(z * 0.13) + 2) * 0.25;
  const color = grassA.clone().lerp(grassB, variation);
  terrainColors.push(color.r, color.g, color.b);
}
terrainPositions.needsUpdate = true;
terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
terrainGeometry.computeVertexNormals();
const terrain = new THREE.Mesh(
  terrainGeometry,
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
  }),
);
terrain.receiveShadow = true;
scene.add(terrain);

const referenceFields: FarmFieldState[] = [
  {
    id: 'reference-harvest',
    farmsteadId: 'farmstead-reference',
    corners: [
      { x: -43, z: -28 },
      { x: 33, z: -25 },
      { x: 36, z: 30 },
      { x: -40, z: 27 },
    ],
    area: 4_180,
    averageSlopeDegrees: 1.5,
    moisture: 0.45,
    fertility: 0.92,
    crop: 'rye',
    nextCrop: 'fallow',
    stage: 'harvesting',
    stageProgress: 0.31,
    priority: 3,
    harvestCount: 2,
    lastYield: 72,
    currentYield: 29,
  },
  {
    id: 'background-oats',
    farmsteadId: 'farmstead-reference',
    corners: [
      { x: -35, z: 35 },
      { x: 33, z: 38 },
      { x: 29, z: 62 },
      { x: -39, z: 59 },
    ],
    area: 1_640,
    averageSlopeDegrees: 2,
    moisture: 0.56,
    fertility: 0.84,
    crop: 'oats',
    nextCrop: 'rye',
    stage: 'growing',
    stageProgress: 0.78,
    priority: 2,
    harvestCount: 1,
    lastYield: 38,
    currentYield: 0,
  },
];
const cropKinds: FarmCrop[] = ['rye', 'oats', 'barley', 'flax', 'wheat', 'fallow'];
const fields: FarmFieldState[] = cropView
  ? cropKinds.map((crop, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const centerX = (column - 1) * 27;
      const centerZ = row * 28 - 12;
      return {
        ...referenceFields[1]!,
        id: `crop-lineup-${crop}`,
        corners: [
          { x: centerX - 10.5, z: centerZ - 9 },
          { x: centerX + 10.5, z: centerZ - 9 },
          { x: centerX + 10.5, z: centerZ + 9 },
          { x: centerX - 10.5, z: centerZ + 9 },
        ],
        area: 378,
        crop,
        nextCrop: crop === 'fallow' ? 'rye' : 'fallow',
        stageProgress: crop === 'fallow' ? 0.82 : 0.9,
      };
    })
  : referenceFields;
const fieldRoot = new THREE.Group();
fieldRoot.name = 'Farm field visual QA';
scene.add(fieldRoot);
const fieldMarkers = new FarmFieldMarkers(fieldRoot, getHeightAt);
fieldMarkers.syncFields(fields);

const ridgeMaterial = new THREE.MeshStandardMaterial({
  color: 0x42513a,
  roughness: 1,
});
for (let index = 0; index < 32; index += 1) {
  const angle = (index / 32) * Math.PI * 2;
  const radius = 62 + Math.sin(index * 2.4) * 6;
  const height = 3.5 + (index % 5) * 0.8;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(2.4 + (index % 3) * 0.7, height, 7),
    ridgeMaterial,
  );
  crown.position.set(
    Math.cos(angle) * radius,
    getHeightAt(Math.cos(angle) * radius, Math.sin(angle) * radius) + height * 0.48,
    Math.sin(angle) * radius + 14,
  );
  crown.scale.z = 0.72;
  crown.castShadow = true;
  scene.add(crown);
}

scene.add(new THREE.HemisphereLight(0xe7eef0, 0x59472f, 2.15));
const sun = new THREE.DirectionalLight(0xffe3af, 3.65);
sun.position.set(-34, 52, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -62;
sun.shadow.camera.right = 62;
sun.shadow.camera.top = 68;
sun.shadow.camera.bottom = -38;
sun.shadow.bias = -0.0004;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 230);
const overview = params.get('view') === 'overview';
const detail = params.get('view') === 'detail';
if (cropView) {
  camera.position.set(35, 48, -57);
  camera.lookAt(0, 0.6, 4);
} else if (overview) {
  camera.position.set(30, 53, -63);
  camera.lookAt(-3, 0, 14);
} else if (detail) {
  camera.position.set(4, 2.45, -6);
  camera.lookAt(0, 0.8, 5.5);
} else {
  camera.position.set(8, 5.2, -38);
  camera.lookAt(-3, 1.3, 6);
}

function render(): void {
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();

let standingTufts = 0;
let grainHeadTufts = 0;
let stubbleTufts = 0;
let barleyHeads = 0;
let oatPanicles = 0;
let flaxBlossoms = 0;
let maslinHeads = 0;
scene.traverse((object) => {
  if (!(object instanceof THREE.InstancedMesh)) return;
  if (object.name.startsWith('Standing ')) standingTufts += object.count;
  if (object.name === 'Pale awned grain heads') grainHeadTufts += object.count;
  if (object.name === 'Cut cereal stubble') stubbleTufts += object.count;
  if (object.name === 'Barley long-awn heads') barleyHeads += object.count;
  if (object.name === 'Oat drooping panicles') oatPanicles += object.count;
  if (object.name === 'Flax blue blossoms') flaxBlossoms += object.count;
  if (object.name === 'Wheat–rye maslin heads') maslinHeads += object.count;
});
window.__FARM_FIELD_LINEUP_METRICS__ = {
  standingTufts,
  grainHeadTufts,
  stubbleTufts,
  barleyHeads,
  oatPanicles,
  flaxBlossoms,
  maslinHeads,
  drawCalls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
};
window.__FARM_FIELD_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.metrics = JSON.stringify(window.__FARM_FIELD_LINEUP_METRICS__);
window.addEventListener('resize', render);
window.addEventListener('beforeunload', () => {
  fieldMarkers.dispose();
  terrainGeometry.dispose();
  (terrain.material as THREE.Material).dispose();
  ridgeMaterial.dispose();
  renderer.dispose();
});
