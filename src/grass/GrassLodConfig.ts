import type { Terrain } from '../terrain/Terrain.ts';
import { dirtZoomGate } from './grassLodMath.ts';

export {
  GRASS_BLADE_CHUNK_SIZE,
  GRASS_BLADE_NEAR_RADIUS,
  GRASS_BLADE_REVEAL,
  grassBladeRevealOpacity,
  isGrassBladeZoomActive,
} from './grassLodMath.ts';

let lastDirtZoomGate = Number.NaN;

/** CPU-side zoom gate (300–400%) written to a terrain vertex attribute. */
export function updateTerrainZoomBlend(terrain: Terrain, cameraDistance: number): void {
  const gate = dirtZoomGate(cameraDistance);
  if (Math.abs(gate - lastDirtZoomGate) < 0.002) return;
  lastDirtZoomGate = gate;
  terrain.setDirtZoomGate(gate);
}
