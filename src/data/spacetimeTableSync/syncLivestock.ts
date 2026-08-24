import type { LivestockHerd, Pasture } from '../../generated/types.ts';
import { buildingClientId, pastureClientId } from '../spacetimeIds.ts';
import type {
  LivestockHerdState,
  LivestockSpecies,
  PastureState,
} from '../../resources/types.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

const SPECIES: readonly LivestockSpecies[] = ['cattle', 'sheep', 'swine'];

export function syncPastures(
  rows: Iterable<Pasture>,
  identityHex: string | null,
): Map<string, PastureState> {
  const pastures = new Map<string, PastureState>();
  if (!identityHex) return pastures;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = pastureClientId(row.id);
    pastures.set(id, {
      id,
      farmsteadId: buildingClientId(row.farmsteadId),
      corners: [
        { x: row.cornerAx, z: row.cornerAz },
        { x: row.cornerBx, z: row.cornerBz },
        { x: row.cornerCx, z: row.cornerCz },
        { x: row.cornerDx, z: row.cornerDz },
      ],
      area: row.area,
      averageSlopeDegrees: row.averageSlopeDegrees,
      moisture: row.moisture,
    });
  }
  return pastures;
}

export function syncLivestockHerds(
  rows: Iterable<LivestockHerd>,
  identityHex: string | null,
): Map<string, LivestockHerdState> {
  const herds = new Map<string, LivestockHerdState>();
  if (!identityHex) return herds;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const buildingId = buildingClientId(row.buildingId);
    herds.set(buildingId, {
      buildingId,
      species: SPECIES[row.species] ?? 'cattle',
      headCount: wholeResourceUnits(row.headCount),
      health: row.health,
      breedingProgress: row.breedingProgress,
      pastureCapacity: row.pastureCapacity,
      suppliedCapacity: row.suppliedCapacity,
      lastFoodOutput: wholeResourceUnits(row.lastFoodOutput),
      lastPreservedOutput: wholeResourceUnits(row.lastPreservedOutput),
      lastWoolGold: wholeResourceUnits(row.lastWoolGold),
      lastWoolOutput: wholeResourceUnits(row.lastWoolOutput),
      lastShearingYear: Number(row.lastShearingYear),
      breedingReserve: wholeResourceUnits(row.breedingReserve),
      lastCulled: wholeResourceUnits(row.lastCulled),
      hayStock: wholeResourceUnits(row.hayStock),
      lastHayOutput: wholeResourceUnits(row.lastHayOutput),
      haymakingPercent: Number(row.haymakingPercent),
    });
  }
  return herds;
}
