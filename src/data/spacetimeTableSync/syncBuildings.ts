import type { Building } from '../../generated/types.ts';
import { buildingClientId } from '../spacetimeIds.ts';
import type { BuildingState } from '../../resources/types.ts';
import { isBuildingKind } from '../../resources/types.ts';

export function syncBuildings(
  rows: Iterable<Building>,
  identityHex: string | null,
): Map<string, BuildingState> {
  const buildings = new Map<string, BuildingState>();
  if (!identityHex) return buildings;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    if (!isBuildingKind(row.kind)) continue;
    const id = buildingClientId(row.id);
    buildings.set(id, {
      id,
      kind: row.kind,
      x: row.x,
      z: row.z,
      workRadius: row.workRadius,
      actionCooldown: row.actionCooldown,
      timber: row.timber,
      firewood: row.firewood,
      stone: row.stone,
      water: row.water,
      food: row.food,
      gold: row.gold,
      waterCapacity: row.waterCapacity,
      assignedLabor: Number(row.assignedLabor),
    });
  }
  return buildings;
}
