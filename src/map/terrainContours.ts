/** Equal-height paths in normalized map coordinates (+Z runs down the page). */
export type TerrainContourPoint = { x: number; y: number };
export type TerrainContourPath = { points: TerrainContourPoint[]; closed: boolean };

export const MAP_CONTOUR_LEVELS = {
  // Placement contours use 2 m. Coarsen that interval for a whole-world map.
  minimumIntervalMeters: 2,
  targetLevelCount: 18,
  indexEvery: 5,
} as const;

export function resolveTerrainContourLevels(minimum: number, maximum: number): {
  intervalMeters: number;
  levels: number[];
} {
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range < 0.01) return { intervalMeters: 0, levels: [] };
  const minimumInterval = MAP_CONTOUR_LEVELS.minimumIntervalMeters;
  const desired = Math.max(minimumInterval, range / MAP_CONTOUR_LEVELS.targetLevelCount);
  const magnitude = minimumInterval * 10 ** Math.floor(Math.log10(desired / minimumInterval));
  const multiplier = [1, 2, 5, 10].find((value) => value * magnitude >= desired)!;
  const intervalMeters = multiplier * magnitude;
  const levels: number[] = [];
  for (let index = Math.floor(minimum / intervalMeters) + 1;
    index * intervalMeters < maximum; index++) {
    levels.push(index * intervalMeters);
  }
  return { intervalMeters, levels };
}

type Edge = 0 | 1 | 2 | 3;
type Segment = readonly [Edge, Edge];
const CELL_SEGMENTS: readonly (readonly Segment[])[] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]],
  [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]],
  [[1, 3]], [[0, 1]], [[3, 0]], [],
];

/**
 * March the sampled height field, then join shared grid edges into paths.
 * Keeping paths connected lets the charcoal spacing flow across cell borders.
 * The bilinear saddle decider preserves passes between neighbouring summits.
 */
export function traceTerrainContours(
  heights: Float32Array,
  resolution: number,
  level: number,
): TerrainContourPath[] {
  if (resolution < 2 || heights.length !== resolution * resolution) return [];
  type Node = { point: TerrainContourPoint; neighbours: number[] };
  const nodes = new Map<number, Node>();
  const horizontalEdgeCount = resolution * (resolution - 1);
  const span = resolution - 1;

  for (let row = 0; row < span; row++) {
    for (let column = 0; column < span; column++) {
      const tl = heights[row * resolution + column] - level;
      const tr = heights[row * resolution + column + 1] - level;
      const br = heights[(row + 1) * resolution + column + 1] - level;
      const bl = heights[(row + 1) * resolution + column] - level;
      const cellCase = (tl >= 0 ? 1 : 0) | (tr >= 0 ? 2 : 0)
        | (br >= 0 ? 4 : 0) | (bl >= 0 ? 8 : 0);
      let segments = CELL_SEGMENTS[cellCase];
      const saddle = tl * br - tr * bl;
      if (cellCase === 5 && saddle > 0) segments = [[0, 1], [2, 3]];
      if (cellCase === 10 && saddle < 0) segments = [[3, 0], [1, 2]];
      if (!segments.length) continue;

      const nodeForEdge = (edge: Edge): number => {
        let id: number;
        let x = column;
        let y = row;
        if (edge === 0 || edge === 2) {
          y += edge === 2 ? 1 : 0;
          id = y * span + column;
          x += crossing(edge === 0 ? tl : bl, edge === 0 ? tr : br);
        } else {
          x += edge === 1 ? 1 : 0;
          id = horizontalEdgeCount + row * resolution + x;
          y += crossing(edge === 1 ? tr : tl, edge === 1 ? br : bl);
        }
        if (!nodes.has(id)) nodes.set(id, { point: { x: x / span, y: y / span }, neighbours: [] });
        return id;
      };
      for (const [fromEdge, toEdge] of segments) {
        const from = nodeForEdge(fromEdge);
        const to = nodeForEdge(toEdge);
        nodes.get(from)!.neighbours.push(to);
        nodes.get(to)!.neighbours.push(from);
      }
    }
  }

  const paths: TerrainContourPath[] = [];
  const visited = new Set<number>();
  const walk = (start: number): void => {
    if (visited.has(start)) return;
    const points: TerrainContourPoint[] = [];
    let current = start;
    let previous = -1;
    let closed = false;
    while (!visited.has(current)) {
      visited.add(current);
      const node = nodes.get(current)!;
      points.push(node.point);
      const next = node.neighbours.find((id) => id !== previous);
      if (next === undefined) break;
      if (next === start) {
        points.push(nodes.get(start)!.point);
        closed = true;
        break;
      }
      previous = current;
      current = next;
    }
    if (points.length > 1) paths.push({ points, closed });
  };
  // Open paths must start at their boundary, not at an interior grid edge.
  for (const [id, node] of nodes) if (node.neighbours.length === 1) walk(id);
  for (const id of nodes.keys()) walk(id);
  return paths;
}

function crossing(from: number, to: number): number {
  return from === to ? 0.5 : Math.max(0, Math.min(1, from / (from - to)));
}
