import type { WorldConfig } from '../../generated/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';

export function syncWorldConfig(rows: Iterable<WorldConfig>, state: GameTableSyncState): void {
  const worldRows = [...rows];
  if (worldRows.length > 0) {
    state.simTick = Number(worldRows[0].simTick);
  }
}
