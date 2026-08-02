import type { ForestManager, ForestTreeLayout } from '../props/ForestManager.ts';
import type { TreeLayoutEntry } from './types.ts';
import { treeWoodYield } from './treeYield.ts';

const TREE_CELL_SIZE = 48;

export class TreeRegistry {
  readonly entries: readonly TreeLayoutEntry[];
  readonly entryById: ReadonlyMap<string, TreeLayoutEntry>;
  readonly entryByLayoutIndex: ReadonlyMap<number, TreeLayoutEntry>;
  private readonly spatialBuckets: Map<number, Map<number, TreeLayoutEntry[]>>;

  private constructor(entries: TreeLayoutEntry[]) {
    this.entries = entries;
    this.entryById = new Map(entries.map((entry) => [entry.id, entry]));
    this.entryByLayoutIndex = new Map(entries.map((entry) => [entry.layoutIndex, entry]));
    this.spatialBuckets = buildTreeSpatialBuckets(entries);
  }

  static fromForestManager(forestManager: ForestManager): TreeRegistry {
    const layouts = forestManager.getTreeLayouts();
    const entries = layouts.map((layout) => toTreeLayoutEntry(layout));
    return new TreeRegistry(entries);
  }

  getEntry(treeId: string): TreeLayoutEntry | undefined {
    return this.entryById.get(treeId);
  }

  treesInRadius(x: number, z: number, radius: number): TreeLayoutEntry[] {
    return this.treesInRadiusInto(x, z, radius, []);
  }

  treesInRadiusInto(
    x: number,
    z: number,
    radius: number,
    results: TreeLayoutEntry[],
  ): TreeLayoutEntry[] {
    results.length = 0;
    const radiusSq = radius * radius;
    const cellRadius = Math.ceil(radius / TREE_CELL_SIZE);

    const originCellX = Math.floor(x / TREE_CELL_SIZE);
    const originCellZ = Math.floor(z / TREE_CELL_SIZE);

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const bucket = this.spatialBuckets
          .get(originCellX + dx)
          ?.get(originCellZ + dz);
        if (!bucket) continue;
        for (const entry of bucket) {
          const distSq = (entry.x - x) ** 2 + (entry.z - z) ** 2;
          if (distSq > radiusSq) continue;
          results.push(entry);
        }
      }
    }

    return results;
  }

  countTreesInRadius(
    x: number,
    z: number,
    radius: number,
    phaseFilter: (phase: string) => boolean,
    getPhase: (treeId: string) => string | undefined,
  ): number {
    let count = 0;
    for (const entry of this.treesInRadius(x, z, radius)) {
      const phase = getPhase(entry.id);
      if (phase && phaseFilter(phase)) count++;
    }
    return count;
  }
}

function toTreeLayoutEntry(layout: ForestTreeLayout): TreeLayoutEntry {
  return {
    id: `tree-${layout.layoutIndex}`,
    layoutIndex: layout.layoutIndex,
    x: layout.x,
    z: layout.z,
    woodYield: treeWoodYield({ form: layout.form, species: layout.species, scale: layout.scale }),
    form: layout.form,
    species: layout.species,
    scale: layout.scale,
  };
}

function buildTreeSpatialBuckets(
  entries: TreeLayoutEntry[],
): Map<number, Map<number, TreeLayoutEntry[]>> {
  const buckets = new Map<number, Map<number, TreeLayoutEntry[]>>();
  for (const entry of entries) {
    const cellX = Math.floor(entry.x / TREE_CELL_SIZE);
    const cellZ = Math.floor(entry.z / TREE_CELL_SIZE);
    let row = buckets.get(cellX);
    if (!row) {
      row = new Map();
      buckets.set(cellX, row);
    }
    const bucket = row.get(cellZ);
    if (bucket) bucket.push(entry);
    else row.set(cellZ, [entry]);
  }
  return buckets;
}
