import {
  CALENDAR_SECONDS_PER_DAY,
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE,
  GUARDHOUSE_LONG_MUSTER_EFFICIENCY,
  GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE,
  GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import type { SettlementSecurity } from '../generated/types.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { buildingKindLabel } from '../resources/WorldLayoutRegistry.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';

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
  lastOutcome: 'none',
  lastGoodsLost: 0,
  lastWealthLost: 0,
  guardsRequired: 0,
  targetsAtRisk: 0,
  estimatedLossFraction: 0,
};

export const GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS = 3;
export const GUARDHOUSE_FOOD_BUFFER_PER_GUARD = 6;
export const GUARDHOUSE_MIN_FOOD_BUFFER = 12;
export const GUARDHOUSE_FOOD_RESERVE_LEAN = 3;
export const GUARDHOUSE_FOOD_RESERVE_STANDARD = GUARDHOUSE_FOOD_BUFFER_PER_GUARD;
export const GUARDHOUSE_FOOD_RESERVE_DEEP = 12;
export const GUARDHOUSE_FOOD_RESERVES = [
  {
    reservePerGuard: GUARDHOUSE_FOOD_RESERVE_LEAN,
    label: 'Lean',
    hint: 'Frees fresh food and cart capacity, but leaves little disruption margin.',
  },
  {
    reservePerGuard: GUARDHOUSE_FOOD_RESERVE_STANDARD,
    label: 'Company',
    hint: 'The established company buffer used by existing settlements.',
  },
  {
    reservePerGuard: GUARDHOUSE_FOOD_RESERVE_DEEP,
    label: 'Deep',
    hint: 'Ties up more perishable food for a longer frontier interruption.',
  },
] as const;
export const WATCH_COVERAGE_CELL_SIZE = 128;

type GuardhouseFoodCandidateLike = Pick<
  BuildingState,
  'id' | 'kind' | 'food' | 'polearms' | 'assignedLabor' | 'constructionComplete'
  | 'guardhouseFoodReserve'
>;

export type RoutedGuardhouseFoodTarget<T extends GuardhouseFoodCandidateLike> = {
  target: T;
  desiredStock: number;
  runwayDays: number;
  routeDistance: number;
};

export function armedGuardCount(
  assignedLabor: number,
  polearms: number | undefined,
): number {
  return Math.max(0, Math.min(assignedLabor, Math.floor(polearms ?? 0)));
}

export function guardhouseFoodTarget(
  assignedLabor: number,
  polearms: number | undefined,
  reservePerGuard: number | undefined = GUARDHOUSE_FOOD_RESERVE_STANDARD,
): number {
  const armed = armedGuardCount(assignedLabor, polearms);
  return armed <= 0
    ? 0
    : Math.max(
        GUARDHOUSE_MIN_FOOD_BUFFER,
        armed * normalizeGuardhouseFoodReserve(reservePerGuard),
      );
}

export function normalizeGuardhouseFoodReserve(
  reservePerGuard: number | undefined,
): number {
  const normalized = Math.floor(reservePerGuard ?? GUARDHOUSE_FOOD_RESERVE_STANDARD);
  return GUARDHOUSE_FOOD_RESERVES.some(
    (candidate) => candidate.reservePerGuard === normalized,
  )
    ? normalized
    : GUARDHOUSE_FOOD_RESERVE_STANDARD;
}

export function guardhouseFoodReserveLabel(
  reservePerGuard: number | undefined,
): string {
  const normalized = normalizeGuardhouseFoodReserve(reservePerGuard);
  return GUARDHOUSE_FOOD_RESERVES.find(
    (candidate) => candidate.reservePerGuard === normalized,
  )?.label ?? 'Company';
}

export function guardhouseFoodRunwayDays(
  assignedLabor: number,
  polearms: number | undefined,
  foodStock: number,
): number {
  const dailyFood = armedGuardCount(assignedLabor, polearms)
    * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  return dailyFood <= 1e-9
    ? Infinity
    : Math.max(0, foodStock) / dailyFood;
}

export function selectCriticalGuardhouseFoodTarget<
  T extends GuardhouseFoodCandidateLike,
>(
  targets: Iterable<T>,
  sourceId: string,
  routeDistanceFor: (target: T) => number | null,
  hasInboundSupply: (target: T) => boolean = () => false,
): RoutedGuardhouseFoodTarget<T> | null {
  let best: RoutedGuardhouseFoodTarget<T> | null = null;
  for (const target of targets) {
    if (
      target.id === sourceId
      || target.kind !== 'guardhouse'
      || target.constructionComplete === false
      || target.assignedLabor <= 0
      || hasInboundSupply(target)
    ) continue;
    const desiredStock = guardhouseFoodTarget(
      target.assignedLabor,
      target.polearms,
      target.guardhouseFoodReserve,
    );
    const runwayDays = guardhouseFoodRunwayDays(
      target.assignedLabor,
      target.polearms,
      target.food,
    );
    if (
      desiredStock <= 1e-6
      || target.food + 1e-6 >= desiredStock
      || runwayDays + 1e-9 >= GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS
    ) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate = { target, desiredStock, runwayDays, routeDistance };
    if (
      best == null
      || candidate.runwayDays < best.runwayDays - 1e-9
      || (
        Math.abs(candidate.runwayDays - best.runwayDays) <= 1e-9
        && candidate.routeDistance < best.routeDistance - 1e-6
      )
      || (
        Math.abs(candidate.runwayDays - best.runwayDays) <= 1e-9
        && Math.abs(candidate.routeDistance - best.routeDistance) <= 1e-6
        && compareStableIds(candidate.target.id, best.target.id) < 0
      )
    ) {
      best = candidate;
    }
  }
  return best;
}

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
      ? `${ready} / ${required} guards ready · projected raid can be fully repelled`
      : `${ready} / ${required} guards ready · no stocked holding currently presents a raid target`;
  }
  const targets = `${security.targetsAtRisk} holding${security.targetsAtRisk === 1 ? '' : 's'} at risk`;
  const loss = `${Math.round(security.estimatedLossFraction * 100)}% portable stores per target`;
  const arson = enemyPressure == null
    ? ''
    : ` · ${Math.round(projectedRaidArsonChance(security, enemyPressure) * 100)}% chance of one raid fire`;
  return `${ready} / ${required} guards ready · ${targets} · about ${loss}${arson}`;
}

export function frontierThreatLabel(
  security: SettlementSecurityState,
  settings: Pick<WorldGenerationSettings, 'conflictMode'> | null,
): string {
  if (settings?.conflictMode !== 'frontier') return 'Peaceful settlement';
  if (security.nextRaidTick <= 0) return 'Frontier quiet';
  if (security.threat >= 0.9) return 'Incursion imminent';
  if (security.threat >= 0.7) return 'Raiders reported';
  if (security.threat >= 0.4) return 'Frontier unrest';
  return 'Frontier watch';
}

export function estimatedRaidDays(
  security: SettlementSecurityState,
  simTick: number,
): number | null {
  if (security.nextRaidTick <= 0) return null;
  const ticksRemaining = Math.max(0, security.nextRaidTick - simTick);
  return ticksRemaining * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY;
}

export function formatRaidReport(security: SettlementSecurityState): string {
  if (security.lastOutcome === 'averted') {
    return security.readyGuards > 0
      ? 'Watch bells mustered the paid guards and the incursion was turned away.'
      : 'Watch bells scattered the raiders before stores were reached.';
  }
  if (security.lastOutcome === 'plundered' || security.lastOutcome === 'arson') {
    const goods = Math.round(security.lastGoodsLost);
    const wealth = Math.round(security.lastWealthLost);
    const losses = [
      goods > 0 ? `${goods} portable goods` : '',
      wealth > 0 ? `${wealth} gold in household and parish wealth` : '',
    ].filter(Boolean);
    const arson = security.lastOutcome === 'arson'
      ? ' and set one reached holding alight'
      : '';
    return `Raiders struck exposed holdings, took ${losses.join(' and ') || 'minor stores'}${arson}.`;
  }
  return 'No incursion has reached the settlement.';
}

export function watchtowerEffectiveRadius(tower: BuildingState): number {
  if (tower.kind !== 'watchtower' || !tower.constructionComplete || tower.assignedLabor <= 0) {
    return 0;
  }
  return tower.assignedLabor === 1 ? tower.workRadius * 0.78 : tower.workRadius;
}

export type GuardhouseMusterState = {
  routeDistance: number | null;
  responseDistance: number | null;
  linkedTowerId: string | null;
  staffedTowers: number;
  roadSpeedMultiplier: number;
  efficiency: number;
  rawReady: number;
  effectiveReady: number;
};

export type ProjectedRaidTarget = {
  kind: 'building' | 'residence';
  id: string;
  x: number;
  z: number;
  label: string;
  protected: boolean;
  portableValue: number;
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

export type GuardhouseMusterResponseBand = 'full' | 'delayed' | 'weak';

export function guardhouseMusterResponseBand(
  efficiency: number,
): GuardhouseMusterResponseBand {
  const normalized = clamp01(efficiency);
  if (normalized >= 0.999) return 'full';
  return normalized >= 0.75 ? 'delayed' : 'weak';
}

export function getGuardhouseMusterState(
  guardhouse: BuildingState,
  gameState: GameState,
  getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) => number | null,
  roadSpeedMultiplier = 1,
): GuardhouseMusterState {
  const towers = [...gameState.buildings.values()].filter(
    (building) =>
      building.kind === 'watchtower'
      && building.constructionComplete !== false
      && building.assignedLabor > 0,
  );
  let routeDistance: number | null = null;
  let linkedTowerId: string | null = null;
  for (const tower of towers) {
    const candidate = getRoadPathDistance(guardhouse.x, guardhouse.z, tower.x, tower.z);
    if (candidate == null) continue;
    if (routeDistance == null || candidate < routeDistance) {
      routeDistance = candidate;
      linkedTowerId = tower.id;
    }
  }
  const armed = armedGuardCount(guardhouse.assignedLabor, guardhouse.polearms);
  const rawReady = armed * clamp01(guardhouse.actionCooldown);
  const normalizedRoadSpeed = normalizeRoadSpeedMultiplier(roadSpeedMultiplier);
  const responseDistance = guardhouseMusterResponseDistance(
    routeDistance,
    normalizedRoadSpeed,
  );
  const efficiency = guardhouseMusterEfficiency(routeDistance, normalizedRoadSpeed);
  return {
    routeDistance,
    responseDistance,
    linkedTowerId,
    staffedTowers: towers.length,
    roadSpeedMultiplier: normalizedRoadSpeed,
    efficiency,
    rawReady,
    effectiveReady: rawReady * efficiency,
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
): ProjectedRaidTarget[] {
  const limit = Math.max(0, Math.floor(targetCount));
  if (limit <= 0) return [];

  const towers = [...gameState.buildings.values()]
    .filter(
      (building) =>
        building.kind === 'watchtower'
        && building.constructionComplete !== false
        && building.assignedLabor > 0,
    )
    .map((tower) => ({
      x: tower.x,
      z: tower.z,
      radius: watchtowerEffectiveRadius(tower),
    }));
  const watchIndex = buildWatchCoverageIndex(towers);

  const selected: ProjectedRaidTarget[] = [];
  const consider = (candidate: ProjectedRaidTarget): void => {
    let insertAt = selected.findIndex(
      (current) => compareProjectedRaidTargets(candidate, current) < 0,
    );
    if (insertAt < 0) insertAt = selected.length;
    if (insertAt >= limit && selected.length >= limit) return;
    selected.splice(insertAt, 0, candidate);
    if (selected.length > limit) selected.pop();
  };

  for (const building of gameState.buildings.values()) {
    if (building.constructionComplete === false || building.kind === 'watchtower') continue;
    const portableValue = buildingPortableRaidValue(building);
    if (portableValue <= 1e-9) continue;
    consider({
      kind: 'building',
      id: building.id,
      x: building.x,
      z: building.z,
      label: buildingKindLabel(building.kind),
      protected: positionIsWatched(building.x, building.z, watchIndex),
      portableValue,
    });
  }
  for (const residence of gameState.residences.values()) {
    if (
      residence.abandoned
      || residence.population <= 0
      || residence.householdWealth <= 1e-9
    ) {
      continue;
    }
    consider({
      kind: 'residence',
      id: residence.id,
      x: residence.x,
      z: residence.z,
      label: `Tier ${residence.tier} household (${residence.population} resident${residence.population === 1 ? '' : 's'})`,
      protected: positionIsWatched(residence.x, residence.z, watchIndex),
      portableValue: residence.householdWealth,
    });
  }
  return selected;
}

export function formatProjectedRaidTargets(targets: readonly ProjectedRaidTarget[]): string {
  if (targets.length === 0) {
    return 'No stocked holding currently presents a likely raid target.';
  }
  const holdings = targets.map(
    (target) => `${target.label} (${target.protected ? 'watched' : 'exposed'})`,
  );
  return `Current likely ${targets.length === 1 ? 'target' : 'targets'}: ${holdings.join('; ')}. Warning rings appear as frontier unrest rises.`;
}

export function countSitesProtectedByWatchtower(
  tower: BuildingState,
  gameState: GameState,
): { buildings: number; homes: number; residents: number } {
  const radius = watchtowerEffectiveRadius(tower);
  if (radius <= 0) return { buildings: 0, homes: 0, residents: 0 };
  const radiusSquared = radius * radius;
  let buildings = 0;
  let homes = 0;
  let residents = 0;
  for (const building of gameState.buildings.values()) {
    if (building.id === tower.id || !building.constructionComplete) continue;
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

function buildingPortableRaidValue(building: BuildingState): number {
  return Math.max(0, building.timber)
    + Math.max(0, building.firewood)
    + Math.max(0, building.food)
    + Math.max(0, building.grain)
    + Math.max(0, building.flour)
    + Math.max(0, building.ale)
    + Math.max(0, building.preservedFood)
    + Math.max(0, building.honey)
    + Math.max(0, building.wine)
    + Math.max(0, building.ironwork ?? 0) * 2
    + Math.max(0, building.polearms ?? 0) * 4
    + Math.max(0, building.gold);
}

type WatchArea = { x: number; z: number; radius: number };
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

function positionIsWatched(
  x: number,
  z: number,
  index: WatchCoverageIndex,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const towers = index.get(watchCellKey(watchCell(x), watchCell(z)));
  return towers?.some((tower) => {
    const dx = x - tower.x;
    const dz = z - tower.z;
    return dx * dx + dz * dz <= tower.radius * tower.radius;
  }) ?? false;
}

function watchCell(value: number): number {
  return Math.floor(value / WATCH_COVERAGE_CELL_SIZE);
}

function watchCellKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

function compareProjectedRaidTargets(
  left: ProjectedRaidTarget,
  right: ProjectedRaidTarget,
): number {
  if (left.protected !== right.protected) return left.protected ? 1 : -1;
  if (left.portableValue !== right.portableValue) {
    return right.portableValue - left.portableValue;
  }
  const idOrder = compareStableIds(left.id, right.id);
  if (idOrder !== 0) return idOrder;
  return left.kind === right.kind ? 0 : left.kind === 'building' ? -1 : 1;
}

function compareStableIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left.localeCompare(right);
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

function formatGuardCount(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0);
}
