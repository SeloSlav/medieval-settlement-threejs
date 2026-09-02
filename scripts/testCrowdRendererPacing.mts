import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  combatAnimationCadenceScale,
  restartPooledVillagerActions,
  SettlementCrowdRenderer,
  villagerAnimationStartTime,
  type CrowdRenderAgent,
  type VillagerRenderMode,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import type { CrowdViewState } from '../src/settlement/crowdView.ts';
import { locomotionAnimationTimeScale } from '../src/settlement/locomotionAnimation.ts';

type SelectionHarness = {
  animatedIds: Set<string>;
  pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string>;
};

function createSelectionHarness(): SelectionHarness {
  const harness = Object.create(SettlementCrowdRenderer.prototype) as SelectionHarness;
  harness.animatedIds = new Set<string>();
  return harness;
}

const modes: VillagerRenderMode[] = [
  'idle', 'walk', 'sit', 'chop', 'mine', 'gather', 'plant', 'sow',
  'fish', 'tend', 'build', 'fight', 'hurt', 'fall', 'flee', 'run',
];
const agents: CrowdRenderAgent[] = Array.from({ length: 1_024 }, (_, index) => ({
  id: `agent:${index}`,
  slot: index,
  x: index % 64 * 5 - 160,
  y: 0,
  z: Math.floor(index / 64) * 5 - 40,
  yaw: index * 0.013,
  appearanceSeed: index * 2_654_435_761 >>> 0,
  variant: index % 2 === 0 ? 'man' : 'woman',
  mode: modes[index % modes.length]!,
  tunicColor: 0x835f3f,
  skinColor: 0xc9946a,
  hairColor: 0x3d2b22,
  tool: null,
  movementSpeed: 1.2,
  active: true,
}));
const nearView: CrowdViewState = {
  centerX: 0,
  centerZ: 0,
  viewRadius: 240,
  orbitDistance: 24,
};
const strategicView: CrowdViewState = {
  ...nearView,
  orbitDistance: 2_400,
};

const harness = createSelectionHarness();
for (const view of [nearView, strategicView, undefined]) {
  const selected = harness.pickAnimatedIds(agents, view);
  assert.equal(selected.size, agents.length, 'every visible agent must retain its authored rig');
  assert.deepEqual([...selected], agents.map((agent) => agent.id));
}
const idBuffer = harness.animatedIds;
harness.pickAnimatedIds(agents, strategicView);
assert.equal(harness.animatedIds, idBuffer, 'selection must reuse its Set backing store');

const iterations = 2_000;
const startedAt = performance.now();
let checksum = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  checksum += harness.pickAnimatedIds(agents, strategicView).size;
}
const elapsedMs = performance.now() - startedAt;
assert.equal(checksum, iterations * agents.length);
assert.ok(elapsedMs < 1_500, `2k exact 1,024-agent selections took ${elapsedMs.toFixed(1)}ms`);

const source = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(source, /AuthoredSkinnedInstanceBatch/);
assert.match(source, /setFromCloneAt\(slot, visual\.model\)/);
assert.match(source, /ExactMountedAttachmentBatch/);
assert.match(source, /proxyAgents:\s*0/);
for (const forbidden of [
  /StrategicHumanoidRenderer/,
  /FallbackMilitaryEquipmentRenderer/,
  /AUTHORED_RIG_(?:DISABLE|RESTORE)_ORBIT_DISTANCE/,
  /MAX_ANIMATED_VILLAGERS/,
  /createReplicatedSkinnedGeometry/,
  /CapsuleGeometry/,
]) {
  assert.doesNotMatch(source, forbidden);
}

const animationRoot = new THREE.Object3D();
const animationMixer = new THREE.AnimationMixer(animationRoot);
const actionModes: VillagerRenderMode[] = [
  'idle', 'walk', 'sit', 'rest', 'talk', 'pray', 'chop', 'mine',
  'gather', 'plant', 'sow', 'fish', 'tend', 'build', 'fight',
  'relax', 'look', 'wait', 'laugh', 'greet', 'sermon', 'agree', 'bow',
  'carry', 'hurt', 'fall', 'flee', 'run',
];
const pooledActions = Object.fromEntries(actionModes.map((mode) => [
  mode,
  animationMixer.clipAction(new THREE.AnimationClip(mode, 2, []), animationRoot),
])) as Record<VillagerRenderMode, THREE.AnimationAction>;
pooledActions.idle.play();
animationMixer.update(0.4);
const appearanceSeed = 431;
const animationRateScale = combatAnimationCadenceScale(appearanceSeed);
restartPooledVillagerActions(
  animationMixer,
  pooledActions,
  'walk',
  appearanceSeed,
  1.8,
  animationRateScale,
);
const expectedWalkPhase = villagerAnimationStartTime('walk', appearanceSeed, 2);
assert.equal(pooledActions.idle.isRunning(), false);
assert.equal(pooledActions.walk.isRunning(), true);
assert.ok(Math.abs(pooledActions.walk.time - expectedWalkPhase) < 1e-12);
assert.ok(Math.abs(
  pooledActions.walk.getEffectiveTimeScale()
    - locomotionAnimationTimeScale('walk', 1.8) * animationRateScale,
) < 1e-12);
assert.equal(villagerAnimationStartTime('fall', appearanceSeed, 2), 0);
assert.notEqual(
  villagerAnimationStartTime('idle', appearanceSeed, 2),
  villagerAnimationStartTime('walk', appearanceSeed, 2),
  'each looping semantic clip should have an independently salted phase',
);
const combatCadences = Array.from(
  { length: 64 },
  (_, index) => combatAnimationCadenceScale(index * 2_654_435_761 >>> 0),
);
assert.ok(combatCadences.every((cadence) => cadence >= 0.96 && cadence <= 1.04));
assert.ok(new Set(combatCadences.map((cadence) => cadence.toFixed(5))).size > 56);
assert.match(source, /this\.transition\(visual, agent\.mode, nextActionMode, agent\.appearanceSeed\)/);
assert.match(source, /nextAction\.time = villagerAnimationStartTime/);

console.log(
  `Exact crowd selection verified: ${agents.length} authored rigs at near and strategic zoom (${elapsedMs.toFixed(1)}ms selection benchmark).`,
);
