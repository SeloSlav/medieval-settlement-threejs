import { CHURCH_BELL_CLIP } from './audioCatalog.ts';
import { CHAPEL_BELL_UNPRIMED_HOUR, isChapelBellHour } from './chapelBellSchedule.ts';

export const CHAPEL_BELL_FULL_VOLUME_DISTANCE = 24;
export const CHAPEL_BELL_CUTOFF_DISTANCE = 260;
export const CHAPEL_BELL_FULL_VOLUME_ORBIT_DISTANCE = 38;
export const CHAPEL_BELL_CUTOFF_ORBIT_DISTANCE = 104;
export const CHAPEL_BELL_MAX_RING_GAME_MINUTES = 20;

const CHAPEL_BELL_END_FADE_SECONDS = 4.5;
const CHAPEL_BELL_FADE_IN_PER_SECOND = 0.36;
const CHAPEL_BELL_FADE_OUT_PER_SECOND = 0.14;

export type ChapelBellPosition = {
  x: number;
  z: number;
};

export type ChapelBellTick = {
  dtSeconds: number;
  clockHour: number;
  calendarMinute: number;
  chapels: readonly ChapelBellPosition[];
  listener: ChapelBellPosition;
  orbitDistance: number;
  enabled: boolean;
};

async function loadAudioAsBlobUrl(path: string): Promise<string> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * A real bell carries well across the settlement, but zooming into an overview
 * should still make it part of the distant soundscape instead of a foreground
 * recording.
 */
export function chapelBellGain(
  chapels: readonly ChapelBellPosition[],
  listener: ChapelBellPosition,
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

export function chapelBellRingShouldContinue(
  startedAtCalendarMinute: number,
  calendarMinute: number,
): boolean {
  const elapsed = calendarMinute - startedAtCalendarMinute;
  return elapsed >= 0 && elapsed <= CHAPEL_BELL_MAX_RING_GAME_MINUTES;
}

export class ChapelBellPlayer {
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private lastObservedAbsoluteHour = CHAPEL_BELL_UNPRIMED_HOUR;
  private activeRingStartedAtMinute: number | null = null;
  private currentVolume = 0;
  private loadGeneration = 0;
  private volume = 1;

  tick(params: ChapelBellTick): void {
    if (!params.enabled) return;

    const absoluteHour = Math.floor(params.calendarMinute / 60);
    if (this.lastObservedAbsoluteHour === CHAPEL_BELL_UNPRIMED_HOUR) {
      this.lastObservedAbsoluteHour = absoluteHour;
    } else if (absoluteHour !== this.lastObservedAbsoluteHour) {
      this.lastObservedAbsoluteHour = absoluteHour;
      if (
        params.chapels.length > 0
        && isChapelBellHour(params.clockHour)
      ) {
        this.play(params.calendarMinute);
      }
    }

    const ringActive = this.activeRingStartedAtMinute !== null
      && chapelBellRingShouldContinue(
        this.activeRingStartedAtMinute,
        params.calendarMinute,
      );
    const spatialGain = ringActive
      ? chapelBellGain(params.chapels, params.listener, params.orbitDistance)
      : 0;
    this.updateVolume(params.dtSeconds, spatialGain);
  }

  stop(): void {
    this.loadGeneration += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.lastObservedAbsoluteHour = CHAPEL_BELL_UNPRIMED_HOUR;
    this.activeRingStartedAtMinute = null;
    this.currentVolume = 0;
  }

  dispose(): void {
    this.stop();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  private play(calendarMinute: number): void {
    this.activeRingStartedAtMinute = calendarMinute;
    this.currentVolume = 0;
    if (this.audio) {
      this.audio.currentTime = 0;
      this.audio.volume = 0;
      this.audio.loop = false;
      void this.audio.play().catch(() => undefined);
      return;
    }

    const generation = ++this.loadGeneration;
    void loadAudioAsBlobUrl(CHURCH_BELL_CLIP.path)
      .then((url) => {
        if (
          generation !== this.loadGeneration
          || this.activeRingStartedAtMinute === null
        ) {
          URL.revokeObjectURL(url);
          return;
        }
        if (this.audio) {
          URL.revokeObjectURL(url);
          return;
        }
        this.blobUrl = url;
        this.installAudio(new Audio(url));
      })
      .catch(() => {
        if (
          generation !== this.loadGeneration
          || this.audio
          || this.activeRingStartedAtMinute === null
        ) return;
        this.installAudio(new Audio(CHURCH_BELL_CLIP.path));
      });
  }

  private installAudio(audio: HTMLAudioElement): void {
    audio.volume = 0;
    audio.loop = false;
    audio.addEventListener('ended', () => {
      if (this.audio !== audio) return;
      this.activeRingStartedAtMinute = null;
      this.currentVolume = 0;
    });
    audio.addEventListener('error', () => {
      if (this.audio !== audio) return;
      this.releaseAudio();
    });
    this.audio = audio;
    void audio.play().catch(() => undefined);
  }

  private updateVolume(dtSeconds: number, spatialGain: number): void {
    const audio = this.audio;
    if (!audio) return;

    let endGain = 1;
    if (
      Number.isFinite(audio.duration)
      && audio.duration > 0
      && Number.isFinite(audio.currentTime)
    ) {
      const remaining = audio.duration - audio.currentTime;
      endGain = smoothstep(0, CHAPEL_BELL_END_FADE_SECONDS, remaining);
    }
    const targetVolume = Math.max(
      0,
      Math.min(
        1,
        (CHURCH_BELL_CLIP.volume ?? 1) * spatialGain * endGain * this.volume,
      ),
    );
    const rate = targetVolume >= this.currentVolume
      ? CHAPEL_BELL_FADE_IN_PER_SECOND
      : CHAPEL_BELL_FADE_OUT_PER_SECOND;
    this.currentVolume = approach(
      this.currentVolume,
      targetVolume,
      Math.max(0, dtSeconds) * rate,
    );
    audio.volume = this.currentVolume;

    if (
      targetVolume <= 0.0001
      && this.currentVolume <= 0.0001
      && this.activeRingStartedAtMinute !== null
    ) {
      this.activeRingStartedAtMinute = null;
      audio.pause();
      audio.currentTime = 0;
    }
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.activeRingStartedAtMinute = null;
    this.currentVolume = 0;
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function inverseSmoothstep(edge0: number, edge1: number, value: number): number {
  return 1 - smoothstep(edge0, edge1, value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
