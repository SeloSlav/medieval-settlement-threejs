import type { Residence, ResidenceNeed } from '../../generated/types.ts';
import { residenceClientId, zoneClientId } from '../spacetimeIds.ts';
import {
  createDefaultNeeds,
  mergeNeedRow,
  needKindFromId,
} from '../../residences/residenceNeedState.ts';
import type { ResidenceState } from '../../resources/types.ts';

function buildNeedsByResidence(rows: Iterable<ResidenceNeed>): Map<string, ResidenceState['needs']> {
  const needsByResidence = new Map<string, ResidenceState['needs']>();
  for (const row of rows) {
    const kind = needKindFromId(Number(row.needKind));
    if (!kind) continue;
    const residenceId = residenceClientId(row.residenceId);
    const needs = needsByResidence.get(residenceId) ?? createDefaultNeeds();
    needsByResidence.set(
      residenceId,
      mergeNeedRow(needs, kind, {
        stock: row.stock,
        deficitTicks: Number(row.deficitTicks),
      }),
    );
  }
  return needsByResidence;
}

export function syncResidences(
  residenceRows: Iterable<Residence>,
  needRows: Iterable<ResidenceNeed>,
  identityHex: string | null,
): Map<string, ResidenceState> {
  const residences = new Map<string, ResidenceState>();
  if (!identityHex) return residences;

  const needsByResidence = buildNeedsByResidence(needRows);
  for (const row of residenceRows) {
    if (row.owner.toHexString() !== identityHex) continue;
    // Additive server fields may be absent from an older generated binding
    // during a rolling local migration; defaults keep those saves readable.
    const upgradeRow = row as Residence & Partial<{
      upgradeTargetTier: number;
      upgradeProgress: number;
      upgradeRequiredTimber: number;
      upgradeRequiredStone: number;
      upgradeRequiredGold: number;
      upgradeDeliveredTimber: number;
      upgradeDeliveredStone: number;
      upgradeDeliveredGold: number;
      upgradeReservedTimber: number;
      upgradeReservedStone: number;
      upgradeReservedGold: number;
      upgradeAssignedLabor: number;
      upgradePriority: number;
    }>;
    const residenceId = residenceClientId(row.id);
    residences.set(residenceId, {
      id: residenceId,
      zoneId: zoneClientId(row.zoneId),
      parcelIndex: Number(row.parcelIndex),
      x: row.x,
      z: row.z,
      yaw: row.yaw,
      population: Number(row.population),
      populationCapacity: Number(row.populationCapacity ?? row.population),
      tier: Math.max(0, Math.min(3, Number(row.tier ?? 1))) as 0 | 1 | 2 | 3,
      settlementTicks: Number(row.settlementTicks ?? 0),
      needs: needsByResidence.get(residenceId) ?? createDefaultNeeds(),
      abandoned: row.abandoned,
      householdWealth: Number(row.householdWealth ?? 0),
      lastHouseholdMarketTick: Number(row.lastHouseholdMarketTick ?? 0),
      upgradeTargetTier: Math.max(
        0,
        Math.min(3, Number(upgradeRow.upgradeTargetTier ?? 0)),
      ) as 0 | 1 | 2 | 3,
      upgradeProgress: Number(upgradeRow.upgradeProgress ?? 0),
      upgradeRequiredTimber: Number(upgradeRow.upgradeRequiredTimber ?? 0),
      upgradeRequiredStone: Number(upgradeRow.upgradeRequiredStone ?? 0),
      upgradeRequiredGold: Number(upgradeRow.upgradeRequiredGold ?? 0),
      upgradeDeliveredTimber: Number(upgradeRow.upgradeDeliveredTimber ?? 0),
      upgradeDeliveredStone: Number(upgradeRow.upgradeDeliveredStone ?? 0),
      upgradeDeliveredGold: Number(upgradeRow.upgradeDeliveredGold ?? 0),
      upgradeReservedTimber: Number(upgradeRow.upgradeReservedTimber ?? 0),
      upgradeReservedStone: Number(upgradeRow.upgradeReservedStone ?? 0),
      upgradeReservedGold: Number(upgradeRow.upgradeReservedGold ?? 0),
      upgradeAssignedLabor: Number(upgradeRow.upgradeAssignedLabor ?? 0),
      upgradePriority: Number(upgradeRow.upgradePriority ?? 2),
    });
  }
  return residences;
}
