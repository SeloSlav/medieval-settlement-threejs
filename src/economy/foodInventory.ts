import type { DeliveryCargoKind } from '../logistics/deliveryTrips.ts';
import {
  CALENDAR_SECONDS_PER_DAY,
  EVENING_MEAL_PER_PERSON,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH,
} from '../generated/gameBalance.ts';

export const FRESH_FOOD_KINDS = [
  'oatGrain',
  'ryeBread',
  'maslinBread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'pears',
  'cherries',
  'aronia',
  'rosehips',
  'cabbage',
  'carrots',
  'beetroot',
  'eggs',
  'grapes',
] as const;

export const PRESERVED_FOOD_KINDS = [
  'curedMeat',
  'smokedFish',
  'cheese',
  'aroniaJam',
  'rosehipJam',
] as const;

export const SAVORY_PRESERVE_KINDS = [
  'curedMeat',
  'smokedFish',
  'cheese',
] as const;

export const NAMED_FOOD_KINDS = [
  'oatGrain',
  'ryeBread',
  'maslinBread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'pears',
  'cherries',
  'aronia',
  'rosehips',
  'cabbage',
  'carrots',
  'beetroot',
  'eggs',
  'grapes',
  'curedMeat',
  'smokedFish',
  'cheese',
  'aroniaJam',
  'rosehipJam',
  'honey',
] as const;

export type NamedFoodKind = (typeof NAMED_FOOD_KINDS)[number];
export type FoodInventoryKind =
  | (typeof FRESH_FOOD_KINDS)[number]
  | (typeof PRESERVED_FOOD_KINDS)[number]
  | 'honey';

export const NAMED_FOOD_LABELS: Record<NamedFoodKind, string> = {
  oatGrain: 'Oats',
  ryeBread: 'Rye bread',
  maslinBread: 'Maslin bread',
  meat: 'Meat',
  fish: 'Fish',
  berries: 'Raspberries',
  mushrooms: 'Mushrooms',
  milk: 'Milk',
  apples: 'Apples',
  pears: 'Pears',
  cherries: 'Cherries',
  aronia: 'Aronia berries',
  rosehips: 'Rosehips',
  cabbage: 'Cabbage',
  carrots: 'Carrots',
  beetroot: 'Beetroot',
  eggs: 'Eggs',
  grapes: 'Grapes',
  curedMeat: 'Cured meat',
  smokedFish: 'Smoked fish',
  cheese: 'Cheese',
  aroniaJam: 'Aronia jam',
  rosehipJam: 'Rosehip jam',
  honey: 'Honey',
};

export type FoodInventoryLike = Partial<Record<FoodInventoryKind, number>>;

/**
 * Most ready-to-eat physical food units are one household ration. Raw oats
 * remain edible as thin porridge, but provide only half a meal per unit; their
 * primary economic role is now the pastoral animal-feed recipe.
 * Keep this exhaustive table in parity with `CommodityKind::meal_value`.
 */
export const FOOD_MEAL_VALUES: Readonly<Record<FoodInventoryKind, number>> = {
  oatGrain: 0.5,
  ryeBread: 1,
  maslinBread: 1,
  meat: 1,
  fish: 1,
  berries: 1,
  mushrooms: 1,
  milk: 1,
  apples: 1,
  pears: 1,
  cherries: 1,
  aronia: 1,
  rosehips: 1,
  cabbage: 1,
  carrots: 1,
  beetroot: 1,
  eggs: 1,
  grapes: 1,
  curedMeat: 1,
  smokedFish: 1,
  cheese: 1,
  aroniaJam: 1,
  rosehipJam: 1,
  honey: 1,
};

/** Relative decay inside each food's fresh or preserved storage class. */
export const FOOD_SPOILAGE_MULTIPLIERS: Readonly<Record<FoodInventoryKind, number>> = {
  oatGrain: 0.35,
  ryeBread: 0.55,
  maslinBread: 0.5,
  meat: 2,
  fish: 2.2,
  berries: 1.4,
  mushrooms: 1.6,
  milk: 2.4,
  apples: 0.75,
  pears: 0.8,
  cherries: 1,
  aronia: 1.3,
  rosehips: 1.2,
  cabbage: 0.8,
  carrots: 0.7,
  beetroot: 0.75,
  eggs: 0.9,
  grapes: 1.2,
  curedMeat: 0.55,
  smokedFish: 0.7,
  cheese: 1,
  aroniaJam: 0.35,
  rosehipJam: 0.35,
  honey: 0,
};

export function foodMealValue(kind: FoodInventoryKind): number {
  return FOOD_MEAL_VALUES[kind];
}

export function foodSpoilageMultiplier(kind: FoodInventoryKind): number {
  return FOOD_SPOILAGE_MULTIPLIERS[kind];
}

export type FoodSpoilageLabel =
  | 'Shelf-stable'
  | 'Slow spoilage'
  | 'Moderate spoilage'
  | 'Fast spoilage';

/** Player-facing perishability band; storage conditions are applied separately. */
export function foodSpoilageLabel(kind: FoodInventoryKind): FoodSpoilageLabel {
  const multiplier = foodSpoilageMultiplier(kind);
  if (multiplier <= 0) return 'Shelf-stable';
  if (multiplier <= 0.75) return 'Slow spoilage';
  if (multiplier <= 1.25) return 'Moderate spoilage';
  return 'Fast spoilage';
}

export const FOOD_CATEGORY_LABELS = {
  grains: 'Grains',
  vegetables: 'Vegetables',
  fruits: 'Fruit',
  animalProduce: 'Animal produce',
  meats: 'Meat',
  fishes: 'Fish',
  foraged: 'Foraged food',
  savoryPreserves: 'Savory preserves',
  sweetPreserves: 'Sweet preserves',
} as const;
export type FoodCategory = keyof typeof FOOD_CATEGORY_LABELS;

export const FOOD_PROGRESSION_SLOT_LABELS = {
  anyFood: 'Any food group',
  grains: 'Grain staple',
  otherFood: 'Another food group',
  produceAndForage: 'Produce or forage',
  animalFoods: 'Meat or animal produce',
  animalProduce: 'Eggs, milk, or cheese',
  meat: 'Fresh or cured meat',
  fish: 'Fish',
} as const;
export type FoodProgressionSlot = keyof typeof FOOD_PROGRESSION_SLOT_LABELS;

export type FoodProgressionStatus = {
  tier: 1 | 2 | 3 | 4;
  requiredSlots: readonly FoodProgressionSlot[];
  satisfiedSlots: FoodProgressionSlot[];
  missingSlots: FoodProgressionSlot[];
  suppliedCategories: FoodCategory[];
  ready: boolean;
};

export function foodCategory(kind: FoodInventoryKind): FoodCategory {
  switch (kind) {
    case 'oatGrain':
    case 'ryeBread':
    case 'maslinBread':
      return 'grains';
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
      return 'vegetables';
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'grapes':
      return 'fruits';
    case 'milk':
    case 'eggs':
      return 'animalProduce';
    case 'meat':
      return 'meats';
    case 'fish':
      return 'fishes';
    case 'berries':
    case 'aronia':
    case 'rosehips':
    case 'mushrooms':
      return 'foraged';
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
      return 'savoryPreserves';
    case 'aroniaJam':
    case 'rosehipJam':
    case 'honey':
      return 'sweetPreserves';
  }
}

function foodProgressionCategory(kind: FoodInventoryKind): FoodCategory {
  switch (kind) {
    case 'curedMeat': return 'meats';
    case 'smokedFish': return 'fishes';
    case 'cheese': return 'animalProduce';
    default: return foodCategory(kind);
  }
}

export function householdFoodPerDay(population: number): number {
  return Math.max(0, population)
    * (RESIDENCE_FOOD_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY + EVENING_MEAL_PER_PERSON);
}

export function foodCategoryQualifyingStock(_population: number): number {
  // Food categories back the discrete household bill. Keep this threshold in
  // the same whole-unit terms as the authoritative simulation so one bread or
  // other full meal satisfies a Tier-1 household regardless of headcount.
  return Math.max(1, Math.floor(RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH));
}

export function foodCategoryStocks(
  inventory: FoodInventoryLike,
): Record<FoodCategory, number> {
  const stocks = Object.fromEntries(
    Object.keys(FOOD_CATEGORY_LABELS).map((category) => [category, 0]),
  ) as Record<FoodCategory, number>;
  for (const kind of [...FRESH_FOOD_KINDS, ...PRESERVED_FOOD_KINDS, 'honey'] as const) {
    stocks[foodCategory(kind)] += finiteFood(inventory[kind]) * foodMealValue(kind);
  }
  return stocks;
}

export function presentFoodCategories(
  inventory: FoodInventoryLike,
  population: number,
): FoodCategory[] {
  const minimum = foodCategoryQualifyingStock(population);
  return (Object.entries(foodCategoryStocks(inventory)) as [FoodCategory, number][])
    .filter(([, stock]) => stock + 1e-6 >= minimum)
    .map(([category]) => category);
}

export function foodVarietyCount(inventory: FoodInventoryLike, population: number): number {
  return presentFoodCategories(inventory, population).length;
}

function presentFoodProgressionCategories(
  inventory: FoodInventoryLike,
  population: number,
): Set<FoodCategory> {
  const minimum = foodCategoryQualifyingStock(population);
  const stocks = new Map<FoodCategory, number>();
  for (const kind of [...FRESH_FOOD_KINDS, ...PRESERVED_FOOD_KINDS, 'honey'] as const) {
    const category = foodProgressionCategory(kind);
    stocks.set(category, (stocks.get(category) ?? 0)
      + finiteFood(inventory[kind]) * foodMealValue(kind));
  }
  return new Set(
    [...stocks.entries()]
      .filter(([, stock]) => stock + 1e-6 >= minimum)
      .map(([category]) => category),
  );
}

/**
 * Residence food progression follows broad Manor-Lords-style food families
 * without importing its late-game item counts wholesale. Tier 1 accepts any
 * viable opening food; Tier 2 establishes grain plus a second category; Tier
 * 3 separates produce/forage, land animal food, and fish. Tier 4 splits land
 * animal food into animal produce and meat, then layers its separate cured-
 * provisions and luxury needs on top of this result.
 */
export function foodProgressionStatus(
  inventory: FoodInventoryLike,
  population: number,
  tier: 1 | 2 | 3 | 4,
): FoodProgressionStatus {
  const suppliedCategories = presentFoodCategories(inventory, population);
  const categories = new Set(suppliedCategories);
  const progressionCategories = presentFoodProgressionCategories(inventory, population);
  const requiredSlots: readonly FoodProgressionSlot[] = tier === 1
    ? ['anyFood']
    : tier === 2
      ? ['grains', 'otherFood']
      : tier === 3
        ? ['grains', 'produceAndForage', 'animalFoods', 'fish']
        : ['grains', 'produceAndForage', 'animalProduce', 'meat', 'fish'];
  const minimum = foodCategoryQualifyingStock(population);
  const grainStock = (['oatGrain', 'ryeBread', 'maslinBread'] as const)
    .reduce((total, kind) => total + finiteFood(inventory[kind]) * foodMealValue(kind), 0);
  const supplied = new Set<FoodProgressionSlot>();

  if (suppliedCategories.length > 0) supplied.add('anyFood');
  if (grainStock + 1e-6 >= minimum) supplied.add('grains');
  if (suppliedCategories.some((category) => category !== 'grains')) supplied.add('otherFood');
  if (['vegetables', 'fruits', 'foraged', 'sweetPreserves']
    .some((category) => categories.has(category as FoodCategory))) {
    supplied.add('produceAndForage');
  }
  if (progressionCategories.has('animalProduce') || progressionCategories.has('meats')) supplied.add('animalFoods');
  if (progressionCategories.has('animalProduce')) supplied.add('animalProduce');
  if (progressionCategories.has('meats')) supplied.add('meat');
  if (progressionCategories.has('fishes')) supplied.add('fish');

  const satisfiedSlots = requiredSlots.filter((slot) => supplied.has(slot));
  const missingSlots = requiredSlots.filter((slot) => !supplied.has(slot));
  return {
    tier,
    requiredSlots,
    satisfiedSlots,
    missingSlots,
    suppliedCategories,
    ready: missingSlots.length === 0,
  };
}

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

export function savoryPreservesStock(inventory: FoodInventoryLike): number {
  return SAVORY_PRESERVE_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]),
    0,
  );
}

export function edibleFoodStock(inventory: FoodInventoryLike): number {
  return freshFoodStock(inventory)
    + preservedFoodStock(inventory)
    + finiteFood(inventory.honey);
}

export function freshFoodMealEquivalents(inventory: FoodInventoryLike): number {
  return FRESH_FOOD_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]) * foodMealValue(kind),
    0,
  );
}

export function preservedFoodMealEquivalents(inventory: FoodInventoryLike): number {
  return PRESERVED_FOOD_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]) * foodMealValue(kind),
    0,
  );
}

export function savoryPreservesMealEquivalents(inventory: FoodInventoryLike): number {
  return SAVORY_PRESERVE_KINDS.reduce(
    (total, kind) => total + finiteFood(inventory[kind]) * foodMealValue(kind),
    0,
  );
}

export function edibleFoodMealEquivalents(inventory: FoodInventoryLike): number {
  return freshFoodMealEquivalents(inventory)
    + preservedFoodMealEquivalents(inventory)
    + finiteFood(inventory.honey) * foodMealValue('honey');
}

export function freshFoodSpoilageExposure(inventory: FoodInventoryLike): number {
  return FRESH_FOOD_KINDS.reduce(
    (total, kind) => total
      + finiteFood(inventory[kind])
        * foodMealValue(kind)
        * foodSpoilageMultiplier(kind),
    0,
  );
}

export function preservedFoodSpoilageExposure(inventory: FoodInventoryLike): number {
  return PRESERVED_FOOD_KINDS.reduce(
    (total, kind) => total
      + finiteFood(inventory[kind])
        * foodMealValue(kind)
        * foodSpoilageMultiplier(kind),
    0,
  );
}

export function savoryPreservesSpoilageExposure(inventory: FoodInventoryLike): number {
  return SAVORY_PRESERVE_KINDS.reduce(
    (total, kind) => total
      + finiteFood(inventory[kind])
        * foodMealValue(kind)
        * foodSpoilageMultiplier(kind),
    0,
  );
}

/** Fresh inputs the smokehouse can actually cure, smoke, or turn into cheese. */
export function preservableFoodStock(inventory: FoodInventoryLike): number {
  return finiteFood(inventory.meat)
    + finiteFood(inventory.fish)
    + finiteFood(inventory.milk);
}

export function isFreshFoodCargo(kind: DeliveryCargoKind): boolean {
  return (FRESH_FOOD_KINDS as readonly string[]).includes(kind);
}

export function isPreservedFoodCargo(kind: DeliveryCargoKind): boolean {
  return (PRESERVED_FOOD_KINDS as readonly string[]).includes(kind);
}

export function isSavoryPreserveCargo(kind: DeliveryCargoKind): boolean {
  return (SAVORY_PRESERVE_KINDS as readonly string[]).includes(kind);
}

export function isEdibleFoodCargo(kind: DeliveryCargoKind): boolean {
  return kind === 'honey' || isFreshFoodCargo(kind) || isPreservedFoodCargo(kind);
}
