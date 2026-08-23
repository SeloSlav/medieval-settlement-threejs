import assert from 'node:assert/strict';
import {
  droughtGroundwaterScore,
  sampleAquiferPotential,
  sampleAuthoritativeGroundwaterScore,
  sampleAuthoritativeWellGroundwaterScore,
  sampleWellGroundwaterScoreForWorldRules,
  sampleWorldGroundwaterScore,
  UNIFORM_GROUNDWATER_SCORE,
} from '../src/hydrology/sampleAuthoritativeHydrology.ts';
import { DROUGHT_GROUNDWATER_MULTIPLIER } from '../src/generated/gameBalance.ts';
import { groundwaterOverlayAlpha } from '../src/hydrology/HydrologyOverlay.ts';
import { setDraftWorldGeneration } from '../src/world/worldGenerationContext.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

const seed = 0x071a2e0d;
const inlandScores: number[] = [];
for (let z = -420; z <= 420; z += 35) {
  for (let x = -420; x <= 420; x += 35) {
    inlandScores.push(sampleWorldGroundwaterScore(x, z, seed, 50));
  }
}

const minimum = Math.min(...inlandScores);
const maximum = Math.max(...inlandScores);
assert.ok(maximum - minimum > 0.55, 'inland aquifers should span several well-quality grades');
assert.ok(inlandScores.some((score) => score < 0.22), 'the map should retain genuinely dry inland sites');
assert.ok(inlandScores.some((score) => score >= 0.62), 'the map should contain good inland well sites');

const dryWorld = sampleWorldGroundwaterScore(280, 220, seed, 0);
const normalWorld = sampleWorldGroundwaterScore(280, 220, seed, 50);
const wetWorld = sampleWorldGroundwaterScore(280, 220, seed, 100);
assert.ok(dryWorld < normalWorld && normalWorld < wetWorld, 'world hydrology should move the water table');
assert.equal(
  droughtGroundwaterScore(normalWorld),
  normalWorld * DROUGHT_GROUNDWATER_MULTIPLIER,
  'summer drought should lower the same underground water table used by wells and fields',
);
assert.ok(
  Math.abs(normalWorld - 0.7774959605958065) < 1e-12,
  'the client sampler must retain the server-parity groundwater contract',
);

const alternateSeed = sampleWorldGroundwaterScore(280, 220, 0x6b712345, 50);
assert.ok(Math.abs(normalWorld - alternateSeed) > 0.25, 'world seeds should move inland aquifer pockets');

const uniformWellA = sampleWellGroundwaterScoreForWorldRules(-360, 260, seed, 50, false);
const uniformWellB = sampleWellGroundwaterScoreForWorldRules(900, -900, seed, 0, false);
assert.equal(uniformWellA, UNIFORM_GROUNDWATER_SCORE);
assert.equal(uniformWellB, UNIFORM_GROUNDWATER_SCORE);
assert.equal(
  sampleWellGroundwaterScoreForWorldRules(280, 220, seed, 50, true),
  normalWorld,
  'enabled well aquifers must use the seeded groundwater network',
);
assert.equal(sampleWellGroundwaterScoreForWorldRules(10_000, 10_000, seed, 50, false), 0);
assert.equal(
  sampleAuthoritativeWellGroundwaterScore(-360, 260),
  UNIFORM_GROUNDWATER_SCORE,
  'the default world must give every valid well site the same reliable yield',
);
setDraftWorldGeneration({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  wellAquiferNetworksEnabled: true,
});
assert.equal(
  sampleAuthoritativeWellGroundwaterScore(280, 220),
  sampleWorldGroundwaterScore(280, 220, DEFAULT_WORLD_GENERATION_SETTINGS.seed, 50),
);
setDraftWorldGeneration(DEFAULT_WORLD_GENERATION_SETTINGS);

assert.equal(groundwaterOverlayAlpha(true, 1), 0, 'surface water must be transparent on the groundwater overlay');
assert.ok(groundwaterOverlayAlpha(false, 0) > 0, 'dry land should retain a readable overlay grade');

for (const [x, z] of [[-650, 620], [-540, -540], [0, 0], [539, 411], [280, 220]]) {
  const aquifer = sampleAquiferPotential(x, z, seed);
  const authoritative = sampleAuthoritativeGroundwaterScore(x, z);
  assert.ok(aquifer >= 0 && aquifer <= 1);
  assert.ok(authoritative >= 0 && authoritative <= 1);
}
assert.ok(sampleAuthoritativeGroundwaterScore(650, 620) > 0, 'large-map edges should retain aquifer variation');
assert.ok(sampleAuthoritativeGroundwaterScore(1_100, -1_100) > 0, 'current large-map edges should remain sampled');
assert.equal(sampleAuthoritativeGroundwaterScore(10_000, 10_000), 0);

console.log('Groundwater network and overlay exclusion checks passed.');
