import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stackedTimberWallMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addBarrel,
  addDarkOpening,
  addGableShell,
  addHippedRoof,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';
import {
  CLOTH_STOCKPILE_VISUAL_SEGMENTS,
  FLAX_STOCKPILE_VISUAL_SEGMENTS,
  LINEN_STOCKPILE_VISUAL_SEGMENTS,
  YARN_STOCKPILE_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS,
  SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_SALT_VISUAL_SEGMENTS,
} from '../foodStockpileVisuals.ts';
import {
  CARPENTER_IRONWORK_VISUAL_SEGMENTS,
  CARPENTER_POLEARM_VISUAL_SEGMENTS,
  CARPENTER_TIMBER_VISUAL_SEGMENTS,
} from '../armoryStockpileVisuals.ts';
import {
  APIARY_HONEY_VISUAL_SEGMENTS,
  THRESHING_GRAIN_VISUAL_SEGMENTS,
} from '../seasonalStockpileVisuals.ts';
import {
  MONASTERY_CIDER_VISUAL_SEGMENTS,
  MONASTERY_FOOD_VISUAL_SEGMENTS,
  MONASTERY_HONEY_VISUAL_SEGMENTS,
  MONASTERY_MEAD_VISUAL_SEGMENTS,
  MONASTERY_WINE_VISUAL_SEGMENTS,
} from '../monasteryStockpileVisuals.ts';
import { STOREHOUSE_HAUL_PER_WORKER } from '../../generated/gameBalance.ts';
import { addStockedPolearmRack } from './polearmRack.ts';
import { createManureStockpile } from './manureStockpileMesh.ts';
import { createMonasteryEstateMesh } from './monasteryEstateMesh.ts';
import {
  MONASTERY_EXTENSION_GUESTHOUSE,
  MONASTERY_EXTENSION_INFIRMARY,
  MONASTERY_EXTENSION_SCRIPTORIUM,
  monasteryHasExtension,
} from '../monasteryEstate.ts';
import {
  monasteryCoreModule,
  type MonasteryPrecinctPlan,
} from './monasteryPrecinctPlan.ts';

export const LOCAL_RECEIPT_VISUAL_SEGMENTS = 3;
export const LOCAL_RECEIPT_VISUAL_CAPACITY = STOREHOUSE_HAUL_PER_WORKER;

const earth = sharedBuildingDetailMaterial('earth');
const canvas = sharedBuildingDetailMaterial('canvas');
const copper = sharedBuildingDetailMaterial('brass');
const hiveBlue = sharedBuildingDetailMaterial('paintBlue');
const hiveRed = sharedBuildingDetailMaterial('paintRed');

function addChimney(group: THREE.Group, x: number, z: number, height = 4.8): void {
  addMesh(group, new THREE.BoxGeometry(0.72, height, 0.72), stoneMaterial('mid'), new THREE.Vector3(x, height * 0.5, z));
  addMesh(group, new THREE.BoxGeometry(0.92, 0.18, 0.92), stoneMaterial('mid'), new THREE.Vector3(x, height + 0.02, z));
}

function addSack(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(group, new THREE.SphereGeometry(0.45 * scale, 8, 6), canvas, new THREE.Vector3(x, 0.42 * scale, z), new THREE.Euler(0, 0, -0.08), new THREE.Vector3(0.82, 1.35, 0.72));
  addMesh(group, new THREE.CylinderGeometry(0.07 * scale, 0.14 * scale, 0.24 * scale, 7), canvas, new THREE.Vector3(x, 0.94 * scale, z));
}

function addSaltSack(group: THREE.Group, scale = 1): void {
  const saltCanvas = canvas;
  const body = addMesh(
    group,
    new THREE.SphereGeometry(0.31 * scale, 8, 6),
    saltCanvas,
    new THREE.Vector3(0, 0.32 * scale, 0),
  );
  body.scale.set(0.84, 1.2, 0.8);
  addMesh(
    group,
    new THREE.CylinderGeometry(0.06 * scale, 0.11 * scale, 0.15 * scale, 7),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.71 * scale, 0),
  );
}

function addPotteryVessel(group: THREE.Group, scale = 1): void {
  const firedClay = sharedBuildingDetailMaterial('firedClay');
  addMesh(
    group,
    new THREE.SphereGeometry(0.23 * scale, 9, 7),
    firedClay,
    new THREE.Vector3(0, 0.25 * scale, 0),
    undefined,
    new THREE.Vector3(1, 1.12, 1),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.1 * scale, 0.15 * scale, 0.23 * scale, 9, 1, true),
    firedClay,
    new THREE.Vector3(0, 0.49 * scale, 0),
  );
}

function addHoneyJar(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.2 * scale, 0.27 * scale, 0.48 * scale, 10),
    residenceFacadeMaterial('yellow'),
    new THREE.Vector3(0, 0.25 * scale, 0),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.15 * scale, 0.035 * scale, 5, 10),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.51 * scale, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function addWineCask(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.68 * scale, 10),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.32 * scale, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (const x of [-0.25, 0.25]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.3 * scale, 0.022 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.32 * scale, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
}

type StockPropPlacement = readonly [
  x: number,
  y: number,
  z: number,
  scale: number,
];

function addSegmentedStockProps(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly StockPropPlacement[],
  addProp: (segment: THREE.Group, scale: number) => void,
): void {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  for (const [x, y, z, scale] of placements) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.visible = false;
    segment.position.set(x, y, z);
    addProp(segment, scale);
    stockpile.add(segment);
  }
  group.add(stockpile);
}

function createBareManureStockpile(
  name: string,
  x: number,
  z: number,
): THREE.Group {
  const stockpile = createManureStockpile(name, x, z);
  stockpile.traverse((object) => {
    if (!(object instanceof THREE.Group) || object.name !== 'ManureStockSegment') return;
    for (const child of [...object.children]) {
      if (child instanceof THREE.Mesh && child.material !== earth) object.remove(child);
    }
  });
  return stockpile;
}

function addCartWheel(group: THREE.Group, x: number, y: number, z: number, radius: number): void {
  addMesh(group, new THREE.TorusGeometry(radius, 0.1, 7, 18), timberMaterial('dark'), new THREE.Vector3(x, y, z), new THREE.Euler(0, Math.PI * 0.5, 0));
  for (let i = 0; i < 8; i++) {
    addMesh(group, new THREE.BoxGeometry(0.09, radius * 1.72, 0.09), timberMaterial('weathered'), new THREE.Vector3(x, y, z), new THREE.Euler(i * Math.PI / 8, 0, Math.PI * 0.5));
  }
  addMesh(group, new THREE.CylinderGeometry(0.17, 0.17, 0.2, 9), timberMaterial('dark'), new THREE.Vector3(x, y, z), new THREE.Euler(0, 0, Math.PI * 0.5));
}

function addCross(group: THREE.Group, x: number, y: number, z: number, scale = 1): void {
  addMesh(group, new THREE.BoxGeometry(0.12 * scale, 1.05 * scale, 0.12 * scale), metalMaterial('iron'), new THREE.Vector3(x, y, z));
  addMesh(group, new THREE.BoxGeometry(0.64 * scale, 0.12 * scale, 0.12 * scale), metalMaterial('iron'), new THREE.Vector3(x, y + 0.18 * scale, z));
}

function addReceiptLockboxes(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly (readonly [number, number, number])[],
): void {
  const container = new THREE.Group();
  container.name = containerName;
  container.visible = false;
  placements.forEach(([x, y, z], index) => {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.visible = false;
    segment.position.set(x, y, z);
    addMesh(
      segment,
      new THREE.BoxGeometry(0.58, 0.4, 0.48),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(0, 0.22, 0),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.24, 0.58, 8, 1, false, 0, Math.PI),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.45, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.065, 0.46, 0.52),
      metalMaterial('iron'),
      new THREE.Vector3(0, 0.3, 0),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.13, 0.17, 0.08),
      copper,
      new THREE.Vector3(0, 0.3, 0.28),
    );
    container.add(segment);
  });
  group.add(container);
}

function addMonasteryTreasuryChest(group: THREE.Group): void {
  addReceiptLockboxes(
    group,
    'MonasteryTreasuryChest',
    'MonasteryGoldSegment',
    [
      [-4.15, 0.2, 4.55],
      [-4.82, 0.12, 4.5],
      [-3.48, 0.12, 4.5],
    ],
  );
}


export function createThreshingBarnMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Threshing barn';
  const shell = addGableShell(group, { width: 10.8, depth: 7.2, stoneHeight: 0.58, wallHeight: 3.25, ridgeHeight: 3.0, wallMaterial: timberMaterial('weathered'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -3.1, 0.62, shell.frontZ + 0.03, 1.25, 2.45);
  addPlankDoor(group, 0, 0.62, shell.frontZ + 0.03, 2.6, 2.7);
  addDarkOpening(group, 0, 0.66, -shell.frontZ - 0.03, 3.7, 2.85);
  for (const x of [-4.2, 4.2]) addSmallWindow(group, x, 2.35, shell.frontZ + 0.03, 0.72, 0.8);
  addSegmentedStockProps(
    group,
    'ThreshingGrainStockpile',
    'ThreshingGrainSegment',
    [-4.9, -4.15, 4.95, 5.55]
      .slice(0, THRESHING_GRAIN_VISUAL_SEGMENTS)
      .map((x) => [x, 0, 4.35, 1.05] as const),
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'ThreshingFlaxStockpile',
    'ThreshingFlaxSegment',
    ([
      [-4.85, 0, -4.35, 1.0],
      [-4.08, 0, -4.42, 0.9],
      [4.78, 0, -4.35, 0.95],
      [5.45, 0, -4.4, 0.82],
    ] as const).slice(0, FLAX_STOCKPILE_VISUAL_SEGMENTS),
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  group.add(createBareManureStockpile('ThreshingManureStockpile', 5.35, 2.65));
  group.add(createCivilianToolStockpile(new THREE.Vector3(-5.45, 0, 2.5), 0.22));
  // A low handcart and flails make the yard read as threshing rather than storage.
  addMesh(group, new THREE.BoxGeometry(2.5, 0.42, 1.45), timberMaterial('weathered'), new THREE.Vector3(3.1, 0.82, 4.65));
  addCartWheel(group, 1.82, 0.67, 4.65, 0.66);
  addCartWheel(group, 4.38, 0.67, 4.65, 0.66);
  for (let i = 0; i < 3; i++) addMesh(group, new THREE.CylinderGeometry(0.045, 0.045, 2.4, 6), timberMaterial('light'), new THREE.Vector3(-3.2 + i * 0.34, 0.55, 4.4), new THREE.Euler(0.12, 0, 1.18));
  return group;
}

function addMonasteryCloisterArcade(
  parent: THREE.Group,
  axis: 'x' | 'z',
  fixed: number,
  start: number,
  end: number,
  name: string,
): void {
  const arcade = new THREE.Group();
  arcade.name = name;
  arcade.userData.architectureModule = 'cloister-arcade';
  const bays = Math.max(2, Math.round(Math.abs(end - start) / 1.55));
  for (let index = 0; index <= bays; index += 1) {
    const along = THREE.MathUtils.lerp(start, end, index / bays);
    const column = addMesh(
      arcade,
      new THREE.BoxGeometry(0.2, 2.05, 0.2),
      stoneMaterial('light'),
      axis === 'x'
        ? new THREE.Vector3(along, 1.03, fixed)
        : new THREE.Vector3(fixed, 1.03, along),
    );
    column.name = 'Monastery cloister pier';
    if (index === bays) continue;
    const next = THREE.MathUtils.lerp(start, end, (index + 1) / bays);
    const midpoint = (along + next) * 0.5;
    const radius = Math.abs(next - along) * 0.42;
    const arch = addMesh(
      arcade,
      new THREE.TorusGeometry(radius, 0.1, 5, 14, Math.PI),
      stoneMaterial('light'),
      axis === 'x'
        ? new THREE.Vector3(midpoint, 1.36, fixed)
        : new THREE.Vector3(fixed, 1.36, midpoint),
      axis === 'x' ? new THREE.Euler() : new THREE.Euler(0, Math.PI * 0.5, 0),
    );
    arch.name = 'Monastery cloister round arch';
  }
  parent.add(arcade);
}

function monasteryMeshDiagnostics(root: THREE.Object3D): { triangleCount: number; meshCount: number } {
  let triangleCount = 0;
  let meshCount = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const index = object.geometry.getIndex();
    const positions = object.geometry.getAttribute('position');
    triangleCount += index ? index.count / 3 : (positions?.count ?? 0) / 3;
  });
  return { triangleCount: Math.round(triangleCount), meshCount };
}

export function createMonasteryMesh(
  extensions = 0,
  orchardPlanting = 0,
  croftPlanting = 0,
  orchardMaturity = 2,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Pauline monastery';
  const estate = createMonasteryEstateMesh(
    extensions,
    orchardPlanting,
    croftPlanting,
    orchardMaturity,
  );
  const plan = estate.userData.architecturePlan as MonasteryPrecinctPlan;
  group.add(estate);
  group.userData.architecturePlan = plan;

  const churchPlan = monasteryCoreModule(plan, 'church-range');
  const churchRange = new THREE.Group();
  churchRange.name = 'Monastery church and conventual range';
  churchRange.position.set(churchPlan.centerX, 0, churchPlan.centerZ);
  churchRange.userData.architectureModule = churchPlan.id;
  const main = addGableShell(churchRange, {
    width: churchPlan.width,
    depth: churchPlan.depth,
    stoneHeight: 1.55,
    wallHeight: 3.7,
    ridgeHeight: 2.85,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: tileMaterial(0),
  });
  addPlankDoor(churchRange, 0, 1.58, main.frontZ + 0.03, 1.16, 2.12);
  for (const x of [-5.25, -2.35, 1.15, 4.35]) for (const y of [2.55, 4.28]) {
    addSmallWindow(churchRange, x, y, main.frontZ + 0.03, 0.66, 0.9);
  }
  for (const x of [-6.85, 6.85]) {
    addMesh(churchRange, new THREE.BoxGeometry(0.46, 2.15, 0.72), stoneMaterial('light'), new THREE.Vector3(x, 1.08, main.frontZ - 0.18)).name = 'Monastery church range buttress';
    addMesh(churchRange, new THREE.BoxGeometry(0.46, 2.15, 0.72), stoneMaterial('light'), new THREE.Vector3(x, 1.08, -main.frontZ + 0.18)).name = 'Monastery church range buttress';
  }
  group.add(churchRange);

  const scriptoriumPlan = monasteryCoreModule(plan, 'scriptorium-wing');
  const scriptoriumWing = new THREE.Group();
  scriptoriumWing.name = 'Monastery scriptorium and records wing';
  scriptoriumWing.position.set(scriptoriumPlan.centerX, 0, scriptoriumPlan.centerZ);
  scriptoriumWing.userData.architectureModule = 'scriptorium-wing';
  scriptoriumWing.userData.disasterResilience = 'preserved plans and ledgers reduce fire reconstruction materials';
  const scriptorium = addGableShell(scriptoriumWing, {
    width: scriptoriumPlan.width,
    depth: scriptoriumPlan.depth,
    stoneHeight: 1.35,
    wallHeight: 3.55,
    ridgeHeight: 2.55,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: tileMaterial(1),
  });
  addPlankDoor(scriptoriumWing, 0, 1.38, scriptorium.frontZ + 0.03, 0.9, 1.95);
  // Tall paired windows express the daylight-dependent writing room; the
  // compact stone undercroft below reads as the fire-resistant record vault.
  for (const x of [-1.05, 1.05]) {
    for (const y of [2.3, 3.65]) {
      addSmallWindow(scriptoriumWing, x, y, scriptorium.frontZ + 0.03, 0.62, 0.82);
      addSmallWindow(scriptoriumWing, x, y, scriptorium.centerZ - scriptorium.halfD - 0.03, 0.62, 0.82);
    }
  }
  for (const x of [-2.25, 2.25]) {
    addMesh(scriptoriumWing, new THREE.BoxGeometry(0.36, 1.75, 0.56), stoneMaterial('light'), new THREE.Vector3(x, 0.88, scriptorium.frontZ - 0.12)).name = 'Scriptorium vault buttress';
  }
  const recordsChest = new THREE.Group();
  recordsChest.name = 'Scriptorium duplicate records chest';
  recordsChest.position.set(-0.8, 0, scriptorium.frontZ + 1.05);
  addMesh(recordsChest, new THREE.BoxGeometry(1.35, 0.72, 0.78), timberMaterial('dark'), new THREE.Vector3(0, 0.37, 0));
  for (const x of [-0.48, 0.48]) addMesh(recordsChest, new THREE.BoxGeometry(0.08, 0.76, 0.82), metalMaterial('iron'), new THREE.Vector3(x, 0.38, 0));
  scriptoriumWing.add(recordsChest);
  if (monasteryHasExtension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM)) {
    group.add(scriptoriumWing);
  } else {
    addMesh(group, new THREE.BoxGeometry(scriptoriumPlan.width, 0.06, scriptoriumPlan.depth), earth, new THREE.Vector3(scriptoriumPlan.centerX, 0.04, scriptoriumPlan.centerZ)).name = 'Reserved scriptorium foundation plot';
  }

  const infirmaryPlan = monasteryCoreModule(plan, 'infirmary-wing');
  const infirmaryWing = new THREE.Group();
  infirmaryWing.name = 'Monastery infirmary wing';
  infirmaryWing.position.set(infirmaryPlan.centerX, 0, infirmaryPlan.centerZ);
  infirmaryWing.userData.architectureModule = infirmaryPlan.id;
  const wing = addGableShell(infirmaryWing, { width: infirmaryPlan.width, depth: infirmaryPlan.depth, stoneHeight: 1.1, wallHeight: 3.35, ridgeHeight: 2.45, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: tileMaterial(1) });
  addPlankDoor(infirmaryWing, 0, 1.14, wing.frontZ + 0.03, 0.94, 1.95);
  for (const x of [-1.2, 0, 1.2]) addSmallWindow(infirmaryWing, x, 2.35, wing.centerZ - wing.halfD - 0.03, 0.64, 0.86);
  if (monasteryHasExtension(extensions, MONASTERY_EXTENSION_INFIRMARY)) {
    group.add(infirmaryWing);
  } else {
    addMesh(group, new THREE.BoxGeometry(infirmaryPlan.width, 0.06, infirmaryPlan.depth), earth, new THREE.Vector3(infirmaryPlan.centerX, 0.04, infirmaryPlan.centerZ)).name = 'Reserved infirmary foundation plot';
  }

  const guesthousePlan = monasteryCoreModule(plan, 'guesthouse-wing');
  if (monasteryHasExtension(extensions, MONASTERY_EXTENSION_GUESTHOUSE)) {
    const guesthouse = new THREE.Group();
    guesthouse.name = 'Monastery guesthouse';
    guesthouse.position.set(guesthousePlan.centerX, 0, guesthousePlan.centerZ);
    guesthouse.userData.architectureModule = guesthousePlan.id;
    const guestShell = addGableShell(guesthouse, {
      width: guesthousePlan.width,
      depth: guesthousePlan.depth,
      stoneHeight: 1.15,
      wallHeight: 3.15,
      ridgeHeight: 2.35,
      wallMaterial: residenceFacadeMaterial('white'),
      roofMaterial: tileMaterial(2),
    });
    addPlankDoor(guesthouse, 0, 1.2, guestShell.frontZ + 0.03, 1.1, 2.0);
    for (const x of [-2.8, -0.95, 0.95, 2.8]) {
      addSmallWindow(guesthouse, x, 2.25, guestShell.frontZ + 0.03, 0.66, 0.82);
    }
    group.add(guesthouse);
  } else {
    addMesh(group, new THREE.BoxGeometry(guesthousePlan.width, 0.06, guesthousePlan.depth), earth, new THREE.Vector3(guesthousePlan.centerX, 0.04, guesthousePlan.centerZ)).name = 'Reserved guesthouse foundation plot';
  }

  const courtPlan = monasteryCoreModule(plan, 'cloister-court');
  const court = new THREE.Group();
  court.name = 'Monastery enclosed cloister court';
  court.userData.architectureModule = courtPlan.id;
  addMesh(
    court,
    new THREE.BoxGeometry(courtPlan.width - 1.8, 0.05, courtPlan.depth - 1.5),
    earth,
    new THREE.Vector3(courtPlan.centerX, 0.055, courtPlan.centerZ),
  ).name = 'Monastery cloister court surface';
  const rearWalkZ = courtPlan.centerZ - courtPlan.depth * 0.5 + 0.65;
  const frontWalkZ = courtPlan.centerZ + courtPlan.depth * 0.5 - 0.65;
  const westWalkX = courtPlan.centerX - courtPlan.width * 0.5 + 0.65;
  const eastWalkX = courtPlan.centerX + courtPlan.width * 0.5 - 0.65;

  addLeanToRoof(group, {
    width: courtPlan.width - 1.1,
    depth: 1.55,
    thickness: 0.18,
    material: tileMaterial(1),
    position: new THREE.Vector3(courtPlan.centerX, 2.3, rearWalkZ),
    pitch: 0.16,
    highEdge: 'negativeZ',
    name: 'Monastery rear cloister roof',
  });
  addLeanToRoof(group, {
    width: courtPlan.width - 1.1,
    depth: 1.55,
    thickness: 0.18,
    material: tileMaterial(1),
    position: new THREE.Vector3(courtPlan.centerX, 2.3, frontWalkZ),
    pitch: 0.16,
    highEdge: 'positiveZ',
    name: 'Monastery front cloister roof',
  });
  addLeanToRoof(group, {
    width: 1.55,
    depth: courtPlan.depth - 1.25,
    thickness: 0.18,
    material: tileMaterial(1),
    position: new THREE.Vector3(westWalkX, 2.3, courtPlan.centerZ),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: 'Monastery west cloister roof',
  });
  addLeanToRoof(group, {
    width: 1.55,
    depth: courtPlan.depth - 1.25,
    thickness: 0.18,
    material: tileMaterial(1),
    position: new THREE.Vector3(eastWalkX, 2.3, courtPlan.centerZ),
    pitch: 0.16,
    highEdge: 'positiveX',
    name: 'Monastery east cloister roof',
  });
  addMonasteryCloisterArcade(group, 'x', rearWalkZ + 0.18, westWalkX, eastWalkX, 'Monastery rear cloister arcade');
  addMonasteryCloisterArcade(group, 'x', frontWalkZ - 0.18, westWalkX, eastWalkX, 'Monastery front cloister arcade');
  addMonasteryCloisterArcade(group, 'z', westWalkX + 0.18, rearWalkZ, frontWalkZ, 'Monastery west cloister arcade');
  addMonasteryCloisterArcade(group, 'z', eastWalkX - 0.18, rearWalkZ, frontWalkZ, 'Monastery east cloister arcade');

  for (const x of [courtPlan.centerX - 3.2, courtPlan.centerX, courtPlan.centerX + 3.2]) {
    const z = courtPlan.centerZ;
    const bed = addMesh(group, new THREE.BoxGeometry(2.0, 0.18, 1.15), earth, new THREE.Vector3(x, 0.09, z));
    bed.name = 'Monastery cloister SeedThree planting bed';
    bed.userData.seedThreePlantingSurface = true;
  }
  for (const x of [courtPlan.centerX - 3.0, courtPlan.centerX + 3.0]) {
    addMesh(group, new THREE.BoxGeometry(4.6, 0.16, 1.0), timberMaterial('weathered'), new THREE.Vector3(x, 0.82, courtPlan.centerZ)).name = 'Monastery feast trestle table';
    for (const z of [courtPlan.centerZ - 1.0, courtPlan.centerZ + 1.0]) {
      addMesh(group, new THREE.BoxGeometry(4.6, 0.14, 0.38), timberMaterial('dark'), new THREE.Vector3(x, 0.48, z)).name = 'Monastery feast bench';
    }
  }
  group.add(court);

  addMesh(group, new THREE.BoxGeometry(2.1, 2.25, 2.1), stoneMaterial('light'), new THREE.Vector3(churchPlan.centerX, 6.4, churchPlan.centerZ));
  addHippedRoof(group, {
    width: 2.65,
    depth: 2.65,
    eaveY: 7.525,
    peakY: 9.875,
    thickness: 0.12,
    material: tileMaterial(2),
    centerX: churchPlan.centerX,
    centerZ: churchPlan.centerZ,
    name: 'Monastery church joined clay-tile tower cap',
  });
  addCross(group, churchPlan.centerX, 10.2, churchPlan.centerZ, 0.85);
  addSegmentedStockProps(
    group,
    'MonasteryFoodStockpile',
    'MonasteryFoodSegment',
    ([
      [-5.9, 0, 4.95, 1.05],
      [-5.15, 0, 5.05, 0.92],
      [-4.55, 0, 4.92, 0.82],
    ] as const).slice(0, MONASTERY_FOOD_VISUAL_SEGMENTS),
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'MonasteryCiderStockpile',
    'MonasteryCiderSegment',
    ([
      [3.45, 0, 4.95, 0.9],
      [4.1, 0, 4.92, 0.78],
      [3.75, 0, 5.55, 0.7],
    ] as const).slice(0, MONASTERY_CIDER_VISUAL_SEGMENTS),
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'MonasteryMeadStockpile',
    'MonasteryMeadSegment',
    ([
      [2.05, 0, 4.95, 0.9],
      [2.7, 0, 4.92, 0.78],
      [2.35, 0, 5.55, 0.7],
    ] as const).slice(0, MONASTERY_MEAD_VISUAL_SEGMENTS),
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'MonasteryHoneyStockpile',
    'MonasteryHoneySegment',
    ([
      [-0.55, 0, 4.95, 1.35],
      [0.0, 0, 4.98, 1.18],
      [0.48, 0, 4.92, 1.02],
    ] as const).slice(0, MONASTERY_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJar(segment, scale),
  );
  addSegmentedStockProps(
    group,
    'MonasteryWineStockpile',
    'MonasteryWineSegment',
    ([
      [0.98, 0, 5.0, 0.92],
      [1.55, 0, 4.95, 0.8],
      [1.28, 0, 5.55, 0.7],
    ] as const).slice(0, MONASTERY_WINE_VISUAL_SEGMENTS),
    (segment, scale) => addWineCask(segment, scale),
  );
  addMonasteryTreasuryChest(group);
  const diagnostics = monasteryMeshDiagnostics(group);
  plan.diagnostics.triangleCount = diagnostics.triangleCount;
  plan.diagnostics.meshCount = diagnostics.meshCount;
  group.userData.architectureDiagnostics = plan.diagnostics;
  return group;
}

export function createBreweryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Brewery';
  const shell = addGableShell(group, { width: 8.7, depth: 6.5, stoneHeight: 1.05, wallHeight: 3.05, ridgeHeight: 2.45, wallMaterial: residenceFacadeMaterial('lightOrange'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -1.8, 1.08, shell.frontZ + 0.03, 1.22, 2.05);
  addSmallWindow(group, 1.45, 2.35, shell.frontZ + 0.03, 0.88, 1.05);
  addChimney(group, 2.7, -1.35, 5.2);
  addSegmentedStockProps(
    group,
    'BreweryAleStockpile',
    'BreweryAleSegment',
    [[-3.9, 0, 4.1, 1], [-2.9, 0, 4.25, 0.85], [3.5, 0, 3.9, 1.1]],
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  // Open brewing bay with a copper mash kettle and malt sacks.
  for (const x of [2.45, 4.55]) addMesh(group, new THREE.BoxGeometry(0.18, 2.45, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 1.22, 4.2));
  addLeanToRoof(group, {
    width: 2.65,
    depth: 2.45,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(3.5, 2.58, 4.1),
    pitch: 0.13,
    highEdge: 'negativeZ',
    name: 'Brewery open-bay roof',
  });
  addMesh(group, new THREE.SphereGeometry(0.72, 12, 8), copper, new THREE.Vector3(3.45, 0.96, 4.15), new THREE.Euler(), new THREE.Vector3(1, 1.18, 1));
  addMesh(group, new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), copper, new THREE.Vector3(3.45, 2.0, 4.15));
  addSegmentedStockProps(
    group,
    'BreweryBarleyStockpile',
    'BreweryBarleySegment',
    [[1.7, 0, 4.3, 0.9], [1.15, 0, 4.25, 0.75]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'BreweryMaltStockpile',
    'BreweryMaltSegment',
    [[4.75, 0, 3.75, 0.86], [5.2, 0, 4.15, 0.72]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  return group;
}

export function createBakeryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Village bakery';
  const shell = addGableShell(group, {
    width: 7.4,
    depth: 5.8,
    stoneHeight: 1.15,
    wallHeight: 2.7,
    ridgeHeight: 2.2,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -1.45, 1.18, shell.frontZ + 0.03, 1.0, 1.88);
  addSmallWindow(group, 1.35, 2.18, shell.frontZ + 0.03, 0.78, 0.92);

  // A masonry oven and tall flue keep the workshop visually distinct from
  // the raised crop store next door.
  addMesh(
    group,
    new THREE.BoxGeometry(2.35, 1.45, 1.9),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 0.74, 3.55),
  );
  addMesh(
    group,
    new THREE.SphereGeometry(1.14, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 1.42, 3.55),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.78, 0.72, 0.08),
    timberMaterial('dark'),
    new THREE.Vector3(2.15, 0.78, 4.51),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, 3.9, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(2.75, 4.35, 1.45),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.22, 0.92),
    stoneMaterial('mortar'),
    new THREE.Vector3(2.75, 6.35, 1.45),
  );
  addSegmentedStockProps(
    group,
    'BakeryFoodStockpile',
    'BakeryFoodSegment',
    [
      [-2.75, 0, 3.55, 0.92],
      [-2.05, 0, 3.75, 0.82],
      [-3.2, 0, 2.85, 0.74],
    ],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  return group;
}

export function createSmokehouseMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Smokehouse';
  const shell = addGableShell(group, { width: 6.4, depth: 5.5, stoneHeight: 1.5, wallHeight: 2.25, ridgeHeight: 2.2, wallMaterial: stackedTimberWallMaterial(), roofMaterial: shingleMaterial(), stoneGroundFloor: true });
  addPlankDoor(group, -1.0, 1.53, shell.frontZ + 0.03, 0.92, 1.78);
  addSmallWindow(group, 1.25, 2.55, shell.frontZ + 0.03, 0.58, 0.72);
  addChimney(group, 1.85, -1.4, 5.4);
  const smoke = addMesh(group, new THREE.ConeGeometry(0.42, 1.5, 8), sharedBuildingDetailMaterial('smoke'), new THREE.Vector3(1.85, 6.2, -1.4));
  smoke.name = 'Smoke plume';
  for (let i = -2; i <= 2; i++) addMesh(group, new THREE.BoxGeometry(0.08, 0.36, 0.08), metalMaterial('iron'), new THREE.Vector3(i * 0.2, 3.15, shell.frontZ + 0.08));
  // Fuel lean-to and restrained drying rail communicate the complete preservation process.
  addLeanToRoof(group, {
    width: 2.35,
    depth: 2.25,
    thickness: 0.12,
    material: shingleMaterial(),
    position: new THREE.Vector3(-4.2, 2.05, 0),
    pitch: 0.14,
    highEdge: 'positiveX',
    name: 'Smokehouse fuel lean-to roof',
  });
  for (const z of [-0.9, 0.9]) addMesh(group, new THREE.BoxGeometry(0.16, 2.0, 0.16), timberMaterial('dark'), new THREE.Vector3(-5.1, 1.0, z));
  const fuelStockpile = new THREE.Group();
  fuelStockpile.name = 'SmokehouseFirewoodStockpile';
  fuelStockpile.visible = false;
  for (let row = 0; row < SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS; row++) {
    const segment = new THREE.Group();
    segment.name = 'SmokehouseFirewoodSegment';
    segment.visible = false;
    for (let i = 0; i < 4; i++) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.13, 0.16, 1.05, 8),
        timberMaterial(i % 2 ? 'light' : 'mid'),
        new THREE.Vector3(-4.1 + i * 0.42, 0.22 + row * 0.34, 0.2),
      );
    }
    fuelStockpile.add(segment);
  }
  group.add(fuelStockpile);
  addMesh(group, new THREE.BoxGeometry(2.55, 0.1, 0.1), timberMaterial('weathered'), new THREE.Vector3(0, 1.85, 4.0));
  const rawFoodStockpile = new THREE.Group();
  rawFoodStockpile.name = 'SmokehouseFreshFoodStockpile';
  rawFoodStockpile.visible = false;
  for (let index = 0; index < SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'SmokehouseFreshFoodSegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.TorusGeometry(0.14, 0.045, 5, 9, Math.PI * 1.65),
      sharedBuildingDetailMaterial('paintRed'),
      new THREE.Vector3((-2 + index) * 0.42, 1.46, 4.0),
    );
    rawFoodStockpile.add(segment);
  }
  group.add(rawFoodStockpile);
  addSegmentedStockProps(
    group,
    'SmokehouseSaltStockpile',
    'SmokehouseSaltSegment',
    ([
      [3.9, 0, -1.55, 0.95],
      [4.45, 0, -1.3, 0.82],
      [4.08, 0, -0.76, 0.72],
    ] as const).slice(0, SMOKEHOUSE_SALT_VISUAL_SEGMENTS),
    (segment, scale) => addSaltSack(segment, scale),
  );
  addSegmentedStockProps(
    group,
    'SmokehousePotteryStockpile',
    'SmokehousePotterySegment',
    ([
      [3.88, 0, 1.0, 1.05],
      [4.45, 0, 1.28, 0.92],
      [4.02, 0, 1.78, 0.8],
    ] as const).slice(0, SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS),
    (segment, scale) => addPotteryVessel(segment, scale),
  );
  const preservedFoodStockpile = new THREE.Group();
  preservedFoodStockpile.name = 'SmokehousePreservedFoodStockpile';
  preservedFoodStockpile.visible = false;
  for (let index = 0; index < SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'SmokehousePreservedFoodSegment';
    segment.visible = false;
    addMesh(
      segment,
      new THREE.TorusGeometry(0.14, 0.045, 5, 9, Math.PI * 1.65),
      sharedBuildingDetailMaterial('paintRed'),
      new THREE.Vector3(index * 0.42, 1.46, 4.0),
    );
    preservedFoodStockpile.add(segment);
  }
  group.add(preservedFoodStockpile);
  return group;
}

const GRANARY_ROOF_SILO_PLAN = Object.freeze({
  centerX: 1.8,
  centerZ: -0.45,
  bodyBaseY: 4.12,
  bodyHeight: 3.12,
  bodyRadiusBottom: 1.34,
  bodyRadiusTop: 1.2,
  capRadius: 1.72,
  capHeight: 1.52,
  bandHeights: Object.freeze([4.52, 5.55, 6.58, 7.12]),
});

function addGranaryRoofSilo(group: THREE.Group): void {
  const plan = GRANARY_ROOF_SILO_PLAN;
  const silo = new THREE.Group();
  silo.name = 'Granary roof grain silo';
  silo.position.set(plan.centerX, 0, plan.centerZ);
  silo.userData.architectureRole = 'roof-grain-silo';
  silo.userData.massingPlan = {
    bodyBaseY: plan.bodyBaseY,
    bodyTopY: plan.bodyBaseY + plan.bodyHeight,
    capTopY: plan.bodyBaseY + plan.bodyHeight + plan.capHeight,
  };
  group.add(silo);

  const body = addMesh(
    silo,
    new THREE.CylinderGeometry(
      plan.bodyRadiusTop,
      plan.bodyRadiusBottom,
      plan.bodyHeight,
      8,
    ),
    timberMaterial('weathered'),
    new THREE.Vector3(0, plan.bodyBaseY + plan.bodyHeight * 0.5, 0),
    new THREE.Euler(0, Math.PI * 0.125, 0),
  );
  body.name = 'Granary roof silo body';

  // Projecting timber hoops and corner staves keep the octagonal store tied
  // to the longhouse framing instead of reading as a modern metal tank.
  for (const y of plan.bandHeights) {
    const t = THREE.MathUtils.clamp((y - plan.bodyBaseY) / plan.bodyHeight, 0, 1);
    const radius = THREE.MathUtils.lerp(plan.bodyRadiusBottom, plan.bodyRadiusTop, t);
    const band = addMesh(
      silo,
      new THREE.CylinderGeometry(radius + 0.075, radius + 0.075, 0.14, 8),
      timberMaterial('dark'),
      new THREE.Vector3(0, y, 0),
      new THREE.Euler(0, Math.PI * 0.125, 0),
    );
    band.name = 'Granary roof silo timber hoop';
  }
  for (const angle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
    const postRadius = 1.27;
    const post = addMesh(
      silo,
      new THREE.BoxGeometry(0.14, plan.bodyHeight - 0.28, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(
        Math.cos(angle) * postRadius,
        plan.bodyBaseY + plan.bodyHeight * 0.5,
        Math.sin(angle) * postRadius,
      ),
      new THREE.Euler(0, -angle, 0),
    );
    post.name = 'Granary roof silo corner stave';
  }

  const ventY = plan.bodyBaseY + plan.bodyHeight * 0.62;
  const ventZ = plan.bodyRadiusTop + 0.08;
  addDarkOpening(
    silo,
    0,
    ventY,
    ventZ,
    0.62,
    0.78,
  );
  for (const yOffset of [-0.22, 0, 0.22]) {
    const slat = addMesh(
      silo,
      new THREE.BoxGeometry(0.54, 0.055, 0.08),
      timberMaterial('dark'),
      new THREE.Vector3(0, ventY + yOffset, ventZ + 0.15),
    );
    slat.name = 'Granary roof silo vent louver';
  }

  const cap = addMesh(
    silo,
    new THREE.ConeGeometry(plan.capRadius, plan.capHeight, 8),
    shingleMaterial(),
    new THREE.Vector3(
      0,
      plan.bodyBaseY + plan.bodyHeight + plan.capHeight * 0.5 - 0.04,
      0,
    ),
    new THREE.Euler(0, Math.PI * 0.125, 0),
  );
  cap.name = 'Granary roof silo shingle cap';

  const finial = addMesh(
    silo,
    new THREE.CylinderGeometry(0.075, 0.11, 0.46, 6),
    metalMaterial('iron'),
    new THREE.Vector3(
      0,
      plan.bodyBaseY + plan.bodyHeight + plan.capHeight + 0.16,
      0,
    ),
  );
  finial.name = 'Granary roof silo finial';
}

export function createGranaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Granary';
  const store = new THREE.Group();
  store.name = 'GranaryGroundedStore';
  const shell = addGableShell(store, { width: 9.5, depth: 6.3, stoneHeight: 0.34, wallHeight: 3.15, ridgeHeight: 2.55, wallMaterial: timberMaterial('weathered'), roofMaterial: shingleMaterial() });
  addPlankDoor(store, 0, 0.38, shell.frontZ + 0.03, 1.55, 2.25);
  for (const x of [-3.3, 3.3]) addSmallWindow(store, x, 1.92, shell.frontZ + 0.03, 0.58, 0.62);
  addGranaryRoofSilo(store);
  group.add(store);
  addSegmentedStockProps(
    group,
    'GranaryGrainStockpile',
    'GranaryGrainSegment',
    [[-3.45, 0, 3.8, 0.9], [-2.75, 0, 3.95, 0.75], [-3.9, 0, 4.5, 0.68]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'GranaryProvisionStockpile',
    'GranaryProvisionSegment',
    [[2.35, 0, 3.85, 0.82], [3.05, 0, 3.95, 0.72], [3.7, 0, 3.82, 0.65]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  return group;
}

export function createApiaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Apiary';
  const shell = addGableShell(group, { width: 5.2, depth: 4.3, stoneHeight: 0.52, wallHeight: 2.2, ridgeHeight: 1.8, wallMaterial: residenceFacadeMaterial('yellow'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -0.85, 0.55, shell.frontZ + 0.03, 0.78, 1.62);
  addSmallWindow(group, 1.1, 1.58, shell.frontZ + 0.03, 0.62, 0.72);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const x = -3.4 + i * 2.2;
    const z = -3.2 - row * 1.25;
    addMesh(group, new THREE.BoxGeometry(1.05, 0.72, 0.78), row ? (i % 2 ? hiveBlue : timberMaterial('light')) : (i % 2 ? hiveRed : residenceFacadeMaterial('yellow')), new THREE.Vector3(x, 0.58, z));
    addMesh(group, new THREE.BoxGeometry(1.22, 0.12, 0.94), shingleMaterial(), new THREE.Vector3(x, 1.0, z));
    addMesh(group, new THREE.BoxGeometry(0.72, 0.06, 0.28), timberMaterial('light'), new THREE.Vector3(x, 0.25, z + 0.5));
  }
  addMesh(group, new THREE.CylinderGeometry(0.2, 0.34, 0.72, 9), metalMaterial('iron'), new THREE.Vector3(3.15, 0.38, 2.75));
  addMesh(group, new THREE.CylinderGeometry(0.08, 0.16, 0.48, 8), metalMaterial('iron'), new THREE.Vector3(3.15, 0.96, 2.75));
  addSegmentedStockProps(
    group,
    'ApiaryHoneyStockpile',
    'ApiaryHoneySegment',
    ([
      [1.75, 0, 2.9, 1],
      [2.25, 0, 3.05, 0.88],
      [2.65, 0, 2.82, 0.75],
    ] as const)
      .slice(0, APIARY_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJar(segment, scale),
  );
  return group;
}

export function createWatermillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Watermill';
  const shell = addGableShell(group, { width: 9.2, depth: 6.8, stoneHeight: 1.6, wallHeight: 2.75, ridgeHeight: 2.7, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: shingleMaterial(), stoneGroundFloor: true });
  addPlankDoor(group, -1.7, 1.64, shell.frontZ + 0.03, 1.0, 1.9);
  addSmallWindow(group, 1.5, 2.85, shell.frontZ + 0.03, 0.78, 0.96);
  const wheelX = 5.25;
  const wheel = new THREE.Group();
  wheel.name = 'Watermill wheel';
  wheel.position.set(wheelX, 2.15, 0);
  group.add(wheel);
  addMesh(wheel, new THREE.TorusGeometry(2.15, 0.16, 8, 24), timberMaterial('dark'), new THREE.Vector3(), new THREE.Euler(0, Math.PI * 0.5, 0));
  for (let i = 0; i < 12; i++) addMesh(wheel, new THREE.BoxGeometry(0.13, 4.05, 0.22), timberMaterial('weathered'), new THREE.Vector3(), new THREE.Euler(i * Math.PI / 12, 0, Math.PI * 0.5));
  addMesh(wheel, new THREE.CylinderGeometry(0.26, 0.26, 2.2, 10), metalMaterial('iron'), new THREE.Vector3(), new THREE.Euler(0, 0, Math.PI * 0.5));
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    addMesh(wheel, new THREE.BoxGeometry(0.4, 0.72, 1.05), timberMaterial('weathered'), new THREE.Vector3(0, Math.sin(angle) * 2.18, Math.cos(angle) * 2.18), new THREE.Euler(angle, 0, 0));
  }
  // Millrace trough and grain handling props distinguish flour milling from saw work.
  addMesh(group, new THREE.BoxGeometry(1.6, 0.3, 7.8), stoneMaterial('mid'), new THREE.Vector3(wheelX + 0.65, 0.25, 0));
  addSegmentedStockProps(
    group,
    'WatermillGrainStockpile',
    'WatermillGrainSegment',
    [[-3.7, 0, 4.05, 0.9], [-3.0, 0, 4.15, 0.72], [-3.55, 0, 4.7, 0.65]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addMesh(group, new THREE.BoxGeometry(1.5, 1.0, 1.35), timberMaterial('weathered'), new THREE.Vector3(-1.9, 0.52, 4.05));
  addSegmentedStockProps(
    group,
    'WatermillFlourStockpile',
    'WatermillFlourSegment',
    [[1.9, 0, 4.05, 0.86], [2.62, 0, 4.15, 0.72], [2.25, 0, 4.68, 0.64]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  group.add(createCivilianToolStockpile(new THREE.Vector3(3.72, 0, 3.82), -0.22));
  return group;
}

export function createWindmillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Windmill';

  addMesh(
    group,
    new THREE.CylinderGeometry(2.85, 3.55, 7.4, 12),
    residenceFacadeMaterial('white'),
    new THREE.Vector3(0, 3.7, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(3.62, 3.62, 0.52, 12),
    stoneMaterial('mid'),
    new THREE.Vector3(0, 0.26, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(3.25, 2.9, 1.8, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0, 8.25, 0),
  );
  addMesh(
    group,
    new THREE.ConeGeometry(3.9, 2.55, 8),
    shingleMaterial(),
    new THREE.Vector3(0, 10.42, 0),
  );
  addMesh(
    group,
    new THREE.SphereGeometry(0.18, 8, 6),
    metalMaterial('iron'),
    new THREE.Vector3(0, 11.78, 0),
  );

  addPlankDoor(group, 0, 0.56, 3.23, 1.0, 1.86);
  addSmallWindow(group, -1.15, 3.15, 2.96, 0.62, 0.78);
  addSmallWindow(group, 1.1, 5.55, 2.72, 0.56, 0.72);

  const sails = new THREE.Group();
  sails.name = 'Windmill sails';
  sails.position.set(0, 8.35, 3.42);
  sails.rotation.z = Math.PI * 0.12;
  group.add(sails);
  for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
    const blade = new THREE.Group();
    blade.rotation.z = bladeIndex * Math.PI * 0.5;
    sails.add(blade);
    addMesh(
      blade,
      new THREE.BoxGeometry(0.18, 5.1, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(0, 2.55, 0),
    );
    for (const side of [-1, 1]) {
      addMesh(
        blade,
        new THREE.BoxGeometry(0.13, 3.65, 0.13),
        timberMaterial('weathered'),
        new THREE.Vector3(side * 0.58, 3.05, 0),
        new THREE.Euler(0, 0, side * -0.08),
      );
    }
    for (let rung = 0; rung < 7; rung += 1) {
      addMesh(
        blade,
        new THREE.BoxGeometry(1.32, 0.1, 0.11),
        timberMaterial(rung % 2 ? 'light' : 'weathered'),
        new THREE.Vector3(0, 1.65 + rung * 0.5, 0),
      );
    }
  }
  addMesh(
    sails,
    new THREE.CylinderGeometry(0.48, 0.48, 0.72, 10),
    timberMaterial('dark'),
    new THREE.Vector3(),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    sails,
    new THREE.CylinderGeometry(0.16, 0.16, 1.15, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0, -0.08),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  addLeanToRoof(group, {
    width: 3.5,
    depth: 2.8,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(3.55, 2.45, -0.55),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: 'Windmill loading porch roof',
  });
  for (const z of [-1.55, 0.45]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.17, 2.35, 0.17),
      timberMaterial('dark'),
      new THREE.Vector3(4.75, 1.18, z),
    );
  }

  addSegmentedStockProps(
    group,
    'WatermillGrainStockpile',
    'WatermillGrainSegment',
    [[3.25, 0, -0.75, 0.9], [4.0, 0, -0.68, 0.72], [3.62, 0, -1.32, 0.65]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'WatermillFlourStockpile',
    'WatermillFlourSegment',
    [[3.3, 0, 1.05, 0.86], [4.02, 0, 1.12, 0.72], [3.62, 0, 1.62, 0.64]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  group.add(createCivilianToolStockpile(new THREE.Vector3(-3.55, 0, -1.65), 0.18));
  return group;
}

export function createCarpenterMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Carpenter and wheelwright';
  const shell = addGableShell(group, { width: 7.2, depth: 5.6, stoneHeight: 0.7, wallHeight: 2.7, ridgeHeight: 2.2, wallMaterial: timberMaterial('weathered'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -1.3, 0.74, shell.frontZ + 0.03, 0.95, 1.86);
  addSmallWindow(group, 1.4, 1.85, shell.frontZ + 0.03, 0.82, 0.94);
  addLeanToRoof(group, {
    width: 3.4,
    depth: 5.0,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(5.1, 2.65, 0),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: 'Carpenter open-bay roof',
  });
  for (const z of [-2.1, 2.1]) addMesh(group, new THREE.BoxGeometry(0.18, 2.6, 0.18), timberMaterial('dark'), new THREE.Vector3(6.35, 1.3, z));
  for (let i = 0; i < 2; i++) {
    const x = 4.4 + i * 1.5;
    addCartWheel(group, x, 1.05, 1.2, 0.9 - i * 0.15);
  }
  addMesh(group, new THREE.BoxGeometry(2.8, 0.22, 1.1), timberMaterial('weathered'), new THREE.Vector3(5.05, 0.92, -1.3));
  const timberStockpile = new THREE.Group();
  timberStockpile.name = 'CarpenterTimberStockpile';
  timberStockpile.visible = false;
  for (let i = 0; i < CARPENTER_TIMBER_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'CarpenterTimberSegment';
    addMesh(
      segment,
      new THREE.BoxGeometry(3.0 - i * 0.12, 0.16, 0.42),
      timberMaterial(i % 2 ? 'light' : 'mid'),
      new THREE.Vector3(4.75, 0.12 + i * 0.18, -3.2),
    );
    timberStockpile.add(segment);
  }
  group.add(timberStockpile);
  const ironworkStockpile = new THREE.Group();
  ironworkStockpile.name = 'CarpenterIronworkStockpile';
  ironworkStockpile.visible = false;
  for (let i = 0; i < CARPENTER_IRONWORK_VISUAL_SEGMENTS; i++) {
    const segment = new THREE.Group();
    segment.name = 'CarpenterIronworkSegment';
    const x = 4.25 + i * 0.78;
    for (const z of [-1.48, -1.15]) {
      addMesh(
        segment,
        new THREE.BoxGeometry(0.58, 0.07, 0.09),
        metalMaterial(i % 2 ? 'steel' : 'iron'),
        new THREE.Vector3(x, 1.08, z),
      );
    }
    ironworkStockpile.add(segment);
  }
  group.add(ironworkStockpile);
  addStockedPolearmRack(group, {
    x: 4.95,
    z: 3.15,
    width: 2.7,
    stockpileName: 'CarpenterPolearmStockpile',
    segmentName: 'CarpenterPolearmSegment',
    segmentCount: CARPENTER_POLEARM_VISUAL_SEGMENTS,
  });
  addMesh(group, new THREE.CylinderGeometry(0.13, 0.13, 3.1, 8), timberMaterial('dark'), new THREE.Vector3(5.12, 0.76, 0), new THREE.Euler(0, 0, Math.PI * 0.5));
  // Upright frame saw makes the open bay identifiable even before its props resolve.
  for (const x of [4.15, 5.85]) addMesh(group, new THREE.BoxGeometry(0.16, 2.2, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 1.2, -0.2));
  addMesh(group, new THREE.BoxGeometry(2.05, 0.16, 0.16), timberMaterial('weathered'), new THREE.Vector3(5, 2.25, -0.2));
  addMesh(group, new THREE.BoxGeometry(1.45, 0.05, 0.09), metalMaterial('steel'), new THREE.Vector3(5, 1.35, -0.2), new THREE.Euler(0, 0, -0.08));
  return group;
}

function createWeaverYarnStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'WeaverYarnStockpile';
  stockpile.visible = false;
  stockpile.position.set(-3.7, 0, 3.65);
  for (let index = 0; index < YARN_STOCKPILE_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'YarnStockSegment';
    segment.position.set((index % 2) * 0.62, 0.26 + Math.floor(index / 2) * 0.38, 0);
    addMesh(
      segment,
      new THREE.TorusGeometry(0.24, 0.055, 7, 14),
      residenceFacadeMaterial(index % 2 ? 'grey' : 'white'),
      new THREE.Vector3(),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
      new THREE.Vector3(1.35, 0.68, 1),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.07, 0.09, 0.44),
      timberMaterial('light'),
      new THREE.Vector3(),
    );
    stockpile.add(segment);
  }
  return stockpile;
}

function createWeaverLinenStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'WeaverLinenStockpile';
  stockpile.visible = false;
  stockpile.position.set(-3.75, 0, -3.55);
  for (let index = 0; index < LINEN_STOCKPILE_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'LinenStockSegment';
    segment.position.set((index % 2) * 0.68, 0.26 + Math.floor(index / 2) * 0.4, 0);
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.2, 0.2, 1.02, 10),
      sharedBuildingDetailMaterial('canvas'),
      new THREE.Vector3(),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8),
      timberMaterial('dark'),
      new THREE.Vector3(),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    stockpile.add(segment);
  }
  return stockpile;
}

function createClothStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'ClothStockpile';
  stockpile.visible = false;
  stockpile.position.set(3.8, 0, 3.55);
  const clothMaterials = [canvas, hiveRed, hiveBlue, residenceFacadeMaterial('grey')] as const;
  for (let index = 0; index < CLOTH_STOCKPILE_VISUAL_SEGMENTS; index++) {
    const segment = new THREE.Group();
    segment.name = 'ClothStockSegment';
    segment.position.set((index % 2) * 0.7, 0.3 + Math.floor(index / 2) * 0.42, 0);
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.24, 1.15, 10),
      clothMaterials[index],
      new THREE.Vector3(),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.075, 0.075, 1.24, 8),
      timberMaterial('dark'),
      new THREE.Vector3(),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    stockpile.add(segment);
  }
  return stockpile;
}

export function createWeaverMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Weaver's workshop";
  const shell = addGableShell(group, {
    width: 7.4,
    depth: 5.7,
    stoneHeight: 0.7,
    wallHeight: 2.65,
    ridgeHeight: 2.15,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -1.35, 0.74, shell.frontZ + 0.03, 0.92, 1.82);
  addSmallWindow(group, 1.45, 1.82, shell.frontZ + 0.03, 0.86, 0.95);

  // A bright road-facing open bay exposes the timber warp-weighted loom.
  addLeanToRoof(group, {
    width: 3.9,
    depth: 5.0,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(5.25, 2.62, 0),
    pitch: 0.16,
    highEdge: 'negativeX',
    name: 'Weaver open-bay roof',
  });
  for (const z of [-2.1, 2.1]) {
    addMesh(group, new THREE.BoxGeometry(0.18, 2.55, 0.18), timberMaterial('dark'), new THREE.Vector3(6.55, 1.28, z));
  }
  for (const x of [4.25, 6.05]) {
    addMesh(group, new THREE.BoxGeometry(0.17, 2.2, 0.17), timberMaterial('dark'), new THREE.Vector3(x, 1.26, 0));
  }
  for (const y of [0.48, 2.28]) {
    addMesh(group, new THREE.BoxGeometry(2.05, 0.16, 0.18), timberMaterial('weathered'), new THREE.Vector3(5.15, y, 0));
  }
  for (let index = 0; index < 8; index++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.025, 1.62, 0.025),
      index % 3 === 0 ? hiveRed : canvas,
      new THREE.Vector3(4.42 + index * 0.21, 1.37, 0.02),
    );
  }
  addMesh(group, new THREE.BoxGeometry(1.58, 0.72, 0.055), hiveBlue, new THREE.Vector3(5.15, 0.91, 0.04));
  addMesh(group, new THREE.BoxGeometry(2.25, 0.2, 0.8), timberMaterial('weathered'), new THREE.Vector3(5.15, 0.62, 1.25));
  addMesh(group, new THREE.CylinderGeometry(0.07, 0.07, 1.15, 8), timberMaterial('light'), new THREE.Vector3(5.15, 0.92, 1.25), new THREE.Euler(0, 0, Math.PI * 0.5));

  group.add(createWeaverYarnStockpile());
  group.add(createWeaverLinenStockpile());
  group.add(createClothStockpile());
  return group;
}

