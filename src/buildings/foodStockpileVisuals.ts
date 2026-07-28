import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const BREWERY_GRAIN_VISUAL_SEGMENTS = 2;
export const BREWERY_ALE_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS = 3;
export const SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS = 2;
export const SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS = 3;
export const GRANARY_GRAIN_VISUAL_SEGMENTS = 3;
export const GRANARY_PROVISION_VISUAL_SEGMENTS = 3;
export const WATERMILL_GRAIN_VISUAL_SEGMENTS = 3;
export const WATERMILL_FLOUR_VISUAL_SEGMENTS = 3;

export function foodStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'brewery':
      return `:food-store:${
        stockpileVisualLevel(
          building.grain,
          BUILDING_STORAGE_CAPS.brewery.grain,
          BREWERY_GRAIN_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.ale,
          BUILDING_STORAGE_CAPS.brewery.ale,
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
          building.food,
          BUILDING_STORAGE_CAPS.smokehouse.food,
          SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.preservedFood,
          BUILDING_STORAGE_CAPS.smokehouse.preservedFood,
          SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS,
        )
      }`;
    case 'granary':
      return `:food-store:${
        stockpileVisualLevel(
          building.grain,
          BUILDING_STORAGE_CAPS.granary.grain,
          GRANARY_GRAIN_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          granaryProvisionStock(building),
          granaryProvisionCapacity(),
          GRANARY_PROVISION_VISUAL_SEGMENTS,
        )
      }`;
    case 'watermill':
      return `:food-store:${
        stockpileVisualLevel(
          building.grain,
          BUILDING_STORAGE_CAPS.watermill.grain,
          WATERMILL_GRAIN_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.flour,
          BUILDING_STORAGE_CAPS.watermill.flour,
          WATERMILL_FLOUR_VISUAL_SEGMENTS,
        )
      }`;
    default:
      return '';
  }
}

export function syncFoodStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  switch (building.kind) {
    case 'brewery':
      syncNamedStockpile(
        marker,
        'BreweryGrainStockpile',
        'BreweryGrainSegment',
        building.grain,
        BUILDING_STORAGE_CAPS.brewery.grain,
      );
      syncNamedStockpile(
        marker,
        'BreweryAleStockpile',
        'BreweryAleSegment',
        building.ale,
        BUILDING_STORAGE_CAPS.brewery.ale,
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
        building.food,
        BUILDING_STORAGE_CAPS.smokehouse.food,
      );
      syncNamedStockpile(
        marker,
        'SmokehousePreservedFoodStockpile',
        'SmokehousePreservedFoodSegment',
        building.preservedFood,
        BUILDING_STORAGE_CAPS.smokehouse.preservedFood,
      );
      break;
    case 'granary':
      syncNamedStockpile(
        marker,
        'GranaryGrainStockpile',
        'GranaryGrainSegment',
        building.grain,
        BUILDING_STORAGE_CAPS.granary.grain,
      );
      syncNamedStockpile(
        marker,
        'GranaryProvisionStockpile',
        'GranaryProvisionSegment',
        granaryProvisionStock(building),
        granaryProvisionCapacity(),
      );
      break;
    case 'watermill':
      syncNamedStockpile(
        marker,
        'WatermillGrainStockpile',
        'WatermillGrainSegment',
        building.grain,
        BUILDING_STORAGE_CAPS.watermill.grain,
      );
      syncNamedStockpile(
        marker,
        'WatermillFlourStockpile',
        'WatermillFlourSegment',
        building.flour,
        BUILDING_STORAGE_CAPS.watermill.flour,
      );
      break;
  }
}

function granaryProvisionStock(building: BuildingState): number {
  return building.food + building.flour + building.preservedFood;
}

function granaryProvisionCapacity(): number {
  return BUILDING_STORAGE_CAPS.granary.food
    + BUILDING_STORAGE_CAPS.granary.flour
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
