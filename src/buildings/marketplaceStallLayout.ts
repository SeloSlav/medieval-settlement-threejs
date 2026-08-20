import type { BuildingState } from '../resources/types.ts';
import type {
  MarketStallDisplayKind,
  MarketStallGroup,
  MarketStallNeed,
} from '../economy/marketStallAssignments.ts';

export const MARKETPLACE_STALL_WORKER_ANCHOR_NAME = 'MarketStallWorkerAnchor';
export const MARKETPLACE_STALL_DISPLAY_PREFIX = 'MarketStallDisplay:';

export const MARKETPLACE_STALL_X_POSITIONS = [-2.35, 0, 2.35] as const;

export const MARKETPLACE_STALL_DISPLAY_NEEDS = {
  food: ['food', 'preservedFood'],
  goods: ['firewood', 'cloth', 'pottery'],
} as const satisfies Readonly<Record<MarketStallGroup, readonly MarketStallNeed[]>>;

export const MARKETPLACE_STALL_DISPLAY_KINDS = {
  food: [
    'provisions',
    'bread',
    'meat',
    'fish',
    'foraged',
    'milk',
    'fruit',
    'vegetables',
    'eggs',
    'porridge',
    'honey',
    'preserves',
    'curedMeat',
    'smokedFish',
    'cheese',
  ],
  goods: ['firewood', 'charcoal', 'cloth', 'pottery'],
} as const satisfies Readonly<
  Record<MarketStallGroup, readonly MarketStallDisplayKind[]>
>;

export type MarketplaceStallLayout = {
  x: number;
  z: number;
  rotation: number;
};

export function marketplaceStallLayout(
  group: MarketStallGroup,
  slotIndex: number,
): MarketplaceStallLayout | null {
  const x = MARKETPLACE_STALL_X_POSITIONS[slotIndex];
  if (x === undefined) return null;
  return group === 'food'
    ? { x, z: -0.82, rotation: 0 }
    : { x, z: 1.02, rotation: Math.PI };
}

/**
 * Resolve the authored seller position behind a counter into world space.
 * The returned yaw faces the counter and center aisle, matching the otherwise
 * invisible anchor attached to the table mesh.
 */
export function marketplaceStallWorkerPosition(
  marketplace: Pick<BuildingState, 'x' | 'z'>,
  buildingYaw: number,
  group: MarketStallGroup,
  slotIndex: number,
): ({ x: number; z: number; yaw: number } | null) {
  const layout = marketplaceStallLayout(group, slotIndex);
  if (!layout) return null;

  const workerOffset = -0.86;
  const localX = layout.x + Math.sin(layout.rotation) * workerOffset;
  const localZ = layout.z + Math.cos(layout.rotation) * workerOffset;
  const world = marketplaceLocalToWorld(marketplace, buildingYaw, localX, localZ);
  return {
    ...world,
    yaw: normalizeAngle(buildingYaw + layout.rotation),
  };
}

/**
 * Two collision-safe waypoints lead from the road side of the open loggia to
 * the seller anchor. The middle bay shifts sideways to miss its timber post.
 */
export function marketplaceStallWorkerApproach(
  marketplace: Pick<BuildingState, 'x' | 'z'>,
  buildingYaw: number,
  group: MarketStallGroup,
  slotIndex: number,
): ({ outside: { x: number; z: number }; inside: { x: number; z: number } } | null) {
  const layout = marketplaceStallLayout(group, slotIndex);
  if (!layout) return null;
  const side = group === 'food' ? -1 : 1;
  const entranceX = slotIndex === 1 ? 0.74 : layout.x;
  return {
    outside: marketplaceLocalToWorld(
      marketplace,
      buildingYaw,
      entranceX,
      side * 3.38,
    ),
    inside: marketplaceLocalToWorld(
      marketplace,
      buildingYaw,
      entranceX,
      side * 2.28,
    ),
  };
}

export function marketStallDisplayName(displayKind: MarketStallDisplayKind): string {
  return `${MARKETPLACE_STALL_DISPLAY_PREFIX}${displayKind}`;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function marketplaceLocalToWorld(
  marketplace: Pick<BuildingState, 'x' | 'z'>,
  buildingYaw: number,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const sin = Math.sin(buildingYaw);
  const cos = Math.cos(buildingYaw);
  return {
    x: marketplace.x + localX * cos + localZ * sin,
    z: marketplace.z - localX * sin + localZ * cos,
  };
}
