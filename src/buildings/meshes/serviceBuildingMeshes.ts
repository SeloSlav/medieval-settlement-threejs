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
    timberMaterial('weathered'),
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

function createSaggingClothPanelGeometry(
  corners: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  segmentsU: number,
  segmentsV: number,
  sag: number,
  seed: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const [a, b, c, d] = corners;
  const bottom = new THREE.Vector3();
  const top = new THREE.Vector3();
  const point = new THREE.Vector3();

  for (let vIndex = 0; vIndex <= segmentsV; vIndex += 1) {
    const v = vIndex / segmentsV;
    for (let uIndex = 0; uIndex <= segmentsU; uIndex += 1) {
      const u = uIndex / segmentsU;
      bottom.lerpVectors(a, b, u);
      top.lerpVectors(d, c, u);
      point.lerpVectors(bottom, top, v);
      const handmade = Math.sin((u * 9.7 + v * 4.1 + seed * 0.17) * Math.PI) * 0.012;
      point.y -= Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * sag;
      point.y += handmade * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      positions.push(point.x, point.y, point.z);
      uvs.push(u * 2.4, v * 2.4);
    }
  }
  const stride = segmentsU + 1;
  for (let v = 0; v < segmentsV; v += 1) {
    for (let u = 0; u < segmentsU; u += 1) {
      const i0 = v * stride + u;
      const i1 = i0 + 1;
      const i2 = i0 + stride + 1;
      const i3 = i0 + stride;
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
  const canvas = sharedBuildingDetailMaterial('canvas');
  const poles = timberMaterial('weathered');
  const halfWidth = 1.72;
  const halfDepth = 2.22;
  const groundY = 0.12;
  const ridgeY = 2.62;
  const centerX = -2.75;
  const centerZ = -0.45;

  const ridgeRear = new THREE.Vector3(centerX, ridgeY, centerZ - halfDepth);
  const ridgeFront = new THREE.Vector3(centerX, ridgeY, centerZ + halfDepth);
  for (const side of [-1, 1] as const) {
    const eaveRear = new THREE.Vector3(centerX + side * halfWidth, groundY, centerZ - halfDepth);
    const eaveFront = new THREE.Vector3(centerX + side * halfWidth, groundY, centerZ + halfDepth);
    const cloth = addMesh(
      group,
      createSaggingClothPanelGeometry(
        [ridgeRear, ridgeFront, eaveFront, eaveRear],
        12,
        7,
        0.1,
        side * 17,
      ),
      canvas,
      new THREE.Vector3(),
    );
    cloth.name = `Hunter sleeping tent canvas ${side < 0 ? 'left' : 'right'}`;
    cloth.userData.proceduralFabric = true;
    cloth.userData.fabricRole = 'sleeping-tent';
  }

  addRoundPoleBetween(
    group,
    ridgeRear.clone().add(new THREE.Vector3(0, 0.035, -0.18)),
    ridgeFront.clone().add(new THREE.Vector3(0, 0.035, 0.22)),
    0.055,
    poles,
    'Hunter tent ridge pole',
  );
  for (const z of [centerZ - halfDepth, centerZ + halfDepth]) {
    const peak = new THREE.Vector3(centerX, ridgeY + 0.08, z);
    for (const side of [-1, 1] as const) {
      addRoundPoleBetween(
        group,
        new THREE.Vector3(centerX + side * (halfWidth + 0.08), 0, z),
        peak,
        0.05,
        poles,
        'Hunter tent A-frame pole',
      );
    }
  }

  const rearShape = new THREE.Shape();
  rearShape.moveTo(-halfWidth, groundY);
  rearShape.lineTo(halfWidth, groundY);
  rearShape.lineTo(0, ridgeY);
  rearShape.closePath();
  const rear = addMesh(
    group,
    new THREE.ShapeGeometry(rearShape),
    canvas,
    new THREE.Vector3(centerX, 0, centerZ - halfDepth - 0.018),
  );
  rear.name = 'Hunter sleeping tent closed rear canvas';
  // ShapeGeometry is authored in XY and already faces the open front/rear axis.
  rear.userData.proceduralFabric = true;
}

function addHunterProcessingFly(group: THREE.Group): void {
  const canvas = sharedBuildingDetailMaterial('canvas');
  const darkWood = timberMaterial('dark');
  const weatheredWood = timberMaterial('weathered');
  const x0 = 0.2;
  const x1 = 4.9;
  const z0 = -2.2;
  const z1 = 2.15;
  const corners = [
    new THREE.Vector3(x0, 2.42, z0),
    new THREE.Vector3(x1, 2.3, z0),
    new THREE.Vector3(x1, 2.18, z1),
    new THREE.Vector3(x0, 2.5, z1),
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
  }
  const fly = addMesh(
    group,
    createSaggingClothPanelGeometry(corners, 10, 8, 0.2, 1550),
    canvas,
    new THREE.Vector3(),
  );
  fly.name = 'Hunter processing fly sagging canvas';
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
  const center = new THREE.Vector3(-0.05, 0, 2.05);
  const stoneCount = 11;
  for (let index = 0; index < stoneCount; index += 1) {
    const angle = index / stoneCount * Math.PI * 2;
    const radius = 0.72 + Math.sin(index * 2.17) * 0.035;
    const rock = addMesh(
      group,
      new THREE.DodecahedronGeometry(0.23 + (index % 3) * 0.018, 0),
      stone,
      new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        0.15,
        center.z + Math.sin(angle) * radius,
      ),
      new THREE.Euler(0.08 * (index % 2), angle, -0.05 * (index % 3)),
    );
    rock.name = 'Hunter hearth ring stone';
    rock.scale.y = 0.62;
  }
  const campfire = new THREE.Group();
  campfire.name = 'HunterCampfire';
  campfire.userData.runtimeFireAnchor = true;
  group.add(campfire);
  for (const [index, angle] of [0.72, -0.72, 0].entries()) {
    const start = new THREE.Vector3(
      center.x - Math.cos(angle) * 0.48,
      0.3 + index * 0.035,
      center.z - Math.sin(angle) * 0.48,
    );
    const end = new THREE.Vector3(
      center.x + Math.cos(angle) * 0.48,
      0.3 + index * 0.035,
      center.z + Math.sin(angle) * 0.48,
    );
    addRoundPoleBetween(campfire, start, end, 0.1, logs, 'Hunter hearth fire log', 8);
  }
  // Three wooden cooking poles stand on bare ground outside the stone ring;
  // no dangling metal rod or baked pot is included.
  const tripodTop = new THREE.Vector3(center.x, 2.28, center.z);
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    addRoundPoleBetween(
      group,
      new THREE.Vector3(center.x + Math.cos(angle) * 1.04, 0, center.z + Math.sin(angle) * 1.04),
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

  // Keep the shared yard open: the rack is east of both door axes, and the
  // cans/barrels sit beside it instead of clipping a facade or circulation.
  const rackX = 5.95;
  const rackZ = 2.55;
  addFishingRack(group, rackX, rackZ);
  addFishingWorkCans(group, rackX + 1.25, rackZ - 0.25);
  addBarrel(group, rackX + 1.62, rackZ + 0.52, 0.72);
  addWickerFishTrap(group, 2.4, -2.15, 0.92);
  addWickerFishTrap(group, 3.25, -2.45, 0.78);
  addPulledUpBoat(group, -5.65, -0.35);
  group.userData.enclosure = 'none';
  group.userData.clearDoorApproaches = [
    { x: -2.72, z: shell.frontZ + 1.1, width: 1.5 },
    { x: 3.7, z: 1.55, width: 1.35 },
  ];
  return group;
}
