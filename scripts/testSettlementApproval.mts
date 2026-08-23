import assert from 'node:assert/strict';
import {
  approvalNeedPressureProgress,
  approvalTier,
  computeSettlementApproval,
} from '../src/economy/settlementApproval.ts';
import { DEFAULT_NIGHT_POLICY } from '../src/economy/nightPolicy.ts';
import {
  APPROVAL_NEED_PRESSURE_RAMP_DAYS,
  CALENDAR_SECONDS_PER_DAY,
  SIM_REALTIME_RATE,
} from '../src/generated/gameBalance.ts';
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
      serviceWarningHouseholds: 4,
      upgradeBlockedHouseholds: 2,
      uncollectedBodiesAtHomes: 1,
      openGraves: 0,
      oldestUncollectedBodyDays: 2,
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
assert.match(distressed.effects[1] ?? '', /4 sustained-shortage homes/);
assert.match(distressed.effects[2] ?? '', /2 homes are blocked/);

const earlyNeedCrisis = needCrisisApproval(3);
assert.ok(
  earlyNeedCrisis.score >= 35,
  `three shortage days should leave recovery room, received ${earlyNeedCrisis.score}%`,
);
assert.equal(
  earlyNeedCrisis.factors.filter((factor) => factor.impact < 0).length,
  2,
  'one combined hardship concern plus low cohesion should replace stacked need penalties',
);
assert.equal(
  earlyNeedCrisis.factors.find((factor) => factor.key === 'household-hardship')?.impact,
  -1,
);
assert.equal(
  earlyNeedCrisis.factors.some((factor) => factor.key === 'hunger'),
  false,
);
assert.match(
  earlyNeedCrisis.factors.find((factor) => factor.key === 'household-hardship')?.detail ?? '',
  /hunger 3\.0 days \(5%\).*services 3\.0 days \(5%\).*60 shortage-days/i,
);

const fiveDayNeedCrisis = needCrisisApproval(5);
assert.ok(fiveDayNeedCrisis.score > 25, 'five shortage days must not cause approval crisis');
assert.ok(fiveDayNeedCrisis.score < earlyNeedCrisis.score, 'need pressure should mature over time');

const longServiceFreshHunger = needCrisisApproval(3, APPROVAL_NEED_PRESSURE_RAMP_DAYS);
const longServiceOnly = needCrisisApproval(0, APPROVAL_NEED_PRESSURE_RAMP_DAYS, false);
const longServiceOnlyPenalty = Math.abs(
  longServiceOnly.factors.find((factor) => factor.key === 'household-hardship')?.impact ?? 0,
);
const longServiceFreshHungerPenalty = Math.abs(
  longServiceFreshHunger.factors.find(
    (factor) => factor.key === 'household-hardship',
  )?.impact ?? 0,
);
assert.ok(
  longServiceFreshHungerPenalty >= longServiceOnlyPenalty,
  'adding fresh hunger must never dilute already-mature service pressure',
);
assert.ok(
  longServiceFreshHungerPenalty - longServiceOnlyPenalty <= 2,
  'a long service deficit must not prematurely mature a newly-started hunger penalty',
);
const longServiceWithHealthyBuffers = needCrisisApproval(
  0,
  APPROVAL_NEED_PRESSURE_RAMP_DAYS,
  false,
  true,
);
assert.equal(
  Math.abs(
    longServiceWithHealthyBuffers.factors.find(
      (factor) => factor.key === 'household-hardship',
    )?.impact ?? 0,
  ),
  longServiceOnlyPenalty,
  'a new buffer failure must not borrow maturity from an unrelated old service deficit',
);

const almostMatureNeedCrisis = needCrisisApproval(APPROVAL_NEED_PRESSURE_RAMP_DAYS - 0.01);
assert.ok(
  almostMatureNeedCrisis.score > 0,
  'need pressure must not bottom out before the configured exposure ramp completes',
);

const prolongedNeedCrisis = needCrisisApproval(APPROVAL_NEED_PRESSURE_RAMP_DAYS);
assert.equal(prolongedNeedCrisis.score, 0);
assert.equal(
  prolongedNeedCrisis.factors.find((factor) => factor.key === 'household-hardship')?.impact,
  -40,
);

const recovered = computeSettlementApproval({
  provisioning: provisioning({
    householdBufferHouseholds: 5,
    householdBufferReadyHouseholds: 5,
    householdBufferCoverage: 1,
    foodConsumers: 15,
    foodRunwayDays: 16,
    welfare: welfare({
      activeHouseholds: 5,
      activeResidents: 15,
      stableHouseholds: 5,
      stableResidents: 15,
      longestHungerDays: 0,
      longestServiceDeficitDays: 0,
    }),
  }),
  nightPolicy: { ...DEFAULT_NIGHT_POLICY, communityCohesion: 0 },
  security: DEFAULT_SETTLEMENT_SECURITY,
  conflictEnabled: false,
  activeFires: 0,
  month: 6,
});
assert.ok(recovered.score >= 60, `recovered households should rebound, received ${recovered.score}%`);
assert.equal(recovered.factors.some((factor) => factor.key === 'household-hardship'), false);

assert.equal(approvalNeedPressureProgress(0), 0);
assert.equal(approvalNeedPressureProgress(APPROVAL_NEED_PRESSURE_RAMP_DAYS / 2), 0.5);
assert.equal(approvalNeedPressureProgress(APPROVAL_NEED_PRESSURE_RAMP_DAYS), 1);
assert.equal(approvalNeedPressureProgress(Number.POSITIVE_INFINITY), 1);
const normalSpeedRampSeconds = APPROVAL_NEED_PRESSURE_RAMP_DAYS
  * CALENDAR_SECONDS_PER_DAY
  / SIM_REALTIME_RATE;
assert.ok(
  normalSpeedRampSeconds >= 2 * 60 * 60,
  `full need pressure must take hours at normal speed, received ${normalSpeedRampSeconds}s`,
);

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
    longestHungerDays: 0,
    sickHouseholds: 0,
    sickResidents: 0,
    untreatedSickHouseholds: 0,
    serviceWarningHouseholds: 0,
    upgradeBlockedHouseholds: 0,
    longestServiceDeficitDays: 0,
    uncollectedBodiesAtHomes: 0,
    oldestUncollectedBodyDays: 0,
    openGraves: 0,
    vacantHomes: 0,
    ...overrides,
  } as SettlementProvisioning['welfare'];
}

function needCrisisApproval(
  hungerExposureDays: number,
  serviceExposureDays = hungerExposureDays,
  hungerActive = true,
  buffersReady = false,
) {
  const starving = hungerActive && hungerExposureDays >= APPROVAL_NEED_PRESSURE_RAMP_DAYS;
  const upgradeBlocked = serviceExposureDays >= APPROVAL_NEED_PRESSURE_RAMP_DAYS;
  return computeSettlementApproval({
    provisioning: provisioning({
      householdBufferHouseholds: 5,
      householdBufferReadyHouseholds: buffersReady ? 5 : 0,
      householdBufferCoverage: buffersReady ? 1 : 0,
      householdBufferFoodShortHomes: buffersReady ? 0 : 5,
      householdBufferWaterShortHomes: buffersReady ? 0 : 5,
      householdBufferFirewoodShortHomes: buffersReady ? 0 : 5,
      foodConsumers: hungerActive ? 15 : 0,
      foodRunwayDays: hungerActive ? 0 : 16,
      welfare: welfare({
        level: starving ? 'critical' : 'watch',
        activeHouseholds: 5,
        activeResidents: 15,
        stableHouseholds: 0,
        stableResidents: 0,
        hungryHouseholds: hungerActive && !starving ? 5 : 0,
        hungryResidents: hungerActive && !starving ? 15 : 0,
        starvingHouseholds: starving ? 5 : 0,
        starvingResidents: starving ? 15 : 0,
        longestHungerDays: hungerActive ? hungerExposureDays : 0,
        serviceWarningHouseholds: 5,
        upgradeBlockedHouseholds: upgradeBlocked ? 5 : 0,
        longestServiceDeficitDays: serviceExposureDays,
      }),
    }),
    nightPolicy: { ...DEFAULT_NIGHT_POLICY, communityCohesion: 0 },
    security: DEFAULT_SETTLEMENT_SECURITY,
    conflictEnabled: false,
    activeFires: 0,
    month: 6,
  });
}
