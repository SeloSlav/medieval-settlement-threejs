import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  approvalConcernSummary,
  approvalNeedPressureProgress,
  approvalTier,
  computeSettlementApproval,
} from '../src/economy/settlementApproval.ts';
import {
  paceSettlementApproval,
  type SettlementApprovalPacingState,
} from '../src/economy/settlementApprovalPacing.ts';
import { DEFAULT_NIGHT_POLICY } from '../src/economy/nightPolicy.ts';
import {
  APPROVAL_BASE_SCORE,
  APPROVAL_DECLINE_POINTS_PER_REAL_HOUR,
  APPROVAL_MAX_ACUTE_PENALTY,
  APPROVAL_MAX_NEED_PENALTY,
  APPROVAL_NEED_PRESSURE_RAMP_DAYS,
} from '../src/generated/gameBalance.ts';
import type { SettlementProvisioning } from '../src/economy/settlementProvisioning.ts';

const DEFAULT_SETTLEMENT_SECURITY = {
  coverage: 0,
  defenseReadiness: 0,
  nextRaidTick: 0,
  targetsAtRisk: 0,
  threat: 0,
  warningStartedTick: 0,
};

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
assert.equal(distressed.score, APPROVAL_BASE_SCORE - APPROVAL_MAX_ACUTE_PENALTY);
assert.equal(distressed.tier, 'uneasy');
assert.ok(distressed.factors.some((factor) =>
  factor.key === 'frontier-safety' && factor.impact < 0));
assert.ok(distressed.factors.some((factor) =>
  factor.key === 'fire-disruption' && factor.impact < 0));
assert.equal(
  distressed.factors
    .filter((factor) => factor.impact < 0 && factor.key !== 'household-hardship')
    .reduce((sum, factor) => sum - factor.impact, 0),
  APPROVAL_MAX_ACUTE_PENALTY,
  'simultaneous acute problems must share one lenient penalty budget',
);
assert.equal(distressed.summary, 'Fires and displacement are disrupting the settlement.');

const earlyNeedCrisis = needCrisisApproval(3);
assert.equal(earlyNeedCrisis.score, 49);
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

const fiveDayNeedCrisis = needCrisisApproval(5);
assert.equal(fiveDayNeedCrisis.score, 48);
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
assert.equal(prolongedNeedCrisis.score, 18);
assert.equal(
  prolongedNeedCrisis.factors.find((factor) => factor.key === 'household-hardship')?.impact,
  -APPROVAL_MAX_NEED_PENALTY,
);
assert.equal(prolongedNeedCrisis.summary, 'Some households are struggling to meet basic needs.');

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
assert.equal(peaceful.score, APPROVAL_BASE_SCORE);
assert.equal(peaceful.summary, 'Residents have no pressing concerns.');

const summaryCases = [
  ['household-hardship', 'Some households are struggling to meet basic needs.'],
  ['illness', 'Illness is affecting the settlement.'],
  ['community-cohesion', 'Community morale is low.'],
  ['labor-fatigue', 'Residents are exhausted.'],
  ['burial-dignity', 'Bodies remain unburied.'],
  ['fire-disruption', 'Fires and displacement are disrupting the settlement.'],
  ['frontier-safety', 'Residents feel unsafe.'],
] as const;
const forbiddenMechanicCopy = /\d|%|\b(?:day|tick|point|impact|threshold|production|tax|upgrade|score|approval)\b/i;
for (const [key, expected] of summaryCases) {
  const summary = approvalConcernSummary([{ key, impact: -1 }]);
  assert.equal(summary, expected);
  assert.equal(
    summary.match(/[.!?]/g)?.length,
    1,
    `${key} diagnosis must contain exactly one sentence`,
  );
  assert.doesNotMatch(summary, forbiddenMechanicCopy);
}

assert.equal(
  APPROVAL_BASE_SCORE - APPROVAL_MAX_NEED_PENALTY - APPROVAL_MAX_ACUTE_PENALTY,
  16,
  'even fully compounded pressure should retain a forgiving floor',
);
const severeTarget = {
  score: 16,
  tier: 'crisis' as const,
  label: 'Crisis',
  summary: 'Some households are struggling to meet basic needs.',
  factors: [],
};
const fiveMinutesMs = 5 * 60 * 1_000;
let pacingNowMs = 0;
let paced = paceSettlementApproval(severeTarget, null, pacingNowMs, true);
let pacingState: SettlementApprovalPacingState = paced.state;
assert.equal(paced.approval.score, APPROVAL_BASE_SCORE);
assert.equal(paced.approval.tier, 'content');

for (let step = 1; step <= 36; step += 1) {
  pacingNowMs += fiveMinutesMs;
  paced = paceSettlementApproval(severeTarget, pacingState, pacingNowMs, true);
  pacingState = paced.state;
}
assert.equal(paced.approval.score, 30, 'three real hours may remove only thirty points');
assert.notEqual(paced.approval.tier, 'crisis');

for (let step = 0; step < 6; step += 1) {
  pacingNowMs += fiveMinutesMs;
  paced = paceSettlementApproval(severeTarget, pacingState, pacingNowMs, true);
  pacingState = paced.state;
}
assert.equal(paced.approval.score, 25);
assert.notEqual(paced.approval.tier, 'crisis');
pacingNowMs += fiveMinutesMs;
paced = paceSettlementApproval(severeTarget, pacingState, pacingNowMs, true);
pacingState = paced.state;
assert.equal(paced.approval.score, 24);
assert.equal(paced.approval.tier, 'crisis');

for (let step = 43; step < 53; step += 1) {
  pacingNowMs += fiveMinutesMs;
  paced = paceSettlementApproval(severeTarget, pacingState, pacingNowMs, true);
  pacingState = paced.state;
}
assert.equal(paced.approval.score, 16, 'reaching the severe target must take over four real hours');
assert.equal(APPROVAL_DECLINE_POINTS_PER_REAL_HOUR, 10);

const difficultyStart = paceSettlementApproval(severeTarget, null, 0, true);
const disabledDecline = paceSettlementApproval(
  severeTarget,
  difficultyStart.state,
  fiveMinutesMs,
  true,
  0,
);
const relaxedDecline = paceSettlementApproval(
  severeTarget,
  difficultyStart.state,
  fiveMinutesMs,
  true,
  50,
);
const demandingDecline = paceSettlementApproval(
  severeTarget,
  difficultyStart.state,
  fiveMinutesMs,
  true,
  150,
);
assert.equal(disabledDecline.state.score, APPROVAL_BASE_SCORE);
assert.ok(relaxedDecline.state.score > APPROVAL_BASE_SCORE - 1);
assert.ok(demandingDecline.state.score < APPROVAL_BASE_SCORE - 1);

let background = paceSettlementApproval(severeTarget, null, 0, true);
background = paceSettlementApproval(severeTarget, background.state, 4 * 60 * 60 * 1_000, true);
assert.equal(background.approval.score, 59, 'a throttled background tab must not spend hours at once');
const pausedAt = fiveMinutesMs;
let paused = paceSettlementApproval(severeTarget, null, 0, true);
paused = paceSettlementApproval(severeTarget, paused.state, pausedAt, false);
const beforePause = paused.approval.score;
paused = paceSettlementApproval(severeTarget, paused.state, pausedAt + 4 * 60 * 60 * 1_000, true);
assert.equal(paused.approval.score, beforePause, 'paused wall time must not lower approval');

const recoveredTarget = { ...severeTarget, score: 90, tier: 'beloved' as const, label: 'Beloved' };
const pacedRecovery = paceSettlementApproval(
  recoveredTarget,
  pacingState,
  pacingNowMs + fiveMinutesMs,
  true,
);
assert.equal(pacedRecovery.approval.score, 90, 'approval recovery should be immediate and lenient');
assert.equal(pacedRecovery.approval.tier, 'beloved');

const settlementHudSource = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const approvalPanelStart = settlementHudSource.indexOf('id="settlement-approval-panel"');
const approvalPanelEnd = settlementHudSource.indexOf('</section>', approvalPanelStart);
const approvalPanelTemplate = settlementHudSource.slice(approvalPanelStart, approvalPanelEnd);
assert.ok(approvalPanelStart >= 0 && approvalPanelEnd > approvalPanelStart);
assert.equal(approvalPanelTemplate.match(/<p\b/g)?.length, 1);
assert.match(approvalPanelTemplate, /data-approval-summary/);
assert.doesNotMatch(
  settlementHudSource,
  /data-approval-(?:effects|concerns|support)|Current effects|Needs attention|Supporting factors|factor\.(?:impact|detail)/,
  'approval hover must never render mechanics, effect lists, or numeric factor impacts',
);

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
