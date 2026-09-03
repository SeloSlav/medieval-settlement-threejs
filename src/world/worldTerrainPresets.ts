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
  | 'gomirje_meadows'
  | 'mrkopalj_polje'
  | 'custom';

export type WorldTerrainPresetDefinition = {
  id: WorldTerrainPreset;
  name: string;
  region: string;
  description: string;
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
  gomirje_meadows: 0x4740_0000,
  mrkopalj_polje: 0x4d50_0000,
} as const satisfies Record<Exclude<WorldTerrainPreset, 'custom'>, number>;

export const SMALL_MAP_FALLBACK_TERRAIN_PRESET = 'mrkopalj_polje' as const;

export const WORLD_TERRAIN_PRESETS: readonly WorldTerrainPresetDefinition[] = [
  // These profiles frame the fields themselves, keeping the surrounding
  // regional mountains outside the playable footprint.
  // Gomirje's field has the Dobra along its northern side:
  // https://dizbi.hazu.hr/d17b118n/main/k/g1/63k/kg163kiol22r.pdf
  {
    id: 'gomirje_meadows',
    name: 'Gomirje Meadows',
    region: 'Dobra · Gorski Kotar',
    description:
      'Flat riverside fields with a gently winding Dobra and low grassy banks.',
    topography: 12,
    hydrology: 40,
    forestDensity: 32,
    minMapSize: 'small',
  },
  // Mrkopalj occupies Mrko polje and is documented from 1477. The modest
  // pastoral pond is an authored gameplay feature, not a named historic lake.
  // https://www.enciklopedija.hr/clanak/mrkopalj
  // https://mrkopalj.hr/o-mrkoplju/
  {
    id: 'mrkopalj_polje',
    name: 'Mrkopaljsko Polje',
    region: 'Mrkopalj · Gorski Kotar',
    description:
      'Level upland pasture with one small fish pond and scattered woodland.',
    topography: 8,
    hydrology: 0,
    forestDensity: 28,
    minMapSize: 'small',
  },
  {
    id: 'kupa_valley',
    name: 'Kupa Valley',
    region: 'Gusti Laz · Gorski Kotar',
    description:
      'Wide river valley with a broad village bench and wooded mountain walls.',
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
    topography: 92,
    hydrology: 46,
    forestDensity: 84,
    minMapSize: 'medium',
  },
  {
    id: 'delnice_meadow',
    name: 'Delnice',
    region: 'Delnice · Gorski Kotar',
    description:
      'Open upland meadow with a fish pond and mountain-ringed forest.',
    topography: 76,
    hydrology: 0,
    forestDensity: 30,
    minMapSize: 'medium',
  },
  {
    id: 'vinodol_coast',
    name: 'Vinodol Coast',
    region: 'Vinodol · Primorje',
    description:
      'Buildable Adriatic coast beneath a limestone ridge.',
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
    topography: 84,
    hydrology: 34,
    forestDensity: 42,
    minMapSize: 'medium',
  },
  {
    id: 'custom',
    name: 'Custom Map',
    region: '',
    description:
      'Shape the terrain, waterways, and woodland.',
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
