import * as THREE from 'three';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { sampleTerrainBlendWeights, sampleTerrainUv } from './TerrainBlendWeights.ts';
import { sampleBaseTerrainHeight } from './TerrainHeight.ts';
import {
  TerrainHorizonWorld,
  type TerrainHorizonWorldSettings,
} from './TerrainHorizonWorld.ts';

export type TerrainHorizonDebugMode =
  | 'final'
  | 'lod'
  | 'height'
  | 'hydrology'
  | 'forest'
  | 'wireframe';

export type TerrainHorizonLodRow = {
  halfExtent: number;
  segmentsPerSide: number;
  filterRadius: number;
};

export type TerrainHorizonDiagnostics = {
  seed: number;
  drawCalls: number;
  terrainDrawCalls: 1;
  vertexCount: number;
  triangleCount: number;
  innerHalfExtent: number;
  outerHalfExtent: number;
  extensionDistance: number;
  sourceCellSize: number;
  lodRows: readonly TerrainHorizonLodRow[];
  castsShadows: false;
  receivesShadows: false;
  updatesPerFrame: false;
  topologyAmplitudeMeters: number;
  hydrologyPaths: number;
  hydrologyLakes: number;
  waterTriangles: number;
  waterDrawCalls: 0 | 1;
  forestStandCount: number;
  seedThreeOverviewTrees: number;
  seedThreeNearTrees: 0;
  seedThreeShadowTrees: 0;
};

export type TerrainHorizonOptions = {
  sourceGeometry: THREE.BufferGeometry;
  material: THREE.Material;
  terrainSize: number;
  sourceResolution: number;
  farDistance: number;
  seed: number;
  sampleHeight?: (x: number, z: number) => number;
  sampleForestBlend?: (x: number, z: number) => number;
  settings?: TerrainHorizonWorldSettings;
  riverLayout?: RiverLayout | null;
};

/**
 * Perceptual controls for the visual-only terrain beyond the playable map.
 * The coverage scale is tied to the camera far plane while the filtering scale
 * follows the progressively larger world-space cells of the horizon mesh.
 */
export const TERRAIN_HORIZON_PARAMETERS = Object.freeze({
  coverage: Object.freeze({
    farPlaneMultiplier: 1.12,
    minimumExtensionMeters: 1_200,
  }),
  lod: Object.freeze({
    distanceFractions: Object.freeze([0, 0.012, 0.035, 0.075, 0.14, 0.24, 0.38, 0.56, 0.78, 1]),
    segmentCapsPerSide: Object.freeze([
      Number.POSITIVE_INFINITY, 256, 192, 160, 128, 96, 80, 64, 56, 48,
    ]),
    filterCellMultipliers: Object.freeze([0, 1, 2, 4, 7, 11, 16, 22, 28, 36]),
  }),
  budget: Object.freeze({
    maximumDrawCalls: 2,
    maximumTerrainTriangles: 12_288,
    maximumWaterTriangles: 8_192,
    maximumSeedThreeOverviewTrees: 7_200,
  }),
});

/**
 * Static geometry that makes the finite simulation map read as a crop from a
 * larger landscape. It never participates in picking, collision, simulation,
 * vegetation streaming, or the directional-shadow atlas.
 */
export class TerrainHorizon {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;

  private readonly productionMaterial: THREE.Material;
  private readonly productionColors: THREE.BufferAttribute;
  private readonly lodDebugColors: THREE.BufferAttribute;
  private readonly heightDebugColors: THREE.BufferAttribute;
  private readonly hydrologyDebugColors: THREE.BufferAttribute;
  private readonly forestDebugColors: THREE.BufferAttribute;
  private readonly world: TerrainHorizonWorld;
  private readonly debugMaterial = new THREE.MeshBasicMaterial({
    name: 'Terrain horizon diagnostics',
    vertexColors: true,
    fog: true,
    toneMapped: false,
  });
  private readonly evidence: TerrainHorizonDiagnostics;

  constructor(options: TerrainHorizonOptions) {
    const innerHalfExtent = options.terrainSize * 0.5;
    const extensionDistance = resolveHorizonExtensionDistance(options.farDistance);
    const settings = options.settings ?? {
      seed: options.seed,
      terrainPreset: 'custom',
      topography: 50,
      hydrology: 50,
      forestDensity: 50,
    };
    this.world = new TerrainHorizonWorld({
      innerHalfExtent,
      outerHalfExtent: innerHalfExtent + extensionDistance,
      settings,
      riverLayout: options.riverLayout ?? null,
      sampleBaseHeight: options.sampleHeight ?? sampleBaseTerrainHeight,
      sampleSourceForestBlend: options.sampleForestBlend,
    });
    const geometryResult = createTerrainHorizonGeometry({
      ...options,
      sampleHeight: this.world.getHeightAt,
      sampleForestBlend: this.world.sampleForestBlend,
      sampleShoreBlend: this.world.sampleShoreBlend,
      sampleHydrologyDebug: this.world.sampleHydrologyDebug,
      sampleForestDebug: this.world.sampleForestDebug,
    });
    this.productionMaterial = options.material;
    this.productionColors = geometryResult.productionColors;
    this.lodDebugColors = geometryResult.lodDebugColors;
    this.heightDebugColors = geometryResult.heightDebugColors;
    this.hydrologyDebugColors = geometryResult.hydrologyDebugColors;
    this.forestDebugColors = geometryResult.forestDebugColors;
    this.mesh = new THREE.Mesh(geometryResult.geometry, this.productionMaterial);
    this.mesh.name = 'Infinite terrain horizon (static LOD)';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -1;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.userData.terrainHorizon = true;
    this.mesh.userData.gameplay = false;
    this.mesh.userData.deterministicSeed = options.seed >>> 0;
    this.group.name = 'Infinite outer world (visual only)';
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
    this.group.userData.gameplay = false;
    this.group.userData.terrainHorizon = true;
    this.group.add(this.mesh);
    if (this.world.waterMesh) this.group.add(this.world.waterMesh);
    const worldEvidence = this.world.diagnostics;
    this.evidence = {
      seed: options.seed >>> 0,
      drawCalls: 1 + worldEvidence.waterDrawCalls,
      terrainDrawCalls: 1,
      vertexCount: geometryResult.vertexCount,
      triangleCount: geometryResult.triangleCount,
      innerHalfExtent: geometryResult.lodRows[0]!.halfExtent,
      outerHalfExtent: geometryResult.lodRows[geometryResult.lodRows.length - 1]!.halfExtent,
      extensionDistance: geometryResult.extensionDistance,
      sourceCellSize: geometryResult.sourceCellSize,
      lodRows: geometryResult.lodRows,
      castsShadows: false,
      receivesShadows: false,
      updatesPerFrame: false,
      ...worldEvidence,
    };
  }

  setDebugMode(mode: TerrainHorizonDebugMode): void {
    this.debugMaterial.wireframe = mode === 'wireframe';
    if (this.world.waterMesh) {
      this.world.waterMesh.visible = mode === 'final' || mode === 'hydrology';
    }
    if (mode === 'final') {
      this.mesh.geometry.setAttribute('color', this.productionColors);
      this.mesh.material = this.productionMaterial;
      return;
    }
    this.mesh.geometry.setAttribute(
      'color',
      mode === 'height'
        ? this.heightDebugColors
        : mode === 'hydrology'
          ? this.hydrologyDebugColors
          : mode === 'forest'
            ? this.forestDebugColors
            : this.lodDebugColors,
    );
    this.mesh.material = this.debugMaterial;
  }

  getDiagnostics(): TerrainHorizonDiagnostics {
    return {
      ...this.evidence,
      lodRows: this.evidence.lodRows.map((row) => ({ ...row })),
    };
  }

  getForestPlacements(): readonly ForestTreePlacement[] {
    return this.world.forestPlacements;
  }

  getHeightAt = (x: number, z: number): number => this.world.getHeightAt(x, z);

  dispose(): void {
    this.mesh.geometry.dispose();
    this.debugMaterial.dispose();
    this.world.dispose();
  }
}

type GeometryBuildResult = {
  geometry: THREE.BufferGeometry;
  productionColors: THREE.BufferAttribute;
  lodDebugColors: THREE.BufferAttribute;
  heightDebugColors: THREE.BufferAttribute;
  hydrologyDebugColors: THREE.BufferAttribute;
  forestDebugColors: THREE.BufferAttribute;
  vertexCount: number;
  triangleCount: number;
  sourceCellSize: number;
  extensionDistance: number;
  lodRows: readonly TerrainHorizonLodRow[];
};

type TerrainHorizonGeometryOptions = TerrainHorizonOptions & {
  sampleHeight: (x: number, z: number) => number;
  sampleForestBlend: (x: number, z: number) => number;
  sampleShoreBlend: (x: number, z: number) => number;
  sampleHydrologyDebug: (x: number, z: number) => number;
  sampleForestDebug: (x: number, z: number) => number;
};

type AttributeArrays = {
  positions: number[];
  normals: number[];
  uvs: number[];
  productionColors: number[];
  lodDebugColors: number[];
  forestBlends: number[];
  shoreBlends: number[];
  roadWearBlends: number[];
  quarryPadBlends: number[];
  dirtZoomGates: number[];
  canopyOcclusion: number[];
  heights: number[];
  hydrologyDebug: number[];
  forestDebug: number[];
};

const LOD_DEBUG_PALETTE = [
  new THREE.Color(0x35d07f),
  new THREE.Color(0xe4c744),
  new THREE.Color(0xe7823d),
  new THREE.Color(0xd24f63),
  new THREE.Color(0x8c63d9),
] as const;

function createTerrainHorizonGeometry(options: TerrainHorizonGeometryOptions): GeometryBuildResult {
  const sourceSegments = Math.max(1, Math.floor(options.sourceResolution) - 1);
  const sourceCellSize = options.terrainSize / sourceSegments;
  const innerHalfExtent = options.terrainSize * 0.5;
  const extensionDistance = resolveHorizonExtensionDistance(options.farDistance);
  const lodRows = createLodRows(
    innerHalfExtent,
    extensionDistance,
    sourceCellSize,
    sourceSegments,
  );
  const arrays: AttributeArrays = {
    positions: [],
    normals: [],
    uvs: [],
    productionColors: [],
    lodDebugColors: [],
    forestBlends: [],
    shoreBlends: [],
    roadWearBlends: [],
    quarryPadBlends: [],
    dirtZoomGates: [],
    canopyOcclusion: [],
    heights: [],
    hydrologyDebug: [],
    forestDebug: [],
  };
  const indices: number[] = [];
  const heightSampler = options.sampleHeight ?? sampleBaseTerrainHeight;

  for (let spanIndex = 0; spanIndex < lodRows.length - 1; spanIndex++) {
    const inner = lodRows[spanIndex]!;
    const outer = lodRows[spanIndex + 1]!;
    const debugColor = LOD_DEBUG_PALETTE[spanIndex % LOD_DEBUG_PALETTE.length]!;
    for (let side = 0; side < 4; side++) {
      appendLodStrip(
        arrays,
        indices,
        options.sourceGeometry,
        options.sourceResolution,
        sourceCellSize,
        inner,
        outer,
        spanIndex === 0,
        side,
        debugColor,
        heightSampler,
        options.sampleForestBlend,
        options.sampleShoreBlend,
        options.sampleHydrologyDebug,
        options.sampleForestDebug,
      );
    }
  }

  const heightDebugColors = createHeightDebugColors(arrays.heights);
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(arrays.positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(arrays.normals), 3));
  const uvAttribute = new THREE.BufferAttribute(Float32Array.from(arrays.uvs), 2);
  geometry.setAttribute('uv', uvAttribute);
  geometry.setAttribute('uv2', uvAttribute);
  const productionColors = new THREE.BufferAttribute(
    Float32Array.from(arrays.productionColors),
    3,
  );
  const lodDebugColors = new THREE.BufferAttribute(
    Float32Array.from(arrays.lodDebugColors),
    3,
  );
  const heightColors = new THREE.BufferAttribute(heightDebugColors, 3);
  const hydrologyDebugColors = new THREE.BufferAttribute(
    createScalarDebugColors(arrays.hydrologyDebug, 0x202a24, 0x25b6df),
    3,
  );
  const forestDebugColors = new THREE.BufferAttribute(
    createScalarDebugColors(arrays.forestDebug, 0x342c22, 0x35c765),
    3,
  );
  geometry.setAttribute('color', productionColors);

  const staticMaskValues = new Float32Array(arrays.forestBlends.length * 3);
  for (let index = 0; index < arrays.forestBlends.length; index++) {
    const offset = index * 3;
    staticMaskValues[offset] = arrays.forestBlends[index]!;
    staticMaskValues[offset + 1] = arrays.shoreBlends[index]!;
    staticMaskValues[offset + 2] = arrays.quarryPadBlends[index]!;
  }
  const staticMasks = new THREE.InterleavedBuffer(staticMaskValues, 3);
  geometry.setAttribute('forestBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 0));
  geometry.setAttribute('shoreBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 1));
  geometry.setAttribute('quarryPadBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 2));
  geometry.setAttribute(
    'roadWearBlend',
    new THREE.BufferAttribute(Float32Array.from(arrays.roadWearBlends), 1),
  );
  geometry.setAttribute(
    'dirtZoomGate',
    new THREE.BufferAttribute(Float32Array.from(arrays.dirtZoomGates), 1),
  );
  geometry.setAttribute(
    'forestCanopyOcclusion',
    new THREE.BufferAttribute(Uint8Array.from(arrays.canopyOcclusion), 4, true),
  );
  geometry.computeBoundingSphere();

  return {
    geometry,
    productionColors,
    lodDebugColors,
    heightDebugColors: heightColors,
    hydrologyDebugColors,
    forestDebugColors,
    vertexCount: arrays.heights.length,
    triangleCount: indices.length / 3,
    sourceCellSize,
    extensionDistance,
    lodRows,
  };
}

function createLodRows(
  innerHalfExtent: number,
  extensionDistance: number,
  sourceCellSize: number,
  sourceSegments: number,
): readonly TerrainHorizonLodRow[] {
  return TERRAIN_HORIZON_PARAMETERS.lod.distanceFractions.map((fraction, index) => ({
    halfExtent: innerHalfExtent + extensionDistance * fraction,
    segmentsPerSide: Math.max(
      8,
      Math.min(
        sourceSegments,
        Math.floor(TERRAIN_HORIZON_PARAMETERS.lod.segmentCapsPerSide[index]!),
      ),
    ),
    filterRadius: sourceCellSize
      * TERRAIN_HORIZON_PARAMETERS.lod.filterCellMultipliers[index]!,
  }));
}

function appendLodStrip(
  arrays: AttributeArrays,
  indices: number[],
  sourceGeometry: THREE.BufferGeometry,
  sourceResolution: number,
  sourceCellSize: number,
  inner: TerrainHorizonLodRow,
  outer: TerrainHorizonLodRow,
  copySourceBoundary: boolean,
  side: number,
  debugColor: THREE.Color,
  sampleHeight: (x: number, z: number) => number,
  sampleForestBlend: (x: number, z: number) => number,
  sampleShoreBlend: (x: number, z: number) => number,
  sampleHydrologyDebug: (x: number, z: number) => number,
  sampleForestDebug: (x: number, z: number) => number,
): void {
  const innerIndices = appendSideRow(
    arrays,
    sourceGeometry,
    sourceResolution,
    sourceCellSize,
    inner,
    copySourceBoundary,
    side,
    debugColor,
    sampleHeight,
    sampleForestBlend,
    sampleShoreBlend,
    sampleHydrologyDebug,
    sampleForestDebug,
  );
  const outerIndices = appendSideRow(
    arrays,
    sourceGeometry,
    sourceResolution,
    sourceCellSize,
    outer,
    false,
    side,
    debugColor,
    sampleHeight,
    sampleForestBlend,
    sampleShoreBlend,
    sampleHydrologyDebug,
    sampleForestDebug,
  );

  let innerIndex = 0;
  let outerIndex = 0;
  while (innerIndex < inner.segmentsPerSide || outerIndex < outer.segmentsPerSide) {
    const nextInner = innerIndex < inner.segmentsPerSide
      ? (innerIndex + 1) / inner.segmentsPerSide
      : Number.POSITIVE_INFINITY;
    const nextOuter = outerIndex < outer.segmentsPerSide
      ? (outerIndex + 1) / outer.segmentsPerSide
      : Number.POSITIVE_INFINITY;
    if (nextInner <= nextOuter) {
      indices.push(
        innerIndices[innerIndex]!,
        innerIndices[innerIndex + 1]!,
        outerIndices[outerIndex]!,
      );
      innerIndex++;
    } else {
      indices.push(
        innerIndices[innerIndex]!,
        outerIndices[outerIndex + 1]!,
        outerIndices[outerIndex]!,
      );
      outerIndex++;
    }
  }
}

function appendSideRow(
  arrays: AttributeArrays,
  sourceGeometry: THREE.BufferGeometry,
  sourceResolution: number,
  sourceCellSize: number,
  row: TerrainHorizonLodRow,
  copySourceBoundary: boolean,
  side: number,
  debugColor: THREE.Color,
  sampleHeight: (x: number, z: number) => number,
  sampleForestBlend: (x: number, z: number) => number,
  sampleShoreBlend: (x: number, z: number) => number,
  sampleHydrologyDebug: (x: number, z: number) => number,
  sampleForestDebug: (x: number, z: number) => number,
): number[] {
  const rowIndices: number[] = [];
  for (let segment = 0; segment <= row.segmentsPerSide; segment++) {
    const t = segment / row.segmentsPerSide;
    const point = squareSidePoint(side, row.halfExtent, t);
    const sourceVertexIndex = copySourceBoundary
      ? sourceBoundaryVertexIndex(side, segment, sourceResolution)
      : null;
    rowIndices.push(appendVertex(
      arrays,
      sourceGeometry,
      sourceVertexIndex,
      point.x,
      point.z,
      row.filterRadius,
      sourceCellSize,
      debugColor,
      sampleHeight,
      sampleForestBlend,
      sampleShoreBlend,
      sampleHydrologyDebug,
      sampleForestDebug,
    ));
  }
  return rowIndices;
}

function appendVertex(
  arrays: AttributeArrays,
  sourceGeometry: THREE.BufferGeometry,
  sourceVertexIndex: number | null,
  x: number,
  z: number,
  filterRadius: number,
  sourceCellSize: number,
  debugColor: THREE.Color,
  sampleHeight: (x: number, z: number) => number,
  sampleForestBlend: (x: number, z: number) => number,
  sampleShoreBlend: (x: number, z: number) => number,
  sampleHydrologyDebug: (x: number, z: number) => number,
  sampleForestDebug: (x: number, z: number) => number,
): number {
  const vertexIndex = arrays.heights.length;
  const sourcePosition = sourceGeometry.getAttribute('position');
  const sourceNormal = sourceGeometry.getAttribute('normal');
  const sourceUv = sourceGeometry.getAttribute('uv');
  const sourceColor = sourceGeometry.getAttribute('color');
  const y = sourceVertexIndex === null
    ? filteredHeight(sampleHeight, x, z, filterRadius)
    : sourcePosition.getY(sourceVertexIndex);
  arrays.positions.push(x, y, z);
  arrays.heights.push(y);

  if (sourceVertexIndex !== null && sourceNormal) {
    arrays.normals.push(
      sourceNormal.getX(sourceVertexIndex),
      sourceNormal.getY(sourceVertexIndex),
      sourceNormal.getZ(sourceVertexIndex),
    );
  } else {
    const sampleOffset = Math.max(sourceCellSize * 2, filterRadius * 0.5, 1);
    const left = filteredHeight(sampleHeight, x - sampleOffset, z, filterRadius);
    const right = filteredHeight(sampleHeight, x + sampleOffset, z, filterRadius);
    const down = filteredHeight(sampleHeight, x, z - sampleOffset, filterRadius);
    const up = filteredHeight(sampleHeight, x, z + sampleOffset, filterRadius);
    const nx = left - right;
    const ny = sampleOffset * 2;
    const nz = down - up;
    const inverseLength = 1 / Math.hypot(nx, ny, nz);
    arrays.normals.push(nx * inverseLength, ny * inverseLength, nz * inverseLength);
  }

  if (sourceVertexIndex !== null && sourceUv) {
    arrays.uvs.push(sourceUv.getX(sourceVertexIndex), sourceUv.getY(sourceVertexIndex));
  } else {
    arrays.uvs.push(...sampleTerrainUv(x, z));
  }
  if (sourceVertexIndex !== null && sourceColor) {
    arrays.productionColors.push(
      sourceColor.getX(sourceVertexIndex),
      sourceColor.getY(sourceVertexIndex),
      sourceColor.getZ(sourceVertexIndex),
    );
  } else {
    arrays.productionColors.push(...sampleTerrainBlendWeights(x, z));
  }
  arrays.lodDebugColors.push(debugColor.r, debugColor.g, debugColor.b);
  arrays.forestBlends.push(sourceVertexIndex === null
    ? sampleForestBlend(x, z)
    : sourceAttributeX(sourceGeometry, 'forestBlend', sourceVertexIndex));
  arrays.shoreBlends.push(sourceVertexIndex === null
    ? sampleShoreBlend(x, z)
    : sourceAttributeX(sourceGeometry, 'shoreBlend', sourceVertexIndex));
  arrays.roadWearBlends.push(sourceAttributeX(sourceGeometry, 'roadWearBlend', sourceVertexIndex));
  arrays.quarryPadBlends.push(sourceAttributeX(sourceGeometry, 'quarryPadBlend', sourceVertexIndex));
  arrays.dirtZoomGates.push(0);
  appendSourceCanopy(arrays.canopyOcclusion, sourceGeometry, sourceVertexIndex);
  arrays.hydrologyDebug.push(sampleHydrologyDebug(x, z));
  arrays.forestDebug.push(sampleForestDebug(x, z));
  return vertexIndex;
}

function filteredHeight(
  sampleHeight: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
): number {
  if (radius <= 0) return sampleHeight(x, z);
  return sampleHeight(x, z) * 0.5
    + sampleHeight(x - radius, z) * 0.125
    + sampleHeight(x + radius, z) * 0.125
    + sampleHeight(x, z - radius) * 0.125
    + sampleHeight(x, z + radius) * 0.125;
}

function squareSidePoint(side: number, halfExtent: number, t: number): { x: number; z: number } {
  if (side === 0) return { x: THREE.MathUtils.lerp(-halfExtent, halfExtent, t), z: -halfExtent };
  if (side === 1) return { x: halfExtent, z: THREE.MathUtils.lerp(-halfExtent, halfExtent, t) };
  if (side === 2) return { x: THREE.MathUtils.lerp(halfExtent, -halfExtent, t), z: halfExtent };
  return { x: -halfExtent, z: THREE.MathUtils.lerp(halfExtent, -halfExtent, t) };
}

function sourceBoundaryVertexIndex(side: number, segment: number, resolution: number): number {
  const last = resolution - 1;
  if (side === 0) return segment;
  if (side === 1) return segment * resolution + last;
  if (side === 2) return last * resolution + last - segment;
  return (last - segment) * resolution;
}

function sourceAttributeX(
  geometry: THREE.BufferGeometry,
  name: string,
  sourceVertexIndex: number | null,
): number {
  if (sourceVertexIndex === null) return 0;
  return geometry.getAttribute(name)?.getX(sourceVertexIndex) ?? 0;
}

function appendSourceCanopy(
  target: number[],
  geometry: THREE.BufferGeometry,
  sourceVertexIndex: number | null,
): void {
  const source = geometry.getAttribute('forestCanopyOcclusion');
  if (sourceVertexIndex === null || !source) {
    target.push(0, 0, 0, 0);
    return;
  }
  target.push(
    Math.round(THREE.MathUtils.clamp(source.getX(sourceVertexIndex), 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(source.getY(sourceVertexIndex), 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(source.getZ(sourceVertexIndex), 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(source.getW(sourceVertexIndex), 0, 1) * 255),
  );
}

function createHeightDebugColors(heights: readonly number[]): Float32Array {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const height of heights) {
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  }
  const range = Math.max(1e-6, maximum - minimum);
  const low = new THREE.Color(0x194b8c);
  const middle = new THREE.Color(0x54a865);
  const high = new THREE.Color(0xf0e7c8);
  const color = new THREE.Color();
  const result = new Float32Array(heights.length * 3);
  for (let index = 0; index < heights.length; index++) {
    const t = (heights[index]! - minimum) / range;
    if (t < 0.5) color.copy(low).lerp(middle, t * 2);
    else color.copy(middle).lerp(high, (t - 0.5) * 2);
    color.toArray(result, index * 3);
  }
  return result;
}

function createScalarDebugColors(
  values: readonly number[],
  lowHex: number,
  highHex: number,
): Float32Array {
  const low = new THREE.Color(lowHex);
  const high = new THREE.Color(highHex);
  const color = new THREE.Color();
  const result = new Float32Array(values.length * 3);
  for (let index = 0; index < values.length; index++) {
    color.copy(low).lerp(high, THREE.MathUtils.clamp(values[index] ?? 0, 0, 1));
    color.toArray(result, index * 3);
  }
  return result;
}

function resolveHorizonExtensionDistance(farDistance: number): number {
  return Math.max(
    farDistance * TERRAIN_HORIZON_PARAMETERS.coverage.farPlaneMultiplier,
    TERRAIN_HORIZON_PARAMETERS.coverage.minimumExtensionMeters,
  );
}
