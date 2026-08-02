import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { routeAgentPolyline } from '../src/settlement/agentNavigation.ts';

const path = [{ x: -20, z: 0 }, { x: 20, z: 0 }];
const isBlocked = (x: number, z: number): boolean => (
  x > -2 && x < 2 && z > -8 && z < 8
);

const expected = [
  { x: -20, z: 0 },
  { x: -20.15, z: 0 },
  { x: -1.3000000000000007, z: -8.45 },
  { x: 2.6000000000000014, z: -8.45 },
  { x: 20.15, z: 0 },
  { x: 20, z: 0 },
];
assert.deepEqual(
  routeAgentPolyline(path, isBlocked),
  expected,
  'pooled navigation scratch storage must preserve A* tie-breaking and smoothing exactly',
);
assert.deepEqual(
  routeAgentPolyline(path, () => false),
  path,
  'clear routes must preserve their exact endpoints',
);

// This deterministic corpus was cross-checked against the pre-pooling HEAD
// implementation. Its fingerprint locks A* tie-breaking, smoothing, null
// routes, and exact floating-point coordinates across varied obstacle fields.
let randomState = 0x6d2b79f5;
const random = (): number => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0x1_0000_0000;
};
const randomizedResults: Array<ReturnType<typeof routeAgentPolyline>> = [];
for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
  const start = { x: random() * 24 - 12, z: random() * 24 - 12 };
  const end = { x: random() * 24 - 12, z: random() * 24 - 12 };
  const rectangles = Array.from(
    { length: 1 + Math.floor(random() * 4) },
    () => {
      const centerX = random() * 20 - 10;
      const centerZ = random() * 20 - 10;
      const halfWidth = 0.35 + random() * 2.25;
      const halfHeight = 0.35 + random() * 2.25;
      return {
        minX: centerX - halfWidth,
        maxX: centerX + halfWidth,
        minZ: centerZ - halfHeight,
        maxZ: centerZ + halfHeight,
      };
    },
  );
  randomizedResults.push(routeAgentPolyline(
    [start, end],
    (x, z) => rectangles.some((rectangle) => (
      x >= rectangle.minX
      && x <= rectangle.maxX
      && z >= rectangle.minZ
      && z <= rectangle.maxZ
    )),
  ));
}
const randomizedFingerprint = createHash('sha256')
  .update(JSON.stringify(randomizedResults))
  .digest('hex');
assert.equal(
  randomizedFingerprint,
  '595c1585faa8b3396043d78cc793cfd95f71a98f836d07bd41b678f8ed1c322f',
  'pooled navigation must preserve the independently verified 200-case randomized corpus',
);

for (let index = 0; index < 20; index++) {
  routeAgentPolyline(path, isBlocked);
}
const before = process.memoryUsage();
const started = performance.now();
for (let index = 0; index < 500; index++) {
  routeAgentPolyline(path, isBlocked);
}
const elapsed = performance.now() - started;
const after = process.memoryUsage();

assert.equal(
  after.arrayBuffers - before.arrayBuffers,
  0,
  'warmed navigation searches should reuse their typed grid buffers',
);
assert.ok(
  elapsed < 250,
  `500 obstructed navigation searches took ${elapsed.toFixed(1)} ms`,
);

console.log(
  `test:agent-navigation-performance passed (${elapsed.toFixed(1)} ms / 500 obstructed routes)`,
);
