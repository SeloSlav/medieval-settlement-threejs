import * as THREE from 'three';
import {
  clearOverlayGeometry,
  polygonSegments,
  updateTerrainPolygonFanGeometry,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type { BurgageLayoutResult } from './burgageLayout.ts';
import { getParcelDividerSegments } from './burgageLayout.ts';

const VALID_COLOR = 0xfffdf5;
const INVALID_COLOR = 0xff5d50;
const FILL_LIFT = 0.105;
const BORDER_LIFT = 0.17;
const FRONTAGE_LIFT = 0.205;
const DIVIDER_LIFT = 0.155;
const MARKER_LIFT = 0.2;
const BORDER_DASH_LENGTH = 1.5;
const BORDER_DASH_GAP = 0.82;

function cornersSignature(corners: readonly THREE.Vector3[]): string {
  return corners
    .map((corner) => `${corner.x.toFixed(2)},${corner.z.toFixed(2)}`)
    .join('|');
}

function outlineSignature(outline: readonly THREE.Vector3[] | null | undefined): string {
  if (!outline || outline.length === 0) return 'none';
  return cornersSignature(outline);
}

function layoutSignature(layout: BurgageLayoutResult | null): string {
  if (!layout) return 'none';
  return [
    layout.plotCount,
    getParcelDividerSegments(layout)
      .map(([start, end]) => (
        `${start.x.toFixed(2)},${start.z.toFixed(2)}-${end.x.toFixed(2)},${end.z.toFixed(2)}`
      ))
      .join('|'),
  ].join(';');
}

function toPoint2(point: THREE.Vector3): Point2 {
  return { x: point.x, z: point.z };
}

function setGeometryVisible(mesh: THREE.Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  mesh.visible = Boolean(position && position.count > 0);
}

function createOverlayMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class BurgagePreview {
  readonly group = new THREE.Group();
  private readonly zoneFill: THREE.Mesh;
  private readonly zoneBorder: THREE.Mesh;
  private readonly frontageBorder: THREE.Mesh;
  private readonly depthGuide: THREE.Mesh;
  private readonly dividerLines: THREE.Mesh;
  private readonly cornerMarkers: THREE.InstancedMesh;
  private readonly hoverMarker: THREE.Mesh;
  private readonly cornerMatrix = new THREE.Matrix4();
  private lastGeometrySignature = '';
  private lastValid: boolean | null = null;
  private lastPlacing = false;

  constructor() {
    this.group.name = 'Terrain-hugging residence plot preview';
    this.group.frustumCulled = false;
    this.group.visible = false;

    this.zoneFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createOverlayMaterial(VALID_COLOR, 0.105),
    );
    this.zoneFill.name = 'Residence plot fill';
    this.zoneFill.renderOrder = 12;
    this.zoneFill.frustumCulled = false;
    this.group.add(this.zoneFill);

    this.zoneBorder = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createOverlayMaterial(VALID_COLOR, 0.9),
    );
    this.zoneBorder.name = 'Residence plot dotted border';
    this.zoneBorder.renderOrder = 15;
    this.zoneBorder.frustumCulled = false;
    this.group.add(this.zoneBorder);

    this.frontageBorder = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createOverlayMaterial(VALID_COLOR, 0.98),
    );
    this.frontageBorder.name = 'Residence frontage dotted border';
    this.frontageBorder.renderOrder = 16;
    this.frontageBorder.frustumCulled = false;
    this.group.add(this.frontageBorder);

    this.depthGuide = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createOverlayMaterial(VALID_COLOR, 0.72),
    );
    this.depthGuide.name = 'Residence depth guide';
    this.depthGuide.renderOrder = 16;
    this.depthGuide.frustumCulled = false;
    this.group.add(this.depthGuide);

    this.dividerLines = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createOverlayMaterial(VALID_COLOR, 0.76),
    );
    this.dividerLines.name = 'Residence parcel dividers';
    this.dividerLines.renderOrder = 14;
    this.dividerLines.frustumCulled = false;
    this.group.add(this.dividerLines);

    const cornerGeometry = new THREE.RingGeometry(0.25, 0.46, 20);
    cornerGeometry.rotateX(-Math.PI * 0.5);
    this.cornerMarkers = new THREE.InstancedMesh(
      cornerGeometry,
      createOverlayMaterial(VALID_COLOR, 0.96),
      4,
    );
    this.cornerMarkers.name = 'Residence plot anchors';
    this.cornerMarkers.renderOrder = 17;
    this.cornerMarkers.frustumCulled = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.visible = false;
    this.group.add(this.cornerMarkers);

    const hoverGeometry = new THREE.RingGeometry(0.22, 0.52, 20);
    hoverGeometry.rotateX(-Math.PI * 0.5);
    this.hoverMarker = new THREE.Mesh(
      hoverGeometry,
      createOverlayMaterial(VALID_COLOR, 0.82),
    );
    this.hoverMarker.name = 'Residence plot hover anchor';
    this.hoverMarker.renderOrder = 17;
    this.hoverMarker.frustumCulled = false;
    this.hoverMarker.visible = false;
    this.group.add(this.hoverMarker);
  }

  update(
    corners: THREE.Vector3[],
    layout: BurgageLayoutResult | null,
    valid: boolean,
    getHeightAt: (x: number, z: number) => number,
    placing = false,
    placementStage = 0,
    hoverPoint: THREE.Vector3 | null = null,
    _frontageEdge = 0,
    outlinePolygon: THREE.Vector3[] | null = null,
    frontagePointCount = 0,
    placedPoints: THREE.Vector3[] = [],
    depthGuide: { from: THREE.Vector3; to: THREE.Vector3 } | null = null,
  ): void {
    if (!placing && corners.length === 0) {
      this.clear();
      return;
    }

    const hoverSignature = hoverPoint
      ? `${hoverPoint.x.toFixed(2)},${hoverPoint.z.toFixed(2)}`
      : 'none';
    const guideSignature = depthGuide
      ? `${depthGuide.from.x.toFixed(2)},${depthGuide.from.z.toFixed(2)}-${depthGuide.to.x.toFixed(2)},${depthGuide.to.z.toFixed(2)}`
      : 'none';
    const geometrySignature = [
      cornersSignature(corners),
      outlineSignature(outlinePolygon),
      hoverSignature,
      layoutSignature(layout),
      placing ? 1 : 0,
      placementStage,
      frontagePointCount,
      cornersSignature(placedPoints),
      guideSignature,
    ].join('|');
    const geometryChanged = geometrySignature !== this.lastGeometrySignature;
    const validityChanged = valid !== this.lastValid || placing !== this.lastPlacing;

    if (!geometryChanged && !validityChanged) return;
    this.lastPlacing = placing;

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
    this.lastValid = valid;
    const color = valid || this.lastPlacing ? VALID_COLOR : INVALID_COLOR;
    for (const object of [
      this.zoneFill,
      this.zoneBorder,
      this.frontageBorder,
      this.depthGuide,
      this.dividerLines,
      this.cornerMarkers,
      this.hoverMarker,
    ]) {
      const material = object.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.color.setHex(color);
      }
    }
    (this.zoneFill.material as THREE.MeshBasicMaterial).opacity = valid || this.lastPlacing
      ? 0.105
      : 0.085;
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
    this.lastPlacing = placing;
    this.setValidity(valid);

    const markerSource = placedPoints.length > 0
      ? placedPoints
      : corners.slice(0, Math.min(placementStage, corners.length, 4));
    this.cornerMarkers.count = markerSource.length;
    this.cornerMarkers.visible = markerSource.length > 0;
    for (let index = 0; index < markerSource.length; index += 1) {
      const point = markerSource[index]!;
      const scale = index < 2 && placing && placementStage <= 2 ? 1.08 : 1;
      this.cornerMatrix.compose(
        new THREE.Vector3(
          point.x,
          getHeightAt(point.x, point.z) + MARKER_LIFT,
          point.z,
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      this.cornerMarkers.setMatrixAt(index, this.cornerMatrix);
    }
    this.cornerMarkers.instanceMatrix.needsUpdate = markerSource.length > 0;

    if (hoverPoint && placing && placementStage < 4) {
      this.hoverMarker.position.set(
        hoverPoint.x,
        getHeightAt(hoverPoint.x, hoverPoint.z) + MARKER_LIFT,
        hoverPoint.z,
      );
      this.hoverMarker.visible = true;
    } else {
      this.hoverMarker.visible = false;
    }

    if (depthGuide && placing && placementStage === 2) {
      updateTerrainRibbonGeometry(
        this.depthGuide.geometry,
        [[toPoint2(depthGuide.from), toPoint2(depthGuide.to)]],
        getHeightAt,
        {
          width: 0.12,
          lift: BORDER_LIFT,
          sampleSpacing: 0.9,
          dashLength: 0.85,
          gapLength: 0.7,
        },
      );
      setGeometryVisible(this.depthGuide);
    } else {
      clearOverlayGeometry(this.depthGuide.geometry);
      this.depthGuide.visible = false;
    }

    const outlineSource = outlinePolygon && outlinePolygon.length >= 2
      ? outlinePolygon.map(toPoint2)
      : corners.map(toPoint2);
    const closeLoop = outlineSource.length >= 4 && (!placing || placementStage >= 2);
    const edges = polygonSegments(outlineSource, closeLoop);
    const resolvedFrontageCount = Math.min(
      Math.max(frontagePointCount, 0),
      outlineSource.length,
    );
    const frontageEdges = resolvedFrontageCount >= 2
      ? edges.slice(0, resolvedFrontageCount - 1)
      : placing && outlineSource.length >= 2
        ? edges
        : [];
    const zoneEdges: TerrainOverlaySegment[] = resolvedFrontageCount >= 2
      ? edges.slice(resolvedFrontageCount - 1)
      : placing
        ? []
        : edges;

    updateTerrainRibbonGeometry(
      this.zoneBorder.geometry,
      zoneEdges,
      getHeightAt,
      {
        width: 0.18,
        lift: BORDER_LIFT,
        sampleSpacing: 0.95,
        dashLength: BORDER_DASH_LENGTH,
        gapLength: BORDER_DASH_GAP,
      },
    );
    setGeometryVisible(this.zoneBorder);

    updateTerrainRibbonGeometry(
      this.frontageBorder.geometry,
      frontageEdges,
      getHeightAt,
      {
        width: 0.24,
        lift: FRONTAGE_LIFT,
        sampleSpacing: 0.9,
        dashLength: BORDER_DASH_LENGTH,
        gapLength: BORDER_DASH_GAP,
      },
    );
    setGeometryVisible(this.frontageBorder);

    if (closeLoop) {
      if (corners.length === 4) {
        updateTerrainQuadGeometry(
          this.zoneFill.geometry,
          corners.map(toPoint2) as [Point2, Point2, Point2, Point2],
          getHeightAt,
          FILL_LIFT,
          9,
          9,
        );
      } else {
        updateTerrainPolygonFanGeometry(
          this.zoneFill.geometry,
          outlineSource,
          getHeightAt,
          FILL_LIFT,
        );
      }
      setGeometryVisible(this.zoneFill);
    } else {
      clearOverlayGeometry(this.zoneFill.geometry);
      this.zoneFill.visible = false;
    }

    const dividerSegments = layout
      ? getParcelDividerSegments(layout).map(
          ([start, end]) => [start, end] as TerrainOverlaySegment,
        )
      : [];
    updateTerrainRibbonGeometry(
      this.dividerLines.geometry,
      dividerSegments,
      getHeightAt,
      {
        width: 0.12,
        lift: DIVIDER_LIFT,
        sampleSpacing: 0.85,
      },
    );
    setGeometryVisible(this.dividerLines);
  }

  clear(): void {
    this.lastGeometrySignature = '';
    this.lastValid = null;
    this.lastPlacing = false;
    this.group.visible = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.visible = false;
    this.hoverMarker.visible = false;
  }

  dispose(): void {
    disposeObject3D(this.group, true);
    this.group.removeFromParent();
    this.group.clear();
  }
}
