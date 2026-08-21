import type { VineyardParcel } from '../../generated/types.ts';
import type { VineyardParcelState } from '../../resources/types.ts';
import { buildingClientId, vineyardClientId } from '../spacetimeIds.ts';

export function syncVineyardParcels(
  rows: Iterable<VineyardParcel>,
  identityHex: string | null,
): Map<string, VineyardParcelState> {
  const vineyards = new Map<string, VineyardParcelState>();
  if (!identityHex) return vineyards;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = vineyardClientId(row.id);
    const monasteryId = buildingClientId(row.buildingId);
    vineyards.set(id, {
      id,
      monasteryId,
      corners: [
        { x: row.cornerAx, z: row.cornerAz },
        { x: row.cornerBx, z: row.cornerBz },
        { x: row.cornerCx, z: row.cornerCz },
        { x: row.cornerDx, z: row.cornerDz },
      ],
      area: row.area,
      averageSlopeDegrees: row.averageSlopeDegrees,
      moisture: row.moisture,
      southExposure: row.southExposure,
      siteSuitability: row.siteSuitability,
      shapeEfficiency: row.shapeEfficiency,
    });
  }
  return vineyards;
}
