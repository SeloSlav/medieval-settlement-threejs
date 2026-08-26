import type {
  FootstepGait,
  FootstepMotion,
  FootstepSide,
} from '../../audio/audioCatalog.ts';
import {
  OUTDOOR_CROUCH_SPEED_MPS,
  OUTDOOR_SPRINT_SPEED_MPS,
  OUTDOOR_WALK_SPEED_MPS,
} from './fpConstants.ts';

/** Horizontal distance covered between individual left/right foot contacts. */
export const FP_CROUCH_STEP_LENGTH_METERS = { min: 0.54, max: 0.78 } as const;
export const FP_WALK_STEP_LENGTH_METERS = { min: 0.64, max: 0.96 } as const;
export const FP_SPRINT_STEP_LENGTH_METERS = { min: 0.46, max: 2.35 } as const;

const FIRST_STEP_PHASE = 0.56;
const MAX_FRAME_TRAVEL_METERS = 1.25;
const SPRINT_GAIT_ENTER_SPEED_MPS = OUTDOOR_WALK_SPEED_MPS * 1.08;
const SPRINT_GAIT_EXIT_SPEED_MPS = OUTDOOR_WALK_SPEED_MPS * 0.95;

export type FpFootstepCadenceState = {
  /** Normalized progress toward the next foot contact. */
  phase: number;
  nextSide: FootstepSide;
  gait: Exclude<FootstepGait, 'landing'> | null;
};

export type FpFootstepCadenceInput = {
  /** Actual post-collision horizontal displacement during this frame. */
  traveledMeters: number;
  horizontalSpeedMps: number;
  moving: boolean;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
};

export function createFpFootstepCadenceState(): FpFootstepCadenceState {
  return {
    phase: FIRST_STEP_PHASE,
    nextSide: 'left',
    gait: null,
  };
}

export function resetFpFootstepCadenceState(
  state: FpFootstepCadenceState,
): void {
  state.phase = FIRST_STEP_PHASE;
  state.nextSide = 'left';
  state.gait = null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function resolveFpFootstepGait(
  input: Pick<
    FpFootstepCadenceInput,
    'crouching' | 'sprinting' | 'horizontalSpeedMps'
  >,
  previousGait: Exclude<FootstepGait, 'landing'> | null = null,
): Exclude<FootstepGait, 'landing'> {
  if (input.crouching) return 'crouch';
  if (
    previousGait === 'sprint'
    && input.horizontalSpeedMps >= SPRINT_GAIT_EXIT_SPEED_MPS
  ) {
    return 'sprint';
  }
  if (input.sprinting && input.horizontalSpeedMps >= SPRINT_GAIT_ENTER_SPEED_MPS) {
    return 'sprint';
  }
  return 'walk';
}

export function fpFootstepSpeedRatio(
  gait: Exclude<FootstepGait, 'landing'>,
  horizontalSpeedMps: number,
): number {
  const referenceSpeed = gait === 'crouch'
    ? OUTDOOR_CROUCH_SPEED_MPS
    : gait === 'sprint'
      ? OUTDOOR_SPRINT_SPEED_MPS
      : OUTDOOR_WALK_SPEED_MPS;
  return clamp01(horizontalSpeedMps / referenceSpeed);
}

export function fpFootstepStepLengthMeters(
  gait: Exclude<FootstepGait, 'landing'>,
  speedRatio: number,
): number {
  const range = gait === 'crouch'
    ? FP_CROUCH_STEP_LENGTH_METERS
    : gait === 'sprint'
      ? FP_SPRINT_STEP_LENGTH_METERS
      : FP_WALK_STEP_LENGTH_METERS;
  return lerp(range.min, range.max, clamp01(speedRatio));
}

/** Diagnostic cadence implied by actual locomotion speed and authored stride. */
export function fpFootstepCadenceHz(
  gait: Exclude<FootstepGait, 'landing'>,
  speedRatio: number,
): number {
  const referenceSpeed = gait === 'crouch'
    ? OUTDOOR_CROUCH_SPEED_MPS
    : gait === 'sprint'
      ? OUTDOOR_SPRINT_SPEED_MPS
      : OUTDOOR_WALK_SPEED_MPS;
  const speed = referenceSpeed * clamp01(speedRatio);
  return speed / fpFootstepStepLengthMeters(gait, speedRatio);
}

function takeNextSide(state: FpFootstepCadenceState): FootstepSide {
  const side = state.nextSide;
  state.nextSide = side === 'left' ? 'right' : 'left';
  return side;
}

/**
 * Advances foot-contact phase from actual post-collision travel, so pushing a
 * wall is silent and cadence cannot drift away from visible ground speed.
 * Large teleport/tab-resume deltas are bounded to avoid a burst of contacts.
 */
export function stepFpFootstepCadence(
  state: FpFootstepCadenceState,
  input: FpFootstepCadenceInput,
): FootstepMotion | null {
  if (
    !input.grounded
    || !input.moving
    || input.horizontalSpeedMps <= 0.12
  ) {
    state.phase = FIRST_STEP_PHASE;
    state.gait = null;
    return null;
  }

  const gait = resolveFpFootstepGait(input, state.gait);
  const speedRatio = fpFootstepSpeedRatio(gait, input.horizontalSpeedMps);
  const stepLength = fpFootstepStepLengthMeters(gait, speedRatio);
  state.gait = gait;
  state.phase += Math.min(
    MAX_FRAME_TRAVEL_METERS,
    Math.max(0, input.traveledMeters),
  ) / stepLength;
  if (state.phase < 1) return null;

  state.phase %= 1;
  return {
    gait,
    side: takeNextSide(state),
    speedRatio,
  };
}

export function takeFpLandingFootstep(
  state: FpFootstepCadenceState,
  horizontalSpeedMps: number,
): FootstepMotion {
  state.phase = 0;
  state.gait = null;
  return {
    gait: 'landing',
    side: takeNextSide(state),
    speedRatio: clamp01(horizontalSpeedMps / OUTDOOR_SPRINT_SPEED_MPS),
  };
}
