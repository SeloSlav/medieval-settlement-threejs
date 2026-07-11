import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  resolveWorldDimensions,
  type WorldDimensions,
  type WorldGenerationSettings,
} from './worldGenerationSettings.ts';
import {
  type AuthoritativeWorldGeneration,
  worldConfigRowToGeneration,
} from './worldConfigAuthority.ts';
import type { WorldConfig } from '../generated/types.ts';

let draftSettings: WorldGenerationSettings = DEFAULT_WORLD_GENERATION_SETTINGS;
let authoritativeSettings: WorldGenerationSettings | null = null;
let activeDimensions: WorldDimensions = resolveWorldDimensions(DEFAULT_WORLD_GENERATION_SETTINGS.mapSize);

/** Scene-build draft from setup panel or localStorage — used until server confirms. */
export function setDraftWorldGeneration(settings: WorldGenerationSettings): void {
  draftSettings = settings;
  if (!authoritativeSettings) {
    activeDimensions = resolveWorldDimensions(settings.mapSize);
  }
}

/** Called when subscribed `world_config` is the active generation contract. */
export function applyAuthoritativeWorldGeneration(generation: AuthoritativeWorldGeneration): void {
  if (!generation.configured) return;
  const { configured: _configured, ...settings } = generation;
  authoritativeSettings = settings;
  activeDimensions = resolveWorldDimensions(settings.mapSize);
}

export function applyAuthoritativeWorldConfigRow(row: WorldConfig): void {
  applyAuthoritativeWorldGeneration(worldConfigRowToGeneration(row));
}

export function clearAuthoritativeWorldGeneration(): void {
  authoritativeSettings = null;
  activeDimensions = resolveWorldDimensions(draftSettings.mapSize);
}

export function getDraftWorldGeneration(): WorldGenerationSettings {
  return draftSettings;
}

export function getActiveWorldGeneration(): WorldGenerationSettings {
  return authoritativeSettings ?? draftSettings;
}

export function getActiveWorldDimensions(): WorldDimensions {
  return activeDimensions;
}

/** @deprecated Use {@link setDraftWorldGeneration} for pre-connect scene build. */
export function setActiveWorldGeneration(settings: WorldGenerationSettings): void {
  setDraftWorldGeneration(settings);
}
