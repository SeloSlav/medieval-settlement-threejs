import { REALM, REALM_CHUNKS_PER_SIDE, REALM_FOG_CELLS_PER_SIDE, worldChunk } from './realmPolicy.ts';
export type FogChunk = { chunk: number; explored: bigint; visible: bigint };

/** Server snapshots own sight. Explored survives reconnect; visible does not survive disconnect. */
export class FogOfWar {
  readonly pixels = new Uint8Array(REALM_FOG_CELLS_PER_SIDE ** 2);
  private chunks = new Map<number, FogChunk>();
  revision = 0;
  apply(rows: Iterable<FogChunk>): void {
    const next = new Map<number, FogChunk>();
    let changed = false;
    for (const row of rows) {
      if (!Number.isInteger(row.chunk) || row.chunk < 0 || row.chunk >= REALM_CHUNKS_PER_SIDE ** 2) continue;
      const previous = this.chunks.get(row.chunk);
      next.set(row.chunk, { ...row });
      if (previous?.visible === row.visible && previous?.explored === row.explored) continue;
      this.write(row); changed = true;
    }
    for (const chunk of this.chunks.keys()) {
      if (!next.has(chunk)) { this.write({ chunk, explored: 0n, visible: 0n }); changed = true; }
    }
    this.chunks = next;
    if (changed) this.revision++;
  }
  disconnect(): void {
    this.apply([...this.chunks.values()].map(row => ({ ...row, visible: 0n })));
  }
  stateAt(x: number, z: number): 'unexplored' | 'explored' | 'visible' {
    if (worldChunk(x, z) === null) return 'unexplored';
    const cx = Math.floor((x + REALM.size / 2) / REALM.fogCellSize);
    const cz = Math.floor((z + REALM.size / 2) / REALM.fogCellSize);
    const value = this.pixels[cz * REALM_FOG_CELLS_PER_SIDE + cx];
    return value === 255 ? 'visible' : value ? 'explored' : 'unexplored';
  }
  private write(row: FogChunk): void {
    const x = (row.chunk % REALM_CHUNKS_PER_SIDE) * 8;
    const z = Math.floor(row.chunk / REALM_CHUNKS_PER_SIDE) * 8;
    for (let bit = 0; bit < 64; bit++) {
      const mask = 1n << BigInt(bit);
      this.pixels[(z + Math.floor(bit / 8)) * REALM_FOG_CELLS_PER_SIDE + x + bit % 8]
        = row.visible & mask ? 255 : row.explored & mask ? 96 : 0;
    }
  }
}
