import type { RockObstacle } from './pathGeometry.ts';

const CELL_SIZE = 18;

export class RockSpatialIndex {
  private readonly cells = new Map<number, RockObstacle[]>();

  constructor(rocks: readonly RockObstacle[]) {
    for (const rock of rocks) {
      const key = cellKey(rock.x, rock.z);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(rock);
      else this.cells.set(key, [rock]);
    }
  }

  rocksInRadius(x: number, z: number, radius: number): RockObstacle[] {
    return this.rocksInRadiusInto(x, z, radius, []);
  }

  rocksInRadiusInto(
    x: number,
    z: number,
    radius: number,
    results: RockObstacle[],
  ): RockObstacle[] {
    results.length = 0;
    const radiusSq = radius * radius;
    const minCellX = Math.floor((x - radius) / CELL_SIZE);
    const maxCellX = Math.floor((x + radius) / CELL_SIZE);
    const minCellZ = Math.floor((z - radius) / CELL_SIZE);
    const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.cells.get(packCell(cellX, cellZ));
        if (!bucket) continue;
        for (const rock of bucket) {
          const reach = radius + (rock.collisionRadius ?? rock.scale * 1.35);
          if (
            (rock.x - x) ** 2 + (rock.z - z) ** 2
            <= Math.max(radiusSq, reach * reach)
          ) {
            results.push(rock);
          }
        }
      }
    }
    return results;
  }
}

function cellKey(x: number, z: number): number {
  return packCell(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
}

function packCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
