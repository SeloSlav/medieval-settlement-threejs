import type { BuildingKind } from './types.ts';

export type BuildingResourceCost = {
  wood: number;
  stone: number;
};

/** Enough for one lumber mill + one stone quarry, plus reserve for early residences. */
export const STARTING_WOOD = 120;
export const STARTING_STONE = 140;

export const STONE_SALVAGE_FRACTION = 0.92;
export const WOOD_SALVAGE_FRACTION = 0.7;

/** Planned cottage-scale residence cost (not buildable yet). */
export const ESTIMATED_COTTAGE_COST: BuildingResourceCost = {
  wood: 50,
  stone: 80,
};

export const BUILDING_COSTS: Record<BuildingKind, BuildingResourceCost> = {
  lumber_mill: { wood: 45, stone: 15 },
  reforester: { wood: 35, stone: 10 },
  stone_quarry: { wood: 25, stone: 40 },
};

export function getBuildingCost(kind: BuildingKind): BuildingResourceCost {
  return BUILDING_COSTS[kind];
}

export function buildingSalvageRefund(kind: BuildingKind): BuildingResourceCost {
  const cost = getBuildingCost(kind);
  return {
    wood: Math.round(cost.wood * WOOD_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
  };
}

export function canAffordBuilding(
  stockpile: BuildingResourceCost,
  kind: BuildingKind,
): boolean {
  const cost = getBuildingCost(kind);
  return stockpile.wood >= cost.wood && stockpile.stone >= cost.stone;
}

export function formatBuildingCost(cost: BuildingResourceCost): string {
  return `${cost.wood} wood, ${cost.stone} stone`;
}
