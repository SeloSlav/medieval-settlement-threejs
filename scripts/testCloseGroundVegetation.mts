import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
  GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
} from '../src/grass/grassLodMath.ts';
import {
  resolveGrassStreamSlotIndex,
  resolveGrassStreamViewTransition,
} from '../src/grass/grassStreamLifecycle.ts';
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
const rendererSource = readFileSync(
  `${projectRoot}src/scene/RendererBackend.ts`,
  'utf8',
);
const lodSource = readFileSync(
  `${projectRoot}src/grass/grassLodMath.ts`,
  'utf8',
);
const meadowTuftPath =
  `${projectRoot}public/assets/textures/vegetation/grass/close-meadow-tuft-greener.png`;

assert.match(
  grassSource,
  /CLOSE_MEADOW_TUFT_PATH[\s\S]*?close-meadow-tuft-greener\.png/,
  'close grass should use the greener generated meadow card',
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
  /MathUtils\.lerp\(0\.285, 0\.205, dryAmount\)[\s\S]*?\.setHSL\(hue, saturation, lightness\)[\s\S]*?\.lerp\(GRASS_TINT_WHITE, 0\.38\)/,
  'grass tint should favor natural meadow green while retaining a muted dry range',
);
assert.match(
  sceneSource,
  /rendererBackend: this\.rendererBackend/,
  'the shared SeedThree material should receive the active renderer backend',
);
assert.match(
  lodSource,
  /CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 200/,
  'grass and wildflowers should begin fading in at 200% zoom',
);
assert.match(
  lodSource,
  /DIRT_FADE_START_ZOOM_PERCENT = CLOSE_GROUND_FADE_START_ZOOM_PERCENT/,
  'brown soil should begin fading in with SeedThree groundcover',
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
  /lodFadeMode === 'continuous-alpha-coverage'[\s\S]*?material\.alphaTest = 0;[\s\S]*?material\.alphaHash = false;[\s\S]*?material\.alphaToCoverage = true;[\s\S]*?material\.transparent = false;[\s\S]*?material\.depthWrite = true;/,
  'the default close-ground fade must use MSAA coverage without a moving alpha hash',
);
assert.match(
  rendererSource,
  /const RENDERER_OPTIONS = \{\s*antialias: true,/,
  'alpha-to-coverage requires the renderer to retain its multisampled target',
);
assert.match(
  fieldSource,
  /resolveGrassStreamSlotIndex\(chunkX, chunkZ, GRID_SIDE\)/,
  'streamed world chunks must keep stable toroidal slot identities',
);
assert.doesNotMatch(
  fieldSource,
  /gridIndex\(localX, localZ\)/,
  'camera-local grid positions must not determine persistent grass slot identity',
);
assert.match(
  fieldSource,
  /WILDFLOWER_SLOT_CAPACITY = 72/,
  'the streamed wildflower slot should hold the complete individual-stem meadow patch',
);
assert.match(
  fieldSource,
  /const patchCount = patchRoll < 0\.025 \? 0 : patchRoll < 0\.14 \? 2 : 3/,
  'wildflowers should occur in most chunks as three color-organized patches',
);
assert.match(
  fieldSource,
  /DENSE_WILDFLOWER_SPACING_SQ = 0\.18 \* 0\.18/,
  'white and yellow stems should gather closely enough to form dense natural patches',
);
assert.match(
  fieldSource,
  /variantIndex: denseVariantIndex,[\s\S]*?count: 3 \+ Math\.floor\(rng\(\) \* 4\),[\s\S]*?variantIndex: PURPLE_WILDFLOWER_INDEX/,
  'dense white/yellow colonies should carry a smaller, more widely scattered purple cohort',
);
assert.match(
  fieldSource,
  /count: rng\(\) < 0\.68 \? 1 : 2,[\s\S]*?appendAccentCohort\(ORANGE_WILDFLOWER_INDEX, 0\.72\)[\s\S]*?appendAccentCohort\(RED_WILDFLOWER_INDEX, 0\.48\)/,
  'orange and red accents should remain local singles or pairs',
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
    { capacity: 72, itemSizes: [16, 4] },
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
    dirtyInstanceCounts: [110, 110, 72],
  }),
  27_760,
  'a first-time slot must upload the complete expanded wildflower slot',
);
assert.equal(
  plannedGroundcoverUploadBytes({
    slotIndex: 3,
    dirtyInstanceCounts: [70, 45, 52],
  }),
  15_660,
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
  [70, 45, 52],
  [78, 50, 61],
  [62, 41, 46],
  [0, 0, 0],
  [69, 44, 54],
] as const;
const slotCapacities = [110, 110, 72] as const;
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
const fullCapacityUploadBytes = recycledCountSequence.length * 27_760;
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

const streamRadius = GRASS_STREAM_CHUNK_RADIUS;
const streamGridSide = streamRadius * 2 + 1;
const originalWindow = new Map<string, number>();
for (let chunkZ = -streamRadius; chunkZ <= streamRadius; chunkZ += 1) {
  for (let chunkX = -streamRadius; chunkX <= streamRadius; chunkX += 1) {
    originalWindow.set(
      `${chunkX},${chunkZ}`,
      resolveGrassStreamSlotIndex(chunkX, chunkZ, streamGridSide),
    );
  }
}
assert.equal(
  new Set(originalWindow.values()).size,
  streamGridSide * streamGridSide,
  'one complete stream window must assign every chunk a unique slot',
);
for (let chunkZ = -streamRadius; chunkZ <= streamRadius; chunkZ += 1) {
  for (let chunkX = -streamRadius + 1; chunkX <= streamRadius; chunkX += 1) {
    assert.equal(
      resolveGrassStreamSlotIndex(chunkX, chunkZ, streamGridSide),
      originalWindow.get(`${chunkX},${chunkZ}`),
      'retained chunks must keep their slots after the camera crosses a chunk boundary',
    );
  }
  assert.equal(
    resolveGrassStreamSlotIndex(streamRadius + 1, chunkZ, streamGridSide),
    resolveGrassStreamSlotIndex(-streamRadius, chunkZ, streamGridSide),
    'only the entering stream column should recycle the column that left the window',
  );
}

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
  1,
  'every wildflower species should retain one readable central stem',
);
const queenAnneBranchBlock = wildflowerSource.slice(
  wildflowerSource.indexOf('const queenAnneBranches = ['),
  wildflowerSource.indexOf('] as const;', wildflowerSource.indexOf('const queenAnneBranches = [')),
);
assert.equal(
  (queenAnneBranchBlock.match(/splitHeight:/g) ?? []).length,
  5,
  "Queen Anne's lace should spread into five irregular side branches",
);
assert.match(
  wildflowerSource,
  /appendStemTube\([\s\S]*?split,[\s\S]*?elbow,[\s\S]*?appendStemTube\([\s\S]*?elbow,[\s\S]*?tip/,
  'each white-flower side branch should bend at a visible elbow instead of radiating rigidly',
);
assert.match(
  wildflowerSource,
  /const queenAnneBranchMask = tsl\.smoothstep[\s\S]*?const whiteUmbel = tsl\.float\(1\)\.sub\([\s\S]*?flowerAnchor\.w/,
  'the branching spray must derive its white-species mask without adding GPU vertex buffers',
);
assert.doesNotMatch(
  `${wildflowerSource}\n${fieldSource}`,
  /aWhiteUmbel|setAttribute\('queenAnneBranchMask'/,
  'branching must remain packed into existing attributes for baseline WebGPU limits',
);
assert.match(
  wildflowerSource,
  /SEEDTHREE_WILDFLOWER_HEAD_SCALE = 1\.25/,
  'wildflower heads should remain legible at maximum strategic-camera zoom',
);
assert.match(
  fieldSource,
  /createSeedThreeWildflowerGeometry\(SEEDTHREE_WILDFLOWER_HEAD_SCALE\)/,
  'the streamed meadow should use the shared enlarged wildflower-head scale',
);
assert.match(
  wildflowerSource,
  /id: 'queen-annes-lace',[\s\S]*?queen-annes-lace-head\.png[\s\S]*?widthScale: \[0\.92, 1\.08\]/,
  'the multi-headed white species should use a smaller central umbel instead of one daisy-like disk',
);
assert.doesNotMatch(
  wildflowerSource,
  /appendLeaf/,
  'wildflower stems should not retain the old side leaf-petal geometry',
);
assert.match(
  wildflowerSource,
  /id: 'clusius-gentian',[\s\S]*?heightScale: \[0\.58, 0\.78\]/,
  'the naturally short gentian should remain distinctly lower than the meadow flowers',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.35, 1\.95\]/,
  'the tallest species should remain below a metre at the authored base height',
);
assert.match(
  wildflowerSource,
  /Clusius gentian:[\s\S]*?const gentianRosette = \[[\s\S]*?appendFoliageBlade[\s\S]*?'lanceolate'/,
  'Clusius gentian should carry a basal rosette around its single unbranched flower stem',
);
assert.match(
  wildflowerSource,
  /Grey hawkbit:[\s\S]*?\[0\.18, 0\.92, 1\.68, 2\.49, 3\.2, 4\.02, 4\.78, 5\.57\][\s\S]*?'lobed'/,
  'grey hawkbit should carry a low lobed rosette beneath its leafless scape',
);
assert.match(
  wildflowerSource,
  /Bulbiferous lily:[\s\S]*?const lilyPedicels = \[[\s\S]*?splitHeight:[\s\S]*?appendFlowerHeadCard/,
  'bulbiferous lily should carry short upper pedicels above its spiral stem leaves',
);
assert.match(
  wildflowerSource,
  /Red campion:[\s\S]*?const campionCymes = \[[\s\S]*?tips: \[[\s\S]*?cyme\.tips\.forEach/,
  'red campion should fork into an open terminal cyme above opposite leaf pairs',
);
assert.match(
  wildflowerSource,
  /const structureVisibility = sharedStructureMask[\s\S]*?gentianStructureMask[\s\S]*?hawkbitStructureMask[\s\S]*?lilyStructureMask[\s\S]*?campionStructureMask/,
  'species silhouettes should stay packed in the existing flower mask instead of adding instance buffers',
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
