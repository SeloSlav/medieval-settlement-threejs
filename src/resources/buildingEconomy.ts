import type { BackyardGardenKind, BuildingKind } from '../generated/gameBalance.ts';
import type { ResourceTotals } from './resourceTotals.ts';
import {
  BACKYARD_GARDEN_COSTS,
  BACKYARD_GARDEN_DEFINITIONS,
  BUILDING_COSTS,
  GOLD_SALVAGE_FRACTION,
  IRONWORK_SALVAGE_FRACTION,
  RESIDENCE_STONE_COST,
  RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
  RESIDENCE_TIMBER_COST,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
  type BuildingResourceCost,
} from '../generated/gameBalance.ts';

export {
  RESIDENCE_STONE_COST,
  RESIDENCE_TIMBER_COST,
  STARTING_STONE,
  STARTING_TIMBER,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
  IRONWORK_SALVAGE_FRACTION,
  GOLD_SALVAGE_FRACTION,
} from '../generated/gameBalance.ts';

export type { BuildingResourceCost };

/** Planned cottage-scale residence footprint reference. */
export const ESTIMATED_COTTAGE_COST: BuildingResourceCost = {
  timber: RESIDENCE_TIMBER_COST,
  stone: RESIDENCE_STONE_COST,
};

export function residenceZoneCost(residenceCount: number): BuildingResourceCost {
  return {
    timber: RESIDENCE_TIMBER_COST * residenceCount,
    stone: RESIDENCE_STONE_COST * residenceCount,
  };
}

export function residenceZoneSalvageRefund(residenceCount: number): BuildingResourceCost {
  const cost = residenceZoneCost(residenceCount);
  return {
    timber: Math.round(cost.timber * TIMBER_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
    ironwork: Math.round((cost.ironwork ?? 0) * IRONWORK_SALVAGE_FRACTION),
    roofTiles: Math.round((cost.roofTiles ?? 0) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION),
    dressedStone: Math.round((cost.dressedStone ?? 0) * STONE_SALVAGE_FRACTION),
  };
}

export function getBuildingCost(kind: BuildingKind): BuildingResourceCost {
  return BUILDING_COSTS[kind];
}

export function buildingSalvageRefund(kind: BuildingKind): BuildingResourceCost {
  const cost = getBuildingCost(kind);
  return {
    timber: Math.round(cost.timber * TIMBER_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
    ironwork: Math.round((cost.ironwork ?? 0) * IRONWORK_SALVAGE_FRACTION),
    roofTiles: Math.round((cost.roofTiles ?? 0) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION),
    dressedStone: Math.round((cost.dressedStone ?? 0) * STONE_SALVAGE_FRACTION),
    gold: Math.round((cost.gold ?? 0) * GOLD_SALVAGE_FRACTION),
  };
}

export function canAffordBuilding(
  totals: Pick<ResourceTotals, 'timber' | 'stone' | 'ironwork' | 'roofTiles' | 'dressedStone' | 'gold'>,
  kind: BuildingKind,
): boolean {
  const cost = getBuildingCost(kind);
  return totals.timber >= cost.timber
    && totals.stone >= cost.stone
    && totals.ironwork >= (cost.ironwork ?? 0)
    && totals.roofTiles >= (cost.roofTiles ?? 0)
    && totals.dressedStone >= (cost.dressedStone ?? 0)
    && totals.gold >= (cost.gold ?? 0);
}

export function canAffordResidenceZone(
  totals: Pick<ResourceTotals, 'timber' | 'stone'>,
  residenceCount: number,
): boolean {
  const cost = residenceZoneCost(residenceCount);
  return totals.timber >= cost.timber && totals.stone >= cost.stone;
}

export function formatBuildingCost(cost: BuildingResourceCost): string {
  const parts: string[] = [];
  if (cost.timber > 0) parts.push(`${cost.timber} timber`);
  if (cost.stone > 0) parts.push(`${cost.stone} stone`);
  if ((cost.ironwork ?? 0) > 0) parts.push(`${cost.ironwork} ironwork`);
  if ((cost.roofTiles ?? 0) > 0) parts.push(`${cost.roofTiles} roof tiles`);
  if ((cost.dressedStone ?? 0) > 0) parts.push(`${cost.dressedStone} dressed stone`);
  if ((cost.gold ?? 0) > 0) parts.push(`${cost.gold} gold`);
  return parts.length > 0 ? parts.join(', ') : 'free';
}

export function getBackyardGardenCost(kind: BackyardGardenKind): BuildingResourceCost {
  return BACKYARD_GARDEN_COSTS[kind];
}

export function backyardGardenSalvageRefund(kind: BackyardGardenKind): BuildingResourceCost {
  const cost = getBackyardGardenCost(kind);
  return {
    timber: Math.round(cost.timber * TIMBER_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
  };
}

export function formatBackyardGardenCost(kind: BackyardGardenKind): string {
  return formatBuildingCost(getBackyardGardenCost(kind));
}

export function formatBackyardGardenSalvage(kind: BackyardGardenKind): string {
  return formatBuildingCost(backyardGardenSalvageRefund(kind));
}

export function canAffordBackyardGarden(
  totals: Pick<ResourceTotals, 'timber' | 'stone'>,
  kind: BackyardGardenKind,
): boolean {
  const cost = getBackyardGardenCost(kind);
  return totals.timber + 1e-6 >= cost.timber && totals.stone + 1e-6 >= cost.stone;
}

export function describeBackyardGardenShortfall(
  totals: Pick<ResourceTotals, 'timber' | 'stone'>,
  kind: BackyardGardenKind,
): string | null {
  const cost = getBackyardGardenCost(kind);
  const label = BACKYARD_GARDEN_DEFINITIONS[kind].label;
  const missing: string[] = [];
  if (totals.timber + 1e-6 < cost.timber) {
    missing.push(`${cost.timber} timber (you have ${Math.floor(totals.timber)})`);
  }
  if (totals.stone + 1e-6 < cost.stone) {
    missing.push(`${cost.stone} stone (you have ${Math.floor(totals.stone)})`);
  }
  if (missing.length === 0) return null;
  return `Not enough resources for ${label}: need ${missing.join(' and ')}.`;
}
