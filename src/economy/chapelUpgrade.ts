import {
  CHAPEL_COFFER_CAPACITY,
  CHAPEL_TIER1_COFFER_CAPACITY,
  CHAPEL_TIER1_TITHE_MULTIPLIER,
  CHAPEL_TIER2_TITHE_MULTIPLIER,
  CHAPEL_TIER2_UPGRADE_IRONWORK,
  CHAPEL_TIER2_UPGRADE_ROOF_TILES,
  CHAPEL_TIER2_UPGRADE_DRESSED_STONE,
  CHAPEL_TIER2_UPGRADE_STONE,
  CHAPEL_TIER2_UPGRADE_TIMBER,
  CHAPEL_TIER3_COFFER_CAPACITY,
  CHAPEL_TIER3_TITHE_MULTIPLIER,
  CHAPEL_TIER3_UPGRADE_IRONWORK,
  CHAPEL_TIER3_UPGRADE_ROOF_TILES,
  CHAPEL_TIER3_UPGRADE_DRESSED_STONE,
  CHAPEL_TIER3_UPGRADE_STONE,
  CHAPEL_TIER3_UPGRADE_TIMBER,
  CHAPEL_TIER4_COFFER_CAPACITY,
  CHAPEL_TIER4_TITHE_MULTIPLIER,
  CHAPEL_TIER4_UPGRADE_TIMBER,
  CHAPEL_TIER4_UPGRADE_STONE,
  CHAPEL_TIER4_UPGRADE_IRONWORK,
  CHAPEL_TIER4_UPGRADE_ROOF_TILES,
  CHAPEL_TIER4_UPGRADE_DRESSED_STONE,
  CHAPEL_TIER2_UPKEEP_MULTIPLIER,
  CHAPEL_TIER3_UPKEEP_MULTIPLIER,
  CHAPEL_TIER4_UPKEEP_MULTIPLIER,
} from '../generated/gameBalance.ts';

export type ChapelTier = 1 | 2 | 3 | 4;

export type ChapelUpgradeCost = {
  targetTier: ChapelTier;
  timber: number;
  stone: number;
  ironwork: number;
  roofTiles: number;
  dressedStone: number;
};

export type ChapelTierDefinition = {
  tier: ChapelTier;
  label: string;
  material: string;
  cofferCapacity: number;
  titheMultiplier: number;
};

export function normalizeChapelTier(value: number | undefined): ChapelTier {
  return Math.max(1, Math.min(4, Math.trunc(Number.isFinite(value) ? value! : 1))) as ChapelTier;
}

export function chapelTierDefinition(value: number | undefined): ChapelTierDefinition {
  const tier = normalizeChapelTier(value);
  if (tier === 4) return {
    tier, label: 'Cathedral',
    material: 'Twin bell towers, high nave, side aisles, and bishop’s choir',
    cofferCapacity: CHAPEL_TIER4_COFFER_CAPACITY,
    titheMultiplier: CHAPEL_TIER4_TITHE_MULTIPLIER,
  };
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
      dressedStone: CHAPEL_TIER2_UPGRADE_DRESSED_STONE,
    };
  }
  if (tier === 2) {
    return {
      targetTier: 3,
      timber: CHAPEL_TIER3_UPGRADE_TIMBER,
      stone: CHAPEL_TIER3_UPGRADE_STONE,
      ironwork: CHAPEL_TIER3_UPGRADE_IRONWORK,
      roofTiles: CHAPEL_TIER3_UPGRADE_ROOF_TILES,
      dressedStone: CHAPEL_TIER3_UPGRADE_DRESSED_STONE,
    };
  }
  if (tier === 3) return {
    targetTier: 4,
    timber: CHAPEL_TIER4_UPGRADE_TIMBER, stone: CHAPEL_TIER4_UPGRADE_STONE,
    ironwork: CHAPEL_TIER4_UPGRADE_IRONWORK, roofTiles: CHAPEL_TIER4_UPGRADE_ROOF_TILES,
    dressedStone: CHAPEL_TIER4_UPGRADE_DRESSED_STONE,
  };
  return null;
}

export function chapelCofferCapacityForTier(value: number | undefined): number {
  return chapelTierDefinition(value).cofferCapacity;
}

export function chapelTitheMultiplier(value: number | undefined): number {
  return chapelTierDefinition(value).titheMultiplier;
}

export function chapelUpkeepMultiplier(value: number | undefined): number {
  return [1, CHAPEL_TIER2_UPKEEP_MULTIPLIER, CHAPEL_TIER3_UPKEEP_MULTIPLIER,
    CHAPEL_TIER4_UPKEEP_MULTIPLIER][normalizeChapelTier(value) - 1]!;
}
