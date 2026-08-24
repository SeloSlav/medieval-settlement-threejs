import {
  CATTLE_DEFAULT_BREEDING_RESERVE,
  CATTLE_DAIRY_PRODUCTIVE_SHARE,
  CATTLE_FOOD_PER_CYCLE_PER_HEAD,
  CATTLE_HEADS_PER_WORKER,
  CATTLE_MAX_HERD,
  CATTLE_MINIMUM_BREEDING_RESERVE,
  CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
  CATTLE_PURCHASE_GOLD_PER_HEAD,
  CATTLE_SALE_GOLD_PER_HEAD,
  CATTLE_SLAUGHTER_FOOD_PER_HEAD,
  CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  CATTLE_WATER_PER_HEAD_PER_CYCLE,
  LIVESTOCK_AUTUMN_CULL_END_MONTH,
  LIVESTOCK_AUTUMN_CULL_START_MONTH,
  LIVESTOCK_DEFAULT_HAYMAKING_PERCENT,
  LIVESTOCK_HAYMAKING_END_MONTH,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
  LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
  SHEEP_DEFAULT_BREEDING_RESERVE,
  SHEEP_DAIRY_PRODUCTIVE_SHARE,
  SHEEP_FOOD_PER_CYCLE_PER_HEAD,
  SHEEP_HEADS_PER_WORKER,
  SHEEP_MAX_HERD,
  SHEEP_MINIMUM_BREEDING_RESERVE,
  SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
  SHEEP_PURCHASE_GOLD_PER_HEAD,
  SHEEP_SALE_GOLD_PER_HEAD,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_SHEARING_START_MONTH,
  SHEEP_SLAUGHTER_FOOD_PER_HEAD,
  SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  SHEEP_WATER_PER_HEAD_PER_CYCLE,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SWINE_DEFAULT_BREEDING_RESERVE,
  SWINE_DAIRY_PRODUCTIVE_SHARE,
  SWINE_HEADS_PER_WORKER,
  SWINE_MAX_HERD,
  SWINE_MINIMUM_BREEDING_RESERVE,
  SWINE_PURCHASE_GOLD_PER_HEAD,
  SWINE_SALE_GOLD_PER_HEAD,
  SWINE_SLAUGHTER_FOOD_PER_HEAD,
  SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  SWINE_WATER_PER_HEAD_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { LivestockHerdState, LivestockSpecies } from '../resources/types.ts';

export type LivestockPolicyDefinition = {
  minimumReserve: number;
  defaultReserve: number;
  maximumHerd: number;
  slaughterFoodPerHead: number;
  slaughterPreservedFoodPerHead: number;
  preservedFoodPerCyclePerHead: number;
  milkPerCyclePerHead: number;
  purchaseGoldPerHead: number;
  saleGoldPerHead: number;
  headsPerWorker: number;
  waterPerHeadPerCycle: number;
  dairyProductiveShare: number;
};

export type LivestockReservePreset = {
  key: 'meat' | 'balanced' | 'growth';
  label: string;
  reserve: number;
};

export type LivestockHaymakingPreset = {
  key: 'grazing' | 'balanced' | 'winter';
  label: string;
  percent: number;
};

export const LIVESTOCK_MILK_USE_PRESETS = [
  { value: 25, label: 'Fresh milk', hint: 'Keep the whole yield perishable and salt-free.' },
  { value: 50, label: 'Balanced', hint: 'Keep the traditional milk and cheese split.' },
  { value: 75, label: 'Cheese first', hint: 'Salt up to 75% of the shared yield for storage and export.' },
] as const;

export type LivestockMilkUsePolicy =
  (typeof LIVESTOCK_MILK_USE_PRESETS)[number];

const POLICY_BY_SPECIES: Record<LivestockSpecies, LivestockPolicyDefinition> = {
  cattle: {
    minimumReserve: CATTLE_MINIMUM_BREEDING_RESERVE,
    defaultReserve: CATTLE_DEFAULT_BREEDING_RESERVE,
    maximumHerd: CATTLE_MAX_HERD,
    slaughterFoodPerHead: CATTLE_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
    preservedFoodPerCyclePerHead: CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
    milkPerCyclePerHead: CATTLE_FOOD_PER_CYCLE_PER_HEAD,
    purchaseGoldPerHead: CATTLE_PURCHASE_GOLD_PER_HEAD,
    saleGoldPerHead: CATTLE_SALE_GOLD_PER_HEAD,
    headsPerWorker: CATTLE_HEADS_PER_WORKER,
    waterPerHeadPerCycle: CATTLE_WATER_PER_HEAD_PER_CYCLE,
    dairyProductiveShare: CATTLE_DAIRY_PRODUCTIVE_SHARE,
  },
  sheep: {
    minimumReserve: SHEEP_MINIMUM_BREEDING_RESERVE,
    defaultReserve: SHEEP_DEFAULT_BREEDING_RESERVE,
    maximumHerd: SHEEP_MAX_HERD,
    slaughterFoodPerHead: SHEEP_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
    preservedFoodPerCyclePerHead: SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
    milkPerCyclePerHead: SHEEP_FOOD_PER_CYCLE_PER_HEAD,
    purchaseGoldPerHead: SHEEP_PURCHASE_GOLD_PER_HEAD,
    saleGoldPerHead: SHEEP_SALE_GOLD_PER_HEAD,
    headsPerWorker: SHEEP_HEADS_PER_WORKER,
    waterPerHeadPerCycle: SHEEP_WATER_PER_HEAD_PER_CYCLE,
    dairyProductiveShare: SHEEP_DAIRY_PRODUCTIVE_SHARE,
  },
  swine: {
    minimumReserve: SWINE_MINIMUM_BREEDING_RESERVE,
    defaultReserve: SWINE_DEFAULT_BREEDING_RESERVE,
    maximumHerd: SWINE_MAX_HERD,
    slaughterFoodPerHead: SWINE_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
    preservedFoodPerCyclePerHead: 0,
    milkPerCyclePerHead: 0,
    purchaseGoldPerHead: SWINE_PURCHASE_GOLD_PER_HEAD,
    saleGoldPerHead: SWINE_SALE_GOLD_PER_HEAD,
    headsPerWorker: SWINE_HEADS_PER_WORKER,
    waterPerHeadPerCycle: SWINE_WATER_PER_HEAD_PER_CYCLE,
    dairyProductiveShare: SWINE_DAIRY_PRODUCTIVE_SHARE,
  },
};

export function livestockPolicyDefinition(species: LivestockSpecies): LivestockPolicyDefinition {
  return POLICY_BY_SPECIES[species];
}

export function livestockPurchaseGoldPerHead(species: LivestockSpecies): number {
  return livestockPolicyDefinition(species).purchaseGoldPerHead;
}

export function livestockSaleGoldPerHead(species: LivestockSpecies): number {
  return livestockPolicyDefinition(species).saleGoldPerHead;
}

export function livestockPurchaseCost(
  species: LivestockSpecies,
  headCount: number,
): number {
  const wholeHeads = Number.isFinite(headCount)
    ? Math.max(0, Math.floor(headCount))
    : 0;
  return wholeHeads * livestockPurchaseGoldPerHead(species);
}

export function livestockSaleProceeds(
  species: LivestockSpecies,
  headCount: number,
): number {
  const wholeHeads = Number.isFinite(headCount)
    ? Math.max(0, Math.floor(headCount))
    : 0;
  return wholeHeads * livestockSaleGoldPerHead(species);
}

export function livestockHeadsPerWorker(species: LivestockSpecies): number {
  return livestockPolicyDefinition(species).headsPerWorker;
}

export function livestockCareCapacity(
  species: LivestockSpecies,
  assignedLabor: number,
): number {
  const workers = Number.isFinite(assignedLabor)
    ? Math.max(0, Math.floor(assignedLabor))
    : 0;
  return workers * livestockHeadsPerWorker(species);
}

export function livestockWaterPerHeadPerCycle(species: LivestockSpecies): number {
  return livestockPolicyDefinition(species).waterPerHeadPerCycle;
}

export function livestockWaterRequiredPerCycle(
  species: LivestockSpecies,
  headCount: number,
): number {
  const heads = Number.isFinite(headCount) ? Math.max(0, headCount) : 0;
  return heads * livestockWaterPerHeadPerCycle(species);
}

export function effectiveLivestockBreedingReserve(
  species: LivestockSpecies,
  configuredReserve: number,
): number {
  const policy = livestockPolicyDefinition(species);
  if (!Number.isFinite(configuredReserve) || configuredReserve <= 0) {
    return policy.maximumHerd;
  }
  return Math.max(1, Math.min(policy.maximumHerd, Math.floor(configuredReserve)));
}

export function livestockReservePresets(species: LivestockSpecies): LivestockReservePreset[] {
  const policy = livestockPolicyDefinition(species);
  return [
    { key: 'meat', label: 'Meat first', reserve: policy.minimumReserve },
    { key: 'balanced', label: 'Balanced', reserve: policy.defaultReserve },
    { key: 'growth', label: 'Grow herd', reserve: policy.maximumHerd },
  ];
}

export function effectiveLivestockHaymakingPercent(configuredPercent: number): number {
  if (!Number.isFinite(configuredPercent)) return 0;
  return Math.max(
    0,
    Math.min(LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT, Math.floor(configuredPercent)),
  );
}

export function livestockHaymakingPresets(): LivestockHaymakingPreset[] {
  return [
    { key: 'grazing', label: 'Grazing first', percent: 0 },
    {
      key: 'balanced',
      label: 'Balanced',
      percent: LIVESTOCK_DEFAULT_HAYMAKING_PERCENT,
    },
    {
      key: 'winter',
      label: 'Winter first',
      percent: LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
    },
  ];
}

export function isLivestockHaymakingMonth(month: number): boolean {
  return month >= LIVESTOCK_HAYMAKING_START_MONTH
    && month <= LIVESTOCK_HAYMAKING_END_MONTH;
}

export function isSheepShearingMonth(month: number): boolean {
  return month >= SHEEP_SHEARING_START_MONTH
    && month <= SHEEP_SHEARING_END_MONTH;
}

export function sheepFleeceOutput(productiveHeads: number): number {
  return Math.max(0, productiveHeads) * SHEEP_WOOL_PER_SHEARING_PER_HEAD;
}

export function projectedSheepFleece(
  herd: Pick<LivestockHerdState, 'headCount' | 'health' | 'suppliedCapacity'>,
): number {
  const headCount = Math.max(0, herd.headCount);
  const suppliedHeads = Math.min(headCount, Math.max(0, herd.suppliedCapacity));
  const health = Math.min(1, Math.max(0, herd.health));
  return sheepFleeceOutput(suppliedHeads * health);
}

export function canStoreFullSheepClip(
  projectedFleece: number,
  woolRoom: number,
): boolean {
  return projectedFleece > 1e-6
    && Math.max(0, woolRoom) + 1e-6 >= projectedFleece;
}

export function isLivestockCullMonth(month: number): boolean {
  return month >= LIVESTOCK_AUTUMN_CULL_START_MONTH
    && month <= LIVESTOCK_AUTUMN_CULL_END_MONTH;
}

export function pendingLivestockCullHeads(
  species: LivestockSpecies,
  headCount: number,
  configuredReserve: number,
): number {
  return Math.max(
    0,
    Math.floor(headCount) - effectiveLivestockBreedingReserve(species, configuredReserve),
  );
}

export function projectedLivestockCullYield(
  species: LivestockSpecies,
  headCount: number,
  configuredReserve: number,
): { heads: number; food: number; preservedFood: number } {
  const heads = pendingLivestockCullHeads(species, headCount, configuredReserve);
  const policy = livestockPolicyDefinition(species);
  return {
    heads,
    food: heads * policy.slaughterFoodPerHead,
    preservedFood: heads * policy.slaughterPreservedFoodPerHead,
  };
}

export function livestockPreservationSaltRequired(
  preservedFood: number,
): number {
  return Math.max(0, preservedFood)
    * LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT;
}

export function livestockSaltedOutputCapacity(salt: number): number {
  return LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT <= 1e-9
    ? Number.POSITIVE_INFINITY
    : Math.max(0, salt) / LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT;
}

export function livestockDairyPreservedOutputPerCycle(
  species: LivestockSpecies,
  productiveHeads: number,
): number {
  return livestockDairyProductiveHeads(species, productiveHeads)
    * livestockPolicyDefinition(species).preservedFoodPerCyclePerHead;
}

/**
 * Herd rows count every animal. This aggregate share represents mature,
 * lactating females so calves, lambs, males, and dry animals consume land and
 * care without all being treated as milk producers.
 */
export function livestockDairyProductiveHeads(
  species: LivestockSpecies,
  healthySupportedHeads: number,
): number {
  return Math.max(0, healthySupportedHeads)
    * livestockPolicyDefinition(species).dairyProductiveShare;
}

export function livestockMilkUsePolicy(
  configured: number | undefined,
): LivestockMilkUsePolicy {
  return LIVESTOCK_MILK_USE_PRESETS.find((preset) => preset.value === configured)
    ?? LIVESTOCK_MILK_USE_PRESETS[1];
}

export function livestockMilkAllocationPerCycle(
  species: LivestockSpecies,
  productiveHeads: number,
  configured: number | undefined,
  cheeseCapacity = Number.POSITIVE_INFINITY,
): { grossMilk: number; freshMilk: number; cheese: number } {
  const policy = livestockPolicyDefinition(species);
  const dairyHeads = livestockDairyProductiveHeads(species, productiveHeads);
  const baseMilk = dairyHeads * policy.milkPerCyclePerHead;
  const baseCheese = dairyHeads * policy.preservedFoodPerCyclePerHead;
  const grossMilk = baseMilk + baseCheese;
  const normalized = livestockMilkUsePolicy(configured).value;
  const desiredCheese = normalized === 25
    ? 0
    : normalized === 75
      ? grossMilk * 0.75
      : baseCheese;
  const boundedCapacity = Number.isFinite(cheeseCapacity)
    ? Math.max(0, cheeseCapacity)
    : Number.POSITIVE_INFINITY;
  const cheese = Math.min(grossMilk, desiredCheese, boundedCapacity);
  return { grossMilk, freshMilk: Math.max(0, grossMilk - cheese), cheese };
}

export function farmhouseCheeseSaltStagingCycles(
  configured: number | undefined,
): number {
  return livestockMilkUsePolicy(configured).value === 25 ? 0 : 3;
}

export function livestockDairySaltPerCycle(
  species: LivestockSpecies,
  productiveHeads: number,
  configured: number | undefined = 50,
): number {
  return livestockPreservationSaltRequired(
    livestockMilkAllocationPerCycle(species, productiveHeads, configured).cheese,
  );
}
