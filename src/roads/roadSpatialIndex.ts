import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';
import type { RoadNode } from './RoadNode.ts';
import { getEdgePath } from './roadEndpoint.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

const CELL_SIZE = 24;

export type IndexedRoadEdge = {
  edgeId: string;
  path: THREE.Vector3[];
  useControlPoints: boolean;
  halfWidth: number;
  bounds: BoundsXZ;
};

type BoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type IndexedRoadNode = {
  node: RoadNode;
  surfaceRadius: number;
};

export class RoadSpatialIndex {
  private readonly edgeCells = new Map<number, IndexedRoadEdge[]>();
  private readonly nodeCells = new Map<number, IndexedRoadNode[]>();
  private readonly edgeHalfWidths = new Map<string, number>();
  private maxSurfaceRadius = 0;

  constructor(nodes: Iterable<RoadNode>, edges: Iterable<RoadEdge>) {
    for (const edge of edges) {
      this.insertEdge(edge);
    }
    for (const node of nodes) {
      this.insertNode(node);
    }
  }

  static fromNetwork(network: { getSpatialIndex(): RoadSpatialIndex }): RoadSpatialIndex {
    return network.getSpatialIndex();
  }

  isNearAnyRoad(x: number, z: number, margin: number): boolean {
    return this.nearestDistance(x, z, margin) <= margin;
  }

  isOnRoadSurface(x: number, z: number, margin: number): boolean {
    const searchRadius = this.maxSurfaceRadius + margin;
    for (const edge of this.queryEdges(x, z, searchRadius)) {
      if (edge.path.length < 2) continue;
      if (distancePointToPolylineXZ(x, z, edge.path) <= edge.halfWidth + margin) {
        return true;
      }
    }
    for (const indexed of this.queryIndexedNodes(x, z, searchRadius)) {
      if (
        indexed.surfaceRadius > 0
        && Math.hypot(x - indexed.node.position.x, z - indexed.node.position.z)
          <= indexed.surfaceRadius + margin
      ) {
        return true;
      }
    }
    return false;
  }

  nearestDistance(x: number, z: number, maxDistance = Infinity): number {
    if (this.edgeCells.size === 0 && this.nodeCells.size === 0) return Infinity;

    if (Number.isFinite(maxDistance)) {
      return this.nearestDistanceWithin(x, z, maxDistance);
    }

    let searchRadius = CELL_SIZE * 2;
    let best = Infinity;
    for (let ring = 0; ring < 8; ring++) {
      best = this.nearestDistanceWithin(x, z, searchRadius, best);
      if (best <= searchRadius * 0.85) return best;
      searchRadius *= 2;
    }
    return best;
  }

  collectSnapCandidates(x: number, z: number, maxDistance: number): {
    nodes: RoadNode[];
    edges: IndexedRoadEdge[];
  } {
    const nodeSet = new Set<RoadNode>();
    const edgeSet = new Set<IndexedRoadEdge>();

    for (const node of this.queryNodes(x, z, maxDistance)) {
      nodeSet.add(node);
    }
    for (const edge of this.queryEdges(x, z, maxDistance)) {
      edgeSet.add(edge);
    }

    return { nodes: [...nodeSet], edges: [...edgeSet] };
  }

  findNearestEdgePath(
    x: number,
    z: number,
    maxDistance = Infinity,
  ): { path: THREE.Vector3[]; distance: number } | null {
    let best: { path: THREE.Vector3[]; distance: number } | null = null;
    const searchRadius = Number.isFinite(maxDistance) ? maxDistance : CELL_SIZE * 16;

    for (const edge of this.queryEdges(x, z, searchRadius)) {
      if (edge.path.length < 2) continue;
      const distance = distancePointToPolylineXZ(x, z, edge.path);
      if (distance > maxDistance + 1e-6) continue;
      if (!best || distance < best.distance) {
        best = { path: edge.path, distance };
      }
    }

    return best;
  }

  private nearestDistanceWithin(
    x: number,
    z: number,
    radius: number,
    best = Infinity,
  ): number {
    for (const node of this.queryNodes(x, z, radius)) {
      best = Math.min(best, Math.hypot(x - node.position.x, z - node.position.z));
    }
    for (const edge of this.queryEdges(x, z, radius)) {
      if (edge.path.length < 2) continue;
      best = Math.min(best, distancePointToPolylineXZ(x, z, edge.path));
    }
    return best;
  }

  private queryNodes(x: number, z: number, radius: number): RoadNode[] {
    const results: RoadNode[] = [];
    const seen = new Set<RoadNode>();
    for (const indexed of this.queryIndexedNodes(x, z, radius)) {
      const node = indexed.node;
      if (seen.has(node)) continue;
      seen.add(node);
      results.push(node);
    }
    return results;
  }

  private queryIndexedNodes(x: number, z: number, radius: number): IndexedRoadNode[] {
    const results: IndexedRoadNode[] = [];
    const seen = new Set<IndexedRoadNode>();
    for (const key of cellKeysInRadius(x, z, radius)) {
      const bucket = this.nodeCells.get(key);
      if (!bucket) continue;
      for (const indexed of bucket) {
        if (seen.has(indexed)) continue;
        seen.add(indexed);
        if (
          Math.hypot(x - indexed.node.position.x, z - indexed.node.position.z)
          <= radius + 1e-6
        ) {
          results.push(indexed);
        }
      }
    }
    return results;
  }

  private queryEdges(x: number, z: number, radius: number): IndexedRoadEdge[] {
    const results: IndexedRoadEdge[] = [];
    const seen = new Set<IndexedRoadEdge>();
    for (const key of cellKeysInRadius(x, z, radius)) {
      const bucket = this.edgeCells.get(key);
      if (!bucket) continue;
      for (const edge of bucket) {
        if (seen.has(edge)) continue;
        seen.add(edge);
        const bounds = edge.bounds;
        if (x >= bounds.minX - radius && x <= bounds.maxX + radius
          && z >= bounds.minZ - radius && z <= bounds.maxZ + radius) {
          results.push(edge);
        }
      }
    }
    return results;
  }

  private insertNode(node: RoadNode): void {
    const key = cellKey(node.position.x, node.position.z);
    let surfaceRadius = 0;
    for (const edgeId of node.edgeIds) {
      surfaceRadius = Math.max(surfaceRadius, this.edgeHalfWidths.get(edgeId) ?? 0);
    }
    this.maxSurfaceRadius = Math.max(this.maxSurfaceRadius, surfaceRadius);
    const indexed = { node, surfaceRadius };
    const bucket = this.nodeCells.get(key);
    if (bucket) bucket.push(indexed);
    else this.nodeCells.set(key, [indexed]);
  }

  private insertEdge(edge: RoadEdge): void {
    const path = getEdgePath(edge);
    if (path.length < 2) return;

    const indexed: IndexedRoadEdge = {
      edgeId: edge.id,
      path,
      useControlPoints: path === edge.controlPoints,
      halfWidth: edge.width * 0.5,
      bounds: computePathBounds(path, 0),
    };
    this.edgeHalfWidths.set(edge.id, indexed.halfWidth);
    this.maxSurfaceRadius = Math.max(this.maxSurfaceRadius, indexed.halfWidth);
    const bounds = indexed.bounds;
    for (const key of cellKeysForBounds(bounds)) {
      const bucket = this.edgeCells.get(key);
      if (bucket) bucket.push(indexed);
      else this.edgeCells.set(key, [indexed]);
    }
  }
}

function computePathBounds(path: THREE.Vector3[], padding: number): BoundsXZ {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of path) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
  };
}

function cellKeysInRadius(x: number, z: number, radius: number): Iterable<number> {
  const minCellX = Math.floor((x - radius) / CELL_SIZE);
  const maxCellX = Math.floor((x + radius) / CELL_SIZE);
  const minCellZ = Math.floor((z - radius) / CELL_SIZE);
  const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
  const keys: number[] = [];
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      keys.push(packCell(cellX, cellZ));
    }
  }
  return keys;
}

function cellKeysForBounds(bounds: BoundsXZ): Iterable<number> {
  const minCellX = Math.floor(bounds.minX / CELL_SIZE);
  const maxCellX = Math.floor(bounds.maxX / CELL_SIZE);
  const minCellZ = Math.floor(bounds.minZ / CELL_SIZE);
  const maxCellZ = Math.floor(bounds.maxZ / CELL_SIZE);
  const keys: number[] = [];
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      keys.push(packCell(cellX, cellZ));
    }
  }
  return keys;
}

function cellKey(x: number, z: number): number {
  return packCell(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
}

function packCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
