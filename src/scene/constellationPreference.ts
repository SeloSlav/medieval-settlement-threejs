const CONSTELLATION_GUIDES_KEY = 'medieval-road-system.constellationGuidesEnabled';

const listeners = new Set<() => void>();

export function areConstellationGuidesEnabled(): boolean {
  try {
    return localStorage.getItem(CONSTELLATION_GUIDES_KEY) === '1';
  } catch {
    // Ignore private browsing / blocked storage.
  }
  return false;
}

export function setConstellationGuidesEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(CONSTELLATION_GUIDES_KEY, '1');
    else localStorage.removeItem(CONSTELLATION_GUIDES_KEY);
  } catch {
    // Ignore private browsing / blocked storage.
  }
  notifyConstellationPreferenceListeners();
}

export function subscribeConstellationPreference(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyConstellationPreferenceListeners(): void {
  for (const listener of listeners) listener();
}
