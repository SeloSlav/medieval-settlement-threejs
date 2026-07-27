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
  private componentByNode: Map<string, number> | null = null;

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  invalidate(): void {
    this.weightedGraph = null;
    this.componentByNode = null;
  }

  roadConnected(ax: number, az: number, bx: number, bz: number): boolean {
    const nodesA = this.snapNodes(ax, az);
    const nodesB = this.snapNodes(bx, bz);
    return nodesA != null && nodesB != null && this.shareComponent(nodesA, nodesB);
  }

  /**
   * Cached topological branch id for a road-accessible world position.
   * Buildings on the same id can exchange carts without running Dijkstra.
   */
  roadComponentAt(x: number, z: number): number | null {
    return this.roadComponentsAt(x, z)[0] ?? null;
  }

  /**
   * Every cached topological branch touching a road-accessible position.
   * A position can be equally close to endpoints from disconnected roads, so
   * retaining the full set avoids an arbitrary branch choice at close passes.
   */
  roadComponentsAt(x: number, z: number): number[] {
    const nodes = this.snapNodes(x, z);
    if (!nodes) return [];
    const components = this.getComponentByNode();
    const selected = new Set<number>();
    for (const nodeId of nodes) {
      const component = components.get(nodeId);
      if (component == null) continue;
      selected.add(component);
    }
    return [...selected].sort((left, right) => left - right);
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

  /**
   * Exact one-to-many road distances using one Dijkstra tree from the origin.
   * This mirrors the authoritative server path metric without materializing a
   * route polyline for every household candidate.
   */
  roadPathDistancesFrom(
    ax: number,
    az: number,
    targets: readonly RoadPoint[],
  ): Array<number | null> {
    if (targets.length === 0) return [];
    const distances = this.shortestNodeDistancesFrom(ax, az);
    if (!distances) return targets.map(() => null);

    return targets.map((target) => {
      const targetNodes = this.snapNodes(target.x, target.z);
      if (!targetNodes) return null;
      let best = Infinity;
      for (const nodeId of targetNodes) {
        const roadCost = distances.get(nodeId);
        const node = this.network.nodes.get(nodeId);
        if (roadCost == null || !node) continue;
        best = Math.min(
          best,
          roadCost + distance(target.x, target.z, node.position.x, node.position.z),
        );
      }
      return Number.isFinite(best) && best > 1e-6 ? best : null;
    });
  }

  private shortestNodeDistancesFrom(ax: number, az: number): Map<string, number> | null {
    const startNodes = this.snapNodes(ax, az);
    if (!startNodes) return null;
    const graph = this.getWeightedGraph();
    const distances = new Map<string, number>();
    const heap = new MinHeap();

    for (const nodeId of startNodes) {
      const node = this.network.nodes.get(nodeId);
      if (!node) continue;
      const cost = distance(ax, az, node.position.x, node.position.z);
      const current = distances.get(nodeId);
      if (current != null && cost + 1e-6 >= current) continue;
      distances.set(nodeId, cost);
      heap.push({ cost, id: nodeId });
    }
    if (heap.length === 0) return null;

    while (heap.length > 0) {
      const current = heap.pop();
      if (!current) break;
      const best = distances.get(current.id);
      if (best == null || current.cost > best + 1e-6) continue;
      for (const neighbor of graph.get(current.id) ?? []) {
        const next = current.cost + neighbor.weight;
        const existing = distances.get(neighbor.id);
        if (existing != null && next + 1e-6 >= existing) continue;
        distances.set(neighbor.id, next);
        heap.push({ cost: next, id: neighbor.id });
      }
    }

    return distances;
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
    const candidates = this.network.getSpatialIndex().collectSnapCandidates(x, z, maxSnap);

    for (const node of candidates.nodes) {
      const dist = distance(x, z, node.position.x, node.position.z);
      if (dist > bestDistance + 1e-6) continue;
      if (dist < bestDistance - 1e-6) {
        bestDistance = dist;
        bestNodes = [node.id];
      } else if (Math.abs(dist - bestDistance) <= 1e-6) {
        bestNodes.push(node.id);
      }
    }

    for (const indexed of candidates.edges) {
      const edge = this.network.edges.get(indexed.edgeId);
      if (!edge || indexed.path.length < 2) continue;
      const dist = distancePointToPolylineXZ(x, z, indexed.path);
      if (dist > bestDistance + 1e-6) continue;
      if (dist < bestDistance - 1e-6) {
        bestDistance = dist;
        bestNodes = [edge.startNodeId, edge.endNodeId];
      } else if (Math.abs(dist - bestDistance) <= 1e-6) {
        bestNodes.push(edge.startNodeId, edge.endNodeId);
      }
    }

    return bestNodes.length > 0 ? [...new Set(bestNodes)] : null;
  }

  private shareComponent(startNodes: string[], targetNodes: string[]): boolean {
    const components = this.getComponentByNode();
    return startNodes.some((start) => {
      const component = components.get(start);
      return component != null
        && targetNodes.some((target) => components.get(target) === component);
    });
  }

  private getComponentByNode(): Map<string, number> {
    if (this.componentByNode) return this.componentByNode;

    const components = new Map<string, number>();
    let nextComponent = 0;
    for (const nodeId of this.network.nodes.keys()) {
      if (components.has(nodeId)) continue;
      const queue = [nodeId];
      let cursor = 0;
      components.set(nodeId, nextComponent);
      while (cursor < queue.length) {
        const currentId = queue[cursor++];
        const current = this.network.nodes.get(currentId);
        if (!current) continue;
        for (const edgeId of current.edgeIds) {
          const edge = this.network.edges.get(edgeId);
          if (!edge) continue;
          const neighbor = edge.startNodeId === currentId ? edge.endNodeId : edge.startNodeId;
          if (components.has(neighbor)) continue;
          components.set(neighbor, nextComponent);
          queue.push(neighbor);
        }
      }
      nextComponent += 1;
    }
    this.componentByNode = components;
    return components;
  }

  private materializePolyline(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    nodePath: readonly string[],
  ): RoadPoint[] {
    const path: RoadPoint[] = [{ x: ax, z: az }];
    const firstNode = nodePath.length > 0
      ? this.network.nodes.get(nodePath[0])
      : null;
    if (firstNode) {
      this.appendPoint(path, {
        x: firstNode.position.x,
        z: firstNode.position.z,
      });
    }
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
