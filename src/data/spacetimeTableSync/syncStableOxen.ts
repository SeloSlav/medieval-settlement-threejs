import type { StableOx } from '../../generated/types.ts';
import type { StableOxState } from '../../resources/types.ts';
import { buildingClientId, stableOxClientId } from '../spacetimeIds.ts';

export type StableOxRow = StableOx;

export function syncStableOxen(
  rows: Iterable<StableOxRow>,
  identityHex: string | null,
): Map<string, StableOxState> {
  const oxen = new Map<string, StableOxState>();
  if (!identityHex) return oxen;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = stableOxClientId(row.id);
    oxen.set(id, {
      id,
      stableId: buildingClientId(row.stableId),
      slot: Math.max(0, Number(row.slot)),
    });
  }
  return oxen;
}
