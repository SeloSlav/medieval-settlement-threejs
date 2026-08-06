import assert from 'node:assert/strict';
import {
  applyWorldGroundwaterVariation,
  sampleAquiferPotential,
  sampleAuthoritativeHydrologyScore,
} from '../src/hydrology/sampleAuthoritativeHydrology.ts';

const seed = 0x071a2e0d;
const inlandScores: number[] = [];
for (let z = -420; z <= 420; z += 35) {
  for (let x = -420; x <= 420; x += 35) {
    inlandScores.push(applyWorldGroundwaterVariation(0.03, x, z, seed, 50));
  }
}

const minimum = Math.min(...inlandScores);
const maximum = Math.max(...inlandScores);
assert.ok(maximum - minimum > 0.55, 'inland aquifers should span several well-quality grades');
assert.ok(inlandScores.some((score) => score < 0.22), 'the map should retain genuinely dry inland sites');
assert.ok(inlandScores.some((score) => score >= 0.62), 'the map should contain good inland well sites');

const dryWorld = applyWorldGroundwaterVariation(0.03, 280, 220, seed, 0);
const normalWorld = applyWorldGroundwaterVariation(0.03, 280, 220, seed, 50);
const wetWorld = applyWorldGroundwaterVariation(0.03, 280, 220, seed, 100);
assert.ok(dryWorld < normalWorld && normalWorld < wetWorld, 'world hydrology should move the water table');

const alternateSeed = applyWorldGroundwaterVariation(0.03, 280, 220, 0x6b712345, 50);
assert.ok(Math.abs(normalWorld - alternateSeed) > 0.25, 'world seeds should move inland aquifer pockets');

for (const [x, z] of [[-650, 620], [-540, -540], [0, 0], [539, 411], [280, 220]]) {
  const aquifer = sampleAquiferPotential(x, z, seed);
  const authoritative = sampleAuthoritativeHydrologyScore(x, z);
  assert.ok(aquifer >= 0 && aquifer <= 1);
  assert.ok(authoritative >= 0 && authoritative <= 1);
}
assert.ok(sampleAuthoritativeHydrologyScore(650, 620) > 0, 'large-map edges should retain aquifer variation');
assert.equal(sampleAuthoritativeHydrologyScore(10_000, 10_000), 0);

console.log('Hydrology variation checks passed.');
