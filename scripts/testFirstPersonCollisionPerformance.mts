import assert from 'node:assert/strict';
import { FpCollisionWorld, type FpCollider } from '../src/camera/fp/fpCollisionWorld.ts';
import { TreeRegistry } from '../src/resources/TreeRegistry.ts';
import type { TreeLayoutEntry, TreeEntityState } from '../src/resources/types.ts';
import type { RockObstacle } from '../src/utils/pathGeometry.ts';
import { RockSpatialIndex } from '../src/utils/rockSpatialIndex.ts';

const TREE_CELL_SIZE = 48;
const ROCK_CELL_SIZE = 18;

const random = seededRandom(0x91e10da5);
const layouts = Array.from({ length: 1_200 }, (_, layoutIndex) => ({
  layoutIndex,
  x: random() * 1_400 - 700,
  z: random() * 1_400 - 700,
  form: (['narrow', 'broad', 'young', 'midstory'] as const)[layoutIndex % 4]!,
  species: layoutIndex % 2 === 0 ? 'oak' : 'pine',
  scale: 0.55 + random() * 1.45,
}));
const registry = TreeRegistry.fromForestManager({
  getTreeLayouts: () => layouts,
} as never);
const treeScratch: TreeLayoutEntry[] = [];

for (let queryIndex = 0; queryIndex < 250; queryIndex += 1) {
  const x = random() * 1_300 - 650;
  const z = random() * 1_300 - 650;
  const radius = 2 + random() * 130;
  const expected = legacyTreesInRadius(registry.entries, x, z, radius);
  assert.deepEqual(
    registry.treesInRadiusInto(x, z, radius, treeScratch),
    expected,
    `tree query ${queryIndex} must preserve legacy ordering and membership`,
  );
  assert.strictEqual(
    registry.treesInRadiusInto(x, z, radius, treeScratch),
    treeScratch,
    'tree queries must return caller-owned scratch',
  );
}

const rocks: RockObstacle[] = Array.from({ length: 900 }, (_, index) => ({
  x: random() * 1_100 - 550,
  z: random() * 1_100 - 550,
  scale: 0.3 + random() * 2.2,
  collisionRadius: index % 3 === 0 ? 0.2 + random() * 3 : undefined,
  collisionMinY: index % 5 === 0 ? random() : undefined,
  collisionMaxY: index % 5 === 0 ? 1 + random() * 4 : undefined,
}));
const rockIndex = new RockSpatialIndex(rocks);
const rockScratch: RockObstacle[] = [];
for (let queryIndex = 0; queryIndex < 250; queryIndex += 1) {
  const x = random() * 1_000 - 500;
  const z = random() * 1_000 - 500;
  const radius = 1 + random() * 45;
  const expected = legacyRocksInRadius(rocks, x, z, radius);
  assert.deepEqual(
    rockIndex.rocksInRadiusInto(x, z, radius, rockScratch),
    expected,
    `rock query ${queryIndex} must preserve legacy ordering and membership`,
  );
  assert.strictEqual(
    rockIndex.rocksInRadiusInto(x, z, radius, rockScratch),
    rockScratch,
    'rock queries must return caller-owned scratch',
  );
}

const nearbyLayouts = [
  { layoutIndex: 0, x: 2, z: 1, form: 'broad', species: 'oak', scale: 1.1 },
  { layoutIndex: 1, x: -3, z: 2, form: 'young', species: 'pine', scale: 0.8 },
  { layoutIndex: 2, x: 5, z: -1, form: 'midstory', species: 'oak', scale: 0.9 },
] as const;
const nearbyRegistry = TreeRegistry.fromForestManager({
  getTreeLayouts: () => nearbyLayouts,
} as never);
let treeQueryCalls = 0;
const treeQuery = nearbyRegistry.treesInRadiusInto.bind(nearbyRegistry);
nearbyRegistry.treesInRadiusInto = (x, z, radius, out) => {
  treeQueryCalls += 1;
  return treeQuery(x, z, radius, out);
};
const nearbyRocks: RockObstacle[] = [
  { x: -1, z: -2, scale: 1, collisionRadius: 0.7, collisionMinY: 0, collisionMaxY: 1.2 },
  { x: 4, z: 3, scale: 0.8, collisionRadius: 0.5, collisionMinY: 0, collisionMaxY: 0.9 },
];
const nearbyRockIndex = new RockSpatialIndex(nearbyRocks);
let currentRockIndex = nearbyRockIndex;
let currentRegistry = nearbyRegistry;
let rockQueryCalls = 0;
let rockVersion = 1;
let treeActivityVersion = 1;
let treeStates = new Map<string, TreeEntityState>([
  ['tree-0', treeState('tree-0', 0, 'mature', 1)],
  ['tree-1', treeState('tree-1', 1, 'growing', 0.45)],
  ['tree-2', treeState('tree-2', 2, 'stump', 0)],
]);
const activeLayouts = new Set([0, 1, 2]);
const world = new FpCollisionWorld({
  getStaticRoots: () => [],
  getHeightAt: () => 0,
  getRockObstaclesNearInto: (x, z, radius, out) => {
    rockQueryCalls += 1;
    return currentRockIndex.rocksInRadiusInto(x, z, radius, out);
  },
  getRockStateVersion: () => rockVersion,
  getTreeRegistry: () => currentRegistry,
  getTreeState: (treeId) => treeStates.get(treeId),
  getTreeStateVersion: () => treeStates,
  getTreeActivityVersion: () => treeActivityVersion,
  isTreeLayoutActive: (layoutIndex) => activeLayouts.has(layoutIndex),
});

world.prepare(0, 0);
const internals = world as unknown as {
  nearby: FpCollider[];
  nearbyRocks: RockObstacle[];
  nearbyTrees: TreeLayoutEntry[];
  dynamicColliders: FpCollider[];
};
assert.deepEqual(
  internals.nearby.map(colliderPosition),
  [
    [-1, -2],
    [4, 3],
    [5, -1],
    [-3, 2],
    [2, 1],
  ],
  'first-person dynamic candidates must retain rocks-first and spatial tree ordering',
);
const rockScratchIdentity = internals.nearbyRocks;
const treeScratchIdentity = internals.nearbyTrees;
const firstColliders = [...internals.nearby];
const started = performance.now();
for (let frame = 0; frame < 20_000; frame += 1) world.prepare(0, 0);
const elapsed = performance.now() - started;
assert.equal(treeQueryCalls, 1, 'stationary unchanged frames must reuse the tree candidate set');
assert.equal(rockQueryCalls, 1, 'stationary unchanged frames must reuse the rock candidate set');
assert.strictEqual(internals.nearbyRocks, rockScratchIdentity);
assert.strictEqual(internals.nearbyTrees, treeScratchIdentity);
assert.deepEqual(internals.nearby, firstColliders, 'cached prepare must preserve collider identities/order');
assert.ok(elapsed < 100, `20,000 cached collision prepares took ${elapsed.toFixed(1)} ms`);

treeStates = new Map(treeStates);
treeStates.set('tree-1', treeState('tree-1', 1, 'growing', 0.8));
world.prepare(0, 0);
assert.equal(treeQueryCalls, 2, 'tree-state map replacement must invalidate stationary prepare');
activeLayouts.delete(2);
treeActivityVersion += 1;
world.prepare(0, 0);
assert.equal(treeQueryCalls, 3, 'forest activity changes must invalidate stationary prepare');
assert.ok(
  !internals.nearby.some((collider) => collider.shape === 'cylinder' && collider.x === 5 && collider.z === -1),
  'inactive tree layouts must leave the candidate result immediately',
);
let replacementTreeQueries = 0;
currentRegistry = TreeRegistry.fromForestManager({
  getTreeLayouts: () => [
    { ...nearbyLayouts[0], x: 8 },
    nearbyLayouts[1],
    nearbyLayouts[2],
  ],
} as never);
const replacementTreeQuery = currentRegistry.treesInRadiusInto.bind(currentRegistry);
currentRegistry.treesInRadiusInto = (x, z, radius, out) => {
  replacementTreeQueries += 1;
  return replacementTreeQuery(x, z, radius, out);
};
world.prepare(0, 0);
assert.equal(replacementTreeQueries, 1, 'tree-registry identity replacement must invalidate prepare');
assert.ok(
  internals.nearby.some((collider) => collider.shape === 'cylinder' && collider.x === 8),
  'same-sized replacement registries must publish their changed candidate coordinates',
);
currentRockIndex = new RockSpatialIndex([
  { ...nearbyRocks[0]!, x: -7 },
  nearbyRocks[1]!,
]);
rockVersion += 1;
world.prepare(0, 0);
assert.equal(rockQueryCalls, 5, 'rock candidate version changes must invalidate stationary prepare');
assert.ok(
  internals.nearby.some((collider) => collider.shape === 'cylinder' && collider.x === -7),
  'same-sized rock index replacements must publish their changed candidate coordinates',
);
world.prepare(0.001, 0);
assert.equal(rockQueryCalls, 6, 'any player movement must conservatively refresh exact candidates');

let fallbackQueries = 0;
const fallback = new FpCollisionWorld({
  getStaticRoots: () => [],
  getHeightAt: () => 0,
  getRockObstaclesNearInto: (x, z, radius, out) => {
    fallbackQueries += 1;
    return nearbyRockIndex.rocksInRadiusInto(x, z, radius, out);
  },
});
fallback.prepare(0, 0);
fallback.prepare(0, 0);
assert.equal(
  fallbackQueries,
  2,
  'missing dynamic version sources must retain conservative recomputation',
);

console.log(
  `test:first-person-collision-performance passed (${elapsed.toFixed(1)} ms / 20,000 cached prepares; 500 exact spatial queries)`,
);

function seededRandom(initial: number): () => number {
  let state = initial;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function legacyTreesInRadius(
  entries: readonly TreeLayoutEntry[],
  x: number,
  z: number,
  radius: number,
): TreeLayoutEntry[] {
  const buckets = new Map<string, TreeLayoutEntry[]>();
  for (const entry of entries) {
    const key = `${Math.floor(entry.x / TREE_CELL_SIZE)}:${Math.floor(entry.z / TREE_CELL_SIZE)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  const radiusSq = radius * radius;
  const seen = new Set<string>();
  const results: TreeLayoutEntry[] = [];
  const cellRadius = Math.ceil(radius / TREE_CELL_SIZE);
  const originCellX = Math.floor(x / TREE_CELL_SIZE);
  const originCellZ = Math.floor(z / TREE_CELL_SIZE);
  for (let dz = -cellRadius; dz <= cellRadius; dz += 1) {
    for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
      const bucket = buckets.get(`${originCellX + dx}:${originCellZ + dz}`);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry.id)) continue;
        const distanceSq = (entry.x - x) ** 2 + (entry.z - z) ** 2;
        if (distanceSq > radiusSq) continue;
        seen.add(entry.id);
        results.push(entry);
      }
    }
  }
  return results;
}

function legacyRocksInRadius(
  rocks: readonly RockObstacle[],
  x: number,
  z: number,
  radius: number,
): RockObstacle[] {
  const cells = new Map<number, RockObstacle[]>();
  for (const rock of rocks) {
    const key = packRockCell(
      Math.floor(rock.x / ROCK_CELL_SIZE),
      Math.floor(rock.z / ROCK_CELL_SIZE),
    );
    const bucket = cells.get(key);
    if (bucket) bucket.push(rock);
    else cells.set(key, [rock]);
  }
  const candidates: RockObstacle[] = [];
  const minCellX = Math.floor((x - radius) / ROCK_CELL_SIZE);
  const maxCellX = Math.floor((x + radius) / ROCK_CELL_SIZE);
  const minCellZ = Math.floor((z - radius) / ROCK_CELL_SIZE);
  const maxCellZ = Math.floor((z + radius) / ROCK_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const bucket = cells.get(packRockCell(cellX, cellZ));
      if (bucket) candidates.push(...bucket);
    }
  }
  const radiusSq = radius * radius;
  return candidates.filter((rock) => {
    const reach = radius + (rock.collisionRadius ?? rock.scale * 1.35);
    return (rock.x - x) ** 2 + (rock.z - z) ** 2 <= Math.max(radiusSq, reach * reach);
  });
}

function packRockCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}

function treeState(
  id: string,
  layoutIndex: number,
  phase: TreeEntityState['phase'],
  growthProgress: number,
): TreeEntityState {
  return {
    treeId: id,
    layoutIndex,
    phase,
    growthProgress,
    felledTick: 0,
    regrowReadyTick: 0,
    version: 0,
  } as TreeEntityState;
}

function colliderPosition(collider: FpCollider): [number, number] {
  return collider.shape === 'cylinder'
    ? [collider.x, collider.z]
    : [collider.centerX, collider.centerZ];
}
