const NATURAL_PAINTERLY_ENABLED_KEY =
  'medieval-road-system.naturalPainterlyEnvironmentEnabled';

const listeners = new Set<(enabled: boolean) => void>();
let enabled = readStoredPreference();

/**
 * The natural-environment paint treatment is opt-out: a missing key means on.
 * Keeping the live value in memory also makes the Esc-menu switch work when
 * browser storage is unavailable.
 */
export function isNaturalPainterlyEnvironmentEnabled(): boolean {
  return enabled;
}

export function setNaturalPainterlyEnvironmentEnabled(nextEnabled: boolean): void {
  const next = nextEnabled !== false;
  if (enabled === next) return;
  enabled = next;
  try {
    if (enabled) localStorage.removeItem(NATURAL_PAINTERLY_ENABLED_KEY);
    else localStorage.setItem(NATURAL_PAINTERLY_ENABLED_KEY, '0');
  } catch {
    // The in-memory preference remains authoritative for this session.
  }
  for (const listener of listeners) listener(enabled);
}

export function subscribeNaturalPainterlyEnvironmentPreference(
  listener: (enabled: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(NATURAL_PAINTERLY_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}
