import type { WorldGenerationSettings } from './worldGenerationSettings.ts';

export type WorldTerrainPreset = 'kupa_valley' | 'risnjak_pass' | 'vinodol_coast' | 'custom';

export type WorldTerrainPresetDefinition = {
  id: WorldTerrainPreset;
  name: string;
  region: string;
  description: string;
  features: readonly string[];
  topography: number;
  hydrology: number;
  forestDensity: number;
};

const PRESET_SEED_MASK = 0xfff0_0000;
const PRESET_VARIATION_MASK = 0x000f_ffff;
const CUSTOM_SEED_FALLBACK_XOR = 0x4d3a_91e7;

const PRESET_SEED_SIGNATURES = {
  kupa_valley: 0x6b70_0000,
  risnjak_pass: 0x7150_0000,
  vinodol_coast: 0x5600_0000,
} as const satisfies Record<Exclude<WorldTerrainPreset, 'custom'>, number>;

export const WORLD_TERRAIN_PRESETS: readonly WorldTerrainPresetDefinition[] = [
  {
    id: 'kupa_valley',
    name: 'Kupa Valley',
    region: 'Gusti Laz · Gorski Kotar',
    description:
      'A Kupa-sized river runs through a broad village bench, enclosed by steep wooded slopes.',
    features: ['25–35 m river', 'Broad valley floor', 'Steep forested sides'],
    topography: 78,
    hydrology: 58,
    forestDensity: 70,
  },
  {
    id: 'risnjak_pass',
    name: 'Risnjak Pass',
    region: 'Risnjak · Gorski Kotar',
    description:
      'A high forest saddle with rugged ridgelines, headwater streams, and a sheltered upland meadow.',
    features: ['High mountain saddle', 'Headwater streams', 'Dense fir and beech'],
    topography: 92,
    hydrology: 46,
    forestDensity: 84,
  },
  {
    id: 'vinodol_coast',
    name: 'Vinodol Coast',
    region: 'Vinodol · Primorje',
    description:
      'The Adriatic covers one edge of the map, backed by buildable coastal ground and a limestone ridge.',
    features: ['One-fifth sea', 'Coastal settlement shelf', 'Karst ridge'],
    topography: 68,
    hydrology: 38,
    forestDensity: 45,
  },
  {
    id: 'custom',
    name: 'Custom Map',
    region: '',
    description:
      'Shape a procedural regional landscape yourself with the topography, water, and woodland controls.',
    features: ['Adjustable relief', 'Adjustable waterways', 'Adjustable woodland'],
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
  },
] as const;

const PRESETS_BY_ID = Object.fromEntries(
  WORLD_TERRAIN_PRESETS.map((preset) => [preset.id, preset]),
) as Record<WorldTerrainPreset, WorldTerrainPresetDefinition>;

export function getWorldTerrainPreset(
  preset: WorldTerrainPreset,
): WorldTerrainPresetDefinition {
  return PRESETS_BY_ID[preset];
}

/**
 * The authoritative server already persists the world seed. A small namespace
 * in that seed records the terrain recipe, while the remaining twenty bits
 * still provide more than a million variations of each authored profile.
 */
export function terrainPresetFromSeed(seed: number): WorldTerrainPreset {
  const signature = (seed >>> 0) & PRESET_SEED_MASK;
  for (const [preset, expected] of Object.entries(PRESET_SEED_SIGNATURES)) {
    if (signature === expected) return preset as Exclude<WorldTerrainPreset, 'custom'>;
  }
  return 'custom';
}

export function seedForTerrainPreset(seed: number, preset: WorldTerrainPreset): number {
  const normalized = seed >>> 0;
  if (preset === 'custom') {
    if (terrainPresetFromSeed(normalized) === 'custom') return normalized;
    const candidate = (normalized ^ CUSTOM_SEED_FALLBACK_XOR) >>> 0;
    return terrainPresetFromSeed(candidate) === 'custom'
      ? candidate
      : (candidate & PRESET_VARIATION_MASK) >>> 0;
  }
  return (PRESET_SEED_SIGNATURES[preset] | (normalized & PRESET_VARIATION_MASK)) >>> 0;
}

export function applyTerrainPreset(
  settings: WorldGenerationSettings,
  preset: WorldTerrainPreset,
): WorldGenerationSettings {
  const definition = getWorldTerrainPreset(preset);
  const next = {
    ...settings,
    seed: seedForTerrainPreset(settings.seed, preset),
    terrainPreset: preset,
  };
  if (preset === 'custom') return next;
  return {
    ...next,
    topography: definition.topography,
    hydrology: definition.hydrology,
    forestDensity: definition.forestDensity,
  };
}
