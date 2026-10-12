import type { PointXZ } from '../utils/pathGeometry.ts';

export type AgentLegRouteResolver = (
  start: PointXZ,
  end: PointXZ,
  solve: () => PointXZ[] | null,
) => readonly PointXZ[] | null;

export function agentNavigationPointKey(point: PointXZ): string {
  const coordinate = (value: number) => Object.is(value,-0) ? '-0' : String(value);
  return `${coordinate(point.x)},${coordinate(point.z)}`;
}

/** Exact static legs shared by different journeys, with bounded ownership. */
export class AgentLegRouteCache {
  private readonly entries = new Map<string,PointXZ[] | null>();
  private readonly capacity: number;
  hits = 0;
  misses = 0;

  constructor(capacity = 4096) {
    if (!Number.isInteger(capacity) || capacity < 1) throw Error('Leg cache capacity must be a positive integer');
    this.capacity = capacity;
  }

  get size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }

  resolve(start: PointXZ,end: PointXZ,radius: number,solve: () => PointXZ[] | null): PointXZ[] | null {
    if (![start.x,start.z,end.x,end.z,radius].every(Number.isFinite)) return solve();
    const key = `${radius}|${agentNavigationPointKey(start)}>${agentNavigationPointKey(end)}`;
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.hits++; this.entries.delete(key); this.entries.set(key,previous);
      return copy(previous);
    }
    this.misses++;
    const route = solve();
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key,copy(route));
    return route;
  }
}

function copy(route: readonly PointXZ[] | null): PointXZ[] | null {
  return route?.map(point => ({x:point.x,z:point.z})) ?? null;
}
