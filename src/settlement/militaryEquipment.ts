import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MILITARY_EQUIPMENT_KINDS = [
  'spear',
  'spear-shield',
  'crossbow',
  'sidearm',
  'sidearm-shield',
  'sword-shield',
  'halberd',
  'bow',
  'uskok-kit',
] as const;

export type MilitaryEquipmentKind = (typeof MILITARY_EQUIPMENT_KINDS)[number];

export type MilitaryEquipmentMountSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceLength: number;
  targetLength: number;
  boneNames: readonly string[];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
};

export type MilitaryEquipmentSource = {
  militaryEquipment: true;
  kind: MilitaryEquipmentKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  sourceLength: number;
  targetLength: number;
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
  spear: 2.12,
  'spear-shield': 2.12,
  crossbow: 0.86,
  sidearm: 0.88,
  'sidearm-shield': 0.88,
  'sword-shield': 1.02,
  halberd: 2.2,
  bow: 1.5,
  'uskok-kit': 0.8,
};

export function createMilitaryEquipmentSources(): MilitaryEquipmentSources {
  const materials = createMaterials();
  return {
    spear: source('spear', createSpear(materials)),
    'spear-shield': source('spear-shield', createSpear(materials), [
      mount(createShield('medium', materials), ['PalmL', 'L_Hand'], 0.78),
    ]),
    crossbow: source('crossbow', createCrossbow(materials), [
      mount(
        createBoltCase(materials),
        ['Torso', 'Spine2', 'Spine'],
        0.62,
        [-0.22, -0.05, -0.17],
        [0.08, 0.12, -0.18],
      ),
    ]),
    sidearm: source('sidearm', createSword(materials, false)),
    'sidearm-shield': source('sidearm-shield', createSword(materials, false), [
      mount(createShield('small', materials), ['PalmL', 'L_Hand'], 0.52),
    ]),
    'sword-shield': source('sword-shield', createSword(materials, true), [
      mount(createShield('large', materials), ['PalmL', 'L_Hand'], 0.92, [0, -0.03, 0]),
    ]),
    halberd: source('halberd', createHalberd(materials)),
    bow: source('bow', createBow(materials), [
      mount(
        createQuiver(materials, 7, 0.58),
        ['Torso', 'Spine2', 'Spine'],
        0.78,
        [0.25, -0.04, -0.18],
        [0.04, -0.18, 0.22],
      ),
    ]),
    'uskok-kit': source('uskok-kit', createUskokAxe(materials), [
      mount(
        createUskokScabbard(materials),
        ['Hips', 'Pelvis', 'Abdomen'],
        0.8,
        [0.24, -0.08, 0.04],
        [0.08, 0.02, -0.2],
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
  return {
    ash: new THREE.MeshStandardMaterial({
      name: 'Waxed ash weapon haft',
      color: 0x8b6235,
      roughness: 0.72,
      metalness: 0.015,
    }),
    walnut: new THREE.MeshStandardMaterial({
      name: 'Dark walnut stock',
      color: 0x4c2f1d,
      roughness: 0.68,
      metalness: 0.01,
    }),
    steel: new THREE.MeshStandardMaterial({
      name: 'Polished forged steel',
      color: 0xa9aca6,
      roughness: 0.28,
      metalness: 0.88,
    }),
    bluedSteel: new THREE.MeshStandardMaterial({
      name: 'Blued forged steel',
      color: 0x414642,
      roughness: 0.4,
      metalness: 0.82,
    }),
    brass: new THREE.MeshStandardMaterial({
      name: 'Cast brass fittings',
      color: 0xa78238,
      roughness: 0.34,
      metalness: 0.78,
    }),
    leather: new THREE.MeshStandardMaterial({
      name: 'Oiled brown leather',
      color: 0x4a2d1c,
      roughness: 0.82,
      metalness: 0,
    }),
    oxblood: new THREE.MeshStandardMaterial({
      name: 'Oxblood frontier leather',
      color: 0x6d2f27,
      roughness: 0.78,
      metalness: 0,
    }),
    paintedWood: new THREE.MeshStandardMaterial({
      name: 'Croatian red painted shield wood',
      color: 0x7d3028,
      roughness: 0.76,
      metalness: 0,
    }),
    feather: new THREE.MeshStandardMaterial({
      name: 'Goose-feather fletching',
      color: 0xd8d2be,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    cord: new THREE.LineBasicMaterial({
      name: 'Hemp bow cord',
      color: 0xd6c89d,
    }),
  };
}

function source(
  kind: MilitaryEquipmentKind,
  scene: THREE.Group,
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
    secondaryMounts,
  };
}

function mount(
  scene: THREE.Group,
  boneNames: readonly string[],
  targetLength: number,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
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
    shapeGeometry([[0, -0.14], [0.082, 0.03], [0.048, 0.13], [0, 0.25], [-0.048, 0.13], [-0.082, 0.03]], 0.026, 0.006),
    materials.steel,
    'Spear · leaf-shaped forged head',
    [0, 1.52, 0],
  );
  add(group, new THREE.ConeGeometry(0.034, 0.11, 10), materials.bluedSteel, 'Spear · iron butt cap', [0, -0.52, 0], [0, 0, Math.PI]);
  group.name = 'Procedural leaf spear';
  group.userData.equipmentIdentity = 'ordinary-leaf-spear';
  return group;
}

function createSword(materials: Materials, longSword: boolean): THREE.Group {
  const group = new THREE.Group();
  const bladeLength = longSword ? 0.77 : 0.61;
  const bladeWidth = longSword ? 0.052 : 0.046;
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
  if (kind !== 'large') {
    const count = kind === 'small' ? 32 : 36;
    const width = kind === 'small' ? 0.25 : 0.29;
    const height = kind === 'small' ? 0.25 : 0.37;
    return Array.from({ length: count }, (_, index) => {
      const angle = index / count * Math.PI * 2;
      return [Math.cos(angle) * width, Math.sin(angle) * height] as const;
    });
  }
  return [
    [-0.31, 0.31], [-0.18, 0.43], [0, 0.47], [0.18, 0.43], [0.31, 0.31],
    [0.32, 0.02], [0.25, -0.27], [0, -0.48], [-0.25, -0.27], [-0.32, 0.02],
  ];
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
  add(group, new RoundedBoxGeometry(0.035, kind === 'large' ? 0.62 : 0.46, 0.012, 3, 0.008), materials.paintedWood, `${kind} shield · painted vertical charge`, [0, 0, depth * 0.72]);
  add(group, new RoundedBoxGeometry(kind === 'large' ? 0.42 : 0.34, 0.035, 0.012, 3, 0.008), materials.paintedWood, `${kind} shield · painted crossbar`, [0, 0.08, depth * 0.72]);
  add(group, new RoundedBoxGeometry(kind === 'large' ? 0.38 : 0.3, 0.035, 0.035, 3, 0.01), materials.leather, `${kind} shield · rear arm strap`, [0, 0, -0.04], [0, 0, Math.PI / 2]);
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
    const normalized = Math.abs(t * 2 - 1);
    const x = 0.14 * Math.sin(normalized * Math.PI) - 0.055 * Math.pow(normalized, 4);
    points.push(new THREE.Vector3(x, y, 0));
  }
  add(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.018, 9, false), materials.ash, 'War bow · continuous recurved stave');
  add(group, new THREE.CylinderGeometry(0.029, 0.029, 0.17, 10), materials.leather, 'War bow · leather grip', [0.13, 0, 0]);
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([points[0]!, new THREE.Vector3(0.02, 0, 0), points.at(-1)!]),
    materials.cord,
  );
  semantic(string, 'War bow · hemp string');
  group.add(string);
  group.name = 'Procedural recurved war bow';
  group.userData.equipmentIdentity = 'fast-firing-war-bow';
  return group;
}

function createCrossbow(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new RoundedBoxGeometry(0.09, 0.73, 0.07, 4, 0.018), materials.walnut, 'Crossbow · carved walnut tiller', [0, 0.03, 0]);
  add(group, new RoundedBoxGeometry(0.14, 0.17, 0.065, 3, 0.014), materials.leather, 'Crossbow · shouldered stock', [0, -0.36, 0.012], [0, 0, -0.13]);
  const prod = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.41, 0.31, 0),
    new THREE.Vector3(-0.22, 0.27, 0.005),
    new THREE.Vector3(0, 0.3, 0.012),
    new THREE.Vector3(0.22, 0.27, 0.005),
    new THREE.Vector3(0.41, 0.31, 0),
  ]);
  add(group, new THREE.TubeGeometry(prod, 36, 0.015, 8, false), materials.bluedSteel, 'Crossbow · forged steel prod');
  add(group, new THREE.CylinderGeometry(0.043, 0.043, 0.085, 12), materials.brass, 'Crossbow · rotating nut', [0, 0.02, 0.025], [0, 0, Math.PI / 2]);
  add(group, new RoundedBoxGeometry(0.018, 0.16, 0.025, 3, 0.006), materials.bluedSteel, 'Crossbow · trigger lever', [0, -0.1, 0.055], [0.25, 0, 0]);
  add(group, new THREE.TorusGeometry(0.07, 0.01, 6, 18, Math.PI * 1.4), materials.bluedSteel, 'Crossbow · spanning stirrup', [0, 0.41, 0], [Math.PI / 2, 0, -0.2]);
  add(group, new THREE.CylinderGeometry(0.006, 0.006, 0.56, 7), materials.ash, 'Crossbow · loaded bolt', [0, 0.12, 0.052]);
  add(group, new THREE.ConeGeometry(0.018, 0.05, 6), materials.steel, 'Crossbow · bolt head', [0, 0.425, 0.052]);
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.41, 0.31, 0.012),
      new THREE.Vector3(0, 0.02, 0.012),
      new THREE.Vector3(0.41, 0.31, 0.012),
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

function createUskokAxe(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.019, 0.025, 0.62, 11), materials.ash, 'Uskok axe · mountain-ash haft', [0, 0.18, 0]);
  add(group, shapeGeometry([[0, -0.1], [0.2, -0.07], [0.27, 0.08], [0.2, 0.22], [0.03, 0.18], [-0.03, 0.09]], 0.04, 0.009), materials.steel, 'Uskok axe · bearded cutting head', [0.015, 0.48, 0]);
  add(group, new THREE.CylinderGeometry(0.034, 0.03, 0.16, 10), materials.bluedSteel, 'Uskok axe · reinforced eye', [0, 0.5, 0]);
  add(group, new THREE.TorusGeometry(0.025, 0.006, 6, 12), materials.brass, 'Uskok axe · grip ferrule', [0, -0.12, 0], [Math.PI / 2, 0, 0]);
  group.name = 'Procedural Uskok bearded axe';
  group.userData.equipmentIdentity = 'uskok-bearded-axe';
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
    list.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
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
  primary.position.set(0, 0, 0);
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
    mounted.position.set(
      secondary.position[0] / inheritedScale,
      secondary.position[1] / inheritedScale,
      secondary.position[2] / inheritedScale,
    );
    mounted.rotation.set(...secondary.rotation);
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
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
