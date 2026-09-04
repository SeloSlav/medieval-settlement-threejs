import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TerrainHorizon,
  TERRAIN_HORIZON_PARAMETERS,
} from '../src/terrain/TerrainHorizon.ts';
import { TerrainHorizonWorld } from '../src/terrain/TerrainHorizonWorld.ts';
import { RiverLayout } from '../src/rivers/RiverLayout.ts';
import { WORLD_TERRAIN_PRESETS } from '../src/world/worldTerrainPresets.ts';
import { forestDensityAt } from '../src/props/forestField.ts';
import { forestFloorBlendAtPosition } from '../src/terrain/terrainGeometryData.ts';

const TERRAIN_SIZE = 80;
const RESOLUTION = 9;
const FAR_DISTANCE = 600;

function testHeight(x: number, z: number): number {
  return x * 0.1 + z * 0.05 + Math.sin(x * 0.04) * 0.3;
}

function createSourceGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const normals = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const uvs = new Float32Array(RESOLUTION * RESOLUTION * 2);
  const colors = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const staticMasks = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const scalar = new Float32Array(RESOLUTION * RESOLUTION);
  const canopy = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  const half = TERRAIN_SIZE * 0.5;
  const step = TERRAIN_SIZE / (RESOLUTION - 1);
  for (let zIndex = 0; zIndex < RESOLUTION; zIndex++) {
    for (let xIndex = 0; xIndex < RESOLUTION; xIndex++) {
      const index = zIndex * RESOLUTION + xIndex;
      const x = -half + xIndex * step;
      const z = -half + zIndex * step;
      positions.set([x, testHeight(x, z), z], index * 3);
      normals.set([-0.1, 1, -0.05], index * 3);
      uvs.set([x / 48, z / 48], index * 2);
      colors.set([0.6, 0.25, 0.15], index * 3);
      staticMasks[index * 3] = 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const uv = new THREE.BufferAttribute(uvs, 2);
  geometry.setAttribute('uv', uv);
  geometry.setAttribute('uv2', uv);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const masks = new THREE.InterleavedBuffer(staticMasks, 3);
  geometry.setAttribute('forestBlend', new THREE.InterleavedBufferAttribute(masks, 1, 0));
  geometry.setAttribute('shoreBlend', new THREE.InterleavedBufferAttribute(masks, 1, 1));
  geometry.setAttribute('quarryPadBlend', new THREE.InterleavedBufferAttribute(masks, 1, 2));
  geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(scalar, 1));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(scalar, 1));
  geometry.setAttribute('forestCanopyOcclusion', new THREE.BufferAttribute(canopy, 4, true));
  return geometry;
}

function createHorizon(source: THREE.BufferGeometry, material: THREE.Material): TerrainHorizon {
  return new TerrainHorizon({
    sourceGeometry: source,
    material,
    terrainSize: TERRAIN_SIZE,
    sourceResolution: RESOLUTION,
    farDistance: FAR_DISTANCE,
    seed: 0x71a2e0d,
    sampleHeight: testHeight,
    sampleForestBlend: () => 1,
  });
}

const source = createSourceGeometry();
const material = new THREE.MeshStandardMaterial({ vertexColors: true });
const horizon = createHorizon(source, material);
const diagnostics = horizon.getDiagnostics();
const playableHalf = TERRAIN_SIZE * 0.5;

// Regression for the former square leaf-litter band around the real playable
// boundary. Sample a complete perimeter in the production medium-map edge
// band: it must contain both genuine woodland and broad meadow gaps.
const forestGenerationHalf = 620;
const forestTerrainHalf = 817;
const forestEdgeRadius = 800;
let denseEdgeSamples = 0;
let openEdgeSamples = 0;
const edgeSampleCount = 512;
for (let index = 0; index < edgeSampleCount; index++) {
  const side = Math.floor(index / (edgeSampleCount / 4));
  const sideIndex = index % (edgeSampleCount / 4);
  const along = THREE.MathUtils.lerp(
    -forestEdgeRadius,
    forestEdgeRadius,
    sideIndex / (edgeSampleCount / 4 - 1),
  );
  const x = side === 0
    ? -forestEdgeRadius
    : side === 1
      ? forestEdgeRadius
      : along;
  const z = side === 2
    ? -forestEdgeRadius
    : side === 3
      ? forestEdgeRadius
      : along;
  const floorBlend = forestFloorBlendAtPosition(
    forestDensityAt(
      x,
      z,
      [],
      forestGenerationHalf,
      forestTerrainHalf,
    ),
    x,
    z,
  );
  if (floorBlend > 0.5) denseEdgeSamples++;
  if (floorBlend < 0.05) openEdgeSamples++;
}
assert.ok(
  denseEdgeSamples > edgeSampleCount * 0.08,
  'the playable perimeter must retain substantial organic woodland stands',
);
assert.ok(
  openEdgeSamples > edgeSampleCount * 0.5,
  'the playable perimeter must retain broad meadow gaps instead of a square litter ring',
);

assert.ok(
  diagnostics.drawCalls <= TERRAIN_HORIZON_PARAMETERS.budget.maximumDrawCalls,
  `outer world exceeded draw-call budget: ${diagnostics.drawCalls}`,
);
assert.equal(diagnostics.terrainDrawCalls, 1);
assert.equal(diagnostics.castsShadows, false);
assert.equal(diagnostics.receivesShadows, false);
assert.equal(diagnostics.updatesPerFrame, false);
assert.equal(horizon.mesh.castShadow, false);
assert.equal(horizon.mesh.receiveShadow, false);
assert.equal(horizon.mesh.children.length, 0, 'the horizon must remain one draw object');
assert.ok(horizon.group.children.includes(horizon.mesh));
assert.ok(horizon.group.children.length <= TERRAIN_HORIZON_PARAMETERS.budget.maximumDrawCalls);
assert.ok(
  diagnostics.outerHalfExtent - diagnostics.innerHalfExtent >=
    FAR_DISTANCE * TERRAIN_HORIZON_PARAMETERS.coverage.farPlaneMultiplier,
  'the outer edge must stay beyond the camera far plane from the playable edge',
);
assert.ok(
  diagnostics.triangleCount <= TERRAIN_HORIZON_PARAMETERS.budget.maximumTerrainTriangles,
  `the static horizon exceeded its triangle budget: ${diagnostics.triangleCount}`,
);
assert.ok(
  diagnostics.waterTriangles <= TERRAIN_HORIZON_PARAMETERS.budget.maximumWaterTriangles,
  `outer hydrology exceeded its triangle budget: ${diagnostics.waterTriangles}`,
);
assert.ok(
  diagnostics.seedThreeOverviewTrees
    <= TERRAIN_HORIZON_PARAMETERS.budget.maximumSeedThreeOverviewTrees,
  'outer SeedThree placement budget must remain bounded',
);
assert.ok(
  diagnostics.seedThreeOverviewTrees >= 2_000,
  `a normal-density map must receive a genuinely dense SeedThree outer forest; got ${diagnostics.seedThreeOverviewTrees}`,
);
assert.equal(diagnostics.seedThreeNearTrees, 0);
assert.equal(diagnostics.seedThreeShadowTrees, 0);
assert.ok(diagnostics.hydrologyPaths >= 1, 'wet custom terrain should receive an outer watershed');
assert.ok(diagnostics.topologyAmplitudeMeters > 0, 'outer terrain should carry regional relief');
for (const placement of horizon.getForestPlacements()) {
  assert.equal(placement.visualOnly, 'terrain-horizon');
  assert.ok(
    Math.max(Math.abs(placement.x), Math.abs(placement.z)) > playableHalf,
    'outer SeedThree trees must stay outside the playable map',
  );
}
for (let index = 1; index < diagnostics.lodRows.length; index++) {
  const previous = diagnostics.lodRows[index - 1]!;
  const current = diagnostics.lodRows[index]!;
  assert.ok(current.halfExtent > previous.halfExtent, 'LOD rows must move monotonically outward');
  assert.ok(
    current.segmentsPerSide <= previous.segmentsPerSide,
    'LOD segment density must never increase with distance',
  );
  assert.ok(current.filterRadius >= previous.filterRadius, 'filter width must grow with LOD distance');
}

const horizonPositions = horizon.mesh.geometry.getAttribute('position');
const horizonIndices = horizon.mesh.geometry.getIndex();
const horizonForestBlend = horizon.mesh.geometry.getAttribute('forestBlend');
assert.ok(horizonIndices);
let seamVertices = 0;
for (let index = 0; index < horizonPositions.count; index++) {
  const x = horizonPositions.getX(index);
  const y = horizonPositions.getY(index);
  const z = horizonPositions.getZ(index);
  assert.ok(
    Math.max(Math.abs(x), Math.abs(z)) >= playableHalf - 1e-6,
    'visual-only horizon geometry must not cover the playable terrain interior',
  );
  if (Math.abs(Math.max(Math.abs(x), Math.abs(z)) - playableHalf) <= 1e-6) {
    seamVertices++;
    assert.ok(Math.abs(y - testHeight(x, z)) <= 1e-5, 'the horizon seam must copy source height exactly');
    assert.equal(
      horizonForestBlend.getX(index),
      1,
      'the horizon seam must copy the source forest floor exactly',
    );
  }
}
assert.equal(seamVertices, 4 * RESOLUTION, 'every source boundary vertex must be copied once per side');

const authoredRiverEndpoint = { x: 39, z: 6 };
const authoredRiver = RiverLayout.fromSerialized({
  bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  seed: 0x12345678,
  drain: authoredRiverEndpoint,
  terrainPreset: 'custom',
  corridors: [{
    points: [
      { x: 14, z: 3, progress: 0, halfWidth: 9, channelDepth: 2.6 },
      { ...authoredRiverEndpoint, progress: 1, halfWidth: 11, channelDepth: 2.9 },
    ],
  }],
  inlandWaterBodies: [],
});
const riverContinuationWorld = new TerrainHorizonWorld({
  innerHalfExtent: 40,
  outerHalfExtent: 720,
  settings: {
    seed: 0x12345678,
    terrainPreset: 'custom',
    topography: 45,
    hydrology: 72,
    forestDensity: 50,
  },
  riverLayout: authoredRiver,
  sampleBaseHeight: testHeight,
  sampleSourceForestBlend: () => 0.8,
});
const continuedRiver = riverContinuationWorld.waterPaths[0]?.points;
assert.ok(continuedRiver && continuedRiver.length > 2, 'authored edge river must continue into the outer world');
assert.equal(continuedRiver[0]!.x, authoredRiverEndpoint.x, 'outer water must start on the authored river endpoint');
assert.equal(continuedRiver[0]!.z, authoredRiverEndpoint.z, 'outer water must not leave a seam gap');
const authoredDirection = new THREE.Vector2(25, 3).normalize();
const continuedDirection = new THREE.Vector2(
  continuedRiver[1]!.x - continuedRiver[0]!.x,
  continuedRiver[1]!.z - continuedRiver[0]!.z,
).normalize();
assert.ok(
  authoredDirection.dot(continuedDirection) > 0.82,
  'outer water must preserve the source corridor tangent through the map edge',
);
riverContinuationWorld.dispose();

const clumpedForestWorld = new TerrainHorizonWorld({
  innerHalfExtent: 80,
  outerHalfExtent: 900,
  settings: {
    seed: 0x71a2e0d,
    terrainPreset: 'custom',
    topography: 35,
    hydrology: 0,
    forestDensity: 50,
  },
  riverLayout: null,
  sampleBaseHeight: () => 0,
  sampleSourceForestBlend: () => 0,
});
const clumpedPlacements = clumpedForestWorld.forestPlacements;
const macroCellSize = 72;
const occupiedMacroCells = new Map<string, number>();
let maximumTreeGroundBlend = 0;
for (const placement of clumpedPlacements) {
  const key = `${Math.floor(placement.x / macroCellSize)}:${Math.floor(placement.z / macroCellSize)}`;
  occupiedMacroCells.set(key, (occupiedMacroCells.get(key) ?? 0) + 1);
  maximumTreeGroundBlend = Math.max(
    maximumTreeGroundBlend,
    clumpedForestWorld.sampleForestBlend(placement.x, placement.z),
  );
}
let sampledGroundCount = 0;
let farGrassSamples = 0;
let forestFloorSamples = 0;
for (let x = -380; x <= 380; x += 20) {
  for (let z = -380; z <= 380; z += 20) {
    const outside = Math.max(Math.abs(x), Math.abs(z)) - 80;
    if (outside < 30 || outside > 290) continue;
    const blend = clumpedForestWorld.sampleForestBlend(x, z);
    sampledGroundCount++;
    if (blend < 0.05) farGrassSamples++;
    if (blend > 0.5) forestFloorSamples++;
  }
}
const occupiedCounts = [...occupiedMacroCells.values()];
const macroCellMean = clumpedPlacements.length / occupiedMacroCells.size;
assert.ok(
  clumpedForestWorld.diagnostics.forestStandCount >= 8,
  'the horizon must author multiple broad woodland stands',
);
assert.ok(
  clumpedPlacements.length >= 1_000,
  'clumping must retain a convincing outer-world tree mass',
);
assert.ok(
  Math.max(...occupiedCounts) > macroCellMean * 2,
  'tree occupancy must peak inside organic clumps instead of remaining uniform',
);
assert.ok(
  forestFloorSamples > sampledGroundCount * 0.04,
  'outer tree stands must paint a visible leaf-litter footprint',
);
assert.ok(
  farGrassSamples > sampledGroundCount * 0.25,
  'organic outer woodland must retain broad meadow openings instead of filling a square ring',
);
assert.ok(
  maximumTreeGroundBlend > 0.72,
  'dense visual-only tree clumps must share their field with the forest-floor material',
);
clumpedForestWorld.dispose();

for (let triangle = 0; triangle < horizonIndices.count; triangle += 3) {
  const a = horizonIndices.getX(triangle);
  const b = horizonIndices.getX(triangle + 1);
  const c = horizonIndices.getX(triangle + 2);
  const abX = horizonPositions.getX(b) - horizonPositions.getX(a);
  const abZ = horizonPositions.getZ(b) - horizonPositions.getZ(a);
  const acX = horizonPositions.getX(c) - horizonPositions.getX(a);
  const acZ = horizonPositions.getZ(c) - horizonPositions.getZ(a);
  assert.ok(
    abZ * acX - abX * acZ > 0,
    `triangle ${triangle / 3} must face upward`,
  );
}

const vertexBuffers = new Set<unknown>();
for (const attribute of Object.values(horizon.mesh.geometry.attributes)) {
  vertexBuffers.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute);
}
assert.ok(vertexBuffers.size <= 8, `WebGPU terrain horizon uses ${vertexBuffers.size} vertex buffers`);

const second = createHorizon(source, material);
assert.deepEqual(
  Array.from(second.mesh.geometry.getAttribute('position').array),
  Array.from(horizon.mesh.geometry.getAttribute('position').array),
  'identical seed and inputs must produce identical horizon geometry',
);
assert.deepEqual(
  second.getForestPlacements(),
  horizon.getForestPlacements(),
  'outer SeedThree placement must be deterministic',
);

const productionColors = horizon.mesh.geometry.getAttribute('color');
horizon.setDebugMode('lod');
assert.notEqual(horizon.mesh.material, material);
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('height');
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('hydrology');
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('forest');
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('wireframe');
assert.equal((horizon.mesh.material as THREE.MeshBasicMaterial).wireframe, true);
horizon.setDebugMode('final');
assert.equal(horizon.mesh.material, material);
assert.equal(horizon.mesh.geometry.getAttribute('color'), productionColors);

for (const preset of WORLD_TERRAIN_PRESETS) {
  const presetLayout = RiverLayout.create({
    bounds: {
      minX: -playableHalf,
      maxX: playableHalf,
      minZ: -playableHalf,
      maxZ: playableHalf,
    },
    seed: 0x13572468,
    riverCount: 3,
    tributaryCount: 1,
    terrainPreset: preset.id,
  });
  const presetHorizon = new TerrainHorizon({
    sourceGeometry: source,
    material,
    terrainSize: TERRAIN_SIZE,
    sourceResolution: RESOLUTION,
    farDistance: FAR_DISTANCE,
    seed: 0x13572468,
    sampleHeight: testHeight,
    settings: {
      seed: 0x13572468,
      terrainPreset: preset.id,
      topography: preset.topography,
      hydrology: preset.hydrology,
      forestDensity: preset.forestDensity,
    },
    riverLayout: presetLayout,
  });
  const evidence = presetHorizon.getDiagnostics();
  assert.ok(
    evidence.drawCalls <= TERRAIN_HORIZON_PARAMETERS.budget.maximumDrawCalls,
    `${preset.id} exceeded the horizon draw budget`,
  );
  assert.ok(
    evidence.triangleCount <= TERRAIN_HORIZON_PARAMETERS.budget.maximumTerrainTriangles,
    `${preset.id} exceeded the terrain triangle budget`,
  );
  assert.ok(
    evidence.waterTriangles <= TERRAIN_HORIZON_PARAMETERS.budget.maximumWaterTriangles,
    `${preset.id} exceeded the outer-water triangle budget`,
  );
  assert.ok(
    presetHorizon.getForestPlacements().length > 0,
    `${preset.id} should seed a dense SeedThree horizon forest`,
  );
  assert.ok(
    presetHorizon.getForestPlacements().length >= Math.min(
      TERRAIN_HORIZON_PARAMETERS.budget.maximumSeedThreeOverviewTrees,
      preset.forestDensity * 15,
    ),
    `${preset.id} should retain enough SeedThree crowns to read as regional woodland; got ${presetHorizon.getForestPlacements().length}`,
  );
  if (preset.hydrology >= 18 || preset.id === 'vinodol_coast') {
    assert.equal(evidence.waterDrawCalls, 1, `${preset.id} should render outer hydrology`);
  }
  const presetPositions = presetHorizon.mesh.geometry.getAttribute('position');
  let hasRegionalRelief = false;
  for (let vertex = 0; vertex < presetPositions.count; vertex++) {
    const x = presetPositions.getX(vertex);
    const z = presetPositions.getZ(vertex);
    if (
      Math.max(Math.abs(x), Math.abs(z)) > playableHalf + 120
      && Math.abs(presetPositions.getY(vertex) - testHeight(x, z)) > 0.2
    ) {
      hasRegionalRelief = true;
      break;
    }
  }
  assert.ok(hasRegionalRelief, `${preset.id} should add topology beyond the seam`);
  presetHorizon.dispose();
}

const requiredAttributes = [
  'position',
  'normal',
  'uv',
  'uv2',
  'color',
  'forestBlend',
  'shoreBlend',
  'quarryPadBlend',
  'roadWearBlend',
  'dirtZoomGate',
  'forestCanopyOcclusion',
];
for (const attribute of requiredAttributes) {
  assert.ok(horizon.mesh.geometry.getAttribute(attribute), `missing production material attribute ${attribute}`);
}

second.dispose();
horizon.dispose();
source.dispose();
material.dispose();

console.log('Terrain horizon LOD tests passed.');
