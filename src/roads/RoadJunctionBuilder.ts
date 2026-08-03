import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import { RoadNetwork } from './RoadNetwork.ts';
import type { RoadNode } from './RoadNode.ts';
import {
  exteriorDirectionAtEdgeEnd,
  getEdgePath,
  inwardDirectionAtEdgeEnd,
  ROAD_END_TRIM,
  roadPerpendicular,
  type RoadEdgeEnd,
} from './roadEndpoint.ts';

const CORE_Y_OFFSET = 0.12;
const BLEND_Y_OFFSET = 0.16;

export class RoadJunctionBuilder {
  private readonly terrain: Terrain;
  private readonly materials: RoadMaterialFactory;
  constructor(terrain: Terrain, materials: RoadMaterialFactory) {
    this.terrain = terrain;
    this.materials = materials;
  }

  build(network: RoadNetwork): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Road junction and cap patches';
    for (const node of network.nodes.values()) {
      const patch = this.buildNodePatch(node, network);
      if (patch) group.add(patch);
    }
    return group;
  }

  private buildNodePatch(node: RoadNode, network: RoadNetwork): THREE.Group | null {
    const incidents = network.getIncidents(node);
    if (incidents.length === 0) return null;
    const width = averageWidth(incidents.map(({ edge }) => edge));
    const isEndpoint = incidents.length === 1;
    const group = new THREE.Group();
    group.name = `Road ${node.junctionType} ${node.id}`;
    group.userData.nodeId = node.id;

    if (isEndpoint) {
      const { edge, end } = incidents[0];
      const frame = this.endpointFrame(node, edge, end, width);
      const blend = this.buildEndpointBlendCap(frame, width);
      const core = this.buildEndpointCoreCap(frame, width);
      blend.castShadow = false;
      blend.receiveShadow = true;
      core.castShadow = false;
      core.receiveShadow = true;
      blend.renderOrder = 10;
      core.renderOrder = 11;
      group.add(blend, core);
      return group;
    }

    const radius = width * (incidents.length === 2 ? 0.78 : 1.08);
    const blendRadius = radius + width * 0.58;
    const directions = incidents.map(({ edge, end }) => inwardDirectionAtEdgeEnd(edge, end));
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

  private endpointFrame(node: RoadNode, edge: RoadEdge, end: RoadEdgeEnd, width: number): EndpointFrame {
    const inward = inwardDirectionAtEdgeEnd(edge, end);
    const exterior = exteriorDirectionAtEdgeEnd(edge, end);
    const perp = roadPerpendicular(inward);
    const trim = width * ROAD_END_TRIM;
    const mouthCenter = node.position.clone().addScaledVector(inward, trim);
    const path = getEdgePath(edge);
    const roadLength = pathLength(path);
    const textureBaseV = (roadLength - trim) / 5.8;
    return { inward, exterior, perp, mouthCenter, width, textureBaseV };
  }

  private buildEndpointCoreCap(frame: EndpointFrame, width: number): THREE.Mesh {
    const bulge = width * 0.54;
    const ring = this.endpointArcPoints(frame, bulge, 20);
    const boundary = ring;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    this.pushCapVertex(positions, uvs, frame.mouthCenter, CORE_Y_OFFSET, 0.5, frame.textureBaseV);

    for (const point of boundary) {
      const alongInward = point.clone().sub(frame.mouthCenter).dot(frame.inward);
      const alongPerp = point.clone().sub(frame.mouthCenter).dot(frame.perp);
      this.pushCapVertex(
        positions,
        uvs,
        point,
        CORE_Y_OFFSET,
        0.5 + alongPerp / Math.max(1, width),
        frame.textureBaseV + Math.max(0, -alongInward) / 5.8,
      );
    }

    for (let i = 1; i < boundary.length; i++) {
      indices.push(0, i, i + 1);
    }

    return this.createCapMesh(positions, uvs, indices, this.materials.road);
  }

  private buildEndpointBlendCap(frame: EndpointFrame, width: number): THREE.Mesh {
    const half = width * 0.5;
    const coreBulge = width * 0.54;
    const ringScales = [
      { bulge: coreBulge, fadeU: 1 },
      { bulge: coreBulge + width * 0.34, fadeU: 0.52 },
      { bulge: coreBulge + width * 0.68, fadeU: 0.24 },
      { bulge: coreBulge + width * 1.02, fadeU: 0 },
    ];
    const arcCount = 22;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const rings = ringScales.map(({ bulge, fadeU }) => {
      const arc = this.endpointArcPoints(frame, bulge, arcCount);
      const points = arc;
      const startIndex = positions.length / 3;
      for (const point of points) {
        const alongInward = point.clone().sub(frame.mouthCenter).dot(frame.inward);
        this.pushCapVertex(
          positions,
          uvs,
          point,
          BLEND_Y_OFFSET,
          fadeU,
          frame.textureBaseV + Math.max(0, -alongInward) / 5.8,
        );
      }
      return { startIndex, count: points.length };
    });

    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
      const inner = rings[ringIndex];
      const outer = rings[ringIndex + 1];
      for (let i = 0; i < inner.count - 1; i++) {
        const a = inner.startIndex + i;
        const b = inner.startIndex + i + 1;
        const c = outer.startIndex + i + 1;
        const d = outer.startIndex + i;
        indices.push(a, d, b, b, d, c);
      }
    }

    this.addMouthWingBlend(frame, width, half, positions, uvs, indices);

    return this.createCapMesh(positions, uvs, indices, this.materials.roadEdge);
  }

  private addMouthWingBlend(
    frame: EndpointFrame,
    width: number,
    half: number,
    positions: number[],
    uvs: number[],
    indices: number[],
  ): void {
    const wingDepth = width * 0.42;
    const corners = [
      frame.mouthCenter.clone().addScaledVector(frame.perp, half),
      frame.mouthCenter.clone().addScaledVector(frame.perp, -half),
    ];
    const perpSigns = [1, -1];

    for (let i = 0; i < corners.length; i++) {
      const innerPoint = corners[i];
      const perpSign = perpSigns[i];
      const innerEdge = innerPoint.clone().addScaledVector(frame.perp, perpSign * width * 0.1);
      const outerEdge = innerPoint
        .clone()
        .addScaledVector(frame.inward, wingDepth * 0.55)
        .addScaledVector(frame.perp, perpSign * width * 0.24);
      const outerCorner = innerPoint.clone().addScaledVector(frame.inward, wingDepth);

      const base = positions.length / 3;
      this.pushCapVertex(positions, uvs, innerPoint, BLEND_Y_OFFSET, 0.95, frame.textureBaseV);
      this.pushCapVertex(positions, uvs, innerEdge, BLEND_Y_OFFSET, 0.74, frame.textureBaseV + 0.02);
      this.pushCapVertex(positions, uvs, outerEdge, BLEND_Y_OFFSET, 0.2, frame.textureBaseV + (wingDepth * 0.22) / 5.8);
      this.pushCapVertex(positions, uvs, outerCorner, BLEND_Y_OFFSET, 0.03, frame.textureBaseV + wingDepth / 5.8);
      if (perpSign > 0) {
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else {
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }

  private endpointArcPoints(frame: EndpointFrame, bulge: number, arcCount: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= arcCount; i++) {
      const t = i / arcCount;
      const angle = -Math.PI * 0.5 + t * Math.PI;
      const wobble = 1 + Math.sin(i * 2.17 + bulge * 0.08) * 0.06;
      const offset = frame.exterior
        .clone()
        .multiplyScalar(Math.cos(angle) * bulge * wobble)
        .add(frame.perp.clone().multiplyScalar(Math.sin(angle) * bulge * wobble));
      points.push(frame.mouthCenter.clone().add(offset));
    }
    return points;
  }

  private pushCapVertex(
    positions: number[],
    uvs: number[],
    point: THREE.Vector3,
    yOffset: number,
    fadeU: number,
    textureV: number,
  ): void {
    positions.push(point.x, this.terrain.getHeightAt(point.x, point.z) + yOffset, point.z);
    uvs.push(fadeU, textureV);
  }

  private createCapMesh(
    positions: number[],
    uvs: number[],
    indices: number[],
    material: THREE.Material,
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    const vertexCount = positions.length / 3;
    geometry.setAttribute('bridgeBlend', new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
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
    const yOffset = blend ? BLEND_Y_OFFSET : CORE_Y_OFFSET;
    const centerY = this.terrain.getHeightAt(center.x, center.z) + yOffset;
    positions.push(center.x, centerY, center.z);
    uvs.push(blend ? 1 : 0.5, 0.5);

    for (const local of ring) {
      const x = center.x + local.x;
      const z = center.z + local.y;
      positions.push(x, this.terrain.getHeightAt(x, z) + yOffset, z);
      const lateralU = 0.5 + local.y / Math.max(1, width);
      uvs.push(blend ? 0 : lateralU, 0.5 + local.x / Math.max(1, radius * 2.4));
    }

    for (let i = 1; i <= ring.length; i++) {
      const next = i === ring.length ? 1 : i + 1;
      indices.push(0, next, i);
    }

    return this.createCapMesh(positions, uvs, indices, blend ? this.materials.roadEdge : this.materials.road);
  }

  private junctionRing(directions: THREE.Vector3[], radius: number, width: number, blend: boolean): THREE.Vector2[] {
    const sampleCount = Math.max(48, directions.length * 16);
    const halfWidth = width * (blend ? 1.42 : 0.54);
    const hubRadius = width * (blend ? 0.58 : 0.5);
    const points: THREE.Vector2[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const angle = -Math.PI + (i / sampleCount) * Math.PI * 2;
      let ringRadius = hubRadius;
      for (const direction of directions) {
        const directionAngle = Math.atan2(direction.z, direction.x);
        const delta = normalizeAngle(angle - directionAngle);
        const along = Math.cos(delta);
        if (along < -1e-5) continue;
        const across = Math.abs(Math.sin(delta));
        const frontExit = along <= 1e-5 ? Infinity : radius / along;
        const sideExit = across <= 1e-5 ? Infinity : halfWidth / across;
        ringRadius = Math.max(ringRadius, Math.min(frontExit, sideExit));
      }
      points.push(new THREE.Vector2(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius));
    }
    return points;
  }
}

type EndpointFrame = {
  inward: THREE.Vector3;
  exterior: THREE.Vector3;
  perp: THREE.Vector3;
  mouthCenter: THREE.Vector3;
  width: number;
  textureBaseV: number;
};

function averageWidth(edges: RoadEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.width, 0) / Math.max(1, edges.length);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function pathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return length;
}
