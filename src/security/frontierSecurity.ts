import {
  CALENDAR_SECONDS_PER_DAY,
  GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE,
  GUARDHOUSE_LONG_MUSTER_EFFICIENCY,
  GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE,
  GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY,
  PALISADED_REFUGE_BREACH_SECONDS,
  PALISADED_REFUGE_RESIDENT_CAPACITY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import type { SettlementSecurity } from '../generated/types.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type {
  DeliveryCargoKind,
  DeliveryTripState,
} from '../logistics/deliveryTrips.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import type { MilitaryCompanyState } from './militaryProgression.ts';
import { buildingKindLabel } from '../resources/WorldLayoutRegistry.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { householdProsperityBand } from '../economy/householdWealth.ts';

export type SettlementSecurityState = {
  threat: number;
  coverage: number;
  protectedValue: number;
  totalValue: number;
  staffedWatchtowers: number;
  readyGuards: number;
  defenseReadiness: number;
  nextRaidTick: number;
  lastRaidTick: number;
  raidApproach: 'unknown' | 'north' | 'east' | 'south' | 'west';
  raidApproachOffset: number;
  warningStartedTick: number;
  warningSourceTowerId: string | null;
  lastOutcome: 'none' | 'averted' | 'plundered' | 'arson';
  lastGoodsLost: number;
  lastWealthLost: number;
  guardsRequired: number;
  targetsAtRisk: number;
  estimatedLossFraction: number;
};

export const DEFAULT_SETTLEMENT_SECURITY: SettlementSecurityState = {
  threat: 0,
  coverage: 0,
  protectedValue: 0,
  totalValue: 0,
  staffedWatchtowers: 0,
  readyGuards: 0,
  defenseReadiness: 0,
  nextRaidTick: 0,
  lastRaidTick: 0,
  raidApproach: 'unknown',
  raidApproachOffset: 0,
  warningStartedTick: 0,
  warningSourceTowerId: null,
  lastOutcome: 'none',
  lastGoodsLost: 0,
  lastWealthLost: 0,
  guardsRequired: 0,
  targetsAtRisk: 0,
  estimatedLossFraction: 0,
};

export const WATCH_COVERAGE_CELL_SIZE = 128;
export const FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS = 300;
export const RAID_SEASON_START_MONTH = 4;
export const RAID_SEASON_END_MONTH = 10;
const CLOTH_RAID_VALUE_MULTIPLIER = 1.5;
const IRONWORK_RAID_VALUE_MULTIPLIER = 2;
const POLEARM_RAID_VALUE_MULTIPLIER = 4;


export function settlementSecurityFromRow(row: SettlementSecurity): SettlementSecurityState {
  return {
    threat: clamp01(row.threat),
    coverage: clamp01(row.coverage),
    protectedValue: Math.max(0, row.protectedValue),
    totalValue: Math.max(0, row.totalValue),
    staffedWatchtowers: Math.max(0, row.staffedWatchtowers),
    readyGuards: Math.max(0, row.readyGuards),
    defenseReadiness: clamp01(row.defenseReadiness),
    nextRaidTick: Number(row.nextRaidTick),
    lastRaidTick: Number(row.lastRaidTick),
    raidApproach: raidApproachFromId(row.raidApproach),
    raidApproachOffset: Number.isFinite(row.raidApproachOffset)
      ? row.raidApproachOffset
      : 0,
    warningStartedTick: Number(row.warningStartedTick),
    warningSourceTowerId: row.warningSourceTowerId > 0n
      ? row.warningSourceTowerId.toString()
      : null,
    lastOutcome: row.lastOutcome === 3
      ? 'arson'
      : row.lastOutcome === 2
        ? 'plundered'
        : row.lastOutcome === 1
          ? 'averted'
          : 'none',
    lastGoodsLost: Math.max(0, row.lastGoodsLost),
    lastWealthLost: Math.max(0, row.lastWealthLost),
    guardsRequired: Math.max(0, row.guardsRequired),
    targetsAtRisk: Math.max(0, row.targetsAtRisk),
    estimatedLossFraction: clamp01(row.estimatedLossFraction),
  };
}

export function projectedRaidArsonChance(
  security: SettlementSecurityState,
  enemyPressure: number,
): number {
  if (
    security.targetsAtRisk <= 0
    || security.guardsRequired <= 1e-6
    || enemyPressure <= 0
  ) return 0;
  const pressure = clamp01(enemyPressure / 100);
  const defenseRatio = clamp01(security.readyGuards / security.guardsRequired);
  if (defenseRatio >= 1 - 1e-9) return 0;
  const undefendedChance = 0.06 + pressure * 0.18;
  return Math.min(0.24, undefendedChance * (1 - defenseRatio * 0.8));
}

export function formatFrontierForecast(
  security: SettlementSecurityState,
  enemyPressure?: number,
): string {
  if (security.guardsRequired <= 1e-6) {
    return 'No raid forecast until the frontier settlement reaches eight residents.';
  }
  const ready = formatGuardCount(security.readyGuards);
  const required = formatGuardCount(security.guardsRequired);
  if (security.targetsAtRisk <= 0) {
    return security.readyGuards + 1e-6 >= security.guardsRequired
      ? `${ready} / ${required} guards in the weakest likely watch district · forecast has enough interceptors; live contact still resolves the fight`
      : `${ready} / ${required} guards in the weakest likely watch district · no stocked holding currently presents a raid target`;
  }
  const targets = `${security.targetsAtRisk} holding${security.targetsAtRisk === 1 ? '' : 's'} at risk`;
  const loss = `up to ${Math.round(security.estimatedLossFraction * 100)}% portable stores per target`;
  const arson = enemyPressure == null
    ? ''
    : ` · ${Math.round(projectedRaidArsonChance(security, enemyPressure) * 100)}% chance of one raid fire`;
  return `${ready} / ${required} guards in the weakest likely watch district · ${targets} · ${loss}${arson}`;
}

export function frontierThreatLabel(
  security: SettlementSecurityState,
  settings: Pick<WorldGenerationSettings, 'conflictMode'> | null,
  month?: number,
): string {
  if (settings?.conflictMode !== 'frontier') return 'Peaceful settlement';
  if (security.nextRaidTick <= 0) return 'Frontier quiet';
  if (security.warningStartedTick > 0) {
    if (month !== undefined && !isFrontierRaidSeason(month)) {
      return 'Hostile trail reported';
    }
    return 'Raiders sighted';
  }
  return 'Frontier watch';
}

export function isFrontierRaidSeason(month: number): boolean {
  return month >= RAID_SEASON_START_MONTH && month <= RAID_SEASON_END_MONTH;
}

export function isFrontierAlertActive(
  security: Pick<SettlementSecurityState, 'nextRaidTick' | 'warningStartedTick'>,
  conflictEnabled: boolean,
  month: number,
): boolean {
  return conflictEnabled
    && security.nextRaidTick > 0
    && security.warningStartedTick > 0
    && isFrontierRaidSeason(month);
}

/** Compatibility name retained for refuge-specific callers. */
export function isPalisadedRefugeRallyActive(
  security: Pick<SettlementSecurityState, 'nextRaidTick' | 'warningStartedTick'>,
  conflictEnabled: boolean,
  month: number,
): boolean {
  return isFrontierAlertActive(security, conflictEnabled, month);
}

export function estimatedRaidDays(
  security: SettlementSecurityState,
  simTick: number,
): number | null {
  if (security.nextRaidTick <= 0) return null;
  const ticksRemaining = Math.max(0, security.nextRaidTick - simTick);
  return ticksRemaining * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY;
}

export function formatFrontierRaidTiming(
  security: SettlementSecurityState,
  simTick: number,
  month: number,
): string {
  const days = estimatedRaidDays(security, simTick);
  if (days === null) {
    return 'No incursion scheduled until the settlement reaches eight residents';
  }
  if (security.warningStartedTick <= 0) {
    return 'No confirmed sighting · scout reports are uncertain and each staffed tower watches only its own frontier';
  }
  const campaignOpen = isFrontierRaidSeason(month);
  if (!campaignOpen && days <= 0.1) {
    return 'Reported trail is ready to move · winter conditions may defer contact until the April campaign season';
  }
  const roundedDays = Math.max(1, Math.ceil(days));
  const countdown = days <= 0.1
    ? 'Contact may occur now'
    : `estimated arrival in about ${roundedDays} ${roundedDays === 1 ? 'day' : 'days'}`;
  return campaignOpen
    ? `${countdown} · April–October campaign season active`
    : `${countdown} · winter conditions can defer contact`;
}

export function projectedRaidPartySize(enemyPressure: number): number {
  return Math.max(
    3,
    Math.min(12, Math.ceil(2.5 + Math.max(0, Math.min(100, enemyPressure)) * 0.065)),
  );
}

export function formatIncomingRaidWarning(
  security: SettlementSecurityState,
  enemyPressure: number,
  simTick: number,
  month: number,
): string {
  const source = security.warningSourceTowerId == null
    ? 'Scouts report'
    : 'A staffed watchtower reports';
  const approach = security.raidApproach === 'unknown'
    ? 'from an uncertain direction'
    : `from the ${security.raidApproach}`;
  const raiders = projectedRaidPartySize(enemyPressure);
  return `${source} ${raiders} raiders approaching ${approach}. ${formatFrontierRaidTiming(
    security,
    simTick,
    month,
  )}.`;
}

export function formatRaidReport(security: SettlementSecurityState): string {
  if (security.lastOutcome === 'averted') {
    return security.readyGuards > 0
      ? 'Live guards stopped or drove off the incursion before raiders secured any stores.'
      : 'The raiders withdrew without securing portable stores; no loss was resolved off-map.';
  }
  if (security.lastOutcome === 'plundered' || security.lastOutcome === 'arson') {
    const goods = Math.round(security.lastGoodsLost);
    const wealth = Math.round(security.lastWealthLost);
    const losses = [
      goods > 0 ? `${goods} portable goods` : '',
      wealth > 0 ? `${wealth} gold in household, parish, and treasury wealth` : '',
    ].filter(Boolean);
    const arson = security.lastOutcome === 'arson'
      ? ' and set one reached holding alight'
      : '';
    return `Raiders struck exposed holdings, took ${losses.join(' and ') || 'minor stores'}${arson}.`;
  }
  return 'No incursion has reached the settlement.';
}

export function watchtowerEffectiveRadius(
  tower: BuildingState,
  fireDisabled = false,
): number {
  if (
    tower.kind !== 'watchtower'
    || !tower.constructionComplete
    || tower.assignedLabor <= 0
    || fireDisabled
  ) {
    return 0;
  }
  return tower.assignedLabor === 1 ? tower.workRadius * 0.78 : tower.workRadius;
}

export type GuardhouseMusterAssignment = {
  guardhouseId: string;
  towerId: string;
  routeDistance: number;
  responseDistance: number;
  efficiency: number;
  rawReady: number;
  effectiveReady: number;
};

export type GuardhouseMusterPlan = {
  staffedTowers: number;
  linkedGuardhouses: number;
  assignmentsByGuardhouse: ReadonlyMap<string, GuardhouseMusterAssignment>;
  readinessByWatch: ReadonlyMap<string, number>;
};

export type ProjectedRaidTarget = {
  kind: 'building' | 'residence' | 'cart' | 'treasury';
  id: string;
  x: number;
  z: number;
  label: string;
  protected: boolean;
  sheltered: boolean;
  portableValue: number;
  portableSummary: string;
  localReadyGuards: number | null;
  localGuardsRequired: number | null;
  estimatedLossFraction: number | null;
};

type ProjectedRaidTargetCandidate = Omit<ProjectedRaidTarget, 'portableSummary'>;
type ProjectedRaidTargetInput = Omit<
  ProjectedRaidTargetCandidate,
  'localReadyGuards' | 'localGuardsRequired' | 'estimatedLossFraction'
>;

export type RaidTargetProjectionOptions = {
  enemyPressure: number;
  roadNetwork: RoadNetwork;
  roadSpeedMultiplier?: number;
  refugeShelterPlan?: RefugeShelterPlan;
  guardhouseMusterPlan?: GuardhouseMusterPlan;
};

export type RefugeShelterPlan = {
  activeRefuges: number;
  residentCapacityPerRefuge: number;
  totalResidentCapacity: number;
  warnedHomesInReach: number;
  warnedResidentsInReach: number;
  assignedHomes: number;
  assignedResidents: number;
  unassignedWarnedHomes: number;
  unassignedWarnedResidents: number;
  refugeByResidence: ReadonlyMap<string, string>;
  residentsByRefuge: ReadonlyMap<string, number>;
  warnedResidenceIds: ReadonlySet<string>;
};

export function raidTargetCanShelter(
  kind: ProjectedRaidTarget['kind'],
  watched: boolean,
  withinRefugeReach: boolean,
): boolean {
  return kind === 'residence' && watched && withinRefugeReach;
}

type PortableRaidStoresLike = {
  timber: number;
  firewood: number;
  ryeSheaves?: number;
  oatSheaves?: number;
  barleySheaves?: number;
  maslinSheaves?: number;
  ryeGrain?: number;
  oatGrain?: number;
  animalFeed?: number;
  maslinGrain?: number;
  barley?: number;
  malt?: number;
  ryeFlour?: number;
  maslinFlour?: number;
  ale: number;
  honey: number;
  wax?: number;
  candles?: number;
  wine: number;
  wool?: number;
  flax?: number;
  cloth?: number;
  ironwork?: number;
  polearms?: number;
  iron?: number;
  clay?: number;
  salt?: number;
  charcoal?: number;
  pottery?: number;
  remedies?: number;
  ryeBread?: number;
  maslinBread?: number;
  meat?: number;
  fish?: number;
  berries?: number;
  mushrooms?: number;
  milk?: number;
  apples?: number;
  cherries?: number;
  eggs?: number;
  grapes?: number;
  curedMeat?: number;
  smokedFish?: number;
  cheese?: number;
  gold: number;
};

function normalizeRoadSpeedMultiplier(roadSpeedMultiplier: number): number {
  return Number.isFinite(roadSpeedMultiplier) && roadSpeedMultiplier > 0
    ? Math.max(0.05, Math.min(1, roadSpeedMultiplier))
    : 1;
}

export function guardhouseMusterResponseDistance(
  roadDistance: number | null,
  roadSpeedMultiplier = 1,
): number | null {
  if (roadDistance == null || !Number.isFinite(roadDistance)) {
    return null;
  }
  return Math.max(0, roadDistance) / normalizeRoadSpeedMultiplier(roadSpeedMultiplier);
}

export function guardhouseMusterEfficiency(
  roadDistance: number | null,
  roadSpeedMultiplier = 1,
): number {
  const distance = guardhouseMusterResponseDistance(roadDistance, roadSpeedMultiplier);
  if (distance == null) return clamp01(GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY);
  if (distance <= GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE) return 1;
  if (distance >= GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE) {
    return clamp01(GUARDHOUSE_LONG_MUSTER_EFFICIENCY);
  }
  const progress = (distance - GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE)
    / Math.max(1e-9, GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE - GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE);
  return clamp01(1 + (GUARDHOUSE_LONG_MUSTER_EFFICIENCY - 1) * progress);
}

export function normalizeGuardhouseMusterWatchtowerId(
  watchtowerId: string | undefined,
): string | null {
  const normalized = watchtowerId?.trim();
  return normalized && normalized !== '0' ? normalized : null;
}

/**
 * Resolves one persisted company order against the operational watch roster.
 * Explicit orders never fall back to another district when their post is
 * unstaffed, burning, or disconnected; automatic companies retain the
 * save-compatible nearest-route behavior with stable ties.
 */
export function selectGuardhouseMusterWatchIndex(
  orderedWatchtowerId: string | null,
  towers: readonly Pick<BuildingState, 'id'>[],
  roadDistances: readonly (number | null)[],
): number {
  if (orderedWatchtowerId !== null) {
    const index = towers.findIndex((tower) => tower.id === orderedWatchtowerId);
    const distance = index < 0 ? null : roadDistances[index];
    return distance != null && Number.isFinite(distance) ? index : -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Infinity;
  for (let index = 0; index < towers.length; index += 1) {
    const distance = roadDistances[index];
    if (distance == null || !Number.isFinite(distance)) continue;
    if (
      distance < nearestDistance - 1e-6
      || (
        Math.abs(distance - nearestDistance) <= 1e-6
        && (
          nearestIndex < 0
          || compareStableIds(
            towers[index]!.id,
            towers[nearestIndex]!.id,
          ) < 0
        )
      )
    ) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

/**
 * Claims every operational company to its nearest staffed watch using one
 * batched road tree per guardhouse. The raid forecast and visible alert
 * routines can share this immutable result instead of solving the same
 * district topology twice.
 */
export function computeGuardhouseMusterPlan(
  gameState: GameState,
  roadNetwork: RoadNetwork,
  roadSpeedMultiplier = 1,
  militaryCompanies: Iterable<MilitaryCompanyState> = [],
): GuardhouseMusterPlan {
  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const towers = [...gameState.buildings.values()]
    .filter(
      (building) =>
        building.kind === 'watchtower'
        && building.constructionComplete !== false
        && building.assignedLabor > 0
        && !fireDisabled.has(building.id),
    );
  const towerPoints = towers.map((tower) => ({ x: tower.x, z: tower.z }));
  const assignmentsByGuardhouse =
    new Map<string, GuardhouseMusterAssignment>();
  const readinessByWatch = new Map<string, number>();
  if (towers.length === 0) {
    return {
      staffedTowers: 0,
      linkedGuardhouses: 0,
      assignmentsByGuardhouse,
      readinessByWatch,
    };
  }

  const normalizedRoadSpeed = normalizeRoadSpeedMultiplier(
    roadSpeedMultiplier,
  );
  const companyReadinessBySource = new Map<string, { assigned: number; ready: number }>();
  for (const company of militaryCompanies) {
    if (company.status !== 'active' || company.livingMembers <= 0) continue;
    const current = companyReadinessBySource.get(company.sourceBuildingId)
      ?? { assigned: 0, ready: 0 };
    current.assigned += company.livingMembers;
    current.ready += company.livingMembers
      * clamp01(company.morale)
      * clamp01(company.cohesion)
      * (1 - clamp01(company.fatigue) * 0.45);
    companyReadinessBySource.set(company.sourceBuildingId, current);
  }
  const pathfinder = roadNetwork.getPathfinder();
  for (const guardhouse of gameState.buildings.values()) {
    if (
      guardhouse.kind !== 'guardhouse'
      || guardhouse.constructionComplete === false
      || fireDisabled.has(guardhouse.id)
    ) continue;
    const companyReadiness = companyReadinessBySource.get(guardhouse.id);
    if (!companyReadiness || companyReadiness.assigned <= 0) continue;

    const distances = pathfinder.roadPathDistancesFrom(
      guardhouse.x,
      guardhouse.z,
      towerPoints,
    );
    const linkedTowerIndex = selectGuardhouseMusterWatchIndex(
      normalizeGuardhouseMusterWatchtowerId(
        guardhouse.guardhouseMusterWatchtowerId,
      ),
      towers,
      distances,
    );
    if (linkedTowerIndex < 0) continue;

    const tower = towers[linkedTowerIndex]!;
    const routeDistance = distances[linkedTowerIndex]!;
    const rawReady = companyReadiness.ready;
    const responseDistance = guardhouseMusterResponseDistance(
      routeDistance,
      normalizedRoadSpeed,
    )!;
    const efficiency = guardhouseMusterEfficiency(
      routeDistance,
      normalizedRoadSpeed,
    );
    const effectiveReady = rawReady * efficiency;
    assignmentsByGuardhouse.set(guardhouse.id, {
      guardhouseId: guardhouse.id,
      towerId: tower.id,
      routeDistance,
      responseDistance,
      efficiency,
      rawReady,
      effectiveReady,
    });
    if (effectiveReady > 1e-9) {
      readinessByWatch.set(
        tower.id,
        (readinessByWatch.get(tower.id) ?? 0) + effectiveReady,
      );
    }
  }

  return {
    staffedTowers: towers.length,
    linkedGuardhouses: assignmentsByGuardhouse.size,
    assignmentsByGuardhouse,
    readinessByWatch,
  };
}

/**
 * Mirrors the authoritative bounded raid selector. The server recalculates its
 * report once per security interval; callers should likewise cache this result
 * until a new report arrives rather than rescanning the settlement every tick.
 */
export function projectRaidTargets(
  gameState: GameState,
  targetCount: number,
  options?: RaidTargetProjectionOptions,
): ProjectedRaidTarget[] {
  const limit = Math.max(0, Math.floor(targetCount));
  if (limit <= 0) return [];

  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const towers: WatchArea[] = [];
  const refuges: WatchArea[] = [];
  let reservedTreasuryTimber = 0;
  let townHallAnchor: BuildingState | null = null;
  let completedHoldingAnchor: BuildingState | null = null;
  let anyHoldingAnchor: BuildingState | null = null;
  for (const building of gameState.buildings.values()) {
    reservedTreasuryTimber += positivePortableAmount(
      building.constructionTreasuryTimber,
    );
    if (
      building.kind === 'watchtower'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && !fireDisabled.has(building.id)
    ) {
      towers.push({
        id: building.id,
        x: building.x,
        z: building.z,
        radius: watchtowerEffectiveRadius(building),
      });
    }
    if (
      building.kind === 'palisaded_refuge'
      && building.constructionComplete !== false
      && !fireDisabled.has(building.id)
      && building.workRadius > 0
    ) {
      refuges.push({
        id: building.id,
        x: building.x,
        z: building.z,
        radius: building.workRadius,
      });
    }
    if (building.kind === 'town_hall') {
      townHallAnchor = earlierBuilding(townHallAnchor, building);
    }
    if (
      building.kind === 'watchtower'
      || building.kind === 'guardhouse'
      || building.kind === 'palisaded_refuge'
    ) continue;
    anyHoldingAnchor = earlierBuilding(anyHoldingAnchor, building);
    if (building.constructionComplete !== false) {
      completedHoldingAnchor = earlierBuilding(completedHoldingAnchor, building);
    }
  }
  const watchIndex = buildWatchCoverageIndex(towers);
  const refugeIndex = buildWatchCoverageIndex(refuges);
  const refugePlan = options?.refugeShelterPlan ?? assignRefugeHouseholds(
    gameState,
    watchIndex,
    refugeIndex,
    refuges.length,
  );
  const districtReadiness = options?.guardhouseMusterPlan?.readinessByWatch ?? null;

  const selected: ProjectedRaidTargetCandidate[] = [];
  const consider = (input: ProjectedRaidTargetInput): void => {
    const district = options && districtReadiness
      ? projectedTargetDistrictDefense(
          input.x,
          input.z,
          input.protected,
          watchIndex,
          districtReadiness,
          options.enemyPressure,
        )
      : {
          localReadyGuards: null,
          localGuardsRequired: null,
          estimatedLossFraction: null,
        };
    const candidate: ProjectedRaidTargetCandidate = {
      ...input,
      ...district,
    };
    let insertAt = selected.findIndex(
      (current) => compareProjectedRaidTargets(candidate, current) < 0,
    );
    if (insertAt < 0) insertAt = selected.length;
    if (insertAt >= limit && selected.length >= limit) return;
    selected.splice(insertAt, 0, candidate);
    if (selected.length > limit) selected.pop();
  };

  for (const building of gameState.buildings.values()) {
    if (building.kind === 'watchtower' || building.kind === 'founders_camp') continue;
    const portableValue = portableRaidValue(building);
    if (portableValue <= 1e-9) continue;
    consider({
      kind: 'building',
      id: building.id,
      x: building.x,
      z: building.z,
      label: `${buildingKindLabel(building.kind)}${building.constructionComplete === false ? ' worksite' : ''}`,
      protected: positionIsWatched(building.x, building.z, watchIndex),
      sheltered: raidTargetCanShelter('building', false, false),
      portableValue,
    });
  }
  for (const trip of gameState.deliveryTrips.values()) {
    if (gameState.buildings.get(trip.buildingId)?.kind === 'founders_camp') continue;
    const portableValue = deliveryTripRaidValue(trip);
    if (portableValue <= 1e-9) continue;
    consider({
      kind: 'cart',
      id: trip.id,
      x: trip.x,
      z: trip.z,
      label: `Loaded ${deliveryCargoLabel(trip.cargoKind)} handcart`,
      protected: positionIsWatched(trip.x, trip.z, watchIndex),
      sheltered: raidTargetCanShelter('cart', false, false),
      portableValue,
    });
  }
  let residenceAnchor: ResidenceState | null = null;
  for (const residence of gameState.residences.values()) {
    if (residence.abandoned || residence.population <= 0) continue;
    if (
      residenceAnchor === null
      || compareStableIds(residence.id, residenceAnchor.id) < 0
    ) {
      residenceAnchor = residence;
    }
    if (residence.householdWealth <= 1e-9) continue;
    const assignedRefugeId = refugePlan.refugeByResidence.get(residence.id);
    const assignedRefuge = assignedRefugeId
      ? gameState.buildings.get(assignedRefugeId) ?? null
      : null;
    const raidX = assignedRefuge?.x ?? residence.x;
    const raidZ = assignedRefuge?.z ?? residence.z;
    const protectedByWatch = positionIsWatched(
      raidX,
      raidZ,
      watchIndex,
    );
    consider({
      kind: 'residence',
      id: residence.id,
      x: raidX,
      z: raidZ,
      label: `Tier ${residence.tier} household (${residence.population} resident${residence.population === 1 ? '' : 's'})${assignedRefuge ? ' rallied at palisaded refuge' : ''}`,
      protected: protectedByWatch,
      sheltered: assignedRefuge !== null,
      portableValue: residence.householdWealth,
    });
  }
  // The compatibility row has no world position in a physical settlement.
  // The server converts any stray balance into a salvage pile, which is
  // already covered by the building-target loop above. Never invent a second
  // raid target while that repair is propagating to the client.
  const treasuryStores: PortableRaidStoresLike | null =
    gameState.physicalFoundingSiteEnabled === true
      ? null
      : {
          ...gameState.stockpile,
          timber: raidableTreasuryTimber(
            gameState.stockpile.timber,
            reservedTreasuryTimber,
          ),
        };
  const treasuryValue = treasuryStores ? portableRaidValue(treasuryStores) : 0;
  const buildingAnchor = townHallAnchor ?? completedHoldingAnchor;
  const treasuryAnchor = buildingAnchor
    ? {
        id: buildingAnchor.id,
        x: buildingAnchor.x,
        z: buildingAnchor.z,
        label: `${buildingKindLabel(buildingAnchor.kind)}${buildingAnchor.constructionComplete === false ? ' worksite' : ''}`,
      }
    : residenceAnchor
      ? {
          id: residenceAnchor.id,
          x: residenceAnchor.x,
          z: residenceAnchor.z,
          label: `Tier ${residenceAnchor.tier} household`,
        }
      : anyHoldingAnchor
        ? {
            id: anyHoldingAnchor.id,
            x: anyHoldingAnchor.x,
            z: anyHoldingAnchor.z,
            label: `${buildingKindLabel(anyHoldingAnchor.kind)} worksite`,
          }
        : null;
  if (treasuryValue > 1e-9 && treasuryAnchor) {
    consider({
      kind: 'treasury',
      id: treasuryAnchor.id,
      x: treasuryAnchor.x,
      z: treasuryAnchor.z,
      label: `Settlement treasury at ${treasuryAnchor.label}`,
      protected: positionIsWatched(treasuryAnchor.x, treasuryAnchor.z, watchIndex),
      sheltered: raidTargetCanShelter('treasury', false, false),
      portableValue: treasuryValue,
    });
  }
  return selected.map((target) => {
    const portableSummary = target.kind === 'building'
      ? portableRaidSummary(gameState.buildings.get(target.id))
      : target.kind === 'cart'
        ? deliveryTripRaidSummary(gameState.deliveryTrips.get(target.id))
      : target.kind === 'treasury'
        ? portableRaidSummary(treasuryStores ?? undefined)
        : 'Private household savings carried with the family';
    return { ...target, portableSummary };
  });
}

export function formatProjectedRaidTargets(targets: readonly ProjectedRaidTarget[]): string {
  if (targets.length === 0) {
    return 'No stocked holding currently presents a likely raid target.';
  }
  const holdings = targets.map((target) => {
    const shelter = target.sheltered
      ? ` · household rallied here · ${PALISADED_REFUGE_BREACH_SECONDS}s live breach`
      : '';
    const district = target.localReadyGuards == null
      || target.localGuardsRequired == null
      || target.estimatedLossFraction == null
      ? ''
      : target.protected
        ? ` · ${formatGuardCount(target.localReadyGuards)} / ${formatGuardCount(target.localGuardsRequired)} district guards · up to ${Math.round(target.estimatedLossFraction * 100)}% loss`
        : ` · no warned guard district · up to ${Math.round(target.estimatedLossFraction * 100)}% loss`;
    const valueLabel = target.kind === 'residence'
      ? `${formatHouseholdPurseBand(target.portableValue)} private purse`
      : `${formatPortableStoreAmount(target.portableValue)} raid value`;
    return `${target.label} (${target.protected ? 'watched' : 'exposed'}${shelter}${district} · ${valueLabel} · ${target.portableSummary})`;
  });
  return `Current likely ${targets.length === 1 ? 'target' : 'targets'}: ${holdings.join('; ')}. Warning rings appear as frontier unrest rises.`;
}

export function countSitesProtectedByWatchtower(
  tower: BuildingState,
  gameState: GameState,
): { buildings: number; homes: number; residents: number } {
  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const radius = watchtowerEffectiveRadius(tower, fireDisabled.has(tower.id));
  if (radius <= 0) return { buildings: 0, homes: 0, residents: 0 };
  const radiusSquared = radius * radius;
  let buildings = 0;
  let homes = 0;
  let residents = 0;
  for (const building of gameState.buildings.values()) {
    if (
      building.id === tower.id
      || building.kind === 'founders_camp'
      || (
        building.constructionComplete === false
        && portableRaidValue(building) <= 1e-9
      )
    ) continue;
    if (distanceSquared(tower, building) <= radiusSquared) buildings += 1;
  }
  for (const residence of gameState.residences.values()) {
    if (residence.abandoned || residence.population <= 0) continue;
    if (distanceSquared(tower, residence) > radiusSquared) continue;
    homes += 1;
    residents += residence.population;
  }
  return { buildings, homes, residents };
}

function formatHouseholdPurseBand(wealth: number): string {
  const band = householdProsperityBand(wealth);
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function palisadedRefugeEffectiveRadius(
  refuge: BuildingState,
  fireDisabled = false,
): number {
  if (
    refuge.kind !== 'palisaded_refuge'
    || refuge.constructionComplete === false
    || fireDisabled
  ) return 0;
  return Math.max(0, refuge.workRadius);
}

export function computeRefugeShelterPlan(
  gameState: GameState,
): RefugeShelterPlan {
  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const towers: WatchArea[] = [];
  const refuges: WatchArea[] = [];
  for (const building of gameState.buildings.values()) {
    if (
      building.kind === 'watchtower'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && !fireDisabled.has(building.id)
    ) {
      const radius = watchtowerEffectiveRadius(building);
      if (radius > 0) {
        towers.push({
          id: building.id,
          x: building.x,
          z: building.z,
          radius,
        });
      }
    } else if (
      building.kind === 'palisaded_refuge'
      && building.constructionComplete !== false
      && !fireDisabled.has(building.id)
      && building.workRadius > 0
    ) {
      refuges.push({
        id: building.id,
        x: building.x,
        z: building.z,
        radius: building.workRadius,
      });
    }
  }
  return assignRefugeHouseholds(
    gameState,
    buildWatchCoverageIndex(towers),
    buildWatchCoverageIndex(refuges),
    refuges.length,
  );
}

export function countHouseholdsShelteredByPalisadedRefuge(
  refuge: BuildingState,
  gameState: GameState,
): {
  homesInReach: number;
  residentsInReach: number;
  warnedHomesInReach: number;
  warnedResidentsInReach: number;
  shelteredHomes: number;
  shelteredResidents: number;
  shelteredWealth: number;
  unassignedWarnedHomes: number;
  unassignedWarnedResidents: number;
  residentCapacity: number;
  remainingResidentCapacity: number;
} {
  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const radius = palisadedRefugeEffectiveRadius(
    refuge,
    fireDisabled.has(refuge.id),
  );
  const empty = {
    homesInReach: 0,
    residentsInReach: 0,
    warnedHomesInReach: 0,
    warnedResidentsInReach: 0,
    shelteredHomes: 0,
    shelteredResidents: 0,
    shelteredWealth: 0,
    unassignedWarnedHomes: 0,
    unassignedWarnedResidents: 0,
    residentCapacity: PALISADED_REFUGE_RESIDENT_CAPACITY,
    remainingResidentCapacity: PALISADED_REFUGE_RESIDENT_CAPACITY,
  };
  if (radius <= 0) {
    return empty;
  }
  const plan = computeRefugeShelterPlan(gameState);
  const radiusSquared = radius * radius;
  let homesInReach = 0;
  let residentsInReach = 0;
  let warnedHomesInReach = 0;
  let warnedResidentsInReach = 0;
  let shelteredHomes = 0;
  let shelteredResidents = 0;
  let shelteredWealth = 0;
  let unassignedWarnedHomes = 0;
  let unassignedWarnedResidents = 0;
  for (const residence of gameState.residences.values()) {
    if (residence.abandoned || residence.population <= 0) continue;
    if (distanceSquared(refuge, residence) > radiusSquared) continue;
    homesInReach += 1;
    residentsInReach += residence.population;
    if (!plan.warnedResidenceIds.has(residence.id)) continue;
    warnedHomesInReach += 1;
    warnedResidentsInReach += residence.population;
    const assignedRefuge = plan.refugeByResidence.get(residence.id);
    if (assignedRefuge === refuge.id) {
      shelteredHomes += 1;
      shelteredResidents += residence.population;
      shelteredWealth += positivePortableAmount(residence.householdWealth);
    } else if (assignedRefuge == null) {
      unassignedWarnedHomes += 1;
      unassignedWarnedResidents += residence.population;
    }
  }
  return {
    homesInReach,
    residentsInReach,
    warnedHomesInReach,
    warnedResidentsInReach,
    shelteredHomes,
    shelteredResidents,
    shelteredWealth,
    unassignedWarnedHomes,
    unassignedWarnedResidents,
    residentCapacity: PALISADED_REFUGE_RESIDENT_CAPACITY,
    remainingResidentCapacity: Math.max(
      0,
      PALISADED_REFUGE_RESIDENT_CAPACITY - shelteredResidents,
    ),
  };
}

export function frontierDefenseFireSignature(
  gameState: Pick<GameState, 'buildings' | 'fireIncidents'>,
): string {
  const disabledDefenseIds: string[] = [];
  for (const incident of gameState.fireIncidents.values()) {
    if (incident.targetKind !== 'building') continue;
    const kind = gameState.buildings.get(incident.targetId)?.kind;
    if (
      kind === 'watchtower'
      || kind === 'guardhouse'
      || kind === 'palisaded_refuge'
    ) {
      disabledDefenseIds.push(`${kind}:${incident.targetId}`);
    }
  }
  disabledDefenseIds.sort();
  return disabledDefenseIds.join('|');
}

function portableRaidValue(stores: PortableRaidStoresLike): number {
  return positivePortableAmount(stores.timber)
    + positivePortableAmount(stores.firewood)
    + positivePortableAmount(stores.ryeSheaves)
    + positivePortableAmount(stores.oatSheaves)
    + positivePortableAmount(stores.barleySheaves)
    + positivePortableAmount(stores.maslinSheaves)
    + positivePortableAmount(stores.ryeGrain)
    + positivePortableAmount(stores.oatGrain)
    + positivePortableAmount(stores.animalFeed)
    + positivePortableAmount(stores.maslinGrain)
    + positivePortableAmount(stores.barley)
    + positivePortableAmount(stores.malt)
    + positivePortableAmount(stores.ryeFlour)
    + positivePortableAmount(stores.maslinFlour)
    + positivePortableAmount(stores.ale)
    + positivePortableAmount(stores.honey)
    + positivePortableAmount(stores.wax) * 1.5
    + positivePortableAmount(stores.candles) * 2
    + positivePortableAmount(stores.wine)
    + positivePortableAmount(stores.wool)
    + positivePortableAmount(stores.flax)
    + positivePortableAmount(stores.cloth) * CLOTH_RAID_VALUE_MULTIPLIER
    + positivePortableAmount(stores.ironwork) * IRONWORK_RAID_VALUE_MULTIPLIER
    + positivePortableAmount(stores.polearms) * POLEARM_RAID_VALUE_MULTIPLIER
    + positivePortableAmount(stores.iron) * IRONWORK_RAID_VALUE_MULTIPLIER
    + positivePortableAmount(stores.clay)
    + positivePortableAmount(stores.salt) * 1.5
    + positivePortableAmount(stores.charcoal)
    + positivePortableAmount(stores.pottery) * 1.25
    + positivePortableAmount(stores.remedies) * 1.25
    + positivePortableAmount(stores.ryeBread)
    + positivePortableAmount(stores.maslinBread)
    + positivePortableAmount(stores.meat)
    + positivePortableAmount(stores.fish)
    + positivePortableAmount(stores.berries)
    + positivePortableAmount(stores.mushrooms)
    + positivePortableAmount(stores.milk)
    + positivePortableAmount(stores.apples)
    + positivePortableAmount(stores.cherries)
    + positivePortableAmount(stores.eggs)
    + positivePortableAmount(stores.grapes)
    + positivePortableAmount(stores.curedMeat)
    + positivePortableAmount(stores.smokedFish)
    + positivePortableAmount(stores.cheese)
    + positivePortableAmount(stores.gold);
}

const RAID_PORTABLE_STORE_SUMMARY = [
  ['timber', 'timber', 1],
  ['firewood', 'firewood', 1],
  ['ryeSheaves', 'rye sheaves', 1],
  ['oatSheaves', 'oat sheaves', 1],
  ['barleySheaves', 'barley sheaves', 1],
  ['maslinSheaves', 'maslin sheaves', 1],
  ['ryeGrain', 'rye grain', 1],
  ['oatGrain', 'oats', 1],
  ['animalFeed', 'animal feed', 1],
  ['maslinGrain', 'maslin grain', 1],
  ['barley', 'barley', 1],
  ['malt', 'malt', 1],
  ['ryeFlour', 'rye flour', 1],
  ['maslinFlour', 'maslin flour', 1],
  ['ale', 'ale', 1],
  ['honey', 'honey', 1],
  ['wax', 'beeswax', 1.5],
  ['candles', 'candles', 2],
  ['wine', 'wine', 1],
  ['wool', 'wool', 1],
  ['flax', 'flax fibre', 1],
  ['cloth', 'clothing', CLOTH_RAID_VALUE_MULTIPLIER],
  ['ironwork', 'ironwork', IRONWORK_RAID_VALUE_MULTIPLIER],
  ['polearms', 'polearms', POLEARM_RAID_VALUE_MULTIPLIER],
  ['iron', 'iron bars', IRONWORK_RAID_VALUE_MULTIPLIER],
  ['clay', 'river clay', 1],
  ['salt', 'sea salt', 1.5],
  ['charcoal', 'charcoal', 1],
  ['pottery', 'pottery', 1.25],
  ['remedies', 'dried remedies', 1.25],
  ['ryeBread', 'rye bread', 1],
  ['maslinBread', 'maslin bread', 1],
  ['meat', 'meat', 1],
  ['fish', 'fish', 1],
  ['berries', 'raspberries', 1],
  ['mushrooms', 'mushrooms', 1],
  ['milk', 'milk', 1],
  ['apples', 'apples', 1],
  ['cherries', 'cherries', 1],
  ['eggs', 'eggs', 1],
  ['grapes', 'grapes', 1],
  ['curedMeat', 'cured meat', 1],
  ['smokedFish', 'smoked fish', 1],
  ['cheese', 'cheese', 1],
  ['gold', 'gold', 1],
] as const;

function portableRaidSummary(storesLike: PortableRaidStoresLike | undefined): string {
  if (!storesLike) return 'portable stores';
  const stores = RAID_PORTABLE_STORE_SUMMARY
    .map(([key, label, valueMultiplier], order) => {
      const amount = positivePortableAmount(storesLike[key]);
      return { label, amount, raidValue: amount * valueMultiplier, order };
    })
    .filter((store) => store.amount > 1e-9)
    .sort((left, right) =>
      right.raidValue - left.raidValue || left.order - right.order
    )
    .slice(0, 2);
  return stores.length === 0
    ? 'minor stores'
    : stores
        .map((store) => `${formatPortableStoreAmount(store.amount)} ${store.label}`)
        .join(' + ');
}

const DELIVERY_CARGO_RAID_VALUE: Partial<Record<DeliveryCargoKind, number>> = {
  timber: 1,
  firewood: 1,
  ryeSheaves: 1,
  oatSheaves: 1,
  barleySheaves: 1,
  maslinSheaves: 1,
  ryeGrain: 1,
  oatGrain: 1,
  animalFeed: 1,
  maslinGrain: 1,
  barley: 1,
  malt: 1,
  ryeFlour: 1,
  maslinFlour: 1,
  ale: 1,
  honey: 1,
  wax: 1.5,
  candles: 2,
  wine: 1,
  wool: 1,
  flax: 1,
  cloth: CLOTH_RAID_VALUE_MULTIPLIER,
  ironwork: IRONWORK_RAID_VALUE_MULTIPLIER,
  polearms: POLEARM_RAID_VALUE_MULTIPLIER,
  gold: 1,
  iron: IRONWORK_RAID_VALUE_MULTIPLIER,
  clay: 1,
  salt: 1.5,
  charcoal: 1,
  pottery: 1.25,
  remedies: 1.25,
  ryeBread: 1,
  maslinBread: 1,
  meat: 1,
  fish: 1,
  berries: 1,
  mushrooms: 1,
  milk: 1,
  apples: 1,
  cherries: 1,
  eggs: 1,
  grapes: 1,
  curedMeat: 1,
  smokedFish: 1,
  cheese: 1,
};

function deliveryTripRaidValue(trip: DeliveryTripState): number {
  return positivePortableAmount(trip.amount)
    * (DELIVERY_CARGO_RAID_VALUE[trip.cargoKind] ?? 0);
}

function deliveryTripRaidSummary(trip: DeliveryTripState | undefined): string {
  if (!trip) return 'cargo on the road';
  return `${formatPortableStoreAmount(trip.amount)} ${deliveryCargoLabel(
    trip.cargoKind,
  )} on the road`;
}

function deliveryCargoLabel(kind: DeliveryCargoKind): string {
  switch (kind) {
    case 'curedMeat': return 'cured meat';
    case 'smokedFish': return 'smoked fish';
    default: return kind;
  }
}

function positivePortableAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function raidableTreasuryTimber(timber: number, reservedTimber: number): number {
  return Math.max(
    0,
    positivePortableAmount(timber) - positivePortableAmount(reservedTimber),
  );
}

function earlierBuilding(
  current: BuildingState | null,
  candidate: BuildingState,
): BuildingState {
  return current === null || compareStableIds(candidate.id, current.id) < 0
    ? candidate
    : current;
}

function formatPortableStoreAmount(value: number): string {
  const rounded = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

type WatchArea = { id: string; x: number; z: number; radius: number };
type WatchCoverageIndex = Map<string, WatchArea[]>;

function buildWatchCoverageIndex(towers: readonly WatchArea[]): WatchCoverageIndex {
  const cells: WatchCoverageIndex = new Map();
  for (const tower of towers) {
    if (
      !Number.isFinite(tower.x)
      || !Number.isFinite(tower.z)
      || !Number.isFinite(tower.radius)
      || tower.radius <= 0
    ) continue;
    const minX = watchCell(tower.x - tower.radius);
    const maxX = watchCell(tower.x + tower.radius);
    const minZ = watchCell(tower.z - tower.radius);
    const maxZ = watchCell(tower.z + tower.radius);
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        const key = watchCellKey(cellX, cellZ);
        const bucket = cells.get(key);
        if (bucket) bucket.push(tower);
        else cells.set(key, [tower]);
      }
    }
  }
  return cells;
}

type RefugeAssignmentCandidate = {
  residenceId: string;
  refugeId: string;
  residents: number;
  distanceSquared: number;
};

function assignRefugeHouseholds(
  gameState: GameState,
  watchIndex: WatchCoverageIndex,
  refugeIndex: WatchCoverageIndex,
  activeRefuges: number,
): RefugeShelterPlan {
  const refugeByResidence = new Map<string, string>();
  const residentsByRefuge = new Map<string, number>();
  const warnedResidenceIds = new Set<string>();
  const candidates: RefugeAssignmentCandidate[] = [];
  let warnedHomesInReach = 0;
  let warnedResidentsInReach = 0;

  if (activeRefuges > 0) {
    for (const residence of gameState.residences.values()) {
      if (residence.abandoned || residence.population <= 0) continue;
      if (!positionIsWatched(residence.x, residence.z, watchIndex)) continue;
      const refuges = watchAreasContaining(
        residence.x,
        residence.z,
        refugeIndex,
      );
      if (refuges.length === 0) continue;
      const residents = Math.max(0, Math.floor(residence.population));
      warnedResidenceIds.add(residence.id);
      warnedHomesInReach += 1;
      warnedResidentsInReach += residents;
      for (const refuge of refuges) {
        const dx = residence.x - refuge.x;
        const dz = residence.z - refuge.z;
        candidates.push({
          residenceId: residence.id,
          refugeId: refuge.id,
          residents,
          distanceSquared: dx * dx + dz * dz,
        });
      }
    }
  }

  candidates.sort((left, right) => {
    if (left.distanceSquared !== right.distanceSquared) {
      return left.distanceSquared - right.distanceSquared;
    }
    const residenceOrder = compareStableIds(
      left.residenceId,
      right.residenceId,
    );
    return residenceOrder !== 0
      ? residenceOrder
      : compareStableIds(left.refugeId, right.refugeId);
  });

  let assignedResidents = 0;
  for (const candidate of candidates) {
    if (
      candidate.residents <= 0
      || candidate.residents > PALISADED_REFUGE_RESIDENT_CAPACITY
      || refugeByResidence.has(candidate.residenceId)
    ) continue;
    const occupied = residentsByRefuge.get(candidate.refugeId) ?? 0;
    const nextOccupied = occupied + candidate.residents;
    if (nextOccupied > PALISADED_REFUGE_RESIDENT_CAPACITY) continue;
    residentsByRefuge.set(candidate.refugeId, nextOccupied);
    refugeByResidence.set(candidate.residenceId, candidate.refugeId);
    assignedResidents += candidate.residents;
  }

  return {
    activeRefuges,
    residentCapacityPerRefuge: PALISADED_REFUGE_RESIDENT_CAPACITY,
    totalResidentCapacity:
      activeRefuges * PALISADED_REFUGE_RESIDENT_CAPACITY,
    warnedHomesInReach,
    warnedResidentsInReach,
    assignedHomes: refugeByResidence.size,
    assignedResidents,
    unassignedWarnedHomes:
      warnedHomesInReach - refugeByResidence.size,
    unassignedWarnedResidents:
      warnedResidentsInReach - assignedResidents,
    refugeByResidence,
    residentsByRefuge,
    warnedResidenceIds,
  };
}

function projectedTargetDistrictDefense(
  x: number,
  z: number,
  watched: boolean,
  watchIndex: WatchCoverageIndex,
  readinessByWatch: ReadonlyMap<string, number>,
  enemyPressure: number,
): Pick<
  ProjectedRaidTargetCandidate,
  'localReadyGuards' | 'localGuardsRequired' | 'estimatedLossFraction'
> {
  const localReadyGuards = watched
    ? watchAreasContaining(x, z, watchIndex).reduce(
        (total, tower) => total + Math.max(0, readinessByWatch.get(tower.id) ?? 0),
        0,
      )
    : 0;
  const localGuardsRequired = raidGuardsRequiredForTarget(enemyPressure, watched);
  const defenseRatio = clamp01(localReadyGuards / Math.max(1e-9, localGuardsRequired));
  return {
    localReadyGuards,
    localGuardsRequired,
    estimatedLossFraction: guardedRaidLossForTarget(
      enemyPressure,
      watched,
      defenseRatio,
    ),
  };
}

function raidGuardsRequiredForTarget(enemyPressure: number, watched: boolean): number {
  const pressure = Math.max(0, Math.min(100, enemyPressure));
  const strength = 2.5 + pressure * 0.065;
  return strength / (watched ? 1 : 0.65);
}

function guardedRaidLossForTarget(
  enemyPressure: number,
  watched: boolean,
  defenseRatio: number,
): number {
  const pressure = clamp01(enemyPressure / 100);
  const exposedLoss = 0.12 + pressure * 0.2;
  const warnedLoss = exposedLoss * (1 - (watched ? 1 : 0) * 0.88);
  const defense = clamp01(defenseRatio);
  return defense >= 1 - 1e-9
    ? 0
    : clamp01(warnedLoss * (1 - defense * 0.8));
}

function watchAreasContaining(
  x: number,
  z: number,
  index: WatchCoverageIndex,
): WatchArea[] {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
  return (index.get(watchCellKey(watchCell(x), watchCell(z))) ?? []).filter(
    (tower) => {
      const dx = x - tower.x;
      const dz = z - tower.z;
      return dx * dx + dz * dz <= tower.radius * tower.radius;
    },
  );
}

function positionIsWatched(
  x: number,
  z: number,
  index: WatchCoverageIndex,
): boolean {
  return watchAreasContaining(x, z, index).length > 0;
}

function watchCell(value: number): number {
  return Math.floor(value / WATCH_COVERAGE_CELL_SIZE);
}

function watchCellKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

function compareProjectedRaidTargets(
  left: ProjectedRaidTargetCandidate,
  right: ProjectedRaidTargetCandidate,
): number {
  if (
    left.estimatedLossFraction != null
    && right.estimatedLossFraction != null
    && Math.abs(left.estimatedLossFraction - right.estimatedLossFraction) > 1e-9
  ) {
    return right.estimatedLossFraction - left.estimatedLossFraction;
  }
  if (left.protected !== right.protected) return left.protected ? 1 : -1;
  if (left.portableValue !== right.portableValue) {
    return right.portableValue - left.portableValue;
  }
  const idOrder = compareStableIds(left.id, right.id);
  if (idOrder !== 0) return idOrder;
  if (left.kind === right.kind) return 0;
  const kindOrder: Record<ProjectedRaidTarget['kind'], number> = {
    building: 0,
    residence: 1,
    cart: 2,
    treasury: 3,
  };
  return kindOrder[left.kind] - kindOrder[right.kind];
}

function compareStableIds(left: string, right: string): number {
  if (isUnsignedIntegerId(left) && isUnsignedIntegerId(right)) {
    let leftStart = 0;
    let rightStart = 0;
    while (leftStart + 1 < left.length && left.charCodeAt(leftStart) === 48) leftStart += 1;
    while (rightStart + 1 < right.length && right.charCodeAt(rightStart) === 48) rightStart += 1;
    const leftLength = left.length - leftStart;
    const rightLength = right.length - rightStart;
    if (leftLength !== rightLength) return leftLength - rightLength;
    const leftId = left.slice(leftStart);
    const rightId = right.slice(rightStart);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUnsignedIntegerId(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function distanceSquared(
  a: Pick<BuildingState, 'x' | 'z'>,
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function raidApproachFromId(
  value: number,
): SettlementSecurityState['raidApproach'] {
  switch (value) {
    case 1: return 'north';
    case 2: return 'east';
    case 3: return 'south';
    case 4: return 'west';
    default: return 'unknown';
  }
}

function formatGuardCount(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0);
}
