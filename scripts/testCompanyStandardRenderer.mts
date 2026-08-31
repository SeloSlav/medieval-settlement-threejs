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
assert.ok(diagnostics.maxStretchRatio < 1.1, 'constraints cap visible rubber stretch');
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
}, {
  id: 'pointed-ottoman-standard',
  faction: 'ottoman',
  x: 4,
  y: 0,
  z: 0,
  yaw: 0,
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
const ottomanShape = gripRenderer.physicsSnapshot('pointed-ottoman-standard');
assert.ok(ottomanShape);
const ottomanPanel = ottomanShape.panels[0]!;
const topFlyX = ottomanPanel.positions[(ottomanPanel.columns - 1) * 3]!;
const centralFlyX = ottomanPanel.positions[
  (Math.floor(ottomanPanel.rows / 2) * ottomanPanel.columns
    + ottomanPanel.columns - 1) * 3
]!;
assert.ok(
  centralFlyX < topFlyX - 0.2,
  'the Ottoman standard must end in one central fly point, not a V-notch',
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
  COMPANY_STANDARD_PERFORMANCE_BUDGET.nearNodesPerPanel * 3
    + COMPANY_STANDARD_PERFORMANCE_BUDGET.mediumNodesPerPanel * 2,
  'capacity keeps the nearest stacked player and Ottoman standards first',
);

const strategicParent = new THREE.Group();
const strategicRenderer = new CompanyStandardRenderer({ parent: strategicParent });
const strategicView = {
  centerX: 0,
  centerZ: 0,
  listenerX: 0,
  listenerZ: 0,
  viewRadius: 260,
  orbitDistance: 180,
};
const strategicAgents: CompanyStandardRenderAgent[] = [
  { id: 'north-west', faction: 'player', x: -110, y: 0, z: -80, yaw: 0 },
  { id: 'north-east', faction: 'ottoman', x: 110, y: 0, z: -80, yaw: 0.4 },
  { id: 'south-west', faction: 'player', x: -110, y: 0, z: 80, yaw: -0.2 },
  { id: 'south-east', faction: 'ottoman', x: 110, y: 0, z: 80, yaw: 0.7 },
];
strategicRenderer.sync(strategicAgents, strategicView, 0);
for (let frame = 0; frame < 8; frame += 1) {
  for (let index = 0; index < strategicAgents.length; index += 1) {
    const agent = strategicAgents[index]!;
    // Each delta remains below the teleport threshold. With a paused/offline
    // presentation dt this used to move only the hoist, leaving each free edge
    // behind as a long world-space ribbon between separated companies.
    agent.x += index % 2 === 0 ? 2.35 : -2.35;
    agent.z += index < 2 ? 0.42 : -0.42;
    agent.yaw += index % 2 === 0 ? 0.08 : -0.08;
  }
  strategicRenderer.sync(strategicAgents, strategicView, 0);
  assert.ok(
    maxDrawnClothTriangleEdge(strategicParent) < 2.25,
    'separated moving standards must never batch into strategic-view cloth ribbons',
  );
}

first.dispose();
second.dispose();
gripRenderer.dispose();
lodRenderer.dispose();
strategicRenderer.dispose();
assert.equal(firstParent.children.length, 0);
assert.equal(secondParent.children.length, 0);
assert.equal(gripParent.children.length, 0);
assert.equal(lodParent.children.length, 0);
assert.equal(strategicParent.children.length, 0);

console.log('Company standard renderer tests passed.');

function maxDrawnClothTriangleEdge(parent: THREE.Object3D): number {
  let maxEdge = 0;
  parent.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.includes('standard cloth')) return;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const indices = geometry.index;
    if (!positions || !indices) return;
    for (let offset = 0; offset < geometry.drawRange.count; offset += 3) {
      const a = indices.getX(offset);
      const b = indices.getX(offset + 1);
      const c = indices.getX(offset + 2);
      maxEdge = Math.max(
        maxEdge,
        drawnEdgeLength(positions, a, b),
        drawnEdgeLength(positions, b, c),
        drawnEdgeLength(positions, c, a),
      );
    }
  });
  return maxEdge;
}

function drawnEdgeLength(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
): number {
  return Math.hypot(
    positions.getX(b) - positions.getX(a),
    positions.getY(b) - positions.getY(a),
    positions.getZ(b) - positions.getZ(a),
  );
}
