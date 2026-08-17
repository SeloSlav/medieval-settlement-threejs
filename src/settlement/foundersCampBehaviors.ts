import type { BuildingState } from '../resources/types.ts';
import {
  FOUNDERS_CAMPFIRE_POSITION,
  FOUNDERS_CAMP_SEAT_LANDMARKS,
} from '../buildings/foundersCampLandmarks.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorAssignment,
  type AmbientBehaviorSlot,
} from './ambientBehaviors.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';

export const FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS = 24;

/**
 * Coordinates the small founding crowd around authored camp landmarks.
 * Conversation is kept as a real pair; remaining founders rotate through the
 * the camp's physical seats and a short camp loop.
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

  const campYaw = buildingPlacementYaw(
    'founders_camp',
    camp.x,
    camp.z,
    null,
  );
  const cosYaw = Math.cos(campYaw);
  const sinYaw = Math.sin(campYaw);
  const world = (x: number, z: number) => ({
    x: camp.x + cosYaw * x + sinYaw * z,
    z: camp.z - sinYaw * x + cosYaw * z,
  });
  const fire = world(FOUNDERS_CAMPFIRE_POSITION.x, FOUNDERS_CAMPFIRE_POSITION.z);
  // Keep the conversation in the clear strip between the preparation table
  // and the fire. Their old z positions ran through the tabletop footprint.
  const conversationA = world(-0.35, -1.35);
  const conversationB = world(1.25, -1.35);
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

  const seatSlots: AmbientBehaviorSlot[] = FOUNDERS_CAMP_SEAT_LANDMARKS.map(
    (seat) => ({
      id: seat.id,
      kind: seat.behavior,
      seatId: seat.id,
      destination: world(seat.destination.x, seat.destination.z),
      approach: seat.approach
        ? world(seat.approach.x, seat.approach.z)
        : undefined,
      lookAt: world(seat.lookAt.x, seat.lookAt.z),
      seatSurfaceHeight: seat.surfaceHeight,
    }),
  );
  const solo: AmbientBehaviorSlot[] = [
    ...seatSlots,
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
