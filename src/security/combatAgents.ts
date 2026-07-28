import type { CombatAgent } from '../generated/types.ts';
import {
  buildingClientId,
  residenceClientId,
  tripClientId,
} from '../data/spacetimeIds.ts';

export const COMBAT_AGENT_STATES = [
  'advancing',
  'fighting',
  'looting',
  'retreating',
  'returning',
  'downed',
] as const;

export type CombatAgentFaction = 'guard' | 'raider';
export type CombatAgentStatus = (typeof COMBAT_AGENT_STATES)[number];
export type CombatTargetKind =
  | 'building'
  | 'residence'
  | 'cart'
  | 'treasury-building'
  | 'treasury-residence';

export type CombatAgentState = {
  id: string;
  raidId: string;
  faction: CombatAgentFaction;
  sourceBuildingId: string | null;
  sourceSlot: number;
  targetKind: CombatTargetKind;
  targetId: string;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  health: number;
  maxHealth: number;
  readiness: number;
  status: CombatAgentStatus;
  attackCooldown: number;
  lootProgress: number;
  carryingLoot: boolean;
  stateChangedTick: number;
};

export function syncCombatAgents(
  rows: Iterable<CombatAgent>,
  identityHex: string | null,
): Map<string, CombatAgentState> {
  const agents = new Map<string, CombatAgentState>();
  if (!identityHex) return agents;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const status = COMBAT_AGENT_STATES[Number(row.state)];
    const targetKind = combatTargetKindFromId(Number(row.targetKind));
    if (!status || !targetKind) continue;
    const id = row.id.toString();
    agents.set(id, {
      id,
      raidId: row.raidId.toString(),
      faction: Number(row.faction) === 0 ? 'guard' : 'raider',
      sourceBuildingId: row.sourceBuildingId > 0n
        ? buildingClientId(row.sourceBuildingId)
        : null,
      sourceSlot: Number(row.sourceSlot),
      targetKind,
      targetId: combatTargetClientId(targetKind, row.targetId),
      x: row.x,
      z: row.z,
      homeX: row.homeX,
      homeZ: row.homeZ,
      health: Math.max(0, row.health),
      maxHealth: Math.max(1, row.maxHealth),
      readiness: Math.max(0, Math.min(1, row.readiness)),
      status,
      attackCooldown: Math.max(0, row.attackCooldown),
      lootProgress: Math.max(0, row.lootProgress),
      carryingLoot: row.carriedLootJson.length > 0,
      stateChangedTick: Number(row.stateChangedTick),
    });
  }
  return agents;
}

export function formatLiveCombatSummary(
  agents: Iterable<CombatAgentState>,
): string | undefined {
  let raiders = 0;
  let guards = 0;
  let downedRaiders = 0;
  let downedGuards = 0;
  for (const agent of agents) {
    if (agent.faction === 'raider') {
      if (agent.status === 'downed') downedRaiders += 1;
      else raiders += 1;
    } else if (agent.status === 'downed') {
      downedGuards += 1;
    } else {
      guards += 1;
    }
  }
  if (raiders + guards + downedRaiders + downedGuards === 0) return undefined;
  const casualties = downedRaiders + downedGuards > 0
    ? ` | ${downedRaiders} raider / ${downedGuards} guard down`
    : '';
  return `Live incursion: ${raiders} raider${raiders === 1 ? '' : 's'} | ${guards} guard${guards === 1 ? '' : 's'} in the field${casualties}.`;
}

function combatTargetKindFromId(value: number): CombatTargetKind | null {
  switch (value) {
    case 0: return 'building';
    case 1: return 'residence';
    case 2: return 'cart';
    case 3: return 'treasury-building';
    case 4: return 'treasury-residence';
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
  }
}
