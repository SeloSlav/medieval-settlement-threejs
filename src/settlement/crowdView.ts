export type CrowdViewState = {
  centerX: number;
  centerZ: number;
  viewRadius: number;
  /** Camera zoom used by close-range presentation such as worker sound. */
  orbitDistance?: number;
  /** Actual listener position; defaults to the camera target for legacy callers. */
  listenerX?: number;
  listenerZ?: number;
};

export const CROWD_SIM_HZ = 15;
export const CROWD_SIM_DT = 1 / CROWD_SIM_HZ;
export const AGENT_WORK_ANIMATION_DISTANCE = 64;
export const FRUSTUM_SIM_MARGIN = 40;
/**
 * Hard strategic-view cutoff for livestock and wildlife. People deliberately
 * do not share this cutoff: military formations and individual villagers must
 * remain legible through the live-world strategic zoom envelope.
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
  };
  state.centerX = centerX;
  state.centerZ = centerZ;
  state.viewRadius = viewRadius;
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
  const dx = x - view.centerX;
  const dz = z - view.centerZ;
  return dx * dx + dz * dz <= view.viewRadius * view.viewRadius;
}

/**
 * People remain renderable at every supported live-world orbit distance. The
 * spatial view-radius test still limits work to the part of the world around
 * the camera target; only the old all-or-nothing 210 m zoom cutoff is removed.
 */
export function isPeopleRenderingEnabled(
  _view: CrowdViewState | undefined,
): boolean {
  return true;
}

export function isAgentAnimalRenderingEnabled(
  view: CrowdViewState | undefined,
): boolean {
  return view?.orbitDistance === undefined
    || view.orbitDistance <= AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE;
}

/** Spatial crowd culling plus the cheaper livestock/wildlife zoom cutoff. */
export function isWithinAnimalCrowdView(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): boolean {
  return isAgentAnimalRenderingEnabled(view) && isWithinCrowdView(x, z, view);
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
