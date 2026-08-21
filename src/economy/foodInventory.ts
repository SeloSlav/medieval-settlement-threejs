import type { DeliveryCargoKind } from '../logistics/deliveryTrips.ts';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  EVENING_MEAL_PER_PERSON,
  FOOD_CATEGORY_QUALIFYING_DAYS,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';

export const FRESH_FOOD_KINDS = [
  'food',
  'oatGrain',
  'ryeBread',
  'maslinBread',
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
] as const;

export const PRESERVED_FOOD_KINDS = [
  'preservedFood',
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
  'cherries',
  'vegetables',
  'eggs',
  'grapes',
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
  oatGrain: 'Oats',
  ryeBread: 'Rye bread',
  maslinBread: 'Maslin bread',
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
  curedMeat: 'Cured meat',
  smokedFish: 'Smoked fish',
  cheese: 'Cheese',
  honey: 'Honey',
};

export type FoodInventoryLike = Partial<Record<FoodInventoryKind, number>>;

/** Physical food units converted to the meal-equivalents used by demand. */
export const FOOD_MEAL_VALUES: Readonly<Record<FoodInventoryKind, number>> = {
  food: 1,
  oatGrain: 0.65,
  ryeBread: 1,
  maslinBread: 1.05,
  meat: 1.1,
  fish: 1,
  berries: 0.55,
  mushrooms: 0.6,
  milk: 0.75,
  apples: 0.6,
  cherries: 0.6,
  vegetables: 0.7,
  eggs: 0.75,
  grapes: 0.6,
  preservedFood: 1,
  curedMeat: 1.15,
  smokedFish: 1.05,
  cheese: 0.9,
  honey: 1.2,
};

/** Relative decay inside each food's fresh or preserved storage class. */
export const FOOD_SPOILAGE_MULTIPLIERS: Readonly<Record<FoodInventoryKind, number>> = {
  food: 1,
  oatGrain: 0.35,
  ryeBread: 0.55,
  maslinBread: 0.5,
  meat: 2,
  fish: 2.2,
  berries: 1.4,
  mushrooms: 1.6,
  milk: 2.4,
  apples: 0.75,
  cherries: 1,
  vegetables: 1,
  eggs: 0.9,
  grapes: 1.2,
  preservedFood: 0.75,
  curedMeat: 0.55,
  smokedFish: 0.7,
  cheese: 1,
  honey: 0,
};

export function foodMealValue(kind: FoodInventoryKind): number {
  return FOOD_MEAL_VALUES[kind];
}

export function foodSpoilageMultiplier(kind: FoodInventoryKind): number {
  return FOOD_SPOILAGE_MULTIPLIERS[kind];
}

export const FOOD_CATEGORY_LABELS = {
  grains: 'Grains',
  vegetables: 'Vegetables',
  fruits: 'Fruit',
  animalProduce: 'Animal produce',
  meats: 'Meat',
  fishes: 'Fish',
  foraged: 'Foraged food',
  honey: 'Honey',
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
    case 'food':
    case 'oatGrain':
    case 'ryeBread':
    case 'maslinBread':
    case 'preservedFood':
      return 'grains';
    case 'vegetables':
      return 'vegetables';
    case 'apples':
    case 'cherries':
    case 'grapes':
      return 'fruits';
    case 'milk':
    case 'eggs':
    case 'cheese':
      return 'animalProduce';
    case 'meat':
    case 'curedMeat':
      return 'meats';
    case 'fish':
    case 'smokedFish':
      return 'fishes';
    case 'berries':
    case 'mushrooms':
      return 'foraged';
    case 'honey':
      return 'honey';
  }
}

export function householdFoodPerDay(population: number): number {
  const workdaySeconds = CALENDAR_SECONDS_PER_DAY
    * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
    / CALENDAR_HOURS_PER_DAY;
  return Math.max(0, population)
    * (RESIDENCE_FOOD_PER_PERSON_PER_SEC * workdaySeconds + EVENING_MEAL_PER_PERSON);
}

export function foodCategoryQualifyingStock(population: number): number {
  return householdFoodPerDay(population) * FOOD_CATEGORY_QUALIFYING_DAYS;
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
  const requiredSlots: readonly FoodProgressionSlot[] = tier === 1
    ? ['anyFood']
    : tier === 2
      ? ['grains', 'otherFood']
      : tier === 3
        ? ['grains', 'produceAndForage', 'animalFoods', 'fish']
        : ['grains', 'produceAndForage', 'animalProduce', 'meat', 'fish'];
  const minimum = foodCategoryQualifyingStock(population);
  const grainStock = (['food', 'oatGrain', 'ryeBread', 'maslinBread'] as const)
    .reduce((total, kind) => total + finiteFood(inventory[kind]) * foodMealValue(kind), 0);
  const supplied = new Set<FoodProgressionSlot>();

  if (suppliedCategories.length > 0) supplied.add('anyFood');
  if (grainStock + 1e-6 >= minimum) supplied.add('grains');
  if (suppliedCategories.some((category) => category !== 'grains')) supplied.add('otherFood');
  if (['vegetables', 'fruits', 'foraged', 'honey']
    .some((category) => categories.has(category as FoodCategory))) {
    supplied.add('produceAndForage');
  }
  if (categories.has('animalProduce') || categories.has('meats')) supplied.add('animalFoods');
  if (categories.has('animalProduce')) supplied.add('animalProduce');
  if (categories.has('meats')) supplied.add('meat');
  if (categories.has('fishes')) supplied.add('fish');

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
