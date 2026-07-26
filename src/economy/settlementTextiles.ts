import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { GameState } from '../resources/types.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import {
  canStoreFullSheepClip,
  projectedSheepFleece,
} from './livestockPolicy.ts';
import type { SettlementProductionCapacity } from './settlementProduction.ts';

export const TEXTILE_PLAN_DAYS_PER_YEAR =
  CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;

export type TextileAttentionKind =
  | 'storage'
  | 'staffing'
  | 'flock'
  | 'missed-window';

export type SettlementTextilePlan = {
  sheepHoldings: number;
  staffedSheepHoldings: number;
  sheepHeadCount: number;
  productiveSheepHeads: number;
  shornHoldings: number;
  pendingHoldings: number;
  readyPendingHoldings: number;
  storageBlockedHoldings: number;
  staffingBlockedHoldings: number;
  flockBlockedHoldings: number;
  missedHoldings: number;
  projectedAnnualWool: number;
  securedAnnualWool: number;
  annualWoolAtRisk: number;
  woolStock: number;
  woolInTransit: number;
  clothStock: number;
  clothInTransit: number;
  annualWeaverWoolCapacity: number;
  annualWeaverClothCapacity: number;
  annualClothPotential: number;
  annualHouseholdClothDemand: number;
  annualClothBalance: number;
  woolCapacitySurplus: number;
  clothReserveRunwayDays: number;
  firstAttentionBuildingId: string | null;
  firstAttentionKind: TextileAttentionKind | null;
};

type TextileProduction = Pick<
  SettlementProductionCapacity,
  'clothWoolPerDay' | 'clothOutputPerDay' | 'clothDemandPerDay'
>;

const ATTENTION_PRIORITY: Record<TextileAttentionKind, number> = {
  storage: 4,
  staffing: 3,
  flock: 2,
  'missed-window': 1,
};

function positive(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function shouldReplaceAttention(
  kind: TextileAttentionKind,
  buildingId: string,
  currentKind: TextileAttentionKind | null,
  currentBuildingId: string | null,
): boolean {
  if (currentKind === null || currentBuildingId === null) return true;
  if (ATTENTION_PRIORITY[kind] !== ATTENTION_PRIORITY[currentKind]) {
    return ATTENTION_PRIORITY[kind] > ATTENTION_PRIORITY[currentKind];
  }
  return compareStableEntityIds(buildingId, currentBuildingId) < 0;
}

/**
 * Annualized sheep-to-cloth plan using current flock condition, staffing, and
 * installed weaving labor. Current physical stores are reported separately so
 * already-woven cloth is never counted again as prospective annual output.
 */
export function computeSettlementTextilePlan(input: {
  state: Pick<
    GameState,
    'stockpile' | 'buildings' | 'livestockHerds' | 'residences' | 'deliveryTrips'
  >;
  clock: Pick<GameClock, 'month' | 'year'>;
  production: TextileProduction;
}): SettlementTextilePlan {
  let sheepHoldings = 0;
  let staffedSheepHoldings = 0;
  let sheepHeadCount = 0;
  let productiveSheepHeads = 0;
  let shornHoldings = 0;
  let pendingHoldings = 0;
  let readyPendingHoldings = 0;
  let storageBlockedHoldings = 0;
  let staffingBlockedHoldings = 0;
  let flockBlockedHoldings = 0;
  let missedHoldings = 0;
  let projectedAnnualWool = 0;
  let securedAnnualWool = 0;
  let firstAttentionBuildingId: string | null = null;
  let firstAttentionKind: TextileAttentionKind | null = null;

  const recordAttention = (kind: TextileAttentionKind, buildingId: string): void => {
    if (
      shouldReplaceAttention(
        kind,
        buildingId,
        firstAttentionKind,
        firstAttentionBuildingId,
      )
    ) {
      firstAttentionKind = kind;
      firstAttentionBuildingId = buildingId;
    }
  };

  for (const herd of input.state.livestockHerds.values()) {
    if (herd.species !== 'sheep') continue;
    const building = input.state.buildings.get(herd.buildingId);
    if (
      !building
      || building.kind !== 'pastoral_farmstead'
      || building.constructionComplete === false
    ) {
      continue;
    }

    sheepHoldings += 1;
    if (building.assignedLabor > 0) staffedSheepHoldings += 1;
    sheepHeadCount += Math.max(0, herd.headCount);
    const projectedFleece = projectedSheepFleece(herd);
    productiveSheepHeads += projectedFleece
      / Math.max(1e-9, SHEEP_WOOL_PER_SHEARING_PER_HEAD);
    const shornThisYear = (herd.lastShearingYear ?? 0) === input.clock.year;

    if (shornThisYear) {
      const storedClip = positive(herd.lastWoolOutput);
      shornHoldings += 1;
      projectedAnnualWool += storedClip;
      securedAnnualWool += storedClip;
      continue;
    }

    projectedAnnualWool += projectedFleece;
    if (input.clock.month > SHEEP_SHEARING_END_MONTH) {
      missedHoldings += 1;
      recordAttention('missed-window', building.id);
      continue;
    }

    pendingHoldings += 1;
    const woolCapacity = BUILDING_STORAGE_CAPS.pastoral_farmstead.wool ?? 0;
    const woolRoom = Math.max(0, woolCapacity - positive(building.wool));
    if (building.assignedLabor <= 0) {
      staffingBlockedHoldings += 1;
      recordAttention('staffing', building.id);
    } else if (projectedFleece <= 1e-6) {
      flockBlockedHoldings += 1;
      recordAttention('flock', building.id);
    } else if (!canStoreFullSheepClip(projectedFleece, woolRoom)) {
      storageBlockedHoldings += 1;
      recordAttention('storage', building.id);
    } else {
      readyPendingHoldings += 1;
      securedAnnualWool += projectedFleece;
    }
  }

  let woolStock = positive(input.state.stockpile.wool);
  let clothStock = positive(input.state.stockpile.cloth);
  for (const building of input.state.buildings.values()) {
    woolStock += positive(building.wool);
    clothStock += positive(building.cloth);
  }
  for (const residence of input.state.residences.values()) {
    clothStock += positive(getNeedStock(residence.needs, 'cloth'));
  }

  let woolInTransit = 0;
  let clothInTransit = 0;
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.phase === 'inbound') continue;
    if (trip.cargoKind === 'wool') woolInTransit += positive(trip.amount);
    if (trip.cargoKind === 'cloth') clothInTransit += positive(trip.amount);
  }
  woolStock += woolInTransit;
  clothStock += clothInTransit;

  const annualWeaverWoolCapacity =
    positive(input.production.clothWoolPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;
  const annualWeaverClothCapacity =
    positive(input.production.clothOutputPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;
  const clothFromProjectedClip = projectedAnnualWool
    * WEAVER_CLOTH_PER_CYCLE
    / WEAVER_WOOL_PER_CYCLE;
  const annualClothPotential = Math.min(
    annualWeaverClothCapacity,
    clothFromProjectedClip,
  );
  const annualHouseholdClothDemand =
    positive(input.production.clothDemandPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;

  return {
    sheepHoldings,
    staffedSheepHoldings,
    sheepHeadCount,
    productiveSheepHeads,
    shornHoldings,
    pendingHoldings,
    readyPendingHoldings,
    storageBlockedHoldings,
    staffingBlockedHoldings,
    flockBlockedHoldings,
    missedHoldings,
    projectedAnnualWool,
    securedAnnualWool,
    annualWoolAtRisk: Math.max(0, projectedAnnualWool - securedAnnualWool),
    woolStock,
    woolInTransit,
    clothStock,
    clothInTransit,
    annualWeaverWoolCapacity,
    annualWeaverClothCapacity,
    annualClothPotential,
    annualHouseholdClothDemand,
    annualClothBalance: annualClothPotential - annualHouseholdClothDemand,
    woolCapacitySurplus: Math.max(
      0,
      projectedAnnualWool - annualWeaverWoolCapacity,
    ),
    clothReserveRunwayDays: input.production.clothDemandPerDay > 1e-9
      ? clothStock / input.production.clothDemandPerDay
      : Number.POSITIVE_INFINITY,
    firstAttentionBuildingId,
    firstAttentionKind,
  };
}

export function textileChainBalanceLabel(plan: SettlementTextilePlan): string {
  if (plan.annualHouseholdClothDemand <= 1e-9) {
    return plan.sheepHoldings === 0
      ? 'No prosperous-house demand or sheep industry'
      : 'No prosperous-house demand · annual cloth can be exported';
  }
  if (plan.sheepHoldings === 0 || plan.projectedAnnualWool <= 1e-9) {
    return 'Fleece missing · establish a healthy sheep holding';
  }
  if (plan.annualWeaverClothCapacity <= 1e-9) {
    return 'Weaving missing · annual fleece cannot become cloth';
  }
  if (plan.woolCapacitySurplus > 0.05) {
    return 'Weaving-limited · add loom labor before more sheep';
  }
  if (plan.annualClothBalance < -0.05) {
    return 'Fleece-limited · household demand exceeds the annual clip';
  }
  return 'Household textiles covered · remaining cloth can be exported';
}
