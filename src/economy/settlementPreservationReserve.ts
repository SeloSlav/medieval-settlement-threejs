import {
  CALENDAR_SECONDS_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { averageProductiveCalendarDayShare } from '../world/holidayCalendar.ts';
import { fireDisabledBuildingIds, fireDisabledResidenceIds } from '../fires/fireIncident.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';
import {
  miningPitOutputPerDay,
  miningPitSurfaceDeposit,
  mineralDepositBeneath,
  mineralMineOutputPerDay,
} from './settlementGeology.ts';
import { MARKETPLACE_SALT_IMPORT_LOT } from './marketplaceMaterialProcurementPolicy.ts';
import {
  buildingPreservedFoodStorageFactor,
  spoilageAdjustedRunwayDays,
} from './foodPreservation.ts';
import { householdFoodPerDay, isPreservedFoodCargo, preservedFoodStock } from './foodInventory.ts';

/**
 * A month of substitute provisions is demanding enough to make autumn
 * stockpiling matter without pretending every prosperous household can store
 * an entire winter indoors.
 */
export const PRESERVATION_RESERVE_DAYS = 30;

export type PreservationReserveBranch = {
  key: string;
  residents: number;
  fallbackDemandPerDay: number;
  targetStock: number;
  preservedStock: number;
  weightedPreservedStock: number;
  preservedInTransit: number;
  projectedStock: number;
  shortfall: number;
  coverageDays: number;
  smokehouseOutputPerDay: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltStock: number;
  saltInTransit: number;
  localSaltOutputPerDay: number;
  localSaltProduction: number;
  potteryStock: number;
  potteryInTransit: number;
  saltImportLots: number;
  saltImportShortfall: number;
  potteryShortfall: number;
  staffedSmokehouses: number;
  staffedSaltMines: number;
  staffedMarkets: number;
  standingSaltMarkets: number;
  selectedSaltTarget: number;
  firstResidenceId: string | null;
  firstSmokehouseId: string | null;
  firstSaltMineId: string | null;
  firstMarketId: string | null;
};

export type SettlementPreservationReservePlan = {
  targetDays: number;
  tierFourResidents: number;
  targetBranches: number;
  preparedBranches: number;
  shortBranches: number;
  branchesWithoutSmokehouse: number;
  branchesWithoutStandingSalt: number;
  targetStock: number;
  roadMatchedStock: number;
  roadMatchedShortfall: number;
  preservedStock: number;
  preservedInTransit: number;
  quarantinedPreservedStock: number;
  unmatchedPreservedStock: number;
  fallbackDemandPerDay: number;
  smokehouseOutputPerDay: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltStock: number;
  saltInTransit: number;
  localSaltOutputPerDay: number;
  localSaltProduction: number;
  potteryStock: number;
  potteryInTransit: number;
  saltImportLots: number;
  saltImportShortfall: number;
  potteryShortfall: number;
  staffedSmokehouses: number;
  staffedSaltMines: number;
  staffedMarkets: number;
  standingSaltMarkets: number;
  selectedSaltTarget: number;
  firstExposedResidenceId: string | null;
  firstAttentionBuildingId: string | null;
  firstSaltMineId: string | null;
  firstSaltMarketId: string | null;
  branches: ReadonlyMap<string, PreservationReserveBranch>;
};

export type SettlementPreservationReserveOptions = {
  sabbathObserved: boolean;
  roadComponentFor?: ProductionRoadComponentResolver;
  targetDays?: number;
  preservedFoodSpoilageFractionPerDay?: number;
};

type MutableBranch = Omit<
  PreservationReserveBranch,
  | 'targetStock'
  | 'projectedStock'
  | 'shortfall'
  | 'coverageDays'
  | 'productionDaysToTarget'
  | 'freshFoodRequired'
  | 'firewoodRequired'
  | 'saltRequired'
  | 'potteryRequired'
  | 'saltImportLots'
  | 'saltImportShortfall'
  | 'localSaltProduction'
  | 'potteryShortfall'
> & {
  targetStock: number;
  projectedStock: number;
  shortfall: number;
  coverageDays: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltImportLots: number;
  saltImportShortfall: number;
  localSaltProduction: number;
  potteryShortfall: number;
  saltMineSourcesByDeposit: Map<string, SaltMineSourceForecast>;
};

type SaltMineSourceForecast = {
  ratePerDay: number;
  remaining: number;
  isRich: boolean;
};

export function computeSettlementPreservationReservePlan(
  state: GameState,
  options: SettlementPreservationReserveOptions,
): SettlementPreservationReservePlan {
  const targetDays = finitePositive(options.targetDays, PRESERVATION_RESERVE_DAYS);
  const preservedFoodSpoilageFractionPerDay = Number.isFinite(
    options.preservedFoodSpoilageFractionPerDay,
  )
    ? Math.max(0, options.preservedFoodSpoilageFractionPerDay ?? 0)
    : PRESERVED_FOOD_SPOILAGE_PER_DAY;
  const fireDisabledBuildings = fireDisabledBuildingIds(state.fireIncidents.values());
  const fireDisabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  const branches = new Map<string, MutableBranch>();
  let quarantinedPreservedStock = 0;

  const branchFor = (
    entity: Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>,
    entityKind: 'building' | 'residence',
  ): MutableBranch => {
    const key = productionRoadBranchKey(
      options.roadComponentFor?.(entity) ?? null,
      entityKind,
      entity.id,
    );
    let branch = branches.get(key);
    if (!branch) {
      branch = emptyBranch(key);
      branches.set(key, branch);
    }
    return branch;
  };

  for (const building of state.buildings.values()) {
    const preserved = preservedFoodStock(building);
    if (fireDisabledBuildings.has(building.id)) {
      quarantinedPreservedStock += preserved;
      continue;
    }
    if (building.constructionComplete === false) {
      continue;
    }
    const branch = branchFor(building, 'building');
    branch.preservedStock += preserved;
    branch.weightedPreservedStock +=
      preserved * buildingPreservedFoodStorageFactor(building.kind);
    branch.saltStock += finiteStock(building.salt);
    branch.potteryStock += finiteStock(building.pottery);

    if (building.assignedLabor <= 0) continue;
    if (building.kind === 'smokehouse') {
      const cycles = cyclesPerCalendarDay(
        building,
        options.sabbathObserved,
      );
      branch.smokehouseOutputPerDay += cycles
        * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE;
      branch.staffedSmokehouses += 1;
      branch.firstSmokehouseId = earlierStableId(
        branch.firstSmokehouseId,
        building.id,
      );
    } else if (building.kind === 'marketplace') {
      const selectedTarget = finiteStock(building.marketplaceSaltTarget);
      branch.staffedMarkets += 1;
      branch.selectedSaltTarget += selectedTarget;
      if (selectedTarget > 1e-9) branch.standingSaltMarkets += 1;
      branch.firstMarketId = earlierStableId(branch.firstMarketId, building.id);
    } else if (building.kind === 'mine' || building.kind === 'stone_quarry') {
      const deposit = building.kind === 'mine'
        ? mineralDepositBeneath(building, state.quarries.values())
        : miningPitSurfaceDeposit(building, state.quarries.values());
      if (deposit?.resource !== 'salt') continue;
      const ratePerDay = building.kind === 'mine'
        ? mineralMineOutputPerDay(
          building,
          deposit,
          options.sabbathObserved,
        )
        : miningPitOutputPerDay(
          building,
          deposit,
          options.sabbathObserved,
        );
      if (ratePerDay <= 1e-9) continue;
      branch.localSaltOutputPerDay += ratePerDay;
      branch.staffedSaltMines += 1;
      branch.firstSaltMineId = earlierStableId(
        branch.firstSaltMineId,
        building.id,
      );
      const sourceKey = `${building.kind === 'mine' ? 'deep' : 'surface'}:${deposit.nodeId}`;
      const source = branch.saltMineSourcesByDeposit.get(sourceKey);
      branch.saltMineSourcesByDeposit.set(sourceKey, {
        ratePerDay: (source?.ratePerDay ?? 0) + ratePerDay,
        remaining: finiteStock(deposit.remaining),
        isRich: building.kind === 'mine',
      });
    }
  }

  for (const residence of state.residences.values()) {
    const preserved = Math.max(
      preservedFoodStock(residence),
      residence.foodInventoryMigrated === true
        ? 0
        : finiteStock(getNeedStock(residence.needs, 'preservedFood')),
    );
    if (fireDisabledResidences.has(residence.id)) {
      quarantinedPreservedStock += preserved;
      continue;
    }
    const branch = branchFor(residence, 'residence');
    branch.preservedStock += preserved;
    branch.weightedPreservedStock +=
      preserved * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR;
    if (
      residence.abandoned
      || residence.tier < 4
      || residence.population <= 0
    ) {
      continue;
    }
    const residents = Math.max(0, residence.population);
    branch.residents += residents;
    branch.fallbackDemandPerDay += householdFoodPerDay(residents);
    branch.firstResidenceId = earlierStableId(
      branch.firstResidenceId,
      residence.id,
    );
  }

  for (const trip of state.deliveryTrips.values()) {
    if (
      !isPreservedFoodCargo(trip.cargoKind)
      && trip.cargoKind !== 'salt'
      && trip.cargoKind !== 'pottery'
    ) {
      continue;
    }
    const amount = finiteStock(trip.amount);
    if (amount <= 1e-9) continue;
    const branch = deliveryBranch(
      trip,
      state,
      branchFor,
    );
    if (!branch) continue;
    if (isPreservedFoodCargo(trip.cargoKind)) {
      branch.preservedInTransit += amount;
    } else if (trip.cargoKind === 'salt') {
      branch.saltInTransit += amount;
    } else {
      branch.potteryInTransit += amount;
    }
  }

  if (
    state.physicalFoundingSiteEnabled !== true
    && preservedFoodStock(state.stockpile) > 1e-9
  ) {
    const key = 'legacy:treasury';
    const branch = branches.get(key) ?? emptyBranch(key);
    const stock = preservedFoodStock(state.stockpile);
    branch.preservedStock += stock;
    branch.weightedPreservedStock +=
      stock * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR;
    branches.set(key, branch);
  }

  let tierFourResidents = 0;
  let targetBranches = 0;
  let preparedBranches = 0;
  let shortBranches = 0;
  let branchesWithoutSmokehouse = 0;
  let branchesWithoutStandingSalt = 0;
  let targetStock = 0;
  let roadMatchedStock = 0;
  let preservedStock = 0;
  let preservedInTransit = 0;
  let fallbackDemandPerDay = 0;
  let smokehouseOutputPerDay = 0;
  let productionDaysToTarget = 0;
  let freshFoodRequired = 0;
  let firewoodRequired = 0;
  let saltRequired = 0;
  let potteryRequired = 0;
  let saltStock = 0;
  let saltInTransit = 0;
  let localSaltOutputPerDay = 0;
  let localSaltProduction = 0;
  let potteryStock = 0;
  let potteryInTransit = 0;
  let saltImportLots = 0;
  let saltImportShortfall = 0;
  let potteryShortfall = 0;
  let staffedSmokehouses = 0;
  let staffedSaltMines = 0;
  let staffedMarkets = 0;
  let standingSaltMarkets = 0;
  let selectedSaltTarget = 0;
  let firstExposedResidenceId: string | null = null;
  let firstAttentionBuildingId: string | null = null;
  let firstSaltMineId: string | null = null;
  let firstSaltMarketId: string | null = null;
  let weakestCoverage = Number.POSITIVE_INFINITY;

  const finalizedBranches = new Map<string, PreservationReserveBranch>();
  for (const [key, branch] of branches) {
    branch.projectedStock = branch.preservedStock + branch.preservedInTransit;
    const projectedWeightedStock =
      branch.weightedPreservedStock
      + branch.preservedInTransit * PRESERVED_FOOD_STORAGE_CART_FACTOR;
    const storageFactor = branch.projectedStock > 1e-9
      ? projectedWeightedStock / branch.projectedStock
      : PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR;
    const spoilageFractionPerDay =
      preservedFoodSpoilageFractionPerDay * storageFactor;
    branch.targetStock = stockRequiredForRunwayDays(
      branch.fallbackDemandPerDay,
      spoilageFractionPerDay,
      targetDays,
    );
    branch.shortfall = Math.max(0, branch.targetStock - branch.projectedStock);
    branch.coverageDays = spoilageAdjustedRunwayDays(
      branch.projectedStock,
      branch.fallbackDemandPerDay,
      spoilageFractionPerDay,
    );
    branch.productionDaysToTarget = branch.shortfall <= 1e-9
      ? 0
      : branch.smokehouseOutputPerDay > 1e-9
        ? productionDaysToStockTarget(
            branch.projectedStock,
            branch.targetStock,
            branch.smokehouseOutputPerDay,
            spoilageFractionPerDay,
          )
        : Number.POSITIVE_INFINITY;

    const productionRequired = branch.smokehouseOutputPerDay > 1e-9
      && Number.isFinite(branch.productionDaysToTarget)
      ? branch.smokehouseOutputPerDay * branch.productionDaysToTarget
      : branch.shortfall;
    const cyclesRequired = productionRequired
      / SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE;
    branch.freshFoodRequired = cyclesRequired * SMOKEHOUSE_FOOD_PER_CYCLE;
    branch.firewoodRequired = cyclesRequired * SMOKEHOUSE_FIREWOOD_PER_CYCLE;
    branch.saltRequired = cyclesRequired * SMOKEHOUSE_SALT_PER_CYCLE;
    branch.potteryRequired = cyclesRequired * SMOKEHOUSE_POTTERY_PER_CYCLE;
    const availableSalt = branch.saltStock + branch.saltInTransit;
    const availablePottery = branch.potteryStock + branch.potteryInTransit;
    const saltNeedAfterStock = Math.max(
      0,
      branch.saltRequired - availableSalt,
    );
    branch.localSaltProduction = Math.min(
      saltNeedAfterStock,
      projectedLocalSaltProduction(
        branch.saltMineSourcesByDeposit.values(),
        branch.productionDaysToTarget,
      ),
    );
    branch.saltImportShortfall = Math.max(
      0,
      saltNeedAfterStock - branch.localSaltProduction,
    );
    branch.potteryShortfall = Math.max(0, branch.potteryRequired - availablePottery);
    branch.saltImportLots = branch.saltImportShortfall > 1e-9
      ? Math.ceil(branch.saltImportShortfall / MARKETPLACE_SALT_IMPORT_LOT)
      : 0;

    tierFourResidents += branch.residents;
    targetStock += branch.targetStock;
    roadMatchedStock += Math.min(branch.targetStock, branch.projectedStock);
    preservedStock += branch.preservedStock;
    preservedInTransit += branch.preservedInTransit;
    fallbackDemandPerDay += branch.fallbackDemandPerDay;
    smokehouseOutputPerDay += branch.smokehouseOutputPerDay;
    freshFoodRequired += branch.freshFoodRequired;
    firewoodRequired += branch.firewoodRequired;
    saltRequired += branch.saltRequired;
    potteryRequired += branch.potteryRequired;
    saltImportLots += branch.saltImportLots;
    saltImportShortfall += branch.saltImportShortfall;
    potteryShortfall += branch.potteryShortfall;
    staffedSmokehouses += branch.staffedSmokehouses;

    if (branch.targetStock > 1e-9) {
      targetBranches += 1;
      saltStock += branch.saltStock;
      saltInTransit += branch.saltInTransit;
      localSaltOutputPerDay += branch.localSaltOutputPerDay;
      localSaltProduction += branch.localSaltProduction;
      potteryStock += branch.potteryStock;
      potteryInTransit += branch.potteryInTransit;
      staffedSaltMines += branch.staffedSaltMines;
      staffedMarkets += branch.staffedMarkets;
      standingSaltMarkets += branch.standingSaltMarkets;
      selectedSaltTarget += branch.selectedSaltTarget;
      if (branch.shortfall <= 1e-9) {
        preparedBranches += 1;
      } else {
        shortBranches += 1;
        if (branch.smokehouseOutputPerDay <= 1e-9) {
          branchesWithoutSmokehouse += 1;
        }
        if (
          branch.saltImportShortfall > 1e-9
          && branch.standingSaltMarkets === 0
        ) {
          branchesWithoutStandingSalt += 1;
        }
        if (
          branch.coverageDays < weakestCoverage - 1e-9
          || (
            Math.abs(branch.coverageDays - weakestCoverage) <= 1e-9
            && branch.firstResidenceId !== null
            && (
              firstExposedResidenceId === null
              || compareStableEntityIds(
                branch.firstResidenceId,
                firstExposedResidenceId,
              ) < 0
            )
          )
        ) {
          weakestCoverage = branch.coverageDays;
          firstExposedResidenceId = branch.firstResidenceId;
          firstAttentionBuildingId = branch.firstSmokehouseId
            ?? branch.firstSaltMineId
            ?? branch.firstMarketId;
          firstSaltMineId = branch.firstSaltMineId;
          firstSaltMarketId = branch.firstMarketId;
        }
      }
      productionDaysToTarget = Math.max(
        productionDaysToTarget,
        branch.productionDaysToTarget,
      );
    }

    const {
      saltMineSourcesByDeposit: _saltMineSourcesByDeposit,
      ...finalizedBranch
    } = branch;
    finalizedBranches.set(key, finalizedBranch);
  }

  const roadMatchedShortfall = Math.max(0, targetStock - roadMatchedStock);
  return {
    targetDays,
    tierFourResidents,
    targetBranches,
    preparedBranches,
    shortBranches,
    branchesWithoutSmokehouse,
    branchesWithoutStandingSalt,
    targetStock,
    roadMatchedStock,
    roadMatchedShortfall,
    preservedStock,
    preservedInTransit,
    quarantinedPreservedStock,
    unmatchedPreservedStock: Math.max(
      0,
      preservedStock + preservedInTransit - roadMatchedStock,
    ),
    fallbackDemandPerDay,
    smokehouseOutputPerDay,
    productionDaysToTarget,
    freshFoodRequired,
    firewoodRequired,
    saltRequired,
    potteryRequired,
    saltStock,
    saltInTransit,
    localSaltOutputPerDay,
    localSaltProduction,
    potteryStock,
    potteryInTransit,
    saltImportLots,
    saltImportShortfall,
    potteryShortfall,
    staffedSmokehouses,
    staffedSaltMines,
    staffedMarkets,
    standingSaltMarkets,
    selectedSaltTarget,
    firstExposedResidenceId,
    firstAttentionBuildingId,
    firstSaltMineId,
    firstSaltMarketId,
    branches: finalizedBranches,
  };
}

function emptyBranch(key: string): MutableBranch {
  return {
    key,
    residents: 0,
    fallbackDemandPerDay: 0,
    targetStock: 0,
    preservedStock: 0,
    weightedPreservedStock: 0,
    preservedInTransit: 0,
    projectedStock: 0,
    shortfall: 0,
    coverageDays: Number.POSITIVE_INFINITY,
    smokehouseOutputPerDay: 0,
    productionDaysToTarget: 0,
    freshFoodRequired: 0,
    firewoodRequired: 0,
    saltRequired: 0,
    potteryRequired: 0,
    saltStock: 0,
    saltInTransit: 0,
    localSaltOutputPerDay: 0,
    localSaltProduction: 0,
    potteryStock: 0,
    potteryInTransit: 0,
    saltImportLots: 0,
    saltImportShortfall: 0,
    potteryShortfall: 0,
    staffedSmokehouses: 0,
    staffedSaltMines: 0,
    staffedMarkets: 0,
    standingSaltMarkets: 0,
    selectedSaltTarget: 0,
    firstResidenceId: null,
    firstSmokehouseId: null,
    firstSaltMineId: null,
    firstMarketId: null,
    saltMineSourcesByDeposit: new Map(),
  };
}

function projectedLocalSaltProduction(
  sources: Iterable<SaltMineSourceForecast>,
  productionDays: number,
): number {
  if (!Number.isFinite(productionDays) || productionDays <= 1e-9) return 0;
  let production = 0;
  for (const source of sources) {
    const potential = Math.max(0, source.ratePerDay) * productionDays;
    production += source.isRich
      ? potential
      : Math.min(Math.max(0, source.remaining), potential);
  }
  return production;
}

function cyclesPerCalendarDay(
  building: Pick<BuildingState, 'assignedLabor' | 'kind'>,
  sabbathObserved: boolean,
): number {
  if (building.kind !== 'smokehouse' || building.assignedLabor <= 0) return 0;
  const interval = getBuildingDefinition('smokehouse').harvestInterval;
  if (interval <= 1e-9) return 0;
  return CALENDAR_SECONDS_PER_DAY
    * averageProductiveCalendarDayShare(sabbathObserved)
    * Math.max(0, building.assignedLabor)
    / interval;
}

function deliveryBranch(
  trip: DeliveryTripState,
  state: GameState,
  branchFor: (
    entity: Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>,
    entityKind: 'building' | 'residence',
  ) => MutableBranch,
): MutableBranch | null {
  if (trip.phase === 'inbound') {
    const origin = state.buildings.get(trip.buildingId);
    return origin ? branchFor(origin, 'building') : null;
  }
  if (trip.targetBuildingId) {
    const target = state.buildings.get(trip.targetBuildingId);
    if (target) return branchFor(target, 'building');
  }
  if (trip.residenceId) {
    const target = state.residences.get(trip.residenceId);
    if (target) return branchFor(target, 'residence');
  }
  const origin = state.buildings.get(trip.buildingId);
  return origin ? branchFor(origin, 'building') : null;
}

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function stockRequiredForRunwayDays(
  demandPerDay: number,
  spoilageFractionPerDay: number,
  days: number,
): number {
  const demand = finiteStock(demandPerDay);
  const duration = finiteStock(days);
  const spoilage = finiteStock(spoilageFractionPerDay);
  if (demand <= 1e-9 || duration <= 1e-9) return 0;
  if (spoilage <= 1e-9) return demand * duration;
  return demand * Math.expm1(spoilage * duration) / spoilage;
}

function productionDaysToStockTarget(
  initialStock: number,
  targetStock: number,
  productionPerDay: number,
  spoilageFractionPerDay: number,
): number {
  const initial = finiteStock(initialStock);
  const target = finiteStock(targetStock);
  const production = finiteStock(productionPerDay);
  const spoilage = finiteStock(spoilageFractionPerDay);
  if (target <= initial + 1e-9) return 0;
  if (production <= 1e-9) return Number.POSITIVE_INFINITY;
  if (spoilage <= 1e-9) return (target - initial) / production;
  const equilibrium = production / spoilage;
  if (target >= equilibrium - 1e-9 || initial >= equilibrium - 1e-9) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.log(
    (equilibrium - initial) / (equilibrium - target),
  ) / spoilage;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function earlierStableId(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return compareStableEntityIds(candidate, current) < 0 ? candidate : current;
}
