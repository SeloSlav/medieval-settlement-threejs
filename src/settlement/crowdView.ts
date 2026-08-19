export type CrowdViewState = {
  centerX: number;
  centerZ: number;
  viewRadius: number;
  shadowRadius: number;
  /** Camera zoom used by close-range presentation such as worker sound. */
  orbitDistance?: number;
  /** Actual listener position; defaults to the camera target for legacy callers. */
  listenerX?: number;
  listenerZ?: number;
};

export const CROWD_SIM_HZ = 15;
export const CROWD_SIM_DT = 1 / CROWD_SIM_HZ;
export const AGENT_SHADOW_DISTANCE = 80;
export const AGENT_WORK_ANIMATION_DISTANCE = 64;
export const FRUSTUM_SIM_MARGIN = 40;
/**
 * Hard strategic-view cutoff for people and animals. At the default 240 m RTS
 * orbit they are sub-pixel details, so keeping their rigs and instances out of
 * the render entirely is both cleaner and substantially cheaper.
 */
export const AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE = 210;

export function buildCrowdViewState(
  centerX: number,
  centerZ: number,
  orbitDistance: number,
  listenerX = centerX,
  listenerZ = centerZ,
  target?: CrowdViewState,
): CrowdViewState {
  const viewRadius = Math.max(120, orbitDistance * 1.35 + FRUSTUM_SIM_MARGIN);
  const state = target ?? {
    centerX: 0,
    centerZ: 0,
    viewRadius: 0,
    shadowRadius: AGENT_SHADOW_DISTANCE,
  };
  state.centerX = centerX;
  state.centerZ = centerZ;
  state.viewRadius = viewRadius;
  state.shadowRadius = AGENT_SHADOW_DISTANCE;
  state.orbitDistance = orbitDistance;
  state.listenerX = listenerX;
  state.listenerZ = listenerZ;
  return state;
}

export function isWithinCrowdView(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): boolean {
  if (!view) return true;
  if (!isAgentAnimalRenderingEnabled(view)) return false;
  const dx = x - view.centerX;
  const dz = z - view.centerZ;
  return dx * dx + dz * dz <= view.viewRadius * view.viewRadius;
}

export function isAgentAnimalRenderingEnabled(
  view: CrowdViewState | undefined,
): boolean {
  return view?.orbitDistance === undefined
    || view.orbitDistance <= AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE;
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

export function isWithinWorkAnimationRange(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): boolean {
  if (!view) return true;
  const dx = x - view.centerX;
  const dz = z - view.centerZ;
  return dx * dx + dz * dz
    <= AGENT_WORK_ANIMATION_DISTANCE * AGENT_WORK_ANIMATION_DISTANCE;
}
