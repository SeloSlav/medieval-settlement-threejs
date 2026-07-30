import * as THREE from 'three';
import {
  BUILDING_STORAGE_CAPS,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
} from '../generated/gameBalance.ts';
import {
  CLAY_BANK_STRATA_VISUAL_SEGMENTS,
  clayBankSiteYieldAt,
  clayBankStrataVisualLevel,
} from '../economy/clayBankPolicy.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS = 4;
export const STONE_QUARRY_STONE_VISUAL_SEGMENTS = 3;
export const LARGE_QUARRY_STONE_VISUAL_SEGMENTS = 4;
export const LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS = 6;
export const LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY =
  LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS
  * LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE;
export const MINE_IRON_VISUAL_SEGMENTS = 6;
export const MINE_SALT_VISUAL_SEGMENTS = 6;
export const MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS = 4;
export const MINE_SUPPORT_TIMBER_VISUAL_CAPACITY =
  MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS * MINE_TIMBER_SUPPORT_PER_CYCLE;
export const CLAY_PIT_CLAY_VISUAL_SEGMENTS = 5;
export const CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS = 3;
export const CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS = 5;
export const SMITHY_IRON_VISUAL_SEGMENTS = 4;
export const SMITHY_CHARCOAL_VISUAL_SEGMENTS = 3;
export const SMITHY_IRONWORK_VISUAL_SEGMENTS = 4;
export const SMITHY_WATER_VISUAL_SEGMENTS = 3;
export const POTTER_CLAY_VISUAL_SEGMENTS = 5;
export const POTTER_FIREWOOD_VISUAL_SEGMENTS = 3;
export const POTTER_POTTERY_VISUAL_SEGMENTS = 5;
export const POTTER_ROOF_TILE_VISUAL_SEGMENTS = 5;
export const POTTER_WATER_VISUAL_SEGMENTS = 3;
export const CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS = 4;

export function bulkStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'lumber_mill':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.lumber_mill.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'woodcutters_lodge':
      return `:bulk-store:${stockpileVisualLevel(
        building.firewood,
        BUILDING_STORAGE_CAPS.woodcutters_lodge.firewood,
        WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.woodcutters_lodge.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'stone_quarry':
      return `:bulk-store:${stockpileVisualLevel(
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
        STONE_QUARRY_STONE_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'large_quarry':
      return `:bulk-store:${stockpileVisualLevel(
        building.stone,
        BUILDING_STORAGE_CAPS.large_quarry.stone,
        LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.large_quarry.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}:supports:${stockpileVisualLevel(
        building.timber,
        LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY,
        LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS,
      )}`;
    case 'mine':
      return `:bulk-store:${stockpileVisualLevel(
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.mine.iron,
        MINE_IRON_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.mine.salt,
        MINE_SALT_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.mine.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}:supports:${stockpileVisualLevel(
        building.timber,
        MINE_SUPPORT_TIMBER_VISUAL_CAPACITY,
        MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS,
      )}`;
    case 'clay_pit':
      return `:bulk-store:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.clay_pit.clay,
        CLAY_PIT_CLAY_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.clay_pit.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}:bank:${clayBankStrataVisualLevel(
        clayBankSiteYieldAt(building.x, building.z),
      )}`;
    case 'threshing_barn':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'watermill':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.watermill.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'charcoal_burner':
      return `:bulk-store:${stockpileVisualLevel(
        building.firewood,
        BUILDING_STORAGE_CAPS.charcoal_burner.firewood,
        CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
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
        building.charcoal ?? 0,
        BUILDING_STORAGE_CAPS.smithy.charcoal,
        SMITHY_CHARCOAL_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.smithy.ironwork,
        SMITHY_IRONWORK_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.water,
        BUILDING_STORAGE_CAPS.smithy.water,
        SMITHY_WATER_VISUAL_SEGMENTS,
      )}`;
    case 'potter_kiln':
      return `:bulk-store:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.clay,
        POTTER_CLAY_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.firewood,
        BUILDING_STORAGE_CAPS.potter_kiln.firewood,
        POTTER_FIREWOOD_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
       building.pottery ?? 0,
       BUILDING_STORAGE_CAPS.potter_kiln.pottery,
       POTTER_POTTERY_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
       building.roofTiles ?? 0,
       BUILDING_STORAGE_CAPS.potter_kiln.roofTiles ?? 0,
       POTTER_ROOF_TILE_VISUAL_SEGMENTS,
      )}:${stockpileVisualLevel(
        building.water,
        BUILDING_STORAGE_CAPS.potter_kiln.water,
        POTTER_WATER_VISUAL_SEGMENTS,
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
    case 'lumber_mill':
      syncCivilianToolStockpile(marker, building);
      break;
    case 'woodcutters_lodge':
      syncNamedStockpile(
        marker,
        'WoodcuttersFirewoodStockpile',
        'WoodcuttersFirewoodSegment',
        building.firewood,
        BUILDING_STORAGE_CAPS.woodcutters_lodge.firewood,
      );
      syncCivilianToolStockpile(marker, building);
      break;
    case 'stone_quarry':
      syncNamedStockpile(
        marker,
        'StoneQuarryStockpile',
        'StoneQuarryStockSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
      );
      syncCivilianToolStockpile(marker, building);
      break;
    case 'large_quarry':
      syncNamedStockpile(
        marker,
        'LargeQuarryStockpile',
        'LargeQuarryStockSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.large_quarry.stone,
      );
      syncNamedStockpile(
        marker,
        'LargeQuarrySupportStockpile',
        'LargeQuarrySupportSegment',
        building.timber,
        LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY,
      );
      syncCivilianToolStockpile(marker, building);
      break;
    case 'mine':
      syncNamedStockpile(
        marker,
        'IronMineStockpile',
        'IronMineOreSegment',
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.mine.iron,
      );
      syncNamedStockpile(
        marker,
        'SaltMineStockpile',
        'SaltMineSaltSegment',
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.mine.salt,
      );
      syncNamedStockpile(
        marker,
        'MineSupportStockpile',
        'MineSupportTimberSegment',
        building.timber,
        MINE_SUPPORT_TIMBER_VISUAL_CAPACITY,
      );
      syncCivilianToolStockpile(marker, building);
      break;
    case 'clay_pit':
      syncNamedStockpile(
        marker,
        'ClayPitStockpile',
        'ClayPitClaySegment',
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.clay_pit.clay,
      );
      syncNamedStockpile(
        marker,
        'ClayBankStrata',
        'ClayBankStratum',
        clayBankStrataVisualLevel(clayBankSiteYieldAt(building.x, building.z)),
        CLAY_BANK_STRATA_VISUAL_SEGMENTS,
      );
      syncCivilianToolStockpile(marker, building);
      break;
    case 'threshing_barn':
      syncCivilianToolStockpile(marker, building);
      break;
    case 'watermill':
      syncCivilianToolStockpile(marker, building);
      break;
    case 'charcoal_burner':
      syncNamedStockpile(
        marker,
        'CharcoalBurnerFirewoodStockpile',
        'CharcoalBurnerFirewoodSegment',
        building.firewood,
        BUILDING_STORAGE_CAPS.charcoal_burner.firewood,
      );
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
        'SmithyCharcoalStockpile',
        'SmithyCharcoalSegment',
        building.charcoal ?? 0,
        BUILDING_STORAGE_CAPS.smithy.charcoal,
      );
      syncNamedStockpile(
        marker,
        'SmithyIronworkStockpile',
        'SmithyIronworkSegment',
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.smithy.ironwork,
      );
      syncNamedStockpile(
        marker,
        'SmithyQuenchWaterStockpile',
        'SmithyQuenchWaterSegment',
        building.water,
        BUILDING_STORAGE_CAPS.smithy.water,
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
        'PotterFirewoodStockpile',
        'PotterFirewoodSegment',
        building.firewood,
        BUILDING_STORAGE_CAPS.potter_kiln.firewood,
      );
      syncNamedStockpile(
        marker,
        'PotterPotteryStockpile',
        'PotterPotterySegment',
        building.pottery ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.pottery,
      );
      syncNamedStockpile(
        marker,
        'PotterRoofTileStockpile',
        'PotterRoofTileSegment',
        building.roofTiles ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.roofTiles ?? 0,
      );
      syncNamedStockpile(
        marker,
        'PotterPuddlingWaterStockpile',
        'PotterPuddlingWaterSegment',
        building.water,
        BUILDING_STORAGE_CAPS.potter_kiln.water,
      );
      break;
  }
}

function syncCivilianToolStockpile(
  marker: THREE.Group,
  building: BuildingState,
): void {
  syncNamedStockpile(
    marker,
    'CivilianToolStockpile',
    'CivilianToolSegment',
    building.ironwork ?? 0,
    (
      BUILDING_STORAGE_CAPS[building.kind] as {
        readonly ironwork?: number;
      }
    ).ironwork ?? 0,
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
