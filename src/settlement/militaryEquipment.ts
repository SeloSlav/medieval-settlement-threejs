import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
};

export type MilitaryEquipmentSource = {
  militaryEquipment: true;
  kind: MilitaryEquipmentKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  sourceLength: number;
  targetLength: number;
  primaryPosition: readonly [number, number, number];
  primaryQuaternion: readonly [number, number, number, number];
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

type Materials = {
  ash: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  bluedSteel: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  oxblood: THREE.MeshStandardMaterial;
  paintedWood: THREE.MeshStandardMaterial;
  feather: THREE.MeshStandardMaterial;
  cord: THREE.LineBasicMaterial;
};

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
  const materials = createMaterials();
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
    ]),
    sidearm: source('sidearm', createSword(materials, false), NATURAL_RIGHT_HAND),
    'sidearm-shield': source('sidearm-shield', createSword(materials, false), NATURAL_RIGHT_HAND, [
      mount(createShield('small', materials), ['PalmL', 'L_Hand'], 0.34, LEFT_PALM_POSITION, [0, 0, 0], FORWARD_LEFT_HAND),
    ]),
    'sword-shield': source('sword-shield', createSword(materials, true), NATURAL_RIGHT_HAND, [
      mount(createShield('large', materials), ['PalmL', 'L_Hand'], 0.62, LEFT_PALM_POSITION, [0, 0, 0], FORWARD_LEFT_HAND),
    ]),
    halberd: source('halberd', createHalberd(materials), UPRIGHT_RIGHT_HAND),
    bow: source('bow', createBow(materials), UPRIGHT_RIGHT_HAND, [
      mount(
        createQuiver(materials, 12, 0.78),
        ['Spine02', 'Spine2', 'Spine01', 'Spine'],
        0.86,
        [0.065, 0.02, 0.085],
        [0.04, -0.18, -0.18],
      ),
    ]),
    'uskok-kit': source('uskok-kit', createKorda(materials), NATURAL_RIGHT_HAND, [
      mount(
        createArquebus(materials),
        ['Spine02', 'Spine2', 'Spine01', 'Spine'],
        1.08,
        [-0.065, 0.015, 0.09],
        [0.06, -0.06, 0.5],
      ),
      mount(
        createUskokScabbard(materials),
        ['Waist', 'Hips', 'Pelvis'],
        0.86,
        [0.1, 0, 0.015],
        [0, 0, Math.PI - 0.18],
      ),
    ]),
  };
}

export function isMilitaryEquipmentSource(
  value: { kind: string },
): value is MilitaryEquipmentSource {
  return (value as Partial<MilitaryEquipmentSource>).militaryEquipment === true;
}

function createMaterials(): Materials {
  const material = (
    name: string,
    color: number,
    roughness: number,
    metalness: number,
    pattern: 'wood' | 'leather' | 'metal' | 'paint' | 'feather',
  ): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    map: createSurfaceTexture(color, pattern),
    roughness,
    metalness,
  });
  return {
    ash: material('Waxed ash weapon haft', 0x8b6235, 0.72, 0.015, 'wood'),
    walnut: material('Dark walnut stock', 0x4c2f1d, 0.68, 0.01, 'wood'),
    steel: material('Satin forged steel', 0xc2c4bd, 0.34, 0.66, 'metal'),
    bluedSteel: material('Blued forged steel', 0x59605d, 0.44, 0.58, 'metal'),
    brass: material('Cast brass fittings', 0xb99a55, 0.38, 0.64, 'metal'),
    leather: material('Oiled brown leather', 0x4a2d1c, 0.82, 0, 'leather'),
    oxblood: material('Oxblood frontier leather', 0x6d2f27, 0.78, 0, 'leather'),
    paintedWood: material('Muted red painted shield wood', 0x7d3028, 0.76, 0, 'paint'),
    feather: Object.assign(material('Goose-feather fletching', 0xd8d2be, 0.9, 0, 'feather'), { side: THREE.DoubleSide }),
    cord: new THREE.LineBasicMaterial({
      name: 'Hemp bow cord',
      color: 0xd6c89d,
    }),
  };
}

/** Small deterministic shared maps keep close-ups tactile without asset IO. */
function createSurfaceTexture(
  base: number,
  pattern: 'wood' | 'leather' | 'metal' | 'paint' | 'feather',
): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const color = new THREE.Color(base);
  const hash = (x: number, y: number): number => {
    let value = Math.imul(x + 11, 374761393) ^ Math.imul(y + 17, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const noise = hash(x, y) - 0.5;
      const grain = pattern === 'wood'
        ? Math.sin((x + Math.sin(y * 0.22) * 5) * 0.46) * 0.06
        : pattern === 'metal'
          ? Math.sin(y * 2.8 + noise) * 0.018
          : pattern === 'leather'
            ? (hash(Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 0.11
            : pattern === 'paint'
              ? (noise * 0.07 - (hash(x * 3, y * 5) > 0.985 ? 0.14 : 0))
              : Math.sin(y * 0.9) * 0.035;
      const variation = THREE.MathUtils.clamp(1 + grain + noise * 0.035, 0.72, 1.16);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(THREE.MathUtils.clamp(color.r * variation, 0, 1) * 255);
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(color.g * variation, 0, 1) * 255);
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(color.b * variation, 0, 1) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = `${pattern} procedural equipment surface`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(pattern === 'wood' ? 2 : 3, pattern === 'wood' ? 6 : 3);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function source(
  kind: MilitaryEquipmentKind,
  scene: THREE.Group,
  primaryQuaternion: readonly [number, number, number, number],
  secondaryMounts: readonly MilitaryEquipmentMountSource[] = [],
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
    primaryPosition: RIGHT_PALM_POSITION,
    primaryQuaternion,
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

function createSpear(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.018, 0.023, 1.84, 12), materials.ash, 'Spear · tapered ash shaft', [0, 0.46, 0]);
  add(group, new THREE.CylinderGeometry(0.03, 0.025, 0.14, 12), materials.bluedSteel, 'Spear · iron socket', [0, 1.41, 0]);
  add(
    group,
    shapeGeometry([[0, -0.14], [0.042, 0.03], [0.03, 0.13], [0, 0.25], [-0.03, 0.13], [-0.042, 0.03]], 0.022, 0.005),
    materials.steel,
    'Spear · leaf-shaped forged head',
    [0, 1.52, 0],
  );
  add(group, new THREE.ConeGeometry(0.034, 0.11, 10), materials.bluedSteel, 'Spear · iron butt cap', [0, -0.52, 0], [0, 0, Math.PI]);
  group.name = 'Procedural leaf spear';
  group.userData.equipmentIdentity = 'ordinary-leaf-spear';
  return group;
}

function createPike(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.014, 0.019, 4.36, 10), materials.ash, 'Pike · long waxed-ash shaft', [0, 1.68, 0]);
  add(group, new THREE.CylinderGeometry(0.021, 0.018, 0.18, 10), materials.bluedSteel, 'Pike · narrow iron socket', [0, 3.95, 0]);
  add(
    group,
    shapeGeometry([[0, -0.1], [0.034, 0.03], [0.02, 0.14], [0, 0.26], [-0.02, 0.14], [-0.034, 0.03]], 0.018, 0.004),
    materials.steel,
    'Pike · compact armor-piercing head',
    [0, 4.08, 0],
  );
  add(group, new THREE.ConeGeometry(0.024, 0.1, 8), materials.bluedSteel, 'Pike · iron shoe', [0, -0.55, 0], [0, 0, Math.PI]);
  group.name = 'Procedural Landsknecht pike';
  group.userData.equipmentIdentity = 'mercenary-pike-and-katzbalger';
  return group;
}

function createSword(materials: Materials, longSword: boolean): THREE.Group {
  const group = new THREE.Group();
  const bladeLength = longSword ? 0.77 : 0.61;
  const bladeWidth = longSword ? 0.026 : 0.023;
  add(
    group,
    shapeGeometry([
      [-bladeWidth, 0],
      [-bladeWidth * 0.78, bladeLength * 0.72],
      [0, bladeLength],
      [bladeWidth * 0.78, bladeLength * 0.72],
      [bladeWidth, 0],
    ], longSword ? 0.024 : 0.022, 0.006),
    materials.steel,
    longSword ? 'Longsword · tapered double-edged blade' : 'Sidearm · tapered double-edged blade',
    [0, 0.17, 0],
  );
  const fuller = add(
    group,
    new RoundedBoxGeometry(0.018, bladeLength * 0.68, 0.005, 2, 0.002),
    materials.bluedSteel,
    'Sword · recessed fuller',
    [0, 0.2 + bladeLength * 0.34, 0.014],
  );
  fuller.scale.x = longSword ? 1.15 : 0.9;
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.15, 0.02, 0),
    new THREE.Vector3(-0.07, 0.045, 0),
    new THREE.Vector3(0, 0.032, 0),
    new THREE.Vector3(0.07, 0.045, 0),
    new THREE.Vector3(0.15, 0.02, 0),
  ]);
  add(group, new THREE.TubeGeometry(guardCurve, 18, 0.014, 8, false), materials.bluedSteel, 'Sword · swept quillon guard');
  add(group, new THREE.CylinderGeometry(0.027, 0.031, 0.19, 10), materials.leather, 'Sword · leather-bound grip', [0, -0.085, 0]);
  for (let index = 0; index < 5; index += 1) {
    add(group, new THREE.TorusGeometry(0.03, 0.004, 5, 12), materials.brass, 'Sword · grip wire', [0, -0.015 - index * 0.035, 0], [Math.PI / 2, 0, 0]);
  }
  add(group, new THREE.SphereGeometry(longSword ? 0.045 : 0.04, 12, 8), materials.brass, 'Sword · wheel pommel', [0, -0.2, 0]);
  group.name = longSword ? 'Procedural longsword' : 'Procedural arming sword';
  group.userData.equipmentIdentity = longSword ? 'mail-company-longsword' : 'infantry-sidearm';
  return group;
}

function shieldOutline(kind: 'small' | 'medium' | 'large'): Array<readonly [number, number]> {
  const count = kind === 'small' ? 28 : 36;
  const radius = kind === 'small' ? 0.17 : kind === 'medium' ? 0.28 : 0.31;
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const handWorkedVariation = kind === 'small' ? 1 : 1 - 0.018 * Math.cos(angle * 4);
    return [Math.cos(angle) * radius * handWorkedVariation, Math.sin(angle) * radius] as const;
  });
}

function createShield(kind: 'small' | 'medium' | 'large', materials: Materials): THREE.Group {
  const group = new THREE.Group();
  const outline = shieldOutline(kind);
  const depth = kind === 'small' ? 0.034 : 0.042;
  add(group, shapeGeometry(outline, depth, 0.012), materials.walnut, `${kind} shield · laminated timber body`);
  const rimPoints = outline.map(([x, y]) => new THREE.Vector3(x, y, depth * 0.58));
  add(
    group,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true, 'centripetal'), outline.length * 3, kind === 'large' ? 0.018 : 0.015, 6, true),
    materials.bluedSteel,
    `${kind} shield · forged rim`,
  );
  const bossRadius = kind === 'small' ? 0.095 : kind === 'medium' ? 0.105 : 0.115;
  add(
    group,
    new THREE.SphereGeometry(bossRadius, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.steel,
    `${kind} shield · raised iron boss`,
    [0, 0, depth * 0.55],
    [Math.PI / 2, 0, 0],
  );
  if (kind !== 'small') {
    add(group, new THREE.TorusGeometry(kind === 'large' ? 0.245 : 0.215, 0.018, 6, 36), materials.paintedWood, `${kind} shield · restrained painted ring`, [0, 0, depth * 0.72]);
  }
  add(group, new RoundedBoxGeometry(kind === 'large' ? 0.42 : 0.3, 0.035, 0.035, 3, 0.01), materials.leather, `${kind} shield · rear arm strap`, [0, 0, -0.04], [0, 0, Math.PI / 2]);
  add(group, new THREE.CylinderGeometry(0.018, 0.018, kind === 'small' ? 0.2 : 0.25, 8), materials.leather, `${kind} shield · hand grip`, [0, 0, -0.075], [0, 0, Math.PI / 2]);
  group.name = `Procedural ${kind} shield`;
  group.userData.equipmentIdentity = `${kind}-shield`;
  return group;
}

function createHalberd(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.021, 0.026, 1.92, 12), materials.ash, 'Halberd · tapered ash haft', [0, 0.45, 0]);
  add(group, new THREE.CylinderGeometry(0.03, 0.027, 0.42, 12), materials.bluedSteel, 'Halberd · iron langet and socket', [0, 1.29, 0]);
  add(group, shapeGeometry([[0, -0.08], [0.055, 0.08], [0, 0.31], [-0.055, 0.08]], 0.03, 0.007), materials.steel, 'Halberd · thrusting spike', [0, 1.49, 0]);
  add(group, shapeGeometry([[0, -0.15], [0.15, -0.11], [0.34, 0.03], [0.31, 0.25], [0.12, 0.18], [0, 0.12]], 0.036, 0.009), materials.steel, 'Halberd · crescent axe blade', [0.015, 1.34, 0]);
  add(group, shapeGeometry([[0, -0.06], [-0.3, 0.02], [-0.13, 0.12], [0, 0.1]], 0.032, 0.008), materials.bluedSteel, 'Halberd · armor-piercing rear hook', [-0.015, 1.34, 0]);
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
  add(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.016, 9, false), materials.ash, 'Self bow · continuous yew-like stave');
  add(group, new THREE.CylinderGeometry(0.027, 0.027, 0.17, 10), materials.leather, 'Self bow · leather grip', [0, 0, 0]);
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
  add(group, new RoundedBoxGeometry(0.09, 0.73, 0.07, 4, 0.018), materials.walnut, 'Crossbow · carved walnut tiller', [0, 0.03, 0]);
  add(group, new RoundedBoxGeometry(0.14, 0.17, 0.065, 3, 0.014), materials.leather, 'Crossbow · shouldered stock', [0, -0.36, 0.012], [0, 0, -0.13]);
  const prod = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.32, 0.31, 0),
    new THREE.Vector3(-0.22, 0.27, 0.005),
    new THREE.Vector3(0, 0.3, 0.012),
    new THREE.Vector3(0.22, 0.27, 0.005),
    new THREE.Vector3(0.32, 0.31, 0),
  ]);
  add(group, new THREE.TubeGeometry(prod, 36, 0.015, 8, false), materials.bluedSteel, 'Crossbow · forged steel prod');
  add(group, new THREE.CylinderGeometry(0.043, 0.043, 0.085, 12), materials.brass, 'Crossbow · rotating nut', [0, 0.02, 0.025], [0, 0, Math.PI / 2]);
  add(group, new RoundedBoxGeometry(0.018, 0.16, 0.025, 3, 0.006), materials.bluedSteel, 'Crossbow · trigger lever', [0, -0.1, 0.055], [0.25, 0, 0]);
  add(group, new THREE.TorusGeometry(0.07, 0.01, 6, 18, Math.PI * 1.4), materials.bluedSteel, 'Crossbow · spanning stirrup', [0, 0.41, 0], [Math.PI / 2, 0, -0.2]);
  add(group, new THREE.CylinderGeometry(0.006, 0.006, 0.56, 7), materials.ash, 'Crossbow · loaded bolt', [0, 0.12, 0.052]);
  add(group, new THREE.ConeGeometry(0.018, 0.05, 6), materials.steel, 'Crossbow · bolt head', [0, 0.425, 0.052]);
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
  add(arrow, shapeGeometry([[-0.022, 0], [0.022, 0], [0.012, 0.085], [-0.012, 0.085]], 0.004, 0.001), materials.feather, 'Arrow · goose fletching', [0, 0.02, 0]);
  return arrow;
}

function createQuiver(materials: Materials, arrowCount: number, arrowLength: number): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.09, 0.075, 0.5, 14, 1, true), materials.leather, 'Bow kit · leather quiver', [0, 0.19, 0]);
  add(group, new THREE.TorusGeometry(0.09, 0.009, 6, 18), materials.brass, 'Bow kit · quiver mouth', [0, 0.44, 0], [Math.PI / 2, 0, 0]);
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
  add(group, new THREE.BoxGeometry(0.19, 0.024, 0.032), materials.bluedSteel, 'Uskok korda · simple iron guard', [0, 0.1, 0]);
  add(group, new THREE.CylinderGeometry(0.026, 0.031, 0.19, 10), materials.oxblood, 'Uskok korda · oxblood grip', [0, -0.005, 0]);
  add(group, new THREE.SphereGeometry(0.038, 10, 7), materials.brass, 'Uskok korda · compact pommel', [0, -0.12, 0]);
  group.name = 'Procedural Uskok korda';
  group.userData.equipmentIdentity = 'uskok-korda-war-knife';
  return group;
}

function createArquebus(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.075, 0.96, 0.072, 3, 0.014), materials.walnut, 'Arquebus · carved walnut stock', [0, 0.05, 0]);
  add(group, new RoundedBoxGeometry(0.13, 0.23, 0.08, 3, 0.016), materials.walnut, 'Arquebus · shouldered butt', [0.025, -0.42, 0], [0, 0, -0.08]);
  add(group, new THREE.CylinderGeometry(0.022, 0.026, 0.72, 12), materials.bluedSteel, 'Arquebus · hand-forged barrel', [0, 0.43, 0.055]);
  add(group, new THREE.TorusGeometry(0.035, 0.007, 6, 12), materials.brass, 'Arquebus · muzzle band', [0, 0.79, 0.055], [Math.PI / 2, 0, 0]);
  const serpentine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.035, 0.04, 0.055),
    new THREE.Vector3(0.09, 0.0, 0.06),
    new THREE.Vector3(0.065, -0.08, 0.055),
  ]);
  add(group, new THREE.TubeGeometry(serpentine, 16, 0.009, 7, false), materials.bluedSteel, 'Arquebus · matchlock serpentine');
  add(group, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), materials.leather, 'Arquebus · slow match', [0.075, -0.05, 0.065], [0, 0, 0.4]);
  add(group, new RoundedBoxGeometry(0.085, 0.075, 0.022, 2, 0.005), materials.brass, 'Arquebus · lock plate', [0.045, -0.04, 0.052]);
  add(group, new RoundedBoxGeometry(0.07, 0.12, 0.03, 2, 0.006), materials.leather, 'Arquebus · shoulder sling', [-0.055, -0.1, -0.03], [0, 0, -0.2]);
  group.name = 'Procedural Uskok matchlock arquebus';
  group.userData.equipmentIdentity = 'uskok-light-arquebus';
  return group;
}

function createKatzbalgerScabbard(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.075, 0.67, 0.048, 3, 0.012), materials.leather, 'Katzbalger · leather scabbard', [0, 0.24, 0]);
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
  add(group, new THREE.CylinderGeometry(0.025, 0.03, 0.16, 10), materials.leather, 'Uskok kit · sidearm hilt', [0, 0.62, 0], [0, 0, -0.12]);
  add(group, new THREE.BoxGeometry(0.2, 0.022, 0.035), materials.brass, 'Uskok kit · sidearm guard', [0, 0.54, 0], [0, 0, -0.12]);
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

function configureMount(mount: THREE.Group, kind: MilitaryEquipmentKind, bone: THREE.Bone): void {
  mount.userData.workerTool = kind;
  mount.userData.workerToolBone = bone.name;
  mount.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object instanceof THREE.Line)) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
}

export function attachMilitaryEquipment(
  model: THREE.Group,
  source: MilitaryEquipmentSource,
): THREE.Group {
  model.updateWorldMatrix(true, true);
  const rightHand = findBone(model, ['PalmR', 'R_Hand']);
  const primary = source.scene.clone(true);
  primary.name = `Military ${source.kind} primary`;
  primary.scale.setScalar(source.targetLength / (source.sourceLength * boneScale(rightHand)));
  primary.position.set(...source.primaryPosition);
  primary.quaternion.set(...source.primaryQuaternion);
  configureMount(primary, source.kind, rightHand);
  rightHand.add(primary);

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
    configureMount(mounted, source.kind, bone);
    bone.add(mounted);
    mounts.push(mounted);
  }
  primary.userData.workerToolMounts = mounts;
  primary.userData.workerToolMountCount = mounts.length;
  return primary;
}

export function setMilitaryEquipmentVisible(tool: THREE.Group, visible: boolean): void {
  const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  for (const mount of mounts ?? [tool]) mount.visible = visible;
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
