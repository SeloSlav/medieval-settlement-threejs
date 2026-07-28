import type { BuildingState } from '../resources/types.ts';

export const PALISADED_REFUGE_RALLY_SLOT_COUNT = 32;

export type RefugeRallyPosition = {
  x: number;
  z: number;
  yaw: number;
};

/**
 * Outside and inside gate points follow the authored refuge mesh. Keeping the
 * last two steps explicit lets civilians enter through the open leaves even
 * though ordinary obstacle routing treats the fortification as one footprint.
 */
export function palisadedRefugeGateOutside(
  refuge: Pick<BuildingState, 'x' | 'z'>,
): RefugeRallyPosition {
  return {
    x: refuge.x,
    z: refuge.z + 6.8,
    yaw: Math.PI,
  };
}

export function palisadedRefugeGateInside(
  refuge: Pick<BuildingState, 'x' | 'z'>,
): RefugeRallyPosition {
  return {
    x: refuge.x,
    z: refuge.z + 4.45,
    yaw: Math.PI,
  };
}

/**
 * Thirty-two deterministic standing places fill the roofed and open portions
 * of the compact enclosure without rebuilding meshes or adding per-frame work.
 */
export function palisadedRefugeRallyPosition(
  refuge: Pick<BuildingState, 'x' | 'z'>,
  slotIndex: number,
): RefugeRallyPosition {
  const slot = Math.max(
    0,
    Math.min(
      PALISADED_REFUGE_RALLY_SLOT_COUNT - 1,
      Math.floor(slotIndex),
    ),
  );
  const column = slot % 8;
  const row = Math.floor(slot / 8);
  return {
    x: refuge.x - 4.2 + column * 1.2,
    z: refuge.z - 2.75 + row * 1.72,
    yaw: row % 2 === 0 ? 0.08 : Math.PI - 0.08,
  };
}
