import { AMBIENT_LAYERS, type AmbientLayerId, type AudioClipDefinition } from './audioCatalog.ts';

type AmbientTrackState = {
  audio: HTMLAudioElement | null;
  blobUrl: string | null;
  currentVolume: number;
  targetVolume: number;
  playPending: boolean;
  lastPlayAttemptAtMs: number;
};

type AmbientMix = {
  baseLayer: AmbientLayerId | null;
  baseVolume?: number;
  overlayLayer?: AmbientLayerId | null;
  overlayVolume?: number;
  weatherLayer?: AmbientLayerId | null;
  weatherVolume?: number;
};

const AMBIENT_FADE_SPEED = 0.16;
const AMBIENT_PLAY_RETRY_MS = 1000;

async function loadAudioAsBlobUrl(path: string): Promise<string> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export class AmbientAudio {
  private enabled = true;
  private readonly ambientTracks: Record<AmbientLayerId, AmbientTrackState> = {
    birds_wind_day: { audio: null, blobUrl: null, currentVolume: 0, targetVolume: 0, playPending: false, lastPlayAttemptAtMs: 0 },
    village_day: { audio: null, blobUrl: null, currentVolume: 0, targetVolume: 0, playPending: false, lastPlayAttemptAtMs: 0 },
    night_insects: { audio: null, blobUrl: null, currentVolume: 0, targetVolume: 0, playPending: false, lastPlayAttemptAtMs: 0 },
    open_wind_overview: { audio: null, blobUrl: null, currentVolume: 0, targetVolume: 0, playPending: false, lastPlayAttemptAtMs: 0 },
    light_rain: { audio: null, blobUrl: null, currentVolume: 0, targetVolume: 0, playPending: false, lastPlayAttemptAtMs: 0 },
  };

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  setAmbientMix(mix: AmbientMix): void {
    if (!this.enabled) return;
    for (const id of Object.keys(this.ambientTracks) as AmbientLayerId[]) {
      this.ambientTracks[id].targetVolume = 0;
    }
    if (mix.baseLayer) {
      const clip = AMBIENT_LAYERS[mix.baseLayer];
      this.ambientTracks[mix.baseLayer].targetVolume = Math.max(0, mix.baseVolume ?? clip.volume ?? 1);
      this.ensureAmbientTrackLoaded(mix.baseLayer);
    }
    if (mix.overlayLayer) {
      const clip = AMBIENT_LAYERS[mix.overlayLayer];
      this.ambientTracks[mix.overlayLayer].targetVolume = Math.max(0, mix.overlayVolume ?? clip.volume ?? 1);
      this.ensureAmbientTrackLoaded(mix.overlayLayer);
    }
    if (mix.weatherLayer) {
      const clip = AMBIENT_LAYERS[mix.weatherLayer];
      this.ambientTracks[mix.weatherLayer].targetVolume = Math.max(0, mix.weatherVolume ?? clip.volume ?? 1);
      this.ensureAmbientTrackLoaded(mix.weatherLayer);
    }
  }

  tick(dtSeconds: number): void {
    if (!this.enabled) return;
    const step = Math.max(0, dtSeconds) * AMBIENT_FADE_SPEED;
    const nowMs = performance.now();
    for (const id of Object.keys(this.ambientTracks) as AmbientLayerId[]) {
      const state = this.ambientTracks[id];
      const audio = state.audio;
      if (!audio) continue;

      if (Math.abs(state.currentVolume - state.targetVolume) <= step) {
        state.currentVolume = state.targetVolume;
      } else if (state.currentVolume < state.targetVolume) {
        state.currentVolume += step;
      } else {
        state.currentVolume -= step;
      }

      audio.volume = Math.max(0, state.currentVolume);
      if (state.targetVolume > 0 && audio.paused) {
        this.maybeStartAmbientPlayback(state, nowMs);
      }
      if (state.currentVolume <= 0.0001 && state.targetVolume <= 0.0001) {
        audio.pause();
        audio.currentTime = 0;
        state.currentVolume = 0;
        state.playPending = false;
      }
    }
  }

  stop(): void {
    this.setAmbientMix({
      baseLayer: null,
      overlayLayer: null,
      weatherLayer: null,
      baseVolume: 0,
      overlayVolume: 0,
      weatherVolume: 0,
    });
    for (const id of Object.keys(this.ambientTracks) as AmbientLayerId[]) {
      const state = this.ambientTracks[id];
      if (!state.audio) continue;
      state.audio.pause();
      state.audio.currentTime = 0;
      if (state.blobUrl) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = null;
      }
      state.audio = null;
      state.currentVolume = 0;
      state.targetVolume = 0;
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
        state.currentVolume = 0;
        state.playPending = false;
        state.lastPlayAttemptAtMs = 0;
      })
      .catch(() => {
        if (state.audio) return;
        const fallback = this.createLoopingAudio(clip.path, clip, layerId);
        state.audio = fallback;
        state.currentVolume = 0;
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
    audio.volume = 0;
    audio.addEventListener('error', () => {
      const state = this.ambientTracks[layerId];
      if (state.audio !== audio) return;
      if (state.blobUrl) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = null;
      }
      state.audio = null;
      state.currentVolume = 0;
      state.targetVolume = 0;
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
    });
  }
}
