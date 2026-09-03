import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FORESTRY_ARCHITECTURE_PLANS,
  createReforesterHutMesh,
  createWoodcuttersLodgeMesh,
} from '../src/buildings/meshes/industryBuildingMeshes.ts';
import { BUILDING_LOCAL_VISUAL_BOUNDS } from '../src/buildings/BuildingVisualBounds.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';

type ForestryKind = keyof typeof FORESTRY_ARCHITECTURE_PLANS;

function objectsWithData(root: THREE.Object3D, key: string, value: unknown): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.userData[key] === value) matches.push(object);
  });
  return matches;
}

function requiredMesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = root.getObjectByName(name);
  assert.ok(object instanceof THREE.Mesh, `missing ${name}`);
  return object;
}

function triangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const index = object.geometry.getIndex();
    const positions = object.geometry.getAttribute('position');
    triangles += index ? index.count / 3 : (positions?.count ?? 0) / 3;
  });
  return triangles;
}

function deterministicSignature(root: THREE.Object3D): readonly string[] {
  root.updateMatrixWorld(true);
  const signature: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    const index = object.geometry.getIndex();
    const positions = object.geometry.getAttribute('position');
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    signature.push([
      object.name,
      positions?.count ?? 0,
      index?.count ?? 0,
      material.userData.buildingMaterialKey
        ?? material.userData.buildingDetailMaterialKey
        ?? material.name,
      ...bounds.min.toArray().map((value) => value.toFixed(5)),
      ...bounds.max.toArray().map((value) => value.toFixed(5)),
    ].join('|'));
  });
  return signature;
}

function assertLiteralOpenings(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const frontWall = requiredMesh(root, 'Gable shell positive-z perforated wall');
  const rearWall = requiredMesh(root, 'Gable shell negative-z perforated wall');
  assert.equal(frontWall.userData.proceduralFacadeOpeningCount, 2);
  assert.equal(rearWall.userData.proceduralFacadeOpeningCount, 1);
  const openings = objectsWithData(root, 'facadeOpeningKind', 'door').concat(
    objectsWithData(root, 'facadeOpeningKind', 'window'),
  );
  assert.equal(objectsWithData(root, 'facadeOpeningKind', 'door').length, 1);
  assert.equal(objectsWithData(root, 'facadeOpeningKind', 'window').length, 2);
  for (const opening of openings) {
    const face = opening.userData.facadeOpeningFace as 'positive-z' | 'negative-z';
    const wall = face === 'positive-z' ? frontWall : rearWall;
    const outward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(opening.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const origin = opening.getWorldPosition(new THREE.Vector3()).addScaledVector(outward, 0.7);
    const hits = new THREE.Raycaster(origin, outward.clone().negate(), 0, 1.25)
      .intersectObject(wall, false);
    assert.equal(hits.length, 0, `${root.name} ${face} opening is not a literal wall aperture`);
  }
}

function assertBrownTimberAndNoVegetation(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const constructionKey = material.userData.buildingMaterialKey as string | undefined;
      const detailKey = material.userData.buildingDetailMaterialKey as string | undefined;
      assert.notEqual(constructionKey, 'timberLight', `${root.name} contains pale structural timber`);
      assert.doesNotMatch(
        `${material.name} ${constructionKey ?? ''} ${detailKey ?? ''}`,
        /(?:foliage|crop|grass|leaf|sapling|shrub|flower|herb|tree material)/i,
        `${root.name} authored living vegetation instead of leaving it to SeedThree`,
      );
      assert.doesNotMatch(
        object.name,
        /(?:foliage|crop|grass|sapling|shrub|flower|herb|planted tree)/i,
        `${root.name} contains a living-vegetation object`,
      );
    }
  });
}

function assertWithinAuthoredBounds(kind: ForestryKind, root: THREE.Group): void {
  const actual = new THREE.Box3().setFromObject(root);
  const expected = BUILDING_LOCAL_VISUAL_BOUNDS[kind];
  const epsilon = 1e-4;
  assert.ok(actual.min.x >= expected.minX - epsilon, `${kind} escaped minX visual bounds`);
  assert.ok(actual.max.x <= expected.maxX + epsilon, `${kind} escaped maxX visual bounds`);
  assert.ok(actual.min.z >= expected.minZ - epsilon, `${kind} escaped minZ visual bounds`);
  assert.ok(actual.max.z <= expected.maxZ + epsilon, `${kind} escaped maxZ visual bounds`);
}

function assertAnnex(kind: ForestryKind, root: THREE.Group): void {
  const plan = FORESTRY_ARCHITECTURE_PLANS[kind];
  const annex = root.getObjectByName(plan.annex.label);
  assert.ok(annex instanceof THREE.Group, `${kind} lost its planned work annex`);
  assert.equal(annex.userData.structuralConnection, 'wall-ledger-to-eave-post-frame');
  assert.deepEqual(annex.userData.architectureModulePlan, plan.annex);
  assert.equal(annex.userData.architectureCompiler.geometryWriter, 'semantic-physical-uv-v1');
  assert.equal(annex.userData.architectureCompiler.drawCalls, 4);

  const roof = requiredMesh(annex, `${plan.annex.label} joined split-shingle roof`);
  assert.equal(roof.userData.proceduralRoofAttachment, 'wall-ledger-to-post-supported-eave');
  assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
  const frame = requiredMesh(annex, `${plan.annex.label} joined brown timber frame and bench legs`);
  const frameMaterial = Array.isArray(frame.material) ? frame.material[0] : frame.material;
  assert.equal(frameMaterial.userData.buildingMaterialKey, 'timberDark');
  assert.equal(frame.userData.structuralMemberCount, 8);
  const boards = requiredMesh(annex, `${plan.annex.label} brown weathered-board work fixture`);
  const boardMaterial = Array.isArray(boards.material) ? boards.material[0] : boards.material;
  assert.equal(boardMaterial.userData.buildingMaterialKey, 'timberWeathered');
  const footings = requiredMesh(annex, `${plan.annex.label} two fieldstone post footings`);
  assert.equal(footings.userData.proceduralPrimitiveCount, 2);

  const diagnostics = frame.userData.proceduralPrimitiveDiagnostics as Array<{ semanticId: string }>;
  const semanticIds = new Set(diagnostics.map(({ semanticId }) => semanticId));
  for (const suffix of [
    'wall-ledger',
    'post-supported-eave-beam',
    'roof-bearing-post-1',
    'roof-bearing-post-2',
  ]) {
    assert.ok(semanticIds.has(`${plan.annex.id}-${suffix}`), `${kind} lost ${suffix}`);
  }

  const roofRun = Math.cos(plan.annex.roof.pitch) * plan.annex.roof.width;
  const roofRise = Math.sin(plan.annex.roof.pitch) * plan.annex.roof.width;
  const highX = plan.annex.roof.centerX - roofRun * 0.5;
  const highY = plan.annex.roof.centerY + roofRise * 0.5;
  const lowX = plan.annex.roof.centerX + roofRun * 0.5;
  const lowY = plan.annex.roof.centerY - roofRise * 0.5;
  assert.ok(Math.abs(highX - plan.annex.ledger.x) < 0.08, `${kind} roof misses wall ledger in X`);
  assert.ok(highY >= plan.annex.ledger.y, `${kind} roof falls below wall ledger`);
  assert.ok(Math.abs(lowX - plan.annex.eave.x) < 0.16, `${kind} roof misses eave beam in X`);
  assert.ok(lowY >= plan.annex.eave.y, `${kind} roof falls below its eave beam`);
  const roofBounds = new THREE.Box3().setFromObject(roof).expandByScalar(0.02);
  const frameBounds = new THREE.Box3().setFromObject(frame);
  assert.ok(roofBounds.intersectsBox(frameBounds), `${kind} annex roof floats above its frame`);
}

const cases = [
  ['reforester', createReforesterHutMesh],
  ['woodcutters_lodge', createWoodcuttersLodgeMesh],
] as const;

for (const [kind, factory] of cases) {
  const root = factory();
  root.updateMatrixWorld(true);
  assert.equal(root.userData.architecturePlan, FORESTRY_ARCHITECTURE_PLANS[kind]);
  assert.equal(root.userData.architecturePlan.embeddedVegetationGeometry, false);
  assertLiteralOpenings(root);
  assertAnnex(kind, root);
  assertBrownTimberAndNoVegetation(root);
  assertWithinAuthoredBounds(kind, root);
  assert.deepEqual(deterministicSignature(root), deterministicSignature(factory()));
  const triangles = triangleCount(root);
  assert.ok(
    triangles <= PROCEDURAL_BUILDING_CATALOG[kind].triangleCeiling,
    `${kind} exceeds its ${PROCEDURAL_BUILDING_CATALOG[kind].triangleCeiling}-triangle ceiling`,
  );
}

const woodcutters = createWoodcuttersLodgeMesh();
const firewood = woodcutters.getObjectByName('WoodcuttersFirewoodStockpile');
assert.ok(firewood instanceof THREE.Group);
assert.equal(firewood.visible, false);
assert.equal(firewood.children.filter((child) => child.name === 'WoodcuttersFirewoodSegment').length, 4);
assert.equal(woodcutters.getObjectByName('Woodcutters empty brown timber splitting block') instanceof THREE.Mesh, true);

console.log('forestry architecture tests passed (literal apertures, connected annexes, brown timber, runtime anchors)');
