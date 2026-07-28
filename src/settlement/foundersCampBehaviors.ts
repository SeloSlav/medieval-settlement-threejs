import type { BuildingState } from '../resources/types.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorAssignment,
  type AmbientBehaviorSlot,
} from './ambientBehaviors.ts';

export const FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS = 24;

/**
 * Coordinates the small founding crowd around authored camp landmarks.
 * Conversation is kept as a real pair; remaining founders rotate through the
 * bench, a fireside resting place, and a short camp loop.
 */
export function planFoundersCampAmbientBehaviors(
  camp: Pick<BuildingState, 'x' | 'z'>,
  actorIds: readonly string[],
  cycleIndex: number,
): Map<string, AmbientBehaviorAssignment> {
  const slots = foundersCampSlots(camp, actorIds.length, cycleIndex);
  return assignAmbientBehaviorSlots(actorIds, slots, cycleIndex);
}

function foundersCampSlots(
  camp: Pick<BuildingState, 'x' | 'z'>,
  actorCount: number,
  cycleIndex: number,
): AmbientBehaviorSlot[] {
  if (actorCount <= 0) return [];

  const world = (x: number, z: number) => ({
    x: camp.x + x,
    z: camp.z + z,
  });
  const fire = world(0.55, -0.6);
  const conversationA = world(-0.35, -2.05);
  const conversationB = world(1.25, -2.0);
  const conversation: AmbientBehaviorSlot[] = [
    {
      id: 'conversation-left',
      kind: 'talk',
      destination: conversationA,
      lookAt: conversationB,
    },
    {
      id: 'conversation-right',
      kind: 'talk',
      destination: conversationB,
      lookAt: conversationA,
    },
  ];

  const wanderWaypoints = [
    world(2.7, 1.05),
    world(3.45, -0.55),
    world(2.35, -1.55),
    world(0.4, -1.35),
    world(-0.75, 0.65),
  ];
  if (cycleIndex % 2 !== 0) wanderWaypoints.reverse();

  const solo: AmbientBehaviorSlot[] = [
    {
      id: 'bench-seat',
      kind: 'sit',
      // The authored sitting clip moves the hips slightly backward onto the
      // bench, so the feet remain on clear ground in front of the collider.
      destination: world(-1.9, -0.42),
      approach: world(-1.9, -0.9),
      lookAt: world(-1.9, -2),
      groundOffset: 0.18,
    },
    {
      id: 'fireside-rest',
      kind: 'rest',
      destination: world(2.45, 0.55),
      lookAt: fire,
    },
    {
      id: 'camp-wander',
      kind: 'wander',
      destination: wanderWaypoints[wanderWaypoints.length - 1]!,
      waypoints: wanderWaypoints,
      lookAt: fire,
    },
  ];

  if (actorCount === 1) return [solo[positiveModulo(cycleIndex, solo.length)]!];
  if (actorCount === 2) return conversation;

  const selected = [...conversation];
  const soloCount = Math.min(solo.length, actorCount - conversation.length);
  for (let index = 0; index < soloCount; index += 1) {
    selected.push(solo[positiveModulo(cycleIndex + index, solo.length)]!);
  }

  while (selected.length < actorCount) {
    const index = selected.length - conversation.length;
    const angle = index / Math.max(1, actorCount - conversation.length) * Math.PI * 2;
    selected.push({
      id: `hearth-idle-${index}`,
      kind: 'idle',
      destination: world(
        fire.x - camp.x + Math.sin(angle) * 2.7,
        fire.z - camp.z + Math.cos(angle) * 2.7,
      ),
      lookAt: fire,
    });
  }
  return selected;
}

function positiveModulo(value: number, modulus: number): number {
  return ((Math.trunc(value) % modulus) + modulus) % modulus;
}
