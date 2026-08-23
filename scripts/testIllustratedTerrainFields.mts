import assert from 'node:assert/strict';
import {
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  ILLUSTRATED_TERRAIN_FIELDS,
  ILLUSTRATED_TERRAIN_STYLE,
  isGuaranteedIllustratedMountainSummit,
  resolveIllustratedElevationStats,
  sampleIllustratedElevationField,
  sampleIllustratedWoodlandField,
} from '../src/map/illustratedTerrainFields.ts';

assert.equal(
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  'world-xz>forest-density,elevation,slope-ridge>woodland-clump,mountain-prominence>glyph-clusters,ridge-marks',
  'the map art should publish its stable-coordinate field contract',
);

const denseWoods = sampleIllustratedWoodlandField({
  x: 40,
  z: -25,
  neighbourhoodRadius: 18,
  densityAt: () => 0.82,
});
assert.ok(denseWoods.clumpMass > 0.98, 'a coherent woodland interior should become a full clump');
assert.equal(denseWoods.neighbourSupport, 1);

const isolatedTree = sampleIllustratedWoodlandField({
  x: 0,
  z: 0,
  neighbourhoodRadius: 18,
  densityAt: (x, z) => Math.hypot(x, z) < 2 ? 0.95 : 0,
});
assert.equal(
  isolatedTree.clumpMass,
  0,
  'one isolated forest-density spike must not produce a standalone map tree',
);

const woodlandEdge = sampleIllustratedWoodlandField({
  x: 0,
  z: 0,
  neighbourhoodRadius: 18,
  densityAt: (x) => x <= 0 ? 0.8 : 0,
});
assert.ok(woodlandEdge.clumpMass > 0.5, 'a connected woodland edge should retain a smaller clump');
assert.ok(woodlandEdge.boundary > denseWoods.boundary, 'the named boundary field should identify forest edges');
assert.deepEqual(
  sampleIllustratedWoodlandField({
    x: 0,
    z: 0,
    neighbourhoodRadius: 18,
    densityAt: (x) => x <= 0 ? 0.8 : 0,
  }),
  woodlandEdge,
  'field samples must be deterministic at the same world XZ coordinate',
);

const flatStats = resolveIllustratedElevationStats(new Float32Array(96).fill(12));
const flatField = sampleIllustratedElevationField({
  height: 12,
  neighbourRange: 0,
  heightAboveNeighbourMean: 0,
  edgeProximity: 1,
  stats: flatStats,
});
assert.equal(flatStats.reliefGate, 0);
assert.equal(
  flatField.mountainProminence,
  0,
  'a flat map edge must never be decorated as a mountain',
);
assert.equal(
  isGuaranteedIllustratedMountainSummit(flatField),
  false,
  'the non-random summit fallback must remain closed on flat edges',
);

const narrowSummitSamples = Float32Array.from(
  { length: 1_000 },
  (_, index) => index >= 970 ? 160 : 0,
);
const narrowSummitStats = resolveIllustratedElevationStats(narrowSummitSamples);
const narrowSummit = sampleIllustratedElevationField({
  height: 160,
  neighbourRange: 148,
  heightAboveNeighbourMean: 112,
  edgeProximity: 0.2,
  stats: narrowSummitStats,
});
assert.equal(
  narrowSummitStats.broadRelief,
  0,
  'the fixture summit should occupy too little area to reach the broad 95th percentile',
);
assert.ok(
  narrowSummitStats.reliefGate > 0.99,
  'a genuine sub-five-percent summit should still open the relief gate',
);
assert.equal(
  isGuaranteedIllustratedMountainSummit(narrowSummit),
  true,
  'the exhaustive sampled-summit audit should guarantee a range for narrow high terrain',
);

const ridgeSamples = Float32Array.from({ length: 100 }, (_, index) => index < 68 ? 0 : 100);
const ridgeStats = resolveIllustratedElevationStats(ridgeSamples);
const centralHighland = sampleIllustratedElevationField({
  height: 72,
  neighbourRange: 0,
  heightAboveNeighbourMean: 0,
  edgeProximity: 0,
  stats: ridgeStats,
});
const edgeHighland = sampleIllustratedElevationField({
  height: 72,
  neighbourRange: 0,
  heightAboveNeighbourMean: 0,
  edgeProximity: 1,
  stats: ridgeStats,
});
assert.ok(ridgeStats.reliefGate > 0.99, 'mountain-scale relief should open the mountain field gate');
assert.ok(
  edgeHighland.mountainProminence > centralHighland.mountainProminence,
  'genuinely high Delnice/Kupa-style map edges should receive stronger ridge marks',
);

const ruggedSummit = sampleIllustratedElevationField({
  height: 100,
  neighbourRange: 74,
  heightAboveNeighbourMean: 42,
  edgeProximity: 0.75,
  stats: ridgeStats,
});
assert.ok(
  ruggedSummit.mountainProminence >= 0.95,
  'high, sloped, locally prominent terrain should read as a mountain range',
);
assert.ok(
  ILLUSTRATED_TERRAIN_FIELDS.woodland.maximumTreeGlyphsPerClump <= 5,
  'far-map groves should stay below the dark-badge overlap threshold',
);
assert.ok(
  ILLUSTRATED_TERRAIN_FIELDS.woodland.clumpSpacingAuthorPixels >= 28,
  'woodland clumps should leave breathing room at the farthest map mip',
);
assert.ok(
  ILLUSTRATED_TERRAIN_FIELDS.elevation.mountainSpacingAuthorPixels >= 50,
  'mountain ranges should not occupy adjacent legacy grid slots',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.paper.base.b >= 190
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.r
      - ILLUSTRATED_TERRAIN_STYLE.paper.base.b <= 24,
  'paper should stay a desaturated faded ivory rather than yellow parchment',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.outlineAlpha <= 0.35
    && ILLUSTRATED_TERRAIN_STYLE.mountains.outlineAlphaMin
      + ILLUSTRATED_TERRAIN_STYLE.mountains.outlineAlphaProminence <= 0.28
    && ILLUSTRATED_TERRAIN_STYLE.grassland.alpha <= 0.12,
  'terrain ink must remain subordinate to live roads, buildings, and stamps',
);

console.log('test:illustrated-map-terrain passed');
