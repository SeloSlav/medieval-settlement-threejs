import { AMBIENT_LAYERS, type AmbientLayerId, type AudioClipDefinition } from './audioCatalog.ts';

type AmbientTrackState = {
  audio: HTMLAudioElement | null;
  blobUrl: string | null;
  currentMix: number;
  targetMix: number;
  mixVolume: number;
  playPending: boolean;
  lastPlayAttemptAtMs: number;
};

type AmbientMix = {
  baseLayer: AmbientLayerId | null;
  baseVolume?: number;
  overlayLayer?: AmbientLayerId | null;
  overlayVolume?: number;
  detailLayer?: AmbientLayerId | null;
  detailVolume?: number;
  weatherLayer?: AmbientLayerId | null;
  weatherVolume?: number;
};

export const AMBIENT_LAYER_FADES: Record<
  AmbientLayerId,
  { inSeconds: number; outSeconds: number }
> = {
  birds_wind_day: { inSeconds: 4.5, outSeconds: 5.5 },
  founders_camp_day: { inSeconds: 3.5, outSeconds: 4.5 },
  village_day: { inSeconds: 3.5, outSeconds: 4.5 },
  town_interior_day: { inSeconds: 4, outSeconds: 5 },
  night_insects: { inSeconds: 5, outSeconds: 6 },
  open_wind_overview: { inSeconds: 5.5, outSeconds: 6.5 },
  light_rain: { inSeconds: 5, outSeconds: 6 },
};
export const AMBIENT_SCORE_DUCK_GAIN = 0.86;
const AMBIENT_GAIN_FADE_SECONDS = 0.8;
const SCORE_DUCK_ATTACK_SECONDS = 2.5;
const SCORE_DUCK_RELEASE_SECONDS = 4;
const AMBIENT_PLAY_RETRY_MS = 1000;
const AMBIENT_LAYER_IDS = Object.keys(AMBIENT_LAYERS) as AmbientLayerId[];

async function loadAudioAsBlobUrl(path: string): Promise<string> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export class AmbientAudio {
  private enabled = true;
  private paused = false;
  private currentAmbientGain = 1;
  private targetAmbientGain = 1;
  private currentScoreDuckGain = 1;
  private targetScoreDuckGain = 1;
  private readonly ambientTracks: Record<AmbientLayerId, AmbientTrackState> = {
    birds_wind_day: createAmbientTrackState(),
    founders_camp_day: createAmbientTrackState(),
    village_day: createAmbientTrackState(),
    town_interior_day: createAmbientTrackState(),
    night_insects: createAmbientTrackState(),
    open_wind_overview: createAmbientTrackState(),
    light_rain: createAmbientTrackState(),
  };

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      for (const id of AMBIENT_LAYER_IDS) {
        this.ambientTracks[id].audio?.pause();
      }
      return;
    }
    for (const id of AMBIENT_LAYER_IDS) {
      if (this.ambientTracks[id].targetMix > 0) this.ensureAmbientTrackLoaded(id);
    }
  }

  setVolume(volume: number): void {
    this.targetAmbientGain = clamp01(volume);
  }

  setScoreActive(active: boolean): void {
    this.targetScoreDuckGain = active ? AMBIENT_SCORE_DUCK_GAIN : 1;
  }

  setAmbientMix(mix: AmbientMix): void {
    if (!this.enabled) return;
    for (const id of AMBIENT_LAYER_IDS) {
      this.ambientTracks[id].targetMix = 0;
    }
    if (mix.baseLayer) {
      const clip = AMBIENT_LAYERS[mix.baseLayer];
      this.ambientTracks[mix.baseLayer].targetMix = 1;
      this.ambientTracks[mix.baseLayer].mixVolume = Math.max(
        0,
        mix.baseVolume ?? clip.volume ?? 1,
      );
      this.ensureAmbientTrackLoaded(mix.baseLayer);
    }
    if (mix.overlayLayer) {
      const clip = AMBIENT_LAYERS[mix.overlayLayer];
      this.ambientTracks[mix.overlayLayer].targetMix = 1;
      this.ambientTracks[mix.overlayLayer].mixVolume = Math.max(
        0,
        mix.overlayVolume ?? clip.volume ?? 1,
      );
      this.ensureAmbientTrackLoaded(mix.overlayLayer);
    }
    if (mix.detailLayer) {
      const clip = AMBIENT_LAYERS[mix.detailLayer];
      this.ambientTracks[mix.detailLayer].targetMix = 1;
      this.ambientTracks[mix.detailLayer].mixVolume = Math.max(
        0,
        mix.detailVolume ?? clip.volume ?? 1,
      );
      this.ensureAmbientTrackLoaded(mix.detailLayer);
    }
    if (mix.weatherLayer) {
      const clip = AMBIENT_LAYERS[mix.weatherLayer];
      this.ambientTracks[mix.weatherLayer].targetMix = 1;
      this.ambientTracks[mix.weatherLayer].mixVolume = Math.max(
        0,
        mix.weatherVolume ?? clip.volume ?? 1,
      );
      this.ensureAmbientTrackLoaded(mix.weatherLayer);
    }
  }

  tick(dtSeconds: number): void {
    if (!this.enabled || this.paused) return;
    const dt = Math.max(0, dtSeconds);
    this.currentAmbientGain = moveToward(
      this.currentAmbientGain,
      this.targetAmbientGain,
      dt / AMBIENT_GAIN_FADE_SECONDS,
    );
    const duckSeconds = this.targetScoreDuckGain < this.currentScoreDuckGain
      ? SCORE_DUCK_ATTACK_SECONDS
      : SCORE_DUCK_RELEASE_SECONDS;
    this.currentScoreDuckGain = moveToward(
      this.currentScoreDuckGain,
      this.targetScoreDuckGain,
      dt * (1 - AMBIENT_SCORE_DUCK_GAIN) / duckSeconds,
    );

    const nowMs = performance.now();
    for (const id of AMBIENT_LAYER_IDS) {
      const state = this.ambientTracks[id];
      const audio = state.audio;
      if (!audio) continue;

      const fade = AMBIENT_LAYER_FADES[id];
      const fadeSeconds = state.targetMix > state.currentMix
        ? fade.inSeconds
        : fade.outSeconds;
      state.currentMix = moveToward(
        state.currentMix,
        state.targetMix,
        dt / fadeSeconds,
      );
      audio.volume = clamp01(
        state.mixVolume
        * state.currentMix
        * this.currentAmbientGain
        * this.currentScoreDuckGain,
      );
      if (
        state.targetMix > 0
        && this.targetAmbientGain > 0
        && audio.paused
      ) {
        this.maybeStartAmbientPlayback(state, nowMs);
      }
      if (state.currentMix <= 0.0001 && state.targetMix <= 0.0001) {
        audio.pause();
        audio.currentTime = 0;
        state.currentMix = 0;
        state.playPending = false;
      }
    }
  }

  stop(): void {
    this.setAmbientMix({
      baseLayer: null,
      overlayLayer: null,
      detailLayer: null,
      weatherLayer: null,
      baseVolume: 0,
      overlayVolume: 0,
      detailVolume: 0,
      weatherVolume: 0,
    });
    for (const id of AMBIENT_LAYER_IDS) {
      const state = this.ambientTracks[id];
      if (!state.audio) continue;
      state.audio.pause();
      state.audio.currentTime = 0;
      if (state.blobUrl) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = null;
      }
      state.audio = null;
      state.currentMix = 0;
      state.targetMix = 0;
      state.mixVolume = 0;
      state.playPending = false;
      state.lastPlayAttemptAtMs = 0;
    }
  }

  dispose(): void {
    this.stop();
  }

  private ensureAmbientTrackLoaded(layerId: AmbientLayerId): void {
    const clip = AMBIENT_LAYERS[layerId];
    const state = this.ambientTracks[layerId];
    if (!clip || state.audio) return;
    loadAudioAsBlobUrl(clip.path)
      .then((url) => {
        if (state.audio) {
          URL.revokeObjectURL(url);
          return;
        }
        state.blobUrl = url;
        const audio = this.createLoopingAudio(url, clip, layerId);
        state.audio = audio;
        state.currentMix = 0;
        state.playPending = false;
        state.lastPlayAttemptAtMs = 0;
      })
      .catch(() => {
        if (state.audio) return;
        const fallback = this.createLoopingAudio(clip.path, clip, layerId);
        state.audio = fallback;
        state.currentMix = 0;
        state.playPending = false;
        state.lastPlayAttemptAtMs = 0;
      });
  }

  private createLoopingAudio(
    src: string,
    clip: AudioClipDefinition,
    layerId: AmbientLayerId,
  ): HTMLAudioElement {
    const audio = new Audio(src);
    audio.loop = clip.loop ?? true;
    // Ambient beds always follow wall-clock time, independent of simulation speed.
    audio.defaultPlaybackRate = 1;
    audio.playbackRate = 1;
    audio.preservesPitch = true;
    audio.volume = 0;
    audio.addEventListener('error', () => {
      const state = this.ambientTracks[layerId];
      if (state.audio !== audio) return;
      if (state.blobUrl) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = null;
      }
      state.audio = null;
      state.currentMix = 0;
      state.targetMix = 0;
    });
    return audio;
  }

  private maybeStartAmbientPlayback(state: AmbientTrackState, nowMs: number): void {
    if (!state.audio || state.playPending) return;
    if (nowMs - state.lastPlayAttemptAtMs < AMBIENT_PLAY_RETRY_MS) return;
    state.playPending = true;
    state.lastPlayAttemptAtMs = nowMs;
    state.audio.play().catch(() => undefined).finally(() => {
      state.playPending = false;
      if (this.paused) state.audio?.pause();
    });
  }
}

function createAmbientTrackState(): AmbientTrackState {
  return {
    audio: null,
    blobUrl: null,
    currentMix: 0,
    targetMix: 0,
    mixVolume: 0,
    playPending: false,
    lastPlayAttemptAtMs: 0,
  };
}

function moveToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) return target;
  return current < target ? current + step : current - step;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
