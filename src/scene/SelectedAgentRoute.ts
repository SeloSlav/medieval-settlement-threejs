import * as THREE from 'three';

export const SELECTED_AGENT_ROUTE_COLOR = 0xff5ea8;
export const SELECTED_AGENT_ROUTE_Y_OFFSET = 0.24;

export type SelectedAgentRoutePoint = {
  x: number;
  y: number;
  z: number;
};

export type SelectedAgentRoute = THREE.Line<
  THREE.BufferGeometry,
  THREE.LineDashedMaterial
>;

type SelectedAgentRouteBuffers = {
  capacity: number;
  position: THREE.BufferAttribute;
  lineDistance: THREE.BufferAttribute;
};

const routeBuffers = new WeakMap<SelectedAgentRoute, SelectedAgentRouteBuffers>();

export function createSelectedAgentRoute(name: string): SelectedAgentRoute {
  const material = new THREE.LineDashedMaterial({
    color: SELECTED_AGENT_ROUTE_COLOR,
    dashSize: 1.1,
    gapSize: 0.72,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry(), material);
  line.name = name;
  line.renderOrder = 14;
  line.visible = false;
  line.frustumCulled = false;
  return line;
}

export function updateSelectedAgentRoute(
  line: SelectedAgentRoute,
  route: readonly SelectedAgentRoutePoint[],
): void {
  if (route.length < 2) {
    line.visible = false;
    return;
  }

  const buffers = ensureRouteCapacity(line, route.length);
  const positions = buffers.position.array as Float32Array;
  const distances = buffers.lineDistance.array as Float32Array;
  let lineDistance = 0;
  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    if (index > 0) {
      const previousOffset = offset - 3;
      const dx = positions[offset] - positions[previousOffset];
      const dy = positions[offset + 1] - positions[previousOffset + 1];
      const dz = positions[offset + 2] - positions[previousOffset + 2];
      lineDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    distances[index] = lineDistance;
  }
  buffers.position.needsUpdate = true;
  buffers.lineDistance.needsUpdate = true;
  line.geometry.setDrawRange(0, route.length);
  line.visible = true;
}

function ensureRouteCapacity(
  line: SelectedAgentRoute,
  required: number,
): SelectedAgentRouteBuffers {
  const existing = routeBuffers.get(line);
  if (existing && existing.capacity >= required) return existing;

  let capacity = Math.max(2, existing?.capacity ?? 0);
  while (capacity < required) capacity *= 2;
  // Three.js does not automatically release WebGL buffers when attributes are
  // replaced. Capacity growth is rare, but disposing the geometry first keeps
  // the old position/distance buffers from surviving until renderer teardown.
  if (existing) line.geometry.dispose();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const lineDistance = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    .setUsage(THREE.DynamicDrawUsage);
  line.geometry.setAttribute('position', position);
  line.geometry.setAttribute('lineDistance', lineDistance);
  const buffers = { capacity, position, lineDistance };
  routeBuffers.set(line, buffers);
  return buffers;
}
