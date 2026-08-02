import assert from 'node:assert/strict';
import fs from 'node:fs';

const sceneManager = fs.readFileSync('src/scene/SceneManager.ts', 'utf8');
const forestProps = fs.readFileSync('src/props/ForestProps.ts', 'utf8');
const assets = fs.readFileSync('src/vegetation/seedthree/seedThreeAssets.ts', 'utf8');
const branchCards = fs.readFileSync('src/vegetation/seedthree/seedThreeBranchCards.ts', 'utf8');
const branchCardCache = fs.readFileSync(
  'src/vegetation/seedthree/seedThreeBranchCardCache.ts',
  'utf8',
);
const forestBuilder = fs.readFileSync(
  'src/vegetation/seedthree/seedThreeForestBuilder.ts',
  'utf8',
);
const seedThreeImpostor = fs.readFileSync(
  'vendor/seedthree/src/core/impostor.js',
  'utf8',
);
const threeRenderer = fs.readFileSync(
  'node_modules/three/src/renderers/common/Renderer.js',
  'utf8',
);
const webGpuTextureUtils = fs.readFileSync(
  'node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js',
  'utf8',
);

assert.match(
  assets,
  /assetPromiseCache\.get\(species\.name\)/,
  'concurrent preload and forest construction must share one species texture/decode promise',
);
assert.match(
  assets,
  /const requestGeneration = assetCacheGeneration[\s\S]*requestGeneration !== assetCacheGeneration[\s\S]*disposeSpeciesAssets\(assets\)/,
  'an in-flight texture cohort invalidated by disposal must not repopulate the next world cache',
);
assert.match(
  assets,
  /Promise\.allSettled\(\[[\s\S]*requiredFailure[\s\S]*result\.value\?\.dispose\(\)/,
  'a required bark/leaf failure must dispose every sibling texture that finished decoding',
);
assert.match(
  forestBuilder,
  /preloadSeedThreeBranchCardCache\(species, FOREST_LOD_OPTS\.mobileTarget\)/,
  'early forest preload must restore persistent branch cards as well as source textures',
);
assert.match(
  sceneManager,
  /const backendPromise = createPreferredRenderer\(\);[\s\S]*void backendPromise[\s\S]*preloadSeedThreeForestAssets/,
  'forest preload must begin when WebGPU resolves, before the graphics Promise.all barrier',
);
assert.doesNotMatch(
  sceneManager,
  /import \{ create(?:Deer|Fish)WildlifeVisuals/,
  'deer and fish implementations must not inflate the synchronous game-entry parse closure',
);
assert.match(
  threeRenderer,
  /async readRenderTargetPixelsAsync[\s\S]*return this\.backend\.copyTextureToBuffer/,
  'the pinned Three renderer must invoke the backend copy before returning its readback promise',
);
assert.match(
  webGpuTextureUtils,
  /submit\( device, encoder\.finish\(\) \);[\s\S]*await readBuffer\.mapAsync\( GPUMapMode\.READ \)/,
  'the pinned WebGPU backend must submit each ordered texture copy before yielding on mapAsync',
);
assert.match(
  sceneManager,
  /const deerVisualModulePromise = import\('\.\.\/foraging\/DeerWildlifeVisuals\.ts'\)/,
  'the deer implementation chunk must begin loading at module evaluation',
);
assert.match(
  sceneManager,
  /const fishVisualModulePromise = import\('\.\.\/foraging\/FishWildlifeVisuals\.ts'\)/,
  'the fish implementation chunk must begin loading at module evaluation',
);
assert.match(
  branchCards,
  /cardRestorePromiseCache\.get\(key\)/,
  'parallel callers must deduplicate persistent branch-card restores',
);
assert.match(
  branchCards,
  /const precedingBake = rendererBakeBarrier[\s\S]*rendererBakeBarrier = precedingBake\.then[\s\S]*await precedingBake/,
  'renderer-exclusive bakes must remain serialized across dispose/new-world generations',
);
const disposeFunction = branchCards.slice(
  branchCards.indexOf('export function disposeSeedThreeBranchCardCache'),
);
assert.doesNotMatch(
  disposeFunction,
  /rendererBakeBarrier\s*=/,
  'disposal must not erase an in-flight renderer bake barrier',
);
assert.match(
  branchCards,
  /cardBuildPromiseCache\.get\(key\)/,
  'parallel callers must never start duplicate renderer-exclusive card bakes',
);
assert.match(
  branchCardCache,
  /Promise\.all\(record\.sets\.map\(async \(cachedSet\)/,
  'warm restoration must decode immutable card sets concurrently',
);
assert.match(
  branchCardCache,
  /Promise\.all\(cachedSet\.variants\.map\(async \(cached\)/,
  'warm restoration must decode immutable variants concurrently while preserving array order',
);
assert.doesNotMatch(
  branchCardCache,
  /values:\s*Array\.from\(attribute\.array\)|indices:\s*Array\.from\(index\.array\)/,
  'persistent geometry must use exact typed-array structured cloning, not boxed number arrays',
);
assert.match(
  branchCards,
  /persistenceQueue[\s\S]*\.catch\(\(error: unknown\)/,
  'one failed persistence job must not poison every later species cache write',
);
assert.match(
  branchCards,
  /disposeCardsAfterPersistence\(cardsToDispose, pendingPersistenceAtDispose\)/,
  'card canvases must stay alive until queued PNG snapshots complete',
);
assert.match(
  branchCards,
  /await persistenceJobsByKey\.get\(key\)/,
  'a new world must wait for an exact-key write queued by the disposing world before declaring a miss',
);
assert.match(
  branchCards,
  /const requestGeneration = cardCacheGeneration[\s\S]*requestGeneration !== cardCacheGeneration/,
  'stale card restores and bakes must not repopulate the next world cache',
);
assert.match(
  forestBuilder,
  /catch \(error\)[\s\S]*preloadPromise === request[\s\S]*preloadPromise = null/,
  'a rejected early preload must be retryable by the real forest build',
);
assert.match(
  forestProps,
  /seedThree\.resetSeedThreeForestPreloadState\(\)/,
  'disposing one world must reset the module preload barrier for the next world',
);
assert.match(
  seedThreeImpostor,
  /pixelsPromise = renderer\.readRenderTargetPixelsAsync[\s\S]*readbacks\.push\(\{ ch, pixelsPromise \}\)/,
  'each exact channel copy must be submitted without a per-channel GPU map stall',
);
assert.match(
  seedThreeImpostor,
  /Promise\.all\(readbacks\.map\(\(\{ pixelsPromise \}\) => pixelsPromise\)\)/,
  'all four exact channel readbacks must resolve before pixel conversion begins',
);
assert.doesNotMatch(
  seedThreeImpostor,
  /pixels\s*=\s*await renderer\.readRenderTargetPixelsAsync\(rt, 0, 0, size, size\)/,
  'the cold atlas path must not retain four serialized WebGPU mapAsync barriers per variant',
);
assert.match(
  forestProps,
  /const materialsPromise = createForestMaterials[\s\S]*const undergrowthMaterialsPromise = createUndergrowthMaterials[\s\S]*computeForestTreePlacements/,
  'forest and undergrowth texture decode must overlap deterministic CPU placement',
);
assert.match(
  sceneManager,
  /const \[forestManager\] = await Promise\.all\(\[forestPromise, worldDetailsPromise\]\)/,
  'forest construction must overlap independent river and quarry detail work',
);
for (const stage of [
  'deer',
  'fish',
  'berry',
  'grass',
  'details',
  'forest',
  'mushrooms',
]) {
  assert.ok(
    sceneManager.includes(`startStage('${stage}'`),
    `vegetation startup telemetry must retain the ${stage} stage`,
  );
}
assert.match(
  sceneManager,
  /__medievalRoadStartup\.vegetation = \{[\s\S]*totalMs:[\s\S]*stages/,
  'real builds must expose a stage breakdown through startup diagnostics',
);

console.log(JSON.stringify({
  exactContent: true,
  promiseDedup: ['species-assets', 'persistent-card-restore', 'renderer-card-bake'],
  warmRestore: 'parallel-image-bitmap-plus-typed-array',
  coldPersistence: 'non-blocking-ordered-queue',
  concurrentStages: 7,
}));
