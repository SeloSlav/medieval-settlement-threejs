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
  COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M,
  COMBAT_STEERING_RANGED_DEPTH_SPACING_M,
  COMBAT_STEERING_RANGED_LINE_SPACING_M,
  COMBAT_STEERING_SEPARATION_DISTANCE_M,
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

type ParityCase = Omit<GoldenFixture, 'tolerance'> & {
  name: string;
  steps: number;
};

type ParityCases = {
  tolerance: number;
  cases: ParityCase[];
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

function fixtureAgent(input: GoldenFixture['agents'][number]): CombatSteeringAgent {
  return {
    state: { x: input.x, z: input.z },
    steeringSeed: input.id,
    steeringTeam: input.team,
    steeringCompany: input.groupKind === 0
      ? 0
      : input.groupKind * 1_000_000 + input.groupId,
    steeringEnabled: input.enabled,
    steeringGoalX: input.goalX,
    steeringGoalZ: input.goalZ,
    steeringSpeed: input.speed,
    steeringVelocityX: input.velocityX,
    steeringVelocityZ: input.velocityZ,
  };
}

function assertMinimumClearance(
  agents: readonly CombatSteeringAgent[],
  label: string,
): void {
  for (let left = 0; left < agents.length; left += 1) {
    for (let right = left + 1; right < agents.length; right += 1) {
      const leftAgent = agents[left]!;
      const rightAgent = agents[right]!;
      assert.ok(
        Math.hypot(
          leftAgent.state.x - rightAgent.state.x,
          leftAgent.state.z - rightAgent.state.z,
        ) >= COMBAT_STEERING_SEPARATION_DISTANCE_M - 1e-9,
        `${label} left ${leftAgent.steeringSeed}/${rightAgent.steeringSeed} penetrating`,
      );
    }
  }
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

// A head-on pair cannot tunnel through or exchange sides over repeated
// server-sized steps. X ordering may invert only after the deterministic
// passing lane has opened at least one complete capsule diameter laterally.
{
  const left = agent(11, -2, 0, 4, 0, 1, 1);
  const right = agent(12, 2, 0, -4, 0, 2, 2);
  const agents = [left, right];
  const grid = new CanonicalCombatSteeringGrid(4);
  let openedPassingLane = false;
  for (let step = 0; step < 18; step += 1) {
    grid.update(agents, agents.length, 0.2, bounds);
    const distance = Math.hypot(
      left.state.x - right.state.x,
      left.state.z - right.state.z,
    );
    const lateralClearance = Math.abs(left.state.z - right.state.z);
    assert.ok(distance >= 0.82 - 1e-9, `hard separation failed on head-on tick ${step + 1}`);
    if (lateralClearance >= 0.82 - 1e-9) openedPassingLane = true;
    if (!openedPassingLane) {
      assert.ok(
        left.state.x < right.state.x,
        `head-on bodies exchanged x order before lateral clearance on tick ${step + 1}`,
      );
    }
  }
  assert.equal(openedPassingLane, true, 'head-on prediction must open a deterministic passing side');
}

// Pathological imports may contain an entire company at one point or packed
// into a few centimetres. The uncapped hard pass plus deterministic final
// placement must resolve every pair in one canonical update.
for (const scenario of ['exact-overlap', 'dense-grid'] as const) {
  const createScenario = (): CombatSteeringAgent[] => Array.from({ length: 64 }, (_, index) => {
    const x = scenario === 'exact-overlap' ? 0 : (index % 8) * 0.1;
    const z = scenario === 'exact-overlap' ? 0 : Math.floor(index / 8) * 0.1;
    return agent(index + 1, x, z, x, z, index + 1, index % 2 + 1);
  });
  const agents = createScenario();
  const repeated = createScenario();
  new CanonicalCombatSteeringGrid(64).update(agents, agents.length, 0.05, bounds);
  new CanonicalCombatSteeringGrid(64).update(repeated, repeated.length, 0.05, bounds);
  assert.deepEqual(agents, repeated, `${scenario} cleanup must remain deterministic`);
  assertMinimumClearance(agents, scenario);
}

// Goal seeking remains dominant even at the maximum supported local crowd.
{
  const center = agent(100, 0, 0, 20, 0, 100, 1);
  const agents = [center];
  const crowdPositions: Array<readonly [number, number]> = [];
  for (let x = -3; x <= 3.001; x += 0.86) {
    for (let z = -3; z <= 3.001; z += 0.86) {
      const distance = Math.hypot(x, z);
      if (distance >= 0.95 && distance <= 3.15) crowdPositions.push([x, z]);
    }
  }
  crowdPositions.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  for (let index = 0; index < 18; index += 1) {
    const [x, z] = crowdPositions[index]!;
    const neighbor = agent(
      101 + index,
      x,
      z,
      x,
      z,
      1_000 + index,
      index % 2 + 1,
    );
    const distance = Math.hypot(x, z);
    neighbor.steeringVelocityX = -x / distance * 2.2;
    neighbor.steeringVelocityZ = -z / distance * 2.2;
    agents.push(neighbor);
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
    const flockPositions: Array<readonly [number, number]> = [];
    for (let x = -3; x <= 3.001; x += 0.86) {
      for (let z = -3; z <= 3.001; z += 0.86) {
        const distance = Math.hypot(x, z);
        if (distance >= 0.95 && distance <= 3.15) flockPositions.push([x, z]);
      }
    }
    flockPositions.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    for (let index = 0; index < 24; index += 1) {
      const [x, z] = flockPositions[index]!;
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

// Engagement ranks use staggered concentric rings after the first ten bodies;
// ranged formations preserve authored lateral/depth spacing without tuples.
{
  const slots = Array.from({ length: COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT }, (_, sourceSlot) =>
    engagementSlotAngle(sourceSlot, 0x1234, 0x5678)
  );
  assert.equal(new Set(slots).size, COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT);
  assert.ok(engagementSlotRadius(2.6, 0) > engagementSlotRadius(1.2, 0));
  assert.ok(Math.abs(
    engagementSlotRadius(2.6, COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT)
      - engagementSlotRadius(2.6, 0)
      - COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M,
  ) < 1e-12);
  const oddRingStagger = wrappedAngleForTest(
    engagementSlotAngle(COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT, 0x1234, 0x5678)
      - engagementSlotAngle(0, 0x1234, 0x5678),
  );
  assert.ok(Math.abs(
    Math.abs(oddRingStagger) - Math.PI / COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
  ) < 1e-12);
  const engagementGoals = new Set<string>();
  for (let rank = 0; rank < 32; rank += 1) {
    const angle = engagementSlotAngle(rank, 0x1234, 0x5678);
    const radius = engagementSlotRadius(2.6, rank);
    engagementGoals.add(`${(Math.cos(angle) * radius).toFixed(12)}:${(
      Math.sin(angle) * radius
    ).toFixed(12)}`);
  }
  assert.equal(engagementGoals.size, 32, '32 attackers must not receive repeated exact goals');
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
  const createGolden = (): CombatSteeringAgent[] => golden.agents.map(fixtureAgent);
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
  assertMinimumClearance(first, 'dense hard cleanup');
}


// Additional fixtures freeze the new hard-pass and grouping edge cases for
// both TypeScript and Rust. Expected records are keyed subsets so the dense
// top-K case stays reviewable without duplicating 26 uninteresting outputs.
{
  const parity = JSON.parse(readFileSync(
    new URL('../balance/combatSteeringParityCases.json', import.meta.url),
    'utf8',
  )) as ParityCases;
  for (const scenario of parity.cases) {
    assert.deepEqual(
      scenario.agents.map(({ id }) => id),
      scenario.agents.map(({ id }) => id).sort((left, right) => left - right),
      `${scenario.name} inputs must remain seed sorted`,
    );
    const agents = scenario.agents.map(fixtureAgent);
    const grid = new CanonicalCombatSteeringGrid(scenario.capacity);
    for (let step = 0; step < scenario.steps; step += 1) {
      grid.update(agents, agents.length, scenario.dtSeconds, scenario.bounds);
    }
    for (const expected of scenario.expected) {
      const actual = agents.find((candidate) => candidate.steeringSeed === expected.id);
      assert.ok(actual, `${scenario.name} omitted expected body ${expected.id}`);
      for (const [label, value, target] of [
        ['x', actual.state.x, expected.x],
        ['z', actual.state.z, expected.z],
        ['velocityX', actual.steeringVelocityX, expected.velocityX],
        ['velocityZ', actual.steeringVelocityZ, expected.velocityZ],
      ] as const) {
        assert.ok(
          Math.abs(value - target) <= parity.tolerance,
          `${scenario.name} ${expected.id} ${label}: expected ${target}, received ${value}`,
        );
      }
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
  const averageStepMs = elapsed / 120;
  assert.ok(
    averageStepMs < 16,
    `1,024-agent grid regression: ${averageStepMs.toFixed(2)} ms average (${elapsed.toFixed(1)} ms / 120 steps)`,
  );
}

const source = readFileSync(new URL('../src/security/combatSteering.ts', import.meta.url), 'utf8');
assert.match(source, /Int32Array/);
assert.match(source, /Float64Array/);
assert.match(source, /COMBAT_STEERING_NEIGHBOR_RADIUS_M/);
assert.doesNotMatch(
  source.slice(source.indexOf('  update('), source.indexOf('/** Stable ring angle')),
  /new (?:Array|Map|Set|Int32Array|Float64Array)/,
  'the per-frame steering path must not allocate collections',
);

console.log('Canonical combat steering grid, engagement slots, ranged lines, determinism, and 1,024-agent performance passed.');

function wrappedAngleForTest(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
