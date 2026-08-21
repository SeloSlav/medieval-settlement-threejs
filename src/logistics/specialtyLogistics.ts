import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  RESIDENCE_ALE_CAPACITY,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_SHOES_CAPACITY,
  RESIDENCE_SHOES_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_CAPACITY,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import { spoilageAdjustedRunwayDays } from '../economy/foodPreservation.ts';
import type { BuildingKind, BuildingState, ResidenceState } from '../resources/types.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { preservedFoodStock } from '../economy/foodInventory.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  compareStableEntityIds,
  localDeliveryDistance,
  localDeliveryDistancesFrom,
  roadPathDistancesFrom,
} from './roadLogistics.ts';
export const SPECIALTY_CONSUMPTION_SECONDS_PER_DAY =
  CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

export const MONASTERY_MIN_PARISH_POPULATION = 12;

export type SpecialtyNeedKind = 'ale' | 'preservedFood' | 'cloth' | 'shoes' | 'pottery';

const PRESERVED_FOOD_PRODUCER_KINDS: readonly BuildingKind[] = [
  'smokehouse',
  'pastoral_farmstead',
];
const ALE_PRODUCER_KINDS: readonly BuildingKind[] = ['tavern'];
const CLOTH_PRODUCER_KINDS: readonly BuildingKind[] = ['weaver'];
const SHOES_PRODUCER_KINDS: readonly BuildingKind[] = ['cobbler'];
const POTTERY_PRODUCER_KINDS: readonly BuildingKind[] = ['potter_kiln'];
const PRESERVED_FOOD_SUPPLIER_KINDS: readonly BuildingKind[] = ['marketplace'];
const ALE_SUPPLIER_KINDS: readonly BuildingKind[] = ['tavern'];
const CLOTH_SUPPLIER_KINDS: readonly BuildingKind[] = ['marketplace'];
const SHOES_SUPPLIER_KINDS: readonly BuildingKind[] = ['marketplace'];
const POTTERY_SUPPLIER_KINDS: readonly BuildingKind[] = ['marketplace'];

export function isOperationalSpecialtySupplier(building: BuildingState): boolean {
  return (building.kind === 'marketplace' || building.kind === 'tavern')
    && building.constructionComplete !== false
    && (building.kind !== 'tavern' || building.assignedLabor > 0);
}

export function isSustainableSpecialtySupplier(building: BuildingState): boolean {
  return building.constructionComplete !== false
    && building.assignedLabor > 0;
}

export function findRoadLinkedSupplierForResidence(
  residence: ResidenceState,
  buildings: Iterable<BuildingState>,
  network: RoadNetwork,
  needKind: SpecialtyNeedKind,
  eligible: (building: BuildingState, roadDistance: number) => boolean = () => true,
): BuildingState | null {
  return findRoadLinkedSpecialtySupplier(
    residence,
    buildings,
    network,
    needKind,
    eligible,
    true,
  );
}

/**
 * Upgrade eligibility needs an operational route, not current stock. Keeping
 * this separate from the live serving supplier prevents an empty workshop from
 * hiding a valid upgrade route while preserving stock-aware delivery claims.
 */
export function findRoadLinkedUpgradeSupplierForResidence(
  residence: ResidenceState,
  buildings: Iterable<BuildingState>,
  network: RoadNetwork,
  needKind: SpecialtyNeedKind,
  eligible: (building: BuildingState, roadDistance: number) => boolean = () => true,
): BuildingState | null {
  return findRoadLinkedSpecialtySupplier(
    residence,
    buildings,
    network,
    needKind,
    eligible,
    false,
  );
}

function findRoadLinkedSpecialtySupplier(
  residence: ResidenceState,
  buildings: Iterable<BuildingState>,
  network: RoadNetwork,
  needKind: SpecialtyNeedKind,
  eligible: (building: BuildingState, roadDistance: number) => boolean,
  requireStock: boolean,
): BuildingState | null {
  const supplierKinds = requireStock
    ? supplierKindsForNeed(needKind)
    : upgradeSupplierKindsForNeed(needKind);
  const suppliers = [...buildings].filter((building) => {
    const laborReady = requireStock
      ? isOperationalSpecialtySupplier(building)
      : isSustainableSpecialtySupplier(building);
    if (!laborReady || !supplierKinds.includes(building.kind)) {
      return false;
    }
    return !requireStock || specialtySupplierStock(building, needKind) > 1e-6;
  });
  const distances = requireStock
    ? roadPathDistancesFrom(network, residence.x, residence.z, suppliers)
    : localDeliveryDistancesFrom(network, residence.x, residence.z, suppliers);
  let best: BuildingState | null = null;
  let bestDistance = Infinity;

  for (let index = 0; index < suppliers.length; index += 1) {
    const building = suppliers[index];
    const distance = distances[index];
    if (distance == null) continue;
    if (!eligible(building, distance)) continue;
    if (
      distance + 1e-6 < bestDistance
      || (
        Math.abs(distance - bestDistance) <= 1e-6
        && best != null
        && compareStableEntityIds(building.id, best.id) < 0
      )
    ) {
      bestDistance = distance;
      best = building;
    }
  }

  return best;
}

export function parishPopulation(residences: Iterable<ResidenceState>): number {
  let total = 0;
  for (const residence of residences) {
    total += residence.population;
  }
  return total;
}

export function hasStaffedChapel(buildings: Iterable<BuildingState>): boolean {
  for (const building of buildings) {
    if (
      building.kind === 'chapel'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
    ) return true;
  }
  return false;
}

export function residencePreservedFoodRunwaySeconds(
  residence: ResidenceState,
  seasonalDemandMultiplier = 1,
  ambientSpoilageFractionPerDay = PRESERVED_FOOD_SPOILAGE_PER_DAY,
): number | null {
  if (residence.abandoned || residence.population === 0 || residence.tier < 4) return null;
  const stock = Math.max(
    preservedFoodStock(residence),
    residence.foodInventoryMigrated === true
      ? 0
      : getNeedStock(residence.needs, 'preservedFood'),
  );
  const multiplier = Number.isFinite(seasonalDemandMultiplier)
    ? Math.max(0, seasonalDemandMultiplier)
    : 1;
  const usePerSec = residence.population
    * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
    * multiplier;
  if (usePerSec <= 1e-9) return null;
  return spoilageAdjustedRunwayDays(
    stock,
    usePerSec * SPECIALTY_CONSUMPTION_SECONDS_PER_DAY,
    Math.max(0, ambientSpoilageFractionPerDay)
      * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  ) * SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function residencePreservedFoodRunwayDays(
  residence: ResidenceState,
  seasonalDemandMultiplier = 1,
  ambientSpoilageFractionPerDay = PRESERVED_FOOD_SPOILAGE_PER_DAY,
): number | null {
  const runwaySeconds = residencePreservedFoodRunwaySeconds(
    residence,
    seasonalDemandMultiplier,
    ambientSpoilageFractionPerDay,
  );
  if (runwaySeconds == null) return null;
  return runwaySeconds / SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function residenceAleRunwaySeconds(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0 || residence.tier < 2) return null;
  const stock = getNeedStock(residence.needs, 'ale');
  const usePerSec = residence.population * RESIDENCE_ALE_PER_PERSON_PER_SEC;
  if (usePerSec <= 1e-9) return null;
  return stock / usePerSec;
}

export function residenceAleRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceAleRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function residenceClothRunwaySeconds(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0 || residence.tier < 2) return null;
  const stock = getNeedStock(residence.needs, 'cloth');
  const usePerSec = residence.population * RESIDENCE_CLOTH_PER_PERSON_PER_SEC;
  if (usePerSec <= 1e-9) return null;
  return stock / usePerSec;
}

export function residenceClothRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceClothRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function residenceShoesRunwaySeconds(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0 || residence.tier < 3) return null;
  const stock = getNeedStock(residence.needs, 'shoes');
  const usePerSec = residence.population * RESIDENCE_SHOES_PER_PERSON_PER_SEC;
  if (usePerSec <= 1e-9) return null;
  return stock / usePerSec;
}

export function residenceShoesRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceShoesRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function residencePotteryRunwaySeconds(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0 || residence.tier < 4) return null;
  const stock = getNeedStock(residence.needs, 'pottery');
  const usePerSec = residence.population * RESIDENCE_POTTERY_PER_PERSON_PER_SEC;
  if (usePerSec <= 1e-9) return null;
  return stock / usePerSec;
}

export function residencePotteryRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residencePotteryRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / SPECIALTY_CONSUMPTION_SECONDS_PER_DAY;
}

export function specialtyRunwaySeconds(
  residence: ResidenceState,
  needKind: SpecialtyNeedKind,
): number | null {
  if (needKind === 'ale') return residenceAleRunwaySeconds(residence);
  if (needKind === 'cloth') return residenceClothRunwaySeconds(residence);
  if (needKind === 'shoes') return residenceShoesRunwaySeconds(residence);
  if (needKind === 'pottery') return residencePotteryRunwaySeconds(residence);
  return residencePreservedFoodRunwaySeconds(residence);
}

export function compareResidencesForSpecialtyDelivery(
  network: RoadNetwork,
  supplier: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
  needKind: SpecialtyNeedKind,
): number {
  const runwayA = specialtyRunwaySeconds(a, needKind) ?? Infinity;
  const runwayB = specialtyRunwaySeconds(b, needKind) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = localDeliveryDistance(network, supplier.x, supplier.z, a.x, a.z) ?? Infinity;
  const distanceB = localDeliveryDistance(network, supplier.x, supplier.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function peekNextSpecialtyDeliveryTarget(
  network: RoadNetwork,
  supplier: { x: number; z: number },
  residences: readonly ResidenceState[],
  needKind: SpecialtyNeedKind,
): ResidenceState | null {
  const capacity = specialtyCapacity(needKind);
  const eligible = residences.filter((residence) =>
    !residence.abandoned
    && residence.population > 0
    && residence.tier >= specialtyNeedMinimumTier(needKind)
    && getNeedStock(residence.needs, needKind) + 1e-6 < capacity);
  const distances = localDeliveryDistancesFrom(network, supplier.x, supplier.z, eligible);
  let bestIndex = -1;
  for (let index = 0; index < eligible.length; index += 1) {
    const distance = distances[index];
    if (distance == null) continue;
    if (bestIndex < 0) {
      bestIndex = index;
      continue;
    }
    const runway = specialtyRunwaySeconds(eligible[index], needKind) ?? Infinity;
    const bestRunway = specialtyRunwaySeconds(eligible[bestIndex], needKind) ?? Infinity;
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

function specialtyNeedMinimumTier(needKind: SpecialtyNeedKind): 2 | 3 | 4 {
  if (needKind === 'ale' || needKind === 'cloth') return 2;
  return needKind === 'shoes' ? 3 : 4;
}

function supplierKindsForNeed(needKind: SpecialtyNeedKind): readonly BuildingKind[] {
  if (needKind === 'ale') return ALE_SUPPLIER_KINDS;
  if (needKind === 'cloth') return CLOTH_SUPPLIER_KINDS;
  if (needKind === 'shoes') return SHOES_SUPPLIER_KINDS;
  if (needKind === 'pottery') return POTTERY_SUPPLIER_KINDS;
  return PRESERVED_FOOD_SUPPLIER_KINDS;
}

function upgradeSupplierKindsForNeed(
  needKind: SpecialtyNeedKind,
): readonly BuildingKind[] {
  return needKind === 'preservedFood'
    ? PRESERVED_FOOD_PRODUCER_KINDS
    : needKind === 'ale'
      ? ALE_PRODUCER_KINDS
      : needKind === 'cloth'
        ? CLOTH_PRODUCER_KINDS
        : needKind === 'shoes'
          ? SHOES_PRODUCER_KINDS
          : POTTERY_PRODUCER_KINDS;
}

function specialtySupplierStock(
  building: BuildingState,
  needKind: SpecialtyNeedKind,
): number {
  if (needKind === 'ale') {
    return Math.max(0, building.ale)
      + Math.max(0, building.cider ?? 0)
      + Math.max(0, building.mead ?? 0);
  }
  if (needKind === 'cloth') return building.cloth ?? 0;
  if (needKind === 'shoes') return building.shoes ?? 0;
  if (needKind === 'pottery') return building.pottery ?? 0;
  return preservedFoodStock(building);
}

function specialtyCapacity(needKind: SpecialtyNeedKind): number {
  if (needKind === 'ale') return RESIDENCE_ALE_CAPACITY;
  if (needKind === 'cloth') return RESIDENCE_CLOTH_CAPACITY;
  if (needKind === 'shoes') return RESIDENCE_SHOES_CAPACITY;
  if (needKind === 'pottery') return RESIDENCE_POTTERY_CAPACITY;
  return RESIDENCE_PRESERVED_FOOD_CAPACITY;
}

export function formatSpecialtyRunwayDays(days: number): string {
  if (days >= 2) return `${days.toFixed(1)} days`;
  const hours = Math.max(1, Math.round(days * 24));
  return `${hours}h`;
}

export {
  PRESERVED_FOOD_PRODUCER_KINDS,
  ALE_PRODUCER_KINDS,
  CLOTH_PRODUCER_KINDS,
  SHOES_PRODUCER_KINDS,
  POTTERY_PRODUCER_KINDS,
  PRESERVED_FOOD_SUPPLIER_KINDS,
  ALE_SUPPLIER_KINDS,
  CLOTH_SUPPLIER_KINDS,
  SHOES_SUPPLIER_KINDS,
  POTTERY_SUPPLIER_KINDS,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
  RESIDENCE_ALE_CAPACITY,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_SHOES_CAPACITY,
  RESIDENCE_POTTERY_CAPACITY,
};
