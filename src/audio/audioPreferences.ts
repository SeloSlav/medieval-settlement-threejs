const GAME_AUDIO_ENABLED_KEY = 'medieval-road-system:audio-enabled';
const MUSIC_ENABLED_KEY = 'medieval-road-system:music-enabled';

let gameAudioEnabled = readBooleanPreference(GAME_AUDIO_ENABLED_KEY, true);
let musicEnabled = readBooleanPreference(MUSIC_ENABLED_KEY, true);

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

function readBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return fallback;
    return stored === '1' || stored === 'true';
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
