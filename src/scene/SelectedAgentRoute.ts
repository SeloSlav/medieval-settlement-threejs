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
  line.geometry.setFromPoints(
    route.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
  );
  line.computeLineDistances();
  line.visible = true;
}
