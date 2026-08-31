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
import {
  addBarrel,
  addCrate,
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';

const UP = new THREE.Vector3(0, 1, 0);

function addConnectedMember(
  group: THREE.Group,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  width = 0.17,
  depth = width,
  material = timberMaterial('dark'),
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const member = addMesh(
    group,
    new THREE.BoxGeometry(width, length, depth),
    material,
    start.clone().add(end).multiplyScalar(0.5),
  );
  member.name = name;
  member.quaternion.setFromUnitVectors(UP, direction.normalize());
  member.userData.proceduralStructuralMember = true;
  return member;
}

function addLeanToFrame(
  group: THREE.Group,
  prefix: string,
  innerX: number,
  outerX: number,
  halfDepth: number,
  baseY: number,
  innerY: number,
  outerY: number,
): void {
  for (const z of [-halfDepth, halfDepth]) {
    addConnectedMember(
      group,
      `${prefix} outer post`,
      new THREE.Vector3(outerX, baseY, z),
      new THREE.Vector3(outerX, outerY, z),
      0.2,
      0.2,
    );
    addConnectedMember(
      group,
      `${prefix} connected rafter`,
      new THREE.Vector3(innerX, innerY, z),
      new THREE.Vector3(outerX, outerY, z),
      0.16,
      0.14,
    );
  }
  addConnectedMember(
    group,
    `${prefix} wall ledger`,
    new THREE.Vector3(innerX, innerY, -halfDepth),
    new THREE.Vector3(innerX, innerY, halfDepth),
    0.2,
    0.18,
  );
  addConnectedMember(
    group,
    `${prefix} eave plate`,
    new THREE.Vector3(outerX, outerY, -halfDepth),
    new THREE.Vector3(outerX, outerY, halfDepth),
    0.2,
    0.18,
  );
}

function addArmorerWorkRack(group: THREE.Group): void {
  const rack = new THREE.Group();
  rack.name = 'Armorer finished-work rack';
  rack.position.set(4.05, 0, 0.65);
  group.add(rack);
  for (const x of [-0.72, 0.72]) {
    addConnectedMember(
      rack,
      'Armorer rack connected post',
      new THREE.Vector3(x, 0.12, 0),
      new THREE.Vector3(x, 1.85, 0),
      0.14,
      0.14,
      timberMaterial('mid'),
    );
  }
  addConnectedMember(
    rack,
    'Armorer rack header',
    new THREE.Vector3(-0.82, 1.58, 0),
    new THREE.Vector3(0.82, 1.58, 0),
    0.14,
    0.14,
    timberMaterial('mid'),
  );
  const shield = addMesh(
    rack,
    new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(-0.32, 1.0, -0.08),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  shield.name = 'Armorer wicker-core shield';
  addMesh(
    rack,
    new THREE.SphereGeometry(0.14, 10, 7),
    metalMaterial('iron'),
    new THREE.Vector3(-0.38, 1.0, -0.08),
    undefined,
    new THREE.Vector3(0.38, 1, 1),
  ).name = 'Armorer shield boss';
  for (const [index, z] of [-0.3, 0.02, 0.34].entries()) {
    addConnectedMember(
      rack,
      'Armorer finished polearm shaft',
      new THREE.Vector3(0.15 + index * 0.2, 0.12, z),
      new THREE.Vector3(0.15 + index * 0.2, 1.74, z),
      0.045,
      0.045,
      timberMaterial('mid'),
    );
  }
}

/** Distinct, secure armorer's workshop rather than a renamed smithy clone. */
export function createWeaponsmithArmorerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Weaponsmith and armorer';
  group.userData.proceduralPlanId = 'weaponsmith-armorer-secure-workshop-v1';
  const shell = addGableShell(group, {
    width: 6.8,
    depth: 5.2,
    stoneHeight: 0.78,
    wallHeight: 2.72,
    ridgeHeight: 1.88,
    wallMaterial: residenceFacadeMaterial('grey'),
    roofMaterial: shingleMaterial(),
    centerX: -0.7,
    centerZ: -0.2,
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -2.05, 0.82, shell.frontZ + 0.02, 1.12, 1.96);
  addSmallWindow(group, 0.55, 2.1, shell.frontZ + 0.03, 0.72, 0.72);
  addSmallWindow(group, -1.5, 2.0, shell.backZ - 0.03, 0.62, 0.58);

  addMesh(
    group,
    new THREE.BoxGeometry(1.14, 3.55, 1.14),
    stoneMaterial('mid'),
    new THREE.Vector3(1.75, 2.55, -1.25),
  ).name = 'Armorer masonry forge stack';
  addMesh(
    group,
    new THREE.CylinderGeometry(0.44, 0.58, 0.58, 8),
    stoneMaterial('mid'),
    new THREE.Vector3(1.75, 4.62, -1.25),
  ).name = 'Armorer open forge flue';

  addLeanToFrame(group, 'Armorer working-bay frame', 2.68, 5.02, 2.18, 0.12, 3.18, 2.72);
  addLeanToRoof(group, {
    width: 2.78,
    depth: 4.75,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(3.86, 3.15, -0.2),
    pitch: 0.19,
    highEdge: 'negativeX',
    name: 'Armorer joined working-bay shingle roof',
  });
  addMesh(
    group,
    new THREE.BoxGeometry(1.42, 0.62, 1.0),
    stoneMaterial('mid'),
    new THREE.Vector3(3.45, 0.31, -0.9),
  ).name = 'Armorer open-bay hearth';
  addMesh(
    group,
    new THREE.BoxGeometry(2.15, 0.18, 0.78),
    timberMaterial('weathered'),
    new THREE.Vector3(4.05, 0.93, 1.48),
  ).name = 'Armorer heavy bench';
  addMesh(
    group,
    new THREE.CylinderGeometry(0.14, 0.22, 0.68, 6),
    metalMaterial('iron'),
    new THREE.Vector3(3.1, 0.72, 0.45),
  ).name = 'Armorer anvil';
  addArmorerWorkRack(group);
  return group;
}

function addBowyerSeasoningRack(group: THREE.Group): void {
  const rack = new THREE.Group();
  rack.name = 'Bowyer stave seasoning rack';
  group.add(rack);
  const x0 = 3.65;
  const x1 = 5.75;
  for (const z of [-1.55, 1.55]) {
    addConnectedMember(rack, 'Bowyer seasoning-rack post', new THREE.Vector3(x1, 0.1, z), new THREE.Vector3(x1, 2.25, z), 0.16, 0.16);
    for (const y of [0.72, 1.36, 2.0]) {
      addConnectedMember(rack, 'Bowyer seasoning-rack rail', new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z), 0.1, 0.12, timberMaterial('mid'));
    }
  }
  for (let index = 0; index < 7; index++) {
    const z = -1.32 + index * 0.44;
    addConnectedMember(
      rack,
      'Bowyer seasoning stave',
      new THREE.Vector3(3.78, 0.84 + (index % 2) * 0.5, z),
      new THREE.Vector3(5.58, 0.84 + (index % 2) * 0.5, z + 0.07),
      0.055,
      0.055,
      timberMaterial('light'),
    );
  }
}

/** Long, dry bowyer's range with a covered seasoning bay and fletching bench. */
export function createBowyerFletcherMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Bowyer and fletcher';
  group.userData.proceduralPlanId = 'bowyer-fletcher-seasoning-range-v1';
  const shell = addGableShell(group, {
    width: 7.8,
    depth: 4.5,
    stoneHeight: 0.42,
    wallHeight: 2.46,
    ridgeHeight: 1.72,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    centerX: -0.8,
    centerZ: -0.35,
  });
  addPlankDoor(group, -2.35, 0.46, shell.frontZ + 0.02, 1.02, 1.9);
  addSmallWindow(group, 0.4, 1.72, shell.frontZ + 0.03, 0.9, 0.72);
  addSmallWindow(group, -1.15, 1.7, shell.backZ - 0.03, 0.72, 0.66);

  addLeanToFrame(group, 'Bowyer covered seasoning-bay frame', 3.06, 6.05, 1.9, 0.1, 2.62, 2.2);
  addLeanToRoof(group, {
    width: 3.35,
    depth: 4.35,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(4.55, 2.6, -0.35),
    pitch: 0.15,
    highEdge: 'negativeX',
    name: 'Bowyer joined seasoning-bay shingle roof',
  });
  addBowyerSeasoningRack(group);
  addMesh(
    group,
    new THREE.BoxGeometry(2.65, 0.17, 0.8),
    timberMaterial('weathered'),
    new THREE.Vector3(4.48, 0.88, 1.2),
  ).name = 'Bowyer long tillering bench';
  for (const x of [3.5, 5.46]) {
    addConnectedMember(group, 'Bowyer tillering-bench leg', new THREE.Vector3(x, 0.1, 1.2), new THREE.Vector3(x, 0.82, 1.2), 0.14, 0.14);
  }
  const target = addMesh(
    group,
    new THREE.CylinderGeometry(0.56, 0.56, 0.28, 18),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(-3.95, 1.02, 3.15),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  target.name = 'Bowyer straw proofing target';
  addConnectedMember(
    group,
    'Bowyer target left splayed support',
    new THREE.Vector3(-4.08, 0.08, 2.45),
    new THREE.Vector3(-4.08, 1.48, 2.92),
    0.12,
    0.12,
    timberMaterial('mid'),
  );
  addConnectedMember(
    group,
    'Bowyer target right splayed support',
    new THREE.Vector3(-4.08, 0.08, 3.85),
    new THREE.Vector3(-4.08, 1.48, 3.38),
    0.12,
    0.12,
    timberMaterial('mid'),
  );
  addConnectedMember(
    group,
    'Bowyer target supporting header',
    new THREE.Vector3(-4.08, 1.48, 2.82),
    new THREE.Vector3(-4.08, 1.48, 3.48),
    0.12,
    0.12,
    timberMaterial('mid'),
  );
  return group;
}

function addTradingPostProceedsChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'TradingPostProceedsChest';
  chest.visible = false;
  for (const [index, x] of [-0.7, 0, 0.7].entries()) {
    const segment = new THREE.Group();
    segment.name = 'TradingPostReceiptSegment';
    segment.visible = false;
    addMesh(segment, new THREE.BoxGeometry(0.58, 0.4, 0.48), timberMaterial(index === 1 ? 'weathered' : 'dark'), new THREE.Vector3(x, 1.18, 4.35));
    addMesh(segment, new THREE.BoxGeometry(0.07, 0.45, 0.52), metalMaterial('iron'), new THREE.Vector3(x, 1.22, 4.35));
    chest.add(segment);
  }
  group.add(chest);
}

/** Secure roadside trading range with a cart portal and connected loading bay. */
export function createTradingPostMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Trading post';
  group.userData.proceduralPlanId = 'trading-post-secure-roadside-store-v1';
  const plinth = addMesh(group, new THREE.BoxGeometry(10.2, 0.58, 6.75), stoneMaterial('mid'), new THREE.Vector3(-0.4, 0.29, -0.1));
  plinth.name = 'Trading post damp-proof fieldstone plinth';
  const shell = addGableShell(group, {
    width: 9.55,
    depth: 6.2,
    stoneHeight: 0.72,
    wallHeight: 2.9,
    ridgeHeight: 2.05,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    centerX: -0.55,
    centerZ: -0.15,
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -0.55, 0.76, shell.frontZ + 0.03, 2.35, 2.48, 'existing-platform');
  for (const x of [-3.65, 2.55]) addSmallWindow(group, x, 2.42, shell.frontZ + 0.04, 0.62, 0.54);
  for (const x of [-2.75, 1.65]) addSmallWindow(group, x, 2.25, shell.backZ - 0.04, 0.58, 0.5);

  const platform = addMesh(group, new THREE.BoxGeometry(8.9, 0.3, 2.15), timberMaterial('dark'), new THREE.Vector3(-0.45, 0.78, 4.12));
  platform.name = 'Trading post joined loading platform';
  for (const x of [-4.35, -2.0, 1.1, 3.55]) {
    addConnectedMember(group, 'Trading post loading-bay post', new THREE.Vector3(x, 0.9, 5.2), new THREE.Vector3(x, 3.55, 5.2), 0.22, 0.22);
    addConnectedMember(group, 'Trading post loading-bay rafter', new THREE.Vector3(x, 3.85, 2.95), new THREE.Vector3(x, 3.55, 5.2), 0.16, 0.14);
  }
  addConnectedMember(group, 'Trading post wall ledger', new THREE.Vector3(-4.55, 3.85, 2.95), new THREE.Vector3(3.75, 3.85, 2.95), 0.22, 0.18);
  addConnectedMember(group, 'Trading post front eave plate', new THREE.Vector3(-4.55, 3.55, 5.2), new THREE.Vector3(3.75, 3.55, 5.2), 0.24, 0.2);
  addLeanToRoof(group, {
    width: 8.9,
    depth: 2.55,
    thickness: 0.16,
    material: shingleMaterial(),
    position: new THREE.Vector3(-0.4, 3.83, 4.18),
    pitch: 0.14,
    highEdge: 'negativeZ',
    name: 'Trading post loading-bay shingle roof',
  });
  addCrate(group, 2.25, 4.12, 0.92);
  addCrate(group, 3.18, 4.22, 0.72);
  addBarrel(group, -3.4, 4.2, 0.84);
  addMesh(group, new THREE.BoxGeometry(1.12, 0.58, 0.1), timberMaterial('weathered'), new THREE.Vector3(-0.4, 2.72, 5.48)).name = 'Trading post road signboard';
  addTradingPostProceedsChest(group);
  return group;
}
