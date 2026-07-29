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
export const CLAY_PIT_CLAY_VISUAL_SEGMENTS = 5;
export const CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS = 5;
export const SMITHY_IRON_VISUAL_SEGMENTS = 4;
export const SMITHY_IRONWORK_VISUAL_SEGMENTS = 4;
export const POTTER_CLAY_VISUAL_SEGMENTS = 5;
export const POTTER_POTTERY_VISUAL_SEGMENTS = 5;

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
    case 'clay_pit':
      return `:bulk-store:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.clay_pit.clay,
        CLAY_PIT_CLAY_VISUAL_SEGMENTS,
      )}`;
    case 'charcoal_burner':
      return `:bulk-store:${stockpileVisualLevel(
        building.charcoal ?? 0,
        BUILDING_STORAGE_CAPS.charcoal_burner.charcoal,
        CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS,
      )}`;
    case 'smithy':
      return `:bulk-store:${stockpileVisualLevel(
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.smithy.iron,
        SMITHY_IRON_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.smithy.ironwork,
        SMITHY_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'potter_kiln':
      return `:bulk-store:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.clay,
        POTTER_CLAY_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.pottery ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.pottery,
        POTTER_POTTERY_VISUAL_SEGMENTS,
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
    case 'clay_pit':
      syncNamedStockpile(
        marker,
        'ClayPitStockpile',
        'ClayPitClaySegment',
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.clay_pit.clay,
      );
      break;
    case 'charcoal_burner':
      syncNamedStockpile(
        marker,
        'CharcoalBurnerStockpile',
        'CharcoalBurnerCharcoalSegment',
        building.charcoal ?? 0,
        BUILDING_STORAGE_CAPS.charcoal_burner.charcoal,
      );
      break;
    case 'smithy':
      syncNamedStockpile(
        marker,
        'SmithyIronStockpile',
        'SmithyIronSegment',
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.smithy.iron,
      );
      syncNamedStockpile(
        marker,
        'SmithyIronworkStockpile',
        'SmithyIronworkSegment',
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.smithy.ironwork,
      );
      break;
    case 'potter_kiln':
      syncNamedStockpile(
        marker,
        'PotterClayStockpile',
        'PotterClaySegment',
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.clay,
      );
      syncNamedStockpile(
        marker,
        'PotterPotteryStockpile',
        'PotterPotterySegment',
        building.pottery ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.pottery,
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
