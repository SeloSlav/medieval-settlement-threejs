import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { addLogPile } from '../logPile.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';
import {
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';

type LumberMillFacadeOpening = {
  readonly x: number;
  readonly width: number;
  readonly yMin: number;
  readonly yMax: number;
};

function addLumberMillPerforatedWall(
  group: THREE.Group,
  length: number,
  stoneHeight: number,
  wallHeight: number,
  frontZ: number,
  openings: readonly LumberMillFacadeOpening[],
): THREE.Mesh {
  const halfLength = (length - 0.18) * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfLength, 0);
  shape.lineTo(halfLength, 0);
  shape.lineTo(halfLength, wallHeight);
  shape.lineTo(-halfLength, wallHeight);
  shape.closePath();

  for (const opening of openings) {
    const halfWidth = opening.width * 0.5;
    const hole = new THREE.Path();
    hole.moveTo(opening.x - halfWidth, opening.yMin);
    hole.lineTo(opening.x - halfWidth, opening.yMax);
    hole.lineTo(opening.x + halfWidth, opening.yMax);
    hole.lineTo(opening.x + halfWidth, opening.yMin);
    hole.closePath();
    shape.holes.push(hole);
  }

  const wallThickness = 0.18;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: wallThickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -wallThickness * 0.5);
  const wall = addMesh(
    group,
    geometry,
    timberMaterial('weathered'),
    new THREE.Vector3(0, stoneHeight, frontZ),
  );
  wall.name = 'Lumber mill front perforated work wall';
  wall.userData.proceduralWallShell = true;
  wall.userData.literalFacadeApertures = true;
  wall.userData.proceduralFacadeOpeningCount = openings.length;
  return wall;
}

function addLumberMillServiceBay(
  group: THREE.Group,
  stoneHeight: number,
  frontZ: number,
): void {
  const bay = new THREE.Group();
  bay.name = 'Lumber mill open saw service bay';
  bay.userData.facadeOpeningKind = 'service-bay';
  bay.userData.facadeOpeningRole = 'literal-recessed-work-bay';
  bay.userData.literalWallAperture = true;
  group.add(bay);

  const shadow = addMesh(
    bay,
    new THREE.BoxGeometry(4.66, 2.56, 0.055),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, stoneHeight + 1.47, frontZ - 0.34),
  );
  shadow.name = 'Lumber mill service bay recessed interior shadow';
  shadow.userData.facadeOpeningRole = 'recessed-interior-shadow';

  for (const x of [-2.53, 2.53]) {
    const jamb = addMesh(
      bay,
      new THREE.BoxGeometry(0.26, 2.88, 0.3),
      timberMaterial('dark'),
      new THREE.Vector3(x, stoneHeight + 1.48, frontZ + 0.015),
    );
    jamb.name = 'Lumber mill service bay load-bearing jamb';
  }
  const lintel = addMesh(
    bay,
    new THREE.BoxGeometry(5.32, 0.28, 0.32),
    timberMaterial('dark'),
    new THREE.Vector3(0, stoneHeight + 2.91, frontZ + 0.015),
  );
  lintel.name = 'Lumber mill service bay structural lintel';
  const sill = addMesh(
    bay,
    new THREE.BoxGeometry(4.78, 0.16, 0.38),
    timberMaterial('mid'),
    new THREE.Vector3(0, stoneHeight + 0.08, frontZ + 0.015),
  );
  sill.name = 'Lumber mill service bay timber sill';
}

function addMillRoof(group: THREE.Group, length: number, width: number, wallTop: number): void {
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const ridgeHeight = 2.35;
  const roofRun = halfW + 0.45;
  const pitch = Math.atan2(ridgeHeight, roofRun);
  const slopeLen = Math.hypot(roofRun, ridgeHeight);

  for (const side of [-1, 1] as const) {
    const panel = addMesh(
      group,
      new THREE.BoxGeometry(length + 0.66, 0.14, slopeLen),
      shingleMaterial(),
      new THREE.Vector3(0, wallTop + ridgeHeight * 0.5, side * roofRun * 0.5),
      new THREE.Euler(side > 0 ? pitch : -pitch, 0, 0),
    );
    panel.name = `Lumber mill joined ${side < 0 ? 'rear' : 'front'} shingle roof plane`;
    panel.userData.proceduralRoofShell = true;
    panel.userData.proceduralRoofAttachment = 'wall-plate-to-ridge';
    for (let row = 0; row < 5; row++) {
      const t = (row + 1) / 6;
      const course = addMesh(
        group,
        new THREE.BoxGeometry(length + 0.68, 0.048, 0.075),
        shingleMaterial(),
        new THREE.Vector3(
          0,
          wallTop + ridgeHeight * t + 0.055,
          side * roofRun * (1 - t),
        ),
        new THREE.Euler(side > 0 ? pitch : -pitch, 0, 0),
      );
      course.name = 'Lumber mill low-profile shingle course edge';
    }
  }
  const ridge = addMesh(
    group,
    new THREE.BoxGeometry(length + 0.78, 0.2, 0.28),
    shingleMaterial(),
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
  );
  ridge.name = 'Lumber mill joined shingle ridge cap';
  ridge.userData.proceduralRoofShell = true;
  for (const xSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'x',
      xSign * (halfL - 0.07),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      timberMaterial('weathered'),
    );
  }
}

function addSawmillRig(group: THREE.Group): void {
  const bed = addMesh(
    group,
    new THREE.BoxGeometry(4.4, 0.28, 1.9),
    timberMaterial('dark'),
    new THREE.Vector3(0.6, 0.92, 2.25),
  );
  bed.name = 'Lumber mill saw carriage bed';
  const blade = addMesh(
    group,
    new THREE.CylinderGeometry(1.05, 1.05, 0.09, 24),
    metalMaterial('steel'),
    new THREE.Vector3(0.4, 1.92, 2.25),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  blade.name = 'Lumber mill circular saw blade';
  for (const x of [-1.35, 2.55]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.2, 2.6, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.55, 2.25),
    );
    post.name = 'Lumber mill saw frame bearing post';
  }
  const rail = addMesh(
    group,
    new THREE.BoxGeometry(4.1, 0.18, 0.18),
    timberMaterial('weathered'),
    new THREE.Vector3(0.6, 2.82, 2.25),
  );
  rail.name = 'Lumber mill saw frame joined top rail';
  const driveWheel = addMesh(
    group,
    new THREE.CylinderGeometry(0.58, 0.58, 0.16, 16),
    metalMaterial('iron'),
    new THREE.Vector3(2.2, 1.45, 2.25),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  driveWheel.name = 'Lumber mill saw drive wheel';
  const axle = addMesh(
    group,
    new THREE.CylinderGeometry(0.09, 0.09, 0.46, 10),
    metalMaterial('iron'),
    new THREE.Vector3(2.2, 1.45, 2.25),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  axle.name = 'Lumber mill saw drive axle';
}

export function createLumberMillRuntimeStockpile(
  positions: readonly (readonly [number, number])[] = [
    [-6.2, -4.15],
    [-3.1, -4.15],
    [0, -4.15],
    [3.1, -4.15],
    [6.2, -4.15],
  ],
): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'TimberStockpile';
  stockpile.visible = false;
  for (let i = 0; i < positions.length; i++) {
    const segment = new THREE.Group();
    segment.name = 'TimberStockSegment';
    const [x, z] = positions[i];
    addLogPile(segment, x, z, 0, i % 2 === 0 ? 4 : 3, 2.65, 0.24);
    stockpile.add(segment);
  }
  return stockpile;
}

/** Long stone-and-oak saw hall. Yard timber is populated from actual mill storage. */
export function createLumberMillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lumber mill';
  const length = 16.8;
  const width = 6.6;
  const stoneHeight = 0.72;
  const wallHeight = 3.2;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const frontZ = halfW - 0.09;
  const rearZ = -halfW + 0.09;
  const doorX = -halfL + 1.0;
  const windowX = [-halfL + 3.95, halfL - 1.5] as const;

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.42, stoneHeight, width + 0.42),
    stoneMaterial('mid'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );
  addLumberMillPerforatedWall(group, length, stoneHeight, wallHeight, frontZ, [
    { x: doorX, width: 1.1, yMin: 0.04, yMax: 2.02 },
    { x: windowX[0], width: 0.92, yMin: 1.25, yMax: 2.43 },
    { x: 0, width: 4.9, yMin: 0.06, yMax: 2.86 },
    { x: windowX[1], width: 0.92, yMin: 1.25, yMax: 2.43 },
  ]);
  const rearWall = addMesh(
    group,
    new THREE.BoxGeometry(length - 0.18, wallHeight, 0.18),
    timberMaterial('weathered'),
    new THREE.Vector3(0, stoneHeight + wallHeight * 0.5, rearZ),
  );
  rearWall.name = 'Lumber mill rear weatherboard wall';
  for (const side of [-1, 1] as const) {
    const endWall = addMesh(
      group,
      new THREE.BoxGeometry(0.18, wallHeight, width - 0.36),
      timberMaterial('weathered'),
      new THREE.Vector3(side * (halfL - 0.09), stoneHeight + wallHeight * 0.5, 0),
    );
    endWall.name = 'Lumber mill enclosed gable-end wall';
  }

  const frontPosts = [-halfL + 0.18, -6.5, -5.45, -3.45, 4.72, 6.15, 7.55, halfL - 0.18];
  const rearPosts = [-halfL + 0.18, -5.9, -3.6, -1.2, 1.2, 3.6, 5.9, halfL - 0.18];
  for (const [z, posts] of [[frontZ + 0.02, frontPosts], [rearZ - 0.02, rearPosts]] as const) {
    for (const x of posts) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.23, wallHeight, 0.23),
        timberMaterial('dark'),
        new THREE.Vector3(x, stoneHeight + wallHeight * 0.5, z),
      );
    }
  }
  for (const z of [frontZ, rearZ]) {
    const plate = addMesh(
      group,
      new THREE.BoxGeometry(length + 0.08, 0.18, 0.24),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.09, z),
    );
    plate.name = 'Lumber mill continuous eave wall plate';
  }
  for (const x of [-halfL + 0.09, halfL - 0.09]) {
    const tie = addMesh(
      group,
      new THREE.BoxGeometry(0.24, 0.18, width - 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(x, wallTop - 0.09, 0),
    );
    tie.name = 'Lumber mill gable-end wall plate';
  }
  addMillRoof(group, length, width, wallTop);

  addLumberMillServiceBay(group, stoneHeight, frontZ);
  addSawmillRig(group);
  // The entrance occupies the first framing bay on the left, so move its
  // neighboring window into the next clear bay rather than layering the two.
  for (const x of windowX) {
    addSmallWindow(group, x, stoneHeight + 1.85, frontZ + 0.03, 0.8, 1.05);
  }
  addPlankDoor(group, doorX, stoneHeight + 0.04, frontZ + 0.04, 0.92, 1.9);

  // Deep eave over the intake bay makes the road-facing working side unmistakable.
  const canopyPostZ = halfW + 1.5;
  for (const x of [-2.7, 2.7]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.18, 3.82, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.91, canopyPostZ),
    );
    post.name = 'Lumber mill canopy roof-bearing post';
  }
  const canopyLedger = addMesh(
    group,
    new THREE.BoxGeometry(6.0, 0.2, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(0, 4.02, frontZ + 0.02),
  );
  canopyLedger.name = 'Lumber mill canopy wall ledger';
  const canopyEaveBeam = addMesh(
    group,
    new THREE.BoxGeometry(6.0, 0.2, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(0, 3.78, canopyPostZ),
  );
  canopyEaveBeam.name = 'Lumber mill canopy post-supported eave beam';
  addLeanToRoof(group, {
    width: 6.0,
    depth: 2.1,
    thickness: 0.13,
    material: shingleMaterial(),
    position: new THREE.Vector3(0, 3.95, halfW + 0.72),
    pitch: 0.16,
    highEdge: 'negativeZ',
    name: 'Lumber mill intake canopy roof',
  });

  group.add(createLumberMillRuntimeStockpile());
  group.add(createCivilianToolStockpile(new THREE.Vector3(-6.7, 0, 4.5), 0.12));
  return group;
}

function addReforesterToolPorch(group: THREE.Group, halfW: number): void {
  addForestryWorkAnnex(group, REFORESTER_ARCHITECTURE_PLAN.annex, halfW);
}

type ForestryWorkAnnexPlan = Readonly<{
  id: 'reforester-tool-porch' | 'woodcutters-cutting-lean-to';
  label: string;
  moduleId: 'tool-porch' | 'cutting-lean-to';
  roof: Readonly<{
    centerX: number;
    centerY: number;
    width: number;
    depth: number;
    pitch: number;
  }>;
  ledger: Readonly<{ x: number; y: number; zHalfSpan: number }>;
  eave: Readonly<{ x: number; y: number; zHalfSpan: number }>;
  postZ: readonly [number, number];
  fixture: Readonly<{
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
    topY: number;
    kind: 'tool-bench-and-chest' | 'cutting-bench';
  }>;
}>;

type ForestryArchitecturePlan = Readonly<{
  kind: 'reforester' | 'woodcutters_lodge';
  typology: 'compact-forester-hut' | 'low-woodland-lodge';
  shell: Readonly<{
    width: number;
    depth: number;
    stoneHeight: number;
    wallHeight: number;
    ridgeHeight: number;
  }>;
  openings: Readonly<{
    frontDoorX: number;
    frontWindowX: number;
    rearWindowX: number;
  }>;
  annex: ForestryWorkAnnexPlan;
  runtimeAnchors: readonly string[];
  embeddedVegetationGeometry: false;
}>;

const REFORESTER_ARCHITECTURE_PLAN = Object.freeze({
  kind: 'reforester',
  typology: 'compact-forester-hut',
  shell: { width: 6.0, depth: 5.45, stoneHeight: 0.58, wallHeight: 2.52, ridgeHeight: 2.35 },
  openings: { frontDoorX: -0.9, frontWindowX: 1.25, rearWindowX: 0.72 },
  annex: {
    id: 'reforester-tool-porch',
    label: 'Reforester connected tool porch',
    moduleId: 'tool-porch',
    roof: { centerX: 3.94, centerY: 2.97, width: 1.95, depth: 3.45, pitch: 0.17 },
    ledger: { x: 2.98, y: 3.02, zHalfSpan: 1.62 },
    eave: { x: 4.78, y: 2.71, zHalfSpan: 1.62 },
    postZ: [-1.5, 1.5],
    fixture: {
      centerX: 4.02,
      centerZ: 0.46,
      width: 1.28,
      depth: 0.7,
      topY: 0.92,
      kind: 'tool-bench-and-chest',
    },
  },
  runtimeAnchors: [],
  embeddedVegetationGeometry: false,
} as const satisfies ForestryArchitecturePlan);

const WOODCUTTERS_ARCHITECTURE_PLAN = Object.freeze({
  kind: 'woodcutters_lodge',
  typology: 'low-woodland-lodge',
  shell: { width: 6.75, depth: 5.9, stoneHeight: 0.72, wallHeight: 2.62, ridgeHeight: 2.22 },
  openings: { frontDoorX: -1.25, frontWindowX: 1.35, rearWindowX: 1.1 },
  annex: {
    id: 'woodcutters-cutting-lean-to',
    label: 'Woodcutters connected cutting lean-to',
    moduleId: 'cutting-lean-to',
    roof: { centerX: 4.225, centerY: 3.0, width: 1.84, depth: 3.25, pitch: 0.18 },
    ledger: { x: 3.38, y: 3.06, zHalfSpan: 1.52 },
    eave: { x: 5.0, y: 2.72, zHalfSpan: 1.52 },
    postZ: [-1.42, 1.42],
    fixture: {
      centerX: 4.22,
      centerZ: -0.55,
      width: 1.18,
      depth: 0.76,
      topY: 0.9,
      kind: 'cutting-bench',
    },
  },
  runtimeAnchors: ['WoodcuttersFirewoodStockpile'],
  embeddedVegetationGeometry: false,
} as const satisfies ForestryArchitecturePlan);

export const FORESTRY_ARCHITECTURE_PLANS = Object.freeze({
  reforester: REFORESTER_ARCHITECTURE_PLAN,
  woodcutters_lodge: WOODCUTTERS_ARCHITECTURE_PLAN,
});

function addAnnexTimberMember(
  writer: ProceduralGeometryWriter,
  plan: ForestryWorkAnnexPlan,
  semanticId: string,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  width: number,
  depth = width,
): void {
  writer.addMember({
    semanticId: `${plan.id}-${semanticId}`,
    moduleId: plan.moduleId,
    materialRole: 'rough-timber',
    structuralUse: 'timber-frame',
    start,
    end,
    width,
    depth,
    upHint: [0, 1, 0],
  });
}

function addForestryWorkAnnex(
  group: THREE.Group,
  plan: ForestryWorkAnnexPlan,
  shellHalfWidth: number,
): void {
  const annex = new THREE.Group();
  annex.name = plan.label;
  annex.userData.architectureModulePlan = plan;
  annex.userData.structuralConnection = 'wall-ledger-to-eave-post-frame';
  group.add(annex);

  if (Math.abs(plan.ledger.x - shellHalfWidth) > 0.45) {
    throw new Error(`${plan.label} ledger no longer reaches its parent wall.`);
  }

  const writer = new ProceduralGeometryWriter([
    'fieldstone',
    'rough-timber',
    'weathered-boards',
  ]);
  addAnnexTimberMember(
    writer,
    plan,
    'wall-ledger',
    [plan.ledger.x, plan.ledger.y, -plan.ledger.zHalfSpan],
    [plan.ledger.x, plan.ledger.y, plan.ledger.zHalfSpan],
    0.2,
    0.22,
  );
  addAnnexTimberMember(
    writer,
    plan,
    'post-supported-eave-beam',
    [plan.eave.x, plan.eave.y, -plan.eave.zHalfSpan],
    [plan.eave.x, plan.eave.y, plan.eave.zHalfSpan],
    0.2,
    0.22,
  );
  for (const [index, z] of plan.postZ.entries()) {
    addAnnexTimberMember(
      writer,
      plan,
      `roof-bearing-post-${index + 1}`,
      [plan.eave.x, 0.22, z],
      [plan.eave.x, plan.eave.y, z],
      0.18,
      0.2,
    );
    writer.addBox({
      semanticId: `${plan.id}-fieldstone-post-footing-${index + 1}`,
      moduleId: plan.moduleId,
      materialRole: 'fieldstone',
      structuralUse: 'foundation-and-plinth',
      center: [plan.eave.x, 0.12, z],
      size: [0.32, 0.24, 0.34],
    });
  }

  const fixture = plan.fixture;
  writer.addBox({
    semanticId: `${plan.id}-${fixture.kind}-boarded-worktop`,
    moduleId: plan.moduleId,
    materialRole: 'weathered-boards',
    structuralUse: 'board-cladding',
    center: [fixture.centerX, fixture.topY, fixture.centerZ],
    size: [fixture.width, 0.14, fixture.depth],
  });
  for (const [xSign, zSign] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addAnnexTimberMember(
      writer,
      plan,
      `${fixture.kind}-leg-${xSign}-${zSign}`,
      [
        fixture.centerX + xSign * (fixture.width * 0.36),
        0.12,
        fixture.centerZ + zSign * (fixture.depth * 0.34),
      ],
      [
        fixture.centerX + xSign * (fixture.width * 0.36),
        fixture.topY - 0.06,
        fixture.centerZ + zSign * (fixture.depth * 0.34),
      ],
      0.13,
      0.13,
    );
  }
  if (fixture.kind === 'tool-bench-and-chest') {
    writer.addBox({
      semanticId: `${plan.id}-brown-weathered-board-tool-chest`,
      moduleId: plan.moduleId,
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [fixture.centerX, 0.37, fixture.centerZ - 0.86],
      size: [1.02, 0.62, 0.62],
      uvOffsetMeters: [0.27, 0.13],
    });
  }

  const compiled = writer.build();
  const slots = addProceduralMaterialSlotMeshes(annex, compiled, {
    namePrefix: plan.label,
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryDark' },
      'rough-timber': { source: 'construction', key: 'timberDark' },
    },
  });
  const footings = slots.meshes.get('fieldstone');
  if (footings) footings.name = `${plan.label} two fieldstone post footings`;
  const frame = slots.meshes.get('rough-timber');
  if (frame) {
    frame.name = `${plan.label} joined brown timber frame and bench legs`;
    frame.userData.structuralMemberCount = frame.userData.proceduralPrimitiveCount;
  }
  const boards = slots.meshes.get('weathered-boards');
  if (boards) boards.name = `${plan.label} brown weathered-board work fixture`;

  const roof = addLeanToRoof(annex, {
    width: plan.roof.width,
    depth: plan.roof.depth,
    thickness: 0.13,
    material: shingleMaterial(),
    position: new THREE.Vector3(plan.roof.centerX, plan.roof.centerY, 0),
    pitch: plan.roof.pitch,
    highEdge: 'negativeX',
    name: `${plan.label} joined split-shingle roof`,
  });
  roof.userData.proceduralRoofAttachment = 'wall-ledger-to-post-supported-eave';
  annex.userData.architectureCompiler = {
    geometryWriter: compiled.version,
    triangleCount: slots.triangleCount,
    drawCalls: slots.drawCalls + 1,
  };
}

/** Compact woodland work hut with a connected, vegetation-free tool porch. */
export function createReforesterHutMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Reforester hut';
  group.userData.architecturePlan = REFORESTER_ARCHITECTURE_PLAN;
  const shell = addGableShell(group, {
    ...REFORESTER_ARCHITECTURE_PLAN.shell,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(
    group,
    REFORESTER_ARCHITECTURE_PLAN.openings.frontDoorX,
    0.62,
    shell.frontZ + 0.02,
    0.94,
    1.86,
  );
  addSmallWindow(
    group,
    REFORESTER_ARCHITECTURE_PLAN.openings.frontWindowX,
    1.64,
    shell.frontZ + 0.02,
    0.76,
    0.92,
  );
  addSmallWindow(
    group,
    REFORESTER_ARCHITECTURE_PLAN.openings.rearWindowX,
    1.66,
    shell.backZ - 0.02,
    0.62,
    0.72,
  );
  addReforesterToolPorch(group, shell.halfW);
  return group;
}

function addChoppingShelter(group: THREE.Group, halfW: number): void {
  addForestryWorkAnnex(group, WOODCUTTERS_ARCHITECTURE_PLAN.annex, halfW);
  const block = addMesh(
    group,
    new THREE.CylinderGeometry(0.46, 0.52, 0.56, 10),
    timberMaterial('dark'),
    new THREE.Vector3(4.25, 0.28, 0.42),
  );
  block.name = 'Woodcutters empty brown timber splitting block';
}

function createWoodcuttersFirewoodStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'WoodcuttersFirewoodStockpile';
  stockpile.visible = false;
  const positions = [
    [-2.45, -3.72],
    [-0.78, -3.72],
    [0.89, -3.72],
    [2.56, -3.72],
  ] as const;
  for (const [x, z] of positions) {
    const segment = new THREE.Group();
    segment.name = 'WoodcuttersFirewoodSegment';
    addLogPile(segment, x, z, 0, 3, 1.42, 0.14);
    stockpile.add(segment);
  }
  return stockpile;
}

/** Firewood workshop with a stone-and-lime lodge and dedicated chopping shelter. */
export function createWoodcuttersLodgeMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Woodcutter's lodge";
  group.userData.architecturePlan = WOODCUTTERS_ARCHITECTURE_PLAN;
  const shell = addGableShell(group, {
    ...WOODCUTTERS_ARCHITECTURE_PLAN.shell,
    wallMaterial: residenceFacadeMaterial('lightOrange'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(
    group,
    WOODCUTTERS_ARCHITECTURE_PLAN.openings.frontDoorX,
    0.76,
    shell.frontZ + 0.02,
    1.0,
    1.9,
  );
  addSmallWindow(
    group,
    WOODCUTTERS_ARCHITECTURE_PLAN.openings.frontWindowX,
    1.82,
    shell.frontZ + 0.02,
    0.82,
    1.0,
  );
  addSmallWindow(
    group,
    WOODCUTTERS_ARCHITECTURE_PLAN.openings.rearWindowX,
    1.78,
    shell.backZ - 0.02,
    0.68,
    0.78,
  );
  addChoppingShelter(group, shell.halfW);
  group.add(createWoodcuttersFirewoodStockpile());
  return group;
}
