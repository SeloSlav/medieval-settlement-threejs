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
  marketplacePendingTradeOffer,
  marketplaceTradeOfferCost,
  marketplaceTradeStagingPlan,
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
  MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
  MARKETPLACE_SEED_GRAIN_TARGETS,
  marketplaceSeedGrainProcurementPlan,
  nextMarketplaceStandingOrder,
  type MarketplaceStandingOrder,
} from '../../economy/marketplaceSeedPolicy.ts';
import type {
  MarketplaceSeedCoveragePlan,
} from '../../economy/marketplaceSeedCoverage.ts';
import type {
  MarketplaceTradeOffer,
  TradeResourceKind,
} from '../../generated/gameBalance.ts';
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
  seedCoverage?: MarketplaceSeedCoveragePlan,
  physicalEconomy = false,
  inboundBulkResources: ReadonlySet<TradeResourceKind> = new Set(),
): string {
  const sections = marketplaceTradeOffersBySection(conflictEnabled);
  const ironworkProcurement = marketplaceIronworkProcurementPlan(building);
  const seedGrainProcurement = marketplaceSeedGrainProcurementPlan(building);
  const nextStandingOrder = nextMarketplaceStandingOrder(building, conflictEnabled);
  const pendingOffer = marketplacePendingTradeOffer(building.marketplacePendingTradeCode);
  const nextTurnaround = manualTrade.nextCooldownSeconds == null
    ? 'Each broker shortens the trade desk turnaround.'
    : `Each broker shortens the trade desk turnaround; current regional road conditions make the next settlement ${manualTrade.nextCooldownSeconds.toFixed(1)}s.`;
  const renderOffer = (offer: (typeof sections.goldBuy)[number]) => {
    const affordable = canAffordMarketplaceTrade(availability, offer, marketState);
    const hasRoom = canReceiveMarketplaceTrade(building, offer);
    const staging = marketplaceTradeStagingPlan(
      building,
      offer,
      physicalEconomy,
      inboundBulkResources,
    );
    const enabled = manualTrade.ready && affordable && hasRoom && !staging.inbound;
    const disabled = enabled ? '' : ' disabled aria-disabled="true"';
    const priceTag =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? formatPriceMultiplier(priceMultiplierFor(marketState, offer.resource))
        : null;
    const marketHint =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? priceTag ?? 'Regional caravan rates'
        : 'Direct barter — no gold involved';
    const actionTitle = staging.requiresStaging && staging.resource
      ? `Order ${staging.missing.toFixed(0)} ${staging.resource} staged at this market`
      : describeMarketplaceTradeOfferForMarket(offer, marketState);
    const hint = manualTrade.reason
      ?? (!affordable
        ? 'Not enough market-accessible stock'
        : !hasRoom
          ? 'Marketplace storage lacks room for the full shipment'
          : staging.inbound && staging.resource
            ? `${staging.resource} staging cart inbound · order settles automatically`
            : staging.requiresStaging && staging.resource
              ? `${staging.localStock.toFixed(0)} / ${staging.required.toFixed(0)} at market · one order dispatches follow-up source carts`
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
          <span class="marketplace-trade-option__title">${actionTitle}</span>
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
      <p class="marketplace-trade-intro">${physicalEconomy
        ? 'Bulk exports settle only from goods physically staged at this market. One order dispatches visible source carts until its full lot arrives, then brokers settle it automatically at the prevailing regional rate. Sale proceeds remain in the visible market lockbox until a broker handcart delivers them to the civic treasury; only then are they spendable. Construction and household reserves remain protected.'
        : 'Legacy saves may export treasury stock and goods in road-linked building stores directly; household provisions remain protected.'} Ale, cloth, and any honey or wine left after enabled monastery hospitality must be hauled here and wait for broker capacity. Imports arrive at this market; farmsteads may collect seed grain by road, while construction carts and household caravans haul other orders onward.</p>
      <p class="marketplace-trade-depth">${manualTrade.label}. ${nextTurnaround}</p>
      ${pendingOffer
        ? renderPendingMarketplaceOrder(
            building,
            pendingOffer,
            marketState,
            manualTrade,
            physicalEconomy,
            inboundBulkResources,
          )
        : ''}
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
      ${renderSeedGrainProcurementPolicy(
        seedGrainProcurement,
        availability,
        marketState,
        manualTrade,
        nextStandingOrder,
        conflictEnabled,
        seedCoverage,
      )}
      ${conflictEnabled ? renderIronworkProcurementPolicy(
        ironworkProcurement,
        availability,
        marketState,
        manualTrade,
        nextStandingOrder,
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

function renderPendingMarketplaceOrder(
  building: BuildingState,
  offer: MarketplaceTradeOffer,
  marketState: RegionalMarketState,
  manualTrade: MarketplaceManualTradeStatus,
  physicalEconomy: boolean,
  inboundBulkResources: ReadonlySet<TradeResourceKind>,
): string {
  const staging = marketplaceTradeStagingPlan(
    building,
    offer,
    physicalEconomy,
    inboundBulkResources,
  );
  const progress = staging.required > 1e-6
    ? Math.max(0, Math.min(100, (staging.localStock / staging.required) * 100))
    : 100;
  let status: string;
  if (staging.missing <= 1e-6) {
    status = building.actionCooldown > 1e-6
      ? `Full lot staged · brokers settle automatically in about ${building.actionCooldown.toFixed(1)}s`
      : 'Full lot staged · automatic settlement queued at the current regional rate';
  } else if (staging.inbound && staging.resource) {
    status = `${staging.resource} cart inbound · ${staging.localStock.toFixed(0)} of ${staging.required.toFixed(0)} physically staged`;
  } else if (manualTrade.label !== 'Bulk order staging') {
    status = `${manualTrade.label} · ${staging.localStock.toFixed(0)} of ${staging.required.toFixed(0)} physically staged`;
  } else {
    status = `Awaiting a free road-linked ${staging.resource ?? 'supply'} cart · ${staging.localStock.toFixed(0)} of ${staging.required.toFixed(0)} staged`;
  }

  return `
    <section class="marketplace-trade-section marketplace-trade-section--pending" aria-label="Active bulk order">
      <h3 class="marketplace-trade-section__title">Active bulk order</h3>
      <p class="marketplace-trade-stock"><strong>${describeMarketplaceTradeOfferForMarket(offer, marketState)}</strong></p>
      <p class="marketplace-trade-depth">${status}</p>
      <p class="marketplace-trade-depth" role="progressbar" aria-label="Physical staging progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}">${Math.round(progress)}% staged · final gold value follows the rate when brokers settle</p>
      <button
        type="button"
        class="marketplace-trade-option"
        data-inspector-action="cancel-marketplace-trade-order"
        data-building-id="${building.id}"
      >
        <span class="marketplace-trade-option__title">Cancel bulk order</span>
        <span class="marketplace-trade-option__hint">Already-dispatched carts still unload here; staged goods remain physical market stock.</span>
      </button>
    </section>`;
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
  nextStandingOrder: MarketplaceStandingOrder,
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
  } else if (nextStandingOrder === 'seedGrain') {
    status = `Queued behind the more depleted seed-grain reserve; ${plan.ordersToTarget} ironwork lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
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
      <p class="resource-inspector-note">Standing stock target — this market buys one six-unit lot whenever its local ironwork falls far enough below target. Orders use the same broker queue as seed grain, treasury gold, and current regional rates; carpenters must still collect the fittings by road. When both orders are due, the more depleted target goes first.</p>
      <div class="resource-action-row">${MARKETPLACE_IRONWORK_TARGETS
        .map((target) => `<button type="button" class="resource-action-button" data-marketplace-ironwork-target="${target}" ${target === plan.target ? 'disabled' : ''}>${target === 0 ? 'Manual only' : `Keep ${target}`}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${status}</p>
    </section>`;
}

function renderSeedGrainProcurementPolicy(
  plan: ReturnType<typeof marketplaceSeedGrainProcurementPlan>,
  availability: MarketplaceTradeAvailability,
  marketState: RegionalMarketState,
  manualTrade: MarketplaceManualTradeStatus,
  nextStandingOrder: MarketplaceStandingOrder,
  conflictEnabled: boolean,
  coverage?: MarketplaceSeedCoveragePlan,
): string {
  const nextCost = marketplaceTradeOfferCost(
    MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
    marketState,
  ).amount;
  let status: string;
  if (plan.target <= 0) {
    status = 'Manual-only — brokers place no automatic seed-grain orders.';
  } else if (!plan.nextOrderDue) {
    status = `Holding ${plan.stock.toFixed(1)} / ${plan.target} grain; the next 24-unit lot waits until it fits without overshooting.`;
  } else if (nextStandingOrder === 'ironwork') {
    status = `Queued behind the more depleted frontier ironwork reserve; ${plan.ordersToTarget} seed lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
  } else if (availability.gold + 1e-6 < nextCost) {
    status = `Waiting for ${nextCost.toFixed(0)} treasury gold; ${plan.ordersToTarget} seed lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
  } else if (!manualTrade.ready) {
    status = `Waiting — ${manualTrade.label.toLowerCase()}.`;
  } else {
    status = `Next 24-unit seed lot ready for ${nextCost.toFixed(0)} gold; ${plan.ordersToTarget} lot${plan.ordersToTarget === 1 ? '' : 's'} remain at current stock.`;
  }

  const sharedQueue = conflictEnabled
    ? ' In frontier worlds, seed grain and ironwork share this broker queue; the more depleted selected target goes first.'
    : '';
  const coverageHtml = renderSeedCoverage(coverage);
  return `
    <section class="marketplace-trade-section" aria-label="Seed-grain procurement">
      <h3 class="marketplace-trade-section__title">Seed-grain procurement</h3>
      <p class="resource-inspector-note">Standing stock target — this market buys one 24-unit grain lot whenever its local stock falls far enough below target. Orders use broker time, treasury gold, and current regional rates.${sharedQueue} Imported grain remains reserved for road-linked, staffed farmsteads with uncovered field seed; each free market or granary serves the least-covered holding first, then the shorter road; mills and breweries continue drawing from holdings and granaries.</p>
      <div class="resource-action-row">${MARKETPLACE_SEED_GRAIN_TARGETS
        .map((target) => `<button type="button" class="resource-action-button" data-marketplace-seed-grain-target="${target}" ${target === plan.target ? 'disabled' : ''}>${target === 0 ? 'Manual only' : `Keep ${target}`}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${status}</p>
      ${coverageHtml}
    </section>`;
}

function renderSeedCoverage(coverage?: MarketplaceSeedCoveragePlan): string {
  if (!coverage) return '';
  if (coverage.connectedHoldings <= 0) {
    return '<p class="inspector-action-panel__hint">Reachable field demand — no active field seed claims on this market’s road branch.</p>';
  }
  const transit = coverage.inboundGrain > 0.05
    ? ` · ${coverage.inboundGrain.toFixed(1)} already inbound${coverage.marketOutboundGrain > 0.05 ? ` (${coverage.marketOutboundGrain.toFixed(1)} from this market)` : ''}`
    : '';
  const firstExposed = coverage.firstShortBuildingId == null
    ? ''
    : ` First exposed: ${coverage.firstShortfall.toFixed(1)} grain short <button type="button" class="inspector-jump-button" data-inspect-building="${coverage.firstShortBuildingId}" aria-label="Inspect first road-linked seed shortfall">Inspect holding</button>.`;
  const laborBlock = coverage.laborBlockedHoldings > 0
    ? ` ${coverage.laborBlockedShortfall.toFixed(1)} grain across ${coverage.laborBlockedHoldings} holding${coverage.laborBlockedHoldings === 1 ? '' : 's'} cannot move until farm labor is assigned.`
    : '';
  const fireBlock = coverage.fireBlockedHoldings > 0
    ? ` ${coverage.fireBlockedShortfall.toFixed(1)} grain is held behind ${coverage.fireBlockedHoldings} fire-disabled holding${coverage.fireBlockedHoldings === 1 ? '' : 's'}.`
    : '';
  const inboundBlock = coverage.inboundBlockedHoldings > 0
    ? ` ${coverage.inboundBlockedHoldings} holding${coverage.inboundBlockedHoldings === 1 ? '' : 's'} already ${coverage.inboundBlockedHoldings === 1 ? 'has' : 'have'} a grain cart inbound, so overlapping sources will not duplicate the haul.`
    : '';
  const nextCart = renderNextMarketplaceSeedCart(coverage);
  if (coverage.seedShortfall <= 0.05) {
    return `<p class="inspector-action-panel__hint">Reachable field demand — ${coverage.seedCovered.toFixed(1)} / ${coverage.seedRequired.toFixed(1)} grain covered across ${coverage.connectedHoldings} holding${coverage.connectedHoldings === 1 ? '' : 's'}${transit}. Current field plans need no additional market seed.</p>`;
  }
  const planned = coverage.plannedImportLots > 0
    ? `${coverage.plannedImportGrain.toFixed(0)} grain in ${coverage.plannedImportLots} currently due lot${coverage.plannedImportLots === 1 ? '' : 's'}`
    : 'no lot currently due';
  return `<p class="inspector-action-panel__hint">Reachable field demand — ${coverage.seedCovered.toFixed(1)} / ${coverage.seedRequired.toFixed(1)} grain covered${transit}; ${coverage.seedShortfall.toFixed(1)} remains short across ${coverage.shortHoldings} holding${coverage.shortHoldings === 1 ? '' : 's'}. This market holds ${coverage.currentMarketStock.toFixed(1)} and has ${planned}, enough to cover up to ${coverage.potentialCoverage.toFixed(1)} of the staffed shortfall${coverage.uncoveredDispatchableShortfall > 0.05 ? ` · ${coverage.uncoveredDispatchableShortfall.toFixed(1)} would remain` : ''}.${laborBlock}${fireBlock}${inboundBlock}${firstExposed} ${nextCart} Reachability is shared with other granaries or markets on the same road component.</p>`;
}

function renderNextMarketplaceSeedCart(
  coverage: MarketplaceSeedCoveragePlan,
): string {
  if (!coverage.sourceOperational) {
    return 'Next seed cart is blocked until this market is complete, staffed, and safe.';
  }
  if (coverage.sourceBusy) {
    return 'This market already has a cart away; seed priority is recalculated when it returns.';
  }
  if (coverage.nextDispatchBuildingId === null) {
    return coverage.inboundBlockedHoldings > 0
      ? 'No duplicate seed cart launches while the exposed staffed holdings wait for inbound grain.'
      : 'No staffed, safe, road-reachable holding is currently eligible for another seed cart.';
  }
  const distance = coverage.nextDispatchDistance === null
    ? ''
    : ` over ${coverage.nextDispatchDistance.toFixed(0)} m of road`;
  const inspect = `<button type="button" class="inspector-jump-button" data-inspect-building="${coverage.nextDispatchBuildingId}" aria-label="Inspect next seed-cart holding">Inspect next holding</button>`;
  if (coverage.nextDispatchAmount <= 0.05) {
    return `Next eligible destination once physical seed is available: ${coverage.nextDispatchStock.toFixed(1)} / ${coverage.nextDispatchRequired.toFixed(1)} onsite${distance}. ${inspect}`;
  }
  return `Next seed cart: ${coverage.nextDispatchAmount.toFixed(1)} grain to the least-covered eligible holding (${coverage.nextDispatchStock.toFixed(1)} / ${coverage.nextDispatchRequired.toFixed(1)} onsite)${distance}. ${inspect}`;
}
