import * as THREE from 'three';
import { StaticRenderBundle } from '../scene/StaticRenderBundle.ts';
import { REALM, REALM_CHUNKS_PER_SIDE } from './realmPolicy.ts';

export type TerrainDrawTile = { mesh: THREE.Mesh; buffer: THREE.InterleavedBuffer };
type Entry = { id: number; tile: TerrainDrawTile; cell: Cell; slot: number; version: number; buffer: THREE.InterleavedBuffer | null };
type Cell = {
  key: string; mesh: THREE.Mesh; buffer: THREE.InterleavedBuffer;
  index: THREE.BufferAttribute; entries: Entry[]; capacity: number;
  vertexCount: number; indexCount: number;
};
const CHUNKS_PER_DRAW_SIDE = 4;
const MAX_SLOTS = CHUNKS_PER_DRAW_SIDE ** 2;

/** Exact resident terrain vertices share draws without extra shader bindings. */
export class SpatialTerrainDraws {
  readonly group = new StaticRenderBundle();
  private material: THREE.Mesh['material'];
  private readonly cells = new Map<string, Cell>();
  private readonly cachedCells = new Map<string, Cell>();
  private cachedSlots = 0;
  private cacheHits = 0;
  private readonly entries = new Map<number, Entry>();
  private readonly dirtyBounds = new Set<Cell>();
  private allocations = 0;
  private copies = 0;

  constructor(material: THREE.Mesh['material']) {
    this.material = material;
    this.group.name = 'Spatial terrain draws';
  }

  get stats() {
    let bytes = 0, capacityVertices = 0, triangles = 0, cachedBytes = 0;
    for (const cell of this.cells.values()) {
      bytes += cell.buffer.array.byteLength + cell.index.array.byteLength;
      capacityVertices += cell.capacity * cell.vertexCount;
      triangles += cell.entries.length * cell.indexCount / 3;
    }
    for (const cell of this.cachedCells.values()) cachedBytes += cell.buffer.array.byteLength + cell.index.array.byteLength;
    return { draws: this.cells.size, chunks: this.entries.size, bytes: bytes + cachedBytes, activeBytes: bytes,
      cachedBytes, cachedDraws: this.cachedCells.size, cachedSlots: this.cachedSlots, cacheHits: this.cacheHits,
      capacityVertices, triangles, allocations: this.allocations, copies: this.copies };
  }

  setMaterial(material: THREE.Mesh['material']): void {
    if (this.material === material) return;
    this.material = material;
    for (const cell of this.cells.values()) cell.mesh.material = material;
  }

  upsert(id: number, tile: TerrainDrawTile): void {
    const geometry = tile.mesh.geometry;
    const index = geometry.index;
    if (!index) throw new Error('Streamed terrain must be indexed');
    const schema = Object.entries(geometry.attributes).map(([name, attribute]) => {
      if (!(attribute instanceof THREE.InterleavedBufferAttribute) || attribute.data !== tile.buffer) {
        throw new Error('Terrain draw attributes must belong to their tile buffer');
      }
      return [name, attribute.itemSize, attribute.offset, attribute.normalized].join(':');
    }).join('|');
    const x = id % REALM_CHUNKS_PER_SIDE, z = Math.floor(id / REALM_CHUNKS_PER_SIDE);
    const key = [Math.floor(x / CHUNKS_PER_DRAW_SIDE), Math.floor(z / CHUNKS_PER_DRAW_SIDE),
      tile.buffer.stride, tile.buffer.count, index.count, schema].join('/');
    let entry = this.entries.get(id);
    // Layout changes can finish on different frames. Keep old/new layouts in
    // separate cells until each source tile is refreshed, preserving both.
    if (entry && entry.cell.key !== key) { this.remove(id); entry = undefined; }
    if (!entry) {
      let cell = this.cells.get(key);
      if (!cell) { cell = this.createCell(key, tile); this.cells.set(key, cell); }
      if (cell.entries.length === cell.capacity) this.grow(cell, tile);
      entry = { id, tile, cell, slot: cell.entries.length, version: -1, buffer: null };
      cell.entries.push(entry); this.entries.set(id, entry);
      this.writeIndices(entry);
      cell.mesh.geometry.setDrawRange(0, cell.entries.length * cell.indexCount);
    }
    if (entry.tile !== tile || entry.buffer !== tile.buffer || entry.version !== tile.buffer.version) {
      entry.tile = tile;
      this.writeVertices(entry);
      entry.version = tile.buffer.version;
      entry.buffer = tile.buffer;
    }
  }

  remove(id: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const cell = entry.cell, last = cell.entries.pop()!;
    if (last !== entry) {
      cell.entries[entry.slot] = last; last.slot = entry.slot;
      this.writeVertices(last); this.writeIndices(last);
    }
    if (cell.entries.length === 0) {
      this.cells.delete(cell.key); this.dirtyBounds.delete(cell);
      cell.mesh.removeFromParent(); cell.mesh.geometry.setDrawRange(0, 0);
      this.cachedCells.set(cell.key, cell); this.cachedSlots += cell.capacity;
      while (this.cachedSlots > REALM.maxCachedChunks) {
        const oldest = this.cachedCells.keys().next().value!;
        const expired = this.cachedCells.get(oldest)!;
        this.cachedCells.delete(oldest); this.cachedSlots -= expired.capacity;
        expired.mesh.geometry.dispose();
      }
      this.group.invalidateTransforms();
    } else {
      cell.mesh.geometry.setDrawRange(0, cell.entries.length * cell.indexCount);
      this.dirtyBounds.add(cell);
    }
  }

  flush(): void {
    for (const cell of this.dirtyBounds) {
      const geometry = cell.mesh.geometry;
      geometry.boundingBox ??= new THREE.Box3(); geometry.boundingBox.makeEmpty();
      for (const entry of cell.entries) {
        const source = entry.tile.mesh.geometry;
        if (!source.boundingBox) source.computeBoundingBox();
        geometry.boundingBox.union(source.boundingBox!);
      }
      geometry.boundingSphere ??= new THREE.Sphere();
      geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    }
    this.dirtyBounds.clear();
  }

  dispose(): void {
    for (const cell of this.cells.values()) cell.mesh.geometry.dispose();
    for (const cell of this.cachedCells.values()) cell.mesh.geometry.dispose();
    this.cells.clear(); this.entries.clear(); this.dirtyBounds.clear();
    this.cachedCells.clear(); this.cachedSlots = 0;
    this.group.clear(); this.group.removeFromParent();
  }

  private createCell(key: string, tile: TerrainDrawTile): Cell {
    const retained = this.cachedCells.get(key);
    if (retained) {
      this.cachedCells.delete(key); this.cachedSlots -= retained.capacity; this.cacheHits++;
      retained.mesh.material = this.material;
      this.group.add(retained.mesh); this.group.invalidateTransforms();
      return retained;
    }
    const cell = { key, mesh: new THREE.Mesh(new THREE.BufferGeometry(), this.material),
      buffer: tile.buffer, index: tile.mesh.geometry.index!, entries: [], capacity: 0,
      vertexCount: tile.buffer.count, indexCount: tile.mesh.geometry.index!.count } as Cell;
    cell.mesh.name = 'Exact terrain cell ' + key.split('/').slice(0, 2).join(',');
    cell.mesh.receiveShadow = true; cell.mesh.userData.terrain = true;
    cell.mesh.matrixAutoUpdate = false;
    this.allocate(cell, tile, 4);
    this.group.add(cell.mesh); this.group.invalidateTransforms();
    return cell;
  }

  private grow(cell: Cell, tile: TerrainDrawTile): void {
    if (cell.capacity >= MAX_SLOTS) throw new Error('A spatial terrain cell cannot contain more than 16 chunks');
    this.allocate(cell, tile, Math.min(MAX_SLOTS, cell.capacity * 2));
  }

  private allocate(cell: Cell, tile: TerrainDrawTile, capacity: number): void {
    const geometry = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(new Float32Array(capacity * cell.vertexCount * tile.buffer.stride), tile.buffer.stride);
    // Native WebGPU promotes unsigned-short index attributes to uint32 on first
    // use. Allocate that actual format directly so ownership and byte counts
    // stay stable even for cells that become visible only after a camera move.
    const index = new THREE.BufferAttribute(new Uint32Array(capacity * cell.indexCount), 1);
    if (cell.capacity) { buffer.array.set(cell.buffer.array); index.array.set(cell.index.array); }
    for (const [name, attribute] of Object.entries(tile.mesh.geometry.attributes)) {
      const source = attribute as THREE.InterleavedBufferAttribute;
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, source.itemSize, source.offset, source.normalized));
    }
    geometry.setIndex(index); geometry.setDrawRange(0, cell.entries.length * cell.indexCount);
    cell.mesh.geometry.dispose(); cell.mesh.geometry = geometry;
    cell.buffer = buffer; cell.index = index; cell.capacity = capacity;
    // A new GPU allocation must receive copied old slots as well as the next
    // tile. Later partial writes must not hide this initialization prefix.
    buffer.addUpdateRange(0, buffer.array.length); index.addUpdateRange(0, index.array.length);
    buffer.needsUpdate = true; index.needsUpdate = true;
    this.dirtyBounds.add(cell); this.allocations++;
  }

  private writeVertices(entry: Entry): void {
    const { cell, tile, slot } = entry, offset = slot * cell.vertexCount * cell.buffer.stride;
    cell.buffer.array.set(tile.buffer.array, offset);
    cell.buffer.addUpdateRange(offset, tile.buffer.array.length); cell.buffer.needsUpdate = true;
    this.dirtyBounds.add(cell); this.copies++;
  }

  private writeIndices(entry: Entry): void {
    const { cell, tile, slot } = entry, source = tile.mesh.geometry.index!;
    const offset = slot * cell.indexCount, vertex = slot * cell.vertexCount;
    for (let i = 0; i < cell.indexCount; i++) cell.index.setX(offset + i, source.getX(i) + vertex);
    cell.index.addUpdateRange(offset, cell.indexCount); cell.index.needsUpdate = true;
  }
}
