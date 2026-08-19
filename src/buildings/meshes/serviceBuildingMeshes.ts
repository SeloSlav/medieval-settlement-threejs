import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { getSharedWellWaterMaterial } from '../WellWaterMaterial.ts';
import {
  addBarrel,
  addGableShell,
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
    stoneMaterial('light'),
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
  addMesh(
    group,
    new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 1.63, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.27, 0.22, 0.42, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 1.03, 0),
  );

  const roof = addMesh(
    group,
    new THREE.ConeGeometry(dimensions.roofRadius, dimensions.roofHeight, 4),
    shingleMaterial(),
    new THREE.Vector3(0, dimensions.roofCenterY, 0),
    new THREE.Euler(0, Math.PI * 0.25, 0),
  );
  roof.name = 'Well shingle roof';
  const tieBeam = addMesh(
    group,
    new THREE.BoxGeometry(3.1, dimensions.tieBeamThickness, 0.16),
    timberMaterial('dark'),
    new THREE.Vector3(0, dimensions.tieBeamY, 0),
  );
  tieBeam.name = 'Well roof tie beam';
  return group;
}

function addStoneChimney(group: THREE.Group, x: number, z: number, height: number): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, height, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(x, height * 0.5 + 2.55, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.88, 0.16, 0.88),
    stoneMaterial('light'),
    new THREE.Vector3(x, 2.55 + height, z),
  );
}

function addDryingLeanTo(group: THREE.Group, halfW: number): void {
  const centerX = halfW + 1.15;
  for (const x of [centerX - 0.72, centerX + 0.72]) {
    for (const z of [-1.72, 1.72]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.16, 2.1, 0.16),
        timberMaterial('dark'),
        new THREE.Vector3(x, 1.05, z),
      );
    }
  }
  addLeanToRoof(group, {
    width: 1.85,
    depth: 3.95,
    thickness: 0.13,
    material: shingleMaterial(),
    position: new THREE.Vector3(centerX, 2.22, 0),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: "Hunter's hall drying lean-to roof",
  });
  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'HuntersFoodStockpile';
  foodStockpile.visible = false;
  for (const z of [-1.25, -0.42, 0.42, 1.25]) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.18, 0.09, 0.09),
      timberMaterial('weathered'),
      new THREE.Vector3(centerX, 1.52, z),
    );
    const segment = new THREE.Group();
    segment.name = 'HuntersFoodSegment';
    for (const x of [centerX - 0.33, centerX + 0.33]) {
      addMesh(
        segment,
        new THREE.ConeGeometry(0.14, 0.58, 7),
        timberMaterial('mid'),
        new THREE.Vector3(x, 1.2, z),
        new THREE.Euler(Math.PI, 0, 0),
      );
    }
    foodStockpile.add(segment);
  }
  group.add(foodStockpile);
}

/** Broad hunting hall with a deep side rack and unmistakable stone chimney. */
export function createHuntersHallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Hunter's hall";
  const shell = addGableShell(group, {
    width: 7.7,
    depth: 6.45,
    stoneHeight: 0.82,
    wallHeight: 2.55,
    ridgeHeight: 2.3,
    wallMaterial: residenceFacadeMaterial('grey'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -1.38, 0.86, shell.frontZ + 0.02, 1.05, 1.92);
  addSmallWindow(group, 1.25, 1.82, shell.frontZ + 0.02, 0.86, 1.0);
  addStoneChimney(group, -2.45, -1.4, 2.75);
  addDryingLeanTo(group, shell.halfW);
  return group;
}

function addHerbPorch(group: THREE.Group, frontZ: number): void {
  const porchZ = frontZ + 1.0;
  for (const x of [-2.0, 2.0]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.14, 2.48, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.24, porchZ),
    );
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
  addMesh(
    group,
    new THREE.BoxGeometry(4.0, 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 2.15, porchZ),
  );
  const remedyStockpile = new THREE.Group();
  remedyStockpile.name = 'ForagersRemedyStockpile';
  remedyStockpile.visible = false;
  for (let i = 0; i < 7; i++) {
    const segmentIndex = Math.min(3, Math.floor(i / 2));
    let segment = remedyStockpile.children[segmentIndex] as THREE.Group | undefined;
    if (!segment) {
      segment = new THREE.Group();
      segment.name = 'ForagersRemedySegment';
      remedyStockpile.add(segment);
    }
    addMesh(
      segment,
      new THREE.ConeGeometry(0.16, 0.55 + (i % 2) * 0.12, 7),
      sharedBuildingDetailMaterial('foliage'),
      new THREE.Vector3(-1.55 + i * 0.52, 1.83, porchZ),
      new THREE.Euler(Math.PI, 0, 0),
    );
  }
  group.add(remedyStockpile);

  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'ForagersFoodStockpile';
  foodStockpile.visible = false;
  for (const [index, x] of [-1.5, -0.5, 0.5, 1.5].entries()) {
    const segment = new THREE.Group();
    segment.name = 'ForagersFoodSegment';
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.38, 0.27, 0.42, 10),
      timberMaterial('light'),
      new THREE.Vector3(x, 0.23, porchZ + 0.15),
    );
    addMesh(
      segment,
      new THREE.TorusGeometry(0.33, 0.025, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.45, porchZ + 0.15),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    for (const offset of [-0.12, 0, 0.12]) {
      addMesh(
        segment,
        new THREE.SphereGeometry(0.075, 7, 5),
        sharedBuildingDetailMaterial(index % 2 === 0 ? 'foliage' : 'paintRed'),
        new THREE.Vector3(x + offset, 0.5 + Math.abs(offset) * 0.2, porchZ + 0.15),
      );
    }
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
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 2.45, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.22, centerZ),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.07, 0.07, 3.65, 8),
    timberMaterial('weathered'),
    new THREE.Vector3(centerX, 2.34, centerZ),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (let strand = -3; strand <= 3; strand++) {
    const x = centerX + strand * 0.43;
    addMesh(
      group,
      new THREE.CylinderGeometry(0.018, 0.018, 1.35 - Math.abs(strand) * 0.08, 5),
      timberMaterial('light'),
      new THREE.Vector3(x, 1.62, centerZ),
    );
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
    timberMaterial('light'),
    new THREE.Vector3(x, 0.55 * scale, z),
  );
  for (const y of [0.18, 0.5, 0.84]) {
    addMesh(
      group,
      new THREE.TorusGeometry((0.44 - y * 0.12) * scale, 0.025 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, y * scale, z),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addPulledUpBoat(group: THREE.Group, x: number, z: number): void {
  const boat = new THREE.Group();
  boat.name = 'Pulled-up fishing boat';
  for (const side of [-1, 1] as const) {
    addMesh(
      boat,
      new THREE.BoxGeometry(0.14, 0.62, 4.25),
      timberMaterial(side > 0 ? 'mid' : 'weathered'),
      new THREE.Vector3(side * 0.68, 0.42, 0),
      new THREE.Euler(0, 0, side * -0.48),
    );
  }
  for (const localZ of [-1.45, -0.5, 0.5, 1.45]) {
    addMesh(
      boat,
      new THREE.BoxGeometry(1.2, 0.11, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(0, 0.62, localZ),
    );
  }
  boat.position.set(x, 0, z);
  boat.rotation.y = -0.22;
  group.add(boat);
}

/** Land-based net shed with wicker traps and a boat hauled safely above the shore. */
export function createFishingCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Fishing camp';
  const shell = addGableShell(group, {
    width: 6.1,
    depth: 5.2,
    stoneHeight: 0.62,
    wallHeight: 2.42,
    ridgeHeight: 2.08,
    wallMaterial: residenceFacadeMaterial('grey'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -1.05, 0.66, shell.frontZ + 0.02, 0.94, 1.84);
  addSmallWindow(group, 1.22, 1.62, shell.frontZ + 0.02, 0.76, 0.88);
  addFishingRack(group, 0, shell.frontZ + 1.18);
  addWickerFishTrap(group, shell.halfW + 0.65, -0.7, 1);
  addWickerFishTrap(group, shell.halfW + 1.15, 0.75, 0.82);
  addPulledUpBoat(group, -shell.halfW - 1.7, -0.2);
  addBarrel(group, shell.halfW - 0.25, -shell.halfD + 0.32, 0.76);
  return group;
}
