import type { CombatAgentState } from './combatAgents.ts';
import type { BanditCampState } from './banditState.ts';
import type { ThreatAlertSoundKind } from '../audio/audioCatalog.ts';

export type ThreatApproachKind = 'wildlife' | 'bandit' | 'ottoman';
export type ThreatAnnouncementPhase = 'camp-established' | 'map-entry' | 'town-entry';

export const THREAT_TOWN_ENTRY_DISTANCE_METERS = 40;

export type ThreatTownTarget = {
  id: string;
  x: number;
  z: number;
};

export type ThreatApproachAlert = {
  id: string;
  kind: ThreatApproachKind;
  phase: ThreatAnnouncementPhase;
  sound: ThreatAlertSoundKind;
  title: string;
  detail: string;
  targetLabel: string;
  x: number;
  z: number;
  count: number;
  /** Stable live group identity used when a report is opened after it moved. */
  combatGroupId: string | null;
};

type ThreatGroup = {
  key: string;
  kind: ThreatApproachKind;
  agents: CombatAgentState[];
};

function threatKind(
  agent: Pick<CombatAgentState, 'faction'>,
): ThreatApproachKind | null {
  if (agent.faction === 'fox' || agent.faction === 'wolf') return 'wildlife';
  if (agent.faction === 'bandit') return 'bandit';
  if (agent.faction === 'raider') return 'ottoman';
  return null;
}

export function threatCombatGroupId(
  agent: Pick<CombatAgentState, 'faction' | 'raidId'>,
): string | null {
  const kind = threatKind(agent);
  return kind ? `${kind}:${agent.raidId}` : null;
}

/** Finds a report's current hostile centroid, preferring the same interpolated
 * positions used by the actor renderer. Downed or dead members no longer pull
 * the camera toward an old battlefield location. */
export function liveThreatCombatGroupPosition(
  agents: Iterable<CombatAgentState>,
  combatGroupId: string,
  getAgentPosition?: (id: string) => Readonly<{ x: number; z: number }> | null,
): Readonly<{ x: number; z: number; count: number }> | null {
  let x = 0;
  let z = 0;
  let count = 0;
  for (const agent of agents) {
    if (
      agent.status === 'downed'
      || !Number.isFinite(agent.health)
      || agent.health <= 0
      || threatCombatGroupId(agent) !== combatGroupId
    ) continue;
    const position = getAgentPosition?.(agent.id) ?? agent;
    x += position.x;
    z += position.z;
    count += 1;
  }
  return count > 0 ? { x: x / count, z: z / count, count } : null;
}

function isCommittedThreat(agent: CombatAgentState): boolean {
  if (!Number.isFinite(agent.health) || agent.health <= 0) return false;
  if (threatKind(agent) === null) return false;
  return agent.status === 'advancing'
    || agent.status === 'fighting'
    || agent.status === 'looting';
}

function threatGroups(agents: Iterable<CombatAgentState>): Map<string, ThreatGroup> {
  const groups = new Map<string, ThreatGroup>();
  for (const agent of agents) {
    if (!isCommittedThreat(agent)) continue;
    const kind = threatKind(agent);
    if (!kind) continue;
    const key = threatCombatGroupId(agent)!;
    const group = groups.get(key) ?? { key, kind, agents: [] };
    group.agents.push(agent);
    groups.set(key, group);
  }
  return groups;
}

function hasEnteredTown(
  agent: CombatAgentState,
  targets: ReadonlyMap<string, ThreatTownTarget>,
): boolean {
  if (
    agent.status !== 'advancing'
    && agent.status !== 'fighting'
    && agent.status !== 'looting'
  ) return false;
  const target = targets.get(agent.targetId);
  if (!target) return false;
  return Math.hypot(agent.x - target.x, agent.z - target.z)
    <= THREAT_TOWN_ENTRY_DISTANCE_METERS;
}

function groupCopy(group: ThreatGroup, phase: 'map-entry' | 'town-entry'): Pick<
  ThreatApproachAlert,
  'title' | 'detail' | 'targetLabel'
> {
  if (phase === 'map-entry') {
    return {
      title: 'Ottoman raiders have entered the map',
      detail: `${group.agents.length} Ottoman ${group.agents.length === 1 ? 'raider has' : 'raiders have'} crossed the frontier. The game has slowed to 1× so the settlement has time to muster before they reach the town.`,
      targetLabel: 'View the Ottoman incursion',
    };
  }
  if (group.kind === 'wildlife') {
    const wolves = group.agents.filter((agent) => agent.faction === 'wolf').length;
    const animals = group.agents.length === 1 ? 'A wild animal has' : `${group.agents.length} wild animals have`;
    return {
      title: wolves > 1 ? 'Wolf pack inside the settlement' : 'Wild animal inside the settlement',
      detail: `${animals} crossed into the built settlement and may now reach people, livestock, or stores. The game has slowed to 1× for an immediate response.`,
      targetLabel: 'View the wildlife breach',
    };
  }
  return {
    title: 'Bandits have entered the settlement',
    detail: `${group.agents.length === 1 ? 'A bandit has' : `${group.agents.length} bandits have`} crossed among the settlement buildings. Guards must intercept them before they reach the stores.`,
    targetLabel: 'View the bandit breach',
  };
}

function soundForGroup(
  group: ThreatGroup,
  phase: 'map-entry' | 'town-entry',
): ThreatAlertSoundKind {
  if (phase === 'map-entry') return 'ottoman-map-entry';
  return group.kind === 'wildlife' ? 'wildlife-town-entry' : 'bandit-town-entry';
}

function alertForGroup(
  group: ThreatGroup,
  phase: 'map-entry' | 'town-entry',
  simTick: number,
): ThreatApproachAlert {
  const copy = groupCopy(group, phase);
  const center = group.agents.reduce(
    (sum, agent) => ({ x: sum.x + agent.x, z: sum.z + agent.z }),
    { x: 0, z: 0 },
  );
  return {
    id: `threat-${phase}:${group.key}:${simTick}`,
    kind: group.kind,
    phase,
    sound: soundForGroup(group, phase),
    ...copy,
    x: center.x / group.agents.length,
    z: center.z / group.agents.length,
    count: group.agents.length,
    combatGroupId: group.key,
  };
}

function campEstablishedAlert(camp: BanditCampState, simTick: number): ThreatApproachAlert {
  return {
    id: `threat-camp-established:${camp.id}:${simTick}`,
    kind: 'bandit',
    phase: 'camp-established',
    sound: 'bandit-camp-established',
    title: 'Bandit camp established',
    detail: 'Scouts report that outlaws have raised a new camp in the surrounding country. Its patrols will begin probing settlement stores unless the camp is cleared.',
    targetLabel: 'View the new bandit camp',
    x: camp.x,
    z: camp.z,
    count: 1,
    combatGroupId: null,
  };
}

/**
 * Tracks announcement boundaries per hostile group: Ottoman map entry,
 * bandit camp creation, and bandit or wildlife town entry. Resting and
 * approaching bandits stay silent; a camp may report a later breach only
 * after its previous patrol has returned.
 */
export class ThreatApproachTracker {
  private activeGroupKeys = new Set<string>();
  private breachedGroupKeys = new Set<string>();
  private activeCampIds = new Set<string>();
  private campsInitialized = false;
  private worldKey: string | null = null;
  private lastSimTick: number | null = null;

  update(
    agents: Iterable<CombatAgentState>,
    simTick: number,
    worldKey: string,
    camps: Iterable<BanditCampState> = [],
    townTargets: Iterable<ThreatTownTarget> = [],
  ): ThreatApproachAlert[] {
    if (
      this.worldKey !== worldKey
      || (this.lastSimTick !== null && simTick < this.lastSimTick)
    ) {
      this.activeGroupKeys.clear();
      this.breachedGroupKeys.clear();
      this.activeCampIds.clear();
      this.campsInitialized = false;
    }
    this.worldKey = worldKey;
    this.lastSimTick = simTick;

    const activeCamps = [...camps]
      .filter((camp) => camp.active && camp.health > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
    const currentCampIds = new Set(activeCamps.map((camp) => camp.id));
    const campAlerts = this.campsInitialized
      ? activeCamps
        .filter((camp) => !this.activeCampIds.has(camp.id))
        .map((camp) => campEstablishedAlert(camp, simTick))
      : [];
    this.campsInitialized = true;
    this.activeCampIds = currentCampIds;

    const currentGroups = threatGroups(agents);
    const currentGroupKeys = new Set(currentGroups.keys());
    const townTargetById = new Map([...townTargets].map((target) => [target.id, target]));
    const townEntryGroups = [...currentGroups.values()].filter((group) => (
      group.kind !== 'ottoman'
      && group.agents.some((agent) => hasEnteredTown(agent, townTargetById))
    ));
    const townEntryKeys = new Set(townEntryGroups.map((group) => group.key));
    const mapEntryAlerts = [...currentGroups.values()]
      .filter((group) => (
        group.kind === 'ottoman'
        && !this.activeGroupKeys.has(group.key)
      ))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((group) => alertForGroup(group, 'map-entry', simTick));
    const townEntryAlerts = townEntryGroups
      .filter((group) => !this.breachedGroupKeys.has(group.key))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((group) => alertForGroup(group, 'town-entry', simTick));
    const alerts = [...campAlerts, ...mapEntryAlerts, ...townEntryAlerts];
    this.activeGroupKeys = new Set(currentGroups.keys());
    for (const key of [...this.breachedGroupKeys]) {
      if (!currentGroupKeys.has(key)) this.breachedGroupKeys.delete(key);
    }
    for (const key of townEntryKeys) this.breachedGroupKeys.add(key);
    return alerts;
  }

  reset(): void {
    this.activeGroupKeys.clear();
    this.breachedGroupKeys.clear();
    this.activeCampIds.clear();
    this.campsInitialized = false;
    this.worldKey = null;
    this.lastSimTick = null;
  }
}
