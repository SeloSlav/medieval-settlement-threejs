import * as THREE from 'three';
import {
  freshFoodStock,
  preservedFoodStock,
} from '../economy/foodInventory.ts';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { breadGrainStock, breadStock, flourStock } from '../economy/cropGoods.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const BREWERY_BARLEY_VISUAL_SEGMENTS = 2;
export const BREWERY_MALT_VISUAL_SEGMENTS = 2;
export const BREWERY_ALE_VISUAL_SEGMENTS = 3;
export const HUNTERS_FOOD_VISUAL_SEGMENTS = 4;
export const FORAGERS_FOOD_VISUAL_SEGMENTS = 4;
export const FORAGERS_REMEDY_VISUAL_SEGMENTS = 4;
export const FISHING_FOOD_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS = 2;
export const SMOKEHOUSE_SALT_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS = 3;
export const GRANARY_GRAIN_VISUAL_SEGMENTS = 3;
export const GRANARY_PROVISION_VISUAL_SEGMENTS = 3;
export const WATERMILL_GRAIN_VISUAL_SEGMENTS = 3;
export const WATERMILL_FLOUR_VISUAL_SEGMENTS = 3;

function breweryBeverageStock(building: BuildingState): number {
  return building.ale
    + (building.cider ?? 0)
    + (building.pearCider ?? 0)
    + (building.mead ?? 0);
}

function breweryBeverageVisualCapacity(): number {
  return Math.max(
    BUILDING_STORAGE_CAPS.brewery.ale,
    BUILDING_STORAGE_CAPS.brewery.cider ?? 0,
    BUILDING_STORAGE_CAPS.brewery.mead ?? 0,
  );
}

export function foodStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'hunters_hall':
      return foodSupplierVisualSignature(
        (building.meat ?? 0) + building.food,
        BUILDING_STORAGE_CAPS.hunters_hall.food,
        HUNTERS_FOOD_VISUAL_SEGMENTS,
      );
    case 'foragers_shed':
      return `:food-store:${
        stockpileVisualLevel(
          building.food + (building.berries ?? 0) + (building.mushrooms ?? 0),
          BUILDING_STORAGE_CAPS.foragers_shed.food,
          FORAGERS_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.remedies ?? 0,
          BUILDING_STORAGE_CAPS.foragers_shed.remedies ?? 0,
          FORAGERS_REMEDY_VISUAL_SEGMENTS,
        )
      }`;
    case 'fishing_camp':
      return foodSupplierVisualSignature(
        (building.fish ?? 0) + building.food,
        BUILDING_STORAGE_CAPS.fishing_camp.food,
        FISHING_FOOD_VISUAL_SEGMENTS,
      );
    case 'brewery':
      return `:food-store:${
        stockpileVisualLevel(
          building.barley ?? 0,
          BUILDING_STORAGE_CAPS.brewery.barley,
          BREWERY_BARLEY_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.malt ?? 0,
          BUILDING_STORAGE_CAPS.brewery.malt,
          BREWERY_MALT_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          breweryBeverageStock(building),
          breweryBeverageVisualCapacity(),
          BREWERY_ALE_VISUAL_SEGMENTS,
        )
      }`;
    case 'smokehouse':
      return `:food-store:${
        stockpileVisualLevel(
          building.firewood,
          BUILDING_STORAGE_CAPS.smokehouse.firewood,
          SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          freshFoodStock(building),
          BUILDING_STORAGE_CAPS.smokehouse.food,
          SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.salt ?? 0,
          BUILDING_STORAGE_CAPS.smokehouse.salt,
          SMOKEHOUSE_SALT_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.pottery ?? 0,
          BUILDING_STORAGE_CAPS.smokehouse.pottery,
          SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          preservedFoodStock(building),
          BUILDING_STORAGE_CAPS.smokehouse.preservedFood,
          SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS,
        )
      }`;
    case 'granary':
      return `:food-store:${
        stockpileVisualLevel(
          breadGrainStock(building) + (building.barley ?? 0),
          BUILDING_STORAGE_CAPS.granary.grain + BUILDING_STORAGE_CAPS.granary.barley,
          GRANARY_GRAIN_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          granaryProvisionStock(building),
          granaryProvisionCapacity(),
          GRANARY_PROVISION_VISUAL_SEGMENTS,
        )
      }`;
    case 'bakery':
      return `:food-store:${
        stockpileVisualLevel(
          breadStock(building) + flourStock(building),
          BUILDING_STORAGE_CAPS.bakery.food + BUILDING_STORAGE_CAPS.bakery.flour,
          3,
        )
      }`;
    case 'watermill':
    case 'windmill': {
      const capacities = BUILDING_STORAGE_CAPS[building.kind];
      return `:food-store:${
        stockpileVisualLevel(
          breadGrainStock(building),
          capacities.grain,
          WATERMILL_GRAIN_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          flourStock(building),
          capacities.flour,
          WATERMILL_FLOUR_VISUAL_SEGMENTS,
        )
      }`;
    }
    default:
      return '';
  }
}

export function syncFoodStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  switch (building.kind) {
    case 'hunters_hall':
      syncNamedStockpile(
        marker,
        'HuntersFoodStockpile',
        'HuntersFoodSegment',
        (building.meat ?? 0) + building.food,
        BUILDING_STORAGE_CAPS.hunters_hall.food,
      );
      break;
    case 'foragers_shed':
      syncNamedStockpile(
        marker,
        'ForagersFoodStockpile',
        'ForagersFoodSegment',
        building.food + (building.berries ?? 0) + (building.mushrooms ?? 0),
        BUILDING_STORAGE_CAPS.foragers_shed.food,
      );
      syncNamedStockpile(
        marker,
        'ForagersRemedyStockpile',
        'ForagersRemedySegment',
        building.remedies ?? 0,
        BUILDING_STORAGE_CAPS.foragers_shed.remedies ?? 0,
      );
      break;
    case 'fishing_camp':
      syncNamedStockpile(
        marker,
        'FishingFoodStockpile',
        'FishingFoodSegment',
        (building.fish ?? 0) + building.food,
        BUILDING_STORAGE_CAPS.fishing_camp.food,
      );
      break;
    case 'brewery':
      syncNamedStockpile(
        marker,
        'BreweryBarleyStockpile',
        'BreweryBarleySegment',
        building.barley ?? 0,
        BUILDING_STORAGE_CAPS.brewery.barley,
      );
      syncNamedStockpile(
        marker,
        'BreweryMaltStockpile',
        'BreweryMaltSegment',
        building.malt ?? 0,
        BUILDING_STORAGE_CAPS.brewery.malt,
      );
      syncNamedStockpile(
        marker,
        'BreweryAleStockpile',
        'BreweryAleSegment',
        breweryBeverageStock(building),
        breweryBeverageVisualCapacity(),
      );
      break;
    case 'smokehouse':
      syncNamedStockpile(
        marker,
        'SmokehouseFirewoodStockpile',
        'SmokehouseFirewoodSegment',
        building.firewood,
        BUILDING_STORAGE_CAPS.smokehouse.firewood,
      );
      syncNamedStockpile(
        marker,
        'SmokehouseFreshFoodStockpile',
        'SmokehouseFreshFoodSegment',
        freshFoodStock(building),
        BUILDING_STORAGE_CAPS.smokehouse.food,
      );
      syncNamedStockpile(
        marker,
        'SmokehouseSaltStockpile',
        'SmokehouseSaltSegment',
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.smokehouse.salt,
      );
      syncNamedStockpile(
        marker,
        'SmokehousePotteryStockpile',
        'SmokehousePotterySegment',
        building.pottery ?? 0,
        BUILDING_STORAGE_CAPS.smokehouse.pottery,
      );
      syncNamedStockpile(
        marker,
        'SmokehousePreservedFoodStockpile',
        'SmokehousePreservedFoodSegment',
        preservedFoodStock(building),
        BUILDING_STORAGE_CAPS.smokehouse.preservedFood,
      );
      break;
    case 'granary':
      syncNamedStockpile(
        marker,
        'GranaryGrainStockpile',
        'GranaryGrainSegment',
        breadGrainStock(building) + (building.barley ?? 0),
        BUILDING_STORAGE_CAPS.granary.grain + BUILDING_STORAGE_CAPS.granary.barley,
      );
      syncNamedStockpile(
        marker,
        'GranaryProvisionStockpile',
        'GranaryProvisionSegment',
        granaryProvisionStock(building),
        granaryProvisionCapacity(),
      );
      break;
    case 'bakery':
      syncNamedStockpile(
        marker,
        'BakeryFoodStockpile',
        'BakeryFoodSegment',
        breadStock(building) + flourStock(building),
        BUILDING_STORAGE_CAPS.bakery.food + BUILDING_STORAGE_CAPS.bakery.flour,
      );
      break;
    case 'watermill':
    case 'windmill': {
      const capacities = BUILDING_STORAGE_CAPS[building.kind];
      syncNamedStockpile(
        marker,
        'WatermillGrainStockpile',
        'WatermillGrainSegment',
        breadGrainStock(building),
        capacities.grain,
      );
      syncNamedStockpile(
        marker,
        'WatermillFlourStockpile',
        'WatermillFlourSegment',
        flourStock(building),
        capacities.flour,
      );
      break;
    }
  }
}

function foodSupplierVisualSignature(
  amount: number,
  capacity: number,
  segments: number,
): string {
  return `:food-store:${stockpileVisualLevel(amount, capacity, segments)}`;
}

function granaryProvisionStock(building: BuildingState): number {
  return freshFoodStock(building)
    + flourStock(building)
    + (building.flax ?? 0)
    + preservedFoodStock(building);
}

function granaryProvisionCapacity(): number {
  return BUILDING_STORAGE_CAPS.granary.food
    + BUILDING_STORAGE_CAPS.granary.flour
    + BUILDING_STORAGE_CAPS.granary.flax
    + BUILDING_STORAGE_CAPS.granary.preservedFood;
}

function syncNamedStockpile(
  marker: THREE.Group,
  containerName: string,
  segmentName: string,
  amount: number,
  capacity: number,
): void {
  const stockpile = marker.getObjectByName(containerName);
  if (!(stockpile instanceof THREE.Group)) return;
  syncStockpileSegments(stockpile, segmentName, amount, capacity);
}
