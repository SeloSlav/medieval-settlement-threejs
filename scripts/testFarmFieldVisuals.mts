import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { timberMaterial } from '../src/buildings/buildingMaterials.ts';
import {
  FarmFieldMarkers,
  FarmFieldPreview,
  LandParcelOriginFootprintPreview,
} from '../src/farming/FarmFieldMarkers.ts';
import type { FarmFieldState, GraveyardState } from '../src/resources/types.ts';
import { BurialMarkers } from '../src/residences/BurialMarkers.ts';
import { BURGAGE_WOOD_FENCE_STYLE } from '../src/residences/BurgageFencing.ts';
import {
  collectGraveSiteVegetationClearancePolygons,
  GRAVE_SITE_VEGETATION_CLEARANCE_RADIUS,
  visibleGraveSitePlacements,
} from '../src/residences/graveyardLayout.ts';
import {
  hashParcelSeed,
  organicParcelBoundaryPoints,
  organicParcelEdgePoints,
  samplePolylineAtFraction,
} from '../src/farming/organicParcelGeometry.ts';
import {
  createFieldPerimeterShrubPlacements,
  FIELD_PERIMETER_SHRUB_INSET_METERS,
} from '../src/farming/FarmFieldPerimeterShrubs.ts';
import {
  distancePointToSegment2,
  isPointInPolygon2,
} from '../src/utils/polygonGeometry.ts';
import { createGorskiShrubPrototype } from '../src/vegetation/seedthree/gorskiShrubPrototypes.ts';

const organicSeed = hashParcelSeed('shared-parcel-visual-test');
const organicEdge = organicParcelEdgePoints(
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { seed: organicSeed, spacing: 2.5, amplitude: 0.35, inwardTarget: { x: 10, z: 10 } },
);
assert.deepEqual(organicEdge[0], { x: 0, z: 0 });
assert.deepEqual(organicEdge[organicEdge.length - 1], { x: 20, z: 0 });
assert.ok(
  organicEdge.slice(1, -1).some((point) => point.z > 0.05),
  'hand-laid edges should vary inward without moving authoritative corners',
);
assert.deepEqual(
  organicEdge,
  organicParcelEdgePoints(
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { seed: organicSeed, spacing: 2.5, amplitude: 0.35, inwardTarget: { x: 10, z: 10 } },
  ),
  'organic parcel detail must be deterministic across reconnects',
);
const organicBoundary = organicParcelBoundaryPoints([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
  { x: 0, z: 20 },
], organicSeed);
const boundaryMidpoint = samplePolylineAtFraction(organicBoundary, 0.5);
assert.ok(Number.isFinite(boundaryMidpoint.x) && Number.isFinite(boundaryMidpoint.z));

const field: FarmFieldState = {
  id: 'visual-test-field',
  farmsteadId: 'visual-test-farmstead',
  corners: [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
    { x: 0, z: 20 },
  ],
  area: 400,
  averageSlopeDegrees: 2,
  moisture: 0.42,
  fertility: 0.9,
  crop: 'rye',
  nextCrop: 'fallow',
  stage: 'growing',
  stageProgress: 0.76,
  priority: 2,
  harvestCount: 0,
  lastYield: 0,
  currentYield: 0,
};

const visualRoot = new THREE.Group();
const hornbeamPrototype = createGorskiShrubPrototype('field-hornbeam', 0);
assert.equal(hornbeamPrototype.fruitAnchors.length, 0, 'the agricultural hornbeam hedge must not create berry or fruit anchors');
assert.equal(hornbeamPrototype.geometry.userData.gorskiShrubKind, 'field-hornbeam');
hornbeamPrototype.geometry.dispose();
const hedgePlacements = createFieldPerimeterShrubPlacements([field]);
assert.ok(hedgePlacements.length >= 24, 'a placed field needs a legible hornbeam hedge around its perimeter');
assert.deepEqual(
  hedgePlacements,
  createFieldPerimeterShrubPlacements([field]),
  'field hedge placement must be deterministic across reconnects',
);
for (const placement of hedgePlacements) {
  assert.ok(
    isPointInPolygon2(placement, field.corners),
    'hornbeam hedge roots must stay inside the grass/wildflower exclusion polygon',
  );
  const boundaryDistance = Math.min(...field.corners.map((start, index) => (
    distancePointToSegment2(placement, start, field.corners[(index + 1) % field.corners.length]!)
  )));
  assert.ok(
    boundaryDistance >= FIELD_PERIMETER_SHRUB_INSET_METERS[0] * 0.7
      && boundaryDistance <= FIELD_PERIMETER_SHRUB_INSET_METERS[1] + 0.28,
    `hornbeam roots should occupy the narrow band before meadow groundcover (got ${boundaryDistance.toFixed(2)} m)`,
  );
}
const fieldMarkers = new FarmFieldMarkers(visualRoot, () => 0);
fieldMarkers.syncFields([field]);
const standingCereal = visualRoot.getObjectByName('Standing cereal stalks');
const matureHeads = visualRoot.getObjectByName('Pale awned grain heads');
const matureSoil = visualRoot.getObjectByName('Worked field soil') as THREE.Mesh;
assert.ok(standingCereal instanceof THREE.InstancedMesh);
assert.ok(matureHeads instanceof THREE.InstancedMesh);
assert.ok(standingCereal.count >= field.area, 'a mature field should read as a dense crop stand');
assert.equal(matureHeads.count, standingCereal.count, 'every mature cereal tuft needs a readable grain head');
assert.ok(matureSoil.geometry.getAttribute('color'), 'worked earth should carry non-flat surface variation');

fieldMarkers.syncFields([{
  ...field,
  stage: 'harvesting',
  stageProgress: 0.56,
}]);
const harvestedStanding = visualRoot.getObjectByName('Standing cereal stalks');
const harvestedStubble = visualRoot.getObjectByName('Cut cereal stubble');
assert.ok(harvestedStanding instanceof THREE.InstancedMesh);
assert.ok(harvestedStubble instanceof THREE.InstancedMesh);
assert.ok(harvestedStanding.count < standingCereal.count, 'harvest progress should clear a visible part of the standing crop');
assert.ok(harvestedStubble.count > 0, 'harvested ground should retain cut stubble');
assert.ok(
  visualRoot.getObjectByName('Irregular soil clods') instanceof THREE.InstancedMesh,
  'exposed worked ground should not remain a featureless flat plane',
);

fieldMarkers.syncFields([{
  ...field,
  crop: 'fallow',
  stage: 'growing',
  stageProgress: 0.8,
}]);
assert.equal(visualRoot.getObjectByName('Pale awned grain heads'), undefined);
assert.ok(
  visualRoot.getObjectByName('Fallow grasses and volunteer plants') instanceof THREE.InstancedMesh,
  'fallow land should remain visibly different from a cereal crop',
);

for (const [crop, signature] of [
  ['oats', 'Oat drooping panicles'],
  ['barley', 'Barley long-awn heads'],
  ['flax', 'Flax blue blossoms'],
  ['wheat', 'Wheat–rye maslin heads'],
] as const) {
  fieldMarkers.syncFields([{
    ...field,
    crop,
    stage: 'growing',
    stageProgress: 0.9,
  }]);
  assert.ok(
    visualRoot.getObjectByName(signature) instanceof THREE.InstancedMesh,
    `${crop} should have a crop-specific modeled silhouette`,
  );
}

fieldMarkers.syncFields([{
  ...field,
  stage: 'ploughing',
  stageProgress: 0,
}]);
const unploughedSoil = visualRoot.getObjectByName('Worked field soil') as THREE.Mesh;
assert.equal(
  unploughedSoil.geometry.getIndex()?.count ?? 0,
  0,
  'zero plough progress should leave the original terrain visible',
);
fieldMarkers.syncFields([{
  ...field,
  stage: 'ploughing',
  stageProgress: 1,
}]);
const ploughedSoil = visualRoot.getObjectByName('Worked field soil') as THREE.Mesh;
assert.ok((ploughedSoil.geometry.getIndex()?.count ?? 0) > 0);
assert.deepEqual(
  (ploughedSoil.material as THREE.Material).userData.pbrTexturePaths,
  {
    albedo: '/assets/textures/terrain/mammoth_terrain_dirt/albedo.png',
    normal: '/assets/textures/terrain/mammoth_terrain_dirt/normal.png',
    roughness: '/assets/textures/terrain/mammoth_terrain_dirt/roughness.png',
  },
  'farm fields should reuse the backyard garden-soil PBR identity',
);
fieldMarkers.syncFields([{
  ...field,
  stage: 'sowing',
  stageProgress: 0.85,
}]);
const seededRows = visualRoot.getObjectByName('Seeded drill rows') as THREE.LineSegments;
assert.ok(
  seededRows.geometry.getAttribute('position').count > 0,
  'seeded progress should be visible in terrain-following drill rows',
);
fieldMarkers.dispose();

const { FIELD_CROP_SPECIES, fieldMaslin } = await import(
  '../vendor/seedthree/src/species/field-crops.js'
);
const { createFieldCropGeometry, fieldCropComponents } = await import(
  '../vendor/seedthree/src/core/field-crops.js'
);
assert.equal(FIELD_CROP_SPECIES.wheat, undefined, 'wheat must not exist as a standalone game crop');
assert.equal(FIELD_CROP_SPECIES.maslin, fieldMaslin);
const maslinComponents = fieldCropComponents(fieldMaslin);
assert.deepEqual(
  maslinComponents.map((component) => [component.preset.key, component.share]),
  [['maslin-wheat-component', 0.62], ['rye', 0.38]],
  'maslin should remain a deterministic wheat–rye mixture',
);
for (const [gameCrop, presetKey] of [
  ['rye', 'rye'],
  ['oats', 'oats'],
  ['barley', 'barley'],
  ['flax', 'flax'],
  ['wheat', 'maslin'],
] as const) {
  const preset = FIELD_CROP_SPECIES[presetKey];
  assert.ok(preset, `${gameCrop} needs a SeedThree field-crop preset`);
  for (const component of fieldCropComponents(preset)) {
    const geometry = createFieldCropGeometry(component.preset, 1);
    assert.ok(geometry.getAttribute('uv'), `${component.preset.name} cards need authored UVs`);
    assert.ok(geometry.getAttribute('position').count >= 8);
    geometry.dispose();
  }
}
for (const textureStem of [
  'field_cereal_young',
  'field_flax_young',
  'field_rye',
  'field_oats',
  'field_barley',
  'field_flax',
  'maslin_wheat_component',
]) {
  for (const suffix of ['albedo', 'normal', 'roughness', 'translucency']) {
    assert.ok(
      existsSync(join(process.cwd(), 'vendor/seedthree/assets/crops', `${textureStem}_${suffix}.png`)),
      `${textureStem} should ship a complete SeedThree PBR/translucency set`,
    );
  }
}
const farmMarkerSource = readFileSync(
  join(process.cwd(), 'src/farming/FarmFieldMarkers.ts'),
  'utf8',
);
const bootstrapSource = readFileSync(join(process.cwd(), 'src/app/appBootstrap.ts'), 'utf8');
assert.match(farmMarkerSource, /cultivatedSoilBase = 'backyard-garden'/);
assert.match(farmMarkerSource, /crop stands will remain hidden rather than using proxy species/);
assert.match(bootstrapSource, /useSeedThreeCrops:\s*true/);

const preview = new FarmFieldPreview(() => 0);
visualRoot.add(preview.group);
preview.show(null, false, 'rye', [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
]);
const openBoundary = preview.group.getObjectByName('Farmland dotted border') as THREE.Mesh;
const previewFill = preview.group.getObjectByName('Farmland preview fill') as THREE.Mesh;
assert.ok(preview.group.visible);
assert.ok(openBoundary.geometry.getAttribute('position').count > 0);
assert.equal(previewFill.visible, false, 'an open three-corner boundary must not imply committed area');
preview.show([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
  { x: 2, z: 12 },
], true, 'rye');
assert.equal(previewFill.visible, true);
assert.ok(previewFill.geometry.getAttribute('position').count > 0);
const previewGuides = preview.group.getObjectByName('Farmland internal guides') as THREE.Mesh;
preview.show([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
  { x: 2, z: 12 },
], true, 'fallow', [], 'pasture');
assert.equal(previewGuides.visible, false, 'pasture placement should preview an enclosure, not crop rows');
preview.show([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
  { x: 2, z: 12 },
], true, 'fallow', [], 'vineyard');
assert.equal(previewGuides.visible, true, 'vineyard placement should preview the growing-row direction');
preview.dispose();

const chapelFootprint = new LandParcelOriginFootprintPreview((x, z) => x * 0.01 + z * 0.02);
visualRoot.add(chapelFootprint.group);
chapelFootprint.show([
  { x: 4, z: 5 },
  { x: 12, z: 5 },
  { x: 12, z: 13 },
  { x: 4, z: 13 },
]);
const chapelFootprintFill = chapelFootprint.group
  .getObjectByName('Linked chapel blocked footprint fill') as THREE.Mesh;
const chapelFootprintBorder = chapelFootprint.group
  .getObjectByName('Linked chapel blocked footprint border') as THREE.Mesh;
assert.equal(chapelFootprint.group.visible, true);
assert.ok(chapelFootprintFill.geometry.getAttribute('position').count > 0);
assert.ok(chapelFootprintBorder.geometry.getAttribute('position').count > 0);
for (const mesh of [chapelFootprintFill, chapelFootprintBorder]) {
  const material = mesh.material as THREE.MeshBasicMaterial;
  assert.equal(material.color.getHex(), 0xff3e35, 'the church exclusion footprint must stay red');
  assert.equal(material.transparent, true);
  assert.ok(material.opacity > 0 && material.opacity < 1, 'the church footprint must remain translucent');
}
chapelFootprint.show(null);
assert.equal(chapelFootprint.group.visible, false, 'the warning must hide outside linked placement');
chapelFootprint.dispose();

const burialRoot = new THREE.Group();
const burialMarkers = new BurialMarkers(burialRoot);
const graveyard: GraveyardState = {
  id: 'graveyard-visual-test',
  chapelId: 'chapel-visual-test',
  corners: [
    { x: 0, z: 0 },
    { x: 14, z: 0 },
    { x: 14, z: 9 },
    { x: 0, z: 9 },
  ],
  area: 126,
  averageSlopeDegrees: 2,
  capacity: 24,
  burials: 0,
};
burialMarkers.sync([graveyard], [], () => 0);
const graveyardMarker = burialRoot.getObjectByName(`Graveyard ${graveyard.id}`) as THREE.Group;
assert.ok(graveyardMarker);
assert.equal(
  graveyardMarker.children.some((child) => child instanceof THREE.Mesh && !child.isInstancedMesh),
  false,
  'an empty graveyard should preserve the native terrain instead of covering it with a dirt sheet',
);
assert.ok(
  graveyardMarker.getObjectByName('Graveyard boundary posts') instanceof THREE.InstancedMesh,
  'removing the ground sheet must retain the authored graveyard boundary',
);
const graveyardFence = graveyardMarker.getObjectByName('Graveyard wooden fencing') as THREE.Group;
const graveyardFencePosts = graveyardFence.getObjectByName(
  'Graveyard boundary posts',
) as THREE.InstancedMesh;
const graveyardFenceRails = graveyardFence.getObjectByName(
  'Graveyard boundary rails',
) as THREE.InstancedMesh;
assert.equal(graveyardFence.userData.openingCount, 4, 'each graveyard side needs an entrance gap');
assert.equal(graveyardFence.userData.hasLintels, false, 'graveyard entrances must remain unframed');
assert.equal(graveyardFence.children.length, 2, 'graveyard fencing should contain posts and rails only');
assert.equal(graveyardFencePosts.material, timberMaterial('mid'));
assert.equal(graveyardFenceRails.material, timberMaterial('mid'));
assert.ok(graveyardFenceRails.count > 0, 'graveyard boundaries must include residence-style timber rails');

const postPosition = new THREE.Vector3();
const postMatrix = new THREE.Matrix4();
const graveyardPostPositions = Array.from({ length: graveyardFencePosts.count }, (_, index) => {
  graveyardFencePosts.getMatrixAt(index, postMatrix);
  return postPosition.setFromMatrixPosition(postMatrix).clone();
});
const openingHalfWidth = BURGAGE_WOOD_FENCE_STYLE.openingWidth * 0.5;
for (const opening of [
  { center: new THREE.Vector2(7, 0), tangent: new THREE.Vector2(1, 0) },
  { center: new THREE.Vector2(14, 4.5), tangent: new THREE.Vector2(0, 1) },
  { center: new THREE.Vector2(7, 9), tangent: new THREE.Vector2(1, 0) },
  { center: new THREE.Vector2(0, 4.5), tangent: new THREE.Vector2(0, 1) },
]) {
  const edgePosts = graveyardPostPositions.filter((point) => {
    const dx = point.x - opening.center.x;
    const dz = point.z - opening.center.y;
    return Math.abs(dx * -opening.tangent.y + dz * opening.tangent.x) < 1e-5;
  });
  const along = edgePosts.map((point) => (
    (point.x - opening.center.x) * opening.tangent.x
      + (point.z - opening.center.y) * opening.tangent.y
  ));
  assert.ok(
    along.some((distance) => Math.abs(distance + openingHalfWidth) < 1e-5)
      && along.some((distance) => Math.abs(distance - openingHalfWidth) < 1e-5),
    'every edge must terminate cleanly at both sides of its centered entrance',
  );
  assert.ok(
    along.every((distance) => Math.abs(distance) >= openingHalfWidth - 1e-5),
    'fence posts must not intrude into any graveyard entrance',
  );
}
const railPosition = new THREE.Vector3();
let highestRailCenter = -Infinity;
for (let index = 0; index < graveyardFenceRails.count; index += 1) {
  graveyardFenceRails.getMatrixAt(index, postMatrix);
  railPosition.setFromMatrixPosition(postMatrix);
  highestRailCenter = Math.max(highestRailCenter, railPosition.y);
}
assert.ok(
  highestRailCenter < BURGAGE_WOOD_FENCE_STYLE.postHeight,
  'no high rail or lintel should bridge a graveyard entrance',
);
const occupiedGraveyard = { ...graveyard, burials: 3 };
const graveSites = visibleGraveSitePlacements(occupiedGraveyard);
const graveSiteClearance = collectGraveSiteVegetationClearancePolygons([occupiedGraveyard]);
assert.equal(graveSites.length, 3);
assert.equal(
  graveSiteClearance.length,
  graveSites.length,
  'only occupied, visibly marked graves should clear grass and wildflowers',
);
for (let index = 0; index < graveSites.length; index += 1) {
  const site = graveSites[index]!;
  const polygon = graveSiteClearance[index]!;
  assert.ok(isPointInPolygon2(site, polygon), 'each clearing must be centered on its grave mound/cross');
  assert.ok(
    polygon.every((point) => (
      Math.abs(Math.hypot(point.x - site.x, point.z - site.z)
        - GRAVE_SITE_VEGETATION_CLEARANCE_RADIUS) < 1e-9
    )),
    'grave vegetation clearing must keep the authored radial extent',
  );
}
assert.equal(
  collectGraveSiteVegetationClearancePolygons([{ ...graveyard, burials: 0 }]).length,
  0,
  'unused graveyard capacity must retain its natural meadow cover',
);
burialMarkers.sync([occupiedGraveyard], [], () => 0);
const occupiedMounds = burialRoot.getObjectByName('Instanced grave mounds') as THREE.InstancedMesh;
assert.equal(occupiedMounds.count, graveSites.length);
burialMarkers.dispose();

console.log('farm-field visual tests passed');
