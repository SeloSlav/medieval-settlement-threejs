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
  state.worldGeneration = worldConfigRowToGeneration(row);
  if (state.worldGeneration.configured) {
    applyAuthoritativeWorldGeneration(state.worldGeneration);
  }
}
