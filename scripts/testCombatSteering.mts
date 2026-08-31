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

type GoldenFixture = {
  capacity: number;
  dtSeconds: number;
  tolerance: number;
  bounds: typeof bounds;
  agents: Array<{
    id: number;
    ownerGroup: number;
    team: number;
    groupKind: number;
    groupId: number;
    faction: number;
    targetId: number;
    enabled: boolean;
    x: number;
    z: number;
    goalX: number;
    goalZ: number;
    speed: number;
    velocityX: number;
    velocityZ: number;
  }>;
  expected: Array<{
    id: number;
    x: number;
    z: number;
    velocityX: number;
    velocityZ: number;
  }>;
};

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
  for (let step = 0; step < 40; step += 1) {
    for (const runtime of agents) {
      runtime.steeringGoalX = runtime.state.x;
      runtime.steeringGoalZ = runtime.state.z;
    }
    grid.update(agents, agents.length, 0.05, bounds);
  }
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
  const outsider = agent(202, 0, 1.9, 0, 1.9, 77, 2);
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
  assert.equal(
    outsider.steeringVelocityX,
    0,
    'a numeric company collision across teams must not leak cohesion',
  );
  assert.equal(
    outsider.steeringVelocityZ,
    0,
    'a numeric company collision across teams must not leak alignment',
  );
}

// Flock-only neighbours must never consume the cap before a closer collision
// threat. The old traversal-order cap missed this enemy after 18 friendlies.
{
  const crowdedCenterVelocity = (includeEnemy: boolean): number => {
    const center = agent(1, 0, 0, 0, 0, 77, 1);
    const agents = [center];
    for (let index = 0; index < 24; index += 1) {
      const x = -1.2 - (index % 6) * 0.12;
      const z = -1.1 - Math.floor(index / 6) * 0.15;
      agents.push(agent(10 + index, x, z, x, z, 77, 1));
    }
    if (includeEnemy) agents.push(agent(999, -0.18, 0, -0.18, 0, 88, 2));
    new CanonicalCombatSteeringGrid(64).update(agents, agents.length, 0.05, bounds);
    return center.steeringVelocityX;
  };
  const flockOnly = crowdedCenterVelocity(false);
  const withCloseEnemy = crowdedCenterVelocity(true);
  assert.ok(flockOnly < 0, 'the friendly flock should pull toward its negative-x center');
  assert.ok(
    withCloseEnemy > 0.25,
    'a close enemy must outrank more than 18 harmless flock-only neighbours',
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
  assert.ok(Math.abs(
    rangedLineLateral(1, 8) - rangedLineLateral(0, 8)
      - COMBAT_STEERING_RANGED_LINE_SPACING_M,
  ) < 1e-12);
  assert.equal(rangedLineDepth(4, 8), COMBAT_STEERING_RANGED_DEPTH_SPACING_M);
  assert.ok(Math.abs(rangedPreferredDistance(20) - 14.4) < 1e-12);
}

// Both language implementations consume this exact fixture. Keeping expected
// results in data (rather than regenerating them inside either test) catches
// semantic drift even when shared constants still happen to match.
{
  const golden = JSON.parse(readFileSync(
    new URL('../balance/combatSteeringGolden.json', import.meta.url),
    'utf8',
  )) as GoldenFixture;
  assert.deepEqual(
    golden.agents.map(({ id }) => id),
    golden.agents.map(({ id }) => id).sort((left, right) => left - right),
    'golden bodies must remain seed-sorted for identical bucket traversal',
  );
  const createGolden = (): CombatSteeringAgent[] => golden.agents.map((input) => ({
    state: { x: input.x, z: input.z },
    steeringSeed: input.id,
    steeringTeam: input.team,
    steeringCompany: input.groupKind === 1 ? input.groupId : 0,
    steeringEnabled: input.enabled,
    steeringGoalX: input.goalX,
    steeringGoalZ: input.goalZ,
    steeringSpeed: input.speed,
    steeringVelocityX: input.velocityX,
    steeringVelocityZ: input.velocityZ,
  }));
  const first = createGolden();
  const repeated = createGolden();
  new CanonicalCombatSteeringGrid(golden.capacity).update(
    first,
    first.length,
    golden.dtSeconds,
    golden.bounds,
  );
  new CanonicalCombatSteeringGrid(golden.capacity).update(
    repeated,
    repeated.length,
    golden.dtSeconds,
    golden.bounds,
  );
  assert.deepEqual(first, repeated, 'identical golden inputs must remain deterministic');
  for (const [index, expected] of golden.expected.entries()) {
    const actual = first[index]!;
    assert.equal(actual.steeringSeed, expected.id);
    for (const [label, value, target] of [
      ['x', actual.state.x, expected.x],
      ['z', actual.state.z, expected.z],
      ['velocityX', actual.steeringVelocityX, expected.velocityX],
      ['velocityZ', actual.steeringVelocityZ, expected.velocityZ],
    ] as const) {
      assert.ok(
        Math.abs(value - target) <= golden.tolerance,
        `golden ${expected.id} ${label}: expected ${target}, received ${value}`,
      );
    }
  }
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
