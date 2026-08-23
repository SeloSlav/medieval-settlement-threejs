import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  ILLUSTRATED_TERRAIN_FIELDS,
  ILLUSTRATED_TERRAIN_STYLE,
  isGuaranteedIllustratedMountainSummit,
  resolveIllustratedElevationStats,
  sampleIllustratedElevationField,
  sampleIllustratedWoodlandField,
} from '../src/map/illustratedTerrainFields.ts';
import {
  projectIllustratedWoodland,
  type IllustratedWoodlandSourceTree,
} from '../src/map/illustratedWoodlandProjection.ts';

assert.equal(
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  'world-xz>accepted-tree-placements,elevation,slope-ridge>exact-tree-glyphs,mountain-prominence>species-glyphs,ridge-marks',
  'the map art should publish its stable-coordinate field contract',
);

const projectionBounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const sourceTrees: IllustratedWoodlandSourceTree[] = [
  { layoutIndex: 17, x: -50, z: 25, species: 'beech', form: 'broad', scale: 1 },
  { layoutIndex: 41, x: 45, z: -60, species: 'silverFir', form: 'narrow', scale: 0.95 },
  { layoutIndex: 89, x: 12, z: 70, species: 'ash', form: 'midstory', scale: 0.82 },
];
const exactProjection = projectIllustratedWoodland(sourceTrees, projectionBounds);
assert.equal(exactProjection.diagnostics.sourceTreeCount, sourceTrees.length);
assert.equal(exactProjection.diagnostics.orphanGlyphCount, 0);
assert.equal(exactProjection.diagnostics.maximumPositionErrorWorld, 0);
assert.equal(exactProjection.glyphs.length, sourceTrees.length);
const beechGlyph = exactProjection.glyphs.find((glyph) => glyph.layoutIndex === 17)!;
assert.equal(beechGlyph.worldX, -50, 'a map tree must retain its accepted world X');
assert.equal(beechGlyph.worldZ, 25, 'a map tree must retain its accepted world Z');
assert.equal(beechGlyph.authorX, 128, 'world X should project linearly into the authoring frame');
assert.equal(beechGlyph.authorY, 320, 'world +Z should project downward into the authoring frame');
assert.equal(beechGlyph.conifer, false, 'beech placements should use the broadleaf glyph');
assert.equal(
  exactProjection.glyphs.find((glyph) => glyph.layoutIndex === 41)?.conifer,
  true,
  'silver-fir placements should use the conifer glyph',
);

const reversedProjection = projectIllustratedWoodland([...sourceTrees].reverse(), projectionBounds);
assert.equal(
  reversedProjection.diagnostics.signature,
  exactProjection.diagnostics.signature,
  'input order must not alter the accepted-tree far-view sample',
);
assert.deepEqual(
  reversedProjection.glyphs.map((glyph) => glyph.layoutIndex),
  exactProjection.glyphs.map((glyph) => glyph.layoutIndex),
  'input order must not alter emitted source indices',
);

const translatedTrees = sourceTrees.map((tree) => ({ ...tree, x: tree.x + 5, z: tree.z - 7 }));
const translatedProjection = projectIllustratedWoodland(translatedTrees, projectionBounds);
for (const glyph of exactProjection.glyphs) {
  const translated = translatedProjection.glyphs.find((candidate) => (
    candidate.layoutIndex === glyph.layoutIndex
  ))!;
  assert.ok(Math.abs(translated.authorX - glyph.authorX - 12.8) < 1e-9);
  assert.ok(Math.abs(translated.authorY - glyph.authorY + 17.92) < 1e-9);
}

const trackedTreeData = JSON.parse(readFileSync(
  new URL('../server/generated/world_trees.json', import.meta.url),
  'utf8',
)) as { trees: Array<{ layoutIndex: number; x: number; z: number }> };
const trackedSources: IllustratedWoodlandSourceTree[] = trackedTreeData.trees.map((tree) => ({
  ...tree,
  species: 'beech',
  form: 'broad',
  scale: 1,
}));
const defaultWorldProjection = projectIllustratedWoodland(
  trackedSources,
  { minX: -817, maxX: 817, minZ: -817, maxZ: 817 },
);
assert.equal(defaultWorldProjection.diagnostics.sourceTreeCount, 10_905);
assert.ok(
  defaultWorldProjection.diagnostics.treeGlyphCount >= 3_000,
  'the default paper map should preserve a genuinely dense accepted-tree read',
);
assert.ok(
  defaultWorldProjection.diagnostics.treeGlyphCount
    <= ILLUSTRATED_TERRAIN_STYLE.woodland.maximumGlyphCount,
  'the dense grove projection must keep its explicit far-view ceiling',
);
assert.equal(
  defaultWorldProjection.glyphs.every((glyph) => (
    trackedTreeData.trees[glyph.layoutIndex]?.layoutIndex === glyph.layoutIndex
  )),
  true,
  'every projected default-world glyph must reference a tracked accepted tree',
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
  ILLUSTRATED_TERRAIN_STYLE.woodland.minimumGlyphSpacingAuthorPixels >= 3.25,
  'individual accepted-tree marks should retain a measurable far-view separation',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.maximumGlyphCount >= 3_500,
  'the illustrated forest ceiling should remain dense enough to read as real groves',
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
