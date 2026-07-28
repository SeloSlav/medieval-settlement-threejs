import type { BuildingState } from '../resources/types.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorAssignment,
  type AmbientBehaviorSlot,
} from './ambientBehaviors.ts';

export const CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS = 12;

/**
 * The chapel has no visible interior, so the exterior gathering stands in for
 * a service happening inside. Parishioners only mingle or circulate here:
 * seating and ground-resting are deliberately left to places that depict them.
 */
export function planChapelGatheringBehaviors(
  chapel: Pick<BuildingState, 'x' | 'z'>,
  actorIds: readonly string[],
  cycleIndex: number,
): Map<string, AmbientBehaviorAssignment> {
  return assignAmbientBehaviorSlots(
    actorIds,
    chapelGatheringSlots(chapel, actorIds.length, cycleIndex),
    cycleIndex,
  );
}

function chapelGatheringSlots(
  chapel: Pick<BuildingState, 'x' | 'z'>,
  actorCount: number,
  cycleIndex: number,
): AmbientBehaviorSlot[] {
  if (actorCount <= 0) return [];

  const slots: AmbientBehaviorSlot[] = [];
  const pairCount = Math.floor(actorCount / 2);
  const cycleAngle = cycleIndex * 0.47;

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const angle = cycleAngle + pairIndex / Math.max(1, pairCount) * Math.PI * 2;
    const radius = 6 + (pairIndex % 2) * 1.15;
    const center = radialPoint(chapel, angle, radius);
    const tangentX = Math.cos(angle) * 0.72;
    const tangentZ = -Math.sin(angle) * 0.72;
    const left = { x: center.x - tangentX, z: center.z - tangentZ };
    const right = { x: center.x + tangentX, z: center.z + tangentZ };
    slots.push(
      {
        id: `conversation-${pairIndex}-left`,
        kind: 'talk',
        destination: left,
        lookAt: right,
      },
      {
        id: `conversation-${pairIndex}-right`,
        kind: 'talk',
        destination: right,
        lookAt: left,
      },
    );
  }

  if (actorCount % 2 !== 0) {
    const angle = cycleAngle + Math.PI * 0.35;
    const direction = cycleIndex % 2 === 0 ? 1 : -1;
    const waypoints = [0, 0.22 * direction, 0.44 * direction].map((offset, index) =>
      radialPoint(chapel, angle + offset, 6.8 + index * 0.25)
    );
    slots.push({
      id: 'churchyard-circulation',
      kind: 'wander',
      destination: waypoints[waypoints.length - 1]!,
      waypoints,
      lookAt: { x: chapel.x, z: chapel.z },
    });
  }

  return slots;
}

function radialPoint(
  origin: Pick<BuildingState, 'x' | 'z'>,
  angle: number,
  radius: number,
): { x: number; z: number } {
  return {
    x: origin.x + Math.sin(angle) * radius,
    z: origin.z + Math.cos(angle) * radius,
  };
}
