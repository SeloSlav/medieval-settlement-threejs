import * as THREE from 'three';
import type { ScenePostProcessor } from '../scene/PostProcessing.ts';
import type {
  RendererAdapterEvidence,
  SupportedRenderer,
} from '../scene/RendererBackend.ts';

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
  grassField: { group: THREE.Group } | null;
  forestManager: { group: THREE.Group } | null;
  getRendererAdapterEvidence(): RendererAdapterEvidence;
  getPerformanceStats(): {
    backend: string;
    frames: number;
    calls: number;
    triangles: number;
    pixelRatio: number;
  };
};

type RuntimeApp = {
  sceneManager: RuntimeSceneManager | null;
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

export type VisualPerformanceReport = {
  schemaVersion: 1;
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
    subsystems: Record<ProfileSubsystem, boolean>;
  };
};

export type VisualPerformanceHooks = {
  readonly subsystems: readonly ProfileSubsystem[];
  getReport(): VisualPerformanceReport | null;
  getState(): Record<ProfileSubsystem, boolean>;
  getRendererStats(): ReturnType<RuntimeSceneManager['getPerformanceStats']>;
  reset(): void;
  setEnabled(subsystem: ProfileSubsystem, enabled: boolean): void;
};

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
  const slowFrameCount = Math.max(1, Math.ceil(validFrameTimes.length * 0.01));
  const slowestFrameTimes = sortedAscending.slice(-slowFrameCount);
  const slowestMeanFrameMs =
    slowestFrameTimes.reduce((sum, frameTime) => sum + frameTime, 0)
    / slowestFrameTimes.length;
  const totalFrameMs = validFrameTimes.reduce((sum, frameTime) => sum + frameTime, 0);

  return {
    medianFps: 1000 / medianFrameMs,
    onePercentLowFps: 1000 / slowestMeanFrameMs,
    meanFps: (validFrameTimes.length * 1000) / totalFrameMs,
    // Preserve the existing collector definition: p99 is the mean of the
    // slowest one percent of frame intervals.
    p99FrameMs: slowestMeanFrameMs,
    maxFrameMs: sortedAscending[sortedAscending.length - 1]!,
    framesOver25Ms: validFrameTimes.filter((frameTime) => frameTime > 25).length,
    framesOver50Ms: validFrameTimes.filter((frameTime) => frameTime > 50).length,
  };
}

export function createVisualPerformanceReport(
  report: Omit<VisualPerformanceReport, 'schemaVersion' | 'windowSeconds'>,
): VisualPerformanceReport {
  return {
    ...report,
    schemaVersion: 1,
    windowSeconds: 30,
    metrics: { ...report.metrics },
    renderer: { ...report.renderer },
    context: {
      ...report.context,
      viewport: { ...report.context.viewport },
      adapter: {
        ...report.context.adapter,
        limitations: [...report.context.adapter.limitations],
      },
      subsystems: { ...report.context.subsystems },
    },
  };
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
} {
  let settleUntil: number | null = null;
  return {
    allowFrame: (frameNow) => {
      if (settleUntil === null) return true;
      if (frameNow < settleUntil) return false;
      settleUntil = null;
      resetTrace('collecting');
      return true;
    },
    invalidate: () => {
      settleUntil = now() + 5_000;
      resetTrace('settling');
    },
  };
}

export function installVisualPerformanceHooksIfRequested(app: object): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('visualProfile') !== '1') return;

  const manager = (app as RuntimeApp).sceneManager;
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
    // Vegetation is intentionally constructed after App.start resolves.
    // Both groups default visible when they appear, so the profiling baseline
    // must not capture their temporary pre-build absence as "disabled".
    groundcoverVisible: manager.grassField?.group.visible ?? true,
    forestVisible: manager.forestManager?.group.visible ?? true,
  };
  const state = Object.fromEntries(SUBSYSTEMS.map((name) => [name, true])) as Record<
    ProfileSubsystem,
    boolean
  >;
  const hiddenUi = new Map<HTMLElement, { visibility: string; pointerEvents: string }>();
  let latestReport: VisualPerformanceReport | null = null;
  let invalidateProfileTrace: (() => void) | null = null;

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
        manager.postProcessor.render = enabled
          ? initial.postRender
          : () => manager.renderer.render(manager.scene, manager.camera);
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
    if (changed && invalidateChangedTrace) invalidateProfileTrace?.();
  };

  const setEnabled = (subsystem: ProfileSubsystem, enabled: boolean): void => {
    applyEnabled(subsystem, enabled, true);
  };

  const reset = (): void => {
    resetVisualPerformanceSubsystems(
      (subsystem, enabled) => applyEnabled(subsystem, enabled, false),
      () => invalidateProfileTrace?.(),
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
  const profileDataset = document.documentElement.dataset;
  profileDataset.visualProfileDisabled = disabledLabel || 'none';
  profileDataset.visualProfileStatus = 'waiting-vegetation';
  for (const subsystem of requestedDisabled) setEnabled(subsystem, false);

  // App.start intentionally resolves before the deferred vegetation build.
  // Wait for the same full scene in every profile, then reapply all URL
  // overrides after vegetation's final shadow-preference sync. The five-second
  // settling window keeps compilation and stream-fill work out of the trace.
  const waitForDeferredScene = (): void => {
    if (manager.forestManager === null || manager.grassField === null) {
      window.setTimeout(waitForDeferredScene, 100);
      return;
    }
    for (const subsystem of requestedDisabled) setEnabled(subsystem, false);
    profileDataset.visualProfileStatus = 'settling';
    window.setTimeout(() => {
      for (const subsystem of requestedDisabled) setEnabled(subsystem, false);
      invalidateProfileTrace = startFrameIntervalCollector(
        manager,
        () => ({ ...state }),
        (report) => {
          latestReport = report;
        },
      );
    }, 5_000);
  };
  window.setTimeout(waitForDeferredScene, 100);

  (window as typeof window & { __visualPerf?: VisualPerformanceHooks }).__visualPerf = {
    subsystems: SUBSYSTEMS,
    getReport: () => latestReport === null
      ? null
      : JSON.parse(JSON.stringify(latestReport)) as VisualPerformanceReport,
    getState: () => ({ ...state }),
    getRendererStats: () => manager.getPerformanceStats(),
    reset,
    setEnabled,
  };
}

function startFrameIntervalCollector(
  manager: RuntimeSceneManager,
  getSubsystemState: () => Record<ProfileSubsystem, boolean>,
  setLatestReport: (report: VisualPerformanceReport | null) => void,
): () => void {
  const dataset = document.documentElement.dataset;
  const windowMs = VISUAL_PERFORMANCE_WINDOW_MS;
  const samples: Array<{
    at: number;
    dt: number;
    drawCalls: number;
    frameCalls: number;
    triangles: number;
  }> = [];
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
  let previousFrame = 0;
  let lastPublished = 0;

  const resetTrace = (status: string): void => {
    samples.length = 0;
    traceStart = 0;
    previousFrame = 0;
    lastPublished = 0;
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
    setLatestReport(null);
    rendererInfo.reset?.();
  };

  const publish = (now: number): void => {
    if (samples.length === 0) return;
    const frameTimes = samples.map((sample) => sample.dt);
    const metrics = calculateVisualPerformanceMetrics(frameTimes);
    if (!metrics) return;
    const stats = manager.getPerformanceStats();
    const medianCounter = (
      select: (sample: (typeof samples)[number]) => number,
    ): number => {
      const values = samples.map(select).sort((a, b) => a - b);
      const index = Math.floor(values.length / 2);
      return values.length % 2 === 0
        ? (values[index - 1]! + values[index]!) * 0.5
        : values[index]!;
    };
    const seconds = Math.min(windowMs, now - traceStart) / 1000;
    const status = now - traceStart >= windowMs ? 'ready' : 'collecting';
    const renderer = {
      medianDrawCalls: medianCounter((sample) => sample.drawCalls),
      medianFrameCalls: medianCounter((sample) => sample.frameCalls),
      medianTriangles: medianCounter((sample) => sample.triangles),
    };
    const report = createVisualPerformanceReport({
      status,
      elapsedSeconds: seconds,
      sampleCount: frameTimes.length,
      metrics,
      renderer,
      context: {
        backend: stats.backend,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        devicePixelRatio: window.devicePixelRatio,
        rendererPixelRatio: stats.pixelRatio,
        visibility: document.visibilityState,
        adapter: adapterEvidence,
        subsystems: getSubsystemState(),
      },
    });

    dataset.visualProfileSeconds = seconds.toFixed(2);
    dataset.visualProfileSampleCount = String(frameTimes.length);
    dataset.visualProfileMedianFps = metrics.medianFps.toFixed(2);
    dataset.visualProfileOnePercentLowFps = metrics.onePercentLowFps.toFixed(2);
    dataset.visualProfileMeanFps = metrics.meanFps.toFixed(2);
    dataset.visualProfileP99FrameMs = metrics.p99FrameMs.toFixed(2);
    dataset.visualProfileMaxFrameMs = metrics.maxFrameMs.toFixed(2);
    dataset.visualProfileFramesOver25Ms = String(metrics.framesOver25Ms);
    dataset.visualProfileFramesOver50Ms = String(metrics.framesOver50Ms);
    dataset.visualProfileBackend = stats.backend;
    dataset.visualProfileDrawCalls = renderer.medianDrawCalls.toFixed(1);
    dataset.visualProfileFrameCalls = renderer.medianFrameCalls.toFixed(1);
    dataset.visualProfileTriangles = renderer.medianTriangles.toFixed(0);
    dataset.visualProfilePixelRatio = stats.pixelRatio.toFixed(2);
    dataset.visualProfileDevicePixelRatio = window.devicePixelRatio.toFixed(2);
    dataset.visualProfileViewport = `${window.innerWidth}x${window.innerHeight}`;
    dataset.visualProfileVisibility = document.visibilityState;
    dataset.visualProfileStatus = status;
    dataset.visualProfileReport = JSON.stringify(report);
    setLatestReport(report);
  };
  const resettleGate = createVisualPerformanceResettleGate(
    () => performance.now(),
    resetTrace,
  );

  const onFrame = (now: number): void => {
    if (document.hidden) {
      if (dataset.visualProfileStatus !== 'paused-hidden') resetTrace('paused-hidden');
      requestAnimationFrame(onFrame);
      return;
    }
    if (!resettleGate.allowFrame(now)) {
      requestAnimationFrame(onFrame);
      return;
    }
    if (traceStart === 0) {
      traceStart = now;
      previousFrame = now;
      dataset.visualProfileStatus = 'collecting';
      requestAnimationFrame(onFrame);
      return;
    }

    const dt = now - previousFrame;
    previousFrame = now;
    const renderInfo = rendererInfo.render;
    if (dt > 0) {
      samples.push({
        at: now,
        dt,
        drawCalls: renderInfo.drawCalls ?? 0,
        frameCalls: renderInfo.frameCalls ?? renderInfo.calls ?? 0,
        triangles: renderInfo.triangles ?? 0,
      });
    }
    // App owns requestAnimationFrame instead of Renderer.setAnimationLoop, so
    // Three does not perform its normal per-frame info reset. Our callback is
    // registered after App.tick and therefore resets counters for the next
    // frame after recording the just-completed one.
    rendererInfo.reset?.();
    while (samples.length > 0 && now - samples[0]!.at > windowMs) samples.shift();
    if (now - lastPublished >= 500) {
      publish(now);
      lastPublished = now;
    }
    requestAnimationFrame(onFrame);
  };

  resetTrace(document.hidden ? 'paused-hidden' : 'collecting');
  requestAnimationFrame(onFrame);
  return resettleGate.invalidate;
}
