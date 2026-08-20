import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CLAY_PIT_CLAY_PER_CYCLE,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
  STONE_PER_HARVEST,
} from '../generated/gameBalance.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type {
  BuildingState,
  GameState,
  ResourceNodeState,
} from '../resources/types.ts';
import { civilianToolThroughputMultiplier } from './civilianToolPolicy.ts';
import { clayBankYieldAt } from './clayBankPolicy.ts';
import {
  largeQuarrySupportRunwayCycles,
  largeQuarrySupportsReady,
} from './largeQuarrySupportPolicy.ts';
import {
  richMineSupportRunwayCycles,
  richMineSupportsReady,
} from './mineSupportPolicy.ts';
import {
  extractionOutputHeadroom,
  extractionOutputTarget,
  type ExtractionOutputCommodity,
} from './processorOutputPolicy.ts';

export type GeologicalResource = 'stone' | 'clay' | 'iron' | 'salt';

export type GeologicalResourcePlan = {
  resource: GeologicalResource;
  deposits: number;
  ordinaryDeposits: number;
  richDeposits: number;
  exhaustedFiniteDeposits: number;
  finiteReserve: number;
  finiteCapacity: number;
  extractionSites: number;
  staffedExtractionSites: number;
  operatingExtractionSites: number;
  staffedTargetPausedSites: number;
  yardStock: number;
  yardTarget: number;
  yardHeadroom: number;
  yardSurplusAboveTarget: number;
  finiteExtractionPerDay: number;
  deepExtractionPerDay: number;
  activeDeepSources: number;
  deepSupportTimberPerDay: number;
  deepSupportRunwayCycles: number;
  deepSourcesAwaitingSupports: number;
  /** Shortest currently worked finite seam runway; null when no finite seam is being depleted. */
  shortestFiniteRunwayDays: number | null;
  firstSupportBuildingId: string | null;
  firstTargetPausedBuildingId: string | null;
  firstAttentionBuildingId: string | null;
};

export type SettlementGeologyPlan = Record<
  GeologicalResource,
  GeologicalResourcePlan
>;

type MutableGeologicalResourcePlan = GeologicalResourcePlan & {
  finiteRatesByDeposit: Map<string, number>;
  finiteBuildingsByDeposit: Map<string, string>;
  blockedFiniteBuildingId: string | null;
};

const MINERAL_CENTER_TOLERANCE_SQ = 2.5 * 2.5;
const EPSILON = 1e-9;
export const GEOLOGY_RUNWAY_WATCH_DAYS = 20;
export const GEOLOGY_RUNWAY_CRITICAL_DAYS = 7;
const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

type SettlementGeologyAlertBase = {
  resource: GeologicalResource;
  level: 'watch' | 'critical';
  firstAttentionBuildingId: string;
  finiteReserve: number;
  activeDeepSources: number;
  deepExtractionPerDay: number;
  deepSupportTimberPerDay: number;
  deepSourcesAwaitingSupports: number;
};

export type SettlementGeologyAlert =
  | SettlementGeologyAlertBase & {
    reason: 'finite-runway';
    runwayDays: number;
  }
  | SettlementGeologyAlertBase & {
    reason: 'deep-supports';
    runwayDays: number | null;
  };

/**
 * Settlement-wide reserve and extraction forecast for physical geological
 * materials. Every deposit has a finite surface reserve. Rich nodes also
 * provide a separate non-depleting underground source for a centered Quarry.
 *
 * This mirrors server producer rates and deposit selection. It uses assigned
 * labor as installed capacity, just like the Town Hall's other long-run plans;
 * carts temporarily drawing workers away can reduce moment-to-moment output.
 */
export function computeSettlementGeologyPlan(
  state: GameState,
  sabbathObserved: boolean,
  options: {
    clayPitThroughputMultiplier?: number;
    resourceAbundance?: number;
  } = {},
): SettlementGeologyPlan {
  const plans = {
    stone: emptyResourcePlan('stone'),
    clay: emptyResourcePlan('clay'),
    iron: emptyResourcePlan('iron'),
    salt: emptyResourcePlan('salt'),
  };
  const deposits = {
    stone: [] as ResourceNodeState[],
    clay: [] as ResourceNodeState[],
    iron: [] as ResourceNodeState[],
    salt: [] as ResourceNodeState[],
  };

  for (const deposit of state.quarries.values()) {
    if (
      deposit.kind !== 'quarry'
      || (deposit.resource !== 'stone'
        && deposit.resource !== 'clay'
        && deposit.resource !== 'iron'
        && deposit.resource !== 'salt')
    ) {
      continue;
    }
    const resource = deposit.resource;
    deposits[resource].push(deposit);
    const plan = plans[resource];
    plan.deposits += 1;
    if (deposit.isRich) {
      plan.richDeposits += 1;
    } else {
      plan.ordinaryDeposits += 1;
    }

    plan.finiteReserve += Math.max(0, deposit.remaining);
    plan.finiteCapacity += Math.max(0, deposit.maxYield);
    if (deposit.remaining <= EPSILON) {
      plan.exhaustedFiniteDeposits += 1;
    }
  }

  const mineralDeposits = [...deposits.iron, ...deposits.salt];
  const geologicalDeposits = [
    ...deposits.stone,
    ...deposits.iron,
    ...deposits.salt,
    ...deposits.clay,
  ];
  const disabledBuildings = fireDisabledBuildingIds(
    state.fireIncidents?.values?.() ?? [],
  );
  const inboundTimberByBuildingId = new Map<string, number>();
  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.cargoKind !== 'timber'
      || trip.phase === 'inbound'
      || trip.amount <= EPSILON
    ) {
      continue;
    }
    inboundTimberByBuildingId.set(
      trip.targetBuildingId,
      (inboundTimberByBuildingId.get(trip.targetBuildingId) ?? 0)
        + trip.amount,
    );
  }
  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || (building.kind !== 'stone_quarry'
        && building.kind !== 'large_quarry'
        && building.kind !== 'clay_pit'
        && building.kind !== 'mine')
    ) {
      continue;
    }

    if (building.kind === 'stone_quarry') {
      const anyDeposit = nearestSurfaceDeposit(
        building,
        geologicalDeposits,
        building.workRadius || getBuildingDefinition('stone_quarry').workRadius,
        true,
      );
      if (anyDeposit === null) continue;
      const resource = anyDeposit.resource as GeologicalResource;
      const plan = plans[resource];
      plan.extractionSites += 1;
      const targetPaused = recordExtractionYard(
        plan,
        building,
        resource,
      );
      if (building.assignedLabor <= 0 || disabledBuildings.has(building.id)) {
        continue;
      }
      plan.staffedExtractionSites += 1;
      if (targetPaused) {
        recordTargetPause(plan, building);
        continue;
      }
      const deposit = nearestSurfaceDeposit(
        building,
        geologicalDeposits,
        building.workRadius || getBuildingDefinition('stone_quarry').workRadius,
        false,
      );
      if (deposit === null) {
        plan.blockedFiniteBuildingId ??= building.id;
        continue;
      }
      const rate = cyclesPerCalendarDay(
        'stone_quarry',
        building.assignedLabor,
        sabbathObserved,
        civilianToolThroughputMultiplier(building.ironwork ?? 0),
      ) * extractionBatch(resource);
      plan.operatingExtractionSites += 1;
      plan.finiteExtractionPerDay += rate;
      addFiniteRate(plan, deposit, building, rate);
      continue;
    }

    if (building.kind === 'large_quarry') {
      const deposit = centeredDeposit(
        building,
        geologicalDeposits,
        (candidate) => candidate.isRich === true,
      );
      if (deposit === null) continue;
      const resource = deposit.resource as GeologicalResource;
      const plan = plans[resource];
      plan.extractionSites += 1;
      const targetPaused = recordExtractionYard(
        plan,
        building,
        resource,
      );
      if (building.assignedLabor <= 0 || disabledBuildings.has(building.id)) {
        continue;
      }
      plan.staffedExtractionSites += 1;
      if (targetPaused) {
        recordTargetPause(plan, building);
        continue;
      }
      const inboundTimber = inboundTimberByBuildingId.get(building.id) ?? 0;
      const cycles = cyclesPerCalendarDay(
        'large_quarry',
        building.assignedLabor,
        sabbathObserved,
        civilianToolThroughputMultiplier(building.ironwork ?? 0),
      );
      plan.deepSupportTimberPerDay +=
        cycles * LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE;
      plan.deepSupportRunwayCycles += largeQuarrySupportRunwayCycles(
        building.timber,
        inboundTimber,
      );
      if (!largeQuarrySupportsReady(building.timber, inboundTimber)) {
        plan.deepSourcesAwaitingSupports += 1;
        plan.firstSupportBuildingId ??= building.id;
        continue;
      }
      plan.operatingExtractionSites += 1;
      plan.activeDeepSources += 1;
      plan.deepExtractionPerDay += cycles * extractionBatch(resource);
      continue;
    }

    if (building.kind === 'clay_pit') {
      const deposit = centeredDeposit(building, deposits.clay);
      if (deposit === null) continue;
      const plan = plans.clay;
      plan.extractionSites += 1;
      const targetPaused = recordExtractionYard(
        plan,
        building,
        'clay',
      );
      if (building.assignedLabor <= 0 || disabledBuildings.has(building.id)) {
        continue;
      }
      plan.staffedExtractionSites += 1;
      if (targetPaused) {
        recordTargetPause(plan, building);
        continue;
      }
      if (!deposit.isRich && deposit.remaining <= EPSILON) {
        plan.blockedFiniteBuildingId ??= building.id;
        continue;
      }
      const rate = cyclesPerCalendarDay(
        'clay_pit',
        building.assignedLabor,
        sabbathObserved,
        civilianToolThroughputMultiplier(building.ironwork ?? 0)
          * Math.max(0, options.clayPitThroughputMultiplier ?? 1)
          * clayBankYieldAt(
            building.x,
            building.z,
            options.resourceAbundance ?? 50,
          ),
      ) * CLAY_PIT_CLAY_PER_CYCLE;
      plan.operatingExtractionSites += 1;
      if (deposit.isRich) {
        plan.activeDeepSources += 1;
        plan.deepExtractionPerDay += rate;
      } else {
        plan.finiteExtractionPerDay += rate;
        addFiniteRate(plan, deposit, building, rate);
      }
      continue;
    }

    const deposit = mineralDepositBeneath(building, mineralDeposits);
    if (deposit === null || (deposit.resource !== 'iron' && deposit.resource !== 'salt')) {
      continue;
    }
    const plan = plans[deposit.resource];
    plan.extractionSites += 1;
    const targetPaused = recordExtractionYard(
      plan,
      building,
      deposit.resource,
    );
    if (building.assignedLabor <= 0 || disabledBuildings.has(building.id)) {
      continue;
    }
    plan.staffedExtractionSites += 1;
    if (targetPaused) {
      recordTargetPause(plan, building);
      continue;
    }
    if (!deposit.isRich && deposit.remaining <= EPSILON) {
      plan.blockedFiniteBuildingId ??= building.id;
      continue;
    }
    const inboundTimber = inboundTimberByBuildingId.get(building.id) ?? 0;
    if (deposit.isRich) {
      const installedCycles = mineralMineCyclesPerDay(
        building,
        sabbathObserved,
        true,
      );
      plan.deepSupportTimberPerDay +=
        installedCycles * MINE_TIMBER_SUPPORT_PER_CYCLE;
      plan.deepSupportRunwayCycles += richMineSupportRunwayCycles(
        building.timber,
        inboundTimber,
      );
      if (!richMineSupportsReady(building.timber, inboundTimber)) {
        plan.deepSourcesAwaitingSupports += 1;
        plan.firstSupportBuildingId ??= building.id;
        continue;
      }
    }
    const rate = mineralMineOutputPerDay(
      building,
      deposit,
      sabbathObserved,
      inboundTimber,
    );
    if (rate > EPSILON) {
      plan.operatingExtractionSites += 1;
    }
    if (deposit.isRich) {
      plan.activeDeepSources += 1;
      plan.deepExtractionPerDay += rate;
    } else {
      plan.finiteExtractionPerDay += rate;
      addFiniteRate(plan, deposit, building, rate);
    }
  }

  for (const resource of ['stone', 'clay', 'iron', 'salt'] as const) {
    const attention = firstFiniteAttention(
      plans[resource],
      deposits[resource],
    );
    plans[resource].firstAttentionBuildingId = attention?.buildingId ?? null;
    plans[resource].shortestFiniteRunwayDays = attention?.runwayDays ?? null;
  }

  return {
    stone: stripInternalFields(plans.stone),
    clay: stripInternalFields(plans.clay),
    iron: stripInternalFields(plans.iron),
    salt: stripInternalFields(plans.salt),
  };
}

export function geologicalFiniteRunwayDays(
  plan: GeologicalResourcePlan,
): number | null {
  if (plan.finiteExtractionPerDay <= EPSILON) return null;
  return plan.finiteReserve / plan.finiteExtractionPerDay;
}

/**
 * Selects one actionable headline warning from the existing geological plan.
 *
 * A ready deep source downgrades an imminent surface exhaustion to a watch:
 * labor still needs moving, but the settlement does not lose the commodity.
 * Staffed deep workings that have stopped for want of physical timber supports
 * also surface here, with the warning aimed at the blocked worksite. Stable
 * resource order keeps equally urgent warnings deterministic.
 */
export function selectSettlementGeologyAlert(
  plan: SettlementGeologyPlan,
): SettlementGeologyAlert | null {
  const resourceOrder: readonly GeologicalResource[] = [
    'stone',
    'clay',
    'iron',
    'salt',
  ];
  let selected: SettlementGeologyAlert | null = null;
  for (const resource of resourceOrder) {
    const candidate = plan[resource];
    const runwayDays = candidate.shortestFiniteRunwayDays;
    let alert: SettlementGeologyAlert | null = null;
    if (
      candidate.deepSourcesAwaitingSupports > 0
      && candidate.firstSupportBuildingId !== null
    ) {
      const localExtractionStopped =
        candidate.finiteExtractionPerDay <= EPSILON
        && candidate.deepExtractionPerDay <= EPSILON;
      alert = {
        reason: 'deep-supports',
        resource,
        level: localExtractionStopped
          || (runwayDays !== null && runwayDays <= GEOLOGY_RUNWAY_CRITICAL_DAYS)
          ? 'critical'
          : 'watch',
        runwayDays: runwayDays === null ? null : Math.max(0, runwayDays),
        firstAttentionBuildingId: candidate.firstSupportBuildingId,
        finiteReserve: candidate.finiteReserve,
        activeDeepSources: candidate.activeDeepSources,
        deepExtractionPerDay: candidate.deepExtractionPerDay,
        deepSupportTimberPerDay: candidate.deepSupportTimberPerDay,
        deepSourcesAwaitingSupports: candidate.deepSourcesAwaitingSupports,
      };
    } else if (
      runwayDays !== null
      && candidate.firstAttentionBuildingId !== null
      && runwayDays <= GEOLOGY_RUNWAY_WATCH_DAYS
    ) {
      const deepReplacementReady =
        candidate.activeDeepSources > 0
        && candidate.deepExtractionPerDay > EPSILON;
      alert = {
        reason: 'finite-runway',
        resource,
        level: runwayDays <= GEOLOGY_RUNWAY_CRITICAL_DAYS
          && !deepReplacementReady
          ? 'critical'
          : 'watch',
        runwayDays: Math.max(0, runwayDays),
        firstAttentionBuildingId: candidate.firstAttentionBuildingId,
        finiteReserve: candidate.finiteReserve,
        activeDeepSources: candidate.activeDeepSources,
        deepExtractionPerDay: candidate.deepExtractionPerDay,
        deepSupportTimberPerDay: candidate.deepSupportTimberPerDay,
        deepSourcesAwaitingSupports: candidate.deepSourcesAwaitingSupports,
      };
    }
    if (alert === null) continue;
    const alertUrgencyDays = alert.runwayDays ?? 0;
    const selectedUrgencyDays = selected?.runwayDays ?? 0;
    if (
      selected === null
      || (alert.level === 'critical' && selected.level !== 'critical')
      || (
        alert.level === selected.level
        && alertUrgencyDays < selectedUrgencyDays - EPSILON
      )
    ) {
      selected = alert;
    }
  }
  return selected;
}

export function mineralDepositBeneath(
  building: Pick<BuildingState, 'x' | 'z'>,
  deposits: Iterable<ResourceNodeState>,
): ResourceNodeState | null {
  for (const deposit of deposits) {
    if (deposit.resource !== 'iron' && deposit.resource !== 'salt') continue;
    if (distanceSq(building, deposit) <= MINERAL_CENTER_TOLERANCE_SQ) {
      return deposit;
    }
  }
  return null;
}

export function mineralMineOutputPerDay(
  building: Pick<BuildingState, 'assignedLabor' | 'ironwork' | 'timber'>,
  deposit: Pick<ResourceNodeState, 'resource' | 'remaining' | 'isRich'>,
  sabbathObserved: boolean,
  inboundTimber = 0,
): number {
  if (
    (deposit.resource !== 'iron' && deposit.resource !== 'salt')
    || (deposit.isRich !== true && deposit.remaining <= EPSILON)
  ) {
    return 0;
  }
  if (
    deposit.isRich
    && !richMineSupportsReady(building.timber, inboundTimber)
  ) {
    return 0;
  }
  const batch = deposit.resource === 'iron'
    ? MINE_IRON_PER_CYCLE
    : MINE_SALT_PER_CYCLE;
  return mineralMineCyclesPerDay(
    building,
    sabbathObserved,
    deposit.isRich === true,
  ) * batch;
}

function mineralMineCyclesPerDay(
  building: Pick<BuildingState, 'assignedLabor' | 'ironwork'>,
  sabbathObserved: boolean,
  isRich: boolean,
): number {
  return cyclesPerCalendarDay(
    'mine',
    building.assignedLabor,
    sabbathObserved,
    (isRich ? RICH_MINE_THROUGHPUT_MULTIPLIER : 1)
      * civilianToolThroughputMultiplier(building.ironwork ?? 0),
  );
}

function emptyResourcePlan(
  resource: GeologicalResource,
): MutableGeologicalResourcePlan {
  return {
    resource,
    deposits: 0,
    ordinaryDeposits: 0,
    richDeposits: 0,
    exhaustedFiniteDeposits: 0,
    finiteReserve: 0,
    finiteCapacity: 0,
    extractionSites: 0,
    staffedExtractionSites: 0,
    operatingExtractionSites: 0,
    staffedTargetPausedSites: 0,
    yardStock: 0,
    yardTarget: 0,
    yardHeadroom: 0,
    yardSurplusAboveTarget: 0,
    finiteExtractionPerDay: 0,
    deepExtractionPerDay: 0,
    activeDeepSources: 0,
    deepSupportTimberPerDay: 0,
    deepSupportRunwayCycles: 0,
    deepSourcesAwaitingSupports: 0,
    shortestFiniteRunwayDays: null,
    firstSupportBuildingId: null,
    firstTargetPausedBuildingId: null,
    firstAttentionBuildingId: null,
    finiteRatesByDeposit: new Map(),
    finiteBuildingsByDeposit: new Map(),
    blockedFiniteBuildingId: null,
  };
}

function stripInternalFields(
  plan: MutableGeologicalResourcePlan,
): GeologicalResourcePlan {
  const {
    finiteRatesByDeposit: _finiteRatesByDeposit,
    finiteBuildingsByDeposit: _finiteBuildingsByDeposit,
    blockedFiniteBuildingId: _blockedFiniteBuildingId,
    ...publicPlan
  } = plan;
  return publicPlan;
}

function recordExtractionYard(
  plan: MutableGeologicalResourcePlan,
  building: BuildingState,
  commodity: ExtractionOutputCommodity,
): boolean {
  const stock = Math.max(0, building[commodity] ?? 0);
  const target = extractionOutputTarget(
    building.kind as 'stone_quarry' | 'large_quarry' | 'mine' | 'clay_pit',
    commodity,
    building.processorOutputTargetPercent,
  );
  const headroom = extractionOutputHeadroom(building, commodity) ?? 0;
  plan.yardStock += stock;
  plan.yardTarget += target;
  plan.yardHeadroom += headroom;
  plan.yardSurplusAboveTarget += Math.max(0, stock - target);
  return headroom <= EPSILON;
}

function recordTargetPause(
  plan: MutableGeologicalResourcePlan,
  building: Pick<BuildingState, 'id'>,
): void {
  plan.staffedTargetPausedSites += 1;
  plan.firstTargetPausedBuildingId ??= building.id;
}

function cyclesPerCalendarDay(
  kind: 'stone_quarry' | 'large_quarry' | 'clay_pit' | 'mine',
  assignedLabor: number,
  sabbathObserved: boolean,
  throughputMultiplier: number,
): number {
  const interval = getBuildingDefinition(kind).harvestInterval;
  if (assignedLabor <= 0 || interval <= EPSILON) return 0;
  return WORKDAY_SECONDS
    * (sabbathObserved ? 6 / 7 : 1)
    * assignedLabor
    * Math.max(0, throughputMultiplier)
    / interval;
}

function centeredDeposit(
  building: BuildingState,
  deposits: readonly ResourceNodeState[],
  predicate: (deposit: ResourceNodeState) => boolean = () => true,
): ResourceNodeState | null {
  for (const deposit of deposits) {
    if (!predicate(deposit)) continue;
    if (distanceSq(building, deposit) <= MINERAL_CENTER_TOLERANCE_SQ) {
      return deposit;
    }
  }
  return null;
}

function nearestSurfaceDeposit(
  building: BuildingState,
  deposits: readonly ResourceNodeState[],
  workRadius: number,
  includeExhausted: boolean,
): ResourceNodeState | null {
  const radiusSq = workRadius * workRadius;
  let nearest: ResourceNodeState | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const deposit of deposits) {
    if (!includeExhausted && deposit.remaining <= EPSILON) continue;
    const candidateDistanceSq = distanceSq(building, deposit);
    if (candidateDistanceSq > radiusSq || candidateDistanceSq >= nearestDistanceSq) {
      continue;
    }
    nearest = deposit;
    nearestDistanceSq = candidateDistanceSq;
  }
  return nearest;
}

function extractionBatch(resource: GeologicalResource): number {
  switch (resource) {
    case 'iron': return MINE_IRON_PER_CYCLE;
    case 'salt': return MINE_SALT_PER_CYCLE;
    case 'clay': return CLAY_PIT_CLAY_PER_CYCLE;
    case 'stone': return STONE_PER_HARVEST;
  }
}

function distanceSq(
  a: Pick<BuildingState, 'x' | 'z'>,
  b: Pick<ResourceNodeState, 'x' | 'z'>,
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function addFiniteRate(
  plan: MutableGeologicalResourcePlan,
  deposit: ResourceNodeState,
  building: BuildingState,
  rate: number,
): void {
  plan.finiteRatesByDeposit.set(
    deposit.nodeId,
    (plan.finiteRatesByDeposit.get(deposit.nodeId) ?? 0) + rate,
  );
  if (!plan.finiteBuildingsByDeposit.has(deposit.nodeId)) {
    plan.finiteBuildingsByDeposit.set(deposit.nodeId, building.id);
  }
}

function firstFiniteAttention(
  plan: MutableGeologicalResourcePlan,
  deposits: readonly ResourceNodeState[],
): { buildingId: string; runwayDays: number } | null {
  if (plan.blockedFiniteBuildingId !== null) {
    return {
      buildingId: plan.blockedFiniteBuildingId,
      runwayDays: 0,
    };
  }
  let firstId: string | null = null;
  let shortestRunway = Number.POSITIVE_INFINITY;
  for (const deposit of deposits) {
    const rate = plan.finiteRatesByDeposit.get(deposit.nodeId) ?? 0;
    if (rate <= EPSILON) continue;
    const runway = Math.max(0, deposit.remaining) / rate;
    if (runway < shortestRunway) {
      shortestRunway = runway;
      firstId = plan.finiteBuildingsByDeposit.get(deposit.nodeId) ?? null;
    }
  }
  return firstId === null
    ? null
    : {
        buildingId: firstId,
        runwayDays: shortestRunway,
      };
}
