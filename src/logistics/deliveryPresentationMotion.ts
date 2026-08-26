import type { DeliveryTripPhase } from './deliveryTrips.ts';

const SERVER_CATCH_UP_RATE = 14;
const MIN_AUTHORITY_LEAD_METERS = 0.6;
const AUTHORITY_LEAD_SECONDS = 0.35;
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
 * prediction is allowed to lead the last server row by one short network
 * interval; only genuine server-ahead corrections are blended into motion.
 * Pulling every predicted frame back toward a stale row makes velocity decay
 * to zero before the next sample and produces a visible move/pause hitch.
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
  } else {
    const maxLead = Math.max(
      MIN_AUTHORITY_LEAD_METERS,
      speed * AUTHORITY_LEAD_SECONDS,
    );
    const leadLimit = Math.min(pathDistance, serverProgress + maxLead);
    if (next > leadLimit) {
      // A delayed row may stop extrapolation, but it must never pull a cart
      // backward. Ordinary authority cadence remains comfortably in-budget.
      next = Math.max(displayProgress, leadLimit);
    }
  }

  return clampProgress(next, pathDistance);
}

function clampProgress(value: number, pathDistance: number): number {
  return Math.min(pathDistance, finiteNonNegative(value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
