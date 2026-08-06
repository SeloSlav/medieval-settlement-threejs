import type { GrassStreamTelemetry } from '../grass/GrassBladeField.ts';
import {
  HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
  HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
  HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE,
  HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
  HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
  HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  HAMLET_FOREST_EDGE_CLUSTER_SIZE,
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
  HAMLET_FOREST_EDGE_LAYOUT_LEGACY,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS,
  HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS,
  HAMLET_FOREST_THICKET_CLUSTER_COUNT,
  HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
  HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
  HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE,
  HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
  HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
  HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
  type HamletForestEdgeLayerEvidence,
  type HamletForestEdgeLayout,
} from './hamletForestEdgeLayer.ts';
import type {
  HamletUnderCanopyGroundEvidence,
} from './hamletUnderCanopyGround.ts';
import {
  calculateVisualPerformanceMetrics,
  type ProfileSubsystem,
  type VisualPerformanceDomPublicationEvidence,
  type VisualPerformanceMetrics,
  type VisualPerformanceReport,
  type VisualSlowFrameContext,
} from './visualPerformanceHooks.ts';

export const HAMLET_PERFORMANCE_VIEWPORT = Object.freeze({
  width: 1280,
  height: 720,
  rendererPixelRatio: 1,
  label: '1280x720@renderer-pr1' as const,
});

export const HAMLET_FOREST_ROUTE_WORK_BUDGET = Object.freeze({
  maxBucketCompactionsPerFrame: 1,
  maxUpdateDurationMs: 2,
  maxMatrixWritesPerChunk: 128,
  minimumCameraMoveMeters: 8,
  minimumDirectionAngleDegrees: 2.5,
  minimumProjectionChange: 0.005,
  minimumCasterBoundsChangeMeters: 0.75,
});

export const HAMLET_ABLATION_IDS = [
  'baseline',
  'route-warmup',
  'forest-selection-frozen',
  'groundcover-stream-frozen',
  'groundcover-stream-forest-update-frozen',
  'groundcover-off',
  'post-off',
  'shadows-off',
  'forest-render-off',
  'heavy-render-off',
] as const;

export type HamletAblationId = (typeof HAMLET_ABLATION_IDS)[number];

export type HamletFixtureAblation = {
  id: HamletAblationId;
  disabledSubsystems: readonly ProfileSubsystem[];
  forestSelection: 'budgeted' | 'frozen' | 'disabled';
  forestUpdates: 'active' | 'frozen-after-settled-warmup';
  groundcoverStreaming: 'active' | 'frozen';
  routeWarmup: 'none' | 'full-route';
};

export const HAMLET_BARE_RAF_WINDOW_MS = 30_000;
export const HAMLET_BARE_RAF_LEAD_IN_MS = 250;

export const HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS = Object.freeze([
  'forest',
  'post',
  'shadows',
] as const satisfies readonly ProfileSubsystem[]);

export type HamletPerformancePairIdentity = {
  runUuid: string;
  performanceTimeOriginMs: number;
};

export type HamletDegradedNoRenderArmEvidence = HamletPerformancePairIdentity & {
  arm: 'degraded-no-render';
  sequenceIndex: 1;
  completedAtPerformanceTimestampMs: number;
  performanceReport: VisualPerformanceReport;
};

export type HamletBareRafLeadInEvidence = HamletPerformancePairIdentity & {
  phase: 'bare-raf-lead-in';
  beforeArm: 'bare-raf-only';
  declaredDurationMs: 250;
  startedAtRafTimestampMs: number;
  completedAtRafTimestampMs: number;
  elapsedMs: number;
  sampleCount: number;
  frameTimesMs: readonly number[];
  forbiddenWork: {
    routeSceneUpdates: 0;
    rendererCalls: 0;
    perFrameDomTelemetryWrites: 0;
  };
};

export type HamletBareRafArmEvidence = HamletPerformancePairIdentity & {
  arm: 'bare-raf-only';
  sequenceIndex: 2;
  windowSeconds: 30;
  startedAtRafTimestampMs: number;
  completedAtRafTimestampMs: number;
  elapsedMs: number;
  sampleCount: number;
  frameTimesMs: readonly number[];
  metrics: VisualPerformanceMetrics;
  forbiddenWork: {
    routeSceneUpdates: 0;
    rendererCalls: 0;
    perFrameDomTelemetryWrites: 0;
  };
};

export type HamletBareRafCaptureEvidence = {
  leadIn: HamletBareRafLeadInEvidence;
  bareRaf: HamletBareRafArmEvidence;
};

export const HAMLET_NO_UPDATE_SHELL_WINDOW_MS = 30_000;
export const HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS = 250;

export const HAMLET_NO_UPDATE_SHELL_TREATMENT =
  'profiled-no-update-no-render-shell' as const;
export const HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT =
  'profiled-no-update-no-render-shell-deferred-dom' as const;
export const HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT =
  'profiled-frozen-update-direct-color-render' as const;
export const HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT =
  'profiled-canonical-route-lod-scene-sky-direct-color-render' as const;
export const HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT =
  'same-document-randomized-canonical-route-update-paired-reversion' as const;
export const HAMLET_ROUTE_SEQUENCE_CAPTURE_FPS = 30;
export const HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED =
  'disabled' as const;
export const HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED =
  'existing-shadow-subsystem-enabled' as const;
export const HAMLET_ROUTE_FOREST_RENDERER_DISABLED =
  'disabled' as const;
export const HAMLET_ROUTE_FOREST_RENDERER_ENABLED =
  'existing-forest-renderer-enabled' as const;

export type HamletRouteShadowSubsystem =
  | typeof HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED
  | typeof HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED;

export type HamletRouteForestRenderer =
  | typeof HAMLET_ROUTE_FOREST_RENDERER_DISABLED
  | typeof HAMLET_ROUTE_FOREST_RENDERER_ENABLED;

export type HamletNoUpdateShellTreatment =
  | typeof HAMLET_NO_UPDATE_SHELL_TREATMENT
  | typeof HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT;

type HamletNoUpdateShellSkippedWork = {
  motionRouteUpdates: 0;
  lodSceneUpdates: 0;
  skyUpdates: 0;
  renderSubmissions: 0;
};

const HAMLET_NO_UPDATE_SHELL_SKIPPED_WORK = Object.freeze({
  motionRouteUpdates: 0,
  lodSceneUpdates: 0,
  skyUpdates: 0,
  renderSubmissions: 0,
} as const satisfies HamletNoUpdateShellSkippedWork);

export type HamletNoUpdateShellLeadInEvidence =
  HamletPerformancePairIdentity & {
    treatment: HamletNoUpdateShellTreatment;
    phase: 'lead-in';
    declaredDurationMs: 250;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    skippedWork: HamletNoUpdateShellSkippedWork;
  };

export type HamletNoUpdateShellCohortEvidence =
  HamletPerformancePairIdentity & {
    treatment: HamletNoUpdateShellTreatment;
    phase: 'judged-cohort';
    windowSeconds: 30;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    metrics: VisualPerformanceMetrics;
    skippedWork: HamletNoUpdateShellSkippedWork;
    retainedShell: {
      schemaVersion: 5;
      rafScheduling: 'requestAnimationFrame';
      collector: 'visual-performance-hooks';
      postamble: 'telemetry-evidence-dom';
      domPublication?: 'terminal-only-after-freeze';
      inMemoryReportCadence?: '500ms';
      jsonSerialization?: 'every-in-memory-report';
    };
  };

export type HamletNoUpdateShellCaptureEvidence = {
  schemaVersion: 1;
  treatment: HamletNoUpdateShellTreatment;
  leadInToCohortGapMs: number;
  leadIn: HamletNoUpdateShellLeadInEvidence;
  judgedCohort: HamletNoUpdateShellCohortEvidence;
  deferredDom?: {
    mode: 'terminal-only-after-freeze';
    cohortDomMutations: 0;
    statusDatasets: 'deferred';
    schema5DatasetPublication: 'deferred';
    metricsTextContent: 'deferred';
  };
};

export type HamletNoUpdateShellEvidence = HamletNoUpdateShellCaptureEvidence & {
  collectorAgreement: {
    schemaVersion: 5;
    exactSampleCount: true;
    exactMetrics: true;
    zeroRendererSubmissions: true;
    domPublication?: VisualPerformanceDomPublicationEvidence;
  };
};

type HamletFrozenUpdateDirectRenderSkippedWork = {
  motionRouteUpdates: 0;
  lodSceneUpdates: 0;
  skyUpdates: 0;
};

const HAMLET_FROZEN_UPDATE_DIRECT_RENDER_SKIPPED_WORK = Object.freeze({
  motionRouteUpdates: 0,
  lodSceneUpdates: 0,
  skyUpdates: 0,
} as const satisfies HamletFrozenUpdateDirectRenderSkippedWork);

const HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH = Object.freeze({
  mode: 'direct-color-scene' as const,
  submission: 'renderer.render(scene,camera)' as const,
  postProcessing: false as const,
});

export type HamletFrozenUpdateDirectRenderLeadInEvidence =
  HamletPerformancePairIdentity & {
    treatment: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT;
    phase: 'lead-in';
    declaredDurationMs: 250;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    skippedWork: HamletFrozenUpdateDirectRenderSkippedWork;
    retainedRender: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH;
  };

export type HamletFrozenUpdateDirectRenderCohortEvidence =
  HamletPerformancePairIdentity & {
    treatment: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT;
    phase: 'judged-cohort';
    windowSeconds: 30;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    metrics: VisualPerformanceMetrics;
    skippedWork: HamletFrozenUpdateDirectRenderSkippedWork;
    retainedRender: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH;
    retainedShell: {
      schemaVersion: 5;
      rafScheduling: 'requestAnimationFrame';
      collector: 'visual-performance-hooks';
      postamble: 'telemetry-evidence-dom';
      gpuTimestamp: 'required-when-supported';
    };
  };

export type HamletFrozenUpdateDirectRenderCaptureEvidence = {
  schemaVersion: 1;
  treatment: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT;
  leadInToCohortGapMs: number;
  leadIn: HamletFrozenUpdateDirectRenderLeadInEvidence;
  judgedCohort: HamletFrozenUpdateDirectRenderCohortEvidence;
};

type HamletDirectRenderCollectorAgreement<
  Shadows extends boolean,
  Forest extends boolean = false,
> = {
  schemaVersion: 5;
  exactSampleCount: true;
  exactMetrics: true;
  actualRendererSubmissions: true;
  renderer: VisualPerformanceReport['renderer'];
  subsystems: {
    post: false;
    shadows: Shadows;
    forest: Forest;
    sky: true;
    groundcover: true;
  };
  gpuTimestamp: {
    status: 'available' | 'unavailable';
    source: 'webgpu-timestamp-query' | 'unavailable';
    span: 'full-post-processing-queue-bookends' | 'unavailable';
    attemptedFrames: number;
    submittedFrames: number;
    resolvedFrames: number;
    retainedAvailableRecords: number;
    retainedUnavailableRecordsWithLimitations: number;
    spanInterpretation:
      'schema-5 queue bookends surround the direct-color renderer submission because post is disabled';
    limitations: readonly string[];
  };
};

export type HamletFrozenUpdateDirectRenderEvidence =
  HamletFrozenUpdateDirectRenderCaptureEvidence & {
    collectorAgreement: HamletDirectRenderCollectorAgreement<false>;
  };

const HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_UPDATES = Object.freeze({
  motionRoute: 'canonical-loop' as const,
  lodScene: 'updateSceneLods' as const,
  sky: Object.freeze([
    'updateCamera',
    'updateSun',
    'updateTime',
  ] as const),
});

export type HamletRouteLodSkyFrameUpdate = {
  routeId: 'gorski-kotar-lod-traverse-v1';
  routeStatus: 'running';
  routeElapsedMs: number;
  routeCycle: number;
  phase: VisualSlowFrameContext['phase'];
  lod: {
    forest: 'overview' | 'near';
    groundcover: 'hidden' | 'transition' | 'full';
    building: VisualSlowFrameContext['phase'];
  };
  forest: VisualSlowFrameContext['forest'];
  groundcoverDelta: VisualSlowFrameContext['groundcoverDelta'];
};

export type HamletRouteLodSkyUpdateSummary = {
  updateCounts: {
    motionRoute: number;
    lodScene: number;
    sky: {
      camera: number;
      sun: number;
      time: number;
    };
  };
  phaseFrameCounts: Record<VisualSlowFrameContext['phase'], number>;
  phaseSequence: readonly VisualSlowFrameContext['phase'][];
  lodStatesTraversed: {
    forest: readonly HamletRouteLodSkyFrameUpdate['lod']['forest'][];
    groundcover: readonly HamletRouteLodSkyFrameUpdate['lod']['groundcover'][];
    building: readonly HamletRouteLodSkyFrameUpdate['lod']['building'][];
  };
  route: {
    firstElapsedMs: number | null;
    lastElapsedMs: number | null;
    minElapsedMs: number | null;
    maxElapsedMs: number | null;
    wrapCount: number;
    cycles: readonly number[];
  };
  frozenVegetationWork: {
    forest: {
      selectionChanges: number;
      workChunks: number;
      matrixWrites: number;
      bucketUploads: number;
      maxPendingBuckets: number;
      selectorSkippedFrames: number;
    };
    groundcover: {
      generationSubsteps: number;
      clearWriteSubsteps: number;
      refreshes: number;
      gpuFlagUpdates: number;
      gpuUpdateRanges: number;
      bytesUploaded: number;
      completedSlots: number;
      cancelledSlots: number;
      maxPendingSlots: number;
    };
  };
};

export type HamletRouteFrameSequenceDescriptor = {
  schemaVersion: 1;
  routeId: 'gorski-kotar-lod-traverse-v1';
  durationMs: 21_000;
  framesPerSecond: 30;
  frameCount: 631;
  ordering: 'frame-index-ascending';
  renderer: 'direct-color-scene';
  vegetation:
    | 'frozen-groundcover-forest-work-with-forest-render-disabled'
    | 'frozen-groundcover-and-forest-update-work-with-forest-render-enabled';
  forestRenderer: HamletRouteForestRenderer;
  forestEdgeLayout?: HamletForestEdgeLayout;
  forestUpdates: 'frozen-after-settled-warmup';
  postProcessing: 'disabled';
  shadowSubsystem: HamletRouteShadowSubsystem;
  signature: string;
};

export type HamletRouteLodSkyDirectRenderLeadInEvidence =
  HamletPerformancePairIdentity & {
    treatment: typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;
    phase: 'lead-in';
    declaredDurationMs: 250;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    retainedUpdates: typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_UPDATES;
    updates: HamletRouteLodSkyUpdateSummary;
    retainedRender: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH;
  };

export type HamletRouteLodSkyDirectRenderCohortEvidence =
  HamletPerformancePairIdentity & {
    treatment: typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;
    phase: 'judged-cohort';
    windowSeconds: 30;
    startedAtRafTimestampMs: number;
    completedAtRafTimestampMs: number;
    elapsedMs: number;
    sampleCount: number;
    frameTimesMs: readonly number[];
    metrics: VisualPerformanceMetrics;
    retainedUpdates: typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_UPDATES;
    updates: HamletRouteLodSkyUpdateSummary;
    retainedRender: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH;
    retainedShell: {
      schemaVersion: 5;
      rafScheduling: 'requestAnimationFrame';
      collector: 'visual-performance-hooks';
      postamble: 'telemetry-evidence-dom';
      gpuTimestamp: 'required-when-supported';
    };
  };

export type HamletRouteLodSkyDirectRenderCaptureEvidence = {
  schemaVersion: 1;
  treatment: typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;
  forestRenderer: HamletRouteForestRenderer;
  forestEdgeLayout?: HamletForestEdgeLayout;
  forestUpdates: 'frozen-after-settled-warmup';
  postProcessing: 'disabled';
  shadowSubsystem: HamletRouteShadowSubsystem;
  leadInToCohortGapMs: number;
  leadIn: HamletRouteLodSkyDirectRenderLeadInEvidence;
  judgedCohort: HamletRouteLodSkyDirectRenderCohortEvidence;
  routeFrameSequence: HamletRouteFrameSequenceDescriptor;
};

export type HamletRouteLodSkyDirectRenderEvidence =
  HamletRouteLodSkyDirectRenderCaptureEvidence & {
    collectorAgreement: HamletDirectRenderCollectorAgreement<boolean, boolean>;
  };

export type HamletRouteLodSkyCollectorAudit = {
  matches: boolean;
  failures: string[];
  captureSampleCount: number;
  collectorSampleCount: number;
  captureMetrics: VisualPerformanceMetrics;
  collectorMetrics: VisualPerformanceMetrics;
  captureForestEdgeLayout: HamletForestEdgeLayout | null;
  captureSequenceSignature: string;
  expectedSequenceSignature: string;
};

export type HamletRouteUpdatePairTreatment =
  | typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT
  | typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;

type HamletRouteUpdatePairCounts = {
  motionRoute: number;
  lodScene: number;
  sky: {
    camera: number;
    sun: number;
    time: number;
  };
};

type HamletRouteUpdatePairArmCommon = {
  sequenceIndex: 1 | 2;
  collectorGeneration: 1 | 2;
  completedAtPerformanceTimestampMs: number;
  performanceReport: VisualPerformanceReport;
};

export type HamletRouteUpdatePairOffArmEvidence =
  HamletFrozenUpdateDirectRenderEvidence
  & HamletRouteUpdatePairArmCommon
  & {
    canonicalUpdateBlock: {
      enabled: false;
      judgedIntervalCount: number;
      updateCounts: HamletRouteUpdatePairCounts;
      exactUpdatesPerJudgedInterval: true;
      phaseAndLodCoverage: 'not-applicable-update-block-off';
    };
  };

export type HamletRouteUpdatePairOnArmEvidence =
  HamletRouteLodSkyDirectRenderEvidence
  & HamletRouteUpdatePairArmCommon
  & {
    canonicalUpdateBlock: {
      enabled: true;
      judgedIntervalCount: number;
      updateCounts: HamletRouteUpdatePairCounts;
      exactUpdatesPerJudgedInterval: true;
      phaseAndLodCoverage: true;
    };
  };

export type HamletRouteUpdatePairArmEvidence =
  | HamletRouteUpdatePairOffArmEvidence
  | HamletRouteUpdatePairOnArmEvidence;

export type HamletRouteUpdatePairEvidence =
  HamletPerformancePairIdentity & {
    schemaVersion: 1;
    experiment: typeof HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT;
    randomization: {
      source: 'crypto.getRandomValues-uint32-low-bit';
      drawUint32: number;
      orderBit: 0 | 1;
    };
    randomizedOrder: readonly [
      HamletRouteUpdatePairTreatment,
      HamletRouteUpdatePairTreatment,
    ];
    arms: readonly [
      HamletRouteUpdatePairArmEvidence,
      HamletRouteUpdatePairArmEvidence,
    ];
    armHandoffGapsMs: {
      firstCohortEndToSecondLeadInStart: number;
      firstTerminalFreezeToSecondLeadInStart: number;
    };
    controlledDifference: {
      canonicalRouteLodSceneSkyUpdates: 'off-vs-on';
      renderer: typeof HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH;
      vegetation: 'frozen';
      disabledSubsystems: readonly ['forest', 'post', 'shadows'];
      schemaVersion: 5;
      gpuTimestamp: 'identical-required-when-supported';
    };
    agreements: {
      sharedDocumentIdentity: true;
      freshSchema5CollectorPerArm: true;
      completeOrderedRafIntervalsPerArm: true;
      exactLeadInAndCohortPerArm: true;
      rendererSubmissionsPerArm: true;
      subsystemStatePerArm: true;
      gpuStatusSourceAndSpan: true;
      offUpdateCountsZero: true;
      onUpdatesExactlyOncePerInterval: true;
      onPhaseAndLodCoverage: true;
    };
  };

export type HamletDomPublicationPairArmEvidence =
  HamletNoUpdateShellEvidence & {
    sequenceIndex: 1 | 2;
    completedAtPerformanceTimestampMs: number;
    performanceReport: VisualPerformanceReport;
  };

export type HamletDomPublicationPairEvidence =
  HamletPerformancePairIdentity & {
    schemaVersion: 1;
    experiment:
      'same-document-randomized-dom-publication-paired-reversion';
    randomization: {
      source: 'crypto.getRandomValues-uint32-low-bit';
      drawUint32: number;
      orderBit: 0 | 1;
    };
    randomizedOrder: readonly [
      HamletNoUpdateShellTreatment,
      HamletNoUpdateShellTreatment,
    ];
    arms: readonly [
      HamletDomPublicationPairArmEvidence,
      HamletDomPublicationPairArmEvidence,
    ];
    armHandoffGapsMs: {
      firstCohortEndToSecondLeadInStart: number;
      firstTerminalFreezeToSecondLeadInStart: number;
    };
  };

export type HamletPairedRafControlEvidence = {
  schemaVersion: 2;
  sequence: 'degraded-no-render-then-bare-raf';
  transitionGapMs: number;
  leadInStartGapMs: number;
  leadInToBareRafGapMs: number;
  degradedNoRender: HamletDegradedNoRenderArmEvidence;
  bareRafLeadIn: HamletBareRafLeadInEvidence;
  bareRaf: HamletBareRafArmEvidence;
};

export function resolveHamletBareRafPairRequest(input: {
  requested: boolean;
  visualProfile: boolean;
  visualNoRender: boolean;
  routeId: string | null;
  ablationId: HamletAblationId;
  disabledSubsystems: readonly string[];
}): boolean {
  if (!input.requested) return false;
  const disabledSubsystems = [...input.disabledSubsystems].sort();
  const requiredDisabledSubsystems = [
    ...HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  ].sort();
  if (
    !input.visualProfile
    || !input.visualNoRender
    || input.routeId !== 'gorski-kotar-lod-traverse-v1'
    || input.ablationId !== 'groundcover-stream-forest-update-frozen'
    || disabledSubsystems.length !== requiredDisabledSubsystems.length
    || disabledSubsystems.some(
      (subsystem, index) => subsystem !== requiredDisabledSubsystems[index],
    )
  ) {
    throw new Error(
      'visualBareRafPair=1 requires the exact Round 32 degraded no-render '
      + 'arm: canonical route, frozen forest/groundcover ablation, '
      + 'visualNoRender=1, and visualDisable=forest,post,shadows.',
    );
  }
  return true;
}

export function resolveHamletNoUpdateShellRequest(input: {
  requested: boolean;
  visualProfile: boolean;
  visualNoRender: boolean;
  visualBareRafPair: boolean;
  routeId: string | null;
  ablationId: HamletAblationId;
  disabledSubsystems: readonly string[];
}): boolean {
  if (!input.requested) return false;
  const disabledSubsystems = [...input.disabledSubsystems].sort();
  const requiredDisabledSubsystems = [
    ...HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  ].sort();
  if (
    !input.visualProfile
    || !input.visualNoRender
    || input.visualBareRafPair
    || input.routeId !== 'gorski-kotar-lod-traverse-v1'
    || input.ablationId !== 'groundcover-stream-forest-update-frozen'
    || disabledSubsystems.length !== requiredDisabledSubsystems.length
    || disabledSubsystems.some(
      (subsystem, index) => subsystem !== requiredDisabledSubsystems[index],
    )
  ) {
    throw new Error(
      'visualNoUpdateShell=1 requires the exact degraded no-render treatment '
      + 'without visualBareRafPair: canonical route, frozen forest/groundcover '
      + 'ablation, visualNoRender=1, and visualDisable=forest,post,shadows.',
    );
  }
  return true;
}

export function resolveHamletFrozenUpdateDirectRenderRequest(input: {
  requested: boolean;
  visualProfile: boolean;
  visualNoRender: boolean;
  visualBareRafPair: boolean;
  visualNoUpdateShell: boolean;
  gpuTimestampMarkersEnabled: boolean;
  routeId: string | null;
  ablationId: HamletAblationId;
  disabledSubsystems: readonly string[];
}): boolean {
  if (!input.requested) return false;
  const disabledSubsystems = [...input.disabledSubsystems].sort();
  const requiredDisabledSubsystems = [
    ...HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  ].sort();
  if (
    !input.visualProfile
    || input.visualNoRender
    || input.visualBareRafPair
    || input.visualNoUpdateShell
    || !input.gpuTimestampMarkersEnabled
    || input.routeId !== 'gorski-kotar-lod-traverse-v1'
    || input.ablationId !== 'groundcover-stream-forest-update-frozen'
    || disabledSubsystems.length !== requiredDisabledSubsystems.length
    || disabledSubsystems.some(
      (subsystem, index) => subsystem !== requiredDisabledSubsystems[index],
    )
  ) {
    throw new Error(
      'visualFrozenDirectRender=1 requires one exact render-on treatment: '
      + 'visualProfile=1, canonical route, frozen forest/groundcover '
      + 'ablation, visualDisable=forest,post,shadows, timestamp markers on, '
      + 'and no no-render, bare-rAF, or no-update-shell control.',
    );
  }
  return true;
}

export function resolveHamletRouteLodSkyDirectRenderRequest(input: {
  requested: boolean;
  visualProfile: boolean;
  visualNoRender: boolean;
  visualBareRafPair: boolean;
  visualNoUpdateShell: boolean;
  visualFrozenDirectRender: boolean;
  gpuTimestampMarkersEnabled: boolean;
  routeId: string | null;
  ablationId: HamletAblationId;
  disabledSubsystems: readonly string[];
}): boolean {
  if (!input.requested) return false;
  const disabledSubsystems = [...input.disabledSubsystems].sort();
  const shadowsDisabledSubsystems = ['forest', 'post', 'shadows'];
  const forestDisabledShadowsEnabledSubsystems = ['forest', 'post'];
  const forestEnabledShadowsEnabledSubsystems = ['post'];
  const exactShadowsDisabled =
    disabledSubsystems.length === shadowsDisabledSubsystems.length
    && disabledSubsystems.every(
      (subsystem, index) =>
        subsystem === shadowsDisabledSubsystems[index],
    );
  const exactForestDisabledShadowsEnabled =
    disabledSubsystems.length
      === forestDisabledShadowsEnabledSubsystems.length
    && disabledSubsystems.every(
      (subsystem, index) =>
        subsystem === forestDisabledShadowsEnabledSubsystems[index],
    );
  const exactForestEnabledShadowsEnabled =
    disabledSubsystems.length
      === forestEnabledShadowsEnabledSubsystems.length
    && disabledSubsystems.every(
      (subsystem, index) =>
        subsystem === forestEnabledShadowsEnabledSubsystems[index],
    );
  if (
    !input.visualProfile
    || input.visualNoRender
    || input.visualBareRafPair
    || input.visualNoUpdateShell
    || input.visualFrozenDirectRender
    || !input.gpuTimestampMarkersEnabled
    || input.routeId !== 'gorski-kotar-lod-traverse-v1'
    || input.ablationId !== 'groundcover-stream-forest-update-frozen'
    || (
      !exactShadowsDisabled
      && !exactForestDisabledShadowsEnabled
      && !exactForestEnabledShadowsEnabled
    )
  ) {
    throw new Error(
      'visualRouteLodSkyDirectRender=1 requires one exact route-update '
      + 'treatment: visualProfile=1, canonical route, frozen forest/groundcover '
      + 'ablation, visualDisable=forest,post,shadows; forest,post; or post '
      + 'for the controlled shadow and forest renderer restorations, '
      + 'timestamp markers on, '
      + 'and no no-render, bare-rAF, no-update-shell, or frozen-update '
      + 'direct-render control.',
    );
  }
  return true;
}

export function resolveHamletRouteUpdatePairRequest(input: {
  requested: boolean;
  visualProfile: boolean;
  visualNoRender: boolean;
  visualBareRafPair: boolean;
  visualNoUpdateShell: boolean;
  visualFrozenDirectRender: boolean;
  visualRouteLodSkyDirectRender: boolean;
  gpuTimestampMarkersEnabled: boolean;
  routeId: string | null;
  ablationId: HamletAblationId;
  disabledSubsystems: readonly string[];
}): boolean {
  if (!input.requested) return false;
  const disabledSubsystems = [...input.disabledSubsystems].sort();
  const requiredDisabledSubsystems = [
    ...HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  ].sort();
  if (
    !input.visualProfile
    || input.visualNoRender
    || input.visualBareRafPair
    || input.visualNoUpdateShell
    || input.visualFrozenDirectRender
    || input.visualRouteLodSkyDirectRender
    || !input.gpuTimestampMarkersEnabled
    || input.routeId !== 'gorski-kotar-lod-traverse-v1'
    || input.ablationId !== 'groundcover-stream-forest-update-frozen'
    || disabledSubsystems.length !== requiredDisabledSubsystems.length
    || disabledSubsystems.some(
      (subsystem, index) => subsystem !== requiredDisabledSubsystems[index],
    )
  ) {
    throw new Error(
      'visualRouteUpdatePair=1 requires one exact paired treatment: '
      + 'visualProfile=1, canonical route, frozen forest/groundcover '
      + 'ablation, visualDisable=forest,post,shadows, timestamp markers on, '
      + 'and no no-render, bare-rAF, no-update-shell, frozen-update, or '
      + 'fixed route-update control.',
    );
  }
  return true;
}

export function resolveHamletRouteUpdatePairOrder(
  drawUint32: number,
): readonly [
  HamletRouteUpdatePairTreatment,
  HamletRouteUpdatePairTreatment,
] {
  if (
    !Number.isInteger(drawUint32)
    || drawUint32 < 0
    || drawUint32 > 0xffff_ffff
  ) {
    throw new Error(
      'Route-update pair randomization requires one unsigned 32-bit draw.',
    );
  }
  return (drawUint32 & 1) === 0
    ? [
        HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
        HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
      ]
    : [
        HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
        HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
      ];
}

export function createHamletRouteFrameSequenceDescriptor(
  shadowSubsystem:
    HamletRouteShadowSubsystem =
      HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
  forestRenderer:
    HamletRouteForestRenderer =
      HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
  forestEdgeLayout?: HamletForestEdgeLayout,
): HamletRouteFrameSequenceDescriptor {
  const shadowsEnabled =
    shadowSubsystem === HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED;
  const forestEnabled =
    forestRenderer === HAMLET_ROUTE_FOREST_RENDERER_ENABLED;
  if (forestEnabled && !shadowsEnabled) {
    throw new Error(
      'The forest-renderer restoration requires the existing shadow subsystem.',
    );
  }
  const baseSignature =
    forestEnabled
      ? 'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|groundcover-and-forest-updates-frozen|forest-render-on|post-disabled|shadows-on'
      : shadowsEnabled
      ? 'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|frozen-vegetation|forest-post-disabled-shadows-on'
      : 'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|frozen-vegetation|forest-post-shadows-off';
  return {
    schemaVersion: 1,
    routeId: 'gorski-kotar-lod-traverse-v1',
    durationMs: 21_000,
    framesPerSecond: HAMLET_ROUTE_SEQUENCE_CAPTURE_FPS,
    frameCount: 631,
    ordering: 'frame-index-ascending',
    renderer: 'direct-color-scene',
    vegetation:
      forestEnabled
        ? 'frozen-groundcover-and-forest-update-work-with-forest-render-enabled'
        : 'frozen-groundcover-forest-work-with-forest-render-disabled',
    forestRenderer,
    ...(forestEdgeLayout ? { forestEdgeLayout } : {}),
    forestUpdates: 'frozen-after-settled-warmup',
    postProcessing: 'disabled',
    shadowSubsystem,
    signature: forestEdgeLayout
      ? `${baseSignature}|forest-edge=${forestEdgeLayout}`
      : baseSignature,
  };
}

export function resolveHamletRouteFrameSequenceElapsedMs(
  frameIndex: number,
): number {
  const descriptor = createHamletRouteFrameSequenceDescriptor();
  if (
    !Number.isInteger(frameIndex)
    || frameIndex < 0
    || frameIndex >= descriptor.frameCount
  ) {
    throw new Error(
      `Route frame index must be an integer from 0 to ${descriptor.frameCount - 1}.`,
    );
  }
  return Math.min(
    descriptor.durationMs,
    frameIndex * 1_000 / descriptor.framesPerSecond,
  );
}

export function resolveHamletRouteFrameSequenceDomRequest(
  requestIndex: string | null,
): number | null {
  if (requestIndex === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(requestIndex)) {
    throw new Error(
      'Route frame sequence DOM requests require one canonical integer index.',
    );
  }
  const frameIndex = Number(requestIndex);
  resolveHamletRouteFrameSequenceElapsedMs(frameIndex);
  return frameIndex;
}

export function resolveHamletDeferredDomRequest(input: {
  requested: boolean;
  visualNoUpdateShell: boolean;
}): boolean {
  if (!input.requested) return false;
  if (!input.visualNoUpdateShell) {
    throw new Error(
      'visualDeferDom=1 requires the exact visualNoUpdateShell=1 treatment.',
    );
  }
  return true;
}

export function resolveHamletDomPublicationPairRequest(input: {
  requested: boolean;
  visualNoUpdateShell: boolean;
  visualDeferDom: boolean;
}): boolean {
  if (!input.requested) return false;
  if (!input.visualNoUpdateShell || input.visualDeferDom) {
    throw new Error(
      'visualDomPair=1 requires visualNoUpdateShell=1 and owns both '
      + 'publication treatments; do not also pass visualDeferDom=1.',
    );
  }
  return true;
}

export function resolveHamletDomPublicationPairOrder(
  drawUint32: number,
): readonly [
  HamletNoUpdateShellTreatment,
  HamletNoUpdateShellTreatment,
] {
  if (
    !Number.isInteger(drawUint32)
    || drawUint32 < 0
    || drawUint32 > 0xffff_ffff
  ) {
    throw new Error(
      'DOM publication pair randomization requires one unsigned 32-bit draw.',
    );
  }
  return (drawUint32 & 1) === 0
    ? [
        HAMLET_NO_UPDATE_SHELL_TREATMENT,
        HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
      ]
    : [
        HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
        HAMLET_NO_UPDATE_SHELL_TREATMENT,
      ];
}

export function createHamletNoUpdateShellCapture(
  identity: HamletPerformancePairIdentity,
  options: { deferCohortDomPublication?: boolean } = {},
): {
  appendRafTimestamp(timestampMs: number): {
    armCollectorAfterCurrentFrame: boolean;
    report: HamletNoUpdateShellCaptureEvidence | null;
  };
  getReport(): HamletNoUpdateShellCaptureEvidence | null;
} {
  let leadInStartedAtRafTimestampMs: number | null = null;
  let previousRafTimestampMs: number | null = null;
  let leadIn: HamletNoUpdateShellLeadInEvidence | null = null;
  let awaitingCohortStart = false;
  let cohortStartedAtRafTimestampMs: number | null = null;
  let report: HamletNoUpdateShellCaptureEvidence | null = null;
  const leadInFrameTimesMs: number[] = [];
  const cohortFrameTimesMs: number[] = [];
  const treatment = options.deferCohortDomPublication
    ? HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT
    : HAMLET_NO_UPDATE_SHELL_TREATMENT;

  return {
    appendRafTimestamp: (timestampMs) => {
      if (report) {
        return {
          armCollectorAfterCurrentFrame: false,
          report: cloneJson(report),
        };
      }
      if (!Number.isFinite(timestampMs)) {
        throw new Error('No-update shell rAF timestamps must be finite.');
      }
      if (leadInStartedAtRafTimestampMs === null) {
        leadInStartedAtRafTimestampMs = timestampMs;
        previousRafTimestampMs = timestampMs;
        return { armCollectorAfterCurrentFrame: false, report: null };
      }
      if (
        previousRafTimestampMs === null
        || timestampMs <= previousRafTimestampMs
      ) {
        throw new Error(
          'No-update shell rAF timestamps must be strictly increasing.',
        );
      }

      if (leadIn === null) {
        leadInFrameTimesMs.push(timestampMs - previousRafTimestampMs);
        previousRafTimestampMs = timestampMs;
        const elapsedMs = timestampMs - leadInStartedAtRafTimestampMs;
        if (elapsedMs < HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS) {
          return { armCollectorAfterCurrentFrame: false, report: null };
        }
        leadIn = {
          ...identity,
          treatment,
          phase: 'lead-in',
          declaredDurationMs: HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
          startedAtRafTimestampMs: leadInStartedAtRafTimestampMs,
          completedAtRafTimestampMs: timestampMs,
          elapsedMs,
          sampleCount: leadInFrameTimesMs.length,
          frameTimesMs: [...leadInFrameTimesMs],
          skippedWork: { ...HAMLET_NO_UPDATE_SHELL_SKIPPED_WORK },
        };
        awaitingCohortStart = true;
        return { armCollectorAfterCurrentFrame: true, report: null };
      }

      if (awaitingCohortStart) {
        awaitingCohortStart = false;
        cohortStartedAtRafTimestampMs = timestampMs;
        previousRafTimestampMs = timestampMs;
        return { armCollectorAfterCurrentFrame: false, report: null };
      }
      if (cohortStartedAtRafTimestampMs === null) {
        throw new Error('No-update shell cohort was not armed after lead-in.');
      }

      cohortFrameTimesMs.push(timestampMs - previousRafTimestampMs);
      previousRafTimestampMs = timestampMs;
      const cohortElapsedMs =
        timestampMs - cohortStartedAtRafTimestampMs;
      if (cohortElapsedMs < HAMLET_NO_UPDATE_SHELL_WINDOW_MS) {
        return { armCollectorAfterCurrentFrame: false, report: null };
      }
      const frameTimesMs = [...cohortFrameTimesMs];
      const metrics = calculateVisualPerformanceMetrics(frameTimesMs);
      if (!metrics) {
        throw new Error(
          'No-update shell completed without valid judged intervals.',
        );
      }
      report = {
        schemaVersion: 1,
        treatment,
        leadInToCohortGapMs:
          cohortStartedAtRafTimestampMs
          - leadIn.completedAtRafTimestampMs,
        leadIn,
        judgedCohort: {
          ...identity,
          treatment,
          phase: 'judged-cohort',
          windowSeconds: 30,
          startedAtRafTimestampMs: cohortStartedAtRafTimestampMs,
          completedAtRafTimestampMs: timestampMs,
          elapsedMs: frameTimesMs.reduce(
            (totalMs, frameTimeMs) => totalMs + frameTimeMs,
            0,
          ),
          sampleCount: frameTimesMs.length,
          frameTimesMs,
          metrics,
          skippedWork: { ...HAMLET_NO_UPDATE_SHELL_SKIPPED_WORK },
          retainedShell: {
            schemaVersion: 5,
            rafScheduling: 'requestAnimationFrame',
            collector: 'visual-performance-hooks',
            postamble: 'telemetry-evidence-dom',
            ...(options.deferCohortDomPublication
              ? {
                  domPublication: 'terminal-only-after-freeze' as const,
                  inMemoryReportCadence: '500ms' as const,
                  jsonSerialization: 'every-in-memory-report' as const,
                }
              : {}),
          },
        },
        ...(options.deferCohortDomPublication
          ? {
              deferredDom: {
                mode: 'terminal-only-after-freeze' as const,
                cohortDomMutations: 0 as const,
                statusDatasets: 'deferred' as const,
                schema5DatasetPublication: 'deferred' as const,
                metricsTextContent: 'deferred' as const,
              },
            }
          : {}),
      };
      return {
        armCollectorAfterCurrentFrame: false,
        report: cloneJson(report),
      };
    },
    getReport: () => report === null ? null : cloneJson(report),
  };
}

export function createHamletFrozenUpdateDirectRenderCapture(
  identity: HamletPerformancePairIdentity,
): {
  appendRafTimestamp(timestampMs: number): {
    armCollectorAfterCurrentFrame: boolean;
    report: HamletFrozenUpdateDirectRenderCaptureEvidence | null;
  };
  getReport(): HamletFrozenUpdateDirectRenderCaptureEvidence | null;
} {
  const intervalCapture = createHamletNoUpdateShellCapture(identity);
  const convert = (
    capture: HamletNoUpdateShellCaptureEvidence | null,
  ): HamletFrozenUpdateDirectRenderCaptureEvidence | null => {
    if (!capture) return null;
    return {
      schemaVersion: 1,
      treatment: HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
      leadInToCohortGapMs: capture.leadInToCohortGapMs,
      leadIn: {
        ...identity,
        treatment: HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
        phase: 'lead-in',
        declaredDurationMs: HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
        startedAtRafTimestampMs:
          capture.leadIn.startedAtRafTimestampMs,
        completedAtRafTimestampMs:
          capture.leadIn.completedAtRafTimestampMs,
        elapsedMs: capture.leadIn.elapsedMs,
        sampleCount: capture.leadIn.sampleCount,
        frameTimesMs: [...capture.leadIn.frameTimesMs],
        skippedWork: {
          ...HAMLET_FROZEN_UPDATE_DIRECT_RENDER_SKIPPED_WORK,
        },
        retainedRender: {
          ...HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH,
        },
      },
      judgedCohort: {
        ...identity,
        treatment: HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
        phase: 'judged-cohort',
        windowSeconds: 30,
        startedAtRafTimestampMs:
          capture.judgedCohort.startedAtRafTimestampMs,
        completedAtRafTimestampMs:
          capture.judgedCohort.completedAtRafTimestampMs,
        elapsedMs: capture.judgedCohort.elapsedMs,
        sampleCount: capture.judgedCohort.sampleCount,
        frameTimesMs: [...capture.judgedCohort.frameTimesMs],
        metrics: { ...capture.judgedCohort.metrics },
        skippedWork: {
          ...HAMLET_FROZEN_UPDATE_DIRECT_RENDER_SKIPPED_WORK,
        },
        retainedRender: {
          ...HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH,
        },
        retainedShell: {
          schemaVersion: 5,
          rafScheduling: 'requestAnimationFrame',
          collector: 'visual-performance-hooks',
          postamble: 'telemetry-evidence-dom',
          gpuTimestamp: 'required-when-supported',
        },
      },
    };
  };

  return {
    appendRafTimestamp: (timestampMs) => {
      const step = intervalCapture.appendRafTimestamp(timestampMs);
      return {
        armCollectorAfterCurrentFrame: step.armCollectorAfterCurrentFrame,
        report: convert(step.report),
      };
    },
    getReport: () => convert(intervalCapture.getReport()),
  };
}

function createHamletRouteLodSkyUpdateAccumulator(): {
  append(update: HamletRouteLodSkyFrameUpdate): void;
  snapshot(): HamletRouteLodSkyUpdateSummary;
} {
  let frameCount = 0;
  let firstElapsedMs: number | null = null;
  let lastElapsedMs: number | null = null;
  let minElapsedMs: number | null = null;
  let maxElapsedMs: number | null = null;
  let previousElapsedMs: number | null = null;
  let previousRouteCycle: number | null = null;
  let wrapCount = 0;
  const routeCycles = new Set<number>();
  const phaseSequence: VisualSlowFrameContext['phase'][] = [];
  const phaseFrameCounts: Record<VisualSlowFrameContext['phase'], number> = {
    strategic: 0,
    settlement: 0,
    'road-eye': 0,
  };
  const forestLods = new Set<
    HamletRouteLodSkyFrameUpdate['lod']['forest']
  >();
  const groundcoverLods = new Set<
    HamletRouteLodSkyFrameUpdate['lod']['groundcover']
  >();
  const buildingLods = new Set<
    HamletRouteLodSkyFrameUpdate['lod']['building']
  >();
  const frozenVegetationWork = {
    forest: {
      selectionChanges: 0,
      workChunks: 0,
      matrixWrites: 0,
      bucketUploads: 0,
      maxPendingBuckets: 0,
      selectorSkippedFrames: 0,
    },
    groundcover: {
      generationSubsteps: 0,
      clearWriteSubsteps: 0,
      refreshes: 0,
      gpuFlagUpdates: 0,
      gpuUpdateRanges: 0,
      bytesUploaded: 0,
      completedSlots: 0,
      cancelledSlots: 0,
      maxPendingSlots: 0,
    },
  };

  return {
    append: (update) => {
      if (
        update.routeId !== 'gorski-kotar-lod-traverse-v1'
        || update.routeStatus !== 'running'
        || !Number.isFinite(update.routeElapsedMs)
        || update.routeElapsedMs < 0
        || update.routeElapsedMs > 21_000
        || !Number.isInteger(update.routeCycle)
        || update.routeCycle < 0
        || update.phase !== update.lod.building
      ) {
        throw new Error(
          'Route/LOD/sky capture requires one valid canonical running-route update.',
        );
      }
      const numericWork = [
        update.forest.workChunks,
        update.forest.matrixWrites,
        update.forest.bucketUploads,
        update.forest.pendingBuckets,
        update.groundcoverDelta.generationSubsteps,
        update.groundcoverDelta.clearWriteSubsteps,
        update.groundcoverDelta.refreshes,
        update.groundcoverDelta.gpuFlagUpdates,
        update.groundcoverDelta.gpuUpdateRanges,
        update.groundcoverDelta.bytesUploaded,
        update.groundcoverDelta.completedSlots,
        update.groundcoverDelta.cancelledSlots,
        update.groundcoverDelta.pendingSlots,
      ];
      if (
        numericWork.some(
          (value) => !Number.isFinite(value) || value < 0,
        )
      ) {
        throw new Error(
          'Route/LOD/sky capture vegetation counters must be finite and non-negative.',
        );
      }

      frameCount += 1;
      firstElapsedMs ??= update.routeElapsedMs;
      lastElapsedMs = update.routeElapsedMs;
      minElapsedMs = minElapsedMs === null
        ? update.routeElapsedMs
        : Math.min(minElapsedMs, update.routeElapsedMs);
      maxElapsedMs = maxElapsedMs === null
        ? update.routeElapsedMs
        : Math.max(maxElapsedMs, update.routeElapsedMs);
      if (
        previousElapsedMs !== null
        && previousRouteCycle !== null
      ) {
        if (update.routeCycle < previousRouteCycle) {
          throw new Error(
            'Route/LOD/sky capture route cycles must be monotonic.',
          );
        }
        wrapCount += Math.max(
          update.routeCycle - previousRouteCycle,
          update.routeElapsedMs < previousElapsedMs ? 1 : 0,
        );
      }
      previousElapsedMs = update.routeElapsedMs;
      previousRouteCycle = update.routeCycle;
      routeCycles.add(update.routeCycle);
      phaseFrameCounts[update.phase] += 1;
      if (phaseSequence.at(-1) !== update.phase) {
        phaseSequence.push(update.phase);
      }
      forestLods.add(update.lod.forest);
      groundcoverLods.add(update.lod.groundcover);
      buildingLods.add(update.lod.building);

      frozenVegetationWork.forest.selectionChanges +=
        Number(update.forest.selectionChanged);
      frozenVegetationWork.forest.workChunks += update.forest.workChunks;
      frozenVegetationWork.forest.matrixWrites += update.forest.matrixWrites;
      frozenVegetationWork.forest.bucketUploads += update.forest.bucketUploads;
      frozenVegetationWork.forest.maxPendingBuckets = Math.max(
        frozenVegetationWork.forest.maxPendingBuckets,
        update.forest.pendingBuckets,
      );
      frozenVegetationWork.forest.selectorSkippedFrames +=
        Number(update.forest.selectorSkipped);
      frozenVegetationWork.groundcover.generationSubsteps +=
        update.groundcoverDelta.generationSubsteps;
      frozenVegetationWork.groundcover.clearWriteSubsteps +=
        update.groundcoverDelta.clearWriteSubsteps;
      frozenVegetationWork.groundcover.refreshes +=
        update.groundcoverDelta.refreshes;
      frozenVegetationWork.groundcover.gpuFlagUpdates +=
        update.groundcoverDelta.gpuFlagUpdates;
      frozenVegetationWork.groundcover.gpuUpdateRanges +=
        update.groundcoverDelta.gpuUpdateRanges;
      frozenVegetationWork.groundcover.bytesUploaded +=
        update.groundcoverDelta.bytesUploaded;
      frozenVegetationWork.groundcover.completedSlots +=
        update.groundcoverDelta.completedSlots;
      frozenVegetationWork.groundcover.cancelledSlots +=
        update.groundcoverDelta.cancelledSlots;
      frozenVegetationWork.groundcover.maxPendingSlots = Math.max(
        frozenVegetationWork.groundcover.maxPendingSlots,
        update.groundcoverDelta.pendingSlots,
      );
    },
    snapshot: () => ({
      updateCounts: {
        motionRoute: frameCount,
        lodScene: frameCount,
        sky: {
          camera: frameCount,
          sun: frameCount,
          time: frameCount,
        },
      },
      phaseFrameCounts: { ...phaseFrameCounts },
      phaseSequence: [...phaseSequence],
      lodStatesTraversed: {
        forest: (['overview', 'near'] as const).filter(
          (lod) => forestLods.has(lod),
        ),
        groundcover: (['hidden', 'transition', 'full'] as const).filter(
          (lod) => groundcoverLods.has(lod),
        ),
        building: (['strategic', 'settlement', 'road-eye'] as const).filter(
          (lod) => buildingLods.has(lod),
        ),
      },
      route: {
        firstElapsedMs,
        lastElapsedMs,
        minElapsedMs,
        maxElapsedMs,
        wrapCount,
        cycles: [...routeCycles].sort((left, right) => left - right),
      },
      frozenVegetationWork: {
        forest: { ...frozenVegetationWork.forest },
        groundcover: { ...frozenVegetationWork.groundcover },
      },
    }),
  };
}

export function createHamletRouteLodSkyDirectRenderCapture(
  identity: HamletPerformancePairIdentity,
  options: {
    shadowSubsystem: HamletRouteShadowSubsystem;
    forestRenderer: HamletRouteForestRenderer;
    forestEdgeLayout?: HamletForestEdgeLayout;
  } = {
    shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
    forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
  },
): {
  appendRafTimestamp(timestampMs: number): {
    armCollectorAfterCurrentFrame: boolean;
    recordCompletedCanonicalUpdateBlock: boolean;
    report: HamletRouteLodSkyDirectRenderCaptureEvidence | null;
  };
  recordCompletedCanonicalUpdateBlock(
    update: HamletRouteLodSkyFrameUpdate,
  ): void;
  getReport(): HamletRouteLodSkyDirectRenderCaptureEvidence | null;
} {
  const intervalCapture = createHamletNoUpdateShellCapture(identity);
  const leadInUpdates = createHamletRouteLodSkyUpdateAccumulator();
  const cohortUpdates = createHamletRouteLodSkyUpdateAccumulator();
  let cohortArmed = false;
  let activeFramePhase: 'lead-in' | 'judged-cohort' | null = null;
  let activeFrameRecorded = true;

  const requirePreviousFrameRecord = (): void => {
    if (activeFramePhase !== null && !activeFrameRecorded) {
      throw new Error(
        'Route/LOD/sky capture advanced before the canonical update block was recorded.',
      );
    }
  };
  const convert = (
    capture: HamletNoUpdateShellCaptureEvidence | null,
  ): HamletRouteLodSkyDirectRenderCaptureEvidence | null => {
    if (!capture) return null;
    const leadInUpdateSummary = leadInUpdates.snapshot();
    const cohortUpdateSummary = cohortUpdates.snapshot();
    if (
      leadInUpdateSummary.updateCounts.motionRoute
        !== capture.leadIn.sampleCount
      || cohortUpdateSummary.updateCounts.motionRoute
        !== capture.judgedCohort.sampleCount
    ) {
      throw new Error(
        'Route/LOD/sky update counts do not match their ordered rAF intervals.',
      );
    }
    return {
      schemaVersion: 1,
      treatment: HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
      forestRenderer: options.forestRenderer,
      ...(options.forestEdgeLayout
        ? { forestEdgeLayout: options.forestEdgeLayout }
        : {}),
      forestUpdates: 'frozen-after-settled-warmup',
      postProcessing: 'disabled',
      shadowSubsystem: options.shadowSubsystem,
      leadInToCohortGapMs: capture.leadInToCohortGapMs,
      leadIn: {
        ...identity,
        treatment: HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
        phase: 'lead-in',
        declaredDurationMs: HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
        startedAtRafTimestampMs:
          capture.leadIn.startedAtRafTimestampMs,
        completedAtRafTimestampMs:
          capture.leadIn.completedAtRafTimestampMs,
        elapsedMs: capture.leadIn.elapsedMs,
        sampleCount: capture.leadIn.sampleCount,
        frameTimesMs: [...capture.leadIn.frameTimesMs],
        retainedUpdates: HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_UPDATES,
        updates: leadInUpdateSummary,
        retainedRender: HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH,
      },
      judgedCohort: {
        ...identity,
        treatment: HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
        phase: 'judged-cohort',
        windowSeconds: 30,
        startedAtRafTimestampMs:
          capture.judgedCohort.startedAtRafTimestampMs,
        completedAtRafTimestampMs:
          capture.judgedCohort.completedAtRafTimestampMs,
        elapsedMs: capture.judgedCohort.elapsedMs,
        sampleCount: capture.judgedCohort.sampleCount,
        frameTimesMs: [...capture.judgedCohort.frameTimesMs],
        metrics: { ...capture.judgedCohort.metrics },
        retainedUpdates: HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_UPDATES,
        updates: cohortUpdateSummary,
        retainedRender: HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH,
        retainedShell: {
          schemaVersion: 5,
          rafScheduling: 'requestAnimationFrame',
          collector: 'visual-performance-hooks',
          postamble: 'telemetry-evidence-dom',
          gpuTimestamp: 'required-when-supported',
        },
      },
      routeFrameSequence: createHamletRouteFrameSequenceDescriptor(
        options.shadowSubsystem,
        options.forestRenderer,
        options.forestEdgeLayout,
      ),
    };
  };

  return {
    appendRafTimestamp: (timestampMs) => {
      requirePreviousFrameRecord();
      const step = intervalCapture.appendRafTimestamp(timestampMs);
      if (step.report) {
        activeFramePhase = null;
        activeFrameRecorded = true;
        return {
          armCollectorAfterCurrentFrame: false,
          recordCompletedCanonicalUpdateBlock: false,
          report: convert(step.report),
        };
      }
      if (step.armCollectorAfterCurrentFrame) {
        cohortArmed = true;
        activeFramePhase = null;
        activeFrameRecorded = true;
        return {
          armCollectorAfterCurrentFrame: true,
          recordCompletedCanonicalUpdateBlock: false,
          report: null,
        };
      }
      activeFramePhase = cohortArmed ? 'judged-cohort' : 'lead-in';
      activeFrameRecorded = false;
      return {
        armCollectorAfterCurrentFrame: false,
        recordCompletedCanonicalUpdateBlock: true,
        report: null,
      };
    },
    recordCompletedCanonicalUpdateBlock: (update) => {
      if (activeFramePhase === null || activeFrameRecorded) {
        throw new Error(
          'Route/LOD/sky canonical update block was not requested for this frame.',
        );
      }
      const accumulator = activeFramePhase === 'lead-in'
        ? leadInUpdates
        : cohortUpdates;
      accumulator.append(update);
      activeFrameRecorded = true;
    },
    getReport: () => convert(intervalCapture.getReport()),
  };
}

export function doesHamletNoUpdateShellMatchCollector(
  capture: HamletNoUpdateShellCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): boolean {
  const cohort = capture.judgedCohort;
  const recomputedMetrics = calculateVisualPerformanceMetrics(
    cohort.frameTimesMs,
  );
  return performanceReport.schemaVersion === 5
    && performanceReport.status === 'ready'
    && performanceReport.windowSeconds === cohort.windowSeconds
    && performanceReport.sampleCount === cohort.sampleCount
    && recomputedMetrics !== null
    && Object.entries(recomputedMetrics).every(
      ([key, value]) =>
        performanceReport.metrics[key as keyof VisualPerformanceMetrics]
          === value,
    )
    && Object.entries(cohort.metrics).every(
      ([key, value]) =>
        performanceReport.metrics[key as keyof VisualPerformanceMetrics]
          === value,
    )
    && performanceReport.renderer.medianDrawCalls === 0
    && performanceReport.renderer.medianFrameCalls === 0
    && performanceReport.renderer.medianTriangles === 0
    && cohort.elapsedMs
      === cohort.frameTimesMs.reduce(
        (sum, frameTimeMs) => sum + frameTimeMs,
        0,
      );
}

function hasHonestFrozenDirectRenderGpuEvidence(
  performanceReport: VisualPerformanceReport,
): boolean {
  const gpuTiming = performanceReport.context.gpuTiming;
  if (gpuTiming.status === 'available') {
    return gpuTiming.source === 'webgpu-timestamp-query'
      && gpuTiming.api === 'compute-pass-timestamp-writes'
      && gpuTiming.span === 'full-post-processing-queue-bookends'
      && gpuTiming.slotCount > 0
      && gpuTiming.attemptedFrames > 0
      && gpuTiming.submittedFrames > 0
      && gpuTiming.resolvedFrames > 0
      && performanceReport.slowFrames.length > 0
      && performanceReport.slowFrames.every(
        (record) =>
          record.precedingFrameGpuTimingStatus === 'available'
          && record.precedingFrameGpuQueryId !== null
          && record.precedingFrameGpuDurationMs !== null
          && Number.isFinite(record.precedingFrameGpuDurationMs)
          && record.precedingFrameGpuDurationMs >= 0
          && record.precedingFrameGpuTimingLimitation === null,
      );
  }
  return gpuTiming.source === 'unavailable'
    && gpuTiming.api === 'unavailable'
    && gpuTiming.span === 'unavailable'
    && gpuTiming.limitations.length > 0
    && gpuTiming.limitations.every((limitation) => limitation.length > 0)
    && performanceReport.slowFrames.length > 0
    && performanceReport.slowFrames.every(
      (record) =>
        record.precedingFrameGpuTimingStatus === 'unavailable'
        && record.precedingFrameGpuQueryId === null
        && record.precedingFrameGpuDurationMs === null
        && Boolean(record.precedingFrameGpuTimingLimitation),
    );
}

export function doesHamletFrozenUpdateDirectRenderMatchCollector(
  capture: HamletFrozenUpdateDirectRenderCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): boolean {
  const cohort = capture.judgedCohort;
  const recomputedMetrics = calculateVisualPerformanceMetrics(
    cohort.frameTimesMs,
  );
  const subsystems = performanceReport.context.subsystems;
  return capture.treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT
    && capture.leadIn.elapsedMs >= HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS
    && performanceReport.schemaVersion === 5
    && performanceReport.status === 'ready'
    && performanceReport.windowSeconds === cohort.windowSeconds
    && performanceReport.sampleCount === cohort.sampleCount
    && recomputedMetrics !== null
    && Object.entries(recomputedMetrics).every(
      ([key, value]) =>
        performanceReport.metrics[key as keyof VisualPerformanceMetrics]
          === value,
    )
    && Object.entries(cohort.metrics).every(
      ([key, value]) =>
        performanceReport.metrics[key as keyof VisualPerformanceMetrics]
          === value,
    )
    && performanceReport.renderer.medianDrawCalls > 0
    && performanceReport.renderer.medianFrameCalls > 0
    && performanceReport.renderer.medianTriangles > 0
    && performanceReport.slowFrames.length > 0
    && performanceReport.slowFrames.every(
      (record) =>
        record.renderer.drawCalls > 0
        && record.renderer.frameCalls > 0
        && record.renderer.triangles > 0,
    )
    && subsystems.post === false
    && subsystems.shadows === false
    && subsystems.forest === false
    && subsystems.sky === true
    && subsystems.groundcover === true
    && hasHonestFrozenDirectRenderGpuEvidence(performanceReport)
    && cohort.elapsedMs
      === cohort.frameTimesMs.reduce(
        (sum, frameTimeMs) => sum + frameTimeMs,
        0,
      );
}

export function createHamletFrozenUpdateDirectRenderEvidence(
  capture: HamletFrozenUpdateDirectRenderCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): HamletFrozenUpdateDirectRenderEvidence {
  if (
    !doesHamletFrozenUpdateDirectRenderMatchCollector(
      capture,
      performanceReport,
    )
  ) {
    throw new Error(
      'Frozen-update direct render did not exactly match its schema-5 '
      + 'renderer/GPU cohort.',
    );
  }
  const gpuTiming = performanceReport.context.gpuTiming;
  const slowFrames = performanceReport.slowFrames;
  return {
    ...cloneJson(capture),
    collectorAgreement: {
      schemaVersion: 5,
      exactSampleCount: true,
      exactMetrics: true,
      actualRendererSubmissions: true,
      renderer: { ...performanceReport.renderer },
      subsystems: {
        post: false,
        shadows: false,
        forest: false,
        sky: true,
        groundcover: true,
      },
      gpuTimestamp: {
        status: gpuTiming.status,
        source: gpuTiming.source,
        span: gpuTiming.span,
        attemptedFrames: gpuTiming.attemptedFrames,
        submittedFrames: gpuTiming.submittedFrames,
        resolvedFrames: gpuTiming.resolvedFrames,
        retainedAvailableRecords: slowFrames.filter(
          (record) =>
            record.precedingFrameGpuTimingStatus === 'available',
        ).length,
        retainedUnavailableRecordsWithLimitations: slowFrames.filter(
          (record) =>
            record.precedingFrameGpuTimingStatus === 'unavailable'
            && Boolean(record.precedingFrameGpuTimingLimitation),
        ).length,
        spanInterpretation:
          'schema-5 queue bookends surround the direct-color renderer submission because post is disabled',
        limitations: [...gpuTiming.limitations],
      },
    },
  };
}

function doesHamletRouteLodSkyUpdateSummaryMatch(
  summary: HamletRouteLodSkyUpdateSummary,
  sampleCount: number,
  requireFullRouteProgression: boolean,
): boolean {
  const counts = summary.updateCounts;
  const forestWork = summary.frozenVegetationWork.forest;
  const groundcoverWork = summary.frozenVegetationWork.groundcover;
  const phaseCountTotal = Object.values(summary.phaseFrameCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const firstStrategicIndex = summary.phaseSequence.indexOf('strategic');
  const firstSettlementIndex = summary.phaseSequence.indexOf('settlement');
  const firstRoadEyeIndex = summary.phaseSequence.indexOf('road-eye');
  const exactPerFrameUpdates =
    counts.motionRoute === sampleCount
    && counts.lodScene === sampleCount
    && counts.sky.camera === sampleCount
    && counts.sky.sun === sampleCount
    && counts.sky.time === sampleCount
    && phaseCountTotal === sampleCount;
  const frozenVegetation =
    forestWork.selectionChanges === 0
    && forestWork.workChunks === 0
    && forestWork.matrixWrites === 0
    && forestWork.bucketUploads === 0
    && forestWork.maxPendingBuckets === 0
    && forestWork.selectorSkippedFrames === sampleCount
    && groundcoverWork.generationSubsteps === 0
    && groundcoverWork.clearWriteSubsteps === 0
    && groundcoverWork.refreshes === 0
    && groundcoverWork.gpuFlagUpdates === 0
    && groundcoverWork.gpuUpdateRanges === 0
    && groundcoverWork.bytesUploaded === 0
    && groundcoverWork.completedSlots === 0
    && groundcoverWork.cancelledSlots === 0
    && groundcoverWork.maxPendingSlots === 0;
  if (!exactPerFrameUpdates || !frozenVegetation) return false;
  if (!requireFullRouteProgression) return true;
  return summary.phaseFrameCounts.strategic > 0
    && summary.phaseFrameCounts.settlement > 0
    && summary.phaseFrameCounts['road-eye'] > 0
    && firstStrategicIndex === 0
    && firstSettlementIndex > firstStrategicIndex
    && firstRoadEyeIndex > firstSettlementIndex
    && summary.lodStatesTraversed.forest.includes('overview')
    && summary.lodStatesTraversed.forest.includes('near')
    && summary.lodStatesTraversed.groundcover.includes('hidden')
    && summary.lodStatesTraversed.groundcover.includes('transition')
    && summary.lodStatesTraversed.groundcover.includes('full')
    && summary.lodStatesTraversed.building.includes('strategic')
    && summary.lodStatesTraversed.building.includes('settlement')
    && summary.lodStatesTraversed.building.includes('road-eye')
    && summary.route.firstElapsedMs !== null
    && summary.route.lastElapsedMs !== null
    && summary.route.minElapsedMs !== null
    && summary.route.minElapsedMs <= 20
    && summary.route.maxElapsedMs !== null
    && summary.route.maxElapsedMs >= 20_000
    && summary.route.wrapCount >= 1
    && summary.route.cycles.includes(0)
    && summary.route.cycles.some((cycle) => cycle >= 1);
}

export function doesHamletRouteLodSkyDirectRenderMatchCollector(
  capture: HamletRouteLodSkyDirectRenderCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): boolean {
  return auditHamletRouteLodSkyDirectRenderCollector(
    capture,
    performanceReport,
  ).matches;
}

export function auditHamletRouteLodSkyDirectRenderCollector(
  capture: HamletRouteLodSkyDirectRenderCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): HamletRouteLodSkyCollectorAudit {
  const cohort = capture.judgedCohort;
  const recomputedMetrics = calculateVisualPerformanceMetrics(
    cohort.frameTimesMs,
  );
  const subsystems = performanceReport.context.subsystems;
  const shadowsEnabled =
    capture.shadowSubsystem === HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED;
  const forestEnabled =
    capture.forestRenderer === HAMLET_ROUTE_FOREST_RENDERER_ENABLED;
  const recognizedShadowSubsystem =
    shadowsEnabled
    || capture.shadowSubsystem === HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED;
  const recognizedForestRenderer =
    forestEnabled
    || capture.forestRenderer === HAMLET_ROUTE_FOREST_RENDERER_DISABLED;
  const expectedSequence = createHamletRouteFrameSequenceDescriptor(
    capture.shadowSubsystem,
    capture.forestRenderer,
    capture.forestEdgeLayout,
  );
  const checks: Record<string, boolean> = {
    treatment:
      capture.treatment === HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
    'recognized-shadow-subsystem': recognizedShadowSubsystem,
    'recognized-forest-renderer': recognizedForestRenderer,
    'forest-updates-frozen':
      capture.forestUpdates === 'frozen-after-settled-warmup',
    'post-processing-disabled': capture.postProcessing === 'disabled',
    'lead-in-duration':
      capture.leadIn.elapsedMs >= HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
    'route-frame-sequence':
      JSON.stringify(capture.routeFrameSequence)
        === JSON.stringify(expectedSequence),
    'lead-in-updates': doesHamletRouteLodSkyUpdateSummaryMatch(
      capture.leadIn.updates,
      capture.leadIn.sampleCount,
      false,
    ),
    'cohort-updates': doesHamletRouteLodSkyUpdateSummaryMatch(
      cohort.updates,
      cohort.sampleCount,
      true,
    ),
    'collector-schema': performanceReport.schemaVersion === 5,
    'collector-ready': performanceReport.status === 'ready',
    'cohort-window':
      performanceReport.windowSeconds === cohort.windowSeconds,
    'cohort-sample-count':
      performanceReport.sampleCount === cohort.sampleCount,
    'recomputed-metrics':
      recomputedMetrics !== null
      && Object.entries(recomputedMetrics).every(
        ([key, value]) =>
          performanceReport.metrics[key as keyof VisualPerformanceMetrics]
            === value,
      ),
    'capture-metrics': Object.entries(cohort.metrics).every(
      ([key, value]) =>
        performanceReport.metrics[key as keyof VisualPerformanceMetrics]
          === value,
    ),
    'renderer-submissions':
      performanceReport.renderer.medianDrawCalls > 0
      && performanceReport.renderer.medianFrameCalls > 0
      && performanceReport.renderer.medianTriangles > 0,
    'slow-frame-records-present': performanceReport.slowFrames.length > 0,
    'slow-frame-renderer-records': performanceReport.slowFrames.every(
      (record) =>
        record.renderer.drawCalls > 0
        && record.renderer.frameCalls > 0
        && record.renderer.triangles > 0,
    ),
    'post-subsystem': subsystems.post === false,
    'shadow-subsystem': subsystems.shadows === shadowsEnabled,
    'forest-subsystem': subsystems.forest === forestEnabled,
    'sky-subsystem': subsystems.sky === true,
    'groundcover-subsystem': subsystems.groundcover === true,
    'gpu-evidence': hasHonestFrozenDirectRenderGpuEvidence(performanceReport),
    'cohort-elapsed-sum':
      cohort.elapsedMs
        === cohort.frameTimesMs.reduce(
          (sum, frameTimeMs) => sum + frameTimeMs,
          0,
        ),
  };
  const failures = Object.entries(checks)
    .filter(([, matches]) => !matches)
    .map(([name]) => name);
  return {
    matches: failures.length === 0,
    failures,
    captureSampleCount: cohort.sampleCount,
    collectorSampleCount: performanceReport.sampleCount,
    captureMetrics: { ...cohort.metrics },
    collectorMetrics: { ...performanceReport.metrics },
    captureForestEdgeLayout: capture.forestEdgeLayout ?? null,
    captureSequenceSignature: capture.routeFrameSequence.signature,
    expectedSequenceSignature: expectedSequence.signature,
  };
}

export function createHamletRouteLodSkyDirectRenderEvidence(
  capture: HamletRouteLodSkyDirectRenderCaptureEvidence,
  performanceReport: VisualPerformanceReport,
): HamletRouteLodSkyDirectRenderEvidence {
  if (
    !doesHamletRouteLodSkyDirectRenderMatchCollector(
      capture,
      performanceReport,
    )
  ) {
    throw new Error(
      'Route/LOD/scene/sky direct render did not exactly match its '
      + 'schema-5 renderer/GPU/update cohort.',
    );
  }
  const gpuTiming = performanceReport.context.gpuTiming;
  const slowFrames = performanceReport.slowFrames;
  return {
    ...cloneJson(capture),
    collectorAgreement: {
      schemaVersion: 5,
      exactSampleCount: true,
      exactMetrics: true,
      actualRendererSubmissions: true,
      renderer: { ...performanceReport.renderer },
      subsystems: {
        post: false,
        shadows:
          capture.shadowSubsystem
            === HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
        forest:
          capture.forestRenderer
            === HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
        sky: true,
        groundcover: true,
      },
      gpuTimestamp: {
        status: gpuTiming.status,
        source: gpuTiming.source,
        span: gpuTiming.span,
        attemptedFrames: gpuTiming.attemptedFrames,
        submittedFrames: gpuTiming.submittedFrames,
        resolvedFrames: gpuTiming.resolvedFrames,
        retainedAvailableRecords: slowFrames.filter(
          (record) =>
            record.precedingFrameGpuTimingStatus === 'available',
        ).length,
        retainedUnavailableRecordsWithLimitations: slowFrames.filter(
          (record) =>
            record.precedingFrameGpuTimingStatus === 'unavailable'
            && Boolean(record.precedingFrameGpuTimingLimitation),
        ).length,
        spanInterpretation:
          'schema-5 queue bookends surround the direct-color renderer submission because post is disabled',
        limitations: [...gpuTiming.limitations],
      },
    },
  };
}

function routeUpdatePairArmCompletedCohortTimestampMs(
  arm: HamletRouteUpdatePairArmEvidence,
): number {
  return arm.judgedCohort.completedAtRafTimestampMs;
}

function routeUpdatePairArmHasIdentity(
  arm: HamletRouteUpdatePairArmEvidence,
  identity: HamletPerformancePairIdentity,
): boolean {
  return arm.leadIn.runUuid === identity.runUuid
    && arm.judgedCohort.runUuid === identity.runUuid
    && arm.leadIn.performanceTimeOriginMs
      === identity.performanceTimeOriginMs
    && arm.judgedCohort.performanceTimeOriginMs
      === identity.performanceTimeOriginMs;
}

export function createHamletRouteUpdatePairCoordinator(
  identity: HamletPerformancePairIdentity,
  drawUint32: number,
): {
  getCurrentTreatment(): HamletRouteUpdatePairTreatment;
  appendRafTimestamp(timestampMs: number): {
    armCollectorAfterCurrentFrame: boolean;
    recordCompletedCanonicalUpdateBlock: boolean;
    captureComplete: boolean;
  };
  recordCompletedCanonicalUpdateBlock(
    update: HamletRouteLodSkyFrameUpdate,
  ): void;
  completeCurrentArm(input: {
    performanceReport: VisualPerformanceReport;
    completedAtPerformanceTimestampMs: number;
  }): {
    advanceToNextArm: boolean;
    report: HamletRouteUpdatePairEvidence | null;
  };
  getReport(): HamletRouteUpdatePairEvidence | null;
} {
  const randomizedOrder = resolveHamletRouteUpdatePairOrder(drawUint32);
  let sequenceIndex: 0 | 1 = 0;
  let frozenCapture =
    randomizedOrder[0] === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT
      ? createHamletFrozenUpdateDirectRenderCapture(identity)
      : null;
  let routeCapture =
    randomizedOrder[0] === HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT
      ? createHamletRouteLodSkyDirectRenderCapture(identity)
      : null;
  const arms: HamletRouteUpdatePairArmEvidence[] = [];
  let report: HamletRouteUpdatePairEvidence | null = null;

  const installArmCapture = (
    treatment: HamletRouteUpdatePairTreatment,
  ): void => {
    frozenCapture =
      treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT
        ? createHamletFrozenUpdateDirectRenderCapture(identity)
        : null;
    routeCapture =
      treatment === HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT
        ? createHamletRouteLodSkyDirectRenderCapture(identity)
        : null;
  };

  return {
    getCurrentTreatment: () => randomizedOrder[sequenceIndex],
    appendRafTimestamp: (timestampMs) => {
      if (report) {
        throw new Error('Route-update pair is already complete.');
      }
      const treatment = randomizedOrder[sequenceIndex];
      if (treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT) {
        if (!frozenCapture || routeCapture) {
          throw new Error(
            'Route-update pair OFF arm capture was not isolated.',
          );
        }
        const step = frozenCapture.appendRafTimestamp(timestampMs);
        return {
          armCollectorAfterCurrentFrame:
            step.armCollectorAfterCurrentFrame,
          recordCompletedCanonicalUpdateBlock: false,
          captureComplete: step.report !== null,
        };
      }
      if (!routeCapture || frozenCapture) {
        throw new Error(
          'Route-update pair ON arm capture was not isolated.',
        );
      }
      const step = routeCapture.appendRafTimestamp(timestampMs);
      return {
        armCollectorAfterCurrentFrame:
          step.armCollectorAfterCurrentFrame,
        recordCompletedCanonicalUpdateBlock:
          step.recordCompletedCanonicalUpdateBlock,
        captureComplete: step.report !== null,
      };
    },
    recordCompletedCanonicalUpdateBlock: (update) => {
      if (
        randomizedOrder[sequenceIndex]
          !== HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT
        || !routeCapture
        || frozenCapture
      ) {
        throw new Error(
          'Route-update pair canonical updates are forbidden in the OFF arm.',
        );
      }
      routeCapture.recordCompletedCanonicalUpdateBlock(update);
    },
    completeCurrentArm: (input) => {
      if (report) {
        return {
          advanceToNextArm: false,
          report: cloneJson(report),
        };
      }
      if (!Number.isFinite(input.completedAtPerformanceTimestampMs)) {
        throw new Error(
          'Route-update pair arm completion timestamp must be finite.',
        );
      }
      const treatment = randomizedOrder[sequenceIndex];
      let arm: HamletRouteUpdatePairArmEvidence;
      if (treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT) {
        const capture = frozenCapture?.getReport() ?? null;
        if (!capture) {
          throw new Error(
            'Route-update pair OFF arm cannot complete before its exact cohort.',
          );
        }
        const evidence = createHamletFrozenUpdateDirectRenderEvidence(
          capture,
          input.performanceReport,
        );
        arm = {
          ...evidence,
          sequenceIndex: sequenceIndex + 1 as 1 | 2,
          collectorGeneration: sequenceIndex + 1 as 1 | 2,
          completedAtPerformanceTimestampMs:
            input.completedAtPerformanceTimestampMs,
          performanceReport: cloneJson(input.performanceReport),
          canonicalUpdateBlock: {
            enabled: false,
            judgedIntervalCount: evidence.judgedCohort.sampleCount,
            updateCounts: {
              motionRoute: 0,
              lodScene: 0,
              sky: {
                camera: 0,
                sun: 0,
                time: 0,
              },
            },
            exactUpdatesPerJudgedInterval: true,
            phaseAndLodCoverage: 'not-applicable-update-block-off',
          },
        };
      } else {
        const capture = routeCapture?.getReport() ?? null;
        if (!capture) {
          throw new Error(
            'Route-update pair ON arm cannot complete before its exact cohort.',
          );
        }
        const evidence = createHamletRouteLodSkyDirectRenderEvidence(
          capture,
          input.performanceReport,
        );
        arm = {
          ...evidence,
          sequenceIndex: sequenceIndex + 1 as 1 | 2,
          collectorGeneration: sequenceIndex + 1 as 1 | 2,
          completedAtPerformanceTimestampMs:
            input.completedAtPerformanceTimestampMs,
          performanceReport: cloneJson(input.performanceReport),
          canonicalUpdateBlock: {
            enabled: true,
            judgedIntervalCount: evidence.judgedCohort.sampleCount,
            updateCounts: cloneJson(
              evidence.judgedCohort.updates.updateCounts,
            ),
            exactUpdatesPerJudgedInterval: true,
            phaseAndLodCoverage: true,
          },
        };
      }
      if (!routeUpdatePairArmHasIdentity(arm, identity)) {
        throw new Error(
          'Route-update pair arm identity leaked across collectors.',
        );
      }
      arms.push(arm);
      if (sequenceIndex === 0) {
        sequenceIndex = 1;
        installArmCapture(randomizedOrder[1]);
        return { advanceToNextArm: true, report: null };
      }

      const first = arms[0]!;
      const second = arms[1]!;
      const offArm = arms.find(
        (candidate) =>
          candidate.treatment
            === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
      );
      const onArm = arms.find(
        (candidate) =>
          candidate.treatment
            === HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
      );
      if (
        !offArm
        || !onArm
        || offArm.canonicalUpdateBlock.enabled
        || !onArm.canonicalUpdateBlock.enabled
      ) {
        throw new Error(
          'Route-update pair must contain exactly one OFF and one ON arm.',
        );
      }
      const firstCohortEndToSecondLeadInStart =
        second.leadIn.startedAtRafTimestampMs
        - routeUpdatePairArmCompletedCohortTimestampMs(first);
      const firstTerminalFreezeToSecondLeadInStart =
        second.leadIn.startedAtRafTimestampMs
        - first.completedAtPerformanceTimestampMs;
      const firstGpu = first.collectorAgreement.gpuTimestamp;
      const secondGpu = second.collectorAgreement.gpuTimestamp;
      const gpuStatusSourceAndSpan =
        firstGpu.status === secondGpu.status
        && firstGpu.source === secondGpu.source
        && firstGpu.span === secondGpu.span
        && firstGpu.spanInterpretation === secondGpu.spanInterpretation;
      const subsystemStatePerArm =
        JSON.stringify(first.collectorAgreement.subsystems)
          === JSON.stringify(second.collectorAgreement.subsystems);
      const offCounts = offArm.canonicalUpdateBlock.updateCounts;
      const offUpdateCountsZero =
        offCounts.motionRoute === 0
        && offCounts.lodScene === 0
        && offCounts.sky.camera === 0
        && offCounts.sky.sun === 0
        && offCounts.sky.time === 0;
      const onCounts = onArm.canonicalUpdateBlock.updateCounts;
      const onSampleCount = onArm.judgedCohort.sampleCount;
      const onUpdatesExactlyOncePerInterval =
        onCounts.motionRoute === onSampleCount
        && onCounts.lodScene === onSampleCount
        && onCounts.sky.camera === onSampleCount
        && onCounts.sky.sun === onSampleCount
        && onCounts.sky.time === onSampleCount;
      if (
        firstCohortEndToSecondLeadInStart < 0
        || firstTerminalFreezeToSecondLeadInStart < 0
        || !gpuStatusSourceAndSpan
        || !subsystemStatePerArm
        || !offUpdateCountsZero
        || !onUpdatesExactlyOncePerInterval
      ) {
        throw new Error(
          'Route-update pair arm handoff or controlled agreements failed.',
        );
      }
      report = {
        ...identity,
        schemaVersion: 1,
        experiment: HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT,
        randomization: {
          source: 'crypto.getRandomValues-uint32-low-bit',
          drawUint32,
          orderBit: (drawUint32 & 1) as 0 | 1,
        },
        randomizedOrder: [...randomizedOrder],
        arms: [cloneJson(first), cloneJson(second)],
        armHandoffGapsMs: {
          firstCohortEndToSecondLeadInStart,
          firstTerminalFreezeToSecondLeadInStart,
        },
        controlledDifference: {
          canonicalRouteLodSceneSkyUpdates: 'off-vs-on',
          renderer: { ...HAMLET_FROZEN_UPDATE_DIRECT_RENDER_PATH },
          vegetation: 'frozen',
          disabledSubsystems: ['forest', 'post', 'shadows'],
          schemaVersion: 5,
          gpuTimestamp: 'identical-required-when-supported',
        },
        agreements: {
          sharedDocumentIdentity: true,
          freshSchema5CollectorPerArm: true,
          completeOrderedRafIntervalsPerArm: true,
          exactLeadInAndCohortPerArm: true,
          rendererSubmissionsPerArm: true,
          subsystemStatePerArm: true,
          gpuStatusSourceAndSpan: true,
          offUpdateCountsZero: true,
          onUpdatesExactlyOncePerInterval: true,
          onPhaseAndLodCoverage: true,
        },
      };
      return {
        advanceToNextArm: false,
        report: cloneJson(report),
      };
    },
    getReport: () => report === null ? null : cloneJson(report),
  };
}

function isValidDomPublicationArmEvidence(
  treatment: HamletNoUpdateShellTreatment,
  publication: VisualPerformanceDomPublicationEvidence,
): boolean {
  if (
    publication.inMemoryReportConstructions < 1
    || publication.jsonSerializations
      !== publication.inMemoryReportConstructions
    || publication.terminalDomPublications !== 1
  ) {
    return false;
  }
  if (treatment === HAMLET_NO_UPDATE_SHELL_TREATMENT) {
    return publication.mode === 'periodic'
      && publication.cohortDomPublications > 0;
  }
  return publication.mode === 'terminal-only-after-freeze'
    && publication.cohortDomPublications === 0;
}

export function createHamletDomPublicationPairCoordinator(
  identity: HamletPerformancePairIdentity,
  drawUint32: number,
): {
  getCurrentTreatment(): HamletNoUpdateShellTreatment;
  appendRafTimestamp(timestampMs: number): {
    armCollectorAfterCurrentFrame: boolean;
    report: HamletNoUpdateShellCaptureEvidence | null;
  };
  completeCurrentArm(input: {
    performanceReport: VisualPerformanceReport;
    domPublication: VisualPerformanceDomPublicationEvidence;
    completedAtPerformanceTimestampMs: number;
  }): {
    advanceToNextArm: boolean;
    report: HamletDomPublicationPairEvidence | null;
  };
  getReport(): HamletDomPublicationPairEvidence | null;
} {
  const randomizedOrder = resolveHamletDomPublicationPairOrder(drawUint32);
  let sequenceIndex: 0 | 1 = 0;
  let capture = createHamletNoUpdateShellCapture(identity, {
    deferCohortDomPublication:
      randomizedOrder[0] === HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
  });
  const arms: HamletDomPublicationPairArmEvidence[] = [];
  let report: HamletDomPublicationPairEvidence | null = null;

  return {
    getCurrentTreatment: () => randomizedOrder[sequenceIndex],
    appendRafTimestamp: (timestampMs) => {
      if (report) {
        throw new Error('DOM publication pair is already complete.');
      }
      return capture.appendRafTimestamp(timestampMs);
    },
    completeCurrentArm: (input) => {
      if (report) {
        return {
          advanceToNextArm: false,
          report: cloneJson(report),
        };
      }
      if (!Number.isFinite(input.completedAtPerformanceTimestampMs)) {
        throw new Error(
          'DOM publication pair arm completion timestamp must be finite.',
        );
      }
      const captureReport = capture.getReport();
      const treatment = randomizedOrder[sequenceIndex];
      if (!captureReport) {
        throw new Error(
          'DOM publication pair arm cannot complete before its exact cohort.',
        );
      }
      if (
        captureReport.treatment !== treatment
        || captureReport.leadIn.runUuid !== identity.runUuid
        || captureReport.judgedCohort.runUuid !== identity.runUuid
        || captureReport.leadIn.performanceTimeOriginMs
          !== identity.performanceTimeOriginMs
        || captureReport.judgedCohort.performanceTimeOriginMs
          !== identity.performanceTimeOriginMs
      ) {
        throw new Error(
          'DOM publication pair arm identity or treatment leaked across arms.',
        );
      }
      if (
        !doesHamletNoUpdateShellMatchCollector(
          captureReport,
          input.performanceReport,
        )
      ) {
        throw new Error(
          'DOM publication pair arm did not exactly match schema-5 metrics.',
        );
      }
      if (
        !isValidDomPublicationArmEvidence(
          treatment,
          input.domPublication,
        )
      ) {
        throw new Error(
          'DOM publication pair arm counters do not match its treatment.',
        );
      }
      const arm: HamletDomPublicationPairArmEvidence = {
        ...cloneJson(captureReport),
        sequenceIndex: sequenceIndex + 1 as 1 | 2,
        completedAtPerformanceTimestampMs:
          input.completedAtPerformanceTimestampMs,
        performanceReport: cloneJson(input.performanceReport),
        collectorAgreement: {
          schemaVersion: 5,
          exactSampleCount: true,
          exactMetrics: true,
          zeroRendererSubmissions: true,
          domPublication: cloneJson(input.domPublication),
        },
      };
      arms.push(arm);
      if (sequenceIndex === 0) {
        sequenceIndex = 1;
        capture = createHamletNoUpdateShellCapture(identity, {
          deferCohortDomPublication:
            randomizedOrder[1]
              === HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
        });
        return { advanceToNextArm: true, report: null };
      }

      const first = arms[0]!;
      const second = arms[1]!;
      const firstCohortEndToSecondLeadInStart =
        second.leadIn.startedAtRafTimestampMs
        - first.judgedCohort.completedAtRafTimestampMs;
      const firstTerminalFreezeToSecondLeadInStart =
        second.leadIn.startedAtRafTimestampMs
        - first.completedAtPerformanceTimestampMs;
      if (
        firstCohortEndToSecondLeadInStart < 0
        || firstTerminalFreezeToSecondLeadInStart < 0
      ) {
        throw new Error(
          'DOM publication pair arms overlapped instead of handing off.',
        );
      }
      report = {
        ...identity,
        schemaVersion: 1,
        experiment:
          'same-document-randomized-dom-publication-paired-reversion',
        randomization: {
          source: 'crypto.getRandomValues-uint32-low-bit',
          drawUint32,
          orderBit: (drawUint32 & 1) as 0 | 1,
        },
        randomizedOrder: [...randomizedOrder],
        arms: [cloneJson(first), cloneJson(second)],
        armHandoffGapsMs: {
          firstCohortEndToSecondLeadInStart,
          firstTerminalFreezeToSecondLeadInStart,
        },
      };
      return {
        advanceToNextArm: false,
        report: cloneJson(report),
      };
    },
    getReport: () => report === null ? null : cloneJson(report),
  };
}

export function createHamletBareRafCapture(
  identity: HamletPerformancePairIdentity,
): {
  appendRafTimestamp(timestampMs: number): HamletBareRafCaptureEvidence | null;
  getReport(): HamletBareRafCaptureEvidence | null;
} {
  let leadInStartedAtRafTimestampMs: number | null = null;
  let previousRafTimestampMs: number | null = null;
  let leadIn: HamletBareRafLeadInEvidence | null = null;
  let startedAtRafTimestampMs: number | null = null;
  let report: HamletBareRafCaptureEvidence | null = null;
  const leadInFrameTimes: number[] = [];
  const frameTimes: number[] = [];
  return {
    appendRafTimestamp: (timestampMs) => {
      if (report) return cloneJson(report);
      if (!Number.isFinite(timestampMs)) {
        throw new Error('Bare-rAF timestamps must be finite.');
      }
      if (leadInStartedAtRafTimestampMs === null) {
        leadInStartedAtRafTimestampMs = timestampMs;
        previousRafTimestampMs = timestampMs;
        return null;
      }
      if (
        previousRafTimestampMs === null
        || timestampMs <= previousRafTimestampMs
      ) {
        throw new Error('Bare-rAF timestamps must be strictly increasing.');
      }
      if (leadIn === null) {
        leadInFrameTimes.push(timestampMs - previousRafTimestampMs);
        previousRafTimestampMs = timestampMs;
        const leadInElapsedMs =
          timestampMs - leadInStartedAtRafTimestampMs;
        if (leadInElapsedMs < HAMLET_BARE_RAF_LEAD_IN_MS) return null;
        leadIn = {
          ...identity,
          phase: 'bare-raf-lead-in',
          beforeArm: 'bare-raf-only',
          declaredDurationMs: HAMLET_BARE_RAF_LEAD_IN_MS,
          startedAtRafTimestampMs: leadInStartedAtRafTimestampMs,
          completedAtRafTimestampMs: timestampMs,
          elapsedMs: leadInElapsedMs,
          sampleCount: leadInFrameTimes.length,
          frameTimesMs: [...leadInFrameTimes],
          forbiddenWork: {
            routeSceneUpdates: 0,
            rendererCalls: 0,
            perFrameDomTelemetryWrites: 0,
          },
        };
        startedAtRafTimestampMs = timestampMs;
        return null;
      }
      if (startedAtRafTimestampMs === null) {
        throw new Error('Bare-rAF lead-in completed without arming the cohort.');
      }
      frameTimes.push(timestampMs - previousRafTimestampMs);
      previousRafTimestampMs = timestampMs;
      const windowElapsedMs = timestampMs - startedAtRafTimestampMs;
      if (windowElapsedMs < HAMLET_BARE_RAF_WINDOW_MS) return null;
      const frameTimesMs = [...frameTimes];
      const elapsedMs = frameTimesMs.reduce(
        (totalMs, frameTimeMs) => totalMs + frameTimeMs,
        0,
      );
      const metrics = calculateVisualPerformanceMetrics(frameTimesMs);
      if (!metrics) {
        throw new Error('Bare-rAF control completed without valid intervals.');
      }
      report = {
        leadIn,
        bareRaf: {
          ...identity,
          arm: 'bare-raf-only',
          sequenceIndex: 2,
          windowSeconds: 30,
          startedAtRafTimestampMs,
          completedAtRafTimestampMs: timestampMs,
          elapsedMs,
          sampleCount: frameTimesMs.length,
          frameTimesMs,
          metrics,
          forbiddenWork: {
            routeSceneUpdates: 0,
            rendererCalls: 0,
            perFrameDomTelemetryWrites: 0,
          },
        },
      };
      return cloneJson(report);
    },
    getReport: () => report === null ? null : cloneJson(report),
  };
}

const ABLATIONS: Record<HamletAblationId, HamletFixtureAblation> = {
  baseline: {
    id: 'baseline',
    disabledSubsystems: [],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'route-warmup': {
    id: 'route-warmup',
    disabledSubsystems: [],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'full-route',
  },
  'forest-selection-frozen': {
    id: 'forest-selection-frozen',
    disabledSubsystems: [],
    forestSelection: 'frozen',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'groundcover-stream-frozen': {
    id: 'groundcover-stream-frozen',
    disabledSubsystems: [],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'frozen',
    routeWarmup: 'full-route',
  },
  'groundcover-stream-forest-update-frozen': {
    id: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: [],
    forestSelection: 'budgeted',
    forestUpdates: 'frozen-after-settled-warmup',
    groundcoverStreaming: 'frozen',
    routeWarmup: 'full-route',
  },
  'groundcover-off': {
    id: 'groundcover-off',
    disabledSubsystems: ['groundcover'],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'post-off': {
    id: 'post-off',
    disabledSubsystems: ['post'],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'shadows-off': {
    id: 'shadows-off',
    disabledSubsystems: ['shadows'],
    forestSelection: 'budgeted',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'forest-render-off': {
    id: 'forest-render-off',
    disabledSubsystems: ['forest'],
    forestSelection: 'disabled',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
  'heavy-render-off': {
    id: 'heavy-render-off',
    disabledSubsystems: ['groundcover', 'post', 'shadows', 'forest'],
    forestSelection: 'disabled',
    forestUpdates: 'active',
    groundcoverStreaming: 'active',
    routeWarmup: 'none',
  },
};

export function resolveHamletFixtureAblation(
  requestedId: string | null | undefined,
): HamletFixtureAblation {
  const id = requestedId ?? 'baseline';
  if (!(HAMLET_ABLATION_IDS as readonly string[]).includes(id)) {
    throw new Error(`Unknown hamlet fixture ablation "${id}".`);
  }
  const resolved = ABLATIONS[id as HamletAblationId];
  return {
    ...resolved,
    disabledSubsystems: [...resolved.disabledSubsystems],
  };
}

export type HamletForestRouteWorkTelemetry = {
  mode:
    | 'full'
    | 'budgeted-time-chunk'
    | 'frozen'
    | 'frozen-after-settled-warmup'
    | 'disabled';
  updateAblation: HamletForestUpdateAblationTelemetry;
  configuredMaxBucketCompactionsPerFrame: number;
  maxBucketCompactionsPerFrame: number;
  maxUpdateDurationBudgetMs: number;
  minimumCameraMoveMeters: number;
  minimumDirectionAngleDegrees: number;
  minimumProjectionChange: number;
  minimumCasterBoundsChangeMeters: number;
  totalBucketCompactions: number;
  totalBucketUploads: number;
  totalWorkChunks: number;
  totalMatrixWrites: number;
  selectorEvaluations: number;
  selectorSkips: number;
  triggerReasons: Record<string, number>;
  selectionChanges: number;
  pendingBuckets: number;
  maxUpdateDurationMs: number;
  phases: Record<'strategic' | 'settlement' | 'road-eye', {
    frames: number;
    selectionChanges: number;
    bucketCompactions: number;
    bucketUploads: number;
    workChunks: number;
    matrixWrites: number;
    maxBucketCompactionsPerFrame: number;
    maxUpdateDurationMs: number;
    triggerReasons: Record<string, number>;
  }>;
  settledKeyframes: Record<'strategic-settled' | 'road-eye-settled', {
    observations: number;
    pendingBuckets: number;
    maxPendingBuckets: number;
    converged: boolean;
    sampledAtMs: number | null;
    sampleTiming: 'pre-departure-dwell';
  }>;
};

export type HamletForestUpdateAblationTelemetry = {
  requestedMode: HamletFixtureAblation['forestUpdates'];
  state: 'not-requested' | 'warming' | 'frozen';
  pendingBucketsAtFreeze: number | null;
  convergedAtFreeze: boolean;
};

export function resolveHamletForestUpdateAblationTelemetry(input: {
  requestedMode: HamletFixtureAblation['forestUpdates'];
  warmupCompleted: boolean;
  pendingBuckets: number;
}): HamletForestUpdateAblationTelemetry {
  if (input.requestedMode === 'active') {
    return {
      requestedMode: input.requestedMode,
      state: 'not-requested',
      pendingBucketsAtFreeze: null,
      convergedAtFreeze: false,
    };
  }
  const pendingBuckets = normalizePendingBuckets(input.pendingBuckets);
  const convergedAtFreeze = input.warmupCompleted && pendingBuckets === 0;
  return {
    requestedMode: input.requestedMode,
    state: convergedAtFreeze ? 'frozen' : 'warming',
    pendingBucketsAtFreeze: convergedAtFreeze ? pendingBuckets : null,
    convergedAtFreeze,
  };
}

export type HamletFixturePerformanceProtocol = {
  requested: boolean;
  valid: boolean;
  cssViewport: { width: number; height: number };
  drawingBuffer: { width: number; height: number };
  rendererPixelRatio: number;
  expected: typeof HAMLET_PERFORMANCE_VIEWPORT.label;
};

export type HamletFixtureRouteWarmupEvidence = {
  required: boolean;
  stage: 'not-required' | 'waiting' | 'route' | 'strategic-drain' | 'resettling' | 'complete';
  completedRoutes: number;
  completed: boolean;
  strategicPendingAtReset: number | null;
  collectorReset: boolean;
};

export type HamletFixtureRouteWarmupDrainResult = {
  stepped: boolean;
  progressed: boolean;
  pendingBuckets: number;
  complete: boolean;
};

export function advanceHamletFixtureRouteWarmupDrain(input: {
  stage: HamletFixtureRouteWarmupEvidence['stage'];
  motionStatus: string;
  pendingBuckets: number;
  step(): number;
}): HamletFixtureRouteWarmupDrainResult {
  const pendingBuckets = normalizePendingBuckets(input.pendingBuckets);
  if (input.stage !== 'strategic-drain' || input.motionStatus !== 'complete') {
    return {
      stepped: false,
      progressed: false,
      pendingBuckets,
      complete: false,
    };
  }
  if (pendingBuckets === 0) {
    return {
      stepped: false,
      progressed: false,
      pendingBuckets: 0,
      complete: true,
    };
  }
  const nextPendingBuckets = normalizePendingBuckets(input.step());
  return {
    stepped: true,
    progressed: nextPendingBuckets < pendingBuckets,
    pendingBuckets: nextPendingBuckets,
    complete: nextPendingBuckets === 0,
  };
}

export function resolveHamletPerformanceProtocol(input: {
  requested: boolean;
  cssWidth: number;
  cssHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  rendererPixelRatio: number;
}): HamletFixturePerformanceProtocol {
  return {
    requested: input.requested,
    valid: input.cssWidth === HAMLET_PERFORMANCE_VIEWPORT.width
      && input.cssHeight === HAMLET_PERFORMANCE_VIEWPORT.height
      && input.drawingBufferWidth === HAMLET_PERFORMANCE_VIEWPORT.width
      && input.drawingBufferHeight === HAMLET_PERFORMANCE_VIEWPORT.height
      && input.rendererPixelRatio === HAMLET_PERFORMANCE_VIEWPORT.rendererPixelRatio,
    cssViewport: { width: input.cssWidth, height: input.cssHeight },
    drawingBuffer: {
      width: input.drawingBufferWidth,
      height: input.drawingBufferHeight,
    },
    rendererPixelRatio: input.rendererPixelRatio,
    expected: HAMLET_PERFORMANCE_VIEWPORT.label,
  };
}

export type HamletFixtureEvidenceEnvelope = {
  schemaVersion: 1;
  fixtureId: string;
  routeId: string;
  routeDurationMs: number;
  ablation: HamletFixtureAblation;
  protocol: HamletFixturePerformanceProtocol;
  performanceReport: VisualPerformanceReport | null;
  forestWork: HamletForestRouteWorkTelemetry & {
    converged: boolean;
    settledKeyframesConverged: boolean;
  };
  groundcoverWork: GrassStreamTelemetry;
  route: {
    completedRoutes: number;
    phasesTraversed: Record<'strategic' | 'settlement' | 'road-eye', boolean>;
    warmup: HamletFixtureRouteWarmupEvidence;
  };
  content: {
    residences: number;
    residenceRoof: 'wood-shingle';
    trees: number;
    visibleTrees: number;
    forestDraws: number;
    forestEdgeLayer?: HamletForestEdgeLayerEvidence;
    underCanopyGround?: HamletUnderCanopyGroundEvidence;
  };
  presentationTreatment?: {
    id: string;
    rendererTreatment:
      typeof HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT;
    disabledSubsystems: string[];
    groundcoverFadeMode:
      | 'continuous-alpha-coverage'
      | 'continuous-alpha-hash'
      | 'legacy-pipeline-cutover';
    groundcoverSubmission:
      'three-whole-field-instanced-meshes';
    forestRenderer: HamletRouteForestRenderer;
    forestEdgeLayout?: HamletForestEdgeLayout;
    forestUpdates: 'frozen-after-settled-warmup';
    postProcessing: 'disabled';
    shadowSubsystem: HamletRouteShadowSubsystem;
  };
  pairedRafControl?: HamletPairedRafControlEvidence;
  noUpdateShell?: HamletNoUpdateShellEvidence;
  pairedDomPublicationControl?: HamletDomPublicationPairEvidence;
  frozenUpdateDirectRender?: HamletFrozenUpdateDirectRenderEvidence;
  routeLodSkyDirectRender?: HamletRouteLodSkyDirectRenderEvidence;
  pairedRouteUpdateControl?: HamletRouteUpdatePairEvidence;
};

export function createHamletFixtureEvidenceEnvelope(input: {
  fixtureId: string;
  routeId: string;
  routeDurationMs: number;
  ablation: HamletFixtureAblation;
  protocol: HamletFixturePerformanceProtocol;
  performanceReport: VisualPerformanceReport | null;
  forestWork: HamletForestRouteWorkTelemetry;
  groundcoverWork: GrassStreamTelemetry;
  completedRoutes: number;
  routeWarmup: HamletFixtureRouteWarmupEvidence;
  content: HamletFixtureEvidenceEnvelope['content'];
  presentationTreatment?:
    HamletFixtureEvidenceEnvelope['presentationTreatment'];
  pairedRafControl?: HamletPairedRafControlEvidence;
  noUpdateShell?: HamletNoUpdateShellEvidence;
  pairedDomPublicationControl?: HamletDomPublicationPairEvidence;
  frozenUpdateDirectRender?: HamletFrozenUpdateDirectRenderEvidence;
  routeLodSkyDirectRender?: HamletRouteLodSkyDirectRenderEvidence;
  pairedRouteUpdateControl?: HamletRouteUpdatePairEvidence;
}): HamletFixtureEvidenceEnvelope {
  return {
    schemaVersion: 1,
    fixtureId: input.fixtureId,
    routeId: input.routeId,
    routeDurationMs: input.routeDurationMs,
    ablation: {
      ...input.ablation,
      disabledSubsystems: [...input.ablation.disabledSubsystems],
    },
    protocol: cloneJson(input.protocol),
    performanceReport: input.performanceReport === null
      ? null
      : cloneJson(input.performanceReport),
    forestWork: {
      ...cloneJson(input.forestWork),
      converged: input.forestWork.pendingBuckets === 0,
      settledKeyframesConverged: Object.values(
        input.forestWork.settledKeyframes,
      ).every((checkpoint) => checkpoint.observations > 0 && checkpoint.converged),
    },
    groundcoverWork: cloneJson(input.groundcoverWork),
    route: {
      completedRoutes: Math.max(0, Math.floor(input.completedRoutes)),
      phasesTraversed: {
        strategic: input.forestWork.phases.strategic.frames > 0,
        settlement: input.forestWork.phases.settlement.frames > 0,
        'road-eye': input.forestWork.phases['road-eye'].frames > 0,
      },
      warmup: cloneJson(input.routeWarmup),
    },
    content: cloneJson(input.content),
    ...(input.presentationTreatment
      ? {
          presentationTreatment:
            cloneJson(input.presentationTreatment),
        }
      : {}),
    ...(input.pairedRafControl
      ? { pairedRafControl: cloneJson(input.pairedRafControl) }
      : {}),
    ...(input.noUpdateShell
      ? { noUpdateShell: cloneJson(input.noUpdateShell) }
      : {}),
    ...(input.pairedDomPublicationControl
      ? {
          pairedDomPublicationControl:
            cloneJson(input.pairedDomPublicationControl),
        }
      : {}),
    ...(input.frozenUpdateDirectRender
      ? {
          frozenUpdateDirectRender:
            cloneJson(input.frozenUpdateDirectRender),
        }
      : {}),
    ...(input.routeLodSkyDirectRender
      ? {
          routeLodSkyDirectRender:
            cloneJson(input.routeLodSkyDirectRender),
        }
      : {}),
    ...(input.pairedRouteUpdateControl
      ? {
          pairedRouteUpdateControl:
            cloneJson(input.pairedRouteUpdateControl),
        }
      : {}),
  };
}

export function canFinalizeHamletFixtureEvidence(
  envelope: HamletFixtureEvidenceEnvelope | null,
  bootStatus: 'initializing' | 'ready' | 'ready-degraded' | 'failed',
): boolean {
  if (
    !envelope
    || bootStatus !== 'ready'
    || !envelope.protocol.requested
    || !envelope.protocol.valid
    || envelope.performanceReport?.status !== 'ready'
    || envelope.route.completedRoutes < 1
    || !Object.values(envelope.route.phasesTraversed).every(Boolean)
  ) {
    return false;
  }
  if (
    envelope.ablation.groundcoverStreaming === 'frozen'
    && (
      envelope.groundcoverWork.mode !== 'frozen'
      || envelope.groundcoverWork.pendingSlots !== 0
      || !envelope.groundcoverWork.converged
    )
  ) {
    return false;
  }
  // Profile-only visualDisable controls may hide the forest and groundcover
  // render groups while their warmed/frozen managers remain the treatment under
  // test. Keep those controls in the runtime report: the canonical frozen
  // ablation itself must preserve its full scene identity.
  if (
    envelope.ablation.forestUpdates === 'frozen-after-settled-warmup'
    && (
      envelope.ablation.disabledSubsystems.length !== 0
      || envelope.content.trees <= 0
      || envelope.content.visibleTrees <= 0
      || envelope.content.forestDraws <= 0
      || envelope.forestWork.mode !== 'frozen-after-settled-warmup'
      || envelope.forestWork.updateAblation.requestedMode
        !== 'frozen-after-settled-warmup'
      || envelope.forestWork.updateAblation.state !== 'frozen'
      || !envelope.forestWork.updateAblation.convergedAtFreeze
      || envelope.forestWork.updateAblation.pendingBucketsAtFreeze !== 0
      || !envelope.forestWork.converged
      || !envelope.forestWork.settledKeyframesConverged
      || envelope.forestWork.totalBucketCompactions !== 0
      || envelope.forestWork.totalBucketUploads !== 0
      || envelope.forestWork.totalWorkChunks !== 0
      || envelope.forestWork.totalMatrixWrites !== 0
      || envelope.forestWork.selectorEvaluations !== 0
      || envelope.forestWork.selectionChanges !== 0
      || envelope.forestWork.maxUpdateDurationMs !== 0
    )
  ) {
    return false;
  }
  return warmupProtocolSatisfied(envelope);
}

export function canFinalizeHamletNoUpdateShellEvidence(
  envelope: HamletFixtureEvidenceEnvelope | null,
  capture: HamletNoUpdateShellCaptureEvidence | null,
  bootStatus: 'initializing' | 'ready' | 'ready-degraded' | 'failed',
): boolean {
  if (
    !envelope
    || !capture
    || bootStatus !== 'ready'
    || !envelope.protocol.requested
    || !envelope.protocol.valid
    || !envelope.performanceReport
    || envelope.performanceReport.status !== 'ready'
    || envelope.ablation.id
      !== 'groundcover-stream-forest-update-frozen'
    || envelope.ablation.routeWarmup !== 'full-route'
    || envelope.groundcoverWork.mode !== 'frozen'
    || envelope.groundcoverWork.pendingSlots !== 0
    || !envelope.groundcoverWork.converged
    || envelope.forestWork.mode !== 'frozen-after-settled-warmup'
    || envelope.forestWork.pendingBuckets !== 0
    || envelope.forestWork.totalBucketCompactions !== 0
    || envelope.forestWork.totalBucketUploads !== 0
    || envelope.forestWork.totalWorkChunks !== 0
    || envelope.forestWork.totalMatrixWrites !== 0
    || envelope.forestWork.selectorEvaluations !== 0
    || envelope.forestWork.selectionChanges !== 0
    || !warmupProtocolSatisfied(envelope)
  ) {
    return false;
  }
  return doesHamletNoUpdateShellMatchCollector(
    capture,
    envelope.performanceReport,
  );
}

export function canFinalizeHamletFrozenUpdateDirectRenderEvidence(
  envelope: HamletFixtureEvidenceEnvelope | null,
  capture: HamletFrozenUpdateDirectRenderCaptureEvidence | null,
  bootStatus: 'initializing' | 'ready' | 'ready-degraded' | 'failed',
): boolean {
  if (
    !envelope
    || !capture
    || bootStatus !== 'ready'
    || !envelope.protocol.requested
    || !envelope.protocol.valid
    || !envelope.performanceReport
    || envelope.performanceReport.status !== 'ready'
    || envelope.ablation.id
      !== 'groundcover-stream-forest-update-frozen'
    || envelope.ablation.routeWarmup !== 'full-route'
    || envelope.groundcoverWork.mode !== 'frozen'
    || envelope.groundcoverWork.pendingSlots !== 0
    || !envelope.groundcoverWork.converged
    || envelope.forestWork.mode !== 'frozen-after-settled-warmup'
    || envelope.forestWork.updateAblation.state !== 'frozen'
    || !envelope.forestWork.updateAblation.convergedAtFreeze
    || envelope.forestWork.updateAblation.pendingBucketsAtFreeze !== 0
    || envelope.forestWork.pendingBuckets !== 0
    || envelope.forestWork.totalBucketCompactions !== 0
    || envelope.forestWork.totalBucketUploads !== 0
    || envelope.forestWork.totalWorkChunks !== 0
    || envelope.forestWork.totalMatrixWrites !== 0
    || envelope.forestWork.selectorEvaluations !== 0
    || envelope.forestWork.selectionChanges !== 0
    || !warmupProtocolSatisfied(envelope)
  ) {
    return false;
  }
  return doesHamletFrozenUpdateDirectRenderMatchCollector(
    capture,
    envelope.performanceReport,
  );
}

export function canFinalizeHamletRouteLodSkyDirectRenderEvidence(
  envelope: HamletFixtureEvidenceEnvelope | null,
  capture: HamletRouteLodSkyDirectRenderCaptureEvidence | null,
  bootStatus: 'initializing' | 'ready' | 'ready-degraded' | 'failed',
): boolean {
  if (
    !envelope
    || !capture
    || !canFinalizeHamletFixtureEvidence(envelope, bootStatus)
    || bootStatus !== 'ready'
    || !envelope.protocol.requested
    || !envelope.protocol.valid
    || !envelope.performanceReport
    || envelope.performanceReport.status !== 'ready'
    || envelope.ablation.id
      !== 'groundcover-stream-forest-update-frozen'
    || envelope.ablation.routeWarmup !== 'full-route'
    || envelope.route.completedRoutes < 1
    || !Object.values(envelope.route.phasesTraversed).every(Boolean)
    || envelope.groundcoverWork.mode !== 'frozen'
    || envelope.groundcoverWork.pendingSlots !== 0
    || !envelope.groundcoverWork.converged
    || envelope.forestWork.mode !== 'frozen-after-settled-warmup'
    || envelope.forestWork.updateAblation.state !== 'frozen'
    || !envelope.forestWork.updateAblation.convergedAtFreeze
    || envelope.forestWork.updateAblation.pendingBucketsAtFreeze !== 0
    || envelope.forestWork.pendingBuckets !== 0
    || envelope.forestWork.totalBucketCompactions !== 0
    || envelope.forestWork.totalBucketUploads !== 0
    || envelope.forestWork.totalWorkChunks !== 0
    || envelope.forestWork.totalMatrixWrites !== 0
    || envelope.forestWork.selectorEvaluations !== 0
    || envelope.forestWork.selectionChanges !== 0
    || envelope.forestWork.maxUpdateDurationMs !== 0
    || !doesHamletRoutePresentationMatchCapture(envelope, capture)
    || !warmupProtocolSatisfied(envelope)
  ) {
    return false;
  }
  return doesHamletRouteLodSkyDirectRenderMatchCollector(
    capture,
    envelope.performanceReport,
  );
}

function doesHamletRoutePresentationMatchCapture(
  envelope: HamletFixtureEvidenceEnvelope,
  capture: HamletRouteLodSkyDirectRenderCaptureEvidence,
): boolean {
  const presentation = envelope.presentationTreatment;
  if (!presentation) return false;
  const forestEnabled =
    capture.forestRenderer === HAMLET_ROUTE_FOREST_RENDERER_ENABLED;
  const shadowsEnabled =
    capture.shadowSubsystem === HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED;
  const expectedDisabledSubsystems = [
    ...(!forestEnabled ? ['forest'] : []),
    'post',
    ...(!shadowsEnabled ? ['shadows'] : []),
  ].sort();
  const actualDisabledSubsystems =
    [...presentation.disabledSubsystems].sort();
  const edgeLayoutMatches =
    capture.forestEdgeLayout === undefined
      ? true
      : presentation.forestEdgeLayout === capture.forestEdgeLayout
        && capture.routeFrameSequence.forestEdgeLayout
          === capture.forestEdgeLayout
        && doesHamletForestEdgeLayerSatisfyBudget(
          envelope.content.forestEdgeLayer,
          capture.forestEdgeLayout,
          envelope.content.trees,
          envelope.content.forestDraws,
        );
  return actualDisabledSubsystems.length
      === expectedDisabledSubsystems.length
    && actualDisabledSubsystems.every(
      (subsystem, index) =>
        subsystem === expectedDisabledSubsystems[index],
    )
    && presentation.forestRenderer === capture.forestRenderer
    && presentation.forestUpdates === capture.forestUpdates
    && presentation.postProcessing === capture.postProcessing
    && presentation.shadowSubsystem === capture.shadowSubsystem
    && edgeLayoutMatches
    && presentation.groundcoverFadeMode === 'continuous-alpha-coverage'
    && presentation.groundcoverSubmission
      === 'three-whole-field-instanced-meshes';
}

function doesHamletForestEdgeLayerSatisfyBudget(
  evidence: HamletForestEdgeLayerEvidence | undefined,
  layout: HamletForestEdgeLayout,
  renderedTreeSlots: number,
  forestDraws: number,
): boolean {
  if (
    !evidence
    || evidence.layout !== layout
    || evidence.sourceSlots !== 1651
    || renderedTreeSlots !== 1651
    || evidence.seedThreeCommit
      !== '4182accfc1fb7a66815e963b5355ca4996418cf3'
    || evidence.budget.treeSlotDelta !== 0
    || evidence.budget.speciesPresetDelta !== 0
    || evidence.budget.instanceCapacityDelta !== 0
    || evidence.budget.textureAssetDelta !== 0
    || evidence.budget.forestDrawBudget !== 20
    || evidence.budget.forestDrawDelta !== 0
    || evidence.budget.maximumTriangleBudgetDelta !== 'non-positive'
    || evidence.budget.trianglePolicy
      !== 'all-reallocated-slots-capped-to-existing-overview-card-detail'
    || forestDraws > evidence.budget.forestDrawBudget
  ) {
    return false;
  }
  if (layout === HAMLET_FOREST_EDGE_LAYOUT_LEGACY) {
    return evidence.reallocatedSlots === 0
      && evidence.retainedSlots === 1651
      && evidence.clusterCount === 0
      && evidence.maximumClusterSize === HAMLET_FOREST_EDGE_CLUSTER_SIZE
      && evidence.bandMeters.minimum
        === HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS
      && evidence.bandMeters.maximum
        === HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS
      && evidence.bandMeters.observedMinimum === null
      && evidence.bandMeters.observedMaximum === null
      && evidence.variants.broadleafSaplings === 0
      && evidence.variants.broadleafShrubCards === 0
      && evidence.variants.broadleafMixedCrowns === 0
      && evidence.clearance === undefined;
  }
  if (layout === HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED) {
    return evidence.reallocatedSlots === 256
      && evidence.retainedSlots === 1395
      && evidence.clusterCount === 32
      && evidence.maximumClusterSize === HAMLET_FOREST_EDGE_CLUSTER_SIZE
      && evidence.bandMeters.minimum
        === HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS
      && evidence.bandMeters.maximum
        === HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS
      && evidence.bandMeters.observedMinimum !== null
      && evidence.bandMeters.observedMinimum
        >= HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS
      && evidence.bandMeters.observedMaximum !== null
      && evidence.bandMeters.observedMaximum
        <= HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS
      && evidence.variants.broadleafSaplings === 128
      && evidence.variants.broadleafShrubCards === 128
      && evidence.variants.broadleafMixedCrowns === 0
      && evidence.clearance === undefined;
  }
  if (layout === HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING) {
    return evidence.reallocatedSlots === 256
      && evidence.retainedSlots === 1395
      && evidence.clusterCount === HAMLET_FOREST_THICKET_CLUSTER_COUNT
      && evidence.maximumClusterSize
        === HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE
      && evidence.bandMeters.minimum
        === HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS
      && evidence.bandMeters.maximum
        === HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS
      && evidence.bandMeters.observedMinimum !== null
      && evidence.bandMeters.observedMinimum
        >= HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS
      && evidence.bandMeters.observedMaximum !== null
      && evidence.bandMeters.observedMaximum
        <= HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS
      && evidence.variants.broadleafSaplings
        === HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT
      && evidence.variants.broadleafShrubCards
        === HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT
      && evidence.variants.broadleafMixedCrowns
        === HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT
      && evidence.clearance?.roadMeters
        === HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
      && evidence.clearance.settlementMeters
        === HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
      && evidence.clearance.observedRoadMinimum
        >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
      && evidence.clearance.observedSettlementMinimum
        >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS;
  }
  if (layout !== HAMLET_FOREST_EDGE_LAYOUT_TAPERED) return false;
  return evidence.reallocatedSlots === 256
    && evidence.retainedSlots === 1395
    && evidence.clusterCount === 132
    && evidence.maximumClusterSize
      === HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE
    && evidence.bandMeters.minimum
      === HAMLET_FOREST_BELT_MIN_DISTANCE_METERS
    && evidence.bandMeters.maximum
      === HAMLET_FOREST_BELT_MAX_DISTANCE_METERS
    && evidence.bandMeters.observedMinimum !== null
    && evidence.bandMeters.observedMinimum
      >= HAMLET_FOREST_BELT_MIN_DISTANCE_METERS
    && evidence.bandMeters.observedMaximum !== null
    && evidence.bandMeters.observedMaximum
      <= HAMLET_FOREST_BELT_MAX_DISTANCE_METERS
    && evidence.variants.broadleafSaplings
      === HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT
    && evidence.variants.broadleafShrubCards
      === HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT
    && evidence.variants.broadleafMixedCrowns
      === HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT
    && evidence.clearance?.roadMeters
      === HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    && evidence.clearance.settlementMeters
      === HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
    && evidence.clearance.observedRoadMinimum
      >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    && evidence.clearance.observedSettlementMinimum
      >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS;
}

export function canFinalizeHamletRouteUpdatePairArmEvidence(
  envelope: HamletFixtureEvidenceEnvelope | null,
  bootStatus: 'initializing' | 'ready' | 'ready-degraded' | 'failed',
): boolean {
  return Boolean(
    envelope
    && bootStatus === 'ready'
    && envelope.protocol.requested
    && envelope.protocol.valid
    && envelope.performanceReport?.status === 'ready'
    && envelope.ablation.id
      === 'groundcover-stream-forest-update-frozen'
    && envelope.ablation.routeWarmup === 'full-route'
    && envelope.groundcoverWork.mode === 'frozen'
    && envelope.groundcoverWork.pendingSlots === 0
    && envelope.groundcoverWork.converged
    && envelope.forestWork.mode === 'frozen-after-settled-warmup'
    && envelope.forestWork.updateAblation.state === 'frozen'
    && envelope.forestWork.updateAblation.convergedAtFreeze
    && envelope.forestWork.updateAblation.pendingBucketsAtFreeze === 0
    && envelope.forestWork.pendingBuckets === 0
    && envelope.forestWork.totalBucketCompactions === 0
    && envelope.forestWork.totalBucketUploads === 0
    && envelope.forestWork.totalWorkChunks === 0
    && envelope.forestWork.totalMatrixWrites === 0
    && envelope.forestWork.selectorEvaluations === 0
    && envelope.forestWork.selectionChanges === 0
    && warmupProtocolSatisfied(envelope)
  );
}

function warmupProtocolSatisfied(envelope: HamletFixtureEvidenceEnvelope): boolean {
  if (envelope.ablation.routeWarmup !== 'full-route') return true;
  const warmup = envelope.route.warmup;
  return warmup.required
    && warmup.stage === 'complete'
    && warmup.completed
    && warmup.completedRoutes >= 1
    && warmup.strategicPendingAtReset === 0
    && warmup.collectorReset;
}

function normalizePendingBuckets(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Number.MAX_SAFE_INTEGER;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
