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
  resolvedSpecialtyFamilyPolicy,
  type SpecialtyMarketFamily,
} from '../../economy/specialtyTrade.ts';
import { marketplaceSeedCoveragePlan } from '../../economy/marketplaceSeedCoverage.ts';
import {
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketBranch,
} from '../../economy/settlementHouseholdMarket.ts';
import { marketplaceServiceResidenceIds } from '../serviceCoverage.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
  isRegionalExportTrip,
  isRegionalMarketTrip,
  tripRemainingSeconds,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  STOREHOUSE_HAUL_PER_WORKER,
  TRADE_RESOURCE_KINDS,
  type TradeResourceKind,
} from '../../generated/gameBalance.ts';
import {
  buildingPreservedFoodStorageFactor,
  formatPreservedFoodLoss,
} from '../../economy/foodPreservation.ts';
import { preservedFoodStock } from '../../economy/foodInventory.ts';
import type { BuildingState } from '../types.ts';
import {
  marketplaceGoldReserveShortfall,
  marketplaceGoldReserveTarget,
  marketplaceGoldSweepSurplus,
} from '../../economy/marketplaceGoldReserve.ts';

const BULK_TRADE_RESOURCES = new Set<TradeResourceKind>(TRADE_RESOURCE_KINDS);

function formatRegionalDeskStatus(reachableHomes: number): string {
  if (reachableHomes <= 0) {
    return 'Regional trade desk ready';
  }
  return `Regional desk ready · ${reachableHomes} home${reachableHomes === 1 ? '' : 's'} reachable for paid emergency orders`;
}

export function renderMarketplaceInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const availability = context.getTradeAvailability?.(building);
  if (!availability) {
    throw new Error('Trading Post inspector requires trade availability.');
  }
  const marketState = context.getMarketState?.();
  if (!marketState) {
    throw new Error('Trading Post inspector requires regional market state.');
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
  const traderCount = Math.max(0, Math.min(5, Math.floor(building.assignedLabor)));
  const activeMarketTrips = Array.from(context.gameState.deliveryTrips.values())
    .filter((trip) => trip.buildingId === building.id);
  const regionalTradeTrips = activeMarketTrips.filter(isRegionalMarketTrip);
  const regionalTradeTrip = regionalTradeTrips[0] ?? null;
  const regionalRoutesFull = traderCount <= 0 || regionalTradeTrips.length >= traderCount;
  const regionalExportTrip = regionalTradeTrips.find(isRegionalExportTrip) ?? null;
  const activeMarketTrip = activeMarketTrips.find((trip) => !isRegionalMarketTrip(trip)) ?? null;
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
        } · ${
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
    regionalRoutesFull,
  );
  const routeCondition = roadSpeedMultiplier < 0.999
    ? `${Math.round(roadSpeedMultiplier * 100)}% caravan pace`
    : 'Firm roads';
  const regionalRoute = regionalTradeTrip
    ? `${formatRegionalImportTrip(
        regionalTradeTrip,
        regionalTradeTrip.residenceId
          ? context.gameState.residences.get(regionalTradeTrip.residenceId)?.parcelIndex
          : undefined,
      )} · ${regionalTradeTrips.length} / ${traderCount} route slots active`
    : marketFireDisabled
    ? 'Paused · repair fire damage before regional trade resumes'
    : traderCount <= 0
      ? `${routeCondition} · assign a regional trader to open a route`
      : `${routeCondition} · ${traderCount} concurrent route slot${traderCount === 1 ? '' : 's'} · next desk settlement in ${manualTrade.nextCooldownSeconds?.toFixed(1)}s`;
  const specialtyRates = {
    drink: marketState.drinkPriceMult,
    provision: marketState.provisionPriceMult,
    wares: marketState.waresPriceMult,
  };
  const specialtyFamilies = ([
    {
      kind: 'drink',
      label: 'drinks',
      stock: building.ale + building.wine,
      policy: building.marketplaceDrinkExportPolicy,
    },
    {
      kind: 'provision',
      label: 'provisions',
      stock: building.honey + (building.cheese ?? 0),
      policy: building.marketplaceProvisionExportPolicy,
    },
    {
      kind: 'wares',
      label: 'wares',
      stock: (building.cloth ?? 0) + (building.pottery ?? 0),
      policy: building.marketplaceWaresExportPolicy,
    },
  ] as const).map((family) => {
    const policyValue = resolvedSpecialtyFamilyPolicy(
      family.policy,
      building.marketplaceSpecialtyExportPolicy,
    );
    return {
      ...family,
      plan: marketplaceSpecialtyExportPlan(
        { marketplaceSpecialtyExportPolicy: policyValue },
        specialtyRates[family.kind],
      ),
    };
  });
  const activeSpecialtyFamily = specialtyFamilies.find((family) =>
    family.stock > 1e-6 && family.plan.saleAllowed
  ) ?? null;
  const heldSpecialtyFamilies = specialtyFamilies.filter((family) =>
    family.stock > 1e-6 && !family.plan.saleAllowed
  );
  const specialtyQueue = marketplaceSpecialtyQueue(building, specialtyRates);
  const specialtyQueueLabel = formatMarketplaceSpecialtyQueue(specialtyQueue);
  const specialtyExportActive = activeSpecialtyFamily != null
    && hasRoadAccess
    && !marketFireDisabled
    && specialtyQueue.exportWorkers > 0
    && !regionalRoutesFull;
  const specialtyExportHeld = heldSpecialtyFamilies.length > 0
    && !marketFireDisabled;
  const specialtyDesk = formatSpecialtyExportDesk(
    marketFireDisabled,
    hasRoadAccess,
    building.assignedLabor,
    building.actionCooldown,
    specialtyQueue,
    specialtyFamilies,
    regionalExportTrip,
    physicalEconomy,
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
  const fiscalPolicy = context.getFiscalPolicy?.();
  const privateExportCash = Math.min(
    Math.max(0, building.privateExportProceedsGold ?? 0),
    Math.max(0, building.gold),
  );
  const householdMarketPlan = typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
    ? computeSettlementHouseholdMarketPlan({
        state: context.gameState,
        marketState,
        roadNetwork: context.worldQueries.getRoadNetworkSnapshot(),
        clock: gameClock(context.gameState.tick),
        sabbathObserved: parishPolicy.sabbathObservanceEnabled
          && settlementHasStaffedChapel(context.gameState),
        importDutyRate: context.getFiscalPolicy?.().importDutyRate ?? 0,
        includeBranchResidenceIds: true,
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
      : regionalTradeTrip
        ? `${cargoKindLabel(regionalTradeTrip.cargoKind)} regional merchant · ${formatTripPhaseLabel(regionalTradeTrip.phase)}`
      : pendingOffer
        ? `Staging bulk order · ${pendingStaging?.localStock.toFixed(0)} / ${pendingStaging?.required.toFixed(0)} at Trading Post`
      : specialtyExportActive
        ? physicalEconomy
          ? `Preparing ${activeSpecialtyFamily?.label} merchant load at ${Math.round((activeSpecialtyFamily?.plan.marketRate ?? 1) * 100)}%`
          : `Trading ${activeSpecialtyFamily?.label} at ${Math.round((activeSpecialtyFamily?.plan.marketRate ?? 1) * 100)}% - ${specialtyQueue.unitsPerSecond.toFixed(2)} units/s`
        : specialtyExportHeld
          ? `Holding ${heldSpecialtyFamilies.map((family) => family.label).join(' and ')} below selected regional floors`
          : manualTrade.ready
            ? formatRegionalDeskStatus(connectedHomes)
            : manualTrade.label,
    statusState: !marketFireDisabled
      && (
        regionalTradeTrip != null
        || specialtyExportActive
        || (manualTrade.ready && connectedHomes > 0)
      )
      ? 'ok'
      : 'idle',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Cured-store aging</span><span>${Math.round(
        (1 - buildingPreservedFoodStorageFactor(building.kind)) * 100,
      )}% slower than ordinary dry storage · ${formatPreservedFoodLoss(
        preservedFoodStock(building)
        * environment.preservedFoodSpoilageFractionPerDay
        * buildingPreservedFoodStorageFactor(building.kind),
      )}</span></li>
      <li><span>Purpose</span><span>Dedicated Trading Post — exchange gold and goods with neighboring regions</span></li>
      <li><span>Regional traders</span><span>${Math.floor(building.assignedLabor)} / 5 assigned</span></li>
      <li><span>Concurrent routes</span><span>${formatMarketplaceCaravanCrew(building.assignedLabor)}</span></li>
      <li><span>Bulk trade desk</span><span>${manualTrade.label}</span></li>
      <li><span>Active bulk order</span><span>${pendingOrderLabel}</span></li>
      <li><span>Production input cart</span><span>${workshopInputCart}</span></li>
      <li><span>Active regional routes</span><span>${regionalRoute}</span></li>
      <li><span>Specialty queue</span><span>${specialtyQueueLabel}</span></li>
      <li><span>Specialty export desk</span><span>${specialtyDesk}</span></li>
      <li><span>Public Trading Post coffer</span><span>${proceedsCollection}</span></li>
      <li><span>Private export purse</span><span>${Math.round(privateExportCash)} gold awaiting free-hauler delivery to producer households</span></li>
      <li><span>Automatic specialty exports</span><span>Private household trade · ${Math.round((fiscalPolicy?.exportDutyRate ?? 0) * 100)}% export duty to the civic lockbox, remainder to households</span></li>
      <li><span>Manual bulk imports</span><span>Public Trading Post procurement · paid from its civic coffer and exempt from household import duty</span></li>
      <li><span>Manual bulk exports</span><span>Public Trading Post trade · full proceeds enter the civic treasury and are not charged the private export duty</span></li>
      <li><span>Export stock</span><span>${physicalEconomy ? 'Must be staged at this Trading Post by visible cart' : 'Legacy treasury + road-linked building stores'}</span></li>
      <li><span>Household reserves</span><span>Protected from exports</span></li>
      <li><span>Household stalls</span><span>Handled only by granary and storehouse workers at a Marketplace</span></li>
      <li><span>Emergency branch</span><span>${householdBranchLabel}</span></li>
      <li><span>Paid-cart queue</span><span>${householdBranchBottleneck}</span></li>
      <li><span>Household orders</span><span>At 18h runway, homes buy a full food-first lot with savings plus ${Math.round((fiscalPolicy?.importDutyRate ?? 0) * 100)}% household import duty; public and parish orders are exempt</span></li>
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
    serviceCoverage: {
      kind: 'marketplace',
      residenceIds: marketplaceServiceResidenceIds(
        householdMarketPlan,
        building.id,
      ),
    },
  };
}

function formatRegionalImportTrip(
  trip: DeliveryTripState,
  parcelIndex?: number,
): string {
  const remainingSeconds = tripRemainingSeconds(trip, trip.pathDistance);
  const clearsIn = Number.isFinite(remainingSeconds)
    ? ` · route clears in about ${Math.max(1, Math.ceil(remainingSeconds))}s`
    : '';
  if (isRegionalExportTrip(trip)) {
    if (trip.phase === 'inbound') {
      return trip.amount > 1e-6
        ? `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} returning from the regional exchange${clearsIn}`
        : `Empty merchant cart returning after a lost export load${clearsIn}`;
    }
    if (trip.phase === 'unloading') {
      return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} exchanging at the regional route${clearsIn}`;
    }
    return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} physically outbound to the regional exchange${clearsIn}`;
  }
  if (trip.phase === 'inbound') {
    return `Merchant cart returning to the Adriatic-facing map edge${clearsIn}`;
  }
  const household = trip.destinationKind === 'residence'
    ? parcelIndex == null
      ? 'the named household'
      : `Parcel #${parcelIndex + 1}`
    : null;
  if (trip.phase === 'unloading') {
    if (household) {
      return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} unloading at ${household}${clearsIn}`;
    }
    return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} unloading into Trading Post storage${clearsIn}`;
  }
  if (household) {
    return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} physically inbound through this Trading Post to ${household}${clearsIn}`;
  }
  return `${Math.round(trip.amount)} ${cargoKindLabel(trip.cargoKind).toLowerCase()} physically inbound from the Adriatic-facing map edge${clearsIn}`;
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
    return `${Math.round(options.activeTrip.amount)} gold traveling to ${
      options.treasurySeatLabel ?? 'the civic lockbox'
    } - unavailable until unloading`;
  }
  if (options.inboundCashTrip && options.inboundCashTrip.amount > 1e-6) {
    return `${Math.round(options.market.gold)} gold held + ${
      Math.round(options.inboundCashTrip.amount)
    } inbound from ${options.treasurySeatLabel ?? 'the civic treasury'}`;
  }
  const privateExportCash = Math.min(
    Math.max(0, options.market.privateExportProceedsGold ?? 0),
    Math.max(0, options.market.gold),
  );
  const held = Math.max(0, options.market.gold - privateExportCash);
  const target = marketplaceGoldReserveTarget(options.market);
  const shortfall = marketplaceGoldReserveShortfall(held, 0, target);
  const surplus = marketplaceGoldSweepSurplus(held, target);
  const lockbox = `${Math.round(held)} public gold in the visible coffer`;
  if (options.marketFireDisabled) {
    return `${lockbox} - sealed until fire recovery`;
  }
  if (shortfall > 1e-6) {
    if (options.market.assignedLabor <= 0) {
      return `${lockbox} - staff the Trading Post and leave a free hauler to request ${Math.ceil(shortfall)} reserve gold`;
    }
    if (!options.treasurySeat) {
      return `${lockbox} - reserve awaits a founding or Town Hall treasury chest`;
    }
    if (!options.treasuryRouteAvailable) {
      return `${lockbox} - connect this Trading Post to ${options.treasurySeatLabel}`;
    }
    return `${Math.round(held)} / ${Math.ceil(target)} working gold - ${Math.ceil(shortfall)} awaits a free treasury handcart`;
  }
  if (surplus <= 1e-6) {
    return target <= 0
      ? 'Empty coffer - imports wait for local receipts'
      : `${Math.round(held)} / ${Math.ceil(target)} working gold ready for imports`;
  }
  const sweepable = `${Math.round(surplus)} surplus of ${Math.round(held)} coffer gold`;
  if (options.market.assignedLabor <= 0) {
    return `${sweepable} - the post is closed; assign a trader before public trade resumes`;
  }
  if (options.activeTrip) {
    return `${sweepable} - Trading Post cart busy carrying ${options.activeTrip.cargoKind}`;
  }
  if (!options.treasurySeat) {
    return `${sweepable} - awaiting a founding or Town Hall treasury chest`;
  }
  if (!options.treasuryRouteAvailable) {
    return `${sweepable} - connect this Trading Post to ${options.treasurySeatLabel}`;
  }
  return `${sweepable} - next free-hauler handcart carries up to ${STOREHOUSE_HAUL_PER_WORKER.toFixed(0)} gold`;
}

function formatSpecialtyExportDesk(
  fireDisabled: boolean,
  hasRoadAccess: boolean,
  assignedLabor: number,
  actionCooldown: number,
  queue: ReturnType<typeof marketplaceSpecialtyQueue>,
  families: ReadonlyArray<{
    kind: SpecialtyMarketFamily;
    label: string;
    stock: number;
    plan: ReturnType<typeof marketplaceSpecialtyExportPlan>;
  }>,
  regionalExportTrip: DeliveryTripState | null,
  physicalEconomy: boolean,
): string {
  if (fireDisabled) return 'Paused - repair fire damage before regional traders resume';
  if (regionalExportTrip) {
    return `Regional merchant ${formatTripPhaseLabel(regionalExportTrip.phase).toLowerCase()} - another trader may open the next free route slot`;
  }
  if (queue.units <= 1e-6) {
    return 'Ready - awaiting ale, wine, honey, cheese, cloth, or pottery hauls';
  }
  const eligible = families.filter((family) =>
    family.stock > 1e-6 && family.plan.saleAllowed
  );
  const held = families.filter((family) =>
    family.stock > 1e-6 && !family.plan.saleAllowed
  );
  if (eligible.length === 0) {
    return `Holding - ${held.map((family) => `${family.label} ${Math.round(family.plan.marketRate * 100)}% below ${Math.round(family.plan.policy.minRate * 100)}% floor`).join(' · ')}`;
  }
  if (!hasRoadAccess) return 'Stalled - connect this Trading Post to a road';
  if (assignedLabor <= 0) return 'Stalled - assign at least one regional trader';
  if (queue.exportWorkers <= 0) {
    return actionCooldown > 1e-6
      ? 'Paused - sole regional trader is settling a manual trade'
      : 'Stalled - no regional-trader capacity';
  }
  if (physicalEconomy) {
    return `${queue.exportWorkers} regional trader${queue.exportWorkers === 1 ? '' : 's'} ready for ${eligible.map((family) => family.label).join(', ')}${held.length > 0 ? ` · holding ${held.map((family) => family.label).join(', ')}` : ''} - one live merchant load per open route slot`;
  }
  return `${queue.exportWorkers} regional trader${queue.exportWorkers === 1 ? '' : 's'} - ${queue.unitsPerSecond.toFixed(2)} units/s · ${eligible.map((family) => `${family.label} ${Math.round(family.plan.marketRate * 100)}%`).join(' · ')}${held.length > 0 ? ` · holding ${held.map((family) => family.label).join(', ')}` : ''}`;
}
