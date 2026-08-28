import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
} from '../generated/gameBalance.ts';
import { edibleFoodStock } from '../economy/foodInventory.ts';
import { breadGrainStock, flourStock, grainSheafStock } from '../economy/cropGoods.ts';
import type { BuildingState, LivestockHerdState } from '../resources/types.ts';
import {
  constructionDeliveredRatio,
  constructionVisualSignature,
} from './ConstructionSiteMesh.ts';
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
  FOUNDING_IRONWORK_VISUAL_SEGMENTS,
  HAYLOFT_VISUAL_SEGMENTS,
  CLOTH_STOCKPILE_VISUAL_SEGMENTS,
  FLAX_STOCKPILE_VISUAL_SEGMENTS,
  LINEN_STOCKPILE_VISUAL_SEGMENTS,
  stockpileVisualLevel,
  TIMBER_STOCKPILE_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
  YARN_STOCKPILE_VISUAL_SEGMENTS,
  SALVAGE_GOODS_VISUAL_CAPACITY,
  SALVAGE_GOODS_VISUAL_SEGMENTS,
  SALVAGE_STONE_VISUAL_CAPACITY,
  SALVAGE_STONE_VISUAL_SEGMENTS,
  SALVAGE_TIMBER_VISUAL_CAPACITY,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
} from './buildingStockpileVisuals.ts';
import { foodStockpileVisualSignature } from './foodStockpileVisuals.ts';
import { bulkStockpileVisualSignature } from './bulkStockpileVisuals.ts';
import { armoryStockpileVisualSignature } from './armoryStockpileVisuals.ts';
import { seasonalStockpileVisualSignature } from './seasonalStockpileVisuals.ts';
import { marketplaceSpecialtyStockpileVisualSignature } from './marketplaceSpecialtyStockpileVisuals.ts';
import { monasteryStockpileVisualSignature } from './monasteryStockpileVisuals.ts';
import { buildingUsesCompletedMesh } from './buildingVisualState.ts';

export function buildingMeshSignature(building: BuildingState): string {
  if (buildingUsesCompletedMesh(building)) {
    const monasteryPlanting = building.kind === 'monastery'
      ? `:mixed-estate:maturity-${building.monasteryOrchardMaturity ?? 2}:extensions-${building.monasteryExtensions ?? 0}`
      : '';
    return `complete:${building.kind}${building.kind === 'chapel' || building.kind === 'monastery' ? `:tier-${building.chapelTier ?? (building.kind === 'monastery' ? 0 : 3)}` : ''}${monasteryPlanting}`;
  }
  return constructionVisualSignature(
    building.constructionProgress,
    constructionDeliveredRatio(
      building.constructionDeliveredTimber,
      building.constructionRequiredTimber,
    ),
    constructionDeliveredRatio(
      building.constructionDeliveredStone,
      building.constructionRequiredStone,
    ),
    constructionDeliveredRatio(
      building.constructionDeliveredIronwork ?? 0,
      building.constructionRequiredIronwork ?? 0,
    ),
    constructionDeliveredRatio(
      building.constructionDeliveredRoofTiles ?? 0,
      building.constructionRequiredRoofTiles ?? 0,
    ),
  );
}

export function buildingMarkerSignatures(
  buildings: ReadonlyMap<string, BuildingState>,
  livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
  issuedGuardPolearms?: ReadonlyMap<string, number>,
): { visual: string; collider: string } {
  const hayByBuilding = new Map<string, number>();
  const hayPasturesByBuilding = new Map<string, number>();
  for (const herd of livestockHerds?.values() ?? []) {
    hayByBuilding.set(
      herd.buildingId,
      (hayByBuilding.get(herd.buildingId) ?? 0) + Math.max(0, herd.hayStock),
    );
    if (herd.species !== 'swine') {
      hayPasturesByBuilding.set(
        herd.buildingId,
        (hayPasturesByBuilding.get(herd.buildingId) ?? 0) + 1,
      );
    }
  }
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
        }:${
          stockpileVisualLevel(
            building.ironwork ?? 0,
            BUILDING_STORAGE_CAPS.founders_camp.ironwork ?? 0,
            FOUNDING_IRONWORK_VISUAL_SEGMENTS,
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
        + edibleFoodStock(building)
        + breadGrainStock(building)
        + grainSheafStock(building)
        + (building.barley ?? 0)
        + (building.malt ?? 0)
        + flourStock(building)
        + building.ale
        + building.wine
        + (building.ironwork ?? 0)
        + (building.polearms ?? 0)
        + (building.iron ?? 0)
        + (building.clay ?? 0)
        + (building.salt ?? 0)
        + (building.charcoal ?? 0)
        + (building.pottery ?? 0)
        + (building.roofTiles ?? 0)
        + (building.manure ?? 0)
        + (building.remedies ?? 0)
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
      )
        && building.constructionComplete !== false
        ? `:local-gold:${stockpileVisualLevel(
          building.gold,
          LOCAL_RECEIPT_VISUAL_CAPACITY,
          LOCAL_RECEIPT_VISUAL_SEGMENTS,
        )}`
        : '';
      const depotStorageCaps = (
        building.kind === 'village_storehouse'
        || building.kind === 'trading_post'
      )
        ? BUILDING_STORAGE_CAPS[building.kind] as Partial<Record<
            'timber' | 'stone' | 'firewood' | 'iron' | 'clay' | 'salt',
            number
          >>
        : null;
      const storehouseState = (
        building.kind === 'village_storehouse'
        || building.kind === 'trading_post'
      )
        && building.constructionComplete !== false
        ? `:storehouse:${
          stockpileVisualLevel(
            building.timber,
            depotStorageCaps?.timber ?? 0,
            STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.stone,
            depotStorageCaps?.stone ?? 0,
            STOREHOUSE_STONE_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.firewood,
            depotStorageCaps?.firewood ?? 0,
            STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.iron ?? 0,
            depotStorageCaps?.iron ?? 0,
            STOREHOUSE_IRON_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.clay ?? 0,
            depotStorageCaps?.clay ?? 0,
            STOREHOUSE_CLAY_VISUAL_SEGMENTS,
          )
        }:${
          stockpileVisualLevel(
            building.salt ?? 0,
            depotStorageCaps?.salt ?? 0,
            STOREHOUSE_SALT_VISUAL_SEGMENTS,
          )
        }:${building.kind === 'trading_post'
          ? stockpileVisualLevel(
              building.gold,
              MARKET_RECEIPT_VISUAL_CAPACITY,
              MARKET_RECEIPT_VISUAL_SEGMENTS,
            )
          : 0}`
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
          hayByBuilding.get(building.id) ?? 0,
          LIVESTOCK_HAY_STORAGE_CAPACITY
            * Math.max(1, hayPasturesByBuilding.get(building.id) ?? 0),
          HAYLOFT_VISUAL_SEGMENTS,
        )}`
        : '';
      const textileCaps = building.kind === 'spinning_retting_house' || building.kind === 'weaver'
        ? BUILDING_STORAGE_CAPS[building.kind] as Partial<Record<
            'wool' | 'flax' | 'yarn' | 'linen' | 'cloth',
            number
          >>
        : null;
      const woolState = (building.kind === 'pastoral_farmstead' || building.kind === 'spinning_retting_house')
        && building.constructionComplete !== false
        ? `:wool:${stockpileVisualLevel(
          building.wool ?? 0,
          building.kind === 'pastoral_farmstead'
            ? BUILDING_STORAGE_CAPS.pastoral_farmstead.wool ?? 0
            : textileCaps?.wool ?? 0,
          WOOL_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const clothState = building.kind === 'weaver'
        && building.constructionComplete !== false
        ? `:cloth:${stockpileVisualLevel(
          building.cloth ?? 0,
          textileCaps?.cloth ?? 0,
          CLOTH_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const leatherChainState = (building.kind === 'tannery' || building.kind === 'cobbler')
        && building.constructionComplete !== false
        ? (() => {
            const caps = BUILDING_STORAGE_CAPS[building.kind] as Partial<Record<'hides' | 'leather' | 'shoes', number>>;
            return [
              `:hides:${stockpileVisualLevel(building.hides ?? 0, caps.hides ?? 0, 3)}`,
              `:leather:${stockpileVisualLevel(building.leather ?? 0, caps.leather ?? 0, 3)}`,
              `:shoes:${stockpileVisualLevel(building.shoes ?? 0, caps.shoes ?? 0, 3)}`,
            ].join('');
          })()
        : '';
      const chandleryState = building.kind === 'chandlery'
        && building.constructionComplete !== false
        ? [
            `:wax:${stockpileVisualLevel(building.wax ?? 0, BUILDING_STORAGE_CAPS.chandlery.wax ?? 0, 3)}`,
            `:candles:${stockpileVisualLevel(building.candles ?? 0, BUILDING_STORAGE_CAPS.chandlery.candles ?? 0, 3)}`,
          ].join('')
        : '';
      const flaxState = building.kind === 'spinning_retting_house'
        && building.constructionComplete !== false
        ? `:flax:${stockpileVisualLevel(
          building.flax ?? 0,
          textileCaps?.flax ?? 0,
          FLAX_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const yarnState = (building.kind === 'spinning_retting_house' || building.kind === 'weaver')
        && building.constructionComplete !== false
        ? `:yarn:${stockpileVisualLevel(
          building.yarn ?? 0,
          textileCaps?.yarn ?? 0,
          YARN_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const linenState = (building.kind === 'spinning_retting_house' || building.kind === 'weaver')
        && building.constructionComplete !== false
        ? `:linen:${stockpileVisualLevel(
          building.linen ?? 0,
          textileCaps?.linen ?? 0,
          LINEN_STOCKPILE_VISUAL_SEGMENTS,
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
        Number.isFinite(building.yaw) ? building.yaw!.toFixed(5) : 'legacy-yaw',
        buildingMeshSignature(building),
      ].join(':');
      return {
        id: building.id,
        visual: `${structural}${foundingState}${salvageState}${treasuryState}${localReceiptState}${guardhousePayrollState}${marketState}${timberState}${storehouseState}${hayState}${woolState}${flaxState}${yarnState}${linenState}${clothState}${leatherChainState}${chandleryState}${foodStockState}${bulkStockState}${armoryStockState}${seasonalStockState}${marketplaceSpecialtyStockState}${monasteryStockState}`,
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

function marketplaceVisualState(building: BuildingState): string {
  if (building.kind !== 'marketplace' || building.constructionComplete === false) {
    return '';
  }
  const cratedGoods = building.firewood
    + edibleFoodStock(building)
    + building.ale
    + (building.cloth ?? 0)
    + (building.pottery ?? 0);
  const cratedCapacity =
    BUILDING_STORAGE_CAPS.marketplace.firewood
    + BUILDING_STORAGE_CAPS.marketplace.food
    + BUILDING_STORAGE_CAPS.marketplace.preservedFood
    + BUILDING_STORAGE_CAPS.marketplace.ale
    + (BUILDING_STORAGE_CAPS.marketplace.cloth ?? 0)
    + (BUILDING_STORAGE_CAPS.marketplace.pottery ?? 0);
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
