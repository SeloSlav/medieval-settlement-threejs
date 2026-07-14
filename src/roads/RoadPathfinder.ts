import { BUILDING_ROAD_ACCESS_DISTANCE } from '../generated/gameBalance.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import type { RoadNetwork } from './RoadNetwork.ts';

type RoadPoint = { x: number; z: number };
type WeightedEdge = { id: string; weight: number };
type HeapEntry = { cost: number; id: string };

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function polylineLength(path: readonly RoadPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += distance(path[i].x, path[i].z, path[i + 1].x, path[i + 1].z);
  }
  return total;
}

class MinHeap {
  private readonly items: HeapEntry[] = [];

  get length(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    this.items.push(entry);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    let cursor = index;
    while (cursor > 0) {
      const parent = (cursor - 1) >> 1;
      if (this.items[parent].cost <= this.items[cursor].cost) break;
      [this.items[parent], this.items[cursor]] = [this.items[cursor], this.items[parent]];
      cursor = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.items.length;
    let cursor = index;
    while (true) {
      const left = cursor * 2 + 1;
      const right = left + 1;
      let smallest = cursor;
      if (left < length && this.items[left].cost < this.items[smallest].cost) smallest = left;
      if (right < length && this.items[right].cost < this.items[smallest].cost) smallest = right;
      if (smallest === cursor) break;
      [this.items[cursor], this.items[smallest]] = [this.items[smallest], this.items[cursor]];
      cursor = smallest;
    }
  }
}

export class RoadPathfinder {
  private readonly network: RoadNetwork;
  private weightedGraph: Map<string, WeightedEdge[]> | null = null;

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  invalidate(): void {
    this.weightedGraph = null;
  }

  roadPathRoute(
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { distance: number; polyline: RoadPoint[] } | null {
    const solve = this.shortestPathSolve(ax, az, bx, bz);
    if (!solve) return null;
    const polyline = this.materializePolyline(ax, az, bx, bz, solve.nodePath);
    const travelDistance = polylineLength(polyline);
    if (travelDistance <= 1e-6) return null;
    return { distance: travelDistance, polyline };
  }

  roadPathDistance(ax: number, az: number, bx: number, bz: number): number | null {
    return this.roadPathRoute(ax, az, bx, bz)?.distance ?? null;
  }

  private shortestPathSolve(
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { nodePath: string[] } | null {
    const nodesA = this.snapNodes(ax, az);
    const nodesB = this.snapNodes(bx, bz);
    if (!nodesA || !nodesB || !this.shareComponent(nodesA, nodesB)) return null;

    const graph = this.getWeightedGraph();
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const heap = new MinHeap();

    for (const nodeId of nodesA) {
      const node = this.network.nodes.get(nodeId);
      if (!node) continue;
      const cost = distance(ax, az, node.position.x, node.position.z);
      dist.set(nodeId, cost);
      prev.set(nodeId, null);
      heap.push({ cost, id: nodeId });
    }

    while (heap.length > 0) {
      const current = heap.pop();
      if (!current) break;
      const best = dist.get(current.id);
      if (best == null || current.cost > best + 1e-6) continue;

      for (const neighbor of graph.get(current.id) ?? []) {
        const next = current.cost + neighbor.weight;
        const existing = dist.get(neighbor.id);
        if (existing != null && next + 1e-6 >= existing) continue;
        dist.set(neighbor.id, next);
        prev.set(neighbor.id, current.id);
        heap.push({ cost: next, id: neighbor.id });
      }
    }

    let bestEnd: string | null = null;
    let bestTotal = Infinity;
    for (const nodeId of nodesB) {
      const roadCost = dist.get(nodeId);
      const node = this.network.nodes.get(nodeId);
      if (roadCost == null || !node) continue;
      const total = roadCost + distance(bx, bz, node.position.x, node.position.z);
      if (total + 1e-6 < bestTotal) {
        bestTotal = total;
        bestEnd = nodeId;
      }
    }

    if (!bestEnd || !Number.isFinite(bestTotal)) return null;

    const nodePath: string[] = [];
    let cursor: string | null = bestEnd;
    while (cursor) {
      nodePath.push(cursor);
      cursor = prev.get(cursor) ?? null;
    }
    nodePath.reverse();
    return { nodePath };
  }

  private getWeightedGraph(): Map<string, WeightedEdge[]> {
    if (this.weightedGraph) return this.weightedGraph;

    const graph = new Map<string, WeightedEdge[]>();
    for (const edge of this.network.edges.values()) {
      const weight = polylineLength(edge.sampledPath.map((point) => ({ x: point.x, z: point.z })));
      const start = graph.get(edge.startNodeId) ?? [];
      start.push({ id: edge.endNodeId, weight });
      graph.set(edge.startNodeId, start);
      const end = graph.get(edge.endNodeId) ?? [];
      end.push({ id: edge.startNodeId, weight });
      graph.set(edge.endNodeId, end);
    }
    this.weightedGraph = graph;
    return graph;
  }

  private snapNodes(x: number, z: number): string[] | null {
    const maxSnap = BUILDING_ROAD_ACCESS_DISTANCE;
    let bestDistance = maxSnap;
    let bestNodes: string[] = [];

    for (const node of this.network.nodes.values()) {
      const dist = distance(x, z, node.position.x, node.position.z);
      if (dist > bestDistance + 1e-6) continue;
      if (dist < bestDistance - 1e-6) {
        bestDistance = dist;
        bestNodes = [node.id];
      } else if (Math.abs(dist - bestDistance) <= 1e-6) {
        bestNodes.push(node.id);
      }
    }

    for (const edge of this.network.edges.values()) {
      if (edge.sampledPath.length < 2) continue;
      const dist = distancePointToPolylineXZ(x, z, edge.sampledPath);
      if (dist > bestDistance + 1e-6) continue;
      if (dist < bestDistance - 1e-6) {
        bestDistance = dist;
        bestNodes = [edge.startNodeId, edge.endNodeId];
      }
    }

    return bestNodes.length > 0 ? [...new Set(bestNodes)] : null;
  }

  private shareComponent(startNodes: string[], targetNodes: string[]): boolean {
    const targets = new Set(targetNodes);
    const visited = new Set<string>();
    const queue = [...startNodes];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      if (targets.has(node)) return true;
      const nodeData = this.network.nodes.get(node);
      if (!nodeData) continue;
      for (const edgeId of nodeData.edgeIds) {
        const edge = this.network.edges.get(edgeId);
        if (!edge) continue;
        const neighbor = edge.startNodeId === node ? edge.endNodeId : edge.startNodeId;
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    return false;
  }

  private materializePolyline(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    nodePath: readonly string[],
  ): RoadPoint[] {
    const path: RoadPoint[] = [{ x: ax, z: az }];
    for (let i = 0; i < nodePath.length - 1; i++) {
      const segment = this.edgePolylineBetween(nodePath[i], nodePath[i + 1]);
      if (!segment) continue;
      for (const point of segment) this.appendPoint(path, point);
    }
    this.appendPoint(path, { x: bx, z: bz });
    return path;
  }

  private edgePolylineBetween(from: string, to: string): RoadPoint[] | null {
    for (const edge of this.network.edges.values()) {
      const points = edge.sampledPath.map((point) => ({ x: point.x, z: point.z }));
      if (edge.startNodeId === from && edge.endNodeId === to) return points;
      if (edge.endNodeId === from && edge.startNodeId === to) return [...points].reverse();
    }

    const fromNode = this.network.nodes.get(from);
    const toNode = this.network.nodes.get(to);
    if (!fromNode || !toNode) return null;
    return [
      { x: fromNode.position.x, z: fromNode.position.z },
      { x: toNode.position.x, z: toNode.position.z },
    ];
  }

  private appendPoint(path: RoadPoint[], point: RoadPoint): void {
    const last = path[path.length - 1];
    if (last && distance(last.x, last.z, point.x, point.z) <= 1e-6) return;
    path.push(point);
  }
}
