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

const STORED_RESOURCE_KINDS_BY_BUILDING: Partial<
  Record<BuildingKind, readonly ResourceKind[]>
> = Object.fromEntries(
  Object.entries(BUILDING_STORAGE_CAPS).map(([kind, rawCaps]) => {
    const caps = rawCaps as Record<string, number | undefined>;
    return [kind, RESOURCE_KINDS.filter((resource) => {
      const storageKey = storageKeyForResource(resource);
      return storageKey != null && (caps[storageKey] ?? 0) > 0;
    })];
  }),
);

export function buildingSharedStorageCapacity(kind: BuildingKind): number | null {
  const caps: StorageCaps = BUILDING_STORAGE_CAPS[kind];
  const capacity = caps.total;
  return Number.isFinite(capacity) && (capacity ?? 0) > 0
    ? Math.max(0, capacity as number)
    : null;
}

export function buildingStoredResourceTotal(building: BuildingInventory): number {
  const inventory = building as Partial<Record<ResourceKind, number>>;
  let total = 0;
  for (const kind of STORED_RESOURCE_KINDS_BY_BUILDING[building.kind] ?? []) {
    const value = inventory[kind];
    if (Number.isFinite(value) && (value ?? 0) > 0) {
      total += value as number;
    }
  }
  return total;
}

function storageKeyForResource(kind: ResourceKind): string | null {
  switch (kind) {
    // `game` is a world-node resource and gold uses dedicated chests or civic
    // coffers; neither consumes a building's working-goods capacity.
    case 'game':
    case 'gold':
      return null;
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
      return 'grain';
    case 'barleySheaves':
      return 'barley';
    case 'ryeFlour':
    case 'maslinFlour':
      return 'flour';
    case 'ryeBread':
    case 'maslinBread':
    case 'meat':
    case 'fish':
    case 'berries':
    case 'mushrooms':
    case 'milk':
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'aronia':
    case 'rosehips':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
      return 'food';
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'aroniaJam':
    case 'rosehipJam':
      return 'preservedFood';
    case 'pearCider':
      return 'cider';
    default:
      return kind;
  }
}

export function buildingSharedStorageRoom(building: BuildingInventory): number {
  const capacity = buildingSharedStorageCapacity(building.kind);
  return capacity == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, capacity - buildingStoredResourceTotal(building));
}
