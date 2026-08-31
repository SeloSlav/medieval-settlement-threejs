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
assert.equal(diagnostics.duplicateStandards, 0);
assert.equal(diagnostics.ownershipResets, 0);
assert.ok(diagnostics.maxOwnershipReachRatio < 1.1);
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

const fullQualityParent = new THREE.Group();
const fullQualityRenderer = new CompanyStandardRenderer({
  parent: fullQualityParent,
  capacity: 3,
});
fullQualityRenderer.sync([
  { id: 'near', faction: 'player', x: 4, y: 0, z: 0, yaw: 0 },
  { id: 'medium', faction: 'player', x: 60, y: 0, z: 0, yaw: 0 },
  { id: 'far', faction: 'ottoman', x: 110, y: 0, z: 0, yaw: 0 },
], {
  centerX: 0,
  centerZ: 0,
  listenerX: 0,
  listenerZ: 0,
  viewRadius: 140,
  orbitDistance: 30,
}, 1 / 30);
const fullQualityDiagnostics = fullQualityRenderer.diagnostics();
assert.equal(fullQualityDiagnostics.standards, 3);
assert.equal(fullQualityDiagnostics.droppedStandards, 0);
assert.equal(
  fullQualityDiagnostics.simulationNodes,
  COMPANY_STANDARD_PERFORMANCE_BUDGET.nodesPerPanel * 5,
  'near, medium, and strategic camera distances retain identical full cloth topology',
);
assert.throws(
  () => fullQualityRenderer.sync([
    { id: 'one', faction: 'player', x: 0, y: 0, z: 0, yaw: 0 },
    { id: 'two', faction: 'player', x: 1, y: 0, z: 0, yaw: 0 },
    { id: 'three', faction: 'ottoman', x: 2, y: 0, z: 0, yaw: 0 },
    { id: 'four', faction: 'ottoman', x: 3, y: 0, z: 0, yaw: 0 },
  ], undefined, 0),
  /cannot represent 4 visible company standards without omission/,
  'standard capacity may never silently omit a visible company',
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
// Eighteen standards represent the 108-v-108 playtest's nine companies per
// side. Deliberately pack them more tightly than the battle normally does so
// overlapping bearers cannot expose shared-state or cross-panel batch bugs.
const strategicAgents: CompanyStandardRenderAgent[] = Array.from(
  { length: 18 },
  (_, index): CompanyStandardRenderAgent => ({
    id: `${index < 9 ? 'player' : 'ottoman'}:cluster-${index % 9}`,
    faction: index < 9 ? 'player' : 'ottoman',
    x: (index % 6 - 2.5) * 0.82,
    y: 0,
    z: (Math.floor(index / 6) - 1) * 0.88,
    yaw: (index % 5 - 2) * 0.11,
    appearanceSeed: 0x431a2e0d + index,
  }),
);
strategicRenderer.sync(strategicAgents, strategicView, 0);
for (let frame = 0; frame < 180; frame += 1) {
  for (let index = 0; index < strategicAgents.length; index += 1) {
    const agent = strategicAgents[index]!;
    // Small independent bearer motion stresses cloth ownership without using
    // the teleport reset. Every third frame is deliberately paused: the hoist
    // and complete sheet still have to move together when dt is exactly zero.
    agent.x += Math.sin(frame * 0.13 + index * 0.71) * 0.035;
    agent.z += Math.cos(frame * 0.11 + index * 0.47) * 0.031;
    agent.yaw += Math.sin(frame * 0.07 + index) * 0.006;
  }
  strategicRenderer.sync(strategicAgents, strategicView, frame % 3 === 0 ? 0 : 1 / 60);
  assert.ok(
    maxDrawnClothTriangleEdge(strategicParent) < 0.5,
    'clustered moving standards must never stretch into strategic-view cloth ribbons',
  );
  for (const agent of strategicAgents) {
    const snapshot = strategicRenderer.physicsSnapshot(agent.id);
    assert.ok(snapshot);
    for (const panel of snapshot.panels) {
      assert.ok(
        maxPanelRowReach(panel) < 1.95,
        `${agent.id} cloth must remain inside its own pole's material envelope`,
      );
    }
  }
}
const strategicDiagnostics = strategicRenderer.diagnostics();
assert.equal(strategicDiagnostics.standards, 18);
assert.equal(strategicDiagnostics.duplicateStandards, 0);
assert.equal(strategicDiagnostics.droppedStandards, 0);
assert.equal(strategicDiagnostics.simulationNodes, 27 * 60);
assert.ok(strategicDiagnostics.maxOwnershipReachRatio <= 1.18);
assert.deepEqual(
  drawnClothComponentCounts(strategicParent),
  {
    'Croatian checkerboard lower standard cloth': 9,
    'Ottoman field standard cloth': 9,
    'Player heraldic standard cloth': 9,
  },
  'every batched panel must remain a disconnected indexed component owned by one pole',
);
const performanceStart = performance.now();
for (let frame = 0; frame < 360; frame += 1) {
  strategicRenderer.sync(strategicAgents, strategicView, 1 / 60);
}
const millisecondsPerFrame = (performance.now() - performanceStart) / 360;
assert.ok(
  millisecondsPerFrame < 4,
  `18 full-quality standards must stay below 4 ms CPU/frame; measured ${millisecondsPerFrame.toFixed(3)} ms`,
);

const duplicateParent = new THREE.Group();
const duplicateRenderer = new CompanyStandardRenderer({ parent: duplicateParent });
duplicateRenderer.sync([
  { id: 'player:duplicate', faction: 'player', x: -8, y: 0, z: 0, yaw: 0 },
  { id: 'player:duplicate', faction: 'player', x: 8, y: 0, z: 0, yaw: 0 },
], strategicView, 0);
assert.equal(duplicateRenderer.diagnostics().standards, 1);
assert.equal(duplicateRenderer.diagnostics().duplicateStandards, 1);
assert.equal(duplicateRenderer.diagnostics().hardwareInstances, 1);
duplicateRenderer.dispose();
assert.equal(duplicateParent.children.length, 0);

// Regression for the original strategic-camera ribbon: the bearer could move
// just under the teleport threshold during a paused presentation frame while
// only the hoist column followed. The free edge then remained at the previous
// company position and the indexed sheet became a many-metre strip. Exercise
// that exact delta at a large world origin, reverse input order every frame,
// and keep dt at zero so neither solver interpolation nor ordering can mask it.
const translatedParent = new THREE.Group();
const translatedRenderer = new CompanyStandardRenderer({
  parent: translatedParent,
  capacity: 18,
});
let translatedAgents: CompanyStandardRenderAgent[] = Array.from(
  { length: 18 },
  (_, index): CompanyStandardRenderAgent => ({
    id: `translated:${index}`,
    faction: index < 9 ? 'player' : 'ottoman',
    x: 250_000 + (index % 6) * 3.2,
    y: 0,
    z: -175_000 + Math.floor(index / 6) * 3.4,
    yaw: (index % 3 - 1) * 0.2,
    appearanceSeed: 0x431a2e0d ^ index,
  }),
);
translatedRenderer.sync(translatedAgents, strategicView, 0);
for (let frame = 0; frame < 24; frame += 1) {
  for (let index = 0; index < translatedAgents.length; index += 1) {
    const agent = translatedAgents[index]!;
    const direction = (frame + index) % 2 === 0 ? 1 : -1;
    agent.x += direction * 2.35;
    agent.z -= direction * 0.42;
    agent.yaw += direction * 0.08;
  }
  translatedAgents = translatedAgents.slice().reverse();
  translatedRenderer.sync(translatedAgents, strategicView, 0);
  assert.ok(
    maxDrawnClothTriangleEdge(translatedParent) < 0.55,
    'paused sub-teleport motion may never leave free cloth nodes at an old pole',
  );
  assert.equal(
    countInvalidDrawnComponents(translatedParent),
    0,
    'large-world batched cloth must keep finite positions and in-range indices',
  );
}
assert.deepEqual(
  drawnClothComponentCounts(translatedParent),
  {
    'Croatian checkerboard lower standard cloth': 9,
    'Ottoman field standard cloth': 9,
    'Player heraldic standard cloth': 9,
  },
  'large-world ordering changes must not connect company-owned components',
);
translatedRenderer.dispose();
assert.equal(translatedParent.children.length, 0);

// The production ceiling must remain safe for the 16-bit dynamic index batch.
// At 512 full Ottoman sheets the highest emitted vertex is 30,719, comfortably
// below 65,535; checking all disconnected components catches wraparound or an
// accidentally shared triangle immediately if panel resolution changes later.
const capacityParent = new THREE.Group();
const capacityRenderer = new CompanyStandardRenderer({
  parent: capacityParent,
  capacity: COMPANY_STANDARD_PERFORMANCE_BUDGET.maxStandards,
});
const capacityAgents: CompanyStandardRenderAgent[] = Array.from(
  { length: COMPANY_STANDARD_PERFORMANCE_BUDGET.maxStandards },
  (_, index): CompanyStandardRenderAgent => ({
    id: `capacity:${index}`,
    faction: 'ottoman',
    x: (index % 32) * 2.1,
    y: 0,
    z: Math.floor(index / 32) * 2.1,
    yaw: (index % 7 - 3) * 0.05,
  }),
);
capacityRenderer.sync(capacityAgents, strategicView, 0);
assert.equal(capacityRenderer.diagnostics().standards, 512);
assert.equal(capacityRenderer.diagnostics().droppedStandards, 0);
assert.equal(countInvalidDrawnComponents(capacityParent), 0);
assert.deepEqual(
  drawnClothComponentCounts(capacityParent),
  { 'Ottoman field standard cloth': 512 },
  'maximum-capacity dynamic indices must keep all 512 sheets disconnected',
);
capacityRenderer.dispose();
assert.equal(capacityParent.children.length, 0);

first.dispose();
second.dispose();
gripRenderer.dispose();
fullQualityRenderer.dispose();
strategicRenderer.dispose();
assert.equal(firstParent.children.length, 0);
assert.equal(secondParent.children.length, 0);
assert.equal(gripParent.children.length, 0);
assert.equal(fullQualityParent.children.length, 0);
assert.equal(strategicParent.children.length, 0);

console.log(
  `Company standard renderer tests passed (${millisecondsPerFrame.toFixed(3)} ms/18-standard frame).`,
);

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

function maxPanelRowReach(panel: {
  columns: number;
  rows: number;
  positions: Float32Array;
}): number {
  let maxReach = 0;
  for (let row = 0; row < panel.rows; row += 1) {
    const hoist = row * panel.columns;
    for (let column = 1; column < panel.columns; column += 1) {
      const node = hoist + column;
      const hoistOffset = hoist * 3;
      const nodeOffset = node * 3;
      maxReach = Math.max(
        maxReach,
        Math.hypot(
          panel.positions[nodeOffset]! - panel.positions[hoistOffset]!,
          panel.positions[nodeOffset + 1]! - panel.positions[hoistOffset + 1]!,
          panel.positions[nodeOffset + 2]! - panel.positions[hoistOffset + 2]!,
        ),
      );
    }
  }
  return maxReach;
}

function drawnClothComponentCounts(parent: THREE.Object3D): Record<string, number> {
  const counts: Record<string, number> = {};
  parent.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.includes('standard cloth')) return;
    const indices = mesh.geometry.index;
    if (!indices) return;
    const drawn = mesh.geometry.drawRange.count;
    if (drawn === 0) return;
    const parents = new Map<number, number>();
    const find = (value: number): number => {
      const parentValue = parents.get(value);
      if (parentValue === undefined) {
        parents.set(value, value);
        return value;
      }
      if (parentValue === value) return value;
      const root = find(parentValue);
      parents.set(value, root);
      return root;
    };
    const join = (left: number, right: number): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
    };
    for (let offset = 0; offset < drawn; offset += 3) {
      const a = indices.getX(offset);
      const b = indices.getX(offset + 1);
      const c = indices.getX(offset + 2);
      join(a, b);
      join(b, c);
    }
    counts[mesh.name] = new Set([...parents.keys()].map(find)).size;
  });
  return counts;
}

function countInvalidDrawnComponents(parent: THREE.Object3D): number {
  let invalid = 0;
  parent.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.includes('standard cloth')) return;
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.index;
    if (!positions || !indices) {
      invalid += 1;
      return;
    }
    for (let offset = 0; offset < mesh.geometry.drawRange.count; offset += 1) {
      const vertex = indices.getX(offset);
      if (
        !Number.isInteger(vertex)
        || vertex < 0
        || vertex >= positions.count
        || !Number.isFinite(positions.getX(vertex))
        || !Number.isFinite(positions.getY(vertex))
        || !Number.isFinite(positions.getZ(vertex))
      ) {
        invalid += 1;
      }
    }
  });
  return invalid;
}
