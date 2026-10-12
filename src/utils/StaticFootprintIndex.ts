export type StaticFootprintBounds = {
  minX: number; maxX: number; minZ: number; maxZ: number;
};

/** Immutable finite footprints; a point query visits only its occupied cell. */
export class StaticFootprintIndex<T> {
  private readonly cells = new Map<string, T[]>();
  private readonly all: readonly T[];
  private readonly cellSize: number;
  constructor(items: readonly T[], bounds: (item: T) => StaticFootprintBounds, cellSize = 128) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Footprint cell size must be finite and positive');
    this.all = items;
    this.cellSize = cellSize;
    for (const item of items) {
      const box = bounds(item);
      if (![box.minX, box.maxX, box.minZ, box.maxZ].every(Number.isFinite)
        || box.minX > box.maxX || box.minZ > box.maxZ) throw new Error('Invalid static footprint bounds');
      for (let z = Math.floor(box.minZ / cellSize); z <= Math.floor(box.maxZ / cellSize); z++) {
        for (let x = Math.floor(box.minX / cellSize); x <= Math.floor(box.maxX / cellSize); x++) {
          const key = `${x},${z}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(item);
          else this.cells.set(key, [item]);
        }
      }
    }
  }

  at(x: number, z: number): readonly T[] {
    // Preserve each sampler's behavior for non-finite diagnostic inputs.
    if (!Number.isFinite(x) || !Number.isFinite(z)) return this.all;
    return this.cells.get(`${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`) ?? EMPTY;
  }
}

const EMPTY: readonly never[] = [];

/** Rotation-independent bound covering every orientation of an ellipse. */
export function ellipticalFootprintBounds(
  site: { x: number; z: number; radiusX: number; radiusZ: number },
  margin: number,
  minimumRadius = 0,
): StaticFootprintBounds {
  const radius = Math.max(Math.abs(site.radiusX), Math.abs(site.radiusZ)) * margin;
  // The narrow phase remains authoritative, including fade/threshold edges.
  const extent = Math.max(radius, minimumRadius) + 1e-6;
  return { minX: site.x - extent, maxX: site.x + extent, minZ: site.z - extent, maxZ: site.z + extent };
}
