import {
  LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
} from '../generated/gameBalance.ts';

const EPSILON = 1e-9;

export const LARGE_QUARRY_SUPPORT_TARGET =
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE
  * LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES;

export function largeQuarrySupportRunwayCycles(
  onsiteTimber: number,
  inboundTimber = 0,
): number {
  if (LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE <= EPSILON) return 0;
  return (
    Math.max(0, onsiteTimber)
    + Math.max(0, inboundTimber)
  ) / LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE;
}

export function largeQuarrySupportsReady(
  onsiteTimber: number,
  inboundTimber = 0,
): boolean {
  return (
    Math.max(0, onsiteTimber)
    + Math.max(0, inboundTimber)
    + EPSILON
    >= LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE
  );
}
