import * as THREE from 'three';
import {
  BUILDING_STORAGE_CAPS,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS = 4;
export const PROCESSOR_FIREWOOD_VISUAL_SEGMENTS = 3;
export const STONE_QUARRY_STONE_VISUAL_SEGMENTS = 3;
export const MINING_PIT_IRON_VISUAL_SEGMENTS = 3;
export const MINING_PIT_SALT_VISUAL_SEGMENTS = 3;
export const MINING_PIT_CLAY_VISUAL_SEGMENTS = 3;
export const LARGE_QUARRY_STONE_VISUAL_SEGMENTS = 4;
export const LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS = 6;
export const LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY =
  LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS
  * LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE;
export const MINE_IRON_VISUAL_SEGMENTS = 6;
export const MINE_SALT_VISUAL_SEGMENTS = 6;
export const MINE_CLAY_VISUAL_SEGMENTS = 6;
export const MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS = 4;
export const MINE_SUPPORT_TIMBER_VISUAL_CAPACITY =
  MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS * MINE_TIMBER_SUPPORT_PER_CYCLE;
export const CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS = PROCESSOR_FIREWOOD_VISUAL_SEGMENTS;
export const CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS = 5;
export const SMITHY_IRON_VISUAL_SEGMENTS = 4;
export const SMITHY_CHARCOAL_VISUAL_SEGMENTS = 3;
export const SMITHY_IRONWORK_VISUAL_SEGMENTS = 4;
export const SMITHY_WATER_VISUAL_SEGMENTS = 3;
export const POTTER_CLAY_VISUAL_SEGMENTS = 5;
export const POTTER_FIREWOOD_VISUAL_SEGMENTS = PROCESSOR_FIREWOOD_VISUAL_SEGMENTS;
export const POTTER_POTTERY_VISUAL_SEGMENTS = 5;
export const POTTER_ROOF_TILE_VISUAL_SEGMENTS = 5;
export const POTTER_WATER_VISUAL_SEGMENTS = 3;
export const CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS = 4;

export type IndustrialFirewoodStockpileContract = Readonly<{
  containerName: string;
  segmentName: string;
  segmentCount: number;
}>;

/**
 * Coverage oracle for every workshop that produces, stores, or consumes
 * firewood. Mesh generators and runtime stock syncing share these exact IDs.
 */
export const INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS = Object.freeze({
  woodcutters_lodge: {
    containerName: 'WoodcuttersFirewoodStockpile',
    segmentName: 'WoodcuttersFirewoodSegment',
    segmentCount: WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
  },
  bakery: {
    containerName: 'BakeryFirewoodStockpile',
    segmentName: 'BakeryFirewoodSegment',
    segmentCount: PROCESSOR_FIREWOOD_VISUAL_SEGMENTS,
  },
  brewery: {
    containerName: 'BreweryFirewoodStockpile',
    segmentName: 'BreweryFirewoodSegment',
    segmentCount: PROCESSOR_FIREWOOD_VISUAL_SEGMENTS,
  },
  smokehouse: {
    containerName: 'SmokehouseFirewoodStockpile',
    segmentName: 'SmokehouseFirewoodSegment',
    segmentCount: PROCESSOR_FIREWOOD_VISUAL_SEGMENTS,
  },
  charcoal_burner: {
    containerName: 'CharcoalBurnerFirewoodStockpile',
    segmentName: 'CharcoalBurnerFirewoodSegment',
    segmentCount: CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  },
  potter_kiln: {
    containerName: 'PotterFirewoodStockpile',
    segmentName: 'PotterFirewoodSegment',
    segmentCount: POTTER_FIREWOOD_VISUAL_SEGMENTS,
  },
  tannery: {
    containerName: 'TanneryFirewoodStockpile',
    segmentName: 'TanneryFirewoodSegment',
    segmentCount: PROCESSOR_FIREWOOD_VISUAL_SEGMENTS,
  },
  chandlery: {
    containerName: 'ChandleryFirewoodStockpile',
    segmentName: 'ChandleryFirewoodSegment',
    segmentCount: PROCESSOR_FIREWOOD_VISUAL_SEGMENTS,
  },
} satisfies Partial<Record<BuildingKind, IndustrialFirewoodStockpileContract>>);

function industrialFirewoodContract(
  kind: BuildingKind,
): IndustrialFirewoodStockpileContract | undefined {
  return (INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS as Partial<
    Record<BuildingKind, IndustrialFirewoodStockpileContract>
  >)[kind];
}

function industrialFirewoodVisualSignature(building: BuildingState): string {
  const contract = industrialFirewoodContract(building.kind);
  if (!contract) return '';
  const capacity = BUILDING_STORAGE_CAPS[building.kind].firewood ?? 0;
  return `:firewood:${stockpileVisualLevel(
    building.firewood,
    capacity,
    contract.segmentCount,
  )}`;
}

export function bulkStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  const firewoodState = industrialFirewoodVisualSignature(building);
  if (building.kind === 'stone_mason') return `:mason:${stockpileVisualLevel(building.stone, 96, 8)}:${stockpileVisualLevel(building.dressedStone ?? 0, 64, 8)}`;
  switch (building.kind) {
    case 'lumber_mill':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.lumber_mill.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'woodcutters_lodge':
      return firewoodState;
    case 'stone_quarry':
      return `:bulk-store:${stockpileVisualLevel(
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
        STONE_QUARRY_STONE_VISUAL_SEGMENTS,
      )}:iron:${stockpileVisualLevel(
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.iron,
        MINING_PIT_IRON_VISUAL_SEGMENTS,
      )}:salt:${stockpileVisualLevel(
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.salt,
        MINING_PIT_SALT_VISUAL_SEGMENTS,
      )}:clay:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.clay,
        MINING_PIT_CLAY_VISUAL_SEGMENTS,
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
      )}:clay:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.mine.clay,
        MINE_CLAY_VISUAL_SEGMENTS,
      )}:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.mine.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}:supports:${stockpileVisualLevel(
        building.timber,
        MINE_SUPPORT_TIMBER_VISUAL_CAPACITY,
        MINE_SUPPORT_TIMBER_VISUAL_SEGMENTS,
      )}`;
    case 'threshing_barn':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.threshing_barn.ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'watermill':
    case 'windmill':
      return `:tools:${stockpileVisualLevel(
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS[building.kind].ironwork ?? 0,
        CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
      )}`;
    case 'charcoal_burner':
      return `${firewoodState}:bulk-store:${stockpileVisualLevel(
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
      return `${firewoodState}:bulk-store:${stockpileVisualLevel(
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.potter_kiln.clay,
        POTTER_CLAY_VISUAL_SEGMENTS,
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
      return firewoodState;
  }
}

export function syncBulkStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  if (building.kind === 'stone_mason') {
    const rawCount = stockpileVisualLevel(building.stone, 96, 8);
    const blockCount = stockpileVisualLevel(building.dressedStone ?? 0, 64, 8);
    for (let i = 0; i < 8; i++) {
      const raw = marker.getObjectByName('MasonRawStoneStock' + i);
      const block = marker.getObjectByName('MasonDressedStoneStock' + i);
      if (raw) raw.visible = i < rawCount;
      if (block) block.visible = i < blockCount;
    }
    return;
  }
  const firewoodContract = industrialFirewoodContract(building.kind);
  if (firewoodContract) {
    syncNamedStockpile(
      marker,
      firewoodContract.containerName,
      firewoodContract.segmentName,
      building.firewood,
      BUILDING_STORAGE_CAPS[building.kind].firewood ?? 0,
    );
  }
  switch (building.kind) {
    case 'lumber_mill':
      syncCivilianToolStockpile(marker, building);
      break;
    case 'woodcutters_lodge':
      break;
    case 'stone_quarry':
      syncNamedStockpile(
        marker,
        'StoneQuarryStockpile',
        'StoneQuarryStockSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.stone_quarry.stone,
      );
      syncNamedStockpile(
        marker,
        'MiningPitIronStockpile',
        'MiningPitIronSegment',
        building.iron ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.iron,
      );
      syncNamedStockpile(
        marker,
        'MiningPitSaltStockpile',
        'MiningPitSaltSegment',
        building.salt ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.salt,
      );
      syncNamedStockpile(
        marker,
        'MiningPitClayStockpile',
        'MiningPitClaySegment',
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.stone_quarry.clay,
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
        'ClayMineStockpile',
        'ClayMineClaySegment',
        building.clay ?? 0,
        BUILDING_STORAGE_CAPS.mine.clay,
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
    case 'threshing_barn':
      syncCivilianToolStockpile(marker, building);
      break;
    case 'watermill':
    case 'windmill':
      syncCivilianToolStockpile(marker, building);
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
