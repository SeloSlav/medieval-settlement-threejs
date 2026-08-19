import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATTAIL_CARD_REFERENCE_HEIGHT,
  CATTAIL_HEIGHT_PROFILE,
  sampleCattailHeightMeters,
} from '../vendor/seedthree/src/core/cattails.js';
import {
  ensureCattailEmergenceHeightMeters,
  REED_MAX_WATERLINE_FRACTION,
} from '../src/rivers/RiverReedHeight.ts';

function sequenceRandom(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

assert.equal(CATTAIL_CARD_REFERENCE_HEIGHT, 1);

const youngHeight = sampleCattailHeightMeters(0, sequenceRandom(0.01, 0.5));
const matureHeight = sampleCattailHeightMeters(0.5, sequenceRandom(0.5, 0.5));
const tallHeight = sampleCattailHeightMeters(1, sequenceRandom(0.99, 0.8));

assert.ok(
  youngHeight >= CATTAIL_HEIGHT_PROFILE.youngMinMeters
    && youngHeight <= CATTAIL_HEIGHT_PROFILE.youngMaxMeters,
);
assert.ok(
  matureHeight >= CATTAIL_HEIGHT_PROFILE.matureMinMeters
    && matureHeight <= CATTAIL_HEIGHT_PROFILE.matureMaxMeters,
);
assert.ok(
  tallHeight >= CATTAIL_HEIGHT_PROFILE.tallMinMeters
    && tallHeight <= CATTAIL_HEIGHT_PROFILE.tallMaxMeters,
);
assert.ok(tallHeight > 2.75, 'wet-edge cattails must include specimens taller than a person');
assert.ok(
  tallHeight - youngHeight > 1.7,
  'mixed-age stands need a clearly readable first-person height range',
);

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const riverReedSource = readFileSync(`${projectRoot}src/rivers/RiverReeds.ts`, 'utf8');
assert.match(
  riverReedSource,
  /heightMeters:\s*resolveSubmergedReedHeightMeters\([\s\S]*?size\.heightScale/,
);
assert.match(riverReedSource, /sampleCattailHeightMeters\(1\s*-\s*shoreT,\s*rng\)/);
assert.match(
  riverReedSource,
  /placement\.heightMeters\s*\/\s*CATTAIL_CARD_REFERENCE_HEIGHT/,
);
assert.match(
  riverReedSource,
  /REED_HEIGHT_MIN_METERS\s*=\s*0\.62[\s\S]*?REED_HEIGHT_MAX_METERS\s*=\s*3\.35/,
  'river placement must broaden the authored cohorts without losing cattail-scale bounds',
);
assert.doesNotMatch(
  riverReedSource,
  /REED_HEIGHT_MULTIPLIER/,
  'river cattails must use physical SeedThree height cohorts, not an ambiguous app multiplier',
);
const shallowWaterHeight = ensureCattailEmergenceHeightMeters(matureHeight, 1.05);
assert.ok(
  1.05 / shallowWaterHeight <= REED_MAX_WATERLINE_FRACTION + 1e-9,
  'a riverbed-rooted cattail must retain a visible crown above the local waterline',
);

console.log(
  `Cattail height profile passed: young ${youngHeight.toFixed(2)} m, `
    + `mature ${matureHeight.toFixed(2)} m, tall ${tallHeight.toFixed(2)} m.`,
);
