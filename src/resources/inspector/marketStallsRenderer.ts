import { getBuildingCost } from '../buildingEconomy.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import { freshFoodStock, preservedFoodStock } from '../../economy/foodInventory.ts';
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
  const connected = [...context.gameState.buildings.values()].filter((candidate) =>
    candidate.constructionComplete !== false
    && candidate.assignedLabor > 0
    && !fireDisabled.has(candidate.id)
    && (candidate.kind === 'granary' || candidate.kind === 'village_storehouse')
    && context.worldQueries.getRoadPathDistance(
      candidate.x,
      candidate.z,
      building.x,
      building.z,
    ) != null
  );
  const foodStallWorkers = connected
    .filter((candidate) => candidate.kind === 'granary')
    .reduce((sum, candidate) => sum + candidate.assignedLabor, 0);
  const goodsStallWorkers = connected
    .filter((candidate) => candidate.kind === 'village_storehouse')
    .reduce((sum, candidate) => sum + candidate.assignedLabor, 0);
  const foodStalls = Math.min(foodStallWorkers, MARKETPLACE_FOOD_STALL_SLOTS);
  const goodsStalls = Math.min(goodsStallWorkers, MARKETPLACE_GOODS_STALL_SLOTS);
  const totalStalls = foodStalls + goodsStalls;
  const fuelMarkets = [...context.gameState.buildings.values()]
    .filter((candidate) =>
      candidate.kind === 'marketplace'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id)
      && hasStaffedGoodsStall(candidate, context, fireDisabled)
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
      ? stockedNeeds > 0
        ? `Founders' supply point — ${stockedNeeds} stocked need ${stockedNeeds === 1 ? 'category issues' : 'categories issue'} on market day; permanent restocking is not staffed yet`
        : 'Empty square — founders can stage supplies here; staff a road-linked granary or storehouse for permanent restocking'
      : taxCartActive
        ? `${Math.round(heldTax)} tax gold remains — a free hauler is carrying the current lockbox load`
      : activeTrip
        ? `${totalStalls} active stalls — a remedy or lockbox cart is on the road`
        : `${totalStalls} active stalls stocking ${stockedNeeds} household need ${stockedNeeds === 1 ? 'category' : 'categories'}`,
    statusState: totalStalls > 0 || stockedNeeds > 0 ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Shared local household exchange — it has no employees of its own</span></li>
      <li><span>Service reach</span><span>${roadConnectedHomes} road-connected ${roadConnectedHomes === 1 ? 'home' : 'homes'} · ${roadConnectedPopulation} residents · no distance radius</span></li>
      <li><span>Food stalls</span><span>${foodStalls}/${MARKETPLACE_FOOD_STALL_SLOTS} physical slots from staffed Granaries · pooled backyard and stored food, cured provisions, and ale${foodStallWorkers > foodStalls ? ` · ${foodStallWorkers - foodStalls} connected depot ${foodStallWorkers - foodStalls === 1 ? 'worker needs' : 'workers need'} another Marketplace` : ''}</span></li>
      <li><span>Goods stalls</span><span>${goodsStalls}/${MARKETPLACE_GOODS_STALL_SLOTS} physical slots from staffed Village Storehouses · firewood, charcoal, cloth, pottery, and shared herb remedies${goodsStallWorkers > goodsStalls ? ` · ${goodsStallWorkers - goodsStalls} connected depot ${goodsStallWorkers - goodsStalls === 1 ? 'worker needs' : 'workers need'} another Marketplace` : ''}</span></li>
      <li><span>Fuel reserve</span><span>${building.firewood.toFixed(0)} firewood + ${(building.charcoal ?? 0).toFixed(0)} charcoal = ${fuelEquivalent.toFixed(0)} fuel-equivalents / ${fuelTarget.toFixed(0)} target · ${formatFuelRunway(fuelRunway, coveredPopulation)}</span></li>
      <li><span>Fuel demand</span><span>${coveredPopulation} covered residents · ${fuelDemandPerDay.toFixed(1)} equivalents/day in ${environment.season} · ${MARKETPLACE_FUEL_RESERVE_DAYS}-day seasonal runway target</span></li>
      <li><span>Distribution</span><span>Every home on the same road network is eligible regardless of distance · nearest stocked Marketplace by exact road length · seven-day pantry issue once per week · daily Town Hall checks cover critical food and heat according to policy · scarce stock goes one household-day per pass, nearest first, with stable household ID as the tie-break</span></li>
      <li><span>Founding exception</span><span>One free camp hauler can stage starter bread and firewood here before permanent depots exist</span></li>
      <li><span>Capacity rule</span><span>${MARKETPLACE_FOOD_STALL_SLOTS + MARKETPLACE_GOODS_STALL_SLOTS} tables fit here: ${MARKETPLACE_FOOD_STALL_SLOTS} food + ${MARKETPLACE_GOODS_STALL_SLOTS} goods · extra connected depot labor needs another Marketplace · stalls cap simultaneous restocking labor, not service radius or household count; available stock still limits each issue</span></li>
      <li><span>Backyard exchange</span><span>Edible surplus becomes physical stall stock for abstract household allocation; herb remedies retain targeted care carts</span></li>
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

function hasStaffedGoodsStall(
  market: BuildingState,
  context: InspectorRenderContext,
  fireDisabled: ReadonlySet<string>,
): boolean {
  return [...context.gameState.buildings.values()].some((candidate) =>
    candidate.kind === 'village_storehouse'
    && candidate.constructionComplete !== false
    && candidate.assignedLabor > 0
    && !fireDisabled.has(candidate.id)
    && context.worldQueries.getRoadPathDistance(
      candidate.x,
      candidate.z,
      market.x,
      market.z,
    ) != null
  );
}

function formatFuelRunway(days: number, population: number): string {
  if (population <= 0 || !Number.isFinite(days)) return 'no covered household demand';
  return `${days.toFixed(1)} days (${(days / 30).toFixed(1)} months)`;
}
