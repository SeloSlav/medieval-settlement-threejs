import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  FRESH_FOOD_KINDS,
  SAVORY_PRESERVE_KINDS,
  freshFoodStock,
  savoryPreservesStock,
} from '../../economy/foodInventory.ts';
import {
  assignMarketplaceStallRoster,
  marketStallLabel,
  type MarketStallAssignment,
} from '../../economy/marketStallAssignments.ts';
import {
  combinedFuelEquivalent,
  fuelRunwayDays,
  householdFuelDemandPerDay,
  marketplaceFuelReserveTarget,
} from '../../economy/fuelReservePolicy.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../../fires/fireIncident.ts';
import {
  BUILDING_STORAGE_CAPS,
  LOCAL_MARKET_TAX_CART_THRESHOLD,
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_FUEL_RESERVE_DAYS,
  MARKETPLACE_GOODS_STALL_SLOTS,
  MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY,
} from '../../generated/gameBalance.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { cargoKindLabel, formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import { buildingLocalStorageItems } from './buildingLocalStorageRenderer.ts';
import {
  renderInspectorResourceStrip,
  type InspectorResourceTokenOptions,
} from './inspectorResourceTokens.ts';
import {
  marketplaceResidenceFulfillment,
  marketplaceServiceResidenceIds,
} from '../serviceCoverage.ts';

export function renderMarketStallsInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const fireDisabled = fireDisabledBuildingIds(context.gameState.fireIncidents.values());
  const residenceFireDisabled = fireDisabledResidenceIds(
    context.gameState.fireIncidents.values(),
  );
  const stallRoster = assignMarketplaceStallRoster(
    context.gameState.buildings.values(),
    (ax, az, bx, bz) => context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    fireDisabled,
  );
  const stallAssignments = stallRoster.stalls;
  const marketAssignments = stallAssignments.filter(
    (assignment) => assignment.marketplaceId === building.id,
  );
  const marketWorkers = stallRoster.workers.filter(
    (worker) => worker.marketplaceId === building.id,
  );
  const foodAssignments = marketAssignments.filter(
    (assignment) => assignment.group === 'food',
  );
  const goodsAssignments = marketAssignments.filter(
    (assignment) => assignment.group === 'goods',
  );
  const standbyFoodWorkers = marketWorkers.filter(
    (worker) => worker.group === 'food' && worker.needKind == null,
  ).length;
  const standbyGoodsWorkers = marketWorkers.filter(
    (worker) => worker.group === 'goods' && worker.needKind == null,
  ).length;
  const standbyWorkers = standbyFoodWorkers + standbyGoodsWorkers;
  const totalStalls = marketAssignments.length;
  const serviceMarketIds = new Set(
    stallAssignments.map((assignment) => assignment.marketplaceId),
  );
  const serviceMarkets = [...context.gameState.buildings.values()]
    .filter((candidate) =>
      candidate.kind === 'marketplace'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id)
      && serviceMarketIds.has(candidate.id)
    );
  const fuelMarkets = [...context.gameState.buildings.values()]
    .filter((candidate) =>
      candidate.kind === 'marketplace'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id)
      && stallRoster.workers.some((worker) =>
        worker.marketplaceId === candidate.id
        && worker.group === 'goods'
      )
    );
  const eligibleResidences = [...context.gameState.residences.values()]
    .filter((residence) =>
      !residence.abandoned
      && residence.population > 0
      && !residenceFireDisabled.has(residence.id)
    );
  const serviceResidenceIds = marketplaceServiceResidenceIds(
    eligibleResidences,
    serviceMarkets,
    building.id,
    (ax, az, bx, bz) => context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
  );
  const serviceResidenceIdSet = new Set(serviceResidenceIds);
  const marketplaceFulfillment = new Map(
    eligibleResidences
      .filter((residence) => serviceResidenceIdSet.has(residence.id))
      .map((residence) => [
        residence.id,
        marketplaceResidenceFulfillment(residence),
      ] as const),
  );
  let roadConnectedHomes = 0;
  let roadConnectedPopulation = 0;
  let coveredHouseholds = 0;
  for (const residence of eligibleResidences) {
    const distanceToMarket = context.worldQueries.getRoadPathDistance(
      residence.x,
      residence.z,
      building.x,
      building.z,
    );
    if (distanceToMarket != null) {
      roadConnectedHomes += 1;
      roadConnectedPopulation += residence.population;
    }
    const claimedMarket = fuelMarkets
      .flatMap((market) => {
        const distance = context.worldQueries.getRoadPathDistance(
          residence.x,
          residence.z,
          market.x,
          market.z,
        );
        return distance == null ? [] : [{ market, distance }];
      })
      .sort((left, right) =>
        left.distance - right.distance || left.market.id.localeCompare(right.market.id)
      )[0]?.market;
    if (claimedMarket?.id === building.id) coveredHouseholds += 1;
  }
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    gameClock(context.gameState.tick),
    context.severeWeatherEnabled ?? false,
  );
  const fuelEquivalent = combinedFuelEquivalent(
    building.firewood,
    building.charcoal ?? 0,
  );
  const fuelDemandPerDay = householdFuelDemandPerDay(
    coveredHouseholds,
    environment.firewoodDemandMultiplier,
  );
  const fuelTarget = marketplaceFuelReserveTarget(
    coveredHouseholds,
    environment.firewoodDemandMultiplier,
    BUILDING_STORAGE_CAPS.marketplace.firewood ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.charcoal ?? 0,
  );
  const fuelRunway = fuelRunwayDays(fuelEquivalent, fuelDemandPerDay);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const stockedNeeds = [
    freshFoodStock(building) + Math.max(0, building.honey),
    savoryPreservesStock(building),
    fuelEquivalent,
    building.cloth,
    building.shoes,
    building.pottery,
    building.remedies,
  ].filter((stock) => (stock ?? 0) > 1e-6).length;
  const taxCartActive = activeTrip?.cargoKind === 'gold'
    && activeTrip.destinationKind === 'building';
  const heldTax = Math.max(0, building.gold ?? 0);
  const localStorageItems = buildingLocalStorageItems(building);
  const freshKinds = new Set<string>([...FRESH_FOOD_KINDS, 'honey']);
  const preservedKinds = new Set<string>(SAVORY_PRESERVE_KINDS);
  const fuelKinds = new Set<string>(['firewood', 'charcoal']);
  const representedKinds = new Set<string>([
    ...freshKinds,
    ...preservedKinds,
    ...fuelKinds,
    'cloth',
    'shoes',
    'pottery',
    'remedies',
    'gold',
  ]);
  const resourcesIn = (kinds: ReadonlySet<string>) =>
    localStorageItems.filter((item) => kinds.has(item.kind));
  const assignmentDetail = (
    needKind: MarketStallAssignment['needKind'],
    slots: number,
    emptyText: string,
  ) => {
    const assignments = marketAssignments.filter((assignment) => assignment.needKind === needKind);
    return `Tables: ${assignments.length}/${slots} · Source: ${formatStallAssignments(assignments, context, emptyText)}`;
  };
  const resourceTokens: InspectorResourceTokenOptions[] = [
    {
      kind: 'food',
      amount: freshFoodStock(building) + Math.max(0, building.honey),
      title: 'Fresh food',
      detail: assignmentDetail('food', MARKETPLACE_FOOD_STALL_SLOTS, 'No stocked Granary table'),
      amountLabel: 'On site',
      resources: resourcesIn(freshKinds),
    },
    {
      kind: 'savoryPreserves',
      amount: savoryPreservesStock(building),
      title: 'Savory preserves',
      detail: assignmentDetail(
        'savoryPreserves',
        MARKETPLACE_FOOD_STALL_SLOTS,
        'No stocked Granary table',
      ),
      amountLabel: 'On site',
      resources: resourcesIn(preservedKinds),
    },
    {
      kind: 'firewood',
      amount: fuelEquivalent,
      title: 'Household fuel',
      detail: `${assignmentDetail('firewood', MARKETPLACE_GOODS_STALL_SLOTS, 'No stocked Storehouse table')} · Target: ${fuelTarget.toFixed(0)} in firewood · Lasts: ${formatFuelRunway(fuelRunway, coveredHouseholds)}`,
      amountLabel: 'Heat value in firewood',
      resources: resourcesIn(fuelKinds),
    },
    {
      kind: 'cloth',
      amount: Math.max(0, building.cloth ?? 0),
      detail: assignmentDetail('cloth', MARKETPLACE_GOODS_STALL_SLOTS, 'No stocked Storehouse table'),
      amountLabel: 'On site',
    },
    {
      kind: 'shoes',
      amount: Math.max(0, building.shoes ?? 0),
      detail: assignmentDetail('shoes', MARKETPLACE_GOODS_STALL_SLOTS, 'No stocked Storehouse table'),
      amountLabel: 'On site',
    },
    {
      kind: 'pottery',
      amount: Math.max(0, building.pottery ?? 0),
      detail: assignmentDetail('pottery', MARKETPLACE_GOODS_STALL_SLOTS, 'No stocked Storehouse table'),
      amountLabel: 'On site',
    },
    {
      kind: 'remedies',
      amount: Math.max(0, building.remedies ?? 0),
      detail: 'Medicinal supplies reserved for deliveries to sick households.',
      amountLabel: 'On site',
    },
    {
      kind: 'gold',
      amount: heldTax,
      title: 'Tax lockbox',
      detail: taxCartActive
        ? 'Collection: cart active'
        : heldTax + 1e-6 >= LOCAL_MARKET_TAX_CART_THRESHOLD
          ? 'Collection: awaiting free hauler'
          : heldTax > 1e-6
            ? `Collection: waiting for ${Math.ceil(LOCAL_MARKET_TAX_CART_THRESHOLD)} gold`
            : 'Collection: empty',
      amountLabel: 'Held here',
    },
    ...localStorageItems
      .filter((item) => !representedKinds.has(item.kind))
      .map((item): InspectorResourceTokenOptions => ({
        ...item,
        amountLabel: 'On site',
      })),
  ];
  const cartLabel = activeTrip
    ? `${cargoKindLabel(activeTrip.cargoKind)} · ${formatTripPhaseLabel(activeTrip.phase)}`
    : 'Idle';

  return {
    eyebrow: 'Building',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: totalStalls <= 0
      ? standbyWorkers > 0
        ? `${standbyWorkers} standby · stock matching`
        : stockedNeeds > 0
          ? 'Stocked · no matching stall'
          : 'Empty · no active stalls'
      : taxCartActive
        ? `${totalStalls} stalls · lockbox cart`
        : activeTrip
          ? `${totalStalls} stalls · service cart`
          : `${totalStalls} stalls · ${stockedNeeds} stocked needs`,
    statusState: totalStalls > 0 || standbyWorkers > 0 ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li data-inspector-primary data-inspector-resource-strip><span>Marketplace stock</span>${renderInspectorResourceStrip(resourceTokens, { ariaLabel: 'Marketplace stock' })}</li>
      <li data-inspector-primary data-inspector-detail="Food and goods tables are staffed by road-linked Granary and Storehouse workers."><span>Stalls</span><span>${foodAssignments.length}/${MARKETPLACE_FOOD_STALL_SLOTS} food · ${goodsAssignments.length}/${MARKETPLACE_GOODS_STALL_SLOTS} goods${standbyWorkers > 0 ? ` · ${standbyWorkers} standby` : ''}</span></li>
      <li data-inspector-primary data-inspector-detail="Every road-connected home is eligible; exact road length chooses the nearest stocked Marketplace."><span>Reach</span><span>${roadConnectedHomes} homes · ${roadConnectedPopulation} residents</span></li>
      <li data-inspector-primary><span>Household issues</span><span>Checks ${MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY} times per day and replenishes each connected household's monthly bill buffer when needed</span></li>
      <li data-inspector-primary data-inspector-detail="Fuel for ${coveredHouseholds} households over ${MARKETPLACE_FUEL_RESERVE_DAYS} days. Charcoal provides twice the household heat of firewood."><span>Fuel runway</span><span>${fuelEquivalent.toFixed(0)}/${fuelTarget.toFixed(0)} eq · ${formatFuelRunway(fuelRunway, coveredHouseholds)}</span></li>
      <li data-inspector-secondary><span>Cart</span><span>${cartLabel}</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
    serviceCoverage: {
      kind: 'marketplace',
      residenceIds: serviceResidenceIds,
      marketplaceFulfillment,
    },
  };
}

function formatStallAssignments(
  assignments: readonly MarketStallAssignment[],
  context: InspectorRenderContext,
  emptyText: string,
): string {
  if (assignments.length === 0) return emptyText;
  return assignments.map((assignment) =>
    `${marketStallLabel(assignment.needKind)} ← ${context.worldQueries.getBuildingLabel(assignment.workplaceKind)} worker`
  ).join(' · ');
}

function formatFuelRunway(days: number, households: number): string {
  if (households <= 0 || !Number.isFinite(days)) return 'no covered household demand';
  return `${days.toFixed(1)} days (${(days / 30).toFixed(1)} months)`;
}
