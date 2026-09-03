import { AMBIENT_SCORE_DUCK_GAIN } from './AmbientAudio.ts';

/** User-provided forest wind recording used by the canopy-reactive wind bed. */
export const FOREST_WIND_URL = '/sounds/ambient/forest_wind.mp3';

/** Keep the established wind mix beneath the broader environmental ambience. */
export const FOREST_WIND_CLIP_VOLUME = 0.04;
export const FOREST_WIND_FADE_IN_SECONDS = 2.8;
export const FOREST_WIND_FADE_OUT_SECONDS = 4.2;

const GAIN_FADE_SECONDS = 0.8;
const SCORE_DUCK_ATTACK_SECONDS = 2.5;
const SCORE_DUCK_RELEASE_SECONDS = 4;
const PLAY_RETRY_MS = 1000;

export class ForestWindAudio {
  private audio: HTMLAudioElement | null = null;
  private enabled = true;
  private paused = false;
  private currentMix = 0;
  private targetMix = 0;
  private currentGain = 1;
  private targetGain = 1;
  private currentScoreDuckGain = 1;
  private targetScoreDuckGain = 1;
  private playPending = false;
  private lastPlayAttemptAtMs = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  setVolume(volume: number): void {
    this.targetGain = clamp01(volume);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.audio?.pause();
      return;
    }
    if (this.enabled && this.targetMix > 0) this.ensureAudio();
  }

  setScoreActive(active: boolean): void {
    this.targetScoreDuckGain = active ? AMBIENT_SCORE_DUCK_GAIN : 1;
  }

  setTargetMix(mix: number): void {
    this.targetMix = this.enabled ? clamp01(mix) : 0;
    if (this.targetMix > 0 && !this.paused) this.ensureAudio();
  }

  tick(dtSeconds: number): void {
    if (!this.enabled || this.paused) return;
    const dt = Math.max(0, dtSeconds);
    const mixFadeSeconds = this.targetMix > this.currentMix
      ? FOREST_WIND_FADE_IN_SECONDS
      : FOREST_WIND_FADE_OUT_SECONDS;
    this.currentMix = moveToward(this.currentMix, this.targetMix, dt / mixFadeSeconds);
    this.currentGain = moveToward(this.currentGain, this.targetGain, dt / GAIN_FADE_SECONDS);

    const duckSeconds = this.targetScoreDuckGain < this.currentScoreDuckGain
      ? SCORE_DUCK_ATTACK_SECONDS
      : SCORE_DUCK_RELEASE_SECONDS;
    this.currentScoreDuckGain = moveToward(
      this.currentScoreDuckGain,
      this.targetScoreDuckGain,
      dt * (1 - AMBIENT_SCORE_DUCK_GAIN) / duckSeconds,
    );

    const audio = this.audio;
    if (!audio) return;
    audio.volume = clamp01(
      FOREST_WIND_CLIP_VOLUME
      * this.currentMix
      * this.currentGain
      * this.currentScoreDuckGain,
    );

    if (this.targetMix > 0 && this.targetGain > 0 && audio.paused) {
      this.maybeStartPlayback(performance.now());
    }
    if (this.currentMix <= 0.0001 && this.targetMix <= 0.0001) {
      audio.pause();
      audio.currentTime = 0;
      this.currentMix = 0;
      this.playPending = false;
    }
  }

  dispose(): void {
    this.stop();
    this.audio = null;
  }

  private ensureAudio(): void {
    if (this.audio) return;
    const audio = new Audio(FOREST_WIND_URL);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.addEventListener('error', () => {
      if (this.audio !== audio) return;
      this.audio = null;
      this.currentMix = 0;
      this.targetMix = 0;
      this.playPending = false;
    });
    this.audio = audio;
  }

  private maybeStartPlayback(nowMs: number): void {
    if (!this.audio || this.playPending) return;
    if (nowMs - this.lastPlayAttemptAtMs < PLAY_RETRY_MS) return;
    this.playPending = true;
    this.lastPlayAttemptAtMs = nowMs;
    this.audio.play().catch(() => undefined).finally(() => {
      this.playPending = false;
      if (this.paused) this.audio?.pause();
    });
  }

  private stop(): void {
    this.targetMix = 0;
    this.currentMix = 0;
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.volume = 0;
    this.playPending = false;
    this.lastPlayAttemptAtMs = 0;
  }
}

function moveToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) return target;
  return current < target ? current + step : current - step;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
