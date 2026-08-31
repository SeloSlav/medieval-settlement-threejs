import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCobblerMesh,
  createTanneryMesh,
} from '../src/buildings/meshes/leatherChainBuildingMeshes.ts';
import {
  createCharcoalBurnerMesh,
  createPotterKilnMesh,
  createSmithyMesh,
} from '../src/buildings/meshes/materialChainBuildingMeshes.ts';
import {
  createPastoralFarmsteadMesh,
  createSwineherdMesh,
} from '../src/buildings/meshes/livestockBuildingMeshes.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';
import type { BuildingKind } from '../src/resources/types.ts';

type RuralCase = {
  readonly kind: Extract<BuildingKind,
    | 'tannery'
    | 'cobbler'
    | 'charcoal_burner'
    | 'smithy'
    | 'potter_kiln'
    | 'pastoral_farmstead'
    | 'swineherd'>;
  readonly create: () => THREE.Group;
  readonly signature: string;
  readonly frontApertures: number;
};

const CASES: readonly RuralCase[] = [
  { kind: 'tannery', create: createTanneryMesh, signature: 'gorski-tannery-v1', frontApertures: 3 },
  { kind: 'cobbler', create: createCobblerMesh, signature: 'gorski-cobbler-v1', frontApertures: 2 },
  { kind: 'charcoal_burner', create: createCharcoalBurnerMesh, signature: 'gorski-charcoal-burner-yard-v1', frontApertures: 0 },
  { kind: 'smithy', create: createSmithyMesh, signature: 'gorski-forest-bloomery-smithy-v1', frontApertures: 2 },
  { kind: 'potter_kiln', create: createPotterKilnMesh, signature: 'gorski-detached-pottery-kiln-yard-v1', frontApertures: 2 },
  { kind: 'pastoral_farmstead', create: createPastoralFarmsteadMesh, signature: 'gorski-pastoral-farmstead-byre-v1', frontApertures: 2 },
  { kind: 'swineherd', create: createSwineherdMesh, signature: 'gorski-woodland-swineherd-sty-v1', frontApertures: 2 },
];

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

function triangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : (position?.count ?? 0) / 3;
  });
  return triangles;
}

function deterministicSignature(root: THREE.Object3D): readonly string[] {
  root.updateMatrixWorld(true);
  const signature: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    const position = object.geometry.getAttribute('position');
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    signature.push([
      object.name,
      position?.count ?? 0,
      object.geometry.index?.count ?? 0,
      material.userData.buildingMaterialKey
        ?? material.userData.buildingDetailMaterialKey
        ?? material.name,
      ...bounds.min.toArray().map((value) => value.toFixed(5)),
      ...bounds.max.toArray().map((value) => value.toFixed(5)),
    ].join('|'));
  });
  return signature;
}

function assertJoined(
  left: THREE.Object3D,
  right: THREE.Object3D,
  message: string,
  tolerance = 0.025,
): void {
  const leftBounds = new THREE.Box3().setFromObject(left).expandByScalar(tolerance);
  const rightBounds = new THREE.Box3().setFromObject(right).expandByScalar(tolerance);
  assert.ok(leftBounds.intersectsBox(rightBounds), message);
}

function assertLiteralFrontApertures(root: THREE.Group, expected: number): void {
  const wall = root.getObjectByName('Gable shell positive-z perforated wall');
  if (expected === 0) {
    assert.equal(wall, undefined, `${root.name} is an open yard and must not invent a cottage facade`);
    return;
  }
  assert.ok(wall instanceof THREE.Mesh, `${root.name} must expose its perforated road facade`);
  assert.equal(wall.geometry.type, 'ExtrudeGeometry');
  assert.equal(wall.userData.proceduralFacadeOpeningCount, expected);

  let semanticOpenings = 0;
  root.traverse((object) => {
    const kind = object.userData.facadeOpeningKind as 'door' | 'window' | undefined;
    if (!kind) return;
    semanticOpenings += 1;
    const origin = object.getWorldPosition(new THREE.Vector3());
    if (kind === 'door') {
      origin.y += Number(object.userData.facadeOpeningHeight) * 0.5;
    }
    const outward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const hits = new THREE.Raycaster(
      origin.clone().addScaledVector(outward, 0.55),
      outward.clone().negate(),
      0,
      1.1,
    ).intersectObject(wall, false);
    assert.equal(hits.length, 0, `${root.name} ${kind} must pass through the wall shell`);
  });
  assert.ok(semanticOpenings >= 1, `${root.name} must retain semantic door/window groups`);
}

function assertSupportFrame(
  root: THREE.Group,
  roofName: string,
  prefix: string,
  outerPostCount: number,
  innerPostCount: number,
  attachmentWallName?: string,
): void {
  const roof = root.getObjectByName(roofName);
  const frame = root.getObjectByName(`${prefix} connected support frame`);
  const ledger = root.getObjectByName(`${prefix} wall ledger`);
  const eave = root.getObjectByName(`${prefix} post-supported eave beam`);
  assert.ok(roof instanceof THREE.Mesh, `${root.name} is missing ${roofName}`);
  assert.ok(frame instanceof THREE.Group, `${roofName} is missing its support frame`);
  assert.ok(ledger instanceof THREE.Mesh && eave instanceof THREE.Mesh);
  assert.equal(roof.userData.supportedRoof, true);
  assert.equal(roof.userData.supportFrameName, frame.name);
  assertJoined(roof, ledger, `${prefix} roof must meet its wall ledger`);
  assertJoined(roof, eave, `${prefix} roof must meet its outer eave beam`);

  const outerPosts = objectsNamed(root, `${prefix} outer roof-bearing post`);
  const innerPosts = objectsNamed(root, `${prefix} inner roof-bearing post`);
  assert.equal(outerPosts.length, outerPostCount);
  assert.equal(innerPosts.length, innerPostCount);
  for (const post of outerPosts) assertJoined(post, eave, `${prefix} outer post must carry the eave`);
  for (const post of innerPosts) assertJoined(post, ledger, `${prefix} inner post must carry the ledger`);
  if (attachmentWallName) {
    const wall = root.getObjectByName(attachmentWallName);
    assert.ok(wall, `${prefix} is missing its attachment wall`);
    assertJoined(ledger, wall, `${prefix} ledger must physically meet the building wall`, 0.035);
  }
}

function assertBrownTimberAndSeedThreeOwnership(root: THREE.Group): void {
  assert.equal(root.userData.embeddedVegetationGeometry, false);
  const plan = root.userData.architecturePlan as {
    vegetationOwner?: string;
    embeddedVegetationGeometry?: boolean;
  };
  assert.equal(plan.vegetationOwner, 'SeedThree');
  assert.equal(plan.embeddedVegetationGeometry, false);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const key = String(
        material.userData.buildingMaterialKey
        ?? material.userData.buildingDetailMaterialKey
        ?? '',
      );
      assert.notEqual(key, 'timberLight', `${root.name} retains pale structural timber at ${object.name}`);
      assert.doesNotMatch(key, /foliage|crop|grassRoof/i, `${root.name} must not embed vegetation materials`);
      if (/brown timber/i.test(object.name)) {
        assert.match(key, /^timber(?:Dark|Mid|Weathered)$/, `${object.name} must use shared brown timber`);
      }
    }
  });
}

function anchorSignature(root: THREE.Group, name: string): string {
  root.updateMatrixWorld(true);
  const container = root.getObjectByName(name);
  assert.ok(container instanceof THREE.Group, `${root.name} must retain runtime anchor ${name}`);
  const format = (object: THREE.Object3D): string => object
    .getWorldPosition(new THREE.Vector3())
    .toArray()
    .map((value) => Number(value.toFixed(3)))
    .join(',');
  return `${name}|${format(container)}|${container.children
    .map((child) => `${child.name}@${format(child)}`)
    .join(';')}`;
}

const EXPECTED_ANCHORS = new Map<string, readonly string[]>([
  ['Tannery', [
    'HidesStock|0,0,0|HidesStockSegment@-4.2,0,1.55;HidesStockSegment@-4.2,0,0;HidesStockSegment@-4.2,0,-1.55',
    'LeatherStock|0,0,0|LeatherStockSegment@2.65,0.03,2.25;LeatherStockSegment@3.3,0.03,2.25;LeatherStockSegment@2.95,0.42,2.25',
  ]],
  ['Cobbler', [
    'LeatherStock|0,0,0|LeatherStockSegment@-2.2,0.02,2.48;LeatherStockSegment@-1.65,0.02,2.48;LeatherStockSegment@-1.95,0.42,2.48',
    'ShoesStock|0,0,0|ShoesStockSegment@0.2,0.78,2.48;ShoesStockSegment@0.9,0.78,2.48;ShoesStockSegment@1.6,0.78,2.48',
  ]],
  ["Charcoal burner's yard", [
    'CharcoalBurnerStockpile|0,0,0|CharcoalBurnerCharcoalSegment@2.05,0.38,1.45;CharcoalBurnerCharcoalSegment@2.65,0.46,1.5;CharcoalBurnerCharcoalSegment@3.25,0.38,1.48;CharcoalBurnerCharcoalSegment@2.35,0.46,2.02;CharcoalBurnerCharcoalSegment@2.95,0.38,2.05',
    'CharcoalBurnerFirewoodStockpile|0,0,0|CharcoalBurnerFirewoodSegment@2,0,-2.7;CharcoalBurnerFirewoodSegment@2.95,0,-2.72;CharcoalBurnerFirewoodSegment@2.45,0.34,-2.68',
  ]],
  ['Forest bloomery and smithy', [
    'SmithyQuenchWaterStockpile|3.55,-0.05,1.95|SmithyQuenchWaterSegment@3.55,0.15,1.95;SmithyQuenchWaterSegment@3.55,0.32,1.95;SmithyQuenchWaterSegment@3.55,0.49,1.95',
    'SmithyIronStockpile|0,0,0|SmithyIronSegment@1.75,0.3,-2.25;SmithyIronSegment@2.53,0.3,-2.25;SmithyIronSegment@1.75,0.43,-2.25;SmithyIronSegment@2.53,0.43,-2.25',
    'SmithyCharcoalStockpile|0,0,0|SmithyCharcoalSegment@-3.55,0.46,-1.85;SmithyCharcoalSegment@-4.03,0.46,-1.85;SmithyCharcoalSegment@-3.55,0.94,-1.85',
    'SmithyIronworkStockpile|0,0,0|SmithyIronworkSegment@2,0.3,2.35;SmithyIronworkSegment@2.52,0.3,2.35;SmithyIronworkSegment@2,0.48,2.35;SmithyIronworkSegment@2.52,0.48,2.35',
  ]],
  ["Potter's kiln", [
    'PotterPuddlingWaterStockpile|-3.35,-0.03,-1.65|PotterPuddlingWaterSegment@-3.35,0.09,-1.65;PotterPuddlingWaterSegment@-3.35,0.18,-1.65;PotterPuddlingWaterSegment@-3.35,0.27,-1.65',
    'PotterClayStockpile|0,0,0|PotterClaySegment@-3.15,0.16,1.65;PotterClaySegment@-2.6,0.16,1.65;PotterClaySegment@-3.15,0.34,1.65;PotterClaySegment@-2.6,0.34,1.65;PotterClaySegment@-3.15,0.52,1.65',
    'PotterPotteryStockpile|0,0,0|PotterPotterySegment@1.55,0.04,1.4;PotterPotterySegment@2.13,0.04,1.4;PotterPotterySegment@2.71,0.04,1.4;PotterPotterySegment@1.55,0.52,1.4;PotterPotterySegment@2.13,0.52,1.4',
    'PotterRoofTileStockpile|0,0,0|PotterRoofTileSegment@-0.15,0.08,2.25;PotterRoofTileSegment@0.47,0.08,2.25;PotterRoofTileSegment@1.09,0.08,2.25;PotterRoofTileSegment@-0.15,0.08,2.8;PotterRoofTileSegment@0.47,0.08,2.8',
    'PotterFirewoodStockpile|0,0,0|PotterFirewoodSegment@1.55,0,-3.15;PotterFirewoodSegment@2.5,0,-3.12;PotterFirewoodSegment@2,0.34,-3.1',
  ]],
  ['Pastoral farmstead', [
    'HayloftStockpile|-4.5,0,-4.25|HayStockSegment@-4.84,1.08,-4.25;HayStockSegment@-4.16,1.08,-4.25;HayStockSegment@-4.828,1.35,-4.25;HayStockSegment@-4.172,1.35,-4.25;HayStockSegment@-4.816,1.62,-4.25;HayStockSegment@-4.184,1.62,-4.25;HayStockSegment@-4.804,1.89,-4.25;HayStockSegment@-4.196,1.89,-4.25',
    'WoolStockpile|-1.6,0,4|WoolStockSegment@-2.01,0.36,4;WoolStockSegment@-1.19,0.36,4;WoolStockSegment@-2.01,0.88,4;WoolStockSegment@-1.19,0.88,4',
    'PastoralSaltStockpile|0,0,0|PastoralSaltSegment@1.65,0,4.02;PastoralSaltSegment@2.2,0,4.12;PastoralSaltSegment@1.92,0,3.58',
    'PastoralManureStockpile|5.45,0,-3.65|ManureStockSegment@5.03,0,-3.97;ManureStockSegment@5.87,0,-3.97;ManureStockSegment@5.11,0,-3.31;ManureStockSegment@5.95,0,-3.31',
  ]],
]);

const triangleReport: string[] = [];
for (const ruralCase of CASES) {
  const root = ruralCase.create();
  root.updateMatrixWorld(true);
  const plan = root.userData.architecturePlan as {
    signature?: string;
    deterministic?: boolean;
    modules?: readonly string[];
  };
  const diagnostics = root.userData.architectureDiagnostics as {
    moduleCount?: number;
    meshCount?: number;
    triangleCount?: number;
    materialSlotCount?: number;
  };
  assert.equal(plan.signature, ruralCase.signature);
  assert.equal(plan.deterministic, true);
  assert.equal(diagnostics.moduleCount, plan.modules?.length);
  assert.ok((diagnostics.meshCount ?? 0) >= 20);
  assert.ok((diagnostics.materialSlotCount ?? 0) <= 15, `${root.name} expands the shared material-slot budget`);
  assertLiteralFrontApertures(root, ruralCase.frontApertures);
  assertBrownTimberAndSeedThreeOwnership(root);
  assert.deepEqual(deterministicSignature(root), deterministicSignature(ruralCase.create()));

  const triangles = triangleCount(root);
  assert.equal(diagnostics.triangleCount, Math.round(triangles));
  assert.ok(
    triangles <= PROCEDURAL_BUILDING_CATALOG[ruralCase.kind].triangleCeiling,
    `${ruralCase.kind} exceeds its catalog triangle ceiling (${triangles})`,
  );
  triangleReport.push(`${ruralCase.kind} ${triangles}`);

  const expectedAnchors = EXPECTED_ANCHORS.get(root.name) ?? [];
  for (const expected of expectedAnchors) {
    const name = expected.slice(0, expected.indexOf('|'));
    assert.equal(anchorSignature(root, name), expected, `${root.name} moved runtime stock anchor ${name}`);
  }
}

const tannery = createTanneryMesh();
tannery.updateMatrixWorld(true);
assertSupportFrame(
  tannery,
  'Deep tannery wet-yard roof',
  'Tannery wet-yard',
  3,
  0,
  'Gable shell positive-z perforated wall',
);
assert.equal(objectsNamed(tannery, 'Bark-liquor tanning vat').length, 3);
assert.equal(objectsNamed(tannery, 'Drying-loft louver').length, 6);

const cobbler = createCobblerMesh();
cobbler.updateMatrixWorld(true);
assertSupportFrame(
  cobbler,
  'Cobbler work porch roof',
  'Cobbler work porch',
  2,
  0,
  'Gable shell positive-z perforated wall',
);
assert.equal(objectsNamed(cobbler, 'Shoe last').length, 3);

const charcoal = createCharcoalBurnerMesh();
charcoal.updateMatrixWorld(true);
assertSupportFrame(
  charcoal,
  'Charcoal burner tool shelter joined split-shingle canopy roof',
  'Charcoal burner tool shelter',
  2,
  2,
);
assert.equal(objectsNamed(charcoal, 'Charcoal clamp brown timber draw vent').length, 8);
assert.ok(charcoal.getObjectByName('CharcoalClampSmoke') instanceof THREE.Group);

const smithy = createSmithyMesh();
smithy.updateMatrixWorld(true);
assertSupportFrame(
  smithy,
  'Smithing bay roof',
  'Smithy open working bay',
  2,
  0,
  'Gable shell right side wall',
);
for (const name of [
  'Direct-process bloomery',
  'Smithy forge hearth',
  'Smithy anvil',
  'Smithy quench tub',
  'Smithy masonry chimney shaft',
]) {
  assert.ok(smithy.getObjectByName(name), `smithy must retain ${name}`);
}

const potter = createPotterKilnMesh();
potter.updateMatrixWorld(true);
assertSupportFrame(
  potter,
  'Potter drying shelter joined split-shingle canopy roof',
  'Potter drying shelter',
  2,
  2,
);
assert.equal(objectsNamed(potter, 'Potter brown timber drying shelf').length, 3);
for (const upright of objectsNamed(potter, 'Potter brown timber drying shelf upright')) {
  for (const shelf of objectsNamed(potter, 'Potter brown timber drying shelf')) {
    assertJoined(upright, shelf, 'potter drying shelves must meet both uprights');
  }
}

const pastoral = createPastoralFarmsteadMesh();
pastoral.updateMatrixWorld(true);
assertSupportFrame(
  pastoral,
  'Pastoral farmstead byre roof',
  'Pastoral farmstead open byre',
  3,
  0,
  'Gable shell right side wall',
);
assert.ok(pastoral.getObjectByName('Open brown timber livestock trough'));
assert.equal(objectsNamed(pastoral, 'Pastoral hayrack connected brown timber rail').length, 2);
assert.equal(objectsNamed(pastoral, 'Pastoral coopered brown timber milk churn').length, 2);

const swineherd = createSwineherdMesh();
swineherd.updateMatrixWorld(true);
const sty = swineherd.getObjectByName('Swineherd hollow framed sleeping sty');
const styRoof = swineherd.getObjectByName('Swineherd joined sleeping-sty roof');
assert.ok(sty instanceof THREE.Group && styRoof instanceof THREE.Mesh);
assert.equal(sty.userData.architectureRole, 'literal-open-animal-shelter');
assert.equal(objectsNamed(sty, 'Swineherd sty roof-bearing corner post').length, 4);
assert.equal(objectsNamed(sty, 'Swineherd sty connected roof plate').length, 2);
for (const plate of objectsNamed(sty, 'Swineherd sty connected roof plate')) {
  assertJoined(plate, styRoof, 'swineherd sty roof must bear on its connected wall plates');
}
sty.traverse((object) => {
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BoxGeometry)) return;
  const { width, height, depth } = object.geometry.parameters;
  assert.equal(
    width >= 4.5 && depth >= 3 && height >= 1,
    false,
    'swineherd sty must remain hollow rather than regress to a solid timber block',
  );
});
const styGate = swineherd.getObjectByName('Swineherd brown timber sty gate in literal opening');
assert.ok(styGate instanceof THREE.Mesh);
assert.equal(styGate.userData.literalWallAperture, true);
assert.ok(swineherd.getObjectByName('Open brown timber livestock trough'));
assert.ok(swineherd.getObjectByName('Swineherd wash trough water surface'));

console.log(`rural workshop architecture passed: ${triangleReport.join(', ')}`);

