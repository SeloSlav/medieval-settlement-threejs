import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { renderMarketplaceTradePanel } from './marketplaceTradeRenderer.ts';
import { formatMarketplaceCaravanCrew } from '../../economy/regionalMarket.ts';
import {
  describeMarketplaceTradeOfferForMarket,
  marketplaceManualTradeStatus,
  marketplacePendingTradeOffer,
  marketplaceTradeStagingPlan,
} from '../../economy/marketplaceTrade.ts';
import {
  formatMarketplaceSpecialtyQueue,
  marketplaceSpecialtyExportPlan,
  marketplaceSpecialtyQueue,
} from '../../economy/specialtyTrade.ts';
import { marketplaceSeedCoveragePlan } from '../../economy/marketplaceSeedCoverage.ts';
import {
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketBranch,
} from '../../economy/settlementHouseholdMarket.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  STOREHOUSE_HAUL_PER_WORKER,
  type TradeResourceKind,
} from '../../generated/gameBalance.ts';
import {
  buildingPreservedFoodStorageFactor,
  formatPreservedFoodLoss,
} from '../../economy/foodPreservation.ts';
import type { BuildingState } from '../types.ts';
import {
  marketplaceGoldReserveShortfall,
  marketplaceGoldReserveTarget,
  marketplaceGoldSweepSurplus,
} from '../../economy/marketplaceGoldReserve.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';

const BULK_TRADE_RESOURCES = new Set<TradeResourceKind>([
  'timber',
  'stone',
  'firewood',
  'food',
  'grain',
  'ironwork',
  'iron',
  'salt',
  'pottery',
]);

function formatLinkedHomeStatus(connectedHomes: number): string {
  if (connectedHomes <= 0) {
    return 'Caravans awaiting your orders';
  }
  return `Trading with ${connectedHomes} road-linked home${connectedHomes === 1 ? '' : 's'}`;
}

export function renderMarketplaceInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const availability = context.getTradeAvailability?.(building);
  if (!availability) {
    throw new Error('Marketplace inspector requires trade availability.');
  }
  const marketState = context.getMarketState?.();
  if (!marketState) {
    throw new Error('Marketplace inspector requires regional market state.');
  }

  const label = context.worldQueries.getBuildingLabel(building.kind);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    gameClock(context.gameState.tick),
  );
  const cost = getBuildingCost(building.kind);
  const connectedHomes = context.worldQueries.countRoadConnectedResidences(building, true);
  const labor = buildingLaborView(building, context.populationStats, context.worldQueries);
  const hasRoadAccess = context.worldQueries.hasRoadAccess(building.x, building.z);
  const roadSpeedMultiplier = context.worldQueries.getRoadConditionSpeedMultiplier();
  const marketFireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  ).has(building.id);
  const physicalEconomy = context.gameState.physicalFoundingSiteEnabled === true;
  const pendingOffer = marketplacePendingTradeOffer(building.marketplacePendingTradeCode);
  const potteryReservedForTrade = pendingOffer?.kind === 'goldSell'
    && pendingOffer.resource === 'pottery';
  const activeMarketTrip = Array.from(context.gameState.deliveryTrips.values())
    .find((trip) => trip.buildingId === building.id) ?? null;
  const activeMaterialTarget = activeMarketTrip?.destinationKind === 'building'
    && activeMarketTrip.targetBuildingId
    && (
      activeMarketTrip.cargoKind === 'iron'
      || activeMarketTrip.cargoKind === 'salt'
      || activeMarketTrip.cargoKind === 'pottery'
    )
    ? context.worldQueries.getBuilding(activeMarketTrip.targetBuildingId)
    : null;
  const nextMaterialDispatch = building.assignedLabor > 0
    && !marketFireDisabled
    && activeMarketTrip == null
    ? context.worldQueries.getNextMarketplaceMaterialDispatch(building)
    : null;
  const workshopInputCart = activeMaterialTarget && activeMarketTrip
    ? `${cargoKindLabel(activeMarketTrip.cargoKind)} to ${
        context.worldQueries.getBuildingLabel(activeMaterialTarget.kind)
      } · ${formatTripPhaseLabel(activeMarketTrip.phase)}`
    : nextMaterialDispatch
      ? `${cargoKindLabel(nextMaterialDispatch.commodity)} next to ${
          context.worldQueries.getBuildingLabel(nextMaterialDispatch.target.kind)
        } · ${staffingPriorityLabel(nextMaterialDispatch.workPriority)} priority · ${
          nextMaterialDispatch.runwayCycles.toFixed(1)
        } cycles onsite · ${formatDeliveryRoadDistance(nextMaterialDispatch.routeDistance)}`
      : (building.iron ?? 0) <= 1e-6
          && (building.salt ?? 0) <= 1e-6
          && (building.pottery ?? 0) <= 1e-6
        ? 'No iron, salt, or pottery onsite'
        : potteryReservedForTrade
            && (building.iron ?? 0) <= 1e-6
            && (building.salt ?? 0) <= 1e-6
          ? 'Pottery held for the active export order'
        : 'No staffed road-linked production site below its selected input buffer';
  const inboundCashTrip = Array.from(context.gameState.deliveryTrips.values())
    .find((trip) =>
      trip.targetBuildingId === building.id
      && trip.cargoKind === 'gold'
      && trip.phase !== 'inbound') ?? null;
  const treasurySeat = Array.from(context.gameState.buildings.values())
    .filter((candidate) =>
      candidate.id !== building.id
      && candidate.constructionComplete !== false
      && (
        candidate.kind === 'town_hall'
        || candidate.kind === 'founders_camp'
        || candidate.kind === 'salvage_pile'
      ))
    .sort((a, b) =>
      marketplaceTreasurySeatPriority(a) - marketplaceTreasurySeatPriority(b)
      || a.id.localeCompare(b.id))[0] ?? null;
  const proceedsCollection = formatMarketplaceProceedsCollection({
    physicalEconomy,
    market: building,
    activeTrip: activeMarketTrip,
    inboundCashTrip,
    marketFireDisabled,
    treasurySeat,
    treasurySeatLabel: treasurySeat
      ? context.worldQueries.getBuildingLabel(treasurySeat.kind)
      : null,
    treasuryRouteAvailable: treasurySeat != null
      && context.worldQueries.getRoadPathDistance(
        building.x,
        building.z,
        treasurySeat.x,
        treasurySeat.z,
      ) != null,
  });
  const inboundBulkResources = new Set<TradeResourceKind>();
  for (const trip of context.gameState.deliveryTrips.values()) {
    if (
      trip.targetBuildingId === building.id
      && trip.phase !== 'inbound'
      && BULK_TRADE_RESOURCES.has(trip.cargoKind as TradeResourceKind)
    ) {
      inboundBulkResources.add(trip.cargoKind as TradeResourceKind);
    }
  }
  const pendingStaging = pendingOffer
    ? marketplaceTradeStagingPlan(building, pendingOffer, physicalEconomy, inboundBulkResources)
    : null;
  const pendingOrderLabel = pendingOffer && pendingStaging
    ? `${describeMarketplaceTradeOfferForMarket(pendingOffer, marketState)} · ${pendingStaging.localStock.toFixed(0)} / ${pendingStaging.required.toFixed(0)} staged`
    : 'None';
  const manualTrade = marketplaceManualTradeStatus(
    building,
    hasRoadAccess,
    roadSpeedMultiplier,
    marketFireDisabled,
  );
  const brokerCount = Math.max(0, Math.floor(building.assignedLabor));
  const routeCondition = roadSpeedMultiplier < 0.999
    ? `${Math.round(roadSpeedMultiplier * 100)}% caravan pace`
    : 'Firm roads';
  const regionalRoute = marketFireDisabled
    ? 'Paused · repair fire damage before regional trade resumes'
    : brokerCount <= 0
      ? `${routeCondition} · assign a broker to open regional trade`
      : `${routeCondition} · next ${manualTrade.nextCooldownSeconds?.toFixed(1)}s settlement with ${brokerCount} ${brokerCount === 1 ? 'broker' : 'brokers'}`;
  const specialtyPlan = marketplaceSpecialtyExportPlan(
    building,
    marketState.specialtyPriceMult,
  );
  const specialtyQueue = marketplaceSpecialtyQueue(building, marketState.specialtyPriceMult);
  const specialtyQueueLabel = formatMarketplaceSpecialtyQueue(specialtyQueue);
  const specialtyExportActive = specialtyQueue.units > 1e-6
    && specialtyPlan.saleAllowed
    && hasRoadAccess
    && !marketFireDisabled
    && specialtyQueue.exportWorkers > 0;
  const specialtyExportHeld = specialtyQueue.units > 1e-6
    && !specialtyPlan.saleAllowed
    && !marketFireDisabled;
  const specialtyDesk = formatSpecialtyExportDesk(
    marketFireDisabled,
    hasRoadAccess,
    building.assignedLabor,
    building.actionCooldown,
    specialtyQueue,
    specialtyPlan,
  );
  const seedCoverage = marketplaceSeedCoveragePlan(
    building,
    context.gameState,
    (_market, farmstead) => context.worldQueries.getRoadPathDistance(
      building.x,
      building.z,
      farmstead.x,
      farmstead.z,
    ),
  );
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const householdMarketPlan = typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
    ? computeSettlementHouseholdMarketPlan({
        state: context.gameState,
        marketState,
        roadNetwork: context.worldQueries.getRoadNetworkSnapshot(),
        clock: gameClock(context.gameState.tick),
        sabbathObserved: parishPolicy.sabbathObservanceEnabled
          && settlementHasStaffedChapel(context.gameState),
      })
    : null;
  const householdBranch = householdMarketPlan?.branches.get(building.id) ?? null;
  const householdBranchLabel = householdMarketPlan == null
    ? 'Route projection unavailable'
    : formatHouseholdMarketBranch(householdBranch);
  const householdBranchBottleneck = householdBranch == null
    ? 'No assigned household orders'
    : householdBranch.blockedHomes <= 0
      ? 'No critical order blocked'
      : `${householdBranch.blockedHomes} critical orders blocked or waiting - ${householdBranch.cooldownHomes} cooling down`;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: marketFireDisabled
      ? manualTrade.label
      : pendingOffer
        ? `Staging bulk order · ${pendingStaging?.localStock.toFixed(0)} / ${pendingStaging?.required.toFixed(0)} at market`
      : specialtyExportActive
        ? `Brokering specialty exports at ${Math.round(specialtyPlan.marketRate * 100)}% - ${specialtyQueue.unitsPerSecond.toFixed(2)} units/s`
        : specialtyExportHeld
          ? `Holding specialty exports - regional rate ${Math.round(specialtyPlan.marketRate * 100)}%`
          : manualTrade.ready
            ? formatLinkedHomeStatus(connectedHomes)
            : manualTrade.label,
    statusState: !marketFireDisabled
      && (specialtyExportActive || (manualTrade.ready && connectedHomes > 0))
      ? 'ok'
      : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Cured-store aging</span><span>${Math.round(
        (1 - buildingPreservedFoodStorageFactor(building.kind)) * 100,
      )}% slower than ordinary dry storage · ${formatPreservedFoodLoss(
        building.preservedFood
        * environment.preservedFoodSpoilageFractionPerDay
        * buildingPreservedFoodStorageFactor(building.kind),
      )}</span></li>
      <li><span>Purpose</span><span>Foreign trade hub — exchange gold and goods with neighboring villages</span></li>
      <li><span>Linked homes</span><span>${connectedHomes}</span></li>
      <li><span>Caravan crew</span><span>${formatMarketplaceCaravanCrew(building.assignedLabor)}</span></li>
      <li><span>Bulk trade desk</span><span>${manualTrade.label}</span></li>
      <li><span>Active bulk order</span><span>${pendingOrderLabel}</span></li>
      <li><span>Production input cart</span><span>${workshopInputCart}</span></li>
      <li><span>Regional route</span><span>${regionalRoute}</span></li>
      <li><span>Specialty queue</span><span>${specialtyQueueLabel}</span></li>
      <li><span>Specialty export desk</span><span>${specialtyDesk}</span></li>
      <li><span>Market coffer</span><span>${proceedsCollection}</span></li>
      <li><span>Export stock</span><span>${physicalEconomy ? 'Must be staged at this market by visible cart' : 'Legacy treasury + road-linked building stores'}</span></li>
      <li><span>Household reserves</span><span>Protected from exports</span></li>
      <li><span>Backyard sales</span><span>Road-linked homes trade here; activity tolls enter this market lockbox</span></li>
      <li><span>Emergency branch</span><span>${householdBranchLabel}</span></li>
      <li><span>Paid-cart queue</span><span>${householdBranchBottleneck}</span></li>
      <li><span>Household orders</span><span>At 18h runway, homes buy a full food-first lot with savings; busy, resting, or blocked carts wait without charging</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor,
    supplementalPanelHtml: renderMarketplaceTradePanel(
      building,
      availability,
      marketState,
      manualTrade,
      context.conflictEnabled,
      seedCoverage,
      physicalEconomy,
      inboundBulkResources,
    ),
  };
}

function marketplaceTreasurySeatPriority(building: BuildingState): number {
  switch (building.kind) {
    case 'town_hall': return 0;
    case 'founders_camp': return 1;
    default: return 2;
  }
}

function formatMarketplaceProceedsCollection(options: {
  physicalEconomy: boolean;
  market: BuildingState;
  activeTrip: DeliveryTripState | null;
  inboundCashTrip: DeliveryTripState | null;
  marketFireDisabled: boolean;
  treasurySeat: BuildingState | null;
  treasurySeatLabel: string | null;
  treasuryRouteAvailable: boolean;
}): string {
  if (!options.physicalEconomy) {
    return 'Legacy settlement - sales and tolls credit the treasury immediately';
  }
  if (
    options.activeTrip?.cargoKind === 'gold'
    && options.activeTrip.amount > 1e-6
  ) {
    return `${options.activeTrip.amount.toFixed(1)} gold traveling to ${
      options.treasurySeatLabel ?? 'the civic lockbox'
    } - unavailable until unloading`;
  }
  if (options.inboundCashTrip && options.inboundCashTrip.amount > 1e-6) {
    return `${options.market.gold.toFixed(1)} gold held + ${
      options.inboundCashTrip.amount.toFixed(1)
    } inbound from ${options.treasurySeatLabel ?? 'the civic treasury'}`;
  }
  const held = Math.max(0, options.market.gold);
  const target = marketplaceGoldReserveTarget(options.market);
  const shortfall = marketplaceGoldReserveShortfall(held, 0, target);
  const surplus = marketplaceGoldSweepSurplus(held, target);
  const lockbox = `${held.toFixed(1)} gold in the visible coffer`;
  if (options.marketFireDisabled) {
    return `${lockbox} - sealed until fire recovery`;
  }
  if (shortfall > 1e-6) {
    if (options.market.assignedLabor <= 0) {
      return `${lockbox} - assign a broker to request ${shortfall.toFixed(1)} reserve gold`;
    }
    if (!options.treasurySeat) {
      return `${lockbox} - reserve awaits a founding or Town Hall treasury chest`;
    }
    if (!options.treasuryRouteAvailable) {
      return `${lockbox} - connect this market to ${options.treasurySeatLabel}`;
    }
    return `${held.toFixed(1)} / ${target} working gold - ${shortfall.toFixed(1)} awaits a free treasury handcart`;
  }
  if (surplus <= 1e-6) {
    return target <= 0
      ? 'Empty coffer - imports wait for local receipts'
      : `${held.toFixed(1)} / ${target} working gold ready for imports`;
  }
  const sweepable = `${surplus.toFixed(1)} surplus of ${held.toFixed(1)} coffer gold`;
  if (options.market.assignedLabor <= 0) {
    return `${sweepable} - assign a broker to sweep it`;
  }
  if (options.market.actionCooldown > 1e-6 && options.market.assignedLabor <= 1) {
    return `${sweepable} - sole broker at the trade desk for ${options.market.actionCooldown.toFixed(1)}s`;
  }
  if (options.activeTrip) {
    return `${sweepable} - market cart busy carrying ${options.activeTrip.cargoKind}`;
  }
  if (!options.treasurySeat) {
    return `${sweepable} - awaiting a founding or Town Hall treasury chest`;
  }
  if (!options.treasuryRouteAvailable) {
    return `${sweepable} - connect this market to ${options.treasurySeatLabel}`;
  }
  return `${sweepable} - next broker handcart carries up to ${STOREHOUSE_HAUL_PER_WORKER.toFixed(0)} gold`;
}

function formatSpecialtyExportDesk(
  fireDisabled: boolean,
  hasRoadAccess: boolean,
  assignedLabor: number,
  actionCooldown: number,
  queue: ReturnType<typeof marketplaceSpecialtyQueue>,
  plan: ReturnType<typeof marketplaceSpecialtyExportPlan>,
): string {
  if (fireDisabled) return 'Paused - repair fire damage before brokers resume';
  if (queue.units <= 1e-6) return 'Ready - awaiting ale, honey, wine, or cloth hauls';
  if (!plan.saleAllowed) {
    return `Holding - ${Math.round(plan.marketRate * 100)}% regional rate below ${Math.round(plan.policy.minRate * 100)}% floor`;
  }
  if (!hasRoadAccess) return 'Stalled - connect this market to a road';
  if (assignedLabor <= 0) return 'Stalled - assign at least one broker';
  if (queue.exportWorkers <= 0) {
    return actionCooldown > 1e-6
      ? 'Paused - sole broker is settling a manual trade'
      : 'Stalled - no broker capacity';
  }
  const clearTime = queue.clearSeconds == null
    ? ''
    : ` - clears in about ${queue.clearSeconds.toFixed(1)}s`;
  return `${queue.exportWorkers} broker${queue.exportWorkers === 1 ? '' : 's'} - ${queue.unitsPerSecond.toFixed(2)} units/s at ${Math.round(plan.marketRate * 100)}%${clearTime}`;
}
