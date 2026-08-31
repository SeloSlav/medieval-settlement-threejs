import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveCombatWeaponPresentation } from './combatWeaponAnimation.ts';
import {
  isMilitaryEquipmentKind,
  type MilitaryEquipmentCombatStance,
  type MilitaryEquipmentKind,
} from './militaryEquipment.ts';
import type { WorkerToolKind } from './workerTools.ts';

const DEFAULT_CAPACITY = 1_024;

export const FALLBACK_MILITARY_EQUIPMENT_KEYS = [
  'spear:melee',
  'spear-shield:melee',
  'pike-kit:melee',
  'sidearm:melee',
  'sidearm-shield:melee',
  'sword-shield:melee',
  'halberd:melee',
  'bow:ranged',
  'bow:melee',
  'crossbow:ranged',
  'crossbow:melee',
  'uskok-kit:ranged',
  'uskok-kit:melee',
] as const;

export type FallbackMilitaryEquipmentKey =
  (typeof FALLBACK_MILITARY_EQUIPMENT_KEYS)[number];

export const FALLBACK_MILITARY_EQUIPMENT_DRAW_CALL_BUDGET =
  FALLBACK_MILITARY_EQUIPMENT_KEYS.length;

export type FallbackMilitaryEquipmentAgent = {
  tool?: WorkerToolKind | null;
  battlefieldWeaponDrop?: unknown;
  combatTargetDistance?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type FallbackMilitaryEquipmentDiagnostic = {
  key: FallbackMilitaryEquipmentKey;
  instances: number;
  triangles: number;
};

type EquipmentLayer = {
  key: FallbackMilitaryEquipmentKey;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  count: number;
};

type ColoredPart = {
  geometry: THREE.BufferGeometry;
  color: number;
  matrix: THREE.Matrix4;
};

const COLORS = {
  ash: 0x8b6235,
  walnut: 0x49301f,
  steel: 0xaeb5b5,
  bluedSteel: 0x4c575b,
  brass: 0xa98b45,
  leather: 0x4a2d1c,
  oxblood: 0x642923,
  paint: 0x79342d,
  cord: 0xc6b98e,
  feather: 0xcec7b3,
} as const;

/**
 * Rigid distance LOD for combat equipment. The close 72 soldiers retain the
 * full authored assemblies and bone-aware combat poses; every farther soldier
 * is routed into one of thirteen low-poly, material-colored instanced layers.
 */
export class FallbackMilitaryEquipmentRenderer {
  private readonly group = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({
    name: 'Distance military equipment · baked material identities',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.18,
  });
  private readonly layers = new Map<FallbackMilitaryEquipmentKey, EquipmentLayer>();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly matrix = new THREE.Matrix4();
  private readonly capacity: number;

  constructor(parent: THREE.Group, capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.group.name = 'Instanced distance military equipment';
    parent.add(this.group);
    for (const key of FALLBACK_MILITARY_EQUIPMENT_KEYS) {
      const geometry = createFallbackEquipmentGeometry(key);
      const mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
      mesh.name = `Distance equipment · ${key}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.layers.set(key, { key, mesh, geometry, count: 0 });
    }
  }

  sync(
    agents: readonly FallbackMilitaryEquipmentAgent[],
    excludedIds?: ReadonlySet<string>,
  ): void {
    for (const layer of this.layers.values()) layer.count = 0;
    for (const agent of agents) {
      const id = 'id' in agent ? String(agent.id) : '';
      if (id && excludedIds?.has(id)) continue;
      if (agent.battlefieldWeaponDrop) continue;
      const key = fallbackEquipmentKey(agent.tool, agent.combatTargetDistance);
      if (!key) continue;
      const layer = this.layers.get(key)!;
      if (layer.count >= this.capacity) continue;
      this.position.set(agent.x, agent.y, agent.z);
      this.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, agent.yaw);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      layer.mesh.setMatrixAt(layer.count, this.matrix);
      layer.count += 1;
    }
    for (const layer of this.layers.values()) {
      layer.mesh.count = layer.count;
      publishInstancePrefix(layer.mesh.instanceMatrix, layer.count);
    }
  }

  diagnostics(): FallbackMilitaryEquipmentDiagnostic[] {
    return [...this.layers.values()].map((layer) => ({
      key: layer.key,
      instances: layer.mesh.count,
      triangles: Math.floor((
        layer.geometry.index?.count
          ?? layer.geometry.getAttribute('position').count
      ) / 3),
    }));
  }

  dispose(): void {
    for (const layer of this.layers.values()) {
      layer.mesh.removeFromParent();
      layer.geometry.dispose();
    }
    this.layers.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

export function fallbackEquipmentKey(
  tool: WorkerToolKind | null | undefined,
  targetDistance = Number.POSITIVE_INFINITY,
): FallbackMilitaryEquipmentKey | null {
  if (!tool || !isMilitaryEquipmentKind(tool)) return null;
  const stance = resolveCombatWeaponPresentation(tool, targetDistance)?.stance
    ?? defaultStance(tool);
  const key = `${tool}:${stance}` as FallbackMilitaryEquipmentKey;
  return (FALLBACK_MILITARY_EQUIPMENT_KEYS as readonly string[]).includes(key)
    ? key
    : `${tool}:melee` as FallbackMilitaryEquipmentKey;
}

function defaultStance(kind: MilitaryEquipmentKind): MilitaryEquipmentCombatStance {
  return kind === 'bow' || kind === 'crossbow' || kind === 'uskok-kit'
    ? 'ranged'
    : 'melee';
}

function createFallbackEquipmentGeometry(
  key: FallbackMilitaryEquipmentKey,
): THREE.BufferGeometry {
  const [kind, stance] = key.split(':') as [
    MilitaryEquipmentKind,
    MilitaryEquipmentCombatStance,
  ];
  const parts: ColoredPart[] = [];
  switch (kind) {
    case 'spear':
      addPole(parts, 2.35, 'spear');
      break;
    case 'spear-shield':
      addPole(parts, 2.65, 'spear');
      addShield(parts, 'medium');
      break;
    case 'pike-kit':
      addPole(parts, 4.7, 'pike');
      addScabbard(parts, -0.22);
      break;
    case 'sidearm':
      addSword(parts, 0.82, false);
      break;
    case 'sidearm-shield':
      addSword(parts, 0.82, false);
      addShield(parts, 'small');
      break;
    case 'sword-shield':
      addSword(parts, 1.08, true);
      addShield(parts, 'large');
      break;
    case 'halberd':
      addPole(parts, 2.55, 'halberd');
      break;
    case 'bow':
      if (stance === 'ranged') addBow(parts, false);
      else {
        addDagger(parts);
        addBow(parts, true);
      }
      break;
    case 'crossbow':
      if (stance === 'ranged') addCrossbow(parts, false);
      else {
        addDagger(parts);
        addCrossbow(parts, true);
      }
      break;
    case 'uskok-kit':
      if (stance === 'ranged') addArquebus(parts, false);
      else {
        addSword(parts, 0.86, false, true);
        addArquebus(parts, true);
      }
      break;
  }
  const geometries = parts.map((part) => coloredGeometry(
    part.geometry,
    part.color,
    part.matrix,
  ));
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error(`Unable to compile fallback equipment ${key}`);
  merged.name = `Distance military equipment geometry · ${key}`;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.fallbackMilitaryEquipment = true;
  merged.userData.fallbackMilitaryEquipmentKey = key;
  return merged;
}

function addPole(
  parts: ColoredPart[],
  length: number,
  kind: 'spear' | 'pike' | 'halberd',
): void {
  const mount = compose([ -0.16, 0.83, 0.12 ], [1.34, 0, -0.05]);
  const shaftLength = length - (kind === 'halberd' ? 0.43 : 0.28);
  addPart(parts, new THREE.CylinderGeometry(0.021, 0.025, shaftLength, 6), COLORS.ash,
    multiply(mount, compose([0, shaftLength * 0.45, 0])));
  addPart(parts, new THREE.CylinderGeometry(0.03, 0.026, kind === 'halberd' ? 0.42 : 0.18, 7), COLORS.bluedSteel,
    multiply(mount, compose([0, shaftLength * 0.91, 0])));
  const tipY = shaftLength * 0.98 + (kind === 'halberd' ? 0.22 : 0.12);
  addPart(parts, new THREE.ConeGeometry(kind === 'pike' ? 0.032 : 0.045, kind === 'halberd' ? 0.34 : 0.27, 6), COLORS.steel,
    multiply(mount, compose([0, tipY, 0])));
  addPart(parts, new THREE.ConeGeometry(0.026, 0.1, 6), COLORS.bluedSteel,
    multiply(mount, compose([0, -shaftLength * 0.52, 0], [0, 0, Math.PI])));
  if (kind !== 'halberd') return;
  addPart(parts, new THREE.BoxGeometry(0.3, 0.23, 0.035), COLORS.steel,
    multiply(mount, compose([0.14, shaftLength * 0.88, 0], [0, 0, -0.28], [1, 1, 1])));
  addPart(parts, new THREE.ConeGeometry(0.045, 0.31, 5), COLORS.bluedSteel,
    multiply(mount, compose([-0.18, shaftLength * 0.88, 0], [0, 0, Math.PI / 2])));
}

function addSword(
  parts: ColoredPart[],
  length: number,
  large: boolean,
  frontier = false,
): void {
  const mount = compose([-0.17, 0.79, 0.16], [1.03, 0.08, -0.32]);
  const bladeLength = length * (large ? 0.72 : 0.68);
  addPart(parts, new THREE.BoxGeometry(large ? 0.055 : 0.046, bladeLength, 0.018), COLORS.steel,
    multiply(mount, compose([0, bladeLength * 0.5 + 0.08, 0])));
  addPart(parts, new THREE.ConeGeometry(large ? 0.039 : 0.033, 0.13, 4), COLORS.steel,
    multiply(mount, compose([0, bladeLength + 0.135, 0], [0, Math.PI / 4, 0])));
  addPart(parts, new THREE.BoxGeometry(frontier ? 0.19 : large ? 0.3 : 0.23, 0.032, 0.035), COLORS.bluedSteel,
    multiply(mount, compose([0, 0.08, 0])));
  addPart(parts, new THREE.CylinderGeometry(0.027, 0.032, 0.19, 7), frontier ? COLORS.oxblood : COLORS.leather,
    multiply(mount, compose([0, -0.03, 0])));
  addPart(parts, new THREE.SphereGeometry(large ? 0.045 : 0.038, 7, 5), COLORS.brass,
    multiply(mount, compose([0, -0.15, 0])));
}

function addDagger(parts: ColoredPart[]): void {
  addSword(parts, 0.42, false);
}

function addShield(
  parts: ColoredPart[],
  kind: 'small' | 'medium' | 'large',
): void {
  const radius = kind === 'small' ? 0.17 : kind === 'medium' ? 0.28 : 0.31;
  const mount = compose([0.24, 0.86, 0.18], [Math.PI / 2, 0, 0.08]);
  addPart(parts, new THREE.CylinderGeometry(radius, radius * 0.96, 0.045, kind === 'small' ? 10 : 14),
    kind === 'small' ? COLORS.walnut : COLORS.paint, mount);
  addPart(parts, new THREE.TorusGeometry(radius * 0.91, 0.016, 4, kind === 'small' ? 10 : 14), COLORS.bluedSteel,
    multiply(mount, compose([0, -0.025, 0], [Math.PI / 2, 0, 0])));
  addPart(parts, new THREE.SphereGeometry(radius * 0.36, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.steel,
    multiply(mount, compose([0, -0.035, 0], [Math.PI / 2, 0, 0])));
}

function addBow(parts: ColoredPart[], stowed: boolean): void {
  const mount = stowed
    ? compose([0.05, 1, -0.18], [0.08, 0.2, -0.12])
    : compose([0.22, 0.9, 0.18], [0, 0.08, -0.04]);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.13, -0.76, 0),
    new THREE.Vector3(0.035, -0.38, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.035, 0.38, 0),
    new THREE.Vector3(0.13, 0.76, 0),
  ]);
  addPart(parts, new THREE.TubeGeometry(curve, 14, 0.017, 4, false), COLORS.ash, mount);
  addPart(parts, new THREE.CylinderGeometry(0.029, 0.029, 0.18, 6), COLORS.leather, mount);
  addPart(parts, new THREE.CylinderGeometry(0.005, 0.005, 1.5, 4), COLORS.cord,
    multiply(mount, compose([0.13, 0, 0], [0, 0, 0.17])));
  if (!stowed) return;
  addPart(parts, new THREE.CylinderGeometry(0.08, 0.065, 0.48, 8, 1, true), COLORS.leather,
    compose([-0.08, 0.88, -0.2], [0.12, 0, -0.12]));
}

function addCrossbow(parts: ColoredPart[], stowed: boolean): void {
  const mount = stowed
    ? compose([0.03, 1.02, -0.18], [1.3, 0.1, 0.25])
    : compose([-0.13, 0.84, 0.17], [Math.PI / 2, 0, 0]);
  addPart(parts, new THREE.BoxGeometry(0.09, 0.73, 0.07), COLORS.walnut, mount);
  addPart(parts, new THREE.BoxGeometry(0.64, 0.035, 0.035), COLORS.bluedSteel,
    multiply(mount, compose([0, 0.29, 0.01])));
  addPart(parts, new THREE.CylinderGeometry(0.045, 0.045, 0.08, 7), COLORS.brass,
    multiply(mount, compose([0, 0.02, 0.04], [0, 0, Math.PI / 2])));
  addPart(parts, new THREE.TorusGeometry(0.068, 0.009, 4, 10, Math.PI * 1.45), COLORS.bluedSteel,
    multiply(mount, compose([0, 0.4, 0], [Math.PI / 2, 0, -0.18])));
  if (!stowed) {
    addPart(parts, new THREE.CylinderGeometry(0.006, 0.006, 0.52, 4), COLORS.ash,
      multiply(mount, compose([0, 0.13, 0.055])));
  }
}

function addArquebus(parts: ColoredPart[], stowed: boolean): void {
  const mount = stowed
    ? compose([-0.05, 1, -0.19], [1.18, 0.1, -0.22])
    : compose([-0.14, 0.84, 0.17], [Math.PI / 2, 0, 0]);
  addPart(parts, new THREE.BoxGeometry(0.085, 0.94, 0.075), COLORS.walnut, mount);
  addPart(parts, new THREE.CylinderGeometry(0.023, 0.027, 0.72, 7), COLORS.bluedSteel,
    multiply(mount, compose([0, 0.43, 0.055])));
  for (const y of [0.2, 0.62]) {
    addPart(parts, new THREE.TorusGeometry(0.035, 0.006, 4, 8), COLORS.brass,
      multiply(mount, compose([0, y, 0.055], [Math.PI / 2, 0, 0])));
  }
  addPart(parts, new THREE.BoxGeometry(0.08, 0.075, 0.025), COLORS.brass,
    multiply(mount, compose([0.045, -0.04, 0.055])));
  addPart(parts, new THREE.BoxGeometry(0.025, 0.19, 0.025), COLORS.bluedSteel,
    multiply(mount, compose([0.075, -0.015, 0.07], [0, 0, 0.38])));
  addPart(parts, new THREE.CylinderGeometry(0.008, 0.008, 0.78, 5), COLORS.steel,
    multiply(mount, compose([-0.035, 0.34, -0.045])));
}

function addScabbard(parts: ColoredPart[], tilt: number): void {
  addPart(parts, new THREE.BoxGeometry(0.075, 0.68, 0.045), COLORS.leather,
    compose([0.16, 0.58, -0.06], [0, 0, Math.PI + tilt]));
  addPart(parts, new THREE.BoxGeometry(0.29, 0.025, 0.035), COLORS.bluedSteel,
    compose([0.16, 0.9, -0.06], [0, 0, tilt]));
}

function addPart(
  parts: ColoredPart[],
  geometry: THREE.BufferGeometry,
  color: number,
  matrix: THREE.Matrix4,
): void {
  parts.push({ geometry, color, matrix });
}

function coloredGeometry(
  source: THREE.BufferGeometry,
  colorHex: number,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const geometry = source.toNonIndexed().applyMatrix4(matrix);
  source.dispose();
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color(colorHex);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function compose(
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
  scale: readonly [number, number, number] = [1, 1, 1],
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function multiply(left: THREE.Matrix4, right: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(left, right);
}

function publishInstancePrefix(
  attribute: THREE.InstancedBufferAttribute,
  count: number,
): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, Math.max(1, count) * attribute.itemSize);
  attribute.needsUpdate = true;
}
