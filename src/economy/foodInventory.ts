import type { DeliveryCargoKind } from '../logistics/deliveryTrips.ts';

export const FRESH_FOOD_KINDS = [
  'food',
  'bread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'cherries',
  'vegetables',
  'eggs',
  'grapes',
  'porridge',
] as const;

export const PRESERVED_FOOD_KINDS = [
  'preservedFood',
  'curedMeat',
  'smokedFish',
  'cheese',
] as const;

export const NAMED_FOOD_KINDS = [
  'bread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'cherries',
  'vegetables',
  'eggs',
  'grapes',
  'porridge',
  'curedMeat',
  'smokedFish',
  'cheese',
  'honey',
] as const;

export type NamedFoodKind = (typeof NAMED_FOOD_KINDS)[number];
export type FoodInventoryKind =
  | (typeof FRESH_FOOD_KINDS)[number]
  | (typeof PRESERVED_FOOD_KINDS)[number]
  | 'honey';

export const NAMED_FOOD_LABELS: Record<NamedFoodKind, string> = {
  bread: 'Bread',
  meat: 'Meat',
  fish: 'Fish',
  berries: 'Berries',
  mushrooms: 'Mushrooms',
  milk: 'Milk',
  apples: 'Apples',
  cherries: 'Cherries',
  vegetables: 'Vegetables',
  eggs: 'Eggs',
  grapes: 'Grapes',
  porridge: 'Porridge',
  curedMeat: 'Cured meat',
  smokedFish: 'Smoked fish',
  cheese: 'Cheese',
  honey: 'Honey',
};

export type FoodInventoryLike = Partial<Record<FoodInventoryKind, number>>;

function finiteFood(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function freshFoodStock(inventory: FoodInventoryLike): number {
  return FRESH_FOOD_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]),
    0,
  );
}

export function preservedFoodStock(inventory: FoodInventoryLike): number {
  return PRESERVED_FOOD_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]),
    0,
  );
}

export function edibleFoodStock(inventory: FoodInventoryLike): number {
  return freshFoodStock(inventory)
    + preservedFoodStock(inventory)
    + finiteFood(inventory.honey);
}

/** Fresh inputs the smokehouse can actually cure, smoke, or turn into cheese. */
export function preservableFoodStock(inventory: FoodInventoryLike): number {
  return finiteFood(inventory.food)
    + finiteFood(inventory.meat)
    + finiteFood(inventory.fish)
    + finiteFood(inventory.milk);
}

export function isFreshFoodCargo(kind: DeliveryCargoKind): boolean {
  return (FRESH_FOOD_KINDS as readonly string[]).includes(kind);
}

export function isPreservedFoodCargo(kind: DeliveryCargoKind): boolean {
  return (PRESERVED_FOOD_KINDS as readonly string[]).includes(kind);
}

export function isEdibleFoodCargo(kind: DeliveryCargoKind): boolean {
  return kind === 'honey' || isFreshFoodCargo(kind) || isPreservedFoodCargo(kind);
}
