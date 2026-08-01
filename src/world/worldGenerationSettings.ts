import { terrainPresetFromSeed, type WorldTerrainPreset } from './worldTerrainPresets.ts';

export const DEFAULT_WORLD_SEED = 0x71a2e0d;

export type WorldMapSize = 'small' | 'medium' | 'large';
export type WorldConflictMode = 'peaceful' | 'frontier';

export type WorldGenerationSettings = {
  seed: number;
  /** Authored terrain recipe encoded into the persisted world seed. */
  terrainPreset: WorldTerrainPreset;
  mapSize: WorldMapSize;
  /** 0 = gentle rolling hills, 100 = rugged highlands */
  topography: number;
  /** 0 = dry with few rivers, 100 = wet with many rivers and valleys */
  hydrology: number;
  /** 0 = open meadows, 100 = dense woodland */
  forestDensity: number;
  /** 0 = lean reserves and fewer rich rolls, 100 = more deposits and better rich-roll odds. */
  resourceAbundance: number;
  /** 0 = extra deposits favor local specialties, 100 = extras spread across resource families. */
  resourceVariety: number;
  /** Peaceful settlements never schedule hostile pressure. */
  conflictMode: WorldConflictMode;
  /** 0 = disabled, 100 = severe frontier pressure. */
  enemyPressure: number;
};

export type WorldDimensions = {
  playableSize: number;
  terrainSize: number;
  playableHalf: number;
};

export const MAP_SIZE_PRESETS: Record<WorldMapSize, WorldDimensions & { label: string }> = {
  small: { playableSize: 620, terrainSize: 817, playableHalf: 310, label: 'Small' },
  medium: { playableSize: 820, terrainSize: 1080, playableHalf: 410, label: 'Medium' },
  large: { playableSize: 1020, terrainSize: 1344, playableHalf: 510, label: 'Large' },
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
};

const STORAGE_KEY = 'medieval-road-system:world-generation';
const TERRAIN_TO_PLAYABLE_RATIO = 1080 / 820;

export function resolveWorldDimensions(mapSize: WorldMapSize): WorldDimensions {
  const preset = MAP_SIZE_PRESETS[mapSize];
  return {
    playableSize: preset.playableSize,
    terrainSize: Math.round(preset.playableSize * TERRAIN_TO_PLAYABLE_RATIO),
    playableHalf: preset.playableSize * 0.5,
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
  const seed = typeof partial.seed === 'number' && Number.isFinite(partial.seed)
    ? partial.seed >>> 0
    : DEFAULT_WORLD_GENERATION_SETTINGS.seed;
  const mapSize = partial.mapSize === 'small' || partial.mapSize === 'large'
    ? partial.mapSize
    : 'medium';
  const conflictMode = partial.conflictMode === 'frontier' ? 'frontier' : 'peaceful';
  return {
    seed,
    terrainPreset: terrainPresetFromSeed(seed),
    mapSize,
    topography: clampPercent(partial.topography ?? DEFAULT_WORLD_GENERATION_SETTINGS.topography),
    hydrology: clampPercent(partial.hydrology ?? DEFAULT_WORLD_GENERATION_SETTINGS.hydrology),
    forestDensity: clampPercent(partial.forestDensity ?? DEFAULT_WORLD_GENERATION_SETTINGS.forestDensity),
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
