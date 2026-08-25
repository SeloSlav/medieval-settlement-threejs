import { MUSIC_TRACKS, type AudioClipDefinition } from './audioCatalog.ts';
import {
  getMusicVolume,
  isGameAudioEnabled,
  isMusicEnabled,
} from './audioPreferences.ts';

export const STARTUP_MUSIC_TRACK_ID = 'valley_at_first_light' as const;
export const STARTUP_MUSIC_FADE_OUT_MS = 7_000;

type StartupAudio = Pick<
  HTMLAudioElement,
  | 'load'
  | 'addEventListener'
  | 'loop'
  | 'pause'
  | 'paused'
  | 'play'
  | 'preload'
  | 'removeEventListener'
  | 'removeAttribute'
  | 'src'
  | 'volume'
>;

export type StartupMusicEnvironment = {
  unlockTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  createAudio: () => StartupAudio;
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (requestId: number) => void;
  scheduleTimeout: (callback: () => void, delayMs: number) => number;
  cancelTimeout: (timeoutId: number) => void;
};

export type StartupMusicControllerOptions = {
  clip?: AudioClipDefinition;
  enabled?: boolean;
  gameAudioEnabled?: boolean;
  musicEnabled?: boolean;
  musicVolume?: number;
  fadeOutMs?: number;
  environment?: StartupMusicEnvironment;
  onAudibilityChange?: (audible: boolean) => void;
};

/**
 * Owns the single non-spatial score cue that spans noble setup, world setup,
 * and initial loading. It deliberately lives above those screens so their
 * mount/unmount transitions never restart or duplicate the track.
 */
export class StartupMusicController {
  private readonly clip: AudioClipDefinition;
  private gameAudioEnabled: boolean;
  private musicEnabled: boolean;
  private musicVolume: number;
  private readonly fadeOutMs: number;
  private readonly environment: StartupMusicEnvironment;
  private readonly onAudibilityChange?: (audible: boolean) => void;
  private audio: StartupAudio | null = null;
  private fadePromise: Promise<void> | null = null;
  private resolveFade: (() => void) | null = null;
  private fadeFrameId: number | null = null;
  private fadeTimeoutId: number | null = null;
  private fadeStartedAtMs = 0;
  private fadeDurationMs = 0;
  private baseVolume = 0;
  private fadeGain = 1;
  private unlockListenersInstalled = false;
  private started = false;
  private handingOff = false;
  private disposed = false;
  private audible = false;

  constructor(options: StartupMusicControllerOptions = {}) {
    this.clip = options.clip ?? MUSIC_TRACKS[STARTUP_MUSIC_TRACK_ID];
    this.gameAudioEnabled = options.gameAudioEnabled
      ?? options.enabled
      ?? isGameAudioEnabled();
    this.musicEnabled = options.musicEnabled
      ?? options.enabled
      ?? isMusicEnabled();
    this.musicVolume = clamp01(options.musicVolume ?? getMusicVolume());
    this.fadeOutMs = Math.max(0, options.fadeOutMs ?? STARTUP_MUSIC_FADE_OUT_MS);
    this.environment = options.environment ?? browserEnvironment();
    this.onAudibilityChange = options.onAudibilityChange;
  }

  start(): void {
    if (this.started || this.disposed || !this.isPlaybackEnabled()) return;
    this.started = true;

    this.baseVolume = this.resolveBaseVolume();
    if (this.baseVolume <= 0.0001) return;

    const audio = this.environment.createAudio();
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = this.baseVolume;
    audio.src = this.clip.path;
    audio.addEventListener('error', this.onAudioError);
    this.audio = audio;
    this.installUnlockListeners();

    // This succeeds when the browser/origin already has playback permission.
    // Otherwise the capture listeners retry synchronously inside the first
    // setup-screen gesture, while user activation is still available.
    this.tryPlay();
  }

  isAudible(): boolean {
    return this.audible;
  }

  setGameAudioEnabled(enabled: boolean): void {
    this.gameAudioEnabled = enabled;
    if (!this.isPlaybackEnabled()) this.dispose();
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!this.isPlaybackEnabled()) this.dispose();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clamp01(volume);
    this.baseVolume = this.resolveBaseVolume();
    const audio = this.audio;
    if (!audio) return;
    audio.volume = clamp01(this.baseVolume * this.fadeGain);
    if (audio.volume <= 0.0001) {
      this.setAudible(false);
    } else if (!audio.paused && !this.disposed) {
      this.setAudible(true);
    }
  }

  fadeOut(durationMs = this.fadeOutMs): Promise<void> {
    if (this.fadePromise) return this.fadePromise;
    if (this.disposed) return Promise.resolve();

    this.handingOff = true;
    this.removeUnlockListeners();
    const audio = this.audio;
    const resolvedDurationMs = Math.max(0, durationMs);
    if (!audio || !this.audible || audio.paused || resolvedDurationMs === 0) {
      this.releaseAudio();
      this.fadePromise = Promise.resolve();
      return this.fadePromise;
    }

    this.fadeStartedAtMs = this.environment.now();
    this.fadeDurationMs = resolvedDurationMs;
    this.fadeGain = 1;
    this.fadePromise = new Promise<void>((resolve) => {
      this.resolveFade = resolve;
    });
    this.fadeFrameId = this.environment.requestFrame(this.advanceFade);
    this.fadeTimeoutId = this.environment.scheduleTimeout(
      this.completeFade,
      resolvedDurationMs,
    );
    return this.fadePromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handingOff = true;
    this.removeUnlockListeners();
    if (this.fadeFrameId !== null) {
      this.environment.cancelFrame(this.fadeFrameId);
      this.fadeFrameId = null;
    }
    if (this.fadeTimeoutId !== null) {
      this.environment.cancelTimeout(this.fadeTimeoutId);
      this.fadeTimeoutId = null;
    }
    this.releaseAudio();
    this.resolveFade?.();
    this.resolveFade = null;
  }

  private readonly onUnlock = (): void => {
    this.tryPlay();
  };

  private readonly onAudioError = (): void => {
    if (this.fadePromise) {
      this.completeFade();
    } else {
      this.releaseAudio();
    }
  };

  private tryPlay(): void {
    const audio = this.audio;
    if (!audio || this.disposed || this.handingOff || this.audible) return;

    let playResult: Promise<void>;
    try {
      playResult = audio.play();
    } catch {
      return;
    }
    void Promise.resolve(playResult).then(() => {
      if (this.audio !== audio || this.disposed || this.handingOff) {
        audio.pause();
        return;
      }
      this.removeUnlockListeners();
      this.setAudible(audio.volume > 0.0001);
    }).catch(() => {
      // Autoplay rejection is expected. The gesture listeners remain armed.
    });
  }

  private installUnlockListeners(): void {
    if (this.unlockListenersInstalled) return;
    this.unlockListenersInstalled = true;
    this.environment.unlockTarget.addEventListener('pointerdown', this.onUnlock, true);
    this.environment.unlockTarget.addEventListener('keydown', this.onUnlock, true);
  }

  private removeUnlockListeners(): void {
    if (!this.unlockListenersInstalled) return;
    this.unlockListenersInstalled = false;
    this.environment.unlockTarget.removeEventListener('pointerdown', this.onUnlock, true);
    this.environment.unlockTarget.removeEventListener('keydown', this.onUnlock, true);
  }

  private readonly advanceFade = (timestampMs: number): void => {
    this.fadeFrameId = null;
    const audio = this.audio;
    if (!audio || this.disposed) {
      this.completeFade();
      return;
    }

    const durationMs = Math.max(1, this.fadeDurationMs);
    const progress = clamp01((timestampMs - this.fadeStartedAtMs) / durationMs);
    const easedProgress = progress * progress * (3 - 2 * progress);
    this.fadeGain = 1 - easedProgress;
    audio.volume = clamp01(this.baseVolume * this.fadeGain);
    if (progress >= 1) {
      this.completeFade();
      return;
    }
    this.fadeFrameId = this.environment.requestFrame(this.advanceFade);
  };

  private readonly completeFade = (): void => {
    if (this.fadeFrameId !== null) {
      this.environment.cancelFrame(this.fadeFrameId);
      this.fadeFrameId = null;
    }
    if (this.fadeTimeoutId !== null) {
      this.environment.cancelTimeout(this.fadeTimeoutId);
      this.fadeTimeoutId = null;
    }
    this.releaseAudio();
    this.resolveFade?.();
    this.resolveFade = null;
  };

  private releaseAudio(): void {
    this.removeUnlockListeners();
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.removeEventListener('error', this.onAudioError);
      audio.pause();
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        // A detached or test audio element may not expose a usable load path.
      }
    }
    this.setAudible(false);
  }

  private setAudible(audible: boolean): void {
    if (this.audible === audible) return;
    this.audible = audible;
    this.onAudibilityChange?.(audible);
  }

  private isPlaybackEnabled(): boolean {
    return this.gameAudioEnabled && this.musicEnabled;
  }

  private resolveBaseVolume(): number {
    return clamp01((this.clip.volume ?? 1) * this.musicVolume);
  }
}

function browserEnvironment(): StartupMusicEnvironment {
  return {
    unlockTarget: window,
    createAudio: () => new Audio(),
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (requestId) => cancelAnimationFrame(requestId),
    scheduleTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
