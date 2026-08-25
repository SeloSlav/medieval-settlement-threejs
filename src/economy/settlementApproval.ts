import type { SettlementProvisioning } from './settlementProvisioning.ts';
import type { SettlementSecurityState } from '../security/frontierSecurity.ts';
import {
  APPROVAL_BASE_SCORE as CONFIGURED_APPROVAL_BASE_SCORE,
  APPROVAL_MAX_ACUTE_PENALTY,
  APPROVAL_MAX_NEED_PENALTY,
  APPROVAL_NEED_PRESSURE_RAMP_DAYS,
} from '../generated/gameBalance.ts';

export const APPROVAL_BASE_SCORE = CONFIGURED_APPROVAL_BASE_SCORE;

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
};

export type SettlementApproval = {
  score: number;
  tier: SettlementApprovalTier;
  label: string;
  summary: string;
  factors: readonly SettlementApprovalFactor[];
};

type ApprovalInput = {
  provisioning: SettlementProvisioning;
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
  const { provisioning } = input;
  const welfare = provisioning.welfare;
  const factors: SettlementApprovalFactor[] = [];
  let rawHungerPenalty = 0;
  let rawServicePenalty = 0;

  const bufferedHomes = Math.max(0, provisioning.householdBufferHouseholds);
  const bufferCoverage = finiteUnit(provisioning.householdBufferCoverage);
  if (bufferedHomes > 0) {
    const factor: SettlementApprovalFactor = {
      key: 'household-provisions',
      label: 'Household provisions',
      impact: clampInteger(Math.round((bufferCoverage - 0.65) * 24), -16, 8),
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
    } else {
      factors.push({
        key: 'household-services',
        label: 'Household services',
        impact: 4,
      });
    }
  }

  if (provisioning.foodConsumers > 0) {
    const factor = foodReserveFactor(provisioning.foodRunwayDays);
    if (factor.impact < 0) {
      rawHungerPenalty += -factor.impact;
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
    };
    if (factor.impact < 0) {
      rawServicePenalty += -factor.impact;
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
  // The exposure cap also guarantees the full configured penalty cannot land before at least
  // one persisted shortage clock completes the configured ramp.
  const exposureCap = APPROVAL_MAX_NEED_PENALTY * longestNeedPressureProgress;
  const maturedPenalty = Math.floor(Math.min(maturedRawPenalty, exposureCap));
  if (maturedPenalty > 0) {
    factors.push({
      key: 'household-hardship',
      label: 'Sustained household hardship',
      impact: -maturedPenalty,
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
    });
  }

  const scoredFactors = capAcuteApprovalPenalties(factors);
  const score = clampInteger(
    APPROVAL_BASE_SCORE + scoredFactors.reduce((sum, factor) => sum + factor.impact, 0),
    0,
    100,
  );
  const tier = approvalTier(score);
  const label = approvalTierLabel(tier);

  return {
    score,
    tier,
    label,
    summary: approvalConcernSummary(scoredFactors),
    factors: scoredFactors,
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
  };
}

export function approvalConcernSummary(
  factors: readonly Pick<SettlementApprovalFactor, 'key' | 'impact'>[],
): string {
  const strongestConcern = [...factors]
    .filter((factor) => factor.impact < 0)
    .sort((left, right) => left.impact - right.impact)[0];
  switch (strongestConcern?.key) {
    case 'household-hardship': return 'Some households are struggling to meet basic needs.';
    case 'illness': return 'Illness is affecting the settlement.';
    case 'burial-dignity': return 'Bodies remain unburied.';
    case 'fire-disruption': return 'Fires and displacement are disrupting the settlement.';
    case 'frontier-safety': return 'Residents feel unsafe.';
    case undefined: return 'Residents have no pressing concerns.';
    default: return 'Residents have a pressing concern.';
  }
}

function capAcuteApprovalPenalties(
  factors: readonly SettlementApprovalFactor[],
): SettlementApprovalFactor[] {
  const acute = factors
    .map((factor, index) => ({ factor, index }))
    .filter(({ factor }) => factor.impact < 0 && factor.key !== 'household-hardship');
  const totalPenalty = acute.reduce((sum, { factor }) => sum - factor.impact, 0);
  const cap = Math.max(0, Math.round(APPROVAL_MAX_ACUTE_PENALTY));
  if (totalPenalty <= cap) return [...factors];

  const allocations = acute.map(({ factor, index }) => {
    const exact = (-factor.impact * cap) / totalPenalty;
    const impact = Math.floor(exact);
    return { exact, impact, index, rawPenalty: -factor.impact };
  });
  let remainder = cap - allocations.reduce((sum, allocation) => sum + allocation.impact, 0);
  const priority = [...allocations].sort((left, right) =>
    (right.exact - right.impact) - (left.exact - left.impact)
      || right.rawPenalty - left.rawPenalty
      || left.index - right.index);
  for (const allocation of priority) {
    if (remainder <= 0) break;
    allocation.impact += 1;
    remainder -= 1;
  }
  const cappedByIndex = new Map(
    allocations.map((allocation) => [allocation.index, -allocation.impact]),
  );
  return factors.map((factor, index) => {
    const impact = cappedByIndex.get(index);
    return impact === undefined ? factor : { ...factor, impact };
  });
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
