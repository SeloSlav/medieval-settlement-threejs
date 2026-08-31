import type { CombatAgentState } from './combatAgents.ts';

export type ThreatApproachKind = 'wildlife' | 'bandit' | 'ottoman';

export type ThreatApproachAlert = {
  id: string;
  kind: ThreatApproachKind;
  title: string;
  detail: string;
  targetLabel: string;
  x: number;
  z: number;
  count: number;
};

type ThreatGroup = {
  key: string;
  kind: ThreatApproachKind;
  agents: CombatAgentState[];
};

function threatKind(agent: CombatAgentState): ThreatApproachKind | null {
  if (agent.faction === 'fox' || agent.faction === 'wolf') return 'wildlife';
  if (agent.faction === 'bandit') return 'bandit';
  if (agent.faction === 'raider') return 'ottoman';
  return null;
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
    const key = `${kind}:${agent.raidId}`;
    const group = groups.get(key) ?? { key, kind, agents: [] };
    group.agents.push(agent);
    groups.set(key, group);
  }
  return groups;
}

function wildlifeCopy(agents: readonly CombatAgentState[]): Pick<
  ThreatApproachAlert,
  'title' | 'detail' | 'targetLabel'
> {
  const wolves = agents.filter((agent) => agent.faction === 'wolf').length;
  const foxes = agents.length - wolves;
  if (wolves > 0) {
    const pack = wolves === 1 ? 'A lone wolf is' : `A pack of ${wolves} wolves is`;
    return {
      title: wolves === 1 ? 'Lone wolf approaching the settlement' : 'Wolf pack approaching the settlement',
      detail: `${pack} moving against people, livestock, or food stores. The game has slowed to 1× so the militia can be formed.`,
      targetLabel: wolves === 1 ? 'View the detected wolf' : 'View the detected wolf pack',
    };
  }
  return {
    title: foxes === 1 ? 'Fox approaching the settlement' : 'Foxes approaching the settlement',
    detail: `${foxes === 1 ? 'A fox has' : `${foxes} foxes have`} committed to a food raid. The game has slowed to 1× so guards can intercept ${foxes === 1 ? 'it' : 'them'}.`,
    targetLabel: foxes === 1 ? 'View the detected fox' : 'View the detected foxes',
  };
}

function groupCopy(group: ThreatGroup): Pick<
  ThreatApproachAlert,
  'title' | 'detail' | 'targetLabel'
> {
  if (group.kind === 'wildlife') return wildlifeCopy(group.agents);
  if (group.kind === 'bandit') {
    return {
      title: 'Bandits detected on the approach',
      detail: `${group.agents.length === 1 ? 'A bandit has' : `${group.agents.length} bandits have`} left camp or entered combat near the settlement. The game has slowed to 1× so guards can respond.`,
      targetLabel: 'View the detected bandits',
    };
  }
  return {
    title: 'Ottoman raiders detected',
    detail: `${group.agents.length} Ottoman ${group.agents.length === 1 ? 'raider has' : 'raiders have'} crossed the frontier and committed to the attack. The game has slowed to 1× so the settlement can muster.`,
    targetLabel: 'View the Ottoman incursion',
  };
}

function alertForGroup(group: ThreatGroup, simTick: number): ThreatApproachAlert {
  const copy = groupCopy(group);
  const center = group.agents.reduce(
    (sum, agent) => ({ x: sum.x + agent.x, z: sum.z + agent.z }),
    { x: 0, z: 0 },
  );
  return {
    id: `threat-approach:${group.key}:${simTick}`,
    kind: group.kind,
    ...copy,
    x: center.x / group.agents.length,
    z: center.z / group.agents.length,
    count: group.agents.length,
  };
}

/**
 * Tracks group-level hostile rising edges. Resting bandits remain invisible;
 * the same camp can report again only after its patrol has returned and a new
 * theft or battle begins.
 */
export class ThreatApproachTracker {
  private activeGroupKeys = new Set<string>();
  private worldKey: string | null = null;
  private lastSimTick: number | null = null;

  update(
    agents: Iterable<CombatAgentState>,
    simTick: number,
    worldKey: string,
  ): ThreatApproachAlert[] {
    if (
      this.worldKey !== worldKey
      || (this.lastSimTick !== null && simTick < this.lastSimTick)
    ) {
      this.activeGroupKeys.clear();
    }
    this.worldKey = worldKey;
    this.lastSimTick = simTick;

    const currentGroups = threatGroups(agents);
    const alerts = [...currentGroups.values()]
      .filter((group) => !this.activeGroupKeys.has(group.key))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((group) => alertForGroup(group, simTick));
    this.activeGroupKeys = new Set(currentGroups.keys());
    return alerts;
  }

  reset(): void {
    this.activeGroupKeys.clear();
    this.worldKey = null;
    this.lastSimTick = null;
  }
}
