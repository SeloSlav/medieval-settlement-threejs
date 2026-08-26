const PAINTERLY_VEGETATION_KEY =
  'medieval-road-system.painterlyVegetationEnabled';

type PainterlyVegetationPreferenceListener = (enabled: boolean) => void;

const listeners = new Set<PainterlyVegetationPreferenceListener>();

/** The painterly world treatment is deliberately opt-in while the look is evaluated. */
export function isPainterlyVegetationEnabled(): boolean {
  try {
    return localStorage.getItem(PAINTERLY_VEGETATION_KEY) === '1';
  } catch {
    // Storage can be unavailable in tests, private browsing, or embedded views.
  }
  return false;
}

export function setPainterlyVegetationEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PAINTERLY_VEGETATION_KEY, '1');
    else localStorage.removeItem(PAINTERLY_VEGETATION_KEY);
  } catch {
    // The live material registry still updates when persistence is unavailable.
  }
  for (const listener of listeners) listener(enabled);
}

export function subscribePainterlyVegetationPreference(
  listener: PainterlyVegetationPreferenceListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
