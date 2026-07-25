export type AmbientLayerId =
  | 'birds_wind_day'
  | 'village_day'
  | 'night_insects'
  | 'open_wind_overview'
  | 'light_rain';

export type AudioClipDefinition = {
  path: string;
  volume?: number;
  loop?: boolean;
};

export type WorkerActivitySoundKind = 'chop' | 'mine' | 'build';

export const AMBIENT_LAYERS: Record<AmbientLayerId, AudioClipDefinition> = {
  birds_wind_day: { path: '/sounds/ambient/birds_wind_day.mp3', volume: 0.2, loop: true },
  village_day: { path: '/sounds/ambient/village_day.mp3', volume: 0.12, loop: true },
  night_insects: { path: '/sounds/ambient/night_insects.mp3', volume: 0.12, loop: true },
  open_wind_overview: { path: '/sounds/ambient/open_wind_overview.mp3', volume: 0.28, loop: true },
  light_rain: { path: '/sounds/ambient/light_rain.mp3', volume: 0.18, loop: true },
};

/** Chapel bell at 6 AM and 6 PM. Distance and end fades are applied by ChapelBellPlayer. */
export const CHURCH_BELL_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/church_bells.mp3',
  volume: 0.32,
};

/** Continuous rushing water used by the river's spatial audio source. */
export const RIVER_WATER_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/river_water_rushing.mp3',
  volume: 0.28,
  loop: true,
};

function workerActivityVariants(
  baseName: string,
  count = 4,
): readonly AudioClipDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/sounds/workers/${baseName}_${index + 1}.mp3`,
    volume: 0.12,
  }));
}

export const WORKER_ACTIVITY_CLIPS: Record<
  WorkerActivitySoundKind,
  readonly AudioClipDefinition[]
> = {
  chop: workerActivityVariants('chop_wood'),
  mine: workerActivityVariants('mine_stone'),
  build: workerActivityVariants('hammer_wood'),
};
