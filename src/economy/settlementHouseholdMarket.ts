import {
  BUILDING_STORAGE_CAPS,
  HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS,
  HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_WATER_CAPACITY,
  SIM_TICK_SECONDS,
  type MarketCommodityOffer,
  type MarketWaterCommodityOffer,
} from '../generated/gameBalance.ts';
import {
  claimResidenceRoutesByNearestSupplier,
  compareStableEntityIds,
} from '../logistics/roadLogistics.ts';
import { residenceFoodRunwayDays } from '../logistics/foodLogistics.ts';
import { residenceWaterRunwayDays } from '../logistics/waterLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import {
  effectiveCommodityGoldCost,
  effectiveWaterCommodityGoldCost,
  type RegionalMarketState,
} from './regionalMarket.ts';
import { gameClock, type GameClock } from '../world/gameCalendar.ts';

export type HouseholdMarketOrderKind = 'food' | 'water';

export type HouseholdMarketOrderQuote = {
  kind: HouseholdMarketOrderKind;
  offerId: string;
  label: string;
  amount: number;
  goldCost: number;
};

export type HouseholdMarketOrderStatus =
  | 'safe'
  | 'ready'
  | 'cooldown'
  | 'closed'
  | 'no-market-route'
  | 'unaffordable'
  | 'market-cart-busy'
  | 'market-storage-full'
  | 'household-storage-full'
  | 'route-too-short'
  | 'fire-disabled';

export type HouseholdMarketResidencePlan = {
  residenceId: string;
  marketplaceId: string | null;
  roadDistance: number | null;
  foodRunwayDays: number;
  waterRunwayDays: number | null;
  foodCritical: boolean;
  waterCritical: boolean;
  critical: boolean;
  urgencyRunwayDays: number;
  status: HouseholdMarketOrderStatus;
  quote: HouseholdMarketOrderQuote | null;
  cooldownTicksRemaining: number;
};

export type HouseholdMarketBranchPlan = {
  marketplaceId: string;
  assignedHomes: number;
  criticalHomes: number;
  affordableCriticalHomes: number;
  readyHomes: number;
  cooldownHomes: number;
  blockedHomes: number;
};

export type SettlementHouseholdMarketPlan = {
  completedMarketplaces: number;
  occupiedHomes: number;
  criticalHomes: number;
  foodCriticalHomes: number;
  waterCriticalHomes: number;
  routedCriticalHomes: number;
  affordableCriticalHomes: number;
  readyHomes: number;
  cooldownHomes: number;
  closedHomes: number;
  unroutedHomes: number;
  unaffordableHomes: number;
  busyCartHomes: number;
  marketStorageBlockedHomes: number;
  householdStorageBlockedHomes: number;
  fireDisabledHomes: number;
  totalHouseholdWealth: number;
  currentLogisticsPaused: boolean;
  firstAttentionResidenceId: string | null;
  residences: Map<string, HouseholdMarketResidencePlan>;
  branches: Map<string, HouseholdMarketBranchPlan>;
};

export type SettlementHouseholdMarketInput = {
  state: GameState;
  marketState: RegionalMarketState;
  roadNetwork: RoadNetwork;
  clock?: GameClock;
  /** True only when the owner enables observance and has a staffed chapel. */
  sabbathObserved: boolean;
  /** Optional narrow projection for inspectors that need only one household. */
  residenceIds?: ReadonlySet<string>;
};

type AttemptResult = {
  status: Exclude<
    HouseholdMarketOrderStatus,
    'safe' | 'cooldown' | 'no-market-route' | 'unaffordable' | 'fire-disabled'
  >;
  quote: HouseholdMarketOrderQuote;
};

/**
 * Mirrors the server's value-per-current-gold selection. Ties prefer the later
 * generated offer, matching Rust Iterator::max_by.
 */
export function bestAffordableHouseholdFoodQuote(
  wealth: number,
  marketState: RegionalMarketState,
): HouseholdMarketOrderQuote | null {
  return bestAffordableQuote(
    MARKET_COMMODITIES,
    wealth,
    (offer) => effectiveCommodityGoldCost(offer, marketState),
    (offer) => offer.foodAmount,
    'food',
  );
}

export function bestAffordableHouseholdWaterQuote(
  wealth: number,
  marketState: RegionalMarketState,
): HouseholdMarketOrderQuote | null {
  return bestAffordableQuote(
    MARKET_WATER_COMMODITIES,
    wealth,
    (offer) => effectiveWaterCommodityGoldCost(offer, marketState),
    (offer) => offer.waterAmount,
    'water',
  );
}

function bestAffordableQuote<T extends MarketCommodityOffer | MarketWaterCommodityOffer>(
  offers: readonly T[],
  wealth: number,
  goldCostFor: (offer: T) => number,
  amountFor: (offer: T) => number,
  kind: HouseholdMarketOrderKind,
): HouseholdMarketOrderQuote | null {
  let best: HouseholdMarketOrderQuote | null = null;
  let bestValue = -Infinity;
  for (const offer of offers) {
    const goldCost = goldCostFor(offer);
    if (goldCost > wealth + 1e-6) continue;
    const amount = amountFor(offer);
    const value = amount / goldCost;
    if (value < bestValue) continue;
    bestValue = value;
    best = {
      kind,
      offerId: offer.id,
      label: offer.label,
      amount,
      goldCost,
    };
  }
  return best;
}

export function computeSettlementHouseholdMarketPlan(
  input: SettlementHouseholdMarketInput,
): SettlementHouseholdMarketPlan {
  const { state, marketState, roadNetwork, sabbathObserved } = input;
  const clock = input.clock ?? gameClock(state.tick);
  const currentLogisticsPaused = !clock.isWorkHours || (clock.isSunday && sabbathObserved);
  const completedMarkets = [...state.buildings.values()].filter(
    (building) =>
      building.kind === 'marketplace'
      && building.constructionComplete !== false,
  );
  const marketsById = new Map(
    completedMarkets.map((marketplace) => [marketplace.id, marketplace]),
  );
  const occupiedResidences = [...state.residences.values()].filter(
    (residence) =>
      !residence.abandoned
      && residence.population > 0
      && (input.residenceIds == null || input.residenceIds.has(residence.id)),
  );
  const fireDisabledResidenceIds = new Set<string>();
  for (const incident of state.fireIncidents.values()) {
    if (incident.targetKind === 'residence') {
      fireDisabledResidenceIds.add(incident.targetId);
    }
  }
  const routeCandidates = occupiedResidences.filter(
    (residence) => !fireDisabledResidenceIds.has(residence.id),
  );
  const routeClaims = claimResidenceRoutesByNearestSupplier(
    roadNetwork,
    completedMarkets,
    routeCandidates,
    () => true,
  );
  const activeMarketTrips = new Set(
    [...state.deliveryTrips.values()].map((trip) => trip.buildingId),
  );
  const residences = new Map<string, HouseholdMarketResidencePlan>();
  const branches = new Map<string, HouseholdMarketBranchPlan>(
    completedMarkets.map((marketplace) => [
      marketplace.id,
      {
        marketplaceId: marketplace.id,
        assignedHomes: 0,
        criticalHomes: 0,
        affordableCriticalHomes: 0,
        readyHomes: 0,
        cooldownHomes: 0,
        blockedHomes: 0,
      },
    ]),
  );

  let criticalHomes = 0;
  let foodCriticalHomes = 0;
  let waterCriticalHomes = 0;
  let routedCriticalHomes = 0;
  let affordableCriticalHomes = 0;
  let readyHomes = 0;
  let cooldownHomes = 0;
  let closedHomes = 0;
  let unroutedHomes = 0;
  let unaffordableHomes = 0;
  let busyCartHomes = 0;
  let marketStorageBlockedHomes = 0;
  let householdStorageBlockedHomes = 0;
  let fireDisabledHomes = 0;
  let totalHouseholdWealth = 0;

  for (const residence of occupiedResidences) {
    totalHouseholdWealth += Math.max(0, residence.householdWealth);
    const foodRunwayDays = residenceFoodRunwayDays(residence) ?? Infinity;
    const waterRunwayDays = residence.tier >= 2
      ? residenceWaterRunwayDays(residence) ?? Infinity
      : null;
    const foodCritical = foodRunwayDays <= HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS;
    const waterCritical = waterRunwayDays != null
      && waterRunwayDays <= HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS;
    const critical = foodCritical || waterCritical;
    const urgencyRunwayDays = Math.min(
      foodCritical ? foodRunwayDays : Infinity,
      waterCritical ? waterRunwayDays ?? Infinity : Infinity,
    );
    const claim = routeClaims.get(residence.id) ?? null;
    const marketplace = claim ? marketsById.get(claim.supplierId) ?? null : null;
    const elapsedCooldownTicks = Math.max(
      0,
      state.tick - Math.max(0, residence.lastHouseholdMarketTick ?? 0),
    );
    const cooldownTicksRemaining = Math.max(
      0,
      HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS - elapsedCooldownTicks,
    );
    const affordableAttempts: HouseholdMarketOrderQuote[] = [];
    if (foodCritical) {
      const foodQuote = bestAffordableHouseholdFoodQuote(
        residence.householdWealth,
        marketState,
      );
      if (foodQuote) affordableAttempts.push(foodQuote);
    }
    if (waterCritical) {
      const waterQuote = bestAffordableHouseholdWaterQuote(
        residence.householdWealth,
        marketState,
      );
      if (waterQuote) affordableAttempts.push(waterQuote);
    }
    let status: HouseholdMarketOrderStatus = 'safe';
    let quote: HouseholdMarketOrderQuote | null = null;

    if (critical) {
      criticalHomes += 1;
      if (foodCritical) foodCriticalHomes += 1;
      if (waterCritical) waterCriticalHomes += 1;

      if (fireDisabledResidenceIds.has(residence.id)) {
        status = 'fire-disabled';
      } else if (cooldownTicksRemaining > 0) {
        status = 'cooldown';
      } else if (!marketplace || !claim) {
        status = 'no-market-route';
      } else if (residence.householdWealth <= 1e-9) {
        status = 'unaffordable';
      } else if (affordableAttempts.length === 0) {
        status = 'unaffordable';
      } else {
        let firstAttempt: AttemptResult | null = null;
        for (const candidate of affordableAttempts) {
          const result = evaluateAttempt(
            residence,
            marketplace,
            candidate,
            claim.distance,
            activeMarketTrips.has(marketplace.id),
            currentLogisticsPaused,
          );
          firstAttempt ??= result;
          if (result.status === 'ready') {
            firstAttempt = result;
            break;
          }
        }
        status = firstAttempt?.status ?? 'unaffordable';
        quote = firstAttempt?.quote ?? null;
      }
    }

    const view: HouseholdMarketResidencePlan = {
      residenceId: residence.id,
      marketplaceId: marketplace?.id ?? null,
      roadDistance: claim?.distance ?? null,
      foodRunwayDays,
      waterRunwayDays,
      foodCritical,
      waterCritical,
      critical,
      urgencyRunwayDays,
      status,
      quote,
      cooldownTicksRemaining,
    };
    residences.set(residence.id, view);

    if (marketplace) {
      const branch = branches.get(marketplace.id)!;
      branch.assignedHomes += 1;
      if (critical) {
        branch.criticalHomes += 1;
        if (affordableAttempts.length > 0) branch.affordableCriticalHomes += 1;
        if (status === 'ready') branch.readyHomes += 1;
        if (status === 'cooldown') branch.cooldownHomes += 1;
        if (status !== 'ready') branch.blockedHomes += 1;
      }
    }

    if (!critical) continue;
    if (marketplace && claim != null && claim.distance > 1e-6) {
      routedCriticalHomes += 1;
    }
    if (affordableAttempts.length > 0) affordableCriticalHomes += 1;
    switch (status) {
      case 'ready': readyHomes += 1; break;
      case 'cooldown': cooldownHomes += 1; break;
      case 'closed': closedHomes += 1; break;
      case 'no-market-route':
      case 'route-too-short': unroutedHomes += 1; break;
      case 'unaffordable': unaffordableHomes += 1; break;
      case 'market-cart-busy': busyCartHomes += 1; break;
      case 'market-storage-full': marketStorageBlockedHomes += 1; break;
      case 'household-storage-full': householdStorageBlockedHomes += 1; break;
      case 'fire-disabled': fireDisabledHomes += 1; break;
      case 'safe': break;
    }
  }

  const attention = [...residences.values()]
    .filter((view) => view.critical)
    .sort((left, right) => {
      const leftBlocked = left.status === 'ready' ? 1 : 0;
      const rightBlocked = right.status === 'ready' ? 1 : 0;
      return leftBlocked - rightBlocked
        || left.urgencyRunwayDays - right.urgencyRunwayDays
        || compareStableEntityIds(left.residenceId, right.residenceId);
    })[0] ?? null;

  return {
    completedMarketplaces: completedMarkets.length,
    occupiedHomes: occupiedResidences.length,
    criticalHomes,
    foodCriticalHomes,
    waterCriticalHomes,
    routedCriticalHomes,
    affordableCriticalHomes,
    readyHomes,
    cooldownHomes,
    closedHomes,
    unroutedHomes,
    unaffordableHomes,
    busyCartHomes,
    marketStorageBlockedHomes,
    householdStorageBlockedHomes,
    fireDisabledHomes,
    totalHouseholdWealth,
    currentLogisticsPaused,
    firstAttentionResidenceId: attention?.residenceId ?? null,
    residences,
    branches,
  };
}

function evaluateAttempt(
  residence: ResidenceState,
  marketplace: BuildingState,
  quote: HouseholdMarketOrderQuote,
  roadDistance: number,
  marketCartBusy: boolean,
  logisticsPaused: boolean,
): AttemptResult {
  if (logisticsPaused) return { status: 'closed', quote };
  const marketCapacity = quote.kind === 'food'
    ? BUILDING_STORAGE_CAPS.marketplace.food
    : Math.max(
        marketplace.waterCapacity,
        BUILDING_STORAGE_CAPS.marketplace.water,
      );
  const marketStock = quote.kind === 'food' ? marketplace.food : marketplace.water;
  if (marketCapacity - marketStock + 1e-6 < quote.amount) {
    return { status: 'market-storage-full', quote };
  }
  if (marketCartBusy) return { status: 'market-cart-busy', quote };
  const householdStock = getNeedStock(residence.needs, quote.kind);
  const householdCapacity = quote.kind === 'food'
    ? RESIDENCE_FOOD_CAPACITY
    : RESIDENCE_WATER_CAPACITY;
  if (householdCapacity - householdStock + 1e-6 < quote.amount) {
    return { status: 'household-storage-full', quote };
  }
  if (!Number.isFinite(roadDistance) || roadDistance <= 1e-6) {
    return { status: 'route-too-short', quote };
  }
  return { status: 'ready', quote };
}

export function formatHouseholdMarketResidenceStatus(
  plan: HouseholdMarketResidencePlan | null,
  marketplaceLabel = 'marketplace',
): string {
  if (!plan) return 'No occupied household';
  if (!plan.critical) {
    return `Standing order idle - triggers at ${Math.round(HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS * 24)}h of food or active water runway`;
  }
  const order = plan.quote
    ? `${plan.quote.label}: ${plan.quote.amount} ${plan.quote.kind} for ${plan.quote.goldCost} gold`
    : null;
  switch (plan.status) {
    case 'ready':
      return `${order} - ready from ${marketplaceLabel}`;
    case 'cooldown':
      return `Standing order cools down for ${formatCooldownSeconds(plan.cooldownTicksRemaining)} more`;
    case 'closed':
      return `${order} - cart rests until work hours`;
    case 'no-market-route':
    case 'route-too-short':
      return 'Blocked - no usable completed marketplace route';
    case 'unaffordable':
      return 'Blocked - savings cannot fund a current food or water lot';
    case 'market-cart-busy':
      return `${order} - market cart already on the road`;
    case 'market-storage-full':
      return `${order} - market needs room to stage the full lot`;
    case 'household-storage-full':
      return `${order} - household needs room for the full lot`;
    case 'fire-disabled':
      return 'Paused - fire damage disables household orders';
    case 'safe':
      return 'Standing order idle';
  }
}

export function formatHouseholdMarketSettlementSummary(
  plan: SettlementHouseholdMarketPlan,
): string {
  if (plan.occupiedHomes === 0) return 'No occupied households';
  if (plan.criticalHomes === 0) {
    return `${plan.occupiedHomes} homes above the ${Math.round(HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS * 24)}h trigger`;
  }
  return `${plan.criticalHomes} critical - ${plan.readyHomes} ready now - ${plan.routedCriticalHomes} market-routed`;
}

export function formatHouseholdMarketPurchasingPower(
  plan: SettlementHouseholdMarketPlan,
): string {
  if (plan.criticalHomes === 0) {
    return `${plan.totalHouseholdWealth.toFixed(1)} gold saved - no emergency lots due`;
  }
  return `${plan.affordableCriticalHomes} / ${plan.criticalHomes} critical homes can fund one current lot - ${plan.totalHouseholdWealth.toFixed(1)} gold saved`;
}

export function formatHouseholdMarketBottlenecks(
  plan: SettlementHouseholdMarketPlan,
): string {
  const parts: string[] = [];
  if (plan.unroutedHomes > 0) parts.push(`${plan.unroutedHomes} off market roads`);
  if (plan.unaffordableHomes > 0) parts.push(`${plan.unaffordableHomes} cannot afford a lot`);
  if (plan.cooldownHomes > 0) parts.push(`${plan.cooldownHomes} cooling down`);
  if (plan.busyCartHomes > 0) parts.push(`${plan.busyCartHomes} behind busy carts`);
  const storageBlocked = plan.marketStorageBlockedHomes + plan.householdStorageBlockedHomes;
  if (storageBlocked > 0) parts.push(`${storageBlocked} full-lot storage blocked`);
  if (plan.closedHomes > 0) parts.push(`${plan.closedHomes} waiting for work hours`);
  if (plan.fireDisabledHomes > 0) parts.push(`${plan.fireDisabledHomes} fire disabled`);
  return parts.length > 0 ? parts.join(' - ') : 'No current emergency-order bottleneck';
}

export function formatHouseholdMarketBranch(
  branch: HouseholdMarketBranchPlan | null,
): string {
  if (!branch) return 'No households assigned to this market';
  if (branch.criticalHomes === 0) {
    return `${branch.assignedHomes} nearest road-linked homes - none below emergency runway`;
  }
  return `${branch.criticalHomes} / ${branch.assignedHomes} homes critical - ${branch.affordableCriticalHomes} can pay - ${branch.readyHomes} ready now`;
}

function formatCooldownSeconds(ticks: number): string {
  const seconds = Math.max(0, ticks) * SIM_TICK_SECONDS;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds)}s`;
}
