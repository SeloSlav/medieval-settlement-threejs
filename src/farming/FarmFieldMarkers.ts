import * as THREE from 'three';
import {
  clearOverlayGeometry,
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { FarmCrop, FarmFieldStage, FarmFieldState } from '../resources/types.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { bilinearPoint, type FarmFieldCorners } from './farmFieldMath.ts';

const GRID_STEPS = 10;
const FIELD_LIFT = 0.08;

function fieldColor(crop: FarmCrop, stage: FarmFieldStage): number {
  if (stage === 'ploughing') return 0x5c3b21;
  if (stage === 'sowing') return 0x7c5830;
  if (stage === 'harvesting') return 0xb38a31;
  if (crop === 'oats') return 0x9da653;
  if (crop === 'fallow') return 0x657440;
  return 0xa88c3f;
}

function createSurface(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= GRID_STEPS; v++) {
    for (let u = 0; u <= GRID_STEPS; u++) {
      const point = bilinearPoint(corners, u / GRID_STEPS, v / GRID_STEPS);
      vertices.push(point.x, getHeightAt(point.x, point.z) + FIELD_LIFT, point.z);
    }
  }
  const stride = GRID_STEPS + 1;
  for (let v = 0; v < GRID_STEPS; v++) {
    for (let u = 0; u < GRID_STEPS; u++) {
      const a = v * stride + u;
      const b = a + 1;
      const d = (v + 1) * stride + u;
      const c = d + 1;
      indices.push(a, d, b, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createRows(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  color: number,
): THREE.LineSegments {
  const vertices: number[] = [];
  const rows = Math.max(3, Math.min(32, Math.floor(Math.hypot(corners[3].x - corners[0].x, corners[3].z - corners[0].z) / 1.4)));
  for (let row = 1; row < rows; row++) {
    const v = row / rows;
    for (let segment = 0; segment < GRID_STEPS; segment++) {
      for (const u of [segment / GRID_STEPS, (segment + 1) / GRID_STEPS]) {
        const point = bilinearPoint(corners, u, v);
        vertices.push(point.x, getHeightAt(point.x, point.z) + FIELD_LIFT + 0.035, point.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 }));
}

function createOutline(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  color: number,
): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < corners.length; index++) {
    for (const point of [corners[index], corners[(index + 1) % corners.length]]) {
      points.push(new THREE.Vector3(point.x, getHeightAt(point.x, point.z) + FIELD_LIFT + 0.06, point.z));
    }
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
  );
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    for (const material of materials) material.dispose();
  });
  root.clear();
}

export class FarmFieldMarkers {
  private readonly root = new THREE.Group();
  private lastSignature = '';
  private readonly getHeightAt: (x: number, z: number) => number;

  constructor(
    parent: THREE.Group,
    getHeightAt: (x: number, z: number) => number,
  ) {
    this.getHeightAt = getHeightAt;
    this.root.name = 'Farm fields';
    parent.add(this.root);
  }

  syncFields(fields: Iterable<FarmFieldState>): void {
    const list = [...fields];
    const signature = list.map((field) => `${field.id}:${field.crop}:${field.stage}:${field.corners.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    disposeObject(this.root);
    for (const field of list) {
      const corners = field.corners as FarmFieldCorners;
      const group = new THREE.Group();
      group.name = `Field ${field.id}`;
      const color = fieldColor(field.crop, field.stage);
      group.add(createSurface(corners, this.getHeightAt, color, 0.92));
      group.add(createRows(corners, this.getHeightAt, field.stage === 'growing' ? 0xd7c76a : 0x3f2b1d));
      group.add(createOutline(corners, this.getHeightAt, 0xd1b56b));
      this.root.add(group);
    }
  }

  dispose(): void {
    disposeObject(this.root);
    this.root.removeFromParent();
  }
}

export class FarmFieldPreview {
  readonly group = new THREE.Group();
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly fill: THREE.Mesh;
  private readonly border: THREE.Mesh;
  private readonly guides: THREE.Mesh;
  private lastSignature = '';

  constructor(getHeightAt: (x: number, z: number) => number) {
    this.getHeightAt = getHeightAt;
    this.group.name = 'Terrain-hugging farmland preview';
    this.group.frustumCulled = false;
    this.group.visible = false;

    this.fill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.11,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.fill.name = 'Farmland preview fill';
    this.fill.renderOrder = 12;
    this.fill.frustumCulled = false;
    this.group.add(this.fill);

    this.guides = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.48,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.guides.name = 'Farmland internal guides';
    this.guides.renderOrder = 14;
    this.guides.frustumCulled = false;
    this.group.add(this.guides);

    this.border = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.94,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.border.name = 'Farmland dotted border';
    this.border.renderOrder = 15;
    this.border.frustumCulled = false;
    this.group.add(this.border);
  }

  show(corners: FarmFieldCorners | null, valid: boolean, _crop: FarmCrop): void {
    if (!corners) {
      this.lastSignature = '';
      this.group.visible = false;
      return;
    }

    const signature = `${valid ? 1 : 0}|${corners
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('|')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.group.visible = true;

    const color = valid ? 0xfffdf5 : 0xff5d50;
    for (const mesh of [this.fill, this.guides, this.border]) {
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
    (this.fill.material as THREE.MeshBasicMaterial).opacity = valid ? 0.11 : 0.085;

    updateTerrainQuadGeometry(
      this.fill.geometry,
      corners,
      this.getHeightAt,
      0.095,
      9,
      9,
    );
    updateTerrainRibbonGeometry(
      this.border.geometry,
      polygonSegments(corners),
      this.getHeightAt,
      {
        width: 0.18,
        lift: 0.16,
        sampleSpacing: 0.9,
        dashLength: 1.5,
        gapLength: 0.82,
      },
    );

    const width = Math.hypot(
      corners[1].x - corners[0].x,
      corners[1].z - corners[0].z,
    );
    const guideCount = Math.max(1, Math.min(16, Math.round(width / 5.2)));
    const guideSegments: TerrainOverlaySegment[] = [];
    for (let index = 1; index < guideCount; index += 1) {
      const u = index / guideCount;
      guideSegments.push([
        bilinearPoint(corners, u, 0),
        bilinearPoint(corners, u, 1),
      ]);
    }
    updateTerrainRibbonGeometry(
      this.guides.geometry,
      guideSegments,
      this.getHeightAt,
      {
        width: 0.075,
        lift: 0.135,
        sampleSpacing: 0.8,
      },
    );
    this.guides.visible = Boolean(
      this.guides.geometry.getAttribute('position')?.count,
    );
  }

  dispose(): void {
    clearOverlayGeometry(this.fill.geometry);
    clearOverlayGeometry(this.border.geometry);
    clearOverlayGeometry(this.guides.geometry);
    disposeObject3D(this.group, true);
    this.group.removeFromParent();
    this.group.clear();
  }
}
