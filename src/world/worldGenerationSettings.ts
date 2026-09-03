import {
  getWorldTerrainPreset,
  isTerrainPresetAvailableForMapSize,
  seedForTerrainPreset,
  terrainPresetFromSeed,
  type WorldTerrainPreset,
} from './worldTerrainPresets.ts';

export const DEFAULT_WORLD_SEED = 0x71a2e0d;

export type WorldMapSize = 'small' | 'medium' | 'large';
export type WorldConflictMode = 'peaceful' | 'frontier';
export type WorldDifficultyRate = 0 | 100 | 150;
export type WorldInitialGoodsMultiplier = 1 | 2;
/** 0 = equipment only, 1 = light rations, 2 = full upkeep. */
export type WorldMilitaryDemands = 0 | 1 | 2;

export type WorldGenerationSettings = {
  seed: number;
  /** Authored terrain recipe encoded into the persisted world seed. */
  terrainPreset: WorldTerrainPreset;
  mapSize: WorldMapSize;
  /** 0 = gentle rolling hills, 100 = mountain-scale massifs */
  topography: number;
  /** 0 = dry with few rivers, 100 = wet with many rivers and valleys */
  hydrology: number;
  /** 0 = open meadows, 100 = dense woodland */
  forestDensity: number;
  /** 0 = fewer bonus wild-food rolls and leaner yields, 100 = more; total and rich budgets come from size. */
  resourceAbundance: number;
  /** 0 = extra deposits favor local specialties, 100 = extras spread across resource families. */
  resourceVariety: number;
  /** Peaceful settlements never schedule hostile pressure. */
  conflictMode: WorldConflictMode;
  /** 0 = disabled, 100 = severe frontier pressure. */
  enemyPressure: number;
  /** Enables independent physical bandit camps and theft patrols. */
  banditCampsEnabled: boolean;
  /** Enables infrequent fox incursions and coordinated wolf-pack attacks. */
  wildAnimalAttacksEnabled: boolean;
  /** Enables ambient fires, lightning ignition, fire spread, and summer droughts. */
  severeWeatherEnabled: boolean;
  /** Makes well groundwater vary by location instead of using one reliable score at every site. */
  wellAquiferNetworksEnabled: boolean;
  /** Passive approval-loss pace as a percentage of the standard rate. */
  approvalDeclineRate: WorldDifficultyRate;
  /** Fresh and preserved food-loss pace as a percentage of the standard rate. */
  foodSpoilageRate: WorldDifficultyRate;
  /** Goods placed in the original founders' camp. Later camps are unaffected. */
  initialGoodsMultiplier: WorldInitialGoodsMultiplier;
  /** Supplies and wages demanded by local non-militia companies. */
  militaryDemands: WorldMilitaryDemands;
};

export type WorldDimensions = {
  /** Full player-accessible width of the rendered heightfield. */
  playableSize: number;
  terrainSize: number;
  playableHalf: number;
  /** Original authored scale used to keep terrain and resource layouts stable. */
  generationSize: number;
  generationHalf: number;
};

const SMALL_PLAYABLE_SIZE = 817;
const SMALL_GENERATION_SIZE = 620;
const LARGE_SIDE_SCALE = Math.sqrt(8);

export const MAP_SIZE_PRESETS: Record<WorldMapSize, WorldDimensions & {
  label: string;
  smallMapAreas: number;
}> = {
  small: {
    playableSize: SMALL_PLAYABLE_SIZE,
    terrainSize: SMALL_PLAYABLE_SIZE,
    playableHalf: SMALL_PLAYABLE_SIZE * 0.5,
    generationSize: SMALL_GENERATION_SIZE,
    generationHalf: SMALL_GENERATION_SIZE * 0.5,
    label: 'Small',
    smallMapAreas: 1,
  },
  medium: {
    playableSize: SMALL_PLAYABLE_SIZE * 2,
    terrainSize: SMALL_PLAYABLE_SIZE * 2,
    playableHalf: SMALL_PLAYABLE_SIZE,
    generationSize: SMALL_GENERATION_SIZE * 2,
    generationHalf: SMALL_GENERATION_SIZE,
    label: 'Medium',
    smallMapAreas: 4,
  },
  large: {
    playableSize: SMALL_PLAYABLE_SIZE * LARGE_SIDE_SCALE,
    terrainSize: SMALL_PLAYABLE_SIZE * LARGE_SIDE_SCALE,
    playableHalf: SMALL_PLAYABLE_SIZE * LARGE_SIDE_SCALE * 0.5,
    generationSize: SMALL_GENERATION_SIZE * LARGE_SIDE_SCALE,
    generationHalf: SMALL_GENERATION_SIZE * LARGE_SIDE_SCALE * 0.5,
    label: 'Large',
    smallMapAreas: 8,
  },
};

export const DEFAULT_WORLD_GENERATION_SETTINGS: WorldGenerationSettings = {
  seed: DEFAULT_WORLD_SEED,
  terrainPreset: terrainPresetFromSeed(DEFAULT_WORLD_SEED),
  mapSize: 'medium',
  topography: 50,
  hydrology: 50,
  forestDensity: 50,
  resourceAbundance: 50,
  resourceVariety: 50,
  conflictMode: 'peaceful',
  enemyPressure: 0,
  banditCampsEnabled: true,
  wildAnimalAttacksEnabled: true,
  severeWeatherEnabled: false,
  wellAquiferNetworksEnabled: false,
  approvalDeclineRate: 100,
  foodSpoilageRate: 100,
  initialGoodsMultiplier: 1,
  militaryDemands: 1,
};

const STORAGE_KEY = 'medieval-road-system:world-generation';
export function resolveWorldDimensions(mapSize: WorldMapSize): WorldDimensions {
  const preset = MAP_SIZE_PRESETS[mapSize];
  return {
    playableSize: preset.playableSize,
    terrainSize: preset.terrainSize,
    playableHalf: preset.playableHalf,
    generationSize: preset.generationSize,
    generationHalf: preset.generationHalf,
  };
}

export function deriveSubSeed(seed: number, tag: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < tag.length; i++) {
    hash = Math.imul(hash ^ tag.charCodeAt(i), 0x5bd1e995);
    hash = (hash >>> 13) ^ hash;
  }
  return hash >>> 0;
}

export function topographyScale(topography: number): number {
  const t = clampPercent(topography) / 100;
  return 0.55 + t * 0.9;
}

export function forestDensityScale(forestDensity: number): number {
  const t = clampPercent(forestDensity) / 100;
  return 0.45 + t * 1.1;
}

export function hydrologyRiverCount(hydrology: number): number {
  const t = clampPercent(hydrology) / 100;
  return Math.round(2 + t * 4);
}

export function hydrologyTributaryCount(hydrology: number): number {
  const value = clampPercent(hydrology);
  if (value < 25) return 0;
  if (value < 60) return 1;
  if (value < 85) return 2;
  return 3;
}

export function hydrologyScoreScale(hydrology: number): number {
  const t = clampPercent(hydrology) / 100;
  return 0.65 + t * 0.7;
}

export function scaledRiverDrain(playableHalf: number): { x: number; z: number } {
  return { x: 0, z: -playableHalf * 0.215 };
}

export function randomWorldSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] >>> 0;
}

export function formatSeedHex(seed: number): string {
  return `0x${(seed >>> 0).toString(16)}`;
}

export function parseSeedHex(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed >>> 0 : null;
}

export function normalizeWorldGenerationSettings(
  partial: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  const requestedSeed = typeof partial.seed === 'number' && Number.isFinite(partial.seed)
    ? partial.seed >>> 0
    : DEFAULT_WORLD_GENERATION_SETTINGS.seed;
  const mapSize = partial.mapSize === 'small' || partial.mapSize === 'large'
    ? partial.mapSize
    : 'medium';
  const requestedTerrainPreset = terrainPresetFromSeed(requestedSeed);
  const terrainPreset = isTerrainPresetAvailableForMapSize(requestedTerrainPreset, mapSize)
    ? requestedTerrainPreset
    : 'delnice_meadow';
  const seed = terrainPreset === requestedTerrainPreset
    ? requestedSeed
    : seedForTerrainPreset(requestedSeed, terrainPreset);
  const fallbackTerrain = terrainPreset === requestedTerrainPreset
    ? null
    : getWorldTerrainPreset(terrainPreset);
  const conflictMode = partial.conflictMode === 'frontier' ? 'frontier' : 'peaceful';
  return {
    seed,
    terrainPreset,
    mapSize,
    topography: clampPercent(
      fallbackTerrain?.topography
        ?? partial.topography
        ?? DEFAULT_WORLD_GENERATION_SETTINGS.topography,
    ),
    hydrology: clampPercent(
      fallbackTerrain?.hydrology
        ?? partial.hydrology
        ?? DEFAULT_WORLD_GENERATION_SETTINGS.hydrology,
    ),
    forestDensity: clampPercent(
      fallbackTerrain?.forestDensity
        ?? partial.forestDensity
        ?? DEFAULT_WORLD_GENERATION_SETTINGS.forestDensity,
    ),
    resourceAbundance: clampPercent(
      partial.resourceAbundance ?? DEFAULT_WORLD_GENERATION_SETTINGS.resourceAbundance,
    ),
    resourceVariety: clampPercent(
      partial.resourceVariety ?? DEFAULT_WORLD_GENERATION_SETTINGS.resourceVariety,
    ),
    conflictMode,
    enemyPressure: conflictMode === 'frontier'
      ? Math.max(1, clampPercent(partial.enemyPressure ?? 50))
      : 0,
    banditCampsEnabled: partial.banditCampsEnabled !== false,
    wildAnimalAttacksEnabled: partial.wildAnimalAttacksEnabled !== false,
    severeWeatherEnabled: partial.severeWeatherEnabled === true,
    wellAquiferNetworksEnabled: partial.wellAquiferNetworksEnabled === true,
    approvalDeclineRate: normalizeWorldDifficultyRate(partial.approvalDeclineRate),
    foodSpoilageRate: normalizeWorldDifficultyRate(partial.foodSpoilageRate),
    initialGoodsMultiplier: normalizeInitialGoodsMultiplier(partial.initialGoodsMultiplier),
    militaryDemands: normalizeMilitaryDemands(partial.militaryDemands),
  };
}

export function loadStoredWorldGenerationSettings(): WorldGenerationSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorldGenerationSettings>;
    return normalizeWorldGenerationSettings(parsed);
  } catch {
    return null;
  }
}

export function saveWorldGenerationSettings(settings: WorldGenerationSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeWorldGenerationSettings(settings)));
  } catch {
    // Private browsing or blocked storage.
  }
}

export function clearStoredWorldGenerationSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function shouldShowWorldSetup(): boolean {
  if (new URLSearchParams(window.location.search).has('new')) {
    return true;
  }
  return loadStoredWorldGenerationSettings() === null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeWorldDifficultyRate(value: number | undefined): WorldDifficultyRate {
  return value === 0 || value === 150 ? value : 100;
}

export function normalizeInitialGoodsMultiplier(
  value: number | undefined,
): WorldInitialGoodsMultiplier {
  return value === 2 ? 2 : 1;
}

export function normalizeMilitaryDemands(
  value: number | undefined,
): WorldMilitaryDemands {
  return value === 0 || value === 2 ? value : 1;
}
