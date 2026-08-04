import {
  CHAPEL_COFFER_CAPACITY,
  CHAPEL_TIER1_COFFER_CAPACITY,
  CHAPEL_TIER1_TITHE_MULTIPLIER,
  CHAPEL_TIER2_TITHE_MULTIPLIER,
  CHAPEL_TIER2_UPGRADE_IRONWORK,
  CHAPEL_TIER2_UPGRADE_ROOF_TILES,
  CHAPEL_TIER2_UPGRADE_STONE,
  CHAPEL_TIER2_UPGRADE_TIMBER,
  CHAPEL_TIER3_COFFER_CAPACITY,
  CHAPEL_TIER3_TITHE_MULTIPLIER,
  CHAPEL_TIER3_UPGRADE_IRONWORK,
  CHAPEL_TIER3_UPGRADE_ROOF_TILES,
  CHAPEL_TIER3_UPGRADE_STONE,
  CHAPEL_TIER3_UPGRADE_TIMBER,
} from '../generated/gameBalance.ts';

export type ChapelTier = 1 | 2 | 3;

export type ChapelUpgradeCost = {
  targetTier: ChapelTier;
  timber: number;
  stone: number;
  ironwork: number;
  roofTiles: number;
};

export type ChapelTierDefinition = {
  tier: ChapelTier;
  label: string;
  material: string;
  cofferCapacity: number;
  titheMultiplier: number;
};

export function normalizeChapelTier(value: number | undefined): ChapelTier {
  if (value === 1 || value === 2) return value;
  return 3;
}

export function chapelTierDefinition(value: number | undefined): ChapelTierDefinition {
  const tier = normalizeChapelTier(value);
  if (tier === 1) {
    return {
      tier,
      label: 'Small wooden church',
      material: 'Timber nave and shingle roof',
      cofferCapacity: CHAPEL_TIER1_COFFER_CAPACITY,
      titheMultiplier: CHAPEL_TIER1_TITHE_MULTIPLIER,
    };
  }
  if (tier === 2) {
    return {
      tier,
      label: 'Small stone church',
      material: 'Stone nave and tiled roof',
      cofferCapacity: CHAPEL_COFFER_CAPACITY,
      titheMultiplier: CHAPEL_TIER2_TITHE_MULTIPLIER,
    };
  }
  return {
    tier,
    label: 'Large stone church',
    material: 'Enlarged stone nave, buttresses, and belfry',
    cofferCapacity: CHAPEL_TIER3_COFFER_CAPACITY,
    titheMultiplier: CHAPEL_TIER3_TITHE_MULTIPLIER,
  };
}

export function chapelUpgradeCost(value: number | undefined): ChapelUpgradeCost | null {
  const tier = normalizeChapelTier(value);
  if (tier === 1) {
    return {
      targetTier: 2,
      timber: CHAPEL_TIER2_UPGRADE_TIMBER,
      stone: CHAPEL_TIER2_UPGRADE_STONE,
      ironwork: CHAPEL_TIER2_UPGRADE_IRONWORK,
      roofTiles: CHAPEL_TIER2_UPGRADE_ROOF_TILES,
    };
  }
  if (tier === 2) {
    return {
      targetTier: 3,
      timber: CHAPEL_TIER3_UPGRADE_TIMBER,
      stone: CHAPEL_TIER3_UPGRADE_STONE,
      ironwork: CHAPEL_TIER3_UPGRADE_IRONWORK,
      roofTiles: CHAPEL_TIER3_UPGRADE_ROOF_TILES,
    };
  }
  return null;
}

export function chapelCofferCapacityForTier(value: number | undefined): number {
  return chapelTierDefinition(value).cofferCapacity;
}

export function chapelTitheMultiplier(value: number | undefined): number {
  return chapelTierDefinition(value).titheMultiplier;
}
