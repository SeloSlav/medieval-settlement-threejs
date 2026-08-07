export type ResidenceNeedKind =
  | 'firewood'
  | 'water'
  | 'food'
  | 'ale'
  | 'preservedFood'
  | 'cloth'
  | 'pottery';

export const RESIDENCE_NEED_KINDS: readonly ResidenceNeedKind[] = [
  'firewood',
  'water',
  'food',
  'preservedFood',
  'ale',
  'cloth',
  'pottery',
];

export function activeResidenceNeedKinds(tier: 0 | 1 | 2 | 3): ResidenceNeedKind[] {
  if (tier === 0) return [];
  return RESIDENCE_NEED_KINDS.filter((kind) => {
    if (kind === 'food' || kind === 'firewood') return true;
    if (kind === 'water') return tier >= 2;
    return tier >= 3;
  });
}

export const RESIDENCE_NEED_KIND_IDS: Record<ResidenceNeedKind, number> = {
  firewood: 0,
  water: 1,
  food: 2,
  ale: 6,
  preservedFood: 7,
  cloth: 14,
  // Must mirror CommodityKind::Pottery because delivery_trip.cargo_kind is
  // shared by household and building-bound carts.
  pottery: 23,
};

export type ResidenceNeedRecord = {
  stock: number;
  deficitTicks: number;
};

export type ResidenceNeedsState = Record<ResidenceNeedKind, ResidenceNeedRecord>;

export type ResidenceNeedSupplyContext = {
  servingLodgeId: string | null;
  servingWellId: string | null;
  servingFoodSupplierId: string | null;
  servingPreservedFoodSupplierId?: string | null;
  servingAleSupplierId?: string | null;
  servingClothSupplierId?: string | null;
  servingPotterySupplierId?: string | null;
};

export type ResidenceCommunityContext = {
  hasChapelAccess: boolean;
  hasMonasteryCoverage: boolean;
  sabbathObservance: boolean;
};

export const DEFAULT_RESIDENCE_COMMUNITY_CONTEXT: ResidenceCommunityContext = {
  hasChapelAccess: false,
  hasMonasteryCoverage: false,
  sabbathObservance: false,
};

export type ResidenceNeedRecoveryStatus = {
  kind: ResidenceNeedKind;
  label: string;
  ready: boolean;
  stock: number;
  threshold: number;
  supplyAvailable: boolean;
};

export type ResidenceNeedsStatus = {
  label: string;
  state: 'active' | 'idle' | 'warning';
};

export function createDefaultNeeds(): ResidenceNeedsState {
  return {
    firewood: { stock: 0, deficitTicks: 0 },
    water: { stock: 0, deficitTicks: 0 },
    food: { stock: 0, deficitTicks: 0 },
    ale: { stock: 0, deficitTicks: 0 },
    preservedFood: { stock: 0, deficitTicks: 0 },
    cloth: { stock: 0, deficitTicks: 0 },
    pottery: { stock: 0, deficitTicks: 0 },
  };
}

export function needKindFromId(id: number): ResidenceNeedKind | null {
  switch (id) {
    case RESIDENCE_NEED_KIND_IDS.firewood:
      return 'firewood';
    case RESIDENCE_NEED_KIND_IDS.water:
      return 'water';
    case RESIDENCE_NEED_KIND_IDS.food:
      return 'food';
    case RESIDENCE_NEED_KIND_IDS.ale:
      return 'ale';
    case RESIDENCE_NEED_KIND_IDS.preservedFood:
      return 'preservedFood';
    case RESIDENCE_NEED_KIND_IDS.cloth:
      return 'cloth';
    case RESIDENCE_NEED_KIND_IDS.pottery:
      return 'pottery';
    default:
      return null;
  }
}

export function getNeed(
  needs: ResidenceNeedsState,
  kind: ResidenceNeedKind,
): ResidenceNeedRecord {
  return needs[kind] ?? { stock: 0, deficitTicks: 0 };
}

export function getNeedStock(needs: ResidenceNeedsState, kind: ResidenceNeedKind): number {
  return getNeed(needs, kind).stock;
}

export function getNeedDeficitTicks(needs: ResidenceNeedsState, kind: ResidenceNeedKind): number {
  return getNeed(needs, kind).deficitTicks;
}

export function maxNeedDeficitTicks(needs: ResidenceNeedsState): number {
  return RESIDENCE_NEED_KINDS.reduce(
    (max, kind) => Math.max(max, getNeedDeficitTicks(needs, kind)),
    0,
  );
}

export function maxActiveNeedDeficitTicks(
  needs: ResidenceNeedsState,
  tier: 0 | 1 | 2 | 3,
): number {
  return activeResidenceNeedKinds(tier).reduce(
    (max, kind) => Math.max(max, getNeedDeficitTicks(needs, kind)),
    0,
  );
}

export function hasNeedStockRoom(stock: number, capacity: number): boolean {
  return stock + 1e-6 < capacity;
}

export function mergeNeedRow(
  needs: ResidenceNeedsState,
  kind: ResidenceNeedKind,
  row: { stock: number; deficitTicks: number },
): ResidenceNeedsState {
  return {
    ...needs,
    [kind]: {
      stock: row.stock,
      deficitTicks: row.deficitTicks,
    },
  };
}
