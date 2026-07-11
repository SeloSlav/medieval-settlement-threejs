export type ResidenceNeedKind = 'firewood' | 'water' | 'food';

export const RESIDENCE_NEED_KINDS: readonly ResidenceNeedKind[] = ['firewood', 'water', 'food'];

export const RESIDENCE_NEED_KIND_IDS: Record<ResidenceNeedKind, number> = {
  firewood: 0,
  water: 1,
  food: 2,
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
};

export type ResidenceCommunityContext = {
  hasChapelAccess: boolean;
  sabbathObservance: boolean;
};

export const DEFAULT_RESIDENCE_COMMUNITY_CONTEXT: ResidenceCommunityContext = {
  hasChapelAccess: false,
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
  state: 'active' | 'idle' | 'warning' | 'abandoned';
};

export function createDefaultNeeds(): ResidenceNeedsState {
  return {
    firewood: { stock: 0, deficitTicks: 0 },
    water: { stock: 0, deficitTicks: 0 },
    food: { stock: 0, deficitTicks: 0 },
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
    default:
      return null;
  }
}

export function getNeed(
  needs: ResidenceNeedsState,
  kind: ResidenceNeedKind,
): ResidenceNeedRecord {
  return needs[kind];
}

export function getNeedStock(needs: ResidenceNeedsState, kind: ResidenceNeedKind): number {
  return needs[kind].stock;
}

export function getNeedDeficitTicks(needs: ResidenceNeedsState, kind: ResidenceNeedKind): number {
  return needs[kind].deficitTicks;
}

export function maxNeedDeficitTicks(needs: ResidenceNeedsState): number {
  return RESIDENCE_NEED_KINDS.reduce(
    (max, kind) => Math.max(max, needs[kind].deficitTicks),
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
