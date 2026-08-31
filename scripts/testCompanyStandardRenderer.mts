import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  COMPANY_STANDARD_PERFORMANCE_BUDGET,
  COMPANY_STANDARD_VISUAL_CONTRACT,
  CompanyStandardRenderer,
  type CompanyStandardRenderAgent,
} from '../src/settlement/CompanyStandardRenderer.ts';

const agents: CompanyStandardRenderAgent[] = [
  {
    id: 'friendly-company-standard',
    faction: 'player',
    x: 0,
    y: 0,
    z: 0,
    yaw: 0.25,
    appearanceSeed: 101,
  },
  {
    id: 'ottoman-company-standard',
    faction: 'ottoman',
    x: 8,
    y: 0,
    z: 2,
    yaw: -0.35,
    appearanceSeed: 202,
  },
];

const fixedWind = (): { x: number; z: number; speed: number } => ({
  x: 0.45,
  z: 0.89,
  speed: 4.2,
});

const firstParent = new THREE.Group();
const secondParent = new THREE.Group();
const first = new CompanyStandardRenderer({
  parent: firstParent,
  windSampler: fixedWind,
});
const second = new CompanyStandardRenderer({
  parent: secondParent,
  windSampler: fixedWind,
});

for (let frame = 0; frame < 90; frame += 1) {
  first.sync(agents, undefined, 1 / 60);
  second.sync(agents, undefined, 1 / 60);
}

const diagnostics = first.diagnostics();
assert.equal(diagnostics.standards, 2);
assert.equal(diagnostics.panels, 3, 'friendly standards stack two cloth panels');
assert.equal(diagnostics.simulationNodes, 180);
assert.equal(diagnostics.hardwareInstances, 2);
assert.equal(diagnostics.drawCalls, COMPANY_STANDARD_PERFORMANCE_BUDGET.maxDrawCalls);
assert.ok(diagnostics.maxStretchRatio < 1.08, 'constraints cap visible rubber stretch');
assert.deepEqual(diagnostics.lod, { near: 2, medium: 0, far: 0 });
assert.equal(COMPANY_STANDARD_VISUAL_CONTRACT.poleHeightMeters, 3.72);
assert.equal(COMPANY_STANDARD_VISUAL_CONTRACT.freeEdgeProfile, 'forked-and-tapered');

const firstSnapshot = first.physicsSnapshot('friendly-company-standard');
const secondSnapshot = second.physicsSnapshot('friendly-company-standard');
assert.ok(firstSnapshot && secondSnapshot);
assert.equal(firstSnapshot.panels.length, 2);
assert.deepEqual(
  [...firstSnapshot.panels[0]!.positions],
  [...secondSnapshot.panels[0]!.positions],
  'same seed, wind, timestep, and pose must produce identical cloth state',
);
const upper = firstSnapshot.panels[0]!;
const freeTop = (upper.columns - 1) * 3;
const hoistTop = 0;
assert.ok(
  Math.abs(upper.positions[freeTop + 2]! - upper.positions[hoistTop + 2]!) > 0.002,
  'the simulated free edge must leave the rigid hoist plane',
);

const gripParent = new THREE.Group();
const gripRenderer = new CompanyStandardRenderer({ parent: gripParent });
const gripX = 12.5;
const gripY = 2.2;
const gripZ = -3.25;
gripRenderer.sync([{
  id: 'bone-mounted-standard',
  faction: 'player',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  gripPose: { x: gripX, y: gripY, z: gripZ },
}], undefined, 0);
const gripSnapshot = gripRenderer.physicsSnapshot('bone-mounted-standard');
assert.ok(gripSnapshot);
const gripUpper = gripSnapshot.panels[0]!;
assert.ok(Math.abs(gripUpper.positions[0]! - gripX) < 1e-5);
assert.ok(Math.abs(gripUpper.positions[2]! - gripZ) < 1e-5);
assert.ok(
  Math.abs(gripUpper.positions[1]! - (gripY + 3.39 - 1.19)) < 1e-5,
  'bone-derived grip position must drive the complete pole frame',
);

const lodParent = new THREE.Group();
const lodRenderer = new CompanyStandardRenderer({ parent: lodParent, capacity: 3 });
lodRenderer.sync([
  { id: 'near', faction: 'player', x: 4, y: 0, z: 0, yaw: 0 },
  { id: 'medium', faction: 'player', x: 60, y: 0, z: 0, yaw: 0 },
  { id: 'far', faction: 'ottoman', x: 110, y: 0, z: 0, yaw: 0 },
  { id: 'over-capacity', faction: 'ottoman', x: 6, y: 0, z: 0, yaw: 0 },
], {
  centerX: 0,
  centerZ: 0,
  listenerX: 0,
  listenerZ: 0,
  viewRadius: 140,
  orbitDistance: 30,
}, 1 / 30);
const lodDiagnostics = lodRenderer.diagnostics();
assert.equal(lodDiagnostics.standards, 3);
assert.equal(lodDiagnostics.droppedStandards, 1);
assert.equal(
  lodDiagnostics.simulationNodes,
  lodDiagnostics.lod.near * COMPANY_STANDARD_PERFORMANCE_BUDGET.nearNodesPerPanel
    + lodDiagnostics.lod.medium * COMPANY_STANDARD_PERFORMANCE_BUDGET.mediumNodesPerPanel
    + lodDiagnostics.lod.far * COMPANY_STANDARD_PERFORMANCE_BUDGET.farNodesPerPanel,
  'single-panel test standards must use their tier-specific node budgets',
);

first.dispose();
second.dispose();
gripRenderer.dispose();
lodRenderer.dispose();
assert.equal(firstParent.children.length, 0);
assert.equal(secondParent.children.length, 0);
assert.equal(gripParent.children.length, 0);
assert.equal(lodParent.children.length, 0);

console.log('Company standard renderer tests passed.');
