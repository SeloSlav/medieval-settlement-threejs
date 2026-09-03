import * as THREE from 'three';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import { fbm2, mulberry32 } from '../props/forestField.ts';
import {
  RiverLayout,
  type InlandWaterBody,
  type RiverCorridor,
  type RiverPoint,
} from '../rivers/RiverLayout.ts';
import {
  computeWaterFeatherAlpha,
  disposeRiverWaterShoreMaps,
  encodeWaterFlowDirection,
  type RiverWaterShoreMaps,
} from '../rivers/riverWaterShoreMaps.ts';
import { createRiverWaterMaterial } from '../rivers/RiverWaterMaterial.ts';
import { waterSurfaceProfileForPreset } from '../rivers/WaterSurfaceProfile.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';

export type TerrainHorizonWorldSettings = Pick<
  WorldGenerationSettings,
  'seed' | 'terrainPreset' | 'topography' | 'hydrology' | 'forestDensity'
>;

export type TerrainHorizonWorldDiagnostics = {
  topologyAmplitudeMeters: number;
  hydrologyPaths: number;
  hydrologyLakes: number;
  waterTriangles: number;
  waterDrawCalls: 0 | 1;
  seedThreeOverviewTrees: number;
  seedThreeNearTrees: 0;
  seedThreeShadowTrees: 0;
};

export type TerrainHorizonWorldOptions = {
  innerHalfExtent: number;
  outerHalfExtent: number;
  settings: TerrainHorizonWorldSettings;
  riverLayout: RiverLayout | null;
  sampleBaseHeight: (x: number, z: number) => number;
  sampleSourceForestBlend?: (x: number, z: number) => number;
};

type HorizonWaterPoint = RiverPoint & { surfaceY: number };
type HorizonWaterPath = { points: HorizonWaterPoint[] };
type HorizonLake = InlandWaterBody & { surfaceY: number };

const WATER_PATH_SPACING = 82;
const WATER_FIELD_RESOLUTION = 256;
const MAX_WATER_PATHS = 4;
const MAX_SEEDTHREE_OVERVIEW_TREES = 7_200;
const FOREST_SEAM_CLEARANCE = 18;
const FOREST_MINIMUM_SPACING = 16;
const WATER_VERTEX_COLUMNS = [-1, -0.44, 0.44, 1] as const;
const WATER_VERTEX_FEATHER = [0.08, 1, 1, 0.08] as const;
const WATER_VERTEX_FOAM = [0.85, 0.12, 0.12, 0.85] as const;

/**
 * Immutable regional fields and scenery used only by the terrain horizon.
 * Hydrology is authored with RiverLayout/RiverField and the production river
 * shader. Trees are returned as overview-only placements for SeedThree to
 * batch into the real forest; this class never creates substitute tree art.
 */
export class TerrainHorizonWorld {
  readonly waterMesh: THREE.Mesh | null;
  readonly forestPlacements: readonly ForestTreePlacement[];
  readonly diagnostics: TerrainHorizonWorldDiagnostics;

  readonly innerHalfExtent: number;
  readonly outerHalfExtent: number;
  readonly extensionDistance: number;
  readonly settings: TerrainHorizonWorldSettings;
  private readonly sourceRiverLayout: RiverLayout | null;
  private readonly sampleBaseHeight: (x: number, z: number) => number;
  private readonly sampleSourceForestBlend: (x: number, z: number) => number;
  readonly waterPaths: HorizonWaterPath[];
  readonly lakes: HorizonLake[];
  private readonly outerRiverLayout: RiverLayout | null;
  private readonly waterMaterial: THREE.Material | null;
  private readonly shoreMaps: RiverWaterShoreMaps | null;
  private readonly topologyAmplitudeMeters: number;

  constructor(options: TerrainHorizonWorldOptions) {
    this.innerHalfExtent = options.innerHalfExtent;
    this.outerHalfExtent = options.outerHalfExtent;
    this.extensionDistance = options.outerHalfExtent - options.innerHalfExtent;
    this.settings = options.settings;
    this.sourceRiverLayout = options.riverLayout;
    this.sampleBaseHeight = options.sampleBaseHeight;
    this.sampleSourceForestBlend = options.sampleSourceForestBlend ?? (() => 0);
    this.topologyAmplitudeMeters = regionalTopologyAmplitude(options.settings);

    const pathSkeletons = createOuterWaterPathSkeletons(options);
    this.waterPaths = pathSkeletons.map((corridor) => this.resolveWaterPath(corridor));
    this.lakes = createOuterLakes(options, (x, z) => this.sampleUncarvedHeight(x, z));
    this.outerRiverLayout = createOuterRiverLayout(options, this.waterPaths, this.lakes);

    const waterGeometry = createOuterWaterGeometry(this, options);
    if (waterGeometry.getIndex()?.count) {
      this.shoreMaps = options.settings.terrainPreset === 'vinodol_coast'
        ? createCoastalShoreMaps(options)
        : this.outerRiverLayout
          ? createHorizonRiverFlowMaps(this, options)
          : null;
      if (!this.shoreMaps) {
        waterGeometry.dispose();
        this.waterMesh = null;
        this.waterMaterial = null;
      } else {
        this.waterMaterial = createRiverWaterMaterial(
          this.shoreMaps,
          waterSurfaceProfileForPreset(options.settings.terrainPreset),
        );
        this.waterMaterial.name = `Distant ${this.waterMaterial.name}`;
        this.waterMaterial.userData.terrainHorizon = true;
        this.waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);
        this.waterMesh.name = 'Outer-world water (static project river renderer)';
        this.waterMesh.castShadow = false;
        this.waterMesh.receiveShadow = false;
        this.waterMesh.renderOrder = 1.24;
        this.waterMesh.matrixAutoUpdate = false;
        this.waterMesh.updateMatrix();
        this.waterMesh.raycast = () => {};
        this.waterMesh.userData.gameplay = false;
        this.waterMesh.userData.terrainHorizon = true;
        this.waterMesh.userData.usesProjectRiverLayout = true;
        this.waterMesh.userData.updatesPerFrame = false;
      }
    } else {
      waterGeometry.dispose();
      this.waterMesh = null;
      this.waterMaterial = null;
      this.shoreMaps = null;
    }

    this.forestPlacements = createSeedThreeHorizonPlacements(this);
    const waterTriangles = this.waterMesh?.geometry.getIndex()?.count
      ? this.waterMesh.geometry.getIndex()!.count / 3
      : 0;
    this.diagnostics = {
      topologyAmplitudeMeters: this.topologyAmplitudeMeters,
      hydrologyPaths: this.waterPaths.length,
      hydrologyLakes: this.lakes.length,
      waterTriangles,
      waterDrawCalls: this.waterMesh ? 1 : 0,
      seedThreeOverviewTrees: this.forestPlacements.length,
      seedThreeNearTrees: 0,
      seedThreeShadowTrees: 0,
    };
  }

  getHeightAt = (x: number, z: number): number => {
    let height = this.sampleUncarvedHeight(x, z);
    if (this.outerRiverLayout) {
      height -= this.outerRiverLayout.getValleyDepression(x, z);
    }
    const path = nearestWaterPathSample(this.waterPaths, x, z);
    if (path && path.distance < path.halfWidth * 0.86) {
      const bedDepth = THREE.MathUtils.lerp(
        Math.max(1.15, path.channelDepth * 0.54),
        0.16,
        smoothstep(path.halfWidth * 0.32, path.halfWidth * 0.86, path.distance),
      );
      height = Math.min(height, path.surfaceY - bedDepth);
    }
    for (const lake of this.lakes) {
      const radius = ellipseRadiusAt(lake, x, z);
      if (radius >= 1.08) continue;
      const floor = lake.surfaceY - lake.depth * (1 - smoothstep(0.42, 1.08, radius));
      height = Math.min(height, floor);
    }
    return height;
  };

  sampleForestBlend = (x: number, z: number): number => {
    const suitability = this.sampleForestSuitability(x, z);
    return smoothstep(0.56, 0.78, suitability) * 0.9;
  };

  sampleShoreBlend = (x: number, z: number): number => {
    if (this.settings.terrainPreset === 'vinodol_coast') {
      const shoreX = this.sourceRiverLayout?.getCoastalShoreX(z);
      if (shoreX === null || shoreX === undefined) return 0;
      return 1 - smoothstep(3, 30, Math.abs(x - shoreX));
    }
    const path = nearestWaterPathSample(this.waterPaths, x, z);
    if (!path) return 0;
    const bankDistance = Math.abs(path.distance - path.halfWidth * 0.72);
    return (1 - smoothstep(1.5, 15, bankDistance))
      * smoothstep(path.halfWidth * 0.28, path.halfWidth * 1.3, path.distance);
  };

  sampleHydrologyDebug = (x: number, z: number): number => {
    if (this.settings.terrainPreset === 'vinodol_coast') {
      const shoreX = this.sourceRiverLayout?.getCoastalShoreX(z);
      return shoreX !== null && shoreX !== undefined && x <= shoreX ? 1 : 0;
    }
    return this.outerRiverLayout?.sampleRiverMask(x, z) ?? 0;
  };

  sampleForestDebug = (x: number, z: number): number =>
    this.sampleForestSuitability(x, z);

  dispose(): void {
    this.waterMesh?.geometry.dispose();
    this.waterMaterial?.dispose();
    if (this.shoreMaps) disposeRiverWaterShoreMaps(this.shoreMaps);
  }

  private sampleUncarvedHeight(x: number, z: number): number {
    const base = this.sampleBaseHeight(x, z);
    const outside = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - this.innerHalfExtent);
    if (outside <= 0) return base;
    if (this.settings.terrainPreset === 'vinodol_coast') {
      const shoreX = this.sourceRiverLayout?.getCoastalShoreX(z);
      if (shoreX !== null && shoreX !== undefined && x <= shoreX) return base;
    }

    const seedX = ((this.settings.seed >>> 8) & 0xffff) * 0.013;
    const seedZ = (this.settings.seed & 0xffff) * -0.017;
    const broad = fbm2((x + seedX) * 0.00135, (z + seedZ) * 0.00135, 4);
    const warpedX = x + (broad - 0.5) * 180;
    const warpedZ = z + (fbm2((x - seedZ) * 0.0011, (z + seedX) * 0.0011, 3) - 0.5) * 180;
    const ridgeNoise = fbm2(
      warpedX * 0.00225 + seedX * 0.01,
      warpedZ * 0.00225 + seedZ * 0.01,
      4,
    );
    const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
    const presence = smoothstep(0.43, 0.73, broad);
    const normalizedOutside = outside / Math.max(1, this.extensionDistance);
    const seam = smoothstep(0, Math.min(360, this.extensionDistance * 0.16), outside);
    const mountainBelt = smoothstep(0.08, 0.62, normalizedOutside);
    const rolling = (broad - 0.5) * (5 + this.settings.topography * 0.13);
    const mountains = Math.pow(ridge, 2.7)
      * presence
      * mountainBelt
      * this.topologyAmplitudeMeters;
    return base + seam * (rolling + mountains);
  }

  private sampleForestSuitability(x: number, z: number): number {
    const outside = Math.max(Math.abs(x), Math.abs(z)) - this.innerHalfExtent;
    if (outside < 0 || outside > this.extensionDistance * 0.78) return 0;
    if (this.settings.terrainPreset === 'vinodol_coast') {
      const shoreX = this.sourceRiverLayout?.getCoastalShoreX(z);
      if (shoreX !== null && shoreX !== undefined && x < shoreX + 26) return 0;
    }
    if (this.sampleHydrologyDebug(x, z) > 0.08) return 0;
    const seedX = ((this.settings.seed >>> 4) & 0x7fff) * 0.021;
    const seedZ = (this.settings.seed & 0x7fff) * -0.019;
    const regional = fbm2((x + seedX) * 0.0027, (z + seedZ) * 0.0027, 4);
    const stands = fbm2((x - seedZ) * 0.0072, (z + seedX) * 0.0072, 3);
    const step = 18;
    const slope = Math.hypot(
      this.sampleUncarvedHeight(x + step, z) - this.sampleUncarvedHeight(x - step, z),
      this.sampleUncarvedHeight(x, z + step) - this.sampleUncarvedHeight(x, z - step),
    ) / (step * 2);
    const density = this.settings.forestDensity / 100;
    const hillWoodland = smoothstep(0.08, 0.5, outside / this.extensionDistance) * 0.12;
    const regionalSuitability = THREE.MathUtils.clamp(
      regional * 0.54 + stands * 0.2 + density * 0.38 + hillWoodland - slope * 0.22,
      0,
      1,
    );
    // Continue the authored woodland mask through the seam before gradually
    // handing it to the larger regional habitat field. This is what prevents a
    // wooded playable edge from turning into a conspicuous strip of bare grass.
    const maximumAxis = Math.max(Math.abs(x), Math.abs(z));
    const boundaryScale = maximumAxis > 1e-6
      ? this.innerHalfExtent / maximumAxis
      : 0;
    const inheritedForest = this.sampleSourceForestBlend(
      x * boundaryScale,
      z * boundaryScale,
    );
    const regionalHandoff = smoothstep(
      FOREST_SEAM_CLEARANCE,
      Math.min(340, this.extensionDistance * 0.16),
      outside,
    );
    return THREE.MathUtils.lerp(inheritedForest, regionalSuitability, regionalHandoff);
  }

  private resolveWaterPath(corridor: RiverCorridor): HorizonWaterPath {
    const sourcePoint = corridor.points[0]!;
    const authoredSurface = this.sourceRiverLayout?.getWaterSurfaceOverride(
      sourcePoint.x,
      sourcePoint.z,
    );
    let previousSurface = authoredSurface
      ?? this.sampleUncarvedHeight(sourcePoint.x, sourcePoint.z) - 0.62;
    const points = corridor.points.map((point, index) => {
      if (index > 0) {
        const target = this.sampleUncarvedHeight(point.x, point.z) - 0.62;
        previousSurface = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(previousSurface, target, 0.2),
          previousSurface - 0.52,
          previousSurface + 0.34,
        );
      }
      return { ...point, surfaceY: previousSurface };
    });
    return { points };
  }
}

function regionalTopologyAmplitude(settings: TerrainHorizonWorldSettings): number {
  const flatlandMountainContext = settings.terrainPreset === 'gomirje_meadows'
    || settings.terrainPreset === 'mrkopalj_polje'
    ? 42
    : 0;
  const coastalRidge = settings.terrainPreset === 'vinodol_coast' ? 24 : 0;
  return 34 + settings.topography * 0.72 + flatlandMountainContext + coastalRidge;
}

function createOuterWaterPathSkeletons(
  options: TerrainHorizonWorldOptions,
): RiverCorridor[] {
  const paths: RiverCorridor[] = [];
  const layout = options.riverLayout;
  if (layout && options.settings.terrainPreset !== 'vinodol_coast') {
    for (const corridor of layout.corridors) {
      if (corridor.points.length < 2) continue;
      const candidates = [
        { endpoint: corridor.points[0]!, adjacent: corridor.points[1]! },
        {
          endpoint: corridor.points[corridor.points.length - 1]!,
          adjacent: corridor.points[corridor.points.length - 2]!,
        },
      ];
      for (const candidate of candidates) {
        if (paths.length >= MAX_WATER_PATHS) break;
        if (maxAbs(candidate.endpoint.x, candidate.endpoint.z) < options.innerHalfExtent * 0.84) {
          continue;
        }
        const path = extendCorridorEndpoint(options, candidate.endpoint, candidate.adjacent);
        if (path.points.length >= 2) paths.push(path);
      }
      if (paths.length >= MAX_WATER_PATHS) break;
    }
  }

  if (
    paths.length === 0
    && options.settings.hydrology >= 18
    && options.settings.terrainPreset !== 'vinodol_coast'
  ) {
    paths.push(createRemoteWatershedPath(options));
  }
  return paths;
}

function extendCorridorEndpoint(
  options: TerrainHorizonWorldOptions,
  endpoint: RiverPoint,
  adjacent: RiverPoint,
): RiverCorridor {
  let sourceDx = endpoint.x - adjacent.x;
  let sourceDz = endpoint.z - adjacent.z;
  const directionLength = Math.max(1e-6, Math.hypot(sourceDx, sourceDz));
  sourceDx /= directionLength;
  sourceDz /= directionLength;
  const normal = outwardSquareNormal(endpoint.x, endpoint.z);
  let exitDx = sourceDx;
  let exitDz = sourceDz;
  if (exitDx * normal.x + exitDz * normal.z < 0.52) {
    exitDx += normal.x * 1.5;
    exitDz += normal.z * 1.5;
    const correctedLength = Math.max(1e-6, Math.hypot(exitDx, exitDz));
    exitDx /= correctedLength;
    exitDz /= correctedLength;
  }

  const travel = Math.max(
    WATER_PATH_SPACING * 2,
    (options.outerHalfExtent - maxAbs(endpoint.x, endpoint.z)) * 1.3,
  );
  const count = Math.ceil(travel / WATER_PATH_SPACING) + 1;
  const phase = hash01(options.settings.seed, Math.round(endpoint.x), Math.round(endpoint.z)) * Math.PI * 2;
  const steeringDistance = Math.min(240, travel * 0.18);
  const controlX = endpoint.x + sourceDx * steeringDistance;
  const controlZ = endpoint.z + sourceDz * steeringDistance;
  const exitX = endpoint.x + exitDx * travel;
  const exitZ = endpoint.z + exitDz * travel;
  const points: RiverPoint[] = [];
  for (let index = 0; index < count; index++) {
    const progress = index / Math.max(1, count - 1);
    const inverseProgress = 1 - progress;
    const baseX = inverseProgress * inverseProgress * endpoint.x
      + 2 * inverseProgress * progress * controlX
      + progress * progress * exitX;
    const baseZ = inverseProgress * inverseProgress * endpoint.z
      + 2 * inverseProgress * progress * controlZ
      + progress * progress * exitZ;
    const tangentX = 2 * inverseProgress * (controlX - endpoint.x)
      + 2 * progress * (exitX - controlX);
    const tangentZ = 2 * inverseProgress * (controlZ - endpoint.z)
      + 2 * progress * (exitZ - controlZ);
    const inverseTangentLength = 1 / Math.max(1e-6, Math.hypot(tangentX, tangentZ));
    const perpendicularX = -tangentZ * inverseTangentLength;
    const perpendicularZ = tangentX * inverseTangentLength;
    const meander = (
      Math.sin(progress * Math.PI * 4.1 + phase) * 0.7
      + Math.sin(progress * Math.PI * 9.2 - phase * 0.6) * 0.3
    ) * THREE.MathUtils.lerp(8, 34, progress) * smoothstep(0, 0.16, progress);
    points.push({
      x: baseX + perpendicularX * meander,
      z: baseZ + perpendicularZ * meander,
      progress,
      halfWidth: endpoint.halfWidth * THREE.MathUtils.lerp(1, 1.18, progress),
      channelDepth: endpoint.channelDepth * THREE.MathUtils.lerp(1, 1.12, progress),
    });
  }
  return { points };
}

function createRemoteWatershedPath(options: TerrainHorizonWorldOptions): RiverCorridor {
  const side = Math.floor(hash01(options.settings.seed ^ 0x48594452, 7, 13) * 4);
  const reach = options.innerHalfExtent + Math.min(420, options.outerHalfExtent * 0.16);
  const tangentReach = Math.min(options.outerHalfExtent * 0.72, options.innerHalfExtent + 680);
  const count = Math.max(10, Math.ceil((tangentReach * 2) / WATER_PATH_SPACING));
  const phase = hash01(options.settings.seed, 17, 31) * Math.PI * 2;
  const points: RiverPoint[] = [];
  for (let index = 0; index <= count; index++) {
    const progress = index / count;
    const tangent = THREE.MathUtils.lerp(-tangentReach, tangentReach, progress);
    const radial = reach
      + Math.sin(progress * Math.PI * 3.2 + phase) * 46
      + Math.sin(progress * Math.PI * 7.4 - phase) * 14;
    const point = squareSideCoordinates(side, radial, tangent);
    points.push({
      ...point,
      progress,
      halfWidth: 12 + options.settings.hydrology * 0.09,
      channelDepth: 2.2 + options.settings.hydrology * 0.025,
    });
  }
  return { points };
}

function createOuterLakes(
  options: TerrainHorizonWorldOptions,
  sampleHeight: (x: number, z: number) => number,
): HorizonLake[] {
  if (
    options.settings.terrainPreset === 'vinodol_coast'
    || options.settings.hydrology < 68
  ) return [];
  const side = Math.floor(hash01(options.settings.seed ^ 0x4c414b45, 3, 19) * 4);
  const radial = options.innerHalfExtent + Math.min(620, options.outerHalfExtent * 0.22);
  const tangent = (hash01(options.settings.seed, 11, 23) - 0.5) * options.innerHalfExtent * 1.1;
  const center = squareSideCoordinates(side, radial, tangent);
  return [{
    ...center,
    radiusX: 38 + options.settings.hydrology * 0.32,
    radiusZ: 29 + options.settings.hydrology * 0.24,
    rotation: hash01(options.settings.seed, 29, 41) * Math.PI,
    depth: 2.4 + options.settings.hydrology * 0.025,
    kind: 'lake',
    surfaceY: sampleHeight(center.x, center.z) - 0.45,
  }];
}

function createOuterRiverLayout(
  options: TerrainHorizonWorldOptions,
  paths: readonly HorizonWaterPath[],
  lakes: readonly HorizonLake[],
): RiverLayout | null {
  if (paths.length === 0 && lakes.length === 0) return null;
  return RiverLayout.fromSerialized({
    bounds: horizonBounds(options.outerHalfExtent),
    seed: options.settings.seed ^ 0x48594452,
    drain: paths[0]?.points.at(-1)
      ? { x: paths[0]!.points.at(-1)!.x, z: paths[0]!.points.at(-1)!.z }
      : { x: lakes[0]!.x, z: lakes[0]!.z },
    terrainPreset: 'custom',
    corridors: paths.map((path) => ({
      points: path.points.map(({ surfaceY: _surfaceY, ...point }) => point),
    })),
    inlandWaterBodies: lakes.map(({ surfaceY: _surfaceY, ...lake }) => lake),
  });
}

function createOuterWaterGeometry(
  world: TerrainHorizonWorld,
  options: TerrainHorizonWorldOptions,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const foam: number[] = [];
  const feather: number[] = [];
  const simDelta: number[] = [];
  const indices: number[] = [];
  const { waterPaths: paths, lakes } = world;

  for (const path of paths) {
    const rows: number[][] = [];
    for (let index = 0; index < path.points.length; index++) {
      const point = path.points[index]!;
      const previous = path.points[Math.max(0, index - 1)]!;
      const next = path.points[Math.min(path.points.length - 1, index + 1)]!;
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const inverseLength = 1 / Math.max(1e-6, Math.hypot(dx, dz));
      const sideX = -dz * inverseLength;
      const sideZ = dx * inverseLength;
      const row: number[] = [];
      for (let column = 0; column < WATER_VERTEX_COLUMNS.length; column++) {
        const offset = WATER_VERTEX_COLUMNS[column]! * point.halfWidth * 0.72;
        row.push(appendWaterVertex(
          positions,
          normals,
          foam,
          feather,
          simDelta,
          point.x + sideX * offset,
          point.surfaceY,
          point.z + sideZ * offset,
          WATER_VERTEX_FOAM[column]!,
          WATER_VERTEX_FEATHER[column]!,
        ));
      }
      rows.push(row);
    }
    for (let row = 0; row < rows.length - 1; row++) {
      for (let column = 0; column < WATER_VERTEX_COLUMNS.length - 1; column++) {
        appendUpwardQuad(indices, positions, rows[row]![column]!, rows[row + 1]![column]!, rows[row + 1]![column + 1]!, rows[row]![column + 1]!);
      }
    }
  }

  for (const lake of lakes) {
    appendLakeGeometry(positions, normals, foam, feather, simDelta, indices, lake);
  }
  if (options.settings.terrainPreset === 'vinodol_coast' && options.riverLayout) {
    appendCoastalGeometry(positions, normals, foam, feather, simDelta, indices, options);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('foamBase', new THREE.Float32BufferAttribute(foam, 1));
  geometry.setAttribute('featherAlpha', new THREE.Float32BufferAttribute(feather, 1));
  geometry.setAttribute('simDelta', new THREE.Float32BufferAttribute(simDelta, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function appendLakeGeometry(
  positions: number[], normals: number[], foam: number[], feather: number[],
  simDelta: number[], indices: number[], lake: HorizonLake,
): void {
  const center = appendWaterVertex(
    positions, normals, foam, feather, simDelta,
    lake.x, lake.surfaceY, lake.z, 0, 1,
  );
  const ring: number[] = [];
  const segments = 28;
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const localX = Math.cos(angle) * lake.radiusX;
    const localZ = Math.sin(angle) * lake.radiusZ;
    const cos = Math.cos(lake.rotation);
    const sin = Math.sin(lake.rotation);
    ring.push(appendWaterVertex(
      positions, normals, foam, feather, simDelta,
      lake.x + localX * cos - localZ * sin,
      lake.surfaceY,
      lake.z + localX * sin + localZ * cos,
      0.76,
      0.1,
    ));
  }
  for (let index = 0; index < segments; index++) {
    appendUpwardTriangle(indices, positions, center, ring[index]!, ring[(index + 1) % segments]!);
  }
}

function appendCoastalGeometry(
  positions: number[], normals: number[], foam: number[], feather: number[],
  simDelta: number[], indices: number[], options: TerrainHorizonWorldOptions,
): void {
  const layout = options.riverLayout!;
  const xSegments = 22;
  const zSegments = 52;
  const waterY = layout.getWaterSurfaceOverride(0, 0) ?? -4.4;
  let maximumShoreX = -options.innerHalfExtent * 0.1;
  for (let zIndex = 0; zIndex <= zSegments; zIndex++) {
    const z = THREE.MathUtils.lerp(-options.outerHalfExtent, options.outerHalfExtent, zIndex / zSegments);
    maximumShoreX = Math.max(maximumShoreX, layout.getCoastalShoreX(z) ?? maximumShoreX);
  }
  for (let zIndex = 0; zIndex < zSegments; zIndex++) {
    const z0 = THREE.MathUtils.lerp(-options.outerHalfExtent, options.outerHalfExtent, zIndex / zSegments);
    const z1 = THREE.MathUtils.lerp(-options.outerHalfExtent, options.outerHalfExtent, (zIndex + 1) / zSegments);
    for (let xIndex = 0; xIndex < xSegments; xIndex++) {
      const x0 = THREE.MathUtils.lerp(-options.outerHalfExtent, maximumShoreX, xIndex / xSegments);
      const x1 = THREE.MathUtils.lerp(-options.outerHalfExtent, maximumShoreX, (xIndex + 1) / xSegments);
      const centerX = (x0 + x1) * 0.5;
      const centerZ = (z0 + z1) * 0.5;
      const shoreX = layout.getCoastalShoreX(centerZ) ?? maximumShoreX;
      if (centerX > shoreX || maxAbs(centerX, centerZ) < options.innerHalfExtent) continue;
      const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const;
      const quad = corners.map(([x, z]) => {
        const localShore = layout.getCoastalShoreX(z) ?? shoreX;
        const shoreDistance = Math.max(0, localShore - x);
        return appendWaterVertex(
          positions, normals, foam, feather, simDelta,
          x, waterY, z,
          1 - smoothstep(3, 34, shoreDistance),
          smoothstep(0, 7, shoreDistance),
        );
      });
      appendUpwardQuad(indices, positions, quad[0]!, quad[1]!, quad[2]!, quad[3]!);
    }
  }
}

function createHorizonRiverFlowMaps(
  world: TerrainHorizonWorld,
  options: TerrainHorizonWorldOptions,
): RiverWaterShoreMaps {
  const resolution = WATER_FIELD_RESOLUTION;
  const span = options.outerHalfExtent * 2;
  const step = span / (resolution - 1);
  const data = new Uint8Array(resolution * resolution * 4);
  // The ribbon's exact analytic feather is carried per vertex. Keep the red
  // channel fully wet so a world-scale low-resolution texture can never punch
  // gaps into a narrow continuation river; this texture only supplies current.
  for (let index = 0; index < resolution * resolution; index++) {
    const offset = index * 4;
    data[offset] = 255;
    data[offset + 1] = 0;
    data[offset + 2] = 128;
    data[offset + 3] = 128;
  }

  for (const path of world.waterPaths) {
    for (let pointIndex = 0; pointIndex < path.points.length - 1; pointIndex++) {
      const a = path.points[pointIndex]!;
      const b = path.points[pointIndex + 1]!;
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const lengthSquared = vx * vx + vz * vz;
      const inverseLength = 1 / Math.max(1e-6, Math.sqrt(lengthSquared));
      const [flowX, flowZ] = encodeWaterFlowDirection({
        dx: vx * inverseLength,
        dz: vz * inverseLength,
      });
      const reach = Math.max(a.halfWidth, b.halfWidth) + step * 1.5;
      const minimumX = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + options.outerHalfExtent) / step));
      const maximumX = Math.min(resolution - 1, Math.ceil((Math.max(a.x, b.x) + reach + options.outerHalfExtent) / step));
      const minimumZ = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + options.outerHalfExtent) / step));
      const maximumZ = Math.min(resolution - 1, Math.ceil((Math.max(a.z, b.z) + reach + options.outerHalfExtent) / step));
      for (let iz = minimumZ; iz <= maximumZ; iz++) {
        const z = -options.outerHalfExtent + iz * step;
        for (let ix = minimumX; ix <= maximumX; ix++) {
          const x = -options.outerHalfExtent + ix * step;
          const t = lengthSquared <= 1e-6
            ? 0
            : THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / lengthSquared, 0, 1);
          const px = THREE.MathUtils.lerp(a.x, b.x, t);
          const pz = THREE.MathUtils.lerp(a.z, b.z, t);
          const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t);
          if (Math.hypot(x - px, z - pz) > halfWidth + step) continue;
          const offset = (iz * resolution + ix) * 4;
          data[offset + 2] = flowX;
          data[offset + 3] = flowZ;
        }
      }
    }
  }

  const shoreTexture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  shoreTexture.colorSpace = THREE.NoColorSpace;
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.generateMipmaps = false;
  shoreTexture.needsUpdate = true;
  return {
    shoreTexture,
    originX: -options.outerHalfExtent,
    originZ: -options.outerHalfExtent,
    invSpanX: 1 / span,
    invSpanZ: 1 / span,
    resolution,
    channelRockCount: 0,
  };
}

function createCoastalShoreMaps(options: TerrainHorizonWorldOptions): RiverWaterShoreMaps {
  const resolution = 128;
  const span = options.outerHalfExtent * 2;
  const data = new Uint8Array(resolution * resolution * 4);
  for (let iz = 0; iz < resolution; iz++) {
    const z = THREE.MathUtils.lerp(-options.outerHalfExtent, options.outerHalfExtent, iz / (resolution - 1));
    const shoreX = options.riverLayout?.getCoastalShoreX(z) ?? -options.innerHalfExtent * 0.55;
    for (let ix = 0; ix < resolution; ix++) {
      const x = THREE.MathUtils.lerp(-options.outerHalfExtent, options.outerHalfExtent, ix / (resolution - 1));
      const signedWaterDistance = shoreX - x;
      const offset = (iz * resolution + ix) * 4;
      data[offset] = Math.round(computeWaterFeatherAlpha(signedWaterDistance) * 255);
      data[offset + 1] = 0;
      data[offset + 2] = 128;
      data[offset + 3] = 128;
    }
  }
  const shoreTexture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  shoreTexture.colorSpace = THREE.NoColorSpace;
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.generateMipmaps = false;
  shoreTexture.needsUpdate = true;
  return {
    shoreTexture,
    originX: -options.outerHalfExtent,
    originZ: -options.outerHalfExtent,
    invSpanX: 1 / span,
    invSpanZ: 1 / span,
    resolution,
    channelRockCount: 0,
  };
}

function createSeedThreeHorizonPlacements(
  world: TerrainHorizonWorld,
): ForestTreePlacement[] {
  const { settings, innerHalfExtent, outerHalfExtent, extensionDistance } = world;
  if (settings.forestDensity <= 0) return [];
  const rng = mulberry32(settings.seed ^ 0x53454544);
  const target = Math.min(
    MAX_SEEDTHREE_OVERVIEW_TREES,
    Math.round(settings.forestDensity * 72),
  );
  // Spend real SeedThree instances where they actually continue the playable
  // forest silhouette. Beyond this band the terrain's inherited woodland mask,
  // mountain relief, and aerial perspective carry the same regional field.
  const visibleOuter = Math.min(
    outerHalfExtent - 40,
    innerHalfExtent + Math.min(820, extensionDistance * 0.38),
  );
  const placements: ForestTreePlacement[] = [];
  const placementGrid = new Map<string, ForestTreePlacement[]>();
  let attempts = 0;
  while (placements.length < target && attempts < target * 34) {
    attempts++;
    const x = THREE.MathUtils.lerp(-visibleOuter, visibleOuter, rng());
    const z = THREE.MathUtils.lerp(-visibleOuter, visibleOuter, rng());
    const outside = maxAbs(x, z) - innerHalfExtent;
    if (outside < FOREST_SEAM_CLEARANCE) continue;
    const suitability = world.sampleForestDebug(x, z);
    if (suitability < 0.34 || rng() > smoothstep(0.32, 0.78, suitability) * 0.94) continue;
    if (hasNearbyHorizonTree(placementGrid, x, z)) continue;
    const altitude = world.getHeightAt(x, z);
    const coldBias = THREE.MathUtils.clamp(
      0.44 + outside / Math.max(1, extensionDistance) * 0.34 + altitude / 520,
      0.25,
      0.88,
    );
    const speciesRoll = rng();
    const species: ForestTreePlacement['species'] = settings.terrainPreset === 'vinodol_coast'
      ? speciesRoll < 0.38 ? 'blackPine' : speciesRoll < 0.62 ? 'hornbeam' : 'sessileOak'
      : speciesRoll < coldBias * 0.44
        ? 'norwaySpruce'
        : speciesRoll < coldBias
          ? 'silverFir'
          : 'beech';
    const placement: ForestTreePlacement = {
      x,
      z,
      species,
      form: species === 'beech' || species === 'hornbeam' || species === 'sessileOak'
        ? (rng() < 0.62 ? 'broad' : 'midstory')
        : 'narrow',
      scale: 0.68 + rng() * 0.48,
      visualOnly: 'terrain-horizon',
    };
    placements.push(placement);
    const cellX = Math.floor(x / FOREST_MINIMUM_SPACING);
    const cellZ = Math.floor(z / FOREST_MINIMUM_SPACING);
    const key = `${cellX}:${cellZ}`;
    const cell = placementGrid.get(key) ?? [];
    cell.push(placement);
    placementGrid.set(key, cell);
  }
  return placements;
}

function hasNearbyHorizonTree(
  grid: ReadonlyMap<string, readonly ForestTreePlacement[]>,
  x: number,
  z: number,
): boolean {
  const cellX = Math.floor(x / FOREST_MINIMUM_SPACING);
  const cellZ = Math.floor(z / FOREST_MINIMUM_SPACING);
  for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const cell = grid.get(`${cellX + offsetX}:${cellZ + offsetZ}`);
      if (!cell) continue;
      if (cell.some((tree) => Math.hypot(tree.x - x, tree.z - z) < FOREST_MINIMUM_SPACING)) {
        return true;
      }
    }
  }
  return false;
}

function nearestWaterPathSample(
  paths: readonly HorizonWaterPath[],
  x: number,
  z: number,
): {
  distance: number;
  halfWidth: number;
  channelDepth: number;
  surfaceY: number;
} | null {
  let best: ReturnType<typeof nearestWaterPathSample> = null;
  for (const path of paths) {
    for (let index = 0; index < path.points.length - 1; index++) {
      const a = path.points[index]!;
      const b = path.points[index + 1]!;
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const lengthSquared = vx * vx + vz * vz;
      const t = lengthSquared <= 1e-6
        ? 0
        : THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / lengthSquared, 0, 1);
      const px = THREE.MathUtils.lerp(a.x, b.x, t);
      const pz = THREE.MathUtils.lerp(a.z, b.z, t);
      const distance = Math.hypot(x - px, z - pz);
      if (best && distance >= best.distance) continue;
      best = {
        distance,
        halfWidth: THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t),
        channelDepth: THREE.MathUtils.lerp(a.channelDepth, b.channelDepth, t),
        surfaceY: THREE.MathUtils.lerp(a.surfaceY, b.surfaceY, t),
      };
    }
  }
  return best;
}

function appendWaterVertex(
  positions: number[], normals: number[], foam: number[], feather: number[],
  simDelta: number[], x: number, y: number, z: number,
  foamValue: number, featherValue: number,
): number {
  const index = positions.length / 3;
  positions.push(x, y, z);
  normals.push(0, 1, 0);
  foam.push(foamValue);
  feather.push(featherValue);
  simDelta.push(0);
  return index;
}

function appendUpwardQuad(
  indices: number[], positions: number[], a: number, b: number, c: number, d: number,
): void {
  appendUpwardTriangle(indices, positions, a, b, c);
  appendUpwardTriangle(indices, positions, a, c, d);
}

function appendUpwardTriangle(
  indices: number[], positions: number[], a: number, b: number, c: number,
): void {
  const ax = positions[a * 3]!;
  const az = positions[a * 3 + 2]!;
  const bx = positions[b * 3]!;
  const bz = positions[b * 3 + 2]!;
  const cx = positions[c * 3]!;
  const cz = positions[c * 3 + 2]!;
  const upward = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (upward >= 0) indices.push(a, b, c);
  else indices.push(a, c, b);
}

function ellipseRadiusAt(lake: HorizonLake, x: number, z: number): number {
  const dx = x - lake.x;
  const dz = z - lake.z;
  const cos = Math.cos(-lake.rotation);
  const sin = Math.sin(-lake.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.hypot(localX / lake.radiusX, localZ / lake.radiusZ);
}

function outwardSquareNormal(x: number, z: number): { x: number; z: number } {
  if (Math.abs(x) >= Math.abs(z)) return { x: Math.sign(x) || 1, z: 0 };
  return { x: 0, z: Math.sign(z) || 1 };
}

function squareSideCoordinates(side: number, radial: number, tangent: number): { x: number; z: number } {
  if (side === 0) return { x: tangent, z: -radial };
  if (side === 1) return { x: radial, z: tangent };
  if (side === 2) return { x: -tangent, z: radial };
  return { x: -radial, z: -tangent };
}

function horizonBounds(halfExtent: number) {
  return { minX: -halfExtent, maxX: halfExtent, minZ: -halfExtent, maxZ: halfExtent };
}

function maxAbs(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z));
}

function hash01(seed: number, x: number, z: number): number {
  let hash = Math.imul((seed ^ Math.imul(x, 0x45d9f3b)) | 0, 0x27d4eb2d)
    ^ Math.imul(z | 0, 0x165667b1);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
