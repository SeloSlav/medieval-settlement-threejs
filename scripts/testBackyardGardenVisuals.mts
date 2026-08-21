import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
  syncBackyardGardenSeasonVisuals,
} from '../src/residences/backyardGardenMesh.ts';
import {
  BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN,
  backyardGardenClearsGroundcover,
  backyardGardenClearancePolygon,
} from '../src/residences/backyardPosition.ts';
import type { BackyardGardenKind } from '../src/generated/gameBalance.ts';
import { BACKYARD_GARDEN_PICKER_KINDS } from '../src/residences/backyardGarden.ts';
import type { BackyardPlantCatalog } from '../src/vegetation/seedthree/backyardPlantAssets.ts';
import { BACKYARD_PLANT_SPECIES } from '../src/vegetation/seedthree/backyardPlantPresets.ts';

const kinds: BackyardGardenKind[] = [
  'orchard',
  'apple_orchard',
  'cherry_orchard',
  'pear_orchard',
  'aronia_orchard',
  'rosehip_orchard',
  'vegetable_garden',
  'flower_garden',
  'herb_garden',
  'hen_yard',
  'goat_pen',
  'backyard_apiary',
];

const signatures: Record<BackyardGardenKind, string> = {
  orchard: 'Prepared orchard planting pit',
  apple_orchard: 'AppleTree:',
  cherry_orchard: 'CherryTree:',
  pear_orchard: 'PearTree:',
  aronia_orchard: 'AroniaBush:',
  rosehip_orchard: 'RosehipBush:',
  vegetable_garden: 'CabbageRows',
  flower_garden: 'RoseBush:',
  herb_garden: 'HerbDryingRack',
  hen_yard: 'HenCoopDoor',
  goat_pen: 'GoatShelter',
  backyard_apiary: 'BackyardBeeSkep',
};

const terrainBackedKinds = new Set<BackyardGardenKind>([
  'orchard',
  'apple_orchard',
  'cherry_orchard',
  'pear_orchard',
  'aronia_orchard',
  'rosehip_orchard',
  'vegetable_garden',
  'flower_garden',
  'herb_garden',
  'hen_yard',
  'goat_pen',
  'backyard_apiary',
]);

assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('cherry_orchard'), false);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('apple_orchard'), false);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('pear_orchard'), false);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('aronia_orchard'), false);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('rosehip_orchard'), false);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS[0], 'orchard');
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('goat_pen'), true);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('backyard_apiary'), true);

for (const kind of kinds) {
  assert.equal(
    backyardGardenClearsGroundcover(kind),
    kind === 'vegetable_garden' || kind === 'flower_garden' || kind === 'herb_garden',
    `${kind} should ${kind.endsWith('_garden') ? '' : 'not '}clear grass and wildflowers`,
  );
}

const quarterTurnClearance = backyardGardenClearancePolygon(
  { x: 10, z: -4, width: 6, depth: 4, yaw: Math.PI * 0.5 },
  0,
);
for (const [actual, expected] of [
  [Math.min(...quarterTurnClearance.map((point) => point.x)), 8],
  [Math.max(...quarterTurnClearance.map((point) => point.x)), 12],
  [Math.min(...quarterTurnClearance.map((point) => point.z)), -7],
  [Math.max(...quarterTurnClearance.map((point) => point.z)), -1],
] as const) {
  assert.ok(Math.abs(actual - expected) < 1e-9);
}
assert.ok(
  BACKYARD_GROUNDCOVER_CLEARANCE_MARGIN >= 0.5,
  'garden clearance should keep wind-bent grass and wildflower heads outside the complete plot',
);
const expandedGardenClearance = backyardGardenClearancePolygon(
  { x: 10, z: -4, width: 6, depth: 4, yaw: 0 },
);
assert.ok(
  Math.min(...expandedGardenClearance.map((point) => point.x)) <= 6.5
    && Math.max(...expandedGardenClearance.map((point) => point.x)) >= 13.5
    && Math.min(...expandedGardenClearance.map((point) => point.z)) <= -6.5
    && Math.max(...expandedGardenClearance.map((point) => point.z)) >= -1.5,
  'the default groundcover exclusion should extend at least half a metre beyond every garden edge',
);

for (const kind of kinds) {
  const width = 6.2;
  const depth = 5.4;
  const garden = createBackyardGardenMesh(kind, { width, depth, seed: 4271 });
  garden.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(garden);
  const size = bounds.getSize(new THREE.Vector3());
  const names: string[] = [];
  const soilBeds: THREE.Mesh[] = [];
  const bedRails: THREE.Mesh[] = [];
  let meshCount = 0;
  garden.traverse((object) => {
    if (object.name) names.push(object.name);
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshCount += 1;
    if (object.name === 'Textured garden soil bed') soilBeds.push(mesh);
    if (object.name === 'Garden bed end rail' || object.name === 'Garden bed side rail') {
      bedRails.push(mesh);
    }
  });

  assert.equal(garden.userData.gardenKind, kind, `${kind} should retain its gameplay identity`);
  assert.equal(garden.userData.usesSeedThree, false, `${kind} should report that SeedThree is not yet attached`);
  const minimumMeshCountWithoutStreamedPlants = kind.endsWith('_orchard') ? 7 : 12;
  assert.ok(
    meshCount >= minimumMeshCountWithoutStreamedPlants,
    `${kind} should be a composed scene, not a placeholder prop`,
  );
  assert.ok(names.some((name) => name.startsWith(signatures[kind])), `${kind} should expose its signature feature`);
  assert.ok(size.x <= 7.5, `${kind} should stay inside a 6.2m parcel with modest foliage overhang`);
  assert.ok(size.z <= 7.5, `${kind} should stay inside a 5.4m backyard with modest foliage overhang`);
  assert.ok(size.y > 0.4, `${kind} should have readable vertical structure`);
  if (kind === 'vegetable_garden' || kind === 'flower_garden' || kind === 'herb_garden') {
    assert.ok(soilBeds.length >= 2, `${kind} should expose its individual textured soil beds`);
    for (const bed of soilBeds) {
      const material = bed.material as THREE.MeshStandardMaterial;
      assert.equal(material.name, 'Textured dark garden-bed soil');
      assert.deepEqual(material.userData.pbrTexturePaths, {
        albedo: '/assets/textures/terrain/mammoth_terrain_dirt/albedo.png',
        normal: '/assets/textures/terrain/mammoth_terrain_dirt/normal.png',
        roughness: '/assets/textures/terrain/mammoth_terrain_dirt/roughness.png',
      });
    }
  }
  if (kind === 'vegetable_garden' || kind === 'flower_garden') {
    assert.equal(bedRails.length, 0, `${kind} should not have timber frames around its beds`);
    for (const bed of soilBeds) {
      assert.equal(
        bed.geometry.type,
        'PlaneGeometry',
        `${kind} soil should be a ground-level surface instead of a raised dirt volume`,
      );
      assert.ok(
        bed.position.y <= 0.01,
        `${kind} soil should sit flush with the backyard terrain`,
      );
    }
  }
  for (let first = 0; first < bedRails.length; first++) {
    const firstBounds = new THREE.Box3().setFromObject(bedRails[first]!);
    for (let second = first + 1; second < bedRails.length; second++) {
      const secondBounds = new THREE.Box3().setFromObject(bedRails[second]!);
      const overlapX = Math.min(firstBounds.max.x, secondBounds.max.x)
        - Math.max(firstBounds.min.x, secondBounds.min.x);
      const overlapZ = Math.min(firstBounds.max.z, secondBounds.max.z)
        - Math.max(firstBounds.min.z, secondBounds.min.z);
      assert.ok(
        overlapX <= 1e-6 || overlapZ <= 1e-6,
        `${kind} bed rails should meet at butt joints without coplanar corner overlap`,
      );
    }
  }
  const fenceNames = names.filter((name) => /fence/i.test(name));
  if (kind === 'hen_yard') {
    assert.deepEqual(
      fenceNames,
      ['Hen yard enclosure fence'],
      'hen yards should retain their functional animal enclosure',
    );
  } else if (kind === 'goat_pen') {
    assert.deepEqual(
      fenceNames,
      ['Goat pen enclosure fence'],
      'goat pens should retain their functional animal enclosure',
    );
  } else {
    assert.deepEqual(
      fenceNames,
      [],
      `${kind} should leave fencing to the parcel perimeter renderer`,
    );
  }

  if (terrainBackedKinds.has(kind)) {
    let hasArtificialGroundPlane = false;
    garden.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.geometry.type !== 'BoxGeometry') return;
      const parameters = mesh.geometry.parameters as { width?: number; depth?: number };
      if (
        Number(parameters.width) >= width * 0.95
        && Number(parameters.depth) >= depth * 0.95
        && mesh.position.y < 0.1
      ) {
        hasArtificialGroundPlane = true;
      }
    });
    assert.equal(
      hasArtificialGroundPlane,
      false,
      `${kind} should let the terrain system provide its grass`,
    );
  }

  disposeBackyardGardenMesh(garden);
}

const shallow = createBackyardGardenMesh('apple_orchard', { width: 4.4, depth: 2.1, seed: 99 });
const shallowTrees: THREE.Object3D[] = [];
shallow.traverse((object) => {
  if (object.name.startsWith('AppleTree:')) shallowTrees.push(object);
});
assert.equal(shallowTrees.length, 2, 'shallow plots should reduce orchard count instead of flattening trees');
assert.deepEqual(shallow.userData.orchardGrid, { columns: 2, rows: 1 });
assert.deepEqual(
  shallowTrees.map((tree) => [tree.position.x, tree.position.z]),
  [[-1.1, 0], [1.1, 0]],
  'shallow orchard trees should evenly center themselves in two width-proportional cells',
);
disposeBackyardGardenMesh(shallow);

const deepOrchard = createBackyardGardenMesh('cherry_orchard', { width: 4, depth: 6, seed: 99 });
const deepTrees: THREE.Object3D[] = [];
deepOrchard.traverse((object) => {
  if (object.name.startsWith('CherryTree:')) deepTrees.push(object);
});
assert.deepEqual(deepOrchard.userData.orchardGrid, { columns: 1, rows: 2 });
assert.deepEqual(
  deepTrees.map((tree) => [tree.position.x, tree.position.z]),
  [[0, -1.5], [0, 1.5]],
  'deep orchard trees should align evenly along the backyard length',
);
disposeBackyardGardenMesh(deepOrchard);

const vegetableDetail = createBackyardGardenMesh('vegetable_garden', {
  width: 6.2,
  depth: 5.4,
  seed: 4271,
});
const vegetableNames: string[] = [];
const vegetableCrops: THREE.Object3D[] = [];
vegetableDetail.traverse((object) => {
  if (object.name) vegetableNames.push(object.name);
  if (object.userData.backyardCropKind) vegetableCrops.push(object);
});
for (const cropName of ['CabbageRows', 'CarrotRows', 'TurnipRows']) {
  assert.ok(
    vegetableNames.includes(cropName),
    `vegetable gardens should devote a visible planting bed to ${cropName}`,
  );
}
assert.ok(
  vegetableNames.filter((name) => name === 'Textured cabbage outer leaf').length >= 28,
  'cabbages should use layered botanical leaf cutouts',
);
assert.ok(
  vegetableNames.filter((name) => name === 'Textured carrot frond').length >= 18,
  'carrots should expose feathery foliage above their modeled roots',
);
assert.ok(
  vegetableNames.filter((name) => name === 'Textured turnip leaf').length >= 20,
  'turnips should expose broad leaf rosettes above their bulbs',
);
assert.ok(!vegetableNames.includes('Bean and pea trellis'), 'vegetable gardens should not retain the lintel-like trellis');
assert.ok(!vegetableNames.includes('Textured climbing bean vine'), 'the unidentified tall vine strip should be removed with its trellis');
assert.ok(!vegetableNames.includes('Harvest basket'), 'vegetable gardens should not retain the stray pot-like center prop');
for (const primitiveName of [
  'Layered cabbage heart',
  'Carrot root shoulder',
  'Carrot crown',
  'Turnip root bulb',
  'Purple turnip shoulder',
]) {
  assert.ok(
    !vegetableNames.includes(primitiveName),
    `visible vegetable detail should not fall back to primitive ${primitiveName} geometry`,
  );
}
syncBackyardGardenSeasonVisuals(vegetableDetail, 'vegetable_garden', 1);
assert.ok(vegetableCrops.every((crop) => !crop.visible), 'winter vegetable beds should show no crop growth');
syncBackyardGardenSeasonVisuals(vegetableDetail, 'vegetable_garden', 3);
assert.ok(vegetableCrops.every((crop) => crop.visible), 'March vegetable beds should show mixed seedlings');
syncBackyardGardenSeasonVisuals(vegetableDetail, 'vegetable_garden', 12);
assert.ok(vegetableCrops.every((crop) => !crop.visible), 'December vegetable beds should be cleared');
disposeBackyardGardenMesh(vegetableDetail);

const herbDetail = createBackyardGardenMesh('herb_garden', {
  width: 6.2,
  depth: 5.4,
  seed: 4271,
});
const herbNames: string[] = [];
const herbRacks: THREE.Group[] = [];
const herbClumps: THREE.Object3D[] = [];
const dryingBundles: THREE.Object3D[] = [];
herbDetail.traverse((object) => {
  if (object.name) herbNames.push(object.name);
  if (object.name.startsWith('HerbDryingRack:')) herbRacks.push(object as THREE.Group);
  if (object.userData.backyardHerbKind) herbClumps.push(object);
  if (object.userData.backyardSeasonalRole === 'drying-herb-bundle') dryingBundles.push(object);
});
for (const herb of ['parsley', 'rosemary', 'sage']) {
  assert.ok(
    herbNames.some((name) => name === `Textured ${herb} clump`),
    `herb gardens should contain a realistic textured ${herb} crop`,
  );
  assert.ok(
    herbNames.filter((name) => name === `Textured ${herb} herb card`).length >= 3,
    `${herb} clumps should use crossed photographic cards for depth`,
  );
}
assert.ok(
  herbNames.filter((name) => name === 'Textured hanging herb bundle').length === 8,
  'both drying racks should use textured herb bundles instead of primitive cones',
);
assert.equal(herbRacks.length, 2, 'herb gardens should read as having two drying racks');
assert.ok(
  herbRacks.every((rack) => (
    rack.userData.detachedFromBeds === true
    && rack.position.x > 2.4
    && rack.position.x < 3.1
  )),
  'the two drying racks should sit detached in a side aisle without exceeding the garden footprint',
);
syncBackyardGardenSeasonVisuals(herbDetail, 'herb_garden', 1);
assert.ok(
  herbClumps.some((clump) => clump.userData.backyardHerbKind === 'rosemary' && clump.visible),
  'hardy rosemary should remain visible at reduced winter scale',
);
assert.ok(dryingBundles.every((bundle) => !bundle.visible), 'winter drying racks should be empty');
syncBackyardGardenSeasonVisuals(herbDetail, 'herb_garden', 3);
assert.ok(dryingBundles.every((bundle) => !bundle.visible), 'March regrowth should not produce cut bundles');
syncBackyardGardenSeasonVisuals(herbDetail, 'herb_garden', 4);
assert.ok(dryingBundles.every((bundle) => bundle.visible), 'April cutting should put herbs on the drying racks');
disposeBackyardGardenMesh(herbDetail);

const fullBackyardVegetables = createBackyardGardenMesh('vegetable_garden', {
  width: 6.9,
  depth: 10.8,
  seed: 4271,
});
assert.deepEqual(
  fullBackyardVegetables.userData.footprint,
  { width: 6.9, depth: 10.8 },
  'garden meshes must retain a parcel-fitted footprint beyond the former generic size caps',
);
disposeBackyardGardenMesh(fullBackyardVegetables);

const extremeBackyardVegetables = createBackyardGardenMesh('vegetable_garden', {
  width: 30,
  depth: 40,
  seed: 4271,
});
let extremeCropCount = 0;
extremeBackyardVegetables.traverse((object) => {
  if (/^(Cabbage|Carrot|Turnip) plant$/.test(object.name)) extremeCropCount += 1;
});
assert.deepEqual(extremeBackyardVegetables.userData.footprint, { width: 30, depth: 40 });
assert.ok(
  extremeCropCount > 0 && extremeCropCount <= 3 * 8 * 24,
  'unusually large plots should fill their footprint without unbounded crop-detail growth',
);
disposeBackyardGardenMesh(extremeBackyardVegetables);

const appleDetail = createBackyardGardenMesh('apple_orchard', { width: 6.2, depth: 5.4, seed: 4271 });
const cherryDetail = createBackyardGardenMesh('cherry_orchard', { width: 6.2, depth: 5.4, seed: 4271 });
let appleFruitCount = 0;
let cherryFruitCount = 0;
let appleFruitRadius = 0;
let cherryFruitRadius = 0;
appleDetail.traverse((object) => {
  const fruit = object as THREE.InstancedMesh;
  if (!fruit.isInstancedMesh || fruit.name !== 'Apple fruit') return;
  appleFruitCount += fruit.count;
  appleFruitRadius = Number(fruit.userData.fruitRadius);
});
cherryDetail.traverse((object) => {
  const fruit = object as THREE.InstancedMesh;
  if (!fruit.isInstancedMesh || fruit.name !== 'Cherry fruit clusters') return;
  cherryFruitCount += fruit.count;
  cherryFruitRadius = Number(fruit.userData.fruitRadius);
});
assert.equal(appleFruitCount, 0, 'fruit must not float without its SeedThree apple tree');
assert.equal(cherryFruitCount, 0, 'fruit must not float without its SeedThree cherry tree');
assert.equal(appleFruitRadius, 0);
assert.equal(cherryFruitRadius, 0);
disposeBackyardGardenMesh(appleDetail);
disposeBackyardGardenMesh(cherryDetail);

const seasonalFoliageTintColor = { value: new THREE.Color(0xffffff) };
const seasonalFoliageTintAmount = { value: 0 };
const collisionCatalog: BackyardPlantCatalog = {
  clone(kind, variant) {
    const tree = new THREE.LOD();
    tree.name = `Test ${kind} tree ${variant}`;
    if (kind === 'aronia' || kind === 'rosehip') {
      tree.userData.backyardFruitAnchors = [
        [0.2, 0.8, 0],
        [-0.18, 0.68, 0.12],
      ];
    }
    tree.userData.backyardSeasonalFoliageTintBindings = [{
      color: seasonalFoliageTintColor,
      amount: seasonalFoliageTintAmount,
    }];
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.4, 3.2),
      new THREE.MeshBasicMaterial(),
    );
    canopy.position.y = 2.5;
    const foliage = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.2, 0.35),
      new THREE.MeshBasicMaterial(),
      12,
    );
    foliage.name = 'foliage';
    for (let index = 0; index < foliage.count; index++) {
      foliage.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index * 0.01, 0, 0));
    }
    canopy.add(foliage);
    tree.addLevel(canopy, 0);
    return tree;
  },
  createFruitInstances(_kind, positions) {
    const fruit = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial(),
      positions.length,
    );
    positions.forEach((position, index) => {
      fruit.setMatrixAt(index, new THREE.Matrix4().makeTranslation(position.x, position.y, position.z));
    });
    return fruit;
  },
};
const collisionOrchard = createBackyardGardenMesh('apple_orchard', {
  width: 6.2,
  depth: 5.4,
  seed: 4271,
  plants: collisionCatalog,
});
const collisionTrees: THREE.Object3D[] = [];
const collisionProxies: THREE.Mesh[] = [];
const harvestBaskets: THREE.Object3D[] = [];
const orchardStones: THREE.Object3D[] = [];
const orchardFruit: THREE.Object3D[] = [];
const basketFruit: THREE.Object3D[] = [];
const orchardFoliage: THREE.InstancedMesh[] = [];
collisionOrchard.traverse((object) => {
  if (object.name.startsWith('AppleTree:')) collisionTrees.push(object);
  if (object.userData.fpCollisionProxy === true) collisionProxies.push(object as THREE.Mesh);
  if (object.name === 'Harvest basket') harvestBaskets.push(object);
  if (object.name === 'Orchard stepping stone') orchardStones.push(object);
  if (object.userData.backyardSeasonalRole === 'orchard-fruit') orchardFruit.push(object);
  if (object.userData.backyardSeasonalRole === 'basket-produce') basketFruit.push(object);
  if (object.userData.backyardDeciduousFoliage === true) {
    orchardFoliage.push(object as THREE.InstancedMesh);
  }
});
assert.equal(collisionTrees.length, 4);
assert.deepEqual(collisionOrchard.userData.orchardGrid, { columns: 2, rows: 2 });
assert.deepEqual(
  collisionTrees.map((tree) => [tree.position.x, tree.position.z]),
  [[-1.55, -1.35], [1.55, -1.35], [-1.55, 1.35], [1.55, 1.35]],
  'roomy orchard trees should evenly occupy a footprint-proportional 2 by 2 grid',
);
assert.equal(collisionProxies.length, collisionTrees.length);
for (const tree of collisionTrees) {
  assert.equal(tree.userData.fpCollisionAggregate, true, 'each orchard tree should publish one close trunk collider');
  const visual = tree.children.find((child) => child.name.startsWith('Test apple tree'));
  assert.equal(visual?.userData.fpNoCollision, true, 'tree crowns and branch meshes should not become colliders');
  const fruit = tree.children.find((child) => (child as THREE.InstancedMesh).isInstancedMesh);
  assert.equal(fruit?.userData.fpNoCollision, true, 'individual fruit should not enlarge tree collision');
}
for (const proxy of collisionProxies) {
  const parameters = proxy.geometry.parameters as { radiusTop?: number; height?: number };
  assert.ok(Number(parameters.radiusTop) <= 0.22, 'apple collision should stay close to the visible trunk');
  assert.ok(Number(parameters.height) <= 1.72, 'apple collision should stop below the spreading crown');
  assert.equal(proxy.material.visible, false, 'collision proxies should never render');
}
assert.equal(harvestBaskets.length, 1);
assert.ok(orchardFruit.length > 0);
assert.ok(basketFruit.length > 0);
assert.equal(orchardFoliage.length, collisionTrees.length);
assert.equal(harvestBaskets[0]!.userData.fpCollisionAggregate, true, 'the harvest basket should use one close aggregate collider');
assert.equal(orchardStones.length, 0, 'orchards should leave their grass paths free of stepping stones');
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 1);
assert.ok(orchardFruit.every((fruit) => !fruit.visible), 'dormant orchards should show no fruit on trees');
assert.ok(basketFruit.every((fruit) => !fruit.visible), 'dormant orchard baskets should be empty');
assert.ok(
  orchardFoliage.every((foliage) => !foliage.visible && foliage.count === 0),
  'apple orchards should retain their branches but drop every leaf in winter',
);
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 3);
assert.ok(
  orchardFoliage.every((foliage) => foliage.visible && foliage.count === 12),
  'spring leaf-out should restore the complete deterministic orchard canopy',
);
assert.equal(seasonalFoliageTintAmount.value, 0.72);
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 8);
assert.ok(orchardFruit.every((fruit) => fruit.visible), 'August fruit should be visibly ripening on trees');
assert.ok(basketFruit.every((fruit) => !fruit.visible), 'ripening fruit should not fill baskets before harvest');
assert.equal(seasonalFoliageTintAmount.value, 0, 'summer orchard leaves should use their mature authored color');
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 9);
assert.ok(orchardFruit.every((fruit) => fruit.visible));
assert.ok(basketFruit.every((fruit) => fruit.visible), 'September harvest should fill orchard baskets');
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 10);
assert.ok(orchardFruit.every((fruit) => !fruit.visible), 'post-harvest trees should be cleared of fruit');
assert.ok(basketFruit.every((fruit) => !fruit.visible), 'post-harvest baskets should be cleared');
assert.ok(seasonalFoliageTintAmount.value > 0.6, 'October apple foliage should receive the shared autumn progression');
assert.equal(seasonalFoliageTintColor.value.getHex(), 0xd1762b);
syncBackyardGardenSeasonVisuals(collisionOrchard, 'apple_orchard', 11, {
  springFlush: 0,
  autumnColor: 1,
  dormancy: 0.5,
});
assert.ok(
  orchardFoliage.every((foliage) => foliage.visible && foliage.count === 6),
  'autumn dormancy should deterministically thin half of the orchard leaves',
);
disposeBackyardGardenMesh(collisionOrchard);

const winterCherry = createBackyardGardenMesh('cherry_orchard', {
  width: 4.4,
  depth: 2.1,
  seed: 117,
  plants: collisionCatalog,
});
syncBackyardGardenSeasonVisuals(winterCherry, 'cherry_orchard', 12);
const winterCherryFoliage: THREE.InstancedMesh[] = [];
winterCherry.traverse((object) => {
  if (object.userData.backyardDeciduousFoliage === true) {
    winterCherryFoliage.push(object as THREE.InstancedMesh);
  }
});
assert.ok(
  winterCherryFoliage.length > 0
    && winterCherryFoliage.every((foliage) => !foliage.visible && foliage.count === 0),
  'cherry orchards should also be completely bare in winter',
);
disposeBackyardGardenMesh(winterCherry);

const establishingPear = createBackyardGardenMesh('pear_orchard', {
  width: 4.4,
  depth: 2.1,
  seed: 221,
  plants: collisionCatalog,
});
const pearAnchors: THREE.Object3D[] = [];
const pearFruit: THREE.Object3D[] = [];
establishingPear.traverse((object) => {
  if (object.userData.backyardMaturityAnchor === true) pearAnchors.push(object);
  if (object.userData.backyardSeasonalRole === 'orchard-fruit') pearFruit.push(object);
});
syncBackyardGardenSeasonVisuals(establishingPear, 'pear_orchard', 9, undefined, 150);
assert.ok(pearAnchors.every((anchor) => Math.abs(anchor.scale.x - 0.68 * 0.3) < 1e-9));
assert.ok(pearFruit.every((fruit) => !fruit.visible), 'new pear standards must not fruit before establishment');
syncBackyardGardenSeasonVisuals(establishingPear, 'pear_orchard', 9, undefined, 75);
assert.ok(pearAnchors.every((anchor) => Math.abs(anchor.scale.x - 0.68 * 0.65) < 1e-9));
syncBackyardGardenSeasonVisuals(establishingPear, 'pear_orchard', 9, undefined, 0);
assert.ok(pearAnchors.every((anchor) => Math.abs(anchor.scale.x - 0.68) < 1e-9));
assert.ok(pearFruit.every((fruit) => fruit.visible), 'mature pears should become visible in their harvest window');
disposeBackyardGardenMesh(establishingPear);

for (const [kind, signature] of [
  ['aronia_orchard', 'AroniaBush:'],
  ['rosehip_orchard', 'RosehipBush:'],
] as const) {
  const shrubOrchard = createBackyardGardenMesh(kind, {
    width: 6.2,
    depth: 5.4,
    seed: 811,
    plants: collisionCatalog,
  });
  const bushes: THREE.Object3D[] = [];
  const fruits: THREE.InstancedMesh[] = [];
  shrubOrchard.traverse((object) => {
    if (object.name.startsWith(signature)) bushes.push(object);
    if (object.userData.backyardSeasonalRole === 'orchard-fruit') {
      fruits.push(object as THREE.InstancedMesh);
    }
  });
  assert.equal(bushes.length, 8, `${kind} should use dense two-by-four cultivated bush rows`);
  assert.ok(fruits.length === bushes.length && fruits.every((fruit) => fruit.count === 2));
  syncBackyardGardenSeasonVisuals(shrubOrchard, kind, kind === 'aronia_orchard' ? 8 : 10);
  assert.ok(fruits.every((fruit) => fruit.visible), `${kind} fruit should follow its authored harvest window`);
  disposeBackyardGardenMesh(shrubOrchard);
}

const preparedOrchard = createBackyardGardenMesh('orchard', { width: 6.2, depth: 5.4, seed: 91 });
assert.equal(preparedOrchard.userData.orchardAwaitingSpecialization, true);
let preparedPitCount = 0;
let preparedPlantCount = 0;
preparedOrchard.traverse((object) => {
  if (object.name === 'Prepared orchard planting pit') preparedPitCount += 1;
  if (object.userData.backyardMaturityAnchor === true) preparedPlantCount += 1;
});
assert.equal(preparedPitCount, 4);
assert.equal(preparedPlantCount, 0, 'the constructed orchard shell must remain unplanted until selected');
disposeBackyardGardenMesh(preparedOrchard);

const flowerDetail = createBackyardGardenMesh('flower_garden', { width: 6.2, depth: 5.4, seed: 4271 });
let petalCount = 0;
let modeledFlowerMeshes = 0;
let texturedRoseCards = 0;
let texturedStemCount = 0;
let roundedPetalVertexCount = 0;
let largestCottageHeadDiameter = 0;
let largestStemDiameter = 0;
let modeledStemLeafCount = 0;
let swayingBloom: THREE.Object3D | null = null;
flowerDetail.traverse((object) => {
  petalCount += Number(object.userData.petalCount ?? 0);
  if (object.name === 'Modeled rose blossom' || object.name === 'Modeled cottage flower') {
    modeledFlowerMeshes += 1;
    roundedPetalVertexCount = Math.max(
      roundedPetalVertexCount,
      (object as THREE.Mesh).geometry.getAttribute('position').count,
    );
    if (object.name === 'Modeled cottage flower') {
      largestCottageHeadDiameter = Math.max(
        largestCottageHeadDiameter,
        Number(object.userData.realWorldDiameterM ?? 0),
      );
    }
  }
  if (object.name === 'Flower stem') {
    const mesh = object as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    texturedStemCount += 1;
    largestStemDiameter = Math.max(
      largestStemDiameter,
      Number(object.userData.maxDiameterM ?? 0),
    );
    assert.equal(mesh.material.name, 'Textured wildflower stem material');
    assert.ok(mesh.material.map, 'flower stems should carry fiber albedo detail');
    assert.ok(mesh.material.normalMap, 'flower stems should carry fine surface relief');
    assert.ok(mesh.material.roughnessMap, 'flower stems should carry roughness variation');
  }
  if (object.name === 'Flower stem leaf') {
    modeledStemLeafCount += 1;
    assert.ok(
      (object as THREE.Mesh).geometry.getAttribute('position').count >= 18,
      'stem leaves should use a curved lanceolate mesh instead of a faceted sphere',
    );
  }
  if (object.name === 'Textured rose blossom card') {
    texturedRoseCards += 1;
    assert.equal(
      object.userData.texturePath,
      '/assets/textures/vegetation/rose_blossom_card.png',
      'rose cards should reference the dedicated blossom texture',
    );
  }
  if (!swayingBloom && object.name.startsWith('Swaying rose bloom')) swayingBloom = object;
});
assert.ok(petalCount >= 100, 'flower gardens should use modeled petals instead of colored orb placeholders');
assert.ok(modeledFlowerMeshes <= 60, 'petals should be consolidated per blossom to protect draw-call cost');
assert.ok(roundedPetalVertexCount >= 150, 'flower heads should use rounded, cupped petal geometry');
assert.ok(
  largestCottageHeadDiameter > 0 && largestCottageHeadDiameter <= 0.065,
  'cottage flower heads should remain within a realistic 4–6.5 cm scale',
);
assert.ok(
  largestStemDiameter > 0 && largestStemDiameter <= 0.007,
  'cottage flower stems should remain no wider than 7 mm',
);
assert.ok(texturedStemCount >= 12, 'each cottage flower should carry a textured stem');
assert.ok(modeledStemLeafCount >= texturedStemCount * 2, 'each cottage flower should carry modeled leaves');
assert.ok(texturedRoseCards >= 24, 'each rose shrub should carry botanically readable textured blossoms');
assert.ok(swayingBloom, 'rose bushes should expose animated bloom anchors');
animateBackyardGardenMesh(flowerDetail, 0);
const firstBloomPosition = swayingBloom!.position.clone();
const firstBloomRotation = swayingBloom!.rotation.clone();
animateBackyardGardenMesh(flowerDetail, 1.25);
assert.ok(
  firstBloomPosition.distanceTo(swayingBloom!.position) > 1e-4
    || Math.abs(firstBloomRotation.z - swayingBloom!.rotation.z) > 1e-4,
  'rose blooms should sway with their bushes',
);
disposeBackyardGardenMesh(flowerDetail);

const luxuryFlowers = createBackyardGardenMesh('flower_garden', {
  width: 6.2,
  depth: 5.4,
  seed: 4271,
  flowerLuxuryUpgraded: true,
});
let bouquetTableCount = 0;
let arrangedBouquets = 0;
luxuryFlowers.traverse((object) => {
  if (object.userData.flowerLuxuryUpgrade === true) bouquetTableCount += 1;
  if (object.name.startsWith('Arranged luxury bouquet')) arrangedBouquets += 1;
});
assert.equal(bouquetTableCount, 1, 'the tier-4 flower upgrade should have a distinct preparation table');
assert.equal(arrangedBouquets, 3, 'the tier-4 flower upgrade should visibly prepare household bouquets');
disposeBackyardGardenMesh(luxuryFlowers);

for (const [kind, species] of Object.entries(BACKYARD_PLANT_SPECIES)) {
  if (kind === 'aronia' || kind === 'rosehip') {
    assert.ok(Number(species.params?.trunks) >= 6, `${kind} should use the multi-cane shrub grammar`);
    assert.ok(Number(species.params?.forkGenerations) >= 4, `${kind} should expose dichotomous fork generations`);
    assert.equal(species.foliageType, 'sprayClusters');
  } else {
    const scale = Number(species.params?.scale);
    const branches = species.params?.branches;
    assert.ok(Number.isFinite(scale) && scale > 0, `${kind} should have a finite cultivated-plant scale`);
    assert.ok(Array.isArray(branches) && branches.length === 4, `${kind} should define the complete SeedThree branch grammar`);
  }
}
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.apple.params?.scale) < Number(BACKYARD_PLANT_SPECIES.cherry.params?.scale),
  'the apple should remain lower and broader than the cherry',
);
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.rose.params?.scale) < 1.5,
  'rose shrubs should remain below windowsill scale',
);
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.pear.params?.scale) > Number(BACKYARD_PLANT_SPECIES.apple.params?.scale),
  'pear standards should keep their distinct upright, taller orchard habit',
);

const backyardAssetSource = readFileSync(
  join(process.cwd(), 'src/vegetation/seedthree/backyardPlantAssets.ts'),
  'utf8',
);
const backyardGardenSource = readFileSync(
  join(process.cwd(), 'src/residences/backyardGardenMesh.ts'),
  'utf8',
);
const backyardMarkerSource = readFileSync(
  join(process.cwd(), 'src/residences/BackyardGardenMarkers.ts'),
  'utf8',
);
const appSource = readFileSync(join(process.cwd(), 'src/app/App.ts'), 'utf8');
const backyardChickenSource = readFileSync(
  join(process.cwd(), 'src/residences/backyardChickenAssets.ts'),
  'utf8',
);
const backyardLineupSource = readFileSync(
  join(process.cwd(), 'src/e2e/backyardLineup.ts'),
  'utf8',
);
assert.match(
  backyardGardenSource,
  /rose_blossom_card\.png/,
  'rose rendering should retain its dedicated blossom texture',
);
assert.doesNotMatch(
  backyardGardenSource,
  /MATERIALS\.terracotta,\s*-width \* 0\.4,\s*0\.22,\s*-depth \* 0\.38/,
  'herb gardens should not restore the stray orange terracotta pot',
);
for (const textureName of ['cabbage_leaf.png', 'carrot_frond.png', 'turnip_leaf.png']) {
  assert.match(
    backyardGardenSource,
    new RegExp(textureName.replace('.', '\\.')),
    `vegetable rendering should reference ${textureName}`,
  );
}
for (const texturePath of [
  'public/assets/textures/vegetation/kitchen_herbs/parsley_clump.png',
  'public/assets/textures/vegetation/kitchen_herbs/rosemary_clump.png',
  'public/assets/textures/vegetation/kitchen_herbs/sage_clump.png',
]) {
  assert.ok(existsSync(join(process.cwd(), texturePath)), `${texturePath} should be packaged`);
  assert.match(
    backyardGardenSource,
    new RegExp(texturePath.split('/').at(-1)!.replace('.', '\\.')),
    `${texturePath} should be referenced by the backyard renderer`,
  );
}
assert.doesNotMatch(
  backyardGardenSource,
  /bean_vine\.png|BeanTrellis|addBeanTrellis|Textured climbing bean vine/,
  'removed vegetable trellis assets should not remain in the renderer',
);
for (const texturePath of [
  'public/assets/textures/terrain/mammoth_terrain_dirt/albedo.png',
  'public/assets/textures/terrain/mammoth_terrain_dirt/normal.png',
  'public/assets/textures/terrain/mammoth_terrain_dirt/roughness.png',
]) {
  assert.ok(existsSync(join(process.cwd(), texturePath)), `${texturePath} should be packaged`);
}
assert.doesNotMatch(
  backyardGardenSource,
  /addFallbackTree|CylinderGeometry\(0\.14, 0\.24|IcosahedronGeometry\(0\.74/,
  'orchards must never substitute low-poly trunks or canopy lobes for SeedThree trees',
);
assert.doesNotMatch(
  backyardGardenSource,
  /addLowWattleFence|Backyard wattle fence/,
  'orchard detail meshes must leave fencing to the parcel perimeter renderer',
);
assert.match(
  backyardGardenSource,
  /if \(!plants\) return;[\s\S]*?const tree = plants\.clone\(plantKind, variant\);[\s\S]*?anchor\.add\(tree\)/,
  'orchard tree vegetation must remain hidden until its SeedThree catalog is available',
);
assert.match(
  backyardAssetSource,
  /normalizeBackyardPlantFoliageWind\(group\)/,
  'cultivated SeedThree prototypes must normalize r185 foliage wind before cloning',
);
assert.match(
  backyardAssetSource,
  /backyardSeasonalFoliageTintBindings/,
  'apple, cherry, and pear clones should retain live SeedThree foliage tint uniforms',
);
assert.match(
  backyardMarkerSource,
  /setDeciduousFoliage\(presentation: DeciduousFoliagePresentation\)/,
  'backyard markers should accept the same deciduous presentation state as the forest',
);
assert.match(
  appSource,
  /backyardGardenMarkers\?\.setDeciduousFoliage\(presentationEnvironment\.deciduousFoliage\)/,
  'live and visual-QA environment changes should reach orchard foliage',
);
for (const fruitFile of [
  'apple.glb',
  'cherry_pair.glb',
  'pear.glb',
  'aronia_cluster.glb',
  'rosehip_cluster.glb',
]) {
  assert.ok(
    existsSync(join(process.cwd(), 'vendor/seedthree/assets/fruits', fruitFile)),
    `${fruitFile} orchard asset should be packaged in the SeloSlav SeedThree fork`,
  );
  assert.match(
    backyardAssetSource,
    new RegExp(fruitFile.replace('.', '\\.')),
    `the orchard catalog should load ${fruitFile}`,
  );
}
for (const textureFile of [
  'pear_single_albedo.png',
  'pear_single_normal.png',
  'pear_single_roughness.png',
  'pear_single_translucency.png',
  'aronia_spray_albedo.png',
  'aronia_spray_normal.png',
  'aronia_spray_roughness.png',
  'aronia_spray_translucency.png',
  'rosehip_spray_albedo.png',
  'rosehip_spray_normal.png',
  'rosehip_spray_roughness.png',
  'rosehip_spray_translucency.png',
]) {
  assert.ok(
    existsSync(join(process.cwd(), 'vendor/seedthree/assets/leaves', textureFile)),
    `${textureFile} should be present in the SeloSlav SeedThree fork`,
  );
}
assert.match(backyardAssetSource, /createGorskiShrubPrototype\(kind, variant\)/);
assert.match(backyardAssetSource, /backyardFruitAnchors/);
assert.match(
  backyardGardenSource,
  /plants\.createFruitInstances\(plantKind, positions, variant\)/,
  'orchard trees should instance SkyeShark fruit GLBs at their authored clusters',
);
const fruitClusterSource = backyardGardenSource.slice(
  backyardGardenSource.indexOf('function addFruitClusters'),
  backyardGardenSource.indexOf('function addFruitTree'),
);
assert.doesNotMatch(
  fruitClusterSource,
  /IcosahedronGeometry|SphereGeometry/,
  'fruit attached to orchard trees must not regress to primitive geometry',
);
assert.match(
  backyardAssetSource,
  /WIND_DIR\.x \* weight[\s\S]*WIND_DIR\.z \* weight/,
  'backyard foliage wind must be stored in plant/object space without inverse leaf-scale amplification',
);
assert.match(
  backyardChickenSource,
  /quaternius-chicken\.glb/,
  'backyard hens should retain the CC0 Quaternius animated model source',
);
assert.match(
  backyardLineupSource,
  /loadBackyardChickenSource\(\)[\s\S]*?removeBackyardChickenFallbacks\(garden\)/,
  'the backyard lineup should replace procedural birds with the same model source as gameplay',
);

console.log('Backyard garden visual system passed.');
