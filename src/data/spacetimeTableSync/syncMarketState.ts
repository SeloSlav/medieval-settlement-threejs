import type { MarketState } from '../../generated/types.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../../economy/regionalMarket.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';

export function syncMarketState(rows: Iterable<MarketState>, state: GameTableSyncState): void {
  state.marketState = { ...DEFAULT_REGIONAL_MARKET_STATE };
  if (!state.identityHex) return;

  for (const row of rows) {
    if (row.owner.toHexString() !== state.identityHex) continue;
    state.marketState = {
      timberPriceMult: row.timberPriceMult,
      stonePriceMult: row.stonePriceMult,
      firewoodPriceMult: row.firewoodPriceMult,
      foodPriceMult: row.foodPriceMult,
      specialtyPriceMult: row.specialtyPriceMult,
      regionalFoodDemand: row.regionalFoodDemand,
      regionalFoodSupply: row.regionalFoodSupply,
      regionalSpecialtyDemand: row.regionalSpecialtyDemand,
      bulletin: row.bulletin,
    };
    break;
  }
}

export function cloneMarketState(state: RegionalMarketState): RegionalMarketState {
  return { ...state };
}
