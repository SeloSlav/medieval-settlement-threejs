import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from './RiverField.ts';
import {
  createBilinearGridSample,
  createVirtualPipesWetTopology,
  sampleBilinearGridDifference,
  type BilinearGridSample,
  VirtualPipesWater2D,
} from './virtualPipesWater.ts';
import { disposeSharedRiverWaterMaterial, getSharedRiverWaterMaterial } from './RiverWaterMaterial.ts';
import {
  computeWaterFeatherAlpha,
  computeWaterFoamBase,
  createRiverWaterShoreMaps,
  disposeRiverWaterShoreMaps,
} from './riverWaterShoreMaps.ts';

const RIVER_WATER_DEPTH = 1.05;
const RIVER_CENTER_DEPTH_BOOST = 0.2;
const RIVER_SHORE_DEPTH_LIFT = 0.06;
const WATER_SIM_RENDER_DELTA_SCALE = 0.24;
export const WATER_SIM_RENDER_DELTA_LIMIT = 0.16;
const MAX_SIM_CATCHUP_STEPS = 2;
const WATER_CPU_UPDATE_INTERVAL_SEC = 1 / 20;
const WATER_CLIP_FEATHER = -0.62;
export const MAX_RIVER_WATER_NORMAL_SLOPE = 0.16;
export const RIVER_WATER_RECEIVES_SHADOWS = false;
const RIVER_NORMAL_SAMPLE_STEP = 0.75;

export { disposeSharedRiverWaterMaterial };

export function computeRiverSimulationRenderDelta(depthDelta: number): number {
  if (!Number.isFinite(depthDelta)) return 0;
  return Math.max(
    -WATER_SIM_RENDER_DELTA_LIMIT,
    Math.min(
      WATER_SIM_RENDER_DELTA_LIMIT,
      depthDelta * WATER_SIM_RENDER_DELTA_SCALE,
    ),
  );
}

export type RiverWaterController = {
  tick: (dt: number, timeSec?: number) => void;
  dispose: () => void;
};

/**
 * Writes a unit water normal while bounding the horizontal gradient.
 *
 * The clipped river mesh deliberately duplicates some shoreline intersection
 * vertices. Face-derived normals therefore diverge across otherwise identical
 * points and can turn a smooth sun glint into saturated triangular facets.
 * Supplying the same sampled gradient for each duplicate keeps the highlight
 * continuous; the slope bound prevents a terrain-bed step from becoming a
 * near-vertical mirror.
 */
export function writeBoundedRiverWaterNormal(
  target: Float32Array,
  offset: number,
  slopeX: number,
  slopeZ: number,
): void {
  const slopeLength = Math.hypot(slopeX, slopeZ);
  const scale = slopeLength > MAX_RIVER_WATER_NORMAL_SLOPE
    ? MAX_RIVER_WATER_NORMAL_SLOPE / slopeLength
    : 1;
  const nx = -slopeX * scale;
  const ny = 1;
  const nz = -slopeZ * scale;
  const invLength = 1 / Math.hypot(nx, ny, nz);
  target[offset] = nx * invLength;
  target[offset + 1] = ny * invLength;
  target[offset + 2] = nz * invLength;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hashNoise2D(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashNoise2D(x0, z0);
  const b = hashNoise2D(x0 + 1, z0);
  const c = hashNoise2D(x0, z0 + 1);
  const d = hashNoise2D(x0 + 1, z0 + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

function sampleFloatGridBilinear(values: Float32Array, nx: number, nz: number, gx: number, gz: number): number {
  const x = Math.max(0, Math.min(nx - 1, gx));
  const z = Math.max(0, Math.min(nz - 1, gz));
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(nx - 1, x0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const tx = x - x0;
  const tz = z - z0;
  const h00 = values[z0 * nx + x0] ?? 0;
  const h10 = values[z0 * nx + x1] ?? h00;
  const h01 = values[z1 * nx + x0] ?? h00;
  const h11 = values[z1 * nx + x1] ?? h10;
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

function compactWaterVertices(params: {
  indices: number[];
  vertexGx: number[];
  vertexGz: number[];
  foamBases: number[];
  featherAlphas: number[];
  positions: Float32Array;
  nx: number;
  nz: number;
}): {
  indices: number[];
  gx: Float32Array;
  gz: Float32Array;
  foamBase: Float32Array;
  featherAlpha: Float32Array;
  positions: Float32Array;
  simDelta: Float32Array;
  gridSamples: BilinearGridSample[];
} {
  const used = new Set<number>();
  for (const index of params.indices) used.add(index);
  const sorted = Array.from(used).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sorted.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));

  const count = sorted.length;
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  const foamBase = new Float32Array(count);
  const featherAlpha = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const simDelta = new Float32Array(count);
  const gridSamples = new Array<BilinearGridSample>(count);

  for (let newIndex = 0; newIndex < count; newIndex++) {
    const oldIndex = sorted[newIndex];
    const gxValue = params.vertexGx[oldIndex];
    const gzValue = params.vertexGz[oldIndex];
    gx[newIndex] = gxValue;
    gz[newIndex] = gzValue;
    foamBase[newIndex] = params.foamBases[oldIndex];
    featherAlpha[newIndex] = params.featherAlphas[oldIndex];
    positions[newIndex * 3] = params.positions[oldIndex * 3];
    positions[newIndex * 3 + 1] = params.positions[oldIndex * 3 + 1];
    positions[newIndex * 3 + 2] = params.positions[oldIndex * 3 + 2];
    gridSamples[newIndex] = createBilinearGridSample(gxValue, gzValue, params.nx, params.nz);
  }

  return {
    indices: params.indices.map((index) => remap.get(index)!),
    gx,
    gz,
    foamBase,
    featherAlpha,
    positions,
    simDelta,
    gridSamples,
  };
}

type ClipPoint = { gx: number; gz: number; signed: number; index: number };

export function createRiverWaterMesh(
  group: THREE.Group,
  terrain: Terrain,
  riverField: RiverField,
): RiverWaterController | null {
  const nx = riverField.resolution;
  const nz = riverField.resolution;
  if (nx < 2 || nz < 2) return null;

  const shoreMaps = createRiverWaterShoreMaps(riverField);
  const organicSigned = riverField.organicSignedDistance;
  const riverMask = riverField.riverMask;

  const clipSigned = (cellIndex: number, ix: number, iz: number): number => {
    const organic = organicSigned[cellIndex] ?? -1;
    const mask = riverMask[cellIndex] ?? 0;
    if (mask < 0.38) return organic;
    if (organic > 2.8) return organic;
    const wx = riverField.startX + ix * riverField.stepX;
    const wz = riverField.startZ + iz * riverField.stepZ;
    const edgeNoise = (valueNoise2D(wx * 0.17 + 4.2, wz * 0.17 - 2.8) - 0.5) * 0.24;
    const organicShore = organic + edgeNoise * (1 - smoothstep(0, 2.2, organic));
    const interiorFloor = smoothstep(0.38, 0.72, mask) * 0.58;
    return Math.max(organicShore, interiorFloor);
  };

  const effectiveClipSignedAt = (gx: number, gz: number): number => {
    const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
    const iz = Math.max(0, Math.min(nz - 1, Math.round(gz)));
    return clipSigned(iz * nx + ix, ix, iz);
  };

  const computeFeatherAlpha = (_gx: number, _gz: number, signed: number): number =>
    computeWaterFeatherAlpha(signed);

  const wetMask = new Uint8Array(nx * nz);
  let hasWet = false;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const wet = riverField.riverMask[i] >= 0.38;
      wetMask[i] = wet ? 1 : 0;
      if (wet) hasWet = true;
    }
  }
  if (!hasWet) return null;

  const sim = new VirtualPipesWater2D({
    nx,
    ny: nz,
    dx: riverField.stepX,
    dy: riverField.stepZ,
    dt: 0.005,
    g: 2.4,
    friction: 0.06,
    viscosity: 0.1,
  });
  const wetTopology = createVirtualPipesWetTopology(nx, nz, wetMask);

  const baseDepth = new Float32Array(nx * nz);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const wx = riverField.startX + ix * riverField.stepX;
      const wz = riverField.startZ + iz * riverField.stepZ;
      const bed = terrain.getHeightAt(wx, wz);
      sim.terrain[i] = bed;
      if (wetMask[i]) {
        const shore = 1 - Math.min(1, Math.max(0, organicSigned[i]) / 6);
        const centerDepth = 1 - shore;
        const depth = RIVER_WATER_DEPTH + shore * RIVER_SHORE_DEPTH_LIFT + centerDepth * RIVER_CENTER_DEPTH_BOOST;
        baseDepth[i] = depth;
        sim.depth[i] = depth;
      } else {
        baseDepth[i] = 0;
        sim.depth[i] = 0;
      }
    }
  }

  const vertexGx: number[] = [];
  const vertexGz: number[] = [];
  const foamBases: number[] = [];
  const featherAlphas: number[] = [];

  const appendVertex = (
    gx: number,
    gz: number,
    signedOverride?: number,
    foamSignedOverride?: number,
  ): number => {
    const signed =
      signedOverride ??
      sampleFloatGridBilinear(organicSigned, nx, nz, gx, gz);
    const foamSigned =
      foamSignedOverride ??
      signed;
    const foamBase = Math.min(1, computeWaterFoamBase(foamSigned));
    const clipSignedAt = signedOverride ?? effectiveClipSignedAt(gx, gz);
    const index = vertexGx.length;
    vertexGx.push(gx);
    vertexGz.push(gz);
    foamBases.push(Math.min(1, foamBase));
    featherAlphas.push(computeFeatherAlpha(gx, gz, clipSignedAt));
    return index;
  };

  const indices: number[] = [];
  const gridVertexIndices = new Int32Array(nx * nz);
  gridVertexIndices.fill(-1);
  const gridVertexIndex = (
    ix: number,
    iz: number,
    signed: number,
    foamSigned: number,
  ): number => {
    const cellIndex = iz * nx + ix;
    const existing = gridVertexIndices[cellIndex];
    if (existing >= 0) return existing;
    const created = appendVertex(ix, iz, signed, foamSigned);
    gridVertexIndices[cellIndex] = created;
    return created;
  };

  const makeIntersection = (a: ClipPoint, b: ClipPoint): ClipPoint => {
    const denom = a.signed - b.signed;
    const t =
      denom === 0
        ? 0.5
        : Math.max(0, Math.min(1, (a.signed - WATER_CLIP_FEATHER) / denom));
    const gx = a.gx + (b.gx - a.gx) * t;
    const gz = a.gz + (b.gz - a.gz) * t;
    const organicAt = sampleFloatGridBilinear(organicSigned, nx, nz, gx, gz);
    return {
      gx,
      gz,
      signed: WATER_CLIP_FEATHER,
      index: appendVertex(gx, gz, WATER_CLIP_FEATHER, organicAt),
    };
  };

  const clipWaterPolygon = (input: ClipPoint[]): ClipPoint[] => {
    const output: ClipPoint[] = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const next = input[(i + 1) % input.length];
      const currentInside = current.signed >= WATER_CLIP_FEATHER;
      const nextInside = next.signed >= WATER_CLIP_FEATHER;
      if (currentInside && nextInside) {
        output.push(next);
      } else if (currentInside && !nextInside) {
        output.push(makeIntersection(current, next));
      } else if (!currentInside && nextInside) {
        output.push(makeIntersection(current, next), next);
      }
    }
    return output;
  };

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const bl = iz * nx + ix;
      const br = iz * nx + ix + 1;
      const tl = (iz + 1) * nx + ix;
      const tr = (iz + 1) * nx + ix + 1;
      const blSigned = clipSigned(bl, ix, iz);
      const tlSigned = clipSigned(tl, ix, iz + 1);
      const trSigned = clipSigned(tr, ix + 1, iz + 1);
      const brSigned = clipSigned(br, ix + 1, iz);
      const blInside = blSigned >= WATER_CLIP_FEATHER;
      const tlInside = tlSigned >= WATER_CLIP_FEATHER;
      const trInside = trSigned >= WATER_CLIP_FEATHER;
      const brInside = brSigned >= WATER_CLIP_FEATHER;
      const insideCount = Number(blInside) + Number(tlInside) + Number(trInside) + Number(brInside);
      if (insideCount === 0) continue;

      const blVertex = blInside
        ? gridVertexIndex(ix, iz, blSigned, organicSigned[bl] ?? 0)
        : -1;
      const tlVertex = tlInside
        ? gridVertexIndex(ix, iz + 1, tlSigned, organicSigned[tl] ?? 0)
        : -1;
      const trVertex = trInside
        ? gridVertexIndex(ix + 1, iz + 1, trSigned, organicSigned[tr] ?? 0)
        : -1;
      const brVertex = brInside
        ? gridVertexIndex(ix + 1, iz, brSigned, organicSigned[br] ?? 0)
        : -1;

      if (insideCount === 4) {
        indices.push(blVertex, tlVertex, brVertex, brVertex, tlVertex, trVertex);
        continue;
      }

      const corners: ClipPoint[] = [
        { gx: ix, gz: iz, signed: blSigned, index: blVertex },
        { gx: ix, gz: iz + 1, signed: tlSigned, index: tlVertex },
        { gx: ix + 1, gz: iz + 1, signed: trSigned, index: trVertex },
        { gx: ix + 1, gz: iz, signed: brSigned, index: brVertex },
      ];

      const clipped = clipWaterPolygon(corners);
      if (clipped.length < 3) continue;
      const first = clipped[0].index;
      for (let i = 1; i < clipped.length - 1; i++) {
        indices.push(first, clipped[i].index, clipped[i + 1].index);
      }
    }
  }
  if (indices.length === 0) return null;

  const fullPositions = new Float32Array(vertexGx.length * 3);
  for (let vi = 0; vi < vertexGx.length; vi++) {
    const gx = vertexGx[vi];
    const gz = vertexGz[vi];
    fullPositions[vi * 3] = riverField.startX + gx * riverField.stepX;
    fullPositions[vi * 3 + 1] =
      sampleFloatGridBilinear(sim.terrain, nx, nz, gx, gz) +
      sampleFloatGridBilinear(baseDepth, nx, nz, gx, gz);
    fullPositions[vi * 3 + 2] = riverField.startZ + gz * riverField.stepZ;
  }

  const compact = compactWaterVertices({
    indices,
    vertexGx,
    vertexGz,
    foamBases,
    featherAlphas,
    positions: fullPositions,
    nx,
    nz,
  });

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(compact.positions, 3);
  const foamAttr = new THREE.BufferAttribute(compact.foamBase, 1);
  const featherAttr = new THREE.BufferAttribute(compact.featherAlpha, 1);
  const simDeltaAttr = new THREE.BufferAttribute(compact.simDelta, 1);
  simDeltaAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('foamBase', foamAttr);
  geometry.setAttribute('featherAlpha', featherAttr);
  geometry.setAttribute('simDelta', simDeltaAttr);
  geometry.setIndex(compact.indices);

  // Derive normals from the continuous still-water heightfield rather than
  // triangle adjacency. Clipped shoreline intersections are duplicated by
  // construction, and computeVertexNormals() gives those duplicates unrelated
  // face normals—the exact source of the hard white specular polygons seen at
  // the near screen edge.
  const normals = new Float32Array(compact.gx.length * 3);
  const sampleStillSurface = (gx: number, gz: number): number =>
    sampleFloatGridBilinear(sim.terrain, nx, nz, gx, gz)
      + sampleFloatGridBilinear(baseDepth, nx, nz, gx, gz);
  for (let vi = 0; vi < compact.gx.length; vi++) {
    const gx = compact.gx[vi];
    const gz = compact.gz[vi];
    const leftGx = Math.max(0, gx - RIVER_NORMAL_SAMPLE_STEP);
    const rightGx = Math.min(nx - 1, gx + RIVER_NORMAL_SAMPLE_STEP);
    const bottomGz = Math.max(0, gz - RIVER_NORMAL_SAMPLE_STEP);
    const topGz = Math.min(nz - 1, gz + RIVER_NORMAL_SAMPLE_STEP);
    const worldDx = Math.max(1e-6, (rightGx - leftGx) * riverField.stepX);
    const worldDz = Math.max(1e-6, (topGz - bottomGz) * riverField.stepZ);
    const slopeX =
      (sampleStillSurface(rightGx, gz) - sampleStillSurface(leftGx, gz))
      / worldDx;
    const slopeZ =
      (sampleStillSurface(gx, topGz) - sampleStillSurface(gx, bottomGz))
      / worldDz;
    writeBoundedRiverWaterNormal(normals, vi * 3, slopeX, slopeZ);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  const vertexCount = compact.gx.length;
  const gridSamples = compact.gridSamples;

  const updateSimDelta = () => {
    const simValues = simDeltaAttr.array as Float32Array;
    for (let vi = 0; vi < vertexCount; vi++) {
      simValues[vi] = computeRiverSimulationRenderDelta(
        sampleBilinearGridDifference(gridSamples[vi], sim.depth, baseDepth),
      );
    }
    simDeltaAttr.needsUpdate = true;
  };

  const mesh = new THREE.Mesh(geometry, getSharedRiverWaterMaterial(shoreMaps));
  mesh.name = 'River water surface';
  mesh.userData.water = true;
  mesh.raycast = () => {};
  // Opaque tree-shadow silhouettes read as disconnected black bands on a
  // translucent surface, especially under the lower rain/winter sun. The
  // terrain/backdrop below still receives those shadows; the water film
  // itself should preserve reflected sky and transmitted riverbed light.
  mesh.receiveShadow = RIVER_WATER_RECEIVES_SHADOWS;
  mesh.renderOrder = 1.25;
  group.add(mesh);

  updateSimDelta();

  let simAccum = 0;
  let cpuAccum = 0;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (mesh.parent === group) group.remove(mesh);
    geometry.dispose();
    disposeRiverWaterShoreMaps(shoreMaps);
    disposeSharedRiverWaterMaterial();
  };

  const tick = (dt: number, _timeSec?: number) => {
    if (disposed) return;

    cpuAccum += Math.min(0.1, Math.max(0, dt));
    if (cpuAccum < WATER_CPU_UPDATE_INTERVAL_SEC) return;
    const updateDt = cpuAccum;
    cpuAccum = 0;

    // The visual solver intentionally advances at most two 5 ms steps per
    // 20 Hz presentation update. Cap discarded catch-up time so a slow frame
    // cannot create an unbounded accumulator that can never be repaid.
    simAccum = Math.min(
      sim.dt * MAX_SIM_CATCHUP_STEPS,
      simAccum + Math.min(0.1, Math.max(0, updateDt)),
    );
    let steps = 0;
    let stepped = false;
    while (simAccum >= sim.dt && steps < MAX_SIM_CATCHUP_STEPS) {
      sim.stepMasked(wetTopology);
      simAccum -= sim.dt;
      steps++;
      stepped = true;
    }
    if (stepped) updateSimDelta();
  };

  return { tick, dispose };
}
