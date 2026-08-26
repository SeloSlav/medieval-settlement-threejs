import assert from 'node:assert/strict';
import {
  createFpFootstepCadenceState,
  FP_CROUCH_STEP_LENGTH_METERS,
  fpFootstepCadenceHz,
  fpFootstepStepLengthMeters,
  FP_SPRINT_STEP_LENGTH_METERS,
  FP_WALK_STEP_LENGTH_METERS,
  resetFpFootstepCadenceState,
  resolveFpFootstepGait,
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
  FP_CROUCH_STEP_LENGTH_METERS.max < FP_WALK_STEP_LENGTH_METERS.max
  && FP_WALK_STEP_LENGTH_METERS.max < FP_SPRINT_STEP_LENGTH_METERS.max,
  'crouch, walk, and sprint need clearly separated full-speed step lengths',
);
assert.ok(
  fpFootstepCadenceHz('crouch', 1) >= 2.2
  && fpFootstepCadenceHz('walk', 1) >= 2.9
  && fpFootstepCadenceHz('sprint', 1) >= 4.5,
  'full-speed cadence must match the unusually fast first-person travel speeds',
);
assert.ok(
  Math.abs(
    fpFootstepCadenceHz('walk', 1)
    - fpFootstepCadenceHz('sprint', 2.9 / 11)
  ) <= 0.1,
  'walk and sprint stride curves must meet without a cadence jump',
);
assert.equal(
  resolveFpFootstepGait({
    crouching: false,
    sprinting: false,
    horizontalSpeedMps: 8,
  }, 'sprint'),
  'sprint',
  'releasing sprint must retain the running gait while momentum is high',
);
assert.equal(
  resolveFpFootstepGait({
    crouching: false,
    sprinting: false,
    horizontalSpeedMps: 2.7,
  }, 'sprint'),
  'walk',
  'the running gait should hand back after decelerating into walking speed',
);

function simulate(
  gait: Exclude<FootstepGait, 'landing'>,
  seconds = 5,
  frameRate = 120,
): Array<{ time: number; distance: number; motion: FootstepMotion }> {
  const state = createFpFootstepCadenceState();
  const frameSeconds = 1 / frameRate;
  const speed = gait === 'crouch' ? 1.8 : gait === 'sprint' ? 11 : 2.9;
  const contacts: Array<{ time: number; distance: number; motion: FootstepMotion }> = [];
  let distance = 0;
  for (let time = 0; time < seconds; time += frameSeconds) {
    const traveledMeters = speed * frameSeconds;
    distance += traveledMeters;
    const motion = stepFpFootstepCadence(state, {
      traveledMeters,
      horizontalSpeedMps: speed,
      moving: true,
      grounded: true,
      crouching: gait === 'crouch',
      sprinting: gait === 'sprint',
    });
    if (motion) contacts.push({ time, distance, motion });
  }
  return contacts;
}

const crouchContacts = simulate('crouch');
const walkContacts = simulate('walk');
const sprintContacts = simulate('sprint');
assert.ok(
  crouchContacts.length >= 11 && crouchContacts.length <= 13,
  `five crouched seconds should produce about twelve contacts, got ${crouchContacts.length}`,
);
assert.ok(
  walkContacts.length >= 15 && walkContacts.length <= 16,
  `five walking seconds should produce about fifteen contacts, got ${walkContacts.length}`,
);
assert.ok(
  sprintContacts.length >= 23 && sprintContacts.length <= 25,
  `five sprinting seconds should produce about twenty-four contacts, got ${sprintContacts.length}`,
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
for (const gait of ['crouch', 'walk', 'sprint'] as const) {
  assert.ok(
    Math.abs(simulate(gait, 5, 30).length - simulate(gait, 5, 144).length) <= 1,
    `${gait} contact count must remain stable across frame rates`,
  );
}
for (const [gait, contacts] of [
  ['crouch', crouchContacts],
  ['walk', walkContacts],
  ['sprint', sprintContacts],
] as const) {
  const expectedStepLength = fpFootstepStepLengthMeters(gait, 1);
  for (let index = 2; index < contacts.length; index += 1) {
    const contactDistance = contacts[index].distance - contacts[index - 1].distance;
    assert.ok(
      Math.abs(contactDistance - expectedStepLength) <= 0.1,
      `${gait} contacts must remain locked to distance traveled`,
    );
  }
}

const stopped = createFpFootstepCadenceState();
for (let frame = 0; frame < 240; frame += 1) {
  assert.equal(stepFpFootstepCadence(stopped, {
    traveledMeters: 0,
    horizontalSpeedMps: 0,
    moving: false,
    grounded: true,
    crouching: false,
    sprinting: false,
  }), null, 'standing still must never advance a hidden footstep loop');
}
const blocked = createFpFootstepCadenceState();
for (let frame = 0; frame < 240; frame += 1) {
  assert.equal(stepFpFootstepCadence(blocked, {
    traveledMeters: 0,
    horizontalSpeedMps: 11,
    moving: true,
    grounded: true,
    crouching: false,
    sprinting: true,
  }), null, 'velocity against a wall must not produce stationary footsteps');
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
