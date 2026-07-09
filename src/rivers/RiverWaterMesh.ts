import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from './RiverField.ts';
import { VirtualPipesWater2D } from './virtualPipesWater.ts';
import { disposeSharedRiverWaterMaterial, getSharedRiverWaterMaterial } from './RiverWaterMaterial.ts';

const WATER_BODY_BASE = new THREE.Color(0x4a93a8);
const WATER_FOAM_BASE = new THREE.Color(0xf2faf7);
const RIVER_WATER_DEPTH = 0.78;
const MAX_SIM_CATCHUP_STEPS = 2;
const WATER_CPU_UPDATE_INTERVAL_SEC = 1 / 20;
const SHORE_LAP_MAX = 0.13;
const SHORE_FOAM_MAX = 0.82;
const WATER_CLIP_FEATHER = -0.62;
const WATER_ALPHA_FEATHER_IN = 1.45;

export { disposeSharedRiverWaterMaterial };

export type RiverWaterController = {
  tick: (dt: number, timeSec?: number) => void;
  dispose: () => void;
};

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

function writeWaterConstrainedBoundaryFlows(sim: VirtualPipesWater2D, wetMask: Uint8Array): void {
  const { nx, ny, flowX, flowY } = sim;
  for (let y = 0; y < ny; y++) {
    const rowFX = y * (nx + 1);
    flowX[rowFX] = 0;
    flowX[rowFX + nx] = 0;
    for (let x = 1; x < nx; x++) {
      const leftWet = wetMask[y * nx + (x - 1)] > 0;
      const rightWet = wetMask[y * nx + x] > 0;
      if (!leftWet || !rightWet) flowX[rowFX + x] = 0;
    }
  }
  for (let y = 0; y <= ny; y++) {
    const rowFY = y * nx;
    if (y === 0 || y === ny) {
      for (let x = 0; x < nx; x++) flowY[rowFY + x] = 0;
      continue;
    }
    for (let x = 0; x < nx; x++) {
      const bottomWet = wetMask[(y - 1) * nx + x] > 0;
      const topWet = wetMask[y * nx + x] > 0;
      if (!bottomWet || !topWet) flowY[rowFY + x] = 0;
    }
  }
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

  const computeFeatherAlpha = (gx: number, gz: number, signed: number, timeSec = 0): number => {
    const wx = riverField.startX + gx * riverField.stepX;
    const wz = riverField.startZ + gz * riverField.stepZ;
    const edgeNoise =
      (valueNoise2D(wx * 0.36 + timeSec * 0.11, wz * 0.36 - timeSec * 0.08) - 0.5) * 0.2 +
      (valueNoise2D(wx * 0.11 - 7.4, wz * 0.11 + 3.1) - 0.5) * 0.12;
    return smoothstep(WATER_CLIP_FEATHER - 0.06, WATER_ALPHA_FEATHER_IN + 0.18, signed + edgeNoise);
  };

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

  const baseDepth = new Float32Array(nx * nz);
  const renderSurfaceBase = new Float32Array(nx * nz);
  const stillSurface = new Float32Array(nx * nz);
  const surfaceScratch = new Float32Array(nx * nz);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const wx = riverField.startX + ix * riverField.stepX;
      const wz = riverField.startZ + iz * riverField.stepZ;
      const bed = terrain.getHeightAt(wx, wz);
      sim.terrain[i] = bed;
      if (wetMask[i]) {
        const shore = 1 - Math.min(1, Math.max(0, organicSigned[i]) / 6);
        const depth = RIVER_WATER_DEPTH + shore * 0.08;
        baseDepth[i] = depth;
        sim.depth[i] = depth;
      } else {
        baseDepth[i] = 0;
        sim.depth[i] = 0;
      }
      stillSurface[i] = sim.terrain[i] + baseDepth[i];
      renderSurfaceBase[i] = stillSurface[i];
    }
  }

  const vertexGx: number[] = [];
  const vertexGz: number[] = [];
  const foamBases: number[] = [];
  const featherAlphas: number[] = [];
  const colors: number[] = [];

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
    const foamBase = foamSigned >= 0 ? 1 - smoothstep(0.04, 3.2, foamSigned) : 1 - smoothstep(-0.35, 0.08, foamSigned);
    const clipSignedAt = signedOverride ?? effectiveClipSignedAt(gx, gz);
    const index = vertexGx.length;
    vertexGx.push(gx);
    vertexGz.push(gz);
    foamBases.push(Math.min(1, foamBase));
    featherAlphas.push(computeFeatherAlpha(gx, gz, clipSignedAt));
    colors.push(WATER_BODY_BASE.r, WATER_BODY_BASE.g, WATER_BODY_BASE.b);
    return index;
  };

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      appendVertex(ix, iz, clipSigned(i, ix, iz), organicSigned[i] ?? 0);
    }
  }

  const indices: number[] = [];
  const gridVertexIndex = (ix: number, iz: number): number => iz * nx + ix;

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
      const corners: ClipPoint[] = [
        { gx: ix, gz: iz, signed: clipSigned(bl, ix, iz), index: gridVertexIndex(ix, iz) },
        { gx: ix, gz: iz + 1, signed: clipSigned(tl, ix, iz + 1), index: gridVertexIndex(ix, iz + 1) },
        { gx: ix + 1, gz: iz + 1, signed: clipSigned(tr, ix + 1, iz + 1), index: gridVertexIndex(ix + 1, iz + 1) },
        { gx: ix + 1, gz: iz, signed: clipSigned(br, ix + 1, iz), index: gridVertexIndex(ix + 1, iz) },
      ];
      const insideCount = corners.reduce(
        (count, corner) => count + (corner.signed >= WATER_CLIP_FEATHER ? 1 : 0),
        0,
      );
      if (insideCount === 0) continue;
      if (insideCount === 4) {
        indices.push(bl, tl, br, br, tl, tr);
        continue;
      }

      const clipped = clipWaterPolygon(corners);
      if (clipped.length < 3) continue;
      const first = clipped[0].index;
      for (let i = 1; i < clipped.length - 1; i++) {
        indices.push(first, clipped[i].index, clipped[i + 1].index);
      }
    }
  }
  if (indices.length === 0) return null;

  const vertexGxAttr = Float32Array.from(vertexGx);
  const vertexGzAttr = Float32Array.from(vertexGz);
  const foamBaseAttr = Float32Array.from(foamBases);
  const featherAlphaAttr = new Float32Array(featherAlphas);
  const positions = new Float32Array(vertexGxAttr.length * 3);

  const writePositions = () => {
    for (let vi = 0; vi < vertexGxAttr.length; vi++) {
      const gx = vertexGxAttr[vi];
      const gz = vertexGzAttr[vi];
      positions[vi * 3] = riverField.startX + gx * riverField.stepX;
      positions[vi * 3 + 1] = sampleFloatGridBilinear(renderSurfaceBase, nx, nz, gx, gz);
      positions[vi * 3 + 2] = riverField.startZ + gz * riverField.stepZ;
    }
  };

  writePositions();

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(new Float32Array(colors), 3);
  const featherAttr = new THREE.BufferAttribute(featherAlphaAttr, 1);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('featherAlpha', featherAttr);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const updateWaterSurface = (timeSec: number) => {
    sim.writeSurfaceHeightsInto(surfaceScratch);
    for (let vi = 0; vi < vertexGxAttr.length; vi++) {
      const gx = vertexGxAttr[vi];
      const gz = vertexGzAttr[vi];
      const wx = riverField.startX + gx * riverField.stepX;
      const wz = riverField.startZ + gz * riverField.stepZ;
      const foamBase = foamBaseAttr[vi];
      const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
      const iz = Math.max(0, Math.min(nz - 1, Math.round(gz)));
      const isBoundary = gx <= 0 || gz <= 0 || gx >= nx - 1 || gz >= nz - 1;
      const wet = wetMask[iz * nx + ix] > 0;
      const simDelta =
        wet && !isBoundary
          ? (sampleFloatGridBilinear(surfaceScratch, nx, nz, gx, gz) -
              sampleFloatGridBilinear(stillSurface, nx, nz, gx, gz)) *
            WATER_SIM_RENDER_DELTA_SCALE
          : 0;

      featherAttr.setX(vi, computeFeatherAlpha(gx, gz, effectiveClipSignedAt(gx, gz), timeSec));

      const shoreMask = Math.pow(foamBase, 0.72);
      const lapPhaseA = timeSec * 2.35 + wx * 0.34 + wz * 0.12;
      const lapPhaseB = timeSec * 3.85 - wx * 0.21 + wz * 0.31;
      const lapPhaseC = timeSec * 1.65 + wx * 0.11 - wz * 0.27;
      const lap =
        shoreMask *
        SHORE_LAP_MAX *
        (Math.sin(lapPhaseA) * 0.52 + Math.sin(lapPhaseB) * 0.33 + Math.sin(lapPhaseC) * 0.15);
      const ripple = (valueNoise2D(wx * 0.24 + timeSec * 0.38, wz * 0.24 - timeSec * 0.31) - 0.5) * shoreMask * 0.035;

      positionAttr.setY(
        vi,
        sampleFloatGridBilinear(renderSurfaceBase, nx, nz, gx, gz) + simDelta + lap + ripple,
      );

      const foamNoise = valueNoise2D(wx * 0.42 + timeSec * 0.44, wz * 0.42 - timeSec * 0.36);
      const foamWave = 0.5 + 0.5 * Math.sin(timeSec * 4.4 + wx * 0.19 - wz * 0.16);
      const foamPulse = 0.5 + 0.5 * Math.sin(timeSec * 6.1 + gx * 1.15 + gz * 0.83);
      const foam = Math.min(
        SHORE_FOAM_MAX,
        Math.pow(shoreMask, 1.15) * (0.34 + foamNoise * 0.34 + foamWave * 0.24 + foamPulse * 0.22),
      );
      colorAttr.setXYZ(
        vi,
        WATER_BODY_BASE.r + (WATER_FOAM_BASE.r - WATER_BODY_BASE.r) * foam,
        WATER_BODY_BASE.g + (WATER_FOAM_BASE.g - WATER_BODY_BASE.g) * foam,
        WATER_BODY_BASE.b + (WATER_FOAM_BASE.b - WATER_BODY_BASE.b) * foam,
      );
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    featherAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const mesh = new THREE.Mesh(geometry, getSharedRiverWaterMaterial());
  mesh.name = 'River water surface';
  mesh.userData.water = true;
  mesh.raycast = () => {};
  mesh.receiveShadow = true;
  mesh.renderOrder = 1.25;
  group.add(mesh);

  let simAccum = 0;
  let cpuAccum = 0;
  let elapsed = 0;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (mesh.parent === group) group.remove(mesh);
    geometry.dispose();
  };

  const tick = (dt: number, timeSec?: number) => {
    if (disposed) return;
    elapsed = timeSec ?? elapsed + dt;
    updateWaterSurface(elapsed);

    cpuAccum += Math.min(0.1, Math.max(0, dt));
    if (cpuAccum < WATER_CPU_UPDATE_INTERVAL_SEC) return;
    const updateDt = cpuAccum;
    cpuAccum = 0;

    simAccum += Math.min(0.1, Math.max(0, updateDt));
    let steps = 0;
    while (simAccum >= sim.dt && steps < MAX_SIM_CATCHUP_STEPS) {
      writeWaterConstrainedBoundaryFlows(sim, wetMask);
      sim.step();
      writeWaterConstrainedBoundaryFlows(sim, wetMask);
      simAccum -= sim.dt;
      steps++;
    }
  };

  return { tick, dispose };
}
