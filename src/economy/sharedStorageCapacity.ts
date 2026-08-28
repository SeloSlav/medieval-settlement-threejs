import {
  BUILDING_STORAGE_CAPS,
  type BuildingKind,
  type StorageCaps,
} from '../generated/gameBalance.ts';
import {
  RESOURCE_KINDS,
  type BuildingState,
  type ResourceKind,
} from '../resources/types.ts';

type BuildingInventory = Pick<BuildingState, 'kind'>
  & Partial<Record<ResourceKind, number>>;

export function buildingSharedStorageCapacity(kind: BuildingKind): number | null {
  const caps: StorageCaps = BUILDING_STORAGE_CAPS[kind];
  const capacity = caps.total;
  return Number.isFinite(capacity) && (capacity ?? 0) > 0
    ? Math.max(0, capacity as number)
    : null;
}

export function buildingStoredResourceTotal(building: BuildingInventory): number {
  const inventory = building as Partial<Record<ResourceKind, number>>;
  return RESOURCE_KINDS.reduce((total, kind) => {
    const value = inventory[kind];
    return total + (Number.isFinite(value) && (value ?? 0) > 0
      ? Math.max(0, value as number)
      : 0);
  }, 0);
}

export function buildingSharedStorageRoom(building: BuildingInventory): number {
  const capacity = buildingSharedStorageCapacity(building.kind);
  return capacity == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, capacity - buildingStoredResourceTotal(building));
}
