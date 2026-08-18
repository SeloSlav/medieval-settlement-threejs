import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const STOREHOUSE_COMMODITIES = [
  'timber',
  'stone',
  'firewood',
  'charcoal',
  'iron',
  'clay',
  'salt',
] as const;
export type StorehouseCommodity = (typeof STOREHOUSE_COMMODITIES)[number];

type StorehouseAcceptsField =
  | 'storehouseAcceptsTimber'
  | 'storehouseAcceptsStone'
  | 'storehouseAcceptsFirewood'
  | 'storehouseAcceptsCharcoal'
  | 'storehouseAcceptsIron'
  | 'storehouseAcceptsClay'
  | 'storehouseAcceptsSalt';

type StorehouseTargetField =
  | 'storehouseTimberTargetPercent'
  | 'storehouseStoneTargetPercent'
  | 'storehouseFirewoodTargetPercent'
  | 'storehouseCharcoalTargetPercent'
  | 'storehouseIronTargetPercent'
  | 'storehouseClayTargetPercent'
  | 'storehouseSaltTargetPercent';

const STOREHOUSE_ACCEPTS_FIELDS: Record<StorehouseCommodity, StorehouseAcceptsField> = {
  timber: 'storehouseAcceptsTimber',
  stone: 'storehouseAcceptsStone',
  firewood: 'storehouseAcceptsFirewood',
  charcoal: 'storehouseAcceptsCharcoal',
  iron: 'storehouseAcceptsIron',
  clay: 'storehouseAcceptsClay',
  salt: 'storehouseAcceptsSalt',
};

const STOREHOUSE_TARGET_FIELDS: Record<StorehouseCommodity, StorehouseTargetField> = {
  timber: 'storehouseTimberTargetPercent',
  stone: 'storehouseStoneTargetPercent',
  firewood: 'storehouseFirewoodTargetPercent',
  charcoal: 'storehouseCharcoalTargetPercent',
  iron: 'storehouseIronTargetPercent',
  clay: 'storehouseClayTargetPercent',
  salt: 'storehouseSaltTargetPercent',
};

export const STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT = 100;
export const STOREHOUSE_STOCK_TARGET_PRESETS = [
  {
    percent: 25,
    label: 'Quarter',
    hint: 'Keeps a small local cache and leaves overflow carts free for other depots.',
  },
  {
    percent: 50,
    label: 'Half',
    hint: 'Balances local construction supply against collection-cart demand.',
  },
  {
    percent: 75,
    label: 'Deep',
    hint: 'Builds a substantial branch reserve before overflow moves elsewhere.',
  },
  {
    percent: 100,
    label: 'Fill',
    hint: 'Matches the original behavior and collects until physical capacity.',
  },
] as const;

export function isStorehouseCommodity(value: string | undefined): value is StorehouseCommodity {
  return STOREHOUSE_COMMODITIES.some((commodity) => commodity === value);
}

export function normalizeStorehouseStockTargetPercent(
  percent: number | undefined,
): number {
  if (!Number.isFinite(percent)) return STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT;
  const rounded = Math.round(percent as number);
  return STOREHOUSE_STOCK_TARGET_PRESETS.some((preset) => preset.percent === rounded)
    ? rounded
    : STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT;
}

export function storehouseStockTarget(capacity: number, percent: number | undefined): number {
  if (!Number.isFinite(capacity)) return 0;
  return Math.max(0, capacity)
    * normalizeStorehouseStockTargetPercent(percent)
    / 100;
}

export function storehouseCollectionHeadroom(
  stock: number,
  capacity: number,
  percent: number | undefined,
): number {
  if (!Number.isFinite(stock)) return 0;
  return Math.max(0, storehouseStockTarget(capacity, percent) - Math.max(0, stock));
}

export function storehouseCommodityTargetPercent(
  building: Pick<BuildingState, StorehouseTargetField>,
  commodity: StorehouseCommodity,
): number {
  return normalizeStorehouseStockTargetPercent(
    building[STOREHOUSE_TARGET_FIELDS[commodity]],
  );
}

export function storehouseCommodityTarget(
  building: Pick<BuildingState, StorehouseTargetField>,
  commodity: StorehouseCommodity,
): number {
  const capacity = BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0;
  return storehouseStockTarget(
    capacity,
    storehouseCommodityTargetPercent(building, commodity),
  );
}

export function storehouseAcceptsCommodity(
  building: Pick<BuildingState, StorehouseAcceptsField>,
  commodity: StorehouseCommodity,
): boolean {
  return building[STOREHOUSE_ACCEPTS_FIELDS[commodity]] !== false;
}

/** Shared intake-gated headroom used by producer overflow and founding-yard relocation. */
export function storehouseFilteredCollectionHeadroom(
  building: Pick<
    BuildingState,
    StorehouseCommodity | StorehouseAcceptsField | StorehouseTargetField
  >,
  commodity: StorehouseCommodity,
): number {
  if (!storehouseAcceptsCommodity(building, commodity)) return 0;
  const rawStock = building[commodity] ?? 0;
  const stock = Number.isFinite(rawStock)
    ? Math.max(0, rawStock)
    : 0;
  return Math.max(0, storehouseCommodityTarget(building, commodity) - stock);
}
