import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import {
  buildingTradeStock,
  settlementTradeStock,
  tradingPostRule,
  tradingPostUnitPrices,
  TRADE_MODE_EXPORT,
  TRADE_MODE_IMPORT,
  TRADE_MODE_NONE,
  TRADE_RESOURCE_COMMODITY_CODES,
  TRADE_RESOURCE_LABELS,
  TRADING_POST_TRADE_CATEGORIES,
  type TradingPostTradeMode,
} from '../../economy/tradingPostTrade.ts';
import {
  CALENDAR_DAYS_PER_MONTH,
  STOREHOUSE_HAUL_PER_WORKER,
  type TradeResourceKind,
} from '../../generated/gameBalance.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import type { BuildingState, GameState } from '../types.ts';
import { renderInspectorResourceToken } from './inspectorResourceTokens.ts';

export function renderMarketplaceTradePanel(
  building: BuildingState,
  gameState: GameState,
  marketState: RegionalMarketState,
): string {
  const clock = gameClock(gameState.tick);
  const daysUntilSettlement = CALENDAR_DAYS_PER_MONTH - clock.monthDay + 1;
  const rules = gameState.tradingPostTradeRules;
  const activeRules = Array.from(rules?.values() ?? [])
    .filter((rule) => rule.buildingId === building.id && rule.mode !== TRADE_MODE_NONE);
  const stagedUnits = activeRules
    .filter((rule) => rule.mode === TRADE_MODE_EXPORT)
    .reduce((total, rule) => total + buildingTradeStock(building, rule.commodity), 0);
  const haulers = Math.max(0, Math.min(2, Math.floor(building.assignedLabor)));

  return `
    <div class="trading-post-ledger">
      <header class="trading-post-ledger__header">
        <div>
          <p class="trading-post-ledger__eyebrow">Monthly trade ledger</p>
          <h3>Import and export rules</h3>
        </div>
        <span class="trading-post-ledger__settlement">${daysUntilSettlement === 1
          ? 'Settlement today'
          : `${daysUntilSettlement} days to settlement`}</span>
      </header>
      <p class="trading-post-ledger__intro">Set one desired settlement surplus for every commodity. Export haulers continuously stage only stock above that floor in this Trading Post; all staged exports are sold at month end. Imports arrive directly into this store at month end and buy only enough to reach the floor, limited by storage and civic gold. The regional exchange is abstract—only local collection and distribution use visible haulers.</p>
      <div class="trading-post-ledger__summary">
        <span><strong>${activeRules.length}</strong> active rules</span>
        <span><strong>${Math.floor(stagedUnits)}</strong> export units staged</span>
        <span><strong>${haulers}/2</strong> cart haulers</span>
        <span><strong>${haulers * STOREHOUSE_HAUL_PER_WORKER}</strong> units per collection cart</span>
      </div>
      <div class="trading-post-ledger__scroll" data-trading-post-scroll>
        ${TRADING_POST_TRADE_CATEGORIES.map((category) => `
          <section class="trading-post-ledger__section">
            <h4>${category.label}</h4>
            <div class="trading-post-ledger__rows">
              ${category.resources.map((resource) => renderCommodityRow(
                building,
                gameState,
                marketState,
                resource,
              )).join('')}
            </div>
          </section>`).join('')}
      </div>
    </div>`;
}

function renderCommodityRow(
  building: BuildingState,
  gameState: GameState,
  marketState: RegionalMarketState,
  resource: TradeResourceKind,
): string {
  const rule = tradingPostRule(gameState.tradingPostTradeRules, building.id, resource);
  const mode = rule?.mode ?? TRADE_MODE_NONE;
  const target = Math.max(0, Math.round(rule?.targetSurplus ?? 0));
  const outsideStock = settlementTradeStock(gameState, resource, false);
  const postStock = buildingTradeStock(building, resource);
  const prices = tradingPostUnitPrices(resource, marketState);
  const lastResult = formatLastResult(rule?.lastTradeAmount ?? 0, rule?.lastTradeGold ?? 0);
  const status = mode === TRADE_MODE_EXPORT
    ? `Eligible: ${Math.max(0, Math.floor(outsideStock - target))} · Staged: ${Math.floor(postStock)}`
    : mode === TRADE_MODE_IMPORT
      ? `Monthly deficit: ${Math.max(0, Math.floor(target - outsideStock - postStock))}`
      : 'Trade mode: off';
  const resourceLabel = TRADE_RESOURCE_LABELS[resource];
  const hoverDetail = [
    `Settlement: ${Math.floor(outsideStock)}`,
    `Trading Post: ${Math.floor(postStock)}`,
    `Buy: ${formatGold(prices.importGold)}`,
    `Sell: ${formatGold(prices.exportGold)}`,
    status,
    lastResult,
  ].filter(Boolean).join(' · ');
  const resourceAnchor = renderInspectorResourceToken({
    kind: resource,
    amount: postStock,
    title: resourceLabel,
    detail: hoverDetail,
    amountLabel: 'Trading Post stock',
    showAmount: false,
    ariaLabel: `${resourceLabel}: ${hoverDetail}`,
    className: 'trading-post-ledger__resource-anchor',
  });
  return `
    <article class="trading-post-ledger__row${mode === TRADE_MODE_NONE ? '' : ' is-active'}"
      data-trade-rule-row data-trade-mode="${mode}">
      <div class="trading-post-ledger__commodity">
        ${resourceAnchor}
      </div>
      <div class="trading-post-ledger__modes" role="group" aria-label="${resourceLabel} trade mode">
        ${renderModeButton(resource, TRADE_MODE_NONE, mode, 'Off')}
        ${renderModeButton(resource, TRADE_MODE_IMPORT, mode, 'Import')}
        ${renderModeButton(resource, TRADE_MODE_EXPORT, mode, 'Export')}
      </div>
      <div class="trading-post-ledger__target">
        <span>Keep in settlement</span>
        <div class="trading-post-ledger__stepper">
          <button type="button" data-trade-surplus-delta="-1" aria-label="Reduce ${TRADE_RESOURCE_LABELS[resource]} kept in settlement">&#x2039;</button>
          <input type="number" min="0" max="9999" step="1" inputmode="numeric"
            value="${target}" data-trade-surplus-input
            data-commodity-kind="${TRADE_RESOURCE_COMMODITY_CODES[resource]}"
            aria-label="${TRADE_RESOURCE_LABELS[resource]} to keep in settlement">
          <button type="button" data-trade-surplus-delta="1" aria-label="Increase ${TRADE_RESOURCE_LABELS[resource]} kept in settlement">&#x203A;</button>
        </div>
      </div>
    </article>`;
}

function renderModeButton(
  resource: TradeResourceKind,
  value: TradingPostTradeMode,
  selected: TradingPostTradeMode,
  label: string,
): string {
  return `<button type="button" data-trade-rule-mode="${value}"
    data-commodity-kind="${TRADE_RESOURCE_COMMODITY_CODES[resource]}"
    class="${selected === value ? 'is-selected' : ''}"
    aria-pressed="${selected === value}">${label}</button>`;
}

function formatGold(value: number): string {
  if (value >= 10) return `${value.toFixed(1)}g`;
  return `${value.toFixed(2)}g`;
}

function formatLastResult(amount: number, gold: number): string {
  if (amount <= 1e-6) return '';
  return gold >= 0
    ? `last sold ${Math.floor(amount)} for ${gold.toFixed(1)}g`
    : `last bought ${Math.floor(amount)} for ${Math.abs(gold).toFixed(1)}g`;
}
