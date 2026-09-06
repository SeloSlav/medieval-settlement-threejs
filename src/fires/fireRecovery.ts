import {
  CARPENTER_TIMBER_COST_MULTIPLIER,
  FIRE_DAMAGE_REPAIR_COST_MULTIPLIER,
  FIRE_DESTROYED_REBUILD_COST_FRACTION,
  FIRE_MINIMUM_REPAIR_COST_FRACTION,
  FIRE_RESOLVED_RETENTION_SECONDS,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  RESIDENCE_TIER4_STONE_COST,
  RESIDENCE_TIER4_TIMBER_COST,
  RESIDENCE_TILE_ROOF_TILE_COST,
  RESIDENCE_TIMBER_COST,
  SIM_TICK_SECONDS,
  type BuildingResourceCost,
} from '../generated/gameBalance.ts';
import { getBuildingCost } from '../resources/buildingEconomy.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import type { FireIncidentState } from './fireIncident.ts';

export type FireRecoveryQuote = {
  cost: BuildingResourceCost;
  fraction: number;
  carpenterSupported: boolean;
  scriptoriumRecoveryMultiplier: number;
  kind: 'repair' | 'rebuild';
};

export function fireRecoveryFraction(damage: number, destroyed: boolean): number {
  if (destroyed) return FIRE_DESTROYED_REBUILD_COST_FRACTION;
  return Math.min(
    FIRE_DESTROYED_REBUILD_COST_FRACTION,
    Math.max(
      FIRE_MINIMUM_REPAIR_COST_FRACTION,
      Math.max(0, Math.min(1, damage)) * FIRE_DAMAGE_REPAIR_COST_MULTIPLIER,
    ),
  );
}

export function fireRecoveryCost(
  base: BuildingResourceCost,
  damage: number,
  destroyed: boolean,
  carpenterSupported: boolean,
  scriptoriumRecoveryMultiplier = 1,
): BuildingResourceCost {
  const fraction = fireRecoveryFraction(damage, destroyed);
  const timberMultiplier = carpenterSupported
    ? CARPENTER_TIMBER_COST_MULTIPLIER
    : 1;
  const archiveMultiplier = Math.max(0, scriptoriumRecoveryMultiplier);
  return {
    timber: roundToTenth(base.timber * fraction * timberMultiplier * archiveMultiplier),
    stone: roundToTenth(base.stone * fraction * archiveMultiplier),
    ironwork: roundToTenth((base.ironwork ?? 0) * fraction * archiveMultiplier),
    roofTiles: roundToTenth((base.roofTiles ?? 0) * fraction * archiveMultiplier),
    dressedStone: roundToTenth((base.dressedStone ?? 0) * fraction * archiveMultiplier),
  };
}

export function buildingFireRecoveryQuote(
  building: Pick<BuildingState, 'kind'>,
  incident: Pick<FireIncidentState, 'damage' | 'status'>,
  carpenterSupported: boolean,
  scriptoriumRecoveryMultiplier = 1,
): FireRecoveryQuote {
  const destroyed = incident.status === 'destroyed';
  return {
    cost: fireRecoveryCost(
      getBuildingCost(building.kind),
      incident.damage,
      destroyed,
      carpenterSupported,
      scriptoriumRecoveryMultiplier,
    ),
    fraction: fireRecoveryFraction(incident.damage, destroyed),
    carpenterSupported,
    scriptoriumRecoveryMultiplier,
    kind: destroyed ? 'rebuild' : 'repair',
  };
}

export function residenceFireRecoveryQuote(
  residence: Pick<ResidenceState, 'tier'>,
  incident: Pick<FireIncidentState, 'damage' | 'status'>,
  carpenterSupported: boolean,
  scriptoriumRecoveryMultiplier = 1,
): FireRecoveryQuote {
  const destroyed = incident.status === 'destroyed';
  return {
    cost: fireRecoveryCost(
      residenceStructuralCost(residence.tier),
      incident.damage,
      destroyed,
      carpenterSupported,
      scriptoriumRecoveryMultiplier,
    ),
    fraction: fireRecoveryFraction(incident.damage, destroyed),
    carpenterSupported,
    scriptoriumRecoveryMultiplier,
    kind: destroyed ? 'rebuild' : 'repair',
  };
}

export function fireRecoveryCoolingSeconds(
  incident: Pick<FireIncidentState, 'status' | 'resolvedTick'>,
  currentTick: number,
): number {
  if (incident.status === 'burning') return Infinity;
  const elapsed = Math.max(0, currentTick - incident.resolvedTick) * SIM_TICK_SECONDS;
  return Math.max(0, FIRE_RESOLVED_RETENTION_SECONDS - elapsed);
}

export function residenceStructuralCost(
  tier: ResidenceState['tier'],
): BuildingResourceCost {
  let timber = RESIDENCE_TIMBER_COST;
  let stone = RESIDENCE_STONE_COST;
  if (tier >= 2) {
    timber += RESIDENCE_TIER2_TIMBER_COST;
    stone += RESIDENCE_TIER2_STONE_COST;
  }
  if (tier >= 3) {
    timber += RESIDENCE_TIER3_TIMBER_COST;
    stone += RESIDENCE_TIER3_STONE_COST;
  }
  if (tier >= 4) {
    timber += RESIDENCE_TIER4_TIMBER_COST;
    stone += RESIDENCE_TIER4_STONE_COST;
  }
  return {
    timber,
    stone,
    roofTiles: tier >= 4 ? RESIDENCE_TILE_ROOF_TILE_COST : 0,
    dressedStone: tier >= 4 ? RESIDENCE_TILE_ROOF_TILE_COST : 0,
  };
}

function roundToTenth(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}
