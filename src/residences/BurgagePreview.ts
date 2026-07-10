import * as THREE from 'three';
import type { BurgageLayoutResult } from './burgageLayout.ts';
import { getParcelDividerSegments } from './burgageLayout.ts';
import { createResidenceMesh } from './ResidenceMarkers.ts';

const VALID_ZONE_COLOR = 0x8ec07c;
const INVALID_ZONE_COLOR = 0xd45d4a;
const VALID_ZONE_FILL = 0x8ec07c;
const INVALID_ZONE_FILL = 0xd45d4a;
const PARCEL_FILL_COLOR = 0xc9b07f;
const PARCEL_LINE_COLOR = 0xe8d4a8;
const DIVIDER_LINE_COLOR = 0xf2e3b7;
const CORNER_COLOR = 0xf2e3b7;

function buildPolygonFill(
  points: THREE.Vector3[],
  getHeightAt: (x: number, z: number) => number,
  lift: number,
): THREE.BufferGeometry | null {
  if (points.length < 3) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const point of points) {
    vertices.push(point.x, getHeightAt(point.x, point.z) + lift, point.z);
  }

  for (let i = 1; i < points.length - 1; i++) {
    indices.push(0, i, i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class BurgagePreview {
  readonly group = new THREE.Group();
  private readonly zoneLine: THREE.Line;
  private readonly zoneFill: THREE.Mesh;
  private readonly parcelFills: THREE.Group;
  private readonly parcelLines: THREE.LineSegments;
  private readonly dividerLines: THREE.LineSegments;
  private readonly cornerMarkers: THREE.InstancedMesh;
  private readonly residenceMeshes: THREE.Group;
  private readonly residencePool: THREE.Group[] = [];

  constructor() {
    this.group.name = 'Residence preview';

    const zoneGeometry = new THREE.BufferGeometry();
    this.zoneLine = new THREE.Line(
      zoneGeometry,
      new THREE.LineBasicMaterial({
        color: VALID_ZONE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    this.zoneLine.renderOrder = 14;
    this.group.add(this.zoneLine);

    this.zoneFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: VALID_ZONE_FILL,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.zoneFill.renderOrder = 12;
    this.group.add(this.zoneFill);

    this.parcelFills = new THREE.Group();
    this.parcelFills.name = 'Parcel fills';
    this.group.add(this.parcelFills);

    const parcelGeometry = new THREE.BufferGeometry();
    this.parcelLines = new THREE.LineSegments(
      parcelGeometry,
      new THREE.LineBasicMaterial({
        color: PARCEL_LINE_COLOR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.parcelLines.renderOrder = 13;
    this.group.add(this.parcelLines);

    const dividerGeometry = new THREE.BufferGeometry();
    this.dividerLines = new THREE.LineSegments(
      dividerGeometry,
      new THREE.LineBasicMaterial({
        color: DIVIDER_LINE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    this.dividerLines.renderOrder = 13;
    this.group.add(this.dividerLines);

    const cornerGeometry = new THREE.SphereGeometry(0.55, 10, 10);
    this.cornerMarkers = new THREE.InstancedMesh(
      cornerGeometry,
      new THREE.MeshBasicMaterial({
        color: CORNER_COLOR,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
      }),
      4,
    );
    this.cornerMarkers.renderOrder = 16;
    this.group.add(this.cornerMarkers);

    this.residenceMeshes = new THREE.Group();
    this.residenceMeshes.name = 'Residence previews';
    this.group.add(this.residenceMeshes);
  }

  update(
    corners: THREE.Vector3[],
    layout: BurgageLayoutResult | null,
    valid: boolean,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    if (corners.length === 0) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    const edgeColor = valid ? VALID_ZONE_COLOR : INVALID_ZONE_COLOR;
    const fillColor = valid ? VALID_ZONE_FILL : INVALID_ZONE_FILL;
    (this.zoneLine.material as THREE.LineBasicMaterial).color.setHex(edgeColor);
    (this.zoneFill.material as THREE.MeshBasicMaterial).color.setHex(fillColor);

    const placedCornerCount = Math.min(corners.length, 4);
    const cornerMatrix = new THREE.Matrix4();
    this.cornerMarkers.count = placedCornerCount;
    for (let i = 0; i < placedCornerCount; i++) {
      const corner = corners[i];
      const y = getHeightAt(corner.x, corner.z) + 0.35;
      cornerMatrix.identity();
      cornerMatrix.setPosition(corner.x, y, corner.z);
      this.cornerMarkers.setMatrixAt(i, cornerMatrix);
    }
    this.cornerMarkers.instanceMatrix.needsUpdate = placedCornerCount > 0;

    const lifted = corners.map((corner) => {
      const y = getHeightAt(corner.x, corner.z) + 0.2;
      return new THREE.Vector3(corner.x, y, corner.z);
    });

    if (lifted.length >= 2) {
      const loop = [...lifted];
      if (lifted.length >= 4) loop.push(lifted[0].clone());
      this.zoneLine.geometry.dispose();
      this.zoneLine.geometry = new THREE.BufferGeometry().setFromPoints(loop);
    } else {
      this.zoneLine.geometry.dispose();
      this.zoneLine.geometry = new THREE.BufferGeometry();
    }

    const fillGeometry = buildPolygonFill(corners, getHeightAt, 0.14);
    this.zoneFill.geometry.dispose();
    if (fillGeometry) {
      this.zoneFill.geometry = fillGeometry;
      this.zoneFill.visible = true;
    } else {
      this.zoneFill.geometry = new THREE.BufferGeometry();
      this.zoneFill.visible = false;
    }

    this.clearParcelFills();
    const parcelPositions: number[] = [];
    const dividerPositions: number[] = [];

    if (layout) {
      for (const parcel of layout.parcels) {
        const poly = parcel.polygon.map((point) => new THREE.Vector3(point.x, 0, point.z));
        const geometry = buildPolygonFill(poly, getHeightAt, 0.16);
        if (!geometry) continue;

        const fill = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: PARCEL_FILL_COLOR,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
          }),
        );
        fill.renderOrder = 12;
        this.parcelFills.add(fill);

        const outline = poly.map((point) => {
          const y = getHeightAt(point.x, point.z) + 0.18;
          return new THREE.Vector3(point.x, y, point.z);
        });
        for (let i = 0; i < outline.length; i++) {
          const a = outline[i];
          const b = outline[(i + 1) % outline.length];
          parcelPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }

      for (const [start, end] of getParcelDividerSegments(layout)) {
        const aY = getHeightAt(start.x, start.z) + 0.2;
        const bY = getHeightAt(end.x, end.z) + 0.2;
        dividerPositions.push(start.x, aY, start.z, end.x, bY, end.z);
      }
    }

    this.parcelLines.geometry.dispose();
    this.parcelLines.geometry = new THREE.BufferGeometry();
    if (parcelPositions.length > 0) {
      this.parcelLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(parcelPositions, 3));
    }

    this.dividerLines.geometry.dispose();
    this.dividerLines.geometry = new THREE.BufferGeometry();
    if (dividerPositions.length > 0) {
      this.dividerLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(dividerPositions, 3));
    }

    const count = layout?.residences.length ?? 0;
    while (this.residencePool.length < count) {
      const mesh = createResidenceMesh();
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = (child.material as THREE.MeshStandardMaterial).clone();
          (child.material as THREE.MeshStandardMaterial).transparent = true;
          (child.material as THREE.MeshStandardMaterial).opacity = 0.82;
        }
      });
      this.residencePool.push(mesh);
      this.residenceMeshes.add(mesh);
    }

    for (let i = 0; i < this.residencePool.length; i++) {
      const mesh = this.residencePool[i];
      if (i >= count) {
        mesh.visible = false;
        continue;
      }

      const residence = layout!.residences[i];
      const y = getHeightAt(residence.x, residence.z);
      mesh.visible = true;
      mesh.position.set(residence.x, y, residence.z);
      mesh.rotation.y = residence.yaw;
    }
  }

  clear(): void {
    this.group.visible = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.instanceMatrix.needsUpdate = true;
    this.zoneFill.visible = false;
    this.clearParcelFills();
    for (const mesh of this.residencePool) {
      mesh.visible = false;
    }
  }

  dispose(): void {
    this.zoneLine.geometry.dispose();
    (this.zoneLine.material as THREE.Material).dispose();
    this.zoneFill.geometry.dispose();
    (this.zoneFill.material as THREE.Material).dispose();
    this.clearParcelFills();
    this.parcelLines.geometry.dispose();
    (this.parcelLines.material as THREE.Material).dispose();
    this.dividerLines.geometry.dispose();
    (this.dividerLines.material as THREE.Material).dispose();
    this.cornerMarkers.geometry.dispose();
    (this.cornerMarkers.material as THREE.Material).dispose();
    for (const mesh of this.residencePool) {
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
    }
    this.residencePool.length = 0;
    this.group.clear();
  }

  private clearParcelFills(): void {
    for (const fill of this.parcelFills.children) {
      if (fill instanceof THREE.Mesh) {
        fill.geometry.dispose();
        (fill.material as THREE.Material).dispose();
      }
    }
    this.parcelFills.clear();
  }
}
