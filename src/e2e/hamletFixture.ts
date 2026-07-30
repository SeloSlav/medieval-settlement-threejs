import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import {
  initializeBuildingMaterialLibrary,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { resolveCloseGroundLod } from '../grass/grassLodMath.ts';
import { createGrassBladeField } from '../grass/GrassBladeField.ts';
import type {
  BurgageZoneState,
  FarmFieldState,
} from '../resources/types.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { computeBurgageLayout } from '../residences/burgageLayout.ts';
import { collectOccupiedParcelPolygons } from '../residences/burgageZoneLayout.ts';
import { createResidenceMesh } from '../residences/ResidenceMarkers.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { createPreferredRenderer } from '../scene/RendererBackend.ts';
import { createPostProcessor } from '../scene/PostProcessing.ts';
import { SkyCloudMesh, loadSkyPerlinTexture } from '../sky/SkyCloudMesh.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { mulberry32 } from '../utils/random.ts';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import {
  createSeedThreeForest,
  getSeedThreeForestStructuralStats,
  setSeedThreeForestShadows,
  updateSeedThreeForestCamera,
} from '../vegetation/seedthree/seedThreeForestBuilder.ts';
import {
  installVisualPerformanceHooksIfRequested,
  type VisualPerformanceHooks,
} from './visualPerformanceHooks.ts';
import {
  HAMLET_FIELD_SPECS,
  HAMLET_FIXTURE_ID,
  HAMLET_FIXTURE_SEED,
  HAMLET_LANDMARKS,
  HAMLET_MOTION_ROUTE,
  HAMLET_MOTION_ROUTE_ID,
  HAMLET_RESIDENCE_ROOF,
  HAMLET_ROAD_ARMS,
  HAMLET_VIEW_IDS,
  HAMLET_VIEW_SPECS,
  HAMLET_ZONE_SPECS,
  type HamletViewId,
  type HamletMotionKeyframe,
  type HamletZoneSpec,
} from './hamletFixtureConfig.ts';

type HamletFixtureLodState = {
  forest: 'overview' | 'near';
  groundcover: 'hidden' | 'transition' | 'full';
  building: 'strategic' | 'settlement' | 'road-eye';
};

type HamletFixtureMotionState = {
  routeId: typeof HAMLET_MOTION_ROUTE_ID;
  status: 'idle' | 'settled' | 'running' | 'paused' | 'complete';
  elapsedMs: number;
  durationMs: number;
  progress: number;
  segmentIndex: number;
  fromKeyframeId: HamletMotionKeyframe['id'];
  toKeyframeId: HamletMotionKeyframe['id'];
  distanceMeters: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraOrientation: [number, number, number, number];
  lod: HamletFixtureLodState;
};

type HamletFixtureMetrics = {
  fixtureId: string;
  seed: number;
  view: HamletViewId;
  renderer: string;
  residences: number;
  residenceRoof: 'wood-shingle';
  roadArms: number;
  fields: number;
  trees: number;
  visibleTrees: number;
  forestDraws: number;
  drawCalls: number;
  triangles: number;
  motion: HamletFixtureMotionState;
};

type HamletFixtureSystems = {
  included: readonly string[];
  omitted: readonly string[];
};

declare global {
  interface Window {
    __HAMLET_FIXTURE_READY__?: boolean;
    __HAMLET_FIXTURE_METRICS__?: HamletFixtureMetrics;
    __HAMLET_FIXTURE_SET_VIEW__?: (view: HamletViewId) => void;
    __HAMLET_FIXTURE_MOTION_ROUTE__?: typeof HAMLET_MOTION_ROUTE;
    __HAMLET_FIXTURE_MOTION_READY__?: boolean;
    __HAMLET_FIXTURE_MOTION_STATE__?: HamletFixtureMotionState;
    __HAMLET_FIXTURE_MOTION_SETTLED_START__?: () => boolean;
    __HAMLET_FIXTURE_START_MOTION__?: (elapsedMs?: number) => boolean;
    __HAMLET_FIXTURE_SEEK_MOTION__?: (elapsedMs: number) => void;
    __HAMLET_FIXTURE_STOP_MOTION__?: () => void;
    __HAMLET_FIXTURE_CAPTURE_VIEW__?: (view: HamletViewId) => HamletFixtureMetrics;
    __HAMLET_FIXTURE_CAPTURE_MOTION__?: (elapsedMs: number) => HamletFixtureMotionState;
    __HAMLET_FIXTURE_CAPTURE_READY__?: (captureId?: HamletViewId | typeof HAMLET_MOTION_ROUTE_ID) => boolean;
    __HAMLET_FIXTURE_SYSTEMS__?: HamletFixtureSystems;
    __visualPerf?: VisualPerformanceHooks;
  }
}

const root = document.querySelector<HTMLElement>('#fixture-root');
const nav = document.querySelector<HTMLElement>('[data-view-nav]');
const metricsElement = document.querySelector<HTMLElement>('#metrics');
if (!root || !nav || !metricsElement) {
  throw new Error('Hamlet fixture host is incomplete.');
}

const params = new URLSearchParams(window.location.search);
const requestedMotionRouteId = params.get('route');
document.body.classList.toggle('clean', params.get('clean') === '1');
let activeViewId = isHamletViewId(params.get('view'))
  ? params.get('view') as HamletViewId
  : 'strategic';

const rendererBackend = await createPreferredRenderer();
const renderer = rendererBackend.renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(0x9eb6c0, 1);
renderer.shadowMap.autoUpdate = false;
root.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 420);
const motionCameraTarget = new THREE.Vector3();
const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.Fog(0xa9c0ca, 142, 285);

scene.add(new THREE.HemisphereLight(0xdce8e6, 0x443827, 1.9));
const sun = new THREE.DirectionalLight(0xffe6b5, 3.5);
sun.position.set(-75, 112, -58);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -112;
sun.shadow.camera.right = 112;
sun.shadow.camera.top = 108;
sun.shadow.camera.bottom = -108;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.026;
scene.add(sun);
const sunDirection = sun.position.clone().normalize();
const skyPerlinPromise = loadSkyPerlinTexture();

let fixtureReady = false;
let detailedTexturesReady = false;
let renderedFrameCount = 0;
let motionAnimationFrame: number | null = null;
let motionStartNowMs = 0;
let motionStartOffsetMs = 0;
let motionLoopEnabled = false;
let shadowMapNeedsRefresh = true;
let lastRenderWidth = 0;
let lastRenderHeight = 0;
let previousTickNowMs = 0;
let fixtureTimeSeconds = 0;
const firstMotionKeyframe = HAMLET_MOTION_ROUTE.keyframes[0];
let motionState: HamletFixtureMotionState = {
  routeId: HAMLET_MOTION_ROUTE_ID,
  status: 'idle',
  elapsedMs: 0,
  durationMs: HAMLET_MOTION_ROUTE.durationMs,
  progress: 0,
  segmentIndex: 0,
  fromKeyframeId: firstMotionKeyframe.id,
  toKeyframeId: firstMotionKeyframe.id,
  distanceMeters: firstMotionKeyframe.distanceMeters,
  cameraPosition: [...firstMotionKeyframe.position],
  cameraTarget: [...firstMotionKeyframe.target],
  cameraOrientation: [...firstMotionKeyframe.orientation],
  lod: resolveFixtureLodState(firstMotionKeyframe.distanceMeters),
};

const roadMaterials = RoadMaterialFactory.createProgressive(rendererBackend.maxAnisotropy);
const roadTexturesReady = roadMaterials.whenTexturesReady();
await initializeBuildingMaterialLibrary(rendererBackend.maxAnisotropy);
const sky = new SkyCloudMesh({
  sunDirection,
  cloudCoverage: 0.34,
  cloudHeight: 210,
  cloudThickness: 68,
  cloudAbsorption: 0.46,
  hazeStrength: 0.095,
  maxCloudDistance: 6200,
  mieCoefficient: 0.0032,
  mieDirectionalG: 0.6,
  radius: 1900,
  rayleigh: 0.7,
  turbidity: 1.45,
  windSpeedX: 0.085,
  windSpeedZ: 0.045,
  widthSegments: 56,
  heightSegments: 28,
  rendererBackend: rendererBackend.kind,
  perlinTexture: await skyPerlinPromise,
  constellationVisibility: 0,
});
await sky.ready;
scene.add(sky);

const terrainGeometry = createHamletTerrainGeometry();
const terrain = new THREE.Mesh(terrainGeometry, roadMaterials.terrain);
terrain.name = 'AD 1550 hamlet relief terrain';
terrain.receiveShadow = true;
scene.add(terrain);

const terrainAdapter = createHamletTerrainAdapter(terrainGeometry);
const roadNetwork = createHamletRoadNetwork();
const roadRoot = new THREE.Group();
roadRoot.name = 'Deterministic Y-road';
const roadMeshBuilder = new RoadMeshBuilder(terrainAdapter, roadMaterials);
for (const edge of roadNetwork.edges.values()) {
  roadRoot.add(roadMeshBuilder.buildEdge(edge, roadNetwork));
}
roadRoot.add(new RoadJunctionBuilder(terrainAdapter, roadMaterials).build(roadNetwork));
scene.add(roadRoot);

const settlementRoot = new THREE.Group();
settlementRoot.name = 'Compact parish hamlet';
scene.add(settlementRoot);

const { zones, residences } = createHamletResidences(settlementRoot);
const burgageFencing = new BurgageFencing(settlementRoot);
burgageFencing.syncZones(zones, residences, hamletHeightAt);

for (const landmark of HAMLET_LANDMARKS) {
  const building = createBuildingMesh(landmark.kind);
  applyPreTileRoofPalette(building);
  building.name = `${building.name} · ${landmark.id}`;
  building.position.set(
    landmark.position[0],
    hamletHeightAt(landmark.position[0], landmark.position[1]),
    landmark.position[1],
  );
  building.rotation.y = landmark.yaw;
  configureWorldMesh(building);
  settlementRoot.add(building);
}

const fieldRoot = new THREE.Group();
fieldRoot.name = 'Cultivated parish parcels';
scene.add(fieldRoot);
const farmFields = new FarmFieldMarkers(fieldRoot, hamletHeightAt);
farmFields.syncFields(createHamletFields());

const forestPlacements = createHamletForestPlacements();
const grassFieldPromise = createGrassBladeField(terrainAdapter, {
  maxAnisotropy: rendererBackend.maxAnisotropy,
  rendererBackend: rendererBackend.kind,
});
const forest = await createSeedThreeForest(
    forestPlacements,
    terrainAdapter,
    rendererBackend.maxAnisotropy,
    HAMLET_FIXTURE_SEED,
    renderer as WebGPURenderer,
  );
setSeedThreeForestShadows(forest, true);
scene.add(forest.group);
const grassField = await grassFieldPromise;
grassField.syncRoadClearance(roadNetwork);
grassField.syncPlacementClearance(collectOccupiedParcelPolygons(zones, residences));
scene.add(grassField.group);

await roadTexturesReady;
detailedTexturesReady = true;
const postProcessor = createPostProcessor(rendererBackend, scene, camera);
postProcessor.setPixelRatio(renderer.getPixelRatio());
const selectionGroup = new THREE.Group();
selectionGroup.name = 'Empty fixture selection subsystem';
selectionGroup.visible = false;
const previewGroup = new THREE.Group();
previewGroup.name = 'Empty fixture preview subsystem';
previewGroup.visible = false;
const riverGroup = new THREE.Group();
riverGroup.name = 'Omitted fixture river subsystem';
riverGroup.visible = false;
const precipitationGroup = new THREE.Group();
precipitationGroup.name = 'Omitted fixture precipitation subsystem';
precipitationGroup.visible = false;
createViewNavigation();
applyView(activeViewId, false);
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();

fixtureReady = true;
window.__HAMLET_FIXTURE_READY__ = true;
window.__HAMLET_FIXTURE_SET_VIEW__ = (view) => applyView(view, true);
installMotionContract();
document.body.dataset.ready = 'true';
document.body.dataset.fixture = HAMLET_FIXTURE_ID;
document.body.dataset.rendererBackend = rendererBackend.kind;
document.body.dataset.motionReady = String(window.__HAMLET_FIXTURE_MOTION_READY__);
document.body.dataset.omittedSystems = 'river,precipitation,weather,wildlife,people';
window.__HAMLET_FIXTURE_SYSTEMS__ = {
  included: [
    'post-processing',
    'volumetric-sky',
    'groundcover',
    'forest',
    'static-shadows',
    'terrain',
    'roads',
    'buildings',
    'fields',
  ],
  omitted: ['river', 'precipitation', 'weather', 'wildlife', 'people'],
};
installVisualPerformanceHooksIfRequested({
  sceneManager: {
    scene,
    camera,
    renderer,
    postProcessor,
    sky,
    sunLight: sun,
    riverSystem: { group: riverGroup, tick: (_dt: number, _timeSec: number) => {} },
    precipitation: { group: precipitationGroup },
    selectionGroup,
    previewGroup,
    terrain: { mesh: terrain },
    grassField,
    forestManager: { group: forest.group },
    getRendererAdapterEvidence: () => ({
      ...rendererBackend.adapterEvidence,
      limitations: [...rendererBackend.adapterEvidence.limitations],
    }),
    getPerformanceStats: () => ({
      backend: rendererBackend.kind,
      frames: renderedFrameCount,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      pixelRatio: renderer.getPixelRatio(),
    }),
  },
});
window.__visualPerf?.setEnabled('river', false);
window.__visualPerf?.setEnabled('riverSimulation', false);
window.__visualPerf?.setEnabled('riverRender', false);
window.__visualPerf?.setEnabled('precipitation', false);
window.__visualPerf?.setEnabled('selection', false);
window.__visualPerf?.setEnabled('preview', false);
startContinuousTick();
if (requestedMotionRouteId === HAMLET_MOTION_ROUTE_ID) {
  startRequestedMotionRoute();
}
window.addEventListener('resize', () => render(0));
window.addEventListener('keydown', handleViewKey);

function hamletHeightAt(x: number, z: number): number {
  const rollingGround = Math.sin(x * 0.043) * 0.78
    + Math.cos(z * 0.038) * 0.58
    + Math.sin((x + z) * 0.026) * 0.42;
  const northRise = THREE.MathUtils.smoothstep(z, 28, 80) * 7.2;
  const edgeRise = THREE.MathUtils.smoothstep(Math.abs(x), 48, 90) * 5.8;
  const valleyTilt = z * 0.018;
  return rollingGround + northRise + edgeRise + valleyTilt;
}

function createHamletTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(180, 160, 144, 128);
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const dirtZoomGates = new Float32Array(positions.count);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const height = hamletHeightAt(x, z);
    positions.setY(index, height);
    uvs.setXY(index, x / 22 + z / 84, z / 25 - x / 96);

    const forestWeight = THREE.MathUtils.clamp(
      Math.max(
        THREE.MathUtils.smoothstep(z, 36, 72),
        THREE.MathUtils.smoothstep(Math.abs(x), 51, 86),
      ),
      0,
      1,
    );
    const dryWeight = THREE.MathUtils.clamp(
      0.13 + THREE.MathUtils.smoothstep(height, 4, 11) * 0.28,
      0.08,
      0.46,
    );
    const meadowWeight = Math.max(0.08, 1 - forestWeight * 0.58 - dryWeight);
    const denseWeight = Math.max(0.08, forestWeight * 0.58 + 0.08);
    const sum = meadowWeight + denseWeight + dryWeight;
    colors[index * 3] = meadowWeight / sum;
    colors[index * 3 + 1] = denseWeight / sum;
    colors[index * 3 + 2] = dryWeight / sum;
    dirtZoomGates[index] = 1;
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.setAttribute('uv2', uvs.clone());
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(dirtZoomGates, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createHamletTerrainAdapter(geometry: THREE.BufferGeometry): Terrain {
  const dirtZoomGate = geometry.getAttribute('dirtZoomGate') as THREE.BufferAttribute;
  const bounds = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };
  return {
    size: 180,
    playableSize: 160,
    resolution: 144,
    bounds,
    mesh: terrain,
    getHeightAt: hamletHeightAt,
    getPointAt(x: number, z: number, offset = 0) {
      return new THREE.Vector3(x, hamletHeightAt(x, z) + offset, z);
    },
    getPointAtInto(x: number, z: number, target: THREE.Vector3, offset = 0) {
      return target.set(x, hamletHeightAt(x, z) + offset, z);
    },
    clampXZ(x: number, z: number) {
      return {
        x: THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX),
        z: THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ),
      };
    },
    setDirtZoomGate(value: number) {
      (dirtZoomGate.array as Float32Array).fill(value);
      dirtZoomGate.needsUpdate = true;
    },
    setRainColorMode() {},
    dispose() {},
  } as unknown as Terrain;
}

function createHamletRoadNetwork(): RoadNetwork {
  const network = new RoadNetwork();
  for (const arm of HAMLET_ROAD_ARMS) {
    const points = arm.points.map(([x, z]) => (
      new THREE.Vector3(x, hamletHeightAt(x, z), z)
    ));
    const added = network.addRoadPath(points, 3.7);
    if (added.length === 0) {
      throw new Error(`Hamlet road arm ${arm.id} did not create an edge.`);
    }
  }
  return network;
}

function createZone(spec: HamletZoneSpec): BurgageZoneState {
  const [startX, startZ] = spec.axisStart;
  const [endX, endZ] = spec.axisEnd;
  const length = Math.hypot(endX - startX, endZ - startZ);
  const tangentX = (endX - startX) / length;
  const tangentZ = (endZ - startZ) / length;
  const normalX = -tangentZ * spec.side;
  const normalZ = tangentX * spec.side;
  const frontA = {
    x: startX + normalX * spec.frontageOffset,
    z: startZ + normalZ * spec.frontageOffset,
  };
  const frontB = {
    x: endX + normalX * spec.frontageOffset,
    z: endZ + normalZ * spec.frontageOffset,
  };
  const backB = {
    x: endX + normalX * (spec.frontageOffset + spec.depth),
    z: endZ + normalZ * (spec.frontageOffset + spec.depth),
  };
  const backA = {
    x: startX + normalX * (spec.frontageOffset + spec.depth),
    z: startZ + normalZ * (spec.frontageOffset + spec.depth),
  };
  return {
    id: spec.id,
    cornerA: frontA,
    cornerB: frontB,
    cornerC: backB,
    cornerD: backA,
    frontageEdge: 0,
    plotCount: spec.plotCount,
  };
}

function createHamletResidences(parent: THREE.Group): {
  zones: BurgageZoneState[];
  residences: Array<{
    id: string;
    zoneId: string;
    parcelIndex: number;
    x: number;
    z: number;
    yaw: number;
  }>;
} {
  const zones = HAMLET_ZONE_SPECS.map(createZone);
  const residences: Array<{
    id: string;
    zoneId: string;
    parcelIndex: number;
    x: number;
    z: number;
    yaw: number;
  }> = [];
  let residenceIndex = 0;

  for (const zone of zones) {
    const layout = computeBurgageLayout(
      {
        a: zone.cornerA,
        b: zone.cornerB,
        c: zone.cornerC,
        d: zone.cornerD,
      },
      zone.frontageEdge,
      zone.plotCount,
    );
    if (!layout) throw new Error(`Hamlet zone ${zone.id} produced no residence layout.`);

    for (const placement of layout.residences) {
      const id = `${zone.id}-residence-${placement.parcelIndex}`;
      const seed = (HAMLET_FIXTURE_SEED ^ Math.imul(residenceIndex + 1, 0x45d9f3b)) >>> 0;
      const residence = createResidenceMesh(seed, 1, { roof: HAMLET_RESIDENCE_ROOF });
      if (residence.userData.residenceRoof !== HAMLET_RESIDENCE_ROOF) {
        throw new Error(`${id} did not retain the pre-tile wood roof override.`);
      }
      residence.name = `Wood-roof residence · ${id}`;
      residence.userData.fixtureResidenceId = id;
      residence.position.set(
        placement.x,
        hamletHeightAt(placement.x, placement.z),
        placement.z,
      );
      residence.rotation.y = placement.yaw;
      configureWorldMesh(residence);
      parent.add(residence);
      residences.push({ id, zoneId: zone.id, ...placement });
      residenceIndex += 1;
    }
  }
  return { zones, residences };
}

function applyPreTileRoofPalette(rootObject: THREE.Object3D): void {
  const woodRoof = sharedBuildingMaterial('shingle');
  rootObject.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const replaced = materials.map((material) => (
      material.name === 'Shared building material: clayRed'
      || material.name === 'Shared building material: clayDark'
      || material.name === 'Shared building material: slate'
        ? woodRoof
        : material
    ));
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
}

function configureWorldMesh(rootObject: THREE.Object3D): void {
  rootObject.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function createHamletFields(): FarmFieldState[] {
  return HAMLET_FIELD_SPECS.map((spec, index) => ({
    id: spec.id,
    farmsteadId: 'parish-hamlet',
    corners: spec.corners.map(([x, z]) => ({ x, z })) as FarmFieldState['corners'],
    area: polygonArea(spec.corners),
    averageSlopeDegrees: 3 + index * 0.6,
    moisture: 0.48 + index * 0.04,
    fertility: 0.78 + index * 0.035,
    crop: spec.crop,
    nextCrop: spec.crop === 'fallow' ? 'rye' : 'fallow',
    stage: spec.stage,
    stageProgress: spec.stageProgress,
    priority: 2,
    harvestCount: 1,
    lastYield: 34 + index * 4,
    currentYield: 0,
  }));
}

function polygonArea(corners: readonly (readonly [number, number])[]): number {
  let doubledArea = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]!;
    const next = corners[(index + 1) % corners.length]!;
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(doubledArea) * 0.5;
}

function createHamletForestPlacements(): ForestTreePlacement[] {
  const rng = mulberry32(HAMLET_FIXTURE_SEED);
  const species: ForestTreePlacement['species'][] = [
    'beech',
    'beech',
    'beech',
    'hornbeam',
    'sycamoreMaple',
    'sessileOak',
    'silverFir',
    'norwaySpruce',
  ];
  const placements: ForestTreePlacement[] = [];

  for (let z = -62; z <= 76; z += 8.4) {
    for (let x = -86; x <= 86; x += 8.4) {
      const northEdge = z > 48 + Math.sin(x * 0.09) * 4;
      const sideEdge = Math.abs(x) > 68 + Math.sin(z * 0.08) * 3 && z > -54;
      if (!northEdge && !sideEdge) continue;
      if (rng() < 0.1) continue;

      const placedX = x + (rng() - 0.5) * 4.2;
      const placedZ = z + (rng() - 0.5) * 4.2;
      const selectedSpecies = species[Math.floor(rng() * species.length)]!;
      placements.push({
        x: placedX,
        z: placedZ,
        species: selectedSpecies,
        form: rng() < 0.2 ? 'midstory' : 'broad',
        scale: 0.64 + rng() * 0.3,
      });
    }
  }
  return placements;
}

function applyView(viewId: HamletViewId, updateLocation: boolean): void {
  stopMotion('idle');
  activeViewId = viewId;
  const view = HAMLET_VIEW_SPECS.find((candidate) => candidate.id === viewId)!;
  camera.position.set(...view.position);
  camera.fov = view.fov;
  motionCameraTarget.set(...view.target);
  camera.lookAt(...view.target);
  camera.updateProjectionMatrix();

  updateSceneLods(
    camera.position.distanceTo(motionCameraTarget),
    view.firstPerson,
    motionCameraTarget,
  );
  for (const link of nav!.querySelectorAll<HTMLAnchorElement>('a[data-view]')) {
    const active = link.dataset.view === viewId;
    link.toggleAttribute('aria-current', active);
  }
  if (updateLocation) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', viewId);
    url.searchParams.delete('route');
    window.history.replaceState(null, '', url);
  }
  render(0);
}

function createViewNavigation(): void {
  nav!.innerHTML = '';
  for (const view of HAMLET_VIEW_SPECS) {
    const link = document.createElement('a');
    const url = new URL(window.location.href);
    url.searchParams.set('view', view.id);
    link.href = url.toString();
    link.dataset.view = view.id;
    link.textContent = `${HAMLET_VIEW_IDS.indexOf(view.id) + 1} ${view.label}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      applyView(view.id, true);
    });
    nav!.append(link);
  }
  const motionLink = document.createElement('a');
  const motionUrl = new URL(window.location.href);
  motionUrl.searchParams.delete('view');
  motionUrl.searchParams.set('route', HAMLET_MOTION_ROUTE_ID);
  motionLink.href = motionUrl.toString();
  motionLink.dataset.route = HAMLET_MOTION_ROUTE_ID;
  motionLink.textContent = '8 LOD route';
  motionLink.addEventListener('click', (event) => {
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('route', HAMLET_MOTION_ROUTE_ID);
    window.history.replaceState(null, '', url);
    startMotionRoute(0, false);
  });
  nav!.append(motionLink);
}

function handleViewKey(event: KeyboardEvent): void {
  const index = Number(event.key) - 1;
  const view = HAMLET_VIEW_IDS[index];
  if (view) applyView(view, true);
}

function resolveFixtureLodState(distanceMeters: number): HamletFixtureLodState {
  const { lodBands } = HAMLET_MOTION_ROUTE;
  return {
    forest: distanceMeters <= lodBands.forest.nearDistanceMeters ? 'near' : 'overview',
    groundcover: distanceMeters <= lodBands.groundcover.fullDetailMeters
      ? 'full'
      : distanceMeters <= lodBands.groundcover.transitionStartMeters
        ? 'transition'
        : 'hidden',
    building: distanceMeters <= lodBands.building.roadEyeMeters
      ? 'road-eye'
      : distanceMeters <= lodBands.building.settlementMeters
        ? 'settlement'
        : 'strategic',
  };
}

function updateSceneLods(
  distanceMeters: number,
  firstPerson: boolean,
  cameraTarget: THREE.Vector3,
): HamletFixtureLodState {
  const closeGround = resolveCloseGroundLod(distanceMeters, firstPerson);
  terrainAdapter.setDirtZoomGate(closeGround.dirtGate);
  grassField.updateCameraState(camera.position, cameraTarget, distanceMeters, firstPerson);
  updateSeedThreeForestCamera(
    forest,
    camera,
    firstPerson,
    { minX: -90, maxX: 90, minZ: -80, maxZ: 80 },
  );
  const lod = resolveFixtureLodState(distanceMeters);
  settlementRoot.userData.reviewLodBand = lod.building;
  document.body.dataset.forestLod = lod.forest;
  document.body.dataset.groundcoverLod = lod.groundcover;
  document.body.dataset.buildingLod = lod.building;
  return lod;
}

function installMotionContract(): void {
  window.__HAMLET_FIXTURE_MOTION_ROUTE__ = HAMLET_MOTION_ROUTE;
  window.__HAMLET_FIXTURE_MOTION_STATE__ = motionState;
  window.__HAMLET_FIXTURE_MOTION_SETTLED_START__ = isMotionSettledStartReady;
  window.__HAMLET_FIXTURE_MOTION_READY__ = isMotionSettledStartReady();
  window.__HAMLET_FIXTURE_START_MOTION__ = (elapsedMs = 0) => (
    startMotionRoute(elapsedMs, false)
  );
  window.__HAMLET_FIXTURE_SEEK_MOTION__ = (elapsedMs) => {
    seekMotionRoute(elapsedMs, 'paused');
  };
  window.__HAMLET_FIXTURE_STOP_MOTION__ = () => stopMotion('paused');
  window.__HAMLET_FIXTURE_CAPTURE_VIEW__ = (view) => {
    applyView(view, false);
    document.body.dataset.captureId = view;
    document.body.dataset.captureReady = 'true';
    return window.__HAMLET_FIXTURE_METRICS__!;
  };
  window.__HAMLET_FIXTURE_CAPTURE_MOTION__ = (elapsedMs) => {
    seekMotionRoute(elapsedMs, 'paused');
    document.body.dataset.captureId = HAMLET_MOTION_ROUTE_ID;
    document.body.dataset.captureReady = 'true';
    return motionState;
  };
  window.__HAMLET_FIXTURE_CAPTURE_READY__ = (captureId) => {
    if (!fixtureReady || !detailedTexturesReady || renderedFrameCount < 2) return false;
    if (!captureId) return document.body.dataset.captureReady === 'true';
    if (captureId === HAMLET_MOTION_ROUTE_ID) {
      return motionState.status !== 'idle';
    }
    return activeViewId === captureId && motionState.status !== 'running';
  };
}

function isMotionSettledStartReady(): boolean {
  return fixtureReady
    && detailedTexturesReady
    && renderedFrameCount >= HAMLET_MOTION_ROUTE.settledStartPredicate.minimumRenderedFrames
    && motionState.status !== 'running';
}

function startMotionRoute(elapsedMs: number, loop: boolean): boolean {
  if (!isMotionSettledStartReady()) return false;
  motionLoopEnabled = loop;
  motionStartOffsetMs = THREE.MathUtils.clamp(
    elapsedMs,
    0,
    HAMLET_MOTION_ROUTE.durationMs,
  );
  seekMotionRoute(motionStartOffsetMs, 'settled');
  motionStartNowMs = performance.now();
  motionState = { ...motionState, status: 'running' };
  publishMotionState();
  document.body.dataset.captureReady = 'false';
  return true;
}

function startRequestedMotionRoute(): void {
  const waitForProfile = params.get('visualProfile') === '1';
  const tryStart = (): void => {
    if (
      waitForProfile
      && document.documentElement.dataset.visualProfileStatus !== 'collecting'
    ) {
      requestAnimationFrame(tryStart);
      return;
    }
    startMotionRoute(0, waitForProfile);
  };
  requestAnimationFrame(tryStart);
}

function stopMotion(status: 'idle' | 'paused'): void {
  motionLoopEnabled = false;
  if (motionState.status === 'running' || status === 'idle') {
    motionState = { ...motionState, status };
    publishMotionState();
  }
}

function seekMotionRoute(
  elapsedMs: number,
  status: HamletFixtureMotionState['status'],
): void {
  const sample = sampleMotionRoute(elapsedMs);
  camera.position.copy(sample.position);
  motionCameraTarget.copy(sample.target);
  camera.quaternion.copy(sample.orientation);
  camera.fov = sample.fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const firstPerson =
    sample.distanceMeters <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters;
  const lod = updateSceneLods(sample.distanceMeters, firstPerson, motionCameraTarget);
  motionState = {
    routeId: HAMLET_MOTION_ROUTE_ID,
    status,
    elapsedMs: sample.elapsedMs,
    durationMs: HAMLET_MOTION_ROUTE.durationMs,
    progress: sample.elapsedMs / HAMLET_MOTION_ROUTE.durationMs,
    segmentIndex: sample.segmentIndex,
    fromKeyframeId: sample.from.id,
    toKeyframeId: sample.to.id,
    distanceMeters: sample.distanceMeters,
    cameraPosition: sample.position.toArray() as [number, number, number],
    cameraTarget: sample.target.toArray() as [number, number, number],
    cameraOrientation: sample.orientation.toArray() as [number, number, number, number],
    lod,
  };
  publishMotionState();
  render(0);
}

function sampleMotionRoute(elapsedMs: number): {
  elapsedMs: number;
  segmentIndex: number;
  from: HamletMotionKeyframe;
  to: HamletMotionKeyframe;
  position: THREE.Vector3;
  target: THREE.Vector3;
  orientation: THREE.Quaternion;
  distanceMeters: number;
  fov: number;
} {
  const clamped = THREE.MathUtils.clamp(elapsedMs, 0, HAMLET_MOTION_ROUTE.durationMs);
  const keyframes = HAMLET_MOTION_ROUTE.keyframes;
  let segmentIndex = Math.max(0, keyframes.length - 2);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    if (clamped <= keyframes[index + 1]!.timeMs) {
      segmentIndex = index;
      break;
    }
  }
  const from = keyframes[segmentIndex]!;
  const to = keyframes[segmentIndex + 1]!;
  const segmentDuration = Math.max(1, to.timeMs - from.timeMs);
  const rawT = THREE.MathUtils.clamp((clamped - from.timeMs) / segmentDuration, 0, 1);
  const t = smootherstep(rawT);
  const position = new THREE.Vector3(...from.position).lerp(
    new THREE.Vector3(...to.position),
    t,
  );
  const target = new THREE.Vector3(...from.target).lerp(
    new THREE.Vector3(...to.target),
    t,
  );
  const orientation = new THREE.Quaternion().slerpQuaternions(
    new THREE.Quaternion(...from.orientation),
    new THREE.Quaternion(...to.orientation),
    t,
  );
  return {
    elapsedMs: clamped,
    segmentIndex,
    from,
    to,
    position,
    target,
    orientation,
    distanceMeters: THREE.MathUtils.lerp(from.distanceMeters, to.distanceMeters, t),
    fov: THREE.MathUtils.lerp(from.fov, to.fov, t),
  };
}

function smootherstep(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function publishMotionState(): void {
  window.__HAMLET_FIXTURE_MOTION_STATE__ = motionState;
  window.__HAMLET_FIXTURE_MOTION_READY__ = isMotionSettledStartReady();
  document.body.dataset.motionStatus = motionState.status;
  document.body.dataset.motionElapsedMs = motionState.elapsedMs.toFixed(0);
  document.body.dataset.motionDistanceMeters = motionState.distanceMeters.toFixed(2);
}

function startContinuousTick(): void {
  if (motionAnimationFrame !== null) return;
  const tick = (nowMs: number): void => {
    motionAnimationFrame = requestAnimationFrame(tick);
    const dtMs = previousTickNowMs === 0
      ? 0
      : Math.min(100, Math.max(0, nowMs - previousTickNowMs));
    previousTickNowMs = nowMs;
    fixtureTimeSeconds += dtMs / 1000;

    if (motionState.status === 'running') {
      const unboundedElapsed = motionStartOffsetMs + nowMs - motionStartNowMs;
      const elapsed = motionLoopEnabled
        ? unboundedElapsed % HAMLET_MOTION_ROUTE.durationMs
        : Math.min(unboundedElapsed, HAMLET_MOTION_ROUTE.durationMs);
      const nextStatus = !motionLoopEnabled && elapsed >= HAMLET_MOTION_ROUTE.durationMs
        ? 'complete'
        : 'running';
      const sample = sampleMotionRoute(elapsed);
      camera.position.copy(sample.position);
      motionCameraTarget.copy(sample.target);
      camera.quaternion.copy(sample.orientation);
      camera.fov = sample.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const firstPerson =
        sample.distanceMeters <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters;
      const lod = updateSceneLods(sample.distanceMeters, firstPerson, motionCameraTarget);
      motionState = {
        routeId: HAMLET_MOTION_ROUTE_ID,
        status: nextStatus,
        elapsedMs: sample.elapsedMs,
        durationMs: HAMLET_MOTION_ROUTE.durationMs,
        progress: sample.elapsedMs / HAMLET_MOTION_ROUTE.durationMs,
        segmentIndex: sample.segmentIndex,
        fromKeyframeId: sample.from.id,
        toKeyframeId: sample.to.id,
        distanceMeters: sample.distanceMeters,
        cameraPosition: sample.position.toArray() as [number, number, number],
        cameraTarget: sample.target.toArray() as [number, number, number],
        cameraOrientation: sample.orientation.toArray() as [number, number, number, number],
        lod,
      };
      publishMotionState();
    } else if (motionState.status === 'idle') {
      const view = HAMLET_VIEW_SPECS.find((candidate) => candidate.id === activeViewId)!;
      updateSceneLods(
        camera.position.distanceTo(motionCameraTarget),
        view.firstPerson,
        motionCameraTarget,
      );
    } else {
      updateSceneLods(
        motionState.distanceMeters,
        motionState.distanceMeters
          <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters,
        motionCameraTarget,
      );
    }

    sky.updateCamera(camera);
    sky.updateSun(sunDirection);
    sky.updateTime(fixtureTimeSeconds);
    render(dtMs / 1000);
  };
  motionAnimationFrame = requestAnimationFrame(tick);
}

function render(dt = 0): void {
  const width = root!.clientWidth;
  const height = Math.max(1, root!.clientHeight);
  if (width !== lastRenderWidth || height !== lastRenderHeight) {
    lastRenderWidth = width;
    lastRenderHeight = height;
    renderer.setSize(width, height, false);
    postProcessor.setSize(width, height);
    sky.updateResolution(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const shadowMap = renderer.shadowMap as typeof renderer.shadowMap & { needsUpdate?: boolean };
  if (shadowMapNeedsRefresh) {
    shadowMap.needsUpdate = true;
    shadowMapNeedsRefresh = false;
  }
  postProcessor.render(dt);
  renderedFrameCount += 1;

  const forestStats = getSeedThreeForestStructuralStats(forest);
  const metrics: HamletFixtureMetrics = {
    fixtureId: HAMLET_FIXTURE_ID,
    seed: HAMLET_FIXTURE_SEED,
    view: activeViewId,
    renderer: rendererBackend.kind,
    residences: residences.length,
    residenceRoof: 'wood-shingle',
    roadArms: HAMLET_ROAD_ARMS.length,
    fields: HAMLET_FIELD_SPECS.length,
    trees: forestStats.trees.totalTrees,
    visibleTrees: forestStats.trees.visibleTrees,
    forestDraws: forestStats.draws,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    motion: motionState,
  };
  window.__HAMLET_FIXTURE_METRICS__ = metrics;
  metricsElement!.textContent = [
    `${activeViewId} · ${rendererBackend.kind}`,
    `${metrics.drawCalls} draws · ${metrics.triangles.toLocaleString()} tris`,
    `${metrics.residences} wood-roof homes · ${metrics.visibleTrees}/${metrics.trees} trees`,
  ].join('\n');
}

function isHamletViewId(value: string | null): value is HamletViewId {
  return HAMLET_VIEW_IDS.some((view) => view === value);
}
