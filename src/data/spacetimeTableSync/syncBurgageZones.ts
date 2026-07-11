import type { BurgageZone } from '../../generated/types.ts';
import { zoneClientId } from '../spacetimeIds.ts';
import type { BurgageFrontageEdge, BurgageZoneState } from '../../resources/types.ts';

export function syncBurgageZones(
  rows: Iterable<BurgageZone>,
  identityHex: string | null,
): Map<string, BurgageZoneState> {
  const burgageZones = new Map<string, BurgageZoneState>();
  if (!identityHex) return burgageZones;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    burgageZones.set(zoneClientId(row.id), {
      id: zoneClientId(row.id),
      cornerA: { x: row.cornerAx, z: row.cornerAz },
      cornerB: { x: row.cornerBx, z: row.cornerBz },
      cornerC: { x: row.cornerCx, z: row.cornerCz },
      cornerD: { x: row.cornerDx, z: row.cornerDz },
      frontageEdge: row.frontageEdge as BurgageFrontageEdge,
      plotCount: Number(row.plotCount),
    });
  }
  return burgageZones;
}
