import * as THREE from 'three';
import {
  createBuildingPreviewMesh,
  updateBuildingPreviewGeometry,
} from '../buildings/BuildingPlacementPreview.ts';
import { FarmFieldPreview } from '../farming/FarmFieldMarkers.ts';
import {
  rectangleFromBaseline,
  type FarmFieldCorners,
} from '../farming/farmFieldMath.ts';
import { BurgagePreview } from '../residences/BurgagePreview.ts';
import {
  cornersFromPoints,
  resolveBurgageLayout,
} from '../residences/burgageLayout.ts';

declare global {
  interface Window {
    __PLACEMENT_LINEUP_READY__?: boolean;
    __PLACEMENT_LINEUP_METRICS__?: {
      pointerUpdates: number;
      lastUpdateMs: number;
      worstUpdateMs: number;
    };
  }
}

const placementRoot = document.querySelector<HTMLElement>('#placement-root');
if (!placementRoot) throw new Error('Placement lineup host is missing.');
const root: HTMLElement = placementRoot;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x85927c);
scene.fog = new THREE.Fog(0x85927c, 78, 155);

function getHeightAt(x: number, z: number): number {
  return Math.sin(x * 0.105) * 1.05
    + Math.cos(z * 0.13) * 0.72
    + Math.sin((x + z) * 0.055) * 0.58;
}

const terrainGeometry = new THREE.PlaneGeometry(112, 68, 140, 92);
terrainGeometry.rotateX(-Math.PI * 0.5);
const terrainPositions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
for (let index = 0; index < terrainPositions.count; index += 1) {
  const x = terrainPositions.getX(index);
  const z = terrainPositions.getZ(index);
  terrainPositions.setY(index, getHeightAt(x, z));
}
terrainPositions.needsUpdate = true;
terrainGeometry.computeVertexNormals();
const terrain = new THREE.Mesh(
  terrainGeometry,
  new THREE.MeshStandardMaterial({
    color: 0x687953,
    roughness: 0.98,
    metalness: 0,
  }),
);
terrain.receiveShadow = true;
terrain.userData.terrain = true;
scene.add(terrain);

const roadGeometry = new THREE.PlaneGeometry(25, 4.8, 36, 4);
roadGeometry.rotateX(-Math.PI * 0.5);
const roadPositions = roadGeometry.getAttribute('position') as THREE.BufferAttribute;
for (let index = 0; index < roadPositions.count; index += 1) {
  const localX = roadPositions.getX(index);
  const localZ = roadPositions.getZ(index);
  const worldX = localX;
  const worldZ = localZ - 11.5;
  roadPositions.setXYZ(index, worldX, getHeightAt(worldX, worldZ) + 0.045, worldZ);
}
roadPositions.needsUpdate = true;
roadGeometry.computeVertexNormals();
const road = new THREE.Mesh(
  roadGeometry,
  new THREE.MeshStandardMaterial({ color: 0x88765b, roughness: 1 }),
);
road.receiveShadow = true;
scene.add(road);

const buildingPreview = createBuildingPreviewMesh('village_storehouse');
scene.add(buildingPreview);
let buildingX = -31;
let buildingZ = 1;
updateBuildingPreviewGeometry(
  buildingPreview,
  'village_storehouse',
  buildingX,
  buildingZ,
  -0.18,
  getHeightAt,
);

const burgageCorners = [
  new THREE.Vector3(-11, getHeightAt(-11, -8.4), -8.4),
  new THREE.Vector3(11, getHeightAt(11, -8.4), -8.4),
  new THREE.Vector3(11, getHeightAt(11, 10), 10),
  new THREE.Vector3(-11, getHeightAt(-11, 10), 10),
];
const burgageZoneCorners = cornersFromPoints(
  burgageCorners.map((point) => ({ x: point.x, z: point.z })),
);
const burgageLayout = burgageZoneCorners
  ? resolveBurgageLayout(burgageZoneCorners, 0, 3)
  : null;
const burgagePreview = new BurgagePreview();
scene.add(burgagePreview.group);
burgagePreview.update(
  burgageCorners,
  burgageLayout,
  true,
  getHeightAt,
  false,
  4,
  null,
  0,
  burgageCorners,
  2,
  burgageCorners,
  null,
);

const fieldCorners: FarmFieldCorners = [
  { x: 23, z: -9 },
  { x: 49, z: -6 },
  { x: 45, z: 14 },
  { x: 21, z: 11 },
];
const fieldPreview = new FarmFieldPreview(getHeightAt);
scene.add(fieldPreview.group);
fieldPreview.show(fieldCorners, true, 'rye');

scene.add(new THREE.HemisphereLight(0xe4ebe0, 0x3f392d, 2.15));
const sun = new THREE.DirectionalLight(0xffefd0, 3.4);
sun.position.set(-30, 48, 38);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -62;
sun.shadow.camera.right = 62;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
camera.position.set(13, 51, 63);
camera.lookAt(7, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const metrics = {
  pointerUpdates: 0,
  lastUpdateMs: 0,
  worstUpdateMs: 0,
};
window.__PLACEMENT_LINEUP_METRICS__ = metrics;
renderer.domElement.dataset.pointerUpdates = '0';
renderer.domElement.dataset.lastUpdateMs = '0';
renderer.domElement.dataset.worstUpdateMs = '0';

renderer.domElement.addEventListener('pointermove', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (!hit) return;

  const started = performance.now();
  if (hit.point.x < -16) {
    buildingX = hit.point.x;
    buildingZ = hit.point.z;
    updateBuildingPreviewGeometry(
      buildingPreview,
      'village_storehouse',
      buildingX,
      buildingZ,
      -0.18,
      getHeightAt,
    );
  } else if (hit.point.x < 17) {
    const rearZ = THREE.MathUtils.clamp(hit.point.z, 3.5, 13);
    const previewCorners = [
      burgageCorners[0]!.clone(),
      burgageCorners[1]!.clone(),
      new THREE.Vector3(11, getHeightAt(11, rearZ), rearZ),
      new THREE.Vector3(-11, getHeightAt(-11, rearZ), rearZ),
    ];
    const previewZone = cornersFromPoints(
      previewCorners.map((point) => ({ x: point.x, z: point.z })),
    );
    const previewLayout = previewZone
      ? resolveBurgageLayout(previewZone, 0, 3)
      : null;
    burgagePreview.update(
      previewCorners,
      previewLayout,
      true,
      getHeightAt,
      true,
      2,
      hit.point,
      0,
      previewCorners,
      2,
      previewCorners.slice(0, 2),
      {
        from: new THREE.Vector3(0, getHeightAt(0, -8.4), -8.4),
        to: hit.point,
      },
    );
  } else {
    const previewField = rectangleFromBaseline(
      fieldCorners[0],
      fieldCorners[1],
      { x: hit.point.x, z: hit.point.z },
    );
    if (previewField) fieldPreview.show(previewField, true, 'rye');
  }
  metrics.pointerUpdates += 1;
  metrics.lastUpdateMs = performance.now() - started;
  metrics.worstUpdateMs = Math.max(metrics.worstUpdateMs, metrics.lastUpdateMs);
  renderer.domElement.dataset.pointerUpdates = `${metrics.pointerUpdates}`;
  renderer.domElement.dataset.lastUpdateMs = metrics.lastUpdateMs.toFixed(3);
  renderer.domElement.dataset.worstUpdateMs = metrics.worstUpdateMs.toFixed(3);
  render();
});

function render(): void {
  const width = root.clientWidth;
  const height = root.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();
window.__PLACEMENT_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
window.addEventListener('resize', render);
