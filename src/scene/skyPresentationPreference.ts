export const FIXED_SKY_PRESETS = [
  {
    id: 'high_noon',
    label: 'High Noon',
    description: 'Bright summer sun with crisp, short shadows.',
    month: 6,
    monthDay: 15,
    hour: 12.75,
  },
  {
    id: 'rose_dawn',
    label: 'Rose Dawn',
    description: 'Peach light rising through cool morning shadows.',
    month: 4,
    monthDay: 12,
    hour: 6.1,
  },
  {
    id: 'ember_sunset',
    label: 'Ember Sunset',
    description: 'A low rust-red western sun and long evening shadows.',
    month: 9,
    monthDay: 12,
    hour: 18.7,
  },
  {
    id: 'blue_hour',
    label: 'Blue Hour',
    description: 'Violet twilight balanced between sunset and starlight.',
    month: 3,
    monthDay: 8,
    hour: 19.25,
  },
  {
    id: 'moonlit_midnight',
    label: 'Moonlit Midnight',
    description: 'Deep blue moonlight beneath the historical star field.',
    month: 8,
    monthDay: 15,
    hour: 0.25,
  },
] as const;

export type FixedSkyPresetId = (typeof FIXED_SKY_PRESETS)[number]['id'];

export type SkyPresentationPreference = Readonly<{
  cycleDisabled: boolean;
  preset: FixedSkyPresetId;
}>;

export const DEFAULT_FIXED_SKY_PRESET: FixedSkyPresetId = 'high_noon';

const STORAGE_KEY = 'medieval-road-system.skyPresentation';
const DEFAULT_PREFERENCE: SkyPresentationPreference = {
  cycleDisabled: true,
  preset: DEFAULT_FIXED_SKY_PRESET,
};

let cachedPreference: SkyPresentationPreference | null = null;

export function getSkyPresentationPreference(): SkyPresentationPreference {
  cachedPreference ??= readStoredPreference();
  return cachedPreference;
}

export function setDayNightCycleDisabled(cycleDisabled: boolean): void {
  writePreference({
    ...getSkyPresentationPreference(),
    cycleDisabled,
  });
}

export function setFixedSkyPreset(preset: FixedSkyPresetId): void {
  writePreference({
    ...getSkyPresentationPreference(),
    preset: isFixedSkyPreset(preset) ? preset : DEFAULT_FIXED_SKY_PRESET,
  });
}

export function isFixedSkyPreset(value: unknown): value is FixedSkyPresetId {
  return FIXED_SKY_PRESETS.some((preset) => preset.id === value);
}

export function fixedSkyPreset(id: FixedSkyPresetId) {
  return FIXED_SKY_PRESETS.find((preset) => preset.id === id)
    ?? FIXED_SKY_PRESETS[0];
}

function readStoredPreference(): SkyPresentationPreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCE;
    const candidate = JSON.parse(stored) as Partial<SkyPresentationPreference>;
    return {
      cycleDisabled: candidate.cycleDisabled === true,
      preset: isFixedSkyPreset(candidate.preset)
        ? candidate.preset
        : DEFAULT_FIXED_SKY_PRESET,
    };
  } catch {
    // Ignore unavailable storage and malformed legacy values.
    return DEFAULT_PREFERENCE;
  }
}

function writePreference(preference: SkyPresentationPreference): void {
  cachedPreference = preference;
  try {
    if (
      preference.cycleDisabled
      && preference.preset === DEFAULT_FIXED_SKY_PRESET
    ) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    }
  } catch {
    // The preference still applies for this session when storage is blocked.
  }
}
