const RESOURCE_TOTALS_PRESENTATION_KEY =
  'medieval-road-system.resourceTotalsPresentation';

export type ResourceTotalsPresentation = 'surplus' | 'total';

export function readResourceTotalsPresentation(): ResourceTotalsPresentation {
  try {
    return localStorage.getItem(RESOURCE_TOTALS_PRESENTATION_KEY) === 'total'
      ? 'total'
      : 'surplus';
  } catch {
    // Ignore private browsing / blocked storage.
    return 'surplus';
  }
}

export function saveResourceTotalsPresentation(
  presentation: ResourceTotalsPresentation,
): void {
  try {
    if (presentation === 'surplus') {
      localStorage.removeItem(RESOURCE_TOTALS_PRESENTATION_KEY);
    } else {
      localStorage.setItem(RESOURCE_TOTALS_PRESENTATION_KEY, presentation);
    }
  } catch {
    // Ignore private browsing / blocked storage.
  }
}
