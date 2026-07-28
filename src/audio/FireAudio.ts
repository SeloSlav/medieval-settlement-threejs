import type { FireIncidentState } from '../fires/fireIncident.ts';
import { FIRE_CRACKLE_CLIP } from './audioCatalog.ts';

export const FIRE_AUDIO_FULL_VOLUME_DISTANCE = 8;
export const FIRE_AUDIO_CUTOFF_DISTANCE = 72;
export const FIRE_AUDIO_MAX_ZOOM_DISTANCE = 96;

const FIRE_AUDIO_FADE_SPEED = 0.5;
const LOAD_RETRY_MS = 30_000;
const PLAY_RETRY_MS = 1000;

export type FireAudioConfig = {
  getListener: () => { x: number; z: number };
  getOrbitDistance: () => number;
  getFireIncidents: () => Iterable<FireIncidentState>;
};

export function fireAudioGain(
  distance: number,
  intensity: number,
  orbitDistance: number,
): number {
  if (
    orbitDistance > FIRE_AUDIO_MAX_ZOOM_DISTANCE
    || distance >= FIRE_AUDIO_CUTOFF_DISTANCE
  ) {
    return 0;
  }
  const distanceGain = distance <= FIRE_AUDIO_FULL_VOLUME_DISTANCE
    ? 1
    : 1 - (
        distance - FIRE_AUDIO_FULL_VOLUME_DISTANCE
      ) / (
        FIRE_AUDIO_CUTOFF_DISTANCE - FIRE_AUDIO_FULL_VOLUME_DISTANCE
      );
  return clamp01(distanceGain) * (0.45 + clamp01(intensity) * 0.55);
}

/**
 * One shared fire loop follows the nearest burning incident acoustically.
 * This avoids an audio element per building while preserving useful distance
 * and intensity feedback.
 */
export class FireAudio {
  private readonly config: FireAudioConfig;
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private currentVolume = 0;
  private targetVolume = 0;
  private loading = false;
  private enabled = true;
  private playPending = false;
  private lastLoadAttemptAtMs = Number.NEGATIVE_INFINITY;
  private lastPlayAttemptAtMs = Number.NEGATIVE_INFINITY;
  private loadGeneration = 0;

  constructor(config: FireAudioConfig) {
    this.config = config;
  }

  tick(dtSeconds: number): void {
    if (!this.enabled) return;
    const listener = this.config.getListener();
    let nearest: { distance: number; intensity: number } | null = null;
    for (const incident of this.config.getFireIncidents()) {
      if (incident.status !== 'burning') continue;
      const distance = Math.hypot(
        incident.x - listener.x,
        incident.z - listener.z,
      );
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, intensity: incident.intensity };
      }
    }

    const gain = nearest
      ? fireAudioGain(
          nearest.distance,
          nearest.intensity,
          this.config.getOrbitDistance(),
        )
      : 0;
    this.targetVolume = gain * (FIRE_CRACKLE_CLIP.volume ?? 1);
    const nowMs = performance.now();
    if (this.targetVolume > 0) this.ensureLoaded(nowMs);
    this.currentVolume = moveToward(
      this.currentVolume,
      this.targetVolume,
      Math.max(0, dtSeconds) * FIRE_AUDIO_FADE_SPEED,
    );

    const audio = this.audio;
    if (!audio) return;
    audio.volume = clamp01(this.currentVolume);
    if (this.targetVolume > 0 && audio.paused) {
      this.maybeStartPlayback(nowMs);
    } else if (this.currentVolume <= 0.0001 && this.targetVolume <= 0.0001) {
      audio.pause();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) return;
    this.targetVolume = 0;
    this.currentVolume = 0;
    if (this.audio) {
      this.audio.pause();
      this.audio.volume = 0;
    }
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.setEnabled(false);
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private ensureLoaded(nowMs: number): void {
    if (
      this.audio
      || this.loading
      || typeof Audio === 'undefined'
      || nowMs - this.lastLoadAttemptAtMs < LOAD_RETRY_MS
    ) {
      return;
    }
    this.loading = true;
    this.lastLoadAttemptAtMs = nowMs;
    const generation = ++this.loadGeneration;
    fetch(FIRE_CRACKLE_CLIP.path, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (generation !== this.loadGeneration || this.audio) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.loop = FIRE_CRACKLE_CLIP.loop ?? true;
        audio.volume = 0;
        this.blobUrl = url;
        this.audio = audio;
      })
      .catch(() => undefined)
      .finally(() => {
        if (generation === this.loadGeneration) this.loading = false;
      });
  }

  private maybeStartPlayback(nowMs: number): void {
    if (!this.audio || this.playPending) return;
    if (nowMs - this.lastPlayAttemptAtMs < PLAY_RETRY_MS) return;
    this.lastPlayAttemptAtMs = nowMs;
    this.playPending = true;
    void this.audio.play().catch(() => undefined).finally(() => {
      this.playPending = false;
    });
  }
}

function moveToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) return target;
  return current < target ? current + step : current - step;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
