import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  ILLUSTRATED_TERRAIN_STYLE,
  resolveIllustratedElevationStats,
  sampleIllustratedWoodlandField,
} from '../src/map/illustratedTerrainFields.ts';
import {
  MAP_CONTOUR_LEVELS,
  resolveTerrainContourLevels,
  traceTerrainContours,
} from '../src/map/terrainContours.ts';
import {
  projectIllustratedWoodland,
  type IllustratedWoodlandSourceTree,
} from '../src/map/illustratedWoodlandProjection.ts';

assert.equal(
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  'world-xz>accepted-tree-placements,terrain-height>exact-tree-glyphs,equal-height-paths>species-glyphs,dotted-charcoal-contours',
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
assert.deepEqual(resolveTerrainContourLevels(flatStats.minimum, flatStats.maximum).levels, [],
  'flat terrain must not acquire invented elevation rings');
assert.deepEqual(traceTerrainContours(new Float32Array(25).fill(12), 5, 12), []);
assert.deepEqual(resolveIllustratedElevationStats([]), { minimum: 0, maximum: 0 });

for (const [minimum, maximum] of [[-17, 23], [0, 160], [0, 600], [241, 244]]) {
  const { intervalMeters, levels } = resolveTerrainContourLevels(minimum, maximum);
  assert.ok(levels.length <= MAP_CONTOUR_LEVELS.targetLevelCount);
  assert.ok(intervalMeters >= 2 && intervalMeters % 2 === 0,
    'map contours must coarsen the placement overlay’s 2 m interval');
  for (let index = 0; index < levels.length; index++) {
    assert.ok(levels[index] > minimum && levels[index] < maximum);
    if (index > 0) assert.equal(levels[index] - levels[index - 1], intervalMeters,
      'equal contour gaps must describe equal rises, not height quantiles');
  }
}

function heightGrid(resolution: number, sample: (x: number, y: number) => number): Float32Array {
  return Float32Array.from({ length: resolution * resolution }, (_, index) => (
    sample((index % resolution) / (resolution - 1), Math.floor(index / resolution) / (resolution - 1))
  ));
}
const slope = heightGrid(17, (x, y) => x * 40 + y * 20);
const slopePaths = traceTerrainContours(slope, 17, 23);
assert.equal(slopePaths.length, 1, 'a ramp should yield one connected path across grid cells');
assert.equal(slopePaths[0].closed, false);
assert.ok(slopePaths[0].points.length > 10);
for (const point of slopePaths[0].points) {
  assert.ok(Math.abs(point.x * 40 + point.y * 20 - 23) < 1e-5,
    'each vertex must lie on the requested world height');
}
assert.deepEqual(slopePaths, traceTerrainContours(slope, 17, 23),
  'repeated bakes must preserve contour ordering and therefore charcoal placement');

const hill = heightGrid(41, (x, y) => 100 - 300 * ((x - 0.5) ** 2 + (y - 0.5) ** 2));
const summitPaths = traceTerrainContours(hill, 41, 80);
assert.equal(summitPaths.length, 1);
assert.equal(summitPaths[0].closed, true, 'an isolated hill should receive a closed elevation ring');
assert.deepEqual(summitPaths[0].points[0], summitPaths[0].points.at(-1));
for (const point of summitPaths[0].points) {
  assert.ok(Math.abs(Math.hypot(point.x - 0.5, point.y - 0.5) - Math.sqrt(20 / 300)) < 0.002);
}

// A summit occupying far less than 5% of the map must survive level selection.
const narrowHill = heightGrid(65, (x, y) => Math.max(0, 160 * (1 - Math.hypot(x - 0.5, y - 0.5) / 0.06)));
const narrowStats = resolveIllustratedElevationStats(narrowHill);
const narrowLevels = resolveTerrainContourLevels(narrowStats.minimum, narrowStats.maximum).levels;
assert.ok(narrowLevels.some((level) => level >= 120));
assert.equal(traceTerrainContours(narrowHill, 65, 120).some((path) => path.closed), true);

// The same diagonal peaks merge below a pass and separate above it.
const saddle = new Float32Array([4, 0, 0, 4]);
const lowSaddle = traceTerrainContours(saddle, 2, 1);
const highSaddle = traceTerrainContours(saddle, 2, 3);
assert.equal(lowSaddle.length, 2);
assert.equal(highSaddle.length, 2);
assert.ok(lowSaddle.some(({ points }) => points.every((point) => point.x - point.y > 0.7)),
  'below the pass, the contour should surround the low corner');
assert.ok(highSaddle.some(({ points }) => points.every((point) => point.x + point.y < 0.3)),
  'above the pass, the contour should surround the high corner');

assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.minimumGlyphSpacingAuthorPixels >= 2.6
    && ILLUSTRATED_TERRAIN_STYLE.woodland.minimumGlyphSpacingAuthorPixels <= 3.2,
  'accepted-tree marks should overlap into groves without collapsing into a solid badge',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.maximumGlyphCount >= 5_000,
  'the illustrated forest ceiling should remain dense enough to read as real groves',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.paper.base.r >= 176
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.r <= 190
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.g >= 166
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.g <= 180
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.b >= 150
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.b <= 166
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.r
      - ILLUSTRATED_TERRAIN_STYLE.paper.base.g >= 8
    && ILLUSTRATED_TERRAIN_STYLE.paper.base.g
      - ILLUSTRATED_TERRAIN_STYLE.paper.base.b >= 10,
  'paper should match the reference warm-grey rag stock rather than white or yellow parchment',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.paper.broadMottleAmplitude >= 16
    && ILLUSTRATED_TERRAIN_STYLE.paper.middleMottleAmplitude >= 7
    && ILLUSTRATED_TERRAIN_STYLE.paper.edgeDarkening >= 18
    && ILLUSTRATED_TERRAIN_STYLE.paper.stainAlphaMin
      + ILLUSTRATED_TERRAIN_STYLE.paper.stainAlphaRange >= 0.09,
  'paper needs observable multiscale tooth, handling stains, and asymmetric edge patina',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.outlineAlpha >= 0.36
    && ILLUSTRATED_TERRAIN_STYLE.woodland.outlineAlpha <= 0.5
    && ILLUSTRATED_TERRAIN_STYLE.grassland.alpha >= 0.16
    && ILLUSTRATED_TERRAIN_STYLE.grassland.alpha <= 0.3,
  'charcoal vegetation must remain darker than the local paper while yielding to gameplay ink',
);
assert.ok(
  ILLUSTRATED_TERRAIN_STYLE.woodland.broadleafSilhouetteVariants >= 12
    && ILLUSTRATED_TERRAIN_STYLE.woodland.coniferSilhouetteVariants >= 6,
  'woodland etching should expose enough seeded silhouettes to avoid symbol repetition',
);

console.log('test:illustrated-map-terrain passed');
