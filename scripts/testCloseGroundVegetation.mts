import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
  GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
} from '../src/grass/grassLodMath.ts';
import { resolveGrassStreamViewTransition } from '../src/grass/grassStreamLifecycle.ts';
import {
  planGroundcoverAttributeUpdateRanges,
  resolveGroundcoverSlotRewrite,
  type GroundcoverSlotUpdate,
} from '../src/grass/groundcoverSlotUpdates.ts';
import { resolveGroundCoverShadowPolicy } from '../vendor/seedthree/src/core/ground-cover-shadows.js';
import { resolveStreamVisibilityHysteresis } from '../vendor/seedthree/src/core/stream-slot-budget.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const grassSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeGrass.ts`,
  'utf8',
);
const fieldSource = readFileSync(
  `${projectRoot}src/grass/GrassBladeField.ts`,
  'utf8',
);
const wildflowerSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeWildflowers.ts`,
  'utf8',
);
const sceneSource = readFileSync(
  `${projectRoot}src/scene/SceneManager.ts`,
  'utf8',
);
const lodSource = readFileSync(
  `${projectRoot}src/grass/grassLodMath.ts`,
  'utf8',
);
const meadowTuftPath =
  `${projectRoot}public/assets/textures/vegetation/grass/close-meadow-tuft.png`;

assert.match(
  grassSource,
  /CLOSE_MEADOW_TUFT_PATH[\s\S]*?close-meadow-tuft\.png/,
  'close grass should use the generated Manor Lords-style meadow card',
);
assert.match(
  grassSource,
  /loadSeedThreeGroundCoverTextures[\s\S]*?createSeedThreeCardClumpGeometry[\s\S]*?createSeedThreeGroundCoverMaterial/,
  'the generated card must run through SeedThree ground-cover textures, geometry, and material',
);
assert.match(
  fieldSource,
  /createSeedThreeTuftVariants\(\)/,
  'the streamed field should use SeedThree tuft geometry',
);
assert.doesNotMatch(
  `${grassSource}\n${fieldSource}`,
  /function tuftGeometry|createGrassTuftGeometry|Grass blade stream|useSeedThreeClumps/,
  'the streamed field must not retain a parallel custom grass fallback',
);
assert.match(
  fieldSource,
  /setRoadDraftActive\(active: boolean\) \{\s*if \(roadDraftActive === active\) return;/,
  'stable road-draft frames must not replace pending stream arrays or cancel the same job repeatedly',
);
assert.doesNotMatch(
  sceneSource,
  /useSeedThreeClumps/,
  'SceneManager should not conditionally switch away from SeedThree grass',
);
assert.match(
  fieldSource,
  /THREE\.MathUtils\.lerp\(0\.68, 1\.08, rng\(\)\)/,
  'full SeedThree grass tufts should use the larger close-meadow height',
);
assert.match(
  grassSource,
  /\.setHSL\(hue, saturation, lightness\)[\s\S]*?\.lerp\(GRASS_TINT_WHITE, 0\.46\)/,
  'grass tint should stay in muted olive and straw colors rather than boosted green',
);
assert.match(
  sceneSource,
  /rendererBackend: this\.rendererBackend/,
  'the shared SeedThree material should receive the active renderer backend',
);
assert.match(
  lodSource,
  /CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 200/,
  'grass, wildflowers, and cattails should begin fading in at 200% zoom',
);
assert.match(
  lodSource,
  /DIRT_FADE_START_ZOOM_PERCENT = 425/,
  'brown soil should wait until the SeedThree groundcover is visually complete',
);
assert.match(
  lodSource,
  /DIRT_REVEAL_ZOOM_PERCENT = 650/,
  'brown soil should reach full strength only at ground-level zoom',
);
assert.match(
  fieldSource,
  /grassZoomVisible = resolveStreamVisibilityHysteresis\([\s\S]*?grassZoomVisible,[\s\S]*?displayOpacity,[\s\S]*?GRASS_BLADE_VISIBILITY_ENTER_OPACITY,[\s\S]*?GRASS_BLADE_VISIBILITY_EXIT_OPACITY,/,
  'the shared grass and wildflower stream should use the bounded visibility hysteresis',
);
assert.match(
  fieldSource,
  /lodFadeMode === 'continuous-alpha-hash'[\s\S]*?material\.alphaTest = 0;[\s\S]*?material\.alphaHash = true;[\s\S]*?material\.transparent = false;[\s\S]*?material\.depthWrite = true;/,
  'the default close-ground fade must retain one stable coverage pipeline',
);
assert.match(
  lodSource,
  /REED_LOD_VISIBILITY_THRESHOLD = 0/,
  'cattails should activate at the same fade boundary',
);
assert.match(
  fieldSource,
  /WILDFLOWER_SLOT_CAPACITY = 8/,
  'the streamed wildflower slot should hold the complete dense meadow patch',
);
assert.match(
  fieldSource,
  /const target = rng\(\) < 0\.04 \? 0 : 6 \+ Math\.floor\(rng\(\) \* 3\)/,
  'wildflowers should occur in most chunks at six to eight colonies',
);
assert.match(
  fieldSource,
  /MIN_WILDFLOWER_SPACING_SQ = 0\.62 \* 0\.62/,
  'wildflower colonies should gather closely enough to form dense natural patches',
);
assert.match(
  fieldSource,
  /localPlacements\.length > 0 && rng\(\) < 0\.78[\s\S]*?THREE\.MathUtils\.lerp\(0\.68, 1\.9, Math\.pow\(rng\(\), 0\.7\)\)/,
  'most wildflower colonies should extend a nearby patch instead of scattering uniformly',
);
assert.match(
  fieldSource,
  /GRASS_STREAM_UPDATE_BUDGET_MS = 2[\s\S]*runStreamSlotUpdateChunk/,
  'groundcover generation and commits must use the reusable two-millisecond deadline scheduler',
);
assert.match(
  fieldSource,
  /generationIterator[\s\S]*budget\.deadlineMs/,
  'slot generation must resume across deadline-bounded substeps before an atomic commit',
);
assert.match(
  fieldSource,
  /activeSlotJob\.phase === 'generate'[\s\S]*activeSlotJob\.phase = 'commit'[\s\S]*commitSlot\(activeSlotJob\)/,
  'live instance buffers must remain untouched until staged generation completes',
);
assert.match(
  fieldSource,
  /planGroundcoverAttributeUpdateRanges[\s\S]*clearUpdateRanges\(\)[\s\S]*addUpdateRange/,
  'GPU uploads must cover only the exact dirty prefix of changed slots',
);
assert.match(
  fieldSource,
  /primeAndFreezeStream/,
  'the frozen-stream A/B must prefill real grass before stopping route-time writes',
);
assert.match(fieldSource, /mode = 'priming-frozen'/);
assert.match(fieldSource, /mode = 'frozen'/);
assert.doesNotMatch(
  `${lodSource}\n${fieldSource}`,
  /GRASS_STREAM_(?:SLOTS_PER_FRAME|BURST_CAP)|streamBurstPending/,
  'fixed 36/14/6 slot bursts must not return',
);
assert.doesNotMatch(
  fieldSource,
  /computeBoundingSphere/,
  'unculled groundcover meshes must not rescan instance bounds while streaming',
);
assert.match(
  fieldSource,
  /MAX_GRASS_STREAM_INSTANCES = GRID_SIDE \* GRID_SIDE \* GRASS_SLOT_CAPACITY[\s\S]*?streamMeshes = variants\.map\([\s\S]*?new THREE\.InstancedMesh\(geometry, grassMaterial, MAX_GRASS_STREAM_INSTANCES\)[\s\S]*?new THREE\.InstancedMesh\([\s\S]*?MAX_WILDFLOWER_STREAM_INSTANCES[\s\S]*?group\.add\(entry\.mesh\)/,
  'groundcover should retain the three whole-field InstancedMesh submissions',
);
assert.match(
  fieldSource,
  /mesh\.frustumCulled = false;[\s\S]*?wildflowerMesh\.frustumCulled = false;/,
  'the restored whole-field submissions must not use the rejected spatial culling path',
);
assert.doesNotMatch(
  fieldSource,
  /spatial-batch-grid|createGroundcoverBatches|GROUNDCOVER_BATCH|localSlotsByBatch/,
  'the rejected 4x4 spatial split must not remain in the game integration',
);
assert.deepEqual(
  resolveGroundCoverShadowPolicy({ terrainReceivesShadow: true }),
  {
    castShadow: false,
    receiveShadow: false,
    mode: 'terrain-projected',
  },
  'dense groundcover should not resample shadows already projected onto its terrain',
);
assert.deepEqual(
  resolveGroundCoverShadowPolicy({ terrainReceivesShadow: false }),
  {
    castShadow: false,
    receiveShadow: true,
    mode: 'mesh-received',
  },
  'groundcover must retain mesh shadow reception when no terrain receiver exists',
);
assert.match(
  fieldSource,
  /applyGroundCoverShadowPolicy\(mesh, \{ terrainReceivesShadow: true \}\)/,
  'each streamed grass submission must use the shared SeedThree terrain-shadow policy',
);
assert.match(
  fieldSource,
  /applyGroundCoverShadowPolicy\(wildflowerMesh, \{[\s\S]*?terrainReceivesShadow: true,[\s\S]*?\}\)/,
  'streamed wildflowers must use the same terrain-shadow policy as grass',
);
assert.doesNotMatch(
  fieldSource,
  /(?:mesh|wildflowerMesh)\.receiveShadow = true/,
  'close groundcover must not restore redundant per-fragment shadow sampling',
);
assert.match(
  fieldSource,
  /planGroundcoverAttributeUpdateRanges\(\s*changedSlots,\s*meshIndex,\s*entry\.slotCapacity,/,
  'whole-field slot uploads must retain exact per-mesh changed-slot range planning',
);

assert.deepEqual(
  resolveGroundcoverSlotRewrite(false, 42, 64, 110),
  { dirtyInstanceCount: 110, clearStart: 0, clearCount: 110 },
  'first initialization must still hide the complete fixed-capacity slot',
);
assert.deepEqual(
  resolveGroundcoverSlotRewrite(true, 42, 64, 110),
  { dirtyInstanceCount: 64, clearStart: 64, clearCount: 0 },
  'growing a recycled slot should touch only its new live prefix',
);
assert.deepEqual(
  resolveGroundcoverSlotRewrite(true, 64, 42, 110),
  { dirtyInstanceCount: 64, clearStart: 42, clearCount: 22 },
  'shrinking a recycled slot must hide exactly the old live tail',
);
assert.deepEqual(
  resolveGroundcoverSlotRewrite(true, 42, 0, 110),
  { dirtyInstanceCount: 42, clearStart: 0, clearCount: 42 },
  'emptying a recycled slot must hide its complete old live prefix',
);
assert.deepEqual(
  resolveGroundcoverSlotRewrite(true, 0, 55, 110),
  { dirtyInstanceCount: 55, clearStart: 55, clearCount: 0 },
  'regrowing an empty initialized slot should touch only the new live prefix',
);

function plannedGroundcoverUploadBytes(update: GroundcoverSlotUpdate): number {
  const meshSpecs = [
    { capacity: 110, itemSizes: [16, 3, 3, 3] },
    { capacity: 110, itemSizes: [16, 3, 3, 3] },
    { capacity: 8, itemSizes: [16, 4] },
  ];
  let bytes = 0;
  for (let meshIndex = 0; meshIndex < meshSpecs.length; meshIndex++) {
    const spec = meshSpecs[meshIndex]!;
    for (const itemSize of spec.itemSizes) {
      bytes += planGroundcoverAttributeUpdateRanges(
        [update],
        meshIndex,
        spec.capacity,
        itemSize,
      ).byteCount;
    }
  }
  return bytes;
}

assert.equal(
  plannedGroundcoverUploadBytes({
    slotIndex: 3,
    dirtyInstanceCounts: [110, 110, 8],
  }),
  22_640,
  'a first-time slot must retain the complete historical 22,640-byte upload',
);
assert.equal(
  plannedGroundcoverUploadBytes({
    slotIndex: 3,
    dirtyInstanceCounts: [70, 45, 7],
  }),
  12_060,
  'a representative recycled slot must publish only exact dirty components',
);
assert.deepEqual(
  planGroundcoverAttributeUpdateRanges(
    [
      { slotIndex: 3, dirtyInstanceCounts: [64] },
      { slotIndex: 4, dirtyInstanceCounts: [55] },
    ],
    0,
    110,
    16,
  ),
  {
    ranges: [
      { start: 5_280, count: 1_024 },
      { start: 7_040, count: 880 },
    ],
    componentCount: 1_904,
    byteCount: 7_616,
  },
  'separated recycled prefixes must not upload the untouched hidden gap',
);
assert.deepEqual(
  planGroundcoverAttributeUpdateRanges(
    [{ slotIndex: 3, dirtyInstanceCounts: [0] }],
    0,
    110,
    16,
  ),
  { ranges: [], componentCount: 0, byteCount: 0 },
  'an unchanged empty slot must not publish a phantom full-buffer upload',
);
assert.match(
  fieldSource,
  /if \(plan\.componentCount === 0\) continue;[\s\S]*attribute\.needsUpdate = true/,
  'zero-component plans must not increment BufferAttribute versions',
);

const recycledCountSequence = [
  [70, 45, 7],
  [78, 50, 8],
  [62, 41, 6],
  [0, 0, 0],
  [69, 44, 7],
] as const;
const slotCapacities = [110, 110, 8] as const;
let initialized = false;
let previousCounts = [0, 0, 0];
let exactUploadBytes = 0;
let exactClearWrites = 0;
for (const nextCounts of recycledCountSequence) {
  const dirtyInstanceCounts: number[] = [];
  for (let meshIndex = 0; meshIndex < slotCapacities.length; meshIndex++) {
    const rewrite = resolveGroundcoverSlotRewrite(
      initialized,
      previousCounts[meshIndex]!,
      nextCounts[meshIndex]!,
      slotCapacities[meshIndex]!,
    );
    dirtyInstanceCounts.push(rewrite.dirtyInstanceCount);
    exactClearWrites += rewrite.clearCount;
  }
  exactUploadBytes += plannedGroundcoverUploadBytes({
    slotIndex: 3,
    dirtyInstanceCounts,
  });
  previousCounts = [...nextCounts];
  initialized = true;
}
const fullCapacityUploadBytes = recycledCountSequence.length * 22_640;
const fullCapacityClearWrites = recycledCountSequence.length
  * slotCapacities.reduce((sum, capacity) => sum + capacity, 0);
assert.ok(
  exactUploadBytes < fullCapacityUploadBytes * 0.7,
  'exact recycled-slot prefixes should remove at least 30% of transfer bytes',
);
assert.ok(
  exactClearWrites < fullCapacityClearWrites * 0.35,
  'tail-only hiding should remove at least 65% of redundant clear writes',
);

function applyGeneratedPrefix(buffer: number[], count: number): void {
  for (let index = 0; index < count; index++) buffer[index] = 1_000 + index;
}

const legacyBuffer = Array.from({ length: 110 }, (_, index) => index);
const exactBuffer = [...legacyBuffer];
let previousLiveCount = 0;
initialized = false;
for (const nextLiveCount of [64, 42, 0, 55]) {
  legacyBuffer.fill(-1);
  applyGeneratedPrefix(legacyBuffer, nextLiveCount);

  const rewrite = resolveGroundcoverSlotRewrite(
    initialized,
    previousLiveCount,
    nextLiveCount,
    exactBuffer.length,
  );
  exactBuffer.fill(
    -1,
    rewrite.clearStart,
    rewrite.clearStart + rewrite.clearCount,
  );
  applyGeneratedPrefix(exactBuffer, nextLiveCount);
  assert.deepEqual(
    exactBuffer,
    legacyBuffer,
    `exact slot rewrite must match full clearing at live count ${nextLiveCount}`,
  );
  initialized = true;
  previousLiveCount = nextLiveCount;
}
assert.match(
  fieldSource,
  /standardPlacementCount[\s\S]*microPlacementCount/,
  'generation should count cohorts without allocating filter arrays in hot loops',
);
assert.doesNotMatch(
  fieldSource,
  /localPlacements\.filter/,
  'groundcover generation must not repeatedly scan and allocate placement subsets',
);

assert.equal(
  resolveStreamVisibilityHysteresis(
    false,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY - 0.0001,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  ),
  false,
  'hidden grass should not chatter on just below its enter boundary',
);
assert.equal(
  resolveStreamVisibilityHysteresis(
    false,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  ),
  true,
  'groundcover should enter at the explicit hysteresis boundary',
);
assert.equal(
  resolveStreamVisibilityHysteresis(
    true,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY + 0.0001,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  ),
  true,
  'visible grass should survive a small outward boundary oscillation',
);
assert.equal(
  resolveStreamVisibilityHysteresis(
    true,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
    GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
    GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  ),
  false,
  'groundcover should leave only at its lower hysteresis boundary',
);

assert.deepEqual(
  resolveGrassStreamViewTransition({
    mode: 'frozen',
    firstPersonActive: false,
    wasFirstPersonActive: true,
    grassVisible: false,
    hasFrozenPrime: false,
  }),
  {
    preserveFrozenState: true,
    invalidateForFirstPersonEntry: false,
    clearInactiveStream: false,
  },
  'a post-prime strategic update must preserve pending=0/converged frozen buffers',
);
assert.deepEqual(
  resolveGrassStreamViewTransition({
    mode: 'frozen',
    firstPersonActive: true,
    wasFirstPersonActive: false,
    grassVisible: true,
    hasFrozenPrime: false,
  }),
  {
    preserveFrozenState: true,
    invalidateForFirstPersonEntry: false,
    clearInactiveStream: false,
  },
  'entering the road-eye phase must reveal frozen grass without invalidating it',
);
assert.equal(
  resolveGrassStreamViewTransition({
    mode: 'active',
    firstPersonActive: false,
    wasFirstPersonActive: false,
    grassVisible: false,
    hasFrozenPrime: false,
  }).clearInactiveStream,
  true,
  'ordinary hidden streaming should still release stale pending work',
);

const stalkBlock = wildflowerSource.slice(
  wildflowerSource.indexOf('const stalks = ['),
  wildflowerSource.indexOf('] as const;', wildflowerSource.indexOf('const stalks = [')),
);
assert.equal(
  (stalkBlock.match(/\{ x:/g) ?? []).length,
  5,
  'each wildflower colony should contain five readable stems',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.05, 1\.4\]/,
  'the shortest species should still reach the close grass layer',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.35, 1\.95\]/,
  'the tallest species should remain below a metre at the authored base height',
);

const meadowTuft = readFileSync(meadowTuftPath);
assert.ok(
  statSync(meadowTuftPath).size > 100_000,
  'the generated meadow card should remain a real authored texture',
);
assert.equal(meadowTuft.subarray(1, 4).toString('ascii'), 'PNG');
assert.equal(meadowTuft[25], 6, 'the generated meadow card should retain an RGBA alpha channel');

console.log(
  'Close-ground vegetation contract tests passed. '
  + `Representative recycled-slot sequence: ${exactUploadBytes}/${fullCapacityUploadBytes} bytes, `
  + `${exactClearWrites}/${fullCapacityClearWrites} clear writes.`,
);
