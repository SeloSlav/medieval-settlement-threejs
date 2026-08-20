export const BREAD_GRAIN_KINDS = ['ryeGrain', 'oatGrain', 'maslinGrain'] as const;
/** Oats are threshed food/fodder; only rye and the wheat-slot grain go to mills. */
export const MILLABLE_GRAIN_KINDS = ['ryeGrain', 'maslinGrain'] as const;
export const GRAIN_SHEAF_KINDS = [
  'ryeSheaves',
  'oatSheaves',
  'barleySheaves',
  'maslinSheaves',
] as const;
export const BREAD_GRAIN_SHEAF_KINDS = [
  'ryeSheaves', 'oatSheaves', 'maslinSheaves',
] as const;
export const FLOUR_KINDS = ['ryeFlour', 'oatFlour', 'maslinFlour'] as const;
export const BAKEABLE_FLOUR_KINDS = ['ryeFlour', 'maslinFlour'] as const;
export const BREAD_KINDS = ['ryeBread', 'oatBread', 'maslinBread'] as const;

export type BreadGrainKind = (typeof BREAD_GRAIN_KINDS)[number];
export type GrainSheafKind = (typeof GRAIN_SHEAF_KINDS)[number];
export type FlourKind = (typeof FLOUR_KINDS)[number];
export type BreadKind = (typeof BREAD_KINDS)[number];
export type CropGoodsKind = BreadGrainKind | GrainSheafKind | FlourKind | BreadKind;

type CropGoodsInventory = Partial<Record<CropGoodsKind, number>>;

function sumKinds<K extends CropGoodsKind>(
  inventory: CropGoodsInventory,
  kinds: readonly K[],
): number {
  return kinds.reduce((total, kind) => {
    const value = inventory[kind];
    return total + (Number.isFinite(value) ? Math.max(0, value ?? 0) : 0);
  }, 0);
}

export function breadGrainStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, BREAD_GRAIN_KINDS);
}

export function millableGrainStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, MILLABLE_GRAIN_KINDS);
}

export function grainSheafStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, GRAIN_SHEAF_KINDS);
}

export function breadGrainBulkStock(inventory: CropGoodsInventory): number {
  return breadGrainStock(inventory) + sumKinds(inventory, BREAD_GRAIN_SHEAF_KINDS);
}

export function flourStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, FLOUR_KINDS);
}

export function bakeableFlourStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, BAKEABLE_FLOUR_KINDS);
}

export function breadStock(inventory: CropGoodsInventory): number {
  return sumKinds(inventory, BREAD_KINDS);
}

export function cropGoodsStock(
  inventory: CropGoodsInventory,
  kind: CropGoodsKind,
): number {
  const value = inventory[kind];
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}
