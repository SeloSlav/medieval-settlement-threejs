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
      settlementTicks: Number(row.settlementTicks ?? 0),
      needs: needsByResidence.get(residenceId) ?? createDefaultNeeds(),
      abandoned: row.abandoned,
      householdWealth: Number(row.householdWealth ?? 0),
    });
  }
  return residences;
}
