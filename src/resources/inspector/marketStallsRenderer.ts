import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import { freshFoodStock, preservedFoodStock } from '../../economy/foodInventory.ts';
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
  buildingStorageRows,
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
} from '../../generated/gameBalance.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';

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
  const fuelMarkets = [...context.gameState.buildings.values()]
    .filter((candidate) =>
      candidate.kind === 'marketplace'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id)
      && stallAssignments.some((assignment) =>
        assignment.marketplaceId === candidate.id
        && assignment.needKind === 'firewood'
      )
    );
  let roadConnectedHomes = 0;
  let roadConnectedPopulation = 0;
  let coveredPopulation = 0;
  for (const residence of context.gameState.residences.values()) {
    if (
      residence.abandoned
      || residence.population <= 0
      || residenceFireDisabled.has(residence.id)
    ) {
      continue;
    }
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
    if (claimedMarket?.id === building.id) coveredPopulation += residence.population;
  }
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    gameClock(context.gameState.tick),
  );
  const fuelEquivalent = combinedFuelEquivalent(
    building.firewood,
    building.charcoal ?? 0,
  );
  const fuelDemandPerDay = householdFuelDemandPerDay(
    coveredPopulation,
    environment.firewoodDemandMultiplier,
  );
  const fuelTarget = marketplaceFuelReserveTarget(
    coveredPopulation,
    environment.firewoodDemandMultiplier,
    BUILDING_STORAGE_CAPS.marketplace.firewood ?? 0,
    BUILDING_STORAGE_CAPS.marketplace.charcoal ?? 0,
  );
  const fuelRunway = fuelRunwayDays(fuelEquivalent, fuelDemandPerDay);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const stockedNeeds = [
    freshFoodStock(building) + Math.max(0, building.honey),
    preservedFoodStock(building),
    building.ale,
    fuelEquivalent,
    building.cloth,
    building.pottery,
    building.remedies,
  ].filter((stock) => (stock ?? 0) > 1e-6).length;
  const taxCartActive = activeTrip?.cargoKind === 'gold'
    && activeTrip.destinationKind === 'building';
  const heldTax = Math.max(0, building.gold ?? 0);

  return {
    eyebrow: 'Building',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: totalStalls <= 0
      ? standbyWorkers > 0
        ? `${standbyWorkers} depot ${standbyWorkers === 1 ? 'worker is' : 'workers are'} standing by for compatible stock`
        : stockedNeeds > 0
          ? `Stock waiting — assign a matching Granary or Storehouse worker to open a table`
          : 'Empty square — staff a road-linked Granary or Storehouse to open tables'
      : taxCartActive
        ? `${Math.round(heldTax)} tax gold remains — a free hauler is carrying the current lockbox load`
      : activeTrip
        ? `${totalStalls} active stalls — a remedy or lockbox cart is on the road`
        : `${totalStalls} active commodity stalls · ${stockedNeeds} stocked household need ${stockedNeeds === 1 ? 'category' : 'categories'} on site`,
    statusState: totalStalls > 0 || standbyWorkers > 0 ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Shared local household exchange — it has no employees of its own</span></li>
      <li><span>Service reach</span><span>${roadConnectedHomes} road-connected ${roadConnectedHomes === 1 ? 'home' : 'homes'} · ${roadConnectedPopulation} residents · no distance radius</span></li>
      <li><span>Food stalls</span><span>${foodAssignments.length}/${MARKETPLACE_FOOD_STALL_SLOTS} active${standbyFoodWorkers > 0 ? ` · ${standbyFoodWorkers} worker${standbyFoodWorkers === 1 ? '' : 's'} awaiting stock` : ''} · ${formatStallAssignments(foodAssignments, context, 'no Granary worker has a stocked food category')}</span></li>
      <li><span>Goods stalls</span><span>${goodsAssignments.length}/${MARKETPLACE_GOODS_STALL_SLOTS} active${standbyGoodsWorkers > 0 ? ` · ${standbyGoodsWorkers} worker${standbyGoodsWorkers === 1 ? '' : 's'} awaiting stock` : ''} · ${formatStallAssignments(goodsAssignments, context, 'no Village Storehouse worker has a stocked goods category')}</span></li>
      <li><span>Fuel reserve</span><span>${building.firewood.toFixed(0)} firewood + ${(building.charcoal ?? 0).toFixed(0)} charcoal = ${fuelEquivalent.toFixed(0)} fuel-equivalents / ${fuelTarget.toFixed(0)} target · ${formatFuelRunway(fuelRunway, coveredPopulation)}</span></li>
      <li><span>Fuel demand</span><span>${coveredPopulation} covered residents · ${fuelDemandPerDay.toFixed(1)} equivalents/day in ${environment.season} · ${MARKETPLACE_FUEL_RESERVE_DAYS}-day seasonal runway target</span></li>
      <li><span>Distribution</span><span>Every home on the same road network is eligible regardless of distance · nearest stocked Marketplace by exact road length · seven-day pantry issue once per week · daily Town Hall checks cover critical food and heat according to policy · scarce stock goes one household-day per pass, nearest first, with stable household ID as the tie-break</span></li>
      <li><span>Capacity rule</span><span>${MARKETPLACE_FOOD_STALL_SLOTS + MARKETPLACE_GOODS_STALL_SLOTS} tables fit here: ${MARKETPLACE_FOOD_STALL_SLOTS} food + ${MARKETPLACE_GOODS_STALL_SLOTS} goods · one depot worker occupies one table at one nearest Marketplace and sells one stocked need category · backyard surplus first enters that worker's Granary or Storehouse, then waits for the same physical restocking cart as every other good · available depot and stall stock still limit each issue</span></li>
      <li><span>Roster order</span><span>Exact road distance fills nearest markets first · food priority is fresh, preserved, then ale · goods priority is fuel, cloth, then pottery · stable building IDs break ties · a worker may switch category only after both depot and stall run out</span></li>
      <li><span>Backyard exchange</span><span>Edible surplus is pooled at the assigned Granary before its food-stall cart brings it here · remedies and hides enter the assigned Storehouse first · herb remedies retain targeted care carts after reaching the square</span></li>
      <li><span>Local tax lockbox</span><span>${Math.round(heldTax)} gold held${taxCartActive ? ' · collection cart active' : heldTax + 1e-6 >= LOCAL_MARKET_TAX_CART_THRESHOLD ? ' · waiting for a free hauler to the civic treasury' : heldTax > 1e-6 ? ` · batching toward ${Math.ceil(LOCAL_MARKET_TAX_CART_THRESHOLD)} gold or the evening sweep` : ''}</span></li>
      <li><span>Water</span><span>Supplied independently from unstaffed wells</span></li>
      <li><span>Regional trade</span><span>Handled only by a staffed Trading Post</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
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

function formatFuelRunway(days: number, population: number): string {
  if (population <= 0 || !Number.isFinite(days)) return 'no covered household demand';
  return `${days.toFixed(1)} days (${(days / 30).toFixed(1)} months)`;
}
