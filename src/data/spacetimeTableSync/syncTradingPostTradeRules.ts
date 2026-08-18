import type { TradingPostTradeRule } from '../../generated/types.ts';
import {
  TRADE_COMMODITY_BY_CODE,
  type TradingPostTradeMode,
  type TradingPostTradeRuleState,
} from '../../economy/tradingPostTrade.ts';
import { buildingClientId } from '../spacetimeIds.ts';

export function syncTradingPostTradeRules(
  rows: Iterable<TradingPostTradeRule>,
  identityHex: string | null,
): Map<string, TradingPostTradeRuleState> {
  const rules = new Map<string, TradingPostTradeRuleState>();
  if (!identityHex) return rules;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const commodity = TRADE_COMMODITY_BY_CODE.get(row.commodityKind);
    if (!commodity) continue;
    const mode = (row.mode >= 0 && row.mode <= 2 ? row.mode : 0) as TradingPostTradeMode;
    const buildingId = buildingClientId(row.buildingId);
    rules.set(`${buildingId}:${row.commodityKind}`, {
      id: row.id,
      buildingId,
      commodityKind: row.commodityKind,
      commodity,
      mode,
      targetSurplus: row.targetSurplus,
      lastSettledMonth: Number(row.lastSettledMonth),
      lastTradeAmount: row.lastTradeAmount,
      lastTradeGold: row.lastTradeGold,
    });
  }
  return rules;
}
