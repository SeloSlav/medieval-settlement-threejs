import * as THREE from 'three';
import {
  createBuildingPreviewMesh,
  updateBuildingPreviewGeometry,
} from '../buildings/BuildingPlacementPreview.ts';
import { resolveBuildingPlacementWildlifePreview } from '../buildings/buildingPlacementWildlifePreview.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { BUILDING_KINDS, type BuildingKind } from '../resources/types.ts';
import { FarmFieldPreview } from '../farming/FarmFieldMarkers.ts';
import {
  rectangleFromBaseline,
  type FarmFieldCorners,
} from '../farming/farmFieldMath.ts';
import { BurgagePreview } from '../residences/BurgagePreview.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { createBackyardGardenMesh } from '../residences/backyardGardenMesh.ts';
import { backyardGardenPlacementForParcel } from '../residences/backyardPosition.ts';
import { createResidenceMesh } from '../residences/ResidenceMarkers.ts';
import {
  cornersFromPoints,
  resolveBurgageLayout,
} from '../residences/burgageLayout.ts';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';
import type { BurgageZoneState } from '../resources/types.ts';

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
const lineupParams = new URLSearchParams(window.location.search);
const alignmentView = lineupParams.get('view') === 'residence-alignment';
const buildingPreviewView = lineupParams.get('view') === 'building-preview';
const wildlifePreviewView = lineupParams.get('view') === 'wildlife-preview';
const buildingPreviewDistance = lineupParams.get('distance');
const previewYawParam = lineupParams.get('yaw');
const requestedPreviewYaw = previewYawParam === null ? Number.NaN : Number(previewYawParam);
const buildingPreviewYaw = Number.isFinite(requestedPreviewYaw)
  ? requestedPreviewYaw
  : 0.58;
const requestedBuilding = lineupParams.get('building');
const buildingKind: BuildingKind = requestedBuilding
  && BUILDING_KINDS.includes(requestedBuilding as BuildingKind)
  ? requestedBuilding as BuildingKind
  : 'village_storehouse';
const buildingDefinition = getBuildingDefinition(buildingKind);
const wildlifeLineupScale = wildlifePreviewView && buildingKind === 'lumber_mill'
  ? 5.2
  : wildlifePreviewView
    ? 2.1
    : 1;

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
scene.fog = new THREE.Fog(
  0x85927c,
  78 * wildlifeLineupScale,
  155 * wildlifeLineupScale,
);

function getHeightAt(x: number, z: number): number {
  if (alignmentView) return 0;
  return Math.sin(x * 0.105) * 1.05
    + Math.cos(z * 0.13) * 0.72
    + Math.sin((x + z) * 0.055) * 0.58;
}

const terrainGeometry = new THREE.PlaneGeometry(
  112 * wildlifeLineupScale,
  68 * wildlifeLineupScale,
  140,
  92,
);
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

const roadGeometry = new THREE.PlaneGeometry(alignmentView ? 38 : 25, 4.8, 36, 4);
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

const buildingPreview = createBuildingPreviewMesh(buildingKind);
scene.add(buildingPreview);
buildingPreview.visible = !alignmentView;
let buildingX = buildingPreviewView || wildlifePreviewView ? 0 : -31;
let buildingZ = buildingPreviewView || wildlifePreviewView ? 0 : 1;
const wildlifeFixtureNodes = wildlifePreviewView
  ? buildingKind === 'lumber_mill'
    ? [
        {
          nodeId: 'visual-game-logging-overlap',
          kind: 'game' as const,
          resource: 'game' as const,
          remaining: 12,
          maxYield: 12,
          x: 190,
          z: 0,
        },
        {
          nodeId: 'visual-game-building-overlap',
          kind: 'game' as const,
          resource: 'game' as const,
          remaining: 12,
          maxYield: 12,
          x: 42,
          z: -10,
        },
      ]
    : [
        {
          nodeId: 'visual-game-direct-risk',
          kind: 'game' as const,
          resource: 'game' as const,
          remaining: 12,
          maxYield: 12,
          x: 35,
          z: -10,
        },
        {
          nodeId: 'visual-game-safe-hunting-reach',
          kind: 'game' as const,
          resource: 'game' as const,
          remaining: 12,
          maxYield: 12,
          x: -61,
          z: 12,
        },
      ]
  : [];
const wildlifePreview = wildlifePreviewView
  ? resolveBuildingPlacementWildlifePreview(
      buildingKind,
      buildingX,
      buildingZ,
      buildingPreviewYaw,
      wildlifeFixtureNodes,
    )
  : undefined;

if (wildlifePreviewView) {
  const markerScale = buildingKind === 'lumber_mill' ? 1.8 : 1;
  for (const node of wildlifeFixtureNodes) {
    const marker = new THREE.Group();
    marker.name = `Visible game resource ${node.nodeId}`;
    const groundY = getHeightAt(node.x, node.z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4 * markerScale, 2.8 * markerScale, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x4b2f1e, fog: false, toneMapped: false }),
    );
    base.position.set(node.x, groundY + 0.22, node.z);
    marker.add(base);
    const gameGlyph = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.1 * markerScale, 0),
      new THREE.MeshBasicMaterial({ color: 0xf0d49a, fog: false, toneMapped: false }),
    );
    gameGlyph.position.set(node.x, groundY + 2.7 * markerScale, node.z);
    gameGlyph.scale.set(1.35, 1.65, 0.72);
    marker.add(gameGlyph);
    scene.add(marker);
  }
}
updateBuildingPreviewGeometry(
  buildingPreview,
  buildingKind,
  buildingX,
  buildingZ,
  buildingPreviewView || wildlifePreviewView ? buildingPreviewYaw : -0.18,
  getHeightAt,
  wildlifePreview,
);

const burgageCorners = (alignmentView
  ? [[-15, -8.4], [15, -8.4], [18, 21], [-17, 14]]
  : [[-11, -8.4], [11, -8.4], [11, 10], [-11, 10]])
  .map(([x, z]) => new THREE.Vector3(x!, getHeightAt(x!, z!), z!));
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
burgagePreview.group.visible = !alignmentView;
if (buildingPreviewView || wildlifePreviewView) burgagePreview.group.visible = false;

if (alignmentView && burgageZoneCorners && burgageLayout) {
  const residenceRoot = new THREE.Group();
  residenceRoot.name = 'House-authored backyard alignment comparison';
  scene.add(residenceRoot);

  const zone: BurgageZoneState = {
    id: 'alignment-zone',
    cornerA: burgageZoneCorners.a,
    cornerB: burgageZoneCorners.b,
    cornerC: burgageZoneCorners.c,
    cornerD: burgageZoneCorners.d,
    frontageEdge: 0,
    plotCount: burgageLayout.plotCount,
  };
  const residences = burgageLayout.residences.map((placement, index) => ({
    id: `alignment-residence-${index}`,
    zoneId: zone.id,
    ...placement,
  }));
  const gardenKinds: BackyardGardenKind[] = [
    'herb_garden',
    'vegetable_garden',
    'flower_garden',
  ];
  for (const [index, residence] of residences.entries()) {
    const house = createResidenceMesh(0x1550 + index * 97, 1);
    house.position.set(residence.x, getHeightAt(residence.x, residence.z), residence.z);
    house.rotation.y = residence.yaw;
    residenceRoot.add(house);

    const parcel = burgageLayout.parcels[index]!;
    const placement = backyardGardenPlacementForParcel(residence, parcel);
    if (!placement) continue;
    const garden = createBackyardGardenMesh(gardenKinds[index]!, {
      width: placement.width,
      depth: placement.depth,
      seed: 4271 + index * 101,
    });
    garden.position.set(placement.x, getHeightAt(placement.x, placement.z), placement.z);
    garden.rotation.y = placement.yaw;
    residenceRoot.add(garden);
  }
  const fencing = new BurgageFencing(residenceRoot);
  fencing.syncZones([zone], residences, getHeightAt);
}

const fieldCorners: FarmFieldCorners = [
  { x: 23, z: -9 },
  { x: 49, z: -6 },
  { x: 45, z: 14 },
  { x: 21, z: 11 },
];
const fieldPreview = new FarmFieldPreview(getHeightAt);
scene.add(fieldPreview.group);
fieldPreview.show(fieldCorners, true, 'rye');
fieldPreview.group.visible = !alignmentView;
if (buildingPreviewView || wildlifePreviewView) fieldPreview.group.visible = false;

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

const camera = new THREE.PerspectiveCamera(
  38,
  1,
  0.1,
  220 * wildlifeLineupScale,
);
if (alignmentView) {
  camera.position.set(0, 43, 38);
  camera.lookAt(0, 0, 6);
} else if (buildingPreviewView) {
  const cameraScale = buildingPreviewDistance === 'near'
    ? 0.68
    : buildingPreviewDistance === 'far'
      ? 1.7
      : 1;
  camera.position.set(20 * cameraScale, 24 * cameraScale, 27 * cameraScale);
  camera.lookAt(0, 2.8, 0);
} else if (wildlifePreviewView) {
  if (buildingKind === 'lumber_mill') {
    camera.position.set(260, 330, 345);
    camera.lookAt(35, 0, 0);
  } else {
    camera.position.set(86, 112, 108);
    camera.lookAt(-4, 0, 0);
  }
} else {
  camera.position.set(13, 51, 63);
  camera.lookAt(7, 0, 0);
}

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
  if (alignmentView || buildingPreviewView || wildlifePreviewView) return;
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
      buildingKind,
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
if (alignmentView) {
  const renderLoadedAlignmentAssets = (): void => {
    render();
    requestAnimationFrame(renderLoadedAlignmentAssets);
  };
  requestAnimationFrame(renderLoadedAlignmentAssets);
}
window.__PLACEMENT_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.buildingKind = buildingKind;
if (alignmentView) {
  document.querySelector('h1')!.textContent = 'Residence Alignment Visual QA';
  document.querySelector('header p')!.textContent = 'Frontage-first houses · house-aligned extensions · skew-safe fencing';
  const labels = document.querySelectorAll<HTMLElement>('.label');
  labels[0]!.textContent = 'Herb garden';
  labels[1]!.textContent = 'Vegetable garden';
  labels[2]!.textContent = 'Flower garden';
} else if (buildingPreviewView) {
  document.querySelector('h1')!.textContent = 'Building Placement Ghost QA';
  document.querySelector('header p')!.textContent = 'Hatched footprint · four road sockets · colorless model';
  const labels = document.querySelectorAll<HTMLElement>('.label');
  labels[0]!.textContent = `${buildingDefinition.label} placement ghost`;
  labels[0]!.style.left = '50%';
  labels[1]!.hidden = true;
  labels[2]!.hidden = true;
} else if (wildlifePreviewView) {
  document.querySelector('h1')!.textContent = 'Wildlife Placement Warning QA';
  document.querySelector('header p')!.textContent = buildingKind === 'lumber_mill'
    ? 'Red grazing habitat · dashed logging extent · advisory overlap'
    : buildingKind === 'hunters_hall'
      ? 'Red grazing habitat · safe hunting reach · placement remains allowed'
      : 'Red grazing habitat · direct footprint risk · placement remains allowed';
  const labels = document.querySelectorAll<HTMLElement>('.label');
  labels[0]!.textContent = '38 m game grazing area';
  labels[1]!.textContent = buildingKind === 'lumber_mill'
    ? '210 m logging work extent'
    : `${buildingDefinition.label} footprint`;
  labels[2]!.textContent = 'Advisory — never a placement blocker';
} else {
  document.querySelector<HTMLElement>('.label')!.textContent = `${buildingDefinition.label} footprint`;
}
window.addEventListener('resize', render);
