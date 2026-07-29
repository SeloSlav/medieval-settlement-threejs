import type { WorldConfig } from '../../generated/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { worldConfigRowToGeneration } from '../../world/worldConfigAuthority.ts';
import { applyAuthoritativeWorldGeneration } from '../../world/worldGenerationContext.ts';
import { normalizeGameSpeed } from '../../world/gameSpeed.ts';

export function syncWorldConfig(rows: Iterable<WorldConfig>, state: GameTableSyncState): void {
  const worldRows = [...rows];
  if (worldRows.length === 0) {
    state.worldGeneration = null;
    state.gameSpeed = 1;
    return;
  }
  const row = worldRows[0];
  state.simTick = Number(row.simTick);
  state.gameSpeed = normalizeGameSpeed(row.gameSpeed);
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
    && current.resourceAbundance === next.resourceAbundance
    && current.resourceVariety === next.resourceVariety
    && current.conflictMode === next.conflictMode
    && current.enemyPressure === next.enemyPressure
    && current.configured === next.configured;
}
