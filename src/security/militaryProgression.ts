import type { MilitaryCompany } from '../generated/types.ts';
import { buildingClientId } from '../data/spacetimeIds.ts';
import {
  normalizeMilitaryDemands,
  type WorldMilitaryDemands,
} from '../world/worldGenerationSettings.ts';

export const MILITARY_KINDS = [
  'militia',
  'spearmen',
  'men-at-arms',
  'crossbows',
  'mercenary-spears',
  'footmen',
  'polearms',
  'bowmen',
  'uskok-border-infantry',
] as const;
export type MilitaryCompanyKind = (typeof MILITARY_KINDS)[number];

export const MILITARY_FORMATIONS = ['line', 'column', 'shield-wall', 'loose'] as const;
export type MilitaryFormation = (typeof MILITARY_FORMATIONS)[number];
export type MilitaryCompanyStatus = 'mustering' | 'active' | 'disbanding' | 'leaving' | 'destroyed';

export type MilitaryCompanyState = {
  id: string;
  kind: MilitaryCompanyKind;
  sourceBuildingId: string;
  status: MilitaryCompanyStatus;
  formation: MilitaryFormation;
  targetSize: number;
  livingMembers: number;
  morale: number;
  cohesion: number;
  fatigue: number;
  provisionDays: number;
  ammunition: number;
  ammunitionCapacity: number;
  formedTick: number;
};

export type MilitaryRecruitmentCost = {
  polearms?: number;
  sidearms?: number;
  shields?: number;
  bows?: number;
  crossbows?: number;
  paddedArmor?: number;
  mailArmor?: number;
  ammunition?: number;
  ale?: number;
  preservedFood?: number;
  gold?: number;
};

export const MILITARY_RECRUITMENT: Record<MilitaryCompanyKind, {
  label: string;
  shortLabel: string;
  size: number;
  cost: MilitaryRecruitmentCost;
  source: 'town-hall' | 'guardhouse';
  residentMen: boolean;
  icon: string;
  summary: string;
}> = {
  militia: {
    label: 'Town militia',
    shortLabel: 'Militia',
    size: 5,
    cost: { polearms: 5 },
    source: 'town-hall',
    residentMen: true,
    icon: 'militia',
    summary: 'Choose how many unreserved local men to call up. They walk to the Town Hall and take one ordinary spear each.',
  },
  spearmen: {
    label: 'Spear company',
    shortLabel: 'Spearmen',
    size: 8,
    cost: { polearms: 8, shields: 8, paddedArmor: 8, ale: 4, preservedFood: 16, gold: 8 },
    source: 'guardhouse',
    residentMen: true,
    icon: 'spearmen',
    summary: 'Eight resident spearmen with shields and padded armor. Reliable line holders with strong reach.',
  },
  'men-at-arms': {
    label: 'Men-at-Arms company',
    shortLabel: 'Men-at-Arms',
    size: 8,
    cost: { sidearms: 8, shields: 8, mailArmor: 8, ale: 8, preservedFood: 24, gold: 32 },
    source: 'guardhouse',
    residentMen: true,
    icon: 'men-at-arms',
    summary: 'Eight armored sword-and-large-shield professionals. Exceptional line holders and missile-resistant infantry, but slow and deliberately vulnerable to polearms and armor-piercing crossbows.',
  },
  crossbows: {
    label: 'Crossbow company',
    shortLabel: 'Crossbows',
    size: 6,
    cost: { crossbows: 6, paddedArmor: 6, ammunition: 6, ale: 3, preservedFood: 18, gold: 12 },
    source: 'guardhouse',
    residentMen: true,
    icon: 'crossbows',
    summary: 'Six resident missile troops with eighteen bolts each. Strong at range, vulnerable once caught in melee.',
  },
  'mercenary-spears': {
    label: 'Mercenary pike company',
    shortLabel: 'Mercenary pikes',
    size: 8,
    cost: { gold: 96 },
    source: 'town-hall',
    residentMen: false,
    icon: 'mercenaries',
    summary: 'Eight hired Landsknecht-style pikemen enter at the safest map edge with long pikes and Katzbalger sidearms. They cost one Treasury gold per surviving man each day. Dismissal, nonpayment, seven quiet days, or the end of their three-week term sends them marching back to that edge without accepting orders; a two-day retainer can recall survivors before they exit.',
  },
  footmen: {
    label: 'Footman company', shortLabel: 'Footmen', size: 8,
    cost: { sidearms: 8, shields: 8, paddedArmor: 8, ale: 4, preservedFood: 16, gold: 16 },
    source: 'guardhouse', residentMen: true, icon: 'footmen',
    summary: 'Eight sidearm-and-small-shield infantry. Fast sustained offense breaks ordinary spear lines and runs down missile troops, but polearms punish their armor.',
  },
  polearms: {
    label: 'Polearm company', shortLabel: 'Polearms', size: 8,
    cost: { polearms: 8, paddedArmor: 8, ale: 4, preservedFood: 24, gold: 16 },
    source: 'guardhouse', residentMen: true, icon: 'polearms',
    summary: 'Eight halberd-style armor breakers. Excellent into Men-at-Arms and other heavy infantry, but exposed to bow and crossbow fire without shields.',
  },
  bowmen: {
    label: 'Bow company', shortLabel: 'Bowmen', size: 8,
    cost: { bows: 8, ammunition: 8, preservedFood: 16, gold: 8 },
    source: 'guardhouse', residentMen: true, icon: 'bowmen',
    summary: 'Eight inexpensive fast-firing bowmen with twenty-four arrows each. Strong against light troops; crossbows remain the better armored-target answer.',
  },
  'uskok-border-infantry': {
    label: 'Uskok border infantry', shortLabel: 'Uskoks', size: 8,
    cost: { polearms: 4, sidearms: 8, paddedArmor: 8, ale: 8, preservedFood: 24, gold: 32 },
    source: 'guardhouse', residentMen: true, icon: 'uskoks',
    summary: 'Eight Croatian frontier professionals with light matchlock arquebuses and long korda war knives. Exceptional flankers and missile hunters; braced spears stop them.',
  },
};

export const MILITARY_PROVISION_ISSUE_DAYS = 3;

export function militaryRecruitmentCost(
  kind: MilitaryCompanyKind,
  demands: WorldMilitaryDemands,
): MilitaryRecruitmentCost {
  const cost = { ...MILITARY_RECRUITMENT[kind].cost };
  if (kind === 'militia' || kind === 'mercenary-spears') return cost;
  const size = MILITARY_RECRUITMENT[kind].size;
  switch (normalizeMilitaryDemands(demands)) {
    case 0:
      cost.ale = 0;
      cost.preservedFood = 0;
      cost.gold = 0;
      break;
    case 1:
      cost.ale = 0;
      cost.preservedFood = size;
      cost.gold = 0;
      break;
    case 2:
      cost.ale = Math.ceil(size / 4);
      cost.preservedFood = size * 2;
      break;
    case 3:
      cost.ale = size;
      cost.preservedFood = size * 2;
      break;
  }
  return cost;
}

export function militaryCompanyRequiresProvisions(
  kind: MilitaryCompanyKind,
  demands: WorldMilitaryDemands,
): boolean {
  return kind !== 'militia'
    && kind !== 'mercenary-spears'
    && normalizeMilitaryDemands(demands) !== 0;
}

export function militaryCompanyWagesEnabled(
  kind: MilitaryCompanyKind,
  demands: WorldMilitaryDemands,
): boolean {
  return kind === 'mercenary-spears'
    || (kind !== 'militia' && normalizeMilitaryDemands(demands) >= 2);
}

export function militaryResupplyCost(
  livingSoldiers: number,
  demands: WorldMilitaryDemands,
): MilitaryRecruitmentCost {
  const living = Math.max(0, Math.floor(livingSoldiers));
  switch (normalizeMilitaryDemands(demands)) {
    case 0: return {};
    case 1: return { preservedFood: living };
    case 2: return { preservedFood: living * 2, ale: Math.ceil(living / 4) };
    case 3: return { preservedFood: living * 2, ale: living };
  }
}

export function syncMilitaryCompanies(
  rows: Iterable<MilitaryCompany>,
  identityHex: string | null,
): Map<string, MilitaryCompanyState> {
  const companies = new Map<string, MilitaryCompanyState>();
  if (!identityHex) return companies;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const kind = MILITARY_KINDS[Number(row.kind)];
    const formation = MILITARY_FORMATIONS[Number(row.formation)];
    const rawStatus = (['mustering', 'active', 'disbanding', 'destroyed'] as const)[Number(row.state)];
    const status = rawStatus === 'disbanding' && kind === 'mercenary-spears'
      ? 'leaving'
      : rawStatus;
    if (!kind || !formation || !status) continue;
    companies.set(row.id.toString(), {
      id: row.id.toString(),
      kind,
      sourceBuildingId: buildingClientId(row.sourceBuildingId),
      status,
      formation,
      targetSize: Number(row.targetSize),
      livingMembers: Number(row.livingMembers),
      morale: clamp01(row.morale),
      cohesion: clamp01(row.cohesion),
      fatigue: clamp01(row.fatigue),
      provisionDays: Math.max(0, row.provisionDays),
      ammunition: Number(row.ammunition),
      ammunitionCapacity: Number(row.ammunitionCapacity),
      formedTick: Number(row.formedTick),
    });
  }
  return companies;
}

export function militaryKindLabel(kind: MilitaryCompanyKind): string {
  return MILITARY_RECRUITMENT[kind].label;
}

export function militaryFormationLabel(formation: MilitaryFormation): string {
  switch (formation) {
    case 'shield-wall': return 'Shield wall';
    case 'loose': return 'Loose order';
    default: return formation[0]!.toUpperCase() + formation.slice(1);
  }
}

export function militaryCostText(cost: MilitaryRecruitmentCost): string {
  const labels: Record<keyof MilitaryRecruitmentCost, string> = {
    polearms: 'polearms', sidearms: 'sidearms', shields: 'shields', bows: 'bows',
    crossbows: 'crossbows', paddedArmor: 'padded armor', mailArmor: 'mail armor',
    ammunition: 'ammunition bundles', ale: 'ale',
    preservedFood: 'preserved food', gold: 'Treasury gold',
  };
  return (Object.entries(cost) as Array<[keyof MilitaryRecruitmentCost, number]>)
    .filter(([, amount]) => amount > 0)
    .map(([kind, amount]) => `${amount} ${labels[kind]}`)
    .join(' · ');
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
