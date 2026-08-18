import type { FireIncident } from '../../generated/types.ts';
import {
  fireSourceFromId,
  fireStatusFromId,
  fireTargetKindFromId,
  type FireIncidentState,
} from '../../fires/fireIncident.ts';
import {
  buildingClientId,
  fireIncidentClientId,
  residenceClientId,
} from '../spacetimeIds.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

export function syncFireIncidents(
  rows: Iterable<FireIncident>,
  identityHex: string | null,
  simTick = Number.MAX_SAFE_INTEGER,
): Map<string, FireIncidentState> {
  const incidents = new Map<string, FireIncidentState>();
  if (!identityHex) return incidents;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const discoveredTick = Number(row.discoveredTick ?? 0);
    if (discoveredTick > 0 && discoveredTick > simTick) continue;
    const targetKind = fireTargetKindFromId(Number(row.targetKind));
    const status = fireStatusFromId(Number(row.state));
    const ignitionSource = fireSourceFromId(Number(row.ignitionSource));
    if (!targetKind || !status || !ignitionSource) continue;

    const id = fireIncidentClientId(row.id);
    incidents.set(id, {
      id,
      targetKind,
      targetId: targetKind === 'building'
        ? buildingClientId(row.targetId)
        : residenceClientId(row.targetId),
      x: row.x,
      z: row.z,
      ignitionSource,
      status,
      intensity: row.intensity,
      damage: row.damage,
      waterDelivered: wholeResourceUnits(row.waterDelivered),
      requiredWater: wholeResourceUnits(row.requiredWater),
      extinguishChance: row.extinguishChance,
      startedTick: Number(row.startedTick),
      discoveredTick,
      lastWaterTick: Number(row.lastWaterTick),
      resolvedTick: Number(row.resolvedTick),
      responseWellId: row.responseWellId > 0n
        ? buildingClientId(row.responseWellId)
        : null,
    });
  }
  return incidents;
}
