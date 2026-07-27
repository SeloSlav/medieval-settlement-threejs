import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_SECONDS_PER_DAY,
  CHAPEL_CHARITY_GOLD_PER_DAY,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
  CHAPEL_POOR_RELIEF_INTERVAL_DAYS,
  HOUSEHOLD_MAX_WEALTH,
  RESIDENCE_FOOD_CAPACITY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import {
  claimResidenceRoutesByNearestSupplier,
  compareStableEntityIds,
} from '../logistics/roadLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { chapelCofferGold } from '../resources/chapelCoffer.ts';
import type {
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import { gameClock, type GameClock } from '../world/gameCalendar.ts';
import type { RegionalMarketState } from './regionalMarket.ts';
import {
  bestAffordableHouseholdFoodQuote,
  type HouseholdMarketOrderQuote,
} from './settlementHouseholdMarket.ts';

export type ParishReliefStatus =
  | 'unbuilt'
  | 'unstaffed'
  | 'fire-disabled'
  | 'below-coffer-threshold'
  | 'no-relief-home'
  | 'no-market-route'
  | 'market-fire-disabled'
  | 'unaffordable'
  | 'household-storage-full'
  | 'not-due'
  | 'closed'
  | 'market-storage-full'
  | 'market-cart-busy'
  | 'route-too-short'
  | 'ready';

export type ChapelReliefPlan = {
  chapelId: string;
  staffed: boolean;
  assignedHomes: number;
  occupiedHomes: number;
  assignedPopulation: number;
  almsRecipientId: string | null;
  reliefHomes: number;
  targetResidenceId: string | null;
  marketplaceId: string | null;
  marketRoadDistance: number | null;
  cofferGold: number;
  reliefBudget: number;
  quote: HouseholdMarketOrderQuote | null;
  dueNow: boolean;
  daysUntilDispatch: number;
  status: ParishReliefStatus;
};

export type SettlementParishReliefPlan = {
  completedChapels: number;
  activeParishes: number;
  fireDisabledChapels: number;
  reconstructingChapels: number;
  structurallyQuarantinedCofferGold: number;
  firstUnavailableChapelId: string | null;
  assignedHomes: number;
  assignedPopulation: number;
  unassignedHomes: number;
  fireDisabledHomes: number;
  fireDisabledResidents: number;
  fireDisabledReliefHomes: number;
  dailyAlmsRecipients: number;
  reliefHomes: number;
  dueNow: boolean;
  readyParishes: number;
  blockedParishes: number;
  reserveShortParishes: number;
  marketFireBlockedParishes: number;
  firstAttentionResidenceId: string | null;
  parishes: Map<string, ChapelReliefPlan>;
};

export type SettlementParishReliefInput = {
  state: GameState;
  marketState: RegionalMarketState;
  roadNetwork: RoadNetwork;
  clock?: GameClock;
  /** True only when observance is enabled and at least one staffed chapel exists. */
  sabbathObserved: boolean;
};

const TICKS_PER_DAY = Math.round(CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS);
const RELIEF_INTERVAL_TICKS = TICKS_PER_DAY * CHAPEL_POOR_RELIEF_INTERVAL_DAYS;

export function isChapelPoorReliefDue(simTick: number): boolean {
  const tick = Math.max(0, Math.floor(simTick));
  return RELIEF_INTERVAL_TICKS > 0
    && tick % RELIEF_INTERVAL_TICKS === TICKS_PER_DAY;
}

export function chapelPoorReliefDaysUntilDispatch(simTick: number): number {
  if (RELIEF_INTERVAL_TICKS <= 0) return 0;
  const tick = Math.max(0, Math.floor(simTick));
  const cycleTick = tick % RELIEF_INTERVAL_TICKS;
  const nextTick = cycleTick <= TICKS_PER_DAY
    ? TICKS_PER_DAY
    : TICKS_PER_DAY + RELIEF_INTERVAL_TICKS;
  return Math.max(0, (nextTick - cycleTick) / TICKS_PER_DAY);
}

export function computeSettlementParishReliefPlan(
  input: SettlementParishReliefInput,
): SettlementParishReliefPlan {
  const { state, marketState, roadNetwork } = input;
  const clock = input.clock ?? gameClock(state.tick);
  const dueNow = isChapelPoorReliefDue(state.tick);
  const daysUntilDispatch = chapelPoorReliefDaysUntilDispatch(state.tick);
  const logisticsPaused = !clock.isWorkHours
    || (clock.isSunday && input.sabbathObserved);
  const disabledBuildingIds = fireDisabledBuildingIds(
    state.fireIncidents.values(),
  );
  const disabledResidenceIds = fireDisabledResidenceIds(
    state.fireIncidents.values(),
  );

  const allChapels = [...state.buildings.values()]
    .filter((building) => building.kind === 'chapel')
    .sort((left, right) => compareStableEntityIds(left.id, right.id));
  const completedChapels = allChapels.filter(
    (chapel) => chapel.constructionComplete !== false,
  );
  const reconstructingChapels = allChapels.filter(
    (chapel) =>
      chapel.constructionComplete === false
      && chapelCofferGold(chapel) > 0.05,
  );
  const fireDisabledChapels = completedChapels.filter(
    (chapel) => disabledBuildingIds.has(chapel.id),
  );
  const unavailableChapels = [...fireDisabledChapels, ...reconstructingChapels]
    .sort((left, right) => compareStableEntityIds(left.id, right.id));
  const activeChapels = completedChapels.filter(
    (chapel) =>
      chapel.assignedLabor > 0
      && !disabledBuildingIds.has(chapel.id),
  );
  const completedMarketplaces = [...state.buildings.values()].filter(
    (building) =>
      building.kind === 'marketplace'
      && building.constructionComplete !== false,
  );
  const operationalMarketplaces = completedMarketplaces.filter(
    (marketplace) => !disabledBuildingIds.has(marketplace.id),
  );
  const fireDisabledMarketplaces = completedMarketplaces.filter(
    (marketplace) => disabledBuildingIds.has(marketplace.id),
  );
  const marketsById = new Map(
    completedMarketplaces.map((marketplace) => [marketplace.id, marketplace]),
  );
  const allResidences = [...state.residences.values()];
  const operationalResidences = allResidences.filter(
    (residence) => !disabledResidenceIds.has(residence.id),
  );
  const fireDisabledResidences = allResidences.filter(
    (residence) => disabledResidenceIds.has(residence.id),
  );
  const chapelClaims = claimResidenceRoutesByNearestSupplier(
    roadNetwork,
    activeChapels,
    operationalResidences,
    () => true,
  );
  const abandonedResidences = operationalResidences.filter(
    (residence) => residence.abandoned,
  );
  const marketClaims = claimResidenceRoutesByNearestSupplier(
    roadNetwork,
    operationalMarketplaces,
    abandonedResidences,
    () => true,
  );
  const fireBlockedMarketClaims = fireDisabledMarketplaces.length === 0
    ? new Map()
    : claimResidenceRoutesByNearestSupplier(
        roadNetwork,
        fireDisabledMarketplaces,
        abandonedResidences,
        () => true,
      );
  const activeMarketTrips = new Set(
    [...state.deliveryTrips.values()].map((trip) => trip.buildingId),
  );
  const assignedByChapel = new Map<string, ResidenceState[]>(
    completedChapels.map((chapel) => [chapel.id, []]),
  );
  for (const residence of operationalResidences) {
    const claim = chapelClaims.get(residence.id);
    if (claim) assignedByChapel.get(claim.supplierId)?.push(residence);
  }

  const parishes = new Map<string, ChapelReliefPlan>();
  let assignedHomes = 0;
  let assignedPopulation = 0;
  let dailyAlmsRecipients = 0;
  let reliefHomes = 0;
  let readyParishes = 0;
  let blockedParishes = 0;
  let reserveShortParishes = 0;
  let marketFireBlockedParishes = 0;

  for (const chapel of completedChapels) {
    const assigned = assignedByChapel.get(chapel.id) ?? [];
    const occupied = assigned.filter(
      (residence) => !residence.abandoned && residence.population > 0,
    );
    const almsRecipient = occupied
      .filter((residence) => residence.householdWealth < HOUSEHOLD_MAX_WEALTH - 1e-9)
      .sort(comparePoorestResidence)[0] ?? null;
    const abandoned = assigned.filter((residence) => residence.abandoned);
    const cofferGold = chapelCofferGold(chapel);
    const reliefBudget = Math.min(
      CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
      Math.max(0, cofferGold),
    );
    const quote = bestAffordableHouseholdFoodQuote(reliefBudget, marketState);
    const routed = abandoned
      .filter((residence) => marketClaims.has(residence.id))
      .sort(compareLowestFoodResidence);
    const fireBlockedRouted = abandoned
      .filter(
        (residence) =>
          !marketClaims.has(residence.id)
          && fireBlockedMarketClaims.has(residence.id),
      )
      .sort(compareLowestFoodResidence);
    const target = quote == null
      ? routed[0] ?? null
      : routed.find(
          (residence) =>
            RESIDENCE_FOOD_CAPACITY - getNeedStock(residence.needs, 'food') + 1e-6
              >= quote.amount,
        ) ?? null;
    const fallbackTarget = target ?? routed[0] ?? fireBlockedRouted[0] ?? abandoned
      .slice()
      .sort(compareLowestFoodResidence)[0] ?? null;
    const marketClaim = fallbackTarget == null
      ? null
      : marketClaims.get(fallbackTarget.id)
        ?? fireBlockedMarketClaims.get(fallbackTarget.id)
        ?? null;
    const marketplace = marketClaim == null
      ? null
      : marketsById.get(marketClaim.supplierId) ?? null;
    const staffed = chapel.assignedLabor > 0
      && !disabledBuildingIds.has(chapel.id);

    let status: ParishReliefStatus;
    if (chapel.constructionComplete === false) {
      status = 'unbuilt';
    } else if (disabledBuildingIds.has(chapel.id)) {
      status = 'fire-disabled';
    } else if (chapel.assignedLabor <= 0) {
      status = 'unstaffed';
    } else if (abandoned.length === 0) {
      status = 'no-relief-home';
    } else if (cofferGold < CHAPEL_CHARITY_MIN_COFFER_GOLD) {
      status = 'below-coffer-threshold';
    } else if (routed.length === 0) {
      status = fireBlockedRouted.length > 0
        ? 'market-fire-disabled'
        : 'no-market-route';
    } else if (quote == null) {
      status = 'unaffordable';
    } else if (target == null) {
      status = 'household-storage-full';
    } else if (!dueNow) {
      status = 'not-due';
    } else if (logisticsPaused) {
      status = 'closed';
    } else if (marketplace == null || marketClaim == null) {
      status = 'no-market-route';
    } else if (marketClaim.distance <= 1e-6) {
      status = 'route-too-short';
    } else if (
      BUILDING_STORAGE_CAPS.marketplace.food - marketplace.food + 1e-6
        < quote.amount
    ) {
      status = 'market-storage-full';
    } else if (activeMarketTrips.has(marketplace.id)) {
      status = 'market-cart-busy';
    } else {
      status = 'ready';
    }

    const plan: ChapelReliefPlan = {
      chapelId: chapel.id,
      staffed,
      assignedHomes: assigned.length,
      occupiedHomes: occupied.length,
      assignedPopulation: occupied.reduce(
        (total, residence) => total + residence.population,
        0,
      ),
      almsRecipientId: almsRecipient?.id ?? null,
      reliefHomes: abandoned.length,
      targetResidenceId: fallbackTarget?.id ?? null,
      marketplaceId: marketplace?.id ?? marketClaim?.supplierId ?? null,
      marketRoadDistance: marketClaim?.distance ?? null,
      cofferGold,
      reliefBudget,
      quote,
      dueNow,
      daysUntilDispatch,
      status,
    };
    parishes.set(chapel.id, plan);

    if (staffed) {
      assignedHomes += plan.assignedHomes;
      assignedPopulation += plan.assignedPopulation;
      if (plan.almsRecipientId != null) dailyAlmsRecipients += 1;
      reliefHomes += plan.reliefHomes;
      if (plan.status === 'ready') readyParishes += 1;
      if (
        plan.status !== 'ready'
        && plan.status !== 'not-due'
        && plan.status !== 'no-relief-home'
      ) {
        blockedParishes += 1;
      }
      if (plan.status === 'below-coffer-threshold') reserveShortParishes += 1;
      if (plan.status === 'market-fire-disabled') marketFireBlockedParishes += 1;
    }
  }

  const firstAttention = [...parishes.values()]
    .filter((parish) =>
      parish.staffed
      && parish.targetResidenceId != null
      && parish.status !== 'not-due')
    .sort((left, right) =>
      statusPriority(left.status) - statusPriority(right.status)
      || compareStableEntityIds(left.chapelId, right.chapelId))[0] ?? null;

  return {
    completedChapels: completedChapels.length,
    activeParishes: activeChapels.length,
    fireDisabledChapels: fireDisabledChapels.length,
    reconstructingChapels: reconstructingChapels.length,
    structurallyQuarantinedCofferGold: unavailableChapels.reduce(
      (total, chapel) => total + chapelCofferGold(chapel),
      0,
    ),
    firstUnavailableChapelId: unavailableChapels[0]?.id ?? null,
    assignedHomes,
    assignedPopulation,
    unassignedHomes: Math.max(
      0,
      operationalResidences.length - chapelClaims.size,
    ),
    fireDisabledHomes: fireDisabledResidences.length,
    fireDisabledResidents: fireDisabledResidences.reduce(
      (total, residence) => total + Math.max(0, residence.population),
      0,
    ),
    fireDisabledReliefHomes: fireDisabledResidences.filter(
      (residence) => residence.abandoned,
    ).length,
    dailyAlmsRecipients,
    reliefHomes,
    dueNow,
    readyParishes,
    blockedParishes,
    reserveShortParishes,
    marketFireBlockedParishes,
    firstAttentionResidenceId: firstAttention?.targetResidenceId ?? null,
    parishes,
  };
}

function comparePoorestResidence(
  left: ResidenceState,
  right: ResidenceState,
): number {
  return left.householdWealth - right.householdWealth
    || compareStableEntityIds(left.id, right.id);
}

function compareLowestFoodResidence(
  left: ResidenceState,
  right: ResidenceState,
): number {
  return getNeedStock(left.needs, 'food') - getNeedStock(right.needs, 'food')
    || compareStableEntityIds(left.id, right.id);
}

function statusPriority(status: ParishReliefStatus): number {
  switch (status) {
    case 'ready': return 0;
    case 'market-cart-busy':
    case 'market-storage-full':
    case 'household-storage-full':
    case 'closed': return 1;
    case 'below-coffer-threshold':
    case 'unaffordable': return 2;
    case 'no-market-route':
    case 'route-too-short':
    case 'market-fire-disabled': return 3;
    default: return 4;
  }
}

export function formatChapelParishTerritory(plan: ChapelReliefPlan): string {
  if (plan.status === 'fire-disabled') {
    return 'Parish territory suspended until structural recovery';
  }
  if (!plan.staffed) return 'Inactive until a priest is assigned';
  return `${plan.assignedHomes} nearest-road homes · ${plan.assignedPopulation} villagers`;
}

export function formatChapelDailyAlms(plan: ChapelReliefPlan): string {
  if (plan.status === 'fire-disabled') {
    return 'Paused · coffer sealed during structural recovery';
  }
  if (!plan.staffed) return 'Inactive';
  if (plan.cofferGold < CHAPEL_CHARITY_MIN_COFFER_GOLD) {
    return `Held below ${CHAPEL_CHARITY_MIN_COFFER_GOLD} gold`;
  }
  if (plan.almsRecipientId == null) return 'No occupied household can receive alms';
  return `Poorest parish household · ${CHAPEL_CHARITY_GOLD_PER_DAY.toFixed(2)} gold/day`;
}

export function formatChapelPoorRelief(plan: ChapelReliefPlan): string {
  const order = plan.quote == null
    ? null
    : `${plan.quote.label} · ${plan.quote.amount} food · ${plan.quote.goldCost} gold`;
  switch (plan.status) {
    case 'unbuilt': return 'Complete the chapel first';
    case 'unstaffed': return 'Assign a priest to form a parish';
    case 'fire-disabled': return 'Paused by chapel fire damage';
    case 'below-coffer-threshold':
      return `Held below ${CHAPEL_CHARITY_MIN_COFFER_GOLD} gold coffer threshold`;
    case 'no-relief-home': return 'No abandoned parish home needs a dole';
    case 'no-market-route': return 'Blocked · no shared parish-to-market route';
    case 'market-fire-disabled': return 'Blocked · reachable marketplace is fire-damaged';
    case 'unaffordable': return `Blocked · ${plan.reliefBudget.toFixed(1)} gold cannot fund a full lot`;
    case 'household-storage-full': return 'Blocked · parish homes lack room for a full food lot';
    case 'not-due':
      return `${order ?? 'Food lot ready'} · next Monday in ${formatDays(plan.daysUntilDispatch)}`;
    case 'closed': return `${order ?? 'Food lot'} · carts are resting`;
    case 'market-storage-full': return `${order ?? 'Food lot'} · market cannot stage the full lot`;
    case 'market-cart-busy': return `${order ?? 'Food lot'} · nearest market cart is busy`;
    case 'route-too-short': return `${order ?? 'Food lot'} · route needs a usable road segment`;
    case 'ready': return `${order ?? 'Food lot'} · dispatching this Monday`;
  }
}

export function formatSettlementParishRelief(
  plan: SettlementParishReliefPlan,
): string {
  if (plan.activeParishes === 0) {
    const unavailableChapels = plan.fireDisabledChapels
      + plan.reconstructingChapels;
    return unavailableChapels > 0
      ? `No active parish · ${plan.fireDisabledChapels} fire-disabled + ${plan.reconstructingChapels} reconstructing ${unavailableChapels === 1 ? 'chapel holds' : 'chapels hold'} ${plan.structurallyQuarantinedCofferGold.toFixed(1)} sealed gold`
      : 'No active staffed parish';
  }
  if (!plan.dueNow) {
    const suspended = plan.fireDisabledReliefHomes > 0
      ? ` · ${plan.fireDisabledReliefHomes} damaged abandoned ${plan.fireDisabledReliefHomes === 1 ? 'home waits' : 'homes wait'} for recovery`
      : '';
    return `${plan.activeParishes} parishes · ${plan.reliefHomes} operational abandoned homes in relief territory${suspended}`;
  }
  return `${plan.readyParishes} ready · ${plan.blockedParishes} blocked this Monday`;
}

export function formatSettlementParishCoverage(
  plan: SettlementParishReliefPlan,
): string {
  if (plan.activeParishes === 0) {
    const unavailableChapels = plan.fireDisabledChapels
      + plan.reconstructingChapels;
    return unavailableChapels > 0
      ? `No active territory · ${plan.fireDisabledChapels} fire-disabled + ${plan.reconstructingChapels} reconstructing ${unavailableChapels === 1 ? 'chapel' : 'chapels'}`
      : 'No staffed chapel territories';
  }
  const unassigned = plan.unassignedHomes > 0
    ? ` · ${plan.unassignedHomes} operational ${plan.unassignedHomes === 1 ? 'home' : 'homes'} off parish roads`
    : '';
  const fireDisabled = plan.fireDisabledHomes > 0
    ? ` · ${plan.fireDisabledHomes} fire-disabled ${plan.fireDisabledHomes === 1 ? 'home' : 'homes'} / ${plan.fireDisabledResidents} ${plan.fireDisabledResidents === 1 ? 'resident' : 'residents'} outside parish finance until recovery`
    : '';
  return `${plan.assignedHomes} operational homes · ${plan.assignedPopulation} villagers${unassigned}${fireDisabled}`;
}

function formatDays(days: number): string {
  if (days <= 1e-6) return 'today';
  const rounded = Math.ceil(days);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}
