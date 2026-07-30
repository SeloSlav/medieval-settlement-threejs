import type { NightPolicyState } from './nightPolicy.ts';
import type { SettlementProvisioning } from './settlementProvisioning.ts';
import type { SettlementSecurityState } from '../security/frontierSecurity.ts';

export const APPROVAL_BASE_SCORE = 50;

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

  const bufferedHomes = Math.max(0, provisioning.householdBufferHouseholds);
  const bufferCoverage = finiteUnit(provisioning.householdBufferCoverage);
  if (bufferedHomes > 0) {
    factors.push({
      key: 'household-provisions',
      label: 'Household provisions',
      impact: clampInteger(Math.round((bufferCoverage - 0.65) * 24), -16, 8),
      detail: [
        `${provisioning.householdBufferReadyHouseholds}/${bufferedHomes} established homes hold their local food, water, and fuel buffers.`,
        formatHouseholdShortfalls(provisioning),
      ].filter(Boolean).join(' '),
    });
  }

  const activeResidents = Math.max(0, welfare.activeResidents);
  if (activeResidents > 0) {
    const stableShare = finiteUnit(welfare.stableResidents / activeResidents);
    factors.push({
      key: 'resident-welfare',
      label: 'Resident welfare',
      impact: clampInteger(Math.round((stableShare - 0.5) * 20), -10, 10),
      detail: `${welfare.stableResidents}/${activeResidents} residents live without a current health or comfort warning.`,
    });

    const distressedResidents = Math.min(
      activeResidents,
      Math.max(0, welfare.hungryResidents)
        + Math.max(0, welfare.malnourishedResidents)
        + Math.max(0, welfare.starvingResidents),
    );
    if (distressedResidents > 0) {
      const distressShare = distressedResidents / activeResidents;
      factors.push({
        key: 'hunger',
        label: 'Hunger',
        impact: -clampInteger(
          Math.round(distressShare * 16) + (welfare.starvingResidents > 0 ? 4 : 0),
          2,
          20,
        ),
        detail: `${distressedResidents} residents are hungry, malnourished, or starving; restore household food deliveries first.`,
      });
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
      welfare.comfortWarningHouseholds / welfare.activeHouseholds,
    );
    const riskShare = Math.min(
      1,
      welfare.migrationRiskHouseholds / welfare.activeHouseholds,
    );
    const comfortPenalty = Math.round(warningShare * 8 + riskShare * 6);
    factors.push({
      key: 'household-comfort',
      label: 'Household comfort',
      impact: comfortPenalty > 0 ? -clampInteger(comfortPenalty, 1, 14) : 4,
      detail: comfortPenalty > 0
        ? `${welfare.comfortWarningHouseholds} homes have sustained status shortages; ${welfare.migrationRiskHouseholds} have reached emigration risk. Restore ale, preserved food, textiles, or pottery required by their tier.`
        : 'No occupied household is nearing comfort-driven emigration.',
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

  if (provisioning.foodConsumers > 0) {
    factors.push(foodReserveFactor(provisioning.foodRunwayDays));
  }

  const winterRelevant = input.month >= 9 || input.month <= 2;
  if (winterRelevant && provisioning.heatedResidents > 0) {
    const winterCoverage = finiteUnit(provisioning.winterFirewoodCoverage);
    factors.push({
      key: 'winter-firewood',
      label: 'Winter warmth',
      impact: clampInteger(Math.round((winterCoverage - 0.65) * 12), -8, 4),
      detail: `${Math.round(winterCoverage * 100)}% of the full winter hearth reserve is stored. Keep every heated road branch supplied.`,
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

  const blockedVacantHomes = welfare.dilapidatedHomes + welfare.ruinedHomes;
  if (blockedVacantHomes > 0) {
    factors.push({
      key: 'vacant-home-decay',
      label: 'Vacant-home decay',
      impact: -clampInteger(blockedVacantHomes * 2, 2, 8),
      detail: `${blockedVacantHomes} vacant ${blockedVacantHomes === 1 ? 'home blocks' : 'homes block'} resettlement until restored.`,
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

  const migrationRisk = Math.max(0, provisioning.welfare.migrationRiskHouseholds);
  effects.push(migrationRisk > 0
    ? `Retention: ${migrationRisk} ${migrationRisk === 1 ? 'household has' : 'households have'} reached comfort-driven emigration risk.`
    : 'Retention: no household has reached comfort-driven emigration risk.');

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
