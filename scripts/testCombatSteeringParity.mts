import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as generated from '../src/generated/gameBalance.ts';

type CombatSteeringBalance = {
  cellSizeM: number;
  neighborRadiusM: number;
  separationDistanceM: number;
  predictionSeconds: number;
  maxNeighbors: number;
  goalWeight: number;
  separationWeight: number;
  predictiveWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  engagementSlotCount: number;
  engagementRadiusFactor: number;
  engagementMinRadiusM: number;
  rangedLineSpacingM: number;
  rangedDepthSpacingM: number;
  rangedPreferredRangeFactor: number;
  velocityResponsePerSecond: number;
  maxTurnRadiansPerSecond: number;
  exactOverlapEpsilonSq: number;
};

const balance = JSON.parse(
  readFileSync('balance/gameBalance.json', 'utf8'),
) as { combatSteering: CombatSteeringBalance };
const rust = readFileSync('server/src/balance_generated.rs', 'utf8');

const contracts = [
  ['COMBAT_STEERING_CELL_SIZE_M', 'cellSizeM'],
  ['COMBAT_STEERING_NEIGHBOR_RADIUS_M', 'neighborRadiusM'],
  ['COMBAT_STEERING_SEPARATION_DISTANCE_M', 'separationDistanceM'],
  ['COMBAT_STEERING_PREDICTION_SECONDS', 'predictionSeconds'],
  ['COMBAT_STEERING_MAX_NEIGHBORS', 'maxNeighbors'],
  ['COMBAT_STEERING_GOAL_WEIGHT', 'goalWeight'],
  ['COMBAT_STEERING_SEPARATION_WEIGHT', 'separationWeight'],
  ['COMBAT_STEERING_PREDICTIVE_WEIGHT', 'predictiveWeight'],
  ['COMBAT_STEERING_ALIGNMENT_WEIGHT', 'alignmentWeight'],
  ['COMBAT_STEERING_COHESION_WEIGHT', 'cohesionWeight'],
  ['COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT', 'engagementSlotCount'],
  ['COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR', 'engagementRadiusFactor'],
  ['COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M', 'engagementMinRadiusM'],
  ['COMBAT_STEERING_RANGED_LINE_SPACING_M', 'rangedLineSpacingM'],
  ['COMBAT_STEERING_RANGED_DEPTH_SPACING_M', 'rangedDepthSpacingM'],
  ['COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR', 'rangedPreferredRangeFactor'],
  ['COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND', 'velocityResponsePerSecond'],
  ['COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND', 'maxTurnRadiansPerSecond'],
  ['COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ', 'exactOverlapEpsilonSq'],
] as const;

for (const [constantName, balanceKey] of contracts) {
  const tsValue = generated[constantName as keyof typeof generated];
  assert.equal(
    typeof tsValue,
    'number',
    `${constantName} is missing from the generated TypeScript balance`,
  );
  assert.equal(
    tsValue,
    balance.combatSteering[balanceKey],
    `${constantName} drifted from balance/gameBalance.json in TypeScript`,
  );

  const rustMatch = rust.match(new RegExp(
    `pub const ${constantName}: [^=]+ = ([^;]+);`,
  ));
  assert.ok(rustMatch, `${constantName} is missing from the generated Rust balance`);
  const rustValue = Number(rustMatch[1]);
  assert.ok(Number.isFinite(rustValue), `${constantName} is not numeric in Rust`);
  assert.equal(
    rustValue,
    tsValue,
    `${constantName} differs between TypeScript (${tsValue}) and Rust (${rustValue})`,
  );
}

assert.ok(
  generated.COMBAT_STEERING_GOAL_WEIGHT
    > generated.COMBAT_STEERING_SEPARATION_WEIGHT,
  'the formation/path goal must remain the dominant steering term',
);
assert.ok(
  generated.COMBAT_STEERING_CELL_SIZE_M
    >= generated.COMBAT_STEERING_SEPARATION_DISTANCE_M * 2,
  'a 3x3 cell query must cover the complete separation neighborhood',
);
assert.ok(
  generated.COMBAT_STEERING_MAX_NEIGHBORS <= 24,
  'the deterministic neighbor cap must keep dense battles bounded',
);

console.log(
  `Combat steering balance parity passed (${contracts.length} shared constants).`,
);
