import * as THREE from 'three';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../placement/TerrainOverlayGeometry.ts';
import type { BuildingKind } from '../resources/types.ts';
import { getBuildingRoadConnectionPoints } from '../roads/BuildingRoadConnections.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import { getBuildingFootprintCorners } from './BuildingTerrainLayout.ts';

const PREVIEW_COLORS = {
  valid: 0xfffdf5,
  invalid: 0xff5d50,
} as const;

const FOOTPRINT_FILL_LIFT = 0.105;
const FOOTPRINT_HATCH_LIFT = 0.17;
const FOOTPRINT_HATCH_WIDTH = 0.28;
const FOOTPRINT_HATCH_SPACING = 1.25;
const FOOTPRINT_BORDER_LIFT = 0.145;
const FOOTPRINT_BORDER_WIDTH = 0.34;
const ROAD_ATTACHMENT_LIFT = 0.21;
const ROAD_ATTACHMENT_RADIUS = 1.15;
const ROAD_ATTACHMENT_WIDTH = 0.3;
const ROAD_ATTACHMENT_SEGMENTS = 28;
const GHOST_FILL_OPACITY = 0.1;
const GHOST_OUTLINE_OPACITY = 0.66;
const GHOST_OUTLINE_MIN_SPAN = 0.45;
const GHOST_OUTLINE_MAX_PARTS = 128;
const PREVIEW_RENDER_ORDER = 12;

export function createBuildingPreviewMesh(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Terrain-hugging building footprint';
  group.userData.previewKind = kind;
  group.frustumCulled = false;
  group.renderOrder = PREVIEW_RENDER_ORDER;

  const fill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLORS.valid,
      transparent: true,
      opacity: 0.2,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  fill.name = 'Building footprint fill';
  fill.userData.previewRole = 'fill';
  fill.renderOrder = PREVIEW_RENDER_ORDER;
  fill.frustumCulled = false;
  group.add(fill);

  const hatch = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLORS.valid,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  hatch.name = 'Building footprint diagonal hatch';
  hatch.userData.previewRole = 'hatch';
  hatch.renderOrder = PREVIEW_RENDER_ORDER + 1;
  hatch.frustumCulled = false;
  group.add(hatch);

  const border = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLORS.valid,
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  border.name = 'Building footprint border';
  border.userData.previewRole = 'border';
  border.renderOrder = PREVIEW_RENDER_ORDER + 2;
  border.frustumCulled = false;
  group.add(border);

  const roadAttachments = new THREE.Group();
  roadAttachments.name = 'Building road attachment circles';
  roadAttachments.renderOrder = PREVIEW_RENDER_ORDER + 3;
  for (let index = 0; index < 4; index += 1) {
    const circle = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: PREVIEW_COLORS.valid,
        transparent: true,
        opacity: 0.96,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    circle.name = `Building road attachment circle ${index + 1}`;
    circle.userData.previewRole = 'road-attachment';
    circle.userData.connectionIndex = index;
    circle.renderOrder = PREVIEW_RENDER_ORDER + 3;
    circle.frustumCulled = false;
    roadAttachments.add(circle);
  }
  group.add(roadAttachments);

  group.add(createBuildingGhost(kind));

  return group;
}

export function updateBuildingPreviewGeometry(
  group: THREE.Group,
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
  getHeightAt: (x: number, z: number) => number,
): void {
  const corners = getBuildingFootprintCorners(kind, x, z, yaw);

  const fill = group.getObjectByName('Building footprint fill');
  if (fill instanceof THREE.Mesh) {
    updateTerrainQuadGeometry(
      fill.geometry,
      corners,
      getHeightAt,
      FOOTPRINT_FILL_LIFT,
      7,
      7,
    );
  }

  const hatch = group.getObjectByName('Building footprint diagonal hatch');
  if (hatch instanceof THREE.Mesh) {
    updateTerrainRibbonGeometry(
      hatch.geometry,
      diagonalFootprintSegments(kind, x, z, yaw),
      getHeightAt,
      {
        width: FOOTPRINT_HATCH_WIDTH,
        lift: FOOTPRINT_HATCH_LIFT,
        sampleSpacing: 0.85,
      },
    );
  }

  const border = group.getObjectByName('Building footprint border');
  if (border instanceof THREE.Mesh) {
    updateTerrainRibbonGeometry(
      border.geometry,
      polygonSegments(corners),
      getHeightAt,
      {
        width: FOOTPRINT_BORDER_WIDTH,
        lift: FOOTPRINT_BORDER_LIFT,
        sampleSpacing: 0.95,
      },
    );
  }

  updateRoadAttachmentGeometry(group, kind, x, z, yaw, getHeightAt);

  const ghost = group.getObjectByName('Building placement ghost');
  if (ghost instanceof THREE.Group) {
    ghost.position.set(x, getHeightAt(x, z), z);
    ghost.rotation.y = yaw;
  }
}

export function updateBuildingPreviewAppearance(
  group: THREE.Group,
  valid: boolean,
): void {
  const color = valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    switch (object.userData.previewRole) {
      case 'fill':
        material.color.setHex(color);
        material.opacity = valid ? 0.2 : 0.18;
        break;
      case 'border':
        material.color.setHex(color);
        material.opacity = valid ? 0.94 : 0.98;
        break;
      case 'hatch':
        material.color.setHex(PREVIEW_COLORS.valid);
        material.opacity = 0.8;
        break;
      case 'road-attachment':
        material.color.setHex(PREVIEW_COLORS.valid);
        material.opacity = 0.96;
        break;
      case 'model-ghost':
        material.color.setHex(PREVIEW_COLORS.valid);
        material.opacity = GHOST_FILL_OPACITY;
        break;
    }
  });
}

function diagonalFootprintSegments(
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
): Array<readonly [{ x: number; z: number }, { x: number; z: number }]> {
  const inset = FOOTPRINT_BORDER_WIDTH * 0.72;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const localCorners = getBuildingFootprintCorners(kind, x, z, yaw).map((corner) => {
    const dx = corner.x - x;
    const dz = corner.z - z;
    return {
      x: dx * cos - dz * sin,
      z: dx * sin + dz * cos,
    };
  });
  const minX = Math.min(...localCorners.map((corner) => corner.x)) + inset;
  const maxX = Math.max(...localCorners.map((corner) => corner.x)) - inset;
  const minZ = Math.min(...localCorners.map((corner) => corner.z)) + inset;
  const maxZ = Math.max(...localCorners.map((corner) => corner.z)) - inset;
  const hatchSpacing = Math.max(
    FOOTPRINT_HATCH_SPACING,
    Math.max(maxX - minX, maxZ - minZ) / 28,
  );
  const minOffset = minZ - maxX;
  const maxOffset = maxZ - minX;
  const firstLine = Math.ceil(minOffset / hatchSpacing);
  const lastLine = Math.floor(maxOffset / hatchSpacing);
  const toWorld = (localX: number, localZ: number) => ({
    x: x + localX * cos + localZ * sin,
    z: z - localX * sin + localZ * cos,
  });
  const segments: Array<readonly [{ x: number; z: number }, { x: number; z: number }]> = [];

  // Lines follow local z = local x + offset, then the completed pattern rotates
  // with the building. Clipping in local space keeps every stripe inside the
  // exact oriented footprint instead of approximating it in world space.
  for (let line = firstLine; line <= lastLine; line += 1) {
    const offset = line * hatchSpacing;
    const startX = Math.max(minX, minZ - offset);
    const endX = Math.min(maxX, maxZ - offset);
    if (endX - startX <= 0.08) continue;
    segments.push([
      toWorld(startX, startX + offset),
      toWorld(endX, endX + offset),
    ]);
  }
  return segments;
}

function updateRoadAttachmentGeometry(
  group: THREE.Group,
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
  getHeightAt: (x: number, z: number) => number,
): void {
  const connections = getBuildingRoadConnectionPoints(
    { id: 'placement-preview', kind, x, z, yaw },
    {
      getPointAt: (pointX: number, pointZ: number, offset = 0) => new THREE.Vector3(
        pointX,
        getHeightAt(pointX, pointZ) + offset,
        pointZ,
      ),
    },
  );

  for (const [index, connection] of connections.entries()) {
    const circle = group.getObjectByName(`Building road attachment circle ${index + 1}`);
    if (!(circle instanceof THREE.Mesh)) continue;
    const center = connection.point;
    const points = Array.from({ length: ROAD_ATTACHMENT_SEGMENTS }, (_, segment) => {
      const angle = segment / ROAD_ATTACHMENT_SEGMENTS * Math.PI * 2;
      return {
        x: center.x + Math.cos(angle) * ROAD_ATTACHMENT_RADIUS,
        z: center.z + Math.sin(angle) * ROAD_ATTACHMENT_RADIUS,
      };
    });
    updateTerrainRibbonGeometry(
      circle.geometry,
      polygonSegments(points),
      getHeightAt,
      {
        width: ROAD_ATTACHMENT_WIDTH,
        lift: ROAD_ATTACHMENT_LIFT,
        sampleSpacing: 0.36,
      },
    );
    circle.userData.connectionPoint = [center.x, center.y, center.z];
  }
}

function createBuildingGhost(kind: BuildingKind): THREE.Group {
  const source = createBuildingMesh(kind);
  source.updateMatrixWorld(true);

  const ghost = new THREE.Group();
  ghost.name = 'Building placement ghost';
  ghost.userData.previewRole = 'model-ghost-root';
  ghost.renderOrder = PREVIEW_RENDER_ORDER + 1;
  ghost.frustumCulled = false;

  const geometry = flattenBuildingGhostGeometry(source);

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: PREVIEW_COLORS.valid,
    transparent: true,
    opacity: GHOST_FILL_OPACITY,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: PREVIEW_COLORS.valid,
    transparent: true,
    opacity: GHOST_OUTLINE_OPACITY,
    depthTest: true,
    depthWrite: false,
  });

  const fill = new THREE.Mesh(geometry.surface, fillMaterial);
  fill.name = 'Building placement ghost fill';
  fill.userData.previewRole = 'model-ghost';
  fill.castShadow = false;
  fill.receiveShadow = false;
  fill.renderOrder = PREVIEW_RENDER_ORDER + 1;
  fill.frustumCulled = false;
  ghost.add(fill);

  const outline = new THREE.LineSegments(geometry.outline, outlineMaterial);
  outline.name = 'Building placement ghost outline';
  outline.userData.previewRole = 'model-outline';
  outline.renderOrder = PREVIEW_RENDER_ORDER + 2;
  outline.frustumCulled = false;
  ghost.add(outline);

  return ghost;
}

function flattenBuildingGhostGeometry(source: THREE.Group): {
  surface: THREE.BufferGeometry;
  outline: THREE.BufferGeometry;
} {
  const surfacePositions: number[] = [];
  const outlinePositions: number[] = [];
  const rootInverse = source.matrixWorld.clone().invert();
  const localMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const transformedMatrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const outlineCandidates: Array<{
    geometry: THREE.BufferGeometry;
    matrices: THREE.Matrix4[];
    span: number;
  }> = [];
  const edgeGeometryCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();

  source.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((material) => !material.visible)) return;

    localMatrix.multiplyMatrices(rootInverse, object.matrixWorld);
    const instanceMatrices: THREE.Matrix4[] = [];
    const appendInstance = (matrix: THREE.Matrix4) => {
      appendTrianglePositions(surfacePositions, object.geometry, matrix, point);
      instanceMatrices.push(matrix.clone());
    };

    if (object instanceof THREE.InstancedMesh) {
      for (let instance = 0; instance < object.count; instance += 1) {
        object.getMatrixAt(instance, instanceMatrix);
        transformedMatrix.multiplyMatrices(localMatrix, instanceMatrix);
        appendInstance(transformedMatrix);
      }
    } else {
      appendInstance(localMatrix);
    }

    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    const radius = object.geometry.boundingSphere?.radius ?? 0;
    let maximumScale = 0;
    for (const matrix of instanceMatrices) {
      maximumScale = Math.max(maximumScale, matrix.getMaxScaleOnAxis());
    }
    const span = radius * maximumScale * 2;
    if (Number.isFinite(span) && span >= GHOST_OUTLINE_MIN_SPAN) {
      outlineCandidates.push({
        geometry: object.geometry,
        matrices: instanceMatrices,
        span,
      });
    }
  });

  outlineCandidates.sort((a, b) => b.span - a.span);
  for (const candidate of outlineCandidates.slice(0, GHOST_OUTLINE_MAX_PARTS)) {
    let edges = edgeGeometryCache.get(candidate.geometry);
    if (!edges) {
      edges = new THREE.EdgesGeometry(candidate.geometry, 32);
      edgeGeometryCache.set(candidate.geometry, edges);
    }
    for (const matrix of candidate.matrices) {
      appendLinePositions(outlinePositions, edges, matrix, point);
    }
  }

  for (const edges of edgeGeometryCache.values()) edges.dispose();
  return {
    surface: geometryFromPositions(surfacePositions),
    outline: geometryFromPositions(outlinePositions),
  };
}

function appendTrianglePositions(
  target: number[],
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  point: THREE.Vector3,
): void {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute || position instanceof THREE.InterleavedBufferAttribute)) {
    return;
  }
  const index = geometry.getIndex();
  const count = index?.count ?? position.count;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const positionIndex = index ? index.getX(vertex) : vertex;
    point.fromBufferAttribute(position, positionIndex).applyMatrix4(matrix);
    target.push(point.x, point.y, point.z);
  }
}

function appendLinePositions(
  target: number[],
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  point: THREE.Vector3,
): void {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute || position instanceof THREE.InterleavedBufferAttribute)) {
    return;
  }
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
    target.push(point.x, point.y, point.z);
  }
}

function geometryFromPositions(positions: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

export function disposeBuildingPreviewMesh(group: THREE.Group): void {
  disposeObject3D(group, true);
}
