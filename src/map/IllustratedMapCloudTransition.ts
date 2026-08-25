const CLOUD_TRANSITION_SEED = 0x5e10c10d;

export const ILLUSTRATED_MAP_CLOUD_TRANSITION = Object.freeze({
  seed: CLOUD_TRANSITION_SEED,
  durationMs: 1_650,
  reducedMotionDurationMs: 320,
  gatherEnd: 0.43,
  handoffHoldEnd: 0.54,
  standardPuffCount: 92,
  reducedMotionPuffCount: 44,
  maxDevicePixelRatio: 1.25,
});

export type IllustratedMapCloudTransitionDebugMode = 'final' | 'coverage' | 'banks';
export type IllustratedMapCloudTransitionPhase = 'gather' | 'handoff' | 'part' | 'complete';
export type IllustratedMapCloudTransitionQuality = 'standard' | 'reduced-motion';

export type IllustratedMapCloudTransitionFrame = {
  normalizedTime: number;
  coverage: number;
  partProgress: number;
  phase: IllustratedMapCloudTransitionPhase;
  shouldCommitMap: boolean;
};

export type IllustratedMapCloudPuff = {
  side: -1 | 1;
  closedX: number;
  y: number;
  radius: number;
  depth: number;
  shade: number;
  driftPhase: number;
};

type IllustratedMapCloudTransitionOptions = {
  debugMode?: IllustratedMapCloudTransitionDebugMode;
  quality?: IllustratedMapCloudTransitionQuality;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function rangeProgress(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

/**
 * One inspectable timeline owns the whole transition. The map renderer may
 * change only during the fully covered handoff interval.
 */
export function illustratedMapCloudFrameAt(
  normalizedTime: number,
): IllustratedMapCloudTransitionFrame {
  const t = clamp01(normalizedTime);
  const { gatherEnd, handoffHoldEnd } = ILLUSTRATED_MAP_CLOUD_TRANSITION;
  if (t < gatherEnd) {
    return {
      normalizedTime: t,
      coverage: smootherstep(t / gatherEnd),
      partProgress: 0,
      phase: 'gather',
      shouldCommitMap: false,
    };
  }
  if (t < handoffHoldEnd) {
    return {
      normalizedTime: t,
      coverage: 1,
      partProgress: 0,
      phase: 'handoff',
      shouldCommitMap: true,
    };
  }
  if (t < 1) {
    const partProgress = smootherstep(rangeProgress(t, handoffHoldEnd, 1));
    return {
      normalizedTime: t,
      coverage: 1 - partProgress,
      partProgress,
      phase: 'part',
      shouldCommitMap: true,
    };
  }
  return {
    normalizedTime: 1,
    coverage: 0,
    partProgress: 1,
    phase: 'complete',
    shouldCommitMap: true,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Stable cloud-bank layout used by runtime rendering and regression tests. */
export function buildIllustratedMapCloudPuffs(
  count: number,
  seed = CLOUD_TRANSITION_SEED,
): IllustratedMapCloudPuff[] {
  const random = mulberry32(seed);
  const puffs: IllustratedMapCloudPuff[] = [];
  const safeCount = Math.max(0, Math.floor(count));
  for (let index = 0; index < safeCount; index += 1) {
    const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const depth = random();
    const edgeInset = random();
    puffs.push({
      side,
      closedX: side < 0
        ? -0.08 + edgeInset * 0.72
        : 1.08 - edgeInset * 0.72,
      y: -0.12 + random() * 1.24,
      radius: 0.09 + random() * 0.12 + depth * 0.045,
      depth,
      shade: Math.min(3, Math.floor(random() * 4)),
      driftPhase: random() * Math.PI * 2,
    });
  }
  return puffs.sort((a, b) => a.depth - b.depth);
}

function resolveDebugMode(): IllustratedMapCloudTransitionDebugMode {
  if (typeof window === 'undefined') return 'final';
  const requested = new URLSearchParams(window.location.search).get('mapCloudDebug');
  return requested === 'coverage' || requested === 'banks' ? requested : 'final';
}

function resolveQuality(): IllustratedMapCloudTransitionQuality {
  if (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return 'reduced-motion';
  return 'standard';
}

function createCloudSprite(shade: number): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cloud transition canvas 2D context is unavailable.');

  const palettes = [
    ['rgba(252,253,247,0.98)', 'rgba(220,226,222,0.9)', 'rgba(132,145,148,0)'],
    ['rgba(244,248,243,0.96)', 'rgba(204,214,212,0.88)', 'rgba(112,128,134,0)'],
    ['rgba(238,243,240,0.94)', 'rgba(190,204,204,0.86)', 'rgba(100,118,126,0)'],
    ['rgba(250,248,235,0.95)', 'rgba(213,216,207,0.88)', 'rgba(120,133,136,0)'],
  ] as const;
  const palette = palettes[Math.min(palettes.length - 1, Math.max(0, shade))];
  const body = context.createRadialGradient(104, 88, 4, 128, 132, 124);
  body.addColorStop(0, palette[0]);
  body.addColorStop(0.42, palette[1]);
  body.addColorStop(1, palette[2]);
  context.fillStyle = body;
  context.fillRect(0, 0, size, size);

  const crown = context.createRadialGradient(92, 66, 0, 92, 66, 76);
  crown.addColorStop(0, 'rgba(255,255,250,0.72)');
  crown.addColorStop(0.48, 'rgba(248,250,244,0.24)');
  crown.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = crown;
  context.fillRect(0, 0, size, size);

  const underbelly = context.createRadialGradient(145, 176, 8, 142, 172, 82);
  underbelly.addColorStop(0, 'rgba(85,104,112,0.24)');
  underbelly.addColorStop(0.56, 'rgba(111,127,132,0.08)');
  underbelly.addColorStop(1, 'rgba(88,104,110,0)');
  context.fillStyle = underbelly;
  context.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * A short-lived canvas effect avoids allocating a second GPU renderer for a
 * transition that is visible for less than two seconds.
 */
export class IllustratedMapCloudTransition {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly sprites: readonly HTMLCanvasElement[];
  private readonly puffs: readonly IllustratedMapCloudPuff[];
  private readonly quality: IllustratedMapCloudTransitionQuality;
  private debugMode: IllustratedMapCloudTransitionDebugMode;
  private animationFrame = 0;
  private animationToken = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    options: IllustratedMapCloudTransitionOptions = {},
  ) {
    this.quality = options.quality ?? resolveQuality();
    this.debugMode = options.debugMode ?? resolveDebugMode();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'illustrated-map-cloud-transition';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.seed = String(ILLUSTRATED_MAP_CLOUD_TRANSITION.seed);
    this.canvas.dataset.quality = this.quality;
    this.canvas.dataset.debugMode = this.debugMode;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Illustrated map cloud transition requires Canvas 2D.');
    this.context = context;
    this.sprites = [0, 1, 2, 3].map(createCloudSprite);
    this.puffs = buildIllustratedMapCloudPuffs(
      this.quality === 'standard'
        ? ILLUSTRATED_MAP_CLOUD_TRANSITION.standardPuffCount
        : ILLUSTRATED_MAP_CLOUD_TRANSITION.reducedMotionPuffCount,
    );
    container.appendChild(this.canvas);
  }

  setDebugMode(mode: IllustratedMapCloudTransitionDebugMode): void {
    this.debugMode = mode;
    this.canvas.dataset.debugMode = mode;
  }

  playToMap(commitMapHandoff: () => void): () => void {
    if (this.disposed) {
      commitMapHandoff();
      return () => undefined;
    }
    this.cancel();
    const token = ++this.animationToken;
    const duration = this.quality === 'standard'
      ? ILLUSTRATED_MAP_CLOUD_TRANSITION.durationMs
      : ILLUSTRATED_MAP_CLOUD_TRANSITION.reducedMotionDurationMs;
    const startTime = performance.now();
    let handoffCommitted = false;
    this.canvas.hidden = false;
    this.canvas.dataset.phase = 'gather';

    const animate = (time: number): void => {
      if (this.disposed || token !== this.animationToken) return;
      const normalizedTime = clamp01((time - startTime) / duration);
      const frame = illustratedMapCloudFrameAt(normalizedTime);
      this.draw(frame);
      if (frame.shouldCommitMap && !handoffCommitted) {
        handoffCommitted = true;
        commitMapHandoff();
      }
      if (frame.phase === 'complete') {
        this.animationFrame = 0;
        this.canvas.hidden = true;
        delete this.canvas.dataset.phase;
        return;
      }
      this.animationFrame = requestAnimationFrame(animate);
    };

    this.animationFrame = requestAnimationFrame(animate);
    return () => {
      if (token === this.animationToken) this.cancel();
    };
  }

  cancel(): void {
    this.animationToken += 1;
    if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.canvas.hidden = true;
    delete this.canvas.dataset.phase;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.canvas.remove();
  }

  private draw(frame: IllustratedMapCloudTransitionFrame): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = Math.max(1, rect.height);
    const dpr = Math.min(
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      ILLUSTRATED_MAP_CLOUD_TRANSITION.maxDevicePixelRatio,
    );
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.context;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    this.canvas.dataset.phase = frame.phase;
    this.canvas.dataset.coverage = frame.coverage.toFixed(3);
    this.canvas.dataset.partProgress = frame.partProgress.toFixed(3);

    if (this.debugMode === 'coverage') {
      context.fillStyle = `rgba(235, 240, 238, ${frame.coverage.toFixed(3)})`;
      context.fillRect(0, 0, cssWidth, cssHeight);
      return;
    }

    const minimumDimension = Math.min(cssWidth, cssHeight);
    const bankOpening = frame.phase === 'gather'
      ? 1 - frame.coverage
      : frame.partProgress;
    const veilOpacity = smootherstep(rangeProgress(frame.coverage, 0.62, 1))
      * (1 - smootherstep(rangeProgress(frame.partProgress, 0.04, 0.58)));

    if (this.debugMode === 'final' && veilOpacity > 0) {
      const veil = context.createLinearGradient(0, 0, 0, cssHeight);
      veil.addColorStop(0, `rgba(225, 232, 231, ${(veilOpacity * 0.98).toFixed(3)})`);
      veil.addColorStop(0.54, `rgba(211, 220, 220, ${(veilOpacity * 0.995).toFixed(3)})`);
      veil.addColorStop(1, `rgba(178, 193, 198, ${(veilOpacity * 0.98).toFixed(3)})`);
      context.fillStyle = veil;
      context.fillRect(0, 0, cssWidth, cssHeight);
    }

    for (const puff of this.puffs) {
      const openingDistance = cssWidth * (0.76 + puff.depth * 0.18);
      const x = puff.closedX * cssWidth + puff.side * bankOpening * openingDistance;
      const y = puff.y * cssHeight
        + Math.sin(puff.driftPhase + frame.normalizedTime * Math.PI) * minimumDimension * 0.018;
      const radius = puff.radius * minimumDimension * (0.88 + puff.depth * 0.28);
      const alpha = this.debugMode === 'banks'
        ? 0.72
        : 0.66 + puff.depth * 0.28;
      context.globalAlpha = alpha;
      if (this.debugMode === 'banks') {
        context.fillStyle = puff.side < 0
          ? 'rgba(225, 172, 112, 0.8)'
          : 'rgba(118, 177, 221, 0.8)';
        context.beginPath();
        context.arc(x, y, radius * 0.7, 0, Math.PI * 2);
        context.fill();
      } else {
        context.drawImage(
          this.sprites[puff.shade],
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );
      }
    }
    context.globalAlpha = 1;

    if (this.debugMode === 'final') {
      const edgeShade = context.createLinearGradient(0, 0, cssWidth, 0);
      const edgeAlpha = (0.14 * Math.max(frame.coverage, 1 - bankOpening)).toFixed(3);
      edgeShade.addColorStop(0, `rgba(72, 91, 101, ${edgeAlpha})`);
      edgeShade.addColorStop(0.22, 'rgba(90, 106, 113, 0)');
      edgeShade.addColorStop(0.78, 'rgba(90, 106, 113, 0)');
      edgeShade.addColorStop(1, `rgba(72, 91, 101, ${edgeAlpha})`);
      context.fillStyle = edgeShade;
      context.fillRect(0, 0, cssWidth, cssHeight);
    }
  }
}
