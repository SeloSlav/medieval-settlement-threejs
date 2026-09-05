import * as THREE from 'three';

type ClockAction = THREE.AnimationAction & {
  _interpolants: unknown[];
  _weightInterpolant: unknown | null;
  _startTime: number | null;
};
type ClockMixer = THREE.AnimationMixer & {
  _actions: ClockAction[];
  _nActiveActions: number;
  _nActiveBindings: number;
  _listeners?: Record<string, unknown[]>;
};
const NO_TRACK_EVALUATION: unknown[] = [];

/**
 * Keep Three 0.185's exact action clock, looping, pausing and rate semantics.
 * A steady, full-weight clip can evaluate its original keys on the GPU instead
 * of sampling every property into an otherwise unobserved CPU skeleton.
 * Transitions, additive animation and event-observed mixers use normal evaluation.
 */
export function advanceAuthoredAnimationClock(
  mixer: THREE.AnimationMixer,
  dt: number,
  supportsClip: (clip: THREE.AnimationClip) => boolean,
): THREE.AnimationAction | null {
  const clock = mixer as ClockMixer;
  let single: ClockAction | null = null;
  let supported = !clock._listeners || Object.keys(clock._listeners).length === 0;
  for (let i = 0; i < clock._nActiveActions && supported; i++) {
    const action = clock._actions[i]!;
    if (!action.enabled) continue;
    if (action._weightInterpolant !== null || action._startTime !== null) {
      supported = false;
      break;
    }
    if (action.weight === 0) continue;
    if (single || action.weight !== 1 || action.blendMode !== THREE.NormalAnimationBlendMode
      || action.loop === THREE.LoopPingPong || !supportsClip(action.getClip())) {
      supported = false;
      break;
    }
    single = action;
  }
  if (!supported || !single) {
    mixer.update(dt);
    return null;
  }

  // This narrow shim depends on AnimationAction._update iterating interpolants
  // and AnimationMixer.update applying active bindings after action clocks.
  // Do not replace binding objects, action ordering, or the public clip itself.
  // Event listeners are excluded so callbacks cannot mutate the binding pool
  // while its evaluation count is temporarily suppressed.
  const interpolants = single._interpolants;
  const bindings = clock._nActiveBindings;
  single._interpolants = NO_TRACK_EVALUATION;
  clock._nActiveBindings = 0;
  try {
    mixer.update(dt);
  } finally {
    single._interpolants = interpolants;
    clock._nActiveBindings = bindings;
  }
  if (!single.enabled || single.getEffectiveWeight() !== 1) {
    mixer.update(0);
    return null;
  }
  return single;
}
