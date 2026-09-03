import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ForestWindAudio,
  FOREST_WIND_CLIP_VOLUME,
  FOREST_WIND_FADE_IN_SECONDS,
  FOREST_WIND_FADE_OUT_SECONDS,
  FOREST_WIND_URL,
} from '../src/audio/ForestWindAudio.ts';
import {
  FOREST_WIND_FIRST_PERSON_FLOOR,
  FOREST_WIND_SILENT_RTS_DISTANCE,
  forestWindTargetMix,
} from '../src/audio/forestWindRules.ts';
import { FireAudio } from '../src/audio/FireAudio.ts';

const windPath = fileURLToPath(new URL(`../public${FOREST_WIND_URL}`, import.meta.url));
const windStat = await stat(windPath);
const header = await readFile(windPath);
const controllerSource = await readFile(
  fileURLToPath(new URL('../src/audio/AmbientAudioController.ts', import.meta.url)),
  'utf8',
);
const villagerRendererSource = await readFile(
  fileURLToPath(new URL('../src/settlement/VillagerRenderer.ts', import.meta.url)),
  'utf8',
);

assert.ok(windStat.isFile() && windStat.size > 100_000, 'forest wind MP3 must be present');
assert.equal(header.toString('ascii', 0, 3), 'ID3', 'forest wind must retain its MP3 container');

assert.equal(
  forestWindTargetMix({
    canopyCover: 1,
    orbitDistance: FOREST_WIND_SILENT_RTS_DISTANCE,
    firstPersonActive: false,
  }),
  0,
  'strategic views must not hear the close forest bed',
);
assert.equal(
  forestWindTargetMix({ canopyCover: 0, orbitDistance: 12, firstPersonActive: false }),
  0,
  'close RTS views outside the forest must remain silent',
);
assert.equal(
  forestWindTargetMix({ canopyCover: 1, orbitDistance: 12, firstPersonActive: false }),
  1,
  'close RTS views under dense canopy must reach the full forest bed',
);
assert.equal(
  forestWindTargetMix({ canopyCover: 0, orbitDistance: 240, firstPersonActive: true }),
  FOREST_WIND_FIRST_PERSON_FLOOR,
  'first person must retain a faint open-ground breeze',
);
assert.equal(
  forestWindTargetMix({ canopyCover: 1, orbitDistance: 240, firstPersonActive: true }),
  1,
  'first person under canopy must reach the full forest bed',
);
assert.ok(
  FOREST_WIND_CLIP_VOLUME <= 0.05
  && FOREST_WIND_FADE_IN_SECONDS >= 2
  && FOREST_WIND_FADE_OUT_SECONDS > FOREST_WIND_FADE_IN_SECONDS,
  'forest wind must remain subtle and fade out more slowly than it fades in',
);

const worldPauseBody = controllerSource.match(
  /setWorldPaused\(paused: boolean\): void \{([\s\S]*?)\n  \}/,
)?.[1];
assert.ok(worldPauseBody, 'the ambient controller must expose a world-pause audio boundary');
assert.match(worldPauseBody, /this\.audio\.setPaused\(paused\)/, 'world pause must silence ambient beds');
assert.match(worldPauseBody, /this\.forestWind\.setPaused\(paused\)/, 'world pause must silence forest wind');
assert.match(worldPauseBody, /this\.riverAudio\.setPaused\(paused\)/, 'world pause must silence river audio');
assert.match(worldPauseBody, /this\.fireAudio\.setPaused\(paused\)/, 'world pause must silence fire ambience');
assert.doesNotMatch(worldPauseBody, /soundtrack/, 'world pause must leave background music playing');
assert.match(
  controllerSource,
  /tick\(dtSeconds: number\): void \{[\s\S]*?this\.soundtrack\.tick\(dtSeconds\);\s*if \(this\.worldPaused\) return;/,
  'paused audio ticks must continue only far enough to advance the background soundtrack',
);
assert.match(
  villagerRendererSource,
  /const audioPaused = this\.getGameSpeed\(\) === 0;\s*this\.farmWorkerSongAudio\.setPaused\(audioPaused\)/,
  'world pause must silence the diegetic farm-worker song',
);

const preferenceStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => preferenceStorage.get(key) ?? null,
    setItem: (key: string, value: string) => preferenceStorage.set(key, value),
  },
});
const preferences = await import('../src/audio/audioPreferences.ts');
assert.equal(preferences.isForestWindEnabled(), false, 'forest wind must be opt-in by default');
preferences.setForestWindEnabled(true);
assert.equal(preferences.isForestWindEnabled(), true, 'forest wind preference must update immediately');
assert.equal(
  preferenceStorage.get('medieval-road-system:forest-wind-enabled'),
  '1',
  'forest wind preference must persist independently from master ambience',
);
assert.equal(
  preferences.getSoundEffectsVolume(),
  preferences.DEFAULT_SOUND_EFFECTS_VOLUME,
  'sound effects must begin at their documented default mix',
);
preferences.setSoundEffectsVolume(0.35);
assert.equal(preferences.getSoundEffectsVolume(), 0.35, 'sound effects volume must update immediately');
assert.equal(
  preferenceStorage.get('medieval-road-system:sound-effects-volume'),
  '0.35',
  'sound effects volume must persist independently from ambience',
);

class FakeAudio {
  static readonly instances: FakeAudio[] = [];
  readonly src: string;
  loop = false;
  preload = '';
  volume = 0;
  currentTime = 0;
  paused = true;
  pauseCalls = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(): void {}

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  removeAttribute(): void {}
}

Object.defineProperty(globalThis, 'Audio', {
  configurable: true,
  value: FakeAudio,
});
const forestWind = new ForestWindAudio();
forestWind.setTargetMix(1);
const playingWind = FakeAudio.instances[0]!;
playingWind.paused = false;
playingWind.currentTime = 12.5;
forestWind.setPaused(true);
assert.equal(playingWind.paused, true, 'pausing the world must silence active forest wind immediately');
assert.equal(playingWind.pauseCalls, 1, 'world pause must issue exactly one audio pause transition');
assert.equal(
  playingWind.currentTime,
  12.5,
  'world pause must retain the loop position so resume does not restart the wind bed',
);
forestWind.tick(10);
assert.equal(playingWind.pauseCalls, 1, 'paused ticks must not restart or repeatedly pause forest wind');
forestWind.setPaused(false);
forestWind.dispose();

const fireAudio = new FireAudio({
  getListener: () => ({ x: 0, z: 0 }),
  getOrbitDistance: () => 12,
  getFireIncidents: () => [],
});
const playingFire = new FakeAudio('fire');
playingFire.paused = false;
playingFire.currentTime = 7.25;
Object.assign(
  fireAudio as unknown as { audio: FakeAudio },
  { audio: playingFire },
);
fireAudio.setPaused(true);
assert.equal(playingFire.paused, true, 'pausing the world must silence active fire ambience immediately');
assert.equal(playingFire.currentTime, 7.25, 'world pause must retain the fire-loop position');

const { FarmWorkerSongAudio } = await import('../src/audio/FarmWorkerSongAudio.ts');
const farmSong = new FarmWorkerSongAudio();
const playingFarmSong = new FakeAudio('farm-song');
playingFarmSong.paused = false;
playingFarmSong.currentTime = 18.75;
Object.assign(
  farmSong as unknown as { audio: FakeAudio },
  { audio: playingFarmSong },
);
farmSong.setPaused(true);
assert.equal(playingFarmSong.paused, true, 'pausing the world must silence active farm singing immediately');
assert.equal(playingFarmSong.currentTime, 18.75, 'world pause must retain the farm-song position');

console.log('test:forest-wind-audio passed');
