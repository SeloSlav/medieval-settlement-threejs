import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  STRATEGIC_HUMANOID_LAYER_COUNT,
  STRATEGIC_HUMANOID_TRIANGLE_BUDGET_PER_PERSON,
  StrategicHumanoidRenderer,
  type StrategicHumanoidAgent,
} from '../src/settlement/StrategicHumanoidRenderer.ts';
import {
  AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE,
  buildCrowdViewState,
  isAgentAnimalRenderingEnabled,
  isPeopleRenderingEnabled,
  isWithinAnimalCrowdView,
  isWithinCrowdView,
} from '../src/settlement/crowdView.ts';
import type { WorkerToolKind } from '../src/settlement/workerTools.ts';

const EQUIPMENT: WorkerToolKind[] = [
  'spear',
  'spear-shield',
  'pike-kit',
  'sidearm',
  'sidearm-shield',
  'sword-shield',
  'halberd',
  'bow',
  'crossbow',
  'uskok-kit',
];
const MODES = ['idle', 'walk', 'run', 'fight', 'hurt', 'fall', 'flee'] as const;

function makeBattle(count: number): StrategicHumanoidAgent[] {
  const formationWidth = Math.max(1, Math.ceil(Math.sqrt(count / 2)));
  return Array.from({ length: count }, (_, index) => {
    const enemy = index >= Math.ceil(count / 2);
    const localIndex = enemy ? index - Math.ceil(count / 2) : index;
    return {
      id: `${enemy ? 'raider' : 'croatian'}:${localIndex}`,
      slot: index,
      x: (localIndex % formationWidth) * 1.35 + (enemy ? 42 : -42),
      y: 0,
      z: Math.floor(localIndex / formationWidth) * 1.45 - 8,
      yaw: enemy ? -Math.PI / 2 : Math.PI / 2,
      appearanceSeed: Math.imul(index + 1, 2_654_435_761) >>> 0,
      variant: 'man',
      presentation: enemy ? 'raider' : 'common',
      mode: MODES[index % MODES.length],
      tunicColor: enemy ? 0x6a3029 : 0x244a70,
      skinColor: index % 3 === 0 ? 0xb87955 : 0xd19a72,
      hairColor: index % 4 === 0 ? 0x2b211d : 0x5a3a27,
      tool: EQUIPMENT[index % EQUIPMENT.length],
      movementSpeed: index % 3 === 0 ? 3.2 : 1.4,
      active: true,
      combatTargetDistance: index % 4 === 0 ? 2.2 : 12,
    } satisfies StrategicHumanoidAgent;
  });
}

function assertBattleContract(
  renderer: StrategicHumanoidRenderer,
  count: number,
  label: string,
): void {
  const agents = makeBattle(count);
  renderer.sync(agents, undefined, 1 / 60);
  const diagnostics = renderer.diagnostics();
  assert.equal(
    diagnostics.instances,
    count,
    `${label}: every combatant must have a strategic humanoid`,
  );
  assert.equal(
    diagnostics.capsuleProxyCount,
    0,
    `${label}: the former white capsule proxy tier must stay deleted`,
  );
  assert.ok(diagnostics.layerDraws > 0);
  assert.ok(
    diagnostics.layerDraws <= STRATEGIC_HUMANOID_LAYER_COUNT,
    `${label}: body submissions must be bounded shared layers`,
  );
  assert.ok(
    diagnostics.trianglesPerPerson <= STRATEGIC_HUMANOID_TRIANGLE_BUDGET_PER_PERSON,
    `${label}: the recognizable silhouette must stay inside its authored topology budget`,
  );
  assert.equal(
    diagnostics.submittedTriangles,
    diagnostics.instances * diagnostics.trianglesPerPerson,
    `${label}: triangle evidence must account for every represented person`,
  );
}

const parent = new THREE.Group();
const renderer = new StrategicHumanoidRenderer(parent, 1_024);
assertBattleContract(renderer, 96 * 2, '96 v 96');
assertBattleContract(renderer, 216, '216-person mixed battle');

const closeIds = new Set(makeBattle(216).slice(0, 72).map((agent) => agent.id));
const mixedLodBattle = makeBattle(216);
renderer.sync(mixedLodBattle, closeIds, 1 / 60);
assert.equal(
  renderer.diagnostics().instances,
  216 - 72,
  'the close authored-rig cohort must be excluded only from the strategic tier',
);

const meshes: THREE.InstancedMesh[] = [];
parent.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (mesh.isInstancedMesh) meshes.push(mesh);
});
assert.ok(meshes.length > 0);
assert.ok(meshes.length <= STRATEGIC_HUMANOID_LAYER_COUNT);
const semanticLayers = new Set<string>();
for (const mesh of meshes) {
  assert.notEqual(mesh.geometry.type, 'CapsuleGeometry');
  assert.doesNotMatch(mesh.name, /pill|capsule|loading body/i);
  semanticLayers.add(mesh.name.split('·').at(-1)?.trim() ?? mesh.name);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(mesh.count, 216 - 72);
  assert.ok(mesh.instanceColor, `${mesh.name} must publish its authored color identity`);
  const firstColor = new THREE.Color();
  mesh.getColorAt(0, firstColor);
  assert.notEqual(firstColor.getHex(), 0xffffff, `${mesh.name} cannot regress to a white pill`);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  assert.ok(material instanceof THREE.MeshStandardMaterial);
  assert.ok(material.roughness >= 0.7);
}
for (const requiredLayer of [
  'torso', 'pelvis', 'head', 'headwear',
  'left-arm', 'right-arm', 'left-leg', 'right-leg',
]) {
  assert.ok(semanticLayers.has(requiredLayer), `missing articulated ${requiredLayer} layer`);
}
const torso = meshes.find((mesh) => mesh.name.endsWith('torso'))!;
const friendlyTunic = new THREE.Color();
const enemyTunic = new THREE.Color();
torso.getColorAt(0, friendlyTunic);
torso.getColorAt(36, enemyTunic);
assert.notEqual(
  friendlyTunic.getHex(),
  enemyTunic.getHex(),
  'opposing faction clothing must remain identifiable at strategic zoom',
);

// The full 1,024-person capacity is a CPU pacing guard, not a promise that
// every other game system can simulate 1,024 combatants for free. Its update
// budget leaves most of a 16.67 ms frame available for terrain, AI, and UI.
const capacityBattle = makeBattle(1_024);
for (let frame = 0; frame < 30; frame++) {
  renderer.sync(capacityBattle, undefined, 1 / 60);
}
const frames = 240;
const startedAt = performance.now();
for (let frame = 0; frame < frames; frame++) {
  renderer.sync(capacityBattle, undefined, 1 / 60);
}
const averageUpdateMs = (performance.now() - startedAt) / frames;
assert.equal(renderer.diagnostics().instances, 1_024);
assert.ok(
  averageUpdateMs < 6,
  `1,024 strategic humanoids cost ${averageUpdateMs.toFixed(2)}ms/frame`,
);

const farView = buildCrowdViewState(
  0,
  0,
  AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE + 80,
);
assert.equal(isPeopleRenderingEnabled(farView), true);
assert.equal(isWithinCrowdView(0, 0, farView), true);
assert.equal(isAgentAnimalRenderingEnabled(farView), false);
assert.equal(isWithinAnimalCrowdView(0, 0, farView), false);

const strategicSource = readFileSync(
  new URL('../src/settlement/StrategicHumanoidRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(strategicSource, /CapsuleGeometry/);
const syncStart = strategicSource.indexOf('  sync(');
const diagnosticStart = strategicSource.indexOf('  diagnostics(', syncStart);
assert.ok(syncStart >= 0 && diagnosticStart > syncStart);
const syncSource = strategicSource.slice(syncStart, diagnosticStart);
for (const allocationPattern of [
  /Array\.from\(/,
  /\.filter\(/,
  /\.map\(/,
  /\.slice\(/,
  /\[\.\.\./,
  /new Map\(/,
  /new Set\(/,
  /new THREE\./,
]) {
  assert.doesNotMatch(
    syncSource,
    allocationPattern,
    'the every-frame strategic update must reuse owned scratch state',
  );
}

const crowdSource = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(crowdSource, /CapsuleGeometry/);
assert.match(crowdSource, /MAX_ANIMATED_VILLAGERS\s*=\s*72/);
assert.match(crowdSource, /isPeopleRenderingEnabled\(view\)/);
assert.match(crowdSource, /syncAnimatedVillagers\(visibleAgents, animatedIds, dt\)/);
assert.match(crowdSource, /strategicHumanoids\.sync\(visibleAgents, animatedIds, dt\)/);

renderer.dispose();
assert.equal(parent.children.length, 0);

console.log(
  `Strategic humanoid contracts passed (96 v 96 and 216 represented; `
    + `1,024 update ${averageUpdateMs.toFixed(2)}ms/frame; zero capsule proxies).`,
);
