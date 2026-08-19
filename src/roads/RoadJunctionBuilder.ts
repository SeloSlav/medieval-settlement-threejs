import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import { RoadNetwork, type RoadIncident } from './RoadNetwork.ts';
import type { RoadNode } from './RoadNode.ts';
import {
  BRIDGE_RAILING_EDGE_INSET,
  BRIDGE_RAILING_START_BLEND,
  buildBridgeJunctionRailings,
} from './BridgeRailings.ts';
import { bridgeBlendAtDistance } from './RiverBridgeSpans.ts';
import {
  ROAD_VISUAL_CORE_Y_OFFSET,
  ROAD_VISUAL_SHOULDER_Y_OFFSET,
  roadCoreMaximumHalfWidth,
  roadVisualWidth,
} from './roadDimensions.ts';
import {
  inwardDirectionAtEdgeEnd,
  ROAD_JUNCTION_REACH,
  roadPerpendicular,
} from './roadEndpoint.ts';

const BRIDGE_JUNCTION_LIFT = 0.014;
const BRIDGE_MOUTH_TOLERANCE = 0.14;
const BRIDGE_JUNCTION_SEGMENTS = 64;
/** Prevent broad junction triangles from cutting through terrain between samples. */
const DRY_JUNCTION_RADIAL_SAMPLE_SPACING = 0.72;
/** Keeps the opaque patch beyond the largest possible irregular road edge. */
const DRY_JUNCTION_COVERAGE_MARGIN_RATIO = 0.035;

export class RoadJunctionBuilder {
  private readonly terrain: Terrain;
  private readonly materials: RoadMaterialFactory;
  constructor(terrain: Terrain, materials: RoadMaterialFactory) {
    this.terrain = terrain;
    this.materials = materials;
  }

  build(network: RoadNetwork): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Road junction patches';
    for (const node of network.nodes.values()) {
      const patch = this.buildNodePatch(node, network);
      if (patch) group.add(patch);
    }
    return group;
  }

  private buildNodePatch(node: RoadNode, network: RoadNetwork): THREE.Group | null {
    const incidents = network.getIncidents(node);
    if (incidents.length === 0) return null;
    const logicalWidth = averageWidth(incidents.map(({ edge }) => edge));
    const width = roadVisualWidth(logicalWidth);
    const isEndpoint = incidents.length === 1;
    // Dead-end caps are compiled into each edge's core and shoulder meshes so
    // their vertices, terrain samples, normals, and UV phase are continuous.
    if (isEndpoint) return null;
    const group = new THREE.Group();
    group.name = `Road ${node.junctionType} ${node.id}`;
    group.userData.nodeId = node.id;
    group.userData.logicalWidth = logicalWidth;
    group.userData.visualWidth = width;

    const directions = uniqueDirections(
      incidents.map(({ edge, end }) => inwardDirectionAtEdgeEnd(edge, end)),
    );
    if (directions.length === 0) return null;
    const bridgeSurface = this.bridgeSurfaceAtNode(incidents);
    if (bridgeSurface) {
      const surfaceY = bridgeSurface.y + BRIDGE_JUNCTION_LIFT;
      const core = this.buildBridgeJunctionCore(
        node.position,
        directions,
        width,
        surfaceY,
        bridgeSurface.blend,
      );
      core.name = `Bridge junction deck ${node.id}`;
      core.userData.nodeId = node.id;
      core.userData.fpNoCollision = true;
      core.castShadow = false;
      core.receiveShadow = true;
      core.renderOrder = 15;
      group.userData.bridgeJunction = true;
      group.add(core);

      // A four-way bridge hub has no safely fenceable corner: perimeter runs
      // visually and physically pinch the two crossing routes at the center.
      // The incident arm railings are already trimmed back to the hub edge, so
      // leave cross/higher-degree junction decks fully open.
      if (directions.length < 4) {
        const railingPaths = this.bridgeJunctionRailingPaths(
          node.position,
          directions,
          width,
          surfaceY,
        );
        const railings = buildBridgeJunctionRailings(
          railingPaths,
          this.materials.bridgeSupport,
        );
        if (railings) {
          railings.userData.nodeId = node.id;
          group.add(railings);
        }
      }
      return group;
    }

    const radius = width * (incidents.length === 2 ? 0.78 : 1.08);
    const blendRadius = radius + width * 0.58;
    const core = this.buildJunctionPatchMesh(node.position, directions, radius, width, false);
    const blend = this.buildJunctionPatchMesh(node.position, directions, blendRadius, width, true);
    blend.castShadow = false;
    blend.receiveShadow = true;
    core.castShadow = false;
    core.receiveShadow = true;
    core.renderOrder = 11;
    blend.renderOrder = 10;
    group.add(blend, core);
    return group;
  }

  private bridgeSurfaceAtNode(
    incidents: RoadIncident[],
  ): JunctionBridgeSurface | null {
    let bridgeBlend = 0;
    let deckY = -Infinity;
    for (const { edge, end } of incidents) {
      const spans = edge.materialData?.bridgeSpans ?? [];
      if (spans.length === 0) continue;
      const distance = end === 'start' ? 0 : edge.length;
      const blend = bridgeBlendAtDistance(distance, spans);
      if (blend <= BRIDGE_RAILING_START_BLEND) continue;

      const surfacePath = edge.surfacePath;
      const endpoint = surfacePath?.[end === 'start' ? 0 : surfacePath.length - 1];
      if (!endpoint) continue;
      bridgeBlend = Math.max(bridgeBlend, blend);
      deckY = Math.max(deckY, endpoint.y);
    }
    return Number.isFinite(deckY) ? { blend: bridgeBlend, y: deckY } : null;
  }

  private createCapMesh(
    positions: number[],
    uvs: number[],
    indices: number[],
    material: THREE.Material,
    bridgeBlend = 0,
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    const vertexCount = positions.length / 3;
    geometry.setAttribute(
      'bridgeBlend',
      new THREE.BufferAttribute(new Float32Array(vertexCount).fill(bridgeBlend), 1),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildJunctionPatchMesh(
    center: THREE.Vector3,
    directions: THREE.Vector3[],
    radius: number,
    width: number,
    blend: boolean,
  ): THREE.Mesh {
    const ring = this.junctionRing(directions, radius, width, blend);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const yOffset = blend
      ? ROAD_VISUAL_SHOULDER_Y_OFFSET
      : ROAD_VISUAL_CORE_Y_OFFSET;
    const centerY = this.terrain.getHeightAt(center.x, center.z) + yOffset;
    positions.push(center.x, centerY, center.z);
    uvs.push(blend ? 1 : 0.5, 0.5);

    const radialRingCount = Math.max(
      1,
      Math.ceil(
        ring.reduce((maximum, local) => Math.max(maximum, local.length()), 0)
          / DRY_JUNCTION_RADIAL_SAMPLE_SPACING,
      ),
    );
    for (let radialIndex = 1; radialIndex <= radialRingCount; radialIndex++) {
      const radialFraction = radialIndex / radialRingCount;
      for (const boundary of ring) {
        const localX = boundary.x * radialFraction;
        const localZ = boundary.y * radialFraction;
        const x = center.x + localX;
        const z = center.z + localZ;
        positions.push(x, this.terrain.getHeightAt(x, z) + yOffset, z);
        const lateralU = 0.5 + localZ / Math.max(1, width);
        uvs.push(
          blend ? 1 - radialFraction : lateralU,
          0.5 + localX / Math.max(1, radius * 2.4),
        );
      }
    }

    for (let angularIndex = 0; angularIndex < ring.length; angularIndex++) {
      const next = (angularIndex + 1) % ring.length;
      indices.push(0, 1 + next, 1 + angularIndex);
    }
    for (let radialIndex = 1; radialIndex < radialRingCount; radialIndex++) {
      const innerStart = 1 + (radialIndex - 1) * ring.length;
      const outerStart = innerStart + ring.length;
      for (let angularIndex = 0; angularIndex < ring.length; angularIndex++) {
        const next = (angularIndex + 1) % ring.length;
        const innerCurrent = innerStart + angularIndex;
        const innerNext = innerStart + next;
        const outerCurrent = outerStart + angularIndex;
        const outerNext = outerStart + next;
        indices.push(
          innerCurrent,
          innerNext,
          outerCurrent,
          outerCurrent,
          innerNext,
          outerNext,
        );
      }
    }

    const mesh = this.createCapMesh(
      positions,
      uvs,
      indices,
      blend ? this.materials.roadEdge : this.materials.road,
    );
    mesh.userData.junctionBoundary = ring.map((point) => [point.x, point.y]);
    mesh.userData.junctionRadialRingCount = radialRingCount;
    mesh.userData.junctionBlend = blend;
    return mesh;
  }

  private buildBridgeJunctionCore(
    center: THREE.Vector3,
    directions: THREE.Vector3[],
    width: number,
    surfaceY: number,
    bridgeBlend: number,
  ): THREE.Mesh {
    const halfWidth = width * 0.5;
    const reach = width * ROAD_JUNCTION_REACH;
    const contour = junctionContour(
      directions,
      halfWidth,
      reach,
      BRIDGE_JUNCTION_SEGMENTS,
    );
    const textureDirection = junctionTextureDirection(directions);
    const texturePerp = roadPerpendicular(textureDirection);
    const positions: number[] = [center.x, surfaceY, center.z];
    const uvs: number[] = [0.5, 0.5];
    const indices: number[] = [];

    for (const local of contour) {
      const along = local.x * textureDirection.x + local.y * textureDirection.z;
      const lateral = local.x * texturePerp.x + local.y * texturePerp.z;
      positions.push(center.x + local.x, surfaceY, center.z + local.y);
      uvs.push(0.5 + lateral / width, 0.5 + along / 5.8);
    }
    for (let index = 0; index < contour.length; index++) {
      const current = index + 1;
      const next = (index + 1) % contour.length + 1;
      indices.push(0, next, current);
    }
    return this.createCapMesh(
      positions,
      uvs,
      indices,
      this.materials.road,
      bridgeBlend,
    );
  }

  private bridgeJunctionRailingPaths(
    center: THREE.Vector3,
    directions: readonly THREE.Vector3[],
    width: number,
    deckY: number,
  ): THREE.Vector3[][] {
    const radius = Math.max(
      width * 0.22,
      width * 0.5 - BRIDGE_RAILING_EDGE_INSET,
    );
    const reach = width * ROAD_JUNCTION_REACH;
    const contour = junctionContour(
      [...directions],
      radius,
      reach,
      BRIDGE_JUNCTION_SEGMENTS,
    );
    if (contour.length < 2) return [];

    const railSegments = contour.map((point, index) => {
      const next = contour[(index + 1) % contour.length];
      return !isBridgeMouthSegment(point, next, directions, reach);
    });
    const firstOpening = railSegments.findIndex((active) => !active);
    if (firstOpening < 0) return [];

    const paths: THREE.Vector3[][] = [];
    let current: THREE.Vector3[] = [];
    for (let step = 1; step <= contour.length; step++) {
      const index = (firstOpening + step) % contour.length;
      if (railSegments[index]) {
        if (current.length === 0) {
          current.push(toJunctionWorldPoint(contour[index], center, deckY));
        }
        current.push(toJunctionWorldPoint(
          contour[(index + 1) % contour.length],
          center,
          deckY,
        ));
        continue;
      }
      if (current.length >= 2) paths.push(current);
      current = [];
    }
    if (current.length >= 2) paths.push(current);
    return paths;
  }

  private junctionRing(directions: THREE.Vector3[], radius: number, width: number, blend: boolean): THREE.Vector2[] {
    const sampleCount = Math.max(72, directions.length * 28);
    const halfWidth = blend
      ? width * 1.42
      : roadCoreMaximumHalfWidth(width) + width * DRY_JUNCTION_COVERAGE_MARGIN_RATIO;
    const hubRadius = width * (blend ? 0.58 : 0.5);
    return stripUnionContour(directions, hubRadius, halfWidth, radius, sampleCount);
  }
}

type JunctionBridgeSurface = {
  blend: number;
  y: number;
};

function isBridgeMouthSegment(
  start: THREE.Vector2,
  end: THREE.Vector2,
  directions: readonly THREE.Vector3[],
  reach: number,
): boolean {
  const midX = (start.x + end.x) * 0.5;
  const midZ = (start.y + end.y) * 0.5;
  return directions.some((direction) => (
    midX * direction.x + midZ * direction.z >= reach - BRIDGE_MOUTH_TOLERANCE
  ));
}

function toJunctionWorldPoint(
  local: THREE.Vector2,
  center: THREE.Vector3,
  surfaceY: number,
): THREE.Vector3 {
  return new THREE.Vector3(center.x + local.x, surfaceY, center.z + local.y);
}

/** Star-shaped outline of a round hub plus short road-strip stubs. */
export function junctionContour(
  directions: THREE.Vector3[],
  radius: number,
  reach: number,
  segments = BRIDGE_JUNCTION_SEGMENTS,
): THREE.Vector2[] {
  return stripUnionContour(directions, radius, radius, reach, segments);
}

/**
 * Star-shaped union of a round hub and its incident rectangular road mouths.
 *
 * Uniform polar samples alone chord inward when a mouth is rotated between
 * sample angles. Include every side and front corner explicitly so the patch
 * cannot leave a terrain wedge between itself and an irregular road ribbon.
 */
function stripUnionContour(
  directions: readonly THREE.Vector3[],
  hubRadius: number,
  halfWidth: number,
  reach: number,
  segments: number,
): THREE.Vector2[] {
  const angles = junctionContourAngles(directions, halfWidth, reach, segments);
  return angles.map((angle) => {
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    let radialExtent = hubRadius;
    for (const direction of directions) {
      const along = ux * direction.x + uz * direction.z;
      if (along < -1e-5) continue;
      const lateral = Math.abs(ux * direction.z - uz * direction.x);
      const widthExtent = lateral <= 1e-4 ? Infinity : halfWidth / lateral;
      const reachExtent = along <= 1e-5 ? Infinity : reach / along;
      radialExtent = Math.max(radialExtent, Math.min(widthExtent, reachExtent));
    }
    return new THREE.Vector2(ux * radialExtent, uz * radialExtent);
  });
}

function junctionContourAngles(
  directions: readonly THREE.Vector3[],
  halfWidth: number,
  reach: number,
  segments: number,
): number[] {
  const angles: number[] = [];
  const pushAngle = (angle: number): void => {
    const normalized = positiveAngle(angle);
    if (angles.some((candidate) => Math.abs(candidate - normalized) < 1e-7)) return;
    angles.push(normalized);
  };

  for (let index = 0; index < segments; index++) {
    pushAngle(index / segments * Math.PI * 2);
  }
  for (const direction of directions) {
    const directionAngle = Math.atan2(direction.z, direction.x);
    pushAngle(directionAngle - Math.PI * 0.5);
    pushAngle(directionAngle + Math.PI * 0.5);
    const perpendicularX = -direction.z;
    const perpendicularZ = direction.x;
    for (const side of [-1, 1]) {
      pushAngle(Math.atan2(
        direction.z * reach + perpendicularZ * halfWidth * side,
        direction.x * reach + perpendicularX * halfWidth * side,
      ));
    }
  }
  return angles.sort((a, b) => a - b);
}

function uniqueDirections(directions: THREE.Vector3[]): THREE.Vector3[] {
  const unique: THREE.Vector3[] = [];
  for (const direction of directions) {
    if (direction.lengthSq() < 1e-6) continue;
    direction.y = 0;
    direction.normalize();
    if (unique.some((candidate) => candidate.dot(direction) > 0.9995)) continue;
    unique.push(direction);
  }
  return unique;
}

function junctionTextureDirection(directions: THREE.Vector3[]): THREE.Vector3 {
  const sum = directions.reduce(
    (result, direction) => result.add(direction),
    new THREE.Vector3(),
  );
  if (sum.lengthSq() > 0.05) return sum.setY(0).normalize();
  return directions[0]?.clone().setY(0).normalize() ?? new THREE.Vector3(1, 0, 0);
}

function averageWidth(edges: RoadEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.width, 0) / Math.max(1, edges.length);
}

function positiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
