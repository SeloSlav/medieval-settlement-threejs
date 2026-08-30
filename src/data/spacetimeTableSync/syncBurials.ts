import type { Corpse, Graveyard } from '../../generated/types.ts';
import type { CorpseState, GraveyardState } from '../../resources/types.ts';
import {
  buildingClientId,
  corpseClientId,
  graveyardClientId,
  residenceClientId,
} from '../spacetimeIds.ts';

export function syncGraveyards(
  rows: Iterable<Graveyard>,
  identityHex: string | null,
): Map<string, GraveyardState> {
  const result = new Map<string, GraveyardState>();
  if (!identityHex) return result;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = graveyardClientId(row.id);
    result.set(id, {
      id,
      chapelId: buildingClientId(row.chapelId),
      corners: [
        { x: row.cornerAx, z: row.cornerAz },
        { x: row.cornerBx, z: row.cornerBz },
        { x: row.cornerCx, z: row.cornerCz },
        { x: row.cornerDx, z: row.cornerDz },
      ],
      area: row.area,
      averageSlopeDegrees: row.averageSlopeDegrees,
      capacity: Number(row.capacity),
      burials: Number(row.burials),
    });
  }
  return result;
}

export function syncCorpses(
  rows: Iterable<Corpse>,
  identityHex: string | null,
): Map<string, CorpseState> {
  const result = new Map<string, CorpseState>();
  if (!identityHex) return result;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = corpseClientId(row.id);
    result.set(id, {
      id,
      residenceId: residenceClientId(row.residenceId),
      cause: Math.max(0, Math.min(3, Number(row.cause))) as 0 | 1 | 2 | 3,
      state: Math.max(0, Math.min(2, Number(row.state))) as 0 | 1 | 2,
      x: row.x,
      z: row.z,
      cartX: row.cartX,
      cartZ: row.cartZ,
      createdTick: Number(row.createdTick),
      chapelId: row.chapelId === 0n ? null : buildingClientId(row.chapelId),
      graveyardId: row.graveyardId === 0n ? null : graveyardClientId(row.graveyardId),
    });
  }
  return result;
}
