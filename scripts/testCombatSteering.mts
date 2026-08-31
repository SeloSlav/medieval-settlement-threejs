import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CanonicalCombatSteeringGrid,
  engagementSlotAngle,
  engagementSlotRadius,
  rangedLineDepth,
  rangedLineLateral,
  rangedPreferredDistance,
  type CombatSteeringAgent,
} from '../src/security/combatSteering.ts';
import {
  COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
  COMBAT_STEERING_RANGED_DEPTH_SPACING_M,
  COMBAT_STEERING_RANGED_LINE_SPACING_M,
} from '../src/generated/gameBalance.ts';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

function agent(
  seed: number,
  x: number,
  z: number,
  goalX = x,
  goalZ = z,
  company = seed,
  team = 1,
): CombatSteeringAgent {
  return {
    state: { x, z },
    steeringSeed: seed,
    steeringTeam: team,
    steeringCompany: company,
    steeringEnabled: true,
    steeringGoalX: goalX,
    steeringGoalZ: goalZ,
    steeringSpeed: 2.2,
    steeringVelocityX: 0,
    steeringVelocityZ: 0,
  };
}

// The solver changes canonical simulation coordinates, including separation
// across companies and opposing teams. Disabled/dead bodies remain fixed.
{
  const agents = [
    agent(1, 0, 0, 0, 0, 10, 1),
    agent(2, 0, 0, 0, 0, 20, 2),
    agent(3, 0, 0, 0, 0, 30, 2),
  ];
  agents[2]!.steeringEnabled = false;
  const grid = new CanonicalCombatSteeringGrid(8);
  for (let step = 0; step < 40; step += 1) grid.update(agents, agents.length, 0.05, bounds);
  assert.ok(
    Math.hypot(
      agents[0]!.state.x - agents[1]!.state.x,
      agents[0]!.state.z - agents[1]!.state.z,
    ) > 0.55,
    'living opponents in different companies must separate canonically',
  );
  assert.deepEqual(agents[2]!.state, { x: 0, z: 0 }, 'downed agents must not be moved');
}

// A head-on pair cannot tunnel through and exchange sides in one server-sized
// step; prediction sees persisted velocities before their capsules overlap.
{
  const left = agent(11, -0.62, 0, 4, 0, 1, 1);
  const right = agent(12, 0.62, 0, -4, 0, 2, 2);
  left.steeringVelocityX = 2.2;
  right.steeringVelocityX = -2.2;
  const agents = [left, right];
  new CanonicalCombatSteeringGrid(4).update(agents, agents.length, 0.2, bounds);
  assert.ok(left.state.x < right.state.x, 'predictive avoidance must prevent tick-side swapping');
  assert.ok(
    Math.abs(left.state.z - right.state.z) > 0.01,
    'head-on prediction must create a deterministic passing side',
  );
}

// Goal seeking remains dominant even at the maximum supported local crowd.
{
  const center = agent(100, 0, 0, 20, 0, 100, 1);
  const agents = [center];
  for (let index = 0; index < 18; index += 1) {
    const angle = index / 18 * Math.PI * 2;
    agents.push(agent(
      101 + index,
      Math.cos(angle) * 0.55,
      Math.sin(angle) * 0.55,
      Math.cos(angle) * 0.55,
      Math.sin(angle) * 0.55,
      1_000 + index,
      index % 2 + 1,
    ));
  }
  new CanonicalCombatSteeringGrid(32).update(agents, agents.length, 0.05, bounds);
  assert.ok(center.state.x > 0, 'the formation/path goal must survive capped avoidance pressure');
}

// Same-company alignment/cohesion must not leak to an otherwise identical
// enemy: the friendly is pulled toward its company mate while the enemy is not.
{
  const companyCenter = agent(200, 0, 0, 0, 0, 77, 1);
  const mate = agent(201, 1.9, 0, 1.9, 0, 77, 1);
  mate.steeringVelocityZ = 1;
  const outsider = agent(202, 0, 1.9, 0, 1.9, 88, 2);
  const agents = [companyCenter, mate, outsider];
  new CanonicalCombatSteeringGrid(8).update(agents, agents.length, 0.05, bounds);
  assert.ok(
    companyCenter.steeringVelocityX > 0,
    'local same-company cohesion must pull toward the company center',
  );
  assert.ok(
    companyCenter.steeringVelocityZ > 0,
    'local same-company alignment must inherit the company heading',
  );
}

// Engagement slots are a one-to-one permutation for the first ring and ranged
// formations preserve authored lateral/depth spacing without allocating tuples.
{
  const slots = Array.from({ length: COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT }, (_, sourceSlot) =>
    engagementSlotAngle(sourceSlot, 0x1234, 0x5678)
  );
  assert.equal(new Set(slots).size, COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT);
  assert.ok(engagementSlotRadius(2.6) > engagementSlotRadius(1.2));
  assert.equal(
    rangedLineLateral(1, 8) - rangedLineLateral(0, 8),
    COMBAT_STEERING_RANGED_LINE_SPACING_M,
  );
  assert.equal(rangedLineDepth(4, 8), COMBAT_STEERING_RANGED_DEPTH_SPACING_M);
  assert.equal(rangedPreferredDistance(20), 14.4);
}

// Identical low-level inputs produce byte-for-byte stable golden outputs. This
// API is also consumed by the Rust/TypeScript cross-language fixture test.
{
  const createGolden = () => {
    const agents = [
      agent(0x101, -0.7, -0.2, 4, 0.4, 9, 1),
      agent(0x202, 0.15, 0.1, -3, -0.5, 10, 2),
      agent(0x303, -0.1, 1.15, 3, 1.4, 9, 1),
    ];
    agents[0]!.steeringVelocityX = 1.2;
    agents[1]!.steeringVelocityX = -0.8;
    agents[2]!.steeringVelocityZ = 0.35;
    return agents;
  };
  const a = createGolden();
  const b = createGolden();
  const gridA = new CanonicalCombatSteeringGrid(8);
  const gridB = new CanonicalCombatSteeringGrid(8);
  gridA.update(a, a.length, 0.05, bounds);
  gridB.update(b, b.length, 0.05, bounds);
  assert.deepEqual(a, b);
}

// Keep 1,024-agent steering comfortably below a frame on ordinary CI hardware.
// The benchmark also guards against accidentally replacing the spatial hash
// with an all-pairs loop.
{
  const agents: CombatSteeringAgent[] = [];
  for (let index = 0; index < 1_024; index += 1) {
    const column = index % 32;
    const row = Math.floor(index / 32);
    agents.push(agent(
      index + 1,
      column * 0.76,
      row * 0.76,
      column * 0.76 + (row % 2 === 0 ? 12 : -12),
      row * 0.76,
      Math.floor(index / 16) + 1,
      row % 2 + 1,
    ));
  }
  const grid = new CanonicalCombatSteeringGrid(agents.length);
  const started = performance.now();
  for (let step = 0; step < 120; step += 1) grid.update(agents, agents.length, 0.05, bounds);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2_500, `1,024-agent grid regression: ${elapsed.toFixed(1)} ms / 120 steps`);
}

const source = readFileSync(new URL('../src/security/combatSteering.ts', import.meta.url), 'utf8');
assert.match(source, /Int32Array/);
assert.match(source, /Float64Array/);
assert.match(source, /COMBAT_STEERING_NEIGHBOR_RADIUS_M/);
assert.doesNotMatch(
  source.slice(source.indexOf('  update('), source.indexOf('  private bucketFor')),
  /new (?:Array|Map|Set|Int32Array|Float64Array)/,
  'the per-frame steering path must not allocate collections',
);

console.log('Canonical combat steering grid, engagement slots, ranged lines, determinism, and 1,024-agent performance passed.');
