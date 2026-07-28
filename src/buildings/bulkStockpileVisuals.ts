import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS = 4;
export const STONE_QUARRY_STONE_VISUAL_SEGMENTS = 3;
export const LARGE_QUARRY_STONE_VISUAL_SEGMENTS = 4;

export function bulkStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'woodcutters_lodge':
      return `:bulk-store:${stockpileVisualLevel(
        building.firewood,
        BUILDING_STORAGE_CAPS.woodcutters_lodge.firewood,
        WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
      )}`;
    case 'stone_quarry':
      return `:bulk-store:${stockpileVisualLevel(
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
        STONE_QUARRY_STONE_VISUAL_SEGMENTS,
      )}`;
    case 'large_quarry':
      return `:bulk-store:${stockpileVisualLevel(
        building.stone,
        BUILDING_STORAGE_CAPS.large_quarry.stone,
        LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
      )}`;
    default:
      return '';
  }
}

export function syncBulkStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  switch (building.kind) {
    case 'woodcutters_lodge':
      syncNamedStockpile(
        marker,
        'WoodcuttersFirewoodStockpile',
        'WoodcuttersFirewoodSegment',
        building.firewood,
        BUILDING_STORAGE_CAPS.woodcutters_lodge.firewood,
      );
      break;
    case 'stone_quarry':
      syncNamedStockpile(
        marker,
        'StoneQuarryStockpile',
        'StoneQuarryStockSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
      );
      break;
    case 'large_quarry':
      syncNamedStockpile(
        marker,
        'LargeQuarryStockpile',
        'LargeQuarryStockSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.large_quarry.stone,
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
