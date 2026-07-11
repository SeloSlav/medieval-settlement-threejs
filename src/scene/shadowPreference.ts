const TREE_SHADOWS_KEY = 'medieval-road-system.treeShadowsEnabled';
const BUILDING_SHADOWS_KEY = 'medieval-road-system.buildingShadowsEnabled';
const LEGACY_TREE_SHADOWS_DISABLED_KEY = 'medieval-road-system.treeShadowsDisabled';
const LEGACY_BUILDING_SHADOWS_DISABLED_KEY = 'medieval-road-system.buildingShadowsDisabled';

const listeners = new Set<() => void>();

export function areTreeShadowsEnabled(): boolean {
  return readShadowEnabled(TREE_SHADOWS_KEY, LEGACY_TREE_SHADOWS_DISABLED_KEY);
}

export function areBuildingShadowsEnabled(): boolean {
  return readShadowEnabled(BUILDING_SHADOWS_KEY, LEGACY_BUILDING_SHADOWS_DISABLED_KEY);
}

export function setTreeShadowsEnabled(enabled: boolean): void {
  writeShadowEnabled(TREE_SHADOWS_KEY, LEGACY_TREE_SHADOWS_DISABLED_KEY, enabled);
  notifyShadowPreferenceListeners();
}

export function setBuildingShadowsEnabled(enabled: boolean): void {
  writeShadowEnabled(BUILDING_SHADOWS_KEY, LEGACY_BUILDING_SHADOWS_DISABLED_KEY, enabled);
  notifyShadowPreferenceListeners();
}

export function subscribeShadowPreferences(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readShadowEnabled(enabledKey: string, legacyDisabledKey: string): boolean {
  try {
    const stored = localStorage.getItem(enabledKey);
    if (stored !== null) {
      return stored !== '0';
    }

    if (localStorage.getItem(legacyDisabledKey) !== null) {
      localStorage.removeItem(legacyDisabledKey);
    }
  } catch {
    // Ignore private browsing / blocked storage.
  }
  return true;
}

function writeShadowEnabled(enabledKey: string, legacyDisabledKey: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(enabledKey);
    else localStorage.setItem(enabledKey, '0');
    localStorage.removeItem(legacyDisabledKey);
  } catch {
    // Ignore private browsing / blocked storage.
  }
}

function notifyShadowPreferenceListeners(): void {
  for (const listener of listeners) listener();
}
