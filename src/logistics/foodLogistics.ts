import {
  BUILDING_STORAGE_CAPS,
  FOOD_PER_DELIVERY,
  HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION,
  HOUSEHOLD_FOOD_RESERVE_PER_CLAIM,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  SMOKEHOUSE_FOOD_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { granaryFreshFoodTarget } from '../economy/granaryPolicy.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from '../economy/staffingPriority.ts';
import {
  GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
  guardhouseFoodRunwayDays,
  guardhouseFoodTarget,
} from '../security/frontierSecurity.ts';
import type { BuildingKind, BuildingState, ResidenceState } from '../resources/types.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { foodDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { lodgeLaborAlternates, lodgeLaborSplit } from './lodgeLogistics.ts';
import {
  processorInputRunwayCycles,
  processorInputTarget,
} from './processorInputLogistics.ts';
import {
  compareStableEntityIds,
  localDeliveryDistance,
  localDeliveryDistancesFrom,
} from './roadLogistics.ts';
import { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';

export type FoodLaborSplit = {
  harvesting: number;
  delivering: number;
};

export type GranaryDispatchDuty = 'households' | 'preservation';
export type InstitutionalFoodDispatchDuty =
  | 'critical-guard'
  | 'preservation-buffer'
  | 'guard-reserve'
  | 'granary-intake';

export const INSTITUTIONAL_FOOD_SOURCE_KINDS = [
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'apiary',
  'vineyard',
  'pastoral_farmstead',
  'swineherd',
] as const satisfies readonly BuildingKind[];

type InstitutionalFoodDestinationLike = Pick<
  BuildingState,
  | 'id'
  | 'kind'
  | 'food'
  | 'polearms'
  | 'assignedLabor'
  | 'constructionComplete'
  | 'constructionPriority'
  | 'processorOutputTargetPercent'
  | 'guardhousePayPriority'
  | 'guardhouseFoodReserve'
  | 'granaryAcceptsFreshFood'
  | 'granaryFreshFoodTargetPercent'
>;

export type RoutedInstitutionalFoodDestination<
  T extends InstitutionalFoodDestinationLike,
> = {
  target: T;
  duty: InstitutionalFoodDispatchDuty;
  desiredStock: number;
  runway: number;
  routeDistance: number;
  priority: StaffingPriority;
};

export function granaryDispatchOrder(householdsFirst: boolean): GranaryDispatchDuty[] {
  return householdsFirst
    ? ['households', 'preservation']
    : ['preservation', 'households'];
}

export function granaryDispatchPriorityLabel(householdsFirst: boolean): string {
  return householdsFirst ? 'Households first' : 'Winter preservation first';
}

export function foodLaborSplit(assignedLabor: number): FoodLaborSplit {
  const split = lodgeLaborSplit(assignedLabor);
  return { harvesting: split.processing, delivering: split.delivering };
}

export function foodLaborAlternates(assignedLabor: number): boolean {
  return lodgeLaborAlternates(assignedLabor);
}

export function formatFoodCrewSplit(assignedLabor: number): string {
  const split = foodLaborSplit(assignedLabor);
  if (split.harvesting === 0 && split.delivering === 0) return 'None assigned';
  if (foodLaborAlternates(assignedLabor)) return '1 worker — alternates harvesting & delivery';
  if (split.delivering === 0) return `${split.harvesting} harvesting`;
  return `${split.harvesting} harvesting · ${split.delivering} delivering`;
}

export function foodPerDelivery(deliveryWorkers: number): number {
  if (deliveryWorkers <= 0) return 0;
  return FOOD_PER_DELIVERY * deliveryWorkers;
}

export function householdFoodReserve(
  claimedHouseholds: number,
  sourceCapacity: number,
): number {
  return Math.max(
    0,
    Math.min(
      Math.max(0, claimedHouseholds) * HOUSEHOLD_FOOD_RESERVE_PER_CLAIM,
      Math.max(0, sourceCapacity) * HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION,
    ),
  );
}

export function institutionalFoodSurplus(
  sourceStock: number,
  claimedHouseholds: number,
  sourceCapacity: number,
): number {
  return Math.max(
    0,
    sourceStock - householdFoodReserve(claimedHouseholds, sourceCapacity),
  );
}

export function residenceFoodRunwaySeconds(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0) return null;
  const stock = getNeedStock(residence.needs, 'food');
  const usePerSec = residence.population * RESIDENCE_FOOD_PER_PERSON_PER_SEC;
  if (usePerSec <= 1e-9) return null;
  return stock / usePerSec;
}

export function residenceFoodRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceFoodRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / GAME_DAY_SECONDS;
}

export function formatFoodRunwayDays(days: number): string {
  if (days >= 2) return `${days.toFixed(1)} days`;
  const hours = Math.max(1, Math.round(days * 24));
  return `${hours}h`;
}

export function compareResidencesForFoodDelivery(
  network: RoadNetwork,
  supplier: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
): number {
  if (a.abandoned !== b.abandoned) {
    return a.abandoned ? 1 : -1;
  }
  const runwayA = residenceFoodRunwaySeconds(a) ?? Infinity;
  const runwayB = residenceFoodRunwaySeconds(b) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = localDeliveryDistance(network, supplier.x, supplier.z, a.x, a.z) ?? Infinity;
  const distanceB = localDeliveryDistance(network, supplier.x, supplier.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function peekNextFoodDeliveryTarget(
  network: RoadNetwork,
  supplier: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  const eligible = residences.filter((residence) =>
    !residence.abandoned
    && residence.population > 0
    && getNeedStock(residence.needs, 'food') + 1e-6 < RESIDENCE_FOOD_CAPACITY);
  const distances = localDeliveryDistancesFrom(network, supplier.x, supplier.z, eligible);
  let bestIndex = -1;
  for (let index = 0; index < eligible.length; index += 1) {
    const distance = distances[index];
    if (distance == null) continue;
    if (bestIndex < 0) {
      bestIndex = index;
      continue;
    }
    const runway = residenceFoodRunwaySeconds(eligible[index]) ?? Infinity;
    const bestRunway = residenceFoodRunwaySeconds(eligible[bestIndex]) ?? Infinity;
    if (
      runway + 1e-6 < bestRunway
      || (
        Math.abs(runway - bestRunway) <= 1e-6
        && (
          distance + 1e-6 < distances[bestIndex]!
          || (
            Math.abs(distance - distances[bestIndex]!) <= 1e-6
            && compareStableEntityIds(eligible[index].id, eligible[bestIndex].id) < 0
          )
        )
      )
    ) {
      bestIndex = index;
    }
  }
  return bestIndex < 0 ? null : eligible[bestIndex];
}

/**
 * Mirrors the server's producer-owned institutional food decision. Household
 * claims are protected before this selector is called. A guard emergency
 * leads, followed by a smokehouse working batch, routine guard reserves, and
 * finally enabled granary collection. Within a duty, selected priority,
 * lowest runway, road distance, and stable id decide.
 */
export function selectInstitutionalFoodTarget<
  T extends InstitutionalFoodDestinationLike,
>(
  targets: Iterable<T>,
  sourceId: string,
  conflictEnabled: boolean,
  routeDistanceFor: (target: T) => number | null,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsFood: (target: T) => boolean = () => true,
): RoutedInstitutionalFoodDestination<T> | null {
  let best: RoutedInstitutionalFoodDestination<T> | null = null;
  for (const target of targets) {
    if (
      target.id === sourceId
      || target.constructionComplete === false
      || target.assignedLabor <= 0
      || hasInboundSupply(target)
    ) continue;
    const plan = institutionalFoodTargetPlan(
      target,
      conflictEnabled,
      acceptsFood(target),
    );
    if (plan == null) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate = { target, routeDistance, ...plan };
    if (best == null || institutionalFoodCandidatePrecedes(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

export function institutionalFoodDutyLabel(
  duty: InstitutionalFoodDispatchDuty,
): string {
  switch (duty) {
    case 'critical-guard': return 'Emergency company rations';
    case 'preservation-buffer': return 'Smokehouse working batch';
    case 'guard-reserve': return 'Company ration reserve';
    case 'granary-intake': return 'Granary fresh-food reserve';
  }
}

function institutionalFoodTargetPlan<T extends InstitutionalFoodDestinationLike>(
  target: T,
  conflictEnabled: boolean,
  acceptsFood: boolean,
): Omit<RoutedInstitutionalFoodDestination<T>, 'target' | 'routeDistance'> | null {
  if (target.kind === 'guardhouse' && conflictEnabled) {
    const desiredStock = guardhouseFoodTarget(
      target.assignedLabor,
      target.polearms,
      target.guardhouseFoodReserve,
    );
    if (desiredStock <= 1e-6 || target.food + 1e-6 >= desiredStock) return null;
    const runway = guardhouseFoodRunwayDays(
      target.assignedLabor,
      target.polearms,
      target.food,
    );
    return {
      duty: runway + 1e-9 < GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS
        ? 'critical-guard'
        : 'guard-reserve',
      desiredStock,
      runway,
      priority: normalizeStaffingPriority(
        Math.max(1, Math.min(3, (target.guardhousePayPriority ?? 1) + 1)),
      ),
    };
  }
  if (target.kind === 'smokehouse' && acceptsFood) {
    const desiredStock = processorInputTarget(
      SMOKEHOUSE_FOOD_PER_CYCLE,
      target.processorOutputTargetPercent,
    );
    if (desiredStock <= 1e-6 || target.food + 1e-6 >= desiredStock) return null;
    return {
      duty: 'preservation-buffer',
      desiredStock,
      runway: processorInputRunwayCycles(
        target.food,
        SMOKEHOUSE_FOOD_PER_CYCLE,
      ),
      priority: normalizeStaffingPriority(target.constructionPriority),
    };
  }
  if (target.kind === 'granary' && target.granaryAcceptsFreshFood !== false) {
    const desiredStock = granaryFreshFoodTarget(
      BUILDING_STORAGE_CAPS.granary.food ?? 0,
      target.granaryFreshFoodTargetPercent,
    );
    if (desiredStock <= 1e-6 || target.food + 1e-6 >= desiredStock) return null;
    return {
      duty: 'granary-intake',
      desiredStock,
      runway: Math.max(0, target.food) / desiredStock,
      priority: normalizeStaffingPriority(target.constructionPriority),
    };
  }
  return null;
}

function institutionalFoodCandidatePrecedes<
  T extends InstitutionalFoodDestinationLike,
>(
  left: RoutedInstitutionalFoodDestination<T>,
  right: RoutedInstitutionalFoodDestination<T>,
): boolean {
  const dutyRank: Record<InstitutionalFoodDispatchDuty, number> = {
    'critical-guard': 0,
    'preservation-buffer': 1,
    'guard-reserve': 2,
    'granary-intake': 3,
  };
  if (dutyRank[left.duty] !== dutyRank[right.duty]) {
    return dutyRank[left.duty] < dutyRank[right.duty];
  }
  if (
    left.duty !== 'critical-guard'
    && left.priority !== right.priority
  ) {
    return left.priority > right.priority;
  }
  if (Math.abs(left.runway - right.runway) > 1e-9) {
    return left.runway < right.runway;
  }
  if (Math.abs(left.routeDistance - right.routeDistance) > 1e-6) {
    return left.routeDistance < right.routeDistance;
  }
  return compareStableEntityIds(left.target.id, right.target.id) < 0;
}

export function foodSupplierDeliveryTripSeconds(
  network: RoadNetwork,
  supplier: { x: number; z: number },
  target: { x: number; z: number } | null,
  deliveryWorkers: number,
  travelSpeedMultiplier = 1,
): number {
  return foodDeliveryTripSeconds(
    network,
    supplier,
    target,
    deliveryWorkers,
    travelSpeedMultiplier,
  );
}
