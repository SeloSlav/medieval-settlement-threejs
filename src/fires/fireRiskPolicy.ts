import {
  FIRE_BUCKET_SPEED_MPS,
  FIRE_BUCKET_UNLOAD_SECONDS,
  FIRE_BUILDING_BASE_FLAMMABILITY,
  FIRE_DEFAULT_BUILDING_BASE_FLAMMABILITY,
  FIRE_MINIMUM_BUCKET_WATER,
  FIRE_SPREAD_RADIUS,
  OFFROAD_DELIVERY_SPEED_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type {
  BuildingKind,
  BuildingState,
  ResidenceState,
} from '../resources/types.ts';

export type FireRiskBand = 'fireproof' | 'low' | 'standard' | 'elevated' | 'severe';
export type FireCoverageBand = 'fireproof' | 'covered' | 'unready' | 'uncovered';
export type FireWellReadiness =
  | 'ready'
  | 'no_hauler'
  | 'dry';

export type FireSafetyAssessment = {
  baseFlammability: number;
  currentFlammability: number;
  storedFuelMultiplier: number;
  riskBand: FireRiskBand;
  coverage: FireCoverageBand;
  nearestWellId: string | null;
  nearestWellReadiness: FireWellReadiness | null;
  responseDistance: number | null;
  firstBucketSeconds: number | null;
  exposedBuildingCount: number;
  exposedHouseholdCount: number;
};

type FireTarget = {
  id?: string | null;
  kind: BuildingKind;
  x: number;
  z: number;
  timber?: number;
  firewood?: number;
  grain?: number;
  barley?: number;
  malt?: number;
  flax?: number;
};

type FireSafetyContext = {
  buildings: Iterable<BuildingState>;
  residences?: Iterable<ResidenceState>;
  fireDisabledBuildingIds?: ReadonlySet<string>;
  /** Current unassigned labor available to carry a bucket. Omit for layout previews. */
  freeHaulersAvailable?: number;
  roadPathDistance?: (
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => number | null;
  travelSpeedMultiplierForWell?: (well: BuildingState) => number;
};

type WellCandidate = {
  well: BuildingState;
  readiness: FireWellReadiness;
  selectionDistance: number;
};

/**
 * Keep this lookup in generated balance data so the authoritative Rust
 * ignition rule and client planning feedback cannot drift.
 */
export function buildingBaseFlammability(kind: BuildingKind): number {
  return FIRE_BUILDING_BASE_FLAMMABILITY[
    kind as keyof typeof FIRE_BUILDING_BASE_FLAMMABILITY
  ] ?? FIRE_DEFAULT_BUILDING_BASE_FLAMMABILITY;
}

/**
 * Matches `building_flammability` in the authoritative fire simulation.
 * Stored fuel raises ignition and incoming-spread risk by up to 75%.
 */
export function buildingFlammability(target: FireTarget): number {
  const base = buildingBaseFlammability(target.kind);
  if (base <= 0) return 0;
  return base * storedFuelMultiplier(target);
}

export function storedFuelMultiplier(target: FireTarget): number {
  const storedFuel = Math.max(0, target.firewood ?? 0)
    + Math.max(0, target.timber ?? 0) * 0.35
    + (
      Math.max(0, target.grain ?? 0)
      + Math.max(0, target.barley ?? 0)
      + Math.max(0, target.malt ?? 0)
      + Math.max(0, target.flax ?? 0)
    ) * 0.08;
  return 1 + Math.min(0.75, storedFuel / 160);
}

export function fireRiskBand(flammability: number): FireRiskBand {
  if (flammability <= 1e-9) return 'fireproof';
  if (flammability <= 0.5) return 'low';
  if (flammability < 1.4) return 'standard';
  if (flammability < 2) return 'elevated';
  return 'severe';
}

export function fireRiskBandLabel(band: FireRiskBand): string {
  switch (band) {
    case 'fireproof': return 'Fire-safe';
    case 'low': return 'Low';
    case 'standard': return 'Standard';
    case 'elevated': return 'Elevated';
    case 'severe': return 'Severe';
  }
}

export function hasFireRiskPlanningOverlay(kind: BuildingKind): boolean {
  return buildingBaseFlammability(kind) >= 1.4;
}

/**
 * One bounded scan answers the layout questions a player needs before a fire:
 * does a ready well cover this point, how long is its first visible bucket
 * trip, and how many occupied/operational structures sit inside spread range?
 */
export function assessBuildingFireSafety(
  target: FireTarget,
  context: FireSafetyContext,
): FireSafetyAssessment {
  const baseFlammability = buildingBaseFlammability(target.kind);
  const storedMultiplier = storedFuelMultiplier(target);
  const currentFlammability = baseFlammability * storedMultiplier;
  if (baseFlammability <= 0) {
    return {
      baseFlammability,
      currentFlammability: 0,
      storedFuelMultiplier: 1,
      riskBand: 'fireproof',
      coverage: 'fireproof',
      nearestWellId: null,
      nearestWellReadiness: null,
      responseDistance: null,
      firstBucketSeconds: null,
      exposedBuildingCount: 0,
      exposedHouseholdCount: 0,
    };
  }

  const fireDisabled = context.fireDisabledBuildingIds ?? EMPTY_IDS;
  let bestReadyWell: WellCandidate | null = null;
  let bestUnreadyWell: WellCandidate | null = null;
  let exposedBuildingCount = 0;

  for (const building of context.buildings) {
    if (
      building.id !== target.id
      && building.constructionComplete !== false
      && !fireDisabled.has(building.id)
      && buildingBaseFlammability(building.kind) > 0
      && planarDistance(target, building) < FIRE_SPREAD_RADIUS
    ) {
      exposedBuildingCount += 1;
    }

    if (
      building.kind !== 'well'
      || building.constructionComplete === false
      || fireDisabled.has(building.id)
      || building.workRadius <= 0
    ) {
      continue;
    }
    const directDistance = planarDistance(target, building);
    if (directDistance > building.workRadius + 1e-6) continue;

    const readiness = wellReadiness(
      building,
      context.freeHaulersAvailable == null || context.freeHaulersAvailable > 0,
    );
    const roadDistance = context.roadPathDistance?.(
      building.x,
      building.z,
      target.x,
      target.z,
    );
    const selectionDistance = roadDistance
      ?? directDistance / Math.max(OFFROAD_DELIVERY_SPEED_MULTIPLIER, 1e-6);
    const candidate = { well: building, readiness, selectionDistance };
    if (readiness === 'ready') {
      if (betterWell(candidate, bestReadyWell)) bestReadyWell = candidate;
    } else if (betterWell(candidate, bestUnreadyWell)) {
      bestUnreadyWell = candidate;
    }
  }

  let exposedHouseholdCount = 0;
  for (const residence of context.residences ?? []) {
    if (
      !residence.abandoned
      && residence.population > 0
      && planarDistance(target, residence) < FIRE_SPREAD_RADIUS
    ) {
      exposedHouseholdCount += 1;
    }
  }

  const selectedWell = bestReadyWell ?? bestUnreadyWell;
  const responseDistance = bestReadyWell
    ? fireResponseRouteDistance(bestReadyWell.well, target, context.roadPathDistance)
    : null;
  const speedMultiplier = bestReadyWell
    ? Math.max(
        1e-6,
        context.travelSpeedMultiplierForWell?.(bestReadyWell.well) ?? 1,
      )
    : 1;
  const firstBucketSeconds = responseDistance == null
    ? null
    : responseDistance / (FIRE_BUCKET_SPEED_MPS * speedMultiplier)
      + FIRE_BUCKET_UNLOAD_SECONDS;

  return {
    baseFlammability,
    currentFlammability,
    storedFuelMultiplier: storedMultiplier,
    riskBand: fireRiskBand(currentFlammability),
    coverage: bestReadyWell ? 'covered' : bestUnreadyWell ? 'unready' : 'uncovered',
    nearestWellId: selectedWell?.well.id ?? null,
    nearestWellReadiness: selectedWell?.readiness ?? null,
    responseDistance,
    firstBucketSeconds,
    exposedBuildingCount,
    exposedHouseholdCount,
  };
}

export function fireCoverageColor(coverage: FireCoverageBand): number {
  switch (coverage) {
    case 'fireproof': return 0x8aa5ad;
    case 'covered': return 0x7fbd68;
    case 'unready': return 0xe0a43a;
    case 'uncovered': return 0xe45b4f;
  }
}

export function describePlacementFireSafety(
  assessment: FireSafetyAssessment,
): string | null {
  if (assessment.riskBand === 'fireproof') return null;
  const risk = `${fireRiskBandLabel(assessment.riskBand)} fire risk`;
  const spreadCount = assessment.exposedBuildingCount + assessment.exposedHouseholdCount;
  const spread = spreadCount === 0
    ? `no other occupied structure inside ${FIRE_SPREAD_RADIUS} m spread range`
    : `${spreadCount} ${spreadCount === 1 ? 'structure' : 'structures'} inside ${FIRE_SPREAD_RADIUS} m spread range`;
  if (
    assessment.coverage === 'covered'
    && assessment.responseDistance != null
    && assessment.firstBucketSeconds != null
  ) {
    return `${risk} · ready well ${Math.round(assessment.responseDistance)} m away · ~${Math.ceil(assessment.firstBucketSeconds)}s to first bucket · ${spread}`;
  }
  if (assessment.coverage === 'unready') {
    return `${risk} · well extent reaches here but ${wellReadinessLabel(assessment.nearestWellReadiness)} · ${spread}`;
  }
  return `${risk} · no ready well extent reaches here · ${spread}`;
}

export function wellReadinessLabel(readiness: FireWellReadiness | null): string {
  switch (readiness) {
    case 'dry': return `it holds less than ${FIRE_MINIMUM_BUCKET_WATER} water`;
    case 'no_hauler': return 'no unassigned hauler is available';
    case 'ready': return 'it is ready';
    case null: return 'it is unavailable';
  }
}

function wellReadiness(
  well: BuildingState,
  freeHaulerAvailable: boolean,
): FireWellReadiness {
  if (well.water + 1e-6 < FIRE_MINIMUM_BUCKET_WATER) return 'dry';
  return freeHaulerAvailable ? 'ready' : 'no_hauler';
}

function betterWell(
  candidate: WellCandidate,
  incumbent: WellCandidate | null,
): boolean {
  if (!incumbent) return true;
  if (candidate.selectionDistance + 1e-6 < incumbent.selectionDistance) return true;
  if (Math.abs(candidate.selectionDistance - incumbent.selectionDistance) > 1e-6) return false;
  return compareStableEntityIds(candidate.well.id, incumbent.well.id) < 0;
}

function fireResponseRouteDistance(
  well: BuildingState,
  target: FireTarget,
  roadPathDistance: FireSafetyContext['roadPathDistance'],
): number {
  const dx = well.x - target.x;
  const dz = well.z - target.z;
  const centerDistance = Math.hypot(dx, dz);
  const standOff = Math.min(4.2, centerDistance * 0.35);
  const targetX = centerDistance > 1e-6
    ? target.x + dx / centerDistance * standOff
    : target.x;
  const targetZ = centerDistance > 1e-6
    ? target.z + dz / centerDistance * standOff
    : target.z;
  return roadPathDistance?.(well.x, well.z, targetX, targetZ)
    ?? Math.hypot(targetX - well.x, targetZ - well.z)
      / Math.max(OFFROAD_DELIVERY_SPEED_MULTIPLIER, 1e-6);
}

function planarDistance(
  a: Pick<FireTarget, 'x' | 'z'>,
  b: Pick<FireTarget, 'x' | 'z'>,
): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
