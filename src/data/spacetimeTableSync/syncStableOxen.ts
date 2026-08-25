import type { StableOx } from '../../generated/types.ts';
import type { StableOxState } from '../../resources/types.ts';
import { buildingClientId, stableOxClientId } from '../spacetimeIds.ts';

// Keep the sync boundary compatible with the previous generated binding while
// a newly published module adds the trailing assignment field.
export type StableOxRow = StableOx & { assignedBuildingId?: bigint };

export function syncStableOxen(
  rows: Iterable<StableOxRow>,
  identityHex: string | null,
): Map<string, StableOxState> {
  const oxen = new Map<string, StableOxState>();
  if (!identityHex) return oxen;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = stableOxClientId(row.id);
    const assignedBuildingId = row.assignedBuildingId ?? 0n;
    oxen.set(id, {
      id,
      stableId: buildingClientId(row.stableId),
      slot: Math.max(0, Number(row.slot)),
      assignedBuildingId: assignedBuildingId === 0n
        ? null
        : buildingClientId(assignedBuildingId),
    });
  }
  return oxen;
}
