import {
  FOOD_PER_DELIVERY,
  HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION,
  HOUSEHOLD_FOOD_RESERVE_PER_CLAIM,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import type { ResidenceState } from '../resources/types.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { foodDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { lodgeLaborAlternates, lodgeLaborSplit } from './lodgeLogistics.ts';
import {
  compareStableEntityIds,
  roadPathDistance,
  roadPathDistancesFrom,
} from './roadLogistics.ts';
import { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';

export type FoodLaborSplit = {
  harvesting: number;
  delivering: number;
};

export type GranaryDispatchDuty = 'households' | 'preservation';

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
  const distanceA = roadPathDistance(network, supplier.x, supplier.z, a.x, a.z) ?? Infinity;
  const distanceB = roadPathDistance(network, supplier.x, supplier.z, b.x, b.z) ?? Infinity;
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
  const distances = roadPathDistancesFrom(network, supplier.x, supplier.z, eligible);
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
