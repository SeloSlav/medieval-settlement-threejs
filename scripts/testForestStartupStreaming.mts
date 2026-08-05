import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeWorldBootstrapDataHeadless } from '../src/world/worldBootstrapData.ts';

const sceneManager = fs.readFileSync('src/scene/SceneManager.ts', 'utf8');
const app = fs.readFileSync('src/app/App.ts', 'utf8');
const forestProps = fs.readFileSync('src/props/ForestProps.ts', 'utf8');
const forestBuilder = fs.readFileSync(
  'src/vegetation/seedthree/seedThreeForestBuilder.ts',
  'utf8',
);

assert.ok(
  /if \(this\.vegetationBuildActive\) \{[\s\S]{0,300}\breturn;\s*\}/.test(sceneManager),
  'screen rendering must not interleave with the startup-only branch-card bake',
);

const vegetationReadyIndex = app.indexOf('await session.sceneManager.finishVegetation();');
const playerEntryIndex = app.indexOf('this.sessionLifecycle?.onPresentationReady();');
assert.ok(
  vegetationReadyIndex >= 0 && vegetationReadyIndex < playerEntryIndex,
  'the complete forest must finish before the loading screen admits the player',
);
assert.doesNotMatch(
  app,
  /requestIdleCallback\(buildVegetation|setTimeout\([\s\S]{0,300}buildVegetation/,
  'forest creation must not retain the old delayed background-start path',
);
assert.ok(
  app.includes("detail: 'Terrain and woodland ready'"),
  'the entry state must describe the fully resident world accurately',
);

assert.equal(
  forestBuilder.includes('yieldToMain'),
  false,
  'startup forest assembly must not stretch across hundreds of animation-frame yields',
);
assert.ok(
  /updateCamera:[\s\S]{0,900}updateSeedThreeForestCamera\(/.test(forestBuilder)
    && /export function updateSeedThreeForestCamera\([\s\S]{0,900}updateSeedThreeForestCameraBudgeted\(/.test(forestBuilder),
  'the runtime controller must use the frame-budgeted conservative camera compactor',
);
assert.ok(
  /updateSeedThreeForestCameraBudgeted\([\s\S]{0,500}maxUpdateDurationMs:\s*(?!Number\.POSITIVE_INFINITY)[A-Z0-9_.]+/.test(forestBuilder),
  'runtime forest compaction must carry an explicit finite main-thread time budget',
);
assert.ok(
  forestBuilder.includes('const nearSlotIndices = slots.map((_, index) => index)')
    && forestBuilder.includes('slot.forceOverview ? [index] : []'),
  'every overview tree must retain its real near LOD underneath the fading quad layer',
);
assert.ok(
  forestBuilder.includes("const initialSelection = selection.triggerReasons.includes('initial')")
    && /completeInteractionWorkImmediately\s*=\s*initialSelection/.test(forestBuilder),
  'the first camera-sized forest selection must publish atomically before rendering',
);
assert.ok(
  forestBuilder.includes("Math.max(Math.abs(placement.x), Math.abs(placement.z)) >= terrain.generationSize * 0.44"),
  'remote edge trees should use a static overview mesh without becoming invisible',
);
assert.ok(
  forestBuilder.includes('if (forest.visibilityDirty === false) return;'),
  'authoritative mature-tree sync must not rewrite unchanged startup matrices',
);
assert.doesNotMatch(
  forestProps,
  /onGroupCreated|onRendererBusyChange/,
  'the forest should be attached once, complete, instead of publishing partial species buckets',
);
assert.ok(
  app.includes('if (this.gameState.trees.size > 0) {\n      this.forestVisualSync.syncAll'),
  'an empty pre-bootstrap tree table must not hide the generated forest',
);

const trees = computeWorldBootstrapDataHeadless().trees;
assert.ok(trees.length >= 4_500, 'the default world should contain the requested high-density forest');

const nearestDistances = trees.map((tree, index) => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let otherIndex = 0; otherIndex < trees.length; otherIndex++) {
    if (otherIndex === index) continue;
    const other = trees[otherIndex];
    nearest = Math.min(nearest, Math.hypot(tree.x - other.x, tree.z - other.z));
  }
  return nearest;
}).sort((a, b) => a - b);
const medianNearest = nearestDistances[Math.floor(nearestDistances.length * 0.5)];
assert.ok(
  medianNearest <= 5.5,
  `the median tree should sit inside touching-crown spacing (received ${medianNearest.toFixed(2)}m)`,
);

const clusteredTrees = trees.filter((tree, index) => {
  let neighbors = 0;
  for (let otherIndex = 0; otherIndex < trees.length; otherIndex++) {
    if (otherIndex === index) continue;
    const other = trees[otherIndex];
    if (Math.hypot(tree.x - other.x, tree.z - other.z) <= 12) neighbors++;
  }
  return neighbors >= 4;
}).length;
const clusteredShare = clusteredTrees / trees.length;
assert.ok(
  clusteredShare >= 0.5,
  `at least half of all trees should form dense local stands (received ${(clusteredShare * 100).toFixed(1)}%)`,
);

console.log(JSON.stringify({
  trees: trees.length,
  medianNearestMeters: Number(medianNearest.toFixed(2)),
  clusteredPercent: Number((clusteredShare * 100).toFixed(1)),
  runtimeResidency: 'camera-compacted-overlapping-overview-lod',
}));
