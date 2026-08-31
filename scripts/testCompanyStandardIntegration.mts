import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CombatPlaytestSimulation,
  type CombatPlaytestPreset,
} from '../src/app/combatPlaytest.ts';
import { CompanyStandardBearerRegistry } from '../src/security/companyStandardBearers.ts';
import {
  COMPANY_STANDARD_PERFORMANCE_BUDGET,
  CompanyStandardRenderer,
  type CompanyStandardRenderAgent,
} from '../src/settlement/CompanyStandardRenderer.ts';
import {
  compareCrowdAnimationPriority,
  type CrowdRenderAgent,
} from '../src/settlement/SettlementCrowdRenderer.ts';

const seed = 0x431a_2e0d;
const site = { x: 0, z: 0, axisX: 1, axisZ: 0 };
const view = {
  centerX: 0,
  centerZ: 0,
  listenerX: 0,
  listenerZ: 0,
  viewRadius: 180,
  orbitDistance: 42,
};

for (const preset of ['field', 'stress'] as const satisfies readonly CombatPlaytestPreset[]) {
  const simulation = new CombatPlaytestSimulation({
    site,
    playableHalf: 248,
    preset,
    seed,
  });
  const snapshot = simulation.snapshot();
  const registry = new CompanyStandardBearerRegistry();
  const assignments = registry.sync(snapshot.values());
  const playerStandards = [...assignments.values()]
    .filter((row) => row.side === 'player').length;
  const ottomanStandards = assignments.size - playerStandards;
  assert.ok(assignments.size > 0, `${preset} must elect visible standards`);
  assert.equal(
    playerStandards,
    ottomanStandards,
    `${preset} must expose one standard per company on both playtest sides`,
  );

  const crowd: CrowdRenderAgent[] = [...snapshot.values()].map((agent, index) => {
    const assignment = registry.assignmentForAgent(agent.id);
    return {
      id: agent.id,
      slot: index,
      x: agent.x,
      y: 0,
      z: agent.z,
      yaw: 0,
      appearanceSeed: index + 1,
      variant: 'man',
      presentation: agent.faction === 'raider' ? 'raider' : 'common',
      mode: 'idle',
      tunicColor: 0xffffff,
      skinColor: 0xffffff,
      hairColor: 0xffffff,
      tool: assignment ? 'sidearm' : null,
      movementSpeed: 0,
      active: true,
      companyStandard: assignment
        ? { id: assignment.companyKey, faction: assignment.side }
        : undefined,
    };
  });
  const closeCohort = crowd
    .filter((agent) => Math.hypot(agent.x - view.centerX, agent.z - view.centerZ) <= 64)
    .sort((left, right) => compareCrowdAnimationPriority(left, right, view))
    .slice(0, 72);
  assert.equal(
    closeCohort.filter((agent) => agent.companyStandard).length,
    assignments.size,
    `${preset} must keep every bearer in the authored 72-rig cohort`,
  );

  const standardAgents: CompanyStandardRenderAgent[] = [...assignments.values()].map((assignment) => {
    const bearer = snapshot.get(assignment.bearerId)!;
    return {
      id: assignment.companyKey,
      faction: assignment.side,
      x: bearer.x,
      y: 0,
      z: bearer.z,
      yaw: 0,
      appearanceSeed: bearer.sourceSlot + 1,
      active: true,
    };
  });
  const parent = new THREE.Group();
  const renderer = new CompanyStandardRenderer({ parent });
  for (let step = 0; step < 12; step += 1) {
    renderer.sync(standardAgents, view, 1 / 30);
  }
  const diagnostics = renderer.diagnostics();
  assert.equal(diagnostics.standards, assignments.size);
  assert.equal(diagnostics.duplicateStandards, 0);
  assert.equal(diagnostics.droppedStandards, 0);
  const expectedPanels = playerStandards * 2 + ottomanStandards;
  assert.equal(diagnostics.panels, expectedPanels);
  assert.equal(diagnostics.hardwareInstances, assignments.size);
  assert.equal(
    diagnostics.simulationNodes,
    expectedPanels * COMPANY_STANDARD_PERFORMANCE_BUDGET.nodesPerPanel,
  );
  assert.equal(diagnostics.triangles, expectedPanels * 90);
  assert.ok(diagnostics.drawCalls <= COMPANY_STANDARD_PERFORMANCE_BUDGET.maxDrawCalls);
  assert.ok(diagnostics.maxStretchRatio < 1.08);
  renderer.dispose();
  assert.equal(parent.children.length, 0);
}

console.log('Field and 216-soldier stress playtests retain every full-quality batched company standard.');
