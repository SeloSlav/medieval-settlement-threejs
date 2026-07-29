const GAME_AUDIO_ENABLED_KEY = 'medieval-road-system:audio-enabled';
const MUSIC_ENABLED_KEY = 'medieval-road-system:music-enabled';
const MUSIC_VOLUME_KEY = 'medieval-road-system:music-volume';
const AMBIENCE_VOLUME_KEY = 'medieval-road-system:ambience-volume';

/** New players begin above the old restrained score mix while retaining headroom. */
export const DEFAULT_MUSIC_VOLUME = 0.75;
/** Leaves the environmental bed present without masking the instrumental score. */
export const DEFAULT_AMBIENCE_VOLUME = 0.8;

let gameAudioEnabled = readBooleanPreference(GAME_AUDIO_ENABLED_KEY, true);
let musicEnabled = readBooleanPreference(MUSIC_ENABLED_KEY, true);
let musicVolume = readNumberPreference(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME);
let ambienceVolume = readNumberPreference(AMBIENCE_VOLUME_KEY, DEFAULT_AMBIENCE_VOLUME);

export function isGameAudioEnabled(): boolean {
  return gameAudioEnabled;
}

export function setGameAudioEnabled(enabled: boolean): void {
  gameAudioEnabled = enabled;
  persistBooleanPreference(GAME_AUDIO_ENABLED_KEY, enabled);
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
}

export function setMusicEnabled(enabled: boolean): void {
  musicEnabled = enabled;
  persistBooleanPreference(MUSIC_ENABLED_KEY, enabled);
}

export function getMusicVolume(): number {
  return musicVolume;
}

export function setMusicVolume(volume: number): void {
  musicVolume = clamp01(Number.isFinite(volume) ? volume : DEFAULT_MUSIC_VOLUME);
  persistNumberPreference(MUSIC_VOLUME_KEY, musicVolume);
}

export function getAmbienceVolume(): number {
  return ambienceVolume;
}

export function setAmbienceVolume(volume: number): void {
  ambienceVolume = clamp01(Number.isFinite(volume) ? volume : DEFAULT_AMBIENCE_VOLUME);
  persistNumberPreference(AMBIENCE_VOLUME_KEY, ambienceVolume);
}

function readBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return fallback;
    return stored === '1' || stored === 'true';
  } catch {
    return fallback;
  }
}

function readNumberPreference(key: string, fallback: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? clamp01(value) : fallback;
  } catch {
    return fallback;
  }
}

function persistBooleanPreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
}

function persistNumberPreference(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
