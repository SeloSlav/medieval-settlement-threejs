import type { CrowdViewState } from '../settlement/crowdView.ts';
import { FARM_WORKERS_SINGING_CLIP } from './audioCatalog.ts';
import { isGameAudioEnabled } from './audioPreferences.ts';
import { isSoundtrackActive } from './audioPlaybackState.ts';

const FARM_SONG_MAX_ZOOM_DISTANCE = 32;
const FARM_SONG_FULL_VOLUME_DISTANCE = 10;
const FARM_SONG_CUTOFF_DISTANCE = 24;
const FARM_SONG_FADE_IN_SPEED = 0.08;
const FARM_SONG_FADE_OUT_SPEED = 0.04;
const PLAY_RETRY_MS = 1000;

export type FarmSongSource = {
  id: string;
  x: number;
  z: number;
};

async function loadAudioAsBlobUrl(path: string): Promise<string> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

/** One shared farm song follows the nearest audible, actively tended field. */
export class FarmWorkerSongAudio {
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private currentVolume = 0;
  private targetVolume = 0;
  private loading = false;
  private playPending = false;
  private paused = false;
  private lastPlayAttemptAtMs = 0;
  private loadGeneration = 0;

  tick(
    dtSeconds: number,
    sources: readonly FarmSongSource[],
    view: CrowdViewState | undefined,
  ): void {
    if (this.paused) return;
    this.targetVolume = (
      isGameAudioEnabled() && !isSoundtrackActive()
        ? this.audibleGain(sources, view)
        : 0
    )
      * (FARM_WORKERS_SINGING_CLIP.volume ?? 1);
    if (this.targetVolume > 0) this.ensureLoaded();

    const speed = this.targetVolume > this.currentVolume
      ? FARM_SONG_FADE_IN_SPEED
      : FARM_SONG_FADE_OUT_SPEED;
    this.currentVolume = moveToward(
      this.currentVolume,
      this.targetVolume,
      Math.max(0, dtSeconds) * speed,
    );

    const audio = this.audio;
    if (!audio) return;
    audio.volume = clamp01(this.currentVolume);
    if (this.targetVolume > 0 && audio.paused) {
      this.maybeStartPlayback(performance.now());
    } else if (this.currentVolume <= 0.0001 && this.targetVolume <= 0.0001) {
      audio.pause();
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.audio?.pause();
  }

  dispose(): void {
    this.loadGeneration += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.loading = false;
    this.playPending = false;
  }

  private audibleGain(
    sources: readonly FarmSongSource[],
    view: CrowdViewState | undefined,
  ): number {
    if (
      !view
      || view.orbitDistance == null
      || view.orbitDistance > FARM_SONG_MAX_ZOOM_DISTANCE
    ) {
      return 0;
    }
    const listenerX = view.listenerX ?? view.centerX;
    const listenerZ = view.listenerZ ?? view.centerZ;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const source of sources) {
      nearestDistance = Math.min(
        nearestDistance,
        Math.hypot(source.x - listenerX, source.z - listenerZ),
      );
    }
    if (nearestDistance <= FARM_SONG_FULL_VOLUME_DISTANCE) return 1;
    if (nearestDistance >= FARM_SONG_CUTOFF_DISTANCE) return 0;
    return 1 - (
      nearestDistance - FARM_SONG_FULL_VOLUME_DISTANCE
    ) / (
      FARM_SONG_CUTOFF_DISTANCE - FARM_SONG_FULL_VOLUME_DISTANCE
    );
  }

  private ensureLoaded(): void {
    if (this.audio || this.loading || typeof Audio === 'undefined') return;
    this.loading = true;
    const generation = ++this.loadGeneration;
    loadAudioAsBlobUrl(FARM_WORKERS_SINGING_CLIP.path)
      .then((url) => {
        if (generation !== this.loadGeneration || this.audio) {
          URL.revokeObjectURL(url);
          return;
        }
        const audio = new Audio(url);
        audio.loop = FARM_WORKERS_SINGING_CLIP.loop ?? true;
        audio.defaultPlaybackRate = 1;
        audio.playbackRate = 1;
        audio.preservesPitch = true;
        audio.volume = 0;
        this.audio = audio;
        this.blobUrl = url;
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
      if (this.paused) this.audio?.pause();
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
