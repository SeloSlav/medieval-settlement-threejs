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
const clipChannels = new WeakMap<THREE.AnimationClip, string>();

export type AuthoredAnimationPose = {
  primary: THREE.AnimationAction | null;
  secondary: THREE.AnimationAction | null;
  blend: number;
};

function channels(clip: THREE.AnimationClip): string {
  let key = clipChannels.get(clip);
  if (key === undefined) { key = clip.tracks.map(track => track.name).sort().join('\n'); clipChannels.set(clip, key); }
  return key;
}

/**
 * Keep Three 0.185's exact action clock, looping, pausing and rate semantics.
 * A steady, full-weight clip can evaluate its original keys on the GPU instead
 * of sampling every property into an otherwise unobserved CPU skeleton.
 * Matching-channel crossfades can publish both clocks to an optional pose target.
 * Additive animation and event-observed mixers use normal evaluation.
 */
export function advanceAuthoredAnimationClock(
  mixer: THREE.AnimationMixer,
  dt: number,
  supportsClip: (clip: THREE.AnimationClip) => boolean,
  pose?: AuthoredAnimationPose,
): THREE.AnimationAction | null {
  const clock = mixer as ClockMixer;
  let single: ClockAction | null = null;
  let secondary: ClockAction | null = null;
  if (pose) { pose.primary = null; pose.secondary = null; pose.blend = 0; }
  let supported = !clock._listeners || Object.keys(clock._listeners).length === 0;
  for (let i = 0; i < clock._nActiveActions && supported; i++) {
    const action = clock._actions[i]!;
    if (!action.enabled) continue;
    if ((!pose && action._weightInterpolant !== null) || action._startTime !== null) {
      supported = false;
      break;
    }
    if (action.weight === 0) continue;
    if ((!pose && single) || secondary || action.weight !== 1 || action.blendMode !== THREE.NormalAnimationBlendMode
      || action.loop === THREE.LoopPingPong || !supportsClip(action.getClip())) {
      supported = false;
      break;
    }
    if (single) secondary = action; else single = action;
  }
  if (single && secondary && channels(single.getClip()) !== channels(secondary.getClip())) supported = false;
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
  const secondaryInterpolants = secondary?._interpolants;
  const bindings = clock._nActiveBindings;
  single._interpolants = NO_TRACK_EVALUATION;
  if (secondary) secondary._interpolants = NO_TRACK_EVALUATION;
  clock._nActiveBindings = 0;
  try {
    mixer.update(dt);
  } finally {
    single._interpolants = interpolants;
    if (secondary) secondary._interpolants = secondaryInterpolants!;
    clock._nActiveBindings = bindings;
  }
  const primaryWeight = single.getEffectiveWeight();
  const secondaryWeight = secondary?.getEffectiveWeight() ?? 0;
  // Complementary fade interpolants are Float32 values. Only accept their
  // rounding-sized deviation from unit weight; partial/rest-pose blends retain
  // normal PropertyMixer evaluation. Preserve active action order for slerp.
  const totalWeight = primaryWeight + secondaryWeight;
  if ((!pose && (!single.enabled || primaryWeight !== 1))
    || (pose && (primaryWeight < 0 || secondaryWeight < 0 || Math.abs(totalWeight - 1) > 6e-8))) {
    mixer.update(0);
    return null;
  }
  if (pose) {
    pose.primary = single;
    pose.secondary = secondary;
    pose.blend = secondaryWeight / totalWeight;
  }
  return single;
}
