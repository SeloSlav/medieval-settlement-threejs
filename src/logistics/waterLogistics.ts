import {
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WELL_WATER_PER_DELIVERY,
} from '../generated/gameBalance.ts';
import { waterDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { GAME_DAY_SECONDS } from './firewoodLogistics.ts';

export {
  formatLodgeCrewSplit,
  lodgeLaborAlternates,
  lodgeLaborSplit,
  type LodgeLaborSplit,
} from './lodgeLogistics.ts';

/** Wells reuse the same crew split as woodcutter's lodges. */
export { lodgeLaborSplit as wellLaborSplit } from './lodgeLogistics.ts';

export function wellWaterPerDelivery(deliveryWorkers: number): number {
  if (deliveryWorkers <= 0) return 0;
  return WELL_WATER_PER_DELIVERY * deliveryWorkers;
}

export function wellDeliveryTripSeconds(
  network: RoadNetwork,
  well: { x: number; z: number },
  target: { x: number; z: number } | null,
  deliveryWorkers: number,
): number {
  return waterDeliveryTripSeconds(network, well, target, deliveryWorkers);
}

export function formatWellCrewSplit(assignedLabor: number): string {
  if (assignedLabor <= 0) return 'None assigned';
  if (assignedLabor === 1) return '1 worker — alternates drawing & delivery';
  const processing = assignedLabor - 1;
  return `${processing} drawing · 1 delivering`;
}

export function residenceWaterDemandPerSecond(residence: ResidenceState): number {
  if (residence.abandoned || residence.population <= 0) return 0;
  return residence.population * RESIDENCE_WATER_PER_PERSON_PER_SEC;
}

export function residenceWaterRunwaySeconds(residence: ResidenceState): number | null {
  const demand = residenceWaterDemandPerSecond(residence);
  if (demand <= 0) return null;
  return getNeedStock(residence.needs, 'water') / demand;
}

export function residenceWaterRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceWaterRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / GAME_DAY_SECONDS;
}

export function residenceHasWaterRoom(waterStock: number): boolean {
  return hasNeedStockRoom(waterStock, RESIDENCE_WATER_CAPACITY);
}

export function formatWaterRunwayDays(days: number): string {
  if (days >= 10) return `${Math.round(days)} days`;
  if (days >= 1) return `${days.toFixed(1)} days`;
  const runwaySeconds = days * GAME_DAY_SECONDS;
  if (runwaySeconds >= 3600) return `~${(runwaySeconds / 3600).toFixed(1)} h`;
  const minutes = runwaySeconds / 60;
  return `~${Math.max(1, Math.round(minutes))} min`;
}

function withinWellRadius(well: BuildingState, residence: ResidenceState): boolean {
  if (well.workRadius <= 0) return false;
  const distance = Math.hypot(residence.x - well.x, residence.z - well.z);
  return distance <= well.workRadius;
}

export function isResidenceInWellRange(well: BuildingState, residence: ResidenceState): boolean {
  return withinWellRadius(well, residence);
}
