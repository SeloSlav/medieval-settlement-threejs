import * as THREE from 'three';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import {
  addMesh,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addProceduralDoor,
  addProceduralWindow,
  type DoorEntranceAccess,
} from './facadeOpeningKit.ts';
import {
  createProceduralRoofPanelGeometry,
  ProceduralGeometryWriter,
} from '../proceduralArchitecture/geometryWriter.ts';

export type GableShellOptions = {
  width: number;
  depth: number;
  stoneHeight: number;
  wallHeight: number;
  ridgeHeight: number;
  wallMaterial: THREE.Material;
  roofMaterial: THREE.Material;
  centerX?: number;
  centerZ?: number;
  stoneGroundFloor?: boolean;
};

export type GableShell = {
  width: number;
  depth: number;
  halfW: number;
  halfD: number;
  wallTop: number;
  ridgeHeight: number;
  frontZ: number;
  backZ: number;
  centerX: number;
  centerZ: number;
};

export type LeanToHighEdge = 'negativeX' | 'positiveX' | 'negativeZ' | 'positiveZ';

export type LeanToRoofOptions = {
  width: number;
  depth: number;
  thickness: number;
  material: THREE.Material;
  position: THREE.Vector3;
  pitch: number;
  highEdge: LeanToHighEdge;
  name: string;
};

export type HippedRoofOptions = {
  width: number;
  depth: number;
  eaveY: number;
  peakY: number;
  thickness: number;
  material: THREE.Material;
  centerX?: number;
  centerZ?: number;
  name: string;
};

type GableFacadeOpening = {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
};

type GableFacadeRecord = {
  readonly group: THREE.Group;
  readonly centerX: number;
  readonly stoneHeight: number;
  readonly wallHeight: number;
  readonly bodyWidth: number;
  readonly frontZ: number;
  readonly backZ: number;
  readonly wallThickness: number;
  readonly wallMaterial: THREE.Material;
  readonly openings: Record<'positive-z' | 'negative-z', GableFacadeOpening[]>;
  meshes: Partial<Record<'positive-z' | 'negative-z', THREE.Mesh>>;
};

const GABLE_FACADES = new WeakMap<THREE.Group, GableFacadeRecord[]>();

/**
 * Adds a shallow attached roof with an explicit high edge.
 *
 * Lean-tos occur on every side of a building, and raw Euler signs are easy to
 * reverse: positive X rotation lowers +Z, while positive Z rotation raises +X.
 * Naming the attachment edge here keeps roofs draining away from their wall.
 */
export function addLeanToRoof(group: THREE.Group, options: LeanToRoofOptions): THREE.Mesh {
  const {
    width,
    depth,
    thickness,
    material,
    position,
    pitch,
    highEdge,
    name,
  } = options;
  const resolvedPitch = Math.abs(pitch);
  const slopesAlongX = highEdge === 'negativeX' || highEdge === 'positiveX';
  const slopeSpan = slopesAlongX ? width : depth;
  const eaveSpan = slopesAlongX ? depth : width;
  const run = Math.cos(resolvedPitch) * slopeSpan;
  const rise = Math.sin(resolvedPitch) * slopeSpan;
  const eaveVector = new THREE.Vector3();
  const slopeVector = new THREE.Vector3();
  switch (highEdge) {
    case 'negativeX':
      eaveVector.set(0, 0, -eaveSpan);
      slopeVector.set(-run, rise, 0);
      break;
    case 'positiveX':
      eaveVector.set(0, 0, eaveSpan);
      slopeVector.set(run, rise, 0);
      break;
    case 'negativeZ':
      eaveVector.set(eaveSpan, 0, 0);
      slopeVector.set(0, rise, -run);
      break;
    case 'positiveZ':
      eaveVector.set(-eaveSpan, 0, 0);
      slopeVector.set(0, rise, run);
      break;
  }

  const roofRole = proceduralRoofRoleOrNull(material);
  let geometry: THREE.BufferGeometry;
  if (roofRole) {
    // Place the writer's top skin around the former primitive centre. That
    // preserves every authored clearance while giving porches, work bays, and
    // cloisters a true eave/slope UV frame instead of box-projected courses.
    const outward = new THREE.Vector3().crossVectors(eaveVector, slopeVector).normalize();
    if (outward.y < 0) outward.negate();
    const topCenter = position.clone().addScaledVector(outward, thickness * 0.5);
    const eaveOrigin = topCenter.clone()
      .addScaledVector(eaveVector, -0.5)
      .addScaledVector(slopeVector, -0.5);
    geometry = createProceduralRoofPanelGeometry({
      semanticId: `lean-to-${highEdge}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      moduleId: 'attached-lean-to-roof',
      materialRole: roofRole,
      structuralUse: 'roof-covering',
      eaveOrigin: [eaveOrigin.x, eaveOrigin.y, eaveOrigin.z],
      eaveVector: [eaveVector.x, eaveVector.y, eaveVector.z],
      slopeVector: [slopeVector.x, slopeVector.y, slopeVector.z],
      thickness,
    });
  } else {
    // Flexible canvas flies need sewn-panel geometry and are intentionally not
    // mislabelled as permanent roof covering. Preserve their existing thin
    // fallback until the owning generator supplies a sagging fabric surface.
    geometry = new THREE.BoxGeometry(width, thickness, depth);
    if (highEdge === 'negativeX') geometry.rotateZ(-resolvedPitch);
    if (highEdge === 'positiveX') geometry.rotateZ(resolvedPitch);
    if (highEdge === 'negativeZ') geometry.rotateX(resolvedPitch);
    if (highEdge === 'positiveZ') geometry.rotateX(-resolvedPitch);
    geometry.translate(position.x, position.y, position.z);
  }

  const roof = addMesh(group, geometry, material, new THREE.Vector3());
  roof.name = name;
  roof.userData.leanToHighEdge = highEdge;
  roof.userData.leanToPitch = resolvedPitch;
  roof.userData.proceduralRoofShell = true;
  roof.userData.proceduralRoofAttachment = 'lean-to';
  return roof;
}

/**
 * Adds a four-face hipped/pyramidal cap as one course-aligned material slot.
 * This replaces four-sided ConeGeometry caps whose cylindrical UVs rotate and
 * stretch shingles independently on every face.
 */
export function addHippedRoof(group: THREE.Group, options: HippedRoofOptions): THREE.Mesh {
  const {
    width,
    depth,
    eaveY,
    peakY,
    thickness,
    material,
    centerX = 0,
    centerZ = 0,
    name,
  } = options;
  if (![width, depth, thickness].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`${name} hipped-roof dimensions must be finite and positive.`);
  }
  if (!Number.isFinite(eaveY) || !Number.isFinite(peakY) || peakY <= eaveY) {
    throw new Error(`${name} hipped-roof peak must be finite and above its eave.`);
  }
  const role = proceduralRoofRole(material);
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const rise = peakY - eaveY;
  const writer = new ProceduralGeometryWriter([role]);
  const common = {
    moduleId: 'joined-hipped-roof',
    materialRole: role,
    structuralUse: 'roof-covering' as const,
    thickness,
  };
  writer.addRoofTriangle({
    ...common,
    semanticId: `${name}-positive-z-face`,
    eaveOrigin: [centerX - halfW, eaveY, centerZ + halfD],
    eaveVector: [width, 0, 0],
    apexOffset: [0, rise, -halfD],
  });
  writer.addRoofTriangle({
    ...common,
    semanticId: `${name}-positive-x-face`,
    eaveOrigin: [centerX + halfW, eaveY, centerZ + halfD],
    eaveVector: [0, 0, -depth],
    apexOffset: [-halfW, rise, 0],
    uvOffsetMeters: [0.13, 0.07],
  });
  writer.addRoofTriangle({
    ...common,
    semanticId: `${name}-negative-z-face`,
    eaveOrigin: [centerX + halfW, eaveY, centerZ - halfD],
    eaveVector: [-width, 0, 0],
    apexOffset: [0, rise, halfD],
    uvOffsetMeters: [0.26, 0.14],
  });
  writer.addRoofTriangle({
    ...common,
    semanticId: `${name}-negative-x-face`,
    eaveOrigin: [centerX - halfW, eaveY, centerZ - halfD],
    eaveVector: [0, 0, depth],
    apexOffset: [halfW, rise, 0],
    uvOffsetMeters: [0.39, 0.21],
  });
  const slot = writer.build().slots[0];
  if (!slot) throw new Error(`${name} hipped roof emitted no geometry.`);
  const roof = addMesh(group, slot.geometry, material, new THREE.Vector3());
  roof.name = name;
  roof.userData.proceduralRoofShell = true;
  roof.userData.proceduralRoofAttachment = 'hipped-cap';
  roof.userData.proceduralMaterialRole = role;
  roof.userData.proceduralPrimitiveCount = 4;
  return roof;
}

export function addGableShell(group: THREE.Group, options: GableShellOptions): GableShell {
  const {
    width,
    depth,
    stoneHeight,
    wallHeight,
    ridgeHeight,
    wallMaterial,
    roofMaterial,
    centerX = 0,
    centerZ = 0,
    stoneGroundFloor = false,
  } = options;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const frontZ = centerZ + halfD - 0.075;
  const backZ = centerZ - halfD + 0.075;
  const bodyWidth = width - 0.12;
  const bodyDepth = depth - 0.12;
  const wallThickness = 0.16;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, stoneHeight, depth + 0.38),
    stoneMaterial(stoneGroundFloor ? 'mid' : 'light'),
    new THREE.Vector3(centerX, stoneHeight * 0.5, centerZ),
  );

  // A hollow wall shell gives every registered door/window a real aperture.
  // The old solid box left a wall directly behind its black reveal and made
  // even correctly modeled openings read as decals.
  const facadeRecord: GableFacadeRecord = {
    group,
    centerX,
    stoneHeight,
    wallHeight,
    bodyWidth,
    frontZ,
    backZ,
    wallThickness,
    wallMaterial,
    openings: { 'positive-z': [], 'negative-z': [] },
    meshes: {},
  };
  const facadeRecords = GABLE_FACADES.get(group) ?? [];
  facadeRecords.push(facadeRecord);
  GABLE_FACADES.set(group, facadeRecords);
  rebuildGableFacade(facadeRecord, 'positive-z');
  rebuildGableFacade(facadeRecord, 'negative-z');

  for (const side of [-1, 1] as const) {
    const wall = addMesh(
      group,
      new THREE.BoxGeometry(wallThickness, wallHeight, bodyDepth - wallThickness * 2),
      wallMaterial,
      new THREE.Vector3(
        centerX + side * (bodyWidth * 0.5 - wallThickness * 0.5),
        stoneHeight + wallHeight * 0.5,
        centerZ,
      ),
    );
    wall.name = `Gable shell ${side < 0 ? 'left' : 'right'} side wall`;
    wall.userData.proceduralWallShell = true;
  }

  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const postHeight = Math.max(0.24, wallHeight - 0.16);
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.22, postHeight, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(
        centerX + sx * (halfW - 0.12),
        stoneHeight + postHeight * 0.5,
        centerZ + sz * (halfD - 0.12),
      ),
    );
    post.name = 'Gable shell corner post joined below wall plate';
  }

  // Four wall plates terminate the posts and visibly carry the rafters. Their
  // top is kept below the roof skin, so no beam can pierce the eave or verge.
  for (const zSign of [-1, 1] as const) {
    const plate = addMesh(
      group,
      new THREE.BoxGeometry(bodyWidth, 0.18, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(centerX, wallTop - 0.09, centerZ + zSign * (halfD - 0.12)),
    );
    plate.name = 'Gable shell transverse wall plate';
  }
  for (const xSign of [-1, 1] as const) {
    const plate = addMesh(
      group,
      new THREE.BoxGeometry(0.2, 0.18, bodyDepth - 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(centerX + xSign * (halfW - 0.12), wallTop - 0.09, centerZ),
    );
    plate.name = 'Gable shell longitudinal wall plate';
  }

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.065),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      wallMaterial,
      0,
      centerX,
      centerZ,
    );
  }

  const roofDepth = depth + 0.48;
  const roofRun = halfW + 0.28;
  const eaveY = wallTop - 0.045;
  const roofRise = ridgeHeight + 0.065;
  const roofRole = proceduralRoofRole(roofMaterial);
  const leftRoof = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'gable-shell-left-roof-plane',
      moduleId: 'joined-gable-roof',
      materialRole: roofRole,
      structuralUse: 'roof-covering',
      eaveOrigin: [centerX - roofRun, eaveY, centerZ - roofDepth * 0.5],
      eaveVector: [0, 0, roofDepth],
      slopeVector: [roofRun, roofRise, 0],
      thickness: 0.13,
    }),
    roofMaterial,
    new THREE.Vector3(),
  );
  leftRoof.name = 'Gable shell joined left roof plane';
  leftRoof.userData.proceduralRoofShell = true;
  const rightRoof = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'gable-shell-right-roof-plane',
      moduleId: 'joined-gable-roof',
      materialRole: roofRole,
      structuralUse: 'roof-covering',
      eaveOrigin: [centerX + roofRun, eaveY, centerZ + roofDepth * 0.5],
      eaveVector: [0, 0, -roofDepth],
      slopeVector: [-roofRun, roofRise, 0],
      thickness: 0.13,
      uvOffsetMeters: [0.13, 0.07],
    }),
    roofMaterial,
    new THREE.Vector3(),
  );
  rightRoof.name = 'Gable shell joined right roof plane';
  rightRoof.userData.proceduralRoofShell = true;

  const ridge = addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.09, roofDepth + 0.1),
    roofMaterial,
    new THREE.Vector3(centerX, eaveY + roofRise + 0.015, centerZ),
  );
  ridge.name = 'Gable shell low-profile roof-covering ridge cap';
  ridge.userData.proceduralRoofShell = true;

  return { width, depth, halfW, halfD, wallTop, ridgeHeight, frontZ, backZ, centerX, centerZ };
}

export function addPlankDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  width = 1.02,
  height = 1.92,
  entranceAccess: DoorEntranceAccess = 'auto-stone-steps',
): void {
  const resolvedFacade = resolveGableFacade(group, z);
  addProceduralDoor(group, {
    position: new THREE.Vector3(x, baseY, z),
    face: resolvedFacade?.face ?? (z < 0 ? 'negative-z' : 'positive-z'),
    width,
    height,
    namePrefix: 'Building',
    entranceAccess,
  });
  registerGableFacadeOpening(
    resolvedFacade,
    x,
    baseY,
    baseY + height + 0.06,
    width + 0.08,
  );
}

export function addDarkOpening(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): void {
  const resolvedFacade = resolveGableFacade(group, z);
  const frame = addMesh(
    group,
    new THREE.BoxGeometry(width + 0.24, height + 0.2, 0.1),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z),
  );
  frame.name = 'Building dark structural opening frame';
  frame.userData.facadeOpeningRole = 'dark-opening-frame';
  const reveal = addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.12),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(x, y, z + 0.07),
  );
  reveal.name = 'Building dark recessed opening';
  reveal.userData.facadeOpeningRole = 'dark-opening-reveal';
  registerGableFacadeOpening(
    resolvedFacade,
    x,
    y - height * 0.5 - 0.04,
    y + height * 0.5 + 0.04,
    width + 0.08,
  );
}

export function addSmallWindow(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width = 0.78,
  height = 1.0,
): void {
  const resolvedFacade = resolveGableFacade(group, z);
  addProceduralWindow(group, {
    position: new THREE.Vector3(x, y, z),
    face: resolvedFacade?.face ?? (z < 0 ? 'negative-z' : 'positive-z'),
    width,
    height,
    namePrefix: 'Building',
  });
  registerGableFacadeOpening(
    resolvedFacade,
    x,
    y - height * 0.5 - 0.04,
    y + height * 0.5 + 0.04,
    width + 0.08,
  );
}

function proceduralRoofRole(
  material: THREE.Material,
): 'split-shingles' | 'clay-tiles' | 'slate' {
  const role = proceduralRoofRoleOrNull(material);
  if (role) return role;
  throw new Error(
    `Gable roof material ${material.name || material.type} has no permitted circa-1550 roof role.`,
  );
}

function proceduralRoofRoleOrNull(
  material: THREE.Material,
): 'split-shingles' | 'clay-tiles' | 'slate' | null {
  const name = material.name.toLowerCase();
  if (name.includes('clayred') || name.includes('claydark')) return 'clay-tiles';
  if (name.includes('slate')) return 'slate';
  if (name.includes('shingle')) return 'split-shingles';
  return null;
}

function resolveGableFacade(
  group: THREE.Group,
  z: number,
): { readonly record: GableFacadeRecord; readonly face: 'positive-z' | 'negative-z' } | null {
  const records = GABLE_FACADES.get(group);
  if (!records || records.length === 0) return null;
  let best: { record: GableFacadeRecord; face: 'positive-z' | 'negative-z'; distance: number } | null = null;
  for (const record of records) {
    for (const [face, plane] of [
      ['positive-z', record.frontZ],
      ['negative-z', record.backZ],
    ] as const) {
      const distance = Math.abs(z - plane);
      if (!best || distance < best.distance) best = { record, face, distance };
    }
  }
  // Side-wall, tower, and free-standing openings may share the same parent
  // group. Only mutate a gable facade when the caller is genuinely on its
  // front/rear plane; otherwise the nearest-record heuristic can cut a remote
  // wall behind an unrelated vent.
  return best && best.distance <= 0.35
    ? { record: best.record, face: best.face }
    : null;
}

function registerGableFacadeOpening(
  resolved: { readonly record: GableFacadeRecord; readonly face: 'positive-z' | 'negative-z' } | null,
  worldX: number,
  worldYMin: number,
  worldYMax: number,
  width: number,
): void {
  if (!resolved) return;
  const { record, face } = resolved;
  const x = worldX - record.centerX;
  const yMin = THREE.MathUtils.clamp(worldYMin - record.stoneHeight, 0.015, record.wallHeight - 0.03);
  const yMax = THREE.MathUtils.clamp(worldYMax - record.stoneHeight, yMin + 0.02, record.wallHeight - 0.015);
  const halfWidth = Math.max(0.03, width * 0.5);
  record.openings[face].push({
    xMin: THREE.MathUtils.clamp(x - halfWidth, -record.bodyWidth * 0.5 + 0.02, record.bodyWidth * 0.5 - 0.04),
    xMax: THREE.MathUtils.clamp(x + halfWidth, -record.bodyWidth * 0.5 + 0.04, record.bodyWidth * 0.5 - 0.02),
    yMin,
    yMax,
  });
  rebuildGableFacade(record, face);
}

function rebuildGableFacade(
  record: GableFacadeRecord,
  face: 'positive-z' | 'negative-z',
): void {
  const shape = new THREE.Shape();
  const halfWidth = record.bodyWidth * 0.5;
  shape.moveTo(-halfWidth, 0);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(halfWidth, record.wallHeight);
  shape.lineTo(-halfWidth, record.wallHeight);
  shape.closePath();
  for (const opening of record.openings[face]) {
    const hole = new THREE.Path();
    // Clockwise hole winding keeps the aperture stable in Shape triangulation.
    hole.moveTo(opening.xMin, opening.yMin);
    hole.lineTo(opening.xMin, opening.yMax);
    hole.lineTo(opening.xMax, opening.yMax);
    hole.lineTo(opening.xMax, opening.yMin);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: record.wallThickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -record.wallThickness * 0.5);

  const previous = record.meshes[face];
  if (previous) {
    previous.removeFromParent();
    previous.geometry.dispose();
  }
  const wall = addMesh(
    record.group,
    geometry,
    record.wallMaterial,
    new THREE.Vector3(
      record.centerX,
      record.stoneHeight,
      face === 'positive-z' ? record.frontZ : record.backZ,
    ),
  );
  wall.name = `Gable shell ${face} perforated wall`;
  wall.userData.proceduralWallShell = true;
  wall.userData.proceduralFacadeOpeningCount = record.openings[face].length;
  record.meshes[face] = wall;
}

export function addBarrel(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.34 * scale, 0.38 * scale, 0.72 * scale, 10),
    timberMaterial('mid'),
    new THREE.Vector3(x, 0.36 * scale, z),
  );
  for (const y of [0.14, 0.58]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.36 * scale, 0.025 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, y * scale, z),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

export function addCrate(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.78 * scale, 0.58 * scale, 0.68 * scale),
    timberMaterial('weathered'),
    new THREE.Vector3(x, 0.29 * scale, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.84 * scale, 0.07 * scale, 0.08 * scale),
    timberMaterial('dark'),
    new THREE.Vector3(x, 0.42 * scale, z + 0.34 * scale),
  );
}
