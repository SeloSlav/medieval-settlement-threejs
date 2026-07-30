import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import {
  initializeBuildingMaterialLibrary,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { resolveCloseGroundLod } from '../grass/grassLodMath.ts';
import {
  createGrassBladeField,
  type GrassBladeField,
  type GrassStreamTelemetry,
} from '../grass/GrassBladeField.ts';
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
import { updateTerrainRoadWear } from '../terrain/TerrainRoadWear.ts';
import { mulberry32 } from '../utils/random.ts';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import {
  createSeedThreeForest,
  getSeedThreeForestStructuralStats,
  setSeedThreeForestShadows,
  updateSeedThreeForestCamera,
  updateSeedThreeForestCameraBudgeted,
  type SeedThreeForestInstances,
} from '../vegetation/seedthree/seedThreeForestBuilder.ts';
import {
  executeVisualProfileRenderPath,
  installVisualPerformanceHooksIfRequested,
  type VisualPerformanceHooks,
  type VisualSlowFrameContext,
} from './visualPerformanceHooks.ts';
import {
  createUnavailableVisualGpuTimestampProfiler,
  createVisualGpuTimestampProfiler,
  VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
  type VisualGpuTimestampProfiler,
} from './webGpuTimestampProfiler.ts';
import {
  batchStaticFixtureMeshes,
  countFixtureStructuralSubmissions,
  type StaticFixtureBatchStats,
} from './staticFixtureBatch.ts';
import {
  advanceHamletFixtureRouteWarmupDrain,
  canFinalizeHamletFixtureEvidence,
  canFinalizeHamletNoUpdateShellEvidence,
  createHamletBareRafCapture,
  createHamletFixtureEvidenceEnvelope,
  createHamletNoUpdateShellCapture,
  HAMLET_FOREST_ROUTE_WORK_BUDGET,
  resolveHamletBareRafPairRequest,
  resolveHamletDeferredDomRequest,
  resolveHamletForestUpdateAblationTelemetry,
  resolveHamletFixtureAblation,
  resolveHamletNoUpdateShellRequest,
  resolveHamletPerformanceProtocol,
  type HamletBareRafCaptureEvidence,
  type HamletDegradedNoRenderArmEvidence,
  type HamletFixtureAblation,
  type HamletFixtureEvidenceEnvelope,
  type HamletNoUpdateShellCaptureEvidence,
  type HamletNoUpdateShellEvidence,
  type HamletPairedRafControlEvidence,
  type HamletPerformancePairIdentity,
  type HamletFixtureRouteWarmupEvidence,
  type HamletForestRouteWorkTelemetry,
  type HamletFixturePerformanceProtocol,
} from './hamletFixturePerformance.ts';
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
  resolveHamletBuildingLodBand,
  resolveHamletFullVisualSystemsReady,
  sampleHamletMotionRoute,
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
  staticBatching: {
    roads: StaticFixtureBatchStats;
    settlement: StaticFixtureBatchStats;
    fields: StaticFixtureBatchStats;
  };
  motion: HamletFixtureMotionState;
};

type HamletFixtureSystems = {
  included: readonly string[];
  omitted: readonly string[];
  degraded: readonly string[];
};

type HamletFixtureBootStageState = {
  status: 'pending' | 'running' | 'ready' | 'timed-out' | 'failed';
  elapsedMs?: number;
  detail?: string;
};

type HamletFixtureBootState = {
  status: 'initializing' | 'ready' | 'ready-degraded' | 'failed';
  stage: string;
  elapsedMs: number;
  detailedTexturesReady: boolean;
  fullVisualSystemsReady: boolean;
  warnings: string[];
  errors: string[];
  stages: Record<string, HamletFixtureBootStageState>;
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
    __HAMLET_FIXTURE_BOOT_STATE__?: HamletFixtureBootState;
    __HAMLET_FIXTURE_FAILED__?: boolean;
    __HAMLET_FIXTURE_ERROR__?: string | null;
    __HAMLET_FIXTURE_DETAILED_TEXTURES_READY__?: boolean;
    __HAMLET_FIXTURE_FULL_VISUAL_SYSTEMS_READY__?: boolean;
    __HAMLET_FIXTURE_PERFORMANCE_PROTOCOL__?: HamletFixturePerformanceProtocol;
    __HAMLET_FIXTURE_ABLATION__?: HamletFixtureAblation;
    __HAMLET_FIXTURE_FOREST_WORK__?: HamletForestRouteWorkTelemetry;
    __HAMLET_FIXTURE_GROUNDCOVER_WORK__?: GrassStreamTelemetry;
    __HAMLET_FIXTURE_COMPLETED_ROUTES__?: number;
    __HAMLET_FIXTURE_ROUTE_WARMUP__?: HamletFixtureRouteWarmupEvidence;
    __HAMLET_FIXTURE_EVIDENCE__?: HamletFixtureEvidenceEnvelope;
    __HAMLET_FIXTURE_GET_EVIDENCE__?: () => HamletFixtureEvidenceEnvelope | null;
    __HAMLET_FIXTURE_WAIT_FOR_TERMINAL__?: Promise<HamletFixtureBootState>;
    __visualPerf?: VisualPerformanceHooks;
  }
}

const root = document.querySelector<HTMLElement>('#fixture-root');
const nav = document.querySelector<HTMLElement>('[data-view-nav]');
const metricsElement = document.querySelector<HTMLElement>('#metrics');
if (!root || !nav || !metricsElement) {
  throw new Error('Hamlet fixture host is incomplete.');
}

const bootStartedAtMs = performance.now();
const bootState: HamletFixtureBootState = {
  status: 'initializing',
  stage: 'host-ready',
  elapsedMs: 0,
  detailedTexturesReady: false,
  fullVisualSystemsReady: false,
  warnings: [],
  errors: [],
  stages: {},
};
let fixtureReady = false;
let detailedTexturesReady = false;
const textureReadiness = {
  building: false,
  road: false,
  skyPerlin: false,
  forest: false,
  groundcover: false,
};
let skyRuntimeReady = false;
let forestRuntimeReady = false;
let groundcoverRuntimeReady = false;
let forestLodPrimed = false;
let forestUpdatesFrozenForMeasurement = false;
let performanceProtocol: HamletFixturePerformanceProtocol | null = null;
let finalizedFixtureEvidence: HamletFixtureEvidenceEnvelope | null = null;
let lastForestRouteElapsedMs = 0;
const settledDwellSamples: Record<
  'strategic-settled' | 'road-eye-settled',
  { pendingBuckets: number; sampledAtMs: number } | null
> = {
  'strategic-settled': null,
  'road-eye-settled': null,
};
const forestRouteWork: HamletForestRouteWorkTelemetry = {
  mode: 'full',
  updateAblation: resolveHamletForestUpdateAblationTelemetry({
    requestedMode: 'active',
    warmupCompleted: false,
    pendingBuckets: 0,
  }),
  configuredMaxBucketCompactionsPerFrame:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.maxBucketCompactionsPerFrame,
  maxBucketCompactionsPerFrame: 0,
  maxUpdateDurationBudgetMs:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.maxUpdateDurationMs,
  minimumCameraMoveMeters:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCameraMoveMeters,
  minimumDirectionAngleDegrees:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumDirectionAngleDegrees,
  minimumProjectionChange:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumProjectionChange,
  minimumCasterBoundsChangeMeters:
    HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCasterBoundsChangeMeters,
  totalBucketCompactions: 0,
  totalBucketUploads: 0,
  totalWorkChunks: 0,
  totalMatrixWrites: 0,
  selectorEvaluations: 0,
  selectorSkips: 0,
  triggerReasons: {},
  selectionChanges: 0,
  pendingBuckets: 0,
  maxUpdateDurationMs: 0,
  phases: {
    strategic: createForestPhaseTelemetry(),
    settlement: createForestPhaseTelemetry(),
    'road-eye': createForestPhaseTelemetry(),
  },
  settledKeyframes: {
    'strategic-settled': createSettledKeyframeTelemetry(),
    'road-eye-settled': createSettledKeyframeTelemetry(),
  },
};

function isFullVisualSystemsReady(): boolean {
  return resolveHamletFullVisualSystemsReady({
    fixtureReady,
    detailedTexturesReady,
    skyRuntimeReady,
    forestRuntimeReady,
    groundcoverRuntimeReady,
  });
}

function refreshFullVisualReadiness(): void {
  const ready = isFullVisualSystemsReady();
  bootState.fullVisualSystemsReady = ready;
  window.__HAMLET_FIXTURE_FULL_VISUAL_SYSTEMS_READY__ = ready;
  document.body.dataset.fullVisualSystemsReady = String(ready);
  publishBootState();
}

let resolveBootTerminal!: (state: HamletFixtureBootState) => void;
const bootTerminal = new Promise<HamletFixtureBootState>((resolve) => {
  resolveBootTerminal = resolve;
});
let bootTerminalPublished = false;
window.__HAMLET_FIXTURE_READY__ = false;
window.__HAMLET_FIXTURE_FAILED__ = false;
window.__HAMLET_FIXTURE_ERROR__ = null;
window.__HAMLET_FIXTURE_DETAILED_TEXTURES_READY__ = false;
window.__HAMLET_FIXTURE_FULL_VISUAL_SYSTEMS_READY__ = false;
window.__HAMLET_FIXTURE_COMPLETED_ROUTES__ = 0;
window.__HAMLET_FIXTURE_WAIT_FOR_TERMINAL__ = bootTerminal;
window.__HAMLET_FIXTURE_SYSTEMS__ = {
  included: [],
  omitted: ['river', 'precipitation', 'weather', 'wildlife', 'people'],
  degraded: [],
};
window.__HAMLET_FIXTURE_BOOT_STATE__ = {
  ...bootState,
  warnings: [],
  errors: [],
  stages: {},
};
document.body.dataset.bootStatus = 'initializing';
document.body.dataset.bootStage = 'host-ready';
metricsElement.textContent = 'Boot: host-ready (0ms)';
const initialLoadingElement = document.querySelector<HTMLElement>('#loading');
if (initialLoadingElement) initialLoadingElement.textContent = 'Building fixture: host-ready…';
window.addEventListener('error', (event) => {
  failBoot(toErrorMessage(event.error ?? event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  failBoot(toErrorMessage(event.reason));
});

const params = new URLSearchParams(window.location.search);
const requestedMotionRouteId = params.get('route');
const requestedVisualProfile = params.get('visualProfile') === '1';
const requestedVisualNoRender =
  requestedVisualProfile && params.get('visualNoRender') === '1';
const visualGpuTimestampMarkersEnabled =
  params.get('visualGpuTimestampMarkers') !== '0';
const fixtureAblation = resolveHamletFixtureAblation(params.get('ablation'));
const requestedVisualDisabledSubsystems =
  (params.get('visualDisable') ?? '')
    .split(',')
    .map((subsystem) => subsystem.trim())
    .filter(Boolean);
const requestedVisualBareRafPair = resolveHamletBareRafPairRequest({
  requested: params.get('visualBareRafPair') === '1',
  visualProfile: requestedVisualProfile,
  visualNoRender: requestedVisualNoRender,
  routeId: requestedMotionRouteId,
  ablationId: fixtureAblation.id,
  disabledSubsystems: requestedVisualDisabledSubsystems,
});
const requestedVisualNoUpdateShell = resolveHamletNoUpdateShellRequest({
  requested: params.get('visualNoUpdateShell') === '1',
  visualProfile: requestedVisualProfile,
  visualNoRender: requestedVisualNoRender,
  visualBareRafPair: requestedVisualBareRafPair,
  routeId: requestedMotionRouteId,
  ablationId: fixtureAblation.id,
  disabledSubsystems: requestedVisualDisabledSubsystems,
});
const requestedVisualDeferredDom = resolveHamletDeferredDomRequest({
  requested: params.get('visualDeferDom') === '1',
  visualNoUpdateShell: requestedVisualNoUpdateShell,
});
if (fixtureAblation.id !== 'baseline' && !requestedVisualProfile) {
  throw new Error('Hamlet fixture ablations require visualProfile=1.');
}
if (
  requestedVisualNoRender
  && (
    requestedMotionRouteId !== HAMLET_MOTION_ROUTE_ID
    || fixtureAblation.id !== 'groundcover-stream-forest-update-frozen'
  )
) {
  throw new Error(
    'visualNoRender=1 requires the canonical Hamlet route and '
    + 'groundcover-stream-forest-update-frozen ablation.',
  );
}
applyAblationQuery(fixtureAblation);
forestRouteWork.mode = requestedVisualProfile
  ? fixtureAblation.forestSelection === 'budgeted'
    ? 'budgeted-time-chunk'
    : fixtureAblation.forestSelection
  : 'full';
forestRouteWork.updateAblation = resolveHamletForestUpdateAblationTelemetry({
  requestedMode: fixtureAblation.forestUpdates,
  warmupCompleted: false,
  pendingBuckets: forestRouteWork.pendingBuckets,
});
window.__HAMLET_FIXTURE_ABLATION__ = {
  ...fixtureAblation,
  disabledSubsystems: [...fixtureAblation.disabledSubsystems],
};
window.__HAMLET_FIXTURE_FOREST_WORK__ = snapshotForestRouteWork();
document.body.classList.toggle('clean', params.get('clean') === '1');
let activeViewId = isHamletViewId(params.get('view'))
  ? params.get('view') as HamletViewId
  : 'strategic';

setBootStage('renderer', 'running');
const rendererBackend = await createPreferredRenderer().then((backend) => {
  setBootStage('renderer', 'ready');
  return backend;
}).catch((error: unknown) => {
  setBootStage('renderer', 'failed', toErrorMessage(error));
  failBoot(`Renderer initialization failed: ${toErrorMessage(error)}`);
  throw error;
});
const renderer = rendererBackend.renderer;
const visualGpuTimestampProfiler: VisualGpuTimestampProfiler | null =
  requestedVisualProfile
    ? requestedVisualNoRender
      ? createUnavailableVisualGpuTimestampProfiler(
          VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
        )
      : createVisualGpuTimestampProfiler(rendererBackend, {
          submitTimestampMarkers: visualGpuTimestampMarkersEnabled,
        })
    : null;
renderer.setPixelRatio(requestedVisualProfile ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.toneMappingExposure = 0.9;
renderer.setClearColor(0x78929d, 1);
renderer.shadowMap.autoUpdate = false;
root.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 420);
const motionCameraTarget = new THREE.Vector3();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x78929d);
scene.fog = new THREE.Fog(0x879da3, 230, 400);

scene.add(new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 1.35));
scene.add(new THREE.AmbientLight(0xb8c8d2, 0.12));
const sun = new THREE.DirectionalLight(0xffe6b5, 3.15);
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
setBootStage('sky-perlin', 'running');
const skyPerlinPromise = loadSkyPerlinTexture();

let renderedFrameCount = 0;
let motionAnimationFrame: number | null = null;
let motionStartNowMs = 0;
let motionStartOffsetMs = 0;
let motionLoopEnabled = false;
let completedMotionRoutes = 0;
let lastMotionRouteCycle = 0;
let shadowMapNeedsRefresh = true;
let lastRenderWidth = 0;
let lastRenderHeight = 0;
let previousTickNowMs = 0;
let fixtureTimeSeconds = 0;
const performancePairIdentity: HamletPerformancePairIdentity | null =
  requestedVisualBareRafPair
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const bareRafCapture = performancePairIdentity
  ? createHamletBareRafCapture(performancePairIdentity)
  : null;
const noUpdateShellIdentity: HamletPerformancePairIdentity | null =
  requestedVisualNoUpdateShell
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const noUpdateShellCapture = noUpdateShellIdentity
  ? createHamletNoUpdateShellCapture(noUpdateShellIdentity, {
      deferCohortDomPublication: requestedVisualDeferredDom,
    })
  : null;
let noUpdateShellCaptureReport: HamletNoUpdateShellCaptureEvidence | null = null;
let deferredDomCohortActive = false;
let bareRafControlCollecting = false;
let degradedNoRenderEnvelope: HamletFixtureEvidenceEnvelope | null = null;
let degradedNoRenderArm: HamletDegradedNoRenderArmEvidence | null = null;
let latestProfileFrameTiming: {
  frameRafTimestampMs: number;
  frameCallbackEntryTimestampMs: number;
  frameCpuDurationMs: number;
  frameUpdatePreRenderDurationMs: number;
  frameRenderSubmissionDurationMs: number;
  framePostRenderDurationMs: number;
} | null = null;
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
let latestForestFrameWork: VisualSlowFrameContext['forest'] = {
  selectionChanged: false,
  selectorSkipped: true,
  workChunks: 0,
  matrixWrites: 0,
  bucketUploads: 0,
  pendingBuckets: 0,
};
let latestGroundcoverFrameDelta: VisualSlowFrameContext['groundcoverDelta'] = {
  generationSubsteps: 0,
  clearWriteSubsteps: 0,
  refreshes: 0,
  gpuFlagUpdates: 0,
  gpuUpdateRanges: 0,
  bytesUploaded: 0,
  completedSlots: 0,
  cancelledSlots: 0,
  pendingSlots: 0,
};
let previousGroundcoverWork: GrassStreamTelemetry | null = null;
const routeWarmupWork: HamletFixtureRouteWarmupEvidence =
  fixtureAblation.routeWarmup === 'full-route'
    ? {
        required: true,
        stage: 'waiting',
        completedRoutes: 0,
        completed: false,
        strategicPendingAtReset: null,
        collectorReset: false,
      }
    : {
        required: false,
        stage: 'not-required',
        completedRoutes: 0,
        completed: true,
        strategicPendingAtReset: null,
        collectorReset: false,
      };
publishRouteWarmupWork();

const roadMaterials = RoadMaterialFactory.createProgressive(rendererBackend.maxAnisotropy);
const roadTexturesReady = roadMaterials.whenTexturesReady();
void roadTexturesReady.catch(() => {});
setBootStage('road-textures', 'running');
const buildingTexturesReady = initializeBuildingMaterialLibrary(rendererBackend.maxAnisotropy);
void buildingTexturesReady.catch(() => {});
setBootStage('building-textures', 'running');
const skyPerlinResult = await waitForBootStage(
  'sky-perlin',
  skyPerlinPromise,
  1_500,
);
textureReadiness.skyPerlin = skyPerlinResult.ok;
refreshDetailedTextureReadiness();
const skyPerlinTexture = skyPerlinResult.ok
  ? skyPerlinResult.value
  : createFallbackPerlinTexture();
setBootStage('sky-runtime', 'running');
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
  perlinTexture: skyPerlinTexture,
  constellationVisibility: 0,
});
const skyRuntimeResult = await waitForBootStage('sky-runtime', sky.ready, 1_500);
skyRuntimeReady = skyRuntimeResult.ok;
sky.visible = skyRuntimeReady;
refreshFullVisualReadiness();
scene.add(sky);

const terrainGeometry = createHamletTerrainGeometry();
const terrain = new THREE.Mesh(terrainGeometry, roadMaterials.terrain);
terrain.name = 'AD 1550 hamlet relief terrain';
terrain.receiveShadow = true;
scene.add(terrain);

const terrainAdapter = createHamletTerrainAdapter(terrainGeometry);
const roadNetwork = createHamletRoadNetwork();
updateTerrainRoadWear(terrainAdapter, roadNetwork);
const roadRoot = new THREE.Group();
roadRoot.name = 'Deterministic Y-road';
const roadMeshBuilder = new RoadMeshBuilder(terrainAdapter, roadMaterials);
for (const edge of roadNetwork.edges.values()) {
  roadRoot.add(roadMeshBuilder.buildEdge(edge, roadNetwork));
}
roadRoot.add(new RoadJunctionBuilder(terrainAdapter, roadMaterials).build(roadNetwork));
const roadBatch = batchStaticFixtureMeshes(
  roadRoot,
  'Static-batched Y-road fabric',
);
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
const settlementBatch = batchStaticFixtureMeshes(
  settlementRoot,
  'Static-batched hamlet fabric',
);

const fieldRoot = new THREE.Group();
fieldRoot.name = 'Cultivated parish parcels';
scene.add(fieldRoot);
const farmFields = new FarmFieldMarkers(fieldRoot, hamletHeightAt);
farmFields.syncFields(createHamletFields());
const fieldBatch = batchStaticFixtureMeshes(
  fieldRoot,
  'Static-batched cultivated parcels',
);

const forestPlacements = createHamletForestPlacements();
setBootStage('groundcover', 'running');
const grassFieldPromise = createGrassBladeField(terrainAdapter, {
  maxAnisotropy: rendererBackend.maxAnisotropy,
  rendererBackend: rendererBackend.kind,
});
setBootStage('forest', 'running');
const forestPromise = createSeedThreeForest(
    forestPlacements,
    terrainAdapter,
    rendererBackend.maxAnisotropy,
    HAMLET_FIXTURE_SEED,
    renderer as WebGPURenderer,
  );
const [forestResult, grassFieldResult] = await Promise.all([
  waitForBootStage('forest', forestPromise, 9_000),
  waitForBootStage('groundcover', grassFieldPromise, 9_000),
]);
const forest: SeedThreeForestInstances = forestResult.ok
  ? forestResult.value
  : createEmptyForest();
forestRuntimeReady = forestResult.ok;
textureReadiness.forest = forestResult.ok;
setSeedThreeForestShadows(forest, true);
scene.add(forest.group);
const grassField: GrassBladeField = grassFieldResult.ok
  ? grassFieldResult.value
  : createEmptyGrassField();
groundcoverRuntimeReady = grassFieldResult.ok;
textureReadiness.groundcover = grassFieldResult.ok;
refreshFullVisualReadiness();
grassField.syncRoadClearance(roadNetwork);
grassField.syncPlacementClearance(collectOccupiedParcelPolygons(zones, residences));
if (fixtureAblation.groundcoverStreaming === 'frozen') {
  const primeKeyframe = HAMLET_MOTION_ROUTE.keyframes.find(
    (keyframe) => keyframe.id === 'road-eye-settled',
  )!;
  grassField.primeAndFreezeStream(
    new THREE.Vector3(...primeKeyframe.position),
    new THREE.Vector3(...primeKeyframe.target),
    primeKeyframe.distanceMeters,
    true,
  );
}
previousGroundcoverWork = grassField.getStreamTelemetry();
window.__HAMLET_FIXTURE_GROUNDCOVER_WORK__ = previousGroundcoverWork;
scene.add(grassField.group);

const [roadTexturesResult, buildingTexturesResult] = await Promise.all([
  waitForBootStage('road-textures', roadTexturesReady, 750),
  waitForBootStage('building-textures', buildingTexturesReady, 750),
]);
textureReadiness.road = roadTexturesResult.ok;
textureReadiness.building = buildingTexturesResult.ok;
refreshDetailedTextureReadiness();
setBootStage('post-processing', 'running');
const postProcessor = createPostProcessor(rendererBackend, scene, camera);
postProcessor.setPixelRatio(renderer.getPixelRatio());
setBootStage('post-processing', 'ready');
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
setBootStage('stable-frame', 'running');
await waitForBootStage('stable-frame', waitForAnimationFrame(), 750);
render();
performanceProtocol = capturePerformanceProtocol();
window.__HAMLET_FIXTURE_PERFORMANCE_PROTOCOL__ = performanceProtocol;
document.body.dataset.performanceProtocolValid = String(performanceProtocol.valid);
if (requestedVisualProfile && !performanceProtocol.valid) {
  const message = [
    'Visual performance protocol requires 1280x720 CSS/drawing-buffer pixels',
    'and rendererPixelRatio=1',
    `(got ${performanceProtocol.cssViewport.width}x${performanceProtocol.cssViewport.height}`,
    `CSS, ${performanceProtocol.drawingBuffer.width}x${performanceProtocol.drawingBuffer.height}`,
    `buffer, PR ${performanceProtocol.rendererPixelRatio}).`,
  ].join(' ');
  failBoot(message);
  throw new Error(message);
}

fixtureReady = true;
window.__HAMLET_FIXTURE_READY__ = true;
refreshFullVisualReadiness();
window.__HAMLET_FIXTURE_SET_VIEW__ = (view) => applyView(view, true);
installMotionContract();
document.body.dataset.ready = 'true';
document.body.dataset.fixture = HAMLET_FIXTURE_ID;
document.body.dataset.rendererBackend = rendererBackend.kind;
document.body.dataset.rendererPixelRatio = renderer.getPixelRatio().toFixed(2);
document.body.dataset.performanceViewport = requestedVisualProfile
  ? '1280x720@renderer-pr1'
  : 'not-requested';
document.body.dataset.ablation = fixtureAblation.id;
document.body.dataset.ablationDisabledSubsystems =
  fixtureAblation.disabledSubsystems.join(',') || 'none';
document.body.dataset.forestWorkMode = forestRouteWork.mode;
document.body.dataset.forestUpdateAblation =
  forestRouteWork.updateAblation.requestedMode;
document.body.dataset.forestUpdateAblationState =
  forestRouteWork.updateAblation.state;
document.body.dataset.forestUpdateConvergedAtFreeze = String(
  forestRouteWork.updateAblation.convergedAtFreeze,
);
document.body.dataset.forestMaxBucketCompactionsPerFrame = String(
  forestRouteWork.configuredMaxBucketCompactionsPerFrame,
);
document.body.dataset.forestMaxUpdateDurationMs = String(
  forestRouteWork.maxUpdateDurationBudgetMs,
);
document.body.dataset.groundcoverStreamMode =
  grassField.getStreamTelemetry().mode;
document.body.dataset.motionReady = String(window.__HAMLET_FIXTURE_MOTION_READY__);
document.body.dataset.omittedSystems = 'river,precipitation,weather,wildlife,people';
const degradedSystems = [
  ...(!skyRuntimeReady ? ['volumetric-sky'] : []),
  ...(!forestRuntimeReady ? ['forest'] : []),
  ...(!groundcoverRuntimeReady ? ['groundcover'] : []),
  ...(!detailedTexturesReady ? ['detailed-textures'] : []),
];
const disabledSubsystems = new Set(fixtureAblation.disabledSubsystems);
window.__HAMLET_FIXTURE_SYSTEMS__ = {
  included: [
    ...(!disabledSubsystems.has('post') ? ['post-processing'] : []),
    ...(skyRuntimeReady ? ['volumetric-sky'] : []),
    ...(groundcoverRuntimeReady && !disabledSubsystems.has('groundcover')
      ? ['groundcover']
      : []),
    ...(forestRuntimeReady && !disabledSubsystems.has('forest') ? ['forest'] : []),
    ...(!disabledSubsystems.has('shadows') ? ['static-shadows'] : []),
    'terrain',
    'roads',
    'buildings',
    'fields',
  ],
  omitted: ['river', 'precipitation', 'weather', 'wildlife', 'people'],
  degraded: degradedSystems,
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
    getVisualGpuFrameTiming: (frameTimestampMs: number) => (
      visualGpuTimestampProfiler?.getFrameTiming(frameTimestampMs) ?? {
        frameRafTimestampMs: frameTimestampMs,
        queryId: null,
        status: 'unavailable',
        durationMs: null,
        limitation: 'GPU timestamp instrumentation was not requested.',
      }
    ),
    getVisualGpuTimingEvidence: () => (
      visualGpuTimestampProfiler?.getEvidence() ?? {
        requested: true,
        status: 'unavailable',
        source: 'unavailable',
        feature: 'timestamp-query',
        api: 'unavailable',
        span: 'unavailable',
        unit: 'milliseconds',
        slotCount: 0,
        attemptedFrames: 0,
        submittedFrames: 0,
        resolvedFrames: 0,
        pendingFrames: 0,
        droppedFrames: 0,
        failedFrames: 0,
        limitations: ['GPU timestamp instrumentation was not requested.'],
      }
    ),
    getSlowFrameContext: (frameTimestampMs: number) => {
      const timing = latestProfileFrameTiming;
      if (
        timing?.frameRafTimestampMs !== frameTimestampMs
        || visualGpuTimestampProfiler === null
      ) {
        return null;
      }
      return {
        frameRafTimestampMs: timing.frameRafTimestampMs,
        frameCallbackEntryTimestampMs:
          timing.frameCallbackEntryTimestampMs,
        frameCpuDurationMs: timing.frameCpuDurationMs,
        frameUpdatePreRenderDurationMs:
          timing.frameUpdatePreRenderDurationMs,
        frameRenderSubmissionDurationMs:
          timing.frameRenderSubmissionDurationMs,
        framePostRenderDurationMs: timing.framePostRenderDurationMs,
        frameGpuTiming:
          visualGpuTimestampProfiler.getFrameTiming(frameTimestampMs),
        routeElapsedMs: motionState.elapsedMs,
        routeCycle: lastMotionRouteCycle,
        phase: motionState.lod.building,
        forest: { ...latestForestFrameWork },
        groundcoverDelta: { ...latestGroundcoverFrameDelta },
      };
    },
    getPerformanceStats: () => {
      const structural = countFixtureStructuralSubmissions(scene);
      return {
        backend: rendererBackend.kind,
        frames: renderedFrameCount,
        calls: structural.draws,
        triangles: structural.triangles,
        pixelRatio: renderer.getPixelRatio(),
      };
    },
  },
});
window.__visualPerf?.setEnabled('river', false);
window.__visualPerf?.setEnabled('riverSimulation', false);
window.__visualPerf?.setEnabled('riverRender', false);
window.__visualPerf?.setEnabled('precipitation', false);
window.__visualPerf?.setEnabled('selection', false);
window.__visualPerf?.setEnabled('preview', false);
if (!skyRuntimeReady) window.__visualPerf?.setEnabled('sky', false);
if (!forestRuntimeReady) window.__visualPerf?.setEnabled('forest', false);
if (!groundcoverRuntimeReady) window.__visualPerf?.setEnabled('groundcover', false);
window.__HAMLET_FIXTURE_GET_EVIDENCE__ = () => publishFixtureEvidence();
publishFixtureEvidence();
startContinuousTick();
if (requestedMotionRouteId === HAMLET_MOTION_ROUTE_ID) {
  startRequestedMotionRoute();
}
window.addEventListener('resize', () => render(0));
window.addEventListener('keydown', handleViewKey);
completeBoot(degradedSystems.length > 0 ? 'ready-degraded' : 'ready');

type BootStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; timedOut: boolean };

async function waitForBootStage<T>(
  name: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<BootStageResult<T>> {
  const startedAt = performance.now();
  setBootStage(name, 'running');
  let timeoutHandle = 0;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = window.setTimeout(() => {
          const timeout = new Error(`${name} timed out after ${timeoutMs}ms`);
          timeout.name = 'FixtureBootTimeout';
          reject(timeout);
        }, timeoutMs);
      }),
    ]);
    window.clearTimeout(timeoutHandle);
    setBootStage(name, 'ready', undefined, performance.now() - startedAt);
    return { ok: true, value };
  } catch (error) {
    window.clearTimeout(timeoutHandle);
    const message = toErrorMessage(error);
    const timedOut = error instanceof Error && error.name === 'FixtureBootTimeout';
    setBootStage(
      name,
      timedOut ? 'timed-out' : 'failed',
      message,
      performance.now() - startedAt,
    );
    bootState.warnings.push(message);
    publishBootState();
    return { ok: false, error: message, timedOut };
  }
}

function setBootStage(
  name: string,
  status: HamletFixtureBootStageState['status'],
  detail?: string,
  elapsedMs?: number,
): void {
  bootState.stage = name;
  bootState.stages[name] = {
    status,
    ...(elapsedMs === undefined ? {} : { elapsedMs: Math.round(elapsedMs) }),
    ...(detail === undefined ? {} : { detail }),
  };
  publishBootState();
}

function refreshDetailedTextureReadiness(): void {
  detailedTexturesReady = Object.values(textureReadiness).every(Boolean);
  bootState.detailedTexturesReady = detailedTexturesReady;
  window.__HAMLET_FIXTURE_DETAILED_TEXTURES_READY__ = detailedTexturesReady;
  document.body.dataset.detailedTexturesReady = String(detailedTexturesReady);
  refreshFullVisualReadiness();
}

function completeBoot(status: 'ready' | 'ready-degraded'): void {
  bootState.status = status;
  bootState.stage = 'complete';
  bootState.elapsedMs = Math.round(performance.now() - bootStartedAtMs);
  window.__HAMLET_FIXTURE_FAILED__ = false;
  window.__HAMLET_FIXTURE_ERROR__ = null;
  document.body.dataset.bootStatus = status;
  publishBootState();
  if (!bootTerminalPublished) {
    bootTerminalPublished = true;
    resolveBootTerminal(snapshotBootState());
  }
}

function failBoot(message: string): void {
  if (bootState.status === 'failed') return;
  bootState.status = 'failed';
  bootState.stage = 'failed';
  bootState.elapsedMs = Math.round(performance.now() - bootStartedAtMs);
  bootState.errors.push(message);
  fixtureReady = false;
  window.__HAMLET_FIXTURE_READY__ = false;
  window.__HAMLET_FIXTURE_FAILED__ = true;
  window.__HAMLET_FIXTURE_ERROR__ = message;
  document.body.dataset.ready = 'false';
  document.body.dataset.failed = 'true';
  document.body.dataset.bootStatus = 'failed';
  const loadingElement = document.querySelector<HTMLElement>('#loading');
  if (loadingElement) loadingElement.textContent = `Fixture failed: ${message}`;
  publishBootState();
  if (!bootTerminalPublished) {
    bootTerminalPublished = true;
    resolveBootTerminal(snapshotBootState());
  }
}

function publishBootState(): void {
  bootState.elapsedMs = Math.round(performance.now() - bootStartedAtMs);
  window.__HAMLET_FIXTURE_BOOT_STATE__ = snapshotBootState();
  document.body.dataset.bootStatus = bootState.status;
  document.body.dataset.bootStage = bootState.stage;
  if (bootState.status === 'initializing') {
    metricsElement!.textContent = `Boot: ${bootState.stage} (${bootState.elapsedMs}ms)`;
    const loadingElement = document.querySelector<HTMLElement>('#loading');
    if (loadingElement) loadingElement.textContent = `Building fixture: ${bootState.stage}…`;
  }
}

function snapshotBootState(): HamletFixtureBootState {
  return {
    ...bootState,
    warnings: [...bootState.warnings],
    errors: [...bootState.errors],
    stages: Object.fromEntries(
      Object.entries(bootState.stages).map(([name, state]) => [name, { ...state }]),
    ),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function capturePerformanceProtocol(): HamletFixturePerformanceProtocol {
  return resolveHamletPerformanceProtocol({
    requested: requestedVisualProfile,
    cssWidth: root!.clientWidth,
    cssHeight: root!.clientHeight,
    drawingBufferWidth: renderer.domElement.width,
    drawingBufferHeight: renderer.domElement.height,
    rendererPixelRatio: renderer.getPixelRatio(),
  });
}

function createFallbackPerlinTexture(): THREE.DataTexture {
  const data = new Uint8Array([
    96, 128, 160, 192,
    160, 112, 176, 128,
    128, 176, 112, 160,
    192, 144, 96, 176,
  ]);
  const texture = new THREE.DataTexture(data, 4, 4, THREE.RedFormat);
  texture.name = 'Bounded fixture fallback sky noise';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createEmptyForest(): SeedThreeForestInstances {
  const group = new THREE.Group();
  group.name = 'Forest unavailable after bounded fixture boot';
  group.visible = false;
  return {
    group,
    placements: [],
    buckets: [],
    slotByLayoutIndex: [],
    hiddenMatrix: new THREE.Matrix4().makeScale(0, 0, 0),
    visibilitySelector: null,
    seasonalCardMaterials: [],
    deciduousFoliage: { autumnProgress: 0, leafDropProgress: 0 },
    renderStats: {
      totalTrees: 0,
      visibleTrees: 0,
      nearTrees: 0,
      overviewTrees: 0,
      culledTrees: 0,
      revision: 0,
    },
  } as unknown as SeedThreeForestInstances;
}

function createEmptyGrassField(): GrassBladeField {
  const group = new THREE.Group();
  group.name = 'Groundcover unavailable after bounded fixture boot';
  group.visible = false;
  return {
    group,
    getStreamTelemetry() {
      return {
        mode: 'frozen',
        maxUpdateDurationBudgetMs: 2,
        updates: 0,
        generationSubsteps: 0,
        generationDurationMs: 0,
        clearWriteSubsteps: 0,
        clearWriteDurationMs: 0,
        refreshCount: 0,
        refreshDurationMs: 0,
        gpuFlagUpdates: 0,
        gpuUpdateRanges: 0,
        bytesUploaded: 0,
        boundsScans: 0,
        completedSlots: 0,
        cancelledSlots: 0,
        pendingSlots: 0,
        maxPendingSlots: 0,
        lastUpdateDurationMs: 0,
        maxUpdateDurationMs: 0,
        converged: true,
      };
    },
    isStreamSettled() {
      return true;
    },
    primeAndFreezeStream() {},
    syncRoadClearance() {},
    syncPlacementClearance() {},
    setBuildInteractionActive() {},
    setRoadDraftActive() {},
    updateCameraState() {},
    dispose() {},
  };
}

function hamletHeightAt(x: number, z: number): number {
  const rollingGround = Math.sin(x * 0.043) * 0.78
    + Math.cos(z * 0.038) * 0.58
    + Math.sin((x + z) * 0.026) * 0.42;
  const northRise = THREE.MathUtils.smoothstep(z, 28, 80) * 7.2;
  const edgeRise = THREE.MathUtils.smoothstep(Math.abs(x), 48, 90) * 5.8;
  const valleyTilt = z * 0.018;
  const outerDistance = Math.hypot(x * 0.82, z);
  const outerRelief = THREE.MathUtils.smoothstep(outerDistance, 92, 270)
    * (
      7.5
      + Math.sin(x * 0.018 + z * 0.011) * 2.6
      + Math.cos(z * 0.021 - x * 0.008) * 1.8
    );
  return rollingGround + northRise + edgeRise + valleyTilt + outerRelief;
}

function createHamletTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(600, 520, 240, 208);
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const dirtZoomGates = new Float32Array(positions.count);
  const shoreBlends = new Float32Array(positions.count);
  const roadWearBlends = new Float32Array(positions.count);
  const quarryPadBlends = new Float32Array(positions.count);

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
  geometry.setAttribute('shoreBlend', new THREE.BufferAttribute(shoreBlends, 1));
  geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(roadWearBlends, 1));
  geometry.setAttribute('quarryPadBlend', new THREE.BufferAttribute(quarryPadBlends, 1));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(dirtZoomGates, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createHamletTerrainAdapter(geometry: THREE.BufferGeometry): Terrain {
  const dirtZoomGate = geometry.getAttribute('dirtZoomGate') as THREE.BufferAttribute;
  const bounds = { minX: -260, maxX: 260, minZ: -260, maxZ: 260 };
  return {
    size: 600,
    playableSize: 520,
    resolution: 241,
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
      const residence = createResidenceMesh(seed, 1);
      if (residence.userData.residenceRoof !== HAMLET_RESIDENCE_ROOF) {
        throw new Error(`${id} did not retain the required split-wood roof.`);
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

  for (let z = -190; z <= 230; z += 10.2) {
    for (let x = -250; x <= 250; x += 10.2) {
      const northForest = z > 46 + Math.sin(x * 0.055) * 11;
      const sideForest = Math.abs(x) > 68 + Math.sin(z * 0.047) * 10 && z > -78;
      const distantSouthForest = z < -105 + Math.sin(x * 0.038) * 9 && Math.abs(x) > 48;
      const backgroundCanopy = z > 145 || Math.abs(x) > 185;
      const woodland = northForest || sideForest || distantSouthForest || backgroundCanopy;
      if (!woodland) continue;

      const innerEdge = z < 92 && Math.abs(x) < 112;
      const thinning = innerEdge ? 0.14 : 0.05;
      if (rng() < thinning) continue;

      const placedX = x + (rng() - 0.5) * 6.4;
      const placedZ = z + (rng() - 0.5) * 6.4;
      const selectedSpecies = species[Math.floor(rng() * species.length)]!;
      placements.push({
        x: placedX,
        z: placedZ,
        species: selectedSpecies,
        form: rng() < 0.2 ? 'midstory' : 'broad',
        scale: 0.62 + rng() * 0.36,
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
    building: resolveHamletBuildingLodBand(distanceMeters),
  };
}

function updateSceneLods(
  distanceMeters: number,
  firstPerson: boolean,
  cameraTarget: THREE.Vector3,
  routeElapsedMs?: number,
  advanceForest = true,
): HamletFixtureLodState {
  latestForestFrameWork = {
    selectionChanged: false,
    selectorSkipped: true,
    workChunks: 0,
    matrixWrites: 0,
    bucketUploads: 0,
    pendingBuckets: forestRouteWork.pendingBuckets,
  };
  latestGroundcoverFrameDelta = {
    generationSubsteps: 0,
    clearWriteSubsteps: 0,
    refreshes: 0,
    gpuFlagUpdates: 0,
    gpuUpdateRanges: 0,
    bytesUploaded: 0,
    completedSlots: 0,
    cancelledSlots: 0,
    pendingSlots: previousGroundcoverWork?.pendingSlots ?? 0,
  };
  const closeGround = resolveCloseGroundLod(distanceMeters, firstPerson);
  terrainAdapter.setDirtZoomGate(closeGround.dirtGate);
  if (!fixtureAblation.disabledSubsystems.includes('groundcover')) {
    grassField.updateCameraState(camera.position, cameraTarget, distanceMeters, firstPerson);
    const groundcoverWork = grassField.getStreamTelemetry();
    const previous = previousGroundcoverWork ?? groundcoverWork;
    latestGroundcoverFrameDelta = {
      generationSubsteps: counterDelta(
        groundcoverWork.generationSubsteps,
        previous.generationSubsteps,
      ),
      clearWriteSubsteps: counterDelta(
        groundcoverWork.clearWriteSubsteps,
        previous.clearWriteSubsteps,
      ),
      refreshes: counterDelta(
        groundcoverWork.refreshCount,
        previous.refreshCount,
      ),
      gpuFlagUpdates: counterDelta(
        groundcoverWork.gpuFlagUpdates,
        previous.gpuFlagUpdates,
      ),
      gpuUpdateRanges: counterDelta(
        groundcoverWork.gpuUpdateRanges,
        previous.gpuUpdateRanges,
      ),
      bytesUploaded: counterDelta(
        groundcoverWork.bytesUploaded,
        previous.bytesUploaded,
      ),
      completedSlots: counterDelta(
        groundcoverWork.completedSlots,
        previous.completedSlots,
      ),
      cancelledSlots: counterDelta(
        groundcoverWork.cancelledSlots,
        previous.cancelledSlots,
      ),
      pendingSlots: groundcoverWork.pendingSlots,
    };
    previousGroundcoverWork = groundcoverWork;
    window.__HAMLET_FIXTURE_GROUNDCOVER_WORK__ = groundcoverWork;
    document.body.dataset.groundcoverStreamMode = groundcoverWork.mode;
    document.body.dataset.groundcoverStreamPending = String(
      groundcoverWork.pendingSlots,
    );
    document.body.dataset.groundcoverStreamConverged = String(
      groundcoverWork.converged,
    );
    document.body.dataset.groundcoverStreamVisible = String(
      grassField.group.children.some((child) => child.visible),
    );
  }
  if (forestRuntimeReady && advanceForest) {
    const casterBounds = { minX: -90, maxX: 90, minZ: -80, maxZ: 80 };
    if (forestUpdatesFrozenForMeasurement && forestLodPrimed) {
      recordForestRouteWork(distanceMeters, {
        selectionChanged: false,
        bucketCompactions: 0,
        workChunks: 0,
        matrixWrites: 0,
        selectorSkipped: true,
        triggerReasons: [],
        pendingBuckets: 0,
        durationMs: 0,
      }, routeElapsedMs);
    } else if (isProfileForestBudgetingRequested() && forestLodPrimed) {
      stepBudgetedForestUpdate(distanceMeters, firstPerson, routeElapsedMs);
    } else if (
      requestedVisualProfile
      && forestLodPrimed
      && fixtureAblation.forestSelection !== 'budgeted'
    ) {
      recordForestRouteWork(distanceMeters, {
        selectionChanged: false,
        bucketCompactions: 0,
        workChunks: 0,
        matrixWrites: 0,
        selectorSkipped: true,
        triggerReasons: [],
        pendingBuckets: 0,
        durationMs: 0,
      }, routeElapsedMs);
    } else {
      updateSeedThreeForestCamera(forest, camera, firstPerson, casterBounds);
      forestLodPrimed = true;
    }
  }
  const lod = resolveFixtureLodState(distanceMeters);
  settlementRoot.userData.reviewLodBand = lod.building;
  document.body.dataset.forestLod = lod.forest;
  document.body.dataset.groundcoverLod = lod.groundcover;
  document.body.dataset.buildingLod = lod.building;
  return lod;
}

function stepBudgetedForestUpdate(
  distanceMeters: number,
  firstPerson: boolean,
  routeElapsedMs?: number,
): number {
  const result = updateSeedThreeForestCameraBudgeted(
    forest,
    camera,
    firstPerson,
    { minX: -90, maxX: 90, minZ: -80, maxZ: 80 },
    {
      maxBucketCompactions:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.maxBucketCompactionsPerFrame,
      maxUpdateDurationMs:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.maxUpdateDurationMs,
      maxMatrixWritesPerChunk:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.maxMatrixWritesPerChunk,
      minimumCameraMove:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCameraMoveMeters,
      minimumDirectionAngle: THREE.MathUtils.degToRad(
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumDirectionAngleDegrees,
      ),
      minimumProjectionChange:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumProjectionChange,
      minimumCasterBoundsChange:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCasterBoundsChangeMeters,
    },
  );
  recordForestRouteWork(distanceMeters, result, routeElapsedMs);
  return result.pendingBuckets;
}

function counterDelta(current: number, previous: number): number {
  return Math.max(0, current - previous);
}

function isProfileForestBudgetingRequested(): boolean {
  return requestedVisualProfile
    && requestedMotionRouteId === HAMLET_MOTION_ROUTE_ID
    && fixtureAblation.forestSelection === 'budgeted';
}

function createForestPhaseTelemetry(): HamletForestRouteWorkTelemetry['phases']['strategic'] {
  return {
    frames: 0,
    selectionChanges: 0,
    bucketCompactions: 0,
    bucketUploads: 0,
    workChunks: 0,
    matrixWrites: 0,
    maxBucketCompactionsPerFrame: 0,
    maxUpdateDurationMs: 0,
    triggerReasons: {},
  };
}

function createSettledKeyframeTelemetry(): HamletForestRouteWorkTelemetry[
  'settledKeyframes'
]['strategic-settled'] {
  return {
    observations: 0,
    pendingBuckets: 0,
    maxPendingBuckets: 0,
    converged: true,
    sampledAtMs: null,
    sampleTiming: 'pre-departure-dwell',
  };
}

function recordForestRouteWork(
  distanceMeters: number,
  result: {
    selectionChanged: boolean;
    selectorSkipped: boolean;
    triggerReasons: readonly string[];
    bucketCompactions: number;
    workChunks: number;
    matrixWrites: number;
    pendingBuckets: number;
    durationMs: number;
  },
  routeElapsedMs?: number,
): void {
  latestForestFrameWork = {
    selectionChanged: result.selectionChanged,
    selectorSkipped: result.selectorSkipped,
    workChunks: result.workChunks,
    matrixWrites: result.matrixWrites,
    bucketUploads: result.bucketCompactions,
    pendingBuckets: result.pendingBuckets,
  };
  forestRouteWork.pendingBuckets = result.pendingBuckets;
  if (motionState.status === 'running') {
    const phaseId = resolveFixtureLodState(distanceMeters).building;
    const phase = forestRouteWork.phases[phaseId];
    phase.frames += 1;
    phase.selectionChanges += result.selectionChanged ? 1 : 0;
    phase.bucketCompactions += result.bucketCompactions;
    phase.bucketUploads += result.bucketCompactions;
    phase.workChunks += result.workChunks;
    phase.matrixWrites += result.matrixWrites;
    phase.maxBucketCompactionsPerFrame = Math.max(
      phase.maxBucketCompactionsPerFrame,
      result.bucketCompactions,
    );
    phase.maxUpdateDurationMs = Math.max(
      phase.maxUpdateDurationMs,
      result.durationMs,
    );
    for (const reason of result.triggerReasons) {
      phase.triggerReasons[reason] = (phase.triggerReasons[reason] ?? 0) + 1;
      forestRouteWork.triggerReasons[reason] =
        (forestRouteWork.triggerReasons[reason] ?? 0) + 1;
    }
    forestRouteWork.selectionChanges += result.selectionChanged ? 1 : 0;
    forestRouteWork.selectorEvaluations += result.selectorSkipped ? 0 : 1;
    forestRouteWork.selectorSkips += result.selectorSkipped ? 1 : 0;
    forestRouteWork.totalBucketCompactions += result.bucketCompactions;
    forestRouteWork.totalBucketUploads += result.bucketCompactions;
    forestRouteWork.totalWorkChunks += result.workChunks;
    forestRouteWork.totalMatrixWrites += result.matrixWrites;
    forestRouteWork.maxBucketCompactionsPerFrame = Math.max(
      forestRouteWork.maxBucketCompactionsPerFrame,
      result.bucketCompactions,
    );
    forestRouteWork.maxUpdateDurationMs = Math.max(
      forestRouteWork.maxUpdateDurationMs,
      result.durationMs,
    );
    if (routeElapsedMs !== undefined) {
      recordSettledKeyframeConvergence(routeElapsedMs, result.pendingBuckets);
    }
  }
  window.__HAMLET_FIXTURE_FOREST_WORK__ = snapshotForestRouteWork();
}

function recordSettledKeyframeConvergence(
  routeElapsedMs: number,
  pendingBuckets: number,
): void {
  const routeWrapped = routeElapsedMs < lastForestRouteElapsedMs;
  if (routeWrapped) {
    settledDwellSamples['strategic-settled'] = null;
    settledDwellSamples['road-eye-settled'] = null;
  }
  const previousElapsedMs = routeWrapped ? 0 : lastForestRouteElapsedMs;
  for (const keyframeId of ['strategic-settled', 'road-eye-settled'] as const) {
    const keyframeIndex = HAMLET_MOTION_ROUTE.keyframes.findIndex(
      (candidate) => candidate.id === keyframeId,
    );
    const keyframe = HAMLET_MOTION_ROUTE.keyframes[keyframeIndex]!;
    const dwellStartMs = HAMLET_MOTION_ROUTE.keyframes[keyframeIndex - 1]!.timeMs;
    if (
      routeElapsedMs >= dwellStartMs
      && routeElapsedMs <= keyframe.timeMs
    ) {
      settledDwellSamples[keyframeId] = {
        pendingBuckets,
        sampledAtMs: routeElapsedMs,
      };
    }
    if (
      previousElapsedMs > keyframe.timeMs
      || routeElapsedMs <= keyframe.timeMs
    ) {
      continue;
    }
    const dwellSample = settledDwellSamples[keyframeId];
    if (!dwellSample) continue;
    const checkpoint = forestRouteWork.settledKeyframes[keyframeId];
    checkpoint.observations += 1;
    checkpoint.pendingBuckets = dwellSample.pendingBuckets;
    checkpoint.maxPendingBuckets = Math.max(
      checkpoint.maxPendingBuckets,
      dwellSample.pendingBuckets,
    );
    checkpoint.converged =
      checkpoint.converged && dwellSample.pendingBuckets === 0;
    checkpoint.sampledAtMs = dwellSample.sampledAtMs;
    settledDwellSamples[keyframeId] = null;
  }
  lastForestRouteElapsedMs = routeElapsedMs;
}

function snapshotForestRouteWork(): HamletForestRouteWorkTelemetry {
  return {
    ...forestRouteWork,
    updateAblation: { ...forestRouteWork.updateAblation },
    phases: {
      strategic: { ...forestRouteWork.phases.strategic },
      settlement: { ...forestRouteWork.phases.settlement },
      'road-eye': { ...forestRouteWork.phases['road-eye'] },
    },
    triggerReasons: { ...forestRouteWork.triggerReasons },
    settledKeyframes: {
      'strategic-settled': {
        ...forestRouteWork.settledKeyframes['strategic-settled'],
      },
      'road-eye-settled': {
        ...forestRouteWork.settledKeyframes['road-eye-settled'],
      },
    },
  };
}

function applyAblationQuery(ablation: HamletFixtureAblation): void {
  if (!requestedVisualProfile) return;
  const url = new URL(window.location.href);
  const disabled = new Set(
    (url.searchParams.get('visualDisable') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const subsystem of ablation.disabledSubsystems) disabled.add(subsystem);
  if (disabled.size > 0) {
    url.searchParams.set('visualDisable', [...disabled].sort().join(','));
  } else {
    url.searchParams.delete('visualDisable');
  }
  window.history.replaceState(null, '', url);
}

function publishFixtureEvidence(): HamletFixtureEvidenceEnvelope | null {
  if (finalizedFixtureEvidence) {
    return JSON.parse(JSON.stringify(finalizedFixtureEvidence)) as HamletFixtureEvidenceEnvelope;
  }
  if (!performanceProtocol || !window.__HAMLET_FIXTURE_METRICS__) return null;
  return createHamletFixtureEvidenceEnvelope({
    fixtureId: HAMLET_FIXTURE_ID,
    routeId: HAMLET_MOTION_ROUTE_ID,
    routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
    ablation: fixtureAblation,
    protocol: performanceProtocol,
    performanceReport: window.__visualPerf?.getReport() ?? null,
    forestWork: snapshotForestRouteWork(),
    groundcoverWork: grassField.getStreamTelemetry(),
    completedRoutes: completedMotionRoutes,
    routeWarmup: routeWarmupWork,
    content: {
      residences: window.__HAMLET_FIXTURE_METRICS__.residences,
      residenceRoof: window.__HAMLET_FIXTURE_METRICS__.residenceRoof,
      trees: window.__HAMLET_FIXTURE_METRICS__.trees,
      visibleTrees: window.__HAMLET_FIXTURE_METRICS__.visibleTrees,
      forestDraws: window.__HAMLET_FIXTURE_METRICS__.forestDraws,
    },
  });
}

function maybeFinalizeFixtureEvidence(): void {
  const performanceReport = window.__visualPerf?.getReport() ?? null;
  if (
    finalizedFixtureEvidence
    || performanceReport?.status !== 'ready'
  ) {
    return;
  }
  const envelope = publishFixtureEvidence();
  if (requestedVisualNoUpdateShell) {
    if (
      !canFinalizeHamletNoUpdateShellEvidence(
        envelope,
        noUpdateShellCaptureReport,
        bootState.status,
      )
      || !envelope
      || !noUpdateShellCaptureReport
    ) {
      return;
    }
    const noUpdateShell: HamletNoUpdateShellEvidence = {
      ...noUpdateShellCaptureReport,
      collectorAgreement: {
        schemaVersion: 5,
        exactSampleCount: true,
        exactMetrics: true,
        zeroRendererSubmissions: true,
        ...(requestedVisualDeferredDom
          ? {
              domPublication:
                window.__visualPerf!.getDomPublicationEvidence(),
            }
          : {}),
      },
    };
    if (requestedVisualDeferredDom) {
      const publication = noUpdateShell.collectorAgreement.domPublication;
      if (
        publication?.mode !== 'terminal-only-after-freeze'
        || publication.inMemoryReportConstructions < 1
        || publication.jsonSerializations
          !== publication.inMemoryReportConstructions
        || publication.cohortDomPublications !== 0
        || publication.terminalDomPublications !== 1
      ) {
        return;
      }
    }
    finalizedFixtureEvidence = {
      ...envelope,
      noUpdateShell,
    };
    window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
    document.documentElement.dataset.visualNoUpdateShellStatus = 'ready';
    document.documentElement.dataset.hamletFixtureEvidence =
      JSON.stringify(finalizedFixtureEvidence);
    return;
  }
  if (!envelope || !canFinalizeHamletFixtureEvidence(envelope, bootState.status)) return;
  if (requestedVisualBareRafPair) {
    if (
      degradedNoRenderEnvelope
      || !performancePairIdentity
      || !bareRafCapture
      || !envelope.performanceReport
    ) {
      return;
    }
    degradedNoRenderEnvelope = JSON.parse(
      JSON.stringify(envelope),
    ) as HamletFixtureEvidenceEnvelope;
    degradedNoRenderArm = {
      ...performancePairIdentity,
      arm: 'degraded-no-render',
      sequenceIndex: 1,
      completedAtPerformanceTimestampMs: performance.now(),
      performanceReport: JSON.parse(
        JSON.stringify(envelope.performanceReport),
      ) as NonNullable<HamletFixtureEvidenceEnvelope['performanceReport']>,
    };
    window.__visualPerf?.stopFrameCollection();
    bareRafControlCollecting = true;
    document.documentElement.dataset.visualBareRafPairStatus = 'collecting';
    return;
  }
  finalizedFixtureEvidence = envelope;
  window.__HAMLET_FIXTURE_EVIDENCE__ = envelope;
  document.documentElement.dataset.hamletFixtureEvidence = JSON.stringify(envelope);
}

function finalizeBareRafControl(
  capture: HamletBareRafCaptureEvidence,
): void {
  if (!degradedNoRenderEnvelope || !degradedNoRenderArm) {
    throw new Error('Bare-rAF control completed without its degraded no-render arm.');
  }
  const { leadIn, bareRaf } = capture;
  const pairedRafControl: HamletPairedRafControlEvidence = {
    schemaVersion: 2,
    sequence: 'degraded-no-render-then-bare-raf',
    transitionGapMs:
      bareRaf.startedAtRafTimestampMs
      - degradedNoRenderArm.completedAtPerformanceTimestampMs,
    leadInStartGapMs:
      leadIn.startedAtRafTimestampMs
      - degradedNoRenderArm.completedAtPerformanceTimestampMs,
    leadInToBareRafGapMs:
      bareRaf.startedAtRafTimestampMs
      - leadIn.completedAtRafTimestampMs,
    degradedNoRender: degradedNoRenderArm,
    bareRafLeadIn: leadIn,
    bareRaf,
  };
  finalizedFixtureEvidence = {
    ...degradedNoRenderEnvelope,
    pairedRafControl,
  };
  window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
  document.documentElement.dataset.visualBareRafPairStatus = 'ready';
  document.documentElement.dataset.hamletFixtureEvidence =
    JSON.stringify(finalizedFixtureEvidence);
}

function publishNoUpdateShellStatus(status: string): void {
  if (requestedVisualDeferredDom) return;
  document.documentElement.dataset.visualNoUpdateShellStatus = status;
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
    document.body.dataset.captureReady = String(isFullVisualSystemsReady());
    return window.__HAMLET_FIXTURE_METRICS__!;
  };
  window.__HAMLET_FIXTURE_CAPTURE_MOTION__ = (elapsedMs) => {
    seekMotionRoute(elapsedMs, 'paused');
    document.body.dataset.captureId = HAMLET_MOTION_ROUTE_ID;
    document.body.dataset.captureReady = String(isFullVisualSystemsReady());
    return motionState;
  };
  window.__HAMLET_FIXTURE_CAPTURE_READY__ = (captureId) => {
    if (!isFullVisualSystemsReady() || renderedFrameCount < 2) return false;
    if (!captureId) return document.body.dataset.captureReady === 'true';
    if (captureId === HAMLET_MOTION_ROUTE_ID) {
      return motionState.status !== 'idle';
    }
    return activeViewId === captureId && motionState.status !== 'running';
  };
}

function isMotionSettledStartReady(): boolean {
  return bootState.status === 'ready'
    && isFullVisualSystemsReady()
    && renderedFrameCount >= HAMLET_MOTION_ROUTE.settledStartPredicate.minimumRenderedFrames
    && (
      fixtureAblation.groundcoverStreaming !== 'frozen'
      || grassField.isStreamSettled()
    )
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
  completedMotionRoutes = 0;
  lastMotionRouteCycle = Math.floor(
    motionStartOffsetMs / HAMLET_MOTION_ROUTE.durationMs,
  );
  publishCompletedMotionRoutes();
  seekMotionRoute(motionStartOffsetMs, 'settled');
  motionStartNowMs = performance.now();
  motionState = { ...motionState, status: 'running' };
  publishMotionState();
  document.body.dataset.captureReady = 'false';
  return true;
}

function startRequestedMotionRoute(): void {
  const waitForProfile = requestedVisualProfile;
  const tryStart = (): void => {
    if (
      waitForProfile
      && document.documentElement.dataset.visualProfileStatus !== 'collecting'
    ) {
      requestAnimationFrame(tryStart);
      return;
    }
    const warmupRoute = routeWarmupWork.required
      && routeWarmupWork.stage === 'waiting';
    if (!startMotionRoute(0, waitForProfile && !warmupRoute)) {
      requestAnimationFrame(tryStart);
      return;
    }
    if (warmupRoute) {
      routeWarmupWork.stage = 'route';
      publishRouteWarmupWork();
    }
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
  const sample = sampleHamletMotionRoute(elapsedMs);
  camera.position.copy(sample.position);
  motionCameraTarget.copy(sample.target);
  camera.quaternion.copy(sample.orientation);
  camera.fov = sample.fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const firstPerson =
    sample.distanceMeters <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters;
  const lod = updateSceneLods(
    sample.distanceMeters,
    firstPerson,
    motionCameraTarget,
    sample.elapsedMs,
  );
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

function publishMotionState(): void {
  window.__HAMLET_FIXTURE_MOTION_STATE__ = motionState;
  window.__HAMLET_FIXTURE_MOTION_READY__ = isMotionSettledStartReady();
  document.body.dataset.motionStatus = motionState.status;
  document.body.dataset.motionElapsedMs = motionState.elapsedMs.toFixed(0);
  document.body.dataset.motionDistanceMeters = motionState.distanceMeters.toFixed(2);
}

function publishCompletedMotionRoutes(): void {
  window.__HAMLET_FIXTURE_COMPLETED_ROUTES__ = completedMotionRoutes;
  document.body.dataset.motionCompletedRoutes = String(completedMotionRoutes);
}

function publishRouteWarmupWork(): void {
  window.__HAMLET_FIXTURE_ROUTE_WARMUP__ = { ...routeWarmupWork };
  document.body.dataset.routeWarmupStage = routeWarmupWork.stage;
  document.body.dataset.routeWarmupCompletedRoutes = String(
    routeWarmupWork.completedRoutes,
  );
  document.body.dataset.routeWarmupCollectorReset = String(
    routeWarmupWork.collectorReset,
  );
}

function advanceRouteWarmupProtocol(): void {
  if (!routeWarmupWork.required) return;
  const visualPerf = window.__visualPerf;
  const drain = advanceHamletFixtureRouteWarmupDrain({
    stage: routeWarmupWork.stage,
    motionStatus: motionState.status,
    pendingBuckets: forestRouteWork.pendingBuckets,
    step: () => stepBudgetedForestUpdate(
      motionState.distanceMeters,
      motionState.distanceMeters
        <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters,
    ),
  });
  if (drain.stepped) {
    document.body.dataset.routeWarmupDrainPending = String(drain.pendingBuckets);
    document.body.dataset.routeWarmupDrainProgressed = String(drain.progressed);
  }
  if (drain.complete) {
    if (!visualPerf) return;
    routeWarmupWork.completed = routeWarmupWork.completedRoutes >= 1;
    routeWarmupWork.strategicPendingAtReset = drain.pendingBuckets;
    if (
      fixtureAblation.forestUpdates === 'frozen-after-settled-warmup'
      && routeWarmupWork.completed
    ) {
      forestRouteWork.updateAblation =
        resolveHamletForestUpdateAblationTelemetry({
          requestedMode: fixtureAblation.forestUpdates,
          warmupCompleted: true,
          pendingBuckets: drain.pendingBuckets,
        });
      forestUpdatesFrozenForMeasurement =
        forestRouteWork.updateAblation.state === 'frozen';
      if (forestUpdatesFrozenForMeasurement) {
        forestRouteWork.mode = 'frozen-after-settled-warmup';
      }
      document.body.dataset.forestWorkMode = forestRouteWork.mode;
      document.body.dataset.forestUpdateAblationState =
        forestRouteWork.updateAblation.state;
      document.body.dataset.forestUpdateConvergedAtFreeze = String(
        forestRouteWork.updateAblation.convergedAtFreeze,
      );
      document.body.dataset.forestUpdatePendingBucketsAtFreeze =
        forestRouteWork.updateAblation.pendingBucketsAtFreeze === null
          ? 'pending'
          : String(forestRouteWork.updateAblation.pendingBucketsAtFreeze);
    }
    resetMeasuredRouteTelemetry();
    visualPerf.restartTrace();
    routeWarmupWork.collectorReset = true;
    routeWarmupWork.stage = 'resettling';
    publishRouteWarmupWork();
    return;
  }
  // startMotionRoute() seek-renders route zero before this tick's normal
  // profiled render. Discard this completed callback, then anchor the trace
  // on the first ordinary callback that follows it.
  if (
    routeWarmupWork.stage === 'resettling'
    && document.documentElement.dataset.visualProfileStatus === 'collecting'
    && visualPerf !== undefined
    && startMotionRoute(0, true)
  ) {
    visualPerf.armTraceAfterCurrentFrame();
    routeWarmupWork.stage = 'complete';
    publishRouteWarmupWork();
  }
}

function resetMeasuredRouteTelemetry(): void {
  forestRouteWork.maxBucketCompactionsPerFrame = 0;
  forestRouteWork.totalBucketCompactions = 0;
  forestRouteWork.totalBucketUploads = 0;
  forestRouteWork.totalWorkChunks = 0;
  forestRouteWork.totalMatrixWrites = 0;
  forestRouteWork.selectorEvaluations = 0;
  forestRouteWork.selectorSkips = 0;
  forestRouteWork.triggerReasons = {};
  forestRouteWork.selectionChanges = 0;
  forestRouteWork.maxUpdateDurationMs = 0;
  forestRouteWork.phases = {
    strategic: createForestPhaseTelemetry(),
    settlement: createForestPhaseTelemetry(),
    'road-eye': createForestPhaseTelemetry(),
  };
  forestRouteWork.settledKeyframes = {
    'strategic-settled': createSettledKeyframeTelemetry(),
    'road-eye-settled': createSettledKeyframeTelemetry(),
  };
  lastForestRouteElapsedMs = 0;
  settledDwellSamples['strategic-settled'] = null;
  settledDwellSamples['road-eye-settled'] = null;
  latestForestFrameWork = {
    selectionChanged: false,
    selectorSkipped: true,
    workChunks: 0,
    matrixWrites: 0,
    bucketUploads: 0,
    pendingBuckets: forestRouteWork.pendingBuckets,
  };
  previousGroundcoverWork = grassField.getStreamTelemetry();
  latestGroundcoverFrameDelta = {
    generationSubsteps: 0,
    clearWriteSubsteps: 0,
    refreshes: 0,
    gpuFlagUpdates: 0,
    gpuUpdateRanges: 0,
    bytesUploaded: 0,
    completedSlots: 0,
    cancelledSlots: 0,
    pendingSlots: previousGroundcoverWork.pendingSlots,
  };
  completedMotionRoutes = 0;
  lastMotionRouteCycle = 0;
  publishCompletedMotionRoutes();
  window.__HAMLET_FIXTURE_FOREST_WORK__ = snapshotForestRouteWork();
  window.__HAMLET_FIXTURE_GROUNDCOVER_WORK__ = previousGroundcoverWork;
  finalizedFixtureEvidence = null;
  delete window.__HAMLET_FIXTURE_EVIDENCE__;
  delete document.documentElement.dataset.hamletFixtureEvidence;
}

function isNoRenderMeasuredWindowActive(): boolean {
  return requestedVisualNoRender
    && routeWarmupWork.stage === 'complete'
    && document.documentElement.dataset.visualProfileStatus === 'collecting';
}

function startContinuousTick(): void {
  if (motionAnimationFrame !== null) return;
  const tick = (nowMs: number): void => {
    if (bareRafControlCollecting) {
      const bareRafControl = bareRafCapture?.appendRafTimestamp(nowMs) ?? null;
      if (bareRafControl) {
        bareRafControlCollecting = false;
        motionAnimationFrame = null;
        finalizeBareRafControl(bareRafControl);
      } else {
        motionAnimationFrame = requestAnimationFrame(tick);
      }
      return;
    }
    const frameCpuStartedAtMs = requestedVisualProfile ? performance.now() : null;
    motionAnimationFrame = requestAnimationFrame(tick);
    if (
      requestedVisualNoUpdateShell
      && routeWarmupWork.stage === 'complete'
      && frameCpuStartedAtMs !== null
      && noUpdateShellCapture !== null
    ) {
      const controlStep = noUpdateShellCapture.appendRafTimestamp(nowMs);
      if (controlStep.armCollectorAfterCurrentFrame) {
        if (requestedVisualDeferredDom) {
          window.__visualPerf?.deferDomPublicationUntilReady();
          deferredDomCohortActive = true;
        }
        window.__visualPerf?.armTraceAfterCurrentFrame();
        publishNoUpdateShellStatus('judged-cohort-arming');
      } else if (controlStep.report) {
        noUpdateShellCaptureReport = controlStep.report;
        publishNoUpdateShellStatus('awaiting-schema-5-report');
      } else {
        publishNoUpdateShellStatus('collecting');
      }
      // This treatment retains the complete profiled callback shell and its
      // telemetry/evidence/DOM postamble. It skips only route/LOD/scene/sky
      // updates and the already-isolated post-processor submission.
      const frameBeforeRenderAtMs = performance.now();
      const frameAfterProfileRenderPathAtMs = render(
        0,
        true,
        nowMs,
        true,
      )!;
      const frameCpuCompletedAtMs = performance.now();
      latestProfileFrameTiming = {
        frameRafTimestampMs: nowMs,
        frameCallbackEntryTimestampMs: frameCpuStartedAtMs,
        frameCpuDurationMs: Math.max(
          0,
          frameCpuCompletedAtMs - frameCpuStartedAtMs,
        ),
        frameUpdatePreRenderDurationMs: Math.max(
          0,
          frameBeforeRenderAtMs - frameCpuStartedAtMs,
        ),
        frameRenderSubmissionDurationMs: Math.max(
          0,
          frameAfterProfileRenderPathAtMs - frameBeforeRenderAtMs,
        ),
        framePostRenderDurationMs: Math.max(
          0,
          frameCpuCompletedAtMs - frameAfterProfileRenderPathAtMs,
        ),
      };
      if (
        finalizedFixtureEvidence
        && motionAnimationFrame !== null
      ) {
        cancelAnimationFrame(motionAnimationFrame);
        motionAnimationFrame = null;
      }
      return;
    }
    const dtMs = previousTickNowMs === 0
      ? 0
      : Math.min(100, Math.max(0, nowMs - previousTickNowMs));
    previousTickNowMs = nowMs;
    fixtureTimeSeconds += dtMs / 1000;

    if (motionState.status === 'running') {
      const unboundedElapsed = motionStartOffsetMs + nowMs - motionStartNowMs;
      const routeCycle = Math.floor(
        unboundedElapsed / HAMLET_MOTION_ROUTE.durationMs,
      );
      if (motionLoopEnabled && routeCycle > lastMotionRouteCycle) {
        completedMotionRoutes += routeCycle - lastMotionRouteCycle;
        lastMotionRouteCycle = routeCycle;
        publishCompletedMotionRoutes();
      }
      const elapsed = motionLoopEnabled
        ? unboundedElapsed % HAMLET_MOTION_ROUTE.durationMs
        : Math.min(unboundedElapsed, HAMLET_MOTION_ROUTE.durationMs);
      const nextStatus = !motionLoopEnabled && elapsed >= HAMLET_MOTION_ROUTE.durationMs
        ? 'complete'
        : 'running';
      if (!motionLoopEnabled && nextStatus === 'complete') {
        if (routeWarmupWork.required && routeWarmupWork.stage === 'route') {
          routeWarmupWork.completedRoutes += 1;
          routeWarmupWork.stage = 'strategic-drain';
          publishRouteWarmupWork();
        } else {
          completedMotionRoutes += 1;
          publishCompletedMotionRoutes();
        }
      }
      const sample = sampleHamletMotionRoute(elapsed);
      camera.position.copy(sample.position);
      motionCameraTarget.copy(sample.target);
      camera.quaternion.copy(sample.orientation);
      camera.fov = sample.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const firstPerson =
        sample.distanceMeters <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters;
      const enteringWarmupDrain = routeWarmupWork.required
        && routeWarmupWork.stage === 'strategic-drain'
        && nextStatus === 'complete';
      const lod = updateSceneLods(
        sample.distanceMeters,
        firstPerson,
        motionCameraTarget,
        sample.elapsedMs,
        !enteringWarmupDrain,
      );
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
      const drainingWarmup = routeWarmupWork.required
        && routeWarmupWork.stage === 'strategic-drain'
        && motionState.status === 'complete';
      updateSceneLods(
        motionState.distanceMeters,
        motionState.distanceMeters
          <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters,
        motionCameraTarget,
        undefined,
        !drainingWarmup,
      );
    }

    advanceRouteWarmupProtocol();
    sky.updateCamera(camera);
    sky.updateSun(sunDirection);
    sky.updateTime(fixtureTimeSeconds);
    if (frameCpuStartedAtMs === null) {
      render(dtMs / 1000);
      return;
    }
    const frameBeforeRenderAtMs = performance.now();
    const frameAfterProfileRenderPathAtMs = render(
      dtMs / 1000,
      true,
      nowMs,
      isNoRenderMeasuredWindowActive(),
    )!;
    // Stop only after render() has completed its telemetry, evidence, and DOM
    // work. GPU execution and presentation remain outside this callback span.
    const frameCpuCompletedAtMs = performance.now();
    latestProfileFrameTiming = {
      frameRafTimestampMs: nowMs,
      // Reuse the profile-only callback-entry clock read that already anchors
      // the schema-5 CPU duration; do not add another hot-path sample.
      frameCallbackEntryTimestampMs: frameCpuStartedAtMs,
      frameCpuDurationMs: Math.max(
        0,
        frameCpuCompletedAtMs - frameCpuStartedAtMs,
      ),
      frameUpdatePreRenderDurationMs: Math.max(
        0,
        frameBeforeRenderAtMs - frameCpuStartedAtMs,
      ),
      frameRenderSubmissionDurationMs: Math.max(
        0,
        frameAfterProfileRenderPathAtMs - frameBeforeRenderAtMs,
      ),
      framePostRenderDurationMs: Math.max(
        0,
        frameCpuCompletedAtMs - frameAfterProfileRenderPathAtMs,
      ),
    };
  };
  motionAnimationFrame = requestAnimationFrame(tick);
}

function render(
  dt = 0,
  profileRenderSubmission = false,
  profileFrameRafTimestampMs: number | null = null,
  skipProfilePostProcessorRender = false,
): number | null {
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
  let renderPathCompletedAtMs: number | null = null;
  let postProcessorRendered = false;
  if (!profileRenderSubmission) {
    postProcessor.render(dt);
    postProcessorRendered = true;
  } else if (!skipProfilePostProcessorRender) {
    const gpuTimestampHandle = profileFrameRafTimestampMs === null
      ? null
      : visualGpuTimestampProfiler?.beginFrame(profileFrameRafTimestampMs) ?? null;
    try {
      postProcessor.render(dt);
      postProcessorRendered = true;
      renderPathCompletedAtMs = performance.now();
    } finally {
      if (gpuTimestampHandle) {
        visualGpuTimestampProfiler?.endFrame(gpuTimestampHandle);
      }
    }
  } else {
    const result = executeVisualProfileRenderPath({
      dt,
      frameRafTimestampMs: profileFrameRafTimestampMs,
      skipPostProcessorRender: true,
      postProcessorRender: (renderDt) => postProcessor.render(renderDt),
      gpuTimestampProfiler: visualGpuTimestampProfiler,
      now: () => performance.now(),
    });
    postProcessorRendered = result.postProcessorRendered;
    renderPathCompletedAtMs = result.renderPathCompletedAtMs;
  }
  if (postProcessorRendered) renderedFrameCount += 1;

  const forestStats = getSeedThreeForestStructuralStats(forest);
  const structural = countFixtureStructuralSubmissions(scene);
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
    drawCalls: structural.draws,
    triangles: structural.triangles,
    staticBatching: {
      roads: { ...roadBatch.stats },
      settlement: { ...settlementBatch.stats },
      fields: { ...fieldBatch.stats },
    },
    motion: motionState,
  };
  window.__HAMLET_FIXTURE_METRICS__ = metrics;
  maybeFinalizeFixtureEvidence();
  if (!deferredDomCohortActive || finalizedFixtureEvidence) {
    metricsElement!.textContent = [
      `${activeViewId} · ${rendererBackend.kind}`,
      `${metrics.drawCalls} draws · ${metrics.triangles.toLocaleString()} tris`,
      `${metrics.residences} wood-roof homes · ${metrics.visibleTrees}/${metrics.trees} trees`,
    ].join('\n');
  }
  return renderPathCompletedAtMs;
}

function isHamletViewId(value: string | null): value is HamletViewId {
  return HAMLET_VIEW_IDS.some((view) => view === value);
}
