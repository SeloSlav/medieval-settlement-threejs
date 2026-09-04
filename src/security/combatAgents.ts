import type { CombatAgent, MilitaryCompany } from '../generated/types.ts';
import {
  CALENDAR_SECONDS_PER_DAY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  buildingClientId,
  residenceClientId,
  tripClientId,
} from '../data/spacetimeIds.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';

export const COMBAT_AGENT_STATES = [
  'advancing',
  'fighting',
  'looting',
  'retreating',
  'returning',
  'downed',
  'wounded-returning',
  'recovering',
  'mustering',
  'holding',
] as const;

export type CombatAgentFaction =
  | 'guard'
  | 'raider'
  | 'bandit'
  | 'militia'
  | 'spearman'
  | 'man-at-arms'
  | 'crossbow'
  | 'mercenary-spear'
  | 'footman'
  | 'polearm'
  | 'bowman'
  | 'hussar'
  | 'armored-lancer'
  | 'mounted-archer'
  | 'dog'
  | 'fox'
  | 'wolf';
export type CombatAgentStatus = (typeof COMBAT_AGENT_STATES)[number];
export type OttomanRaiderRole = 'azab' | 'janissary' | 'akinci' | 'sipahi';
export type CombatTargetKind =
  | 'building'
  | 'residence'
  | 'cart'
  | 'treasury-building'
  | 'treasury-residence'
  | 'bandit-camp'
  | 'ground'
  | 'combat-agent'
  | 'stable-ox';

export type CombatAgentState = {
  id: string;
  raidId: string;
  faction: CombatAgentFaction;
  sourceBuildingId: string | null;
  sourceSlot: number;
  ottomanRole: OttomanRaiderRole | null;
  /** Hunter's Hall duty for a dog; null keeps it on free settlement patrol. */
  assignedBuildingId?: string | null;
  targetKind: CombatTargetKind;
  targetId: string;
  x: number;
  z: number;
  /** Final server steering velocity, in metres per simulation second. */
  velocityX?: number;
  velocityZ?: number;
  homeX: number;
  homeZ: number;
  health: number;
  maxHealth: number;
  readiness: number;
  status: CombatAgentStatus;
  attackCooldown: number;
  lootProgress: number;
  carryingLoot: boolean;
  issuedPolearms: number;
  raidAnchorBuildingId: string | null;
  banditCampId: string | null;
  companyId: string | null;
  homeResidenceId: string | null;
  personIdentity: string | null;
  stateChangedTick: number;
  /** Authoritative company intent; hostiles use their own movement presentation. */
  running?: boolean;
  companyFacingX?: number;
  companyFacingZ?: number;
  /** Remaining direct-order/chase distance. */
  routeProgress?: number;
};

export type GuardCompanyRosterSummary = {
  rosterFloor: number;
  fieldedGuards: number;
  woundedGuards: number;
};

export function isWoundedGuard(agent: CombatAgentState): boolean {
  return agent.faction === 'guard' && (
    agent.status === 'downed'
    || agent.status === 'wounded-returning'
    || agent.status === 'recovering'
  );
}

export function isActiveRaiderThreat(agent: CombatAgentState): boolean {
  return agent.faction === 'raider'
    && Number.isFinite(agent.health)
    && agent.health > 0
    && (
      agent.status === 'advancing'
      || agent.status === 'fighting'
      || agent.status === 'looting'
      || agent.status === 'retreating'
    );
}

export function isPlayerMilitaryFaction(faction: CombatAgentFaction): boolean {
  return faction === 'militia'
    || faction === 'spearman'
    || faction === 'man-at-arms'
    || faction === 'crossbow'
    || faction === 'mercenary-spear'
    || faction === 'footman'
    || faction === 'polearm'
    || faction === 'bowman'
    || faction === 'hussar'
    || faction === 'armored-lancer'
    || faction === 'mounted-archer';
}

/** Actors controlled by hostile simulation systems must never enter the
 * player's individual-unit selection flow. */
export function isHostileCombatFaction(faction: CombatAgentFaction): boolean {
  return faction === 'raider'
    || faction === 'bandit'
    || faction === 'fox'
    || faction === 'wolf';
}

/** Returns the atomic RTS company that owns this fighter's primary selection.
 * Mustering, casualties, and recovery actors remain individually inspectable
 * because MilitiaCommandController intentionally does not group them. Returning
 * companies stay selectable so their leaving-state UI can offer retention. */
export function selectablePlayerMilitaryCompanyId(
  agent: CombatAgentState,
): string | null {
  if (
    !isPlayerMilitaryFaction(agent.faction)
    || !agent.companyId
    || agent.status === 'downed'
    || agent.status === 'mustering'
    || agent.status === 'wounded-returning'
    || agent.status === 'recovering'
  ) {
    return null;
  }
  return agent.companyId;
}

export function hasActiveRaiderThreat(
  agents: Iterable<CombatAgentState>,
): boolean {
  for (const agent of agents) {
    if (isActiveRaiderThreat(agent)) return true;
  }
  return false;
}

export function guardCompanyRosterSummary(
  agents: Iterable<CombatAgentState>,
  sourceBuildingId: string,
): GuardCompanyRosterSummary {
  let rosterFloor = 0;
  let fieldedGuards = 0;
  let woundedGuards = 0;
  for (const agent of agents) {
    if (
      agent.faction !== 'guard'
      || agent.sourceBuildingId !== sourceBuildingId
    ) {
      continue;
    }
    rosterFloor = Math.max(rosterFloor, agent.sourceSlot + 1);
    if (isWoundedGuard(agent)) woundedGuards += 1;
    else fieldedGuards += 1;
  }
  return { rosterFloor, fieldedGuards, woundedGuards };
}

export function guardCompanyIssuedPolearms(
  agents: Iterable<CombatAgentState>,
  sourceBuildingId: string,
): number {
  let issued = 0;
  for (const agent of agents) {
    if (
      agent.faction === 'guard'
      && agent.sourceBuildingId === sourceBuildingId
      && Number.isFinite(agent.issuedPolearms)
    ) {
      issued += Math.max(0, agent.issuedPolearms);
    }
  }
  return issued;
}

export function issuedGuardPolearmsByCompany(
  agents: Iterable<CombatAgentState>,
  issued: Map<string, number> = new Map<string, number>(),
): Map<string, number> {
  issued.clear();
  for (const agent of agents) {
    if (
      agent.faction !== 'guard'
      || agent.sourceBuildingId === null
      || !Number.isFinite(agent.issuedPolearms)
      || agent.issuedPolearms <= 0
    ) {
      continue;
    }
    issued.set(
      agent.sourceBuildingId,
      (issued.get(agent.sourceBuildingId) ?? 0) + agent.issuedPolearms,
    );
  }
  return issued;
}

export function syncCombatAgents(
  rows: Iterable<CombatAgent>,
  identityHex: string | null,
  companyRows: Iterable<MilitaryCompany> = [],
): Map<string, CombatAgentState> {
    const agents = new Map<string, CombatAgentState>();
  if (!identityHex) return agents;
  const companies = new Map([...companyRows].map(row => [row.id.toString(), row]));
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const status = COMBAT_AGENT_STATES[Number(row.state)];
    const targetKind = combatTargetKindFromId(Number(row.targetKind));
    if (!status || !targetKind) continue;
    const id = row.id.toString();
    const faction = combatFactionFromId(Number(row.faction));
    const issuedPolearms = carriedPolearms(row.carriedLootJson);
    const playerMilitary = isPlayerMilitaryFaction(faction);
    const company = playerMilitary ? companies.get(row.raidId.toString()) : undefined;
    const homeResidenceId = playerMilitary && row.raidAnchorBuildingId > 0n
      ? residenceClientId(row.raidAnchorBuildingId)
      : null;
    agents.set(id, {
      id,
      raidId: row.raidId.toString(),
      faction,
      sourceBuildingId: row.sourceBuildingId > 0n
        ? buildingClientId(row.sourceBuildingId)
        : null,
      sourceSlot: Number(row.sourceSlot),
      ottomanRole: faction === 'raider'
        ? ottomanRaiderRole(Number(row.sourceSlot))
        : null,
      assignedBuildingId: row.assignedBuildingId > 0n
        ? buildingClientId(row.assignedBuildingId)
        : null,
      targetKind,
      targetId: combatTargetClientId(targetKind, row.targetId),
      x: row.x,
      z: row.z,
      velocityX: row.velocityX,
      velocityZ: row.velocityZ,
      homeX: row.homeX,
      homeZ: row.homeZ,
      health: Math.max(0, row.health),
      maxHealth: Math.max(1, row.maxHealth),
      readiness: Math.max(0, Math.min(1, row.readiness)),
      status,
      attackCooldown: Math.max(0, row.attackCooldown),
      lootProgress: Math.max(0, row.lootProgress),
      carryingLoot: (faction === 'raider' || faction === 'bandit' || faction === 'fox') && row.carriedLootJson.length > 0,
      issuedPolearms: faction === 'guard' || playerMilitary ? issuedPolearms : 0,
      raidAnchorBuildingId: row.raidAnchorBuildingId > 0n && faction !== 'bandit' && !playerMilitary
        ? buildingClientId(row.raidAnchorBuildingId)
        : null,
      banditCampId: row.raidAnchorBuildingId > 0n && faction === 'bandit'
        ? `bandit-camp-${row.raidAnchorBuildingId}`
        : null,
      companyId: playerMilitary ? row.raidId.toString() : null,
      homeResidenceId,
      personIdentity: homeResidenceId
        ? `${homeResidenceId}:person:${Number(row.residentSlot)}`
        : null,
      stateChangedTick: Number(row.stateChangedTick),
      routeProgress: Math.max(0, row.routeProgress),
      running: company ? company.running && company.fatigue < 0.95 : undefined,
      companyFacingX: company?.facingX,
      companyFacingZ: company?.facingZ,
    });
  }
  return agents;
}

export function ottomanRaiderRole(sourceSlot: number): OttomanRaiderRole {
  switch (Math.max(0, Math.floor(sourceSlot)) % 8) {
    case 0:
    case 1:
    case 2: return 'azab';
    case 3:
    case 4: return 'janissary';
    case 5:
    case 6: return 'akinci';
    default: return 'sipahi';
  }
}

export function ottomanRaiderIsRanged(sourceSlot: number): boolean {
  return [1, 2, 5, 6].includes(Math.max(0, Math.floor(sourceSlot)) % 8);
}

export function isMountedCombatAgent(
  agent: Pick<CombatAgentState, 'faction' | 'ottomanRole'>,
): boolean {
  return agent.faction === 'hussar'
    || agent.faction === 'armored-lancer'
    || agent.faction === 'mounted-archer'
    || (agent.faction === 'raider'
      && (agent.ottomanRole === 'akinci' || agent.ottomanRole === 'sipahi'));
}

function combatFactionFromId(value: number): CombatAgentFaction {
  if (value === 0) return 'guard';
  if (value === 2) return 'bandit';
  if (value === 3) return 'militia';
  if (value === 4) return 'spearman';
  if (value === 5) return 'man-at-arms';
  if (value === 6) return 'crossbow';
  if (value === 7) return 'mercenary-spear';
  if (value === 8) return 'footman';
  if (value === 9) return 'polearm';
  if (value === 10) return 'bowman';
  if (value === 11) return 'hussar';
  if (value === 15) return 'armored-lancer';
  if (value === 16) return 'mounted-archer';
  if (value === 12) return 'dog';
  if (value === 13) return 'fox';
  if (value === 14) return 'wolf';
  return 'raider';
}

function carriedPolearms(carriedStoresJson: string): number {
  if (carriedStoresJson.length === 0) return 0;
  try {
    const carried = JSON.parse(carriedStoresJson) as { polearms?: unknown };
    const polearms = Number(carried.polearms);
    return wholeResourceUnits(polearms);
  } catch {
    return 0;
  }
}

export function formatLiveCombatSummary(
  agents: Iterable<CombatAgentState>,
  simTick?: number,
  routStarted = false,
): string | undefined {
  let raiders = 0;
  let retreatingRaiders = 0;
  let retreatingLootCarriers = 0;
  let guards = 0;
  let downedRaiders = 0;
  let woundedGuards = 0;
  let recoveringGuards = 0;
  let musteringGuards = 0;
  let holdingGuards = 0;
  let breachingRefuges = 0;
  let lootingHoldings = 0;
  let raiderHealth = 0;
  let guardHealth = 0;
  let longestRecoveryDays = 0;
  for (const agent of agents) {
    if (agent.faction === 'raider') {
      if (agent.status === 'downed') downedRaiders += 1;
      else {
        raiders += 1;
        raiderHealth += agent.health / agent.maxHealth;
        if (agent.status === 'retreating') {
          retreatingRaiders += 1;
          if (agent.carryingLoot) retreatingLootCarriers += 1;
        }
        if (agent.status === 'looting' && agent.raidAnchorBuildingId) {
          breachingRefuges += 1;
        } else if (agent.status === 'looting') {
          lootingHoldings += 1;
        }
      }
    } else if (agent.faction === 'guard' && (
      agent.status === 'downed'
      || agent.status === 'wounded-returning'
      || agent.status === 'recovering'
    )) {
      woundedGuards += 1;
      if (agent.status === 'recovering') {
        recoveringGuards += 1;
        if (simTick != null) {
          longestRecoveryDays = Math.max(
            longestRecoveryDays,
            guardRecoveryRemainingDays(agent, simTick),
          );
        }
      }
    } else if (agent.faction === 'guard') {
      guards += 1;
      guardHealth += agent.health / agent.maxHealth;
      if (agent.status === 'mustering') musteringGuards += 1;
      if (agent.status === 'holding') holdingGuards += 1;
    }
  }
  if (raiders + guards + downedRaiders + woundedGuards === 0) return undefined;
  if (raiders === 0 && musteringGuards + holdingGuards > 0) {
    const parts = [
      musteringGuards > 0
        ? `${musteringGuards} guard${musteringGuards === 1 ? '' : 's'} marching to assigned posts`
        : '',
      holdingGuards > 0
        ? `${holdingGuards} holding the watch line`
        : '',
      woundedGuards > 0
        ? `${woundedGuards} wounded unavailable`
        : '',
    ].filter(Boolean);
    return `Frontier muster: ${parts.join(' · ')}.`;
  }
  if (raiders === 0 && guards === 0 && downedRaiders === 0) {
    const recovery = recoveringGuards > 0 && longestRecoveryDays > 0
      ? ` · up to ${formatRecoveryDays(longestRecoveryDays)} remaining`
      : '';
    return `Company aftermath: ${woundedGuards} wounded guard${woundedGuards === 1 ? '' : 's'} unavailable${recovery}.`;
  }
  if (raiders === 0) {
    const parts = [
      guards > 0
        ? `${guards} guard${guards === 1 ? '' : 's'} returning`
        : '',
      woundedGuards > 0
        ? `${woundedGuards} wounded unavailable`
        : '',
      downedRaiders > 0
        ? `${downedRaiders} raider${downedRaiders === 1 ? '' : 's'} down`
        : '',
    ].filter(Boolean);
    return `Raid aftermath: ${parts.join(' · ')}.`;
  }
  const raiderStrength = raiders > 0
    ? ` at ${Math.round(raiderHealth / raiders * 100)}% health`
    : '';
  const guardStrength = guards > 0
    ? ` at ${Math.round(guardHealth / guards * 100)}% health`
    : '';
  const casualtyParts = [
    downedRaiders > 0
      ? `${downedRaiders} raider${downedRaiders === 1 ? '' : 's'} down`
      : '',
    woundedGuards > 0
      ? `${woundedGuards} guard${woundedGuards === 1 ? '' : 's'} wounded`
      : '',
  ].filter(Boolean);
  const casualties = casualtyParts.length > 0
    ? ` | ${casualtyParts.join(' · ')}`
    : '';
  if (routStarted) {
    const fleeing = retreatingRaiders === raiders
      ? `${raiders} raider${raiders === 1 ? '' : 's'} fleeing`
      : `${retreatingRaiders} / ${raiders} raiders fleeing`;
    const pursuit = guards > 0
      ? `${guards} guard${guards === 1 ? '' : 's'} pursuing${guardStrength}`
      : 'no fit guards in pursuit';
    const loot = retreatingLootCarriers > 0
      ? ` | ${retreatingLootCarriers} ${retreatingLootCarriers === 1 ? 'fugitive carries' : 'fugitives carry'} stolen stores`
      : '';
    return `Raiders routed: ${fleeing}${raiderStrength} | ${pursuit}${loot}${casualties}.`;
  }
  const refugeAssault = breachingRefuges > 0
    ? ` | ${breachingRefuges} raider${breachingRefuges === 1 ? '' : 's'} breaching a refuge`
    : '';
  const holdingLoot = lootingHoldings > 0
    ? ` | ${lootingHoldings} raider${lootingHoldings === 1 ? '' : 's'} looting ${lootingHoldings === 1 ? 'a holding' : 'holdings'}`
    : '';
  return `Live incursion: ${raiders} raider${raiders === 1 ? '' : 's'}${raiderStrength} | ${guards} guard${guards === 1 ? '' : 's'}${guardStrength}${refugeAssault}${holdingLoot}${casualties}.`;
}

export function guardRecoveryTicks(readiness: number): number {
  const normalizedReadiness = Number.isFinite(readiness)
    ? Math.max(0, Math.min(1, readiness))
    : 0;
  const ticksPerDay = Math.max(
    1,
    Math.round(CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS),
  );
  return Math.max(1, Math.round((5 - normalizedReadiness * 2) * ticksPerDay));
}

export function guardRecoveryRemainingDays(
  agent: Pick<CombatAgentState, 'readiness' | 'stateChangedTick'>,
  simTick: number,
): number {
  const ticksPerDay = Math.max(
    1,
    Math.round(CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS),
  );
  const remainingTicks = Math.max(
    0,
    guardRecoveryTicks(agent.readiness)
      - Math.max(0, simTick - agent.stateChangedTick),
  );
  return remainingTicks / ticksPerDay;
}

function formatRecoveryDays(days: number): string {
  return days < 1
    ? '<1 day'
    : `${Math.ceil(days)} days`;
}

function combatTargetKindFromId(value: number): CombatTargetKind | null {
  switch (value) {
    case 0: return 'building';
    case 1: return 'residence';
    case 2: return 'cart';
    case 3: return 'treasury-building';
    case 4: return 'treasury-residence';
    case 5: return 'bandit-camp';
    case 6: return 'ground';
    case 7: return 'combat-agent';
    case 8: return 'stable-ox';
    default: return null;
  }
}

function combatTargetClientId(kind: CombatTargetKind, id: bigint): string {
  switch (kind) {
    case 'building':
    case 'treasury-building':
      return buildingClientId(id);
    case 'residence':
    case 'treasury-residence':
      return residenceClientId(id);
    case 'cart':
      return tripClientId(id);
    case 'bandit-camp':
      return `bandit-camp-${id}`;
    case 'ground':
      return `ground-${id}`;
    case 'combat-agent':
    case 'stable-ox':
      return id.toString();
  }
}
