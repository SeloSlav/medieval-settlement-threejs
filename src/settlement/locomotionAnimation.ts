export type LocomotionAnimationMode = 'walk' | 'run' | 'flee';

const NOMINAL_WALK_SPEED = 1.2;
const NOMINAL_RUN_SPEED = 2.15;
const NOMINAL_FLEE_SPEED = 1.9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Converts observed world-space travel into an authored locomotion cycle rate.
 * The run clip covers a substantially longer stride than the walk clip, so it
 * must not reuse the walk-speed divisor or soldiers appear to sprint in place.
 */
export function locomotionAnimationTimeScale(
  mode: LocomotionAnimationMode,
  movementSpeed: number,
): number {
  const speed = Number.isFinite(movementSpeed) ? Math.max(0, movementSpeed) : 0;
  switch (mode) {
    case 'walk':
      return 1.06 * clamp(speed / NOMINAL_WALK_SPEED, 0.55, 1.45);
    case 'run':
      return clamp(speed / NOMINAL_RUN_SPEED, 0.38, 1.25);
    case 'flee':
      return clamp(speed / NOMINAL_FLEE_SPEED, 0.44, 1.25);
  }
}
