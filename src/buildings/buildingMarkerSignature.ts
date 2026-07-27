import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
} from '../generated/gameBalance.ts';
import type { BuildingState, LivestockHerdState } from '../resources/types.ts';
import { constructionVisualSignature } from './ConstructionSiteMesh.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
  HAYLOFT_VISUAL_SEGMENTS,
  CLOTH_STOCKPILE_VISUAL_SEGMENTS,
  stockpileVisualLevel,
  TIMBER_STOCKPILE_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
  SALVAGE_GOODS_VISUAL_CAPACITY,
  SALVAGE_GOODS_VISUAL_SEGMENTS,
  SALVAGE_STONE_VISUAL_CAPACITY,
  SALVAGE_STONE_VISUAL_SEGMENTS,
  SALVAGE_TIMBER_VISUAL_CAPACITY,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
} from './buildingStockpileVisuals.ts';

export function buildingMeshSignature(building: BuildingState): string {
  if (building.constructionComplete !== false) {
    return `complete:${building.kind}`;
  }
  return constructionVisualSignature(
    building.constructionProgress,
    ratio(building.constructionDeliveredTimber, building.constructionRequiredTimber),
    ratio(building.constructionDeliveredStone, building.constructionRequiredStone),
  );
}

export function buildingMarkerSignatures(
  buildings: ReadonlyMap<string, BuildingState>,
  livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
): { visual: string; collider: string } {
  const entries = [...buildings.values()]
    .map((building) => {
      const foundingState = building.kind === 'founders_camp'
        && building.constructionComplete !== false
        ? `:founding:${building.foundingShelterActive !== false ? 1 : 0}:${
          stockpileVisualLevel(
            building.timber,
            BUILDING_STORAGE_CAPS.founders_camp.timber,
            FOUNDING_TIMBER_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.stone,
            BUILDING_STORAGE_CAPS.founders_camp.stone,
            FOUNDING_STONE_VISUAL_SEGMENTS,
          )
        }:${building.gold > 1e-6 ? 1 : 0}`
        : '';
      const timberState = building.kind === 'lumber_mill'
        && building.constructionComplete !== false
        ? `:timber:${stockpileVisualLevel(
          building.timber,
          BUILDING_STORAGE_CAPS.lumber_mill.timber,
          TIMBER_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const salvageGoods = building.firewood
        + building.water
        + building.food
        + building.grain
        + building.flour
        + building.ale
        + building.preservedFood
        + building.honey
        + building.wine
        + (building.ironwork ?? 0)
        + (building.polearms ?? 0)
        + (building.wool ?? 0)
        + (building.cloth ?? 0);
      const salvageState = building.kind === 'salvage_pile'
        && building.constructionComplete !== false
        ? `:salvage:${
          stockpileVisualLevel(
            building.timber,
            SALVAGE_TIMBER_VISUAL_CAPACITY,
            SALVAGE_TIMBER_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.stone,
            SALVAGE_STONE_VISUAL_CAPACITY,
            SALVAGE_STONE_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            salvageGoods,
            SALVAGE_GOODS_VISUAL_CAPACITY,
            SALVAGE_GOODS_VISUAL_SEGMENTS,
          )
        }:${building.gold > 1e-6 ? 1 : 0}`
        : '';
      const hayState = building.kind === 'pastoral_farmstead'
        && building.constructionComplete !== false
        ? `:hay:${stockpileVisualLevel(
          livestockHerds?.get(building.id)?.hayStock ?? 0,
          LIVESTOCK_HAY_STORAGE_CAPACITY,
          HAYLOFT_VISUAL_SEGMENTS,
        )}`
        : '';
      const woolState = (building.kind === 'pastoral_farmstead' || building.kind === 'weaver')
        && building.constructionComplete !== false
        ? `:wool:${stockpileVisualLevel(
          building.wool ?? 0,
          BUILDING_STORAGE_CAPS[building.kind].wool ?? 0,
          WOOL_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const clothState = building.kind === 'weaver'
        && building.constructionComplete !== false
        ? `:cloth:${stockpileVisualLevel(
          building.cloth ?? 0,
          BUILDING_STORAGE_CAPS.weaver.cloth ?? 0,
          CLOTH_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const structural = [
        building.id,
        building.x.toFixed(2),
        building.z.toFixed(2),
        buildingMeshSignature(building),
      ].join(':');
      return {
        id: building.id,
        visual: `${structural}${foundingState}${salvageState}${timberState}${hayState}${woolState}${clothState}`,
        collider: structural,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    visual: entries.map((entry) => entry.visual).join('|'),
    collider: entries.map((entry) => entry.collider).join('|'),
  };
}

export function buildingMarkerCollectionSignature(
  buildings: ReadonlyMap<string, BuildingState>,
  livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
): string {
  return buildingMarkerSignatures(buildings, livestockHerds).visual;
}

function ratio(value: number, required: number): number {
  if (required <= 1e-6) return 1;
  return Math.min(1, Math.max(0, value / required));
}
