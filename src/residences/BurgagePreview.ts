import * as THREE from 'three';
import type { BurgageLayoutResult } from './burgageLayout.ts';
import { getParcelDividerSegments } from './burgageLayout.ts';
import { createResidencePreviewMesh } from './ResidenceMarkers.ts';

const VALID_ZONE_COLOR = 0x8ec07c;
const INVALID_ZONE_COLOR = 0xd45d4a;
const VALID_ZONE_FILL = 0x8ec07c;
const INVALID_ZONE_FILL = 0xd45d4a;
const PLACING_ZONE_OUTLINE_COLOR = 0xd8e8ff;
const PLACING_FRONTAGE_COLOR = PLACING_ZONE_OUTLINE_COLOR;
const PLACING_DEPTH_GUIDE_COLOR = 0x7ec8ff;
const PLACED_CORNER_COLOR = 0xffd56a;
const PLACING_CORNER_COLOR = 0xffffff;
const HOVER_CORNER_COLOR = PLACING_CORNER_COLOR;
const OUTLINE_LIFT = 0.38;
const FRONTAGE_OUTLINE_LIFT = 0.46;
const PARCEL_FILL_COLOR = 0xc9b07f;
const PARCEL_LINE_COLOR = 0xe8d4a8;
const DIVIDER_LINE_COLOR = 0xf2e3b7;
const MAX_PARCEL_FILLS = 12;
const MAX_HOUSE_PREVIEWS = 12;
const DASH_LENGTH = 1.8;
const DASH_GAP = 1.0;

type EdgeSegment = readonly [THREE.Vector3, THREE.Vector3];
type LineObject = THREE.LineSegments | THREE.Line;
type GeometryObject = THREE.Mesh | LineObject;

function replaceGeometry(object: GeometryObject): THREE.BufferGeometry {
  object.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  object.geometry = geometry;
  return geometry;
}

function writeTriangleFan(
  geometry: THREE.BufferGeometry,
  points: THREE.Vector3[],
  getHeightAt: (x: number, z: number) => number,
  lift: number,
): boolean {
  if (points.length < 3) return false;

  const triangleCount = points.length - 2;
  const vertices = new Float32Array(triangleCount * 9);
  let offset = 0;
  for (let i = 1; i < points.length - 1; i++) {
    for (const index of [0, i, i + 1]) {
      const point = points[index];
      vertices[offset++] = point.x;
      vertices[offset++] = getHeightAt(point.x, point.z) + lift;
      vertices[offset++] = point.z;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return true;
}

function assignTriangleFanMesh(
  mesh: THREE.Mesh,
  points: THREE.Vector3[],
  getHeightAt: (x: number, z: number) => number,
  lift: number,
): boolean {
  const geometry = replaceGeometry(mesh);
  const filled = writeTriangleFan(geometry, points, getHeightAt, lift);
  mesh.visible = filled;
  return filled;
}

function assignLineSegments(line: LineObject, positions: number[]): void {
  const geometry = replaceGeometry(line);
  if (positions.length === 0) {
    line.visible = false;
    return;
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  line.visible = true;
}

function collectEdges(points: THREE.Vector3[], closeLoop: boolean): EdgeSegment[] {
  const edges: EdgeSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    edges.push([points[i], points[i + 1]]);
  }
  if (closeLoop && points.length >= 4) {
    edges.push([points[points.length - 1], points[0]]);
  }
  return edges;
}

function buildSolidEdgePositions(edges: EdgeSegment[]): number[] {
  const positions: number[] = [];
  for (const [start, end] of edges) {
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  }
  return positions;
}

function buildDashedEdgePositions(edges: EdgeSegment[]): number[] {
  const positions: number[] = [];
  const step = DASH_LENGTH + DASH_GAP;

  for (const [start, end] of edges) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.2) continue;

    const dirX = dx / length;
    const dirY = dy / length;
    const dirZ = dz / length;

    let traveled = DASH_GAP * 0.5;
    while (traveled + DASH_LENGTH <= length) {
      const dashStart = traveled;
      const dashEnd = traveled + DASH_LENGTH;
      positions.push(
        start.x + dirX * dashStart,
        start.y + dirY * dashStart,
        start.z + dirZ * dashStart,
        start.x + dirX * dashEnd,
        start.y + dirY * dashEnd,
        start.z + dirZ * dashEnd,
      );
      traveled += step;
    }
  }

  return positions;
}

function cornersSignature(corners: THREE.Vector3[]): string {
  return corners.map((corner) => `${corner.x.toFixed(2)},${corner.z.toFixed(2)}`).join('|');
}

function outlineSignature(outline: THREE.Vector3[] | null | undefined): string {
  if (!outline || outline.length === 0) return 'none';
  return outline.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join('|');
}

function layoutSignature(layout: BurgageLayoutResult | null): string {
  if (!layout) return 'none';
  return [
    layout.plotCount,
    layout.parcels.map((parcel) => parcel.polygon.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(':')).join('|'),
    layout.residences.map((residence) => `${residence.x.toFixed(2)},${residence.z.toFixed(2)},${residence.yaw.toFixed(3)}`).join('|'),
  ].join(';');
}

export class BurgagePreview {
  readonly group = new THREE.Group();
  private readonly zoneOutline: THREE.LineSegments;
  private readonly frontageOutline: THREE.LineSegments;
  private readonly depthGuide: THREE.LineSegments;
  private readonly zoneOutlinePlacing: THREE.LineBasicMaterial;
  private readonly frontageOutlinePlacing: THREE.LineBasicMaterial;
  private readonly depthGuideMaterial: THREE.LineBasicMaterial;
  private readonly zoneOutlineSolid: THREE.LineBasicMaterial;
  private readonly placedCornerMaterial: THREE.MeshBasicMaterial;
  private readonly zoneFill: THREE.Mesh;
  private readonly parcelFillMeshes: THREE.Mesh[];
  private readonly parcelFillMaterial: THREE.MeshBasicMaterial;
  private readonly parcelLines: THREE.LineSegments;
  private readonly dividerLines: THREE.LineSegments;
  private readonly cornerMarkers: THREE.InstancedMesh;
  private readonly hoverMarker: THREE.Mesh;
  private readonly housePreviewMeshes: THREE.Group[];
  private lastGeometrySignature = '';
  private lastValid: boolean | null = null;
  private readonly cornerMatrix = new THREE.Matrix4();

  constructor() {
    this.group.name = 'Residence preview';
    this.group.frustumCulled = false;

    this.zoneOutlinePlacing = new THREE.LineBasicMaterial({
      color: PLACING_ZONE_OUTLINE_COLOR,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false,
    });
    this.frontageOutlinePlacing = new THREE.LineBasicMaterial({
      color: PLACING_FRONTAGE_COLOR,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    });
    this.zoneOutlineSolid = new THREE.LineBasicMaterial({
      color: VALID_ZONE_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.zoneOutline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      this.zoneOutlinePlacing,
    );
    this.zoneOutline.renderOrder = 14;
    this.zoneOutline.frustumCulled = false;
    this.zoneOutline.visible = false;
    this.group.add(this.zoneOutline);

    this.frontageOutline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      this.frontageOutlinePlacing,
    );
    this.frontageOutline.renderOrder = 18;
    this.frontageOutline.frustumCulled = false;
    this.frontageOutline.visible = false;
    this.group.add(this.frontageOutline);

    this.depthGuideMaterial = new THREE.LineBasicMaterial({
      color: PLACING_DEPTH_GUIDE_COLOR,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    this.depthGuide = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      this.depthGuideMaterial,
    );
    this.depthGuide.renderOrder = 17;
    this.depthGuide.frustumCulled = false;
    this.depthGuide.visible = false;
    this.group.add(this.depthGuide);

    this.zoneFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: VALID_ZONE_FILL,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.zoneFill.renderOrder = 12;
    this.zoneFill.frustumCulled = false;
    this.zoneFill.visible = false;
    this.group.add(this.zoneFill);

    this.parcelFillMaterial = new THREE.MeshBasicMaterial({
      color: PARCEL_FILL_COLOR,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.parcelFillMeshes = [];
    for (let i = 0; i < MAX_PARCEL_FILLS; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.parcelFillMaterial);
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.parcelFillMeshes.push(mesh);
      this.group.add(mesh);
    }

    this.parcelLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: PARCEL_LINE_COLOR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.parcelLines.renderOrder = 13;
    this.parcelLines.frustumCulled = false;
    this.parcelLines.visible = false;
    this.group.add(this.parcelLines);

    this.dividerLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DIVIDER_LINE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dividerLines.renderOrder = 13;
    this.dividerLines.frustumCulled = false;
    this.dividerLines.visible = false;
    this.group.add(this.dividerLines);

    const cornerGeometry = new THREE.SphereGeometry(0.72, 10, 10);
    this.placedCornerMaterial = new THREE.MeshBasicMaterial({
      color: PLACED_CORNER_COLOR,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      depthTest: false,
    });
    this.cornerMarkers = new THREE.InstancedMesh(
      cornerGeometry,
      this.placedCornerMaterial,
      4,
    );
    this.cornerMarkers.renderOrder = 16;
    this.cornerMarkers.frustumCulled = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.visible = false;
    this.group.add(this.cornerMarkers);

    this.hoverMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 10),
      new THREE.MeshBasicMaterial({
        color: HOVER_CORNER_COLOR,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.hoverMarker.renderOrder = 16;
    this.hoverMarker.frustumCulled = false;
    this.hoverMarker.visible = false;
    this.group.add(this.hoverMarker);

    this.housePreviewMeshes = [];
    for (let i = 0; i < MAX_HOUSE_PREVIEWS; i++) {
      // Preview slot index only — placed homes derive colors from residence id hash.
      const mesh = createResidencePreviewMesh(i + 1);
      mesh.visible = false;
      this.housePreviewMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  update(
    corners: THREE.Vector3[],
    layout: BurgageLayoutResult | null,
    valid: boolean,
    getHeightAt: (x: number, z: number) => number,
    placing = false,
    placementStage = 0,
    hoverPoint: THREE.Vector3 | null = null,
    frontageEdge = 0,
    outlinePolygon: THREE.Vector3[] | null = null,
    frontagePointCount = 0,
    placedPoints: THREE.Vector3[] = [],
    depthGuide: { from: THREE.Vector3; to: THREE.Vector3 } | null = null,
  ): void {
    if (!placing && corners.length === 0) {
      this.clear();
      return;
    }

    const hoverSignature = hoverPoint ? `${hoverPoint.x.toFixed(2)},${hoverPoint.z.toFixed(2)}` : 'none';
    const geometrySignature = `${cornersSignature(corners)}|${outlineSignature(outlinePolygon)}|${hoverSignature}|${layoutSignature(layout)}|${placing ? 1 : 0}|${placementStage}|${frontageEdge}|${frontagePointCount}|${cornersSignature(placedPoints)}|${depthGuide ? `${depthGuide.from.x},${depthGuide.from.z}-${depthGuide.to.x},${depthGuide.to.z}` : 'none'}`;
    const geometryChanged = geometrySignature !== this.lastGeometrySignature;
    const validityChanged = valid !== this.lastValid;

    if (!geometryChanged && !validityChanged) return;

    if (geometryChanged) {
      this.lastGeometrySignature = geometrySignature;
      this.rebuildGeometry(
        corners,
        layout,
        valid,
        getHeightAt,
        placing,
        placementStage,
        hoverPoint,
        outlinePolygon,
        frontagePointCount,
        placedPoints,
        depthGuide,
      );
      this.lastValid = valid;
      return;
    }

    this.setValidity(valid);
  }

  setValidity(valid: boolean): void {
    if (valid === this.lastValid) return;
    this.lastValid = valid;
    const edgeColor = valid ? VALID_ZONE_COLOR : INVALID_ZONE_COLOR;
    const fillColor = valid ? VALID_ZONE_FILL : INVALID_ZONE_FILL;
    (this.zoneFill.material as THREE.MeshBasicMaterial).color.setHex(fillColor);
    if (this.zoneOutline.material === this.zoneOutlineSolid) {
      this.zoneOutlineSolid.color.setHex(edgeColor);
    }
  }

  private rebuildGeometry(
    corners: THREE.Vector3[],
    layout: BurgageLayoutResult | null,
    valid: boolean,
    getHeightAt: (x: number, z: number) => number,
    placing: boolean,
    placementStage: number,
    hoverPoint: THREE.Vector3 | null,
    outlinePolygon: THREE.Vector3[] | null,
    frontagePointCount: number,
    placedPoints: THREE.Vector3[],
    depthGuide: { from: THREE.Vector3; to: THREE.Vector3 } | null,
  ): void {
    this.group.visible = true;
    const edgeColor = valid ? VALID_ZONE_COLOR : INVALID_ZONE_COLOR;
    const fillColor = valid ? VALID_ZONE_FILL : INVALID_ZONE_FILL;
    (this.zoneFill.material as THREE.MeshBasicMaterial).color.setHex(fillColor);

    const markerSource = placedPoints.length > 0
      ? placedPoints
      : corners.slice(0, placing && corners.length >= 4 ? 4 : Math.min(placementStage, corners.length, 4));

    this.cornerMarkers.count = markerSource.length;
    this.cornerMarkers.visible = markerSource.length > 0;
    for (let i = 0; i < markerSource.length; i++) {
      const corner = markerSource[i];
      const y = getHeightAt(corner.x, corner.z) + 0.42;
      const scale = i < 2 && placing && placementStage <= 2 ? 1.12 : 1;
      this.cornerMatrix.compose(
        new THREE.Vector3(corner.x, y, corner.z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      this.cornerMarkers.setMatrixAt(i, this.cornerMatrix);
    }
    this.cornerMarkers.instanceMatrix.needsUpdate = markerSource.length > 0;

    if (depthGuide && placing && placementStage === 2) {
      assignLineSegments(this.depthGuide, buildDashedEdgePositions([[depthGuide.from, depthGuide.to]]));
      this.depthGuide.visible = true;
    } else {
      replaceGeometry(this.depthGuide);
      this.depthGuide.visible = false;
    }

    if (hoverPoint && placing && placementStage < 4) {
      const y = getHeightAt(hoverPoint.x, hoverPoint.z) + 0.36;
      this.hoverMarker.position.set(hoverPoint.x, y, hoverPoint.z);
      this.hoverMarker.visible = true;
    } else {
      this.hoverMarker.visible = false;
    }

    const outlineSource = outlinePolygon && outlinePolygon.length >= 2
      ? outlinePolygon
      : corners;
    const lifted = outlineSource.map((corner) => {
      const y = getHeightAt(corner.x, corner.z) + OUTLINE_LIFT;
      return new THREE.Vector3(corner.x, y, corner.z);
    });

    const closeLoop = lifted.length >= 4 && (!placing || placementStage >= 2);
    const edges = collectEdges(lifted, closeLoop);
    const resolvedFrontageCount = Math.min(
      Math.max(frontagePointCount, 0),
      lifted.length,
    );
    const frontageEdges = resolvedFrontageCount >= 2
      ? edges.slice(0, resolvedFrontageCount - 1)
      : edges;
    const zoneEdges = resolvedFrontageCount >= 2 && closeLoop
      ? [...edges.slice(resolvedFrontageCount - 1, resolvedFrontageCount), ...edges.slice(resolvedFrontageCount)]
      : resolvedFrontageCount >= 2
        ? edges.slice(resolvedFrontageCount - 1)
        : [];

    if (placing) {
      this.zoneOutline.material = this.zoneOutlinePlacing;
      this.zoneOutlinePlacing.color.setHex(PLACING_ZONE_OUTLINE_COLOR);
      assignLineSegments(this.zoneOutline, buildDashedEdgePositions(zoneEdges));

      const frontageEdgeSegments: EdgeSegment[] = frontageEdges.map(([start, end]) => [
        new THREE.Vector3(start.x, getHeightAt(start.x, start.z) + FRONTAGE_OUTLINE_LIFT, start.z),
        new THREE.Vector3(end.x, getHeightAt(end.x, end.z) + FRONTAGE_OUTLINE_LIFT, end.z),
      ]);
      assignLineSegments(this.frontageOutline, buildDashedEdgePositions(frontageEdgeSegments));
      this.frontageOutline.material = this.frontageOutlinePlacing;
      this.frontageOutlinePlacing.color.setHex(PLACING_FRONTAGE_COLOR);
    } else {
      this.zoneOutline.material = this.zoneOutlineSolid;
      this.zoneOutlineSolid.color.setHex(edgeColor);
      assignLineSegments(this.zoneOutline, buildSolidEdgePositions(edges));
      replaceGeometry(this.frontageOutline);
      this.frontageOutline.visible = false;
    }

    if (closeLoop) {
      assignTriangleFanMesh(this.zoneFill, lifted, getHeightAt, 0.14);
    } else {
      replaceGeometry(this.zoneFill);
      this.zoneFill.visible = false;
    }

    const parcelPositions: number[] = [];
    const dividerPositions: number[] = [];
    let parcelFillCount = 0;

    if (layout) {
      for (const parcel of layout.parcels) {
        const poly = parcel.polygon.map((point) => new THREE.Vector3(point.x, 0, point.z));
        if (parcelFillCount < MAX_PARCEL_FILLS) {
          assignTriangleFanMesh(this.parcelFillMeshes[parcelFillCount], poly, getHeightAt, 0.16);
          parcelFillCount += 1;
        }

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

    for (let i = parcelFillCount; i < MAX_PARCEL_FILLS; i++) {
      replaceGeometry(this.parcelFillMeshes[i]);
      this.parcelFillMeshes[i].visible = false;
    }

    assignLineSegments(this.parcelLines, parcelPositions);
    assignLineSegments(this.dividerLines, dividerPositions);

    const houseCount = layout?.residences.length ?? 0;
    for (let i = 0; i < houseCount; i++) {
      const residence = layout!.residences[i];
      const mesh = this.housePreviewMeshes[i];
      const y = getHeightAt(residence.x, residence.z);
      mesh.position.set(residence.x, y, residence.z);
      mesh.rotation.y = residence.yaw;
      mesh.visible = true;
    }
    for (let i = houseCount; i < MAX_HOUSE_PREVIEWS; i++) {
      this.housePreviewMeshes[i].visible = false;
    }
  }

  clear(): void {
    this.lastGeometrySignature = '';
    this.lastValid = null;
    this.group.visible = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.visible = false;
    this.cornerMarkers.instanceMatrix.needsUpdate = true;
    this.hoverMarker.visible = false;
    replaceGeometry(this.zoneOutline);
    this.zoneOutline.visible = false;
    replaceGeometry(this.frontageOutline);
    this.frontageOutline.visible = false;
    replaceGeometry(this.depthGuide);
    this.depthGuide.visible = false;
    replaceGeometry(this.zoneFill);
    this.zoneFill.visible = false;
    for (const mesh of this.housePreviewMeshes) {
      mesh.visible = false;
    }
    replaceGeometry(this.parcelLines);
    this.parcelLines.visible = false;
    replaceGeometry(this.dividerLines);
    this.dividerLines.visible = false;
    for (const mesh of this.parcelFillMeshes) {
      replaceGeometry(mesh);
      mesh.visible = false;
    }
  }

  dispose(): void {
    this.zoneOutline.geometry.dispose();
    this.frontageOutline.geometry.dispose();
    this.zoneOutlinePlacing.dispose();
    this.frontageOutlinePlacing.dispose();
    this.zoneOutlineSolid.dispose();
    this.zoneFill.geometry.dispose();
    (this.zoneFill.material as THREE.Material).dispose();
    for (const mesh of this.parcelFillMeshes) {
      mesh.geometry.dispose();
    }
    this.parcelFillMaterial.dispose();
    this.parcelLines.geometry.dispose();
    (this.parcelLines.material as THREE.Material).dispose();
    this.dividerLines.geometry.dispose();
    (this.dividerLines.material as THREE.Material).dispose();
    this.cornerMarkers.geometry.dispose();
    (this.cornerMarkers.material as THREE.Material).dispose();
    this.hoverMarker.geometry.dispose();
    (this.hoverMarker.material as THREE.Material).dispose();
    for (const mesh of this.housePreviewMeshes) {
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
    }
    this.group.clear();
  }
}
