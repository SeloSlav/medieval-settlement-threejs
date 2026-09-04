import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../src/generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';
import {
  PROCESSOR_OUTPUT_TARGET_KINDS,
  processorInputCommodities,
} from '../src/economy/processorOutputPolicy.ts';
import {
  bulkStockpileVisualSignature,
  INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS,
  syncBulkStockpileVisuals,
  type IndustrialFirewoodStockpileContract,
} from '../src/buildings/bulkStockpileVisuals.ts';
import {
  FIREWOOD_LOG_LENGTH,
  FIREWOOD_LOG_MESH_ID,
} from '../src/buildings/firewoodPileMesh.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import { createWoodcuttersLodgeMesh } from '../src/buildings/meshes/industryBuildingMeshes.ts';
import {
  createCharcoalBurnerMesh,
  createPotterKilnMesh,
} from '../src/buildings/meshes/materialChainBuildingMeshes.ts';
import {
  createBakeryMesh,
  createBreweryMesh,
  createSmokehouseMesh,
} from '../src/buildings/meshes/expandedBuildingMeshes.ts';
import { createTanneryMesh } from '../src/buildings/meshes/leatherChainBuildingMeshes.ts';
import { createChandleryMesh } from '../src/buildings/meshes/chandleryBuildingMesh.ts';
import { createVillageStorehouseMesh } from '../src/buildings/meshes/civicLogisticsBuildingMeshes.ts';
import { createMarketplaceMesh } from '../src/buildings/meshes/marketplaceMesh.ts';
import { createResidenceFirewoodPile } from '../src/residences/residenceFirewoodPile.ts';
import { createDeliveryCartMesh } from '../src/logistics/deliveryCartMesh.ts';
import { marketStallDisplayName } from '../src/buildings/marketplaceStallLayout.ts';

const processorFirewoodKinds = PROCESSOR_OUTPUT_TARGET_KINDS
  .filter((kind) => processorInputCommodities(kind).includes('firewood'))
  .sort();
const expectedIndustrialKinds = [...processorFirewoodKinds, 'woodcutters_lodge'].sort();
assert.deepEqual(
  Object.keys(INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS).sort(),
  expectedIndustrialKinds,
  'the firewood visual coverage oracle must include the producer and every consuming workshop',
);

const industrialFactories = {
  bakery: createBakeryMesh,
  brewery: createBreweryMesh,
  chandlery: createChandleryMesh,
  charcoal_burner: createCharcoalBurnerMesh,
  potter_kiln: createPotterKilnMesh,
  smokehouse: createSmokehouseMesh,
  tannery: createTanneryMesh,
  woodcutters_lodge: createWoodcuttersLodgeMesh,
} satisfies Record<keyof typeof INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS, () => THREE.Group>;

function firewoodMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (
      object.userData.firewoodMeshId === FIREWOOD_LOG_MESH_ID
      || object.geometry.userData.firewoodMeshId === FIREWOOD_LOG_MESH_ID
    ) {
      meshes.push(object);
    }
  });
  return meshes;
}

function assertSharedFirewoodGeometry(root: THREE.Object3D, label: string): void {
  const logs = firewoodMeshes(root);
  assert.ok(logs.length > 0, `${label} must use the shared firewood billet mesh`);
  for (const log of logs) {
    assert.equal(
      log.geometry.userData.firewoodMeshId,
      FIREWOOD_LOG_MESH_ID,
      `${label} contains a firewood prop outside the shared mesh contract`,
    );
    const geometry = log.geometry as THREE.CylinderGeometry;
    assert.ok(
      Math.abs(geometry.parameters.height - FIREWOOD_LOG_LENGTH) < 1e-9,
      `${label} firewood must use the canonical short billet length`,
    );
  }
}

for (const [kind, contract] of Object.entries(
  INDUSTRIAL_FIREWOOD_STOCKPILE_CONTRACTS,
) as [BuildingKind, IndustrialFirewoodStockpileContract][]) {
  const model = industrialFactories[kind as keyof typeof industrialFactories]();
  const stockpile = model.getObjectByName(contract.containerName);
  assert.ok(stockpile instanceof THREE.Group, `${kind} is missing ${contract.containerName}`);
  const segments = stockpile.children.filter((child) => child.name === contract.segmentName);
  assert.equal(
    segments.length,
    contract.segmentCount,
    `${kind} firewood segment count must match the runtime visual contract`,
  );
  for (const segment of segments) assertSharedFirewoodGeometry(segment, kind);

  const capacity = BUILDING_STORAGE_CAPS[kind].firewood ?? 0;
  const building = {
    kind,
    constructionComplete: true,
    firewood: capacity,
  } as BuildingState;
  assert.match(bulkStockpileVisualSignature(building), /:firewood:[1-9]/);
  syncBulkStockpileVisuals(model, building);
  assert.equal(stockpile.visible, true, `${kind} stocked firewood must render`);
  assert.equal(segments.filter((segment) => segment.visible).length, contract.segmentCount);
  syncBulkStockpileVisuals(model, { ...building, firewood: 0 });
  assert.equal(stockpile.visible, false, `${kind} empty firewood storage must clear`);
}

const foundersCamp = createFoundersCampMesh();
const foundersFirewood = foundersCamp.getObjectByName('Stacked cut camp firewood');
assert.ok(foundersFirewood instanceof THREE.InstancedMesh);
assert.equal(
  (foundersFirewood.geometry as THREE.CylinderGeometry).parameters.height,
  FIREWOOD_LOG_LENGTH,
  'Founders Camp firewood must be half the former 1.72 m timber-like length',
);
assertSharedFirewoodGeometry(foundersFirewood, 'Founders Camp');

const wheel = foundersCamp.getObjectByName('Spare founding cart wheel');
const wheelAssembly = foundersCamp.getObjectByName('Spare founding cart wheel assembly');
const spokes = foundersCamp.getObjectByName('Spare wheel spokes');
const barrels = foundersCamp.getObjectByName('Coopered provision barrels');
assert.ok(wheel instanceof THREE.Mesh);
assert.ok(wheelAssembly instanceof THREE.Group);
assert.ok(spokes instanceof THREE.InstancedMesh);
assert.ok(barrels instanceof THREE.InstancedMesh);
const barrelMatrix = new THREE.Matrix4();
barrels.getMatrixAt(0, barrelMatrix);
const barrelCenter = new THREE.Vector3().setFromMatrixPosition(barrelMatrix);
assert.equal(wheel.parent, wheelAssembly, 'the rim must inherit the wheel assembly lean');
assert.equal(spokes.parent, wheelAssembly, 'the spokes must inherit the same lean as the rim');
assert.ok(wheelAssembly.rotation.x > 0.35, 'the spare wheel must visibly lean toward its barrel');
assert.ok(Math.abs(wheelAssembly.position.x - barrelCenter.x) < 1e-6);
assert.ok(wheelAssembly.position.z < barrelCenter.z);
foundersCamp.updateMatrixWorld(true);
assert.ok(
  Math.abs(new THREE.Box3().setFromObject(wheelAssembly).min.y - 0.02) < 0.025,
  'the leaning wheel must remain grounded at its lower rim',
);
const wheelGeometry = wheel.geometry as THREE.TorusGeometry;
const barrelGeometry = barrels.geometry as THREE.CylinderGeometry;
const contactY = barrelCenter.y + barrelGeometry.parameters.height * 0.48;
const contactSin = (contactY - wheelAssembly.position.y)
  / (wheelGeometry.parameters.radius * Math.cos(wheelAssembly.rotation.x));
const wheelContactZ = wheelAssembly.position.z
  + wheelGeometry.parameters.radius * contactSin * Math.sin(wheelAssembly.rotation.x)
  + wheelGeometry.parameters.tube;
const barrelFrontZ = barrelCenter.z - barrelGeometry.parameters.radiusTop;
assert.ok(
  Math.abs(wheelContactZ - barrelFrontZ) < 0.05,
  'the grounded wheel upper rim must meet the barrel instead of standing unsupported',
);

const residencePile = createResidenceFirewoodPile(0, 0);
assert.equal(firewoodMeshes(residencePile).length, 10);
assertSharedFirewoodGeometry(residencePile, 'residence');

const storehouse = createVillageStorehouseMesh();
const storehouseFirewood = storehouse.getObjectByName('StorehouseFirewoodStockpile');
assert.ok(storehouseFirewood instanceof THREE.Group);
assertSharedFirewoodGeometry(storehouseFirewood, 'Village Storehouse');

const firewoodCart = createDeliveryCartMesh('firewood');
assert.equal(firewoodMeshes(firewoodCart).length, 6);
assertSharedFirewoodGeometry(firewoodCart, 'firewood delivery cart');

const marketplace = createMarketplaceMesh();
const marketFirewood = marketplace.getObjectByName(marketStallDisplayName('firewood'));
assert.ok(marketFirewood instanceof THREE.Group);
assert.equal(marketFirewood.userData.firewoodMeshId, FIREWOOD_LOG_MESH_ID);

console.log(
  `firewood visual tests passed (${expectedIndustrialKinds.length} industrial sites; `
  + `${FIREWOOD_LOG_LENGTH.toFixed(2)} m shared billets)`,
);
