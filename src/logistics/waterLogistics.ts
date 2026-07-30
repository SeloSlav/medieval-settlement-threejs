import {
  BREWERY_BREWING_WATER_PER_CYCLE,
  BREWERY_MALTING_WATER_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  POTTER_WATER_PER_CYCLE,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  SMITHY_WATER_PER_CYCLE,
  WEAVER_FLAX_WATER_PER_CYCLE,
  WELL_WATER_PER_DELIVERY,
} from '../generated/gameBalance.ts';
import { waterDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { BuildingKind, BuildingState, ResidenceState } from '../resources/types.ts';
import { normalizeStaffingPriority } from '../economy/staffingPriority.ts';
import { processorInputStagingCycles } from '../economy/processorOutputPolicy.ts';
import { weaverFibreDeliveryPreferenceRank } from '../economy/weaverInputPolicy.ts';
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

export type IndustrialWaterCandidate = {
  building: BuildingState;
  requiredPerCycle: number;
  stockRatio: number;
  distance: number;
};

export function industrialWaterRequirement(kind: BuildingKind): number {
  switch (kind) {
    case 'granary':
      return GRANARY_WATER_PER_CYCLE;
    case 'brewery':
      return BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE;
    case 'weaver':
      return WEAVER_FLAX_WATER_PER_CYCLE;
    case 'smithy':
      return SMITHY_WATER_PER_CYCLE;
    case 'potter_kiln':
      return POTTER_WATER_PER_CYCLE;
    case 'lumber_mill':
      return MILL_WATER_PER_HARVEST;
    default:
      return 0;
  }
}

export function industrialWaterTarget(
  kind: BuildingKind,
  processorOutputTargetPercent: number | undefined = 100,
): number {
  const perCycle = industrialWaterRequirement(kind);
  return kind === 'granary'
    || kind === 'brewery'
    || kind === 'weaver'
    || kind === 'smithy'
    || kind === 'potter_kiln'
    ? perCycle * processorInputStagingCycles(processorOutputTargetPercent)
    : perCycle;
}

export function industrialWaterInputPreferenceRank(
  kind: BuildingKind,
  weaverInputPolicy: number | undefined,
): number {
  return kind === 'weaver'
    ? weaverFibreDeliveryPreferenceRank(weaverInputPolicy, 'flax')
    : 1;
}

function compareCanonicalUint64Strings(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function selectIndustrialWaterCandidate(
  candidates: Iterable<IndustrialWaterCandidate>,
): IndustrialWaterCandidate | null {
  let selected: IndustrialWaterCandidate | null = null;
  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.stockRatio)
      || candidate.stockRatio < 0
      || !Number.isFinite(candidate.distance)
      || candidate.distance < 0
    ) {
      continue;
    }
    const candidatePriority = normalizeStaffingPriority(
      candidate.building.constructionPriority,
    );
    const selectedPriority = selected
      ? normalizeStaffingPriority(selected.building.constructionPriority)
      : 0;
    const candidateInputPreference = industrialWaterInputPreferenceRank(
      candidate.building.kind,
      candidate.building.weaverInputPolicy,
    );
    const selectedInputPreference = selected
      ? industrialWaterInputPreferenceRank(
          selected.building.kind,
          selected.building.weaverInputPolicy,
        )
      : Infinity;
    if (
      !selected
      || candidatePriority > selectedPriority
      || (
        candidatePriority === selectedPriority
        && candidateInputPreference < selectedInputPreference
      )
      || (
        candidatePriority === selectedPriority
        && candidateInputPreference === selectedInputPreference
        && candidate.stockRatio < selected.stockRatio
      )
      || (
        candidatePriority === selectedPriority
        && candidateInputPreference === selectedInputPreference
        && candidate.stockRatio === selected.stockRatio
        && (
          candidate.distance < selected.distance
          || (
            candidate.distance === selected.distance
            && compareCanonicalUint64Strings(candidate.building.id, selected.building.id) < 0
          )
        )
      )
    ) {
      selected = candidate;
    }
  }
  return selected;
}

export function wellDeliveryTripSeconds(
  network: RoadNetwork,
  well: { x: number; z: number },
  target: { x: number; z: number } | null,
  deliveryWorkers: number,
  travelSpeedMultiplier = 1,
): number {
  return waterDeliveryTripSeconds(
    network,
    well,
    target,
    deliveryWorkers,
    travelSpeedMultiplier,
  );
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
