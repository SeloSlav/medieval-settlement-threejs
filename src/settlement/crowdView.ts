export type CrowdViewState = {
  centerX: number;
  centerZ: number;
  viewRadius: number;
  shadowRadius: number;
};

export const CROWD_SIM_HZ = 15;
export const CROWD_SIM_DT = 1 / CROWD_SIM_HZ;
export const AGENT_SHADOW_DISTANCE = 80;
export const FRUSTUM_SIM_MARGIN = 40;

export function buildCrowdViewState(
  centerX: number,
  centerZ: number,
  orbitDistance: number,
): CrowdViewState {
  const viewRadius = Math.max(120, orbitDistance * 1.35 + FRUSTUM_SIM_MARGIN);
  return {
    centerX,
    centerZ,
    viewRadius,
    shadowRadius: AGENT_SHADOW_DISTANCE,
  };
}

export function isWithinCrowdView(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): boolean {
  if (!view) return true;
  const dx = x - view.centerX;
  const dz = z - view.centerZ;
  return dx * dx + dz * dz <= view.viewRadius * view.viewRadius;
}

export function isWithinShadowRange(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): boolean {
  if (!view) return true;
  const dx = x - view.centerX;
  const dz = z - view.centerZ;
  return dx * dx + dz * dz <= view.shadowRadius * view.shadowRadius;
}
