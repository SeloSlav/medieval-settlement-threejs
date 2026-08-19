import {
  CHAPEL_BELL_EVENING_HOUR,
  CHAPEL_BELL_MORNING_HOUR,
  CHAPEL_BELL_NOON_HOUR,
  isChapelBellHour,
} from '../src/audio/chapelBellSchedule.ts';
import {
  ANGELUS_GROUP_PAUSE_SECONDS,
  ANGELUS_STROKE_GROUPS,
  ANGELUS_STROKE_INTERVAL_SECONDS,
  ANGELUS_STROKE_TIMES_SECONDS,
  CHAPEL_BELL_CUTOFF_DISTANCE,
  CHAPEL_BELL_CUTOFF_ORBIT_DISTANCE,
  ChapelBellPlayer,
  chapelBellGain,
} from '../src/audio/ChapelBellPlayer.ts';
import { BuildingAudio } from '../src/audio/BuildingAudio.ts';
import { CHAPEL_BELL_CLIPS } from '../src/audio/audioCatalog.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(isChapelBellHour(CHAPEL_BELL_MORNING_HOUR), 'morning Angelus hour');
assert(isChapelBellHour(CHAPEL_BELL_NOON_HOUR), 'noon Angelus hour');
assert(isChapelBellHour(CHAPEL_BELL_EVENING_HOUR), 'evening Angelus hour');
assert(!isChapelBellHour(0), 'midnight is not an Angelus hour');
assert(CHAPEL_BELL_MORNING_HOUR === 6, 'morning Angelus at 6 AM');
assert(CHAPEL_BELL_NOON_HOUR === 12, 'midday Angelus at noon');
assert(CHAPEL_BELL_EVENING_HOUR === 18, 'evening Angelus at 6 PM');

assert(
  ANGELUS_STROKE_GROUPS.join(',') === '3,3,3,9',
  'Angelus groups must remain 3, pause, 3, pause, 3, pause, 9',
);
assert(ANGELUS_STROKE_TIMES_SECONDS.length === 18, 'Angelus must total 18 strokes');
let strokeIndex = 0;
for (let groupIndex = 0; groupIndex < ANGELUS_STROKE_GROUPS.length; groupIndex += 1) {
  const strokeCount = ANGELUS_STROKE_GROUPS[groupIndex] ?? 0;
  for (let stroke = 1; stroke < strokeCount; stroke += 1) {
    const prior = ANGELUS_STROKE_TIMES_SECONDS[strokeIndex + stroke - 1] ?? 0;
    const next = ANGELUS_STROKE_TIMES_SECONDS[strokeIndex + stroke] ?? 0;
    assert(
      Math.abs(next - prior - ANGELUS_STROKE_INTERVAL_SECONDS) < 1e-9,
      'strokes within each Angelus group must retain the measured cadence',
    );
  }
  strokeIndex += strokeCount;
  if (groupIndex < ANGELUS_STROKE_GROUPS.length - 1) {
    const prior = ANGELUS_STROKE_TIMES_SECONDS[strokeIndex - 1] ?? 0;
    const next = ANGELUS_STROKE_TIMES_SECONDS[strokeIndex] ?? 0;
    assert(
      Math.abs(next - prior - ANGELUS_GROUP_PAUSE_SECONDS) < 1e-9,
      'Angelus prayer groups must retain the longer pause',
    );
  }
}

assert(
  chapelBellGain([{ x: 0, z: 0 }], { x: 0, z: 0 }, 24) > 0.99,
  'a close chapel should ring at full spatial gain',
);
assert(
  chapelBellGain(
    [{ x: 0, z: 0 }],
    { x: CHAPEL_BELL_CUTOFF_DISTANCE, z: 0 },
    24,
  ) === 0,
  'bells should be inaudible past their world-space cutoff',
);
assert(
  chapelBellGain(
    [{ x: 0, z: 0 }],
    { x: 0, z: 0 },
    CHAPEL_BELL_CUTOFF_ORBIT_DISTANCE,
  ) === 0,
  'bells should fade out at far overview zoom',
);

const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
const playedPaths: string[] = [];
const playedRates: number[] = [];
class FakeBellAudioElement {
  paused = true;
  currentTime = 0;
  duration = 8;
  volume = 0;
  playbackRate = 1;
  preload = '';
  src = '';
  loop = false;

  pause(): void {
    this.paused = true;
  }

  play(): Promise<void> {
    this.paused = false;
    playedPaths.push(this.src);
    playedRates.push(this.playbackRate);
    return Promise.resolve();
  }

  removeAttribute(): void {
    this.src = '';
  }
}
Object.defineProperty(globalThis, 'Audio', {
  configurable: true,
  writable: true,
  value: FakeBellAudioElement,
});
try {
  const player = new ChapelBellPlayer();
  const chapel = { x: 0, z: 0, tier: 2 as const };
  const tick = (dtSeconds: number, calendarMinute: number, clockHour: number): void => {
    player.tick({
      dtSeconds,
      calendarMinute,
      clockHour,
      chapels: [chapel],
      listener: { x: 0, z: 0 },
      orbitDistance: 24,
      enabled: true,
    });
  };
  tick(0, 359, 5);
  tick(0.1, 360, 6);
  for (let frame = 0; frame < 600; frame += 1) tick(0.1, 360, 6);
  assert(playedPaths.length === 18, 'one Angelus prayer must play exactly 18 strokes');
  assert(
    playedPaths.every((path) => path === CHAPEL_BELL_CLIPS[2].path)
    && playedRates.every((rate) => rate === 1),
    'the Angelus must use the nearest church tier bell without pitch-speed changes',
  );
  player.dispose();

  const buildingAudio = new BuildingAudio();
  buildingAudio.playChapel(3, 'building:test-tier-3-church');
  assert(
    playedPaths.at(-1) === CHAPEL_BELL_CLIPS[3].path
    && playedRates.at(-1) === 1,
    'selecting a church must play its tier bell once at exactly 1.0x speed',
  );
  buildingAudio.dispose();
} finally {
  if (audioDescriptor) {
    Object.defineProperty(globalThis, 'Audio', audioDescriptor);
  } else {
    delete (globalThis as { Audio?: unknown }).Audio;
  }
}

console.log('chapel bell schedule tests passed');
