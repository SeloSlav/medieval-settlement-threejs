import type { VisualGpuTimestampProfiler, VisualGpuTimestampFrameHandle, VisualGpuFrameTiming } from '../e2e/webGpuTimestampProfiler.ts';

type Fields = Record<string, unknown>;
export type DevelopmentProfileContext = {
  camera: { position: number[]; rotation: number[]; target: number[]; distance: number; mode: string; navigating: boolean };
  tool: string;
  menuOpen: boolean;
  visible: boolean;
  gameSpeed: number;
  world: Record<string, number>;
};
export type DevelopmentProfileRendererStats = {
  calls: number; triangles: number; renderPasses?: number; pixelRatio?: number;
  directionalShadow?: { refreshedThisFrame: boolean; reasons: readonly string[] };
};
type StartOptions = {
  metadata: Fields;
  toggles: Fields;
  getContext: () => DevelopmentProfileContext;
  gpu?: VisualGpuTimestampProfiler;
};
type ProfileEvent = { id: number; t: number; kind: string; data: Fields };
type Frame = {
  raf: number; entry: number; cpuMs: number; phases: Record<string, number>;
  context: DevelopmentProfileContext; state: number; renderer: DevelopmentProfileRendererStats;
  motion: string; gpu: { timing: VisualGpuFrameTiming } | null;
};
type Interval = Frame & { end: number; ms: number; outsideCpuMs: number; outsidePhases: Record<string, number>; suspended: boolean };
const round = (n: number) => Math.round(n * 100) / 100;
const topPhases = (phases: Record<string, number>, limit = 8) => Object.fromEntries(
  Object.entries(phases).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, value]) => [key, round(value)]),
);

class Aggregate {
  frames = 0;
  total = 0;
  max = 0;
  cpu = 0;
  outside = 0;
  entryDelay = 0;
  calls = 0;
  triangles = 0;
  shadows = 0;
  over33 = 0;
  over50 = 0;
  over100 = 0;
  private readonly histogram = new Uint32Array(2049);
  private readonly phases: Record<string, number> = {};

  add(frame: Interval): void {
    this.frames++;
    this.total += frame.ms;
    this.max = Math.max(this.max, frame.ms);
    this.cpu += frame.cpuMs;
    this.outside += frame.outsideCpuMs;
    this.entryDelay += Math.max(0, frame.entry - frame.raf);
    this.calls += frame.renderer.calls;
    this.triangles += frame.renderer.triangles;
    this.shadows += Number(frame.renderer.directionalShadow?.refreshedThisFrame ?? false);
    this.over33 += Number(frame.ms > 1000 / 30);
    this.over50 += Number(frame.ms > 50);
    this.over100 += Number(frame.ms > 100);
    this.histogram[Math.min(2048, Math.ceil(frame.ms))]++;
    for (const [label, value] of Object.entries(frame.phases)) this.phases[label] = (this.phases[label] ?? 0) + value;
  }

  report(): Fields {
    const count = Math.max(1, this.frames);
    const percentile = (fraction: number): number | string | null => {
      if (!this.frames) return null;
      let remaining = Math.ceil(this.frames * fraction);
      for (let i = 0; i < this.histogram.length; i++) {
        remaining -= this.histogram[i];
        if (remaining <= 0) return i === 2048 ? '>=2048' : i;
      }
      return null;
    };
    return {
      frames: this.frames, fps: this.total > 0 ? round(this.frames * 1000 / this.total) : null,
      meanMs: round(this.total / count), p95MsUpperBound: percentile(.95), p99MsUpperBound: percentile(.99),
      maxMs: round(this.max), framesOver33Ms: this.over33, framesOver50Ms: this.over50, framesOver100Ms: this.over100,
      meanCallbackCpuMs: round(this.cpu / count), meanBetweenCallbacksCpuMs: round(this.outside / count),
      meanCallbackEntryDelayMs: round(this.entryDelay / count), meanDraws: round(this.calls / count),
      meanTriangles: Math.round(this.triangles / count), shadowRefreshPct: round(this.shadows * 100 / count),
      meanCpuMsInclusive: topPhases(Object.fromEntries(Object.entries(this.phases).map(([label, ms]) => [label, ms / count])), 20),
    };
  }
}

type TimelineBucket = { t: number; frames: number; ms: number; max: number; cpu: number; moving: number; calls: number; triangles: number; state: number; camera: number[] };

/** Opt-in, bounded gameplay recorder. No instrumentation remains installed after stop. */
export class DevelopmentProfiler {
  private readonly now: () => number;
  private active = false;
  private generation = 0;
  private options: StartOptions | null = null;
  private startedAt = 0;
  private startedUtc = '';
  private frameEntry = 0;
  private frameRaf = 0;
  private inFrame = false;
  private framePhases: Record<string, number> = {};
  private outsidePhases: Record<string, number> = {};
  private outsideCpuMs = 0;
  private wrapperDepth = 0;
  private previous: Frame | null = null;
  private currentState = 0;
  private nextState = 1;
  private readonly stateIds = new Map<string, number>();
  private states: Array<{ id: number; t: number; toggles: Fields }> = [];
  private events: ProfileEvent[] = [];
  private browserEvents: ProfileEvent[] = [];
  private browserEntryCounts: Record<string, number> = {};
  private nextEventId = 0;
  private droppedEvents = 0;
  private droppedStates = 0;
  private droppedCohorts = 0;
  private total = new Aggregate();
  private gameplay = new Aggregate();
  private cohorts = new Map<string, Aggregate>();
  private worst: Interval[] = [];
  private timeline: TimelineBucket[] = [];
  private bucketWidthMs = 1000;
  private cleanup: Array<() => void> = [];
  private observers: PerformanceObserver[] = [];
  private gpuHandle: VisualGpuTimestampFrameHandle | null = null;
  private gpuPending: Frame[] = [];
  private gpuSamples = 0;
  private gpuTotalMs = 0;
  private gpuMaxMs = 0;
  private frameCounter = 0;
  private suspended = false;
  private lastReport: string | null = null;

  constructor(now: () => number = () => performance.now()) { this.now = now; }
  isRecording(): boolean { return this.active; }
  getLastReport(): string | null { return this.lastReport; }
  getElapsedMs(): number { return this.active ? Math.max(0, this.now() - this.startedAt) : 0; }
  getFrameCount(): number { return this.total.frames; }

  start(options: StartOptions): void {
    if (this.active) return;
    this.generation++;
    this.options = options;
    this.startedAt = this.now();
    this.startedUtc = new Date().toISOString();
    this.currentState = this.nextEventId = this.droppedEvents = this.droppedStates = this.droppedCohorts = 0;
    this.states = [{ id: 0, t: 0, toggles: structuredClone(options.toggles) }];
    this.nextState = 1;
    this.stateIds.clear(); this.stateIds.set(JSON.stringify(options.toggles), 0);
    this.events = []; this.browserEvents = []; this.browserEntryCounts = {}; this.worst = []; this.timeline = [];
    this.total = new Aggregate(); this.gameplay = new Aggregate(); this.cohorts.clear();
    this.previous = null; this.inFrame = false; this.wrapperDepth = 0;
    this.outsidePhases = {}; this.outsideCpuMs = 0; this.bucketWidthMs = 1000;
    this.gpuHandle = null; this.gpuPending = [];
    this.gpuSamples = this.gpuTotalMs = this.gpuMaxMs = this.frameCounter = 0;
    this.suspended = false;
    this.active = true;
    this.event('record-start', { context: options.getContext() });
    this.observeBrowser();
  }

  togglesChanged(toggles: Fields): void {
    if (!this.active) return;
    const signature = JSON.stringify(toggles);
    const existing = this.stateIds.get(signature);
    if (existing !== undefined) this.currentState = existing;
    else {
      this.currentState = this.nextState++;
      if (this.states.length < 128) {
        this.states.push({ id: this.currentState, t: this.time(), toggles: structuredClone(toggles) });
        this.stateIds.set(signature, this.currentState);
      } else this.droppedStates++;
    }
    this.event('render-toggles', { state: this.currentState, ...toggles });
  }

  event(kind: string, data: Fields = {}, absoluteTime = this.now()): void {
    if (!this.active) return;
    if (kind === 'visibility' && data.visible === false) this.suspended = true;
    const event = { id: this.nextEventId++, t: round(Math.max(0, absoluteTime - this.startedAt)), kind, data: structuredClone(data) };
    if (this.events.length >= 240) {
      const work = this.events.findIndex(event => event.kind === 'between-frame-work');
      if (work < 0 && kind === 'between-frame-work') { this.droppedEvents++; return; }
      this.events.splice(work >= 0 ? work : 1, 1); this.droppedEvents++;
    }
    this.events.push(event);
  }

  /** Wrap synchronous work only while recording. Durations are inclusive, including nested spans. */
  instrument(owner: object | null | undefined, key: string, label: string): void {
    if (!owner || !this.active) return;
    const target = owner as Record<string, unknown>;
    const original = target[key];
    if (typeof original !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const profiler = this;
    const measured = function(this: unknown, ...args: unknown[]): unknown {
      if (!profiler.active) return original.apply(this, args);
      const start = profiler.now();
      const topLevel = profiler.wrapperDepth++ === 0;
      const inFrame = profiler.inFrame;
      try { return original.apply(this, args); }
      finally {
        profiler.wrapperDepth--;
        const ms = Math.max(0, profiler.now() - start);
        const phases = inFrame ? profiler.framePhases : profiler.outsidePhases;
        phases[label] = (phases[label] ?? 0) + ms;
        if (!inFrame && topLevel) {
          profiler.outsideCpuMs += ms;
          if (ms >= 8) profiler.event('between-frame-work', { label, cpuMs: round(ms) }, start);
        }
      }
    }
    target[key] = measured;
    this.cleanup.push(() => {
      if (target[key] !== measured) return;
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else delete target[key];
    });
  }

  /** Record request/response wall time separately from blocking CPU work. */
  instrumentAction(owner: object | null | undefined, key: string): void {
    if (!owner || !this.active) return;
    const target = owner as Record<string, unknown>;
    const original = target[key];
    if (typeof original !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const profiler = this;
    const action = function(this: unknown, ...args: unknown[]): unknown {
      if (!profiler.active) return original.apply(this, args);
      const generation = profiler.generation;
      const start = profiler.now();
      const id = profiler.nextEventId;
      // Only callers explicitly registered by the game can contribute arguments.
      profiler.event('action-request', { action: key, request: id, args });
      const finish = (outcome: string) => {
        if (generation === profiler.generation) profiler.event('action-result', { action: key, request: id, outcome, wallMs: round(profiler.now() - start) });
      };
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') void result.then(() => finish('completed'), () => finish('rejected'));
        else finish('completed');
        return result;
      } catch (error) { finish('threw'); throw error; }
    }
    target[key] = action;
    this.cleanup.push(() => {
      if (target[key] !== action) return;
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else delete target[key];
    });
  }

  beginFrame(rafTimestampMs: number, callbackEntryMs: number): void {
    if (!this.active) return;
    this.resolveGpuSamples();
    if (this.previous && rafTimestampMs > this.previous.raf) {
      this.addInterval({ ...this.previous, end: rafTimestampMs, ms: rafTimestampMs - this.previous.raf,
        outsideCpuMs: this.outsideCpuMs, outsidePhases: this.outsidePhases, suspended: this.suspended });
    }
    this.suspended = false;
    this.outsideCpuMs = 0; this.outsidePhases = {};
    this.frameRaf = rafTimestampMs; this.frameEntry = callbackEntryMs; this.framePhases = {};
    this.inFrame = true;
    // Sample GPU queue bookends once per eight application frames to limit disturbance.
    this.gpuHandle = this.frameCounter++ % 8 === 0 ? this.options?.gpu?.beginFrame(rafTimestampMs) ?? null : null;
  }

  completeFrame(callbackEndMs: number, renderer: DevelopmentProfileRendererStats): void {
    if (!this.active || !this.inFrame || !this.options) return;
    this.inFrame = false;
    if (this.gpuHandle) this.options.gpu?.endFrame(this.gpuHandle);
    const context = this.options.getContext();
    const previousCamera = this.previous?.context.camera;
    let motion = 'still';
    if (previousCamera && previousCamera.mode === context.camera.mode) {
      const changed = (a: number[], b: number[]) => a.some((value, i) => Math.abs(value - (b[i] ?? value)) > 0.0001);
      const parts: string[] = [];
      if (Math.abs(context.camera.distance - previousCamera.distance) > .002) parts.push('zoom');
      if (changed(context.camera.target, previousCamera.target)) parts.push('pan');
      if (changed(context.camera.rotation, previousCamera.rotation)) parts.push('rotate');
      if (!parts.length && changed(context.camera.position, previousCamera.position)) parts.push('move');
      if (parts.length) motion = parts.join('+');
    }
    if (motion === 'still' && context.camera.navigating) motion = 'input';
    const frame: Frame = { raf: this.frameRaf, entry: this.frameEntry, cpuMs: Math.max(0, callbackEndMs - this.frameEntry),
      phases: this.framePhases, context, motion, renderer, state: this.currentState,
      gpu: this.gpuHandle && this.options.gpu ? { timing: this.options.gpu.getFrameTiming(this.frameRaf) } : null };
    if (this.gpuHandle) this.gpuPending.push(frame);
    const previousContext = this.previous?.context;
    if (previousContext && previousContext.tool !== context.tool) this.event('tool', { tool: context.tool });
    if (previousContext && previousContext.camera.mode !== context.camera.mode) this.event('camera-mode', { mode: context.camera.mode });
    if (previousContext && previousContext.gameSpeed !== context.gameSpeed) this.event('game-speed', { speed: context.gameSpeed });
    if (previousContext && JSON.stringify(previousContext.world) !== JSON.stringify(context.world)) this.event('world-counts', context.world);
    this.previous = frame;
    this.gpuHandle = null;
  }

  stop(): string | null {
    if (!this.active) return this.lastReport;
    for (const observer of this.observers) this.consumeEntries(observer.takeRecords());
    this.resolveGpuSamples();
    this.event('record-stop', { context: this.options?.getContext(), frames: this.total.frames });
    const report = this.buildReport();
    this.active = false;
    this.inFrame = false;
    for (const restore of this.cleanup.reverse()) restore();
    this.cleanup.length = 0;
    for (const observer of this.observers) observer.disconnect();
    this.observers.length = 0;
    this.options?.gpu?.dispose();
    this.options = null;
    this.previous = null;
    this.gpuPending.length = 0;
    this.lastReport = `SELO_PROFILE_V1\n${JSON.stringify(report, (_key, value) => typeof value === 'number' ? round(value) : value)}`;
    return this.lastReport;
  }

  dispose(): void { if (this.active) this.stop(); }

  private time(): number { return round(Math.max(0, this.now() - this.startedAt)); }

  private addInterval(frame: Interval): void {
    if (!Number.isFinite(frame.ms) || frame.ms <= 0) return;
    this.total.add(frame);
    if (!frame.context.menuOpen && frame.context.visible && !frame.suspended) this.gameplay.add(frame);
    const key = `${frame.state}|${frame.suspended ? 'background-gap' : frame.context.visible ? frame.context.menuOpen ? 'menu' : 'game' : 'hidden'}|${frame.motion}|${frame.context.tool}`;
    let cohort = this.cohorts.get(key);
    if (!cohort && this.cohorts.size < 64) { cohort = new Aggregate(); this.cohorts.set(key, cohort); }
    if (cohort) cohort.add(frame); else this.droppedCohorts++;
    const index = this.worst.findIndex(other => frame.ms > other.ms);
    if (index >= 0) this.worst.splice(index, 0, frame);
    else if (this.worst.length < 20) this.worst.push(frame);
    if (this.worst.length > 20) this.worst.length = 20;
    const t = Math.max(0, frame.raf - this.startedAt);
    const bucketTime = Math.floor(t / this.bucketWidthMs) * this.bucketWidthMs;
    let bucket = this.timeline.at(-1);
    if (!bucket || bucket.t !== bucketTime) {
      bucket = { t: bucketTime, frames: 0, ms: 0, max: 0, cpu: 0, moving: 0, calls: 0, triangles: 0,
        state: frame.state, camera: [...frame.context.camera.position, ...frame.context.camera.target, frame.context.camera.distance] };
      this.timeline.push(bucket);
    }
    bucket.frames++; bucket.ms += frame.ms; bucket.cpu += frame.cpuMs;
    bucket.max = Math.max(bucket.max, frame.ms); bucket.moving += Number(frame.motion !== 'still');
    bucket.calls += frame.renderer.calls; bucket.triangles += frame.renderer.triangles;
    if (this.timeline.length > 120) this.coarsenTimeline();
  }

  private coarsenTimeline(): void {
    this.bucketWidthMs *= 2;
    const next: TimelineBucket[] = [];
    for (const bucket of this.timeline) {
      const t = Math.floor(bucket.t / this.bucketWidthMs) * this.bucketWidthMs;
      const last = next.at(-1);
      if (last?.t === t) {
        last.frames += bucket.frames; last.ms += bucket.ms; last.cpu += bucket.cpu;
        last.max = Math.max(last.max, bucket.max); last.moving += bucket.moving;
        last.calls += bucket.calls; last.triangles += bucket.triangles;
      } else next.push({ ...bucket, t });
    }
    this.timeline = next;
  }

  private resolveGpuSamples(): void {
    const gpu = this.options?.gpu;
    if (!gpu) return;
    this.gpuPending = this.gpuPending.filter(frame => {
      const timing = gpu.getFrameTiming(frame.raf);
      if (frame.gpu) frame.gpu.timing = timing;
      if (timing.status === 'pending') return true;
      if (timing.status === 'available' && timing.durationMs !== null) {
        this.gpuSamples++; this.gpuTotalMs += timing.durationMs; this.gpuMaxMs = Math.max(this.gpuMaxMs, timing.durationMs);
      }
      return false;
    });
  }

  private observeBrowser(): void {
    if (typeof PerformanceObserver !== 'undefined') {
      for (const type of ['longtask', 'long-animation-frame']) {
        if (!PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
        try {
          const observer = new PerformanceObserver(list => this.consumeEntries(list.getEntries()));
          observer.observe({ type, buffered: false }); this.observers.push(observer);
        } catch { /* Browser support is reported in metadata instead of failing recording. */ }
      }
    }
    if (typeof document !== 'undefined') {
      const visibility = () => this.event('visibility', { visible: document.visibilityState === 'visible' });
      document.addEventListener('visibilitychange', visibility);
      this.cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
    }
    if (typeof window !== 'undefined') {
      const resize = () => this.event('viewport', { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio });
      window.addEventListener('resize', resize);
      this.cleanup.push(() => window.removeEventListener('resize', resize));
    }
  }

  private consumeEntries(entries: PerformanceEntry[]): void {
    for (const entry of entries) {
      if (entry.startTime + entry.duration < this.startedAt) continue;
      const animation = entry as PerformanceEntry & { blockingDuration?: number; scripts?: Array<{ sourceFunctionName?: string; duration?: number; invokerType?: string }> };
      this.browserEntryCounts[entry.entryType] = (this.browserEntryCounts[entry.entryType] ?? 0) + 1;
      this.browserEvents.push({ id: this.nextEventId++, t: round(Math.max(0, entry.startTime - this.startedAt)), kind: entry.entryType,
        data: { ms: round(entry.duration), blockingMs: animation.blockingDuration === undefined ? undefined : round(animation.blockingDuration),
          scripts: animation.scripts?.slice(0, 4).map(script => ({ function: script.sourceFunctionName, ms: round(script.duration ?? 0), invoker: script.invokerType })) } });
      this.browserEvents.sort((a, b) => Number(b.data.ms) - Number(a.data.ms));
      if (this.browserEvents.length > 40) this.browserEvents.length = 40;
    }
  }

  private buildReport(): Fields {
    const gpuEvidence = this.options?.gpu?.getEvidence();
    const evidence = gpuEvidence?.status === 'available' ? {
      ...gpuEvidence, span: 'application-callback-queue-bookends',
      limitations: [
        'Sampled queue markers bracket the application callback, including actor compute, scene updates and rendering. The span includes queue-idle/submission gaps and excludes display presentation.',
        'Two empty compute-marker submissions and asynchronous timestamp readback are profiling overhead; this is not an isolated shader-execution duration.',
      ],
    } : gpuEvidence ?? { status: 'unavailable' };
    return {
      schema: 'selo-development-profile/1', startedUtc: this.startedUtc, durationMs: this.time(),
      metadata: this.options?.metadata, summary: this.total.report(), gameplay: this.gameplay.report(),
      gpu: { sampleEveryFrames: 8, samples: this.gpuSamples, meanQueueSpanMs: this.gpuSamples ? round(this.gpuTotalMs / this.gpuSamples) : null,
        maxQueueSpanMs: this.gpuSamples ? round(this.gpuMaxMs) : null, evidence },
      states: this.states, events: this.events, browserEntryCounts: this.browserEntryCounts, worstBrowserTasks: this.browserEvents,
      cohortKey: 'stateId|game/menu/hidden/background-gap|cameraMotion|activeTool',
      cohorts: Array.from(this.cohorts, ([key, aggregate]) => ({ key, ...aggregate.report() })),
      timelineColumns: ['startMs', 'frames', 'meanMs', 'maxMs', 'meanCpuMs', 'movingPct', 'meanDraws', 'meanTriangles', 'stateAtStart', 'cameraAtStart:positionXYZ,targetXYZ,distance'],
      timelineBucketMs: this.bucketWidthMs,
      timeline: this.timeline.map(b => [b.t, b.frames, round(b.ms / b.frames), round(b.max), round(b.cpu / b.frames), round(b.moving * 100 / b.frames), Math.round(b.calls / b.frames), Math.round(b.triangles / b.frames), b.state, b.camera]),
      worstFrames: this.worst.map(frame => ({
        startMs: round(Math.max(0, frame.raf - this.startedAt)), endMs: round(frame.end - this.startedAt), intervalMs: round(frame.ms),
        callbackCpuMs: round(frame.cpuMs), callbackEntryDelayMs: round(Math.max(0, frame.entry - frame.raf)),
        betweenCallbacksCpuMs: round(frame.outsideCpuMs), cpuMsInclusive: topPhases(frame.phases),
        betweenCallbacksMsInclusive: topPhases(frame.outsidePhases), state: frame.state, motion: frame.motion,
        context: frame.context, renderer: frame.renderer, gpu: frame.gpu?.timing ?? null, backgroundGap: frame.suspended,
        nearbyEvents: this.events.filter(event => event.t >= frame.raf - this.startedAt - 500 && event.t <= frame.end - this.startedAt + 50).map(event => event.id).slice(-12),
      })),
      limits: { droppedEvents: this.droppedEvents, droppedStates: this.droppedStates, framesWithoutCohort: this.droppedCohorts, worstFramesRetained: 20 },
      notes: [
        'Frame intervals belong to the completed callback at interval start, including its camera, toggles and renderer statistics. The final incomplete interval is excluded.',
        'CPU spans are synchronous wall time and inclusive: nested spans must not be added together. Action response wall time is not CPU time.',
        'All switch, placement and compilation spikes are retained; no post-toggle settling frames are discarded. Menu and background frames have separate cohorts; gameplay excludes them.',
        'GPU timestamps sample full application-callback queue bookends every 8 frames; spans include GPU work and possible queue idle/submission gaps, not isolated shader execution. Unsampled frames have null GPU timing.',
        'Profiling adds timing calls, browser observers and sampled GPU marker submissions. Correlation identifies suspects; it does not by itself prove causation.',
        'Percentile upper bounds use 1 ms histogram bins; the overflow bin is >=2048 ms. Event and state truncation is explicit; the timeline coarsens to cover the whole recording.',
      ],
    };
  }
}
