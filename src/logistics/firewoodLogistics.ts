import {
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';

/** One in-game day for firewood runway display (60 sim seconds). */
export const GAME_DAY_SECONDS = 60;

export function residenceFirewoodDemandPerSecond(residence: ResidenceState): number {
  if (residence.abandoned || residence.population <= 0) return 0;
  return residence.population * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC;
}

export function residenceFirewoodRunwaySeconds(residence: ResidenceState): number | null {
  const demand = residenceFirewoodDemandPerSecond(residence);
  if (demand <= 0) return null;
  return getNeedStock(residence.needs, 'firewood') / demand;
}

export function residenceFirewoodRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceFirewoodRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / GAME_DAY_SECONDS;
}

export function residenceHasFirewoodRoom(firewoodStock: number): boolean {
  return firewoodStock + 1e-6 < RESIDENCE_FIREWOOD_CAPACITY;
}

export function formatFirewoodRunwayDays(days: number): string {
  if (days >= 10) return `${Math.round(days)} days`;
  if (days >= 1) return `${days.toFixed(1)} days`;
  const runwaySeconds = days * GAME_DAY_SECONDS;
  if (runwaySeconds >= 3600) return `~${(runwaySeconds / 3600).toFixed(1)} h`;
  const minutes = runwaySeconds / 60;
  return `~${Math.max(1, Math.round(minutes))} min`;
}
