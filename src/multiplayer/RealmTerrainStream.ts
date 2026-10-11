import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { ChunkStream } from './ChunkStream.ts';
import { REALM, REALM_CHUNKS_PER_SIDE, chunkBounds, worldChunk } from './realmPolicy.ts';

type SourceAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type AttributeState = { input: SourceAttribute; version: number; revisions: Uint32Array; offset: number };
type Tile = {
  mesh: THREE.Mesh; layout: string; revisions: Map<string, number>;
  samples: Uint32Array; weights: Float32Array; buffer: THREE.InterleavedBuffer;
  dispose(): void;
};
const CELLS = 16, SIDE = CELLS + 1, COUNT = SIDE * SIDE;
const TOTAL_CHUNKS = REALM_CHUNKS_PER_SIDE ** 2;

/** Retains the authoritative heightfield and a bounded cache of reusable draw buffers. */
export class RealmTerrainStream {
  readonly group = new THREE.Group();
  readonly stream: ChunkStream<Tile>;
  private readonly terrain: Terrain;
  private readonly attached = new Map<number, Tile>();
  private readonly attributes = new Map<string, AttributeState>();
  private layout = '';
  private stride = 0;
  private revision = 0;
  private allocations = 0;
  private refreshes = 0;
  private center: number | null = null;
  private paused = false;
  get stats() { return { allocations: this.allocations, refreshes: this.refreshes }; }

  constructor(terrain: Terrain, scene: THREE.Scene) {
    this.terrain = terrain;
    this.group.name = 'Streamed realm terrain';
    scene.add(this.group);
    terrain.mesh.visible = false;
    this.synchronizeSource();
    this.stream = new ChunkStream({ capacity: REALM.maxResidentChunks, cacheCapacity: REALM.maxCachedChunks, concurrency: 2,
      load: async id => this.createTile(id),
      attach: (id, tile) => {
        this.synchronizeSource(); this.refreshTile(id, tile);
        this.attached.set(id, tile); this.group.add(tile.mesh); tile.mesh.updateMatrixWorld(true);
      },
      detach: (id, tile) => { this.attached.delete(id); this.group.remove(tile.mesh); },
      onError: (id, error) => console.error(`[Realm terrain ${id}]`, error),
    });
  }
  update(x: number, z: number, paperMap: boolean): void {
    const center = worldChunk(x, z);
    if (center !== this.center || paperMap !== this.paused) {
      this.center = center; this.paused = paperMap;
      const ids: number[] = [];
      if (!paperMap && center !== null) {
        const cx = center % REALM_CHUNKS_PER_SIDE, cz = Math.floor(center / REALM_CHUNKS_PER_SIDE);
        for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
          if (cx + dx < 0 || cx + dx >= REALM_CHUNKS_PER_SIDE || cz + dz < 0 || cz + dz >= REALM_CHUNKS_PER_SIDE) continue;
          ids.push((cz + dz) * REALM_CHUNKS_PER_SIDE + cx + dx);
        }
        ids.sort((a, b) => this.distance(a, x, z) - this.distance(b, x, z));
      }
      this.stream.setInterest(ids);
    }
    const start = performance.now();
    this.synchronizeSource();
    for (const [id, tile] of this.attached) {
      if (performance.now() - start >= REALM.streamBudgetMs) break;
      this.refreshTile(id, tile);
    }
    this.stream.pump(Math.max(0, REALM.streamBudgetMs - (performance.now() - start)));
  }
  dispose(): void { this.stream.dispose(); this.group.removeFromParent(); this.terrain.mesh.visible = true; }

  private synchronizeSource(): void {
    const entries = Object.entries(this.terrain.mesh.geometry.attributes);
    const layout = entries.map(([name, a]) => `${name}:${a.itemSize}`).join('|');
    const changedLayout = layout !== this.layout;
    if (changedLayout) { this.attributes.clear(); this.layout = layout; }
    let offset = 0;
    for (const [name, input] of entries) {
      const buffer = input instanceof THREE.InterleavedBufferAttribute ? input.data : input;
      const version = buffer.version;
      let state = this.attributes.get(name);
      if (!state) {
        state = { input, version, revisions: new Uint32Array(TOTAL_CHUNKS), offset };
        state.revisions.fill(++this.revision); this.attributes.set(name, state);
      } else if (state.input !== input || state.version !== version) {
        const revision = ++this.revision;
        // Ranges describe only the latest mutation. Missing versions or replacement
        // attributes require a complete invalidation, including cached tiles.
        if (state.input !== input || version !== state.version + 1 || !buffer.updateRanges.length) {
          state.revisions.fill(revision);
        } else {
          for (const range of buffer.updateRanges) this.invalidateRange(state, range.start, range.count, revision);
        }
        state.input = input; state.version = version;
      }
      state.offset = offset; offset += input.itemSize;
    }
    this.stride = offset;
  }
  private invalidateRange(state: AttributeState, start: number, count: number, revision: number): void {
    if (count <= 0) return;
    const input = state.input;
    const stride = input instanceof THREE.InterleavedBufferAttribute ? input.data.stride : input.itemSize;
    const resolution = this.terrain.resolution;
    const first = Math.max(0, Math.floor(start / stride));
    const last = Math.min(resolution ** 2 - 1, Math.floor((start + count - 1) / stride));
    const minRow = Math.floor(first / resolution), maxRow = Math.floor(last / resolution);
    // A range spanning rows includes every intervening column. Include one
    // vertex of interpolation support on every side, including chunk seams.
    const minColumn = minRow === maxRow ? first % resolution : 0;
    const maxColumn = minRow === maxRow ? last % resolution : resolution - 1;
    const chunkCells = (resolution - 1) / REALM_CHUNKS_PER_SIDE;
    const minX = Math.max(0, Math.floor((minColumn - 1) / chunkCells));
    const maxX = Math.min(REALM_CHUNKS_PER_SIDE - 1, Math.floor((maxColumn + 1) / chunkCells));
    const minZ = Math.max(0, Math.floor((minRow - 1) / chunkCells));
    const maxZ = Math.min(REALM_CHUNKS_PER_SIDE - 1, Math.floor((maxRow + 1) / chunkCells));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      state.revisions[z * REALM_CHUNKS_PER_SIDE + x] = revision;
    }
  }
  private distance(id: number, x: number, z: number): number {
    const b = chunkBounds(id); return (b.minX + REALM.chunkSize / 2 - x) ** 2 + (b.minZ + REALM.chunkSize / 2 - z) ** 2;
  }
  private createTile(id: number): Tile {
    this.synchronizeSource();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.terrain.mesh.material);
    mesh.name = `Realm terrain chunk ${id}`; mesh.receiveShadow = true; mesh.userData.terrain = true;
    const samples = new Uint32Array(COUNT * 4), weights = new Float32Array(COUNT * 4);
    const b = chunkBounds(id), resolution = this.terrain.resolution;
    for (let z = 0; z < SIDE; z++) for (let x = 0; x < SIDE; x++) {
      const sx = (b.minX + x * REALM.chunkSize / CELLS + REALM.size / 2) / REALM.size * (resolution - 1);
      const sz = (b.minZ + z * REALM.chunkSize / CELLS + REALM.size / 2) / REALM.size * (resolution - 1);
      const ix = Math.min(resolution - 2, Math.floor(sx)), iz = Math.min(resolution - 2, Math.floor(sz));
      const fx = sx - ix, fz = sz - iz, v = (z * SIDE + x) * 4, a = iz * resolution + ix;
      samples.set([a, a + 1, a + resolution, a + resolution + 1], v);
      weights.set([(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz], v);
    }
    const tile = { mesh, layout: '', revisions: new Map<string, number>(), samples, weights,
      buffer: new THREE.InterleavedBuffer(new Float32Array(0), 1), dispose: () => mesh.geometry.dispose() };
    this.refreshTile(id, tile);
    return tile;
  }
  private refreshTile(id: number, tile: Tile): void {
    const newLayout = tile.layout !== this.layout;
    if (newLayout) {
      const geometry = new THREE.BufferGeometry();
      tile.buffer = new THREE.InterleavedBuffer(new Float32Array(COUNT * this.stride), this.stride);
      for (const [name, state] of this.attributes) {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(tile.buffer, state.input.itemSize, state.offset));
      }
      const indices: number[] = [];
      for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
        const a = z * SIDE + x, d = a + SIDE;
        indices.push(a, d, a + 1, a + 1, d, d + 1);
      }
      geometry.setIndex(indices);
      tile.mesh.geometry.dispose(); tile.mesh.geometry = geometry;
      tile.layout = this.layout; tile.revisions.clear(); this.allocations++;
    }
    let changed = false, boundsChanged = newLayout;
    const packed = tile.buffer.array, { samples, weights } = tile;
    for (const [name, state] of this.attributes) {
      const revision = state.revisions[id];
      if (tile.revisions.get(name) === revision) continue;
      const input = state.input;
      for (let i = 0; i < COUNT; i++) {
        const s = i * 4, target = i * this.stride + state.offset;
        for (let c = 0; c < input.itemSize; c++) {
          packed[target + c] = input.getComponent(samples[s], c) * weights[s]
            + input.getComponent(samples[s + 1], c) * weights[s + 1]
            + input.getComponent(samples[s + 2], c) * weights[s + 2]
            + input.getComponent(samples[s + 3], c) * weights[s + 3];
        }
      }
      tile.revisions.set(name, revision); changed = true;
      if (name === 'position') boundsChanged = true;
    }
    if (changed) { tile.buffer.needsUpdate = true; this.refreshes++; }
    if (boundsChanged) { tile.mesh.geometry.computeBoundingBox(); tile.mesh.geometry.computeBoundingSphere(); }
    tile.mesh.material = this.terrain.mesh.material;
  }
}
