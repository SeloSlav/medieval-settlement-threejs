const DISTANT_CANOPY_CARDS_KEY =
  'medieval-road-system.distantCanopyCardsEnabled';

export function areDistantCanopyCardsEnabled(): boolean {
  try {
    return localStorage.getItem(DISTANT_CANOPY_CARDS_KEY) !== '0';
  } catch {
    // Ignore private browsing / blocked storage.
  }
  return true;
}

export function setDistantCanopyCardsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(DISTANT_CANOPY_CARDS_KEY);
    else localStorage.setItem(DISTANT_CANOPY_CARDS_KEY, '0');
  } catch {
    // Ignore private browsing / blocked storage.
  }
}
