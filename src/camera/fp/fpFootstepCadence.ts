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

export const FP_CROUCH_STEP_CADENCE_HZ = { min: 1.15, max: 1.6 } as const;
export const FP_WALK_STEP_CADENCE_HZ = { min: 1.55, max: 2.1 } as const;
export const FP_SPRINT_STEP_CADENCE_HZ = { min: 2.6, max: 3.55 } as const;

const FIRST_STEP_PHASE = 0.56;
const MAX_CADENCE_DT_SECONDS = 0.1;
const SPRINT_GAIT_ENTER_SPEED_MPS = OUTDOOR_WALK_SPEED_MPS * 1.08;

export type FpFootstepCadenceState = {
  /** Normalized progress toward the next foot contact. */
  phase: number;
  nextSide: FootstepSide;
  gait: Exclude<FootstepGait, 'landing'> | null;
};

export type FpFootstepCadenceInput = {
  dtSeconds: number;
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
): Exclude<FootstepGait, 'landing'> {
  if (input.crouching) return 'crouch';
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

export function fpFootstepCadenceHz(
  gait: Exclude<FootstepGait, 'landing'>,
  speedRatio: number,
): number {
  const range = gait === 'crouch'
    ? FP_CROUCH_STEP_CADENCE_HZ
    : gait === 'sprint'
      ? FP_SPRINT_STEP_CADENCE_HZ
      : FP_WALK_STEP_CADENCE_HZ;
  return lerp(range.min, range.max, clamp01(speedRatio));
}

function takeNextSide(state: FpFootstepCadenceState): FootstepSide {
  const side = state.nextSide;
  state.nextSide = side === 'left' ? 'right' : 'left';
  return side;
}

/**
 * Advances a human cadence phase and emits at most one contact per frame.
 * Locomotion already caps integration frames; this additionally bounds large
 * tab-resume deltas so missed contacts never arrive as a machine-gun burst.
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

  const gait = resolveFpFootstepGait(input);
  const speedRatio = fpFootstepSpeedRatio(gait, input.horizontalSpeedMps);
  const cadenceHz = fpFootstepCadenceHz(gait, speedRatio);
  state.gait = gait;
  state.phase += Math.min(
    MAX_CADENCE_DT_SECONDS,
    Math.max(0, input.dtSeconds),
  ) * cadenceHz;
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
