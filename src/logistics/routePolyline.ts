import type { PointXZ } from '../utils/pathGeometry.ts';

/** JSON `[x,z]` pairs — keep in sync with server `serialize_route_polyline`. */
export function encodeRoutePolyline(points: readonly PointXZ[]): string {
  if (points.length === 0) return '';
  const pairs = points.map((point) => [point.x, point.z]);
  return JSON.stringify(pairs);
}

export function decodeRoutePolyline(json: string | null | undefined): PointXZ[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    const points: PointXZ[] = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const x = Number(entry[0]);
      const z = Number(entry[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      points.push({ x, z });
    }
    return points;
  } catch {
    return null;
  }
}
