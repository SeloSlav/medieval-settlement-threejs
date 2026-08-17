import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  FOREST_WIND_CLIP_VOLUME,
  FOREST_WIND_FADE_IN_SECONDS,
  FOREST_WIND_FADE_OUT_SECONDS,
  SEEDTHREE_TEMPERATE_WIND_URL,
} from '../src/audio/ForestWindAudio.ts';
import {
  FOREST_WIND_FIRST_PERSON_FLOOR,
  FOREST_WIND_SILENT_RTS_DISTANCE,
  forestWindTargetMix,
} from '../src/audio/forestWindRules.ts';

const windPath = fileURLToPath(SEEDTHREE_TEMPERATE_WIND_URL);
const windStat = await stat(windPath);
const header = await readFile(windPath);

assert.ok(windStat.isFile() && windStat.size > 1_000_000, 'SeedThree wind WAV must be present');
assert.equal(header.toString('ascii', 0, 4), 'RIFF', 'SeedThree wind must have a RIFF header');
assert.equal(header.toString('ascii', 8, 12), 'WAVE', 'SeedThree wind must be a WAV asset');

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

console.log('test:forest-wind-audio passed');
