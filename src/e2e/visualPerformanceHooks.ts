import * as THREE from 'three';
import type { ScenePostProcessor } from '../scene/PostProcessing.ts';
import type {
  RendererAdapterEvidence,
  RendererBackend,
  SupportedRenderer,
} from '../scene/RendererBackend.ts';
import type { GrassStreamTelemetry } from '../grass/GrassBladeField.ts';
import type { ForestCanopyOcclusionDebugMode } from '../terrain/ForestCanopyOcclusion.ts';
import type {
  TerrainHorizonDebugMode,
  TerrainHorizonDiagnostics,
} from '../terrain/TerrainHorizon.ts';
import type { SeedThreeForestProfileBreakdown } from '../vegetation/seedthree/seedThreeForestTypes.ts';
import {
  createVisualGpuTimestampProfiler,
  type VisualGpuFrameTiming,
  type VisualGpuFrameTimingStatus,
  type VisualGpuTimingEvidence,
  type VisualGpuTimestampFrameHandle,
  type VisualGpuTimestampProfiler,
  VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
} from './webGpuTimestampProfiler.ts';

export type ProfileSubsystem =
  | 'post'
  | 'sky'
  | 'shadows'
  | 'river'
  | 'riverSimulation'
  | 'riverRender'
  | 'precipitation'
  | 'selection'
  | 'preview'
  | 'terrain'
  | 'groundcover'
  | 'forest'
  | 'ui';

type RuntimeSceneManager = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: SupportedRenderer;
  postProcessor: ScenePostProcessor;
  sky: THREE.Object3D;
  sunLight: THREE.DirectionalLight;
  riverSystem: { group: THREE.Group; tick(dt: number, timeSec: number): void };
  precipitation: { group: THREE.Group };
  selectionGroup: THREE.Group;
  previewGroup: THREE.Group;
  terrain: { mesh: THREE.Mesh };
  terrainHorizon?: { mesh: THREE.Mesh };
  grassField: {
    group: THREE.Group;
    getStreamTelemetry(target?: GrassStreamTelemetry): GrassStreamTelemetry;
  } | null;
  forestManager: {
    group: THREE.Group;
    getSeedThreeProfileBreakdown(): SeedThreeForestProfileBreakdown | null;
    setForestFloorDebugMode?(mode: ForestCanopyOcclusionDebugMode): void;
  } | null;
  getRendererAdapterEvidence(): RendererAdapterEvidence;
  setTerrainHorizonDebugMode?(mode: TerrainHorizonDebugMode): void;
  getTerrainHorizonDiagnostics?(): TerrainHorizonDiagnostics;
  getVisualGpuFrameTiming?(frameTimestampMs: number): VisualGpuFrameTiming;
  getVisualGpuTimingEvidence?(): VisualGpuTimingEvidence;
  getSlowFrameContext?(frameTimestampMs: number): VisualSlowFrameContext | null;
  getPerformanceStats(): {
    backend: string;
    frames: number;
    calls: number;
    renderPasses?: number;
    triangles: number;
    pixelRatio: number;
  };
};

type RuntimeApp = {
  sceneManager: RuntimeSceneManager | null;
  setVisualFrameProfiler?(profiler: RuntimeAppFrameProfiler | null): void;
};

type RuntimeAppFrameProfiler = {
  beginFrame(rafTimestampMs: number, callbackEntryTimestampMs: number): void;
  completeFrame(
    callbackCompletedAtMs: number,
    phase: VisualSlowFrameContext['phase'],
  ): void;
  dispose(): void;
};

export type VisualPerformanceInstallOptions = {
  /** Avoid report construction/serialization during the measured cohort. */
  deferPeriodicReportsUntilReady?: boolean;
};

export type VisualPerformanceMetrics = {
  medianFps: number;
  onePercentLowFps: number;
  meanFps: number;
  p99FrameMs: number;
  maxFrameMs: number;
  framesOver25Ms: number;
  framesOver50Ms: number;
};

export type VisualPerformanceAdapterEvidence = RendererAdapterEvidence;

export const VISUAL_FRAME_CPU_SPAN = Object.freeze({
  durationField: 'precedingFrameCpuDurationMs' as const,
  frameTimestampField: 'precedingFrameRafTimestampMs' as const,
  callbackEntryTimestampField:
    'precedingFrameCallbackEntryTimestampMs' as const,
  entryLatenessField: 'precedingFrameEntryLatenessMs' as const,
  intervalStartTimestampField: 'intervalStartRafTimestampMs' as const,
  intervalEndTimestampField: 'intervalEndRafTimestampMs' as const,
  alignment: 'preceding-frame-callback-at-interval-start' as const,
  start: 'animation-frame-callback-entry' as const,
  end: 'animation-frame-callback-completion' as const,
  callbackEntryTimestamp:
    'performance-now-sampled-at-animation-frame-callback-entry' as const,
  entryLateness:
    'callback-entry-performance-now-minus-animation-frame-callback-timestamp' as const,
  // Chromium reduces these two same-origin clocks to a 0.1 ms quantum, but
  // samples them independently. Allow one quantum plus 0.001 ms FP margin.
  entryLatenessNegativeToleranceMs: 0.101 as const,
});

export const VISUAL_FRAME_CPU_SUBSPANS = Object.freeze({
  alignment: 'same-preceding-frame-callback' as const,
  updatePreRenderDurationField:
    'precedingFrameUpdatePreRenderDurationMs' as const,
  renderSubmissionDurationField:
    'precedingFrameRenderSubmissionDurationMs' as const,
  postRenderDurationField: 'precedingFramePostRenderDurationMs' as const,
  updatePreRender:
    'animation-frame-callback-entry-to-immediately-before-render-call' as const,
  renderSubmission:
    'immediately-before-render-call-to-post-processor-render-return' as const,
  postRender:
    'post-processor-render-return-to-callback-completion-telemetry-evidence-dom' as const,
});

export const VISUAL_FRAME_GPU_SPAN = Object.freeze({
  durationField: 'precedingFrameGpuDurationMs' as const,
  statusField: 'precedingFrameGpuTimingStatus' as const,
  queryIdField: 'precedingFrameGpuQueryId' as const,
  frameTimestampField: 'precedingFrameGpuRafTimestampMs' as const,
  intervalStartTimestampField: 'intervalStartRafTimestampMs' as const,
  intervalEndTimestampField: 'intervalEndRafTimestampMs' as const,
  alignment:
    'preceding-frame-full-post-processing-render-at-interval-start' as const,
  source: 'webgpu-timestamp-query' as const,
  unit: 'milliseconds' as const,
  start:
    'gpu-queue-timestamp-after-profile-marker-submitted-immediately-before-post-processor-render' as const,
  end:
    'gpu-queue-timestamp-before-profile-marker-submitted-immediately-after-post-processor-render-return' as const,
});

export type VisualSlowFrameContext = {
  frameRafTimestampMs: number;
  frameCallbackEntryTimestampMs: number;
  frameCpuDurationMs: number;
  frameUpdatePreRenderDurationMs: number;
  frameRenderSubmissionDurationMs: number;
  framePostRenderDurationMs: number;
  frameGpuTiming: VisualGpuFrameTiming;
  routeElapsedMs: number;
  routeCycle: number;
  phase: 'strategic' | 'settlement' | 'road-eye';
  forest: {
    selectionChanged: boolean;
    selectorSkipped: boolean;
    workChunks: number;
    matrixWrites: number;
    bucketUploads: number;
    pendingBuckets: number;
  };
  groundcoverDelta: {
    generationSubsteps: number;
    clearWriteSubsteps: number;
    refreshes: number;
    gpuFlagUpdates: number;
    gpuUpdateRanges: number;
    bytesUploaded: number;
    wildflowerLodCompactions: number;
    wildflowerLodGpuFlagUpdates: number;
    wildflowerLodGpuUpdateRanges: number;
    wildflowerLodBytesUploaded: number;
    wildflowerLodReclassifications: number;
    completedSlots: number;
    cancelledSlots: number;
    pendingSlots: number;
  };
};

type RuntimeAppFrameAttribution = RuntimeAppFrameProfiler & {
  wrapPostRender(render: ScenePostProcessor['render']): ScenePostProcessor['render'];
  getSlowFrameContext(frameTimestampMs: number): VisualSlowFrameContext | null;
  getVisualGpuFrameTiming(frameTimestampMs: number): VisualGpuFrameTiming;
  getVisualGpuTimingEvidence(): VisualGpuTimingEvidence;
};

function createGrassStreamTelemetryScratch(): GrassStreamTelemetry {
  return {
    mode: 'active',
    maxUpdateDurationBudgetMs: 0,
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
}

function createVisualSlowFrameContextScratch(): VisualSlowFrameContext {
  return {
    frameRafTimestampMs: -1,
    frameCallbackEntryTimestampMs: -1,
    frameCpuDurationMs: 0,
    frameUpdatePreRenderDurationMs: 0,
    frameRenderSubmissionDurationMs: 0,
    framePostRenderDurationMs: 0,
    frameGpuTiming: {
      frameRafTimestampMs: -1,
      queryId: null,
      status: 'missing',
      durationMs: null,
      limitation: 'No application frame has completed yet.',
    },
    routeElapsedMs: 0,
    routeCycle: 0,
    phase: 'strategic',
    forest: {
      selectionChanged: false,
      selectorSkipped: true,
      workChunks: 0,
      matrixWrites: 0,
      bucketUploads: 0,
      pendingBuckets: 0,
    },
    groundcoverDelta: {
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
    },
  };
}

/**
 * Query-only attribution for the real App loop. Keeping this adapter in the
 * dynamically imported visual hook avoids shipping timestamp-query machinery
 * or per-frame telemetry work in an ordinary play session.
 */
export function createRuntimeAppFrameAttribution(
  manager: RuntimeSceneManager,
  submitTimestampMarkers: boolean,
): RuntimeAppFrameAttribution {
  const stats = manager.getPerformanceStats();
  const backend = {
    kind: stats.backend,
    renderer: manager.renderer,
    maxAnisotropy: 1,
    adapterEvidence: manager.getRendererAdapterEvidence(),
  } as RendererBackend;
  const gpuProfiler: VisualGpuTimestampProfiler =
    createVisualGpuTimestampProfiler(backend, { submitTimestampMarkers });
  const groundcoverStart = createGrassStreamTelemetryScratch();
  const groundcoverEnd = createGrassStreamTelemetryScratch();
  const emptyGroundcover = createGrassStreamTelemetryScratch();
  const contexts = [
    createVisualSlowFrameContextScratch(),
    createVisualSlowFrameContextScratch(),
  ];
  const frame = {
    rafTimestampMs: -1,
    callbackEntryTimestampMs: -1,
    renderStartedAtMs: -1,
    renderCompletedAtMs: -1,
  };
  let nextContextIndex = 0;
  let latestContext: VisualSlowFrameContext | null = null;

  const readGroundcover = (target: GrassStreamTelemetry): GrassStreamTelemetry => {
    if (manager.grassField) {
      return manager.grassField.getStreamTelemetry(target);
    }
    Object.assign(target, emptyGroundcover);
    return target;
  };
  const counterDelta = (current: number, previous: number): number =>
    Math.max(0, current - previous);

  return {
    beginFrame: (rafTimestampMs, callbackEntryTimestampMs) => {
      frame.rafTimestampMs = rafTimestampMs;
      frame.callbackEntryTimestampMs = callbackEntryTimestampMs;
      frame.renderStartedAtMs = callbackEntryTimestampMs;
      frame.renderCompletedAtMs = callbackEntryTimestampMs;
      readGroundcover(groundcoverStart);
    },
    completeFrame: (callbackCompletedAtMs, phase) => {
      const context = contexts[nextContextIndex]!;
      nextContextIndex = (nextContextIndex + 1) % contexts.length;
      readGroundcover(groundcoverEnd);
      context.frameRafTimestampMs = frame.rafTimestampMs;
      context.frameCallbackEntryTimestampMs = frame.callbackEntryTimestampMs;
      context.frameCpuDurationMs = Math.max(
        0,
        callbackCompletedAtMs - frame.callbackEntryTimestampMs,
      );
      context.frameUpdatePreRenderDurationMs = Math.max(
        0,
        frame.renderStartedAtMs - frame.callbackEntryTimestampMs,
      );
      context.frameRenderSubmissionDurationMs = Math.max(
        0,
        frame.renderCompletedAtMs - frame.renderStartedAtMs,
      );
      context.framePostRenderDurationMs = Math.max(
        0,
        callbackCompletedAtMs - frame.renderCompletedAtMs,
      );
      if (submitTimestampMarkers) {
        context.frameGpuTiming = gpuProfiler.getFrameTiming(frame.rafTimestampMs);
      } else {
        const timing = context.frameGpuTiming;
        timing.frameRafTimestampMs = frame.rafTimestampMs;
        timing.queryId = null;
        timing.status = 'unavailable';
        timing.durationMs = null;
        timing.limitation = VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION;
      }
      context.phase = phase;
      context.routeElapsedMs = 0;
      context.routeCycle = 0;
      const delta = context.groundcoverDelta;
      delta.generationSubsteps = counterDelta(
        groundcoverEnd.generationSubsteps,
        groundcoverStart.generationSubsteps,
      );
      delta.clearWriteSubsteps = counterDelta(
        groundcoverEnd.clearWriteSubsteps,
        groundcoverStart.clearWriteSubsteps,
      );
      delta.refreshes = counterDelta(
        groundcoverEnd.refreshCount,
        groundcoverStart.refreshCount,
      );
      delta.gpuFlagUpdates = counterDelta(
        groundcoverEnd.gpuFlagUpdates,
        groundcoverStart.gpuFlagUpdates,
      );
      delta.gpuUpdateRanges = counterDelta(
        groundcoverEnd.gpuUpdateRanges,
        groundcoverStart.gpuUpdateRanges,
      );
      delta.bytesUploaded = counterDelta(
        groundcoverEnd.bytesUploaded,
        groundcoverStart.bytesUploaded,
      );
      delta.wildflowerLodCompactions = counterDelta(
        groundcoverEnd.wildflowerLodCompactions ?? 0,
        groundcoverStart.wildflowerLodCompactions ?? 0,
      );
      delta.wildflowerLodGpuFlagUpdates = counterDelta(
        groundcoverEnd.wildflowerLodGpuFlagUpdates ?? 0,
        groundcoverStart.wildflowerLodGpuFlagUpdates ?? 0,
      );
      delta.wildflowerLodGpuUpdateRanges = counterDelta(
        groundcoverEnd.wildflowerLodGpuUpdateRanges ?? 0,
        groundcoverStart.wildflowerLodGpuUpdateRanges ?? 0,
      );
      delta.wildflowerLodBytesUploaded = counterDelta(
        groundcoverEnd.wildflowerLodCompactionBytesUploaded ?? 0,
        groundcoverStart.wildflowerLodCompactionBytesUploaded ?? 0,
      );
      delta.wildflowerLodReclassifications = counterDelta(
        groundcoverEnd.wildflowerLodReclassifications ?? 0,
        groundcoverStart.wildflowerLodReclassifications ?? 0,
      );
      delta.completedSlots = counterDelta(
        groundcoverEnd.completedSlots,
        groundcoverStart.completedSlots,
      );
      delta.cancelledSlots = counterDelta(
        groundcoverEnd.cancelledSlots,
        groundcoverStart.cancelledSlots,
      );
      delta.pendingSlots = groundcoverEnd.pendingSlots;
      latestContext = context;
    },
    dispose: () => gpuProfiler.dispose(),
    wrapPostRender: (render) => (dt) => {
      frame.renderStartedAtMs = performance.now();
      if (!submitTimestampMarkers) {
        try {
          render.call(manager.postProcessor, dt);
        } finally {
          frame.renderCompletedAtMs = performance.now();
        }
        return;
      }
      const gpuFrameHandle: VisualGpuTimestampFrameHandle =
        gpuProfiler.beginFrame(frame.rafTimestampMs);
      try {
        render.call(manager.postProcessor, dt);
      } finally {
        frame.renderCompletedAtMs = performance.now();
        gpuProfiler.endFrame(gpuFrameHandle);
      }
    },
    getSlowFrameContext: (frameTimestampMs) =>
      latestContext?.frameRafTimestampMs === frameTimestampMs
        ? latestContext
        : null,
    getVisualGpuFrameTiming: (frameTimestampMs) =>
      gpuProfiler.getFrameTiming(frameTimestampMs),
    getVisualGpuTimingEvidence: () => gpuProfiler.getEvidence(),
  };
}

export type VisualSlowFrameRecord = Omit<
  VisualSlowFrameContext,
  | 'frameRafTimestampMs'
  | 'frameCallbackEntryTimestampMs'
  | 'frameCpuDurationMs'
  | 'frameUpdatePreRenderDurationMs'
  | 'frameRenderSubmissionDurationMs'
  | 'framePostRenderDurationMs'
  | 'frameGpuTiming'
> & {
  dtMs: number;
  traceMs: number;
  intervalStartRafTimestampMs: number;
  intervalEndRafTimestampMs: number;
  precedingFrameRafTimestampMs: number;
  precedingFrameCallbackEntryTimestampMs: number;
  precedingFrameEntryLatenessMs: number;
  precedingFrameCpuDurationMs: number;
  precedingFrameUpdatePreRenderDurationMs: number;
  precedingFrameRenderSubmissionDurationMs: number;
  precedingFramePostRenderDurationMs: number;
  precedingFrameGpuRafTimestampMs: number;
  precedingFrameGpuQueryId: number | null;
  precedingFrameGpuDurationMs: number | null;
  precedingFrameGpuTimingStatus: VisualGpuFrameTimingStatus;
  precedingFrameGpuTimingLimitation: string | null;
  renderer: {
    drawCalls: number;
    frameCalls: number;
    triangles: number;
  };
};

export type VisualPerformanceReport = {
  schemaVersion: 5;
  status: 'collecting' | 'ready';
  windowSeconds: 30;
  elapsedSeconds: number;
  sampleCount: number;
  metrics: VisualPerformanceMetrics;
  renderer: {
    medianDrawCalls: number;
    medianFrameCalls: number;
    medianTriangles: number;
  };
  frameCpuSpan: typeof VISUAL_FRAME_CPU_SPAN;
  frameCpuSubspans: typeof VISUAL_FRAME_CPU_SUBSPANS;
  frameGpuSpan: typeof VISUAL_FRAME_GPU_SPAN;
  slowFrames: VisualSlowFrameRecord[];
  context: {
    backend: string;
    viewport: {
      width: number;
      height: number;
    };
    devicePixelRatio: number;
    rendererPixelRatio: number;
    visibility: DocumentVisibilityState;
    adapter: VisualPerformanceAdapterEvidence;
    gpuTiming: VisualGpuTimingEvidence;
    subsystems: Record<ProfileSubsystem, boolean>;
  };
};

export type VisualPerformanceHooks = {
  readonly subsystems: readonly ProfileSubsystem[];
  armTraceAfterCurrentFrame(): void;
  deferDomPublicationUntilReady(): void;
  getDomPublicationEvidence(): VisualPerformanceDomPublicationEvidence;
  getReport(): VisualPerformanceReport | null;
  getState(): Record<ProfileSubsystem, boolean>;
  getRendererStats(): ReturnType<RuntimeSceneManager['getPerformanceStats']>;
  restartTrace(): void;
  stopFrameCollection(): void;
  reset(): void;
  setEnabled(subsystem: ProfileSubsystem, enabled: boolean): void;
  setForestFloorDebugMode(mode: ForestCanopyOcclusionDebugMode): void;
  setTerrainHorizonDebugMode(mode: TerrainHorizonDebugMode): void;
  getTerrainHorizonDiagnostics(): TerrainHorizonDiagnostics | null;
};

export type VisualPerformanceDomPublicationEvidence = {
  mode: 'periodic' | 'terminal-only-after-freeze';
  inMemoryReportConstructions: number;
  jsonSerializations: number;
  cohortDomPublications: number;
  terminalDomPublications: number;
};

export function createVisualPerformanceDomPublicationGate(): {
  deferUntilReady(): void;
  accept(report: VisualPerformanceReport): {
    serializedReport: string;
    publishToDom: boolean;
  };
  getEvidence(): VisualPerformanceDomPublicationEvidence;
  reset(): void;
} {
  let mode: VisualPerformanceDomPublicationEvidence['mode'] = 'periodic';
  let inMemoryReportConstructions = 0;
  let jsonSerializations = 0;
  let cohortDomPublications = 0;
  let terminalDomPublications = 0;
  return {
    deferUntilReady: () => {
      mode = 'terminal-only-after-freeze';
      inMemoryReportConstructions = 0;
      jsonSerializations = 0;
      cohortDomPublications = 0;
      terminalDomPublications = 0;
    },
    accept: (report) => {
      inMemoryReportConstructions += 1;
      const serializedReport = JSON.stringify(report);
      jsonSerializations += 1;
      if (mode === 'periodic') {
        if (report.status === 'ready') terminalDomPublications += 1;
        else cohortDomPublications += 1;
        return { serializedReport, publishToDom: true };
      }
      if (report.status === 'ready' && terminalDomPublications === 0) {
        terminalDomPublications = 1;
        return { serializedReport, publishToDom: true };
      }
      return { serializedReport, publishToDom: false };
    },
    getEvidence: () => ({
      mode,
      inMemoryReportConstructions,
      jsonSerializations,
      cohortDomPublications,
      terminalDomPublications,
    }),
    reset: () => {
      inMemoryReportConstructions = 0;
      jsonSerializations = 0;
      cohortDomPublications = 0;
      terminalDomPublications = 0;
    },
  };
}

export type VisualProfileRenderPathResult = {
  postProcessorRendered: boolean;
  renderPathCompletedAtMs: number;
};

export function executeVisualProfileRenderPath(input: {
  dt: number;
  frameRafTimestampMs: number | null;
  skipPostProcessorRender: boolean;
  postProcessorRender(dt: number): void;
  gpuTimestampProfiler: Pick<
    VisualGpuTimestampProfiler,
    'beginFrame' | 'endFrame'
  > | null;
  now(): number;
}): VisualProfileRenderPathResult {
  const {
    dt,
    frameRafTimestampMs,
    skipPostProcessorRender,
    postProcessorRender,
    gpuTimestampProfiler,
    now,
  } = input;
  const gpuTimestampHandle =
    !skipPostProcessorRender && frameRafTimestampMs !== null
      ? gpuTimestampProfiler?.beginFrame(frameRafTimestampMs) ?? null
      : null;
  try {
    if (!skipPostProcessorRender) postProcessorRender(dt);
    return {
      postProcessorRendered: !skipPostProcessorRender,
      renderPathCompletedAtMs: now(),
    };
  } finally {
    if (gpuTimestampHandle) {
      gpuTimestampProfiler?.endFrame(gpuTimestampHandle);
    }
  }
}

const SUBSYSTEMS = [
  'post',
  'sky',
  'shadows',
  'river',
  'riverSimulation',
  'riverRender',
  'precipitation',
  'selection',
  'preview',
  'terrain',
  'groundcover',
  'forest',
  'ui',
] as const satisfies readonly ProfileSubsystem[];

const VISUAL_PERFORMANCE_WINDOW_MS = 30_000;
const MAX_SLOW_FRAME_RECORDS = 64;
const WORST_FRAME_FRACTION = 0.01;

export function createVisualPerformanceTraceArmingBoundary(): {
  armAfterCurrentFrame(): void;
  consumeCompletedFrame(): boolean;
  reset(): void;
} {
  let excludeCompletedFrame = false;
  return {
    armAfterCurrentFrame: () => {
      excludeCompletedFrame = true;
    },
    consumeCompletedFrame: () => {
      if (!excludeCompletedFrame) return false;
      excludeCompletedFrame = false;
      return true;
    },
    reset: () => {
      excludeCompletedFrame = false;
    },
  };
}

export type VisualPerformanceTraceSample = {
  at: number;
  dt: number;
  drawCalls: number;
  frameCalls: number;
  triangles: number;
};

export function createVisualPerformanceTraceCapture(
  windowMs = VISUAL_PERFORMANCE_WINDOW_MS,
): {
  appendInterval(
    sample: VisualPerformanceTraceSample,
    slowFrame: VisualSlowFrameRecord | null,
  ): boolean;
  freezeIfComplete(
    traceStartRafTimestampMs: number,
    intervalEndRafTimestampMs: number,
  ): boolean;
  getSamples(): readonly VisualPerformanceTraceSample[];
  getSlowFrames(): readonly VisualSlowFrameRecord[];
  isFrozen(): boolean;
  reset(): void;
} {
  const boundedWindowMs = Math.max(0, windowMs);
  const samples: VisualPerformanceTraceSample[] = [];
  const slowFrames: VisualSlowFrameRecord[] = [];
  let frozen = false;
  return {
    appendInterval: (sample, slowFrame) => {
      if (frozen) return false;
      samples.push({ ...sample });
      if (slowFrame) appendVisualSlowFrameRecord(slowFrames, slowFrame);
      return true;
    },
    freezeIfComplete: (
      traceStartRafTimestampMs,
      intervalEndRafTimestampMs,
    ) => {
      if (
        !frozen
        && intervalEndRafTimestampMs - traceStartRafTimestampMs
          >= boundedWindowMs
      ) {
        frozen = true;
      }
      return frozen;
    },
    getSamples: () => samples,
    getSlowFrames: () => slowFrames,
    isFrozen: () => frozen,
    reset: () => {
      samples.length = 0;
      slowFrames.length = 0;
      frozen = false;
    },
  };
}

export function createVisualPerformanceReadyReportLatch(): {
  accept(report: VisualPerformanceReport): VisualPerformanceReport;
  hasReadyReport(): boolean;
  reset(): void;
} {
  let readyReport: VisualPerformanceReport | null = null;
  return {
    accept: (report) => {
      if (readyReport) return readyReport;
      if (report.status === 'ready') readyReport = report;
      return report;
    },
    hasReadyReport: () => readyReport !== null,
    reset: () => {
      readyReport = null;
    },
  };
}

export function calculateVisualPerformanceMetrics(
  frameTimes: readonly number[],
): VisualPerformanceMetrics | null {
  const validFrameTimes = frameTimes.filter(
    (frameTime) => Number.isFinite(frameTime) && frameTime > 0,
  );
  if (validFrameTimes.length === 0) return null;

  const sortedAscending = [...validFrameTimes].sort((a, b) => a - b);
  const middle = Math.floor(sortedAscending.length / 2);
  const medianFrameMs = sortedAscending.length % 2 === 0
    ? (sortedAscending[middle - 1]! + sortedAscending[middle]!) * 0.5
    : sortedAscending[middle]!;
  const slowFrameCount = Math.max(
    1,
    Math.ceil(validFrameTimes.length * WORST_FRAME_FRACTION),
  );
  const slowestFrameTimes = sortedAscending.slice(-slowFrameCount).reverse();
  const slowestMeanFrameMs =
    slowestFrameTimes.reduce((sum, frameTime) => sum + frameTime, 0)
    / slowestFrameTimes.length;
  const totalFrameMs = validFrameTimes.reduce((sum, frameTime) => sum + frameTime, 0);

  return {
    medianFps: 1000 / medianFrameMs,
    onePercentLowFps: 1000 / slowestMeanFrameMs,
    meanFps: (validFrameTimes.length * 1000) / totalFrameMs,
    // Preserve the collector's standard, uncapped worst-one-percent definition.
    p99FrameMs: slowestMeanFrameMs,
    maxFrameMs: sortedAscending[sortedAscending.length - 1]!,
    framesOver25Ms: validFrameTimes.filter((frameTime) => frameTime > 25).length,
    framesOver50Ms: validFrameTimes.filter((frameTime) => frameTime > 50).length,
  };
}

export function createVisualPerformanceReport(
  report: Omit<
    VisualPerformanceReport,
    | 'schemaVersion'
    | 'windowSeconds'
    | 'frameCpuSpan'
    | 'frameCpuSubspans'
    | 'frameGpuSpan'
  >,
): VisualPerformanceReport {
  return {
    ...report,
    schemaVersion: 5,
    windowSeconds: 30,
    metrics: { ...report.metrics },
    renderer: { ...report.renderer },
    frameCpuSpan: { ...VISUAL_FRAME_CPU_SPAN },
    frameCpuSubspans: { ...VISUAL_FRAME_CPU_SUBSPANS },
    frameGpuSpan: { ...VISUAL_FRAME_GPU_SPAN },
    slowFrames: report.slowFrames.map(cloneSlowFrameRecord),
    context: {
      ...report.context,
      viewport: { ...report.context.viewport },
      adapter: {
        ...report.context.adapter,
        limitations: [...report.context.adapter.limitations],
      },
      gpuTiming: {
        ...report.context.gpuTiming,
        limitations: [...report.context.gpuTiming.limitations],
      },
      subsystems: { ...report.context.subsystems },
    },
  };
}

export function createVisualSlowFrameRecordForInterval(input: {
  intervalStartRafTimestampMs: number;
  intervalEndRafTimestampMs: number;
  traceStartRafTimestampMs: number;
  precedingFrame: (VisualSlowFrameContext & {
    renderer: VisualSlowFrameRecord['renderer'];
  }) | null;
}): VisualSlowFrameRecord | null {
  const {
    intervalStartRafTimestampMs,
    intervalEndRafTimestampMs,
    traceStartRafTimestampMs,
    precedingFrame,
  } = input;
  const dtMs = intervalEndRafTimestampMs - intervalStartRafTimestampMs;
  const entryLatenessMs = precedingFrame === null
    ? null
    : calculateVisualFrameEntryLatenessMs(
        precedingFrame.frameRafTimestampMs,
        precedingFrame.frameCallbackEntryTimestampMs,
      );
  if (
    precedingFrame === null
    || precedingFrame.frameRafTimestampMs !== intervalStartRafTimestampMs
    || entryLatenessMs === null
    || !Number.isFinite(dtMs)
    || dtMs <= 0
  ) {
    return null;
  }
  const {
    frameRafTimestampMs,
    frameCallbackEntryTimestampMs,
    frameCpuDurationMs,
    frameUpdatePreRenderDurationMs,
    frameRenderSubmissionDurationMs,
    framePostRenderDurationMs,
    frameGpuTiming,
    renderer,
    ...context
  } = precedingFrame;
  const gpuTiming = normalizeVisualGpuFrameTiming(
    frameRafTimestampMs,
    frameGpuTiming,
  );
  return {
    ...context,
    dtMs,
    traceMs: intervalEndRafTimestampMs - traceStartRafTimestampMs,
    intervalStartRafTimestampMs,
    intervalEndRafTimestampMs,
    precedingFrameRafTimestampMs: frameRafTimestampMs,
    precedingFrameCallbackEntryTimestampMs: frameCallbackEntryTimestampMs,
    precedingFrameEntryLatenessMs: entryLatenessMs,
    precedingFrameCpuDurationMs: frameCpuDurationMs,
    precedingFrameUpdatePreRenderDurationMs:
      frameUpdatePreRenderDurationMs,
    precedingFrameRenderSubmissionDurationMs:
      frameRenderSubmissionDurationMs,
    precedingFramePostRenderDurationMs: framePostRenderDurationMs,
    precedingFrameGpuRafTimestampMs: gpuTiming.frameRafTimestampMs,
    precedingFrameGpuQueryId: gpuTiming.queryId,
    precedingFrameGpuDurationMs: gpuTiming.durationMs,
    precedingFrameGpuTimingStatus: gpuTiming.status,
    precedingFrameGpuTimingLimitation: gpuTiming.limitation,
    renderer: { ...renderer },
  };
}

function calculateVisualFrameEntryLatenessMs(
  frameRafTimestampMs: number,
  frameCallbackEntryTimestampMs: number,
): number | null {
  if (
    !Number.isFinite(frameRafTimestampMs)
    || frameRafTimestampMs < 0
    || !Number.isFinite(frameCallbackEntryTimestampMs)
    || frameCallbackEntryTimestampMs < 0
  ) {
    return null;
  }
  const entryLatenessMs =
    frameCallbackEntryTimestampMs - frameRafTimestampMs;
  if (
    entryLatenessMs
      < -VISUAL_FRAME_CPU_SPAN.entryLatenessNegativeToleranceMs
  ) {
    return null;
  }
  return Math.max(0, entryLatenessMs);
}

export function hydrateVisualSlowFrameGpuTiming(
  record: VisualSlowFrameRecord,
  timing: VisualGpuFrameTiming,
): VisualSlowFrameRecord {
  const clone = cloneSlowFrameRecord(record);
  if (
    timing.frameRafTimestampMs !== record.precedingFrameRafTimestampMs
    || timing.queryId !== record.precedingFrameGpuQueryId
  ) {
    return clone;
  }
  const normalized = normalizeVisualGpuFrameTiming(
    record.precedingFrameRafTimestampMs,
    timing,
  );
  clone.precedingFrameGpuRafTimestampMs = normalized.frameRafTimestampMs;
  clone.precedingFrameGpuQueryId = normalized.queryId;
  clone.precedingFrameGpuDurationMs = normalized.durationMs;
  clone.precedingFrameGpuTimingStatus = normalized.status;
  clone.precedingFrameGpuTimingLimitation = normalized.limitation;
  return clone;
}

export function areVisualSlowFrameGpuTimingsTerminal(
  records: readonly VisualSlowFrameRecord[],
): boolean {
  return records.every(
    (record) => record.precedingFrameGpuTimingStatus !== 'pending',
  );
}

export function createUnavailableVisualGpuTimingEvidence(
  reason: string,
): VisualGpuTimingEvidence {
  return {
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
    limitations: [reason],
  };
}

function normalizeVisualGpuFrameTiming(
  expectedFrameRafTimestampMs: number,
  timing: VisualGpuFrameTiming | undefined,
): VisualGpuFrameTiming {
  if (!timing) {
    return {
      frameRafTimestampMs: expectedFrameRafTimestampMs,
      queryId: null,
      status: 'unavailable',
      durationMs: null,
      limitation:
        'The preceding frame context did not expose GPU timestamp instrumentation.',
    };
  }
  if (timing.frameRafTimestampMs !== expectedFrameRafTimestampMs) {
    return {
      frameRafTimestampMs: expectedFrameRafTimestampMs,
      queryId: timing.queryId,
      status: 'missing',
      durationMs: null,
      limitation:
        'GPU timing frame identity did not match the causally preceding animation frame.',
    };
  }
  if (
    timing.status === 'available'
    && (
      timing.durationMs === null
      || !Number.isFinite(timing.durationMs)
      || timing.durationMs < 0
    )
  ) {
    return {
      ...timing,
      status: 'failed',
      durationMs: null,
      limitation:
        'The timestamp query resolved without a finite non-negative GPU duration.',
    };
  }
  return {
    ...timing,
    durationMs: timing.status === 'available' ? timing.durationMs : null,
  };
}

function cloneSlowFrameRecord(record: VisualSlowFrameRecord): VisualSlowFrameRecord {
  return {
    ...record,
    renderer: { ...record.renderer },
    forest: { ...record.forest },
    groundcoverDelta: { ...record.groundcoverDelta },
  };
}

export function appendVisualSlowFrameRecord(
  records: VisualSlowFrameRecord[],
  record: VisualSlowFrameRecord,
  maxRecords = MAX_SLOW_FRAME_RECORDS,
): void {
  const limit = Math.max(0, Math.floor(maxRecords));
  if (limit === 0) return;
  const clone = cloneSlowFrameRecord(record);
  const insertionIndex = records.findIndex(
    (retained) => clone.dtMs > retained.dtMs,
  );
  if (insertionIndex === -1) records.push(clone);
  else records.splice(insertionIndex, 0, clone);
  if (records.length > limit) records.length = limit;
}

export function shouldCaptureVisualSlowFrame(
  records: readonly VisualSlowFrameRecord[],
  dtMs: number,
  maxRecords = MAX_SLOW_FRAME_RECORDS,
): boolean {
  const limit = Math.max(0, Math.floor(maxRecords));
  if (limit === 0 || !Number.isFinite(dtMs) || dtMs <= 0) return false;
  return records.length < limit
    || dtMs > records[Math.min(records.length, limit) - 1]!.dtMs;
}

export function selectVisualWorstFrameRecords(
  records: readonly VisualSlowFrameRecord[],
  sampleCount: number,
  maxRecords = MAX_SLOW_FRAME_RECORDS,
): VisualSlowFrameRecord[] {
  const boundedSampleCount = Math.max(0, Math.floor(sampleCount));
  const limit = Math.max(0, Math.floor(maxRecords));
  if (boundedSampleCount === 0 || limit === 0) return [];
  const selectedCount = Math.min(
    limit,
    Math.max(1, Math.ceil(boundedSampleCount * WORST_FRAME_FRACTION)),
  );
  return records.slice(0, selectedCount).map(cloneSlowFrameRecord);
}

export function doVisualSlowFrameRecordsReproduceMetrics(
  records: readonly VisualSlowFrameRecord[],
  frameTimes: readonly number[],
  metrics: VisualPerformanceMetrics,
): boolean {
  const validFrameTimes = frameTimes.filter(
    (frameTime) => Number.isFinite(frameTime) && frameTime > 0,
  );
  if (validFrameTimes.length === 0) return records.length === 0;
  const fullWorstFrameCount = Math.max(
    1,
    Math.ceil(validFrameTimes.length * WORST_FRAME_FRACTION),
  );
  const expectedCount = Math.min(MAX_SLOW_FRAME_RECORDS, fullWorstFrameCount);
  const expectedFrameTimes = [...validFrameTimes]
    .sort((a, b) => b - a)
    .slice(0, expectedCount);
  if (
    records.length !== expectedCount
    || records.length > MAX_SLOW_FRAME_RECORDS
    || records.some(
      (record, index) =>
        !Number.isFinite(record.dtMs)
        || record.dtMs <= 0
        || record.dtMs !== expectedFrameTimes[index],
    )
  ) {
    return false;
  }
  const recordMeanFrameMs =
    records.reduce((sum, record) => sum + record.dtMs, 0)
    / records.length;
  // A trace above 6,400 samples retains the exact leading 64 records while
  // leaving the standard worst-one-percent metric cohort uncapped.
  return fullWorstFrameCount > MAX_SLOW_FRAME_RECORDS
    || (
      recordMeanFrameMs === metrics.p99FrameMs
      && 1000 / recordMeanFrameMs === metrics.onePercentLowFps
    );
}

export function resetVisualPerformanceSubsystems(
  applyEnabled: (subsystem: ProfileSubsystem, enabled: boolean) => void,
  invalidateTrace: () => void,
): void {
  for (const subsystem of SUBSYSTEMS) applyEnabled(subsystem, true);
  invalidateTrace();
}

export function createVisualPerformanceResettleGate(
  now: () => number,
  resetTrace: (status: 'settling' | 'collecting') => void,
): {
  allowFrame(frameNow: number): boolean;
  invalidate(): void;
  settleThrough(deadline: number): void;
} {
  let settleUntil: number | null = null;
  const settleThrough = (deadline: number): void => {
    settleUntil = Math.max(settleUntil ?? Number.NEGATIVE_INFINITY, deadline);
    resetTrace('settling');
  };
  return {
    allowFrame: (frameNow) => {
      if (settleUntil === null) return true;
      if (frameNow < settleUntil) return false;
      settleUntil = null;
      resetTrace('collecting');
      return true;
    },
    invalidate: () => {
      settleThrough(now() + 5_000);
    },
    settleThrough,
  };
}

export function createVisualPerformanceResetCoordinator(
  now: () => number,
  markPendingReset: () => void,
): {
  attach(invalidateTrace: (settleUntil: number) => void): void;
  requestReset(): void;
} {
  let invalidateTrace: ((settleUntil: number) => void) | null = null;
  let pendingSettleUntil: number | null = null;
  return {
    attach: (invalidate) => {
      invalidateTrace = invalidate;
      if (pendingSettleUntil !== null && pendingSettleUntil > now()) {
        invalidate(pendingSettleUntil);
      }
      pendingSettleUntil = null;
    },
    requestReset: () => {
      const settleUntil = now() + 5_000;
      if (invalidateTrace) {
        invalidateTrace(settleUntil);
        return;
      }
      pendingSettleUntil = settleUntil;
      markPendingReset();
    },
  };
}

export function installVisualPerformanceHooksIfRequested(
  app: object,
  options: VisualPerformanceInstallOptions = {},
): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('visualProfile') !== '1') return;

  const runtimeApp = app as RuntimeApp;
  const manager = runtimeApp.sceneManager;
  if (!manager) {
    throw new Error('Visual profiling requested before SceneManager initialization.');
  }

  const initial = {
    postRender: manager.postProcessor.render,
    skyVisible: manager.sky.visible,
    shadowsEnabled: manager.renderer.shadowMap.enabled,
    sunCastShadow: manager.sunLight.castShadow,
    riverVisible: manager.riverSystem.group.visible,
    riverTick: manager.riverSystem.tick,
    precipitationVisible: manager.precipitation.group.visible,
    selectionVisible: manager.selectionGroup.visible,
    previewVisible: manager.previewGroup.visible,
    terrainVisible: manager.terrain.mesh.visible,
    terrainHorizonVisible: manager.terrainHorizon?.mesh.visible ?? true,
    // Vegetation is intentionally constructed after App.start resolves.
    // Both groups default visible when they appear, so the profiling baseline
    // must not capture their temporary pre-build absence as "disabled".
    groundcoverVisible: manager.grassField?.group.visible ?? true,
    forestVisible: manager.forestManager?.group.visible ?? true,
    ownsSlowFrameContext: Object.hasOwn(manager, 'getSlowFrameContext'),
    getSlowFrameContext: manager.getSlowFrameContext,
    ownsVisualGpuFrameTiming: Object.hasOwn(manager, 'getVisualGpuFrameTiming'),
    getVisualGpuFrameTiming: manager.getVisualGpuFrameTiming,
    ownsVisualGpuTimingEvidence: Object.hasOwn(
      manager,
      'getVisualGpuTimingEvidence',
    ),
    getVisualGpuTimingEvidence: manager.getVisualGpuTimingEvidence,
  };
  const appFrameAttribution = runtimeApp.setVisualFrameProfiler
    ? createRuntimeAppFrameAttribution(
        manager,
        params.get('visualGpuTimestampMarkers') !== '0',
      )
    : null;
  let disposeRealAppProfile = (): void => {
    appFrameAttribution?.dispose();
  };
  if (appFrameAttribution) {
    runtimeApp.setVisualFrameProfiler!({
      beginFrame: appFrameAttribution.beginFrame,
      completeFrame: appFrameAttribution.completeFrame,
      dispose: () => disposeRealAppProfile(),
    });
    manager.getSlowFrameContext =
      appFrameAttribution.getSlowFrameContext;
    manager.getVisualGpuFrameTiming =
      appFrameAttribution.getVisualGpuFrameTiming;
    manager.getVisualGpuTimingEvidence =
      appFrameAttribution.getVisualGpuTimingEvidence;
  }
  const wrapPostRender = (
    render: ScenePostProcessor['render'],
  ): ScenePostProcessor['render'] =>
    appFrameAttribution?.wrapPostRender(render) ?? render;
  manager.postProcessor.render = wrapPostRender(initial.postRender);
  const state = Object.fromEntries(SUBSYSTEMS.map((name) => [name, true])) as Record<
    ProfileSubsystem,
    boolean
  >;
  const profileDataset = document.documentElement.dataset;
  const hiddenUi = new Map<HTMLElement, { visibility: string; pointerEvents: string }>();
  let latestReport: VisualPerformanceReport | null = null;
  let armTraceAfterCurrentFrame = (): void => {};
  let deferDomPublicationUntilReady = (): void => {};
  let getDomPublicationEvidence = (): VisualPerformanceDomPublicationEvidence => ({
    mode: 'periodic',
    inMemoryReportConstructions: 0,
    jsonSerializations: 0,
    cohortDomPublications: 0,
    terminalDomPublications: 0,
  });
  let stopCollector = (): void => {};
  let stopFrameCollection = (): void => stopCollector();
  let deferredScenePollTimeout: number | null = null;
  let collectorSettleTimeout: number | null = null;
  let realAppProfileDisposed = false;
  let installedHooks: VisualPerformanceHooks | null = null;
  const resetCoordinator = createVisualPerformanceResetCoordinator(
    () => performance.now(),
    () => {
      latestReport = null;
      delete profileDataset.visualProfileReport;
      profileDataset.visualProfileStatus = 'settling';
    },
  );

  const setUiVisible = (visible: boolean): void => {
    if (visible) {
      for (const [element, previous] of hiddenUi) {
        element.style.visibility = previous.visibility;
        element.style.pointerEvents = previous.pointerEvents;
      }
      hiddenUi.clear();
      return;
    }

    const canvas = manager.renderer.domElement;
    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      if (element === canvas || element.contains(canvas) || canvas.contains(element)) continue;
      hiddenUi.set(element, {
        visibility: element.style.visibility,
        pointerEvents: element.style.pointerEvents,
      });
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
    }
  };

  const applyEnabled = (
    subsystem: ProfileSubsystem,
    enabled: boolean,
    invalidateChangedTrace: boolean,
  ): void => {
    const changed = state[subsystem] !== enabled;
    state[subsystem] = enabled;
    switch (subsystem) {
      case 'post':
        manager.postProcessor.render = wrapPostRender(enabled
          ? initial.postRender
          : () => manager.renderer.render(manager.scene, manager.camera));
        break;
      case 'sky':
        manager.sky.visible = enabled && initial.skyVisible;
        break;
      case 'shadows':
        manager.renderer.shadowMap.enabled = enabled && initial.shadowsEnabled;
        manager.sunLight.castShadow = enabled && initial.sunCastShadow;
        if (enabled) {
          const shadowMap = manager.renderer.shadowMap as { needsUpdate?: boolean };
          shadowMap.needsUpdate = true;
        }
        break;
      case 'river':
        manager.riverSystem.group.visible = enabled && initial.riverVisible;
        manager.riverSystem.tick = enabled ? initial.riverTick : () => {};
        break;
      case 'riverSimulation':
        manager.riverSystem.tick = enabled ? initial.riverTick : () => {};
        break;
      case 'riverRender':
        manager.riverSystem.group.visible = enabled && initial.riverVisible;
        break;
      case 'precipitation':
        manager.precipitation.group.visible = enabled && initial.precipitationVisible;
        break;
      case 'selection':
        manager.selectionGroup.visible = enabled && initial.selectionVisible;
        break;
      case 'preview':
        manager.previewGroup.visible = enabled && initial.previewVisible;
        break;
      case 'terrain':
        manager.terrain.mesh.visible = enabled && initial.terrainVisible;
        if (manager.terrainHorizon) {
          manager.terrainHorizon.mesh.visible = enabled && initial.terrainHorizonVisible;
        }
        break;
      case 'groundcover':
        if (manager.grassField) {
          manager.grassField.group.visible = enabled && initial.groundcoverVisible;
        }
        break;
      case 'forest':
        if (manager.forestManager) {
          manager.forestManager.group.visible = enabled && initial.forestVisible;
        }
        break;
      case 'ui':
        setUiVisible(enabled);
        break;
    }
    if (changed && invalidateChangedTrace) resetCoordinator.requestReset();
  };

  const setEnabled = (subsystem: ProfileSubsystem, enabled: boolean): void => {
    applyEnabled(subsystem, enabled, true);
  };

  const reset = (): void => {
    resetVisualPerformanceSubsystems(
      (subsystem, enabled) => applyEnabled(subsystem, enabled, false),
      resetCoordinator.requestReset,
    );
  };

  const requestedDisabled = new Set(
    (params.get('visualDisable') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name): name is ProfileSubsystem =>
        (SUBSYSTEMS as readonly string[]).includes(name),
      ),
  );
  const disabledLabel = SUBSYSTEMS.filter((name) => requestedDisabled.has(name)).join(',');
  profileDataset.visualProfileDisabled = disabledLabel || 'none';
  profileDataset.visualProfileStatus = 'waiting-vegetation';
  for (const subsystem of requestedDisabled) applyEnabled(subsystem, false, false);

  const disposeProfile = (): void => {
    if (realAppProfileDisposed || appFrameAttribution === null) return;
    realAppProfileDisposed = true;
    if (deferredScenePollTimeout !== null) {
      window.clearTimeout(deferredScenePollTimeout);
      deferredScenePollTimeout = null;
    }
    if (collectorSettleTimeout !== null) {
      window.clearTimeout(collectorSettleTimeout);
      collectorSettleTimeout = null;
    }
    stopCollector();
    for (const subsystem of SUBSYSTEMS) {
      applyEnabled(subsystem, true, false);
    }
    manager.postProcessor.render = initial.postRender;
    if (initial.ownsSlowFrameContext) {
      manager.getSlowFrameContext = initial.getSlowFrameContext;
    } else {
      delete manager.getSlowFrameContext;
    }
    if (initial.ownsVisualGpuFrameTiming) {
      manager.getVisualGpuFrameTiming = initial.getVisualGpuFrameTiming;
    } else {
      delete manager.getVisualGpuFrameTiming;
    }
    if (initial.ownsVisualGpuTimingEvidence) {
      manager.getVisualGpuTimingEvidence = initial.getVisualGpuTimingEvidence;
    } else {
      delete manager.getVisualGpuTimingEvidence;
    }
    setUiVisible(true);
    appFrameAttribution.dispose();
    runtimeApp.setVisualFrameProfiler?.(null);
    const profileWindow = window as typeof window & {
      __visualPerf?: VisualPerformanceHooks;
    };
    if (profileWindow.__visualPerf === installedHooks) {
      delete profileWindow.__visualPerf;
    }
    for (const key of Object.keys(profileDataset)) {
      if (key.startsWith('visualProfile')) delete profileDataset[key];
    }
    latestReport = null;
  };
  disposeRealAppProfile = disposeProfile;
  stopFrameCollection = (): void => {
    stopCollector();
    if (appFrameAttribution) disposeProfile();
  };

  // Wait for the same full scene in every profile (including harnesses that
  // construct vegetation explicitly), then reapply all URL overrides after
  // vegetation's final shadow-preference sync. The five-second settling window
  // keeps shader compilation out of the trace.
  const waitForDeferredScene = (): void => {
    deferredScenePollTimeout = null;
    if (realAppProfileDisposed) return;
    if (manager.forestManager === null || manager.grassField === null) {
      deferredScenePollTimeout = window.setTimeout(waitForDeferredScene, 100);
      return;
    }
    for (const subsystem of requestedDisabled) setEnabled(subsystem, false);
    const forestProfile = manager.forestManager.getSeedThreeProfileBreakdown();
    if (forestProfile) {
      profileDataset.visualProfileForestStructural = JSON.stringify(forestProfile);
    }
    profileDataset.visualProfileStatus = 'settling';
    collectorSettleTimeout = window.setTimeout(() => {
      collectorSettleTimeout = null;
      if (realAppProfileDisposed) return;
      for (const subsystem of requestedDisabled) setEnabled(subsystem, false);
      const collector = startFrameIntervalCollector(
        manager,
        () => ({ ...state }),
        (report) => {
          latestReport = report;
        },
      );
      if (options.deferPeriodicReportsUntilReady) {
        collector.deferPeriodicReportsUntilReady();
        collector.deferDomPublicationUntilReady();
      }
      armTraceAfterCurrentFrame = collector.armAfterCurrentFrame;
      deferDomPublicationUntilReady =
        collector.deferDomPublicationUntilReady;
      getDomPublicationEvidence = collector.getDomPublicationEvidence;
      stopCollector = collector.stop;
      resetCoordinator.attach(collector.settleThrough);
    }, 5_000);
  };
  deferredScenePollTimeout = window.setTimeout(waitForDeferredScene, 100);

  installedHooks = {
    subsystems: SUBSYSTEMS,
    armTraceAfterCurrentFrame: () => armTraceAfterCurrentFrame(),
    deferDomPublicationUntilReady: () => deferDomPublicationUntilReady(),
    getDomPublicationEvidence: () => getDomPublicationEvidence(),
    getReport: () => latestReport === null
      ? null
      : JSON.parse(JSON.stringify(latestReport)) as VisualPerformanceReport,
    getState: () => ({ ...state }),
    getRendererStats: () => manager.getPerformanceStats(),
    restartTrace: resetCoordinator.requestReset,
    stopFrameCollection: () => stopFrameCollection(),
    reset,
    setEnabled,
    setForestFloorDebugMode: (mode) => {
      manager.forestManager?.setForestFloorDebugMode?.(mode);
    },
    setTerrainHorizonDebugMode: (mode) => {
      manager.setTerrainHorizonDebugMode?.(mode);
    },
    getTerrainHorizonDiagnostics: () => (
      manager.getTerrainHorizonDiagnostics?.() ?? null
    ),
  };
  (window as typeof window & { __visualPerf?: VisualPerformanceHooks })
    .__visualPerf = installedHooks;
}

function startFrameIntervalCollector(
  manager: RuntimeSceneManager,
  getSubsystemState: () => Record<ProfileSubsystem, boolean>,
  setLatestReport: (report: VisualPerformanceReport | null) => void,
): {
  armAfterCurrentFrame(): void;
  deferDomPublicationUntilReady(): void;
  deferPeriodicReportsUntilReady(): void;
  getDomPublicationEvidence(): VisualPerformanceDomPublicationEvidence;
  settleThrough(settleUntil: number): void;
  stop(): void;
} {
  const dataset = document.documentElement.dataset;
  const windowMs = VISUAL_PERFORMANCE_WINDOW_MS;
  const traceCapture = createVisualPerformanceTraceCapture(windowMs);
  const traceArmingBoundary = createVisualPerformanceTraceArmingBoundary();
  const readyReportLatch = createVisualPerformanceReadyReportLatch();
  const domPublicationGate = createVisualPerformanceDomPublicationGate();
  const rendererInfo = manager.renderer.info as unknown as {
    reset?: () => void;
    render: {
      drawCalls?: number;
      frameCalls?: number;
      calls?: number;
      triangles?: number;
    };
  };
  const adapterEvidence = manager.getRendererAdapterEvidence();
  let traceStart = 0;
  let traceArmed = false;
  let traceIntegrityError: string | null = null;
  let frozenContext: VisualPerformanceReport['context'] | null = null;
  type CollectedFrame = {
    rafTimestampMs: number;
    renderer: VisualSlowFrameRecord['renderer'];
    context: VisualSlowFrameContext | null;
  };
  const collectedFrames: [CollectedFrame, CollectedFrame] = [
    {
      rafTimestampMs: 0,
      renderer: { drawCalls: 0, frameCalls: 0, triangles: 0 },
      context: null,
    },
    {
      rafTimestampMs: 0,
      renderer: { drawCalls: 0, frameCalls: 0, triangles: 0 },
      context: null,
    },
  ];
  let nextCollectedFrameIndex = 0;
  let previousFrame: CollectedFrame | null = null;
  let lastPublished = 0;
  let animationFrameId: number | null = null;
  let stopped = false;
  let lifecycleStatus = 'collecting';
  let deferPeriodicReportsUntilReady = false;

  const mayWriteCohortDom = (): boolean =>
    domPublicationGate.getEvidence().mode === 'periodic';

  const writeLifecycleStatus = (status: string): void => {
    lifecycleStatus = status;
    if (mayWriteCohortDom()) dataset.visualProfileStatus = status;
  };

  const scheduleFrame = (): void => {
    if (stopped) return;
    animationFrameId = requestAnimationFrame(onFrame);
  };

  const resetTrace = (status: string): void => {
    traceCapture.reset();
    traceArmingBoundary.reset();
    readyReportLatch.reset();
    traceStart = 0;
    traceArmed = false;
    traceIntegrityError = null;
    frozenContext = null;
    previousFrame = null;
    lastPublished = 0;
    domPublicationGate.reset();
    lifecycleStatus = status;
    if (mayWriteCohortDom()) {
      dataset.visualProfileStatus = status;
      dataset.visualProfileSeconds = '0.00';
      dataset.visualProfileSampleCount = '0';
      delete dataset.visualProfileMedianFps;
      delete dataset.visualProfileOnePercentLowFps;
      delete dataset.visualProfileMeanFps;
      delete dataset.visualProfileP99FrameMs;
      delete dataset.visualProfileMaxFrameMs;
      delete dataset.visualProfileFramesOver25Ms;
      delete dataset.visualProfileFramesOver50Ms;
      delete dataset.visualProfileDrawCalls;
      delete dataset.visualProfileFrameCalls;
      delete dataset.visualProfileTriangles;
      delete dataset.visualProfileDevicePixelRatio;
      delete dataset.visualProfileReport;
      delete dataset.visualProfileIntegrityError;
    }
    setLatestReport(null);
    rendererInfo.reset?.();
  };

  const snapshotReportContext = (): VisualPerformanceReport['context'] => {
    const stats = manager.getPerformanceStats();
    const gpuTiming = manager.getVisualGpuTimingEvidence?.()
      ?? createUnavailableVisualGpuTimingEvidence(
        'The active scene manager does not expose profile GPU timestamp instrumentation.',
      );
    return {
      backend: stats.backend,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: stats.pixelRatio,
      visibility: document.visibilityState,
      adapter: {
        ...adapterEvidence,
        limitations: [...adapterEvidence.limitations],
      },
      gpuTiming: {
        ...gpuTiming,
        limitations: [...gpuTiming.limitations],
      },
      subsystems: { ...getSubsystemState() },
    };
  };

  const publish = (now: number): void => {
    if (readyReportLatch.hasReadyReport()) return;
    if (deferPeriodicReportsUntilReady && !traceCapture.isFrozen()) return;
    const samples = traceCapture.getSamples();
    if (samples.length === 0) return;
    const frameTimes = samples.map((sample) => sample.dt);
    const metrics = calculateVisualPerformanceMetrics(frameTimes);
    if (!metrics) return;
    const medianCounter = (
      select: (sample: (typeof samples)[number]) => number,
    ): number => {
      const values = samples.map(select).sort((a, b) => a - b);
      const index = Math.floor(values.length / 2);
      return values.length % 2 === 0
        ? (values[index - 1]! + values[index]!) * 0.5
        : values[index]!;
    };
    const seconds = traceCapture.isFrozen()
      ? windowMs / 1000
      : Math.min(windowMs, now - traceStart) / 1000;
    const renderer = {
      medianDrawCalls: medianCounter((sample) => sample.drawCalls),
      medianFrameCalls: medianCounter((sample) => sample.frameCalls),
      medianTriangles: medianCounter((sample) => sample.triangles),
    };
    const slowFrameSelection = selectVisualWorstFrameRecords(
      traceCapture.getSlowFrames(),
      frameTimes.length,
    ).map((record) => {
      const timing = manager.getVisualGpuFrameTiming?.(
        record.precedingFrameRafTimestampMs,
      );
      return timing
        ? hydrateVisualSlowFrameGpuTiming(record, timing)
        : record;
    });
    if (
      !doVisualSlowFrameRecordsReproduceMetrics(
        slowFrameSelection,
        frameTimes,
        metrics,
      )
    ) {
      traceIntegrityError =
        'The selected detail records did not exactly match the frozen metric cohort.';
      lifecycleStatus = 'integrity-error';
      if (mayWriteCohortDom()) {
        dataset.visualProfileStatus = 'integrity-error';
        dataset.visualProfileIntegrityError = traceIntegrityError;
        delete dataset.visualProfileReport;
      }
      setLatestReport(null);
      return;
    }
    const status = traceCapture.isFrozen()
      && areVisualSlowFrameGpuTimingsTerminal(slowFrameSelection)
      ? 'ready'
      : 'collecting';
    const reportContext = frozenContext ?? snapshotReportContext();
    const report = readyReportLatch.accept(createVisualPerformanceReport({
      status,
      elapsedSeconds: seconds,
      sampleCount: frameTimes.length,
      metrics,
      renderer,
      slowFrames: slowFrameSelection,
      context: reportContext,
    }));
    const domPublication = domPublicationGate.accept(report);
    setLatestReport(report);
    lifecycleStatus = report.status;
    if (!domPublication.publishToDom) return;

    dataset.visualProfileSeconds = seconds.toFixed(2);
    dataset.visualProfileSampleCount = String(frameTimes.length);
    dataset.visualProfileMedianFps = metrics.medianFps.toFixed(2);
    dataset.visualProfileOnePercentLowFps = metrics.onePercentLowFps.toFixed(2);
    dataset.visualProfileMeanFps = metrics.meanFps.toFixed(2);
    dataset.visualProfileP99FrameMs = metrics.p99FrameMs.toFixed(2);
    dataset.visualProfileMaxFrameMs = metrics.maxFrameMs.toFixed(2);
    dataset.visualProfileFramesOver25Ms = String(metrics.framesOver25Ms);
    dataset.visualProfileFramesOver50Ms = String(metrics.framesOver50Ms);
    dataset.visualProfileBackend = report.context.backend;
    dataset.visualProfileDrawCalls = renderer.medianDrawCalls.toFixed(1);
    dataset.visualProfileFrameCalls = renderer.medianFrameCalls.toFixed(1);
    dataset.visualProfileTriangles = renderer.medianTriangles.toFixed(0);
    dataset.visualProfilePixelRatio =
      report.context.rendererPixelRatio.toFixed(2);
    dataset.visualProfileDevicePixelRatio =
      report.context.devicePixelRatio.toFixed(2);
    dataset.visualProfileViewport =
      `${report.context.viewport.width}x${report.context.viewport.height}`;
    dataset.visualProfileVisibility = report.context.visibility;
    dataset.visualProfileStatus = report.status;
    dataset.visualProfileReport = domPublication.serializedReport;
  };
  const resettleGate = createVisualPerformanceResettleGate(
    () => performance.now(),
    resetTrace,
  );

  const onFrame = (now: number): void => {
    animationFrameId = null;
    if (stopped) return;
    if (traceIntegrityError !== null) {
      if (mayWriteCohortDom()) {
        dataset.visualProfileStatus = 'integrity-error';
        dataset.visualProfileIntegrityError = traceIntegrityError;
      }
      rendererInfo.reset?.();
      scheduleFrame();
      return;
    }
    if (document.hidden) {
      if (lifecycleStatus !== 'paused-hidden') resetTrace('paused-hidden');
      else rendererInfo.reset?.();
      scheduleFrame();
      return;
    }
    if (!resettleGate.allowFrame(now)) {
      rendererInfo.reset?.();
      scheduleFrame();
      return;
    }
    const performanceStats = manager.getPerformanceStats();
    const context = manager.getSlowFrameContext?.(now) ?? null;
    const currentFrame = collectedFrames[nextCollectedFrameIndex];
    nextCollectedFrameIndex = (nextCollectedFrameIndex + 1)
      % collectedFrames.length;
    currentFrame.rafTimestampMs = now;
    currentFrame.renderer.drawCalls = performanceStats.calls;
    currentFrame.renderer.frameCalls = performanceStats.renderPasses ?? 0;
    currentFrame.renderer.triangles = performanceStats.triangles;
    currentFrame.context = context;
    if (traceArmingBoundary.consumeCompletedFrame()) {
      // The arming callback itself belongs to the preceding treatment (route
      // seek or explicit control lead-in). Clear any intervals accumulated
      // before it so the next ordinary callback anchors a fresh cohort.
      resetTrace('collecting');
      traceArmed = true;
      rendererInfo.reset?.();
      scheduleFrame();
      return;
    }
    if (!traceArmed) {
      traceArmed = true;
      writeLifecycleStatus('collecting');
      rendererInfo.reset?.();
      scheduleFrame();
      return;
    }
    if (traceStart === 0) {
      traceStart = now;
      previousFrame = currentFrame;
      writeLifecycleStatus('collecting');
      rendererInfo.reset?.();
      scheduleFrame();
      return;
    }

    const intervalStartRafTimestampMs = previousFrame?.rafTimestampMs ?? now;
    const dt = now - intervalStartRafTimestampMs;
    if (dt > 0 && !traceCapture.isFrozen()) {
      const precedingContext = previousFrame?.context ?? null;
      const contextIsCausallyAligned = precedingContext !== null
        && precedingContext.frameRafTimestampMs === intervalStartRafTimestampMs
        && calculateVisualFrameEntryLatenessMs(
          precedingContext.frameRafTimestampMs,
          precedingContext.frameCallbackEntryTimestampMs,
        ) !== null;
      if (!contextIsCausallyAligned) {
        const integrityError =
          'A frame interval could not be paired with its causally preceding CPU/GPU context.';
        resetTrace('integrity-error');
        traceIntegrityError = integrityError;
        if (mayWriteCohortDom()) {
          dataset.visualProfileIntegrityError = integrityError;
        }
        scheduleFrame();
        return;
      }
      const sample = {
        at: now,
        dt,
        drawCalls: previousFrame?.renderer.drawCalls ?? 0,
        frameCalls: previousFrame?.renderer.frameCalls ?? 0,
        triangles: previousFrame?.renderer.triangles ?? 0,
      };
      const retainedSlowFrames = traceCapture.getSlowFrames();
      const shouldCaptureSlowFrame = shouldCaptureVisualSlowFrame(
        retainedSlowFrames,
        dt,
      );
      let slowFrame: VisualSlowFrameRecord | null = null;
      if (shouldCaptureSlowFrame) {
        slowFrame = createVisualSlowFrameRecordForInterval({
          intervalStartRafTimestampMs,
          intervalEndRafTimestampMs: now,
          traceStartRafTimestampMs: traceStart,
          precedingFrame: {
            ...precedingContext,
            renderer: previousFrame!.renderer,
          },
        });
        if (!slowFrame) {
          const integrityError =
            'A retained slow frame could not be materialized from its validated context.';
          resetTrace('integrity-error');
          traceIntegrityError = integrityError;
          if (mayWriteCohortDom()) {
            dataset.visualProfileIntegrityError = integrityError;
          }
          scheduleFrame();
          return;
        }
      }
      traceCapture.appendInterval(sample, slowFrame);
      if (
        traceCapture.freezeIfComplete(traceStart, now)
        && frozenContext === null
      ) {
        frozenContext = snapshotReportContext();
      }
    }
    previousFrame = currentFrame;
    // SceneManager disables Three's automatic info reset so it can delimit the
    // complete world/map submission itself. This callback runs after App.tick
    // and resets counters for the next profiler sample after recording the
    // just-completed one.
    rendererInfo.reset?.();
    if (now - lastPublished >= 500) {
      publish(now);
      lastPublished = now;
    }
    scheduleFrame();
  };

  resetTrace(document.hidden ? 'paused-hidden' : 'collecting');
  scheduleFrame();
  return {
    armAfterCurrentFrame: traceArmingBoundary.armAfterCurrentFrame,
    deferDomPublicationUntilReady: domPublicationGate.deferUntilReady,
    getDomPublicationEvidence: domPublicationGate.getEvidence,
    deferPeriodicReportsUntilReady: () => {
      deferPeriodicReportsUntilReady = true;
    },
    settleThrough: resettleGate.settleThrough,
    stop: () => {
      stopped = true;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },
  };
}
