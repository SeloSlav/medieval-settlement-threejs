import type { SettlementSecurity } from '../../generated/types.ts';
import {
  DEFAULT_SETTLEMENT_SECURITY,
  settlementSecurityFromRow,
} from '../../security/frontierSecurity.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';

export function syncSettlementSecurity(
  rows: Iterable<SettlementSecurity>,
  state: GameTableSyncState,
): void {
  state.settlementSecurity = { ...DEFAULT_SETTLEMENT_SECURITY };
  if (!state.identityHex) return;

  for (const row of rows) {
    if (row.owner.toHexString() !== state.identityHex) continue;
    state.settlementSecurity = settlementSecurityFromRow(row);
    break;
  }
}
