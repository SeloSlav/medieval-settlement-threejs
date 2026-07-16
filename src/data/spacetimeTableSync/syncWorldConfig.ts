import type { WorldConfig } from '../../generated/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { worldConfigRowToGeneration } from '../../world/worldConfigAuthority.ts';
import { applyAuthoritativeWorldGeneration } from '../../world/worldGenerationContext.ts';

export function syncWorldConfig(rows: Iterable<WorldConfig>, state: GameTableSyncState): void {
  const worldRows = [...rows];
  if (worldRows.length === 0) {
    state.worldGeneration = null;
    return;
  }
  const row = worldRows[0];
  state.simTick = Number(row.simTick);
  const nextGeneration = worldConfigRowToGeneration(row);
  if (!sameGeneration(state.worldGeneration, nextGeneration)) {
    state.worldGeneration = nextGeneration;
    if (nextGeneration.configured) {
      applyAuthoritativeWorldGeneration(nextGeneration);
    }
  }
}

function sameGeneration(
  current: GameTableSyncState['worldGeneration'],
  next: NonNullable<GameTableSyncState['worldGeneration']>,
): boolean {
  return current?.seed === next.seed
    && current.mapSize === next.mapSize
    && current.topography === next.topography
    && current.hydrology === next.hydrology
    && current.forestDensity === next.forestDensity
    && current.configured === next.configured;
}
