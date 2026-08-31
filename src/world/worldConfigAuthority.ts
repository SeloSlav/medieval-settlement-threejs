import type { WorldConfig } from '../generated/types.ts';
import {
  normalizeInitialGoodsMultiplier,
  normalizeMilitaryDemands,
  normalizeWorldDifficultyRate,
  normalizeWorldGenerationSettings,
  type WorldGenerationSettings,
  type WorldMapSize,
} from './worldGenerationSettings.ts';

export type AuthoritativeWorldGeneration = WorldGenerationSettings & {
  configured: boolean;
};

export class WorldGenerationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldGenerationMismatchError';
  }
}

export const MAP_SIZE_CODES = {
  small: 0,
  medium: 1,
  large: 2,
} as const satisfies Record<WorldMapSize, number>;

export const MAP_SIZE_BY_CODE: Record<number, WorldMapSize> = {
  0: 'small',
  1: 'medium',
  2: 'large',
};

export function encodeMapSize(mapSize: WorldMapSize): number {
  return MAP_SIZE_CODES[mapSize];
}

export function decodeMapSize(code: number): WorldMapSize {
  return MAP_SIZE_BY_CODE[code] ?? 'medium';
}

export function worldConfigRowToGeneration(row: WorldConfig): AuthoritativeWorldGeneration {
  return {
    ...normalizeWorldGenerationSettings({
      seed: Number(row.seed),
      mapSize: decodeMapSize(row.mapSize),
      topography: row.topography,
      hydrology: row.hydrology,
      forestDensity: row.forestDensity,
      resourceAbundance: row.resourceAbundance,
      resourceVariety: row.resourceVariety,
      conflictMode: row.conflictEnabled ? 'frontier' : 'peaceful',
      enemyPressure: row.enemyPressure,
      banditCampsEnabled: row.banditCampsEnabled,
      wildAnimalAttacksEnabled: row.wildAnimalAttacksEnabled,
      severeWeatherEnabled: row.severeWeatherEnabled,
      wellAquiferNetworksEnabled: row.wellAquiferNetworksEnabled,
      approvalDeclineRate: normalizeWorldDifficultyRate(row.approvalDeclineRate),
      foodSpoilageRate: normalizeWorldDifficultyRate(row.foodSpoilageRate),
      initialGoodsMultiplier: normalizeInitialGoodsMultiplier(row.initialGoodsMultiplier),
      militaryDemands: normalizeMilitaryDemands(row.militaryDemands),
    }),
    configured: row.configured,
  };
}

export function generationMatchesServer(
  server: AuthoritativeWorldGeneration | null,
  local: WorldGenerationSettings,
): boolean {
  if (!server?.configured) return false;
  const normalizedLocal = normalizeWorldGenerationSettings(local);
  return server.seed === (normalizedLocal.seed >>> 0)
    && server.mapSize === normalizedLocal.mapSize
    && server.topography === normalizedLocal.topography
    && server.hydrology === normalizedLocal.hydrology
    && server.forestDensity === normalizedLocal.forestDensity
    && server.resourceAbundance === normalizedLocal.resourceAbundance
    && server.resourceVariety === normalizedLocal.resourceVariety
    && server.conflictMode === normalizedLocal.conflictMode
    && server.enemyPressure === normalizedLocal.enemyPressure
    && server.banditCampsEnabled === normalizedLocal.banditCampsEnabled
    && server.wildAnimalAttacksEnabled === normalizedLocal.wildAnimalAttacksEnabled
    && server.severeWeatherEnabled === normalizedLocal.severeWeatherEnabled
    && server.wellAquiferNetworksEnabled === normalizedLocal.wellAquiferNetworksEnabled
    && server.approvalDeclineRate === normalizedLocal.approvalDeclineRate
    && server.foodSpoilageRate === normalizedLocal.foodSpoilageRate
    && server.initialGoodsMultiplier === normalizedLocal.initialGoodsMultiplier
    && server.militaryDemands === normalizedLocal.militaryDemands;
}

export type WorldGenerationAuthorityResolution =
  | {
      kind: 'adopt-server';
      settings: WorldGenerationSettings;
    }
  | {
      kind: 'use-local';
      settings: WorldGenerationSettings;
    }
  | {
      kind: 'prompt';
    };

/**
 * Resolves setup before terrain is created.
 *
 * A configured server is the save contract and wins over missing or stale
 * browser storage. An unconfigured server is a genuinely new world and must
 * prompt rather than silently inheriting settings from an older database.
 * When the server cannot be probed, cached settings remain the offline fallback.
 */
export function resolveWorldGenerationAuthority(
  server: AuthoritativeWorldGeneration | null,
  local: WorldGenerationSettings | null,
): WorldGenerationAuthorityResolution {
  if (server?.configured) {
    const { configured: _configured, ...serverSettings } = server;
    return local && generationMatchesServer(server, local)
      ? { kind: 'use-local', settings: local }
      : { kind: 'adopt-server', settings: serverSettings };
  }
  if (server) return { kind: 'prompt' };
  return local
    ? { kind: 'use-local', settings: local }
    : { kind: 'prompt' };
}

/** Blocks bootstrap when a running server world was generated with different settings. */
export function assertWorldGenerationCompatible(
  local: WorldGenerationSettings,
  server: AuthoritativeWorldGeneration | null,
  simTick: number,
): void {
  if (!server?.configured) return;
  if (generationMatchesServer(server, local)) return;
  if (simTick > 0) {
    throw new WorldGenerationMismatchError(
      'The server world changed after this terrain was prepared '
      + `(server: ${server.mapSize}/${server.conflictMode}, terrain: ${local.mapSize}/${local.conflictMode}). `
      + 'Reload to adopt the server\'s saved map settings without resetting the settlement.',
    );
  }
}

export function settingsToConfigurePayload(settings: WorldGenerationSettings) {
  const normalized = normalizeWorldGenerationSettings(settings);
  return {
    seed: BigInt(normalized.seed >>> 0),
    mapSize: encodeMapSize(normalized.mapSize),
    topography: normalized.topography,
    hydrology: normalized.hydrology,
    forestDensity: normalized.forestDensity,
    resourceAbundance: normalized.resourceAbundance,
    resourceVariety: normalized.resourceVariety,
    conflictEnabled: normalized.conflictMode === 'frontier',
    enemyPressure: normalized.enemyPressure,
    banditCampsEnabled: normalized.banditCampsEnabled,
    wildAnimalAttacksEnabled: normalized.wildAnimalAttacksEnabled,
    severeWeatherEnabled: normalized.severeWeatherEnabled,
    wellAquiferNetworksEnabled: normalized.wellAquiferNetworksEnabled,
    approvalDeclineRate: normalized.approvalDeclineRate,
    foodSpoilageRate: normalized.foodSpoilageRate,
    initialGoodsMultiplier: normalized.initialGoodsMultiplier,
    militaryDemands: normalized.militaryDemands,
  };
}
