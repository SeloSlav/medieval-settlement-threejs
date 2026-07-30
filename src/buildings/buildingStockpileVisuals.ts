import * as THREE from 'three';

export const TIMBER_STOCKPILE_VISUAL_SEGMENTS = 5;
export const STOREHOUSE_TIMBER_VISUAL_SEGMENTS = 5;
export const STOREHOUSE_STONE_VISUAL_SEGMENTS = 9;
export const STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS = 6;
export const STOREHOUSE_IRON_VISUAL_SEGMENTS = 4;
export const STOREHOUSE_CLAY_VISUAL_SEGMENTS = 4;
export const STOREHOUSE_SALT_VISUAL_SEGMENTS = 4;
export const FOUNDING_TIMBER_VISUAL_SEGMENTS = 8;
export const FOUNDING_STONE_VISUAL_SEGMENTS = 8;
export const SALVAGE_TIMBER_VISUAL_SEGMENTS = 6;
export const SALVAGE_STONE_VISUAL_SEGMENTS = 6;
export const SALVAGE_GOODS_VISUAL_SEGMENTS = 6;
export const SALVAGE_TIMBER_VISUAL_CAPACITY = 180;
export const SALVAGE_STONE_VISUAL_CAPACITY = 160;
export const SALVAGE_GOODS_VISUAL_CAPACITY = 140;
export const HAYLOFT_VISUAL_SEGMENTS = 8;
export const WOOL_STOCKPILE_VISUAL_SEGMENTS = 4;
export const PASTORAL_SALT_VISUAL_SEGMENTS = 3;
export const FLAX_STOCKPILE_VISUAL_SEGMENTS = 4;
export const CLOTH_STOCKPILE_VISUAL_SEGMENTS = 4;

export function stockpileVisualLevel(
  amount: number,
  capacity: number,
  segmentCount: number,
): number {
  if (
    !Number.isFinite(amount)
    || !Number.isFinite(capacity)
    || capacity <= 1e-9
    || segmentCount <= 0
  ) {
    return 0;
  }
  const fill = THREE.MathUtils.clamp(amount / capacity, 0, 1);
  return fill > 0
    ? Math.max(1, Math.ceil(fill * Math.floor(segmentCount)))
    : 0;
}

export function syncStockpileSegments(
  stockpile: THREE.Group,
  segmentName: string,
  amount: number,
  capacity: number,
): number {
  const segments = stockpile.children.filter((child) => child.name === segmentName);
  const visibleCount = stockpileVisualLevel(amount, capacity, segments.length);
  stockpile.visible = visibleCount > 0;
  segments.forEach((segment, index) => {
    segment.visible = index < visibleCount;
  });
  return visibleCount;
}
