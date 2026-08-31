import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  BATTLEFIELD_WEAPON_DROP_DRAW_CALL_BUDGET,
  BattlefieldWeaponDropRenderer,
  battlefieldWeaponDropTransform,
  type BattlefieldWeaponDropAgent,
} from '../src/settlement/BattlefieldWeaponDropRenderer.ts';
import {
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  MILITARY_EQUIPMENT_KINDS,
  setMilitaryEquipmentDropped,
  setMilitaryEquipmentVisible,
} from '../src/settlement/militaryEquipment.ts';
import { workerToolVisibleInMode } from '../src/settlement/SettlementCrowdRenderer.ts';
import type { WorkerToolSources } from '../src/settlement/workerTools.ts';

const parent = new THREE.Group();
const renderer = new BattlefieldWeaponDropRenderer(parent, 2);
const sources = createMilitaryEquipmentSources();
renderer.configureSources(sources as unknown as WorkerToolSources);

const agent = (
  id: string,
  x: number,
  kind: 'spear-shield' | 'bow' | 'halberd',
  recoverable: boolean,
): BattlefieldWeaponDropAgent => ({
  id,
  x,
  y: 0.02,
  z: 0,
  yaw: 0.4,
  appearanceSeed: Number(id.replace(/\D/g, '') || 1) * 193,
  active: true,
  tool: kind,
  battlefieldWeaponDrop: { ownerId: id, kind, recoverable },
});

const living: BattlefieldWeaponDropAgent = {
  id: 'living', x: 0.1, y: 0.02, z: 0, yaw: 0, appearanceSeed: 1,
  active: true, tool: 'sidearm',
};
const hurt: BattlefieldWeaponDropAgent = {
  id: 'hurt', x: 0.2, y: 0.02, z: 0, yaw: 0, appearanceSeed: 2,
  active: true, tool: 'sidearm',
};
const near = agent('fallen-1', 2, 'spear-shield', true);
const middle = agent('fallen-2', 5, 'bow', false);
const far = agent('fallen-3', 9, 'halberd', true);
const view = { centerX: 0, centerZ: 0, viewRadius: 120, orbitDistance: 42 };

renderer.sync([far, hurt, near, living, middle], view);
const diagnostic = renderer.diagnostics();
assert.equal(diagnostic.owners, 3, 'every casualty must retain its recoverable weapon visual');
assert.equal(diagnostic.droppedOwners, 0);
assert.ok(diagnostic.capacity >= 3, 'the instance storage must grow instead of omitting owners');
assert.ok(diagnostic.instances > 0);
assert.ok(diagnostic.activeDrawCalls > 0);
assert.ok(diagnostic.triangles > 0);
assert.equal(diagnostic.exactPbrMaterials, true);
assert.deepEqual(
  renderer.ownershipSnapshot().map((entry) => entry.ownerId),
  ['fallen-1', 'fallen-2', 'fallen-3'],
  'stable owner identities must survive the deterministic spatial sort',
);
assert.equal(renderer.ownershipSnapshot()[0]?.recoverable, true);
assert.equal(renderer.ownershipSnapshot()[1]?.recoverable, false);

const captureMatrices = (): number[] => {
  const values: number[] = [];
  parent.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count <= 0) return;
    values.push(...Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)));
  });
  return values;
};
const firstMatrices = captureMatrices();
renderer.sync([middle, living, near, far, hurt], view);
assert.deepEqual(captureMatrices(), firstMatrices, 'drop scatter must be replay deterministic');

const firstTransform = battlefieldWeaponDropTransform(near, 'spear-shield');
const repeatedTransform = battlefieldWeaponDropTransform(near, 'spear-shield');
const secondaryTransform = battlefieldWeaponDropTransform(near, 'spear-shield', 1);
assert.deepEqual(firstTransform, repeatedTransform);
assert.notDeepEqual(firstTransform, secondaryTransform);
assert.ok(Math.hypot(firstTransform.x - near.x, firstTransform.z - near.z) < 0.8);
assert.ok(firstTransform.y > near.y, 'weapon should clear the terrain rather than z-fight it');
assert.ok(Math.abs(firstTransform.pitch - Math.PI / 2) < 0.08, 'weapon should lie across the ground');

renderer.sync([near], {
  ...view,
  orbitDistance: 10_000,
});
assert.equal(renderer.diagnostics().owners, 1, 'strategic zoom must not erase recoverable equipment');
const massCasualties = Array.from({ length: 513 }, (_, index) =>
  agent(`mass-${index}`, index * 0.45, 'spear-shield', true));
renderer.sync(massCasualties, view);
assert.equal(renderer.diagnostics().owners, massCasualties.length);
assert.equal(renderer.diagnostics().droppedOwners, 0);
assert.ok(renderer.diagnostics().capacity >= massCasualties.length);
renderer.sync([], view);
assert.equal(renderer.diagnostics().instances, 0, 'removing an owner must clear every pooled instance');

// A hit reaction is not a detach event. Only the explicit casualty bit hides
// held mounts; harnessed kit remains on the body and returns when recovered.
assert.equal(workerToolVisibleInMode('sidearm', 'hurt'), true);
assert.equal(workerToolVisibleInMode('sidearm', 'fall'), true);
const primary = new THREE.Group();
const shield = new THREE.Group();
primary.userData.workerToolCombatRole = 'melee-held';
shield.userData.workerToolCombatRole = 'always';
primary.userData.workerToolMounts = [primary, shield];
primary.userData.workerToolVisible = true;
primary.userData.workerToolCombatStance = 'melee';
setMilitaryEquipmentDropped(primary, true);
assert.equal(primary.visible, false, 'the held weapon must leave the death-pose hand');
assert.equal(shield.visible, true, 'harness/defensive kit should not disappear with the held weapon');
setMilitaryEquipmentDropped(primary, false);
assert.equal(primary.visible, true, 'a recovered or pooled living owner regains the hand mount');
setMilitaryEquipmentVisible(primary, false);
assert.equal(primary.visible, false);
assert.equal(shield.visible, false);

const allKindsParent = new THREE.Group();
const allKindsRenderer = new BattlefieldWeaponDropRenderer(
  allKindsParent,
  MILITARY_EQUIPMENT_KINDS.length,
);
allKindsRenderer.configureSources(sources as unknown as WorkerToolSources);
allKindsRenderer.sync(MILITARY_EQUIPMENT_KINDS.map((kind, index) => ({
  id: `all-${kind}`,
  x: index,
  y: 0.02,
  z: 0,
  yaw: 0,
  appearanceSeed: index + 1,
  active: true,
  tool: kind,
  battlefieldWeaponDrop: {
    ownerId: `all-${kind}`,
    kind,
    recoverable: true,
  },
})), view);
const allKinds = allKindsRenderer.diagnostics();
assert.equal(allKinds.owners, MILITARY_EQUIPMENT_KINDS.length);
assert.equal(allKinds.pieces, MILITARY_EQUIPMENT_KINDS.length);
assert.ok(
  allKinds.activeDrawCalls <= BATTLEFIELD_WEAPON_DROP_DRAW_CALL_BUDGET,
  `${allKinds.activeDrawCalls} exact-PBR draws exceeded the all-family budget`,
);
assert.ok(allKinds.triangles < 30_000, 'one casualty per family should stay below 30k source triangles');
let mappedPbrLayers = 0;
allKindsParent.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (!mesh.isInstancedMesh || mesh.count <= 0) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.some((material) => (
    material as THREE.MeshStandardMaterial
  ).isMeshStandardMaterial && Boolean((material as THREE.MeshStandardMaterial).map))) {
    mappedPbrLayers += 1;
  }
});
assert.ok(mappedPbrLayers > 0, 'drops must retain the authored mapped PBR material instances');
allKindsRenderer.dispose();
assert.equal(allKindsParent.children.length, 0);

const villagerRendererSource = readFileSync(
  new URL('../src/settlement/VillagerRenderer.ts', import.meta.url),
  'utf8',
);
const bearerCapture = villagerRendererSource.indexOf(
  'this.companyStandardBearers.isBearer(state.id)',
);
const bearerSuccession = villagerRendererSource.indexOf(
  'this.companyStandardBearers.sync(agents.values())',
);
assert.ok(
  bearerCapture >= 0 && bearerCapture < bearerSuccession,
  'the fallen bearer sidearm must be captured before company succession',
);
assert.match(
  villagerRendererSource,
  /carriedStandardSidearm[\s\S]{0,160}fallenCompanyStandardBearers\.has\(combat\.id\)[\s\S]{0,800}renderAgent\.tool = carriedStandardSidearm \? 'sidearm'/,
  'the old standard bearer must drop the sword players actually saw in his hand',
);
const crowdRendererSource = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(
  crowdRendererSource,
  /resetPooledVillager[\s\S]{0,1800}setWorkerToolDropped\(visual\.tool, false\)/,
  'pooled casualty rigs must restore held mounts before reuse by a living soldier',
);

renderer.dispose();
for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);
assert.equal(parent.children.length, 0);

console.log(`Battlefield weapon drops passed: explicit death detach, exact shared PBR assemblies, deterministic ground scatter, non-omitting dynamic capacity, ownership, cleanup, and ${allKinds.activeDrawCalls} active draws across all ten weapon families.`);
