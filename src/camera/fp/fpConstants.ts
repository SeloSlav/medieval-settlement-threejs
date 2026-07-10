/** From The Mammoth `fpSessionConstants.ts` — look tuning. */
export const MOUSE_SENS = 0.0022;
export const LOOK_INERTIA_COAST_GAIN = 0.11;
export const LOOK_INERTIA_DAMP_PER_S = 18;
export const PITCH_LIMIT = 1.53;
export const FREE_LOOK_YAW_MAX = 2.35;
export const FREE_LOOK_RECENTER_RATE_PER_S = 3.5;
export const FREE_LOOK_RECENTER_SNAP_EPS = 1e-4;
export const CAM_BOB_DIP_Y = 0.004;

/**
 * Human-scale locomotion (1 world unit = 1 m).
 * Eye stand ~1.55 m (~1.70 m tall); crouch eye ~1.0 m.
 * Walk ~5.2 km/h, run ~19.8 km/h, crouch-walk ~3.2 km/h on uneven ground.
 */
export const OUTDOOR_WALK_SPEED_MPS = 1.45;
export const OUTDOOR_SPRINT_SPEED_MPS = 5.5;
export const OUTDOOR_CROUCH_SPEED_MPS = 0.9;
