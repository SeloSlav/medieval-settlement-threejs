import type { CombatAgentState } from './combatAgents.ts';

/** Spears stay at camp for the entire theft trip, including an interrupted
 * escape or casualty. Combat retargeting must not conjure a spear in town. */
export function banditOnTheftMission(agent: CombatAgentState, alreadyDeparted = false): boolean {
  if (agent.faction !== 'bandit') return false;
  const atCamp = Math.hypot(agent.x - agent.homeX, agent.z - agent.homeZ) <= 8;
  if (agent.status === 'holding' && agent.targetKind === 'bandit-camp' && atCamp) return false;
  return alreadyDeparted || agent.carryingLoot || !atCamp
    || agent.status === 'advancing' || agent.status === 'looting'
    || agent.status === 'returning' || agent.status === 'retreating'
    || agent.targetKind === 'building' || agent.targetKind === 'residence'
    || agent.targetKind === 'cart';
}
