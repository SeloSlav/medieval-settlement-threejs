/** The one persistent-world ruleset. Keep in sync with server/src/realm_policy.rs. */
export const REALM = Object.freeze({
  version: 1, seed: 0x47471e50, size: 12_288, maxPlayers: 50, reservedOutposts: 17,
  realSecondsPerDay: 300, simulationRealtimeRate: 0.4,
  regionColumns: 9, regionSpacing: 1_280, townRadius: 384,
  chunkSize: 256, fogCellSize: 32, unitSight: 96, campSight: 160,
  frameBudgetMs: 1000 / 60, streamBudgetMs: 2, maxResidentChunks: 81, maxCachedChunks: 128,
});
export const REALM_CHUNKS_PER_SIDE = REALM.size / REALM.chunkSize;
export const REALM_FOG_CELLS_PER_SIDE = REALM.size / REALM.fogCellSize;
export function worldChunk(x: number, z: number): number | null {
  const half = REALM.size / 2;
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || x < -half || z < -half || x >= half || z >= half) return null;
  return Math.floor((z + half) / REALM.chunkSize) * REALM_CHUNKS_PER_SIDE
    + Math.floor((x + half) / REALM.chunkSize);
}
export function chunkBounds(id: number) {
  if (!Number.isInteger(id) || id < 0 || id >= REALM_CHUNKS_PER_SIDE ** 2) throw new RangeError('Invalid realm chunk');
  const minX = (id % REALM_CHUNKS_PER_SIDE) * REALM.chunkSize - REALM.size / 2;
  const minZ = Math.floor(id / REALM_CHUNKS_PER_SIDE) * REALM.chunkSize - REALM.size / 2;
  return { minX, minZ, maxX: minX + REALM.chunkSize, maxZ: minZ + REALM.chunkSize };
}
/** Entire mature-town footprints fit, with contested land between them. */
export function realmRegionCenter(slot: number): { x: number; z: number } {
  if (!Number.isInteger(slot) || slot < 0 || slot >= REALM.regionColumns ** 2) throw new RangeError('Invalid realm region');
  const origin = (REALM.regionColumns - 1) / 2;
  return { x: ((slot % REALM.regionColumns) - origin) * REALM.regionSpacing,
    z: (Math.floor(slot / REALM.regionColumns) - origin) * REALM.regionSpacing };
}
