import assert from 'node:assert/strict';
import {
  createFpFootstepCadenceState,
  FP_CROUCH_STEP_CADENCE_HZ,
  fpFootstepCadenceHz,
  FP_SPRINT_STEP_CADENCE_HZ,
  FP_WALK_STEP_CADENCE_HZ,
  resetFpFootstepCadenceState,
  stepFpFootstepCadence,
  takeFpLandingFootstep,
} from '../src/camera/fp/fpFootstepCadence.ts';
import {
  buildFootstepVariantBag,
  resolveFootstepPlaybackTuning,
} from '../src/audio/footstepPlayback.ts';
import type {
  FootstepEvent,
  FootstepGait,
  FootstepMotion,
  FootstepSurface,
} from '../src/audio/audioCatalog.ts';
import { WorldFoleyAudio } from '../src/audio/WorldFoleyAudio.ts';

assert.ok(
  FP_CROUCH_STEP_CADENCE_HZ.max < FP_WALK_STEP_CADENCE_HZ.max
  && FP_WALK_STEP_CADENCE_HZ.max < FP_SPRINT_STEP_CADENCE_HZ.max,
  'crouch, walk, and sprint need clearly separated maximum cadences',
);
assert.ok(
  fpFootstepCadenceHz('crouch', 1) >= 1.5
  && fpFootstepCadenceHz('walk', 1) >= 2
  && fpFootstepCadenceHz('sprint', 1) >= 3.4,
  'full-speed cadence should reach authored human gait targets',
);

function simulate(
  gait: Exclude<FootstepGait, 'landing'>,
  seconds = 5,
): Array<{ time: number; motion: FootstepMotion }> {
  const state = createFpFootstepCadenceState();
  const frameSeconds = 1 / 120;
  const speed = gait === 'crouch' ? 1.8 : gait === 'sprint' ? 11 : 2.9;
  const contacts: Array<{ time: number; motion: FootstepMotion }> = [];
  for (let time = 0; time < seconds; time += frameSeconds) {
    const motion = stepFpFootstepCadence(state, {
      dtSeconds: frameSeconds,
      horizontalSpeedMps: speed,
      moving: true,
      grounded: true,
      crouching: gait === 'crouch',
      sprinting: gait === 'sprint',
    });
    if (motion) contacts.push({ time, motion });
  }
  return contacts;
}

const crouchContacts = simulate('crouch');
const walkContacts = simulate('walk');
const sprintContacts = simulate('sprint');
assert.ok(
  crouchContacts.length >= 7 && crouchContacts.length <= 9,
  `five crouched seconds should produce about eight contacts, got ${crouchContacts.length}`,
);
assert.ok(
  walkContacts.length >= 10 && walkContacts.length <= 12,
  `five walking seconds should produce about eleven contacts, got ${walkContacts.length}`,
);
assert.ok(
  sprintContacts.length >= 17 && sprintContacts.length <= 19,
  `five sprinting seconds should produce about eighteen contacts, got ${sprintContacts.length}`,
);
for (const contacts of [crouchContacts, walkContacts, sprintContacts]) {
  for (let index = 1; index < contacts.length; index += 1) {
    assert.notEqual(
      contacts[index].motion.side,
      contacts[index - 1].motion.side,
      'successive contacts must alternate left and right feet',
    );
  }
}

const stopped = createFpFootstepCadenceState();
for (let frame = 0; frame < 240; frame += 1) {
  assert.equal(stepFpFootstepCadence(stopped, {
    dtSeconds: 1 / 60,
    horizontalSpeedMps: 0,
    moving: false,
    grounded: true,
    crouching: false,
    sprinting: false,
  }), null, 'standing still must never advance a hidden footstep loop');
}
resetFpFootstepCadenceState(stopped);
const landingA = takeFpLandingFootstep(stopped, 0);
const landingB = takeFpLandingFootstep(stopped, 7);
assert.equal(landingA.gait, 'landing');
assert.notEqual(landingA.side, landingB.side, 'landings must retain foot alternation');

const surfaces: FootstepSurface[] = [
  'grass',
  'forest',
  'dirt',
  'timber',
  'stone',
  'water',
];
for (const surface of surfaces) {
  let previous = 0;
  const used = new Set<number>();
  for (let bagSequence = 0; bagSequence < 12; bagSequence += 1) {
    const bag = buildFootstepVariantBag(surface, bagSequence, previous);
    assert.deepEqual(
      [...bag].sort(),
      [1, 2, 3],
      `${surface} must play every take exactly once per shuffled bag`,
    );
    for (const variant of bag) {
      assert.notEqual(variant, previous, `${surface} must not repeat a take immediately`);
      used.add(variant);
      previous = variant;
    }
  }
  assert.equal(used.size, 3, `${surface} should use all three authored takes`);
}

function tuning(
  gait: FootstepGait,
  side: FootstepEvent['side'],
  sequence: number,
): ReturnType<typeof resolveFootstepPlaybackTuning> {
  return resolveFootstepPlaybackTuning({
    surface: 'dirt',
    gait,
    side,
    speedRatio: 1,
  }, sequence);
}

const crouchTuning = tuning('crouch', 'left', 2);
const walkTuning = tuning('walk', 'left', 2);
const sprintTuning = tuning('sprint', 'left', 2);
assert.ok(
  crouchTuning.gain < walkTuning.gain && walkTuning.gain < sprintTuning.gain,
  'contact weight should rise from crouch to walk to sprint',
);
assert.notEqual(
  tuning('walk', 'left', 7).playbackRate,
  tuning('walk', 'right', 7).playbackRate,
  'the two shoes need subtly different pitch identities',
);
const rates = new Set(
  Array.from({ length: 20 }, (_, sequence) => (
    tuning('walk', sequence % 2 === 0 ? 'left' : 'right', sequence).playbackRate
  )),
);
assert.ok(rates.size >= 12, 'seeded pitch variation should avoid a mechanical cycle');
for (const rate of rates) {
  assert.ok(rate >= 0.92 && rate <= 1.12, 'pitch variation must remain believable');
}

const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
const played: Array<{
  path: string;
  playbackRate: number;
  preservesPitch: boolean;
}> = [];
class FakeFootstepAudio {
  paused = true;
  volume = 0;
  currentTime = 0;
  duration = 1;
  playbackRate = 1;
  preservesPitch = true;
  preload = '';
  src = '';

  pause(): void {
    this.paused = true;
  }

  play(): Promise<void> {
    this.paused = false;
    played.push({
      path: this.src,
      playbackRate: this.playbackRate,
      preservesPitch: this.preservesPitch,
    });
    return Promise.resolve();
  }

  removeAttribute(): void {
    this.src = '';
  }
}
Object.defineProperty(globalThis, 'Audio', {
  configurable: true,
  writable: true,
  value: FakeFootstepAudio,
});
try {
  const foley = new WorldFoleyAudio();
  for (let sequence = 0; sequence < 7; sequence += 1) {
    foley.playFootstep({
      surface: 'dirt',
      gait: 'walk',
      side: sequence % 2 === 0 ? 'left' : 'right',
      speedRatio: 1,
    });
  }
  assert.equal(played.length, 7, 'each cadence contact must emit one one-shot');
  assert.equal(
    new Set(played.slice(0, 3).map(({ path }) => path)).size,
    3,
    'the first shuffled bag must use all three dirt takes',
  );
  for (let index = 1; index < played.length; index += 1) {
    assert.notEqual(
      played[index].path,
      played[index - 1].path,
      'runtime playback must not repeat the same recording back-to-back',
    );
  }
  assert.ok(
    played.every(({ preservesPitch }) => !preservesPitch),
    'footstep rate variation must disable browser pitch preservation',
  );
  assert.ok(
    new Set(played.map(({ playbackRate }) => playbackRate)).size >= 5,
    'runtime contacts need audible micro-pitch variation',
  );
  foley.dispose();
} finally {
  if (audioDescriptor) {
    Object.defineProperty(globalThis, 'Audio', audioDescriptor);
  } else {
    delete (globalThis as { Audio?: unknown }).Audio;
  }
}

console.log('test:first-person-footsteps passed');
