import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  StaticColliderIndex, agentCapsuleOverlapsCollider, type FpCollider,
} from '../src/camera/fp/fpCollisionWorld.ts';
import { routeAgentPolyline } from '../src/settlement/agentNavigation.ts';
import type { PointXZ } from '../src/utils/pathGeometry.ts';

// Independent reference: intersect the segment with each polygon edge and
// measure distances between segment endpoints and edges. No rounded-box slabs.
function pointSegmentSq(p: PointXZ, a: PointXZ, b: PointXZ): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz || 1)));
  return (p.x-a.x-dx*t)**2+(p.z-a.z-dz*t)**2;
}
function segmentsIntersect(a: PointXZ, b: PointXZ, c: PointXZ, d: PointXZ): boolean {
  const dx = b.x-a.x, dz = b.z-a.z, ex = d.x-c.x, ez = d.z-c.z;
  const cross = dx*ez-dz*ex;
  if (cross === 0) return false;
  const u = ((c.x-a.x)*ez-(c.z-a.z)*ex)/cross;
  const v = ((c.x-a.x)*dz-(c.z-a.z)*dx)/cross;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
function reference(a: PointXZ, b: PointXZ, radius: number, collider: FpCollider): boolean {
  if (collider.shape === 'cylinder') {
    return pointSegmentSq({ x: collider.x, z: collider.z }, a, b) <= (radius+collider.radius)**2;
  }
  const cos = Math.cos(collider.yaw), sin = Math.sin(collider.yaw);
  const local = (p: PointXZ): PointXZ => ({
    x: (p.x-collider.centerX)*cos-(p.z-collider.centerZ)*sin,
    z: (p.x-collider.centerX)*sin+(p.z-collider.centerZ)*cos,
  });
  a = local(a); b = local(b);
  if ([a,b].some(p => Math.abs(p.x) <= collider.halfX && Math.abs(p.z) <= collider.halfZ)) return true;
  const corners = [
    { x: -collider.halfX, z: -collider.halfZ },
    { x: collider.halfX, z: -collider.halfZ },
    { x: collider.halfX, z: collider.halfZ },
    { x: -collider.halfX, z: collider.halfZ },
  ];
  for (let i=0; i<4; i++) {
    const c = corners[i], d = corners[(i+1)%4];
    if (segmentsIntersect(a,b,c,d) || Math.min(pointSegmentSq(a,c,d), pointSegmentSq(b,c,d),
      pointSegmentSq(c,a,b), pointSegmentSq(d,a,b)) <= radius*radius) return true;
  }
  return false;
}
let state = 0x527193;
const random = () => {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0)/2**32;
};
const colliders: FpCollider[] = Array.from({ length: 2000 }, (_, i) => {
  const x = random()*12000-6000, z = random()*12000-6000;
  return i%3 === 0
    ? { shape: 'cylinder', x, z, radius: 0.05+random()*5, minY: 0, maxY: 3 }
    : { shape: 'box', centerX: x, centerZ: z, halfX: 0.025+random()*6,
      halfZ: 0.025+random()*6, yaw: random()*Math.PI*2, minY: 0, maxY: 3 };
});
const index = new StaticColliderIndex();
for (const collider of colliders) index.add(collider);
for (let i=0; i<4000; i++) {
  const target = colliders[i%colliders.length];
  const x = target.shape === 'box' ? target.centerX : target.x;
  const z = target.shape === 'box' ? target.centerZ : target.z;
  const a = { x: x+random()*40-20, z: z+random()*40-20 };
  const b = i%7 === 0 ? a : { x: x+random()*40-20, z: z+random()*40-20 };
  const radius = i%11 === 0 ? random()*18 : random()*0.8;
  assert.equal(agentCapsuleOverlapsCollider(a,b,radius,target), reference(a,b,radius,target), `shape ${i}`);
  const expected = !colliders.some(c => reference(a,b,radius,c));
  assert.equal(index.segmentIsClear(a,b,radius), expected, `spatial query ${i}`);
  assert.equal(index.segmentIsClear(b,a,radius), expected, `reversed query ${i}`);
}
// Signed cell boundaries, diagonal corner crossings, point queries and long
// empty routes exercise both the DDA and the bounded all-collider fallback.
for (const [a,b] of [
  [{ x: -16, z: 0 }, { x: 16, z: 0 }],
  [{ x: 16, z: 16 }, { x: -16, z: -16 }],
  [{ x: 8, z: 0 }, { x: 0, z: 8 }],
  [{ x: -6000, z: -6000 }, { x: 6000, z: 6000 }],
] as const) {
  assert.equal(index.segmentIsClear(a,b,0.28), !colliders.some(c => reference(a,b,0.28,c)));
}
const thinFence: FpCollider = {
  shape: 'box', centerX: 0.11, centerZ: 0, halfX: 0.025, halfZ: 4,
  yaw: 0, minY: 0, maxY: 2,
};
const fenceIndex = new StaticColliderIndex(); fenceIndex.add(thinFence);
const path = [{ x: -6, z: 0 }, { x: 6, z: 0 }];
const route = routeAgentPolyline(path,
  (x,z) => fenceIndex.diskOverlaps(x,z,0.01),
  (a,b) => fenceIndex.segmentIsClear(a,b,0.01));
assert(route && route.some(p => Math.abs(p.z) > 4), 'thin fences require a real detour');
for (let i=1; i<route.length; i++) assert(fenceIndex.segmentIsClear(route[i-1],route[i],0.01));
assert(fenceIndex.segmentIsClear({ x: -6, z: 4.02 }, { x: 6, z: 4.02 },0.01), 'clear openings remain open');
assert(!fenceIndex.segmentIsClear({ x: -6, z: 4.01 }, { x: 6, z: 4.01 },0.01), 'tangent contact is blocked');
index.clear(); assert(index.segmentIsClear(path[0],path[1],0.28), 'clear removes all collision data');
assert(!index.segmentIsClear({ x: NaN, z: 0 },path[1],0.28), 'invalid queries fail closed');

const fixture = new StaticColliderIndex();
for (let i=0; i<50; i++) fixture.add({
  shape: 'box', centerX: i%10*15, centerZ: Math.floor(i/10)*15,
  halfX: 2, halfZ: 5, yaw: 0.3, minY: 0, maxY: 3,
});
const routes = Array.from({ length: 80 }, (_,i) => [
  { x: -12, z: (i%10)*7-5 }, { x: 148, z: Math.floor(i/10)*9-5 },
]);
const run = (sweep: boolean) => {
  let pointQueries = 0, resultCount = 0;
  const start = performance.now();
  for (const candidate of routes) {
    const result = routeAgentPolyline(candidate, (x,z) => {
      pointQueries++; return fixture.diskOverlaps(x,z,0.28);
    }, sweep ? (a,b) => fixture.segmentIsClear(a,b,0.28) : undefined);
    if (result) {
      resultCount++;
      if (sweep) for (let i=1; i<result.length; i++) assert(fixture.segmentIsClear(result[i-1],result[i],0.28));
    }
  }
  return { ms: performance.now()-start, pointQueries, resultCount };
};
run(false); run(true);
const sampled = run(false), swept = run(true);
assert.equal(swept.resultCount, sampled.resultCount, 'reachable town errands remain reachable');
assert(swept.pointQueries < sampled.pointQueries/5, 'smoothing should eliminate most point hash queries');
console.log('test:agent-static-segments passed', JSON.stringify({ sampled, swept }));

if (process.argv[2]) {
  const workload = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
    groups: Array<{ colliders: FpCollider[]; routes: Array<{ path: PointXZ[]; radius: number }> }>;
  };
  const replay = (sweep: boolean) => {
    let pointQueries = 0, routes = 0, reachable = 0;
    const started = performance.now();
    for (const group of workload.groups) {
      const actualIndex = new StaticColliderIndex();
      for (const collider of group.colliders) actualIndex.add(collider);
      for (const request of group.routes) {
        routes++;
        const result = routeAgentPolyline(request.path, (x,z) => {
          pointQueries++; return actualIndex.diskOverlaps(x,z,request.radius);
        }, sweep ? (a,b) => actualIndex.segmentIsClear(a,b,request.radius) : undefined);
        if (result) reachable++;
      }
    }
    return { ms: performance.now()-started, pointQueries, routes, reachable };
  };
  replay(false); replay(true);
  const report = { phase: 'static-collision-only-no-water-no-route-cache',
    sampled: replay(false), swept: replay(true) };
  writeFileSync(process.argv[2].replace(/\.json$/, '-replay.json'), JSON.stringify(report,null,2));
  console.log('Actual town route replay', JSON.stringify(report));
}
