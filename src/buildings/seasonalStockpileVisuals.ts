import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const THRESHING_GRAIN_VISUAL_SEGMENTS = 4;
export const THRESHING_FLAX_VISUAL_SEGMENTS = 4;
export const APIARY_FOOD_VISUAL_SEGMENTS = 2;
export const APIARY_HONEY_VISUAL_SEGMENTS = 3;
export const VINEYARD_FOOD_VISUAL_SEGMENTS = 2;
export const VINEYARD_WINE_VISUAL_SEGMENTS = 2;

export function seasonalStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'threshing_barn':
      return `:seasonal-store:${stockpileVisualLevel(
        building.grain + (building.barley ?? 0),
        BUILDING_STORAGE_CAPS.threshing_barn.grain
          + (BUILDING_STORAGE_CAPS.threshing_barn.barley ?? 0),
        THRESHING_GRAIN_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.flax ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.flax ?? 0,
        THRESHING_FLAX_VISUAL_SEGMENTS,
      )}`;
    case 'apiary':
      return `:seasonal-store:${
        stockpileVisualLevel(
          building.food,
          BUILDING_STORAGE_CAPS.apiary.food,
          APIARY_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.honey,
          BUILDING_STORAGE_CAPS.apiary.honey,
          APIARY_HONEY_VISUAL_SEGMENTS,
        )
      }`;
    case 'vineyard':
      return `:seasonal-store:${
        stockpileVisualLevel(
          building.food,
          BUILDING_STORAGE_CAPS.vineyard.food,
          VINEYARD_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.wine,
          BUILDING_STORAGE_CAPS.vineyard.wine,
          VINEYARD_WINE_VISUAL_SEGMENTS,
        )
      }`;
    default:
      return '';
  }
}

export function syncSeasonalStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  switch (building.kind) {
    case 'threshing_barn':
      syncNamedStockpile(
        marker,
        'ThreshingGrainStockpile',
        'ThreshingGrainSegment',
        building.grain + (building.barley ?? 0),
        BUILDING_STORAGE_CAPS.threshing_barn.grain
          + (BUILDING_STORAGE_CAPS.threshing_barn.barley ?? 0),
      );
      syncNamedStockpile(
        marker,
        'ThreshingFlaxStockpile',
        'ThreshingFlaxSegment',
        building.flax ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.flax ?? 0,
      );
      break;
    case 'apiary':
      syncNamedStockpile(
        marker,
        'ApiaryFoodStockpile',
        'ApiaryFoodSegment',
        building.food,
        BUILDING_STORAGE_CAPS.apiary.food,
      );
      syncNamedStockpile(
        marker,
        'ApiaryHoneyStockpile',
        'ApiaryHoneySegment',
        building.honey,
        BUILDING_STORAGE_CAPS.apiary.honey,
      );
      break;
    case 'vineyard':
      syncNamedStockpile(
        marker,
        'VineyardFoodStockpile',
        'VineyardFoodSegment',
        building.food,
        BUILDING_STORAGE_CAPS.vineyard.food,
      );
      syncNamedStockpile(
        marker,
        'VineyardWineStockpile',
        'VineyardWineSegment',
        building.wine,
        BUILDING_STORAGE_CAPS.vineyard.wine,
      );
      break;
  }
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
