import {
  BUILDING_STORAGE_CAPS,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';

export const CIVILIAN_TOOL_SITE_KINDS = [
  'lumber_mill',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'clay_pit',
] as const satisfies readonly BuildingKind[];

export type CivilianToolSiteKind = (typeof CIVILIAN_TOOL_SITE_KINDS)[number];

export type CivilianToolPlan = {
  maintained: boolean;
  ironwork: number;
  capacity: number;
  runwayCycles: number;
  throughputMultiplier: number;
};

export function isCivilianToolSite(
  kind: BuildingKind,
): kind is CivilianToolSiteKind {
  return (CIVILIAN_TOOL_SITE_KINDS as readonly BuildingKind[]).includes(kind);
}

export function civilianToolsMaintained(ironwork: number): boolean {
  return Math.max(0, ironwork) + 1e-6 >= CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
}

export function civilianToolRunwayCycles(ironwork: number): number {
  return CIVILIAN_TOOL_IRONWORK_PER_CYCLE <= 1e-9
    ? Infinity
    : Math.max(0, ironwork) / CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
}

export function civilianToolThroughputMultiplier(ironwork: number): number {
  return civilianToolsMaintained(ironwork)
    ? CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    : 1;
}

export function civilianToolPlan(
  building: Pick<BuildingState, 'kind' | 'ironwork'>,
): CivilianToolPlan | null {
  if (!isCivilianToolSite(building.kind)) return null;
  const ironwork = Math.max(0, building.ironwork ?? 0);
  return {
    maintained: civilianToolsMaintained(ironwork),
    ironwork,
    capacity: BUILDING_STORAGE_CAPS[building.kind].ironwork ?? 0,
    runwayCycles: civilianToolRunwayCycles(ironwork),
    throughputMultiplier: civilianToolThroughputMultiplier(ironwork),
  };
}
