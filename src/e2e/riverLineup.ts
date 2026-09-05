import * as THREE from 'three';
import {
  MeshStandardNodeMaterial,
  WebGPURenderer,
} from 'three/webgpu';
import { float, smoothstep, uv } from 'three/tsl';
import type { Terrain } from '../terrain/Terrain.ts';
import { setWorldAnimationTime } from '../scene/worldAnimationTime.ts';
import { createRiverChannelRockPlacements } from '../rivers/RiverChannelRocks.ts';
import { RiverField } from '../rivers/RiverField.ts';
import {
  KUPA_BANK_TO_WATER_DROP_METERS,
  KUPA_HYDRAULIC_GRADE,
  KUPA_MIN_CHANNEL_WATER_DEPTH_METERS,
  RiverLayout,
  type RiverPoint,
} from '../rivers/RiverLayout.ts';
import { getStillWaterSurfaceY } from '../rivers/RiverWaterLevel.ts';
import {
  type RiverWaterDebugMode,
  setSharedRiverWaterDebugMode,
} from '../rivers/RiverWaterMaterial.ts';
import {
  createRiverWaterShoreMaps,
  disposeRiverWaterShoreMaps,
} from '../rivers/riverWaterShoreMaps.ts';
import { createRiverSystem } from '../rivers/RiverSystem.ts';
import { loadRiverRockTextures } from '../utils/propTextureLoad.ts';

type RiverLineupView = 'near' | 'design' | 'far';

type FixtureTslNode = {
  x: FixtureTslNode;
  mul(value: FixtureTslNode | number): FixtureTslNode;
};

type CameraEvidence = {
  position: number[];
  target: number[];
  fov: number;
};

type RiverLineupPerformance = {
  medianGpuMs: number | null;
  sampleCount: number;
  medianFps: number;
  onePercentLowFps: number;
  p95FrameMs: number;
  p95CpuSubmitMs: number;
  framesOver25Ms: number;
};

export type RiverLineupEvidence = {
  ready: boolean;
  view: RiverLineupView;
  debugMode: RiverWaterDebugMode;
  fixedAnimationTimeSeconds: number;
  deterministicInput: string;
  noPost: true;
  bankOverlay: {
    transparent: boolean;
    premultipliedAlpha: boolean;
    depthWrite: boolean;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
    opacityContract: string;
    surface: string;
  };
  crossSection: {
    adjacentBankToWaterDropMeters: number;
    centerWaterDepthMeters: number;
    requiredBankDropMeters: number;
    requiredWaterDepthMeters: number;
    waterClimbsBank: boolean;
  };
  channel: {
    rockCount: number;
    stationCount: number;
    mixedSideStationCount: number;
    foamSourcePixels: number;
    peakFoamSource: number;
    packedSurfaceMapBytes: number;
    cattailInstances: number;
    cattailSubmergedInstances: number;
    qualityTier: string;
    packedSurfaceTextureLookups: 1;
    travellingFoam: true;
  };
  renderer: {
    backend: string;
    drawCalls: number;
    renderPasses: number;
    triangles: number;
    geometries: number;
    textures: number;
    renderTargets: number;
    pixelRatio: number;
  };
  performance: RiverLineupPerformance;
  camera: CameraEvidence;
};

type CaptureRequest = {
  view?: RiverLineupView;
  debugMode?: RiverWaterDebugMode;
  animationTimeSeconds?: number;
};

declare global {
  interface Window {
    __KUPA_RIVER_LINEUP_READY__?: boolean;
    __KUPA_RIVER_LINEUP_EVIDENCE__?: RiverLineupEvidence;
    __KUPA_RIVER_LINEUP_CAPTURE__?: (
      request?: CaptureRequest,
    ) => Promise<RiverLineupEvidence>;
  }
}

const root = document.querySelector<HTMLElement>('#lineup-root');
if (!root) throw new Error('Kupa river lineup host is missing.');
const stageDataset = document.documentElement.dataset;
stageDataset.kupaRiverStage = 'module-ready';

const query = new URLSearchParams(window.location.search);
document.body.dataset.clean = String(query.get('clean') === '1');
const initialView = normalizeView(query.get('view'));
const initialDebugMode = normalizeDebugMode(query.get('debug'));
const requestedTime = Number(query.get('time'));
const fixedAnimationTimeSeconds = Number.isFinite(requestedTime)
  ? Math.max(0, requestedTime)
  : 6.25;
let currentAnimationTime = fixedAnimationTimeSeconds;
const detail = document.querySelector<HTMLElement>('#contract-detail');
if (detail) {
  detail.textContent = `${initialView} camera · ${initialDebugMode} output · fixed t=${fixedAnimationTimeSeconds.toFixed(2)}s · direct no-post render`;
}

const BOUNDS = Object.freeze({ minX: -90, maxX: 90, minZ: -260, maxZ: 260 });
// 2.04 m/cell along this long validation reach is close to the 1.60 m/cell
// production field while retaining enough stations to judge repeated rapids.
const FIELD_RESOLUTION = 256;
const LAYOUT_SEED = 0x4b75_7061;
const TERRAIN_SEGMENTS_X = 112;
const TERRAIN_SEGMENTS_Z = 220;
const PERFORMANCE_WARMUP_FRAMES = 10;
const PERFORMANCE_SAMPLE_FRAMES = 45;

const layout = RiverLayout.create({
  bounds: BOUNDS,
  seed: LAYOUT_SEED,
  riverCount: 1,
  tributaryCount: 0,
  terrainPreset: 'kupa_valley',
});
const riverField = RiverField.fromLayout({
  bounds: BOUNDS,
  layout,
  resolution: FIELD_RESOLUTION,
});
stageDataset.kupaRiverStage = 'field-ready';

const renderer = new WebGPURenderer({ antialias: true, alpha: false, trackTimestamp: true } as ConstructorParameters<typeof WebGPURenderer>[0]);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = false;
await renderer.init();
root.appendChild(renderer.domElement);
stageDataset.kupaRiverStage = 'renderer-ready';

const backend = (
  renderer as unknown as {
    backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
  }
).backend;
const rendererBackend = backend?.isWebGPUBackend
  ? 'webgpu'
  : backend?.isWebGLBackend
    ? 'webgl2-node'
    : 'unknown';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x839c96);
scene.fog = new THREE.FogExp2(0x839c96, 0.0062);

const terrainMaterial = new THREE.MeshStandardMaterial({
  name: 'Kupa visual-contract terrain',
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.98,
  metalness: 0,
});
const terrainGeometry = createTerrainGeometry();
const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrainMesh.name = 'Kupa entrenched terrain cross-section';
terrainMesh.receiveShadow = true;
scene.add(terrainMesh);

const terrain = {
  generationSize: Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ),
  bounds: BOUNDS,
  mesh: terrainMesh,
  getHeightAt: terrainHeightAt,
  getForestBlendAt: () => 0.28,
} as unknown as Terrain;

const bankMaterial = new MeshStandardNodeMaterial();
bankMaterial.name = 'Kupa lineup carbonate bank material';
bankMaterial.color.set(0xf0eee5);
bankMaterial.roughness = 0.9;
bankMaterial.metalness = 0;
// `createRiverSystem` replaces the river-bank color/normal/roughness nodes but
// deliberately inherits alpha and depth ordering from RoadMaterialFactory's
// production `createRiverBankMaterial`. Reproduce that base-material contract
// here so this isolated fixture does not turn the 6.5 m overlay into an opaque
// cream strip with a hard dry-side seam.
bankMaterial.transparent = true;
bankMaterial.premultipliedAlpha = true;
bankMaterial.opacity = 1;
bankMaterial.depthWrite = false;
bankMaterial.polygonOffset = true;
bankMaterial.polygonOffsetFactor = -3;
bankMaterial.polygonOffsetUnits = -8;
const bankUv = uv() as unknown as FixtureTslNode;
bankMaterial.opacityNode = (smoothstep(
  float(0.08) as never,
  float(0.62) as never,
  bankUv.x as never,
) as unknown as FixtureTslNode).mul(0.94) as never;
bankMaterial.userData.fixtureOpacityContract = 'smoothstep(0.08,0.62,uv.x)*0.94';
const rockTextures = await loadRiverRockTextures(renderer.getMaxAnisotropy());
const river = await createRiverSystem(
  terrain,
  riverField,
  bankMaterial,
  rockTextures,
  renderer.getMaxAnisotropy(),
  rendererBackend === 'webgpu' ? 'webgpu' : 'webgl2-node',
);
scene.add(river.group);
stageDataset.kupaRiverStage = 'river-core-ready';
await river.finishDetails();
if (query.get('baseline') === '1') {
  const baseline = await import('../rivers/WaterBaseline.ts');
  const baselineMaps = createRiverWaterShoreMaps(riverField);
  river.group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.water) return;
    object.geometry.setAttribute('simDelta',new THREE.BufferAttribute(new Float32Array(object.geometry.getAttribute('position').count),1));
    object.material = baseline.createRiverWaterMaterial(baselineMaps);
  });
}
stageDataset.kupaRiverStage = 'river-details-ready';

const channelRocks = createRiverChannelRockPlacements(riverField);
const heroRock = selectHeroRock(channelRocks);
const crossSectionPoint = nearestCorridorPoint(heroRock.x, heroRock.z);
const camera = new THREE.PerspectiveCamera(43, 1, 0.08, 300);
let activeView = initialView;
let activeDebugMode = initialDebugMode;
let activeTarget = new THREE.Vector3();
applyCamera(activeView);
river.updateCameraState(camera.position, activeTarget, camera.position.distanceTo(activeTarget), true);
setSharedRiverWaterDebugMode(activeDebugMode);
setWorldAnimationTime(fixedAnimationTimeSeconds);

addLighting();

const shoreMapEvidence = collectShoreMapEvidence();
const crossSectionEvidence = collectCrossSectionEvidence();
const stationEvidence = collectStationEvidence();
const habitatEvidence = collectHabitatEvidence();
const waterEvidence = collectWaterEvidence();

const frameIntervalsMs: number[] = [];
const cpuSubmitMs: number[] = [];
const gpuMs: number[] = [];
let gpuPending = false;
let previousFrameTimestamp = 0;
let frameIndex = 0;
let animationFrameId = 0;
let evidencePublished = false;

const resize = (): void => {
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
resize();

const renderFrame = (timestamp: number): void => {
  animationFrameId = requestAnimationFrame(renderFrame);
  const deltaMs = previousFrameTimestamp > 0 ? timestamp - previousFrameTimestamp : 0;
  previousFrameTimestamp = timestamp;
  const dt = Math.min(0.033, Math.max(0, deltaMs / 1000));
  river.tick(dt, currentAnimationTime);
  setWorldAnimationTime(currentAnimationTime);

  const cpuStart = performance.now();
  resetRendererFrameInfo();
  renderer.render(scene, camera);
  const cpuEnd = performance.now();
  if (rendererBackend === 'webgpu' && !gpuPending) {
    gpuPending = true;
    (renderer as unknown as { resolveTimestampsAsync(): Promise<number | undefined> }).resolveTimestampsAsync().then(value => {
      if (frameIndex > PERFORMANCE_WARMUP_FRAMES && typeof value === 'number' && value > 0) gpuMs.push(value);
    }).finally(() => { gpuPending = false; });
  }

  if (frameIndex >= PERFORMANCE_WARMUP_FRAMES && deltaMs > 0) {
    frameIntervalsMs.push(deltaMs);
    cpuSubmitMs.push(cpuEnd - cpuStart);
  }
  frameIndex += 1;
  if (frameIndex % 5 === 0) stageDataset.kupaRiverFrames = String(frameIndex);

  if (!evidencePublished && frameIntervalsMs.length >= PERFORMANCE_SAMPLE_FRAMES) {
    evidencePublished = true;
    publishEvidence();
  }
};
animationFrameId = requestAnimationFrame(renderFrame);
stageDataset.kupaRiverStage = 'sampling';

window.__KUPA_RIVER_LINEUP_CAPTURE__ = async (request = {}) => {
  activeView = request.view ?? activeView;
  activeDebugMode = request.debugMode ?? activeDebugMode;
  const captureTime = Number.isFinite(request.animationTimeSeconds)
    ? Math.max(0, request.animationTimeSeconds!)
    : fixedAnimationTimeSeconds;
  currentAnimationTime = captureTime;
  applyCamera(activeView);
  setSharedRiverWaterDebugMode(activeDebugMode);
  setWorldAnimationTime(captureTime);
  resetRendererFrameInfo();
  renderer.render(scene, camera);
  for (let i = 0; i < 30; i++) await twoAnimationFrames();
  const evidence = buildEvidence(captureTime);
  window.__KUPA_RIVER_LINEUP_EVIDENCE__ = evidence;
  document.documentElement.dataset.kupaRiverEvidence = JSON.stringify(evidence);
  return evidence;
};

window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(animationFrameId);
  river.dispose();
  terrainGeometry.dispose();
  terrainMaterial.dispose();
  bankMaterial.dispose();
  renderer.dispose();
});

function publishEvidence(): void {
  const evidence = buildEvidence(fixedAnimationTimeSeconds);
  window.__KUPA_RIVER_LINEUP_EVIDENCE__ = evidence;
  window.__KUPA_RIVER_LINEUP_READY__ = true;
  document.documentElement.dataset.kupaRiverReady = 'true';
  document.documentElement.dataset.kupaRiverEvidence = JSON.stringify(evidence);
  document.documentElement.dataset.kupaRiverStage = 'ready';
}

function buildEvidence(animationTimeSeconds: number): RiverLineupEvidence {
  const performanceEvidence = collectPerformanceEvidence();
  const rendererInfo = renderer.info as unknown as {
    render: {
      calls?: number;
      drawCalls?: number;
      frameCalls?: number;
      triangles?: number;
    };
    memory: {
      geometries?: number;
      textures?: number;
      renderTargets?: number;
    };
  };
  return {
    ready: true,
    view: activeView,
    debugMode: activeDebugMode,
    fixedAnimationTimeSeconds: animationTimeSeconds,
    deterministicInput: `kupa-layout-${LAYOUT_SEED.toString(16)}-field-${FIELD_RESOLUTION}`,
    noPost: true,
    bankOverlay: {
      transparent: bankMaterial.transparent,
      premultipliedAlpha: bankMaterial.premultipliedAlpha,
      depthWrite: bankMaterial.depthWrite,
      polygonOffsetFactor: bankMaterial.polygonOffsetFactor,
      polygonOffsetUnits: bankMaterial.polygonOffsetUnits,
      opacityContract: String(bankMaterial.userData.fixtureOpacityContract ?? 'missing'),
      surface: String(bankMaterial.userData.riverBankSurface ?? 'missing'),
    },
    crossSection: crossSectionEvidence,
    channel: {
      rockCount: channelRocks.length,
      stationCount: stationEvidence.stationCount,
      mixedSideStationCount: stationEvidence.mixedSideStationCount,
      foamSourcePixels: shoreMapEvidence.foamSourcePixels,
      peakFoamSource: shoreMapEvidence.peakFoamSource,
      packedSurfaceMapBytes: shoreMapEvidence.packedSurfaceMapBytes,
      cattailInstances: habitatEvidence.total,
      cattailSubmergedInstances: habitatEvidence.submerged,
      qualityTier: waterEvidence.qualityTier,
      packedSurfaceTextureLookups: 1,
      travellingFoam: true,
    },
    renderer: {
      backend: rendererBackend,
      drawCalls: rendererInfo.render.drawCalls ?? rendererInfo.render.calls ?? 0,
      renderPasses: rendererInfo.render.frameCalls ?? 0,
      triangles: rendererInfo.render.triangles ?? 0,
      geometries: rendererInfo.memory.geometries ?? 0,
      textures: rendererInfo.memory.textures ?? 0,
      renderTargets: rendererInfo.memory.renderTargets ?? 0,
      pixelRatio: renderer.getPixelRatio(),
    },
    performance: performanceEvidence,
    camera: {
      position: camera.position.toArray(),
      target: activeTarget.toArray(),
      fov: camera.fov,
    },
  };
}

function createTerrainGeometry(): THREE.BufferGeometry {
  const spanX = BOUNDS.maxX - BOUNDS.minX;
  const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
  const geometry = new THREE.PlaneGeometry(
    spanX,
    spanZ,
    TERRAIN_SEGMENTS_X,
    TERRAIN_SEGMENTS_Z,
  );
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const meadow = new THREE.Color(0x536b3b);
  const wetMoss = new THREE.Color(0x536347);
  const riverBed = new THREE.Color(0x676c61);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const mask = layout.sampleRiverMask(x, z);
    positions.setY(index, terrainHeightAt(x, z));
    const mineralNoise = stableNoise(x, z);
    if (mask >= 0.48) {
      color.copy(riverBed).lerp(wetMoss, 0.22 + mineralNoise * 0.18);
    } else {
      // Production TerrainGrassMaterial deliberately applies no shore-color
      // tint beneath the dedicated bank mesh. Keep this undercoat grassy even
      // on the carved dry slope so the carbonate overlay's analytic alpha is
      // what owns the visible waterline-to-meadow handoff.
      color.copy(meadow).offsetHSL((mineralNoise - 0.5) * 0.018, 0, (mineralNoise - 0.5) * 0.08);
    }
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function terrainHeightAt(x: number, z: number): number {
  // Match production's zero-based monotone Kupa datum. Water now owns the
  // explicit `hydraulicBankDatum - bankDrop` surface, so retaining the old
  // +4.65 fixture pedestal would visually fake roughly eight metres of bank.
  const regionalGrade = z * KUPA_HYDRAULIC_GRADE;
  const outsideUndulation = (
    Math.sin(z * 0.055 + 0.8) * 0.12
    + Math.sin(z * 0.021 - 1.7) * 0.08
  );
  const naturalDryDatum = regionalGrade + outsideUndulation;
  const channel = layout.sampleChannel(x, z);
  if (!channel) return naturalDryDatum;
  const hydraulicBankDatum = layout.getHydraulicBankDatum(x, z) ?? naturalDryDatum;
  const radius = channel.distance / Math.max(1e-6, channel.halfWidth);
  const hydraulicBlend = 1 - THREE.MathUtils.smoothstep(radius, 0.7, 0.94);
  const supportedDryDatum = THREE.MathUtils.lerp(
    naturalDryDatum,
    hydraulicBankDatum,
    hydraulicBlend,
  );
  return supportedDryDatum - layout.getValleyDepression(x, z);
}

function stableNoise(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233 + 3.17) * 43758.5453;
  return value - Math.floor(value);
}

function addLighting(): void {
  scene.add(new THREE.HemisphereLight(0xe8f0dc, 0x38453b, 2.35));
  const sun = new THREE.DirectionalLight(0xffe2ad, 4.4);
  sun.position.set(-46, 62, 36);
  sun.castShadow = false;
  scene.add(sun, sun.target);
}

function applyCamera(view: RiverLineupView): void {
  const center = new THREE.Vector3(heroRock.x, 0, heroRock.z);
  const bankY = terrainHeightAt(
    crossSectionPoint.x + crossSectionPoint.normalX * crossSectionPoint.halfWidth * 0.76,
    crossSectionPoint.z + crossSectionPoint.normalZ * crossSectionPoint.halfWidth * 0.76,
  );
  const waterY = getStillWaterSurfaceY(terrain, riverField, heroRock.x, heroRock.z);
  const presets: Record<RiverLineupView, {
    position: THREE.Vector3;
    target: THREE.Vector3;
    fov: number;
  }> = {
    near: {
      position: center.clone()
        .add(new THREE.Vector3(crossSectionPoint.normalX * 34, bankY + 4.5, crossSectionPoint.normalZ * 34))
        .add(new THREE.Vector3(-heroRock.flowX * 10, 0, -heroRock.flowZ * 10)),
      target: center.clone().setY(waterY + 0.32)
        .add(new THREE.Vector3(heroRock.flowX * 4.5, 0, heroRock.flowZ * 4.5)),
      fov: 42,
    },
    design: {
      position: center.clone()
        .add(new THREE.Vector3(crossSectionPoint.normalX * 55, bankY + 16, crossSectionPoint.normalZ * 55))
        .add(new THREE.Vector3(-heroRock.flowX * 26, 0, -heroRock.flowZ * 26)),
      target: center.clone().setY(waterY + 0.55)
        .add(new THREE.Vector3(heroRock.flowX * 7, 0, heroRock.flowZ * 7)),
      fov: 45,
    },
    far: {
      position: center.clone()
        .add(new THREE.Vector3(crossSectionPoint.normalX * 76, bankY + 37, crossSectionPoint.normalZ * 76))
        .add(new THREE.Vector3(-heroRock.flowX * 48, 0, -heroRock.flowZ * 48)),
      target: center.clone().setY(waterY + 0.8)
        .add(new THREE.Vector3(heroRock.flowX * 4, 0, heroRock.flowZ * 4)),
      fov: 48,
    },
  };
  const preset = presets[view];
  camera.position.copy(preset.position);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(preset.target);
  camera.updateMatrixWorld(true);
  activeTarget = preset.target;
  river?.updateCameraState(
    camera.position,
    activeTarget,
    camera.position.distanceTo(activeTarget),
    view === 'near',
  );
}

function selectHeroRock(
  rocks: ReturnType<typeof createRiverChannelRockPlacements>,
): (typeof rocks)[number] {
  const central = rocks.filter((rock) => Math.abs(rock.z) < 34);
  const candidates = central.length > 0 ? central : rocks;
  const selected = candidates.reduce<(typeof rocks)[number] | null>(
    (best, rock) => !best || rock.scale > best.scale ? rock : best,
    null,
  );
  if (!selected) throw new Error('Kupa river visual contract produced no channel rocks.');
  return selected;
}

function nearestCorridorPoint(x: number, z: number): RiverPoint & {
  normalX: number;
  normalZ: number;
} {
  const points = layout.corridors[0]?.points ?? [];
  if (points.length < 2) throw new Error('Kupa river visual contract has no corridor.');
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.hypot(points[index].x - x, points[index].z - z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  const previous = points[Math.max(0, nearestIndex - 1)];
  const next = points[Math.min(points.length - 1, nearestIndex + 1)];
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const length = Math.max(1e-6, Math.hypot(dx, dz));
  return {
    ...points[nearestIndex],
    normalX: -dz / length,
    normalZ: dx / length,
  };
}

function collectCrossSectionEvidence(): RiverLineupEvidence['crossSection'] {
  const centerBedY = terrainHeightAt(crossSectionPoint.x, crossSectionPoint.z);
  const waterY = getStillWaterSurfaceY(
    terrain,
    riverField,
    crossSectionPoint.x,
    crossSectionPoint.z,
  );
  const bankX = crossSectionPoint.x + crossSectionPoint.normalX * crossSectionPoint.halfWidth * 0.76;
  const bankZ = crossSectionPoint.z + crossSectionPoint.normalZ * crossSectionPoint.halfWidth * 0.76;
  const bankY = terrainHeightAt(bankX, bankZ);
  return {
    adjacentBankToWaterDropMeters: bankY - waterY,
    centerWaterDepthMeters: waterY - centerBedY,
    requiredBankDropMeters: KUPA_BANK_TO_WATER_DROP_METERS,
    requiredWaterDepthMeters: KUPA_MIN_CHANNEL_WATER_DEPTH_METERS,
    waterClimbsBank: riverField.isRenderedWetAt(bankX, bankZ),
  };
}

function collectShoreMapEvidence(): {
  foamSourcePixels: number;
  peakFoamSource: number;
  packedSurfaceMapBytes: number;
} {
  const maps = createRiverWaterShoreMaps(riverField);
  const data = maps.shoreTexture.image.data as Uint8Array;
  let foamSourcePixels = 0;
  let peakFoamSource = 0;
  for (let offset = 1; offset < data.length; offset += 4) {
    if (data[offset] > 0) foamSourcePixels += 1;
    peakFoamSource = Math.max(peakFoamSource, data[offset]);
  }
  const result = {
    foamSourcePixels,
    peakFoamSource,
    packedSurfaceMapBytes: data.byteLength,
  };
  disposeRiverWaterShoreMaps(maps);
  return result;
}

function collectStationEvidence(): {
  stationCount: number;
  mixedSideStationCount: number;
} {
  const stations = new Map<string, Set<number>>();
  for (const rock of channelRocks) {
    const key = `${rock.corridor}:${rock.station}`;
    const sides = stations.get(key) ?? new Set<number>();
    sides.add(rock.side);
    stations.set(key, sides);
  }
  return {
    stationCount: stations.size,
    mixedSideStationCount: [...stations.values()].filter((sides) => sides.size > 1).length,
  };
}

function collectHabitatEvidence(): { total: number; submerged: number } {
  let total = 0;
  let submerged = 0;
  river.group.traverse((object) => {
    const habitat = object.userData.cattailHabitat as {
      total?: number;
      submerged?: number;
    } | undefined;
    if (!habitat) return;
    total += habitat.total ?? 0;
    submerged += habitat.submerged ?? 0;
  });
  return { total, submerged };
}

function collectWaterEvidence(): { qualityTier: string } {
  let qualityTier = 'unknown';
  river.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (typeof material.userData.waterQualityTier === 'string') {
        qualityTier = material.userData.waterQualityTier;
      }
    }
  });
  return { qualityTier };
}

function collectPerformanceEvidence(): RiverLineupPerformance {
  const intervals = frameIntervalsMs.slice(-PERFORMANCE_SAMPLE_FRAMES);
  const submissions = cpuSubmitMs.slice(-PERFORMANCE_SAMPLE_FRAMES);
  const medianFrameMs = percentile(intervals, 0.5);
  const slowCount = Math.max(1, Math.ceil(intervals.length * 0.01));
  const slowest = [...intervals].sort((a, b) => b - a).slice(0, slowCount);
  const onePercentFrameMs = slowest.reduce((sum, value) => sum + value, 0) / slowest.length;
  return {
    medianGpuMs: gpuMs.length ? percentile(gpuMs.slice(-PERFORMANCE_SAMPLE_FRAMES),0.5) : null,
    sampleCount: intervals.length,
    medianFps: medianFrameMs > 0 ? 1000 / medianFrameMs : 0,
    onePercentLowFps: onePercentFrameMs > 0 ? 1000 / onePercentFrameMs : 0,
    p95FrameMs: percentile(intervals, 0.95),
    p95CpuSubmitMs: percentile(submissions, 0.95),
    framesOver25Ms: intervals.filter((value) => value > 25).length,
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index] ?? 0;
}

function resetRendererFrameInfo(): void {
  (renderer.info as unknown as { reset?: () => void }).reset?.();
}

function normalizeView(value: string | null): RiverLineupView {
  return value === 'near' || value === 'far' ? value : 'design';
}

function normalizeDebugMode(value: string | null): RiverWaterDebugMode {
  return value === 'normal'
    || value === 'fresnel'
    || value === 'surface-response'
    || value === 'flow-presence'
    || value === 'foam-field'
    ? value
    : 'final';
}

function twoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
