import type {
  WorldGenerationSettings,
  WorldMapSize,
} from './worldGenerationSettings.ts';

export type WorldTerrainPreset =
  | 'kupa_valley'
  | 'risnjak_pass'
  | 'delnice_meadow'
  | 'vinodol_coast'
  | 'lic_polje'
  | 'custom';

export type WorldTerrainPresetDefinition = {
  id: WorldTerrainPreset;
  name: string;
  region: string;
  description: string;
  features: readonly string[];
  topography: number;
  hydrology: number;
  forestDensity: number;
  minMapSize: WorldMapSize;
};

const PRESET_SEED_MASK = 0xfff0_0000;
const PRESET_VARIATION_MASK = 0x000f_ffff;
const CUSTOM_SEED_FALLBACK_XOR = 0x4d3a_91e7;

const PRESET_SEED_SIGNATURES = {
  kupa_valley: 0x6b70_0000,
  risnjak_pass: 0x7150_0000,
  delnice_meadow: 0x4310_0000,
  vinodol_coast: 0x5600_0000,
  lic_polje: 0x4c10_0000,
} as const satisfies Record<Exclude<WorldTerrainPreset, 'custom'>, number>;

export const WORLD_TERRAIN_PRESETS: readonly WorldTerrainPresetDefinition[] = [
  {
    id: 'kupa_valley',
    name: 'Kupa Valley',
    region: 'Gusti Laz · Gorski Kotar',
    description:
      'Wide river valley with a broad village bench and wooded mountain walls.',
    features: ['25–35 m river', 'Broad valley floor', '500+ m valley sides'],
    topography: 78,
    hydrology: 58,
    forestDensity: 70,
    minMapSize: 'medium',
  },
  {
    id: 'risnjak_pass',
    name: 'Risnjak Pass',
    region: 'Risnjak · Gorski Kotar',
    description:
      'Rugged forest saddle with streams and a sheltered upland meadow.',
    features: ['High mountain saddle', 'Headwater streams', 'Dense fir and beech'],
    topography: 92,
    hydrology: 46,
    forestDensity: 84,
    minMapSize: 'small',
  },
  {
    id: 'delnice_meadow',
    name: 'Delnice',
    region: 'Delnice · Gorski Kotar',
    description:
      'Open upland meadow with a fish pond and mountain-ringed forest.',
    features: ['Open meadow floor', 'Spring-fed fish pond', 'Mountain ring'],
    topography: 76,
    hydrology: 0,
    forestDensity: 30,
    minMapSize: 'small',
  },
  {
    id: 'vinodol_coast',
    name: 'Vinodol Coast',
    region: 'Vinodol · Primorje',
    description:
      'Buildable Adriatic coast beneath a limestone ridge.',
    features: ['One-fifth sea', 'Coastal settlement shelf', 'Karst ridge'],
    topography: 68,
    hydrology: 38,
    forestDensity: 45,
    minMapSize: 'medium',
  },
  // Lič is documented as a settled Frankapan possession by 1477, but the old
  // village was abandoned through much of the 16th century after Ottoman
  // incursions. This profile therefore represents a frontier founding site,
  // not an already thriving 1550 settlement.
  // https://hrcak.srce.hr/file/364048
  {
    id: 'lic_polje',
    name: 'Ličko Polje',
    region: 'Lič · Gorski Kotar',
    description:
      'High karst grazing field with a stream that vanishes into a ponor.',
    features: ['Disappearing stream', 'Open grazing basin', 'Karst mountain ring'],
    topography: 84,
    hydrology: 34,
    forestDensity: 42,
    minMapSize: 'small',
  },
  {
    id: 'custom',
    name: 'Custom Map',
    region: '',
    description:
      'Shape the terrain, waterways, and woodland.',
    features: ['Mountain-scale relief', 'Adjustable waterways', 'Adjustable woodland'],
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
    minMapSize: 'small',
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

const MAP_SIZE_RANK: Record<WorldMapSize, number> = {
  small: 0,
  medium: 1,
  large: 2,
};

export function isTerrainPresetAvailableForMapSize(
  preset: WorldTerrainPreset,
  mapSize: WorldMapSize,
): boolean {
  return MAP_SIZE_RANK[mapSize] >= MAP_SIZE_RANK[getWorldTerrainPreset(preset).minMapSize];
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
