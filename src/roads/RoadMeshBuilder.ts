import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';

export class RoadMeshBuilder {
  private readonly terrain: Terrain;
  private readonly materials: RoadMaterialFactory;
  constructor(terrain: Terrain, materials: RoadMaterialFactory) {
    this.terrain = terrain;
    this.materials = materials;
  }

  buildEdge(edge: RoadEdge): THREE.Group {
    const sampled = this.sampleEdge(edge);
    edge.sampledPath = sampled;
    edge.length = pathLength(sampled);

    const group = new THREE.Group();
    group.name = `Road edge ${edge.id}`;
    group.userData.edgeId = edge.id;

    const core = this.buildRibbon(sampled, edge.width, this.materials.road, 0.055, edge.id, true);
    core.name = `Road core ${edge.id}`;
    core.userData.edgeId = edge.id;
    core.castShadow = false;
    core.receiveShadow = true;
    core.renderOrder = 11;
    group.add(core);

    const edgeBlend = this.buildEdgeBlend(sampled, edge.width, edge.id);
    edgeBlend.name = `Road edge blend ${edge.id}`;
    edgeBlend.userData.edgeId = edge.id;
    edgeBlend.renderOrder = 10;
    group.add(edgeBlend);
    edge.mesh = group;
    return group;
  }

  buildPreview(points: THREE.Vector3[], width: number, valid: boolean): THREE.Mesh | null {
    const sampled = this.samplePoints(points, 1.25);
    if (sampled.length < 2) return null;
    return this.buildRibbon(sampled, width, valid ? this.materials.previewValid : this.materials.previewInvalid, 0.13, 'preview', false);
  }

  buildSelection(edge: RoadEdge): THREE.Mesh | null {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) return null;
    const mesh = this.buildRibbon(path, edge.width + 0.9, this.materials.selection, 0.18, `${edge.id}-selection`, false);
    mesh.renderOrder = 20;
    return mesh;
  }

  private sampleEdge(edge: RoadEdge): THREE.Vector3[] {
    return this.samplePoints(edge.controlPoints, 1.15);
  }

  private samplePoints(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
    if (points.length < 2) return [];
    const length = pathLength(points);
    const curvatureBoost = estimateCurvature(points) * 8;
    const divisions = THREE.MathUtils.clamp(Math.ceil(length / spacing + curvatureBoost), 8, 240);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const sampled: THREE.Vector3[] = [];
    for (let i = 0; i <= divisions; i++) {
      const p = curve.getPoint(i / divisions);
      sampled.push(this.terrain.getPointAt(p.x, p.z, 0));
    }
    return sampled;
  }

  private buildRibbon(
    path: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    yOffset: number,
    seed: string,
    irregular: boolean
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const half = width * 0.5;

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAt(path, i);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const jitter = irregular ? edgeJitter(seed, i, 0) * 0.22 : 0;
      const left = path[i].clone().addScaledVector(normal, half + jitter);
      const right = path[i].clone().addScaledVector(normal, -half + edgeJitter(seed, i, 1) * (irregular ? 0.22 : 0));
      left.y = this.terrain.getHeightAt(left.x, left.z) + yOffset;
      right.y = this.terrain.getHeightAt(right.x, right.z) + yOffset;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, distances[i] / 5.8, 1, distances[i] / 5.8);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildEdgeBlend(path: THREE.Vector3[], width: number, seed: string): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const half = width * 0.5;
    const shoulder = width * 0.38;

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAt(path, i);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const leftJitter = edgeJitter(seed, i, 2) * 0.42;
      const rightJitter = edgeJitter(seed, i, 3) * 0.42;
      const leftOuter = path[i].clone().addScaledVector(normal, half + shoulder + leftJitter);
      const leftInner = path[i].clone().addScaledVector(normal, half - 0.08 + leftJitter * 0.35);
      const rightInner = path[i].clone().addScaledVector(normal, -half + 0.08 + rightJitter * 0.35);
      const rightOuter = path[i].clone().addScaledVector(normal, -half - shoulder + rightJitter);
      for (const p of [leftOuter, leftInner, rightInner, rightOuter]) {
        p.y = this.terrain.getHeightAt(p.x, p.z) + 0.036;
        positions.push(p.x, p.y, p.z);
      }
      const v = distances[i] / 5.8;
      uvs.push(0, v, 1, v, 1, v, 0, v);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 4;
      indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
      indices.push(a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.materials.roadEdge);
  }
}

function tangentAt(path: THREE.Vector3[], index: number): THREE.Vector3 {
  const prev = path[Math.max(0, index - 1)];
  const next = path[Math.min(path.length - 1, index + 1)];
  const tangent = new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z);
  if (tangent.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
  return tangent.normalize();
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) result.push(result[i - 1] + path[i - 1].distanceTo(path[i]));
  return result;
}

function pathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return length;
}

function estimateCurvature(points: THREE.Vector3[]): number {
  let curvature = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = new THREE.Vector2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z).normalize();
    const b = new THREE.Vector2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z).normalize();
    curvature += Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  }
  return curvature;
}

function edgeJitter(seed: string, index: number, side: number): number {
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.sin(index * 1.734 + side * 11.91 + seedValue * 0.137) * 0.65 + Math.sin(index * 0.431 + seedValue) * 0.35;
}

