import {
  CHAPEL_BELL_CLIPS,
  type AudioClipDefinition,
  type ChapelBellTier,
} from './audioCatalog.ts';
import { CHAPEL_BELL_UNPRIMED_HOUR, isChapelBellHour } from './chapelBellSchedule.ts';

export const CHAPEL_BELL_FULL_VOLUME_DISTANCE = 24;
export const CHAPEL_BELL_CUTOFF_DISTANCE = 260;
export const CHAPEL_BELL_FULL_VOLUME_ORBIT_DISTANCE = 38;
export const CHAPEL_BELL_CUTOFF_ORBIT_DISTANCE = 104;

export const ANGELUS_STROKE_GROUPS = [3, 3, 3, 9] as const;
export const ANGELUS_STROKE_INTERVAL_SECONDS = 2.7;
export const ANGELUS_GROUP_PAUSE_SECONDS = 6;
export const ANGELUS_STROKE_TIMES_SECONDS = buildAngelusStrokeTimes();

const CHAPEL_BELL_POOL_SIZE = 4;
const CHAPEL_BELL_END_FADE_SECONDS = 0.5;
const CHAPEL_BELL_MAX_FRAME_STEP_SECONDS = 0.25;

export type ChapelBellPosition = {
  x: number;
  z: number;
  tier: ChapelBellTier;
};

export type ChapelBellTick = {
  dtSeconds: number;
  clockHour: number;
  calendarMinute: number;
  chapels: readonly ChapelBellPosition[];
  listener: Pick<ChapelBellPosition, 'x' | 'z'>;
  orbitDistance: number;
  enabled: boolean;
};

type BellPoolEntry = {
  audio: HTMLAudioElement;
  clipGain: number;
};

/**
 * A real bell carries well across the settlement, but zooming into an overview
 * should still make it part of the distant soundscape instead of a foreground
 * recording.
 */
export function chapelBellGain(
  chapels: readonly Pick<ChapelBellPosition, 'x' | 'z'>[],
  listener: Pick<ChapelBellPosition, 'x' | 'z'>,
  orbitDistance: number,
): number {
  if (chapels.length === 0) return 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const chapel of chapels) {
    nearestDistance = Math.min(
      nearestDistance,
      Math.hypot(chapel.x - listener.x, chapel.z - listener.z),
    );
  }
  const distanceGain = inverseSmoothstep(
    CHAPEL_BELL_FULL_VOLUME_DISTANCE,
    CHAPEL_BELL_CUTOFF_DISTANCE,
    nearestDistance,
  );
  const zoomGain = inverseSmoothstep(
    CHAPEL_BELL_FULL_VOLUME_ORBIT_DISTANCE,
    CHAPEL_BELL_CUTOFF_ORBIT_DISTANCE,
    orbitDistance,
  );
  return distanceGain * zoomGain;
}

/**
 * Plays the Angelus as exact, individually triggered bell strokes:
 * 3, pause, 3, pause, 3, pause, 9. Reusing a single-toll recording preserves
 * the bell's natural decay without asking a generator to guess the rhythm.
 */
export class ChapelBellPlayer {
  private readonly pool: BellPoolEntry[] = [];
  private lastObservedAbsoluteHour = CHAPEL_BELL_UNPRIMED_HOUR;
  private patternElapsedSeconds = 0;
  private nextStrokeIndex = ANGELUS_STROKE_TIMES_SECONDS.length;
  private activeTier: ChapelBellTier = 1;
  private lastSpatialGain = 0;
  private volume = 1;

  tick(params: ChapelBellTick): void {
    if (!params.enabled) return;

    const absoluteHour = Math.floor(params.calendarMinute / 60);
    if (this.lastObservedAbsoluteHour === CHAPEL_BELL_UNPRIMED_HOUR) {
      this.lastObservedAbsoluteHour = absoluteHour;
    } else if (absoluteHour !== this.lastObservedAbsoluteHour) {
      this.lastObservedAbsoluteHour = absoluteHour;
      if (params.chapels.length > 0 && isChapelBellHour(params.clockHour)) {
        this.beginAngelus(nearestChapel(params.chapels, params.listener)?.tier ?? 1);
      }
    }

    this.lastSpatialGain = chapelBellGain(
      params.chapels,
      params.listener,
      params.orbitDistance,
    );
    if (this.nextStrokeIndex < ANGELUS_STROKE_TIMES_SECONDS.length) {
      this.patternElapsedSeconds += Math.min(
        CHAPEL_BELL_MAX_FRAME_STEP_SECONDS,
        Math.max(0, params.dtSeconds),
      );
      const nextStrokeAt = ANGELUS_STROKE_TIMES_SECONDS[this.nextStrokeIndex];
      if (nextStrokeAt != null && this.patternElapsedSeconds >= nextStrokeAt) {
        this.playStroke(CHAPEL_BELL_CLIPS[this.activeTier]);
        this.nextStrokeIndex += 1;
      }
    }
    this.updatePlayingVolumes();
  }

  stop(): void {
    for (const entry of this.pool) {
      entry.audio.pause();
      entry.audio.currentTime = 0;
    }
    this.lastObservedAbsoluteHour = CHAPEL_BELL_UNPRIMED_HOUR;
    this.patternElapsedSeconds = 0;
    this.nextStrokeIndex = ANGELUS_STROKE_TIMES_SECONDS.length;
    this.lastSpatialGain = 0;
  }

  dispose(): void {
    this.stop();
    for (const entry of this.pool) entry.audio.removeAttribute('src');
    this.pool.length = 0;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.updatePlayingVolumes();
  }

  private beginAngelus(tier: ChapelBellTier): void {
    this.activeTier = tier;
    this.patternElapsedSeconds = 0;
    this.nextStrokeIndex = 0;
  }

  private playStroke(clip: AudioClipDefinition): void {
    if (typeof Audio === 'undefined') return;
    while (this.pool.length < CHAPEL_BELL_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push({ audio, clipGain: 0 });
    }
    const entry = this.pool.find(({ audio }) => audio.paused) ?? this.pool[0];
    if (!entry) return;
    entry.audio.pause();
    entry.audio.currentTime = 0;
    entry.audio.src = clip.path;
    entry.audio.loop = false;
    entry.audio.playbackRate = 1;
    entry.clipGain = Math.max(0, clip.volume ?? 1);
    entry.audio.volume = Math.min(
      1,
      entry.clipGain * this.lastSpatialGain * this.volume,
    );
    void entry.audio.play().catch(() => undefined);
  }

  private updatePlayingVolumes(): void {
    for (const entry of this.pool) {
      const { audio } = entry;
      if (audio.paused) continue;
      const remaining = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - audio.currentTime)
        : CHAPEL_BELL_END_FADE_SECONDS;
      const endGain = smoothstep(0, CHAPEL_BELL_END_FADE_SECONDS, remaining);
      audio.volume = Math.min(
        1,
        entry.clipGain * this.lastSpatialGain * this.volume * endGain,
      );
    }
  }
}

function buildAngelusStrokeTimes(): readonly number[] {
  const times: number[] = [];
  let groupStart = 0;
  for (const strokeCount of ANGELUS_STROKE_GROUPS) {
    for (let stroke = 0; stroke < strokeCount; stroke += 1) {
      times.push(groupStart + stroke * ANGELUS_STROKE_INTERVAL_SECONDS);
    }
    groupStart = (times.at(-1) ?? groupStart) + ANGELUS_GROUP_PAUSE_SECONDS;
  }
  return Object.freeze(times);
}

function nearestChapel(
  chapels: readonly ChapelBellPosition[],
  listener: Pick<ChapelBellPosition, 'x' | 'z'>,
): ChapelBellPosition | null {
  let nearest: ChapelBellPosition | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const chapel of chapels) {
    const distance = Math.hypot(chapel.x - listener.x, chapel.z - listener.z);
    if (distance >= nearestDistance) continue;
    nearest = chapel;
    nearestDistance = distance;
  }
  return nearest;
}

function inverseSmoothstep(edge0: number, edge1: number, value: number): number {
  return 1 - smoothstep(edge0, edge1, value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
