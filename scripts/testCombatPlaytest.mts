import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMBAT_PLAYTEST_AGENT_PREFIX,
  COMBAT_PLAYTEST_RANGED_TARGET_RETENTION_FACTOR,
  CombatPlaytestSimulation,
  combatPlaytestCamera,
  combatPlaytestPresetDefinition,
  combatPlaytestWorldSettings,
  denseMeleeEngagementRank,
  parseCombatPlaytestRequest,
  type MeleeEngagementRankMember,
  type CombatPlaytestPreset,
} from '../src/app/combatPlaytest.ts';
import { engagementSlotRadius } from '../src/security/combatSteering.ts';

const seed = 0x431a_2e0d;
const site = { x: 0, z: 0, axisX: 1, axisZ: 0 };

assert.equal(parseCombatPlaytestRequest('?combatPreset=stress'), null);
assert.deepEqual(
  parseCombatPlaytestRequest('?combatPlaytest=1&combatPreset=stress&combatSeed=431a2e0d'),
  { enabled: true, preset: 'stress', seed },
);
assert.equal(parseCombatPlaytestRequest('?combatPlaytest=true')?.preset, 'field');

const world = combatPlaytestWorldSettings(seed);
assert.equal(world.seed, seed);
assert.equal(world.mapSize, 'medium');
assert.equal(world.terrainPreset, 'delnice_meadow');
assert.equal(world.conflictMode, 'peaceful');
assert.equal(world.banditCampsEnabled, false);

assert.deepEqual(
  (['skirmish', 'field', 'stress'] as const).map((preset) => {
    const definition = combatPlaytestPresetDefinition(preset);
    return [definition.friendlyCount, definition.enemyCount];
  }),
  [[32, 32], [64, 64], [256, 256]],
);

const simulation = createSimulation('field');
assert.deepEqual(simulation.summary(), {
  preset: 'field',
  seed,
  friendlyAlive: 64,
  friendlyTotal: 64,
  enemyAlive: 64,
  enemyTotal: 64,
  outcome: 'active',
});

const opening = simulation.snapshot();
const friendly = [...opening.values()].filter((agent) => agent.faction !== 'raider');
const enemy = [...opening.values()].filter((agent) => agent.faction === 'raider');
assert.equal(new Set(friendly.map((agent) => agent.companyId)).size, 8);
assert.deepEqual(
  [...new Set(friendly.map((agent) => agent.faction))].sort(),
  [
    'bowman',
    'crossbow',
    'footman',
    'man-at-arms',
    'mercenary-spear',
    'militia',
    'polearm',
    'spearman',
  ],
);
for (const faction of [
  'militia',
  'spearman',
  'man-at-arms',
  'footman',
  'mercenary-spear',
  'polearm',
  'bowman',
  'crossbow',
]) {
  assert.equal(friendly.filter((agent) => agent.faction === faction).length, 8);
}
assert.ok(enemy.every((agent) => agent.faction === 'raider'));
assert.ok(friendly.every((agent) => agent.status === 'holding'));
assert.ok(enemy.every((agent) => agent.status === 'advancing'));

// Fixed source slots must not strand survivors on an outer melee ring after
// the first rank dies. The next ten stable survivors compact into ranks 0..9,
// whose goals are inside the spearmen's authored strike range.
{
  const cohort: MeleeEngagementRankMember[] = Array.from({ length: 32 }, (_, sourceSlot) => ({
    state: { sourceSlot },
    steeringSeed: sourceSlot + 1,
    steeringTeam: 1,
    steeringCompany: 77,
    steeringEnabled: true,
    meleeEngaging: true,
    meleeEngagementTargetId: 'shared-target',
  }));
  assert.equal(denseMeleeEngagementRank(cohort[10]!, cohort), 10);
  assert.ok(
    engagementSlotRadius(2.6, 10) > 2.6,
    'the pre-casualty outer rank should begin beyond immediate spear strike range',
  );
  for (let slot = 0; slot < 10; slot += 1) {
    cohort[slot]!.steeringEnabled = false;
    cohort[slot]!.meleeEngaging = false;
  }
  for (let slot = 10; slot < 20; slot += 1) {
    const promotedRank = denseMeleeEngagementRank(cohort[slot]!, cohort);
    assert.equal(promotedRank, slot - 10, `source slot ${slot} must compact after casualties`);
    assert.ok(
      engagementSlotRadius(2.6, promotedRank) <= 2.6,
      `promoted source slot ${slot} must be able to enter spear strike range`,
    );
  }
}

// The Ottoman ranks are deliberately spread across several lanes. Each ranged
// company must nevertheless designate one stable company target/frame instead
// of bending its individual lateral/depth slots around different nearest foes.
{
  const rangedFormation = createSimulation('field');
  const observed = new Set<string>();
  for (let step = 0; step < 220; step += 1) {
    rangedFormation.tick(0.05);
    const frame = [...rangedFormation.snapshot().values()];
    for (const faction of ['bowman', 'crossbow'] as const) {
      const targets = new Set(
        frame
          .filter((agent) => (
            agent.faction === faction
            && agent.status !== 'downed'
            && agent.targetKind === 'combat-agent'
          ))
          .map((agent) => agent.targetId),
      );
      assert.ok(
        targets.size <= 1,
        `${faction} slots must share one designated target against spread enemies`,
      );
      if (targets.size === 1) observed.add(faction);
    }
  }
  assert.deepEqual(
    [...observed].sort(),
    ['bowman', 'crossbow'],
    'both ranged companies must enter their shared engagement frames',
  );
}

// A designated ranged-company target is sticky through ordinary formation
// motion, but must expire while still alive once the company deliberately
// moves beyond 1.35x acquisition range.
{
  const retention = createSimulation('field');
  const bowCompanyId = `${COMBAT_PLAYTEST_AGENT_PREFIX}company:bowman`;
  let originalTargetId: string | null = null;
  for (let step = 0; step < 300 && !originalTargetId; step += 1) {
    retention.tick(0.05);
    originalTargetId = retention.rangedCompanyTarget(bowCompanyId);
  }
  assert.ok(originalTargetId, 'bowmen must acquire a shared target for retention testing');
  const bowIds = [...retention.snapshot().values()]
    .filter((agent) => agent.faction === 'bowman')
    .map((agent) => agent.id);
  assert.equal(retention.issueOrder(bowIds, -80, -20), 1);
  let replacementTargetId = originalTargetId;
  for (let step = 0; step < 400 && replacementTargetId === originalTargetId; step += 1) {
    retention.tick(0.05);
    replacementTargetId = retention.rangedCompanyTarget(bowCompanyId);
  }
  assert.notEqual(
    replacementTargetId,
    originalTargetId,
    'a ranged company must release a target beyond its retention envelope',
  );
  const retentionFrame = retention.snapshot();
  const originalTarget = retentionFrame.get(originalTargetId);
  assert.ok(originalTarget && originalTarget.status !== 'downed', 'retarget must not depend on death');
  const livingBows = [...retentionFrame.values()].filter((agent) => (
    agent.faction === 'bowman' && agent.status !== 'downed'
  ));
  const bowCenterX = average(livingBows.map((agent) => agent.x));
  const bowCenterZ = average(livingBows.map((agent) => agent.z));
  assert.ok(
    Math.hypot(originalTarget.x - bowCenterX, originalTarget.z - bowCenterZ)
      > 22 * COMBAT_PLAYTEST_RANGED_TARGET_RETENTION_FACTOR,
    'live target must expire only after leaving 1.35x bow acquisition range',
  );
}

const openingEnemyCenterX = average(enemy.map((agent) => agent.x));
tickFor(simulation, 0.5);
const chargedEnemyCenterX = average(
  [...simulation.snapshot().values()]
    .filter((agent) => agent.faction === 'raider')
    .map((agent) => agent.x),
);
assert.ok(
  chargedEnemyCenterX < openingEnemyCenterX - 0.75,
  'Ottoman AI should visibly engage from the opening instead of waiting in formation.',
);

// Right-click move orders remain authoritative even when a company is already
// inside local detection/weapon range.
tickFor(simulation, 5.5);
const beforeRetreat = simulation.snapshot();
const swords = [...beforeRetreat.values()].filter((agent) => agent.faction === 'man-at-arms');
const swordsBeforeX = average(swords.map((agent) => agent.x));
assert.equal(simulation.issueOrder(swords.map((agent) => agent.id), -31, -3), 1);
tickFor(simulation, 1.25);
const swordsAfter = [...simulation.snapshot().values()]
  .filter((agent) => agent.faction === 'man-at-arms' && agent.status !== 'downed');
assert.ok(
  average(swordsAfter.map((agent) => agent.x)) < swordsBeforeX - 1,
  'an explicit terrain order should reposition an engaged company instead of being replaced by aggro',
);
assert.ok(swordsAfter.some((agent) => agent.targetKind === 'ground'));

// Ranged companies should create space to reload/draw instead of standing in
// point-blank contact. Observe the production status contract over a battle.
let sawRangedSpacing = false;
let sawCasualty = false;
for (let step = 0; step < 1_200; step += 1) {
  const before = simulation.snapshot();
  simulation.tick(0.05);
  const frame = simulation.snapshot();
  if (!sawRangedSpacing) {
    sawRangedSpacing = [...before.values()].some((agent) => {
      if (
        agent.status !== 'fighting'
        || agent.targetKind !== 'combat-agent'
        || (agent.faction !== 'bowman' && agent.faction !== 'crossbow')
      ) return false;
      const previousTarget = before.get(agent.targetId);
      const nextAgent = frame.get(agent.id);
      const nextTarget = frame.get(agent.targetId);
      if (!previousTarget || !nextAgent || !nextTarget || nextAgent.status !== 'fighting') return false;
      const previousSpacing = Math.hypot(agent.x - previousTarget.x, agent.z - previousTarget.z);
      const nextSpacing = Math.hypot(nextAgent.x - nextTarget.x, nextAgent.z - nextTarget.z);
      return nextSpacing > previousSpacing + 0.005;
    });
  }
  if (step % 10 !== 0) continue;
  const summary = simulation.summary();
  sawCasualty ||= summary.friendlyAlive < 64 || summary.enemyAlive < 64;
}
assert.equal(
  sawRangedSpacing,
  true,
  'ranged companies should increase spacing while keeping a non-rout fighting target',
);
assert.equal(sawCasualty, true, 'enemy engagement should resolve attacks and casualties locally');

const deterministicA = createSimulation('skirmish');
const deterministicB = createSimulation('skirmish');
const companyIds = [...deterministicA.snapshot().values()]
  .filter((agent) => agent.faction === 'polearm')
  .map((agent) => agent.id);
assert.equal(deterministicA.issueOrder(companyIds, 2, 6), 1);
assert.equal(deterministicB.issueOrder(companyIds, 2, 6), 1);
for (let step = 0; step < 400; step += 1) {
  deterministicA.tick(0.05);
  deterministicB.tick(0.05);
}
assert.deepEqual([...deterministicA.snapshot()], [...deterministicB.snapshot()]);

deterministicA.reset('stress');
assert.equal(deterministicA.summary().friendlyTotal, 256);
assert.equal(deterministicA.summary().enemyTotal, 256);
assert.equal(deterministicA.snapshot().size, 512);
deterministicA.reset('stress');
assert.equal(deterministicA.snapshot().size, 512);

const camera = combatPlaytestCamera({ ...site, x: 14, z: -9 });
assert.deepEqual([camera.targetX, camera.targetZ, camera.distance], [14, -9, 32]);
assert.ok(camera.pitch > 0 && camera.pitch < Math.PI / 2);

const app = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../src/app/appBootstrap.ts', import.meta.url), 'utf8');
const commands = readFileSync(
  new URL('../src/security/MilitiaCommandController.ts', import.meta.url),
  'utf8',
);
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const playtest = readFileSync(new URL('../src/app/combatPlaytest.ts', import.meta.url), 'utf8');

assert.match(app, /visualQaConditions \|\| this\.combatPlaytestRequest/);
assert.match(app, /battleShowcaseWorldInput[\s\S]*treeRegistry: this\.treeRegistry/);
assert.match(app, /setCommandHandler[\s\S]*combatPlaytest\.issueOrder/);
assert.match(app, /!this\.battleShowcase && !this\.combatPlaytest/);
assert.match(app, /if \(!this\.combatPlaytest\) \{[\s\S]*militiaCommands\?\.sync/);
assert.match(bootstrap, /worldSettingsOverride[\s\S]*if \(!bridge\.worldSettingsOverride\) saveWorldGenerationSettings/);
assert.match(commands, /setCompanyGuidesVisible/);
assert.match(commands, /SecondaryClickGesture/);
assert.match(styles, /combat-playtest-mode > :not\(\.combat-playtest-overlay\):not\(\.militia-selection-box\)/);
assert.match(playtest, /spearman:[\s\S]{0,140}health: 74[\s\S]{0,90}damage: 11\.5[\s\S]{0,90}range: 2\.6/);
assert.match(playtest, /'man-at-arms':[\s\S]{0,140}health: 96[\s\S]{0,90}cadence: 0\.92[\s\S]{0,90}range: 2\.05/);
assert.match(playtest, /crossbow:[\s\S]{0,140}health: 58[\s\S]{0,90}cadence: 2\.45[\s\S]{0,90}range: 17\.5/);
assert.match(playtest, /polearm:[\s\S]{0,140}health: 70[\s\S]{0,90}damage: 17\.5[\s\S]{0,90}range: 2\.85/);
assert.match(playtest, /bowman:[\s\S]{0,140}health: 55[\s\S]{0,90}cadence: 1\.55[\s\S]{0,90}range: 20/);
assert.match(playtest, /minimumRange: 8/);
assert.match(playtest, /minimumRange: 7\.25/);
assert.match(playtest, /refreshMeleeEngagementRanks\(\)/);
assert.match(playtest, /engagementSlotAngle\(\s*runtime\.meleeEngagementRank/);
assert.match(playtest, /engagementSlotRadius\(stats\.range, runtime\.meleeEngagementRank\)/);
assert.match(playtest, /rangedLineLateral\(input\.sourceSlot, input\.companySize\)/);
assert.doesNotMatch(playtest, /retireFrom[\s\S]{0,900}setStatus\(runtime, 'retreating'\)/);

console.log('Offline production-world combat playtest route, controls, isolation, and stress contract passed.');

function createSimulation(preset: CombatPlaytestPreset): CombatPlaytestSimulation {
  return new CombatPlaytestSimulation({ site, playableHalf: 248, preset, seed });
}

function tickFor(sim: CombatPlaytestSimulation, seconds: number): void {
  const steps = Math.ceil(seconds / 0.05);
  for (let step = 0; step < steps; step += 1) sim.tick(0.05);
}

function average(values: readonly number[]): number {
  assert.ok(values.length > 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
