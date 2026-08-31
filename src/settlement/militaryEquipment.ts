import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  createMilitaryEquipmentMaterials,
  type MilitaryEquipmentMaterials,
} from './militaryEquipmentMaterials.ts';

export const MILITARY_EQUIPMENT_KINDS = [
  'spear',
  'spear-shield',
  'pike-kit',
  'crossbow',
  'sidearm',
  'sidearm-shield',
  'sword-shield',
  'halberd',
  'bow',
  'uskok-kit',
] as const;

export type MilitaryEquipmentKind = (typeof MILITARY_EQUIPMENT_KINDS)[number];

export type MilitaryEquipmentCombatStance = 'melee' | 'ranged';
export type MilitaryEquipmentCombatRole =
  | 'always'
  | 'melee-held'
  | 'melee-stowed'
  | 'ranged-held'
  | 'ranged-stowed';

const MILITARY_EQUIPMENT_KIND_SET: ReadonlySet<string> = new Set(
  MILITARY_EQUIPMENT_KINDS,
);

/**
 * Narrows the unified worker-tool catalog to persistent combat equipment.
 * Military kits remain bone-mounted throughout their owner's animation
 * lifecycle; hiding or detaching one must be an explicit gameplay event.
 */
export function isMilitaryEquipmentKind(
  kind: string,
): kind is MilitaryEquipmentKind {
  return MILITARY_EQUIPMENT_KIND_SET.has(kind);
}

export type MilitaryEquipmentMountSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceLength: number;
  targetLength: number;
  boneNames: readonly string[];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  quaternion?: readonly [number, number, number, number];
  combatRole: MilitaryEquipmentCombatRole;
};

export type MilitaryEquipmentSource = {
  militaryEquipment: true;
  kind: MilitaryEquipmentKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  sourceLength: number;
  targetLength: number;
  primaryBoneNames: readonly string[];
  primaryPosition: readonly [number, number, number];
  primaryQuaternion: readonly [number, number, number, number];
  primaryCombatRole: MilitaryEquipmentCombatRole;
  secondaryMounts: readonly MilitaryEquipmentMountSource[];
};

export type MilitaryEquipmentSources = Record<MilitaryEquipmentKind, MilitaryEquipmentSource>;

export type MilitaryEquipmentMountDiagnostic = {
  mount: 'primary' | 'secondary';
  bone: string;
  partCount: number;
  triangleCount: number;
  worldLength: number;
  semanticParts: string[];
};

type Materials = MilitaryEquipmentMaterials;

const TARGET_LENGTHS: Record<MilitaryEquipmentKind, number> = {
  spear: 2.35,
  'spear-shield': 2.65,
  'pike-kit': 4.7,
  crossbow: 0.74,
  sidearm: 0.82,
  'sidearm-shield': 0.82,
  'sword-shield': 1.08,
  halberd: 2.55,
  bow: 1.88,
  'uskok-kit': 0.86,
};

// Sampled against the worker rig's authored idle, not the misleading T-pose.
const RIGHT_PALM_POSITION = [0.0078, 0.057, -0.0071] as const;
const LEFT_PALM_POSITION = [-0.0065, 0.0383, -0.0037] as const;
const UPRIGHT_RIGHT_HAND = [-0.145608, -0.102947, -0.976031, 0.124758] as const;
const FORWARD_RIGHT_HAND = [-0.014743, -0.762952, -0.617363, 0.191177] as const;
const FORWARD_LEFT_HAND = [0.176702, -0.13146, -0.962764, -0.156782] as const;
const NATURAL_RIGHT_HAND = [0, 0, 0, 1] as const;

export function createMilitaryEquipmentSources(): MilitaryEquipmentSources {
  const materials = createMilitaryEquipmentMaterials();
  return {
    spear: source('spear', createSpear(materials), UPRIGHT_RIGHT_HAND),
    'spear-shield': source('spear-shield', createSpear(materials), UPRIGHT_RIGHT_HAND, [
      mount(createShield('medium', materials), ['PalmL', 'L_Hand'], 0.56, LEFT_PALM_POSITION, [0, 0, 0], FORWARD_LEFT_HAND),
    ]),
    'pike-kit': source('pike-kit', createPike(materials), UPRIGHT_RIGHT_HAND, [
      mount(createKatzbalgerScabbard(materials), ['Waist', 'Hips', 'Pelvis'], 0.82, [0.1, 0, 0.015], [0, 0, Math.PI - 0.18]),
    ]),
    crossbow: source('crossbow', createCrossbow(materials), FORWARD_RIGHT_HAND, [
      mount(
        createBoltCase(materials),
        ['Spine02', 'Spine2', 'Spine01', 'Spine'],
        0.54,
        [0.065, 0.02, 0.085],
        [0.08, 0.12, -0.18],
      ),
      mount(createCrossbow(materials), ['Spine02', 'Spine2', 'Spine01', 'Spine'], 0.74, [0.07, 0.015, 0.105], [0.08, -0.22, 0.82], undefined, 'ranged-stowed'),
      mount(createFallbackDagger(materials), ['PalmR', 'R_Hand'], 0.42, RIGHT_PALM_POSITION, [0, 0, 0], NATURAL_RIGHT_HAND, 'melee-held'),
      mount(createFallbackDaggerScabbard(materials), ['Waist', 'Hips', 'Pelvis'], 0.46, [0.11, 0, 0.02], [0, 0, Math.PI - 0.2], undefined, 'melee-stowed'),
    ], 'ranged-held'),
    sidearm: source('sidearm', createSword(materials, false), NATURAL_RIGHT_HAND),
    'sidearm-shield': source('sidearm-shield', createSword(materials, false), NATURAL_RIGHT_HAND, [
      mount(createShield('small', materials), ['PalmL', 'L_Hand'], 0.34, LEFT_PALM_POSITION, [0, 0, 0], FORWARD_LEFT_HAND),
    ]),
    'sword-shield': source('sword-shield', createSword(materials, true), NATURAL_RIGHT_HAND, [
      mount(createShield('large', materials), ['PalmL', 'L_Hand'], 0.62, LEFT_PALM_POSITION, [0, 0, 0], FORWARD_LEFT_HAND),
    ]),
    halberd: source('halberd', createHalberd(materials), UPRIGHT_RIGHT_HAND),
    bow: source('bow', createBow(materials), FORWARD_LEFT_HAND, [
      mount(
        createQuiver(materials, 12, 0.78),
        ['Spine02', 'Spine2', 'Spine01', 'Spine'],
        0.86,
        [0.065, 0.02, 0.085],
        [0.04, -0.18, -0.18],
      ),
      mount(createBow(materials), ['Spine02', 'Spine2', 'Spine01', 'Spine'], 1.88, [0.08, 0.02, 0.105], [0.04, -0.2, 0.18], undefined, 'ranged-stowed'),
      mount(createFallbackDagger(materials), ['PalmR', 'R_Hand'], 0.42, RIGHT_PALM_POSITION, [0, 0, 0], NATURAL_RIGHT_HAND, 'melee-held'),
      mount(createFallbackDaggerScabbard(materials), ['Waist', 'Hips', 'Pelvis'], 0.46, [0.11, 0, 0.02], [0, 0, Math.PI - 0.2], undefined, 'melee-stowed'),
    ], 'ranged-held', ['PalmL', 'L_Hand'], LEFT_PALM_POSITION),
    'uskok-kit': source('uskok-kit', createKorda(materials), NATURAL_RIGHT_HAND, [
      mount(
        createArquebus(materials),
        ['Spine02', 'Spine2', 'Spine01', 'Spine'],
        1.08,
        [-0.065, 0.015, 0.09],
        [0.06, -0.06, 0.5],
        undefined,
        'ranged-stowed',
      ),
      mount(
        createArquebus(materials),
        ['PalmR', 'R_Hand'],
        1.08,
        RIGHT_PALM_POSITION,
        [0, 0, 0],
        FORWARD_RIGHT_HAND,
        'ranged-held',
      ),
      mount(
        createUskokScabbard(materials),
        ['Waist', 'Hips', 'Pelvis'],
        0.86,
        [0.1, 0, 0.015],
        [0, 0, Math.PI - 0.18],
        undefined,
        'melee-stowed',
      ),
    ], 'melee-held'),
  };
}

export function isMilitaryEquipmentSource(
  value: { kind: string },
): value is MilitaryEquipmentSource {
  return (value as Partial<MilitaryEquipmentSource>).militaryEquipment === true;
}

function source(
  kind: MilitaryEquipmentKind,
  scene: THREE.Group,
  primaryQuaternion: readonly [number, number, number, number],
  secondaryMounts: readonly MilitaryEquipmentMountSource[] = [],
  primaryCombatRole: MilitaryEquipmentCombatRole = 'melee-held',
  primaryBoneNames: readonly string[] = ['PalmR', 'R_Hand'],
  primaryPosition: readonly [number, number, number] = RIGHT_PALM_POSITION,
): MilitaryEquipmentSource {
  const optimized = optimizeAssembly(scene);
  const bounds = new THREE.Box3().setFromObject(optimized);
  const sourceSize = bounds.getSize(new THREE.Vector3());
  const sourceLength = Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
  if (!Number.isFinite(sourceLength) || sourceLength <= 0.001) {
    throw new Error(`Invalid procedural ${kind} bounds.`);
  }
  return {
    militaryEquipment: true,
    kind,
    scene: optimized,
    bounds,
    sourceSize,
    sourceLength,
    targetLength: TARGET_LENGTHS[kind],
    primaryBoneNames,
    primaryPosition,
    primaryQuaternion,
    primaryCombatRole,
    secondaryMounts,
  };
}

function mount(
  scene: THREE.Group,
  boneNames: readonly string[],
  targetLength: number,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
  quaternion?: readonly [number, number, number, number],
  combatRole: MilitaryEquipmentCombatRole = 'always',
): MilitaryEquipmentMountSource {
  const optimized = optimizeAssembly(scene);
  const bounds = new THREE.Box3().setFromObject(optimized);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    scene: optimized,
    bounds,
    sourceLength: Math.max(size.x, size.y, size.z),
    targetLength,
    boneNames,
    position,
    rotation,
    quaternion,
    combatRole,
  };
}

function semantic(mesh: THREE.Object3D, name: string): void {
  mesh.name = name;
  mesh.userData.semanticWeaponPart = name;
}

function add(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  semantic(mesh, name);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  return mesh;
}

function shapeGeometry(
  points: readonly (readonly [number, number])[],
  depth: number,
  bevel = Math.min(depth * 0.34, 0.012),
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index]![0], points[index]![1]);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 4,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Elliptical sweep for a bow stave: readable limb flats without a mesh-per-segment cost. */
function staveGeometry(
  points: readonly THREE.Vector3[],
  halfWidthAt: (fraction: number) => number,
  halfDepthAt: (fraction: number) => number,
  radialSegments = 8,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances[index] = distances[index - 1]! + points[index]!.distanceTo(points[index - 1]!);
  }
  const totalDistance = Math.max(0.001, distances.at(-1)!);
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const tangent = next.clone().sub(previous).normalize();
    const planarNormal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
    const binormal = new THREE.Vector3(0, 0, 1);
    const fraction = distances[index]! / totalDistance;
    const halfWidth = halfWidthAt(fraction);
    const halfDepth = halfDepthAt(fraction);
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      const vertex = points[index]!.clone()
        .addScaledVector(planarNormal, Math.cos(angle) * halfWidth)
        .addScaledVector(binormal, Math.sin(angle) * halfDepth);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(fraction * 3.2, radial / radialSegments);
    }
  }
  const row = radialSegments + 1;
  for (let index = 0; index < points.length - 1; index += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const a = index * row + radial;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
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

function addRivet(
  group: THREE.Group,
  material: THREE.Material,
  name: string,
  position: readonly [number, number, number],
  radius = 0.01,
): THREE.Mesh {
  return add(group, new THREE.SphereGeometry(radius, 8, 5), material, name, position);
}

function createSpear(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.018, 0.023, 1.84, 14), materials.ash, 'Spear · tapered ash shaft', [0, 0.46, 0]);
  add(group, new THREE.CylinderGeometry(0.03, 0.025, 0.14, 14), materials.bluedSteel, 'Spear · forged conical socket', [0, 1.41, 0]);
  add(group, new THREE.TorusGeometry(0.027, 0.005, 5, 12), materials.bluedSteel, 'Spear · socket collar', [0, 1.345, 0], [Math.PI / 2, 0, 0]);
  add(group, new RoundedBoxGeometry(0.012, 0.24, 0.008, 2, 0.002), materials.bluedSteel, 'Spear · front reinforcing langet', [0, 1.26, 0.021]);
  add(group, new RoundedBoxGeometry(0.012, 0.24, 0.008, 2, 0.002), materials.bluedSteel, 'Spear · rear reinforcing langet', [0, 1.26, -0.021]);
  add(
    group,
    shapeGeometry([[0, -0.14], [0.042, 0.03], [0.03, 0.13], [0, 0.25], [-0.03, 0.13], [-0.042, 0.03]], 0.022, 0.005),
    materials.steel,
    'Spear · leaf-shaped forged head',
    [0, 1.52, 0],
  );
  add(
    group,
    shapeGeometry([[0, -0.105], [0.008, 0.03], [0.005, 0.16], [0, 0.225], [-0.005, 0.16], [-0.008, 0.03]], 0.006, 0.0015),
    materials.bluedSteel,
    'Spear · forged central blade ridge',
    [0, 1.52, 0.014],
  );
  for (let index = 0; index < 3; index += 1) {
    add(group, new THREE.TorusGeometry(0.0225, 0.003, 5, 10), materials.leather, 'Spear · socket binding', [0, 1.19 - index * 0.016, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.ConeGeometry(0.034, 0.11, 10), materials.bluedSteel, 'Spear · iron butt cap', [0, -0.52, 0], [0, 0, Math.PI]);
  group.name = 'Procedural leaf spear';
  group.userData.equipmentIdentity = 'ordinary-leaf-spear';
  return group;
}

function createPike(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.014, 0.019, 4.36, 12), materials.ash, 'Pike · long waxed-ash shaft', [0, 1.68, 0]);
  add(group, new THREE.CylinderGeometry(0.021, 0.018, 0.18, 12), materials.bluedSteel, 'Pike · narrow iron socket', [0, 3.95, 0]);
  add(group, new THREE.TorusGeometry(0.0195, 0.004, 5, 10), materials.bluedSteel, 'Pike · socket collar', [0, 3.865, 0], [Math.PI / 2, 0, 0]);
  add(group, new RoundedBoxGeometry(0.009, 0.44, 0.007, 2, 0.002), materials.bluedSteel, 'Pike · front reinforcing langet', [0, 3.69, 0.017]);
  add(group, new RoundedBoxGeometry(0.009, 0.44, 0.007, 2, 0.002), materials.bluedSteel, 'Pike · rear reinforcing langet', [0, 3.69, -0.017]);
  add(
    group,
    shapeGeometry([[0, -0.1], [0.034, 0.03], [0.02, 0.14], [0, 0.26], [-0.02, 0.14], [-0.034, 0.03]], 0.018, 0.004),
    materials.steel,
    'Pike · compact armor-piercing head',
    [0, 4.08, 0],
  );
  add(
    group,
    shapeGeometry([[0, -0.07], [0.006, 0.04], [0.003, 0.18], [0, 0.245], [-0.003, 0.18], [-0.006, 0.04]], 0.005, 0.001),
    materials.bluedSteel,
    'Pike · forged head ridge',
    [0, 4.08, 0.011],
  );
  for (let index = 0; index < 4; index += 1) {
    add(group, new THREE.TorusGeometry(0.0185, 0.003, 5, 10), materials.leather, 'Pike · lower-hand grip binding', [0, 0.18 + index * 0.022, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.ConeGeometry(0.024, 0.1, 8), materials.bluedSteel, 'Pike · iron shoe', [0, -0.55, 0], [0, 0, Math.PI]);
  group.name = 'Procedural Landsknecht pike';
  group.userData.equipmentIdentity = 'mercenary-pike-and-katzbalger';
  return group;
}

function createSword(materials: Materials, longSword: boolean): THREE.Group {
  const group = new THREE.Group();
  const bladeLength = longSword ? 0.77 : 0.61;
  const bladeWidth = longSword ? 0.026 : 0.023;
  const guardSpan = longSword ? 0.17 : 0.145;
  add(
    group,
    shapeGeometry([
      [-bladeWidth, 0],
      [-bladeWidth, bladeLength * 0.12],
      [-bladeWidth * 0.82, bladeLength * 0.72],
      [0, bladeLength],
      [bladeWidth * 0.78, bladeLength * 0.72],
      [bladeWidth, bladeLength * 0.12],
      [bladeWidth, 0],
    ], longSword ? 0.021 : 0.019, 0.005),
    materials.steel,
    longSword ? 'Longsword · tapered double-edged blade' : 'Sidearm · tapered double-edged blade',
    [0, 0.17, 0],
  );
  for (const side of [-1, 1]) {
    const fuller = add(
      group,
      new RoundedBoxGeometry(0.016, bladeLength * 0.63, 0.0035, 2, 0.0015),
      materials.bluedSteel,
      side > 0 ? 'Sword · front recessed fuller' : 'Sword · rear recessed fuller',
      [0, 0.21 + bladeLength * 0.32, side * (longSword ? 0.012 : 0.011)],
    );
    fuller.scale.x = longSword ? 1.16 : 0.92;
  }
  add(group, new RoundedBoxGeometry(bladeWidth * 1.72, 0.075, 0.024, 2, 0.004), materials.bluedSteel, 'Sword · reinforced ricasso', [0, 0.2, 0]);
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-guardSpan, 0.015, 0),
    new THREE.Vector3(-guardSpan * 0.48, 0.046, 0),
    new THREE.Vector3(0, 0.032, 0),
    new THREE.Vector3(guardSpan * 0.48, 0.046, 0),
    new THREE.Vector3(guardSpan, 0.015, 0),
  ]);
  add(group, new THREE.TubeGeometry(guardCurve, 18, 0.014, 8, false), materials.bluedSteel, 'Sword · swept quillon guard');
  add(group, new RoundedBoxGeometry(0.085, 0.038, 0.044, 3, 0.01), materials.brass, 'Sword · guard block and rain collar', [0, 0.025, 0]);
  add(group, new THREE.CylinderGeometry(0.027, 0.031, 0.19, 10), materials.leather, 'Sword · leather-bound grip', [0, -0.085, 0]);
  for (let index = 0; index < 5; index += 1) {
    add(group, new THREE.TorusGeometry(0.03, 0.004, 5, 12), materials.brass, 'Sword · grip wire', [0, -0.015 - index * 0.035, 0], [Math.PI / 2, 0, 0]);
  }
  const pommel = add(group, new THREE.SphereGeometry(longSword ? 0.048 : 0.042, 14, 9), materials.brass, 'Sword · wheel pommel', [0, -0.2, 0]);
  pommel.scale.z = 0.52;
  addRivet(group, materials.bluedSteel, 'Sword · front pommel peen', [0, -0.2, 0.025], longSword ? 0.012 : 0.01);
  addRivet(group, materials.bluedSteel, 'Sword · rear pommel peen', [0, -0.2, -0.025], longSword ? 0.012 : 0.01);
  group.name = longSword ? 'Procedural longsword' : 'Procedural arming sword';
  group.userData.equipmentIdentity = longSword ? 'mail-company-longsword' : 'infantry-sidearm';
  return group;
}

function shieldOutline(kind: 'small' | 'medium' | 'large'): Array<readonly [number, number]> {
  if (kind === 'large') {
    return [
      [0.22, 0.3], [0, 0.325], [-0.22, 0.3], [-0.3, 0.19], [-0.305, 0.04],
      [-0.26, -0.12], [-0.17, -0.27], [0, -0.38], [0.17, -0.27], [0.26, -0.12],
      [0.305, 0.04], [0.3, 0.19],
    ];
  }
  const count = kind === 'small' ? 28 : 36;
  const radius = kind === 'small' ? 0.17 : 0.275;
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const handWorkedVariation = kind === 'small' ? 1 : 1 - 0.016 * Math.cos(angle * 4);
    return [
      Math.cos(angle) * radius * handWorkedVariation * (kind === 'medium' ? 0.94 : 1),
      Math.sin(angle) * radius * (kind === 'medium' ? 1.04 : 1),
    ] as const;
  });
}

/** Shallow concentric shell gives bucklers and targes a real light-catching convexity. */
function convexShieldGeometry(
  outline: readonly (readonly [number, number])[],
  thickness: number,
  bulge: number,
  rings = 4,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const maxX = Math.max(...outline.map(([x]) => Math.abs(x)));
  const maxY = Math.max(...outline.map(([, y]) => Math.abs(y)));
  const push = (x: number, y: number, z: number): number => {
    const index = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(x / (maxX * 2) + 0.5, y / (maxY * 2) + 0.5);
    return index;
  };
  const frontCenter = push(0, 0, thickness * 0.5 + bulge);
  const backCenter = push(0, 0, -thickness * 0.5 + bulge * 0.24);
  const frontRings: number[][] = [];
  const backRings: number[][] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = ring / rings;
    const crown = Math.pow(1 - radius, 1.45);
    frontRings.push(outline.map(([x, y]) => push(x * radius, y * radius, thickness * 0.5 + bulge * crown)));
    backRings.push(outline.map(([x, y]) => push(x * radius, y * radius, -thickness * 0.5 + bulge * crown * 0.24)));
  }
  const count = outline.length;
  for (let side = 0; side < count; side += 1) {
    const next = (side + 1) % count;
    indices.push(frontCenter, frontRings[0]![side]!, frontRings[0]![next]!);
    indices.push(backCenter, backRings[0]![next]!, backRings[0]![side]!);
  }
  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let side = 0; side < count; side += 1) {
      const next = (side + 1) % count;
      const frontA = frontRings[ring]![side]!;
      const frontB = frontRings[ring + 1]![side]!;
      const frontC = frontRings[ring]![next]!;
      const frontD = frontRings[ring + 1]![next]!;
      indices.push(frontA, frontB, frontC, frontB, frontD, frontC);
      const backA = backRings[ring]![side]!;
      const backB = backRings[ring]![next]!;
      const backC = backRings[ring + 1]![side]!;
      const backD = backRings[ring + 1]![next]!;
      indices.push(backA, backB, backC, backB, backD, backC);
    }
  }
  const frontEdge = frontRings.at(-1)!;
  const backEdge = backRings.at(-1)!;
  for (let side = 0; side < count; side += 1) {
    const next = (side + 1) % count;
    indices.push(frontEdge[side]!, backEdge[side]!, frontEdge[next]!);
    indices.push(backEdge[side]!, backEdge[next]!, frontEdge[next]!);
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

function createShield(kind: 'small' | 'medium' | 'large', materials: Materials): THREE.Group {
  const group = new THREE.Group();
  const outline = shieldOutline(kind);
  const depth = kind === 'small' ? 0.034 : 0.042;
  const bulge = kind === 'small' ? 0.034 : kind === 'medium' ? 0.052 : 0.046;
  add(
    group,
    convexShieldGeometry(outline, depth, bulge),
    kind === 'small' ? materials.walnut : materials.paintedWood,
    `${kind} shield · convex laminated and canvas-faced timber body`,
  );
  const rimPoints = outline.map(([x, y]) => new THREE.Vector3(x, y, depth * 0.5));
  add(
    group,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true, 'centripetal'), outline.length * 3, kind === 'large' ? 0.018 : 0.015, 6, true),
    materials.bluedSteel,
    `${kind} shield · rolled and riveted forged rim`,
  );
  const bossRadius = kind === 'small' ? 0.095 : kind === 'medium' ? 0.105 : 0.115;
  add(
    group,
    new THREE.SphereGeometry(bossRadius, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.steel,
    `${kind} shield · raised iron boss`,
    [0, 0, depth * 0.5 + bulge * 0.82],
    [Math.PI / 2, 0, 0],
  );
  add(group, new THREE.TorusGeometry(bossRadius * 1.05, 0.008, 5, 20), materials.bluedSteel, `${kind} shield · boss neck collar`, [0, 0, depth * 0.5 + bulge * 0.79]);
  const rivetCount = kind === 'large' ? outline.length : 8;
  for (let index = 0; index < rivetCount; index += 1) {
    const outlineIndex = Math.floor(index / rivetCount * outline.length) % outline.length;
    const [x, y] = outline[outlineIndex]!;
    addRivet(
      group,
      materials.brass,
      `${kind} shield · peened rim rivet`,
      [x * 0.84, y * 0.84, depth * 0.5 + bulge * 0.1],
      kind === 'small' ? 0.008 : 0.009,
    );
  }
  add(group, new RoundedBoxGeometry(kind === 'large' ? 0.43 : 0.3, 0.037, 0.03, 3, 0.01), materials.leather, `${kind} shield · adjustable rear arm strap`, [0, 0.07, -depth * 0.62], [0, 0, Math.PI / 2]);
  add(group, new THREE.CylinderGeometry(0.019, 0.019, kind === 'small' ? 0.2 : 0.25, 9), materials.walnut, `${kind} shield · shaped wooden hand grip`, [0, -0.04, -0.075], [0, 0, Math.PI / 2]);
  for (const x of [-0.13, 0.13]) {
    addRivet(group, materials.brass, `${kind} shield · rear strap rivet`, [x, 0.07, -depth * 0.73], 0.009);
  }
  group.name = `Procedural ${kind} shield`;
  group.userData.equipmentIdentity = `${kind}-shield`;
  return group;
}

function createHalberd(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.021, 0.026, 1.92, 14), materials.ash, 'Halberd · tapered ash haft', [0, 0.45, 0]);
  add(group, new THREE.CylinderGeometry(0.03, 0.027, 0.42, 14), materials.bluedSteel, 'Halberd · long forged socket', [0, 1.29, 0]);
  add(group, new RoundedBoxGeometry(0.014, 0.62, 0.009, 2, 0.002), materials.bluedSteel, 'Halberd · front socket langet', [0, 1.05, 0.024]);
  add(group, new RoundedBoxGeometry(0.014, 0.62, 0.009, 2, 0.002), materials.bluedSteel, 'Halberd · rear socket langet', [0, 1.05, -0.024]);
  add(group, shapeGeometry([[0, -0.08], [0.055, 0.08], [0, 0.31], [-0.055, 0.08]], 0.03, 0.007), materials.steel, 'Halberd · thrusting spike', [0, 1.49, 0]);
  add(group, shapeGeometry([[0, -0.15], [0.15, -0.11], [0.34, 0.03], [0.31, 0.25], [0.12, 0.18], [0, 0.12]], 0.036, 0.009), materials.steel, 'Halberd · crescent axe blade', [0.015, 1.34, 0]);
  add(group, shapeGeometry([[0, -0.06], [-0.3, 0.02], [-0.13, 0.12], [0, 0.1]], 0.032, 0.008), materials.bluedSteel, 'Halberd · armor-piercing rear hook', [-0.015, 1.34, 0]);
  add(group, shapeGeometry([[0.08, -0.085], [0.15, -0.055], [0.315, 0.045], [0.296, 0.095], [0.14, 0.035]], 0.007, 0.002), materials.bluedSteel, 'Halberd · beveled axe cheek', [0.015, 1.34, 0.022]);
  for (const x of [-0.023, 0.023]) {
    addRivet(group, materials.brass, 'Halberd · peened head rivet', [x, 1.31, 0.033], 0.009);
  }
  for (let index = 0; index < 5; index += 1) {
    add(group, new THREE.TorusGeometry(0.0245, 0.003, 5, 10), materials.leather, 'Halberd · lower-hand grip wrap', [0, 0.05 + index * 0.021, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.ConeGeometry(0.033, 0.1, 10), materials.bluedSteel, 'Halberd · iron butt cap', [0, -0.55, 0], [0, 0, Math.PI]);
  group.name = 'Procedural Gorski Kotar halberd';
  group.userData.equipmentIdentity = 'armor-breaking-halberd';
  return group;
}

function createBow(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const t = index / 24;
    const y = THREE.MathUtils.lerp(-0.75, 0.75, t);
    const centered = t * 2 - 1;
    // A tall local self bow: a continuous D curve, not an Ottoman recurve.
    const x = 0.135 * Math.pow(Math.abs(centered), 1.7);
    points.push(new THREE.Vector3(x, y, 0));
  }
  add(
    group,
    staveGeometry(
      points,
      (fraction) => THREE.MathUtils.lerp(0.009, 0.024, Math.sin(Math.PI * fraction) ** 0.72),
      (fraction) => THREE.MathUtils.lerp(0.006, 0.014, Math.sin(Math.PI * fraction) ** 0.58),
    ),
    materials.ash,
    'Self bow · tapered D-section stave',
  );
  add(group, new RoundedBoxGeometry(0.052, 0.185, 0.036, 4, 0.012), materials.leather, 'Self bow · stitched leather grip', [0, 0, 0]);
  for (const y of [-0.073, -0.036, 0, 0.036, 0.073]) {
    add(group, new THREE.TorusGeometry(0.0255, 0.0028, 5, 10), materials.oxblood, 'Self bow · spiral grip binding', [0, y, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.CylinderGeometry(0.009, 0.014, 0.064, 8), materials.bone, 'Self bow · lower horn nock', [points[0]!.x, points[0]!.y, 0], [0, 0, 0.17]);
  add(group, new THREE.CylinderGeometry(0.014, 0.009, 0.064, 8), materials.bone, 'Self bow · upper horn nock', [points.at(-1)!.x, points.at(-1)!.y, 0], [0, 0, -0.17]);
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([points[0]!, new THREE.Vector3(-0.055, 0, 0), points.at(-1)!]),
    materials.cord,
  );
  semantic(string, 'Self bow · hemp string');
  group.add(string);
  group.name = 'Procedural Croatian self bow';
  group.userData.equipmentIdentity = 'rural-self-bow';
  return group;
}

function createCrossbow(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(
    group,
    shapeGeometry([
      [-0.045, -0.36], [-0.066, -0.27], [-0.052, 0.25], [-0.034, 0.4],
      [0.034, 0.4], [0.052, 0.25], [0.066, -0.27], [0.045, -0.36],
    ], 0.072, 0.012),
    materials.walnut,
    'Crossbow · sculpted walnut tiller',
  );
  add(group, new RoundedBoxGeometry(0.14, 0.17, 0.065, 3, 0.014), materials.leather, 'Crossbow · shouldered stock', [0, -0.36, 0.012], [0, 0, -0.13]);
  add(group, new RoundedBoxGeometry(0.024, 0.59, 0.012, 2, 0.003), materials.bluedSteel, 'Crossbow · bolt groove and top rail', [0, 0.08, 0.044]);
  add(group, new RoundedBoxGeometry(0.11, 0.035, 0.075, 2, 0.006), materials.brass, 'Crossbow · worn butt cap', [0, -0.435, 0.01], [0, 0, -0.13]);
  const prod = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.32, 0.31, 0),
    new THREE.Vector3(-0.22, 0.27, 0.005),
    new THREE.Vector3(0, 0.3, 0.012),
    new THREE.Vector3(0.22, 0.27, 0.005),
    new THREE.Vector3(0.32, 0.31, 0),
  ]);
  add(group, new THREE.TubeGeometry(prod, 36, 0.015, 8, false), materials.bluedSteel, 'Crossbow · forged steel prod');
  add(group, new THREE.CylinderGeometry(0.043, 0.043, 0.085, 14), materials.bone, 'Crossbow · antler rotating nut', [0, 0.02, 0.025], [0, 0, Math.PI / 2]);
  addRivet(group, materials.bluedSteel, 'Crossbow · nut axle cap', [0.047, 0.02, 0.025], 0.011);
  add(group, new RoundedBoxGeometry(0.018, 0.16, 0.025, 3, 0.006), materials.bluedSteel, 'Crossbow · trigger lever', [0, -0.1, 0.055], [0.25, 0, 0]);
  const triggerGuard = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.028, -0.04, 0.052),
    new THREE.Vector3(-0.045, -0.13, 0.075),
    new THREE.Vector3(0, -0.19, 0.07),
    new THREE.Vector3(0.04, -0.12, 0.055),
  ]);
  add(group, new THREE.TubeGeometry(triggerGuard, 14, 0.006, 6, false), materials.bluedSteel, 'Crossbow · forged trigger bow');
  add(group, new THREE.TorusGeometry(0.07, 0.01, 6, 18, Math.PI * 1.4), materials.bluedSteel, 'Crossbow · spanning stirrup', [0, 0.41, 0], [Math.PI / 2, 0, -0.2]);
  add(group, new RoundedBoxGeometry(0.016, 0.16, 0.008, 2, 0.002), materials.steel, 'Crossbow · spring bolt clip', [0, 0.18, 0.055], [-0.05, 0, 0]);
  for (let index = 0; index < 5; index += 1) {
    add(group, new THREE.TorusGeometry(0.036 + index * 0.002, 0.003, 5, 10), materials.leather, 'Crossbow · prod binding', [0, 0.29 + index * 0.012, 0], [Math.PI / 2, 0, 0]);
  }
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.32, 0.31, 0.012),
      new THREE.Vector3(0, 0.02, 0.012),
      new THREE.Vector3(0.32, 0.31, 0.012),
    ]),
    materials.cord,
  );
  semantic(string, 'Crossbow · drawn cord');
  group.add(string);
  group.name = 'Procedural military crossbow';
  group.userData.equipmentIdentity = 'armor-piercing-crossbow';
  return group;
}

function createArrow(materials: Materials, length: number): THREE.Group {
  const arrow = new THREE.Group();
  add(arrow, new THREE.CylinderGeometry(0.004, 0.004, length, 6), materials.ash, 'Arrow · ash shaft', [0, length * 0.5, 0]);
  add(arrow, new THREE.ConeGeometry(0.014, 0.04, 6), materials.steel, 'Arrow · forged point', [0, length + 0.02, 0]);
  add(arrow, new THREE.TorusGeometry(0.007, 0.002, 4, 8), materials.bluedSteel, 'Arrow · point socket binding', [0, length - 0.002, 0], [Math.PI / 2, 0, 0]);
  add(arrow, new THREE.CylinderGeometry(0.006, 0.005, 0.025, 6), materials.walnut, 'Arrow · reinforced hardwood self nock', [0, 0.002, 0]);
  for (let vane = 0; vane < 3; vane += 1) {
    add(
      arrow,
      shapeGeometry([[-0.021, 0], [0.02, 0], [0.012, 0.085], [-0.008, 0.095]], 0.0025, 0.0008),
      materials.feather,
      'Arrow · bound goose-feather vane',
      [0, 0.02, 0],
      [0, vane / 3 * Math.PI * 2, 0],
    );
  }
  return arrow;
}

function createQuiver(materials: Materials, arrowCount: number, arrowLength: number): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.09, 0.075, 0.5, 14, 1, true), materials.leather, 'Bow kit · leather quiver', [0, 0.19, 0]);
  add(group, new THREE.CylinderGeometry(0.076, 0.076, 0.022, 14), materials.oxblood, 'Bow kit · reinforced quiver floor', [0, -0.068, 0]);
  add(group, new THREE.TorusGeometry(0.09, 0.009, 6, 18), materials.brass, 'Bow kit · latten-bound quiver mouth', [0, 0.44, 0], [Math.PI / 2, 0, 0]);
  add(group, new THREE.TorusGeometry(0.08, 0.008, 6, 16), materials.oxblood, 'Bow kit · lower leather binding', [0, -0.045, 0], [Math.PI / 2, 0, 0]);
  add(group, new RoundedBoxGeometry(0.035, 0.48, 0.016, 2, 0.005), materials.oxblood, 'Bow kit · stitched suspension strap', [0.085, 0.2, -0.03], [0.08, 0, -0.08]);
  for (const y of [0.04, 0.2, 0.36]) {
    addRivet(group, materials.brass, 'Bow kit · suspension rivet', [0.087, y, -0.02], 0.007);
  }
  for (let index = 0; index < arrowCount; index += 1) {
    const angle = index / arrowCount * Math.PI * 2;
    const arrow = createArrow(materials, arrowLength);
    arrow.position.set(Math.cos(angle) * 0.045, 0.36, Math.sin(angle) * 0.045);
    arrow.rotation.z = (index - arrowCount * 0.5) * 0.008;
    group.add(arrow);
  }
  group.name = 'Procedural bowman quiver and arrows';
  group.userData.equipmentIdentity = 'bow-ammunition-kit';
  return group;
}

function createBoltCase(materials: Materials): THREE.Group {
  const group = createQuiver(materials, 5, 0.34);
  add(group, new RoundedBoxGeometry(0.026, 0.32, 0.022, 2, 0.006), materials.bluedSteel, 'Crossbow kit · belt-carried cranequin rack', [0.13, 0.21, 0.02], [0, 0, -0.08]);
  add(group, new THREE.TorusGeometry(0.046, 0.012, 6, 16), materials.brass, 'Crossbow kit · cranequin gear housing', [0.13, 0.34, 0.035]);
  add(group, new RoundedBoxGeometry(0.16, 0.018, 0.018, 2, 0.005), materials.bluedSteel, 'Crossbow kit · folding cranequin crank', [0.18, 0.38, 0.04], [0, 0, -0.42]);
  add(group, new THREE.CylinderGeometry(0.015, 0.015, 0.085, 7), materials.walnut, 'Crossbow kit · cranequin crank handle', [0.25, 0.345, 0.04], [0, 0, -0.42]);
  group.scale.setScalar(0.82);
  group.name = 'Procedural crossbow bolt case';
  group.userData.equipmentIdentity = 'crossbow-bolt-kit';
  return group;
}

function createKorda(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(
    group,
    shapeGeometry([[-0.021, 0], [-0.026, 0.45], [-0.023, 0.66], [0, 0.74], [0.02, 0.66], [0.03, 0.2], [0.027, 0]], 0.018, 0.004),
    materials.steel,
    'Uskok korda · single-edged frontier blade',
    [0, 0.12, 0],
  );
  for (const side of [-1, 1]) {
    add(
      group,
      shapeGeometry([[-0.011, 0.06], [-0.013, 0.43], [-0.01, 0.61], [0, 0.67], [0.009, 0.6], [0.014, 0.2], [0.013, 0.06]], 0.0035, 0.001),
      materials.bluedSteel,
      side > 0 ? 'Uskok korda · front forged fuller' : 'Uskok korda · rear forged fuller',
      [0, 0.12, side * 0.011],
    );
  }
  const guard = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.1, 0.105, -0.005),
    new THREE.Vector3(-0.05, 0.125, 0),
    new THREE.Vector3(0, 0.11, 0),
    new THREE.Vector3(0.06, 0.095, 0),
    new THREE.Vector3(0.105, 0.12, 0.005),
  ]);
  add(group, new THREE.TubeGeometry(guard, 14, 0.012, 7, false), materials.bluedSteel, 'Uskok korda · swept iron guard');
  add(group, new RoundedBoxGeometry(0.062, 0.035, 0.036, 2, 0.008), materials.brass, 'Uskok korda · latten bolster', [0, 0.095, 0]);
  add(group, new THREE.CylinderGeometry(0.026, 0.031, 0.19, 10), materials.oxblood, 'Uskok korda · oxblood grip', [0, -0.005, 0]);
  for (let index = 0; index < 5; index += 1) {
    add(group, new THREE.TorusGeometry(0.029, 0.003, 5, 10), materials.brass, 'Uskok korda · grip wire', [0, 0.055 - index * 0.035, 0], [Math.PI / 2, 0, 0]);
  }
  const pommel = add(group, new THREE.SphereGeometry(0.04, 12, 8), materials.brass, 'Uskok korda · compact disc pommel', [0, -0.12, 0]);
  pommel.scale.z = 0.58;
  group.name = 'Procedural Uskok korda';
  group.userData.equipmentIdentity = 'uskok-korda-war-knife';
  return group;
}

/** Compact belt dagger used only when a bow or crossbowman is forced into contact. */
function createFallbackDagger(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(
    group,
    shapeGeometry([[-0.018, 0], [-0.023, 0.22], [0, 0.32], [0.023, 0.22], [0.018, 0]], 0.014, 0.003),
    materials.steel,
    'Ranged fallback dagger · double-edged blade',
    [0, 0.1, 0],
  );
  add(group, new RoundedBoxGeometry(0.012, 0.2, 0.004, 2, 0.001), materials.bluedSteel, 'Ranged fallback dagger · recessed fuller', [0, 0.24, 0.009]);
  add(group, new RoundedBoxGeometry(0.12, 0.02, 0.028, 2, 0.004), materials.bluedSteel, 'Ranged fallback dagger · iron guard', [0, 0.08, 0]);
  add(group, new RoundedBoxGeometry(0.05, 0.025, 0.032, 2, 0.006), materials.brass, 'Ranged fallback dagger · grip bolster', [0, 0.066, 0]);
  add(group, new THREE.CylinderGeometry(0.02, 0.024, 0.12, 9), materials.leather, 'Ranged fallback dagger · leather grip', [0, 0.01, 0]);
  for (let index = 0; index < 3; index += 1) {
    add(group, new THREE.TorusGeometry(0.022, 0.0025, 5, 9), materials.brass, 'Ranged fallback dagger · grip wire', [0, 0.035 - index * 0.032, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.SphereGeometry(0.028, 9, 6), materials.brass, 'Ranged fallback dagger · small pommel', [0, -0.065, 0]);
  group.name = 'Procedural ranged fallback dagger';
  group.userData.equipmentIdentity = 'ranged-fallback-dagger';
  return group;
}

function createFallbackDaggerScabbard(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.052, 0.35, 0.036, 3, 0.009), materials.leather, 'Ranged fallback dagger · belt scabbard', [0, 0.12, 0]);
  add(group, new THREE.ConeGeometry(0.033, 0.065, 8), materials.brass, 'Ranged fallback dagger · scabbard chape', [0, -0.087, 0], [0, 0, Math.PI]);
  add(group, new THREE.TorusGeometry(0.029, 0.005, 5, 10), materials.brass, 'Ranged fallback dagger · scabbard throat', [0, 0.292, 0], [Math.PI / 2, 0, 0]);
  add(group, new THREE.BoxGeometry(0.12, 0.018, 0.026), materials.bluedSteel, 'Ranged fallback dagger · visible guard', [0, 0.31, 0]);
  add(group, new THREE.CylinderGeometry(0.02, 0.024, 0.11, 9), materials.leather, 'Ranged fallback dagger · visible grip', [0, 0.365, 0]);
  group.name = 'Procedural ranged fallback dagger scabbard';
  group.userData.equipmentIdentity = 'ranged-fallback-dagger-scabbard';
  return group;
}

function createArquebus(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(
    group,
    shapeGeometry([
      [-0.04, -0.48], [-0.082, -0.39], [-0.062, -0.2], [-0.045, 0.69],
      [0.045, 0.69], [0.052, -0.2], [0.092, -0.35], [0.075, -0.5],
    ], 0.074, 0.012),
    materials.walnut,
    'Arquebus · sculpted walnut full stock',
  );
  add(group, new RoundedBoxGeometry(0.14, 0.23, 0.08, 3, 0.016), materials.walnut, 'Arquebus · shouldered fishtail butt', [0.025, -0.42, 0], [0, 0, -0.08]);
  add(group, new RoundedBoxGeometry(0.09, 0.05, 0.082, 2, 0.008), materials.brass, 'Arquebus · worn butt plate', [0.045, -0.525, 0], [0, 0, -0.08]);
  add(group, new THREE.CylinderGeometry(0.022, 0.026, 0.72, 12), materials.bluedSteel, 'Arquebus · long hand-forged barrel', [0, 0.43, 0.055]);
  for (const y of [0.18, 0.47, 0.7]) {
    add(group, new THREE.TorusGeometry(0.028, 0.0055, 5, 12), materials.brass, 'Arquebus · latten barrel band', [0, y, 0.055], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.TorusGeometry(0.035, 0.007, 6, 12), materials.brass, 'Arquebus · reinforced muzzle band', [0, 0.79, 0.055], [Math.PI / 2, 0, 0]);
  add(group, new RoundedBoxGeometry(0.012, 0.025, 0.014, 2, 0.003), materials.steel, 'Arquebus · forged front sight', [0, 0.748, 0.086]);
  add(group, new RoundedBoxGeometry(0.018, 0.02, 0.012, 2, 0.003), materials.steel, 'Arquebus · rear notch sight', [0, 0.18, 0.084]);
  add(group, new THREE.CylinderGeometry(0.0055, 0.0065, 0.67, 7), materials.ash, 'Arquebus · under-barrel ramrod', [-0.025, 0.43, -0.05]);
  for (const y of [0.18, 0.52, 0.7]) {
    add(group, new THREE.TorusGeometry(0.011, 0.0035, 5, 9), materials.bluedSteel, 'Arquebus · ramrod thimble', [-0.025, y, -0.05], [Math.PI / 2, 0, 0]);
  }
  const serpentine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.035, 0.04, 0.055),
    new THREE.Vector3(0.09, 0.0, 0.06),
    new THREE.Vector3(0.065, -0.08, 0.055),
  ]);
  add(group, new THREE.TubeGeometry(serpentine, 16, 0.009, 7, false), materials.bluedSteel, 'Arquebus · articulated matchlock serpentine');
  const slowMatch = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.067, -0.075, 0.06),
    new THREE.Vector3(0.11, -0.035, 0.07),
    new THREE.Vector3(0.09, 0.055, 0.072),
  ]);
  add(group, new THREE.TubeGeometry(slowMatch, 12, 0.007, 6, false), materials.leather, 'Arquebus · smouldering slow-match cord');
  add(group, new RoundedBoxGeometry(0.088, 0.09, 0.024, 2, 0.005), materials.brass, 'Arquebus · engraved lock plate', [0.045, -0.025, 0.052]);
  add(group, new THREE.CylinderGeometry(0.032, 0.025, 0.035, 10), materials.bluedSteel, 'Arquebus · priming pan', [0.055, 0.055, 0.075], [0, 0, Math.PI / 2]);
  add(group, new RoundedBoxGeometry(0.06, 0.042, 0.009, 2, 0.003), materials.brass, 'Arquebus · hinged pan cover', [0.057, 0.063, 0.095], [0.08, 0, -0.12]);
  addRivet(group, materials.steel, 'Arquebus · serpentine pivot', [0.065, -0.035, 0.071], 0.011);
  add(group, new RoundedBoxGeometry(0.014, 0.11, 0.02, 2, 0.004), materials.bluedSteel, 'Arquebus · trigger', [0.012, -0.12, 0.053], [0.32, 0, 0]);
  const triggerGuard = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.025, -0.08, 0.045),
    new THREE.Vector3(-0.04, -0.17, 0.07),
    new THREE.Vector3(0.015, -0.21, 0.065),
    new THREE.Vector3(0.042, -0.13, 0.045),
  ]);
  add(group, new THREE.TubeGeometry(triggerGuard, 14, 0.006, 6, false), materials.bluedSteel, 'Arquebus · forged trigger guard');
  const sling = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.045, -0.4, -0.035),
    new THREE.Vector3(-0.13, -0.1, -0.1),
    new THREE.Vector3(-0.1, 0.46, -0.09),
    new THREE.Vector3(-0.04, 0.62, -0.02),
  ]);
  add(group, new THREE.TubeGeometry(sling, 28, 0.008, 6, false), materials.leather, 'Arquebus · adjustable leather shoulder sling');
  addRivet(group, materials.brass, 'Arquebus · rear sling stud', [-0.045, -0.4, -0.035], 0.009);
  addRivet(group, materials.brass, 'Arquebus · forward sling stud', [-0.04, 0.62, -0.02], 0.009);
  group.name = 'Procedural Uskok matchlock arquebus';
  group.userData.equipmentIdentity = 'uskok-light-arquebus';
  return group;
}

function createKatzbalgerScabbard(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.075, 0.67, 0.048, 3, 0.012), materials.leather, 'Katzbalger · leather scabbard', [0, 0.24, 0]);
  add(group, new THREE.ConeGeometry(0.044, 0.095, 8), materials.brass, 'Katzbalger · latten scabbard chape', [0, -0.145, 0], [0, 0, Math.PI]);
  add(group, new THREE.TorusGeometry(0.04, 0.006, 5, 11), materials.brass, 'Katzbalger · reinforced scabbard throat', [0, 0.575, 0], [Math.PI / 2, 0, 0]);
  for (const y of [0.22, 0.43]) {
    add(group, new THREE.TorusGeometry(0.042, 0.006, 5, 11), materials.oxblood, 'Katzbalger · suspension band', [0, y, 0], [Math.PI / 2, 0, 0]);
    add(group, new THREE.TorusGeometry(0.024, 0.005, 5, 10), materials.brass, 'Katzbalger · belt suspension ring', [0.052, y, 0], [0, Math.PI / 2, 0]);
  }
  add(group, new THREE.CylinderGeometry(0.027, 0.03, 0.16, 10), materials.oxblood, 'Katzbalger · visible grip', [0, 0.65, 0]);
  const guard = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.16, 0.56, 0), new THREE.Vector3(-0.08, 0.6, 0.02),
    new THREE.Vector3(0, 0.58, 0), new THREE.Vector3(0.08, 0.6, 0.02), new THREE.Vector3(0.16, 0.56, 0),
  ]);
  add(group, new THREE.TubeGeometry(guard, 24, 0.012, 7, false), materials.bluedSteel, 'Katzbalger · S-curved guard');
  add(group, new THREE.SphereGeometry(0.038, 10, 7), materials.brass, 'Katzbalger · pommel', [0, 0.75, 0]);
  group.name = 'Procedural Landsknecht Katzbalger scabbard';
  group.userData.equipmentIdentity = 'landsknecht-katzbalger';
  return group;
}

function createUskokScabbard(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.075, 0.64, 0.045, 3, 0.012), materials.oxblood, 'Uskok kit · sidearm scabbard', [0, 0.23, 0], [0, 0, -0.12]);
  add(group, new THREE.ConeGeometry(0.043, 0.09, 8), materials.brass, 'Uskok kit · sidearm scabbard chape', [-0.045, -0.105, 0], [0, 0, Math.PI - 0.12]);
  add(group, new THREE.TorusGeometry(0.04, 0.006, 5, 11), materials.brass, 'Uskok kit · sidearm scabbard throat', [0.04, 0.54, 0], [Math.PI / 2, 0, -0.12]);
  for (const y of [0.16, 0.39]) {
    add(group, new THREE.TorusGeometry(0.041, 0.006, 5, 10), materials.leather, 'Uskok kit · decorated scabbard band', [0, y, 0], [Math.PI / 2, 0, -0.12]);
  }
  add(group, new THREE.CylinderGeometry(0.025, 0.03, 0.16, 10), materials.leather, 'Uskok kit · sidearm hilt', [0, 0.62, 0], [0, 0, -0.12]);
  add(group, new RoundedBoxGeometry(0.2, 0.024, 0.035, 2, 0.005), materials.brass, 'Uskok kit · sidearm guard', [0, 0.54, 0], [0, 0, -0.12]);
  group.name = 'Procedural Uskok sidearm and scabbard';
  group.userData.equipmentIdentity = 'uskok-sidearm';
  return group;
}

/**
 * Bakes a semantic assembly into one mesh per PBR material while keeping lines
 * separate. The source is built once, then cloned with shared geometry and
 * materials for every animated soldier. This preserves authored silhouettes
 * and roughness roles without multiplying geometry memory by company size.
 */
function optimizeAssembly(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const semanticParts: string[] = [];
  const geometries = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const lines: THREE.Line[] = [];
  source.traverse((object) => {
    if (object.userData.semanticWeaponPart) {
      semanticParts.push(String(object.userData.semanticWeaponPart));
    }
    if (object instanceof THREE.Line) {
      const line = object.clone() as THREE.Line;
      line.geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      line.position.set(0, 0, 0);
      line.rotation.set(0, 0, 0);
      line.scale.set(1, 1, 1);
      lines.push(line);
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const list = geometries.get(mesh.material) ?? [];
    const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const normalized = transformed.index ? transformed.toNonIndexed() : transformed;
    if (normalized !== transformed) transformed.dispose();
    // Merge only a stable realtime attribute contract. Primitive helpers differ
    // in incidental attributes/indexing, which otherwise defeats batching.
    for (const attribute of Object.keys(normalized.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal' && attribute !== 'uv') {
        normalized.deleteAttribute(attribute);
      }
    }
    if (!normalized.getAttribute('normal')) normalized.computeVertexNormals();
    if (!normalized.getAttribute('uv')) {
      const count = normalized.getAttribute('position')?.count ?? 0;
      normalized.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    list.push(normalized);
    geometries.set(mesh.material, list);
  });

  const optimized = new THREE.Group();
  optimized.name = source.name;
  optimized.userData = {
    ...source.userData,
    semanticWeaponParts: [...new Set(semanticParts)],
    optimizedByMaterial: true,
  };
  for (const [material, entries] of geometries) {
    const geometry = entries.length === 1 ? entries[0]! : mergeGeometries(entries, false);
    if (!geometry) throw new Error(`Could not merge ${source.name} geometry for ${material.name}.`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${source.name} · ${material.name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    optimized.add(mesh);
    for (const entry of entries) if (entry !== geometry) entry.dispose();
  }
  for (const line of lines) optimized.add(line);
  disposeObjectGeometries(source);
  return optimized;
}

function findBone(model: THREE.Group, names: readonly string[]): THREE.Bone {
  for (const name of names) {
    const object = model.getObjectByName(name);
    if (object instanceof THREE.Bone) return object;
  }
  throw new Error(`Worker rig is missing its ${names.join('/')} joint.`);
}

function boneScale(bone: THREE.Bone): number {
  const scale = bone.getWorldScale(new THREE.Vector3());
  return Math.max(0.001, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
}

function configureMount(
  mount: THREE.Group,
  kind: MilitaryEquipmentKind,
  bone: THREE.Bone,
  combatRole: MilitaryEquipmentCombatRole,
): void {
  mount.userData.workerTool = kind;
  mount.userData.workerToolBone = bone.name;
  mount.userData.workerToolCombatRole = combatRole;
  const held = combatRole === 'melee-held' || combatRole === 'ranged-held';
  if (held) {
    const supportGrip = supportGripFor(kind, combatRole);
    if (supportGrip) mount.userData.workerToolSupportGripLocal = supportGrip;
    const muzzle = muzzleFor(kind, combatRole);
    if (muzzle) mount.userData.workerToolMuzzleLocal = muzzle;
  }
  mount.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object instanceof THREE.Line)) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
}

function supportGripFor(
  kind: MilitaryEquipmentKind,
  role: MilitaryEquipmentCombatRole,
): readonly [number, number, number] | null {
  switch (kind) {
    case 'spear': return [0, 0.42, 0];
    case 'pike-kit': return [0, 0.5, 0];
    case 'halberd': return [0, 0.46, 0];
    case 'crossbow': return role === 'ranged-held' ? [0, 0.18, 0.025] : null;
    case 'uskok-kit': return role === 'ranged-held' ? [0, 0.19, 0.045] : null;
    default: return null;
  }
}

function muzzleFor(
  kind: MilitaryEquipmentKind,
  role: MilitaryEquipmentCombatRole,
): readonly [number, number, number] | null {
  if (kind === 'crossbow' && role === 'ranged-held') return [0, 0.46, 0.052];
  if (kind === 'uskok-kit' && role === 'ranged-held') return [0, 0.79, 0.055];
  return null;
}

export function attachMilitaryEquipment(
  model: THREE.Group,
  source: MilitaryEquipmentSource,
): THREE.Group {
  model.updateWorldMatrix(true, true);
  const primaryBone = findBone(model, source.primaryBoneNames);
  const primary = source.scene.clone(true);
  primary.name = `Military ${source.kind} primary`;
  primary.scale.setScalar(source.targetLength / (source.sourceLength * boneScale(primaryBone)));
  primary.position.set(...source.primaryPosition);
  primary.quaternion.set(...source.primaryQuaternion);
  configureMount(primary, source.kind, primaryBone, source.primaryCombatRole);
  primaryBone.add(primary);

  const mounts = [primary];
  for (const secondary of source.secondaryMounts) {
    model.updateWorldMatrix(true, true);
    const bone = findBone(model, secondary.boneNames);
    const inheritedScale = boneScale(bone);
    const mounted = secondary.scene.clone(true);
    mounted.name = `Military ${source.kind} secondary ${bone.name}`;
    mounted.scale.setScalar(secondary.targetLength / (secondary.sourceLength * inheritedScale));
    mounted.position.set(...secondary.position);
    if (secondary.quaternion) mounted.quaternion.set(...secondary.quaternion);
    else mounted.rotation.set(...secondary.rotation);
    configureMount(mounted, source.kind, bone, secondary.combatRole);
    bone.add(mounted);
    mounts.push(mounted);
  }
  primary.userData.workerToolMounts = mounts;
  primary.userData.workerToolMountCount = mounts.length;
  primary.userData.workerToolVisible = true;
  primary.userData.workerToolCombatStance = defaultCombatStance(source.kind);
  applyMilitaryEquipmentVisibility(primary);
  return primary;
}

export function setMilitaryEquipmentVisible(tool: THREE.Group, visible: boolean): void {
  tool.userData.workerToolVisible = visible;
  applyMilitaryEquipmentVisibility(tool);
}

export function setMilitaryEquipmentCombatStance(
  tool: THREE.Group,
  stance: MilitaryEquipmentCombatStance,
): void {
  tool.userData.workerToolCombatStance = stance;
  applyMilitaryEquipmentVisibility(tool);
}

/**
 * Separates a casualty's held weapon from the bone-mounted kit without
 * discarding equipment that still belongs on the body (quiver, scabbard,
 * bolt case, and similar harness pieces). The matching ground object is owned
 * by BattlefieldWeaponDropRenderer; this flag only prevents the hand-mounted
 * copy from drawing through the clamped death pose.
 */
export function setMilitaryEquipmentDropped(
  tool: THREE.Group,
  dropped: boolean,
): void {
  tool.userData.workerToolDropped = dropped;
  applyMilitaryEquipmentVisibility(tool);
}

function defaultCombatStance(kind: MilitaryEquipmentKind): MilitaryEquipmentCombatStance {
  return kind === 'bow' || kind === 'crossbow' || kind === 'uskok-kit'
    ? 'ranged'
    : 'melee';
}

function applyMilitaryEquipmentVisibility(tool: THREE.Group): void {
  const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  const visible = tool.userData.workerToolVisible !== false;
  const dropped = tool.userData.workerToolDropped === true;
  const stance = tool.userData.workerToolCombatStance as
    | MilitaryEquipmentCombatStance
    | undefined;
  for (const mount of mounts ?? [tool]) {
    const role = (mount.userData.workerToolCombatRole ?? 'always') as
      MilitaryEquipmentCombatRole;
    const roleVisible = role === 'always'
      || (role === 'melee-held' && stance === 'melee')
      || (role === 'melee-stowed' && stance === 'ranged')
      || (role === 'ranged-held' && stance === 'ranged')
      || (role === 'ranged-stowed' && stance === 'melee');
    const held = role === 'melee-held' || role === 'ranged-held';
    mount.visible = visible && roleVisible && !(dropped && held);
  }
}

export function militaryEquipmentMountDiagnostics(
  tool: THREE.Group,
): MilitaryEquipmentMountDiagnostic[] {
  const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  return (mounts ?? [tool]).map((mount, index) => {
    let triangleCount = 0;
    let partCount = 0;
    mount.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      partCount += 1;
      const elements = mesh.geometry.index?.count
        ?? mesh.geometry.getAttribute('position')?.count
        ?? 0;
      triangleCount += Math.floor(elements / 3);
    });
    const size = new THREE.Box3().setFromObject(mount).getSize(new THREE.Vector3());
    return {
      mount: index === 0 ? 'primary' : 'secondary',
      bone: String(mount.userData.workerToolBone ?? mount.parent?.name ?? 'unknown'),
      partCount,
      triangleCount,
      worldLength: Math.max(size.x, size.y, size.z),
      semanticParts: (mount.userData.semanticWeaponParts as string[] | undefined) ?? [],
    };
  });
}

export function disposeMilitaryEquipmentSource(source: MilitaryEquipmentSource): void {
  disposeObjectResources(source.scene);
  for (const mountSource of source.secondaryMounts) disposeObjectResources(mountSource.scene);
}

function disposeObjectGeometries(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

function disposeObjectResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
