import type { PointXZ } from '../utils/pathGeometry.ts';

export type AmbientBehaviorKind = 'idle' | 'wander' | 'sit' | 'rest' | 'talk';

/**
 * A reusable world-space activity slot. Systems provide their own meaningful
 * places (a bench, market stall, hearth, conversation pair, patrol loop) while
 * the shared planner rotates actors through them deterministically.
 */
export type AmbientBehaviorSlot = {
  id: string;
  kind: AmbientBehaviorKind;
  destination: PointXZ;
  /**
   * Identifies the physical seat reserved by a sitting/resting activity.
   * Seatless activities must omit this so planners can enforce real capacity.
   */
  seatId?: string;
  approach?: PointXZ;
  lookAt?: PointXZ;
  waypoints?: readonly PointXZ[];
  groundOffset?: number;
};

export type AmbientBehaviorAssignment = AmbientBehaviorSlot & {
  actorId: string;
};

/**
 * Assigns every actor to one slot and rotates the roster each cycle. Keeping
 * selection separate from movement/animation lets other crowds reuse the same
 * variation mechanism without depending on the villager renderer.
 */
export function assignAmbientBehaviorSlots(
  actorIds: readonly string[],
  slots: readonly AmbientBehaviorSlot[],
  cycleIndex: number,
): Map<string, AmbientBehaviorAssignment> {
  const assignments = new Map<string, AmbientBehaviorAssignment>();
  if (actorIds.length === 0 || slots.length === 0) return assignments;

  const rotation = positiveModulo(cycleIndex, actorIds.length);
  for (let slotIndex = 0; slotIndex < Math.min(actorIds.length, slots.length); slotIndex += 1) {
    const actorId = actorIds[(slotIndex + rotation) % actorIds.length]!;
    const slot = slots[slotIndex]!;
    assignments.set(actorId, {
      ...slot,
      actorId,
      destination: { ...slot.destination },
      approach: slot.approach ? { ...slot.approach } : undefined,
      lookAt: slot.lookAt ? { ...slot.lookAt } : undefined,
      waypoints: slot.waypoints?.map((point) => ({ ...point })),
    });
  }
  return assignments;
}

function positiveModulo(value: number, modulus: number): number {
  return ((Math.trunc(value) % modulus) + modulus) % modulus;
}
