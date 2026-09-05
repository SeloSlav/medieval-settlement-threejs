import assert from 'node:assert/strict';
import {
  createBilinearGridSample,
  createVirtualPipesWetTopology,
  sampleBilinearGridDifference,
  VirtualPipesWater2D,
} from '../src/rivers/virtualPipesWater.ts';
import {
  computeRiverSimulationRenderDelta,
  WATER_SIM_RENDER_DELTA_LIMIT,
} from '../src/e2e/waterBaselineSimulation.ts';

function createSolver(nx: number, ny: number): VirtualPipesWater2D {
  const sim = new VirtualPipesWater2D({
    nx,
    ny,
    dx: 2.1,
    dy: 1.7,
    dt: 0.005,
    g: 2.4,
    friction: 0.06,
    viscosity: 0.1,
  });
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      sim.terrain[i] = Math.sin(x * 0.41) * 0.17 + Math.cos(y * 0.37) * 0.13;
      sim.depth[i] = 0.8 + Math.sin(x * 0.23 + y * 0.31) * 0.12;
    }
  }
  return sim;
}

// When every cell is wet, sparse iteration must be exactly numerically
// equivalent to the original dense solver, including viscosity and limiting.
{
  const nx = 7;
  const ny = 6;
  const dense = createSolver(nx, ny);
  const sparse = createSolver(nx, ny);
  const topology = createVirtualPipesWetTopology(nx, ny, new Uint8Array(nx * ny).fill(1));

  assert.equal(topology.cells.length / 5, nx * ny);
  assert.equal(topology.boundaryFlags.length, nx * ny);
  assert.equal(
    topology.boundaryFlags.reduce((count, flag) => count + Number(flag === 0), 0),
    (nx - 2) * (ny - 2),
    'only the outer ring should pay dry-edge sentinel checks in an all-wet grid',
  );
  assert.equal(topology.horizontalEdges.length / 3, (nx - 1) * ny);
  assert.equal(topology.verticalEdges.length / 3, nx * (ny - 1));

  for (let step = 0; step < 12; step++) {
    dense.step();
    sparse.stepMasked(topology);
  }

  assert.deepEqual(sparse.depth, dense.depth);
  assert.deepEqual(sparse.flowX, dense.flowX);
  assert.deepEqual(sparse.flowY, dense.flowY);
}

// A branched partial mask exercises the river case: only wet cells and
// wet-to-wet edges participate, dry depths stay untouched, and the closed
// topology conserves water.
{
  const nx = 5;
  const ny = 4;
  const mask = new Uint8Array([
    0, 1, 1, 0, 0,
    1, 1, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 0, 1, 1, 1,
  ]);
  const sim = createSolver(nx, ny);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) sim.depth[i] = 0;
  }
  const topology = createVirtualPipesWetTopology(nx, ny, mask);
  assert.equal(topology.cells.length / 5, 10);
  assert.equal(topology.boundaryFlags.length, 10);
  assert.ok(topology.boundaryFlags.some((flag) => flag !== 0));
  assert.equal(topology.horizontalEdges.length / 3, 6);
  assert.equal(topology.verticalEdges.length / 3, 4);

  const initialWetVolume = topology.cells.reduce(
    (total, value, index) => index % 5 === 0 ? total + sim.depth[value] : total,
    0,
  );
  for (let step = 0; step < 30; step++) sim.stepMasked(topology);
  const finalWetVolume = topology.cells.reduce(
    (total, value, index) => index % 5 === 0 ? total + sim.depth[value] : total,
    0,
  );

  assert.ok(Math.abs(finalWetVolume - initialWetVolume) < 1e-5);
  assert.ok(
    sim.flowX.some((flow) => Math.abs(flow) > 1e-8) ||
      sim.flowY.some((flow) => Math.abs(flow) > 1e-8),
    'the sparse solver should produce active flow, not merely preserve zeros',
  );

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) assert.equal(sim.depth[i], 0);
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 1; x < nx; x++) {
      const leftWet = mask[y * nx + x - 1] > 0;
      const rightWet = mask[y * nx + x] > 0;
      if (!leftWet || !rightWet) assert.equal(sim.flowX[y * (nx + 1) + x], 0);
    }
  }
  for (let y = 1; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const bottomWet = mask[(y - 1) * nx + x] > 0;
      const topWet = mask[y * nx + x] > 0;
      if (!bottomWet || !topWet) assert.equal(sim.flowY[y * nx + x], 0);
    }
  }
}

// Dry-boundary flow storage is deliberately contaminated to prove the sparse
// kernel ignores it rather than relying on one-time zero initialization.
{
  const nx = 3;
  const ny = 3;
  const mask = new Uint8Array([
    0, 0, 0,
    0, 1, 0,
    0, 0, 0,
  ]);
  const sim = createSolver(nx, ny);
  const topology = createVirtualPipesWetTopology(nx, ny, mask);
  const center = 4;
  const initialDepth = sim.depth[center];
  sim.flowX.fill(50);
  sim.flowY.fill(-50);
  sim.stepMasked(topology);
  assert.equal(
    sim.depth[center],
    initialDepth,
    'inactive bank edges must remain closed even when their backing arrays contain stale values',
  );
}

assert.throws(
  () => createVirtualPipesWetTopology(3, 3, new Uint8Array(8)),
  /one mask value per cell/,
);

// The closed visual solver has no authored inflow/outflow boundary conditions.
// Its conserved state may pool at a low confluence, but presentation must stay
// in a shallow-ripple range rather than extruding terrain-scale triangles.
assert.ok(Math.abs(computeRiverSimulationRenderDelta(0.1) - 0.024) < 1e-8);
assert.equal(
  computeRiverSimulationRenderDelta(10_000),
  WATER_SIM_RENDER_DELTA_LIMIT,
);
assert.equal(
  computeRiverSimulationRenderDelta(-10_000),
  -WATER_SIM_RENDER_DELTA_LIMIT,
);
assert.equal(computeRiverSimulationRenderDelta(Number.NaN), 0);

// Direct vertex-delta sampling must match the former two-surface calculation
// at fractional (clipped shoreline) vertex coordinates.
{
  const terrain = new Float32Array([10, 12, 14, 16, 18, 20]);
  const baselineDepth = new Float32Array([1, 2, 3, 4, 5, 6]);
  const currentDepth = new Float32Array([1.4, 1.8, 3.7, 3.6, 5.2, 6.9]);
  const sample = createBilinearGridSample(1.35, 0.42, 3, 2);
  const sampleGrid = (values: Float32Array): number => {
    const h00 = values[sample.i00];
    const h10 = values[sample.i10];
    const h01 = values[sample.i01];
    const h11 = values[sample.i11];
    const hx0 = h00 + (h10 - h00) * sample.tx;
    const hx1 = h01 + (h11 - h01) * sample.tx;
    return hx0 + (hx1 - hx0) * sample.tz;
  };
  const currentSurface = currentDepth.map((depth, index) => depth + terrain[index]);
  const baselineSurface = baselineDepth.map((depth, index) => depth + terrain[index]);
  const formerSurfaceDelta = sampleGrid(currentSurface) - sampleGrid(baselineSurface);
  const directDepthDelta = sampleBilinearGridDifference(sample, currentDepth, baselineDepth);
  assert.ok(Math.abs(directDepthDelta - formerSurfaceDelta) < 2e-6);
}

// Profile a river-shaped mask rather than relying on theoretical loop counts.
// The ratio remains stable across developer and CI hardware while still
// catching accidental full-grid iteration.
const performanceNx = 256;
const performanceNy = 256;
const performanceMask = new Uint8Array(performanceNx * performanceNy);
for (let x = 0; x < performanceNx; x++) {
  const center = performanceNy * 0.52 + Math.sin(x * 0.045) * 24;
  for (let y = 0; y < performanceNy; y++) {
    const mainChannel = Math.abs(y - center) <= 5;
    const tributary = x > 40
      && x < 150
      && Math.abs(y - (52 + x * 0.38)) <= 3;
    if (mainChannel || tributary) performanceMask[y * performanceNx + x] = 1;
  }
}
const densePerformance = createSolver(performanceNx, performanceNy);
const sparsePerformance = createSolver(performanceNx, performanceNy);
const performanceTopology = createVirtualPipesWetTopology(
  performanceNx,
  performanceNy,
  performanceMask,
);
const wetFraction =
  (performanceTopology.cells.length / 5) / (performanceNx * performanceNy);
assert.ok(wetFraction < 0.08, 'the performance fixture should remain river-shaped and sparse');

for (let step = 0; step < 3; step++) {
  densePerformance.step();
  sparsePerformance.stepMasked(performanceTopology);
}
const denseStarted = performance.now();
for (let step = 0; step < 20; step++) densePerformance.step();
const denseElapsed = performance.now() - denseStarted;
const sparseStarted = performance.now();
for (let step = 0; step < 20; step++) {
  sparsePerformance.stepMasked(performanceTopology);
}
const sparseElapsed = performance.now() - sparseStarted;
assert.ok(
  sparseElapsed < denseElapsed * 0.5,
  `sparse river solver regressed (${sparseElapsed.toFixed(1)} ms sparse vs `
    + `${denseElapsed.toFixed(1)} ms dense)`,
);

console.log(
  'Sparse virtual-pipes tests passed: dense equivalence, closed banks, water conservation, '
    + `${(wetFraction * 100).toFixed(1)}% wet-grid profile `
    + `${denseElapsed.toFixed(1)} -> ${sparseElapsed.toFixed(1)} ms / 20 steps.`,
);
