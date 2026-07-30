import {
  MINE_TIMBER_SUPPORT_BUFFER_CYCLES,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
} from '../generated/gameBalance.ts';

const EPSILON = 1e-9;

export const RICH_MINE_SUPPORT_TARGET =
  MINE_TIMBER_SUPPORT_PER_CYCLE * MINE_TIMBER_SUPPORT_BUFFER_CYCLES;

export function richMineSupportRunwayCycles(
  onsiteTimber: number,
  inboundTimber = 0,
): number {
  if (MINE_TIMBER_SUPPORT_PER_CYCLE <= EPSILON) return 0;
  return (
    Math.max(0, onsiteTimber)
    + Math.max(0, inboundTimber)
  ) / MINE_TIMBER_SUPPORT_PER_CYCLE;
}

export function richMineSupportsReady(
  onsiteTimber: number,
  inboundTimber = 0,
): boolean {
  return (
    Math.max(0, onsiteTimber)
    + Math.max(0, inboundTimber)
    + EPSILON
    >= MINE_TIMBER_SUPPORT_PER_CYCLE
  );
}
