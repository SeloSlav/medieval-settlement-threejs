import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from '../src/residences/backyardGardenMesh.ts';
import type { BackyardGardenKind } from '../src/generated/gameBalance.ts';
import { BACKYARD_PLANT_SPECIES } from '../src/vegetation/seedthree/backyardPlantPresets.ts';

const kinds: BackyardGardenKind[] = [
  'apple_orchard',
  'cherry_orchard',
  'vegetable_garden',
  'flower_garden',
  'herb_garden',
  'hen_yard',
];

const signatures: Record<BackyardGardenKind, string> = {
  apple_orchard: 'AppleTree:',
  cherry_orchard: 'CherryTree:',
  vegetable_garden: 'BeanTrellis',
  flower_garden: 'RoseBush:',
  herb_garden: 'HerbDryingRack',
  hen_yard: 'HenCoopDoor',
};

const terrainBackedKinds = new Set<BackyardGardenKind>([
  'apple_orchard',
  'cherry_orchard',
  'flower_garden',
  'hen_yard',
]);

for (const kind of kinds) {
  const width = 6.2;
  const depth = 5.4;
  const garden = createBackyardGardenMesh(kind, { width, depth, seed: 4271 });
  garden.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(garden);
  const size = bounds.getSize(new THREE.Vector3());
  const names: string[] = [];
  let meshCount = 0;
  garden.traverse((object) => {
    if (object.name) names.push(object.name);
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });

  assert.equal(garden.userData.gardenKind, kind, `${kind} should retain its gameplay identity`);
  assert.equal(garden.userData.usesSeedThree, false, `${kind} should report that SeedThree is not yet attached`);
  assert.ok(meshCount >= 12, `${kind} should be a composed scene, not a placeholder prop`);
  assert.ok(names.some((name) => name.startsWith(signatures[kind])), `${kind} should expose its signature feature`);
  assert.ok(size.x <= 7.5, `${kind} should stay inside a 6.2m parcel with modest foliage overhang`);
  assert.ok(size.z <= 7.5, `${kind} should stay inside a 5.4m backyard with modest foliage overhang`);
  assert.ok(size.y > 0.4, `${kind} should have readable vertical structure`);

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
let shallowTrees = 0;
shallow.traverse((object) => {
  if (object.name.startsWith('AppleTree:')) shallowTrees += 1;
});
assert.equal(shallowTrees, 2, 'shallow plots should reduce orchard count instead of flattening trees');
disposeBackyardGardenMesh(shallow);

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

for (const [kind, species] of Object.entries(BACKYARD_PLANT_SPECIES)) {
  const scale = Number(species.params?.scale);
  const branches = species.params?.branches;
  assert.ok(Number.isFinite(scale) && scale > 0, `${kind} should have a finite cultivated-plant scale`);
  assert.ok(Array.isArray(branches) && branches.length === 4, `${kind} should define the complete SeedThree branch grammar`);
}
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.apple.params?.scale) < Number(BACKYARD_PLANT_SPECIES.cherry.params?.scale),
  'the apple should remain lower and broader than the cherry',
);
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.rose.params?.scale) < 1.5,
  'rose shrubs should remain below windowsill scale',
);

const backyardAssetSource = readFileSync(
  join(process.cwd(), 'src/vegetation/seedthree/backyardPlantAssets.ts'),
  'utf8',
);
const backyardGardenSource = readFileSync(
  join(process.cwd(), 'src/residences/backyardGardenMesh.ts'),
  'utf8',
);
assert.match(
  backyardGardenSource,
  /rose_blossom_card\.png/,
  'rose rendering should retain its dedicated blossom texture',
);
assert.doesNotMatch(
  backyardGardenSource,
  /addFallbackTree|CylinderGeometry\(0\.14, 0\.24|IcosahedronGeometry\(0\.74/,
  'orchards must never substitute low-poly trunks or canopy lobes for SeedThree trees',
);
assert.match(
  backyardGardenSource,
  /if \(!plants\) return;[\s\S]*?anchor\.add\(plants\.clone\(plantKind, variant\)\)/,
  'orchard tree vegetation must remain hidden until its SeedThree catalog is available',
);
assert.match(
  backyardAssetSource,
  /normalizeBackyardPlantFoliageWind\(group\)/,
  'cultivated SeedThree prototypes must normalize r185 foliage wind before cloning',
);
assert.match(
  backyardAssetSource,
  /WIND_DIR\.x \* weight[\s\S]*WIND_DIR\.z \* weight/,
  'backyard foliage wind must be stored in plant/object space without inverse leaf-scale amplification',
);

console.log('Backyard garden visual system passed.');
