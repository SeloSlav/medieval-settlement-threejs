import { mapIconRevealOpacity } from '../grass/grassLodMath.ts';

const RESOURCE_ICONS_ALWAYS_SHOWN_KEY =
  'medieval-road-system.resourceIconsAlwaysShown';

let resourceIconsAlwaysShown = readStoredPreference();

export function areResourceIconsAlwaysShown(): boolean {
  return resourceIconsAlwaysShown;
}

export function setResourceIconsAlwaysShown(enabled: boolean): void {
  resourceIconsAlwaysShown = enabled;
  try {
    if (enabled) localStorage.removeItem(RESOURCE_ICONS_ALWAYS_SHOWN_KEY);
    else localStorage.setItem(RESOURCE_ICONS_ALWAYS_SHOWN_KEY, '0');
  } catch {
    // Ignore private browsing / blocked storage.
  }
}

export function resolveResourceIconOpacity(
  zoomPercent: number,
  alwaysShown = areResourceIconsAlwaysShown(),
): number {
  return alwaysShown ? 1 : mapIconRevealOpacity(zoomPercent);
}

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(RESOURCE_ICONS_ALWAYS_SHOWN_KEY) !== '0';
  } catch {
    // Ignore private browsing / blocked storage.
  }
  return true;
}
