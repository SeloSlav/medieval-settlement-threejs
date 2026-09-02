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
  'hussars',
  'armored-lancers',
  'mounted-archers',
] as const;
export type MilitaryCompanyKind = (typeof MILITARY_KINDS)[number];

export const MILITARY_FORMATIONS = [
  'line',
  'column',
  'shield-wall',
  'loose',
  'brace',
  'wedge',
] as const;
export type MilitaryFormation = (typeof MILITARY_FORMATIONS)[number];
export const MILITARY_STANCES = [
  'balanced',
  'stand-ground',
  'push-forward',
  'give-ground',
  'missile-alert',
] as const;
export type MilitaryStance = (typeof MILITARY_STANCES)[number];
export type MilitaryCompanyStatus = 'mustering' | 'active' | 'disbanding' | 'leaving' | 'destroyed';

export type MilitaryCompanyState = {
  id: string;
  kind: MilitaryCompanyKind;
  sourceBuildingId: string;
  status: MilitaryCompanyStatus;
  departureRequested: boolean;
  formation: MilitaryFormation;
  stance: MilitaryStance;
  targetSize: number;
  livingMembers: number;
  morale: number;
  cohesion: number;
  fatigue: number;
  provisionDays: number;
  horseOats: number;
  horseWater: number;
  ammunition: number;
  ammunitionCapacity: number;
  formedTick: number;
  experience: number;
  level: number;
};

export const MERCENARY_COMPANY_NAMES = Object.freeze([
  'The Croaking Frogs of Kupa',
  'The Tipsy Pikes of Karlovac',
  'The Muddy Boots of Mrežnica',
  'The One-Eyed Roosters of Ozalj',
  'The Saintly Scoundrels of Senj',
  'The Black Badgers of Žumberak',
  'The Copper Kettles of Varaždin',
  'The Hungry Wolves of Una',
  'The Bent Spoons of Sisak',
  'The Loud Geese of Turopolje',
  'The Drowned Rats of Korana',
  'The Three-Legged Bears of Lika',
] as const);

export const MILITARY_MAX_LEVEL = 10;

export function militaryCompanyGainsExperience(kind: MilitaryCompanyKind): boolean {
  return kind !== 'militia' && kind !== 'mercenary-spears';
}

/** Total experience required to begin the supplied level. */
export function militaryLevelStartExperience(level: number): number {
  const capped = Math.max(1, Math.min(MILITARY_MAX_LEVEL, Math.floor(level)));
  let total = 0;
  for (let completedLevel = 1; completedLevel < capped; completedLevel += 1) {
    total += 100 + Math.max(0, completedLevel - 1) * 40;
  }
  return total;
}

export function militaryExperienceProgress(company: Pick<MilitaryCompanyState, 'experience' | 'level'>): {
  current: number;
  required: number;
  fraction: number;
  maximum: boolean;
} {
  const level = Math.max(1, Math.min(MILITARY_MAX_LEVEL, Math.floor(company.level)));
  if (level >= MILITARY_MAX_LEVEL) {
    return { current: 1, required: 1, fraction: 1, maximum: true };
  }
  const start = militaryLevelStartExperience(level);
  const next = militaryLevelStartExperience(level + 1);
  const required = Math.max(1, next - start);
  const current = Math.max(0, Math.min(required, Math.floor(company.experience) - start));
  return { current, required, fraction: current / required, maximum: false };
}

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
  source: 'town-hall' | 'guardhouse' | 'cavalry-yard';
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
    summary: 'Eight hired Landsknecht-style pikemen enter at the safest map edge with long pikes and Katzbalger sidearms. They cost one civic treasury gold per surviving man each day. Dismissal, nonpayment, seven quiet days, or the end of their three-week term sends them marching back to that edge without accepting orders; a two-day retainer can recall survivors before they exit.',
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
  hussars: {
    label: 'Frontier hussar company', shortLabel: 'Hussars', size: 6,
    cost: { polearms: 6, sidearms: 6, shields: 6, paddedArmor: 6, ale: 3, preservedFood: 18, gold: 30 },
    source: 'cavalry-yard', residentMen: true, icon: 'hussars',
    summary: 'Six Croatian-Hungarian light horse with lance, sidearm, small shield, and padded coat. Fast flanking cavalry that excels at overrunning missile troops.',
  },
  'armored-lancers': {
    label: 'Armored lancer company', shortLabel: 'Armored lancers', size: 6,
    cost: { polearms: 6, sidearms: 6, mailArmor: 6, ale: 6, preservedFood: 24, gold: 48 },
    source: 'cavalry-yard', residentMen: true, icon: 'armored-lancers',
    summary: 'Six mail-armored lancers who collect reserved pasture horses before mustering. The strongest charge and holding power of the mounted roster, with severe horse, armor, and wage costs.',
  },
  'mounted-archers': {
    label: 'Mounted archer company', shortLabel: 'Mounted archers', size: 6,
    cost: { bows: 6, sidearms: 6, paddedArmor: 6, ammunition: 6, ale: 3, preservedFood: 18, gold: 30 },
    source: 'cavalry-yard', residentMen: true, icon: 'mounted-archers',
    summary: 'Six frontier horse archers with bows, sidearms, and twenty-four arrows each. Highly mobile skirmishers that need spacing and suffer against braced spear or polearm troops.',
  },
};

export const MILITARY_PROVISION_ISSUE_DAYS = 3;

export function militaryRecruitmentCost(
  kind: MilitaryCompanyKind,
  demands: WorldMilitaryDemands,
): MilitaryRecruitmentCost {
  return militaryReinforcementCost(kind, MILITARY_RECRUITMENT[kind].size, demands);
}

export function militaryReinforcementCost(
  kind: MilitaryCompanyKind,
  requested: number,
  demands: WorldMilitaryDemands,
): MilitaryRecruitmentCost {
  const size = MILITARY_RECRUITMENT[kind].size;
  const count = Math.max(1, Math.floor(requested));
  const cost = Object.fromEntries(
    (Object.entries(MILITARY_RECRUITMENT[kind].cost) as Array<[keyof MilitaryRecruitmentCost, number]>)
      .map(([resource, amount]) => [resource, Math.ceil(amount / size * count)]),
  ) as MilitaryRecruitmentCost;
  if (kind === 'militia' || kind === 'mercenary-spears') return cost;
  switch (normalizeMilitaryDemands(demands)) {
    case 0:
      cost.ale = 0;
      cost.preservedFood = 0;
      cost.gold = 0;
      break;
    case 1:
      cost.ale = 0;
      cost.preservedFood = count;
      cost.gold = 0;
      break;
    case 2:
      cost.ale = Math.ceil(count / 4);
      cost.preservedFood = count * 2;
      break;
    case 3:
      cost.ale = count;
      cost.preservedFood = count * 2;
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
    const stance = MILITARY_STANCES[Number(row.stance)];
    const rawStatus = (['mustering', 'active', 'disbanding', 'destroyed'] as const)[Number(row.state)];
    const status = rawStatus === 'disbanding' && kind === 'mercenary-spears'
      ? 'leaving'
      : rawStatus;
    if (!kind || !formation || !stance || !status) continue;
    companies.set(row.id.toString(), {
      id: row.id.toString(),
      kind,
      sourceBuildingId: buildingClientId(row.sourceBuildingId),
      status,
      departureRequested: row.departureRequested,
      formation,
      stance,
      targetSize: Number(row.targetSize),
      livingMembers: Number(row.livingMembers),
      morale: clamp01(row.morale),
      cohesion: clamp01(row.cohesion),
      fatigue: clamp01(row.fatigue),
      provisionDays: Math.max(0, row.provisionDays),
      horseOats: Math.max(0, row.horseOats),
      horseWater: Math.max(0, row.horseWater),
      ammunition: Number(row.ammunition),
      ammunitionCapacity: Number(row.ammunitionCapacity),
      formedTick: Number(row.formedTick),
      experience: Number(row.experience),
      level: Math.max(1, Number(row.level)),
    });
  }
  return companies;
}

export function militaryKindLabel(kind: MilitaryCompanyKind): string {
  return MILITARY_RECRUITMENT[kind].label;
}

/** Stable contract-company identity derived from its authoritative company id. */
export function mercenaryCompanyName(companyId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < companyId.length; index += 1) {
    hash ^= companyId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return MERCENARY_COMPANY_NAMES[(hash >>> 0) % MERCENARY_COMPANY_NAMES.length]!;
}

export function militaryCompanyDisplayName(
  company: Pick<MilitaryCompanyState, 'id' | 'kind'>,
): string {
  return company.kind === 'mercenary-spears'
    ? mercenaryCompanyName(company.id)
    : `${militaryKindLabel(company.kind)} #${company.id}`;
}

export function militaryFormationLabel(formation: MilitaryFormation): string {
  switch (formation) {
    case 'shield-wall': return 'Shield wall';
    case 'loose': return 'Loose order';
    default: return formation[0]!.toUpperCase() + formation.slice(1);
  }
}

export function militaryFormationDescription(formation: MilitaryFormation): string {
  switch (formation) {
    case 'line': return 'Spreads the company across a broad front for a direct engagement.';
    case 'column': return 'Keeps the company narrow for roads and rapid repositioning.';
    case 'shield-wall': return 'Locks shielded infantry into a tight front against missiles and frontal attacks.';
    case 'loose': return 'Widens spacing to reduce missile losses and help skirmishers maneuver.';
    case 'brace': return 'Plants spear or polearm ranks to meet a frontal cavalry charge.';
    case 'wedge': return 'Forms mounted troops into a point for a decisive charge.';
  }
}

export function militaryFormationAvailable(
  kind: MilitaryCompanyKind,
  formation: MilitaryFormation,
): boolean {
  if (formation === 'shield-wall') {
    return ['spearmen', 'men-at-arms', 'mercenary-spears', 'footmen'].includes(kind);
  }
  if (formation === 'brace') return ['spearmen', 'mercenary-spears', 'polearms'].includes(kind);
  if (formation === 'wedge') return ['hussars', 'armored-lancers', 'mounted-archers'].includes(kind);
  return true;
}

export function militaryStanceLabel(stance: MilitaryStance): string {
  return stance.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

export function militaryStanceDescription(stance: MilitaryStance): string {
  switch (stance) {
    case 'balanced': return 'Maintains an adaptable pace and engages threats normally.';
    case 'stand-ground': return 'Holds this ground and waits for the enemy to close.';
    case 'push-forward': return 'Presses the attack aggressively and tires more quickly.';
    case 'give-ground': return 'Yields ground under pressure while keeping the company together.';
    case 'missile-alert': return 'Spreads attention against incoming missiles but risks close combat.';
  }
}

export function militaryStanceAvailable(
  kind: MilitaryCompanyKind,
  stance: MilitaryStance,
): boolean {
  const mounted = ['hussars', 'armored-lancers', 'mounted-archers'].includes(kind);
  const ranged = ['crossbows', 'bowmen', 'mounted-archers'].includes(kind);
  if (stance === 'push-forward') return !ranged || mounted;
  if (stance === 'give-ground' || stance === 'missile-alert') return !mounted;
  return true;
}

export function militaryCompanyRankLabel(
  company: Pick<MilitaryCompanyState, 'kind' | 'level'>,
): string | null {
  if (!militaryCompanyGainsExperience(company.kind)) return null;
  if (company.level >= 9) return 'Household elite';
  if (company.level >= 7) return 'Hardened';
  if (company.level >= 4) return 'Veteran';
  if (company.level >= 2) return 'Seasoned';
  return 'Unproven';
}

export function militaryCostText(cost: MilitaryRecruitmentCost): string {
  const labels: Record<keyof MilitaryRecruitmentCost, string> = {
    polearms: 'polearms', sidearms: 'sidearms', shields: 'shields', bows: 'bows',
    crossbows: 'crossbows', paddedArmor: 'padded armor', mailArmor: 'mail armor',
    ammunition: 'ammunition bundles', ale: 'ale',
    preservedFood: 'preserved food', gold: 'civic treasury gold',
  };
  return (Object.entries(cost) as Array<[keyof MilitaryRecruitmentCost, number]>)
    .filter(([, amount]) => amount > 0)
    .map(([kind, amount]) => `${amount} ${labels[kind]}`)
    .join(' · ');
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
