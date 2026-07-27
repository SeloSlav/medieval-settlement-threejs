import {
  GUARDHOUSE_PAYROLL_REORDER_DAYS,
  GUARDHOUSE_PAYROLL_TARGET_DAYS,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../generated/gameBalance.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { BuildingState } from '../resources/types.ts';
import { armedGuardCount } from './frontierSecurity.ts';

export const GUARDHOUSE_PAY_PRIORITY_LOW = 0;
export const GUARDHOUSE_PAY_PRIORITY_NORMAL = 1;
export const GUARDHOUSE_PAY_PRIORITY_HIGH = 2;

export const GUARDHOUSE_PAY_PRIORITIES = [
  { priority: GUARDHOUSE_PAY_PRIORITY_LOW, label: 'Low' },
  { priority: GUARDHOUSE_PAY_PRIORITY_NORMAL, label: 'Normal' },
  { priority: GUARDHOUSE_PAY_PRIORITY_HIGH, label: 'High' },
] as const;
const NO_FIRE_DISABLED_BUILDINGS: ReadonlySet<string> = new Set();

export type GuardhousePayrollEntry = {
  building: BuildingState;
  priority: number;
  armedGuards: number;
  dailyWage: number;
  onsiteGold: number;
  inTransitGold: number;
  securedGold: number;
  targetGold: number;
  reorderGold: number;
  fundedGold: number;
  fundedRatio: number;
  claimPosition: number;
  companyCount: number;
};

export type GuardhousePayrollLogisticsStatus =
  | 'inactive'
  | 'legacy'
  | 'stocked'
  | 'en-route'
  | 'ready'
  | 'no-treasury'
  | 'no-gold'
  | 'no-road'
  | 'no-hauler'
  | 'treasury-busy';

export type GuardhousePayrollLogisticsPlan = {
  armedGuards: number;
  dailyWage: number;
  onsiteGold: number;
  inTransitGold: number;
  securedGold: number;
  targetGold: number;
  reorderGold: number;
  onsiteRunwayDays: number;
  securedRunwayDays: number;
  cartLoad: number;
  source: BuildingState | null;
  routeDistance: number | null;
  activeTrip: DeliveryTripState | null;
  status: GuardhousePayrollLogisticsStatus;
};

export function normalizeGuardhousePayPriority(priority: number | undefined): number {
  if (!Number.isFinite(priority)) return GUARDHOUSE_PAY_PRIORITY_NORMAL;
  return Math.max(
    GUARDHOUSE_PAY_PRIORITY_LOW,
    Math.min(GUARDHOUSE_PAY_PRIORITY_HIGH, Math.floor(priority ?? GUARDHOUSE_PAY_PRIORITY_NORMAL)),
  );
}

export function guardhousePayPriorityLabel(priority: number | undefined): string {
  const normalized = normalizeGuardhousePayPriority(priority);
  return GUARDHOUSE_PAY_PRIORITIES.find((candidate) => candidate.priority === normalized)?.label
    ?? 'Normal';
}

export function guardhouseDailyWage(armedGuards: number): number {
  return Math.max(0, armedGuards) * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
}

export function guardhousePayrollTarget(armedGuards: number): number {
  return guardhouseDailyWage(armedGuards) * Math.max(0, GUARDHOUSE_PAYROLL_TARGET_DAYS);
}

export function guardhousePayrollReorderPoint(armedGuards: number): number {
  return guardhouseDailyWage(armedGuards)
    * Math.max(
      0,
      Math.min(GUARDHOUSE_PAYROLL_TARGET_DAYS, GUARDHOUSE_PAYROLL_REORDER_DAYS),
    );
}

export function guardhousePayrollCartLoad(options: {
  armedGuards: number;
  onsiteGold: number;
  inTransitGold: number;
  treasuryGold: number;
  cartCapacity?: number;
}): number {
  const securedGold = finiteStock(options.onsiteGold) + finiteStock(options.inTransitGold);
  const reorderGold = guardhousePayrollReorderPoint(options.armedGuards);
  if (
    options.armedGuards <= 1e-9
    || securedGold + 1e-9 >= reorderGold
    || options.treasuryGold <= 1e-9
  ) {
    return 0;
  }
  return Math.min(
    Math.max(0, guardhousePayrollTarget(options.armedGuards) - securedGold),
    finiteStock(options.treasuryGold),
    finiteStock(options.cartCapacity ?? STOREHOUSE_HAUL_PER_WORKER),
  );
}

export function guardhousePayrollInTransitGold(
  trips: Iterable<DeliveryTripState>,
): Map<string, number> {
  const byGuardhouse = new Map<string, number>();
  for (const trip of trips) {
    if (
      trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.cargoKind !== 'gold'
      || trip.phase === 'inbound'
    ) {
      continue;
    }
    byGuardhouse.set(
      trip.targetBuildingId,
      (byGuardhouse.get(trip.targetBuildingId) ?? 0) + finiteStock(trip.amount),
    );
  }
  return byGuardhouse;
}

/**
 * Projects how today's treasury would fund one day of guard wages if no more
 * income arrived. This mirrors the server's priority buckets and stable
 * within-tier building order; the server applies the same order continuously.
 */
export function guardhousePayrollPlan(
  buildings: Iterable<BuildingState>,
  treasuryGold: number,
  fireDisabledBuildingIds: ReadonlySet<string> = NO_FIRE_DISABLED_BUILDINGS,
  inTransitGoldByGuardhouse: ReadonlyMap<string, number> = new Map(),
): GuardhousePayrollEntry[] {
  const companies = [...buildings]
    .filter((building) =>
      building.kind === 'guardhouse'
      && building.constructionComplete !== false
      && !fireDisabledBuildingIds.has(building.id)
      && armedGuardCount(building.assignedLabor, building.polearms) > 0
    )
    .sort((left, right) => {
      const priorityOrder = normalizeGuardhousePayPriority(right.guardhousePayPriority)
        - normalizeGuardhousePayPriority(left.guardhousePayPriority);
      return priorityOrder !== 0 ? priorityOrder : compareBuildingIds(left.id, right.id);
    });

  let availableGold = Math.max(0, treasuryGold);
  return companies.map((building, index) => {
    const armedGuards = armedGuardCount(building.assignedLabor, building.polearms);
    const dailyWage = guardhouseDailyWage(armedGuards);
    const onsiteGold = finiteStock(building.gold);
    const inTransitGold = finiteStock(inTransitGoldByGuardhouse.get(building.id) ?? 0);
    const securedGold = onsiteGold + inTransitGold;
    const treasuryClaim = Math.min(Math.max(0, dailyWage - securedGold), availableGold);
    availableGold -= treasuryClaim;
    const fundedGold = Math.min(dailyWage, securedGold + treasuryClaim);
    return {
      building,
      priority: normalizeGuardhousePayPriority(building.guardhousePayPriority),
      armedGuards,
      dailyWage,
      onsiteGold,
      inTransitGold,
      securedGold,
      targetGold: guardhousePayrollTarget(armedGuards),
      reorderGold: guardhousePayrollReorderPoint(armedGuards),
      fundedGold,
      fundedRatio: dailyWage > 1e-9 ? fundedGold / dailyWage : 1,
      claimPosition: index + 1,
      companyCount: companies.length,
    };
  });
}

export function guardhousePayrollLogisticsPlan(options: {
  guardhouse: BuildingState;
  buildings: Iterable<BuildingState>;
  trips: Iterable<DeliveryTripState>;
  physicalEconomy: boolean;
  freeHaulers: number;
  getRoadPathDistance: (
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => number | null;
}): GuardhousePayrollLogisticsPlan {
  const buildings = [...options.buildings];
  const trips = [...options.trips];
  const armedGuards = armedGuardCount(
    options.guardhouse.assignedLabor,
    options.guardhouse.polearms,
  );
  const dailyWage = guardhouseDailyWage(armedGuards);
  const onsiteGold = finiteStock(options.guardhouse.gold);
  const incomingTrips = trips
    .filter(
      (trip) =>
        trip.destinationKind === 'building'
        && trip.targetBuildingId === options.guardhouse.id
        && trip.cargoKind === 'gold'
        && trip.phase !== 'inbound',
    )
    .sort((left, right) => compareBuildingIds(left.id, right.id));
  const inTransitGold = incomingTrips.reduce(
    (sum, trip) => sum + finiteStock(trip.amount),
    0,
  );
  const securedGold = onsiteGold + inTransitGold;
  const targetGold = guardhousePayrollTarget(armedGuards);
  const reorderGold = guardhousePayrollReorderPoint(armedGuards);
  const activeTrip = incomingTrips[0] ?? null;
  const activeSource = activeTrip
    ? buildings.find((building) => building.id === activeTrip.buildingId) ?? null
    : null;
  const treasurySeats = buildings
    .filter(
      (building) =>
        building.constructionComplete !== false
        && (
          building.kind === 'town_hall'
          || building.kind === 'founders_camp'
          || building.kind === 'salvage_pile'
        ),
    )
    .sort(compareTreasurySeats);
  const stockedSources = treasurySeats.filter((building) => finiteStock(building.gold) > 1e-9);
  const busySources = new Set(
    trips
      .filter((trip) => treasurySeats.some((seat) => seat.id === trip.buildingId))
      .map((trip) => trip.buildingId),
  );
  const reachableSources = stockedSources
    .map((source) => ({
      source,
      routeDistance: options.getRoadPathDistance(
        source.x,
        source.z,
        options.guardhouse.x,
        options.guardhouse.z,
      ),
    }))
    .filter(
      (candidate): candidate is { source: BuildingState; routeDistance: number } =>
        candidate.routeDistance !== null,
    );
  const dispatchSource = reachableSources.find(
    (candidate) => !busySources.has(candidate.source.id),
  ) ?? null;
  const source = activeSource
    ?? dispatchSource?.source
    ?? reachableSources[0]?.source
    ?? stockedSources[0]
    ?? treasurySeats[0]
    ?? null;
  const routeDistance = source
    ? options.getRoadPathDistance(
        source.x,
        source.z,
        options.guardhouse.x,
        options.guardhouse.z,
      )
    : null;
  const status: GuardhousePayrollLogisticsStatus = armedGuards <= 1e-9
    ? 'inactive'
    : !options.physicalEconomy
      ? 'legacy'
      : activeTrip
        ? 'en-route'
        : securedGold + 1e-9 >= reorderGold
          ? 'stocked'
          : treasurySeats.length === 0
            ? 'no-treasury'
            : stockedSources.length === 0
              ? 'no-gold'
              : reachableSources.length === 0
                ? 'no-road'
                : options.freeHaulers <= 0
                  ? 'no-hauler'
                  : dispatchSource === null
                    ? 'treasury-busy'
                    : 'ready';
  return {
    armedGuards,
    dailyWage,
    onsiteGold,
    inTransitGold,
    securedGold,
    targetGold,
    reorderGold,
    onsiteRunwayDays: runwayDays(onsiteGold, dailyWage),
    securedRunwayDays: runwayDays(securedGold, dailyWage),
    cartLoad: guardhousePayrollCartLoad({
      armedGuards,
      onsiteGold,
      inTransitGold,
      treasuryGold: dispatchSource?.source.gold ?? 0,
    }),
    source,
    routeDistance,
    activeTrip,
    status,
  };
}

function compareTreasurySeats(left: BuildingState, right: BuildingState): number {
  const priority = (building: BuildingState): number => {
    if (building.kind === 'town_hall') return 0;
    if (building.kind === 'founders_camp') return 1;
    return 2;
  };
  return priority(left) - priority(right) || compareBuildingIds(left.id, right.id);
}

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function runwayDays(stock: number, dailyUse: number): number {
  return dailyUse > 1e-9 ? stock / dailyUse : Number.POSITIVE_INFINITY;
}

function compareBuildingIds(left: string, right: string): number {
  const leftMatch = /^building-(\d+)$/.exec(left);
  const rightMatch = /^building-(\d+)$/.exec(right);
  if (leftMatch && rightMatch) {
    const leftId = BigInt(leftMatch[1]);
    const rightId = BigInt(rightMatch[1]);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left.localeCompare(right);
}
