import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  KUPA_BANK_TO_WATER_DROP_METERS,
  KUPA_MIN_CHANNEL_WATER_DEPTH_METERS,
  RiverLayout,
  type RiverPoint,
} from '../src/rivers/RiverLayout.ts';
import { RiverField } from '../src/rivers/RiverField.ts';
import {
  computeRiverRockRapidFoam,
  createRiverChannelRockPlacements,
  getRiverChannelRockContactRadius,
  RIVER_CHANNEL_ROCK_LIMIT,
  RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
  RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
} from '../src/rivers/RiverChannelRocks.ts';
import { createRiverWaterShoreMaps } from '../src/rivers/riverWaterShoreMaps.ts';
import {
  createRiverBankMeshes,
  KUPA_BANK_PRESENTATION_TOP_RADIUS,
} from '../src/rivers/RiverBankMesh.ts';
import { createRiverWaterMesh } from '../src/rivers/RiverWaterMesh.ts';
import { sampleWorldRawTerrainHeight } from '../src/terrain/TerrainHeight.ts';
import { TERRAIN_RESOLUTION } from '../src/terrain/terrainGeometryData.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  resolveWorldDimensions,
  type WorldDimensions,
  type WorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';

const bounds = { minX: -540, maxX: 540, minZ: -540, maxZ: 540 };
const seed = 0x13d4_a21;
const layout = RiverLayout.create({ bounds, seed, terrainPreset: 'kupa_valley' });
const fieldStartedAt = performance.now();
const field = RiverField.fromLayout({ bounds, layout });
const fieldElapsedMs = performance.now() - fieldStartedAt;
const corridor = layout.corridors[0];

for (const progress of [0.12, 0.33, 0.5, 0.68, 0.88]) {
  const index = Math.round(progress * (corridor.points.length - 1));
  const point = corridor.points[index];
  const tangent = corridorTangent(corridor.points, index);
  const cross = { x: -tangent.z, z: tangent.x };
  const centerCarve = layout.getValleyDepression(point.x, point.z);
  const centerWaterDepth = layout.getWaterColumnDepth(point.x, point.z);
  assert.ok(centerWaterDepth !== null);
  assert.ok(
    centerWaterDepth >= KUPA_MIN_CHANNEL_WATER_DEPTH_METERS - 1e-9,
    `Kupa thalweg must retain at least ${KUPA_MIN_CHANNEL_WATER_DEPTH_METERS} m of water`,
  );
  assert.ok(
    Math.abs(
      centerCarve - centerWaterDepth - KUPA_BANK_TO_WATER_DROP_METERS
    ) < 1e-9,
    'the center water surface must remain exactly 3.2 m below the adjacent bank datum',
  );

  let furthestWetRadius = 0;
  let shallowestWetSurfaceDrop = Number.POSITIVE_INFINITY;
  for (let side = -1; side <= 1; side += 2) {
    for (let radius = 0; radius <= 0.76; radius += 0.01) {
      const x = point.x + cross.x * point.halfWidth * radius * side;
      const z = point.z + cross.z * point.halfWidth * radius * side;
      if (!field.isRenderedWetAt(x, z)) continue;
      furthestWetRadius = Math.max(furthestWetRadius, radius);
      const carve = layout.getValleyDepression(x, z);
      const depth = layout.getWaterColumnDepth(x, z);
      assert.ok(depth !== null);
      shallowestWetSurfaceDrop = Math.min(shallowestWetSurfaceDrop, carve - depth);
    }
  }
  assert.ok(
    furthestWetRadius <= 0.56,
    `rendered Kupa water must stop at the authored lower bank, got radius ${furthestWetRadius}`,
  );
  assert.ok(
    shallowestWetSurfaceDrop >= KUPA_BANK_TO_WATER_DROP_METERS - 0.22,
    `rendered water must not climb the bank ramp, got ${shallowestWetSurfaceDrop.toFixed(2)} m drop`,
  );

  const bankTopX = point.x + cross.x * point.halfWidth * 0.72;
  const bankTopZ = point.z + cross.z * point.halfWidth * 0.72;
  assert.ok(
    layout.getValleyDepression(bankTopX, bankTopZ) <= 1e-9,
    'the dry bank must finish climbing back to the terrain datum',
  );
}

// The production field stays 512² as world size grows. Validate the
// continuous authored clip instead of allowing nearest-cell half-widths to
// turn into several metres of water film on medium and large banks.
let largePresentationField: RiverField | null = null;
let largePresentationBedAt: ((x: number, z: number) => number) | null = null;
let minimumProductionDepth = Number.POSITIVE_INFINITY;
let minimumBakedBankRelief = Number.POSITIVE_INFINITY;
let maximumHydraulicRise = Number.NEGATIVE_INFINITY;
for (const mapSize of ['small', 'medium', 'large'] as const) {
  const dimensions = resolveWorldDimensions(mapSize);
  const terrainSize = dimensions.terrainSize;
  for (const scaleSeed of [seed, seed ^ 0x5e17_93b, 0x23e3_c53]) {
    const scaleBounds = {
      minX: -terrainSize * 0.5,
      maxX: terrainSize * 0.5,
      minZ: -terrainSize * 0.5,
      maxZ: terrainSize * 0.5,
    };
    const scaleLayout = RiverLayout.create({
      bounds: scaleBounds,
      seed: scaleSeed,
      terrainPreset: 'kupa_valley',
    });
    const scaleField = RiverField.fromLayout({
      bounds: scaleBounds,
      layout: scaleLayout,
    });
    const settings: WorldGenerationSettings = {
      ...DEFAULT_WORLD_GENERATION_SETTINGS,
      mapSize,
      seed: scaleSeed,
      terrainPreset: 'kupa_valley',
    };
    const productionBedAt = createProductionBedSampler(
      scaleLayout,
      settings,
      dimensions,
    );
    if (mapSize === 'large' && scaleSeed === 0x23e3_c53) {
      largePresentationField = scaleField;
      largePresentationBedAt = productionBedAt;
    }
    const scaleCorridor = scaleLayout.corridors[0];

    let previousSurface = Number.POSITIVE_INFINITY;
    for (let pointIndex = 0; pointIndex < scaleCorridor.points.length; pointIndex += 1) {
      const point = scaleCorridor.points[pointIndex];
      const surface = scaleLayout.getWaterSurfaceOverride(point.x, point.z);
      assert.ok(surface !== null, 'every Kupa centerline point needs an authored hydraulic surface');
      maximumHydraulicRise = Math.max(maximumHydraulicRise, surface - previousSurface);
      assert.ok(
        surface < previousSurface,
        `${mapSize} baked Kupa surface must fall at every downstream segment`,
      );
      previousSurface = surface;
      const tangent = corridorTangent(scaleCorridor.points, pointIndex);
      const cross = { x: -tangent.z, z: tangent.x };
      for (const floorRadius of [-0.24, 0, 0.24]) {
        const floorX = point.x + cross.x * point.halfWidth * floorRadius;
        const floorZ = point.z + cross.z * point.halfWidth * floorRadius;
        const floorSurface = scaleLayout.getWaterSurfaceOverride(floorX, floorZ);
        assert.ok(floorSurface !== null);
        const depth = floorSurface - productionBedAt(floorX, floorZ);
        minimumProductionDepth = Math.min(minimumProductionDepth, depth);
        assert.ok(
          depth >= 2,
          `${mapSize} production-grid channel-floor depth fell to ${depth.toFixed(3)} m`,
        );
      }
    }

    for (const progress of [0.14, 0.34, 0.52, 0.7, 0.86]) {
      const pointIndex = Math.round(progress * (scaleCorridor.points.length - 1));
      const point = scaleCorridor.points[pointIndex];
      const tangent = corridorTangent(scaleCorridor.points, pointIndex);
      const cross = { x: -tangent.z, z: tangent.x };
      const waterSurface = scaleLayout.getWaterSurfaceOverride(point.x, point.z);
      assert.ok(waterSurface !== null);
      for (const side of [-1, 1]) {
        const bankRadius = KUPA_BANK_PRESENTATION_TOP_RADIUS;
        const bankX = point.x + cross.x * point.halfWidth * bankRadius * side;
        const bankZ = point.z + cross.z * point.halfWidth * bankRadius * side;
        const relief = productionBedAt(bankX, bankZ) - waterSurface;
        minimumBakedBankRelief = Math.min(minimumBakedBankRelief, relief);
        assert.ok(
          relief >= 3,
          `${mapSize} baked bank top fell to ${relief.toFixed(3)} m above the Kupa`,
        );
      }
      let furthestGameplayWetRadius = 0;
      let furthestMeshClipRadius = 0;
      let shallowestSurfaceDrop = Number.POSITIVE_INFINITY;

      for (let side = -1; side <= 1; side += 2) {
        for (let radius = 0; radius <= 0.72; radius += 0.0025) {
          const x = point.x + cross.x * point.halfWidth * radius * side;
          const z = point.z + cross.z * point.halfWidth * radius * side;
          if (scaleField.isRenderedWetAt(x, z)) {
            furthestGameplayWetRadius = Math.max(furthestGameplayWetRadius, radius);
            const carve = scaleLayout.getValleyDepression(x, z);
            const depth = scaleLayout.getWaterColumnDepth(x, z);
            assert.ok(depth !== null);
            shallowestSurfaceDrop = Math.min(shallowestSurfaceDrop, carve - depth);
          }
          if (sampleKupaMeshClipMask(scaleField, x, z) >= 0.38) {
            furthestMeshClipRadius = Math.max(furthestMeshClipRadius, radius);
          }
        }
      }

      assert.ok(
        furthestGameplayWetRadius <= 0.535,
        `${mapSize} Kupa gameplay water climbed to r=${furthestGameplayWetRadius.toFixed(3)}`,
      );
      assert.ok(
        furthestMeshClipRadius <= 0.55,
        `${mapSize} Kupa mesh clip climbed to r=${furthestMeshClipRadius.toFixed(3)}`,
      );
      assert.ok(
        shallowestSurfaceDrop >= 3,
        `${mapSize} Kupa bank-to-surface drop fell to ${shallowestSurfaceDrop.toFixed(2)} m`,
      );
    }
  }
}

assert.ok(largePresentationField);
assert.ok(largePresentationBedAt);
const waterGroup = new THREE.Group();
const waterController = createRiverWaterMesh(
  waterGroup,
  { getHeightAt: largePresentationBedAt } as never,
  largePresentationField,
);
assert.ok(waterController);
const waterMesh = waterGroup.children.find((child) => child.userData.water) as THREE.Mesh;
assert.ok(waterMesh);
const waterPositions = waterMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
const waterIndices = waterMesh.geometry.getIndex();
assert.ok(waterIndices);
let minimumGeneratedMeshMask = Number.POSITIVE_INFINITY;
const auditMeshPoint = (x: number, z: number): void => {
  const mask = largePresentationField.layout.sampleRiverMask(x, z);
  minimumGeneratedMeshMask = Math.min(minimumGeneratedMeshMask, mask);
  assert.ok(mask >= 0.375, `generated Kupa water edge crossed dry mask ${mask.toFixed(5)}`);
};
for (let index = 0; index < waterPositions.count; index += 1) {
  auditMeshPoint(waterPositions.getX(index), waterPositions.getZ(index));
}
for (let offset = 0; offset < waterIndices.count; offset += 3) {
  const ia = waterIndices.getX(offset);
  const ib = waterIndices.getX(offset + 1);
  const ic = waterIndices.getX(offset + 2);
  const ax = waterPositions.getX(ia);
  const az = waterPositions.getZ(ia);
  const bx = waterPositions.getX(ib);
  const bz = waterPositions.getZ(ib);
  const cx = waterPositions.getX(ic);
  const cz = waterPositions.getZ(ic);
  auditMeshPoint((ax + bx) * 0.5, (az + bz) * 0.5);
  auditMeshPoint((bx + cx) * 0.5, (bz + cz) * 0.5);
  auditMeshPoint((cx + ax) * 0.5, (cz + az) * 0.5);
  auditMeshPoint((ax + bx + cx) / 3, (az + bz + cz) / 3);
}
assert.ok(waterIndices.count / 3 <= 35_000, 'analytic boundary refinement exceeded its mesh budget');
waterController.dispose();
const bankGroup = createRiverBankMeshes(
  { getHeightAt: largePresentationBedAt } as never,
  largePresentationField,
  new THREE.MeshBasicMaterial() as never,
);
const bankMesh = bankGroup.children[0] as THREE.Mesh;
const bankPositions = bankMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
const bankUvs = bankMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
let bankInnerVertices = 0;
let bankOuterVertices = 0;
let minimumGeneratedBankRelief = Number.POSITIVE_INFINITY;
for (let index = 0; index < bankPositions.count; index += 1) {
  if (bankUvs.getX(index) >= 0.99) {
    bankInnerVertices += 1;
    assert.ok(
      largePresentationField.layout.sampleRiverMask(
        bankPositions.getX(index),
        bankPositions.getZ(index),
      ) < 0.38,
      'the carbonate bank overlay must begin on the dry side of the analytic Kupa waterline',
    );
  }
  if (bankUvs.getX(index) > 0.001) continue;
  bankOuterVertices += 1;
  const x = bankPositions.getX(index);
  const z = bankPositions.getZ(index);
  const surface = largePresentationField.layout.getWaterSurfaceOverride(x, z);
  assert.ok(surface !== null);
  const relief = bankPositions.getY(index) - surface;
  minimumGeneratedBankRelief = Math.min(minimumGeneratedBankRelief, relief);
  assert.ok(
    relief >= 3,
    `generated carbonate bank crest fell to ${relief.toFixed(3)} m above the Kupa`,
  );
}
assert.ok(bankInnerVertices > 0);
assert.ok(bankOuterVertices > 0);
bankMesh.geometry.dispose();
(bankMesh.material as THREE.Material).dispose();

const largeCorridor = largePresentationField.layout.corridors[0];
const largePointIndex = Math.floor(largeCorridor.points.length * 0.5);
const largePoint = largeCorridor.points[largePointIndex];
const largeTangent = corridorTangent(largeCorridor.points, largePointIndex);
const largeCross = { x: -largeTangent.z, z: largeTangent.x };
const dryClearancePoint = {
  x: largePoint.x + largeCross.x * largePoint.halfWidth * 0.66,
  z: largePoint.z + largeCross.z * largePoint.halfWidth * 0.66,
};
assert.equal(
  largePresentationField.renderedWaterTouchesDisk(
    dryClearancePoint.x,
    dryClearancePoint.z,
    1,
  ),
  false,
  'large-map disk clearance must not inherit a half-cell of water up the bank',
);
assert.equal(
  largePresentationField.renderedWaterMayTouchPolyline(
    [
      {
        x: largePoint.x - largeCross.x * largePoint.halfWidth * 0.8,
        z: largePoint.z - largeCross.z * largePoint.halfWidth * 0.8,
      },
      {
        x: largePoint.x + largeCross.x * largePoint.halfWidth * 0.8,
        z: largePoint.z + largeCross.z * largePoint.halfWidth * 0.8,
      },
    ],
    0.8,
  ),
  true,
  'analytic route clearance must still detect a path that crosses the Kupa',
);

const largeRocks = createRiverChannelRockPlacements(largePresentationField);
assert.ok(largeRocks.some((rock) => rock.rapidEnergy === 0));
assert.ok(largeRocks.some((rock) => rock.rapidEnergy >= 0.8));
assert.ok(largeRocks.every((rock) => rock.flowSpeed > 0));
const largeMaps = createRiverWaterShoreMaps(largePresentationField);
assert.equal(largeMaps.resolution, 1024);
const largeMapPixels = largeMaps.shoreTexture.image.data as Uint8Array;
assert.equal(largeMapPixels.byteLength, 4 * 1024 * 1024);
for (const rock of largeRocks) {
  if (rock.rapidEnergy <= 0.001) continue;
  assert.ok(
    peakRapidSourceNearRock(
      largePresentationField,
      largeMaps.resolution!,
      largeMapPixels,
      rock,
    ) > 0,
    'every sufficiently energetic large-map boulder must survive packed-field sampling',
  );
}
largeMaps.shoreTexture.dispose();

const rockStartedAt = performance.now();
const rocks = createRiverChannelRockPlacements(field);
const repeatedRocks = createRiverChannelRockPlacements(field);
const rockElapsedMs = performance.now() - rockStartedAt;
assert.deepEqual(rocks, repeatedRocks, 'channel-rock placement must be deterministic');
assert.ok(rocks.length >= 24, 'the broad Kupa channel must contain authored boulder stations');
assert.ok(rocks.length <= RIVER_CHANNEL_ROCK_LIMIT);
assert.ok(rocks.every((rock) => field.isRenderedWetAt(rock.x, rock.z)));
assert.ok(rocks.some((rock) => rock.rapidEnergy === 0));
assert.ok(rocks.some((rock) => rock.rapidEnergy >= 0.8));
assert.ok(rocks.every((rock) => rock.flowSpeed > 0));

const stationSides = new Map<string, -1 | 1>();
for (const rock of rocks) {
  const key = `${rock.corridor}:${rock.station}`;
  const previousSide = stationSides.get(key);
  if (previousSide !== undefined) {
    assert.equal(
      rock.side,
      previousSide,
      'one boulder station may occupy only one side so the opposite flow branch stays open',
    );
  } else {
    stationSides.set(key, rock.side);
  }
  assert.ok(
    rock.halfWidth >= rock.scale * 6,
    'each boulder must leave a broad navigable branch around its station',
  );
}
assert.ok(
  hasOpenFlowPath(
    field,
    rocks,
    corridor.points[3],
    corridor.points[corridor.points.length - 4],
  ),
  'eroding every rendered boulder footprint must still leave a continuous upstream-to-downstream flow path',
);

const heroRock = rocks.find((rock) => rock.scale >= 1.1) ?? rocks[0];
assert.ok(heroRock);
const radius = getRiverChannelRockContactRadius(heroRock.scale);
const contactFoam = computeRiverRockRapidFoam(
  heroRock,
  heroRock.x - heroRock.flowX * radius,
  heroRock.z - heroRock.flowZ * radius,
);
const wakeLength = Math.max(
  RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
  heroRock.scale * RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
);
const wakeProgress = 0.28;
const wakeCross = radius * (0.92 - wakeProgress * 0.58);
const wakeFoam = computeRiverRockRapidFoam(
  heroRock,
  heroRock.x
    + heroRock.flowX * wakeLength * wakeProgress
    - heroRock.flowZ * wakeCross,
  heroRock.z
    + heroRock.flowZ * wakeLength * wakeProgress
    + heroRock.flowX * wakeCross,
);
const upstreamFoam = computeRiverRockRapidFoam(
  heroRock,
  heroRock.x - heroRock.flowX * 30,
  heroRock.z - heroRock.flowZ * 30,
);
assert.ok(contactFoam >= 0.65, 'rock contact must generate attached whitewater');
assert.ok(wakeFoam >= 0.4, 'the downstream split strand must retain mobile-foam energy');
assert.equal(upstreamFoam, 0, 'foam must not travel upstream from its obstacle');

const mapStartedAt = performance.now();
const maps = createRiverWaterShoreMaps(field);
const mapElapsedMs = performance.now() - mapStartedAt;
assert.equal(maps.channelRockCount, rocks.length);
const pixels = maps.shoreTexture.image.data as Uint8Array;
const hydraulicPixels = maps.hydraulicTexture!.image.data as Uint16Array;
const cellMeters = (field.stepX + field.stepZ) * 0.5;
for (let i=0;i<field.organicSignedDistance.length;i+=127) {
  const expected=field.organicSignedDistance[i]! * cellMeters;
  const actual=THREE.DataUtils.fromHalfFloat(hydraulicPixels[i*4+3]!);
  assert.ok(Math.abs(actual-expected)<=Math.max(0.002,Math.abs(expected)*0.001),
    'hydraulic shore distance must use metres, including half-float rounding');
}
let rapidPixels = 0;
let peakRapid = 0;
for (let index = 1; index < pixels.length; index += 4) {
  const rapid = pixels[index];
  if (rapid > 18) rapidPixels += 1;
  peakRapid = Math.max(peakRapid, rapid);
}
assert.ok(rapidPixels >= rocks.length, 'every channel-rock budget must reach the packed foam field');
assert.ok(peakRapid >= 180, 'the packed field must preserve strong rock-contact energy');
assert.equal(
  pixels.byteLength,
  field.resolution * field.resolution * 4,
  'shore, rapid source, and flow must remain one RGBA8 lookup',
);
maps.shoreTexture.dispose();
maps.hydraulicTexture!.dispose();

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const waterMaterialSource = readFileSync(
  `${projectRoot}src/rivers/RiverWaterMaterial.ts`,
  'utf8',
);
const surfaceMapSource = readFileSync(
  `${projectRoot}src/rivers/riverWaterShoreMaps.ts`,
  'utf8',
);
const rockSource = readFileSync(
  `${projectRoot}src/rivers/RiverShoreStones.ts`,
  'utf8',
);
const textureSource = readFileSync(
  `${projectRoot}src/utils/propTextureLoad.ts`,
  'utf8',
);
assert.match(waterMaterialSource, /buildWaterOptics/);
assert.match(surfaceMapSource, /deflectWaterAroundRock/);
assert.match(surfaceMapSource, /hydraulicTexture/);
assert.match(
  surfaceMapSource,
  /RAPID_SOURCE_TEXEL_TAPS[\s\S]*?Math\.sqrt\(peak \* coverage\)/,
  'packed obstacle wakes must use coverage-aware sub-texel sampling',
);
assert.doesNotMatch(
  surfaceMapSource,
  /Math\.max\(0\.22,[\s\S]*?weight/,
  'packed obstacle wakes must not restore the repeated four-texel rectangle splat',
);
assert.match(rockSource, /new THREE\.InstancedMesh/);
assert.match(rockSource, /writeCarbonateMossVertexColors/);
assert.match(rockSource, /shoreMoisture/);
assert.match(textureSource, /gorski_river_stone_v1/);

console.log('Kupa river presentation contract passed', {
  bankDropMeters: KUPA_BANK_TO_WATER_DROP_METERS,
  minimumWaterDepthMeters: KUPA_MIN_CHANNEL_WATER_DEPTH_METERS,
  channelRocks: rocks.length,
  rapidPixels,
  peakRapid,
  fieldBuildMs: Number(fieldElapsedMs.toFixed(1)),
  deterministicRockAndRepeatMs: Number(rockElapsedMs.toFixed(1)),
  packedRapidMapMs: Number(mapElapsedMs.toFixed(1)),
  packedMapMiB: Number((pixels.byteLength / (1024 * 1024)).toFixed(2)),
  minimumProductionDepthMeters: Number(minimumProductionDepth.toFixed(3)),
  minimumBakedBankReliefMeters: Number(minimumBakedBankRelief.toFixed(3)),
  minimumGeneratedBankReliefMeters: Number(minimumGeneratedBankRelief.toFixed(3)),
  maximumHydraulicRiseMeters: Number(maximumHydraulicRise.toFixed(6)),
  minimumGeneratedMeshMask: Number(minimumGeneratedMeshMask.toFixed(5)),
});

function createProductionBedSampler(
  layout: RiverLayout,
  settings: WorldGenerationSettings,
  dimensions: WorldDimensions,
): (x: number, z: number) => number {
  const step = dimensions.terrainSize / (TERRAIN_RESOLUTION - 1);
  const half = dimensions.terrainSize * 0.5;
  const heightCache = new Map<number, number>();
  const heightAtGrid = (ix: number, iz: number): number => {
    const key = iz * TERRAIN_RESOLUTION + ix;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const x = -half + ix * step;
    const z = -half + iz * step;
    const height = sampleWorldRawTerrainHeight(
      x,
      z,
      settings,
      dimensions,
      layout,
    ) - layout.getValleyDepression(x, z);
    heightCache.set(key, height);
    return height;
  };

  return (x: number, z: number): number => {
    const gx = Math.max(0, Math.min(TERRAIN_RESOLUTION - 1, (x + half) / step));
    const gz = Math.max(0, Math.min(TERRAIN_RESOLUTION - 1, (z + half) / step));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(TERRAIN_RESOLUTION - 1, x0 + 1);
    const z1 = Math.min(TERRAIN_RESOLUTION - 1, z0 + 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const bottom = heightAtGrid(x0, z0) * (1 - tx) + heightAtGrid(x1, z0) * tx;
    const top = heightAtGrid(x0, z1) * (1 - tx) + heightAtGrid(x1, z1) * tx;
    return bottom * (1 - tz) + top * tz;
  };
}

function corridorTangent(points: readonly RiverPoint[], index: number): { x: number; z: number } {
  const previous = points[Math.max(0, index - 2)];
  const next = points[Math.min(points.length - 1, index + 2)];
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const length = Math.max(1e-9, Math.hypot(dx, dz));
  return { x: dx / length, z: dz / length };
}

function hasOpenFlowPath(
  riverField: RiverField,
  channelRocks: ReturnType<typeof createRiverChannelRockPlacements>,
  upstream: RiverPoint,
  downstream: RiverPoint,
): boolean {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;
  const blocked = new Uint8Array(resolution * resolution);
  for (const rock of channelRocks) {
    const radius = getRiverChannelRockContactRadius(rock.scale) * 1.08;
    const centerX = (rock.x - startX) / stepX;
    const centerZ = (rock.z - startZ) / stepZ;
    const reachX = Math.ceil(radius / stepX);
    const reachZ = Math.ceil(radius / stepZ);
    for (let iz = Math.max(0, Math.floor(centerZ) - reachZ);
      iz <= Math.min(resolution - 1, Math.ceil(centerZ) + reachZ);
      iz += 1) {
      for (let ix = Math.max(0, Math.floor(centerX) - reachX);
        ix <= Math.min(resolution - 1, Math.ceil(centerX) + reachX);
        ix += 1) {
        const x = startX + ix * stepX;
        const z = startZ + iz * stepZ;
        if ((x - rock.x) ** 2 + (z - rock.z) ** 2 <= radius ** 2) {
          blocked[iz * resolution + ix] = 1;
        }
      }
    }
  }

  const findOpenWet = (point: RiverPoint): number => {
    const centerX = Math.round((point.x - startX) / stepX);
    const centerZ = Math.round((point.z - startZ) / stepZ);
    for (let radius = 0; radius <= 10; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const ix = centerX + dx;
          const iz = centerZ + dz;
          if (ix < 0 || iz < 0 || ix >= resolution || iz >= resolution) continue;
          const index = iz * resolution + ix;
          if (blocked[index] !== 0) continue;
          if (!riverField.isRenderedWetAtGrid(ix, iz)) continue;
          return index;
        }
      }
    }
    return -1;
  };

  const start = findOpenWet(upstream);
  const target = findOpenWet(downstream);
  if (start < 0 || target < 0) return false;
  const visited = new Uint8Array(resolution * resolution);
  const queue = new Int32Array(resolution * resolution);
  let read = 0;
  let write = 0;
  visited[start] = 1;
  queue[write++] = start;
  const neighbors = [-1, 1, -resolution, resolution] as const;

  while (read < write) {
    const index = queue[read++];
    if (index === target) return true;
    const ix = index % resolution;
    for (const delta of neighbors) {
      const next = index + delta;
      if (next < 0 || next >= visited.length || visited[next] !== 0) continue;
      if (delta === -1 && ix === 0) continue;
      if (delta === 1 && ix === resolution - 1) continue;
      const nextX = next % resolution;
      const nextZ = Math.floor(next / resolution);
      if (blocked[next] !== 0 || !riverField.isRenderedWetAtGrid(nextX, nextZ)) continue;
      visited[next] = 1;
      queue[write++] = next;
    }
  }
  return false;
}

function sampleKupaMeshClipMask(
  riverField: RiverField,
  x: number,
  z: number,
): number {
  const gx = Math.max(0, Math.min(
    riverField.resolution - 1,
    (x - riverField.startX) / riverField.stepX,
  ));
  const gz = Math.max(0, Math.min(
    riverField.resolution - 1,
    (z - riverField.startZ) / riverField.stepZ,
  ));
  const ix0 = Math.floor(gx);
  const iz0 = Math.floor(gz);
  const ix1 = Math.min(riverField.resolution - 1, ix0 + 1);
  const iz1 = Math.min(riverField.resolution - 1, iz0 + 1);
  const tx = gx - ix0;
  const tz = gz - iz0;
  const sample = (ix: number, iz: number): number => riverField.layout.sampleRiverMask(
    riverField.startX + ix * riverField.stepX,
    riverField.startZ + iz * riverField.stepZ,
  );
  const bottom = sample(ix0, iz0) * (1 - tx) + sample(ix1, iz0) * tx;
  const top = sample(ix0, iz1) * (1 - tx) + sample(ix1, iz1) * tx;
  return bottom * (1 - tz) + top * tz;
}

function peakRapidSourceNearRock(
  riverField: RiverField,
  resolution: number,
  pixels: Uint8Array,
  rock: ReturnType<typeof createRiverChannelRockPlacements>[number],
): number {
  const stepX = riverField.spanX / (resolution - 1);
  const stepZ = riverField.spanZ / (resolution - 1);
  const reach = Math.max(
    RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
    rock.scale * RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
  ) + rock.scale * 2.2 + 3;
  const gx = (rock.x - riverField.startX) / stepX;
  const gz = (rock.z - riverField.startZ) / stepZ;
  const reachX = Math.ceil(reach / stepX);
  const reachZ = Math.ceil(reach / stepZ);
  let peak = 0;
  for (let iz = Math.max(0, Math.floor(gz) - reachZ);
    iz <= Math.min(resolution - 1, Math.ceil(gz) + reachZ);
    iz += 1) {
    for (let ix = Math.max(0, Math.floor(gx) - reachX);
      ix <= Math.min(resolution - 1, Math.ceil(gx) + reachX);
      ix += 1) {
      peak = Math.max(peak, pixels[(iz * resolution + ix) * 4 + 1]);
    }
  }
  return peak;
}
