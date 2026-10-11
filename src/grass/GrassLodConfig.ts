import type { Terrain } from '../terrain/Terrain.ts';
import { resolveCloseGroundLod } from './grassLodMath.ts';

export {
  GRASS_BLADE_CHUNK_SIZE,
  GRASS_BLADE_NEAR_RADIUS,
  GRASS_BLADE_REVEAL,
  grassBladeRevealOpacity,
  isGrassBladeZoomActive,
  resolveCloseGroundLod,
} from './grassLodMath.ts';

const dirtZoomGates = new WeakMap<Terrain, number>();

/** CPU-side brown-soil zoom gate (200–650%) written to a terrain vertex attribute. */
export function updateTerrainZoomBlend(
  terrain: Terrain,
  cameraDistance: number,
  firstPersonActive = false,
): void {
  const { dirtGate } = resolveCloseGroundLod(cameraDistance, firstPersonActive);
  if (Math.abs(dirtGate - (dirtZoomGates.get(terrain) ?? Number.NaN)) < 0.002) return;
  dirtZoomGates.set(terrain, dirtGate);
  terrain.setDirtZoomGate(dirtGate);
}
