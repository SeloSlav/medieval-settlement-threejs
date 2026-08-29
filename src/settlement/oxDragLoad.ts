import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingKind } from '../resources/types.ts';

export const OX_DRAG_LOAD_KINDS = [
  'timber',
  'stone',
  'iron',
  'clay',
  'charcoal',
  'sheaves',
  'feed',
  'planks',
] as const;

export type OxDragLoadKind = (typeof OX_DRAG_LOAD_KINDS)[number];

export type OxDragLoadMetrics = Readonly<{
  centerDistance: number;
  groundLength: number;
}>;

const LOAD_METRICS: Record<OxDragLoadKind, OxDragLoadMetrics> = {
  timber: { centerDistance: 2.25, groundLength: 3.15 },
  stone: { centerDistance: 2.05, groundLength: 2.55 },
  iron: { centerDistance: 2.05, groundLength: 2.55 },
  clay: { centerDistance: 2.05, groundLength: 2.55 },
  charcoal: { centerDistance: 2.05, groundLength: 2.55 },
  sheaves: { centerDistance: 2.1, groundLength: 2.7 },
  feed: { centerDistance: 2.05, groundLength: 2.55 },
  planks: { centerDistance: 2.2, groundLength: 2.95 },
};

type MaterialSlot =
  | 'wood'
  | 'woodCut'
  | 'rope'
  | 'stone'
  | 'iron'
  | 'clay'
  | 'charcoal'
  | 'straw'
  | 'canvas';

type PartWriter = Map<MaterialSlot, THREE.BufferGeometry[]>;

/** Visual cargo inferred from the heavy workplace served by an active ox. */
export function oxDragLoadKindForWorkplace(
  kind: BuildingKind,
): OxDragLoadKind | null {
  switch (kind) {
    case 'lumber_mill':
    case 'woodcutters_lodge':
      return 'timber';
    case 'stone_quarry':
    case 'large_quarry':
      return 'stone';
    case 'mine':
      return 'iron';
    case 'charcoal_burner':
      return 'charcoal';
    case 'threshing_barn':
      return 'sheaves';
    case 'pastoral_farmstead':
    case 'swineherd':
      return 'feed';
    case 'carpenter':
      return 'planks';
    default:
      return null;
  }
}

/**
 * Shared low-draw-call cargo templates. Clones share merged geometry and
 * materials; only their ground-following transform changes per ox.
 */
export class OxDragLoadLibrary {
  private readonly templates = new Map<OxDragLoadKind, THREE.Group>();
  private readonly materials: Record<MaterialSlot, THREE.MeshStandardMaterial> = {
    wood: material('Ox drag bark', 0x68452a, 0.98),
    woodCut: material('Ox drag cut wood', 0xb78c58, 0.95),
    rope: material('Ox drag rope', 0x7c603c, 1),
    stone: material('Ox drag quarried stone', 0x686d70, 1),
    iron: material('Ox drag iron ore', 0x65463a, 0.98, 0.04),
    clay: material('Ox drag wet clay', 0x8b5039, 1),
    charcoal: material('Ox drag charcoal', 0x222526, 1),
    straw: material('Ox drag dried straw', 0xb39050, 1),
    canvas: material('Ox drag sack canvas', 0xa78e62, 0.99),
  };

  create(kind: OxDragLoadKind): THREE.Group {
    let template = this.templates.get(kind);
    if (!template) {
      template = buildLoadTemplate(kind, this.materials);
      this.templates.set(kind, template);
    }
    const clone = template.clone(true);
    clone.name = `Ox dragged cargo: ${kind}`;
    clone.userData.oxDragLoadKind = kind;
    return clone;
  }

  metrics(kind: OxDragLoadKind): OxDragLoadMetrics {
    return LOAD_METRICS[kind];
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const template of this.templates.values()) {
      template.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
      });
    }
    for (const geometry of geometries) geometry.dispose();
    for (const materialValue of Object.values(this.materials)) {
      materialValue.dispose();
    }
    this.templates.clear();
  }
}

function material(
  name: string,
  color: number,
  roughness: number,
  metalness = 0,
): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  result.name = name;
  return result;
}

function buildLoadTemplate(
  kind: OxDragLoadKind,
  materials: Record<MaterialSlot, THREE.MeshStandardMaterial>,
): THREE.Group {
  const writer: PartWriter = new Map();
  if (kind === 'timber') addTimberDrag(writer);
  else {
    addTravois(writer);
    switch (kind) {
      case 'stone':
        addRockPile(writer, 'stone');
        break;
      case 'iron':
        addRockPile(writer, 'iron');
        break;
      case 'clay':
        addClayBaskets(writer);
        break;
      case 'charcoal':
        addSacks(writer, 'charcoal');
        break;
      case 'sheaves':
        addSheaves(writer);
        break;
      case 'feed':
        addSacks(writer, 'canvas');
        break;
      case 'planks':
        addPlanks(writer);
        break;
      default: {
        const unreachable: never = kind;
        throw new Error(`Unknown ox drag load: ${unreachable}`);
      }
    }
  }

  const group = new THREE.Group();
  group.name = `Ox drag-load template: ${kind}`;
  for (const [slot, parts] of writer) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[slot]);
    mesh.name = `Ox drag ${kind} ${slot}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}

function addTimberDrag(writer: PartWriter): void {
  const logs = [
    { x: -0.19, y: 0.13, z: 0.03, length: 3.15, radius: 0.13 },
    { x: 0.16, y: 0.12, z: -0.1, length: 2.92, radius: 0.12 },
    { x: -0.01, y: 0.34, z: 0.06, length: 2.7, radius: 0.11 },
  ] as const;
  for (const log of logs) {
    emit(
      writer,
      'wood',
      new THREE.CylinderGeometry(log.radius * 0.88, log.radius, log.length, 7),
      [log.x, log.y, log.z],
      [Math.PI * 0.5, 0, 0],
    );
    for (const direction of [-1, 1]) {
      emit(
        writer,
        'woodCut',
        new THREE.CylinderGeometry(log.radius * 0.8, log.radius * 0.84, 0.018, 7),
        [log.x, log.y, log.z + direction * log.length * 0.5],
        [Math.PI * 0.5, 0, 0],
      );
    }
  }
  for (const z of [-0.62, 0.58]) {
    emit(
      writer,
      'rope',
      new THREE.TorusGeometry(0.27, 0.025, 5, 10),
      [0, 0.3, z],
      undefined,
      [1.35, 1, 1],
    );
  }
  addGroundTraces(writer, 1.75);
}

function addTravois(writer: PartWriter): void {
  for (const x of [-0.43, 0.43]) {
    emit(writer, 'wood', new THREE.BoxGeometry(0.1, 0.11, 2.55), [x, 0.075, 0]);
  }
  for (const z of [-0.7, 0, 0.68]) {
    emit(writer, 'wood', new THREE.BoxGeometry(0.98, 0.09, 0.12), [0, 0.13, z]);
  }
  addGroundTraces(writer, 1.65);
}

function addGroundTraces(writer: PartWriter, length: number): void {
  for (const x of [-0.4, 0.4]) {
    emit(
      writer,
      'rope',
      new THREE.BoxGeometry(0.035, 0.035, length),
      [x, 0.18, 1.25],
    );
  }
}

function addRockPile(writer: PartWriter, slot: 'stone' | 'iron'): void {
  const rocks = [
    [-0.27, 0.34, -0.32, 0.28],
    [0.23, 0.32, -0.28, 0.25],
    [-0.18, 0.35, 0.18, 0.24],
    [0.28, 0.34, 0.2, 0.27],
    [0.02, 0.58, -0.03, 0.24],
  ] as const;
  for (const [index, [x, y, z, radius]] of rocks.entries()) {
    emit(
      writer,
      slot,
      new THREE.DodecahedronGeometry(radius, 0),
      [x, y, z],
      [index * 0.17, index * 0.39, index * 0.13],
      [1, 0.78 + (index % 2) * 0.12, 0.94],
    );
  }
}

function addClayBaskets(writer: PartWriter): void {
  for (const [x, z] of [[-0.25, -0.18], [0.25, -0.1], [0, 0.34]] as const) {
    emit(
      writer,
      'clay',
      new THREE.SphereGeometry(0.25, 8, 5),
      [x, 0.35, z],
      undefined,
      [1, 0.62, 1],
    );
    emit(
      writer,
      'rope',
      new THREE.TorusGeometry(0.26, 0.025, 5, 10),
      [x, 0.35, z],
      [Math.PI * 0.5, 0, 0],
    );
  }
}

function addSacks(writer: PartWriter, contents: 'charcoal' | 'canvas'): void {
  const sackSlot = contents === 'charcoal' ? 'canvas' : contents;
  for (const [index, [x, z]] of ([[-0.25, -0.2], [0.24, -0.14], [0, 0.3]] as const).entries()) {
    emit(
      writer,
      sackSlot,
      new THREE.CapsuleGeometry(0.22, 0.34, 3, 8),
      [x, 0.43, z],
      [0.08 * (index - 1), 0, index % 2 ? 0.12 : -0.1],
      [0.9, 0.85, 0.82],
    );
    if (contents === 'charcoal') {
      for (let chunk = 0; chunk < 3; chunk += 1) {
        emit(
          writer,
          'charcoal',
          new THREE.DodecahedronGeometry(0.07 + chunk * 0.008, 0),
          [x - 0.08 + chunk * 0.08, 0.67 + (chunk % 2) * 0.04, z],
          [chunk * 0.3, index * 0.4, chunk * 0.2],
        );
      }
    }
  }
}

function addSheaves(writer: PartWriter): void {
  for (const [index, [x, y, z, yaw]] of ([
    [-0.24, 0.32, -0.18, -0.12],
    [0.22, 0.31, -0.12, 0.1],
    [-0.12, 0.48, 0.22, 0.08],
    [0.2, 0.47, 0.25, -0.09],
  ] as const).entries()) {
    emit(
      writer,
      'straw',
      new THREE.CylinderGeometry(0.13, 0.19, 1.05, 7),
      [x, y, z],
      [Math.PI * 0.5, yaw, Math.PI * 0.5],
    );
    emit(
      writer,
      'rope',
      new THREE.TorusGeometry(0.145, 0.018, 5, 8),
      [x, y, z + (index % 2 ? 0.04 : -0.04)],
      [0, Math.PI * 0.5, 0],
    );
  }
}

function addPlanks(writer: PartWriter): void {
  for (let index = 0; index < 6; index += 1) {
    const layer = Math.floor(index / 3);
    const x = -0.3 + (index % 3) * 0.3;
    emit(
      writer,
      'woodCut',
      new THREE.BoxGeometry(0.24, 0.1, 2.25 - (index % 2) * 0.12),
      [x, 0.24 + layer * 0.12, -0.05 + (index % 2) * 0.06],
    );
  }
  for (const z of [-0.55, 0.54]) {
    emit(writer, 'rope', new THREE.BoxGeometry(0.95, 0.035, 0.04), [0, 0.48, z]);
  }
}

function emit(
  writer: PartWriter,
  slot: MaterialSlot,
  geometry: THREE.BufferGeometry,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
  scale: readonly [number, number, number] = [1, 1, 1],
): void {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  geometry.applyMatrix4(matrix);
  const parts = writer.get(slot);
  if (parts) parts.push(geometry);
  else writer.set(slot, [geometry]);
}
