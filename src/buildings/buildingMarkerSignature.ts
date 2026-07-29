import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
} from '../generated/gameBalance.ts';
import type { BuildingState, LivestockHerdState } from '../resources/types.ts';
import { localCivicReceiptGold } from '../economy/civicReceipts.ts';
import { constructionVisualSignature } from './ConstructionSiteMesh.ts';
import {
  MARKET_RECEIPT_VISUAL_CAPACITY,
  MARKET_RECEIPT_VISUAL_SEGMENTS,
  MARKET_STAGING_VISUAL_SEGMENTS,
} from './meshes/marketplaceMesh.ts';
import {
  LOCAL_RECEIPT_VISUAL_CAPACITY,
  LOCAL_RECEIPT_VISUAL_SEGMENTS,
} from './meshes/expandedBuildingMeshes.ts';
import {
  GUARDHOUSE_PAYROLL_VISUAL_CAPACITY,
  GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS,
} from './meshes/civicLogisticsBuildingMeshes.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
  HAYLOFT_VISUAL_SEGMENTS,
  CLOTH_STOCKPILE_VISUAL_SEGMENTS,
  FLAX_STOCKPILE_VISUAL_SEGMENTS,
  stockpileVisualLevel,
  TIMBER_STOCKPILE_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
  SALVAGE_GOODS_VISUAL_CAPACITY,
  SALVAGE_GOODS_VISUAL_SEGMENTS,
  SALVAGE_STONE_VISUAL_CAPACITY,
  SALVAGE_STONE_VISUAL_SEGMENTS,
  SALVAGE_TIMBER_VISUAL_CAPACITY,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
} from './buildingStockpileVisuals.ts';
import { foodStockpileVisualSignature } from './foodStockpileVisuals.ts';
import { bulkStockpileVisualSignature } from './bulkStockpileVisuals.ts';
import { armoryStockpileVisualSignature } from './armoryStockpileVisuals.ts';
import { seasonalStockpileVisualSignature } from './seasonalStockpileVisuals.ts';
import { marketplaceSpecialtyStockpileVisualSignature } from './marketplaceSpecialtyStockpileVisuals.ts';
import { monasteryStockpileVisualSignature } from './monasteryStockpileVisuals.ts';

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
  issuedGuardPolearms?: ReadonlyMap<string, number>,
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
        + (building.barley ?? 0)
        + (building.malt ?? 0)
        + building.flour
        + building.ale
        + building.preservedFood
        + building.honey
        + building.wine
        + (building.ironwork ?? 0)
        + (building.polearms ?? 0)
        + (building.iron ?? 0)
        + (building.clay ?? 0)
        + (building.salt ?? 0)
        + (building.charcoal ?? 0)
        + (building.pottery ?? 0)
        + (building.manure ?? 0)
        + (building.wool ?? 0)
        + (building.flax ?? 0)
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
      const treasuryState = (
        building.kind === 'town_hall'
        || building.kind === 'chapel'
      )
        && building.constructionComplete !== false
        ? `:secured-gold:${building.gold > 1e-6 ? 1 : 0}`
        : '';
      const localReceiptState = (
        building.kind === 'monastery'
        || building.kind === 'ferry_landing'
      )
        && building.constructionComplete !== false
        ? `:local-gold:${stockpileVisualLevel(
          building.kind === 'monastery'
            ? building.gold
            : localCivicReceiptGold(building),
          LOCAL_RECEIPT_VISUAL_CAPACITY,
          LOCAL_RECEIPT_VISUAL_SEGMENTS,
        )}`
        : '';
      const storehouseState = building.kind === 'village_storehouse'
        && building.constructionComplete !== false
        ? `:storehouse:${
          stockpileVisualLevel(
            building.timber,
            BUILDING_STORAGE_CAPS.village_storehouse.timber,
            STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.stone,
            BUILDING_STORAGE_CAPS.village_storehouse.stone,
            STOREHOUSE_STONE_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.firewood,
            BUILDING_STORAGE_CAPS.village_storehouse.firewood,
            STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
          )
        }`
        : '';
      const guardhousePayrollState = building.kind === 'guardhouse'
        && building.constructionComplete !== false
        ? `:payroll:${stockpileVisualLevel(
          building.gold,
          GUARDHOUSE_PAYROLL_VISUAL_CAPACITY,
          GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS,
        )}`
        : '';
      const marketState = marketplaceVisualState(building);
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
      const flaxState = building.kind === 'weaver'
        && building.constructionComplete !== false
        ? `:flax:${stockpileVisualLevel(
          building.flax ?? 0,
          BUILDING_STORAGE_CAPS.weaver.flax ?? 0,
          FLAX_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const foodStockState = foodStockpileVisualSignature(building);
      const bulkStockState = bulkStockpileVisualSignature(building);
      const armoryStockState = armoryStockpileVisualSignature(
        building,
        issuedGuardPolearms?.get(building.id) ?? 0,
      );
      const seasonalStockState = seasonalStockpileVisualSignature(building);
      const marketplaceSpecialtyStockState =
        marketplaceSpecialtyStockpileVisualSignature(building);
      const monasteryStockState = monasteryStockpileVisualSignature(building);
      const structural = [
        building.id,
        building.x.toFixed(2),
        building.z.toFixed(2),
        buildingMeshSignature(building),
      ].join(':');
      return {
        id: building.id,
        visual: `${structural}${foundingState}${salvageState}${treasuryState}${localReceiptState}${guardhousePayrollState}${marketState}${timberState}${storehouseState}${hayState}${woolState}${flaxState}${clothState}${foodStockState}${bulkStockState}${armoryStockState}${seasonalStockState}${marketplaceSpecialtyStockState}${monasteryStockState}`,
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
  issuedGuardPolearms?: ReadonlyMap<string, number>,
): string {
  return buildingMarkerSignatures(
    buildings,
    livestockHerds,
    issuedGuardPolearms,
  ).visual;
}

function ratio(value: number, required: number): number {
  if (required <= 1e-6) return 1;
  return Math.min(1, Math.max(0, value / required));
}

function marketplaceVisualState(building: BuildingState): string {
  if (building.kind !== 'marketplace' || building.constructionComplete === false) {
    return '';
  }
  const cratedGoods = building.firewood
    + building.food
    + building.grain
    + (building.barley ?? 0)
    + (building.ironwork ?? 0);
  const cratedCapacity =
    BUILDING_STORAGE_CAPS.marketplace.firewood
    + BUILDING_STORAGE_CAPS.marketplace.food
    + BUILDING_STORAGE_CAPS.marketplace.grain
    + (BUILDING_STORAGE_CAPS.marketplace.barley ?? 0)
    + (BUILDING_STORAGE_CAPS.marketplace.ironwork ?? 0);
  return `:market:${
    stockpileVisualLevel(
      building.timber,
      BUILDING_STORAGE_CAPS.marketplace.timber,
      MARKET_STAGING_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.stone,
      BUILDING_STORAGE_CAPS.marketplace.stone,
      MARKET_STAGING_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      cratedGoods,
      cratedCapacity,
      MARKET_STAGING_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.gold,
      MARKET_RECEIPT_VISUAL_CAPACITY,
      MARKET_RECEIPT_VISUAL_SEGMENTS,
    )
  }`;
}
