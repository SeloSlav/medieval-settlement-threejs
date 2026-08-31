import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChandleryMesh } from '../src/buildings/meshes/chandleryBuildingMesh.ts';
import { createSalvagePileMesh } from '../src/buildings/meshes/salvagePileMesh.ts';
import {
  createFishingCampMesh,
  createForagersShedMesh,
  createHuntersHallMesh,
  createWellMesh,
} from '../src/buildings/meshes/serviceBuildingMeshes.ts';
import { createSpinningRettingHouseMesh } from '../src/buildings/meshes/spinningRettingHouseMesh.ts';
import { createTavernMesh } from '../src/buildings/meshes/tavernBuildingMesh.ts';

const factories = {
  tavern: createTavernMesh,
  chandlery: createChandleryMesh,
  spinning_retting_house: createSpinningRettingHouseMesh,
  salvage_pile: createSalvagePileMesh,
  well: createWellMesh,
  hunters_hall: createHuntersHallMesh,
  foragers_shed: createForagersShedMesh,
  fishing_camp: createFishingCampMesh,
} as const;

const triangleCeilings: Record<keyof typeof factories, number> = {
  tavern: 1_800,
  chandlery: 2_600,
  spinning_retting_house: 3_700,
  salvage_pile: 1_000,
  well: 800,
  hunters_hall: 2_000,
  foragers_shed: 1_800,
  fishing_camp: 2_800,
};

for (const [kind, factory] of Object.entries(factories) as Array<
  [keyof typeof factories, () => THREE.Group]
>) {
  const first = factory();
  const second = factory();
  assert.deepEqual(
    topologySignature(first),
    topologySignature(second),
    `${kind} is not deterministic`,
  );
  const triangles = triangleCount(first);
  assert.ok(
    triangles <= triangleCeilings[kind],
    `${kind} exceeds its reviewed ${triangleCeilings[kind]}-triangle ceiling (${triangles})`,
  );
  assertBrownTimberFamily(first, kind);
  assertNoEmbeddedVegetationMaterial(first, kind);
}

assertFacadeOpenings(createTavernMesh(), [2], [2], 'tavern');
const chandlery = createChandleryMesh();
assertFacadeOpenings(chandlery, [2], [1], 'chandlery');
assert.equal(
  chandlery.getObjectByName('Gable shell left side wall'),
  undefined,
  'chandlery side window still has a solid plaster wall behind it',
);
assert.equal(
  chandlery.getObjectsByProperty('name', 'Chandlery negative-x perforated wall lower panel').length,
  1,
  'chandlery side window is missing its literal four-panel aperture',
);
assert.equal(
  chandlery.getObjectsByProperty('name', 'Chandlery melt-bay perforated outer wall upper panel').length,
  1,
  'chandlery heated-bay louver is not cut into a connected exterior wall',
);
assertFacadeOpenings(
  createSpinningRettingHouseMesh(),
  [2],
  [1],
  'spinning/retting house',
);
assertFacadeOpenings(createForagersShedMesh(), [2], [0], 'forager shed');
assertFacadeOpenings(createFishingCampMesh(), [2, 2], [0, 0], 'fishing camp');

const well = createWellMesh();
const wellRope = requiredMesh(well, 'Well windlass fibre rope');
assert.equal(
  materialOf(wellRope).userData.buildingDetailMaterialKey,
  'wicker',
  'well rope must use woven fibre rather than pale timber',
);
for (const post of well.getObjectsByProperty('name', 'Well windlass post')) {
  assert.ok(
    Number(post.userData.roofClearance) >= 0.079,
    'well post protrudes through the joined roof shell',
  );
}

const forager = createForagersShedMesh();
for (const name of ['Forager woven remedy basket', 'Forager woven food basket']) {
  const baskets = forager.getObjectsByProperty('name', name);
  assert.ok(baskets.length > 0, `${name} is missing`);
  for (const basket of baskets) {
    assert.equal(
      materialOf(basket as THREE.Mesh).userData.buildingDetailMaterialKey,
      'wicker',
      `${name} must use woven fibre rather than a light timber slot`,
    );
  }
}

const hunters = createHuntersHallMesh();
assert.equal(hunters.userData.noBakedHangingTools, true);
assert.equal(
  hunters.getObjectByName('Hunter processing fly sagging canvas')?.userData.proceduralFabric,
  true,
);

assertRoofSupportsCovered(
  chandlery,
  /Chandlery melt-bay (?:timber post|low-eave wall plate|attached wall plate)/,
  'Chandlery heated melt-bay lean-to roof',
);
assertRoofSupportsCovered(
  createSpinningRettingHouseMesh(),
  /Spinning & Retting House wet-bay (?:timber post|low-eave wall plate|attached wall plate)/,
  'Spinning & Retting House wet-yard lean-to roof',
);

const salvage = createSalvagePileMesh();
const chest = salvage.getObjectByName('SalvageTreasuryChest');
assert.ok(chest, 'salvage pile lost its runtime treasury chest');
chest.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const material = materialOf(object);
  if (material.userData.buildingWeatheringProfile === 'timber') {
    assertBrownMaterial(material, 'salvage treasury chest');
  }
});

console.log(
  'remaining special-site architecture passed (literal facades, brown timber, woven fibre, deterministic budgets)',
);

function assertFacadeOpenings(
  group: THREE.Group,
  positiveZ: readonly number[],
  negativeZ: readonly number[],
  label: string,
): void {
  const measured = {
    positiveZ: [] as number[],
    negativeZ: [] as number[],
  };
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name === 'Gable shell positive-z perforated wall') {
      measured.positiveZ.push(Number(object.userData.proceduralFacadeOpeningCount));
    }
    if (object.name === 'Gable shell negative-z perforated wall') {
      measured.negativeZ.push(Number(object.userData.proceduralFacadeOpeningCount));
    }
  });
  assert.deepEqual(measured.positiveZ.sort(), [...positiveZ].sort(), `${label} front apertures`);
  assert.deepEqual(measured.negativeZ.sort(), [...negativeZ].sort(), `${label} rear apertures`);
}

function topologySignature(group: THREE.Group): unknown[] {
  const signature: unknown[] = [];
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    const material = materialOf(object);
    signature.push([
      object.name,
      object.geometry.type,
      position?.count ?? 0,
      object.geometry.index?.count ?? 0,
      material.userData.buildingMaterialKey
        ?? material.userData.buildingDetailMaterialKey
        ?? material.name,
      ...object.matrixWorld.elements.map((value) => Math.round(value * 1e5) / 1e5),
    ]);
  });
  return signature;
}

function triangleCount(group: THREE.Group): number {
  let triangles = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return Math.round(triangles);
}

function assertBrownTimberFamily(group: THREE.Group, label: string): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = materialOf(object);
    if (material.userData.buildingWeatheringProfile !== 'timber') return;
    assertBrownMaterial(material, `${label}:${object.name}`);
  });
}

function assertBrownMaterial(material: THREE.Material, label: string): void {
  const color = (material as THREE.MeshStandardMaterial).color;
  assert.ok(color, `${label} timber has no authored tint`);
  assert.ok(
    color.r > color.g && color.g > color.b && color.r < 0.35,
    `${label} escaped the shared dark-brown timber palette`,
  );
}

function assertNoEmbeddedVegetationMaterial(group: THREE.Group, label: string): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = materialOf(object);
    assert.equal(
      /vegetation|foliage|crop|grass/i.test(
        String(material.userData.buildingMaterialKey ?? material.userData.buildingDetailMaterialKey ?? ''),
      ),
      false,
      `${label} embeds vegetation geometry instead of leaving it to SeedThree`,
    );
  });
}

function requiredMesh(group: THREE.Group, name: string): THREE.Mesh {
  const object = group.getObjectByName(name);
  assert.ok(object instanceof THREE.Mesh, `${name} is missing`);
  return object;
}

function assertRoofSupportsCovered(
  group: THREE.Group,
  supportPattern: RegExp,
  roofName: string,
): void {
  group.updateMatrixWorld(true);
  const roof = requiredMesh(group, roofName);
  const supports: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && supportPattern.test(object.name)) supports.push(object);
  });
  assert.ok(supports.length >= 4, `${roofName} is missing its connected support frame`);
  const plates = supports.filter((support) => /plate/i.test(support.name));
  for (const support of supports) {
    const bounds = new THREE.Box3().setFromObject(support);
    const center = bounds.getCenter(new THREE.Vector3());
    const hit = new THREE.Raycaster(
      new THREE.Vector3(center.x, 10, center.z),
      new THREE.Vector3(0, -1, 0),
      0,
      20,
    ).intersectObject(roof, false)[0];
    assert.ok(hit, `${support.name} has no covering lean-to roof`);
    assert.ok(
      bounds.max.y <= hit.point.y + 1e-4,
      `${support.name} protrudes through ${roofName}`,
    );
    if (/plate/i.test(support.name)) {
      assert.ok(
        hit.point.y - bounds.max.y <= 0.18,
        `${support.name} stops short of ${roofName}`,
      );
    } else {
      const postBounds = bounds.clone().expandByScalar(1e-4);
      assert.ok(
        plates.some((plate) => postBounds.intersectsBox(new THREE.Box3().setFromObject(plate))),
        `${support.name} does not connect to a roof-supporting wall plate`,
      );
    }
  }
}

function materialOf(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}
