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
import {
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  GUARDHOUSE_FOOD_VISUAL_SEGMENTS,
  GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
} from '../armoryStockpileVisuals.ts';
import { addStockedPolearmRack } from './polearmRack.ts';

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

function addTradingPostProceedsChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'TradingPostProceedsChest';
  chest.visible = false;
  const placements = [
    [-0.7, 0.96, 4.2],
    [0, 0.96, 4.2],
    [0.7, 0.96, 4.2],
  ] as const;
  placements.forEach(([x, y, z], index) => {
    const segment = new THREE.Group();
    segment.name = 'TradingPostReceiptSegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.BoxGeometry(0.58, 0.4, 0.48),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(x, y + 0.22, z),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.07, 0.45, 0.52),
      metalMaterial('iron'),
      new THREE.Vector3(x, y + 0.26, z),
    );
    chest.add(segment);
  });
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

  // Separate inventory-driven bays make each physical bulk store readable at
  // overview distance. Segments are grouped rather than recreated as stock
  // changes, so hauling updates visibility without adding draw calls or churn.
  const timberStock = new THREE.Group();
  timberStock.name = 'StorehouseTimberStockpile';
  timberStock.visible = false;
  for (let i = 0; i < STOREHOUSE_TIMBER_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseTimberSegment';
    segment.visible = false;
    for (let row = 0; row < 3; row++) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.15, 0.18, 2.25, 8),
        timberMaterial(row % 2 ? 'mid' : 'light'),
        new THREE.Vector3(-5.5 + i * 0.43, 0.24 + row * 0.32, -4.15),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    timberStock.add(segment);
  }
  group.add(timberStock);

  const stoneStock = new THREE.Group();
  stoneStock.name = 'StorehouseStoneStockpile';
  stoneStock.visible = false;
  for (let i = 0; i < STOREHOUSE_STONE_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseStoneSegment';
    segment.visible = false;
    const x = 3.2 + (i % 3) * 0.55;
    const z = -4.5 + Math.floor(i / 3) * 0.5;
    addMesh(
      segment,
      new THREE.DodecahedronGeometry(0.38 + (i % 2) * 0.08, 0),
      stoneMaterial(i % 3 === 0 ? 'mortar' : 'mid'),
      new THREE.Vector3(x, 0.3 + Math.floor(i / 6) * 0.35, z),
      new THREE.Euler(i * 0.2, i * 0.31, 0),
    );
    stoneStock.add(segment);
  }
  group.add(stoneStock);

  addMesh(group, new THREE.BoxGeometry(3.4, 0.12, 2.2), timberMaterial('dark'), new THREE.Vector3(0, 0.08, -4.2));
  const firewoodStock = new THREE.Group();
  firewoodStock.name = 'StorehouseFirewoodStockpile';
  firewoodStock.visible = false;
  for (let i = 0; i < STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseFirewoodSegment';
    segment.visible = false;
    for (let row = 0; row < 3; row++) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.12, 0.15, 0.95, 7),
        timberMaterial('dark'),
        new THREE.Vector3(-1.25 + i * 0.48, 0.2 + row * 0.27, -4.2),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    firewoodStock.add(segment);
  }
  group.add(firewoodStock);

  const ironStock = new THREE.Group();
  ironStock.name = 'StorehouseIronStockpile';
  ironStock.visible = false;
  for (let i = 0; i < STOREHOUSE_IRON_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseIronSegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.DodecahedronGeometry(0.25 + (i % 2) * 0.04, 0),
      metalMaterial('iron'),
      new THREE.Vector3(-4.0 + (i % 2) * 0.46, 1.08 + Math.floor(i / 2) * 0.18, 4.12 + Math.floor(i / 2) * 0.4),
      new THREE.Euler(i * 0.27, i * 0.41, i * 0.13),
    );
    ironStock.add(segment);
  }
  group.add(ironStock);

  const clayStock = new THREE.Group();
  clayStock.name = 'StorehouseClayStockpile';
  clayStock.visible = false;
  for (let i = 0; i < STOREHOUSE_CLAY_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseClaySegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.BoxGeometry(0.42, 0.28, 0.36),
      residenceFacadeMaterial(i % 2 === 0 ? 'orange' : 'lightOrange'),
      new THREE.Vector3(-2.65 + (i % 2) * 0.48, 1.02 + Math.floor(i / 2) * 0.27, 4.18 + Math.floor(i / 2) * 0.38),
      new THREE.Euler(0, (i % 2 === 0 ? -0.09 : 0.12), 0),
    );
    clayStock.add(segment);
  }
  group.add(clayStock);

  const saltStock = new THREE.Group();
  saltStock.name = 'StorehouseSaltStockpile';
  saltStock.visible = false;
  for (let i = 0; i < STOREHOUSE_SALT_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'StorehouseSaltSegment';
    segment.visible = false;
    const x = 0.75 + (i % 2) * 0.52;
    const y = 1.2 + Math.floor(i / 2) * 0.42;
    const z = 4.18 + Math.floor(i / 2) * 0.32;
    const sack = addMesh(
      segment,
      new THREE.SphereGeometry(0.3, 8, 6),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(x, y, z),
    );
    sack.scale.set(0.84, 1.18, 0.8);
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.06, 0.1, 0.14, 7),
      timberMaterial('light'),
      new THREE.Vector3(x, y + 0.36, z),
    );
    saltStock.add(segment);
  }
  group.add(saltStock);
  addTradingPostProceedsChest(group);
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

  addStockedPolearmRack(group, {
    x: 4.45,
    z: 1.68,
    stockpileName: 'GuardhousePolearmStockpile',
    segmentName: 'GuardhousePolearmSegment',
    segmentCount: GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
  });
  const foodStockpile = new THREE.Group();
  foodStockpile.name = 'GuardhouseFoodStockpile';
  foodStockpile.visible = false;
  const foodCrates = [
    [5.55, 0.02, -0.1, 1.08],
    [3.75, 0.02, -0.52, 0.75],
  ] as const;
  for (let index = 0; index < GUARDHOUSE_FOOD_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'GuardhouseFoodSegment';
    const [x, y, z, scale] = foodCrates[index];
    addCrate(segment, x, y, z, scale);
    foodStockpile.add(segment);
  }
  group.add(foodStockpile);
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

export function createPalisadedRefugeMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Palisaded refuge';

  // A low packed-earth and local-stone footing keeps the enclosure plausible
  // on wet mountain ground without turning it into a masonry fort.
  const earthBerm = new THREE.Mesh(
    new THREE.TorusGeometry(7.45, 0.46, 6, 48),
    earth,
  );
  earthBerm.name = 'Refuge earth berm';
  earthBerm.rotation.x = Math.PI * 0.5;
  earthBerm.scale.y = 0.76;
  earthBerm.position.y = 0.18;
  earthBerm.receiveShadow = true;
  group.add(earthBerm);

  const stoneDrain = new THREE.Mesh(
    new THREE.TorusGeometry(7.1, 0.23, 5, 40),
    stoneMaterial('mid'),
  );
  stoneDrain.name = 'Refuge stone drainage ring';
  stoneDrain.rotation.x = Math.PI * 0.5;
  stoneDrain.scale.y = 0.76;
  stoneDrain.position.y = 0.27;
  stoneDrain.receiveShadow = true;
  group.add(stoneDrain);

  const stakePositions: Array<{ x: number; z: number; height: number }> = [];
  const stakeCount = 52;
  for (let index = 0; index < stakeCount; index += 1) {
    const angle = index / stakeCount * Math.PI * 2;
    const x = Math.sin(angle) * 7.45;
    const z = Math.cos(angle) * 5.65;
    // Leave a useful two-leaf opening on the road-facing side.
    if (z > 4.8 && Math.abs(x) < 1.65) continue;
    stakePositions.push({
      x,
      z,
      height: 2.45 + ((index * 17) % 5) * 0.08,
    });
  }

  // Two instanced draws keep the many irregular stakes cheap at settlement scale.
  const stakeGeometry = new THREE.CylinderGeometry(0.16, 0.21, 1, 6);
  const stakeMaterial = timberMaterial('weathered');
  const stakes = new THREE.InstancedMesh(
    stakeGeometry,
    stakeMaterial,
    stakePositions.length,
  );
  stakes.name = 'Refuge palisade stakes';
  const tipGeometry = new THREE.ConeGeometry(0.205, 0.48, 6);
  const tips = new THREE.InstancedMesh(
    tipGeometry,
    timberMaterial('dark'),
    stakePositions.length,
  );
  tips.name = 'Refuge palisade stake tips';
  const transform = new THREE.Object3D();
  for (let index = 0; index < stakePositions.length; index += 1) {
    const stake = stakePositions[index];
    transform.position.set(stake.x, 0.42 + stake.height * 0.5, stake.z);
    transform.rotation.set(0, index * 0.37, 0);
    transform.scale.set(1, stake.height, 1);
    transform.updateMatrix();
    stakes.setMatrixAt(index, transform.matrix);

    transform.position.y = 0.42 + stake.height + 0.24;
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    tips.setMatrixAt(index, transform.matrix);
  }
  stakes.instanceMatrix.needsUpdate = true;
  tips.instanceMatrix.needsUpdate = true;
  stakes.castShadow = true;
  stakes.receiveShadow = true;
  tips.castShadow = true;
  group.add(stakes, tips);

  // Rough horizontal bindings make the wall read as a built enclosure rather
  // than a decorative ring of isolated posts.
  const railMaterial = timberMaterial('dark');
  for (let segment = 0; segment < 12; segment += 1) {
    const angle = (segment + 0.5) / 12 * Math.PI * 2;
    if (Math.cos(angle) > 0.82) continue;
    const x = Math.sin(angle) * 7.05;
    const z = Math.cos(angle) * 5.35;
    const tangent = Math.atan2(
      Math.sin(angle) * 5.65,
      Math.cos(angle) * 7.45,
    );
    for (const y of [1.08, 2.08]) {
      addMesh(
        group,
        new THREE.BoxGeometry(3.55, 0.15, 0.16),
        railMaterial,
        new THREE.Vector3(x, y, z),
        new THREE.Euler(0, tangent, 0),
      );
    }
  }

  // Heavier gate posts and two open leaves keep the refuge visually permeable:
  // warned families can actually reach shelter during an incursion.
  for (const x of [-1.72, 1.72]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.25, 0.3, 3.25, 7),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.88, 5.25),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(4.0, 0.3, 0.34),
    timberMaterial('dark'),
    new THREE.Vector3(0, 3.42, 5.25),
  );
  for (const [x, yaw] of [[-2.38, -0.72], [2.38, 0.72]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.48, 2.35, 0.18),
      timberMaterial('weathered'),
      new THREE.Vector3(x, 1.42, 5.88),
      new THREE.Euler(0, yaw, 0),
    );
  }

  // A small covered emergency store and sleeping bench explain the refuge's
  // civilian role without adding an abstract garrison or logistics inventory.
  for (const x of [-3.55, 0.15]) {
    for (const z of [-2.85, 0.35]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.2, 2.45, 0.2),
        timberMaterial('dark'),
        new THREE.Vector3(x, 1.42, z),
      );
    }
  }
  addLeanToRoof(group, {
    width: 4.55,
    depth: 4.0,
    thickness: 0.18,
    material: shingleMaterial(),
    position: new THREE.Vector3(-1.7, 2.82, -1.25),
    pitch: 0.18,
    highEdge: 'negativeX',
    name: 'Refuge shelter roof',
  });
  addMesh(
    group,
    new THREE.BoxGeometry(3.3, 0.2, 0.7),
    timberMaterial('mid'),
    new THREE.Vector3(-1.65, 0.55, -2.25),
  );
  addCrate(group, -2.8, 0.04, -0.15, 0.82);
  addCrate(group, -1.65, 0.04, 0.12, 0.68);
  addMesh(
    group,
    new THREE.BoxGeometry(3.5, 0.08, 2.55),
    earth,
    new THREE.Vector3(-1.7, 0.06, -1.25),
  );

  return group;
}
