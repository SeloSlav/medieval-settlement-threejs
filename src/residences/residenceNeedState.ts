export type ResidenceNeedKind =
  | 'firewood'
  | 'water'
  | 'food'
  | 'ale'
  | 'preservedFood'
  | 'cloth'
  | 'shoes'
  | 'pottery'
  | 'church'
  | 'foodVariety'
  | 'luxury';

export const RESIDENCE_NEED_KINDS: readonly ResidenceNeedKind[] = [
  'food',
  'firewood',
  'water',
  'church',
  'foodVariety',
  'cloth',
  'shoes',
  'preservedFood',
  'ale',
  'pottery',
  'luxury',
];

export type ResidenceNeedCategory = {
  id: 'food-and-drink' | 'fuel-and-water' | 'household-goods' | 'faith-and-community';
  label: string;
  kinds: readonly ResidenceNeedKind[];
};

/**
 * Canonical household-need groupings used by residence-facing UI. Keep this
 * beside the need registry so new needs cannot silently land in an invented
 * presentation category.
 */
export const RESIDENCE_NEED_CATEGORIES: readonly ResidenceNeedCategory[] = [
  {
    id: 'food-and-drink',
    label: 'Food & drink',
    kinds: ['food', 'foodVariety', 'preservedFood', 'ale'],
  },
  {
    id: 'fuel-and-water',
    label: 'Fuel & water',
    kinds: ['firewood', 'water'],
  },
  {
    id: 'household-goods',
    label: 'Clothing & household goods',
    kinds: ['cloth', 'shoes', 'pottery', 'luxury'],
  },
  {
    id: 'faith-and-community',
    label: 'Faith & community',
    kinds: ['church'],
  },
];

export function residenceNeedCategory(kind: ResidenceNeedKind): ResidenceNeedCategory {
  const category = RESIDENCE_NEED_CATEGORIES.find((candidate) =>
    candidate.kinds.includes(kind));
  if (!category) throw new Error(`Residence need category missing for ${kind}`);
  return category;
}

export function activeResidenceNeedKinds(tier: 0 | 1 | 2 | 3 | 4): ResidenceNeedKind[] {
  if (tier === 0) return [];
  return RESIDENCE_NEED_KINDS.filter((kind) => {
    if (kind === 'food' || kind === 'firewood' || kind === 'water' || kind === 'church') return true;
    if (kind === 'foodVariety' || kind === 'cloth' || kind === 'ale') return tier >= 2;
    if (kind === 'shoes') return tier >= 3;
    return tier >= 4;
  });
}

export const RESIDENCE_NEED_KIND_IDS: Record<ResidenceNeedKind, number> = {
  firewood: 0,
  water: 1,
  food: 2,
  ale: 6,
  preservedFood: 7,
  cloth: 14,
  shoes: 60,
  // Must mirror CommodityKind::Pottery because delivery_trip.cargo_kind is
  // shared by household and building-bound carts.
  pottery: 23,
  church: 42,
  foodVariety: 43,
  luxury: 57,
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
  servingShoesSupplierId?: string | null;
  servingPotterySupplierId?: string | null;
};

export type ResidenceCommunityContext = {
  hasChapelAccess: boolean;
  hasMonasteryCoverage: boolean;
  sabbathObservance: boolean;
  chapelTier?: number;
};

export const DEFAULT_RESIDENCE_COMMUNITY_CONTEXT: ResidenceCommunityContext = {
  hasChapelAccess: false,
  hasMonasteryCoverage: false,
  sabbathObservance: false,
};

export function requiredChapelTierForResidence(tier: number): 1 | 2 | 3 {
  if (tier >= 4) return 3;
  if (tier >= 2) return 2;
  return 1;
}

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
    shoes: { stock: 0, deficitTicks: 0 },
    pottery: { stock: 0, deficitTicks: 0 },
    church: { stock: 0, deficitTicks: 0 },
    foodVariety: { stock: 0, deficitTicks: 0 },
    luxury: { stock: 0, deficitTicks: 0 },
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
    case RESIDENCE_NEED_KIND_IDS.shoes:
      return 'shoes';
    case RESIDENCE_NEED_KIND_IDS.pottery:
      return 'pottery';
    case RESIDENCE_NEED_KIND_IDS.church:
      return 'church';
    case RESIDENCE_NEED_KIND_IDS.foodVariety:
      return 'foodVariety';
    case RESIDENCE_NEED_KIND_IDS.luxury:
      return 'luxury';
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
  tier: 0 | 1 | 2 | 3 | 4,
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
