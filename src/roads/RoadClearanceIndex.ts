import type { RoadEdge } from './RoadEdge.ts';
import { distancePointToPolylineXZ,distancePointToSegmentXZ } from '../utils/pathGeometry.ts';
import { StaticFootprintIndex } from '../utils/StaticFootprintIndex.ts';

type Segment = { a: RoadEdge['controlPoints'][number]; b: RoadEdge['controlPoints'][number]; halfWidth: number };
type Path = { points: RoadEdge['controlPoints']; halfWidth: number };

/** Rebuilt with the road snapshot; sampled centerlines and clearance maths stay exact. */
export class RoadClearanceIndex {
  private readonly index: StaticFootprintIndex<Segment>;
  private readonly paths: Path[] = [];
  private readonly diagnosticPaths: Path[] = [];
  private readonly maximumMargin: number;

  constructor(edges: readonly RoadEdge[],maximumMargin = 16) {
    if (!Number.isFinite(maximumMargin) || maximumMargin < 0) throw Error('Road clearance margin must be finite and nonnegative');
    this.maximumMargin = maximumMargin;
    const segments: Segment[] = [];
    for (const edge of edges) {
      const points = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
      if (points.length < 2) continue;
      const path = {points,halfWidth:edge.width*0.5}; this.paths.push(path);
      if (!Number.isFinite(path.halfWidth) || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
        // Preserve the original whole-polyline NaN/Infinity semantics instead
        // of letting a finite segment of an invalid polyline clear a point.
        this.diagnosticPaths.push(path); continue;
      }
      for (let i = 0; i < points.length - 1; i++) segments.push({a:points[i]!,b:points[i+1]!,halfWidth:path.halfWidth});
    }
    this.index = new StaticFootprintIndex(segments,segment => {
      const radius = Math.max(0,segment.halfWidth+maximumMargin)+1e-6;
      return {minX:Math.min(segment.a.x,segment.b.x)-radius,maxX:Math.max(segment.a.x,segment.b.x)+radius,
        minZ:Math.min(segment.a.z,segment.b.z)-radius,maxZ:Math.max(segment.a.z,segment.b.z)+radius};
    });
  }

  isNear(x: number,z: number,margin: number,extraMargin = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(margin+extraMargin) || margin+extraMargin > this.maximumMargin) {
      return this.paths.some(path => distancePointToPolylineXZ(x,z,path.points) <= path.halfWidth+margin+extraMargin);
    }
    for (const segment of this.index.at(x,z)) {
      if (distancePointToSegmentXZ(x,z,segment.a,segment.b) <= segment.halfWidth+margin+extraMargin) return true;
    }
    return this.diagnosticPaths.some(path => distancePointToPolylineXZ(x,z,path.points) <= path.halfWidth+margin+extraMargin);
  }
}
