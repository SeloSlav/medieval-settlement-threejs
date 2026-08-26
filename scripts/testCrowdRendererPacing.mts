import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  restartPooledVillagerActions,
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
  type VillagerRenderMode,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import {
  isWithinWorkAnimationRange,
  type CrowdViewState,
} from '../src/settlement/crowdView.ts';

const MAX_ANIMATED_VILLAGERS = 72;

type SelectionHarness = {
  animatedCandidates: CrowdRenderAgent[];
  animatedIds: Set<string>;
  pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string>;
};

type RenderAgentCacheHarness = {
  renderAgentsById: Map<string, CrowdRenderAgent>;
  renderAgentFor(id: string): CrowdRenderAgent;
};

function createSelectionHarness(): SelectionHarness {
  const harness = Object.create(SettlementCrowdRenderer.prototype) as SelectionHarness;
  harness.animatedCandidates = [];
  harness.animatedIds = new Set<string>();
  return harness;
}

function referenceSelection(
  agents: readonly CrowdRenderAgent[],
  view?: CrowdViewState,
): Set<string> {
  const candidates = agents.filter((agent) =>
    isWithinWorkAnimationRange(agent.x, agent.z, view)
  );
  if (view) {
    candidates.sort((a, b) => {
      const aDx = a.x - view.centerX;
      const aDz = a.z - view.centerZ;
      const bDx = b.x - view.centerX;
      const bDz = b.z - view.centerZ;
      return aDx * aDx + aDz * aDz - (bDx * bDx + bDz * bDz);
    });
  }
  return new Set(
    candidates.slice(0, MAX_ANIMATED_VILLAGERS).map((agent) => agent.id),
  );
}

const modes: VillagerRenderMode[] = [
  'idle',
  'walk',
  'sit',
  'chop',
  'mine',
  'gather',
  'plant',
  'sow',
  'fish',
  'tend',
  'build',
  'fight',
];
const agents: CrowdRenderAgent[] = Array.from({ length: 1024 }, (_, index) => ({
  id: `agent:${index}`,
  slot: index,
  x: index % 64 * 5 - 160,
  y: 0,
  z: Math.floor(index / 64) * 5 - 40,
  yaw: index * 0.013,
  appearanceSeed: index * 2654435761 >>> 0,
  variant: index % 2 === 0 ? 'man' : 'woman',
  mode: modes[index % modes.length]!,
  tunicColor: 0x835f3f,
  skinColor: 0xc9946a,
  hairColor: 0x3d2b22,
  tool: null,
  movementSpeed: 1.2,
  active: index % 7 !== 0,
}));
const view: CrowdViewState = {
  centerX: 0,
  centerZ: 0,
  viewRadius: 240,
};

const harness = createSelectionHarness();
for (const selectedView of [view, undefined]) {
  assert.deepEqual(
    [...harness.pickAnimatedIds(agents, selectedView)],
    [...referenceSelection(agents, selectedView)],
    'scratch-backed selection must preserve the original eligibility, ordering, and cap',
  );
}
const candidateBuffer = harness.animatedCandidates;
const idBuffer = harness.animatedIds;
harness.pickAnimatedIds(agents, view);
assert.equal(harness.animatedCandidates, candidateBuffer);
assert.equal(harness.animatedIds, idBuffer);

const iterations = 20_000;
let checksum = 0;
const startedAt = performance.now();
for (let iteration = 0; iteration < iterations; iteration++) {
  checksum += harness.pickAnimatedIds(agents, view).size;
}
const elapsedMs = performance.now() - startedAt;
assert.equal(checksum, iterations * MAX_ANIMATED_VILLAGERS);
assert.ok(
  elapsedMs < 1_500,
  `20k worst-case 1,024-agent selections took ${elapsedMs.toFixed(1)}ms`,
);

const source = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
for (const allocationPattern of [
  /this\.latestAgents\s*=\s*\[\.\.\.agents\]/,
  /const visibleAgents\s*=.*\.filter\(/,
  /const candidates\s*=.*\.filter\(/,
  /new Map\(agents\.map\(/,
  /const proxyAgents\s*=.*\.filter\(/,
]) {
  assert.doesNotMatch(source, allocationPattern);
}

const villagerSource = readFileSync(
  new URL('../src/settlement/VillagerRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  villagerSource,
  /const renderAgents:\s*CrowdRenderAgent\[\]\s*=\s*\[\]/,
);
assert.doesNotMatch(villagerSource, /renderAgents\.push\(\s*\{/);
for (const assignment of [
  'slot',
  'x',
  'y',
  'z',
  'yaw',
  'appearanceSeed',
  'variant',
  'mode',
  'tunicColor',
  'skinColor',
  'hairColor',
  'tool',
  'movementSpeed',
  'active',
]) {
  assert.match(villagerSource, new RegExp(`renderAgent\\.${assignment}\\s*=`));
}

const renderCache = Object.create(SettlementCrowdRenderer.prototype) as unknown as
  RenderAgentCacheHarness;
// VillagerRenderer's cache method has the same private method shape; bind its
// prototype without constructing the browser/audio-dependent renderer.
const villagerModule = await import('../src/settlement/VillagerRenderer.ts');
const VillagerRendererClass = villagerModule.VillagerRenderer as unknown as {
  prototype: RenderAgentCacheHarness;
};
Object.setPrototypeOf(renderCache, VillagerRendererClass.prototype);
renderCache.renderAgentsById = new Map<string, CrowdRenderAgent>();
const firstAgents = Array.from({ length: 1024 }, (_, index) =>
  renderCache.renderAgentFor(`cached:${index}`)
);
for (let frame = 0; frame < 1_000; frame++) {
  for (let index = 0; index < firstAgents.length; index++) {
    assert.equal(renderCache.renderAgentFor(`cached:${index}`), firstAgents[index]);
  }
}
assert.equal(renderCache.renderAgentsById.size, firstAgents.length);

const animationRoot = new THREE.Object3D();
const animationMixer = new THREE.AnimationMixer(animationRoot);
const actionModes: VillagerRenderMode[] = [
  'idle', 'walk', 'sit', 'rest', 'talk', 'pray', 'chop', 'mine',
  'gather', 'plant', 'sow', 'fish', 'tend', 'build', 'fight',
];
const pooledActions = Object.fromEntries(actionModes.map((mode) => [
  mode,
  animationMixer.clipAction(new THREE.AnimationClip(mode, 2, []), animationRoot),
])) as Record<VillagerRenderMode, THREE.AnimationAction>;
pooledActions.idle.play();
animationMixer.update(0.4);
const pooledAppearanceSeed = 431;
restartPooledVillagerActions(
  animationMixer,
  pooledActions,
  'walk',
  pooledAppearanceSeed,
  1.8,
);
const expectedWalkPhase = pooledAppearanceSeed % 997 / 997 * 2;
assert.equal(pooledActions.idle.isRunning(), false);
assert.equal(pooledActions.walk.isRunning(), true);
assert.ok(Math.abs(pooledActions.walk.time - expectedWalkPhase) < 1e-12);
assert.ok(Math.abs(pooledActions.walk.getEffectiveTimeScale() - 1.59) < 1e-12);
animationMixer.update(0.5);
restartPooledVillagerActions(
  animationMixer,
  pooledActions,
  'walk',
  pooledAppearanceSeed,
  1.8,
);
assert.ok(
  Math.abs(pooledActions.walk.time - expectedWalkPhase) < 1e-12,
  'same-ID pooled reacquire must restart the authored action at its deterministic phase',
);

type PoolVisual = {
  id: string;
  variant: 'man' | 'woman';
  toolKind: null;
  tool: null;
  root: THREE.Group;
  mixer: { stopAllAction(): void };
};
type PoolHarness = {
  animated: Map<string, PoolVisual>;
  animatedPool: Map<string, PoolVisual[]>;
  idlePooledVisualCount: number;
  resetPooledVillager(visual: PoolVisual, agent: CrowdRenderAgent): void;
  createAnimatedVillager(agent: CrowdRenderAgent): PoolVisual;
  disposeAnimatedVillager(visual: PoolVisual): void;
  removeAnimatedVillager(id: string): void;
  acquireAnimatedVillager(agent: CrowdRenderAgent): PoolVisual;
};
const poolHarness = Object.create(
  SettlementCrowdRenderer.prototype,
) as PoolHarness;
poolHarness.animated = new Map();
poolHarness.animatedPool = new Map();
poolHarness.idlePooledVisualCount = 0;
let poolDisposals = 0;
let poolResets = 0;
poolHarness.disposeAnimatedVillager = () => {
  poolDisposals += 1;
};
poolHarness.resetPooledVillager = (visual, agent) => {
  poolResets += 1;
  visual.id = agent.id;
};
poolHarness.createAnimatedVillager = (agent) => ({
  id: agent.id,
  variant: agent.variant,
  toolKind: null,
  tool: null,
  root: new THREE.Group(),
  mixer: { stopAllAction() {} },
});
for (let index = 0; index < 73; index++) {
  const visual = poolHarness.createAnimatedVillager(agents[index]!);
  poolHarness.animated.set(visual.id, visual);
}
for (const id of [...poolHarness.animated.keys()]) {
  poolHarness.removeAnimatedVillager(id);
}
assert.equal(poolHarness.idlePooledVisualCount, 72);
assert.equal(poolDisposals, 1, 'idle visual pooling must dispose overflow beyond the animated cap');
const sameIdAgent = agents[71]!;
const reacquiredVisual = poolHarness.acquireAnimatedVillager(sameIdAgent);
assert.equal(reacquiredVisual.id, sameIdAgent.id);
assert.equal(poolResets, 1, 'every pooled pop must reset, including same-ID reacquire');
assert.equal(poolHarness.idlePooledVisualCount, 71);

assert.match(source, /private readonly animatedPool = new Map<string, AnimatedVillager\[\]>\(\);/);
assert.match(source, /if \(pooledVisual\) this\.resetPooledVillager\(visual, agent\);/);
assert.match(source, /this\.idlePooledVisualCount >= MAX_ANIMATED_VILLAGERS/);
assert.match(
  source,
  /this\.syncAnimatedVillagers\(visibleAgents, animatedIds, dt\);\s*this\.updateAnimatedBatches\(visibleAgents, animatedIds\);/,
);
assert.doesNotMatch(source, /createProxyLayers|updateProxyLayers|villager LOD/i);
assert.match(source, /mesh\.visible = false;\s*mesh\.castShadow = false;/);
assert.doesNotMatch(source, /castShadow = true/);
assert.doesNotMatch(source, /shadowCaster|isWithinShadowRange/i);
assert.match(source, /material\.vertexColors = true;/);
assert.doesNotMatch(source, /mergeGeometries/);

console.log(
  `Crowd renderer pacing tests passed (${iterations.toLocaleString()} selections in ${elapsedMs.toFixed(1)}ms; `
    + 'agents outside the animated range are culled).',
);
