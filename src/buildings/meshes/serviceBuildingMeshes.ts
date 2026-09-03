import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { getSharedWellWaterMaterial } from '../WellWaterMaterial.ts';
import { createFishingBoatMesh } from './fishingBoatMesh.ts';
import { addCampAFrameShelter, createCampfireEffects } from './foundersCampMesh.ts';
import { CAMP_HIDE_METERS_PER_REPEAT } from '../campHideSurface.ts';
import { createDrapedCanopyGeometry } from './drapedCanopyGeometry.ts';
import {
  addBarrel,
  addGableShell,
  addHippedRoof,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';

const WELL_DIMENSIONS = {
  wallHeight: 0.95,
  wallCenterY: 0.69,
  wallOuterTopRadius: 1.18,
  wallOuterBottomRadius: 1.28,
  wallInnerTopRadius: 0.98,
  wallInnerBottomRadius: 1.08,
  wallSegments: 14,
  postX: 1.42,
  postBaseY: 0.145,
  windlassY: 2.23,
  roofRadius: 2.52,
  roofHeight: 1.78,
  roofCenterY: 3.72,
  tieBeamY: 3.0,
  tieBeamThickness: 0.16,
} as const;

/** CylinderGeometry faces outward; reverse it for the well's separate inner masonry skin. */
function createInwardFacingCylinderGeometry(
  topRadius: number,
  bottomRadius: number,
  height: number,
  radialSegments: number,
): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    radialSegments,
    1,
    true,
  );
  const index = geometry.getIndex();
  if (!index) throw new Error('The well interior cylinder must be indexed.');
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const second = index.getX(triangle + 1);
    index.setX(triangle + 1, index.getX(triangle + 2));
    index.setX(triangle + 2, second);
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Closes the annular seam between the inner and outer skins. The overlap is
 * intentional: the polygonal torus and cylinders use different tessellation,
 * so edge-to-edge contact can still reveal bright exterior wedges obliquely.
 */
function createWellCrownSealGeometry(
  innerRadius: number,
  outerRadius: number,
  radialSegments: number,
): THREE.RingGeometry {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, radialSegments);
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
}

function createHorizontalCircleGeometry(
  radius: number,
  radialSegments: number,
): THREE.CircleGeometry {
  const geometry = new THREE.CircleGeometry(radius, radialSegments);
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
}

/** Limestone village well beneath a steep, weatherproof shingle cap. */
export function createWellMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Well';

  const dimensions = WELL_DIMENSIONS;
  const roofBaseY = dimensions.roofCenterY - dimensions.roofHeight * 0.5;
  const roofHalfSpan = dimensions.roofRadius / Math.sqrt(2);
  const roofUndersideAtPost = roofBaseY + dimensions.roofHeight
    * (1 - dimensions.postX / roofHalfSpan);
  const tieBeamTop = dimensions.tieBeamY + dimensions.tieBeamThickness * 0.5;
  const postTopY = Math.min(tieBeamTop, roofUndersideAtPost - 0.08);
  const postHeight = postTopY - dimensions.postBaseY;

  addMesh(
    group,
    new THREE.CylinderGeometry(2.0, 2.12, 0.22, 12),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, 0.11, 0),
  );
  const outerWall = addMesh(
    group,
    new THREE.CylinderGeometry(
      dimensions.wallOuterTopRadius,
      dimensions.wallOuterBottomRadius,
      dimensions.wallHeight,
      dimensions.wallSegments,
      1,
      true,
    ),
    stoneMaterial('mid'),
    new THREE.Vector3(0, dimensions.wallCenterY, 0),
  );
  outerWall.name = 'Well outer masonry wall';
  const innerWall = addMesh(
    group,
    createInwardFacingCylinderGeometry(
      dimensions.wallInnerTopRadius,
      dimensions.wallInnerBottomRadius,
      dimensions.wallHeight,
      dimensions.wallSegments,
    ),
    stoneMaterial('mid'),
    new THREE.Vector3(0, dimensions.wallCenterY, 0),
  );
  innerWall.name = 'Well inner masonry wall';
  const crownSeal = addMesh(
    group,
    createWellCrownSealGeometry(
      dimensions.wallInnerTopRadius - 0.05,
      dimensions.wallOuterTopRadius + 0.05,
      dimensions.wallSegments * 2,
    ),
    stoneMaterial('mid'),
    new THREE.Vector3(
      0,
      dimensions.wallCenterY + dimensions.wallHeight * 0.5 - 0.003,
      0,
    ),
  );
  crownSeal.name = 'Well masonry crown seal';
  const water = addMesh(
    group,
    createHorizontalCircleGeometry(0.94, 48),
    getSharedWellWaterMaterial(),
    new THREE.Vector3(0, 0.885, 0),
  );
  water.name = 'Well water surface';
  water.receiveShadow = false;
  water.renderOrder = 1.25;
  water.userData.water = true;
  addMesh(
    group,
    new THREE.TorusGeometry(1.22, 0.16, 7, 16),
    stoneMaterial('mid'),
    new THREE.Vector3(0, 1.17, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  for (const x of [-dimensions.postX, dimensions.postX]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.24, postHeight, 0.24),
      timberMaterial('dark'),
      new THREE.Vector3(x, dimensions.postBaseY + postHeight * 0.5, 0),
    );
    post.name = 'Well windlass post';
    post.userData.roofClearance = roofUndersideAtPost - postTopY;
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.13, 0.13, 3.15, 9),
    timberMaterial('weathered'),
    new THREE.Vector3(0, dimensions.windlassY, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10),
    timberMaterial('mid'),
    new THREE.Vector3(0, dimensions.windlassY, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  const wellRope = addMesh(
    group,
    new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(0, 1.63, 0),
  );
  wellRope.name = 'Well windlass fibre rope';
  const wellBucket = addMesh(
    group,
    new THREE.CylinderGeometry(0.27, 0.22, 0.42, 10),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 1.03, 0),
  );
  wellBucket.name = 'Well brown-timber bucket';

  addHippedRoof(group, {
    width: dimensions.roofRadius * Math.SQRT2,
    depth: dimensions.roofRadius * Math.SQRT2,
    eaveY: dimensions.roofCenterY - dimensions.roofHeight * 0.5,
    peakY: dimensions.roofCenterY + dimensions.roofHeight * 0.5,
    thickness: 0.11,
    material: shingleMaterial(),
    name: 'Well joined four-sided shingle roof',
  });
  const tieBeam = addMesh(
    group,
    new THREE.BoxGeometry(3.1, dimensions.tieBeamThickness, 0.16),
    timberMaterial('dark'),
    new THREE.Vector3(0, dimensions.tieBeamY, 0),
  );
  tieBeam.name = 'Well roof tie beam';
  return group;
}

function addRoundPoleBetween(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  name: string,
  radialSegments = 7,
): THREE.Mesh {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const pole = addMesh(
    group,
    new THREE.CylinderGeometry(radius, radius * 1.04, length, radialSegments),
    material,
    midpoint,
  );
  pole.name = name;
  pole.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return pole;
}

function addHunterSleepingTent(group: THREE.Group): void {
  // Reuse the actual founder shelter, including its door flaps, seams, repair
  // patch, guy ropes, stakes and bedroll. Its authored entrance faces -Z.
  const tent = addCampAFrameShelter(group, -2.55, -0.9, Math.PI, 0);
  tent.userData.fabricRole = 'sleeping-tent';
}

function addHunterProcessingFly(group: THREE.Group): void {
  const hide = sharedBuildingDetailMaterial('hide');
  const darkWood = timberMaterial('dark');
  const weatheredWood = timberMaterial('weathered');
  // Inset the supports so the loose hide can fold over them inside the
  // existing canopy footprint, without encroaching on the front hearth.
  const x0 = 0.42;
  const x1 = 4.68;
  const z0 = -1.98;
  const z1 = 1.91;
  const corners = [
    new THREE.Vector3(x0, 2.62, z0),
    new THREE.Vector3(x1, 2.5, z0),
    new THREE.Vector3(x1, 2.38, z1),
    new THREE.Vector3(x0, 2.7, z1),
  ] as const;
  for (const corner of corners) {
    addRoundPoleBetween(
      group,
      new THREE.Vector3(corner.x, 0, corner.z),
      corner,
      0.072,
      darkWood,
      'Hunter processing fly post',
      8,
    );
    const binding = addMesh(
      group,
      new THREE.TorusGeometry(0.084, 0.018, 5, 12),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(corner.x, corner.y - 0.075, corner.z),
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
    binding.name = 'Hunter hide canopy post binding';
  }
  const fly = addMesh(
    group,
    createDrapedCanopyGeometry(corners, CAMP_HIDE_METERS_PER_REPEAT),
    hide,
    new THREE.Vector3(),
  );
  fly.name = 'Hunter processing fly stitched brown hide';
  fly.userData.proceduralFabric = true;
  fly.userData.fabricRole = 'processing-fly';

  const table = addMesh(
    group,
    new THREE.BoxGeometry(2.6, 0.12, 1.15),
    weatheredWood,
    new THREE.Vector3(2.7, 0.92, 0.55),
  );
  table.name = 'Hunter processing table';
  for (const [x, z] of [[1.58, 0.14], [3.82, 0.14], [1.58, 0.96], [3.82, 0.96]] as const) {
    addRoundPoleBetween(
      group,
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, 0.87, z),
      0.055,
      darkWood,
      'Hunter processing table leg',
      7,
    );
  }

  // This is deliberately an empty structural frame. Bows, snares, carcasses,
  // and tools are runtime inventory, not inexplicable baked decoration.
  const frameX = 1.0;
  const frameZ = -1.35;
  for (const x of [frameX, frameX + 2.4]) {
    addRoundPoleBetween(
      group,
      new THREE.Vector3(x, 0, frameZ),
      new THREE.Vector3(x, 2.05, frameZ),
      0.06,
      darkWood,
      'Hunter empty tool-frame post',
      7,
    );
  }
  addRoundPoleBetween(
    group,
    new THREE.Vector3(frameX, 1.88, frameZ),
    new THREE.Vector3(frameX + 2.4, 1.88, frameZ),
    0.06,
    darkWood,
    'Hunter empty tool-frame rail',
    7,
  ).userData.runtimeInventoryAnchor = 'hunter-tools';
}

function addHunterHearth(group: THREE.Group): void {
  const stone = stoneMaterial('mid');
  const logs = timberMaterial('dark');
  // Keep the whole hearth in the open front yard, beyond the fly's +Z edge.
  const center = new THREE.Vector3(-0.05, 0, 3.35);
  const hearth = new THREE.Group();
  hearth.name = 'Hunter hearth';
  hearth.position.copy(center);
  group.add(hearth);
  const stoneCount = 11;
  for (let index = 0; index < stoneCount; index += 1) {
    const angle = index / stoneCount * Math.PI * 2;
    const radius = 0.72 + Math.sin(index * 2.17) * 0.035;
    const rock = addMesh(
      hearth,
      new THREE.DodecahedronGeometry(0.23 + (index % 3) * 0.018, 0),
      stone,
      new THREE.Vector3(
        Math.cos(angle) * radius,
        0.15,
        Math.sin(angle) * radius,
      ),
      new THREE.Euler(0.08 * (index % 2), angle, -0.05 * (index % 3)),
    );
    rock.name = 'Hunter hearth ring stone';
    rock.scale.y = 0.62;
  }
  const campfire = new THREE.Group();
  campfire.name = 'HunterCampfire';
  campfire.userData.runtimeFireAnchor = true;
  hearth.add(campfire);
  campfire.add(createCampfireEffects());
  for (const [index, angle] of [0.72, -0.72, 0].entries()) {
    const start = new THREE.Vector3(
      -Math.cos(angle) * 0.48,
      0.3 + index * 0.035,
      -Math.sin(angle) * 0.48,
    );
    const end = new THREE.Vector3(
      Math.cos(angle) * 0.48,
      0.3 + index * 0.035,
      Math.sin(angle) * 0.48,
    );
    addRoundPoleBetween(campfire, start, end, 0.1, logs, 'Hunter hearth fire log', 8);
  }
  // Three wooden cooking poles stand on bare ground outside the stone ring;
  // no dangling metal rod or baked pot is included.
  const tripodTop = new THREE.Vector3(0, 2.28, 0);
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    addRoundPoleBetween(
      hearth,
      new THREE.Vector3(Math.cos(angle) * 1.04, 0, Math.sin(angle) * 1.04),
      tripodTop,
      0.035,
      timberMaterial('weathered'),
      'Hunter hearth tripod pole',
      6,
    );
  }
}

/** Temporary woodland hunting camp with canvas shelter and an open work yard. */
export function createHuntersHallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Hunter's camp";
  group.userData.historicalMassing = 'temporary-woodland-camp';
  group.userData.noBakedHangingTools = true;
  addHunterSleepingTent(group);
  addHunterProcessingFly(group);
  addHunterHearth(group);

  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'HuntersFoodStockpile';
  foodStockpile.visible = false;
  group.add(foodStockpile);
  for (let index = 0; index < 4; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'HuntersFoodSegment';
    const row = Math.floor(index / 2);
    const column = index % 2;
    const x = 3.45 + column * 0.55;
    const z = -0.72 - row * 0.52;
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.29, 0.3, 9),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.15, z),
    ).name = 'Covered hunter provision basket';
    foodStockpile.add(segment);
  }
  return group;
}

function addHerbPorch(group: THREE.Group, frontZ: number): void {
  const porchZ = frontZ + 1.0;
  for (const x of [-2.0, 2.0]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.14, 2.48, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.24, porchZ),
    );
    post.name = "Forager's shed herb-porch structural post";
  }
  addLeanToRoof(group, {
    width: 4.35,
    depth: 2.05,
    thickness: 0.12,
    material: shingleMaterial(),
    position: new THREE.Vector3(0, 2.54, porchZ - 0.18),
    pitch: 0.14,
    highEdge: 'negativeZ',
    name: "Forager's shed herb porch roof",
  });
  const dryingRail = addMesh(
    group,
    new THREE.BoxGeometry(4.0, 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 2.15, porchZ),
  );
  dryingRail.name = "Forager's shed brown-timber drying rail";
  const remedyStockpile = new THREE.Group();
  remedyStockpile.name = 'ForagersRemedyStockpile';
  remedyStockpile.visible = false;
  for (let segmentIndex = 0; segmentIndex < 4; segmentIndex++) {
    const segment = new THREE.Group();
    segment.name = 'ForagersRemedySegment';
    const x = -1.5 + segmentIndex;
    const basket = addMesh(
      segment,
      new THREE.CylinderGeometry(0.28, 0.22, 0.38, 9),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.2, porchZ + 0.15),
    );
    basket.name = 'Forager woven remedy basket';
    remedyStockpile.add(segment);
  }
  group.add(remedyStockpile);

  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'ForagersFoodStockpile';
  foodStockpile.visible = false;
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    const segment = new THREE.Group();
    segment.name = 'ForagersFoodSegment';
    const basket = addMesh(
      segment,
      new THREE.CylinderGeometry(0.38, 0.27, 0.42, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.23, porchZ + 0.15),
    );
    basket.name = 'Forager woven food basket';
    const rim = addMesh(
      segment,
      new THREE.TorusGeometry(0.33, 0.025, 5, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.45, porchZ + 0.15),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    rim.name = 'Forager woven food-basket rim';
    foodStockpile.add(segment);
  }
  group.add(foodStockpile);
}

/** Compact gathering shed whose herb-drying porch reads clearly from above. */
export function createForagersShedMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Forager's shed";
  const shell = addGableShell(group, {
    width: 5.45,
    depth: 4.65,
    stoneHeight: 0.55,
    wallHeight: 2.34,
    ridgeHeight: 2.0,
    wallMaterial: residenceFacadeMaterial('yellow'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -0.95, 0.59, shell.frontZ + 0.02, 0.9, 1.8);
  addSmallWindow(group, 1.08, 1.54, shell.frontZ + 0.02, 0.72, 0.86);
  addHerbPorch(group, shell.frontZ);
  addBarrel(group, shell.halfW - 0.35, -shell.halfD + 0.35, 0.82);
  return group;
}

function addFishingRack(group: THREE.Group, centerX: number, centerZ: number): void {
  for (const x of [centerX - 1.65, centerX + 1.65]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.16, 2.45, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.22, centerZ),
    );
    post.name = 'Fishing rack timber post';
  }
  const crossbar = addMesh(
    group,
    new THREE.CylinderGeometry(0.07, 0.07, 3.65, 8),
    timberMaterial('weathered'),
    new THREE.Vector3(centerX, 2.34, centerZ),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  crossbar.name = 'Fishing rack timber crossbar';
  for (let strand = -3; strand <= 3; strand++) {
    const x = centerX + strand * 0.43;
    const dryingCord = addMesh(
      group,
      new THREE.CylinderGeometry(0.018, 0.018, 1.35 - Math.abs(strand) * 0.08, 5),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 1.62, centerZ),
    );
    dryingCord.name = 'Fishing rack fibre drying cord';
  }
  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'FishingFoodStockpile';
  foodStockpile.visible = false;
  for (const x of [centerX - 0.78, centerX, centerX + 0.78]) {
    const segment = new THREE.Group();
    segment.name = 'FishingFoodSegment';
    const fish = addMesh(
      segment,
      new THREE.ConeGeometry(0.16, 0.62, 7),
      metalMaterial('steel'),
      new THREE.Vector3(x, 1.48, centerZ + 0.08),
      new THREE.Euler(0, 0, Math.PI),
    );
    fish.name = 'Drying river fish';
    foodStockpile.add(segment);
  }
  group.add(foodStockpile);
}

function addWickerFishTrap(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.32 * scale, 0.48 * scale, 1.1 * scale, 10, 1, true),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(x, 0.55 * scale, z),
  );
  for (const y of [0.18, 0.5, 0.84]) {
    addMesh(
      group,
      new THREE.TorusGeometry((0.44 - y * 0.12) * scale, 0.025 * scale, 5, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, y * scale, z),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addPulledUpBoat(group: THREE.Group, x: number, z: number): void {
  const boat = createFishingBoatMesh();
  boat.position.set(x, 0, z);
  boat.rotation.y = -0.22;
  group.add(boat);
}

function addFishingServiceShed(
  group: THREE.Group,
  centerX: number,
  centerZ: number,
): void {
  const shell = addGableShell(group, {
    width: 3.55,
    depth: 4.05,
    stoneHeight: 0.48,
    wallHeight: 2.18,
    ridgeHeight: 1.84,
    wallMaterial: sharedBuildingMaterial('timberWeathered'),
    roofMaterial: shingleMaterial(),
    centerX,
    centerZ,
  });
  addPlankDoor(group, centerX - 0.35, 0.52, shell.frontZ + 0.02, 0.84, 1.72);
  addSmallWindow(group, centerX + 0.92, 1.48, shell.frontZ + 0.02, 0.48, 0.58);
  const smokeAnchor = new THREE.Object3D();
  smokeAnchor.name = 'FishingServiceShedSmoke';
  smokeAnchor.position.set(centerX + 0.75, shell.wallTop + shell.ridgeHeight - 0.32, centerZ - 0.4);
  smokeAnchor.userData.runtimeSmokeAnchor = true;
  group.add(smokeAnchor);
}

function addFishingWorkCans(group: THREE.Group, x: number, z: number): void {
  for (const [index, offset] of [-0.28, 0.28].entries()) {
    const can = addMesh(
      group,
      new THREE.CylinderGeometry(0.2, 0.22, 0.42 + index * 0.06, 9),
      metalMaterial('iron'),
      new THREE.Vector3(x + offset, 0.21 + index * 0.03, z),
    );
    can.name = 'Fishing work can';
    addMesh(
      group,
      new THREE.TorusGeometry(0.18, 0.018, 5, 10, Math.PI),
      metalMaterial('iron'),
      new THREE.Vector3(x + offset, 0.46 + index * 0.06, z),
      new THREE.Euler(0, 0, index === 0 ? 0.18 : -0.18),
    ).name = 'Fishing work can handle';
  }
}

/** Unfenced riverside compound with two clear door approaches and an open work yard. */
export function createFishingCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Fishing camp';
  const shell = addGableShell(group, {
    width: 6.45,
    depth: 5.35,
    stoneHeight: 0.64,
    wallHeight: 2.38,
    ridgeHeight: 2.35,
    wallMaterial: sharedBuildingMaterial('timberWeathered'),
    roofMaterial: shingleMaterial(),
    centerX: -1.65,
    centerZ: 0.2,
  });
  addPlankDoor(group, -2.72, 0.68, shell.frontZ + 0.02, 0.96, 1.82);
  addSmallWindow(group, -0.48, 1.58, shell.frontZ + 0.02, 0.68, 0.8);
  addFishingServiceShed(group, 4.05, -0.48);

  // Leave a broad walk-up to the service shed; the drying station sits farther
  // out in the east workyard with its cans and barrel alongside it.
  const rackX = 6.8;
  const rackZ = 3.7;
  addFishingRack(group, rackX, rackZ);
  addFishingWorkCans(group, rackX + 1.25, rackZ - 0.25);
  addBarrel(group, rackX + 1.62, rackZ + 0.52, 0.72);
  addWickerFishTrap(group, 2.4, -2.15, 0.92);
  addWickerFishTrap(group, 3.25, -2.45, 0.78);
  addPulledUpBoat(group, -6.7, -0.35);
  group.userData.enclosure = 'none';
  group.userData.clearDoorApproaches = [
    { x: -2.72, z: shell.frontZ + 1.1, width: 1.5 },
    { x: 3.7, z: 1.55, width: 1.35 },
  ];
  return group;
}
