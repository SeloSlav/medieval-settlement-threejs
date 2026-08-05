import type { FarmCrop } from '../resources/types.ts';

export type MapOverlayMode = 'none' | 'water' | 'wind' | 'fertility';
export type MapOverlaySelection = {
  mode: MapOverlayMode;
  crop: FarmCrop;
};

export const FERTILITY_OVERLAY_CROPS = [
  'rye',
  'oats',
  'barley',
  'flax',
  'wheat',
] as const satisfies readonly FarmCrop[];

const STORAGE_KEY = 'medieval-road-system.mapOverlay';
const LEGACY_WATER_KEY = 'medieval-road-system.hydrologyOverlayEnabled';
const DEFAULT_SELECTION: MapOverlaySelection = { mode: 'none', crop: 'wheat' };
const listeners = new Set<() => void>();

export function getMapOverlaySelection(): MapOverlaySelection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const candidate = JSON.parse(stored) as Partial<MapOverlaySelection>;
      const mode = isMode(candidate.mode) ? candidate.mode : 'none';
      const crop = isFertilityCrop(candidate.crop) ? candidate.crop : 'wheat';
      return { mode, crop };
    }
    if (localStorage.getItem(LEGACY_WATER_KEY) === '1') {
      return { mode: 'water', crop: 'wheat' };
    }
  } catch {
    // Ignore blocked or unavailable storage.
  }
  return { ...DEFAULT_SELECTION };
}

export function setMapOverlaySelection(selection: MapOverlaySelection): void {
  const normalized: MapOverlaySelection = {
    mode: isMode(selection.mode) ? selection.mode : 'none',
    crop: isFertilityCrop(selection.crop) ? selection.crop : 'wheat',
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    localStorage.removeItem(LEGACY_WATER_KEY);
  } catch {
    // Ignore blocked or unavailable storage.
  }
  for (const listener of listeners) listener();
}

export function subscribeMapOverlayPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isMode(value: unknown): value is MapOverlayMode {
  return value === 'none' || value === 'water' || value === 'wind' || value === 'fertility';
}

function isFertilityCrop(value: unknown): value is FarmCrop {
  return FERTILITY_OVERLAY_CROPS.includes(value as (typeof FERTILITY_OVERLAY_CROPS)[number]);
}
