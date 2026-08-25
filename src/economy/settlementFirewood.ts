import {
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CHARCOAL_HOUSEHOLD_FUEL_VALUE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CHANDLERY_FIREWOOD_PER_CYCLE,
  BAKERY_FIREWOOD_PER_CYCLE,
  LODGE_FIREWOOD_PER_CYCLE,
  LODGE_TIMBER_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { fireDisabledBuildingIds, fireDisabledResidenceIds } from '../fires/fireIncident.ts';
import { residenceFirewoodPriorityTarget } from '../logistics/firewoodLogistics.ts';
import { lodgeSustainedProcessingLabor } from '../logistics/lodgeLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { civilianToolThroughputMultiplier } from './civilianToolPolicy.ts';
import { householdFirewoodUnitsPerDay } from './householdBillDemand.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';

export const INDUSTRIAL_FIREWOOD_KINDS = [
  'bakery',
  'brewery',
  'smokehouse',
  'charcoal_burner',
  'potter_kiln',
  'chandlery',
] as const satisfies readonly BuildingKind[];

export type FirewoodRoadEntity = Pick<
  BuildingState | ResidenceState,
  'id' | 'x' | 'z'
>;

export type FirewoodRoadComponentResolver = (
  entity: FirewoodRoadEntity,
) => string | number | null;

export type SettlementFirewoodBranch = {
  key: string;
  householdStock: number;
  protectedHouseholdStock: number;
  protectedHouseholdTarget: number;
  householdsBelowProtectedStock: number;
  distributorStock: number;
  industrialStock: number;
  firewoodInTransit: number;
  winterHouseholdDemandPerDay: number;
  industrialDemandPerDay: number;
  lodgeOutputCapacityPerDay: number;
  lodgeTimberDrawPerDay: number;
  heatedHouseholds: number;
  industrialSites: number;
  distributors: number;
  firstHouseholdId: string | null;
  firstIndustryId: string | null;
  totalDemandPerDay: number;
  totalStock: number;
  runwayDays: number;
  dailyMargin: number;
};

export type SettlementFirewoodPlan = {
  branches: ReadonlyMap<string, SettlementFirewoodBranch>;
  activeBranches: number;
  flowDeficitBranches: number;
  unservedBranches: number;
  heatedHouseholds: number;
  industrialSites: number;
  distributors: number;
  householdStock: number;
  protectedHouseholdStock: number;
  protectedHouseholdTarget: number;
  householdsBelowProtectedStock: number;
  distributorStock: number;
  industrialStock: number;
  inactiveStock: number;
  quarantinedStock: number;
  firewoodInTransit: number;
  winterHouseholdDemandPerDay: number;
  industrialDemandPerDay: number;
  totalDemandPerDay: number;
  lodgeOutputCapacityPerDay: number;
  lodgeTimberDrawPerDay: number;
  dailyMargin: number;
  combinedRunwayDays: number;
  worstBranchRunwayDays: number;
  firstDeficitTargetId: string | null;
};

type MutableFirewoodBranch = Omit<
  SettlementFirewoodBranch,
  'totalDemandPerDay' | 'totalStock' | 'runwayDays' | 'dailyMargin'
>;

/**
 * A road-branch fuel budget for the physical economy. Household cupboards,
 * ready distributor yards, hot-workshop buffers, and carts remain separate so
 * the readout does not imply that fuel staged inside a kiln can heat a home.
 *
 * Production and consumption are installed full-input capacities. Current
 * woodcutter tool maintenance changes both firewood output and timber draw;
 * smithy demand is reconciled by the industrial-material ledger. A lone lodge
 * worker contributes half a processing worker because sustained demand
 * alternates that worker between splitting and cart duty.
 */
export function computeSettlementFirewoodPlan(
  state: GameState,
  sabbathObserved: boolean,
  roadComponentFor?: FirewoodRoadComponentResolver,
): SettlementFirewoodPlan {
  const fireDisabledBuildings = fireDisabledBuildingIds(state.fireIncidents.values());
  const fireDisabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  const branches = new Map<string, MutableFirewoodBranch>();
  let quarantinedStock = 0;
  // The compatibility row is not a place. Physical settlements materialize
  // any stray balance into a salvage pile, so even the "inactive" diagnostic
  // must ignore it while that repair is propagating to the client.
  let inactiveStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : finiteStock(state.stockpile.firewood);

  const ensureBranch = (
    entity: FirewoodRoadEntity,
    entityKind: 'building' | 'residence',
  ): MutableFirewoodBranch => {
    const component = roadComponentFor?.(entity) ?? null;
    const key = component === null
      ? `unroaded:${entityKind}:${entity.id}`
      : `component:${typeof component}:${String(component)}`;
    let branch = branches.get(key);
    if (!branch) {
      branch = {
        key,
        householdStock: 0,
        protectedHouseholdStock: 0,
        protectedHouseholdTarget: 0,
        householdsBelowProtectedStock: 0,
        distributorStock: 0,
        industrialStock: 0,
        firewoodInTransit: 0,
        winterHouseholdDemandPerDay: 0,
        industrialDemandPerDay: 0,
        lodgeOutputCapacityPerDay: 0,
        lodgeTimberDrawPerDay: 0,
        heatedHouseholds: 0,
        industrialSites: 0,
        distributors: 0,
        firstHouseholdId: null,
        firstIndustryId: null,
      };
      branches.set(key, branch);
    }
    return branch;
  };

  for (const residence of state.residences.values()) {
    const stock = finiteStock(getNeedStock(residence.needs, 'firewood'));
    if (fireDisabledResidences.has(residence.id)) {
      quarantinedStock += stock;
      continue;
    }
    if (residence.abandoned || residence.population <= 0 || residence.tier < 1) {
      continue;
    }
    const branch = ensureBranch(residence, 'residence');
    const protectedTarget = residenceFirewoodPriorityTarget(residence.population);
    branch.heatedHouseholds += 1;
    branch.householdStock += stock;
    branch.protectedHouseholdStock += Math.min(stock, protectedTarget);
    branch.protectedHouseholdTarget += protectedTarget;
    if (stock + 1e-6 < protectedTarget) {
      branch.householdsBelowProtectedStock += 1;
    }
    branch.winterHouseholdDemandPerDay += householdFirewoodUnitsPerDay(
      WINTER_FIREWOOD_DEMAND_MULTIPLIER,
    );
    branch.firstHouseholdId = earlierId(branch.firstHouseholdId, residence.id);
  }

  for (const building of state.buildings.values()) {
    const stock = finiteStock(building.firewood)
      + (building.kind === 'marketplace' || building.kind === 'village_storehouse'
        ? finiteStock(building.charcoal) * CHARCOAL_HOUSEHOLD_FUEL_VALUE
        : 0);
    if (fireDisabledBuildings.has(building.id)) {
      quarantinedStock += stock;
      continue;
    }
    if (building.constructionComplete === false) continue;
    if (isReadyFirewoodDistributor(building)) {
      const branch = ensureBranch(building, 'building');
      branch.distributors += 1;
      branch.distributorStock += stock;
      if (building.kind === 'woodcutters_lodge') {
        const capacity = lodgeFirewoodCapacity(building, sabbathObserved);
        branch.lodgeOutputCapacityPerDay += capacity.firewoodPerDay;
        branch.lodgeTimberDrawPerDay += capacity.timberPerDay;
      }
      continue;
    }
    if (isIndustrialFirewoodKind(building.kind) && building.assignedLabor > 0) {
      const branch = ensureBranch(building, 'building');
      branch.industrialSites += 1;
      branch.industrialStock += stock;
      branch.industrialDemandPerDay += industrialFirewoodCapacityPerDay(
        building,
        sabbathObserved,
      );
      branch.firstIndustryId = earlierId(branch.firstIndustryId, building.id);
      continue;
    }
    inactiveStock += stock;
  }

  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.phase === 'inbound'
      || (trip.cargoKind !== 'firewood' && trip.cargoKind !== 'charcoal')
      || trip.amount <= 1e-9
    ) {
      continue;
    }
    const residence = trip.destinationKind === 'residence' && trip.residenceId
      ? state.residences.get(trip.residenceId)
      : undefined;
    const building = trip.destinationKind === 'building' && trip.targetBuildingId
      ? state.buildings.get(trip.targetBuildingId)
      : undefined;
    if (
      trip.cargoKind === 'charcoal'
      && building?.kind !== 'marketplace'
      && building?.kind !== 'village_storehouse'
    ) {
      continue;
    }
    const fuelEquivalent = finiteStock(trip.amount)
      * (trip.cargoKind === 'charcoal' ? CHARCOAL_HOUSEHOLD_FUEL_VALUE : 1);
    if (
      residence
      && !fireDisabledResidences.has(residence.id)
      && !residence.abandoned
      && residence.population > 0
    ) {
      ensureBranch(residence, 'residence').firewoodInTransit += fuelEquivalent;
    } else if (
      building
      && !fireDisabledBuildings.has(building.id)
      && building.constructionComplete !== false
    ) {
      ensureBranch(building, 'building').firewoodInTransit += fuelEquivalent;
    }
  }

  const finalized = new Map<string, SettlementFirewoodBranch>();
  let flowDeficitBranches = 0;
  let unservedBranches = 0;
  let heatedHouseholds = 0;
  let industrialSites = 0;
  let distributors = 0;
  let householdStock = 0;
  let protectedHouseholdStock = 0;
  let protectedHouseholdTarget = 0;
  let householdsBelowProtectedStock = 0;
  let distributorStock = 0;
  let industrialStock = 0;
  let firewoodInTransit = 0;
  let winterHouseholdDemandPerDay = 0;
  let industrialDemandPerDay = 0;
  let lodgeOutputCapacityPerDay = 0;
  let lodgeTimberDrawPerDay = 0;
  let worstBranchRunwayDays = Number.POSITIVE_INFINITY;
  let firstDeficitTargetId: string | null = null;

  for (const branch of branches.values()) {
    const totalDemandPerDay =
      branch.winterHouseholdDemandPerDay + branch.industrialDemandPerDay;
    const totalStock = branch.householdStock
      + branch.distributorStock
      + branch.industrialStock
      + branch.firewoodInTransit;
    const runwayDays = totalDemandPerDay > 1e-9
      ? totalStock / totalDemandPerDay
      : Number.POSITIVE_INFINITY;
    const dailyMargin = branch.lodgeOutputCapacityPerDay - totalDemandPerDay;
    const hasDemand = totalDemandPerDay > 1e-9;
    if (hasDemand && dailyMargin < -1e-6) {
      flowDeficitBranches += 1;
      firstDeficitTargetId = earlierId(
        firstDeficitTargetId,
        branch.firstHouseholdId ?? branch.firstIndustryId,
      );
    }
    if (hasDemand && branch.distributors === 0) {
      unservedBranches += 1;
      firstDeficitTargetId = earlierId(
        firstDeficitTargetId,
        branch.firstHouseholdId ?? branch.firstIndustryId,
      );
    }
    if (hasDemand) worstBranchRunwayDays = Math.min(worstBranchRunwayDays, runwayDays);

    heatedHouseholds += branch.heatedHouseholds;
    industrialSites += branch.industrialSites;
    distributors += branch.distributors;
    householdStock += branch.householdStock;
    protectedHouseholdStock += branch.protectedHouseholdStock;
    protectedHouseholdTarget += branch.protectedHouseholdTarget;
    householdsBelowProtectedStock += branch.householdsBelowProtectedStock;
    distributorStock += branch.distributorStock;
    industrialStock += branch.industrialStock;
    firewoodInTransit += branch.firewoodInTransit;
    winterHouseholdDemandPerDay += branch.winterHouseholdDemandPerDay;
    industrialDemandPerDay += branch.industrialDemandPerDay;
    lodgeOutputCapacityPerDay += branch.lodgeOutputCapacityPerDay;
    lodgeTimberDrawPerDay += branch.lodgeTimberDrawPerDay;
    finalized.set(branch.key, {
      ...branch,
      totalDemandPerDay,
      totalStock,
      runwayDays,
      dailyMargin,
    });
  }

  const totalDemandPerDay = winterHouseholdDemandPerDay + industrialDemandPerDay;
  const totalStock = householdStock
    + distributorStock
    + industrialStock
    + firewoodInTransit;
  return {
    branches: finalized,
    activeBranches: [...finalized.values()]
      .filter((branch) => branch.totalDemandPerDay > 1e-9).length,
    flowDeficitBranches,
    unservedBranches,
    heatedHouseholds,
    industrialSites,
    distributors,
    householdStock,
    protectedHouseholdStock,
    protectedHouseholdTarget,
    householdsBelowProtectedStock,
    distributorStock,
    industrialStock,
    inactiveStock,
    quarantinedStock,
    firewoodInTransit,
    winterHouseholdDemandPerDay,
    industrialDemandPerDay,
    totalDemandPerDay,
    lodgeOutputCapacityPerDay,
    lodgeTimberDrawPerDay,
    dailyMargin: lodgeOutputCapacityPerDay - totalDemandPerDay,
    combinedRunwayDays: totalDemandPerDay > 1e-9
      ? totalStock / totalDemandPerDay
      : Number.POSITIVE_INFINITY,
    worstBranchRunwayDays,
    firstDeficitTargetId,
  };
}

export function industrialFirewoodCapacityPerDay(
  building: Pick<
    BuildingState,
    'kind' | 'assignedLabor'
  >,
  sabbathObserved: boolean,
): number {
  if (!isIndustrialFirewoodKind(building.kind) || building.assignedLabor <= 0) return 0;
  const cycles = workshopCyclesPerDay(
    building.kind,
    building.assignedLabor,
    sabbathObserved,
  );
  switch (building.kind) {
    case 'bakery':
      return cycles * BAKERY_FIREWOOD_PER_CYCLE;
    case 'brewery':
      return cycles / 2 * (
        BREWERY_MALTING_FIREWOOD_PER_CYCLE
        + BREWERY_BREWING_FIREWOOD_PER_CYCLE
      );
    case 'smokehouse':
      return cycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE;
    case 'charcoal_burner':
      return cycles * CHARCOAL_BURNER_FIREWOOD_PER_CYCLE;
    case 'potter_kiln':
      return cycles * POTTER_FIREWOOD_PER_CYCLE;
    case 'chandlery':
      return cycles * CHANDLERY_FIREWOOD_PER_CYCLE;
  }
}

function isIndustrialFirewoodKind(
  kind: BuildingKind,
): kind is (typeof INDUSTRIAL_FIREWOOD_KINDS)[number] {
  return (INDUSTRIAL_FIREWOOD_KINDS as readonly BuildingKind[]).includes(kind);
}

function isReadyFirewoodDistributor(building: BuildingState): boolean {
  return building.assignedLabor > 0
    && (
      building.kind === 'woodcutters_lodge'
      || (
        building.kind === 'village_storehouse'
        && building.storehouseAcceptsFirewood
      )
    );
}

function lodgeFirewoodCapacity(
  building: Pick<BuildingState, 'assignedLabor' | 'ironwork'>,
  sabbathObserved: boolean,
): { firewoodPerDay: number; timberPerDay: number } {
  const processingLabor = lodgeSustainedProcessingLabor(building.assignedLabor);
  const cycles = workshopCyclesPerDay(
    'woodcutters_lodge',
    processingLabor,
    sabbathObserved,
  ) * civilianToolThroughputMultiplier(building.ironwork ?? 0);
  return {
    firewoodPerDay: cycles * LODGE_FIREWOOD_PER_CYCLE,
    timberPerDay: cycles * LODGE_TIMBER_PER_CYCLE,
  };
}

function workshopCyclesPerDay(
  kind: BuildingKind,
  labor: number,
  sabbathObserved: boolean,
): number {
  const interval = getBuildingDefinition(kind).harvestInterval;
  if (interval <= 1e-9 || labor <= 0) return 0;
  return CALENDAR_SECONDS_PER_DAY / interval
    * labor
    * (sabbathObserved ? 6 / 7 : 1);
}

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function earlierId(current: string | null, candidate: string | null): string | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  const currentNumeric = Number(current);
  const candidateNumeric = Number(candidate);
  if (Number.isFinite(currentNumeric) && Number.isFinite(candidateNumeric)) {
    return candidateNumeric < currentNumeric ? candidate : current;
  }
  return candidate < current ? candidate : current;
}
