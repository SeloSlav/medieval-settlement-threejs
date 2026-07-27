import type { BuildingState } from './types.ts';

/** Chapel coffer balance; non-chapel buildings always read as zero. */
export function chapelCofferGold(building: BuildingState): number {
  return building.kind === 'chapel'
    ? Math.max(0, building.gold - Math.min(
        Math.max(0, building.chapelMonasteryTitheDue ?? 0),
        Math.max(0, building.gold),
      ))
    : 0;
}

export function totalChapelCofferGold(buildings: Iterable<BuildingState>): number {
  let total = 0;
  for (const building of buildings) {
    total += chapelCofferGold(building);
  }
  return total;
}
