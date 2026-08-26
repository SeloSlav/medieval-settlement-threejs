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
  BRIDGE_DECK_TEXTURE_METERS_PER_TILE,
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
    const textureFrame = junctionTextureFrame(incidents);
    const bridgeSurface = this.bridgeSurfaceAtNode(incidents);
    if (bridgeSurface) {
      const surfaceY = bridgeSurface.y + BRIDGE_JUNCTION_LIFT;
      const core = this.buildBridgeJunctionCore(
        node.position,
        directions,
        width,
        surfaceY,
        bridgeSurface.blend,
        textureFrame,
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
    const core = this.buildJunctionPatchMesh(
      node.position,
      directions,
      radius,
      width,
      false,
      textureFrame,
    );
    const blend = this.buildJunctionPatchMesh(
      node.position,
      directions,
      blendRadius,
      width,
      true,
      textureFrame,
    );
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
    edgeFades?: number[],
    bridgeUvs: number[] = uvs,
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('bridgeUv', new THREE.Float32BufferAttribute(bridgeUvs, 2));
    const vertexCount = positions.length / 3;
    geometry.setAttribute(
      'bridgeBlend',
      new THREE.BufferAttribute(new Float32Array(vertexCount).fill(bridgeBlend), 1),
    );
    if (edgeFades) {
      geometry.setAttribute('edgeFade', new THREE.Float32BufferAttribute(edgeFades, 1));
    }
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
    textureFrame: JunctionTextureFrame,
  ): THREE.Mesh {
    const ring = this.junctionRing(directions, radius, width, blend);
    const positions: number[] = [];
    const uvs: number[] = [];
    const edgeFades: number[] = [];
    const indices: number[] = [];
    const yOffset = blend
      ? ROAD_VISUAL_SHOULDER_Y_OFFSET
      : ROAD_VISUAL_CORE_Y_OFFSET;
    const centerY = this.terrain.getHeightAt(center.x, center.z) + yOffset;
    positions.push(center.x, centerY, center.z);
    uvs.push(0.5, textureFrame.phaseV);
    if (blend) edgeFades.push(1);

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
        const along = localX * textureFrame.direction.x + localZ * textureFrame.direction.z;
        const lateral = localX * textureFrame.perpendicular.x
          + localZ * textureFrame.perpendicular.z;
        uvs.push(
          0.5 - lateral / Math.max(1, width),
          textureFrame.phaseV + along / 5.8,
        );
        if (blend) edgeFades.push(1 - radialFraction);
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
      0,
      blend ? edgeFades : undefined,
    );
    mesh.userData.junctionBoundary = ring.map((point) => [point.x, point.y]);
    mesh.userData.junctionRadialRingCount = radialRingCount;
    mesh.userData.junctionBlend = blend;
    mesh.userData.junctionTextureDirection = [
      textureFrame.direction.x,
      textureFrame.direction.z,
    ];
    mesh.userData.junctionTexturePhaseV = textureFrame.phaseV;
    mesh.userData.junctionTextureEdgeId = textureFrame.edgeId;
    return mesh;
  }

  private buildBridgeJunctionCore(
    center: THREE.Vector3,
    directions: THREE.Vector3[],
    width: number,
    surfaceY: number,
    bridgeBlend: number,
    textureFrame: JunctionTextureFrame,
  ): THREE.Mesh {
    const halfWidth = width * 0.5;
    const reach = width * ROAD_JUNCTION_REACH;
    const contour = junctionContour(
      directions,
      halfWidth,
      reach,
      BRIDGE_JUNCTION_SEGMENTS,
    );
    const positions: number[] = [center.x, surfaceY, center.z];
    const uvs: number[] = [0.5, textureFrame.phaseV];
    const bridgePhaseV = textureFrame.phaseV * 5.8
      / BRIDGE_DECK_TEXTURE_METERS_PER_TILE;
    const bridgeRepeatsAcross = width / BRIDGE_DECK_TEXTURE_METERS_PER_TILE;
    const bridgeUvs: number[] = [bridgeRepeatsAcross * 0.5, bridgePhaseV];
    const indices: number[] = [];

    for (const local of contour) {
      const along = local.x * textureFrame.direction.x + local.y * textureFrame.direction.z;
      const lateral = local.x * textureFrame.perpendicular.x
        + local.y * textureFrame.perpendicular.z;
      positions.push(center.x + local.x, surfaceY, center.z + local.y);
      uvs.push(0.5 - lateral / width, textureFrame.phaseV + along / 5.8);
      bridgeUvs.push(
        bridgeRepeatsAcross * 0.5
          - lateral / BRIDGE_DECK_TEXTURE_METERS_PER_TILE,
        bridgePhaseV + along / BRIDGE_DECK_TEXTURE_METERS_PER_TILE,
      );
    }
    for (let index = 0; index < contour.length; index++) {
      const current = index + 1;
      const next = (index + 1) % contour.length + 1;
      indices.push(0, next, current);
    }
    const mesh = this.createCapMesh(
      positions,
      uvs,
      indices,
      this.materials.road,
      bridgeBlend,
      undefined,
      bridgeUvs,
    );
    mesh.userData.bridgeTextureMetersPerTile = BRIDGE_DECK_TEXTURE_METERS_PER_TILE;
    mesh.userData.junctionTextureDirection = [
      textureFrame.direction.x,
      textureFrame.direction.z,
    ];
    mesh.userData.junctionTexturePhaseV = textureFrame.phaseV;
    mesh.userData.junctionTextureEdgeId = textureFrame.edgeId;
    return mesh;
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
    // A round stroke join must be at least as wide as the incident strip.
    // Using a smaller fallback radius makes the contour snap inward as soon
    // as a polar ray passes behind an arm, exposing a triangular terrain bite
    // on the outside of obtuse bends.
    const hubRadius = halfWidth;
    return stripUnionContour(directions, hubRadius, halfWidth, radius, sampleCount);
  }
}

type JunctionBridgeSurface = {
  blend: number;
  y: number;
};

type JunctionTextureFrame = {
  direction: THREE.Vector3;
  perpendicular: THREE.Vector3;
  phaseV: number;
  edgeId: string;
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

function junctionTextureFrame(incidents: readonly RoadIncident[]): JunctionTextureFrame {
  const candidates = incidents.map((incident) => ({
    ...incident,
    outward: inwardDirectionAtEdgeEnd(incident.edge, incident.end),
  })).filter(({ outward }) => outward.lengthSq() > 1e-6);

  let dominant = candidates[0];
  let dominantSupport = -Infinity;
  for (const candidate of candidates) {
    // Axial support makes the through-road win at a T junction. Length then
    // chooses one actual arm at ordinary bends instead of inventing a bisector
    // orientation that stamps a conspicuous texture knot into the hub.
    const support = candidates.reduce(
      (sum, other) => sum + Math.abs(candidate.outward.dot(other.outward)),
      0,
    );
    const candidateLength = Number.isFinite(candidate.edge.length) ? candidate.edge.length : 0;
    const dominantLength = dominant && Number.isFinite(dominant.edge.length)
      ? dominant.edge.length
      : 0;
    const candidateKey = `${candidate.edge.id}:${candidate.end}`;
    const dominantKey = dominant ? `${dominant.edge.id}:${dominant.end}` : '';
    if (
      support > dominantSupport + 1e-6
      || (
        Math.abs(support - dominantSupport) <= 1e-6
        && (
          candidateLength > dominantLength + 1e-6
          || (
            Math.abs(candidateLength - dominantLength) <= 1e-6
            && candidateKey < dominantKey
          )
        )
      )
    ) {
      dominant = candidate;
      dominantSupport = support;
    }
  }

  if (!dominant) {
    const direction = new THREE.Vector3(1, 0, 0);
    return {
      direction,
      perpendicular: roadPerpendicular(direction),
      phaseV: 0,
      edgeId: '',
    };
  }

  const direction = dominant.outward.clone();
  if (dominant.end === 'end') direction.multiplyScalar(-1);
  direction.setY(0).normalize();
  return {
    direction,
    perpendicular: roadPerpendicular(direction),
    phaseV: dominant.end === 'start' ? 0 : dominant.edge.length / 5.8,
    edgeId: dominant.edge.id,
  };
}

function averageWidth(edges: RoadEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.width, 0) / Math.max(1, edges.length);
}

function positiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
