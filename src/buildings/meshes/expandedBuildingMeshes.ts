import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
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
import { addProceduralDoor, addProceduralWindow } from './facadeOpeningKit.ts';
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
import {
  createProceduralRoofPanelGeometry,
  ProceduralGeometryWriter,
} from '../proceduralArchitecture/geometryWriter.ts';

export const LOCAL_RECEIPT_VISUAL_SEGMENTS = 3;
export const LOCAL_RECEIPT_VISUAL_CAPACITY = STOREHOUSE_HAUL_PER_WORKER;

const earth = sharedBuildingDetailMaterial('earth');
const canvas = sharedBuildingDetailMaterial('canvas');
const copper = sharedBuildingDetailMaterial('brass');
const hiveBlue = sharedBuildingDetailMaterial('paintBlue');
const hiveRed = sharedBuildingDetailMaterial('paintRed');

type JoinedTimberMember = Readonly<{
  semanticId: string;
  start: readonly [number, number, number];
  end: readonly [number, number, number];
  width?: number;
  depth?: number;
  upHint?: readonly [number, number, number];
  structuralUse?: 'timber-frame' | 'roof-frame';
}>;

/**
 * Emits one brown, member-aligned material slot for a complete structural
 * assembly. End points are authored at ledgers, plates, posts, or machine
 * bearings, so the visible frame cannot regress to a collection of floating
 * primitive boxes.
 */
function addJoinedTimberFrame(
  group: THREE.Group,
  name: string,
  moduleId: string,
  members: readonly JoinedTimberMember[],
): THREE.Mesh {
  const writer = new ProceduralGeometryWriter(['rough-timber']);
  for (const member of members) {
    writer.addMember({
      semanticId: member.semanticId,
      moduleId,
      materialRole: 'rough-timber',
      structuralUse: member.structuralUse ?? 'timber-frame',
      start: member.start,
      end: member.end,
      width: member.width ?? 0.18,
      depth: member.depth ?? 0.18,
      upHint: member.upHint ?? [0, 1, 0],
    });
  }
  const slot = writer.build().slots[0];
  if (!slot) throw new Error(`${name} emitted no structural timber.`);
  const frame = addMesh(
    group,
    slot.geometry,
    timberMaterial('dark'),
    new THREE.Vector3(),
  );
  frame.name = name;
  frame.userData.architectureRole = moduleId;
  frame.userData.structuralConnection = 'joined-endpoint-authored';
  frame.userData.structuralMemberCount = members.length;
  frame.userData.proceduralMaterialRole = 'rough-timber';
  frame.userData.proceduralPrimitiveDiagnostics = slot.diagnostics.primitives;
  return frame;
}

export const PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS = Object.freeze({
  threshing_barn: Object.freeze({
    semanticId: 'threshing-barn-opposed-cart-floor-v1',
    typology: 'broad-boarded-barn-with-opposed-cart-doors',
    literalOpenings: 5,
    dynamicAnchors: Object.freeze([
      'ThreshingGrainStockpile',
      'ThreshingFlaxStockpile',
      'ThreshingManureStockpile',
    ]),
  }),
  brewery: Object.freeze({
    semanticId: 'brewery-hearth-and-cooling-lean-to-v1',
    typology: 'lime-rendered-brewhouse-with-open-kettle-bay',
    literalOpenings: 2,
    dynamicAnchors: Object.freeze([
      'BreweryAleStockpile',
      'BreweryBarleyStockpile',
      'BreweryMaltStockpile',
    ]),
  }),
  bakery: Object.freeze({
    semanticId: 'bakery-attached-masonry-oven-v1',
    typology: 'compact-lime-rendered-bakehouse-with-attached-oven',
    literalOpenings: 2,
    dynamicAnchors: Object.freeze(['BakeryFoodStockpile']),
  }),
  smokehouse: Object.freeze({
    semanticId: 'smokehouse-sealed-log-chamber-v1',
    typology: 'detached-log-smoking-chamber-with-fuel-lean-to',
    literalOpenings: 4,
    dynamicAnchors: Object.freeze([
      'SmokehouseFirewoodStockpile',
      'SmokehouseFreshFoodStockpile',
      'SmokehouseSaltStockpile',
      'SmokehousePotteryStockpile',
      'SmokehousePreservedFoodStockpile',
    ]),
  }),
  watermill: Object.freeze({
    semanticId: 'watermill-streamside-wheel-house-v1',
    typology: 'fieldstone-mill-house-with-connected-undershot-wheel',
    literalOpenings: 2,
    dynamicAnchors: Object.freeze([
      'WatermillGrainStockpile',
      'WatermillFlourStockpile',
      'Watermill wheel',
    ]),
  }),
  carpenter: Object.freeze({
    semanticId: 'carpenter-open-bench-range-v1',
    typology: 'boarded-workshop-with-braced-open-carpentry-bay',
    literalOpenings: 2,
    dynamicAnchors: Object.freeze([
      'CarpenterTimberStockpile',
      'CarpenterIronworkStockpile',
      'CarpenterPolearmStockpile',
    ]),
  }),
  weaver: Object.freeze({
    semanticId: 'weaver-broad-lit-loom-bay-v1',
    typology: 'lime-rendered-workshop-with-covered-loom-bay',
    literalOpenings: 2,
    dynamicAnchors: Object.freeze([
      'WeaverYarnStockpile',
      'WeaverLinenStockpile',
      'ClothStockpile',
    ]),
  }),
});

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
    sharedBuildingDetailMaterial('wicker'),
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.threshing_barn;
  const shell = addGableShell(group, { width: 10.8, depth: 7.2, stoneHeight: 0.58, wallHeight: 3.25, ridgeHeight: 3.0, wallMaterial: timberMaterial('weathered'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -3.1, 0.62, shell.frontZ + 0.03, 1.25, 2.45);
  addPlankDoor(group, 0, 0.62, shell.frontZ + 0.03, 2.6, 2.7);
  // The central threshing floor is a real cross-passage: both cart doors cut
  // the wall shell at the same bay and threshold instead of using a black
  // rectangle on the rear wall.
  addPlankDoor(group, 0, 0.62, shell.backZ - 0.03, 2.6, 2.7, 'ground-level');
  for (const x of [-4.2, 4.2]) addSmallWindow(group, x, 2.35, shell.frontZ + 0.03, 0.72, 0.8);
  const halfDoor = 1.3;
  addJoinedTimberFrame(
    group,
    'Threshing barn joined cart-bay and wall-plate frame',
    'boarded-barn-frame',
    [
      ...([-1, 1] as const).flatMap((zSign) => [
        {
          semanticId: `threshing-barn-${zSign < 0 ? 'rear' : 'front'}-left-cart-jamb`,
          start: [-halfDoor - 0.13, 0.58, zSign * 3.47] as const,
          end: [-halfDoor - 0.13, 3.65, zSign * 3.47] as const,
        },
        {
          semanticId: `threshing-barn-${zSign < 0 ? 'rear' : 'front'}-right-cart-jamb`,
          start: [halfDoor + 0.13, 0.58, zSign * 3.47] as const,
          end: [halfDoor + 0.13, 3.65, zSign * 3.47] as const,
        },
        {
          semanticId: `threshing-barn-${zSign < 0 ? 'rear' : 'front'}-cart-lintel`,
          start: [-halfDoor - 0.13, 3.38, zSign * 3.47] as const,
          end: [halfDoor + 0.13, 3.38, zSign * 3.47] as const,
        },
      ]),
      {
        semanticId: 'threshing-barn-left-side-mid-post',
        start: [-5.28, 0.58, 0],
        end: [-5.28, 3.65, 0],
      },
      {
        semanticId: 'threshing-barn-right-side-mid-post',
        start: [5.28, 0.58, 0],
        end: [5.28, 3.65, 0],
      },
      {
        semanticId: 'threshing-barn-left-longitudinal-wall-plate',
        start: [-5.28, 3.72, -3.47],
        end: [-5.28, 3.72, 3.47],
        structuralUse: 'roof-frame',
      },
      {
        semanticId: 'threshing-barn-right-longitudinal-wall-plate',
        start: [5.28, 3.72, -3.47],
        end: [5.28, 3.72, 3.47],
        structuralUse: 'roof-frame',
      },
    ],
  );
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.brewery;
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
  // Open brewing bay with a copper mash kettle and malt sacks. The high-edge
  // ledger keys into the house wall plate; two rafters terminate on a low
  // eave beam carried by posts rather than leaving the canopy floating.
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
  addJoinedTimberFrame(
    group,
    'Brewery joined cooling-bay roof frame',
    'cooling-lean-to',
    [
      { semanticId: 'brewery-cooling-bay-wall-ledger', start: [2.15, 2.67, 3.18], end: [4.85, 2.67, 3.18], structuralUse: 'roof-frame' },
      { semanticId: 'brewery-cooling-bay-eave-beam', start: [2.15, 2.37, 5.24], end: [4.85, 2.37, 5.24], structuralUse: 'roof-frame' },
      { semanticId: 'brewery-cooling-bay-left-post', start: [2.28, 0, 5.24], end: [2.28, 2.37, 5.24] },
      { semanticId: 'brewery-cooling-bay-right-post', start: [4.72, 0, 5.24], end: [4.72, 2.37, 5.24] },
      { semanticId: 'brewery-cooling-bay-left-rafter', start: [2.28, 2.37, 5.24], end: [2.28, 2.67, 3.18], structuralUse: 'roof-frame' },
      { semanticId: 'brewery-cooling-bay-right-rafter', start: [4.72, 2.37, 5.24], end: [4.72, 2.67, 3.18], structuralUse: 'roof-frame' },
    ],
  );
  const hearth = addMesh(
    group,
    new THREE.CylinderGeometry(0.83, 0.88, 0.32, 10),
    stoneMaterial('mid'),
    new THREE.Vector3(3.45, 0.16, 4.15),
  );
  hearth.name = 'Brewery masonry kettle hearth';
  hearth.userData.architectureRole = 'brewing-hearth';
  const kettle = addMesh(group, new THREE.SphereGeometry(0.72, 12, 8), copper, new THREE.Vector3(3.45, 0.96, 4.15), new THREE.Euler(), new THREE.Vector3(1, 1.18, 1));
  kettle.name = 'Brewery copper mash kettle seated on hearth';
  const kettleRim = addMesh(
    group,
    new THREE.TorusGeometry(0.7, 0.055, 6, 16),
    metalMaterial('iron'),
    new THREE.Vector3(3.45, 1.65, 4.15),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  kettleRim.name = 'Brewery iron-supported mash-kettle rim';
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.bakery;
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
  const ovenBody = addMesh(
    group,
    new THREE.BoxGeometry(2.35, 1.45, 1.9),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 0.74, 3.55),
  );
  ovenBody.name = 'Bakery attached masonry oven body';
  const ovenDome = addMesh(
    group,
    new THREE.SphereGeometry(1.14, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 1.42, 3.55),
  );
  ovenDome.name = 'Bakery attached masonry oven dome';
  const ovenMouth = addMesh(
    group,
    new THREE.BoxGeometry(0.78, 0.72, 0.08),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(2.15, 0.78, 4.51),
  );
  ovenMouth.name = 'Bakery recessed oven mouth';
  const ovenFlue = addMesh(
    group,
    new THREE.BoxGeometry(0.64, 0.72, 1.35),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 2.13, 2.98),
  );
  ovenFlue.name = 'Bakery oven-to-chimney masonry flue';
  ovenFlue.userData.architectureRole = 'masonry-oven';
  // Keep the stack on the oven axis. The previous offset stack read as an
  // unrelated column and never visibly received the oven flue.
  const chimneyStack = addMesh(
    group,
    new THREE.BoxGeometry(0.72, 3.9, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(2.15, 4.35, 2.38),
  );
  chimneyStack.name = 'Bakery oven-axis masonry chimney stack';
  const chimneyCap = addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.22, 0.92),
    stoneMaterial('mortar'),
    new THREE.Vector3(2.15, 6.35, 2.38),
  );
  chimneyCap.name = 'Bakery plain weathered chimney cap';
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.smokehouse;
  const shell = addGableShell(group, { width: 6.4, depth: 5.5, stoneHeight: 1.5, wallHeight: 2.25, ridgeHeight: 2.2, wallMaterial: stackedTimberWallMaterial(), roofMaterial: shingleMaterial(), stoneGroundFloor: true });
  addPlankDoor(group, -1.0, 1.53, shell.frontZ + 0.03, 0.92, 1.78);
  // A sealed smoking chamber needs small controllable vents, not a glazed
  // domestic window. These three reveals all register literal wall holes.
  addDarkOpening(group, 0.82, 3.12, shell.frontZ + 0.03, 0.28, 0.24);
  addDarkOpening(group, 1.48, 3.12, shell.frontZ + 0.03, 0.28, 0.24);
  addDarkOpening(group, 0, 3.18, shell.backZ - 0.03, 0.34, 0.24);
  addChimney(group, 1.85, -1.4, 5.4);
  const firebox = addMesh(
    group,
    new THREE.BoxGeometry(1.45, 1.08, 1.32),
    stoneMaterial('mid'),
    new THREE.Vector3(1.85, 0.54, -1.4),
  );
  firebox.name = 'Smokehouse chimney-connected stone firebox';
  firebox.userData.architectureRole = 'stone-firebox';
  const smoke = addMesh(group, new THREE.ConeGeometry(0.42, 1.5, 8), sharedBuildingDetailMaterial('smoke'), new THREE.Vector3(1.85, 6.2, -1.4));
  smoke.name = 'Smoke plume';
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
  addJoinedTimberFrame(
    group,
    'Smokehouse joined fuel-bay roof frame',
    'service-lean-to',
    [
      { semanticId: 'smokehouse-fuel-bay-wall-ledger', start: [-3.14, 2.15, -1.05], end: [-3.14, 2.15, 1.05], structuralUse: 'roof-frame' },
      { semanticId: 'smokehouse-fuel-bay-eave-beam', start: [-5.31, 1.84, -1.05], end: [-5.31, 1.84, 1.05], structuralUse: 'roof-frame' },
      { semanticId: 'smokehouse-fuel-bay-front-post', start: [-5.31, 0, 0.92], end: [-5.31, 1.84, 0.92] },
      { semanticId: 'smokehouse-fuel-bay-back-post', start: [-5.31, 0, -0.92], end: [-5.31, 1.84, -0.92] },
      { semanticId: 'smokehouse-fuel-bay-front-rafter', start: [-5.31, 1.84, 0.92], end: [-3.14, 2.15, 0.92], structuralUse: 'roof-frame' },
      { semanticId: 'smokehouse-fuel-bay-back-rafter', start: [-5.31, 1.84, -0.92], end: [-3.14, 2.15, -0.92], structuralUse: 'roof-frame' },
    ],
  );
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

export const GRANARY_ARCHITECTURE_PLAN = Object.freeze({
  semanticId: 'granary-raised-staddle-store-v1',
  store: Object.freeze({
    width: 8.6,
    depth: 5.4,
    floorBaseY: 1.24,
    floorThickness: 0.18,
    wallHeight: 2.42,
    ridgeRise: 2.05,
    wallThickness: 0.16,
  }),
  roof: Object.freeze({
    width: 9.44,
    depth: 6.18,
    thickness: 0.13,
  }),
  door: Object.freeze({
    width: 1.5,
    height: 2.16,
  }),
  supportX: Object.freeze([-3.18, -1.06, 1.06, 3.18]),
  supportZ: Object.freeze([-2.02, 2.02]),
  grainStockAnchors: Object.freeze([
    Object.freeze([-3.45, 0, 3.8, 0.9] as StockPropPlacement),
    Object.freeze([-2.75, 0, 3.95, 0.75] as StockPropPlacement),
    Object.freeze([-3.9, 0, 4.5, 0.68] as StockPropPlacement),
  ]),
  provisionStockAnchors: Object.freeze([
    Object.freeze([2.35, 0, 3.85, 0.82] as StockPropPlacement),
    Object.freeze([3.05, 0, 3.95, 0.72] as StockPropPlacement),
    Object.freeze([3.7, 0, 3.82, 0.65] as StockPropPlacement),
  ]),
});

export const APIARY_ARCHITECTURE_PLAN = Object.freeze({
  semanticId: 'apiary-open-covered-skep-stand-v1',
  roof: Object.freeze({
    width: 8.72,
    depth: 3.72,
    centerY: 2.44,
    centerZ: -0.36,
    pitch: 0.23,
    thickness: 0.12,
    highEdge: 'negativeZ' as const,
  }),
  postX: Object.freeze([-3.7, 3.7]),
  postZ: Object.freeze([-2.17, 1.45]),
  benchRows: Object.freeze([-1.22, 0.12]),
  skepX: Object.freeze([-2.65, 0, 2.65]),
  honeyStockAnchors: Object.freeze([
    Object.freeze([1.75, 0, 2.9, 1] as StockPropPlacement),
    Object.freeze([2.25, 0, 3.05, 0.88] as StockPropPlacement),
    Object.freeze([2.65, 0, 2.82, 0.75] as StockPropPlacement),
  ]),
});

function addRaisedGranaryRoof(group: THREE.Group): void {
  const plan = GRANARY_ARCHITECTURE_PLAN;
  const store = plan.store;
  const roof = plan.roof;
  const wallTop = store.floorBaseY + store.floorThickness + store.wallHeight;
  const eaveY = wallTop - 0.035;
  const rise = store.ridgeRise + 0.055;
  const halfRoofWidth = roof.width * 0.5;
  const halfRoofDepth = roof.depth * 0.5;
  const material = shingleMaterial();
  const left = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'granary-raised-store-negative-x-roof-plane',
      moduleId: 'granary-joined-gable-roof',
      materialRole: 'split-shingles',
      structuralUse: 'roof-covering',
      eaveOrigin: [-halfRoofWidth, eaveY, -halfRoofDepth],
      eaveVector: [0, 0, roof.depth],
      slopeVector: [halfRoofWidth, rise, 0],
      thickness: roof.thickness,
    }),
    material,
    new THREE.Vector3(),
  );
  left.name = 'Granary joined negative-X roof plane';
  left.userData.proceduralRoofShell = true;
  left.userData.architectureRole = 'split-shingle-roof';

  const right = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'granary-raised-store-positive-x-roof-plane',
      moduleId: 'granary-joined-gable-roof',
      materialRole: 'split-shingles',
      structuralUse: 'roof-covering',
      eaveOrigin: [halfRoofWidth, eaveY, halfRoofDepth],
      eaveVector: [0, 0, -roof.depth],
      slopeVector: [-halfRoofWidth, rise, 0],
      thickness: roof.thickness,
      uvOffsetMeters: [0.19, 0.11],
    }),
    material,
    new THREE.Vector3(),
  );
  right.name = 'Granary joined positive-X roof plane';
  right.userData.proceduralRoofShell = true;
  right.userData.architectureRole = 'split-shingle-roof';

  const ridge = addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.09, roof.depth + 0.08),
    material,
    new THREE.Vector3(0, eaveY + rise + 0.012, 0),
  );
  ridge.name = 'Granary low-profile shingle ridge cap';
  ridge.userData.proceduralRoofShell = true;
}

function addGranaryStaddle(
  group: THREE.Group,
  x: number,
  z: number,
  index: number,
): void {
  const support = new THREE.Group();
  support.name = `Granary staddle support ${index + 1}`;
  support.position.set(x, 0, z);
  support.userData.architectureRole = 'discrete-staddle-support';
  group.add(support);

  const foot = addMesh(
    support,
    new THREE.CylinderGeometry(0.36, 0.42, 0.3, 8),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, 0.15, 0),
    new THREE.Euler(0, index * 0.17, 0),
  );
  foot.name = 'Granary staddle ground stone';
  const stem = addMesh(
    support,
    new THREE.CylinderGeometry(0.23, 0.28, 0.5, 8),
    stoneMaterial('mid'),
    new THREE.Vector3(0, 0.52, 0),
    new THREE.Euler(0, index * 0.11, 0),
  );
  stem.name = 'Granary staddle stone stem';
  const cap = addMesh(
    support,
    new THREE.CylinderGeometry(0.5, 0.25, 0.22, 8),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, 0.88, 0),
    new THREE.Euler(0, index * 0.23, 0),
  );
  cap.name = 'Granary staddle vermin cap';
}

function addGranaryWallPanel(
  group: THREE.Group,
  name: string,
  size: THREE.Vector3,
  position: THREE.Vector3,
): THREE.Mesh {
  const panel = addMesh(
    group,
    new THREE.BoxGeometry(size.x, size.y, size.z),
    stackedTimberWallMaterial(),
    position,
  );
  panel.name = name;
  panel.userData.architectureRole = 'sealed-timber-store';
  return panel;
}

function addGranaryGable(
  group: THREE.Group,
  z: number,
  outwardSign: -1 | 1,
): void {
  const plan = GRANARY_ARCHITECTURE_PLAN.store;
  const wallTop = plan.floorBaseY + plan.floorThickness + plan.wallHeight;
  const shape = new THREE.Shape();
  shape.moveTo(-plan.width * 0.5 + 0.08, 0);
  shape.lineTo(plan.width * 0.5 - 0.08, 0);
  shape.lineTo(0, plan.ridgeRise);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: plan.wallThickness,
    bevelEnabled: false,
  });
  geometry.translate(0, wallTop, z - plan.wallThickness * 0.5);
  const gable = addMesh(
    group,
    geometry,
    stackedTimberWallMaterial(),
    new THREE.Vector3(0, 0, outwardSign * 0.01),
  );
  gable.name = `Granary ${outwardSign > 0 ? 'front' : 'rear'} ventilated gable infill`;
  gable.userData.architectureRole = 'vented-gable';
}

function addGranaryLoadingStair(group: THREE.Group): void {
  const plan = GRANARY_ARCHITECTURE_PLAN.store;
  const frontZ = plan.depth * 0.5;
  const landing = addMesh(
    group,
    new THREE.BoxGeometry(2.22, 0.18, 1.0),
    timberMaterial('weathered'),
    new THREE.Vector3(0, plan.floorBaseY - 0.02, frontZ + 0.48),
  );
  landing.name = 'Granary raised loading landing';
  landing.userData.architectureRole = 'loading-platform';
  for (let index = 0; index < 4; index++) {
    const height = 0.28 + index * 0.28;
    const step = addMesh(
      group,
      new THREE.BoxGeometry(1.82, height, 0.48),
      timberMaterial(index >= 2 ? 'mid' : 'weathered'),
      new THREE.Vector3(0, height * 0.5, frontZ + 1.82 - index * 0.38),
    );
    step.name = `Granary loading stair tread ${index + 1}`;
  }
}

export function createGranaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Granary';
  group.userData.architecturePlan = GRANARY_ARCHITECTURE_PLAN;
  const store = new THREE.Group();
  store.name = 'GranaryRaisedStore';
  store.userData.architectureRole = 'raised-staddle-grain-store';
  group.add(store);
  const plan = GRANARY_ARCHITECTURE_PLAN;
  const shell = plan.store;
  const wallBase = shell.floorBaseY + shell.floorThickness;
  const wallTop = wallBase + shell.wallHeight;
  const halfWidth = shell.width * 0.5;
  const halfDepth = shell.depth * 0.5;
  const frontZ = halfDepth - shell.wallThickness * 0.5;
  const rearZ = -halfDepth + shell.wallThickness * 0.5;

  let supportIndex = 0;
  for (const z of plan.supportZ) {
    for (const x of plan.supportX) addGranaryStaddle(store, x, z, supportIndex++);
  }
  for (const z of plan.supportZ) {
    const bearer = addMesh(
      store,
      new THREE.BoxGeometry(shell.width - 0.44, 0.24, 0.28),
      timberMaterial('dark'),
      new THREE.Vector3(0, 1.09, z),
    );
    bearer.name = 'Granary staddle-supported floor bearer';
  }
  const floor = addMesh(
    store,
    new THREE.BoxGeometry(shell.width, shell.floorThickness, shell.depth),
    timberMaterial('weathered'),
    new THREE.Vector3(0, shell.floorBaseY + shell.floorThickness * 0.5, 0),
  );
  floor.name = 'Granary raised timber floor deck';
  floor.userData.architectureRole = 'raised-floor-deck';

  const sidePanelWidth = (shell.width - plan.door.width) * 0.5;
  for (const side of [-1, 1] as const) {
    addGranaryWallPanel(
      store,
      `Granary front sealed wall panel ${side < 0 ? 'left' : 'right'}`,
      new THREE.Vector3(sidePanelWidth, shell.wallHeight, shell.wallThickness),
      new THREE.Vector3(side * (plan.door.width * 0.5 + sidePanelWidth * 0.5), wallBase + shell.wallHeight * 0.5, frontZ),
    );
  }
  const lintelHeight = Math.max(0.18, shell.wallHeight - plan.door.height);
  addGranaryWallPanel(
    store,
    'Granary front loading-door lintel infill',
    new THREE.Vector3(plan.door.width, lintelHeight, shell.wallThickness),
    new THREE.Vector3(0, wallTop - lintelHeight * 0.5, frontZ),
  );
  addGranaryWallPanel(
    store,
    'Granary rear sealed wall',
    new THREE.Vector3(shell.width, shell.wallHeight, shell.wallThickness),
    new THREE.Vector3(0, wallBase + shell.wallHeight * 0.5, rearZ),
  );
  for (const side of [-1, 1] as const) {
    addGranaryWallPanel(
      store,
      `Granary ${side < 0 ? 'negative-X' : 'positive-X'} sealed wall`,
      new THREE.Vector3(shell.wallThickness, shell.wallHeight, shell.depth - shell.wallThickness * 2),
      new THREE.Vector3(side * (halfWidth - shell.wallThickness * 0.5), wallBase + shell.wallHeight * 0.5, 0),
    );
  }

  for (const [x, z] of [
    [-halfWidth + 0.12, -halfDepth + 0.12],
    [-halfWidth + 0.12, halfDepth - 0.12],
    [halfWidth - 0.12, -halfDepth + 0.12],
    [halfWidth - 0.12, halfDepth - 0.12],
  ] as const) {
    const post = addMesh(
      store,
      new THREE.BoxGeometry(0.22, shell.wallHeight - 0.08, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(x, wallBase + (shell.wallHeight - 0.08) * 0.5, z),
    );
    post.name = 'Granary corner post joined below wall plate';
  }
  for (const z of [-halfDepth + 0.12, halfDepth - 0.12]) {
    const plate = addMesh(
      store,
      new THREE.BoxGeometry(shell.width - 0.22, 0.2, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.1, z),
    );
    plate.name = 'Granary eave wall plate';
  }
  for (const x of [-halfWidth + 0.12, halfWidth - 0.12]) {
    const plate = addMesh(
      store,
      new THREE.BoxGeometry(0.22, 0.2, shell.depth - 0.42),
      timberMaterial('dark'),
      new THREE.Vector3(x, wallTop - 0.1, 0),
    );
    plate.name = 'Granary gable wall plate';
  }

  addGranaryGable(store, frontZ + 0.01, 1);
  addGranaryGable(store, rearZ - shell.wallThickness + 0.01, -1);
  addPlankDoor(store, 0, wallBase + 0.02, frontZ + 0.105, plan.door.width, plan.door.height, 'existing-platform');
  const ventY = wallTop + shell.ridgeRise * 0.42;
  for (const z of [frontZ + 0.18, rearZ - 0.18]) {
    addDarkOpening(store, 0, ventY, z, 0.68, 0.5);
    for (const offset of [-0.14, 0, 0.14]) {
      const louver = addMesh(
        store,
        new THREE.BoxGeometry(0.56, 0.05, 0.06),
        timberMaterial('dark'),
        new THREE.Vector3(0, ventY + offset, z + Math.sign(z) * 0.11),
      );
      louver.name = 'Granary gable ventilation louver';
    }
  }
  addRaisedGranaryRoof(store);
  addGranaryLoadingStair(store);
  addSegmentedStockProps(
    group,
    'GranaryGrainStockpile',
    'GranaryGrainSegment',
    plan.grainStockAnchors,
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  addSegmentedStockProps(
    group,
    'GranaryProvisionStockpile',
    'GranaryProvisionSegment',
    plan.provisionStockAnchors,
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  return group;
}

function addApiaryFooting(
  group: THREE.Group,
  x: number,
  z: number,
  index: number,
): void {
  const footing = addMesh(
    group,
    new THREE.CylinderGeometry(0.3, 0.36, 0.2, 8),
    stoneMaterial(index % 2 === 0 ? 'mortar' : 'mid'),
    new THREE.Vector3(x, 0.1, z),
    new THREE.Euler(0, index * 0.19, 0),
  );
  footing.name = 'Apiary discrete fieldstone post footing';
  footing.userData.architectureRole = 'fieldstone-footing';
}

function addApiarySkep(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  index: number,
): void {
  const skep = new THREE.Group();
  skep.name = `Apiary woven straw skep ${index + 1}`;
  skep.position.set(x, y, z);
  skep.userData.architectureRole = 'woven-skep';
  group.add(skep);
  const profile = [
    new THREE.Vector2(0.14, 0),
    new THREE.Vector2(0.43, 0.08),
    new THREE.Vector2(0.53, 0.32),
    new THREE.Vector2(0.49, 0.62),
    new THREE.Vector2(0.36, 0.86),
    new THREE.Vector2(0.16, 1.02),
    new THREE.Vector2(0.05, 1.05),
  ];
  const body = addMesh(
    skep,
    new THREE.LatheGeometry(profile, 10),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(),
    new THREE.Euler(0, index * 0.17, 0),
  );
  body.name = 'Apiary woven skep body';
  body.userData.architectureRole = 'woven-skep';
  for (const [ringY, radius] of [[0.26, 0.51], [0.52, 0.48], [0.77, 0.39]] as const) {
    const binding = addMesh(
      skep,
      new THREE.TorusGeometry(radius, 0.025, 4, 10),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(0, ringY, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    binding.name = 'Apiary skep woven binding course';
  }
  const entrance = addMesh(
    skep,
    new THREE.CircleGeometry(0.095, 8),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, 0.22, 0.515),
  );
  entrance.name = 'Apiary skep entrance';
}

export function createApiaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Apiary';
  group.userData.architecturePlan = APIARY_ARCHITECTURE_PLAN;
  const plan = APIARY_ARCHITECTURE_PLAN;
  const roofRun = Math.cos(plan.roof.pitch) * plan.roof.depth;
  const roofRise = Math.sin(plan.roof.pitch) * plan.roof.depth;
  const highY = plan.roof.centerY + roofRise * 0.5 - 0.06;
  const lowY = plan.roof.centerY - roofRise * 0.5 - 0.06;
  let postIndex = 0;
  for (const z of plan.postZ) {
    for (const x of plan.postX) {
      addApiaryFooting(group, x, z, postIndex);
      const postHeight = z < plan.roof.centerZ ? highY : lowY;
      const post = addMesh(
        group,
        new THREE.BoxGeometry(0.2, postHeight - 0.16, 0.2),
        timberMaterial('dark'),
        new THREE.Vector3(x, 0.16 + (postHeight - 0.16) * 0.5, z),
      );
      post.name = 'Apiary roof-bearing post';
      post.userData.architectureRole = 'open-frame-support';
      post.userData.roofClearance = 0.06;
      postIndex += 1;
    }
  }
  for (const [z, y] of [[plan.postZ[0], highY - 0.11], [plan.postZ[1], lowY - 0.11]] as const) {
    const plate = addMesh(
      group,
      new THREE.BoxGeometry(plan.roof.width - 0.62, 0.2, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(0, y, z),
    );
    plate.name = 'Apiary joined roof plate';
  }
  const roof = addLeanToRoof(group, {
    width: plan.roof.width,
    depth: plan.roof.depth,
    thickness: plan.roof.thickness,
    material: shingleMaterial(),
    position: new THREE.Vector3(0, plan.roof.centerY, plan.roof.centerZ),
    pitch: plan.roof.pitch,
    highEdge: plan.roof.highEdge,
    name: 'Apiary joined split-shingle lean-to roof',
  });
  roof.userData.architectureRole = 'covered-skep-stand';
  roof.userData.roofRunMeters = roofRun;

  let skepIndex = 0;
  for (const z of plan.benchRows) {
    const bench = addMesh(
      group,
      new THREE.BoxGeometry(6.64, 0.16, 0.7),
      timberMaterial('mid'),
      new THREE.Vector3(0, 0.62, z),
    );
    bench.name = 'Apiary raised skep bench';
    bench.userData.architectureRole = 'covered-hive-stand';
    for (const x of [-2.75, 0, 2.75]) {
      const leg = addMesh(
        group,
        new THREE.BoxGeometry(0.2, 0.5, 0.42),
        timberMaterial('dark'),
        new THREE.Vector3(x, 0.31, z),
      );
      leg.name = 'Apiary skep bench leg';
    }
    for (const x of plan.skepX) addApiarySkep(group, x, 0.7, z, skepIndex++);
  }

  const tableTop = addMesh(
    group,
    new THREE.BoxGeometry(2.05, 0.15, 0.8),
    timberMaterial('mid'),
    new THREE.Vector3(-2.5, 0.9, 1.05),
  );
  tableTop.name = 'Apiary processing table top';
  tableTop.userData.architectureRole = 'processing-table';
  for (const x of [-3.28, -1.72]) {
    for (const z of [0.76, 1.34]) {
      const leg = addMesh(
        group,
        new THREE.BoxGeometry(0.18, 0.82, 0.18),
        timberMaterial('dark'),
        new THREE.Vector3(x, 0.46, z),
      );
      leg.name = 'Apiary processing table leg';
    }
  }
  const chest = addMesh(
    group,
    new THREE.BoxGeometry(1.14, 0.58, 0.72),
    timberMaterial('mid'),
    new THREE.Vector3(2.82, 0.39, 1.03),
  );
  chest.name = 'Apiary brown timber tool chest';
  chest.userData.architectureRole = 'tool-chest';
  const chestLid = addMesh(
    group,
    new THREE.BoxGeometry(1.24, 0.11, 0.8),
    timberMaterial('mid'),
    new THREE.Vector3(2.82, 0.72, 1.03),
  );
  chestLid.name = 'Apiary brown timber tool chest lid';
  addSegmentedStockProps(
    group,
    'ApiaryHoneyStockpile',
    'ApiaryHoneySegment',
    plan.honeyStockAnchors.slice(0, APIARY_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJar(segment, scale),
  );
  return group;
}

export function createWatermillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Watermill';
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.watermill;
  const shell = addGableShell(group, { width: 9.2, depth: 6.8, stoneHeight: 1.6, wallHeight: 2.75, ridgeHeight: 2.7, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: shingleMaterial(), stoneGroundFloor: true });
  addPlankDoor(group, -1.7, 1.64, shell.frontZ + 0.03, 1.0, 1.9);
  addSmallWindow(group, 1.5, 2.85, shell.frontZ + 0.03, 0.78, 0.96);
  const wheelX = 5.25;
  const wheel = new THREE.Group();
  wheel.name = 'Watermill wheel';
  wheel.position.set(wheelX, 2.15, 0);
  group.add(wheel);
  addMesh(wheel, new THREE.TorusGeometry(2.15, 0.16, 8, 24), timberMaterial('dark'), new THREE.Vector3(), new THREE.Euler(0, Math.PI * 0.5, 0));
  const wheelMembers: JoinedTimberMember[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    wheelMembers.push({
      semanticId: `watermill-wheel-spoke-${i + 1}`,
      start: [0, sin * 0.2, cos * 0.2],
      end: [0, sin * 2.02, cos * 2.02],
      width: 0.13,
      depth: 0.18,
      upHint: [1, 0, 0],
    });
    const centerY = sin * 2.18;
    const centerZ = cos * 2.18;
    const tangentY = cos * 0.39;
    const tangentZ = -sin * 0.39;
    wheelMembers.push({
      semanticId: `watermill-wheel-paddle-${i + 1}`,
      start: [0, centerY - tangentY, centerZ - tangentZ],
      end: [0, centerY + tangentY, centerZ + tangentZ],
      width: 0.34,
      depth: 0.96,
      upHint: [1, 0, 0],
    });
  }
  addJoinedTimberFrame(
    wheel,
    'Watermill joined wheel spokes and paddle boards',
    'weathered-board-waterwheel',
    wheelMembers,
  );
  const axle = addMesh(
    wheel,
    new THREE.CylinderGeometry(0.26, 0.26, 2.2, 10),
    timberMaterial('dark'),
    new THREE.Vector3(),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  axle.name = 'Watermill timber axle entering axle-house bearing';
  const gudgeon = addMesh(
    wheel,
    new THREE.CylinderGeometry(0.12, 0.12, 0.36, 8),
    metalMaterial('iron'),
    new THREE.Vector3(-1.14, 0, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  gudgeon.name = 'Watermill iron axle gudgeon';
  const bearing = addMesh(
    group,
    new THREE.BoxGeometry(0.46, 0.72, 0.74),
    stoneMaterial('mid'),
    new THREE.Vector3(4.63, 2.15, 0),
  );
  bearing.name = 'Watermill wall-connected axle bearing block';
  bearing.userData.architectureRole = 'axle-house';

  // A shallow U-shaped race leaves physical clearance for the undershot
  // paddles. The previous solid stone slab occupied the water channel itself.
  const raceBottom = addMesh(
    group,
    new THREE.BoxGeometry(1.5, 0.14, 7.8),
    stoneMaterial('mortar'),
    new THREE.Vector3(wheelX, 0.07, 0),
  );
  raceBottom.name = 'Watermill open mill-race stone bed';
  for (const x of [wheelX - 0.72, wheelX + 0.72]) {
    const raceWall = addMesh(
      group,
      new THREE.BoxGeometry(0.18, 0.52, 7.8),
      stoneMaterial('mid'),
      new THREE.Vector3(x, 0.26, 0),
    );
    raceWall.name = 'Watermill open mill-race side wall';
  }
  addSegmentedStockProps(
    group,
    'WatermillGrainStockpile',
    'WatermillGrainSegment',
    [[-3.7, 0, 4.05, 0.9], [-3.0, 0, 4.15, 0.72], [-3.55, 0, 4.7, 0.65]],
    (segment, scale) => addSack(segment, 0, 0, scale),
  );
  const grainChest = addMesh(group, new THREE.BoxGeometry(1.5, 1.0, 1.35), timberMaterial('mid'), new THREE.Vector3(-1.9, 0.52, 4.05));
  grainChest.name = 'Watermill brown timber grain chest';
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

type WindmillTowerOpening = {
  readonly facetIndex: number;
  readonly kind: 'door' | 'window';
  readonly lateralX: number;
  readonly baseY: number;
  readonly width: number;
  readonly height: number;
};

const WINDMILL_TOWER_OPENINGS: readonly WindmillTowerOpening[] = [
  { facetIndex: 0, kind: 'door', lateralX: 0, baseY: 0.54, width: 1.0, height: 1.86 },
  { facetIndex: 11, kind: 'window', lateralX: 0.35, baseY: 2.76, width: 0.62, height: 0.78 },
  { facetIndex: 1, kind: 'window', lateralX: -0.32, baseY: 5.19, width: 0.56, height: 0.72 },
];

function addWindmillTaperedTowerShell(group: THREE.Group): void {
  const sides = 12;
  const baseRadius = 3.55;
  const topRadius = 2.85;
  const height = 7.4;
  const halfFacetAngle = Math.PI / sides;
  const bottomApothem = baseRadius * Math.cos(halfFacetAngle);
  const topApothem = topRadius * Math.cos(halfFacetAngle);
  const bottomWidth = 2 * baseRadius * Math.sin(halfFacetAngle);
  const topWidth = 2 * topRadius * Math.sin(halfFacetAngle);
  const radialInset = bottomApothem - topApothem;
  const tilt = Math.atan2(radialInset, height);
  const verticalScale = Math.cos(tilt);
  const slantHeight = height / verticalScale;
  const wallThickness = 0.18;

  for (let facetIndex = 0; facetIndex < sides; facetIndex += 1) {
    const opening = WINDMILL_TOWER_OPENINGS.find((candidate) => candidate.facetIndex === facetIndex);
    const shape = new THREE.Shape();
    shape.moveTo(-bottomWidth * 0.5, 0);
    shape.lineTo(bottomWidth * 0.5, 0);
    shape.lineTo(topWidth * 0.5, slantHeight);
    shape.lineTo(-topWidth * 0.5, slantHeight);
    shape.closePath();

    if (opening) {
      const yMin = opening.baseY / verticalScale;
      const yMax = (opening.baseY + opening.height) / verticalScale;
      const halfWidth = (opening.width + 0.1) * 0.5;
      const hole = new THREE.Path();
      hole.moveTo(opening.lateralX - halfWidth, yMin);
      hole.lineTo(opening.lateralX - halfWidth, yMax);
      hole.lineTo(opening.lateralX + halfWidth, yMax);
      hole.lineTo(opening.lateralX + halfWidth, yMin);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: wallThickness,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.translate(0, 0, -wallThickness);
    const angle = facetIndex * Math.PI * 2 / sides;
    const facet = new THREE.Group();
    facet.name = `Windmill tapered tower facet ${facetIndex + 1}`;
    facet.position.set(
      Math.sin(angle) * bottomApothem,
      0,
      Math.cos(angle) * bottomApothem,
    );
    facet.rotation.set(-tilt, angle, 0);
    group.add(facet);

    const wall = addMesh(
      facet,
      geometry,
      residenceFacadeMaterial('white'),
      new THREE.Vector3(),
    );
    wall.name = opening
      ? `Windmill physically perforated ${opening.kind} tower wall`
      : 'Windmill joined tapered plaster tower wall';
    wall.userData.proceduralWallShell = true;
    wall.userData.literalFacadeApertures = opening !== undefined;
    wall.userData.proceduralFacadeOpeningCount = opening ? 1 : 0;

    if (!opening) continue;
    if (opening.kind === 'door') {
      const parts = addProceduralDoor(facet, {
        position: new THREE.Vector3(opening.lateralX, opening.baseY / verticalScale, 0.025),
        face: 'positive-z',
        width: opening.width,
        height: opening.height,
        namePrefix: 'Windmill',
        entranceAccess: 'existing-platform',
      });
      parts.root.userData.literalWallAperture = true;
      parts.root.userData.facadeOpeningRole = 'tapered-tower-door';
    } else {
      const parts = addProceduralWindow(facet, {
        position: new THREE.Vector3(
          opening.lateralX,
          (opening.baseY + opening.height * 0.5) / verticalScale,
          0.025,
        ),
        face: 'positive-z',
        width: opening.width,
        height: opening.height,
        namePrefix: 'Windmill',
      });
      parts.root.userData.literalWallAperture = true;
      parts.root.userData.facadeOpeningRole = 'tapered-tower-window';
    }
  }
}

export function createWindmillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Windmill';

  addWindmillTaperedTowerShell(group);
  const foundation = addMesh(
    group,
    new THREE.CylinderGeometry(3.62, 3.62, 0.52, 12),
    stoneMaterial('mid'),
    new THREE.Vector3(0, 0.26, 0),
  );
  foundation.name = 'Windmill continuous fieldstone tower foundation';
  const capDrum = addMesh(
    group,
    new THREE.CylinderGeometry(3.25, 2.9, 1.8, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0, 8.25, 0),
  );
  capDrum.name = 'Windmill joined timber rotating cap drum';
  const capRoof = addMesh(
    group,
    new THREE.ConeGeometry(3.9, 2.55, 8),
    shingleMaterial(),
    new THREE.Vector3(0, 10.42, 0),
  );
  capRoof.name = 'Windmill joined shingle cap roof';
  capRoof.userData.proceduralRoofShell = true;
  capRoof.userData.proceduralRoofAttachment = 'cap-drum';
  const finial = addMesh(
    group,
    new THREE.SphereGeometry(0.18, 8, 6),
    metalMaterial('iron'),
    new THREE.Vector3(0, 11.78, 0),
  );
  finial.name = 'Windmill cap roof iron finial';
  const bearing = addMesh(
    group,
    new THREE.BoxGeometry(0.82, 0.78, 0.28),
    timberMaterial('mid'),
    new THREE.Vector3(0, 8.35, 3.08),
  );
  bearing.name = 'Windmill cap axle bearing housing';
  bearing.userData.architectureRole = 'sail-axle-bearing';

  const sails = new THREE.Group();
  sails.name = 'Windmill sails';
  sails.position.set(0, 8.35, 3.42);
  sails.rotation.z = Math.PI * 0.12;
  group.add(sails);
  for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
    const blade = new THREE.Group();
    blade.name = 'Windmill joined sail blade';
    blade.userData.architectureRole = 'windmill-sail-blade';
    blade.rotation.z = bladeIndex * Math.PI * 0.5;
    sails.add(blade);
    const spar = addMesh(
      blade,
      new THREE.BoxGeometry(0.18, 5.1, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(0, 2.55, 0),
    );
    spar.name = 'Windmill sail load-bearing spar';
    for (const side of [-1, 1]) {
      const rail = addMesh(
        blade,
        new THREE.BoxGeometry(0.13, 3.65, 0.13),
        timberMaterial('weathered'),
        new THREE.Vector3(side * 0.58, 3.05, 0),
        new THREE.Euler(0, 0, side * -0.08),
      );
      rail.name = 'Windmill sail weathered side rail';
    }
    for (let rung = 0; rung < 7; rung += 1) {
      const lattice = addMesh(
        blade,
        new THREE.BoxGeometry(1.32, 0.1, 0.11),
        timberMaterial(rung % 2 ? 'mid' : 'weathered'),
        new THREE.Vector3(0, 1.65 + rung * 0.5, 0),
      );
      lattice.name = 'Windmill sail brown timber lattice rung';
    }
  }
  const hub = addMesh(
    sails,
    new THREE.CylinderGeometry(0.48, 0.48, 0.72, 10),
    timberMaterial('dark'),
    new THREE.Vector3(),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  hub.name = 'Windmill sail timber hub';
  const axle = addMesh(
    sails,
    new THREE.CylinderGeometry(0.16, 0.16, 1.15, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0, -0.08),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  axle.name = 'Windmill sail iron axle';
  axle.userData.architectureRole = 'sail-axle';

  const porchRoof = addLeanToRoof(group, {
    width: 2.45,
    depth: 3.15,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(4.25, 2.55, -0.45),
    pitch: 0.14,
    highEdge: 'negativeX',
    name: 'Windmill loading porch roof',
  });
  porchRoof.userData.architectureRole = 'wall-ledger-supported-loading-porch';
  const porchLedger = addMesh(
    group,
    new THREE.BoxGeometry(0.22, 0.22, 3.05),
    timberMaterial('dark'),
    new THREE.Vector3(3.14, 2.69, -0.45),
  );
  porchLedger.name = 'Windmill loading porch wall ledger';
  const porchEaveBeam = addMesh(
    group,
    new THREE.BoxGeometry(0.22, 0.22, 3.05),
    timberMaterial('dark'),
    new THREE.Vector3(5.32, 2.38, -0.45),
  );
  porchEaveBeam.name = 'Windmill loading porch post-supported eave beam';
  for (const z of [-1.75, 0.85]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.19, 2.38, 0.19),
      timberMaterial('dark'),
      new THREE.Vector3(5.32, 1.19, z),
    );
    post.name = 'Windmill loading porch roof-bearing post';
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.carpenter;
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
  addJoinedTimberFrame(
    group,
    'Carpenter joined lean-to, bench, and frame-saw structure',
    'braced-open-frame',
    [
      { semanticId: 'carpenter-bay-wall-ledger', start: [3.56, 2.87, -2.38], end: [3.56, 2.87, 2.38], structuralUse: 'roof-frame' },
      { semanticId: 'carpenter-bay-eave-beam', start: [6.7, 2.31, -2.38], end: [6.7, 2.31, 2.38], structuralUse: 'roof-frame' },
      { semanticId: 'carpenter-bay-front-post', start: [6.7, 0, 2.12], end: [6.7, 2.31, 2.12] },
      { semanticId: 'carpenter-bay-back-post', start: [6.7, 0, -2.12], end: [6.7, 2.31, -2.12] },
      { semanticId: 'carpenter-bay-front-rafter', start: [6.7, 2.31, 2.12], end: [3.56, 2.87, 2.12], structuralUse: 'roof-frame' },
      { semanticId: 'carpenter-bay-back-rafter', start: [6.7, 2.31, -2.12], end: [3.56, 2.87, -2.12], structuralUse: 'roof-frame' },
      ...([3.85, 6.25] as const).flatMap((x) => ([-1.72, -0.88] as const).map((z) => ({
        semanticId: `carpenter-workbench-leg-${x}-${z}`,
        start: [x, 0, z] as const,
        end: [x, 0.81, z] as const,
        width: 0.16,
        depth: 0.16,
      }))),
      { semanticId: 'carpenter-frame-saw-left-post', start: [4.15, 0.2, -0.2], end: [4.15, 2.25, -0.2], width: 0.16, depth: 0.16 },
      { semanticId: 'carpenter-frame-saw-right-post', start: [5.85, 0.2, -0.2], end: [5.85, 2.25, -0.2], width: 0.16, depth: 0.16 },
      { semanticId: 'carpenter-frame-saw-top-rail', start: [4.15, 2.25, -0.2], end: [5.85, 2.25, -0.2], width: 0.16, depth: 0.16 },
      { semanticId: 'carpenter-frame-saw-bottom-rail', start: [4.15, 0.42, -0.2], end: [5.85, 0.42, -0.2], width: 0.13, depth: 0.14 },
    ],
  );
  for (let i = 0; i < 2; i++) {
    const x = 4.4 + i * 1.5;
    addCartWheel(group, x, 1.05, 1.2, 0.9 - i * 0.15);
  }
  const workbench = addMesh(group, new THREE.BoxGeometry(2.8, 0.22, 1.1), timberMaterial('mid'), new THREE.Vector3(5.05, 0.92, -1.3));
  workbench.name = 'Carpenter brown timber workbench top';
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
  // Upright frame saw makes the open bay identifiable even before its props resolve.
  const sawBlade = addMesh(group, new THREE.BoxGeometry(1.45, 0.05, 0.09), metalMaterial('steel'), new THREE.Vector3(5, 1.35, -0.2), new THREE.Euler(0, 0, -0.08));
  sawBlade.name = 'Carpenter frame-saw tensioned blade';
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
      sharedBuildingDetailMaterial('wicker'),
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
  group.userData.architecturePlan = PROCESSOR_WORKSHOP_ARCHITECTURE_PLANS.weaver;
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
  addJoinedTimberFrame(
    group,
    'Weaver joined lean-to, loom, and bench frame',
    'weathered-board-broad-lit-work-bay',
    [
      { semanticId: 'weaver-bay-wall-ledger', start: [3.68, 2.87, -2.38], end: [3.68, 2.87, 2.38], structuralUse: 'roof-frame' },
      { semanticId: 'weaver-bay-eave-beam', start: [7.1, 2.27, -2.38], end: [7.1, 2.27, 2.38], structuralUse: 'roof-frame' },
      { semanticId: 'weaver-bay-front-post', start: [7.1, 0, 2.12], end: [7.1, 2.27, 2.12] },
      { semanticId: 'weaver-bay-back-post', start: [7.1, 0, -2.12], end: [7.1, 2.27, -2.12] },
      { semanticId: 'weaver-bay-front-rafter', start: [7.1, 2.27, 2.12], end: [3.68, 2.87, 2.12], structuralUse: 'roof-frame' },
      { semanticId: 'weaver-bay-back-rafter', start: [7.1, 2.27, -2.12], end: [3.68, 2.87, -2.12], structuralUse: 'roof-frame' },
      { semanticId: 'weaver-loom-left-post', start: [4.25, 0.16, 0], end: [4.25, 2.28, 0], width: 0.17, depth: 0.17 },
      { semanticId: 'weaver-loom-right-post', start: [6.05, 0.16, 0], end: [6.05, 2.28, 0], width: 0.17, depth: 0.17 },
      { semanticId: 'weaver-loom-top-rail', start: [4.25, 2.28, 0], end: [6.05, 2.28, 0], width: 0.16, depth: 0.18 },
      { semanticId: 'weaver-loom-bottom-rail', start: [4.25, 0.48, 0], end: [6.05, 0.48, 0], width: 0.16, depth: 0.18 },
      ...([4.25, 6.05] as const).flatMap((x) => ([0.98, 1.52] as const).map((z) => ({
        semanticId: `weaver-bench-leg-${x}-${z}`,
        start: [x, 0, z] as const,
        end: [x, 0.52, z] as const,
        width: 0.15,
        depth: 0.15,
      }))),
      { semanticId: 'weaver-cloth-drying-rail', start: [4.1, 1.82, 2.0], end: [6.35, 1.82, 2.0], width: 0.11, depth: 0.11 },
      { semanticId: 'weaver-cloth-drying-left-post', start: [4.1, 0, 2.0], end: [4.1, 1.82, 2.0], width: 0.12, depth: 0.12 },
      { semanticId: 'weaver-cloth-drying-right-post', start: [6.35, 0, 2.0], end: [6.35, 1.82, 2.0], width: 0.12, depth: 0.12 },
    ],
  );
  for (let index = 0; index < 8; index++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.025, 1.62, 0.025),
      index % 3 === 0 ? hiveRed : canvas,
      new THREE.Vector3(4.42 + index * 0.21, 1.37, 0.02),
    );
  }
  addMesh(group, new THREE.BoxGeometry(1.58, 0.72, 0.055), hiveBlue, new THREE.Vector3(5.15, 0.91, 0.04));
  const bench = addMesh(group, new THREE.BoxGeometry(2.25, 0.2, 0.8), timberMaterial('mid'), new THREE.Vector3(5.15, 0.62, 1.25));
  bench.name = 'Weaver brown timber loom bench';
  addMesh(group, new THREE.CylinderGeometry(0.07, 0.07, 1.15, 8), timberMaterial('light'), new THREE.Vector3(5.15, 0.92, 1.25), new THREE.Euler(0, 0, Math.PI * 0.5));

  group.add(createWeaverYarnStockpile());
  group.add(createWeaverLinenStockpile());
  group.add(createClothStockpile());
  return group;
}

