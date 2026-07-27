import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addDarkOpening,
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import {
  WATCHTOWER_GALLERY_DECK_CENTER_Y,
  WATCHTOWER_GALLERY_DECK_THICKNESS,
  WATCHTOWER_GALLERY_POST_CENTER_Y,
  WATCHTOWER_GALLERY_POST_HEIGHT,
  WATCHTOWER_GALLERY_RAIL_CENTER_Y,
  WATCHTOWER_GALLERY_RAIL_HEIGHT,
  WATCHTOWER_GALLERY_TOP_BEAM_Y,
  WATCHTOWER_ROOF_CENTER_Y,
  WATCHTOWER_ROOF_HEIGHT,
} from '../watchtowerLayout.ts';
import {
  BUILDING_DEFINITIONS,
  GUARDHOUSE_PAYROLL_TARGET_DAYS,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
} from '../../generated/gameBalance.ts';

const earth = sharedBuildingDetailMaterial('earth');
export const GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS = 3;
export const GUARDHOUSE_PAYROLL_VISUAL_CAPACITY =
  BUILDING_DEFINITIONS.guardhouse.maxLabor
  * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY
  * GUARDHOUSE_PAYROLL_TARGET_DAYS;

function addCrate(group: THREE.Group, x: number, y: number, z: number, scale = 1): void {
  addMesh(group, new THREE.BoxGeometry(1.0 * scale, 0.78 * scale, 0.82 * scale), timberMaterial('weathered'), new THREE.Vector3(x, y + 0.39 * scale, z));
  for (const offset of [-0.38, 0.38]) {
    addMesh(group, new THREE.BoxGeometry(0.09 * scale, 0.82 * scale, 0.88 * scale), timberMaterial('dark'), new THREE.Vector3(x + offset * scale, y + 0.4 * scale, z));
  }
}

function addBell(group: THREE.Group, x: number, y: number, z: number): void {
  addMesh(group, new THREE.CylinderGeometry(0.12, 0.34, 0.52, 10), sharedBuildingDetailMaterial('brass'), new THREE.Vector3(x, y, z));
  addMesh(group, new THREE.SphereGeometry(0.09, 7, 5), metalMaterial('iron'), new THREE.Vector3(x, y - 0.34, z));
}

function addTownHallTreasuryChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'TownHallTreasuryChest';
  chest.visible = false;
  addMesh(
    chest,
    new THREE.BoxGeometry(1.35, 0.72, 0.82),
    timberMaterial('dark'),
    new THREE.Vector3(3.75, 0.43, 3.18),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.42, 0.42, 1.35, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(3.75, 0.83, 3.18),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.13, 0.78, 0.88),
    metalMaterial('iron'),
    new THREE.Vector3(3.75, 0.57, 3.18),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.22, 0.28, 0.12),
    sharedBuildingDetailMaterial('brass'),
    new THREE.Vector3(3.75, 0.56, 3.62),
  );
  group.add(chest);
}

function addGuardhousePayrollChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'GuardhousePayrollChest';
  chest.visible = false;
  const placements = [
    [3.3, 0.06, 1.45],
    [4.05, 0.06, 1.45],
    [4.8, 0.06, 1.45],
  ] as const;
  placements.forEach(([x, y, z], index) => {
    const segment = new THREE.Group();
    segment.name = 'GuardhousePayrollSegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.BoxGeometry(0.62, 0.42, 0.5),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(x, y + 0.23, z),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.25, 0.25, 0.62, 8, 1, false, 0, Math.PI),
      timberMaterial('weathered'),
      new THREE.Vector3(x, y + 0.48, z),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.07, 0.48, 0.54),
      metalMaterial('iron'),
      new THREE.Vector3(x, y + 0.32, z),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.14, 0.18, 0.08),
      sharedBuildingDetailMaterial('brass'),
      new THREE.Vector3(x, y + 0.32, z + 0.29),
    );
    chest.add(segment);
  });
  group.add(chest);
}

function addPolearmRack(group: THREE.Group, x: number, z: number): void {
  addMesh(group, new THREE.BoxGeometry(3.0, 0.16, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 0.72, z));
  addMesh(group, new THREE.BoxGeometry(3.0, 0.16, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 1.64, z));
  for (const offset of [-1.3, 1.3]) {
    addMesh(group, new THREE.BoxGeometry(0.16, 1.95, 0.18), timberMaterial('dark'), new THREE.Vector3(x + offset, 0.98, z));
  }
  for (let index = 0; index < 6; index += 1) {
    const shaftX = x - 1.02 + index * 0.41;
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.045, 2.45, 6), timberMaterial('light'), new THREE.Vector3(shaftX, 1.42, z - 0.12));
    addMesh(group, new THREE.ConeGeometry(0.12, 0.38, 5), metalMaterial('iron'), new THREE.Vector3(shaftX, 2.81, z - 0.12));
  }
}

export function createTownHallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Town Hall';
  const shell = addGableShell(group, {
    width: 11.2,
    depth: 7.4,
    stoneHeight: 1.4,
    wallHeight: 4.05,
    ridgeHeight: 2.65,
    wallMaterial: residenceFacadeMaterial('yellow'),
    roofMaterial: tileMaterial(0),
    stoneGroundFloor: true,
  });

  // An arcaded public ground floor and balcony give the hall a civic facade.
  for (const x of [-3.75, -1.25, 1.25, 3.75]) {
    addDarkOpening(group, x, 1.35, shell.frontZ + 0.04, 1.45, 2.15);
    addSmallWindow(group, x, 4.0, shell.frontZ + 0.08, 0.74, 1.02);
  }
  addPlankDoor(group, 0, 1.43, -shell.frontZ - 0.05, 1.24, 2.2);
  addMesh(group, new THREE.BoxGeometry(10.2, 0.22, 1.35), timberMaterial('dark'), new THREE.Vector3(0, 2.66, 4.05));
  for (let x = -4.8; x <= 4.8; x += 1.2) {
    addMesh(group, new THREE.BoxGeometry(0.12, 1.02, 0.12), timberMaterial('dark'), new THREE.Vector3(x, 3.12, 4.58));
  }
  addMesh(group, new THREE.BoxGeometry(10.15, 0.12, 0.12), timberMaterial('weathered'), new THREE.Vector3(0, 3.58, 4.58));

  // Exterior stair, proclamation board, and bench communicate public use at street level.
  for (let i = 0; i < 6; i++) {
    addMesh(group, new THREE.BoxGeometry(2.15, 0.2, 0.48), stoneMaterial(i % 2 ? 'mid' : 'light'), new THREE.Vector3(-4.25, 0.12 + i * 0.2, 4.15 + i * 0.4));
  }
  addMesh(group, new THREE.BoxGeometry(2.25, 1.45, 0.12), timberMaterial('weathered'), new THREE.Vector3(3.55, 1.45, 4.72));
  for (const x of [2.6, 4.5]) addMesh(group, new THREE.BoxGeometry(0.16, 2.4, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 1.2, 4.68));
  addMesh(group, new THREE.BoxGeometry(2.7, 0.18, 0.64), timberMaterial('mid'), new THREE.Vector3(0.25, 0.58, 5.05));
  for (const x of [-0.75, 1.25]) addMesh(group, new THREE.BoxGeometry(0.16, 0.58, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 0.3, 5.05));
  addTownHallTreasuryChest(group);

  // Compact bell cupola: a recognizable settlement landmark without reading as a church.
  addMesh(group, new THREE.BoxGeometry(2.25, 1.8, 2.25), timberMaterial('dark'), new THREE.Vector3(0, 7.55, 0));
  for (const z of [-1.14, 1.14]) addDarkOpening(group, 0, 7.55, z, 0.78, 0.92);
  addBell(group, 0, 7.55, 1.22);
  addMesh(group, new THREE.ConeGeometry(1.65, 2.0, 4), tileMaterial(1), new THREE.Vector3(0, 9.38, 0), new THREE.Euler(0, Math.PI * 0.25, 0));
  addMesh(group, new THREE.BoxGeometry(0.1, 0.92, 0.1), metalMaterial('iron'), new THREE.Vector3(0, 10.72, 0));
  addMesh(group, new THREE.BoxGeometry(0.58, 0.1, 0.1), metalMaterial('iron'), new THREE.Vector3(0, 10.88, 0));
  return group;
}

export function createVillageStorehouseMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Village storehouse';

  // Raised masonry plinth protects construction stock from damp ground.
  addMesh(group, new THREE.BoxGeometry(10.8, 0.7, 7.2), stoneMaterial('mid'), new THREE.Vector3(-0.35, 0.35, 0));
  const shell = addGableShell(group, {
    width: 10.2,
    depth: 6.6,
    stoneHeight: 0.82,
    wallHeight: 3.25,
    ridgeHeight: 2.5,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    centerX: -0.7,
  });
  addPlankDoor(group, -0.7, 0.88, shell.frontZ + 0.04, 2.65, 2.72);
  for (const x of [-4.2, 2.8]) addSmallWindow(group, x, 2.75, shell.frontZ + 0.06, 0.62, 0.52);

  // Loading platform and deep canopy make the warehouse function legible at game camera distance.
  addMesh(group, new THREE.BoxGeometry(9.2, 0.32, 2.2), timberMaterial('dark'), new THREE.Vector3(-0.4, 0.72, 4.2));
  for (const x of [-4.6, 3.8]) addMesh(group, new THREE.BoxGeometry(0.22, 3.1, 0.22), timberMaterial('dark'), new THREE.Vector3(x, 2.43, 5.0));
  addLeanToRoof(group, {
    width: 9.4,
    depth: 2.75,
    thickness: 0.16,
    material: shingleMaterial(),
    position: new THREE.Vector3(-0.4, 4.15, 4.25),
    pitch: 0.14,
    highEdge: 'negativeZ',
    name: 'Village storehouse loading canopy roof',
  });
  for (let i = 0; i < 4; i++) addMesh(group, new THREE.BoxGeometry(2.7 - i * 0.18, 0.18, 0.52), stoneMaterial(i % 2 ? 'light' : 'mid'), new THREE.Vector3(-0.55, 0.1 + i * 0.18, 6.45 - i * 0.4));

  addCrate(group, 2.8, 0.92, 4.18, 1.05);
  addCrate(group, 4.0, 0.92, 4.28, 0.82);
  addCrate(group, 3.45, 1.75, 4.25, 0.72);

  // Separate visible bays for timber, firewood, and quarried stone reinforce specialization.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) {
    addMesh(group, new THREE.CylinderGeometry(0.15, 0.18, 2.25, 8), timberMaterial(row % 2 ? 'mid' : 'light'), new THREE.Vector3(-5.5 + i * 0.43, 0.24 + row * 0.32, -4.15), new THREE.Euler(0, 0, Math.PI * 0.5));
  }
  for (let i = 0; i < 9; i++) {
    const x = 3.2 + (i % 3) * 0.55;
    const z = -4.5 + Math.floor(i / 3) * 0.5;
    addMesh(group, new THREE.DodecahedronGeometry(0.38 + (i % 2) * 0.08, 0), stoneMaterial(i % 3 === 0 ? 'mortar' : 'mid'), new THREE.Vector3(x, 0.3 + Math.floor(i / 6) * 0.35, z), new THREE.Euler(i * 0.2, i * 0.31, 0));
  }
  addMesh(group, new THREE.BoxGeometry(3.4, 0.12, 2.2), timberMaterial('dark'), new THREE.Vector3(0, 0.08, -4.2));
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    addMesh(group, new THREE.CylinderGeometry(0.12, 0.15, 0.95, 7), timberMaterial('dark'), new THREE.Vector3(-1.25 + i * 0.48, 0.2 + row * 0.27, -4.2), new THREE.Euler(0, 0, Math.PI * 0.5));
  }
  addMesh(group, new THREE.BoxGeometry(0.7, 0.06, 1.8), earth, new THREE.Vector3(-0.4, 0.06, 6.35));
  return group;
}

export function createWatchtowerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Frontier watchtower';

  // A compact limestone footing resists the wet mountain ground without reading as a castle keep.
  addMesh(group, new THREE.BoxGeometry(4.6, 0.82, 4.6), stoneMaterial('mid'), new THREE.Vector3(0, 0.41, 0));
  for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]] as const) {
    addMesh(group, new THREE.BoxGeometry(0.46, 5.8, 0.46), timberMaterial('dark'), new THREE.Vector3(x, 3.72, z));
  }

  // Braced open legs keep the silhouette legible while showing believable timber construction.
  for (const z of [-1.5, 1.5]) {
    addMesh(group, new THREE.BoxGeometry(0.24, 4.1, 0.22), timberMaterial('weathered'), new THREE.Vector3(0, 3.35, z), new THREE.Euler(0, 0, 0.58));
    addMesh(group, new THREE.BoxGeometry(0.24, 4.1, 0.22), timberMaterial('weathered'), new THREE.Vector3(0, 3.35, z), new THREE.Euler(0, 0, -0.58));
  }
  for (const x of [-1.5, 1.5]) {
    addMesh(group, new THREE.BoxGeometry(0.22, 4.1, 0.24), timberMaterial('weathered'), new THREE.Vector3(x, 3.35, 0), new THREE.Euler(0.58, 0, 0));
    addMesh(group, new THREE.BoxGeometry(0.22, 4.1, 0.24), timberMaterial('weathered'), new THREE.Vector3(x, 3.35, 0), new THREE.Euler(-0.58, 0, 0));
  }

  addMesh(
    group,
    new THREE.BoxGeometry(4.8, WATCHTOWER_GALLERY_DECK_THICKNESS, 4.8),
    timberMaterial('dark'),
    new THREE.Vector3(0, WATCHTOWER_GALLERY_DECK_CENTER_Y, 0),
  );
  // A waist-high open gallery lets the staffed watch remain readable instead
  // of hiding villagers inside an undersized solid block.
  const gallery = new THREE.Group();
  gallery.name = 'Open timber watch gallery';
  const galleryWall = timberMaterial('weathered');
  const galleryFrame = timberMaterial('dark');
  for (const z of [-2.1, 2.1]) {
    addMesh(gallery, new THREE.BoxGeometry(4.35, WATCHTOWER_GALLERY_RAIL_HEIGHT, 0.18), galleryWall, new THREE.Vector3(0, WATCHTOWER_GALLERY_RAIL_CENTER_Y, z));
    addMesh(gallery, new THREE.BoxGeometry(4.35, 0.26, 0.2), galleryFrame, new THREE.Vector3(0, WATCHTOWER_GALLERY_TOP_BEAM_Y, z));
    for (const x of [-2.05, 0, 2.05]) {
      addMesh(gallery, new THREE.BoxGeometry(0.2, WATCHTOWER_GALLERY_POST_HEIGHT, 0.2), galleryFrame, new THREE.Vector3(x, WATCHTOWER_GALLERY_POST_CENTER_Y, z));
    }
  }
  for (const x of [-2.1, 2.1]) {
    addMesh(gallery, new THREE.BoxGeometry(0.18, WATCHTOWER_GALLERY_RAIL_HEIGHT, 4.35), galleryWall, new THREE.Vector3(x, WATCHTOWER_GALLERY_RAIL_CENTER_Y, 0));
    addMesh(gallery, new THREE.BoxGeometry(0.2, 0.26, 4.35), galleryFrame, new THREE.Vector3(x, WATCHTOWER_GALLERY_TOP_BEAM_Y, 0));
    addMesh(gallery, new THREE.BoxGeometry(0.2, WATCHTOWER_GALLERY_POST_HEIGHT, 0.2), galleryFrame, new THREE.Vector3(x, WATCHTOWER_GALLERY_POST_CENTER_Y, 0));
  }
  group.add(gallery);

  // Steep shingle cap is the single dominant silhouette feature.
  addMesh(group, new THREE.ConeGeometry(3.45, WATCHTOWER_ROOF_HEIGHT, 4), shingleMaterial(), new THREE.Vector3(0, WATCHTOWER_ROOF_CENTER_Y, 0), new THREE.Euler(0, Math.PI * 0.25, 0));
  addMesh(group, new THREE.BoxGeometry(0.11, 0.82, 0.11), metalMaterial('iron'), new THREE.Vector3(0, WATCHTOWER_ROOF_CENTER_Y + 1.64, 0));

  // Exterior ladder and warning bell explain access and early-warning gameplay.
  for (const x of [-0.6, 0.6]) {
    addMesh(group, new THREE.BoxGeometry(0.14, 6.0, 0.14), timberMaterial('dark'), new THREE.Vector3(x, 3.25, 2.5), new THREE.Euler(-0.08, 0, 0));
  }
  for (let y = 0.75; y <= 5.8; y += 0.5) {
    addMesh(group, new THREE.BoxGeometry(1.35, 0.1, 0.12), timberMaterial('weathered'), new THREE.Vector3(0, y, 2.5));
  }
  addMesh(group, new THREE.BoxGeometry(1.15, 0.14, 0.14), timberMaterial('dark'), new THREE.Vector3(2.65, 7.45, 1.7));
  addMesh(group, new THREE.BoxGeometry(0.14, 0.75, 0.14), timberMaterial('dark'), new THREE.Vector3(2.15, 7.15, 1.7));
  addBell(group, 3.1, 7.08, 1.7);

  return group;
}

export function createGuardhouseMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Frontier guardhouse';

  // This is a paid-company lodging and muster yard, not a miniature castle.
  addMesh(group, new THREE.BoxGeometry(8.2, 0.58, 6.2), stoneMaterial('mid'), new THREE.Vector3(-1.35, 0.29, 0));
  const shell = addGableShell(group, {
    width: 7.7,
    depth: 5.65,
    stoneHeight: 1.35,
    wallHeight: 3.45,
    ridgeHeight: 2.35,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
    centerX: -1.45,
  });
  addPlankDoor(group, -1.45, 1.22, shell.frontZ + 0.05, 1.18, 2.05);
  for (const x of [-3.85, 0.95]) {
    addSmallWindow(group, x, 2.55, shell.frontZ + 0.07, 0.58, 0.7);
  }

  // Exposed oak framing gives the upper room a legible, locally built structure.
  for (const x of [-4.95, -2.62, -0.28, 2.05]) {
    addMesh(group, new THREE.BoxGeometry(0.2, 2.45, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 2.48, shell.frontZ + 0.14));
  }
  addMesh(group, new THREE.BoxGeometry(7.45, 0.2, 0.18), timberMaterial('dark'), new THREE.Vector3(-1.45, 1.42, shell.frontZ + 0.14));
  addMesh(group, new THREE.BoxGeometry(7.45, 0.2, 0.18), timberMaterial('dark'), new THREE.Vector3(-1.45, 3.48, shell.frontZ + 0.14));

  // A deep lean-to covers drill equipment and provisions beside the street.
  for (const x of [3.05, 6.25]) {
    for (const z of [-2.35, 2.35]) {
      addMesh(group, new THREE.BoxGeometry(0.22, 3.0, 0.22), timberMaterial('dark'), new THREE.Vector3(x, 1.5, z));
    }
  }
  addLeanToRoof(group, {
    width: 4.7,
    depth: 5.45,
    thickness: 0.18,
    material: shingleMaterial(),
    position: new THREE.Vector3(4.18, 3.18, 0),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: 'Frontier guardhouse drill-yard roof',
  });
  addMesh(group, new THREE.BoxGeometry(3.2, 0.18, 0.64), timberMaterial('mid'), new THREE.Vector3(4.55, 0.54, -1.85));
  for (const x of [3.15, 5.95]) {
    addMesh(group, new THREE.BoxGeometry(0.16, 0.55, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 0.28, -1.85));
  }

  addPolearmRack(group, 4.45, 1.68);
  addCrate(group, 5.55, 0.02, -0.1, 1.08);
  addCrate(group, 3.75, 0.02, -0.52, 0.75);
  addGuardhousePayrollChest(group);

  // A compact palisade fragment frames the drill yard without implying a full wall system.
  for (let index = 0; index < 7; index += 1) {
    const z = -3.2 + index * 1.02;
    addMesh(group, new THREE.CylinderGeometry(0.12, 0.16, 1.9, 6), timberMaterial(index % 2 ? 'dark' : 'weathered'), new THREE.Vector3(6.65, 0.95, z));
    addMesh(group, new THREE.ConeGeometry(0.17, 0.4, 6), timberMaterial('weathered'), new THREE.Vector3(6.65, 2.1, z));
  }
  addMesh(group, new THREE.BoxGeometry(0.18, 0.08, 6.45), earth, new THREE.Vector3(6.62, 0.05, 0));
  return group;
}
