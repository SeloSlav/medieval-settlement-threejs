import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import type { WorldDimensions } from '../world/worldGenerationSettings.ts';

export type RegionalFlatlandPreset = 'gomirje_meadows' | 'mrkopalj_polje';

export type RegionalFlatlandTerrainFields = {
  drainageGrade: number;
  meadowUndulation: number;
  lowTerrace: number;
  waterBankBlend: number;
  height: number;
};

export const GOMIRJE_HYDRAULIC_GRADE = 0.0012;
export const FLATLAND_BANK_TO_WATER_DROP = 0.8;

// World-space metres -> meadow undulation / low terrace -> shared hydraulic
// bank datum -> terrain, placement, shoreline and material normals. The small
// surface band is 70 m wide, well above production heightfield cell sizes.
// No edge-distance term: the visible map is a crop of the open field floor.
const MEADOW_PROFILE = {
  broadWavelength: 240,
  broadHeight: 1.1,
  surfaceWavelength: 70,
  surfaceHeight: 0.16,
  terraceHeight: 1.3,
};

export function flatlandBankDatum(preset: RegionalFlatlandPreset, x: number): number {
  return preset === 'gomirje_meadows' ? -x * GOMIRJE_HYDRAULIC_GRADE : 0;
}

/** Exposes the controlling fields for deterministic height/slope diagnostics. */
export function sampleRegionalFlatlandTerrainFields(
  x: number,
  z: number,
  preset: RegionalFlatlandPreset,
  seed: number,
  relief: number,
  dimensions: WorldDimensions,
  layout: RiverLayout | null,
): RegionalFlatlandTerrainFields {
  const drainageGrade = flatlandBankDatum(preset, x);
  const meadowUndulation = (
    meadowNoise(x / MEADOW_PROFILE.broadWavelength, z / MEADOW_PROFILE.broadWavelength, seed)
      * MEADOW_PROFILE.broadHeight
    + meadowNoise(x / MEADOW_PROFILE.surfaceWavelength, z / MEADOW_PROFILE.surfaceWavelength, seed ^ 0x7117)
      * MEADOW_PROFILE.surfaceHeight
  ) * relief;
  const lowTerrace = preset === 'gomirje_meadows'
    ? smoothstep(-0.05, 0.9, z / dimensions.playableHalf) * MEADOW_PROFILE.terraceHeight
    : 0;
  let waterBankBlend = 0;
  if (preset === 'gomirje_meadows') {
    const channel = layout?.sampleChannel(x, z);
    if (channel) {
      waterBankBlend = 1 - smoothstep(0.72, 0.94, channel.distance / channel.halfWidth);
    }
  } else {
    for (const pond of layout?.inlandWaterBodies ?? []) {
      // A flat shelf extends beyond the entire organic pond shoreline. This
      // keeps the standing surface horizontal even when the meadow seed varies.
      const radius = Math.max(pond.radiusX, pond.radiusZ);
      waterBankBlend = Math.max(waterBankBlend,
        1 - smoothstep(radius * 1.15, radius * 1.8, Math.hypot(x - pond.x, z - pond.z)));
    }
  }
  return {
    drainageGrade,
    meadowUndulation,
    lowTerrace,
    waterBankBlend,
    height: drainageGrade + (meadowUndulation + lowTerrace) * (1 - waterBankBlend),
  };
}

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function meadowNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = smoothstep(0, 1, x - ix);
  const tz = smoothstep(0, 1, z - iz);
  const a = hashF64(seed, ix, iz);
  const b = hashF64(seed, ix + 1, iz);
  const c = hashF64(seed, ix, iz + 1);
  const d = hashF64(seed, ix + 1, iz + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz - 0.5;
}
