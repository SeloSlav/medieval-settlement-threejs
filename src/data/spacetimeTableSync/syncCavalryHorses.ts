import type { CavalryHorse } from '../../generated/types.ts';
import type { CavalryHorseState } from '../../resources/types.ts';
import { cavalryHorseClientId, pastureClientId } from '../spacetimeIds.ts';

export type CavalryHorseRow = CavalryHorse;

export function syncCavalryHorses(
  rows: Iterable<CavalryHorseRow>,
  identityHex: string | null,
): Map<string, CavalryHorseState> {
  const horses = new Map<string, CavalryHorseState>();
  if (!identityHex) return horses;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    horses.set(cavalryHorseClientId(row.id), {
      id: cavalryHorseClientId(row.id),
      pastureId: row.pastureId === 0n ? null : pastureClientId(row.pastureId),
      slot: Math.max(0, Number(row.slot)),
      atPasture: row.atPasture,
      assignedCompanyId: row.assignedCompanyId === 0n ? null : row.assignedCompanyId.toString(),
      assignedCombatAgentId: row.assignedCombatAgentId === 0n
        ? null
        : row.assignedCombatAgentId.toString(),
    });
  }
  return horses;
}
