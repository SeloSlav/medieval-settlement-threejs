import type { CombatAgentState } from './combatAgents.ts';
import { hostileCompanyStrategicKindForFaction } from './militaryCompanyPresentation.ts';
import type { StrategicCompanyMarker } from './MilitaryCompanyStrategicOverlay.ts';

/** A marker must stay within a small, coherent party, not span a whole raid. */
export const HOSTILE_MARKER_MAX_PARTY_DIAMETER = 12;

export function hostileStrategicMarkers(agents: Iterable<CombatAgentState>): StrategicCompanyMarker[] {
  const parties = new Map<string, CombatAgentState[][]>();
  const sorted = [...agents].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const agent of sorted) {
    const kind = hostileCompanyStrategicKindForFaction(agent.faction);
    if (!kind || agent.status === 'downed' || agent.health <= 0) continue;
    // A thief leaving camp is a separate party immediately, even before it has
    // walked far from the sentries. Different encounters never merge.
    const key = `hostile:${agent.faction}:${agent.raidId}:${agent.status}`;
    const groups = parties.get(key) ?? [];
    const group = groups.find(members => members.every(member =>
      Math.hypot(member.x - agent.x, member.z - agent.z) <= HOSTILE_MARKER_MAX_PARTY_DIAMETER));
    if (group) group.push(agent);
    else groups.push([agent]);
    parties.set(key, groups);
  }
  return [...parties.entries()].flatMap(([key, groups]) => groups.map(members => ({
    id: `${key}:${members[0]!.id}`,
    kind: hostileCompanyStrategicKindForFaction(members[0]!.faction)!,
    agentIds: members.map(member => member.id),
    x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
    z: members.reduce((sum, member) => sum + member.z, 0) / members.length,
    livingMembers: members.length,
    controllable: false,
    moving: members.some(member => member.status === 'advancing'
      || member.status === 'retreating' || member.status === 'returning'
      || (member.routeProgress ?? 0) > 0.25),
    hostile: true,
  })));
}
