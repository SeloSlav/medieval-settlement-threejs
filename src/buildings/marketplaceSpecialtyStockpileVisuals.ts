import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const MARKET_ALE_VISUAL_SEGMENTS = 3;
export const MARKET_HONEY_VISUAL_SEGMENTS = 3;
export const MARKET_WINE_VISUAL_SEGMENTS = 3;
export const MARKET_CLOTH_VISUAL_SEGMENTS = 3;
export const MARKET_IRON_VISUAL_SEGMENTS = 3;
export const MARKET_SALT_VISUAL_SEGMENTS = 3;
export const MARKET_POTTERY_VISUAL_SEGMENTS = 3;

export function marketplaceSpecialtyStockpileVisualSignature(
  building: BuildingState,
): string {
  if (building.kind !== 'marketplace' || building.constructionComplete === false) {
    return '';
  }
  return `:market-specialty:${
    stockpileVisualLevel(
      building.ale,
      BUILDING_STORAGE_CAPS.marketplace.ale,
      MARKET_ALE_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.honey,
      BUILDING_STORAGE_CAPS.marketplace.honey,
      MARKET_HONEY_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.wine,
      BUILDING_STORAGE_CAPS.marketplace.wine,
      MARKET_WINE_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.cloth ?? 0,
      BUILDING_STORAGE_CAPS.marketplace.cloth ?? 0,
      MARKET_CLOTH_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.iron ?? 0,
      BUILDING_STORAGE_CAPS.marketplace.iron ?? 0,
      MARKET_IRON_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.salt ?? 0,
      BUILDING_STORAGE_CAPS.marketplace.salt ?? 0,
      MARKET_SALT_VISUAL_SEGMENTS,
    )
  }:${
    stockpileVisualLevel(
      building.pottery ?? 0,
      BUILDING_STORAGE_CAPS.marketplace.pottery ?? 0,
      MARKET_POTTERY_VISUAL_SEGMENTS,
    )
  }`;
}

export function syncMarketplaceSpecialtyStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  if (building.kind !== 'marketplace') return;
  syncNamedStockpile(
    marker,
    'MarketAleStockpile',
    'MarketAleSegment',
    building.ale,
    BUILDING_STORAGE_CAPS.marketplace.ale,
  );
  syncNamedStockpile(
    marker,
    'MarketHoneyStockpile',
    'MarketHoneySegment',
    building.honey,
    BUILDING_STORAGE_CAPS.marketplace.honey,
  );
  syncNamedStockpile(
    marker,
    'MarketWineStockpile',
    'MarketWineSegment',
    building.wine,
    BUILDING_STORAGE_CAPS.marketplace.wine,
  );
  syncNamedStockpile(
    marker,
    'MarketClothStockpile',
    'MarketClothSegment',
    building.cloth ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.cloth ?? 0,
  );
  syncNamedStockpile(
    marker,
    'MarketIronStockpile',
    'MarketIronSegment',
    building.iron ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.iron ?? 0,
  );
  syncNamedStockpile(
    marker,
    'MarketSaltStockpile',
    'MarketSaltSegment',
    building.salt ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.salt ?? 0,
  );
  syncNamedStockpile(
    marker,
    'MarketPotteryStockpile',
    'MarketPotterySegment',
    building.pottery ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.pottery ?? 0,
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
