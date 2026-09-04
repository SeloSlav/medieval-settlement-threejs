import type { CombatAgentState } from './combatAgents.ts';

/** Dogs use combat movement states for peaceful patrols as well as pursuit. */
export function guardDogActivity(
  dog: Pick<CombatAgentState, 'status' | 'targetKind' | 'targetId' | 'sourceBuildingId' | 'assignedBuildingId' | 'health' | 'maxHealth'>,
  huntingCamp = "Hunter's hall",
): { status: string; activity: string; objective: string } {
  if (dog.status === 'downed') {
    return { status: 'Downed', activity: 'This guard dog has fallen', objective: '—' };
  }
  if (dog.targetKind === 'combat-agent') {
    return dog.status === 'fighting'
      ? { status: 'Fighting', activity: 'Attacking a nearby threat', objective: 'Nearby hostile' }
      : { status: 'Pursuing a threat', activity: 'Running to confront a nearby threat', objective: 'Nearby hostile' };
  }
  if (dog.health < dog.maxHealth && dog.targetKind === 'building' && dog.targetId === dog.sourceBuildingId) {
    return { status: 'Recovering', activity: 'Returning to the home kennel to heal', objective: 'Home kennel' };
  }
  return dog.assignedBuildingId
    ? { status: 'Woodland patrol', activity: `Roaming the woods within ${huntingCamp}'s work area`, objective: `${huntingCamp} work area` }
    : { status: 'Road patrol', activity: 'Walking the settlement roads and watching for threats', objective: 'Settlement road network' };
}
