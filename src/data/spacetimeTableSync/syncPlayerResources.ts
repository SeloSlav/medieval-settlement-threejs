import type { PlayerResources } from '../../generated/types.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { createEmptyStockpile } from '../../resources/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';

export function syncPlayerResources(rows: Iterable<PlayerResources>, state: GameTableSyncState): void {
  state.stockpile = createEmptyStockpile();
  state.economicActivityTaxRate = ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  state.parishPolicy = { ...DEFAULT_PARISH_POLICY };
  if (!state.identityHex) return;

  for (const row of rows) {
    if (row.owner.toHexString() !== state.identityHex) continue;
    state.stockpile = {
      timber: row.timber,
      stone: row.stone,
      firewood: row.firewood,
      water: row.water,
      gold: row.gold ?? 0,
      game: 0,
      berries: 0,
      food: row.food ?? 0,
    };
    state.economicActivityTaxRate = row.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
    state.parishPolicy = {
      autoSweepEnabled: row.chapelAutoSweepEnabled ?? DEFAULT_PARISH_POLICY.autoSweepEnabled,
      cofferReserveGold: row.chapelCofferReserveGold ?? DEFAULT_PARISH_POLICY.cofferReserveGold,
      manualCollectTotal: row.parishManualCollectTotal ?? 0,
      autoSweepTotal: row.parishAutoSweepTotal ?? 0,
      salaryPaidTotal: row.parishSalaryPaidTotal ?? 0,
      upkeepPaidTotal: row.parishUpkeepPaidTotal ?? 0,
      charityPaidTotal: row.parishCharityPaidTotal ?? 0,
    };
    break;
  }
}
