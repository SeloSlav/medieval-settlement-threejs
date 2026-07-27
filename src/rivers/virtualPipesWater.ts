/**
 * 2D shallow-water style flow on a staggered grid (“virtual pipes”), after the method described in
 * https://andrewkrapivin.github.io/blog/posts/virtual-pipes-and-terrain/
 */

export type VirtualPipesWaterParams = {
  nx: number;
  ny: number;
  dx?: number;
  dy?: number;
  dt?: number;
  g?: number;
  friction?: number;
  viscosity?: number;
};

/**
 * Sparse, immutable topology for a fixed wet mask.
 *
 * Each edge record stores [flow index, first cell, second cell]. Cell records
 * store [depth index, left flow, right flow, bottom flow, top flow], using a
 * sentinel where a wet cell borders dry land. Keeping these as flat typed
 * arrays avoids per-step object traversal and division.
 */
export type VirtualPipesWetTopology = {
  nx: number;
  ny: number;
  horizontalEdges: Uint32Array;
  verticalEdges: Uint32Array;
  cells: Uint32Array;
};

export type BilinearGridSample = {
  i00: number;
  i10: number;
  i01: number;
  i11: number;
  tx: number;
  tz: number;
};

const DEFAULT_DX = 1;
const DEFAULT_DY = 1;
const DEFAULT_DT = 0.005;
const DEFAULT_G = 1;
const DEFAULT_FRICTION = 0.02;
const NO_FLOW_EDGE = 0xffff_ffff;

export function createVirtualPipesWetTopology(
  nx: number,
  ny: number,
  wetMask: Uint8Array,
): VirtualPipesWetTopology {
  if (nx < 2 || ny < 2 || wetMask.length !== nx * ny) {
    throw new Error('Wet topology requires nx, ny >= 2 and one mask value per cell');
  }

  const horizontalEdges: number[] = [];
  const verticalEdges: number[] = [];
  const cells: number[] = [];

  for (let y = 0; y < ny; y++) {
    const rowCell = y * nx;
    const rowFlowX = y * (nx + 1);
    const rowFlowY = y * nx;
    const nextRowFlowY = (y + 1) * nx;
    for (let x = 0; x < nx; x++) {
      const cell = rowCell + x;
      if (wetMask[cell] === 0) continue;
      cells.push(
        cell,
        x > 0 && wetMask[cell - 1] > 0
          ? rowFlowX + x
          : NO_FLOW_EDGE,
        x + 1 < nx && wetMask[cell + 1] > 0
          ? rowFlowX + x + 1
          : NO_FLOW_EDGE,
        y > 0 && wetMask[cell - nx] > 0
          ? rowFlowY + x
          : NO_FLOW_EDGE,
        y + 1 < ny && wetMask[cell + nx] > 0
          ? nextRowFlowY + x
          : NO_FLOW_EDGE,
      );
    }
  }

  for (let y = 0; y < ny; y++) {
    const rowCell = y * nx;
    const rowFlow = y * (nx + 1);
    for (let x = 1; x < nx; x++) {
      const left = rowCell + x - 1;
      const right = rowCell + x;
      if (wetMask[left] === 0 || wetMask[right] === 0) continue;
      horizontalEdges.push(rowFlow + x, left, right);
    }
  }

  for (let y = 1; y < ny; y++) {
    const bottomRow = (y - 1) * nx;
    const topRow = y * nx;
    const rowFlow = y * nx;
    for (let x = 0; x < nx; x++) {
      const bottom = bottomRow + x;
      const top = topRow + x;
      if (wetMask[bottom] === 0 || wetMask[top] === 0) continue;
      verticalEdges.push(rowFlow + x, bottom, top);
    }
  }

  return {
    nx,
    ny,
    horizontalEdges: Uint32Array.from(horizontalEdges),
    verticalEdges: Uint32Array.from(verticalEdges),
    cells: Uint32Array.from(cells),
  };
}

export function createBilinearGridSample(
  gx: number,
  gy: number,
  nx: number,
  ny: number,
): BilinearGridSample {
  const x = Math.max(0, Math.min(nx - 1, gx));
  const y = Math.max(0, Math.min(ny - 1, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  return {
    i00: y0 * nx + x0,
    i10: y0 * nx + x1,
    i01: y1 * nx + x0,
    i11: y1 * nx + x1,
    tx: x - x0,
    tz: y - y0,
  };
}

/**
 * Directly samples the delta between two grids. By bilinear linearity this is
 * equivalent to sampling two full surface fields and subtracting the results.
 */
export function sampleBilinearGridDifference(
  sample: BilinearGridSample,
  current: Float32Array,
  baseline: Float32Array,
): number {
  const { i00, i10, i01, i11, tx, tz } = sample;
  const d00 = current[i00] - baseline[i00];
  const d10 = current[i10] - baseline[i10];
  const d01 = current[i01] - baseline[i01];
  const d11 = current[i11] - baseline[i11];
  const dx0 = d00 + (d10 - d00) * tx;
  const dx1 = d01 + (d11 - d01) * tx;
  return dx0 + (dx1 - dx0) * tz;
}

export class VirtualPipesWater2D {
  readonly nx: number;
  readonly ny: number;
  dx: number;
  dy: number;
  dt: number;
  g: number;
  friction: number;
  viscosity: number;

  readonly terrain: Float32Array;
  readonly depth: Float32Array;
  readonly flowX: Float32Array;
  readonly flowY: Float32Array;

  constructor(params: VirtualPipesWaterParams) {
    const nx = params.nx | 0;
    const ny = params.ny | 0;
    if (nx < 2 || ny < 2) {
      throw new Error('VirtualPipesWater2D requires nx, ny >= 2');
    }
    this.nx = nx;
    this.ny = ny;
    this.dx = params.dx ?? DEFAULT_DX;
    this.dy = params.dy ?? DEFAULT_DY;
    this.dt = params.dt ?? DEFAULT_DT;
    this.g = params.g ?? DEFAULT_G;
    this.friction = params.friction ?? DEFAULT_FRICTION;
    this.viscosity = params.viscosity ?? 0;

    const nCell = nx * ny;
    this.terrain = new Float32Array(nCell);
    this.depth = new Float32Array(nCell);
    this.flowX = new Float32Array((nx + 1) * ny);
    this.flowY = new Float32Array(nx * (ny + 1));
  }

  writeSurfaceHeightsInto(out: Float32Array): void {
    const { nx, ny, terrain, depth } = this;
    const n = nx * ny;
    for (let i = 0; i < n; i++) out[i] = terrain[i] + depth[i];
  }

  step(): void {
    const { nx, ny, dx, dy, dt, g, friction, viscosity } = this;
    const rdx = g * dt / dx;
    const rdy = g * dt / dy;
    const invCell = dt / (dx * dy);
    const frictionFactor = Math.pow(Math.max(0, Math.min(1, 1 - friction)), dt);

    const terr = this.terrain;
    const depth = this.depth;
    const flowX = this.flowX;
    const flowY = this.flowY;

    for (let y = 0; y < ny; y++) {
      const rowT = y * nx;
      const rowF = y * (nx + 1);
      for (let x = 1; x < nx; x++) {
        const i0 = rowT + (x - 1);
        const i1 = rowT + x;
        const s0 = terr[i0] + depth[i0];
        const s1 = terr[i1] + depth[i1];
        const e = rowF + x;
        flowX[e] = flowX[e] * frictionFactor + (s0 - s1) * rdx;
      }
    }

    for (let y = 1; y < ny; y++) {
      const rowT = y * nx;
      const rowTPrev = (y - 1) * nx;
      for (let x = 0; x < nx; x++) {
        const i0 = rowTPrev + x;
        const i1 = rowT + x;
        const s0 = terr[i0] + depth[i0];
        const s1 = terr[i1] + depth[i1];
        const e = y * nx + x;
        flowY[e] = flowY[e] * frictionFactor + (s0 - s1) * rdy;
      }
    }

    if (viscosity > 0) {
      const nu = 3 * dt * viscosity;
      for (let y = 0; y < ny; y++) {
        const rowT = y * nx;
        const rowF = y * (nx + 1);
        for (let x = 1; x < nx; x++) {
          const e = rowF + x;
          const q = flowX[e];
          const iUp = rowT + (q > 0 ? x - 1 : x);
          let H = depth[iUp];
          H *= H;
          if (H > 0) flowX[e] *= H / (H + nu);
        }
      }
      for (let y = 1; y < ny; y++) {
        const rowT = y * nx;
        const rowPrev = (y - 1) * nx;
        for (let x = 0; x < nx; x++) {
          const e = y * nx + x;
          const q = flowY[e];
          const iUp = (q > 0 ? rowPrev : rowT) + x;
          let H = depth[iUp];
          H *= H;
          if (H > 0) flowY[e] *= H / (H + nu);
        }
      }
    }

    for (let y = 0; y < ny; y++) {
      const rowT = y * nx;
      const rowFX = y * (nx + 1);
      const rowFY = y * nx;
      const rowFY1 = (y + 1) * nx;
      for (let x = 0; x < nx; x++) {
        const i = rowT + x;
        let totalOut = 0;
        const fx0 = flowX[rowFX + x];
        const fx1 = flowX[rowFX + x + 1];
        const fy0 = flowY[rowFY + x];
        const fy1 = flowY[rowFY1 + x];
        if (fx0 < 0) totalOut += -fx0;
        if (fy0 < 0) totalOut += -fy0;
        if (fx1 > 0) totalOut += fx1;
        if (fy1 > 0) totalOut += fy1;

        const maxOut = (depth[i] * dx * dy) / dt;
        if (totalOut > 0) {
          const scale = Math.min(1, maxOut / totalOut);
          if (fx0 < 0) flowX[rowFX + x] *= scale;
          if (fy0 < 0) flowY[rowFY + x] *= scale;
          if (fx1 > 0) flowX[rowFX + x + 1] *= scale;
          if (fy1 > 0) flowY[rowFY1 + x] *= scale;
        }
      }
    }

    for (let y = 0; y < ny; y++) {
      const rowT = y * nx;
      const rowFX = y * (nx + 1);
      const rowFY = y * nx;
      const rowFY1 = (y + 1) * nx;
      for (let x = 0; x < nx; x++) {
        const i = rowT + x;
        const d =
          flowX[rowFX + x] + flowY[rowFY + x] - flowX[rowFX + x + 1] - flowY[rowFY1 + x];
        depth[i] += d * invCell;
      }
    }
  }

  /**
   * Uses the same numerical kernel as `step()` for active cells and edges, but
   * visits only precomputed wet topology. Dry-boundary edges are represented
   * by a sentinel and treated as zero, so stale or contaminated flow storage
   * cannot leak water across the bank.
   */
  stepMasked(topology: VirtualPipesWetTopology): void {
    const { nx, ny, dx, dy, dt, g, friction, viscosity } = this;
    if (topology.nx !== nx || topology.ny !== ny) {
      throw new Error('Wet topology dimensions must match the water solver');
    }

    const rdx = g * dt / dx;
    const rdy = g * dt / dy;
    const invCell = dt / (dx * dy);
    const frictionFactor = Math.pow(Math.max(0, Math.min(1, 1 - friction)), dt);

    const terr = this.terrain;
    const depth = this.depth;
    const flowX = this.flowX;
    const flowY = this.flowY;
    const horizontalEdges = topology.horizontalEdges;
    const verticalEdges = topology.verticalEdges;
    const cells = topology.cells;

    for (let p = 0; p < horizontalEdges.length; p += 3) {
      const edge = horizontalEdges[p];
      const left = horizontalEdges[p + 1];
      const right = horizontalEdges[p + 2];
      const leftSurface = terr[left] + depth[left];
      const rightSurface = terr[right] + depth[right];
      flowX[edge] = flowX[edge] * frictionFactor + (leftSurface - rightSurface) * rdx;
    }

    for (let p = 0; p < verticalEdges.length; p += 3) {
      const edge = verticalEdges[p];
      const bottom = verticalEdges[p + 1];
      const top = verticalEdges[p + 2];
      const bottomSurface = terr[bottom] + depth[bottom];
      const topSurface = terr[top] + depth[top];
      flowY[edge] = flowY[edge] * frictionFactor + (bottomSurface - topSurface) * rdy;
    }

    if (viscosity > 0) {
      const nu = 3 * dt * viscosity;
      for (let p = 0; p < horizontalEdges.length; p += 3) {
        const edge = horizontalEdges[p];
        const q = flowX[edge];
        const upstream = q > 0 ? horizontalEdges[p + 1] : horizontalEdges[p + 2];
        let height = depth[upstream];
        height *= height;
        if (height > 0) flowX[edge] *= height / (height + nu);
      }
      for (let p = 0; p < verticalEdges.length; p += 3) {
        const edge = verticalEdges[p];
        const q = flowY[edge];
        const upstream = q > 0 ? verticalEdges[p + 1] : verticalEdges[p + 2];
        let height = depth[upstream];
        height *= height;
        if (height > 0) flowY[edge] *= height / (height + nu);
      }
    }

    for (let p = 0; p < cells.length; p += 5) {
      const cell = cells[p];
      const leftEdge = cells[p + 1];
      const rightEdge = cells[p + 2];
      const bottomEdge = cells[p + 3];
      const topEdge = cells[p + 4];
      const leftFlow = leftEdge === NO_FLOW_EDGE ? 0 : flowX[leftEdge];
      const rightFlow = rightEdge === NO_FLOW_EDGE ? 0 : flowX[rightEdge];
      const bottomFlow = bottomEdge === NO_FLOW_EDGE ? 0 : flowY[bottomEdge];
      const topFlow = topEdge === NO_FLOW_EDGE ? 0 : flowY[topEdge];
      let totalOut = 0;
      if (leftFlow < 0) totalOut += -leftFlow;
      if (bottomFlow < 0) totalOut += -bottomFlow;
      if (rightFlow > 0) totalOut += rightFlow;
      if (topFlow > 0) totalOut += topFlow;

      if (totalOut <= 0) continue;
      const maxOut = (depth[cell] * dx * dy) / dt;
      const scale = Math.min(1, maxOut / totalOut);
      if (leftFlow < 0) flowX[leftEdge] *= scale;
      if (bottomFlow < 0) flowY[bottomEdge] *= scale;
      if (rightFlow > 0) flowX[rightEdge] *= scale;
      if (topFlow > 0) flowY[topEdge] *= scale;
    }

    for (let p = 0; p < cells.length; p += 5) {
      const cell = cells[p];
      const leftEdge = cells[p + 1];
      const rightEdge = cells[p + 2];
      const bottomEdge = cells[p + 3];
      const topEdge = cells[p + 4];
      const delta =
        (leftEdge === NO_FLOW_EDGE ? 0 : flowX[leftEdge]) +
        (bottomEdge === NO_FLOW_EDGE ? 0 : flowY[bottomEdge]) -
        (rightEdge === NO_FLOW_EDGE ? 0 : flowX[rightEdge]) -
        (topEdge === NO_FLOW_EDGE ? 0 : flowY[topEdge]);
      depth[cell] += delta * invCell;
    }
  }
}
