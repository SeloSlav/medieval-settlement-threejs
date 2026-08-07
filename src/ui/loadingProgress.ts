export type LoadingPhase =
  | 'worldSetup'
  | 'sceneShell'
  | 'graphics'
  | 'terrain'
  | 'worldFeatures'
  | 'connecting'
  | 'vegetation';

const PHASE_RANGES: Record<LoadingPhase, { start: number; end: number }> = {
  worldSetup: { start: 0, end: 8 },
  sceneShell: { start: 8, end: 12 },
  graphics: { start: 12, end: 22 },
  terrain: { start: 22, end: 62 },
  worldFeatures: { start: 62, end: 74 },
  connecting: { start: 74, end: 88 },
  // Reserve the final 4% for the authoritative session-ready handoff. The
  // loading cover can remain up after rendering work completes.
  vegetation: { start: 88, end: 96 },
};

export function loadingPercentForPhase(phase: LoadingPhase, fraction: number): number {
  const range = PHASE_RANGES[phase];
  const clamped = Math.min(1, Math.max(0, fraction));
  return range.start + (range.end - range.start) * clamped;
}
