import type { ActiveRaid } from '../generated/types.ts';

export type ActiveRaidState = {
  raidId: string;
  startedTick: number;
  enemyPressure: number;
  initialRaiders: number;
  initialGuards: number;
  goodsLost: number;
  wealthLost: number;
  arsonStarted: boolean;
  raidersDowned: number;
  routStarted: boolean;
};

/**
 * Replicates the owner's authoritative live-incursion marker. Combat agents
 * remain the physical actors; this row is only the shared mobilization and
 * all-clear state accumulated from their actual actions.
 */
export function syncActiveRaid(
  rows: Iterable<ActiveRaid>,
  identityHex: string | null,
): ActiveRaidState | null {
  if (!identityHex) return null;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    return {
      raidId: row.raidId.toString(),
      startedTick: Number(row.startedTick),
      enemyPressure: Number(row.enemyPressure),
      initialRaiders: Number(row.initialRaiders),
      initialGuards: Number(row.initialGuards),
      goodsLost: Math.max(0, row.goodsLost),
      wealthLost: Math.max(0, row.wealthLost),
      arsonStarted: row.arsonStarted,
      raidersDowned: Math.max(0, Number(row.raidersDowned)),
      routStarted: row.routStarted,
    };
  }
  return null;
}
