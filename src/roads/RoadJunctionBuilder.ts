import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import { RoadNetwork } from './RoadNetwork.ts';
import type { RoadNode } from './RoadNode.ts';

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
    const edges = network.getConnectedEdges(node);
    if (edges.length === 0) return null;
    const width = averageWidth(edges);
    const radius = width * (edges.length <= 1 ? 0.9 : edges.length === 2 ? 0.78 : 1.08);
    const directions = edges.map((edge) => directionAwayFromNode(edge, node.id));
    const core = this.buildPatchMesh(node.position, directions, radius, width, false);
    const blend = this.buildPatchMesh(node.position, directions, radius + width * 0.42, width, true);
    const group = new THREE.Group();
    group.name = `Road ${node.junctionType} ${node.id}`;
    group.userData.nodeId = node.id;
    core.renderOrder = 13;
    blend.renderOrder = 12;
    group.add(blend, core);
    return group;
  }

  private buildPatchMesh(center: THREE.Vector3, directions: THREE.Vector3[], radius: number, width: number, blend: boolean): THREE.Mesh {
    const ring = directions.length <= 1
      ? this.capRing(directions[0] ?? new THREE.Vector3(1, 0, 0), radius, blend)
      : this.junctionRing(directions, radius, width, blend);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const centerY = this.terrain.getHeightAt(center.x, center.z) + (blend ? 0.042 : 0.074);
    positions.push(center.x, centerY, center.z);
    uvs.push(0.5, 0.5);

    for (const local of ring) {
      const x = center.x + local.x;
      const z = center.z + local.y;
      positions.push(x, this.terrain.getHeightAt(x, z) + (blend ? 0.04 : 0.078), z);
      uvs.push(0.5 + local.x / Math.max(1, radius * 2.4), 0.5 + local.y / Math.max(1, radius * 2.4));
    }

    for (let i = 1; i <= ring.length; i++) {
      const next = i === ring.length ? 1 : i + 1;
      indices.push(0, i, next);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = blend ? this.materials.roadEdge : this.materials.road;
    return new THREE.Mesh(geometry, material);
  }

  private capRing(direction: THREE.Vector3, radius: number, blend: boolean): THREE.Vector2[] {
    const angle = Math.atan2(direction.z, direction.x);
    const points: THREE.Vector2[] = [];
    const count = 28;
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const wobble = blend ? 1.1 + 0.08 * Math.sin(i * 2.1) : 1 + 0.045 * Math.sin(i * 1.7);
      const rx = Math.cos(t) * radius * wobble;
      const rz = Math.sin(t) * radius * 0.82 * wobble;
      const rotatedX = rx * Math.cos(angle) - rz * Math.sin(angle);
      const rotatedZ = rx * Math.sin(angle) + rz * Math.cos(angle);
      points.push(new THREE.Vector2(rotatedX, rotatedZ));
    }
    return points;
  }

  private junctionRing(directions: THREE.Vector3[], radius: number, width: number, blend: boolean): THREE.Vector2[] {
    const points: Array<{ angle: number; point: THREE.Vector2 }> = [];
    const spread = blend ? 0.62 : 0.49;
    for (let i = 0; i < directions.length; i++) {
      const base = Math.atan2(directions[i].z, directions[i].x);
      for (const offset of [-spread, -spread * 0.35, spread * 0.35, spread]) {
        const angle = base + offset;
        const wobble = 1 + Math.sin((i + 1) * 9.31 + offset * 4.7) * (blend ? 0.12 : 0.06);
        const r = radius + width * (Math.abs(offset) < spread * 0.5 ? 0.28 : 0.05);
        points.push({ angle: normalizeAngle(angle), point: new THREE.Vector2(Math.cos(angle) * r * wobble, Math.sin(angle) * r * wobble) });
      }
    }
    points.sort((a, b) => a.angle - b.angle);
    return points.map((entry) => entry.point);
  }
}

function directionAwayFromNode(edge: RoadEdge, nodeId: string): THREE.Vector3 {
  const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
  if (edge.startNodeId === nodeId) {
    return new THREE.Vector3(path[1].x - path[0].x, 0, path[1].z - path[0].z).normalize();
  }
  const last = path.length - 1;
  return new THREE.Vector3(path[last - 1].x - path[last].x, 0, path[last - 1].z - path[last].z).normalize();
}

function averageWidth(edges: RoadEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.width, 0) / Math.max(1, edges.length);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}


