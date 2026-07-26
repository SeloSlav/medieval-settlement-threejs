import type { BuildingState } from '../types.ts';
import {
  canAffordCommodityTrade,
  canAffordMarketplaceTrade,
  canAffordWaterCommodityTrade,
  canReceiveCommodityTrade,
  canReceiveMarketplaceTrade,
  canReceiveWaterCommodityTrade,
  describeCommodityOffer,
  describeMarketplaceTradeOfferForMarket,
  describeWaterCommodityOffer,
  formatTradeAvailabilitySummary,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
  marketplaceTradeOfferCost,
  marketplaceTradeOffersBySection,
} from '../../economy/marketplaceTrade.ts';
import type {
  MarketplaceManualTradeStatus,
  MarketplaceTradeAvailability,
} from '../../economy/marketplaceTrade.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import {
  formatMarketDepthHint,
  formatPriceMultiplier,
  formatRegionalRateSummary,
  priceMultiplierFor,
} from '../../economy/regionalMarket.ts';
import {
  MARKETPLACE_IRONWORK_IMPORT_OFFER,
  MARKETPLACE_IRONWORK_TARGETS,
  marketplaceIronworkProcurementPlan,
} from '../../economy/marketplaceIronworkPolicy.ts';
import {
  MARKETPLACE_SPECIALTY_EXPORT_POLICIES,
  marketplaceSpecialtyExportPlan,
  marketplaceSpecialtyQueue,
} from '../../economy/specialtyTrade.ts';

export function renderMarketplaceTradePanel(
  building: BuildingState,
  availability: MarketplaceTradeAvailability,
  marketState: RegionalMarketState,
  manualTrade: MarketplaceManualTradeStatus,
  conflictEnabled = false,
): string {
  const sections = marketplaceTradeOffersBySection(conflictEnabled);
  const ironworkProcurement = marketplaceIronworkProcurementPlan(building);
  const renderOffer = (offer: (typeof sections.goldBuy)[number]) => {
    const affordable = canAffordMarketplaceTrade(availability, offer, marketState);
    const hasRoom = canReceiveMarketplaceTrade(building, offer);
    const enabled = manualTrade.ready && affordable && hasRoom;
    const disabled = enabled ? '' : ' disabled aria-disabled="true"';
    const priceTag =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? formatPriceMultiplier(priceMultiplierFor(marketState, offer.resource))
        : null;
    const marketHint =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? priceTag ?? 'Regional caravan rates'
        : 'Direct barter — no gold involved';
    const hint = manualTrade.reason
      ?? (!affordable
        ? 'Not enough market-accessible stock'
        : !hasRoom
          ? 'Marketplace storage lacks room for the full shipment'
          : marketHint);
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option"
          data-inspector-action="marketplace-trade"
          data-trade-id="${offer.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeMarketplaceTradeOfferForMarket(offer, marketState)}</span>
          <span class="marketplace-trade-option__hint">${hint}</span>
        </button>
      </li>`;
  };

  const renderFoodCommodity = (commodity: (typeof MARKET_COMMODITIES)[number]) => {
    const affordable = canAffordCommodityTrade(availability, commodity, marketState);
    const hasRoom = canReceiveCommodityTrade(building, commodity);
    const enabled = manualTrade.ready && affordable && hasRoom;
    const disabled = enabled ? '' : ' disabled aria-disabled="true"';
    const priceTag = formatPriceMultiplier(marketState.foodPriceMult);
    const hint = manualTrade.reason
      ?? (!affordable
        ? 'Not enough treasury gold'
        : !hasRoom
          ? 'Marketplace needs room for the full order'
          : `${commodity.origin} · delivered to homes${priceTag ? ` · ${priceTag}` : ''}`);
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option marketplace-trade-option--provender"
          data-inspector-action="marketplace-trade"
          data-trade-id="${commodity.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeCommodityOffer(commodity, marketState)}</span>
          <span class="marketplace-trade-option__hint">${hint}</span>
        </button>
      </li>`;
  };

  const renderWaterCommodity = (commodity: (typeof MARKET_WATER_COMMODITIES)[number]) => {
    const affordable = canAffordWaterCommodityTrade(availability, commodity, marketState);
    const hasRoom = canReceiveWaterCommodityTrade(building, commodity);
    const enabled = manualTrade.ready && affordable && hasRoom;
    const disabled = enabled ? '' : ' disabled aria-disabled="true"';
    const priceTag = formatPriceMultiplier(marketState.firewoodPriceMult);
    const hint = manualTrade.reason
      ?? (!affordable
        ? 'Not enough treasury gold'
        : !hasRoom
          ? 'Marketplace needs room for the full order'
          : `${commodity.origin} · delivered to homes${priceTag ? ` · ${priceTag}` : ''}`);
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option marketplace-trade-option--water"
          data-inspector-action="marketplace-trade"
          data-trade-id="${commodity.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeWaterCommodityOffer(commodity, marketState)}</span>
          <span class="marketplace-trade-option__hint">${hint}</span>
        </button>
      </li>`;
  };

  return `
    <div class="marketplace-trade-panel">
      <p class="marketplace-trade-bulletin">${marketState.bulletin}</p>
      <p class="marketplace-trade-intro">Brokers export only treasury stock and goods in road-linked building stores; household provisions stay protected. Ale, cloth, and any honey or wine left after enabled monastery hospitality must be hauled here and wait for broker capacity. Imports arrive at this market; farmsteads may collect seed grain by road, while construction carts and household caravans haul other orders onward.</p>
      <p class="marketplace-trade-depth">${manualTrade.label}. Each broker shortens the trade desk turnaround.</p>
      <p class="marketplace-trade-rates" aria-label="Current regional rates">${formatRegionalRateSummary(marketState)}</p>
      <p class="marketplace-trade-depth">${formatMarketDepthHint()}</p>
      <p class="marketplace-trade-stock">${formatTradeAvailabilitySummary(availability)}</p>
      <section class="marketplace-trade-section" aria-label="Provender">
        <h3 class="marketplace-trade-section__title">Provender — regional market</h3>
        <ul class="marketplace-trade-list">${MARKET_COMMODITIES.map(renderFoodCommodity).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Water imports">
        <h3 class="marketplace-trade-section__title">Water imports</h3>
        <ul class="marketplace-trade-list">${MARKET_WATER_COMMODITIES.map(renderWaterCommodity).join('')}</ul>
      </section>
      ${conflictEnabled ? renderIronworkProcurementPolicy(
        ironworkProcurement,
        availability,
        marketState,
        manualTrade,
      ) : ''}
      ${renderSpecialtyExportPolicy(building, marketState)}
      <section class="marketplace-trade-section" aria-label="Buy with gold">
        <h3 class="marketplace-trade-section__title">Buy bulk goods</h3>
        <ul class="marketplace-trade-list">${sections.goldBuy.map(renderOffer).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Sell for gold">
        <h3 class="marketplace-trade-section__title">Sell for gold</h3>
        <ul class="marketplace-trade-list">${sections.goldSell.map(renderOffer).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Barter">
        <h3 class="marketplace-trade-section__title">Barter</h3>
        <ul class="marketplace-trade-list">${sections.barter.map(renderOffer).join('')}</ul>
      </section>
    </div>`;
}

function renderSpecialtyExportPolicy(
  building: BuildingState,
  marketState: RegionalMarketState,
): string {
  const plan = marketplaceSpecialtyExportPlan(building, marketState.specialtyPriceMult);
  const queue = marketplaceSpecialtyQueue(building, marketState.specialtyPriceMult);
  const currentRate = `${Math.round(plan.marketRate * 100)}%`;
  const rateShortfallPoints = Math.max(1, Math.ceil(plan.rateShortfall * 100 - 1e-6));
  let status: string;
  if (queue.units <= 1e-6) {
    status = `Regional rate ${currentRate} · awaiting hauled ale, honey, wine, or cloth.`;
  } else if (!plan.saleAllowed) {
    status = `Holding ${queue.units.toFixed(1)} units · current rate ${currentRate} is ${rateShortfallPoints} point${rateShortfallPoints === 1 ? '' : 's'} below this floor.`;
  } else {
    status = `${queue.units.toFixed(1)} units eligible at ${currentRate} · worth about ${queue.goldValue.toFixed(1)} gold if sold at the current rate.`;
  }

  return `
    <section class="marketplace-trade-section" aria-label="Specialty export policy">
      <h3 class="marketplace-trade-section__title">Specialty export policy</h3>
      <p class="resource-inspector-note">Ale, honey, wine, and cloth must arrive here by physical cart. Selling deepens regional supply and lowers the next rate; holding can recover price but may fill this market and back up its producer routes.</p>
      <div class="resource-action-row">${MARKETPLACE_SPECIALTY_EXPORT_POLICIES
        .map((policy) => `<button type="button" class="resource-action-button" data-marketplace-specialty-export-policy="${policy.value}" title="${policy.hint}" ${policy.value === plan.policy.value ? 'disabled' : ''}>${policy.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${status}</p>
    </section>`;
}

function renderIronworkProcurementPolicy(
  plan: ReturnType<typeof marketplaceIronworkProcurementPlan>,
  availability: MarketplaceTradeAvailability,
  marketState: RegionalMarketState,
  manualTrade: MarketplaceManualTradeStatus,
): string {
  const nextCost = marketplaceTradeOfferCost(
    MARKETPLACE_IRONWORK_IMPORT_OFFER,
    marketState,
  ).amount;
  let status: string;
  if (plan.target <= 0) {
    status = 'Manual-only — brokers place no automatic ironwork orders.';
  } else if (!plan.nextOrderDue) {
    status = `Holding ${plan.stock.toFixed(1)} / ${plan.target} ironwork; the next six-unit lot waits until it fits without overshooting.`;
  } else if (availability.gold + 1e-6 < nextCost) {
    status = `Waiting for ${nextCost.toFixed(0)} treasury gold; ${plan.ordersToTarget} lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
  } else if (!manualTrade.ready) {
    status = `Waiting — ${manualTrade.label.toLowerCase()}.`;
  } else {
    status = `Next six-unit lot ready for ${nextCost.toFixed(0)} gold; ${plan.ordersToTarget} lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
  }

  return `
    <section class="marketplace-trade-section" aria-label="Frontier ironwork procurement">
      <h3 class="marketplace-trade-section__title">Frontier ironwork procurement</h3>
      <p class="resource-inspector-note">Standing stock target — this market buys one six-unit lot whenever its local ironwork falls far enough below target. Orders use broker time, treasury gold, and current regional rates; carpenters must still collect the fittings by road.</p>
      <div class="resource-action-row">${MARKETPLACE_IRONWORK_TARGETS
        .map((target) => `<button type="button" class="resource-action-button" data-marketplace-ironwork-target="${target}" ${target === plan.target ? 'disabled' : ''}>${target === 0 ? 'Manual only' : `Keep ${target}`}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${status}</p>
    </section>`;
}
