import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';

export const ROAD_END_TRIM = 0.5;
/** Length of each road arm covered by a shared node patch, as a width multiplier. */
export const ROAD_JUNCTION_REACH = 0.74;
export type RoadEdgeEnd = 'start' | 'end';

export function getEdgePath(edge: RoadEdge): THREE.Vector3[] {
  const sampled = edge.sampledPath;
  const control = edge.controlPoints;
  if (sampled.length >= 2 && control.length >= 2) {
    return sampled.length >= control.length ? sampled : control;
  }
  if (sampled.length >= 2) return sampled;
  if (control.length >= 2) return control;
  return sampled.length > 0 ? sampled : control;
}

export function inwardDirectionAtNode(edge: RoadEdge, nodeId: string): THREE.Vector3 {
  return inwardDirectionAtEdgeEnd(edge, edge.startNodeId === nodeId ? 'start' : 'end');
}

export function inwardDirectionAtEdgeEnd(edge: RoadEdge, end: RoadEdgeEnd): THREE.Vector3 {
  const path = getEdgePath(edge);
  if (path.length < 2) return new THREE.Vector3(1, 0, 0);
  if (end === 'start') {
    return new THREE.Vector3(path[1].x - path[0].x, 0, path[1].z - path[0].z).normalize();
  }
  const last = path.length - 1;
  return new THREE.Vector3(path[last - 1].x - path[last].x, 0, path[last - 1].z - path[last].z).normalize();
}

export function exteriorDirectionAtNode(edge: RoadEdge, nodeId: string): THREE.Vector3 {
  return inwardDirectionAtNode(edge, nodeId).multiplyScalar(-1);
}

export function exteriorDirectionAtEdgeEnd(edge: RoadEdge, end: RoadEdgeEnd): THREE.Vector3 {
  return inwardDirectionAtEdgeEnd(edge, end).multiplyScalar(-1);
}

export function roadTerminalTrimDistance(width: number): number {
  // Endpoint caps now share the ribbon's terminal vertices instead of living
  // in a separately triangulated overlap. Trim to the cap diameter so the
  // shared seam sits at the node-facing edge of the road fabric.
  return width * ROAD_END_TRIM;
}

export function trimPathAtEndpoint(
  path: THREE.Vector3[],
  nodeId: string,
  edge: RoadEdge,
  width: number,
  trimDistance = roadTerminalTrimDistance(width),
): void {
  if (path.length < 2) return;
  if (edge.startNodeId === nodeId) {
    trimPathStart(path, trimDistance);
    return;
  }
  if (edge.endNodeId === nodeId) {
    trimPathEnd(path, trimDistance);
  }
}

export function roadPerpendicular(direction: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(-direction.z, 0, direction.x).normalize();
}

function trimPathStart(path: THREE.Vector3[], trimDistance: number): void {
  let remaining = Math.max(0, trimDistance);
  for (let index = 1; index < path.length; index++) {
    const segmentLength = distanceXZ(path[index - 1], path[index]);
    if (segmentLength <= 1e-6) continue;
    if (remaining <= segmentLength) {
      const trimmed = path[index - 1].clone().lerp(path[index], remaining / segmentLength);
      path.splice(0, index, trimmed);
      return;
    }
    remaining -= segmentLength;
  }
}

function trimPathEnd(path: THREE.Vector3[], trimDistance: number): void {
  let remaining = Math.max(0, trimDistance);
  for (let index = path.length - 1; index > 0; index--) {
    const segmentLength = distanceXZ(path[index], path[index - 1]);
    if (segmentLength <= 1e-6) continue;
    if (remaining <= segmentLength) {
      const trimmed = path[index].clone().lerp(path[index - 1], remaining / segmentLength);
      path.splice(index, path.length - index, trimmed);
      return;
    }
    remaining -= segmentLength;
  }
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
