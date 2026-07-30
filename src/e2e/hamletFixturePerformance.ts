import type { GrassStreamTelemetry } from '../grass/GrassBladeField.ts';
import {
  calculateVisualPerformanceMetrics,
  type ProfileSubsystem,
  type VisualPerformanceDomPublicationEvidence,
  type VisualPerformanceMetrics,
  type VisualPerformanceReport,
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

type HamletNoUpdateShellTreatment =
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
  };
  pairedRafControl?: HamletPairedRafControlEvidence;
  noUpdateShell?: HamletNoUpdateShellEvidence;
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
  pairedRafControl?: HamletPairedRafControlEvidence;
  noUpdateShell?: HamletNoUpdateShellEvidence;
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
    content: { ...input.content },
    ...(input.pairedRafControl
      ? { pairedRafControl: cloneJson(input.pairedRafControl) }
      : {}),
    ...(input.noUpdateShell
      ? { noUpdateShell: cloneJson(input.noUpdateShell) }
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
