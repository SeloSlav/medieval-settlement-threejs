import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  BatchedBuildingShadowProxies,
  type BatchedShadowProxyStats,
} from '../buildings/buildingShadowProxy.ts';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { preloadAuthoredArchitectureModels } from '../buildings/authoredArchitectureModels.ts';
import {
  initializeBuildingMaterialLibrary,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { resolveCloseGroundLod } from '../grass/grassLodMath.ts';
import {
  createGrassBladeField,
  type GrassBladeField,
  type GrassBladeLodFadeMode,
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
import {
  beginRendererFrame,
  configureRendererFrameStats,
  readRendererFrameStats,
  type RendererFrameStats,
  type RendererInfoLike,
} from '../scene/rendererFrameStats.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { SkyCloudMesh, loadSkyPerlinTexture } from '../sky/SkyCloudMesh.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { updateTerrainRoadWear } from '../terrain/TerrainRoadWear.ts';
import { computeDayNightState } from '../world/dayNightPresentation.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import {
  createHamletForestPlacements,
  resolveHamletForestEdgeLayout,
  type HamletForestEdgeLayerEvidence,
} from './hamletForestEdgeLayer.ts';
import {
  applyHamletUnderCanopyGroundTreatment,
  assertHamletUnderCanopyGroundDependencies,
  resolveHamletUnderCanopyGroundTreatment,
  type HamletUnderCanopyGroundEvidence,
} from './hamletUnderCanopyGround.ts';
import {
  createSeedThreeForest,
  getSeedThreeForestProfileBreakdown,
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
  canFinalizeHamletFrozenUpdateDirectRenderEvidence,
  canFinalizeHamletNoUpdateShellEvidence,
  canFinalizeHamletRouteLodSkyDirectRenderEvidence,
  canFinalizeHamletRouteUpdatePairArmEvidence,
  auditHamletRouteLodSkyDirectRenderCollector,
  createHamletBareRafCapture,
  createHamletDomPublicationPairCoordinator,
  createHamletFixtureEvidenceEnvelope,
  createHamletFrozenUpdateDirectRenderCapture,
  createHamletFrozenUpdateDirectRenderEvidence,
  createHamletNoUpdateShellCapture,
  createHamletRouteFrameSequenceDescriptor,
  createHamletRouteLodSkyDirectRenderCapture,
  createHamletRouteLodSkyDirectRenderEvidence,
  createHamletRouteUpdatePairCoordinator,
  HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
  HAMLET_FOREST_ROUTE_WORK_BUDGET,
  HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
  HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  resolveHamletBareRafPairRequest,
  resolveHamletDeferredDomRequest,
  resolveHamletDomPublicationPairRequest,
  resolveHamletForestUpdateAblationTelemetry,
  resolveHamletFixtureAblation,
  resolveHamletFrozenUpdateDirectRenderRequest,
  resolveHamletNoUpdateShellRequest,
  resolveHamletPerformanceProtocol,
  resolveHamletRouteFrameSequenceDomRequest,
  resolveHamletRouteFrameSequenceElapsedMs,
  resolveHamletRouteLodSkyDirectRenderRequest,
  resolveHamletRouteUpdatePairRequest,
  type HamletBareRafCaptureEvidence,
  type HamletDegradedNoRenderArmEvidence,
  type HamletFixtureAblation,
  type HamletFixtureEvidenceEnvelope,
  type HamletFrozenUpdateDirectRenderCaptureEvidence,
  type HamletNoUpdateShellCaptureEvidence,
  type HamletNoUpdateShellEvidence,
  type HamletPairedRafControlEvidence,
  type HamletPerformancePairIdentity,
  type HamletFixtureRouteWarmupEvidence,
  type HamletForestRouteWorkTelemetry,
  type HamletFixturePerformanceProtocol,
  type HamletRouteFrameSequenceDescriptor,
  type HamletRouteLodSkyDirectRenderCaptureEvidence,
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

await preloadAuthoredArchitectureModels();

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

type HamletRouteFrameSequenceCapture = {
  signature: HamletRouteFrameSequenceDescriptor['signature'];
  frameIndex: number;
  elapsedMs: number;
  cameraPoseSignature: string;
  motion: HamletFixtureMotionState;
};

type HamletRouteFrameNativePngCapture = {
  frame: HamletRouteFrameSequenceCapture;
  captureSurface: {
    source: 'renderer-drawing-buffer';
    protocol: '1280x720@renderer-pr1';
    width: 1280;
    height: 720;
    rendererPixelRatio: 1;
    mimeType: 'image/png';
  };
  dataUrl: string;
};

type HamletFixtureMetrics = {
  fixtureId: string;
  seed: number;
  view: HamletViewId;
  renderer: string;
  residences: number;
  residenceRoof: 'tier-1-bundled-thatch';
  roadArms: number;
  fields: number;
  trees: number;
  visibleTrees: number;
  forestDraws: number;
  forestEdgeLayer: HamletForestEdgeLayerEvidence;
  underCanopyGround: HamletUnderCanopyGroundEvidence;
  drawCalls: number;
  triangles: number;
  staticBatching: {
    roads: StaticFixtureBatchStats;
    settlement: StaticFixtureBatchStats;
    fields: StaticFixtureBatchStats;
    structureShadows: BatchedShadowProxyStats;
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
    __HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE__?: HamletRouteFrameSequenceDescriptor;
    __HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE_READY__?: () => boolean;
    __HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME__?: (
      frameIndex: number,
    ) => HamletRouteFrameSequenceCapture;
    __HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME_PNG__?: (
      frameIndex: number,
    ) => Promise<HamletRouteFrameNativePngCapture>;
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
const requestedMoonlightSky = params.get('sky') === 'moonlight';
const requestedMotionRouteId = params.get('route');
const requestedVisualProfile = params.get('visualProfile') === '1';
const requestedForestEdgeLayout = resolveHamletForestEdgeLayout(
  params.get('forestEdgeLayout'),
);
const requestedUnderCanopyGround =
  resolveHamletUnderCanopyGroundTreatment(params.get('forestGround'));
assertHamletUnderCanopyGroundDependencies(
  requestedUnderCanopyGround,
  requestedForestEdgeLayout,
);
document.documentElement.dataset.visualRouteForestEdgeLayout =
  requestedForestEdgeLayout;
document.documentElement.dataset.visualRouteForestGround =
  requestedUnderCanopyGround;
const profileLegacyGroundcoverShadowReception =
  requestedVisualProfile
  && params.get('visualGroundcoverShadowReceive') === 'legacy';
const requestedVisualNoRender =
  requestedVisualProfile && params.get('visualNoRender') === '1';
const visualGpuTimestampMarkersEnabled =
  params.get('visualGpuTimestampMarkers') !== '0';
const groundcoverLodFadeMode: GrassBladeLodFadeMode =
  params.get('groundcoverFade') === 'legacy-pipeline-cutover'
    ? 'legacy-pipeline-cutover'
    : params.get('groundcoverFade') === 'continuous-alpha-hash'
      ? 'continuous-alpha-hash'
      : 'continuous-alpha-coverage';
const requestedGroundcoverTransitionEvidence =
  params.get('groundcoverTransitionEvidence') === '1';
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
const requestedVisualDomPublicationPair =
  resolveHamletDomPublicationPairRequest({
    requested: params.get('visualDomPair') === '1',
    visualNoUpdateShell: requestedVisualNoUpdateShell,
    visualDeferDom: requestedVisualDeferredDom,
  });
const requestedVisualFrozenUpdateDirectRender =
  resolveHamletFrozenUpdateDirectRenderRequest({
    requested: params.get('visualFrozenDirectRender') === '1',
    visualProfile: requestedVisualProfile,
    visualNoRender: requestedVisualNoRender,
    visualBareRafPair: requestedVisualBareRafPair,
    visualNoUpdateShell: requestedVisualNoUpdateShell,
    gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,
    routeId: requestedMotionRouteId,
    ablationId: fixtureAblation.id,
    disabledSubsystems: requestedVisualDisabledSubsystems,
  });
const requestedVisualRouteLodSkyDirectRender =
  resolveHamletRouteLodSkyDirectRenderRequest({
    requested: params.get('visualRouteLodSkyDirectRender') === '1',
    visualProfile: requestedVisualProfile,
    visualNoRender: requestedVisualNoRender,
    visualBareRafPair: requestedVisualBareRafPair,
    visualNoUpdateShell: requestedVisualNoUpdateShell,
    visualFrozenDirectRender: requestedVisualFrozenUpdateDirectRender,
    gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,
    routeId: requestedMotionRouteId,
    ablationId: fixtureAblation.id,
    disabledSubsystems: requestedVisualDisabledSubsystems,
  });
const requestedVisualRouteShadowSubsystem =
  requestedVisualRouteLodSkyDirectRender
  && !requestedVisualDisabledSubsystems.includes('shadows')
    ? HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED
    : HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED;
const requestedVisualRouteForestRenderer =
  requestedVisualRouteLodSkyDirectRender
  && !requestedVisualDisabledSubsystems.includes('forest')
    ? HAMLET_ROUTE_FOREST_RENDERER_ENABLED
    : HAMLET_ROUTE_FOREST_RENDERER_DISABLED;
const requestedVisualRouteUpdatePair =
  resolveHamletRouteUpdatePairRequest({
    requested: params.get('visualRouteUpdatePair') === '1',
    visualProfile: requestedVisualProfile,
    visualNoRender: requestedVisualNoRender,
    visualBareRafPair: requestedVisualBareRafPair,
    visualNoUpdateShell: requestedVisualNoUpdateShell,
    visualFrozenDirectRender: requestedVisualFrozenUpdateDirectRender,
    visualRouteLodSkyDirectRender:
      requestedVisualRouteLodSkyDirectRender,
    gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,
    routeId: requestedMotionRouteId,
    ablationId: fixtureAblation.id,
    disabledSubsystems: requestedVisualDisabledSubsystems,
  });
if (fixtureAblation.id !== 'baseline' && !requestedVisualProfile) {
  throw new Error('Hamlet fixture ablations require visualProfile=1.');
}
if (
  requestedGroundcoverTransitionEvidence
  && (
    !requestedVisualProfile
    || requestedMotionRouteId !== HAMLET_MOTION_ROUTE_ID
    || fixtureAblation.id !== 'groundcover-stream-forest-update-frozen'
    || requestedVisualDisabledSubsystems.includes('groundcover')
    || !requestedVisualRouteLodSkyDirectRender
  )
) {
  throw new Error(
    'groundcoverTransitionEvidence=1 requires the canonical Hamlet route, '
    + 'visualProfile=1, the frozen groundcover/forest-update ablation, and '
    + 'the exact direct-color route treatment with '
    + 'post disabled, forest and shadows in an accepted restoration state, and '
    + 'groundcover presentation enabled.',
  );
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
configureRendererFrameStats(renderer.info as unknown as RendererInfoLike);
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
renderer.domElement.setAttribute(
  'data-testid',
  'hamlet-native-render-capture-surface',
);
root.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 420);
camera.layers.disable(TREE_SHADOW_CAST_LAYER);
const motionCameraTarget = new THREE.Vector3();
const scene = new THREE.Scene();
const sceneBackground = new THREE.Color(0x78929d);
scene.background = sceneBackground;
scene.fog = new THREE.Fog(0x879da3, 230, 400);

const moonlightClock: GameClock = {
  simTick: 0,
  totalDays: 224,
  hour: 23,
  minute: 0,
  preciseHour: 23,
  preciseCalendarDay: 224 + 23 / 24,
  weekday: 0,
  monthDay: 15,
  month: 8,
  year: 1,
  isSunday: true,
  isWorkHours: false,
};
const fixtureDayNight = requestedMoonlightSky
  ? computeDayNightState(moonlightClock, true)
  : null;
const hemisphere = new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 1.35);
const ambient = new THREE.AmbientLight(0xb8c8d2, 0.12);
scene.add(hemisphere);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffe6b5, 3.15);
sun.position.copy(
  fixtureDayNight?.sunDirection
    ?? new THREE.Vector3(-75, 112, -58).normalize(),
).multiplyScalar(145);
if (fixtureDayNight) {
  renderer.toneMappingExposure = 0.72;
  sceneBackground.setHex(fixtureDayNight.fogColor);
  scene.fog.color.setHex(fixtureDayNight.fogColor);
  hemisphere.color.setHex(fixtureDayNight.hemiSkyColor);
  hemisphere.groundColor.setHex(fixtureDayNight.hemiGroundColor);
  hemisphere.intensity = fixtureDayNight.hemiIntensity;
  ambient.color.setHex(fixtureDayNight.ambientColor);
  ambient.intensity = fixtureDayNight.ambientIntensity;
  sun.color.setHex(fixtureDayNight.sunColor);
  sun.intensity = fixtureDayNight.sunIntensity;
  document.documentElement.dataset.fixtureSky = 'moonlight';
}
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
sun.shadow.autoUpdate = false;
sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
scene.add(sun);
const sunDirection = sun.position.clone().normalize();
setBootStage('sky-perlin', 'running');
const skyPerlinPromise = loadSkyPerlinTexture();

let renderedFrameCount = 0;
let lastRendererFrameStats: RendererFrameStats = {
  drawCalls: 0,
  renderPasses: 0,
  triangles: 0,
};
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
const frozenUpdateDirectRenderIdentity: HamletPerformancePairIdentity | null =
  requestedVisualFrozenUpdateDirectRender
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const frozenUpdateDirectRenderCapture =
  frozenUpdateDirectRenderIdentity
    ? createHamletFrozenUpdateDirectRenderCapture(
        frozenUpdateDirectRenderIdentity,
      )
    : null;
const routeFrameSequenceDescriptor =
  requestedVisualRouteLodSkyDirectRender
    || requestedVisualRouteUpdatePair
    || requestedGroundcoverTransitionEvidence
      ? createHamletRouteFrameSequenceDescriptor(
        requestedVisualRouteShadowSubsystem,
        requestedVisualRouteForestRenderer,
        requestedForestEdgeLayout,
      )
    : null;
const routeLodSkyDirectRenderIdentity: HamletPerformancePairIdentity | null =
  requestedVisualRouteLodSkyDirectRender
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const routeLodSkyDirectRenderCapture =
  routeLodSkyDirectRenderIdentity
    ? createHamletRouteLodSkyDirectRenderCapture(
        routeLodSkyDirectRenderIdentity,
        {
          shadowSubsystem: requestedVisualRouteShadowSubsystem,
          forestRenderer: requestedVisualRouteForestRenderer,
          forestEdgeLayout: requestedForestEdgeLayout,
        },
      )
    : null;
const routeUpdatePairIdentity: HamletPerformancePairIdentity | null =
  requestedVisualRouteUpdatePair
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const routeUpdatePairRandomDraw = requestedVisualRouteUpdatePair
  ? crypto.getRandomValues(new Uint32Array(1))[0]!
  : null;
const routeUpdatePairCoordinator =
  routeUpdatePairIdentity && routeUpdatePairRandomDraw !== null
    ? createHamletRouteUpdatePairCoordinator(
        routeUpdatePairIdentity,
        routeUpdatePairRandomDraw,
      )
    : null;
const noUpdateShellIdentity: HamletPerformancePairIdentity | null =
  requestedVisualNoUpdateShell
    ? {
        runUuid: crypto.randomUUID(),
        performanceTimeOriginMs: performance.timeOrigin,
      }
    : null;
const domPublicationPairRandomDraw = requestedVisualDomPublicationPair
  ? crypto.getRandomValues(new Uint32Array(1))[0]!
  : null;
const domPublicationPairCoordinator =
  noUpdateShellIdentity && domPublicationPairRandomDraw !== null
    ? createHamletDomPublicationPairCoordinator(
        noUpdateShellIdentity,
        domPublicationPairRandomDraw,
      )
    : null;
const noUpdateShellCapture = noUpdateShellIdentity
  && !domPublicationPairCoordinator
    ? createHamletNoUpdateShellCapture(noUpdateShellIdentity, {
      deferCohortDomPublication: requestedVisualDeferredDom,
    })
  : null;
let noUpdateShellCaptureReport: HamletNoUpdateShellCaptureEvidence | null = null;
let frozenUpdateDirectRenderCaptureReport:
  HamletFrozenUpdateDirectRenderCaptureEvidence | null = null;
let routeLodSkyDirectRenderCaptureReport:
  HamletRouteLodSkyDirectRenderCaptureEvidence | null = null;
let routeFrameSequenceDomControl: HTMLInputElement | null = null;
let routeUpdatePairArmCaptureComplete = false;
let routeUpdatePairAwaitingFreshCollector = false;
let deferredDomCohortActive = false;
let domPublicationPairAwaitingFreshCollector = false;
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
  wildflowerLodCompactions: 0,
  wildflowerLodGpuFlagUpdates: 0,
  wildflowerLodGpuUpdateRanges: 0,
  wildflowerLodBytesUploaded: 0,
  wildflowerLodReclassifications: 0,
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
const skyRuntimeResult = await waitForBootStage(
  'sky-runtime',
  sky.ready,
  requestedMoonlightSky ? 8_000 : 1_500,
);
skyRuntimeReady = skyRuntimeResult.ok;
sky.visible = skyRuntimeReady;
if (fixtureDayNight && skyRuntimeReady) {
  await sky.loadCelestialSky();
  sky.updateAtmosphere(fixtureDayNight.dawnAmount, fixtureDayNight.duskAmount);
  sky.updateSiderealAngle(fixtureDayNight.siderealAngle);
}
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
const structureShadowBatch = new BatchedBuildingShadowProxies(
  settlementRoot,
  'Production-representative hamlet shadow proxies',
  true,
);

const { zones, residences } = createHamletResidences(
  settlementRoot,
  structureShadowBatch,
);
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
  structureShadowBatch.upsertBuilding(landmark.id, landmark.kind, building);
}
structureShadowBatch.flush();
const settlementBatch = batchStaticFixtureMeshes(
  settlementRoot,
  'Static-batched hamlet fabric',
);

const fieldRoot = new THREE.Group();
fieldRoot.name = 'Cultivated parish parcels';
scene.add(fieldRoot);
const farmFields = new FarmFieldMarkers(fieldRoot, hamletHeightAt, {
  maxAnisotropy: rendererBackend.maxAnisotropy,
  rendererBackend: rendererBackend.kind,
  useSeedThreeCrops: true,
});
farmFields.syncFields(createHamletFields());
await farmFields.whenCropsReady();
const fieldBatch = batchStaticFixtureMeshes(
  fieldRoot,
  'Static-batched cultivated parcels',
);

const {
  placements: forestPlacements,
  edgeLayer: forestEdgeLayer,
} = createHamletForestPlacements(requestedForestEdgeLayout);
const underCanopyGround = applyHamletUnderCanopyGroundTreatment({
  treatment: requestedUnderCanopyGround,
  forestEdgeLayout: requestedForestEdgeLayout,
  geometry: terrainGeometry,
  placements: forestPlacements,
});
document.documentElement.dataset.hamletUnderCanopyGroundEvidence =
  JSON.stringify(underCanopyGround);
setBootStage('groundcover', 'running');
const grassFieldPromise = createGrassBladeField(terrainAdapter, {
  maxAnisotropy: rendererBackend.maxAnisotropy,
  rendererBackend: rendererBackend.kind,
  lodFadeMode: groundcoverLodFadeMode,
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
if (profileLegacyGroundcoverShadowReception) {
  grassField.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
}
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
document.body.dataset.groundcoverLodFadeMode = groundcoverLodFadeMode;
document.body.dataset.groundcoverShadowReception =
  profileLegacyGroundcoverShadowReception
    ? 'mesh-received-legacy-profile'
    : 'terrain-projected';
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
const hamletVisualPerformanceApp = {
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
    forestManager: {
      group: forest.group,
      getSeedThreeProfileBreakdown: () =>
        getSeedThreeForestProfileBreakdown(forest),
    },
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
      const structural = countFixtureStructuralSubmissions(scene, camera);
      return {
        backend: rendererBackend.kind,
        frames: renderedFrameCount,
        calls: structural.draws,
        renderPasses: lastRendererFrameStats.renderPasses,
        triangles: structural.triangles,
        pixelRatio: renderer.getPixelRatio(),
      };
    },
  },
};
installVisualPerformanceHooksIfRequested(hamletVisualPerformanceApp);
if (domPublicationPairCoordinator) {
  document.documentElement.dataset.visualDomPairStatus =
    'first-arm-lead-in';
}
if (frozenUpdateDirectRenderCapture) {
  document.documentElement.dataset.visualFrozenDirectRenderStatus =
    'lead-in';
}
if (routeLodSkyDirectRenderCapture) {
  document.documentElement.dataset.visualRouteLodSkyDirectRenderStatus =
    'lead-in';
  document.documentElement.dataset.visualRouteShadowSubsystem =
    requestedVisualRouteShadowSubsystem;
  document.documentElement.dataset.visualRouteForestRenderer =
    requestedVisualRouteForestRenderer;
  document.documentElement.dataset.visualRouteForestUpdates =
    'frozen-after-settled-warmup';
  document.documentElement.dataset.visualRoutePostProcessing =
    'disabled';
  document.documentElement.dataset.visualRouteFrameSequenceStatus =
    'waiting-for-terminal-evidence';
}
if (routeUpdatePairCoordinator) {
  document.documentElement.dataset.visualRouteUpdatePairStatus =
    'first-arm-lead-in';
  document.documentElement.dataset.visualRouteUpdatePairTreatment =
    routeUpdatePairCoordinator.getCurrentTreatment();
  document.documentElement.dataset.visualRouteFrameSequenceStatus =
    'waiting-for-terminal-evidence';
}
if (requestedGroundcoverTransitionEvidence) {
  document.documentElement.dataset.visualGroundcoverEvidenceTreatment =
    `two-grass-plus-ten-spatial-wildflower-lod-meshes:${groundcoverLodFadeMode}:`
    + HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;
  document.documentElement.dataset.visualRouteFrameSequenceStatus =
    'waiting-for-settled-groundcover';
}
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
    setEnvironment() {
      return false;
    },
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
  const forestBlends = new Float32Array(positions.count);
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
    forestBlends[index] = THREE.MathUtils.smoothstep(forestWeight, 0.32, 0.78);
    dirtZoomGates[index] = 1;
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.setAttribute('uv2', uvs.clone());
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('forestBlend', new THREE.BufferAttribute(forestBlends, 1));
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

function createHamletResidences(
  parent: THREE.Group,
  structureShadows: BatchedBuildingShadowProxies,
): {
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
      structureShadows.upsertResidence(id, 1, residence);
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
    // Match production: detailed structure meshes receive shadows while the
    // coarse instanced proxy batch alone enters the static shadow atlas.
    mesh.castShadow = false;
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
    wildflowerLodCompactions: 0,
    wildflowerLodGpuFlagUpdates: 0,
    wildflowerLodGpuUpdateRanges: 0,
    wildflowerLodBytesUploaded: 0,
    wildflowerLodReclassifications: 0,
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
      wildflowerLodCompactions: counterDelta(
        groundcoverWork.wildflowerLodCompactions ?? 0,
        previous.wildflowerLodCompactions ?? 0,
      ),
      wildflowerLodGpuFlagUpdates: counterDelta(
        groundcoverWork.wildflowerLodGpuFlagUpdates ?? 0,
        previous.wildflowerLodGpuFlagUpdates ?? 0,
      ),
      wildflowerLodGpuUpdateRanges: counterDelta(
        groundcoverWork.wildflowerLodGpuUpdateRanges ?? 0,
        previous.wildflowerLodGpuUpdateRanges ?? 0,
      ),
      wildflowerLodBytesUploaded: counterDelta(
        groundcoverWork.wildflowerLodCompactionBytesUploaded ?? 0,
        previous.wildflowerLodCompactionBytesUploaded ?? 0,
      ),
      wildflowerLodReclassifications: counterDelta(
        groundcoverWork.wildflowerLodReclassifications ?? 0,
        previous.wildflowerLodReclassifications ?? 0,
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
      stabilizeDuringInteraction: true,
      minimumCameraMove:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCameraMoveMeters,
      minimumDirectionAngle: THREE.MathUtils.degToRad(
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumDirectionAngleDegrees,
      ),
      minimumProjectionChange:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumProjectionChange,
      minimumCasterBoundsChange:
        HAMLET_FOREST_ROUTE_WORK_BUDGET.minimumCasterBoundsChangeMeters,
      cameraInteractionActive: routeElapsedMs !== undefined,
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
    presentationTreatment:
      requestedVisualRouteLodSkyDirectRender
        ? {
            id:
              `groundcover-${groundcoverLodFadeMode}-live-wildflower-route`,
            rendererTreatment:
              HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
            disabledSubsystems: [
              ...requestedVisualDisabledSubsystems,
            ].sort(),
            groundcoverFadeMode: groundcoverLodFadeMode,
            groundcoverSubmission:
              'two-grass-plus-ten-spatial-wildflower-lod-meshes',
            forestRenderer:
              requestedVisualRouteForestRenderer,
            forestEdgeLayout: requestedForestEdgeLayout,
            forestUpdates:
              'frozen-after-settled-warmup',
            postProcessing:
              'disabled',
            shadowSubsystem:
              requestedVisualRouteShadowSubsystem,
          }
        : undefined,
    content: {
      residences: window.__HAMLET_FIXTURE_METRICS__.residences,
      residenceRoof: window.__HAMLET_FIXTURE_METRICS__.residenceRoof,
      trees: window.__HAMLET_FIXTURE_METRICS__.trees,
      visibleTrees: window.__HAMLET_FIXTURE_METRICS__.visibleTrees,
      forestDraws: window.__HAMLET_FIXTURE_METRICS__.forestDraws,
      forestEdgeLayer,
      underCanopyGround,
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
  if (
    envelope
    && !document.documentElement.dataset.hamletFixtureRuntimeEvidence
  ) {
    const rendererMemory = (
      renderer.info as unknown as {
        memory?: Record<string, number>;
      }
    ).memory;
    const browserMemory = (
      performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;
    document.documentElement.dataset.hamletFixtureRuntimeEvidence =
      JSON.stringify({
        bootStatus: bootState.status,
        protocol: {
          requested: envelope.protocol.requested,
          valid: envelope.protocol.valid,
          viewport: performanceReport.context.viewport,
          devicePixelRatio: performanceReport.context.devicePixelRatio,
          rendererPixelRatio: performanceReport.context.rendererPixelRatio,
        },
        route: envelope.route,
        routeWarmup: envelope.route.warmup,
        ablation: envelope.ablation,
        content: envelope.content,
        presentationTreatment: envelope.presentationTreatment ?? null,
        groundcoverWork: envelope.groundcoverWork,
        forestWork: envelope.forestWork,
        renderer: {
          ...performanceReport.renderer,
          lastFrame: { ...lastRendererFrameStats },
          memoryCounters: rendererMemory
            ? Object.fromEntries(
                Object.entries(rendererMemory).filter(
                  (entry): entry is [string, number] =>
                    Number.isFinite(entry[1]),
                ),
              )
            : null,
          renderTargets: {
            drawingBuffer: 1,
            activePostProcessingTargets: requestedVisualDisabledSubsystems
              .includes('post')
              ? 0
              : null,
            allocatedShadowMaps: sun.shadow.map ? 1 : 0,
            limitation:
              'The active Three.js backend does not expose exact render-target allocation or GPU byte totals.',
          },
        },
        browserMemory: browserMemory
          ? {
              usedJSHeapSize: browserMemory.usedJSHeapSize,
              totalJSHeapSize: browserMemory.totalJSHeapSize,
              jsHeapSizeLimit: browserMemory.jsHeapSizeLimit,
            }
          : null,
      });
  }
  if (requestedVisualRouteUpdatePair) {
    if (
      !routeUpdatePairCoordinator
      || !routeUpdatePairArmCaptureComplete
      || !canFinalizeHamletRouteUpdatePairArmEvidence(
        envelope,
        bootState.status,
      )
      || !envelope
    ) {
      return;
    }
    const completion = routeUpdatePairCoordinator.completeCurrentArm({
      performanceReport,
      completedAtPerformanceTimestampMs: performance.now(),
    });
    if (completion.advanceToNextArm) {
      window.__visualPerf?.stopFrameCollection();
      routeUpdatePairArmCaptureComplete = false;
      routeUpdatePairAwaitingFreshCollector = true;
      document.documentElement.dataset.visualRouteUpdatePairStatus =
        'collector-handoff';
      installVisualPerformanceHooksIfRequested(
        hamletVisualPerformanceApp,
      );
      return;
    }
    if (!completion.report) {
      throw new Error(
        'Route-update pair ended without paired evidence.',
      );
    }
    finalizedFixtureEvidence = {
      ...envelope,
      pairedRouteUpdateControl: completion.report,
    };
    window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
    document.documentElement.dataset.visualRouteUpdatePairStatus =
      'ready';
    document.documentElement.dataset.hamletFixtureEvidence =
      JSON.stringify(finalizedFixtureEvidence);
    installRouteFrameSequenceDomBridge();
    document.documentElement.dataset.visualRouteFrameSequenceStatus =
      'ready';
    return;
  }
  if (requestedVisualRouteLodSkyDirectRender) {
    if (routeLodSkyDirectRenderCaptureReport) {
      const collectorAudit =
        auditHamletRouteLodSkyDirectRenderCollector(
          routeLodSkyDirectRenderCaptureReport,
          performanceReport,
        );
      const serializedCollectorAudit = JSON.stringify(collectorAudit);
      if (
        document.documentElement.dataset
          .visualRouteLodSkyDirectRenderCollectorAudit
          !== serializedCollectorAudit
      ) {
        document.documentElement.dataset
          .visualRouteLodSkyDirectRenderCollectorAudit =
            serializedCollectorAudit;
      }
    }
    if (
      !canFinalizeHamletRouteLodSkyDirectRenderEvidence(
        envelope,
        routeLodSkyDirectRenderCaptureReport,
        bootState.status,
      )
      || !envelope
      || !routeLodSkyDirectRenderCaptureReport
    ) {
      return;
    }
    const routeLodSkyDirectRender =
      createHamletRouteLodSkyDirectRenderEvidence(
        routeLodSkyDirectRenderCaptureReport,
        performanceReport,
      );
    finalizedFixtureEvidence = {
      ...envelope,
      routeLodSkyDirectRender,
    };
    window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
    document.documentElement.dataset.visualRouteLodSkyDirectRenderStatus =
      'ready';
    document.documentElement.dataset.hamletFixtureEvidence =
      JSON.stringify(finalizedFixtureEvidence);
    installRouteFrameSequenceDomBridge();
    document.documentElement.dataset.visualRouteFrameSequenceStatus =
      'ready';
    return;
  }
  if (requestedVisualFrozenUpdateDirectRender) {
    if (
      !canFinalizeHamletFrozenUpdateDirectRenderEvidence(
        envelope,
        frozenUpdateDirectRenderCaptureReport,
        bootState.status,
      )
      || !envelope
      || !frozenUpdateDirectRenderCaptureReport
    ) {
      return;
    }
    const frozenUpdateDirectRender =
      createHamletFrozenUpdateDirectRenderEvidence(
        frozenUpdateDirectRenderCaptureReport,
        performanceReport,
      );
    finalizedFixtureEvidence = {
      ...envelope,
      frozenUpdateDirectRender,
    };
    window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
    document.documentElement.dataset.visualFrozenDirectRenderStatus =
      'ready';
    document.documentElement.dataset.hamletFixtureEvidence =
      JSON.stringify(finalizedFixtureEvidence);
    return;
  }
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
    if (domPublicationPairCoordinator) {
      const completion = domPublicationPairCoordinator.completeCurrentArm({
        performanceReport,
        domPublication:
          window.__visualPerf!.getDomPublicationEvidence(),
        completedAtPerformanceTimestampMs: performance.now(),
      });
      if (completion.advanceToNextArm) {
        window.__visualPerf?.stopFrameCollection();
        noUpdateShellCaptureReport = null;
        deferredDomCohortActive = false;
        domPublicationPairAwaitingFreshCollector = true;
        document.documentElement.dataset.visualDomPairStatus =
          'collector-handoff';
        installVisualPerformanceHooksIfRequested(
          hamletVisualPerformanceApp,
        );
        return;
      }
      if (!completion.report) {
        throw new Error(
          'DOM publication pair ended without paired evidence.',
        );
      }
      finalizedFixtureEvidence = {
        ...envelope,
        pairedDomPublicationControl: completion.report,
      };
      window.__HAMLET_FIXTURE_EVIDENCE__ = finalizedFixtureEvidence;
      document.documentElement.dataset.visualDomPairStatus = 'ready';
      document.documentElement.dataset.hamletFixtureEvidence =
        JSON.stringify(finalizedFixtureEvidence);
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
  if (
    requestedVisualDeferredDom
    || domPublicationPairCoordinator?.getCurrentTreatment()
      === HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT
  ) {
    return;
  }
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
  if (routeFrameSequenceDescriptor) {
    window.__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE__ = {
      ...routeFrameSequenceDescriptor,
    };
    window.__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE_READY__ =
      isRouteFrameSequenceReady;
    window.__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME__ =
      captureRouteFrameSequenceFrame;
    window.__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME_PNG__ =
      captureRouteFrameSequencePng;
  }
}

function hasTerminalRouteFrameSequenceEvidence(): boolean {
  return requestedGroundcoverTransitionEvidence
    || finalizedFixtureEvidence?.routeLodSkyDirectRender !== undefined
    || finalizedFixtureEvidence?.pairedRouteUpdateControl !== undefined;
}

function maybeInstallGroundcoverTransitionEvidenceBridge(): void {
  if (
    !requestedGroundcoverTransitionEvidence
    || !isFullVisualSystemsReady()
    || !grassField.isStreamSettled()
    || document.documentElement.dataset.visualRouteFrameSequenceStatus
      === 'ready'
  ) {
    return;
  }
  document.documentElement.dataset.visualRouteFrameSequenceStatus = 'ready';
  installRouteFrameSequenceDomBridge();
}

function isRouteFrameSequenceReady(): boolean {
  return routeFrameSequenceDescriptor !== null
    && hasTerminalRouteFrameSequenceEvidence()
    && document.documentElement.dataset.visualRouteFrameSequenceStatus
      === 'ready';
}

function installRouteFrameSequenceDomBridge(): void {
  if (
    routeFrameSequenceDomControl !== null
    || routeFrameSequenceDescriptor === null
    || !hasTerminalRouteFrameSequenceEvidence()
  ) {
    return;
  }
  const bridgeRoot = document.documentElement;
  const requestControl = document.createElement('input');
  const outputControl = document.createElement('output');
  requestControl.type = 'text';
  requestControl.inputMode = 'numeric';
  requestControl.autocomplete = 'off';
  requestControl.tabIndex = -1;
  requestControl.setAttribute(
    'data-testid',
    'hamlet-route-frame-sequence-request',
  );
  requestControl.setAttribute(
    'aria-label',
    'Route frame sequence index',
  );
  requestControl.style.position = 'fixed';
  requestControl.style.left = '0';
  requestControl.style.top = '0';
  requestControl.style.width = '2px';
  requestControl.style.height = '2px';
  requestControl.style.boxSizing = 'border-box';
  requestControl.style.padding = '0';
  requestControl.style.margin = '0';
  requestControl.style.border = '0';
  requestControl.style.opacity = '0';
  requestControl.style.zIndex = '2147483647';
  requestControl.style.pointerEvents = 'auto';
  outputControl.hidden = true;
  outputControl.setAttribute(
    'data-testid',
    'hamlet-route-frame-sequence-native-png-output',
  );
  outputControl.setAttribute('aria-hidden', 'true');
  bridgeRoot.dataset.visualRouteFrameSequenceReplayStatus = 'idle';
  const clearReplayCompletion = (): void => {
    outputControl.textContent = '';
    outputControl.removeAttribute('data-completed-index');
    outputControl.removeAttribute('data-completed-elapsed-ms');
    outputControl.removeAttribute('data-completed-signature');
    outputControl.removeAttribute('data-completed-camera-pose-signature');
    delete bridgeRoot.dataset.visualRouteFrameSequenceCompletedIndex;
    delete bridgeRoot.dataset.visualRouteFrameSequenceCompletedElapsedMs;
    delete bridgeRoot.dataset.visualRouteFrameSequenceCompletedSignature;
    delete bridgeRoot.dataset
      .visualRouteFrameSequenceCompletedCameraPoseSignature;
  };
  let lastHandledRequestIndex: string | null = null;
  let replayGeneration = 0;
  const handleReplayRequest = async (): Promise<void> => {
    const requestedIndex = requestControl.value;
    if (requestedIndex === '') {
      replayGeneration += 1;
      lastHandledRequestIndex = null;
      clearReplayCompletion();
      bridgeRoot.dataset.visualRouteFrameSequenceReplayStatus = 'idle';
      return;
    }
    if (requestedIndex === lastHandledRequestIndex) return;
    const generation = ++replayGeneration;
    lastHandledRequestIndex = requestedIndex;
    clearReplayCompletion();
    bridgeRoot.dataset.visualRouteFrameSequenceReplayStatus = 'rendering';
    try {
      const frameIndex = resolveHamletRouteFrameSequenceDomRequest(
        requestedIndex,
      );
      if (frameIndex === null) {
        throw new Error('Route frame sequence DOM request was empty.');
      }
      const completed = await captureRouteFrameSequencePng(frameIndex);
      if (
        generation !== replayGeneration
        || requestControl.value !== requestedIndex
      ) {
        return;
      }
      const completionIdentity = Object.freeze({
        index: String(completed.frame.frameIndex),
        elapsedMs: completed.frame.elapsedMs.toFixed(3),
        signature: completed.frame.signature,
        cameraPoseSignature: completed.frame.cameraPoseSignature,
      });
      outputControl.setAttribute(
        'data-completed-index',
        completionIdentity.index,
      );
      outputControl.setAttribute(
        'data-completed-elapsed-ms',
        completionIdentity.elapsedMs,
      );
      outputControl.setAttribute(
        'data-completed-signature',
        completionIdentity.signature,
      );
      outputControl.setAttribute(
        'data-completed-camera-pose-signature',
        completionIdentity.cameraPoseSignature,
      );
      outputControl.textContent = completed.dataUrl;
      bridgeRoot.dataset.visualRouteFrameSequenceCompletedIndex =
        completionIdentity.index;
      bridgeRoot.dataset.visualRouteFrameSequenceCompletedElapsedMs =
        completionIdentity.elapsedMs;
      bridgeRoot.dataset.visualRouteFrameSequenceCompletedSignature =
        completionIdentity.signature;
      bridgeRoot.dataset
        .visualRouteFrameSequenceCompletedCameraPoseSignature =
          completionIdentity.cameraPoseSignature;
      bridgeRoot.dataset.visualRouteFrameSequenceReplayStatus = 'complete';
    } catch {
      if (
        generation !== replayGeneration
        || requestControl.value !== requestedIndex
      ) {
        return;
      }
      clearReplayCompletion();
      bridgeRoot.dataset.visualRouteFrameSequenceReplayStatus = 'error';
    }
  };
  requestControl.addEventListener('input', handleReplayRequest);
  requestControl.addEventListener('change', handleReplayRequest);
  routeFrameSequenceDomControl = requestControl;
  document.body.append(requestControl, outputControl);
}

function captureRouteFrameSequenceFrame(
  frameIndex: number,
): HamletRouteFrameSequenceCapture {
  if (!isRouteFrameSequenceReady() || !routeFrameSequenceDescriptor) {
    throw new Error(
      'Route frame sequence capture requires terminal route-update evidence.',
    );
  }
  if (motionAnimationFrame !== null) {
    cancelAnimationFrame(motionAnimationFrame);
    motionAnimationFrame = null;
  }
  motionLoopEnabled = false;
  const elapsedMs = resolveHamletRouteFrameSequenceElapsedMs(frameIndex);
  seekMotionRoute(elapsedMs, 'paused', false);
  fixtureTimeSeconds = elapsedMs / 1_000;
  sky.updateCamera(camera);
  sky.updateSun(sunDirection);
  sky.updateTime(fixtureTimeSeconds);
  render(0, true, null, false, true);
  document.body.dataset.captureId = HAMLET_MOTION_ROUTE_ID;
  document.body.dataset.captureReady = 'true';
  document.documentElement.dataset.visualRouteFrameSequenceIndex =
    String(frameIndex);
  document.documentElement.dataset.visualRouteFrameSequenceElapsedMs =
    elapsedMs.toFixed(3);
  document.documentElement.dataset.visualRouteFrameSequenceSignature =
    routeFrameSequenceDescriptor.signature;
  const motion: HamletFixtureMotionState = {
    ...motionState,
    cameraPosition: [...motionState.cameraPosition],
    cameraTarget: [...motionState.cameraTarget],
    cameraOrientation: [...motionState.cameraOrientation],
    lod: { ...motionState.lod },
  };
  return {
    signature: routeFrameSequenceDescriptor.signature,
    frameIndex,
    elapsedMs,
    cameraPoseSignature: createRouteFrameCameraPoseSignature(
      frameIndex,
      elapsedMs,
      motion,
    ),
    motion,
  };
}

async function captureRouteFrameSequencePng(
  frameIndex: number,
): Promise<HamletRouteFrameNativePngCapture> {
  const frame = captureRouteFrameSequenceFrame(frameIndex);
  await rendererBackend.waitForSubmittedWork();
  const canvas = renderer.domElement;
  const rendererPixelRatio = renderer.getPixelRatio();
  if (
    canvas.width !== 1280
    || canvas.height !== 720
    || rendererPixelRatio !== 1
    || performanceProtocol?.valid !== true
  ) {
    throw new Error(
      'Native route capture requires the validated 1280x720@renderer-pr1 drawing buffer.',
    );
  }
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error(
      'Native route capture did not produce an exact PNG data URL.',
    );
  }
  return {
    frame,
    captureSurface: {
      source: 'renderer-drawing-buffer',
      protocol: '1280x720@renderer-pr1',
      width: 1280,
      height: 720,
      rendererPixelRatio: 1,
      mimeType: 'image/png',
    },
    dataUrl,
  };
}

function createRouteFrameCameraPoseSignature(
  frameIndex: number,
  elapsedMs: number,
  motion: HamletFixtureMotionState,
): string {
  const numbers = [
    ...motion.cameraPosition,
    ...motion.cameraTarget,
    ...motion.cameraOrientation,
  ].map((value) => value.toFixed(6));
  return [
    routeFrameSequenceDescriptor?.routeId ?? 'missing-route',
    frameIndex,
    elapsedMs.toFixed(3),
    ...numbers,
    motion.lod.forest,
    motion.lod.groundcover,
    motion.lod.building,
  ].join('|');
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
  renderFrame = true,
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
  if (renderFrame) render(0);
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
    if (requestedVisualRouteUpdatePair) {
      resetRouteUpdatePairVisualBaseline();
    }
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
    wildflowerLodCompactions: 0,
    wildflowerLodGpuFlagUpdates: 0,
    wildflowerLodGpuUpdateRanges: 0,
    wildflowerLodBytesUploaded: 0,
    wildflowerLodReclassifications: 0,
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

function isFreshDomPairCollectorReady(): boolean {
  return document.documentElement.dataset.visualProfileStatus === 'collecting';
}

function resetRouteUpdatePairVisualBaseline(): void {
  previousTickNowMs = 0;
  fixtureTimeSeconds = 0;
  sky.updateCamera(camera);
  sky.updateSun(sunDirection);
  sky.updateTime(0);
}

function restartRouteUpdatePairArmFromCanonicalZero(): void {
  const completedRoutesBeforeRestart = completedMotionRoutes;
  stopMotion('paused');
  if (!startMotionRoute(0, true)) {
    throw new Error(
      'Route-update pair could not restart its canonical arm baseline.',
    );
  }
  completedMotionRoutes = completedRoutesBeforeRestart;
  publishCompletedMotionRoutes();
  resetRouteUpdatePairVisualBaseline();
  render(0);
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
    const routeLodSkyTreatmentActive =
      requestedVisualRouteLodSkyDirectRender
      && routeWarmupWork.stage === 'complete'
      && frameCpuStartedAtMs !== null
      && routeLodSkyDirectRenderCapture !== null;
    const routeUpdatePairTreatmentActive =
      requestedVisualRouteUpdatePair
      && routeWarmupWork.stage === 'complete'
      && frameCpuStartedAtMs !== null
      && routeUpdatePairCoordinator !== null;
    let recordRouteLodSkyCanonicalUpdate = false;
    let recordRouteUpdatePairCanonicalUpdate = false;
    let routeUpdatePairCanonicalUpdatesEnabled = false;
    if (
      requestedVisualFrozenUpdateDirectRender
      && routeWarmupWork.stage === 'complete'
      && frameCpuStartedAtMs !== null
      && frozenUpdateDirectRenderCapture !== null
    ) {
      const treatmentStep =
        frozenUpdateDirectRenderCapture.appendRafTimestamp(nowMs);
      if (treatmentStep.armCollectorAfterCurrentFrame) {
        window.__visualPerf?.armTraceAfterCurrentFrame();
        document.documentElement.dataset.visualFrozenDirectRenderStatus =
          'judged-cohort-arming';
      } else if (
        treatmentStep.report
        && frozenUpdateDirectRenderCaptureReport === null
      ) {
        frozenUpdateDirectRenderCaptureReport = treatmentStep.report;
        document.documentElement.dataset.visualFrozenDirectRenderStatus =
          'awaiting-schema-5-report';
      }
      // The lead-in and judged cohort retain the profiled callback shell and
      // one direct-color renderer submission while skipping route, LOD, scene,
      // and sky updates. URL validation keeps forest, post, and shadows off.
      const frameBeforeRenderAtMs = performance.now();
      const frameAfterProfileRenderPathAtMs = render(
        0,
        true,
        nowMs,
        false,
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
    if (
      requestedVisualNoUpdateShell
      && routeWarmupWork.stage === 'complete'
      && frameCpuStartedAtMs !== null
      && (
        noUpdateShellCapture !== null
        || domPublicationPairCoordinator !== null
      )
    ) {
      if (
        domPublicationPairAwaitingFreshCollector
        && isFreshDomPairCollectorReady()
      ) {
        domPublicationPairAwaitingFreshCollector = false;
      }
      const activeNoUpdateShellCapture =
        domPublicationPairCoordinator ?? noUpdateShellCapture;
      const controlStep = domPublicationPairAwaitingFreshCollector
        ? null
        : activeNoUpdateShellCapture!.appendRafTimestamp(nowMs);
      if (controlStep?.armCollectorAfterCurrentFrame) {
        if (
          requestedVisualDeferredDom
          || domPublicationPairCoordinator?.getCurrentTreatment()
            === HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT
        ) {
          window.__visualPerf?.deferDomPublicationUntilReady();
          deferredDomCohortActive = true;
        }
        window.__visualPerf?.armTraceAfterCurrentFrame();
        publishNoUpdateShellStatus('judged-cohort-arming');
      } else if (controlStep?.report) {
        noUpdateShellCaptureReport = controlStep.report;
        publishNoUpdateShellStatus('awaiting-schema-5-report');
      } else if (controlStep) {
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
    if (routeUpdatePairTreatmentActive) {
      if (
        routeUpdatePairAwaitingFreshCollector
        && isFreshDomPairCollectorReady()
      ) {
        restartRouteUpdatePairArmFromCanonicalZero();
        routeUpdatePairAwaitingFreshCollector = false;
        document.documentElement.dataset.visualRouteUpdatePairStatus =
          'second-arm-lead-in';
        document.documentElement.dataset.visualRouteUpdatePairTreatment =
          routeUpdatePairCoordinator.getCurrentTreatment();
      }
      if (!routeUpdatePairAwaitingFreshCollector) {
        const currentTreatment =
          routeUpdatePairCoordinator.getCurrentTreatment();
        routeUpdatePairCanonicalUpdatesEnabled =
          currentTreatment
            !== HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT;
        const treatmentStep =
          routeUpdatePairCoordinator.appendRafTimestamp(nowMs);
        recordRouteUpdatePairCanonicalUpdate =
          treatmentStep.recordCompletedCanonicalUpdateBlock;
        if (treatmentStep.armCollectorAfterCurrentFrame) {
          window.__visualPerf?.armTraceAfterCurrentFrame();
          document.documentElement.dataset.visualRouteUpdatePairStatus =
            currentTreatment
              === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT
              ? 'off-arm-judged-cohort-arming'
              : 'on-arm-judged-cohort-arming';
        } else if (treatmentStep.captureComplete) {
          routeUpdatePairArmCaptureComplete = true;
          document.documentElement.dataset.visualRouteUpdatePairStatus =
            'awaiting-schema-5-report';
        }
      }
    }
    if (routeLodSkyTreatmentActive) {
      const treatmentStep =
        routeLodSkyDirectRenderCapture.appendRafTimestamp(nowMs);
      recordRouteLodSkyCanonicalUpdate =
        treatmentStep.recordCompletedCanonicalUpdateBlock;
      if (treatmentStep.armCollectorAfterCurrentFrame) {
        window.__visualPerf?.armTraceAfterCurrentFrame();
        document.documentElement.dataset.visualRouteLodSkyDirectRenderStatus =
          'judged-cohort-arming';
      } else if (
        treatmentStep.report
        && routeLodSkyDirectRenderCaptureReport === null
      ) {
        routeLodSkyDirectRenderCaptureReport = treatmentStep.report;
        document.documentElement.dataset.visualRouteLodSkyDirectRenderStatus =
          'awaiting-schema-5-report';
      }
    }
    let dtMs = 0;
    const canonicalSceneUpdateBlockEnabled =
      !routeUpdatePairTreatmentActive
      || routeUpdatePairCanonicalUpdatesEnabled;
    if (canonicalSceneUpdateBlockEnabled) {
      dtMs = previousTickNowMs === 0
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
    if (recordRouteLodSkyCanonicalUpdate) {
      if (motionState.status !== 'running') {
        throw new Error(
          'Canonical route stopped during its measured update block.',
        );
      }
      routeLodSkyDirectRenderCapture!.recordCompletedCanonicalUpdateBlock({
        routeId: HAMLET_MOTION_ROUTE_ID,
        routeStatus: 'running',
        routeElapsedMs: motionState.elapsedMs,
        routeCycle: lastMotionRouteCycle,
        phase: motionState.lod.building,
        lod: { ...motionState.lod },
        forest: { ...latestForestFrameWork },
        groundcoverDelta: { ...latestGroundcoverFrameDelta },
      });
    }
      if (recordRouteUpdatePairCanonicalUpdate) {
        if (motionState.status !== 'running') {
          throw new Error(
            'Route-update pair stopped during its measured ON update block.',
          );
        }
        routeUpdatePairCoordinator!.recordCompletedCanonicalUpdateBlock({
          routeId: HAMLET_MOTION_ROUTE_ID,
          routeStatus: 'running',
          routeElapsedMs: motionState.elapsedMs,
          routeCycle: lastMotionRouteCycle,
          phase: motionState.lod.building,
          lod: { ...motionState.lod },
          forest: { ...latestForestFrameWork },
          groundcoverDelta: { ...latestGroundcoverFrameDelta },
        });
      }
    }
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
      routeLodSkyTreatmentActive || routeUpdatePairTreatmentActive,
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
    if (
      (
        requestedVisualRouteLodSkyDirectRender
        || requestedVisualRouteUpdatePair
      )
      && finalizedFixtureEvidence
      && motionAnimationFrame !== null
    ) {
      cancelAnimationFrame(motionAnimationFrame);
      motionAnimationFrame = null;
    }
  };
  motionAnimationFrame = requestAnimationFrame(tick);
}

function render(
  dt = 0,
  profileRenderSubmission = false,
  profileFrameRafTimestampMs: number | null = null,
  skipProfilePostProcessorRender = false,
  directColorSceneRender = false,
): number | null {
  const rendererInfo = renderer.info as unknown as RendererInfoLike;
  const rendererFrameBoundary = beginRendererFrame(rendererInfo);
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
    sun.shadow.needsUpdate = true;
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
      if (directColorSceneRender) renderer.render(scene, camera);
      else postProcessor.render(dt);
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
  lastRendererFrameStats = readRendererFrameStats(
    rendererInfo,
    rendererFrameBoundary,
  );

  const forestStats = getSeedThreeForestStructuralStats(forest);
  const structural = countFixtureStructuralSubmissions(scene, camera);
  const metrics: HamletFixtureMetrics = {
    fixtureId: HAMLET_FIXTURE_ID,
    seed: HAMLET_FIXTURE_SEED,
    view: activeViewId,
    renderer: rendererBackend.kind,
    residences: residences.length,
    residenceRoof: 'tier-1-bundled-thatch',
    roadArms: HAMLET_ROAD_ARMS.length,
    fields: HAMLET_FIELD_SPECS.length,
    trees: forestStats.trees.totalTrees,
    visibleTrees: forestStats.trees.visibleTrees,
    forestDraws: forestStats.draws,
    forestEdgeLayer,
    underCanopyGround,
    drawCalls: structural.draws,
    triangles: structural.triangles,
    staticBatching: {
      roads: { ...roadBatch.stats },
      settlement: { ...settlementBatch.stats },
      fields: { ...fieldBatch.stats },
      structureShadows: structureShadowBatch.getStats(),
    },
    motion: motionState,
  };
  window.__HAMLET_FIXTURE_METRICS__ = metrics;
  maybeFinalizeFixtureEvidence();
  maybeInstallGroundcoverTransitionEvidenceBridge();
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
