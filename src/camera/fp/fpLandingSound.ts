export const FP_LANDING_SOUND_COOLDOWN_SEC = 0.18;

export type FpLandingSoundState = {
  awaitingLanding: boolean;
  cooldownSec: number;
};

export function createFpLandingSoundState(): FpLandingSoundState {
  return {
    awaitingLanding: false,
    cooldownSec: 0,
  };
}

export function resetFpLandingSoundState(state: FpLandingSoundState): void {
  state.awaitingLanding = false;
  state.cooldownSec = 0;
}

/** Returns true once, on the first grounded frame after an accepted jump. */
export function stepFpLandingSound(
  state: FpLandingSoundState,
  jumpStarted: boolean,
  grounded: boolean,
  dtSec: number,
): boolean {
  state.cooldownSec = Math.max(0, state.cooldownSec - Math.max(0, dtSec));

  if (jumpStarted && !grounded) {
    state.awaitingLanding = true;
  }
  if (!state.awaitingLanding || !grounded) return false;

  state.awaitingLanding = false;
  if (state.cooldownSec > 0) return false;

  state.cooldownSec = FP_LANDING_SOUND_COOLDOWN_SEC;
  return true;
}
