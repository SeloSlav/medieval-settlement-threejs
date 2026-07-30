import assert from 'node:assert/strict';
import {
  approvalTier,
  computeSettlementApproval,
} from '../src/economy/settlementApproval.ts';
import { DEFAULT_NIGHT_POLICY } from '../src/economy/nightPolicy.ts';
import type { SettlementProvisioning } from '../src/economy/settlementProvisioning.ts';
import { DEFAULT_SETTLEMENT_SECURITY } from '../src/security/frontierSecurity.ts';

const thriving = computeSettlementApproval({
  provisioning: provisioning({
    householdBufferHouseholds: 8,
    householdBufferReadyHouseholds: 8,
    householdBufferCoverage: 1,
    foodConsumers: 24,
    foodRunwayDays: 16,
    heatedResidents: 24,
    winterFirewoodCoverage: 1,
    welfare: welfare({
      activeHouseholds: 8,
      activeResidents: 24,
      stableHouseholds: 8,
      stableResidents: 24,
    }),
  }),
  nightPolicy: {
    ...DEFAULT_NIGHT_POLICY,
    communityCohesion: 0.9,
  },
  security: DEFAULT_SETTLEMENT_SECURITY,
  conflictEnabled: false,
  activeFires: 0,
  month: 6,
});
assert.ok(thriving.score >= 80, `expected thriving approval, received ${thriving.score}`);
assert.ok(thriving.factors.some((factor) =>
  factor.key === 'community-cohesion' && factor.impact > 0));
assert.match(thriving.effects[0] ?? '', /all 8 established homes/);

const distressed = computeSettlementApproval({
  provisioning: provisioning({
    householdBufferHouseholds: 5,
    householdBufferReadyHouseholds: 0,
    householdBufferCoverage: 0,
    householdBufferFoodShortHomes: 5,
    householdBufferWaterShortHomes: 3,
    foodConsumers: 15,
    foodRunwayDays: 0.5,
    heatedResidents: 15,
    winterFirewoodCoverage: 0.1,
    displacedHouseholds: 2,
    welfare: welfare({
      level: 'critical',
      activeHouseholds: 5,
      activeResidents: 15,
      stableHouseholds: 0,
      stableResidents: 0,
      hungryHouseholds: 2,
      hungryResidents: 6,
      malnourishedHouseholds: 1,
      malnourishedResidents: 3,
      starvingHouseholds: 1,
      starvingResidents: 3,
      sickHouseholds: 2,
      sickResidents: 4,
      untreatedSickHouseholds: 2,
      comfortWarningHouseholds: 4,
      migrationRiskHouseholds: 2,
      uncollectedBodiesAtHomes: 1,
      openGraves: 0,
      oldestUncollectedBodyDays: 2,
      dilapidatedHomes: 1,
      ruinedHomes: 1,
    }),
  }),
  nightPolicy: {
    ...DEFAULT_NIGHT_POLICY,
    communityCohesion: 0.1,
    laborFatigue: 0.8,
  },
  security: {
    ...DEFAULT_SETTLEMENT_SECURITY,
    threat: 1,
    nextRaidTick: 100,
    coverage: 0.1,
    defenseReadiness: 0.1,
    targetsAtRisk: 3,
    warningStartedTick: 50,
  },
  conflictEnabled: true,
  activeFires: 2,
  month: 1,
});
assert.ok(distressed.score < 25, `expected crisis approval, received ${distressed.score}`);
assert.equal(distressed.tier, 'crisis');
assert.ok(distressed.factors.some((factor) =>
  factor.key === 'frontier-safety' && factor.impact < 0));
assert.ok(distressed.factors.some((factor) =>
  factor.key === 'fire-disruption' && factor.impact < 0));
assert.match(distressed.summary, /strongest current pressure/i);
assert.match(distressed.effects[1] ?? '', /2 households have reached/);

const peaceful = computeSettlementApproval({
  provisioning: provisioning(),
  nightPolicy: DEFAULT_NIGHT_POLICY,
  security: {
    ...DEFAULT_SETTLEMENT_SECURITY,
    threat: 1,
    nextRaidTick: 100,
  },
  conflictEnabled: false,
  activeFires: 0,
  month: 6,
});
assert.equal(
  peaceful.factors.some((factor) => factor.key === 'frontier-safety'),
  false,
);
assert.equal(peaceful.score, 50);
assert.match(peaceful.effects[0] ?? '', /build an operational residence/i);

assert.equal(approvalTier(100), 'beloved');
assert.equal(approvalTier(70), 'liked');
assert.equal(approvalTier(55), 'content');
assert.equal(approvalTier(40), 'uneasy');
assert.equal(approvalTier(25), 'disliked');
assert.equal(approvalTier(0), 'crisis');

console.log('settlement approval tests passed');

function provisioning(
  overrides: Partial<SettlementProvisioning> = {},
): SettlementProvisioning {
  return {
    foodConsumers: 0,
    heatedResidents: 0,
    displacedHouseholds: 0,
    householdBufferHouseholds: 0,
    householdBufferReadyHouseholds: 0,
    householdBufferCoverage: 0,
    householdBufferFoodShortHomes: 0,
    householdBufferFirewoodShortHomes: 0,
    householdBufferWaterShortHomes: 0,
    householdBufferPreservedFoodShortHomes: 0,
    householdBufferAleShortHomes: 0,
    householdBufferClothShortHomes: 0,
    householdBufferPotteryShortHomes: 0,
    foodRunwayDays: 0,
    winterFirewoodCoverage: 0,
    welfare: welfare(),
    ...overrides,
  } as SettlementProvisioning;
}

function welfare(
  overrides: Partial<SettlementProvisioning['welfare']> = {},
): SettlementProvisioning['welfare'] {
  return {
    level: 'none',
    activeHouseholds: 0,
    activeResidents: 0,
    stableHouseholds: 0,
    stableResidents: 0,
    hungryHouseholds: 0,
    hungryResidents: 0,
    malnourishedHouseholds: 0,
    malnourishedResidents: 0,
    starvingHouseholds: 0,
    starvingResidents: 0,
    sickHouseholds: 0,
    sickResidents: 0,
    untreatedSickHouseholds: 0,
    comfortWarningHouseholds: 0,
    migrationRiskHouseholds: 0,
    uncollectedBodiesAtHomes: 0,
    oldestUncollectedBodyDays: 0,
    openGraves: 0,
    dilapidatedHomes: 0,
    ruinedHomes: 0,
    ...overrides,
  } as SettlementProvisioning['welfare'];
}
