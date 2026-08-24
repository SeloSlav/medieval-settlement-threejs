import type { BuildingKind } from '../resources/types.ts';

export type NightPolicyCode = 0 | 1 | 2;

export type NightPolicyState = {
  watch: NightPolicyCode;
  gathering: NightPolicyCode;
  work: NightPolicyCode;
  lighting: NightPolicyCode;
  curfew: NightPolicyCode;
  lastReportDay: number;
  lastHouseholds: number;
  lastWellRestedHouseholds: number;
  lastColdHouseholds: number;
  lastSocialHouseholds: number;
  lastWorkers: number;
  lastWatchStrength: number;
  lastIncidents: number;
  lastTheftGold: number;
  lastWildlifeSightings: number;
  lastLightingFuelUsed: number;
  lastLightingFuelShortfall: number;
  communityCohesion: number;
  laborFatigue: number;
};

export const DEFAULT_NIGHT_POLICY: NightPolicyState = {
  watch: 0,
  gathering: 1,
  work: 1,
  lighting: 1,
  curfew: 1,
  lastReportDay: 0,
  lastHouseholds: 0,
  lastWellRestedHouseholds: 0,
  lastColdHouseholds: 0,
  lastSocialHouseholds: 0,
  lastWorkers: 0,
  lastWatchStrength: 0,
  lastIncidents: 0,
  lastTheftGold: 0,
  lastWildlifeSightings: 0,
  lastLightingFuelUsed: 0,
  lastLightingFuelShortfall: 0,
  communityCohesion: 0.5,
  laborFatigue: 0,
};

export const NIGHT_WATCH_OPTIONS = [
  { value: 0, label: 'Ordinary watch', hint: 'Normal patrol coverage and warning range.' },
  { value: 1, label: 'Reinforced watch', hint: 'Earlier warning and stronger night security.' },
  { value: 2, label: 'Stand down', hint: 'Send watchmen home; darkness becomes much riskier.' },
] as const;

export const NIGHT_GATHERING_OPTIONS = [
  { value: 0, label: 'Quiet homes', hint: 'A short domestic evening with little public life.' },
  { value: 1, label: 'Courtyard visits', hint: 'Neighbors socialize near homes and civic yards.' },
  { value: 2, label: 'Open late', hint: 'A livelier, longer evening that builds cohesion.' },
] as const;

export const NIGHT_WORK_OPTIONS = [
  { value: 0, label: 'Day shift only', hint: 'All production rests until morning.' },
  { value: 1, label: 'Keep processes going', hint: 'Stocked kilns, clamps, mills, curing, and brewing continue.' },
  { value: 2, label: 'Staffed night shift', hint: 'Indoor workshops also work, accumulating fatigue.' },
] as const;

export const NIGHT_LIGHTING_OPTIONS = [
  { value: 0, label: 'Conserve fuel', hint: 'Dim windows and minimal public flame.' },
  { value: 1, label: 'Light main roads', hint: 'Balanced fuel use, visibility, and safety.' },
  { value: 2, label: 'Light the settlement', hint: 'Brightest and safest, but consumes more firewood.' },
] as const;

export const NIGHT_CURFEW_OPTIONS = [
  { value: 0, label: 'No curfew', hint: 'Most freedom and public activity, with higher risk.' },
  { value: 1, label: 'Children indoors', hint: 'A balanced family curfew.' },
  { value: 2, label: 'General curfew', hint: 'Safer streets but sharply reduced social life.' },
] as const;

export function normalizeNightPolicyCode(value: number | null | undefined): NightPolicyCode {
  if (value === 1 || value === 2) return value;
  return 0;
}

const CONTINUOUS_NIGHT_KINDS = new Set<BuildingKind>([
  'bakery',
  'brewery',
  'charcoal_burner',
  'potter_kiln',
  'smokehouse',
  'watermill',
]);

const STAFFED_NIGHT_KINDS = new Set<BuildingKind>([
  ...CONTINUOUS_NIGHT_KINDS,
  'carpenter',
  'monastery',
  'smithy',
  'weaver',
]);

export function isNightWorkBuilding(kind: BuildingKind, policy: NightPolicyCode): boolean {
  if (policy === 1) return CONTINUOUS_NIGHT_KINDS.has(kind);
  if (policy === 2) return STAFFED_NIGHT_KINDS.has(kind);
  return false;
}

export function nightLightingVisualScale(policy: NightPolicyCode): number {
  if (policy === 2) return 1.18;
  if (policy === 1) return 0.92;
  return 0.42;
}

/**
 * Routine dawn summaries remain available in the Town Hall inspector. The
 * Lord's ledger is reserved for nights with an actual gameplay consequence.
 */
export const DAWN_REPORT_RELEVANCE_THRESHOLD = 1;

export function dawnReportRelevanceScore(policy: NightPolicyState): number {
  if (policy.lastReportDay <= 0 || policy.lastHouseholds <= 0) return 0;

  let score = 0;
  if (policy.lastIncidents > 0 || policy.lastTheftGold > 0.005) score += 3;
  if (policy.lastColdHouseholds > 0) score += 2;
  return score;
}

export function isDawnReportRelevant(policy: NightPolicyState): boolean {
  return dawnReportRelevanceScore(policy) >= DAWN_REPORT_RELEVANCE_THRESHOLD;
}

export function formatDawnReport(policy: NightPolicyState): string {
  if (policy.lastReportDay <= 0 || policy.lastHouseholds <= 0) {
    return 'No household night has been recorded yet.';
  }
  const clauses = [
    `${policy.lastWellRestedHouseholds}/${policy.lastHouseholds} households well rested`,
    `${policy.lastSocialHouseholds} social`,
    `${policy.lastWorkers} night workers`,
    `${policy.lastLightingFuelUsed.toFixed(2)} firewood burned`,
  ];
  if (policy.lastColdHouseholds > 0) {
    clauses.push(`${policy.lastColdHouseholds} cold`);
  }
  if (policy.lastLightingFuelShortfall > 0.005) {
    clauses.push(`${policy.lastLightingFuelShortfall.toFixed(2)} fuel short`);
  }
  if (policy.lastTheftGold > 0.005) {
    clauses.push(`${Math.round(policy.lastTheftGold)} gold stolen`);
  } else if (policy.lastIncidents === 0) {
    clauses.push('no incidents');
  } else {
    clauses.push(`${policy.lastIncidents} incident${policy.lastIncidents === 1 ? '' : 's'}`);
  }
  if (policy.lastWildlifeSightings > 0) clauses.push('wildlife sighted');
  return clauses.join(' · ');
}
