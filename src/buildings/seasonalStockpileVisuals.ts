import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  PASTORAL_SALT_VISUAL_SEGMENTS,
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';
import {
  MANURE_STOCKPILE_VISUAL_SEGMENTS,
  MANURE_STOCK_SEGMENT_NAME,
} from './meshes/manureStockpileMesh.ts';

export const THRESHING_GRAIN_VISUAL_SEGMENTS = 4;
export const THRESHING_FLAX_VISUAL_SEGMENTS = 4;
export const APIARY_HONEY_VISUAL_SEGMENTS = 3;
export const VINEYARD_GRAPE_VISUAL_SEGMENTS = 2;
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
      )}:${stockpileVisualLevel(
        building.manure ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.manure ?? 0,
        MANURE_STOCKPILE_VISUAL_SEGMENTS,
      )}`;
    case 'pastoral_farmstead':
      return `:pastoral-store:${stockpileVisualLevel(
        building.manure ?? 0,
        BUILDING_STORAGE_CAPS.pastoral_farmstead.manure ?? 0,
        MANURE_STOCKPILE_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.pastoral_farmstead.salt ?? 0,
        PASTORAL_SALT_VISUAL_SEGMENTS,
      )}`;
    case 'apiary':
      return `:seasonal-store:${
        stockpileVisualLevel(
          building.honey,
          BUILDING_STORAGE_CAPS.apiary.honey,
          APIARY_HONEY_VISUAL_SEGMENTS,
        )
      }`;
    case 'vineyard':
      return `:seasonal-store:${
        stockpileVisualLevel(
          building.grapes ?? 0,
          BUILDING_STORAGE_CAPS.vineyard.food,
          VINEYARD_GRAPE_VISUAL_SEGMENTS,
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
      syncNamedStockpile(
        marker,
        'ThreshingManureStockpile',
        MANURE_STOCK_SEGMENT_NAME,
        building.manure ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.manure ?? 0,
      );
      break;
    case 'pastoral_farmstead':
      syncNamedStockpile(
        marker,
        'PastoralManureStockpile',
        MANURE_STOCK_SEGMENT_NAME,
        building.manure ?? 0,
        BUILDING_STORAGE_CAPS.pastoral_farmstead.manure ?? 0,
      );
      syncNamedStockpile(
        marker,
        'PastoralSaltStockpile',
        'PastoralSaltSegment',
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.pastoral_farmstead.salt ?? 0,
      );
      break;
    case 'apiary':
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
        'VineyardGrapeStockpile',
        'VineyardGrapeSegment',
        building.grapes ?? 0,
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
