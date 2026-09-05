import { getTreeSpeciesProfile, type ForestTreePlacement } from '../props/forestPlacements.ts';

export const TREE_FALL_SECONDS = 3.5;
export const LOG_HEALTH_PER_TIMBER = 10;
export const LOG_HEALTH_PER_FIREWOOD = 5;
export const treeFallDirection = (layoutIndex: number): number => layoutIndex * 2.399963229728653;
export type ForestrySoundEvent = { kind: 'fall' | 'impact'; layoutIndex: number; x: number; y: number; z: number };

/** Slow hinge release accelerates into an exact, grounded terminal pose. */
export function treeFallAngle(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return Math.PI * 0.5 * (0.08 * t + 0.92 * t * t * t);
}

export function timberLogDimensions(placement: Pick<ForestTreePlacement, 'species' | 'scale'>): { radius: number; length: number } {
  const profile = getTreeSpeciesProfile(placement.species);
  return {
    radius: Math.max(0.12, Math.min(0.6, 0.27 * placement.scale * profile.trunkMul)),
    length: Math.max(1.8, Math.min(3.0, 2.25 * Math.sqrt(placement.scale) * profile.heightMul)),
  };
}
