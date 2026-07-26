import {
  CATTLE_DEFAULT_BREEDING_RESERVE,
  CATTLE_MAX_HERD,
  CATTLE_MINIMUM_BREEDING_RESERVE,
  CATTLE_SLAUGHTER_FOOD_PER_HEAD,
  CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  LIVESTOCK_AUTUMN_CULL_END_MONTH,
  LIVESTOCK_AUTUMN_CULL_START_MONTH,
  LIVESTOCK_DEFAULT_HAYMAKING_PERCENT,
  LIVESTOCK_HAYMAKING_END_MONTH,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
  SHEEP_DEFAULT_BREEDING_RESERVE,
  SHEEP_MAX_HERD,
  SHEEP_MINIMUM_BREEDING_RESERVE,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_SHEARING_START_MONTH,
  SHEEP_SLAUGHTER_FOOD_PER_HEAD,
  SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SWINE_DEFAULT_BREEDING_RESERVE,
  SWINE_MAX_HERD,
  SWINE_MINIMUM_BREEDING_RESERVE,
  SWINE_SLAUGHTER_FOOD_PER_HEAD,
  SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
} from '../generated/gameBalance.ts';
import type { LivestockHerdState, LivestockSpecies } from '../resources/types.ts';

export type LivestockPolicyDefinition = {
  minimumReserve: number;
  defaultReserve: number;
  maximumHerd: number;
  slaughterFoodPerHead: number;
  slaughterPreservedFoodPerHead: number;
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

const POLICY_BY_SPECIES: Record<LivestockSpecies, LivestockPolicyDefinition> = {
  cattle: {
    minimumReserve: CATTLE_MINIMUM_BREEDING_RESERVE,
    defaultReserve: CATTLE_DEFAULT_BREEDING_RESERVE,
    maximumHerd: CATTLE_MAX_HERD,
    slaughterFoodPerHead: CATTLE_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  },
  sheep: {
    minimumReserve: SHEEP_MINIMUM_BREEDING_RESERVE,
    defaultReserve: SHEEP_DEFAULT_BREEDING_RESERVE,
    maximumHerd: SHEEP_MAX_HERD,
    slaughterFoodPerHead: SHEEP_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  },
  swine: {
    minimumReserve: SWINE_MINIMUM_BREEDING_RESERVE,
    defaultReserve: SWINE_DEFAULT_BREEDING_RESERVE,
    maximumHerd: SWINE_MAX_HERD,
    slaughterFoodPerHead: SWINE_SLAUGHTER_FOOD_PER_HEAD,
    slaughterPreservedFoodPerHead: SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  },
};

export function livestockPolicyDefinition(species: LivestockSpecies): LivestockPolicyDefinition {
  return POLICY_BY_SPECIES[species];
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
