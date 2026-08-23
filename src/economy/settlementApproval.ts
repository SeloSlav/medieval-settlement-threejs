import type { NightPolicyState } from './nightPolicy.ts';
import type { SettlementProvisioning } from './settlementProvisioning.ts';
import type { SettlementSecurityState } from '../security/frontierSecurity.ts';
import { APPROVAL_NEED_PRESSURE_RAMP_DAYS } from '../generated/gameBalance.ts';

export const APPROVAL_BASE_SCORE = 50;
const MAX_COMBINED_NEED_PENALTY = 40;

export type SettlementApprovalTier =
  | 'beloved'
  | 'liked'
  | 'content'
  | 'uneasy'
  | 'disliked'
  | 'crisis';

export type SettlementApprovalFactor = {
  key: string;
  label: string;
  impact: number;
  detail: string;
};

export type SettlementApproval = {
  score: number;
  tier: SettlementApprovalTier;
  label: string;
  summary: string;
  factors: readonly SettlementApprovalFactor[];
  effects: readonly string[];
};

type ApprovalInput = {
  provisioning: SettlementProvisioning;
  nightPolicy: Pick<NightPolicyState, 'communityCohesion' | 'laborFatigue'>;
  security: Pick<
    SettlementSecurityState,
    | 'coverage'
    | 'defenseReadiness'
    | 'nextRaidTick'
    | 'targetsAtRisk'
    | 'threat'
    | 'warningStartedTick'
  >;
  conflictEnabled: boolean;
  activeFires: number;
  month: number;
};

export function computeSettlementApproval(input: ApprovalInput): SettlementApproval {
  const { provisioning, nightPolicy } = input;
  const welfare = provisioning.welfare;
  const factors: SettlementApprovalFactor[] = [];
  let rawHungerPenalty = 0;
  let rawServicePenalty = 0;
  const needPressureDetails: string[] = [];

  const bufferedHomes = Math.max(0, provisioning.householdBufferHouseholds);
  const bufferCoverage = finiteUnit(provisioning.householdBufferCoverage);
  if (bufferedHomes > 0) {
    const factor: SettlementApprovalFactor = {
      key: 'household-provisions',
      label: 'Household provisions',
      impact: clampInteger(Math.round((bufferCoverage - 0.65) * 24), -16, 8),
      detail: [
        `${provisioning.householdBufferReadyHouseholds}/${bufferedHomes} established homes hold their local food, water, and fuel buffers.`,
        formatHouseholdShortfalls(provisioning),
      ].filter(Boolean).join(' '),
    };
    // Empty buffers are already represented by the independently-aged hunger,
    // food-confidence, service, and warmth pressures below. Keeping this as a
    // second negative would both double-count the shortage and let an old
    // service clock instantly mature a brand-new food-buffer failure (or vice
    // versa). Well-provisioned homes still earn the positive confidence bonus.
    if (factor.impact > 0) {
      factors.push(factor);
    }
  }

  const activeResidents = Math.max(0, welfare.activeResidents);
  if (activeResidents > 0) {
    const stableShare = finiteUnit(welfare.stableResidents / activeResidents);
    const stableSupport = clampInteger(Math.round(stableShare * 10), 0, 10);
    if (stableSupport > 0) {
      factors.push({
        key: 'resident-welfare',
        label: 'Resident welfare',
        impact: stableSupport,
        detail: `${welfare.stableResidents}/${activeResidents} residents live without a current health or comfort warning.`,
      });
    }

    const distressedResidents = Math.min(
      activeResidents,
      Math.max(0, welfare.hungryResidents)
        + Math.max(0, welfare.malnourishedResidents)
        + Math.max(0, welfare.starvingResidents),
    );
    if (distressedResidents > 0) {
      const distressShare = distressedResidents / activeResidents;
      rawHungerPenalty += clampInteger(
        Math.round(distressShare * 16) + (welfare.starvingResidents > 0 ? 4 : 0),
        2,
        20,
      );
      needPressureDetails.push(
        `${distressedResidents} residents are hungry, malnourished, or starving; restore household food deliveries first.`,
      );
    }

    if (welfare.sickResidents > 0) {
      const sickShare = Math.min(1, welfare.sickResidents / activeResidents);
      factors.push({
        key: 'illness',
        label: 'Illness',
        impact: -clampInteger(
          Math.round(sickShare * 8) + Math.min(4, welfare.untreatedSickHouseholds * 2),
          1,
          12,
        ),
        detail: `${welfare.sickResidents} residents are ill and ${welfare.untreatedSickHouseholds} sick homes lack a full day of remedies.`,
      });
    }
  }

  if (welfare.activeHouseholds > 0) {
    const warningShare = Math.min(
      1,
      welfare.serviceWarningHouseholds / welfare.activeHouseholds,
    );
    const blockedShare = Math.min(
      1,
      welfare.upgradeBlockedHouseholds / welfare.activeHouseholds,
    );
    const servicePenalty = Math.round(warningShare * 8 + blockedShare * 8);
    if (servicePenalty > 0) {
      rawServicePenalty += clampInteger(servicePenalty, 1, 16);
      needPressureDetails.push(
        `${welfare.serviceWarningHouseholds} homes have sustained unmet needs; ${welfare.upgradeBlockedHouseholds} cannot be promoted until service recovers. Household work and taxable market activity continue normally.`,
      );
    } else {
      factors.push({
        key: 'household-services',
        label: 'Household services',
        impact: 4,
        detail: 'Every occupied home has stable need service.',
      });
    }
  }

  if (provisioning.foodConsumers > 0) {
    const factor = foodReserveFactor(provisioning.foodRunwayDays);
    if (factor.impact < 0) {
      rawHungerPenalty += -factor.impact;
      needPressureDetails.push(factor.detail);
    } else {
      factors.push(factor);
    }
  }

  const winterRelevant = input.month >= 9 || input.month <= 2;
  if (winterRelevant && provisioning.heatedResidents > 0) {
    const winterCoverage = finiteUnit(provisioning.winterFirewoodCoverage);
    const factor: SettlementApprovalFactor = {
      key: 'winter-firewood',
      label: 'Winter warmth',
      impact: clampInteger(Math.round((winterCoverage - 0.65) * 12), -8, 4),
      detail: `${Math.round(winterCoverage * 100)}% of the full winter hearth reserve is stored. Keep every heated road branch supplied.`,
    };
    if (factor.impact < 0) {
      rawServicePenalty += -factor.impact;
      needPressureDetails.push(factor.detail);
    } else {
      factors.push(factor);
    }
  }

  const hungerExposureDays = finitePositive(welfare.longestHungerDays);
  const serviceExposureDays = finitePositive(welfare.longestServiceDeficitDays);
  const hungerPressureProgress = approvalNeedPressureProgress(hungerExposureDays);
  const servicePressureProgress = approvalNeedPressureProgress(serviceExposureDays);
  const longestNeedPressureProgress = Math.max(
    hungerPressureProgress,
    servicePressureProgress,
  );
  const maturedRawPenalty =
    rawHungerPenalty * hungerPressureProgress
      + rawServicePenalty * servicePressureProgress;
  // Cap after each pressure family has aged. Normalizing the current raw
  // factors first would let a brand-new shortage dilute an older, mature one.
  // The exposure cap also guarantees the full -40 cannot land before at least
  // one persisted shortage clock completes the configured ramp.
  const exposureCap = MAX_COMBINED_NEED_PENALTY * longestNeedPressureProgress;
  const maturedPenalty = Math.floor(Math.min(maturedRawPenalty, exposureCap));
  if (maturedPenalty > 0) {
    factors.push({
      key: 'household-hardship',
      label: 'Sustained household hardship',
      impact: -maturedPenalty,
      detail: [
        `Persisted shortage clocks ramp this pressure gradually: hunger ${formatExposureDays(hungerExposureDays)} (${Math.round(hungerPressureProgress * 100)}%); unmet services ${formatExposureDays(serviceExposureDays)} (${Math.round(servicePressureProgress * 100)}%). Full severity takes ${APPROVAL_NEED_PRESSURE_RAMP_DAYS} shortage-days.`,
        ...needPressureDetails,
      ].join(' '),
    });
  }

  const cohesion = finiteUnit(nightPolicy.communityCohesion);
  factors.push({
    key: 'community-cohesion',
    label: 'Community cohesion',
    impact: clampInteger(Math.round((cohesion - 0.5) * 20), -10, 10),
    detail: `${Math.round(cohesion * 100)}% cohesion reflects safe, social, well-rested nights. Courtyard gatherings and warm, fed homes strengthen it.`,
  });

  const fatigue = finiteUnit(nightPolicy.laborFatigue);
  if (fatigue >= 0.08) {
    factors.push({
      key: 'labor-fatigue',
      label: 'Night-work fatigue',
      impact: -clampInteger(Math.round(fatigue * 8), 1, 8),
      detail: `${Math.round(fatigue * 100)}% accumulated fatigue is weighing on household confidence. Reduce staffed night shifts to recover.`,
    });
  }

  if (welfare.uncollectedBodiesAtHomes > 0) {
    const burialBlocked = welfare.openGraves <= 0 || welfare.oldestUncollectedBodyDays >= 1;
    factors.push({
      key: 'burial-dignity',
      label: 'Burial dignity',
      impact: -clampInteger(
        welfare.uncollectedBodiesAtHomes * 2 + (burialBlocked ? 4 : 0),
        2,
        10,
      ),
      detail: `${welfare.uncollectedBodiesAtHomes} ${welfare.uncollectedBodiesAtHomes === 1 ? 'body remains' : 'bodies remain'} at homes; provide graves and staffed chapel carts.`,
    });
  }

  const firePressure = Math.max(
    Math.max(0, input.activeFires),
    Math.max(0, provisioning.displacedHouseholds),
  );
  if (firePressure > 0) {
    factors.push({
      key: 'fire-disruption',
      label: 'Fire disruption',
      impact: -clampInteger(
        input.activeFires * 3 + provisioning.displacedHouseholds * 2,
        3,
        12,
      ),
      detail: `${input.activeFires} active ${input.activeFires === 1 ? 'fire' : 'fires'} and ${provisioning.displacedHouseholds} displaced ${provisioning.displacedHouseholds === 1 ? 'household' : 'households'} are disrupting settlement life.`,
    });
  }

  if (input.conflictEnabled && securityPressureActive(input.security)) {
    const safety = finiteUnit(
      finiteUnit(input.security.coverage) * 0.55
        + finiteUnit(input.security.defenseReadiness) * 0.45,
    );
    const warningPenalty = input.security.warningStartedTick > 0
      ? Math.min(4, Math.max(1, input.security.targetsAtRisk))
      : 0;
    factors.push({
      key: 'frontier-safety',
      label: 'Frontier safety',
      impact: clampInteger(Math.round((safety - 0.5) * 12) - warningPenalty, -10, 6),
      detail: `${Math.round(input.security.coverage * 100)}% of settlement value is watched and defense readiness is ${Math.round(input.security.defenseReadiness * 100)}%. Staff towers and road-link supplied guard companies.`,
    });
  }

  const score = clampInteger(
    APPROVAL_BASE_SCORE + factors.reduce((sum, factor) => sum + factor.impact, 0),
    0,
    100,
  );
  const tier = approvalTier(score);
  const label = approvalTierLabel(tier);

  return {
    score,
    tier,
    label,
    summary: approvalSummary(score, label, factors),
    factors,
    effects: approvalEffects(provisioning, cohesion),
  };
}

export function approvalTier(score: number): SettlementApprovalTier {
  const normalized = clampInteger(Math.round(score), 0, 100);
  if (normalized >= 85) return 'beloved';
  if (normalized >= 70) return 'liked';
  if (normalized >= 55) return 'content';
  if (normalized >= 40) return 'uneasy';
  if (normalized >= 25) return 'disliked';
  return 'crisis';
}

export function approvalNeedPressureProgress(exposureDays: number): number {
  const rampDays = Math.max(1, APPROVAL_NEED_PRESSURE_RAMP_DAYS);
  const exposure = finitePositive(exposureDays);
  if (exposure === Number.POSITIVE_INFINITY) return 1;
  return finiteUnit(exposure / rampDays);
}

export function approvalTierLabel(tier: SettlementApprovalTier): string {
  switch (tier) {
    case 'beloved': return 'Beloved';
    case 'liked': return 'Liked';
    case 'content': return 'Content';
    case 'uneasy': return 'Uneasy';
    case 'disliked': return 'Disliked';
    case 'crisis': return 'Crisis';
  }
}

function foodReserveFactor(days: number): SettlementApprovalFactor {
  const runway = finitePositive(days);
  let impact = 0;
  if (runway < 2) {
    impact = -10;
  } else if (runway < 5) {
    impact = -Math.max(1, Math.round((5 - runway) * 2));
  } else if (runway >= 10) {
    impact = 5;
  } else {
    impact = 2;
  }
  return {
    key: 'food-reserves',
    label: 'Food confidence',
    impact,
    detail: `${formatRunway(runway)} of spoilage-adjusted food remains at current demand. Build accessible reserves before household cupboards run short.`,
  };
}

function approvalEffects(
  provisioning: SettlementProvisioning,
  cohesion: number,
): string[] {
  const effects: string[] = [];
  const households = Math.max(0, provisioning.householdBufferHouseholds);
  const ready = Math.max(0, provisioning.householdBufferReadyHouseholds);
  if (households <= 0) {
    effects.push('Settler growth: build an operational residence to establish the first household.');
  } else if (ready >= households) {
    effects.push(`Settler growth: all ${households} established ${households === 1 ? 'home holds' : 'homes hold'} the local survival buffers needed for further arrivals.`);
  } else {
    effects.push(`Settler growth: ${households - ready} of ${households} established ${households === 1 ? 'home is' : 'homes are'} pausing later arrivals until local buffers recover.`);
  }

  const serviceWarnings = Math.max(0, provisioning.welfare.serviceWarningHouseholds);
  const blockedUpgrades = Math.max(0, provisioning.welfare.upgradeBlockedHouseholds);
  effects.push(serviceWarnings > 0
    ? `Work and trade: ${serviceWarnings} sustained-shortage ${serviceWarnings === 1 ? 'home continues' : 'homes continue'} producing and trading at the normal rate.`
    : 'Work and trade: household service pressure does not modify production or assessed tax.');
  effects.push(blockedUpgrades > 0
    ? `Residence promotion: ${blockedUpgrades} ${blockedUpgrades === 1 ? 'home is' : 'homes are'} blocked from tier upgrades until all active needs recover.`
    : 'Residence promotion: no home is blocked by a sustained need shortage.');

  const cohesionBonus = Math.round(finiteUnit(cohesion) * 2);
  effects.push(
    `Community: ${Math.round(finiteUnit(cohesion) * 100)}% cohesion adds ${cohesionBonus} settlement-progress ${cohesionBonus === 1 ? 'tick' : 'ticks'} to each warm, fed, well-rested home at dawn.`,
  );
  return effects;
}

function approvalSummary(
  score: number,
  label: string,
  factors: readonly SettlementApprovalFactor[],
): string {
  const strongestConcern = [...factors]
    .filter((factor) => factor.impact < 0)
    .sort((left, right) => left.impact - right.impact)[0];
  if (strongestConcern) {
    return `${label} at ${score}%. The strongest current pressure is ${strongestConcern.label.toLowerCase()}.`;
  }
  return `${label} at ${score}%. No active factor is reducing approval.`;
}

function formatHouseholdShortfalls(provisioning: SettlementProvisioning): string {
  const shortages = [
    ['food', provisioning.householdBufferFoodShortHomes],
    ['water', provisioning.householdBufferWaterShortHomes],
    ['firewood', provisioning.householdBufferFirewoodShortHomes],
    ['preserved food', provisioning.householdBufferPreservedFoodShortHomes],
    ['ale', provisioning.householdBufferAleShortHomes],
    ['textiles', provisioning.householdBufferClothShortHomes],
    ['pottery', provisioning.householdBufferPotteryShortHomes],
  ]
    .filter((entry): entry is [string, number] => Number(entry[1]) > 0)
    .map(([label, count]) => `${label} ${count}`);
  return shortages.length > 0 ? `Short homes: ${shortages.join(' · ')}.` : '';
}

function securityPressureActive(
  security: Pick<
    SettlementSecurityState,
    'nextRaidTick' | 'targetsAtRisk' | 'threat' | 'warningStartedTick'
  >,
): boolean {
  return security.nextRaidTick > 0
    || security.targetsAtRisk > 0
    || security.threat > 0
    || security.warningStartedTick > 0;
}

function formatRunway(days: number): string {
  if (!Number.isFinite(days)) return 'an unlimited runway';
  if (days < 1) return 'less than one day';
  return `${days < 10 ? days.toFixed(1) : Math.floor(days)} days`;
}

function formatExposureDays(days: number): string {
  const exposure = finitePositive(days);
  if (!Number.isFinite(exposure)) return 'More than the full ramp';
  if (exposure < 1) return 'Less than one day';
  return `${exposure < 10 ? exposure.toFixed(1) : Math.floor(exposure)} days`;
}

function finitePositive(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
