import * as THREE from 'three';
import { edibleFoodStock } from '../economy/foodInventory.ts';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const MONASTERY_FOOD_VISUAL_SEGMENTS = 3;
export const MONASTERY_ALE_VISUAL_SEGMENTS = 3;
export const MONASTERY_CIDER_VISUAL_SEGMENTS = 3;
export const MONASTERY_HONEY_VISUAL_SEGMENTS = 3;
export const MONASTERY_WINE_VISUAL_SEGMENTS = 3;

function monasteryMealStock(building: BuildingState): number {
  return Math.max(0, edibleFoodStock(building) - Math.max(0, building.honey));
}

export function monasteryStockpileVisualSignature(
  building: BuildingState,
): string {
  if (building.kind !== 'monastery' || building.constructionComplete === false) {
    return '';
  }
  return `:monastery-pantry:${
    stockpileVisualLevel(
      monasteryMealStock(building),
      BUILDING_STORAGE_CAPS.monastery.food,
      MONASTERY_FOOD_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.cider ?? 0,
      BUILDING_STORAGE_CAPS.monastery.cider,
      MONASTERY_CIDER_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.ale,
      BUILDING_STORAGE_CAPS.monastery.ale,
      MONASTERY_ALE_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.honey,
      BUILDING_STORAGE_CAPS.monastery.honey,
      MONASTERY_HONEY_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.wine,
      BUILDING_STORAGE_CAPS.monastery.wine,
      MONASTERY_WINE_VISUAL_SEGMENTS,
    )
  }`;
}

export function syncMonasteryStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  if (building.kind !== 'monastery') return;
  syncNamedStockpile(
    marker,
    'MonasteryCiderStockpile',
    'MonasteryCiderSegment',
    building.cider ?? 0,
    BUILDING_STORAGE_CAPS.monastery.cider,
  );
  syncNamedStockpile(
    marker,
    'MonasteryFoodStockpile',
    'MonasteryFoodSegment',
    monasteryMealStock(building),
    BUILDING_STORAGE_CAPS.monastery.food,
  );
  syncNamedStockpile(
    marker,
    'MonasteryAleStockpile',
    'MonasteryAleSegment',
    building.ale,
    BUILDING_STORAGE_CAPS.monastery.ale,
  );
  syncNamedStockpile(
    marker,
    'MonasteryHoneyStockpile',
    'MonasteryHoneySegment',
    building.honey,
    BUILDING_STORAGE_CAPS.monastery.honey,
  );
  syncNamedStockpile(
    marker,
    'MonasteryWineStockpile',
    'MonasteryWineSegment',
    building.wine,
    BUILDING_STORAGE_CAPS.monastery.wine,
  );
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
