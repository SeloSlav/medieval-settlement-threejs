import type { BuildingState } from '../resources/types.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorAssignment,
  type AmbientBehaviorSlot,
} from './ambientBehaviors.ts';
import {
  chapelClergyGatheringPoint,
  type ChapelMassPhase,
} from './chapelMass.ts';

export const CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS = 12;

/** Plans the visible assembly before mass and churchyard fellowship afterward. */
export function planChapelGatheringBehaviors(
  chapel: Pick<BuildingState, 'x' | 'z'> & Partial<Pick<BuildingState, 'yaw'>>,
  actorIds: readonly string[],
  cycleIndex: number,
  options: {
    clergyActorIds?: readonly string[];
    phase?: ChapelMassPhase;
  } = {},
): Map<string, AmbientBehaviorAssignment> {
  const phase = options.phase ?? 'assembly';
  if (phase === 'service') return new Map();
  const clergyIds = new Set(options.clergyActorIds ?? []);
  const layActorIds = actorIds.filter((actorId) => !clergyIds.has(actorId));
  const assignments = assignAmbientBehaviorSlots(
    layActorIds,
    chapelGatheringSlots(chapel, layActorIds.length, cycleIndex, phase),
    cycleIndex,
  );
  [...clergyIds].sort().forEach((actorId, index) => {
    const destination = chapelClergyGatheringPoint(chapel, index);
    assignments.set(actorId, {
      actorId,
      id: `clergy-${phase}-${index}`,
      kind: phase === 'assembly' ? 'talk' : 'idle',
      destination,
      lookAt: phase === 'assembly'
        ? chapelLocalPoint(chapel, 0, 13)
        : chapelLocalPoint(chapel, 0, 12.6),
    });
  });
  return assignments;
}

function chapelGatheringSlots(
  chapel: Pick<BuildingState, 'x' | 'z'> & Partial<Pick<BuildingState, 'yaw'>>,
  actorCount: number,
  cycleIndex: number,
  phase: Exclude<ChapelMassPhase, 'service'>,
): AmbientBehaviorSlot[] {
  if (actorCount <= 0) return [];

  const slots: AmbientBehaviorSlot[] = [];
  const pairCount = Math.floor(actorCount / 2);
  const cycleAngle = cycleIndex * 0.47;

  if (phase === 'assembly') {
    const leader = chapelClergyGatheringPoint(chapel);
    for (let index = 0; index < actorCount; index += 1) {
      const file = index % 7;
      const rank = Math.floor(index / 7);
      const localX = (file - 3) * 1.25 + (rank % 2) * 0.35;
      const localZ = 12.35 + rank * 1.22;
      const destination = chapelLocalPoint(chapel, localX, localZ);
      slots.push({
        id: `congregation-${index}`,
        kind: index % 6 === 5 ? 'wander' : 'talk',
        destination,
        lookAt: leader,
        waypoints: index % 6 === 5
          ? [
              chapelLocalPoint(chapel, localX - 0.6, localZ + 0.4),
              destination,
            ]
          : undefined,
      });
    }
    return slots;
  }

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const column = pairIndex % 4;
    const rank = Math.floor(pairIndex / 4);
    const centerX = (column - 1.5) * 2.6 + Math.sin(cycleAngle + pairIndex) * 0.28;
    const centerZ = 12.1 + rank * 2.15 + (column % 2) * 0.45;
    const left = chapelLocalPoint(chapel, centerX - 0.68, centerZ);
    const right = chapelLocalPoint(chapel, centerX + 0.68, centerZ);
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
    const direction = cycleIndex % 2 === 0 ? 1 : -1;
    const waypoints = [0, 1, 2].map((index) =>
      chapelLocalPoint(
        chapel,
        direction * (-3.6 + index * 1.35),
        14.6 + Math.sin(cycleAngle + index) * 0.35,
      )
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

function chapelLocalPoint(
  chapel: Pick<BuildingState, 'x' | 'z'> & Partial<Pick<BuildingState, 'yaw'>>,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const yaw = chapel.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: chapel.x + localX * cos + localZ * sin,
    z: chapel.z - localX * sin + localZ * cos,
  };
}
