import type { DeliveryTripPhase } from './deliveryTrips.ts';

const SERVER_CATCH_UP_RATE = 14;
const MAX_FRAME_SECONDS = 0.1;

export type DeliveryDisplayProgressInput = Readonly<{
  displayProgress: number;
  serverProgress: number;
  pathDistance: number;
  phase: DeliveryTripPhase;
  effectiveTravelSpeed: number;
  deltaSeconds: number;
}>;

/**
 * Advances a cart continuously between authoritative samples. Normal client
 * prediction keeps moving until the semantic phase or route endpoint changes;
 * only genuine server-ahead corrections are blended into motion. Pulling a
 * predicted frame back toward a stale row, or capping its lead over that row,
 * makes velocity decay to zero before the next sample and produces a visible
 * move/pause hitch.
 */
export function advanceDeliveryDisplayProgress(
  input: DeliveryDisplayProgressInput,
): number {
  const pathDistance = finiteNonNegative(input.pathDistance);
  const displayProgress = clampProgress(input.displayProgress, pathDistance);
  if (input.phase === 'unloading' || pathDistance <= 1e-6) {
    return displayProgress;
  }

  const serverProgress = clampProgress(input.serverProgress, pathDistance);
  const speed = finiteNonNegative(input.effectiveTravelSpeed);
  const dt = Math.min(MAX_FRAME_SECONDS, finiteNonNegative(input.deltaSeconds));
  if (dt <= 0 || speed <= 0) return displayProgress;

  let next = Math.min(pathDistance, displayProgress + speed * dt);
  if (serverProgress > next) {
    const catchUp = 1 - Math.exp(-dt * SERVER_CATCH_UP_RATE);
    next += (serverProgress - next) * catchUp;
  }

  return clampProgress(next, pathDistance);
}

function clampProgress(value: number, pathDistance: number): number {
  return Math.min(pathDistance, finiteNonNegative(value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
