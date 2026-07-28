import type { Season } from '../world/seasonPolicy.ts';
import {
  MUSIC_TRACKS,
  type MusicTrackId,
} from './audioCatalog.ts';
import { setSoundtrackActive } from './audioPlaybackState.ts';

export type SoundtrackContext = {
  isNight: boolean;
  season: Season;
  villageActive: boolean;
};

const INITIAL_SILENCE_MIN_MS = 30_000;
const INITIAL_SILENCE_MAX_MS = 60_000;
const BETWEEN_TRACKS_MIN_MS = 90_000;
const BETWEEN_TRACKS_MAX_MS = 180_000;
const MISSING_TRACK_RETRY_MS = 60_000;
const FADE_IN_SECONDS = 5;
const FADE_OUT_SECONDS = 7;

async function loadAudioAsBlobUrl(path: string): Promise<string> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

/**
 * Plays sparse, contextual non-looping cues. Music is deliberately separated
 * by quiet windows so ambience and close worker details remain intelligible.
 */
export class SoundtrackAudio {
  private context: SoundtrackContext = {
    isNight: false,
    season: 'summer',
    villageActive: false,
  };
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private activeTrack: MusicTrackId | null = null;
  private lastTrack: MusicTrackId | null = null;
  private currentVolume = 0;
  private loading = false;
  private enabled = true;
  private started = false;
  private nextTrackAtMs = Number.POSITIVE_INFINITY;

  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.nextTrackAtMs = performance.now() + randomBetween(
      INITIAL_SILENCE_MIN_MS,
      INITIAL_SILENCE_MAX_MS,
    );
  }

  syncContext(context: SoundtrackContext): void {
    this.context = context;
  }

  tick(dtSeconds: number): void {
    if (!this.enabled || !this.started) return;
    const nowMs = performance.now();
    if (!this.audio) {
      if (!this.loading && nowMs >= this.nextTrackAtMs) {
        void this.loadAndPlay(this.pickTrack());
      }
      return;
    }

    const clip = this.activeTrack ? MUSIC_TRACKS[this.activeTrack] : null;
    const baseVolume = clip?.volume ?? 0;
    const remaining = Number.isFinite(this.audio.duration)
      ? this.audio.duration - this.audio.currentTime
      : Number.POSITIVE_INFINITY;
    const targetVolume = remaining <= FADE_OUT_SECONDS
      ? baseVolume * Math.max(0, remaining / FADE_OUT_SECONDS)
      : baseVolume;
    const fadeSeconds = targetVolume > this.currentVolume
      ? FADE_IN_SECONDS
      : FADE_OUT_SECONDS;
    const step = Math.max(0, dtSeconds) * baseVolume / fadeSeconds;
    this.currentVolume = moveToward(this.currentVolume, targetVolume, step);
    this.audio.volume = clamp01(this.currentVolume);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopCurrent();
      this.started = false;
      this.nextTrackAtMs = Number.POSITIVE_INFINITY;
    } else {
      this.start();
    }
  }

  isPlaying(): boolean {
    return Boolean(this.audio && !this.audio.paused);
  }

  dispose(): void {
    this.enabled = false;
    this.started = false;
    this.loading = false;
    this.stopCurrent();
  }

  private pickTrack(): MusicTrackId {
    const preferred: MusicTrackId = this.context.season === 'winter'
      ? 'winter_hearth'
      : this.context.isNight
        ? 'vespers_over_the_valley'
        : this.context.villageActive
          ? 'roads_and_rooftops'
          : 'valley_at_first_light';
    if (preferred !== this.lastTrack) return preferred;

    const alternatives = (
      Object.keys(MUSIC_TRACKS) as MusicTrackId[]
    ).filter((track) => track !== this.lastTrack);
    return alternatives[Math.floor(Math.random() * alternatives.length)]
      ?? preferred;
  }

  private async loadAndPlay(track: MusicTrackId): Promise<void> {
    this.loading = true;
    try {
      const url = await loadAudioAsBlobUrl(MUSIC_TRACKS[track].path);
      if (!this.enabled || !this.started) {
        URL.revokeObjectURL(url);
        return;
      }
      this.stopCurrent();
      const audio = new Audio(url);
      this.audio = audio;
      this.blobUrl = url;
      this.activeTrack = track;
      this.currentVolume = 0;
      audio.volume = 0;
      audio.loop = false;
      audio.addEventListener('ended', this.onTrackEnded, { once: true });
      audio.addEventListener('error', this.onTrackError, { once: true });
      await audio.play();
      this.lastTrack = track;
      setSoundtrackActive(true);
    } catch {
      this.stopCurrent();
      this.nextTrackAtMs = performance.now() + MISSING_TRACK_RETRY_MS;
    } finally {
      this.loading = false;
    }
  }

  private readonly onTrackEnded = (): void => {
    this.stopCurrent();
    this.nextTrackAtMs = performance.now() + randomBetween(
      BETWEEN_TRACKS_MIN_MS,
      BETWEEN_TRACKS_MAX_MS,
    );
  };

  private readonly onTrackError = (): void => {
    this.stopCurrent();
    this.nextTrackAtMs = performance.now() + MISSING_TRACK_RETRY_MS;
  };

  private stopCurrent(): void {
    if (this.audio) {
      this.audio.removeEventListener('ended', this.onTrackEnded);
      this.audio.removeEventListener('error', this.onTrackError);
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.activeTrack = null;
    this.currentVolume = 0;
    setSoundtrackActive(false);
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function moveToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) return target;
  return current < target ? current + step : current - step;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
