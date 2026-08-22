export function hydrologyGradeLabel(score: number): string {
  if (score >= 0.82) return 'Excellent';
  if (score >= 0.62) return 'Good';
  if (score >= 0.42) return 'Fair';
  if (score >= 0.22) return 'Poor';
  return 'Dry';
}

export function wellCapacityFromHydrology(baseCapacity: number, hydrologyScore: number): number {
  return baseCapacity * (0.32 + 0.68 * clamp01(hydrologyScore));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
