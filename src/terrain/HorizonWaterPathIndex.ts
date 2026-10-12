import { MathUtils } from 'three';
import { StaticFootprintIndex } from '../utils/StaticFootprintIndex.ts';

export type HorizonWaterPoint = { x: number; z: number; halfWidth: number; channelDepth: number; surfaceY: number };
export type HorizonWaterPath = { points: HorizonWaterPoint[] };
type Segment = readonly [HorizonWaterPoint,HorizonWaterPoint];
type Sample = { distance: number; halfWidth: number; channelDepth: number; surfaceY: number };

/** Exact nearest-channel selection within the maximum possible carving radius. */
export class HorizonWaterPathIndex {
  private readonly index: StaticFootprintIndex<Segment>;

  constructor(paths: readonly HorizonWaterPath[]) {
    const segments: Segment[] = [];
    let radius = 0;
    for (const path of paths) {
      for (let i = 0; i < path.points.length - 1; i++) {
        const a = path.points[i]!,b = path.points[i+1]!;
        segments.push([a,b]); radius = Math.max(radius,a.halfWidth,b.halfWidth);
      }
    }
    radius = radius * 0.86 + 1e-6;
    // A narrow, nearer channel can suppress carving by a farther wide one.
    // Keep those competitors using the GLOBAL maximum radius, then retain
    // the original distance comparison and source ordering in the narrow phase.
    this.index = new StaticFootprintIndex(segments,([a,b]) => ({
      minX: Math.min(a.x,b.x)-radius,maxX: Math.max(a.x,b.x)+radius,
      minZ: Math.min(a.z,b.z)-radius,maxZ: Math.max(a.z,b.z)+radius,
    }));
  }

  sample(x: number,z: number): Sample | null {
    let best: Sample | null = null;
    for (const [a,b] of this.index.at(x,z)) {
      const vx = b.x-a.x,vz = b.z-a.z;
      const lengthSquared = vx*vx+vz*vz;
      const t = lengthSquared <= 1e-6 ? 0
        : MathUtils.clamp(((x-a.x)*vx+(z-a.z)*vz)/lengthSquared,0,1);
      const px = MathUtils.lerp(a.x,b.x,t),pz = MathUtils.lerp(a.z,b.z,t);
      const distance = Math.hypot(x-px,z-pz);
      if (best && distance >= best.distance) continue;
      best = {distance,halfWidth:MathUtils.lerp(a.halfWidth,b.halfWidth,t),
        channelDepth:MathUtils.lerp(a.channelDepth,b.channelDepth,t),surfaceY:MathUtils.lerp(a.surfaceY,b.surfaceY,t)};
    }
    return best;
  }
}
