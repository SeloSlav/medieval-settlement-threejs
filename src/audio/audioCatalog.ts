import type { BuildingKind } from '../generated/gameBalance.ts';

export type AmbientLayerId =
  | 'birds_wind_day'
  | 'village_day'
  | 'night_insects'
  | 'open_wind_overview'
  | 'light_rain';

export type MusicTrackId =
  | 'valley_at_first_light'
  | 'roads_and_rooftops'
  | 'vespers_over_the_valley'
  | 'winter_hearth';

export type AudioClipDefinition = {
  path: string;
  volume?: number;
  loop?: boolean;
};

export type WorkerActivitySoundKind =
  | 'chop'
  | 'mine'
  | 'build'
  | 'cut_crop'
  | 'dig'
  | 'fish'
  | 'forage'
  | 'livestock';

export type CombatAudioSoundKind = 'pike' | 'voices';

export type UiSoundId =
  | 'road_place'
  | 'building_place'
  | 'confirm'
  | 'error';

export type ChapelBellTier = 1 | 2 | 3;

export type BuildingAudioKind = Exclude<
  BuildingKind,
  'chapel'
> | 'residence';

export type FootstepSurface = 'grass' | 'dirt' | 'timber' | 'stone' | 'water';

export type WorldFoleySoundId =
  | 'cart_roll_1'
  | 'cart_roll_2'
  | 'cart_cargo_1'
  | 'cart_cargo_2'
  | 'cart_load'
  | 'cart_unload'
  | 'construction_timber'
  | 'construction_stone'
  | 'demolition_timber'
  | 'demolition_stone'
  | `footstep_${FootstepSurface}_${1 | 2 | 3}`
  | 'fire_bucket_1'
  | 'fire_bucket_2'
  | 'fire_steam'
  | 'fire_ignite'
  | 'fire_extinguish'
  | 'animal_cattle_1'
  | 'animal_cattle_2'
  | 'animal_sheep_1'
  | 'animal_sheep_2'
  | 'animal_swine_1'
  | 'animal_swine_2'
  | 'animal_chicken_1'
  | 'animal_chicken_2'
  | 'animal_deer_1'
  | 'animal_deer_2'
  | 'season_winter_gust'
  | 'season_autumn_leaves'
  | 'season_rain_roof'
  | 'event_residence_complete'
  | 'event_residence_upgrade'
  | 'event_raid_alarm'
  | 'event_burial'
  | 'event_trade_arrival';

export const AMBIENT_LAYERS: Record<AmbientLayerId, AudioClipDefinition> = {
  birds_wind_day: { path: '/sounds/ambient/birds_wind_day.mp3', volume: 0.95, loop: true },
  village_day: { path: '/sounds/ambient/village_day.mp3', volume: 0.45, loop: true },
  night_insects: { path: '/sounds/ambient/night_insects.mp3', volume: 0.75, loop: true },
  open_wind_overview: { path: '/sounds/ambient/open_wind_overview.mp3', volume: 0.8, loop: true },
  light_rain: { path: '/sounds/ambient/light_rain.mp3', volume: 0.7, loop: true },
};

/** One authentic bell toll per church tier, reused for clicks and Angelus strokes. */
export const CHAPEL_BELL_CLIPS: Record<ChapelBellTier, AudioClipDefinition> = {
  1: { path: '/sounds/buildings/chapel_bell_tier_1.mp3', volume: 0.24 },
  2: { path: '/sounds/buildings/chapel_bell_tier_2.mp3', volume: 0.26 },
  3: { path: '/sounds/buildings/chapel_bell_tier_3.mp3', volume: 0.28 },
};

/** Continuous rushing water used by the river's spatial audio source. */
export const RIVER_WATER_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/river_water_rushing.mp3',
  volume: 0.28,
  loop: true,
};

/** Context-selected, non-looping score with deliberate silence between cues. */
export const MUSIC_TRACKS: Record<MusicTrackId, AudioClipDefinition> = {
  valley_at_first_light: {
    path: '/sounds/music/valley_at_first_light.mp3',
    volume: 0.135,
  },
  roads_and_rooftops: {
    path: '/sounds/music/roads_and_rooftops.mp3',
    volume: 0.175,
  },
  vespers_over_the_valley: {
    path: '/sounds/music/vespers_over_the_valley.mp3',
    volume: 0.245,
  },
  winter_hearth: {
    path: '/sounds/music/winter_hearth.mp3',
    volume: 0.18,
  },
};

/** Authorized Selo Empire asset, heard only beside actively worked grain fields. */
export const FARM_WORKERS_SINGING_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/farm_workers_singing.mp3',
  volume: 0.14,
  loop: true,
};

/** Shared close-range loop that follows the nearest actively burning structure. */
export const FIRE_CRACKLE_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/fire_crackle.mp3',
  volume: 0.24,
  loop: true,
};

function combatVariants(
  baseName: string,
  count: number,
  volume: number,
): readonly AudioClipDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/sounds/combat/${baseName}_${index + 1}.mp3`,
    volume,
  }));
}

export const COMBAT_AUDIO_CLIPS: Record<
  CombatAudioSoundKind,
  readonly AudioClipDefinition[]
> = {
  pike: combatVariants('pike_melee', 4, 0.2),
  voices: combatVariants('angry_fighting', 4, 0.115),
};

function workerActivityVariants(
  baseName: string,
  count = 4,
  volume = 0.12,
): readonly AudioClipDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/sounds/workers/${baseName}_${index + 1}.mp3`,
    volume,
  }));
}

export const WORKER_ACTIVITY_CLIPS: Record<
  WorkerActivitySoundKind,
  readonly AudioClipDefinition[]
> = {
  chop: workerActivityVariants('chop_wood'),
  mine: workerActivityVariants('mine_stone'),
  build: workerActivityVariants('hammer_wood'),
  cut_crop: workerActivityVariants('cut_crop', 3, 0.075),
  dig: workerActivityVariants('dig_soil', 3, 0.08),
  fish: workerActivityVariants('fishing', 3, 0.08),
  forage: workerActivityVariants('forage', 3, 0.065),
  livestock: workerActivityVariants('livestock', 3, 0.07),
};

export const UI_SOUNDS: Record<UiSoundId, AudioClipDefinition> = {
  road_place: { path: '/sounds/ui/road_place.mp3', volume: 0.34 },
  building_place: { path: '/sounds/ui/building_place.mp3', volume: 0.34 },
  confirm: { path: '/sounds/ui/confirm.mp3', volume: 0.28 },
  error: { path: '/sounds/ui/error.mp3', volume: 0.3 },
};

/** Selection-only character cues for finished buildings and occupied homes. */
export const BUILDING_AUDIO_CLIPS: Record<
  BuildingAudioKind,
  AudioClipDefinition
> = {
  founders_camp: { path: '/sounds/buildings/founders_camp.mp3', volume: 0.055 },
  salvage_pile: { path: '/sounds/buildings/salvage_pile.mp3', volume: 0.045 },
  lumber_mill: { path: '/sounds/buildings/lumber_mill.mp3', volume: 0.07 },
  reforester: { path: '/sounds/buildings/reforester.mp3', volume: 0.045 },
  woodcutters_lodge: { path: '/sounds/buildings/woodcutters_lodge.mp3', volume: 0.065 },
  stone_quarry: { path: '/sounds/buildings/stone_quarry.mp3', volume: 0.065 },
  large_quarry: { path: '/sounds/buildings/large_quarry.mp3', volume: 0.07 },
  remote_work_camp: { path: '/sounds/buildings/remote_work_camp.mp3', volume: 0.045 },
  mine: { path: '/sounds/buildings/mine.mp3', volume: 0.065 },
  clay_pit: { path: '/sounds/buildings/clay_pit.mp3', volume: 0.055 },
  charcoal_burner: { path: '/sounds/buildings/charcoal_burner.mp3', volume: 0.05 },
  smithy: { path: '/sounds/buildings/smithy.mp3', volume: 0.065 },
  potter_kiln: { path: '/sounds/buildings/potter_kiln.mp3', volume: 0.055 },
  well: { path: '/sounds/buildings/well.mp3', volume: 0.05 },
  hunters_hall: { path: '/sounds/buildings/hunters_hall.mp3', volume: 0.05 },
  foragers_shed: { path: '/sounds/buildings/foragers_shed.mp3', volume: 0.045 },
  fishing_camp: { path: '/sounds/buildings/fishing_camp.mp3', volume: 0.05 },
  wayside_shrine: { path: '/sounds/buildings/wayside_shrine.mp3', volume: 0.04 },
  marketplace: { path: '/sounds/buildings/marketplace.mp3', volume: 0.04 },
  trading_post: { path: '/sounds/buildings/trading_post.mp3', volume: 0.05 },
  town_hall: { path: '/sounds/buildings/town_hall.mp3', volume: 0.04 },
  village_storehouse: { path: '/sounds/buildings/village_storehouse.mp3', volume: 0.045 },
  watchtower: { path: '/sounds/buildings/watchtower.mp3', volume: 0.045 },
  guardhouse: { path: '/sounds/buildings/guardhouse.mp3', volume: 0.05 },
  palisaded_refuge: { path: '/sounds/buildings/palisaded_refuge.mp3', volume: 0.045 },
  threshing_barn: { path: '/sounds/buildings/threshing_barn.mp3', volume: 0.055 },
  pastoral_farmstead: { path: '/sounds/buildings/pastoral_farmstead.mp3', volume: 0.05 },
  swineherd: { path: '/sounds/buildings/swineherd.mp3', volume: 0.05 },
  monastery: { path: '/sounds/buildings/monastery.mp3', volume: 0.04 },
  brewery: { path: '/sounds/buildings/brewery.mp3', volume: 0.05 },
  tavern: { path: '/sounds/buildings/tavern.mp3', volume: 0.05 },
  smokehouse: { path: '/sounds/buildings/smokehouse.mp3', volume: 0.045 },
  granary: { path: '/sounds/buildings/granary.mp3', volume: 0.045 },
  bakery: { path: '/sounds/buildings/bakery.mp3', volume: 0.05 },
  apiary: { path: '/sounds/buildings/apiary.mp3', volume: 0.04 },
  watermill: { path: '/sounds/buildings/watermill.mp3', volume: 0.055 },
  windmill: { path: '/sounds/buildings/windmill.mp3', volume: 0.055 },
  carpenter: { path: '/sounds/buildings/carpenter.mp3', volume: 0.06 },
  weaver: { path: '/sounds/buildings/weaver.mp3', volume: 0.05 },
  tannery: { path: '/sounds/buildings/smokehouse.mp3', volume: 0.045 },
  cobbler: { path: '/sounds/buildings/carpenter.mp3', volume: 0.045 },
  vineyard: { path: '/sounds/buildings/vineyard.mp3', volume: 0.045 },
  residence: { path: '/sounds/buildings/residence.mp3', volume: 0.035 },
};

function worldFoleyClip(name: string, volume: number): AudioClipDefinition {
  return { path: `/sounds/world/${name}.mp3`, volume };
}

/** Event-driven movement, weather, wildlife, and settlement feedback cues. */
export const WORLD_FOLEY_CLIPS: Record<WorldFoleySoundId, AudioClipDefinition> = {
  cart_roll_1: worldFoleyClip('cart_roll_1', 0.055),
  cart_roll_2: worldFoleyClip('cart_roll_2', 0.055),
  cart_cargo_1: worldFoleyClip('cart_cargo_1', 0.045),
  cart_cargo_2: worldFoleyClip('cart_cargo_2', 0.045),
  cart_load: worldFoleyClip('cart_load', 0.06),
  cart_unload: worldFoleyClip('cart_unload', 0.06),
  construction_timber: worldFoleyClip('construction_timber', 0.075),
  construction_stone: worldFoleyClip('construction_stone', 0.075),
  demolition_timber: worldFoleyClip('demolition_timber', 0.085),
  demolition_stone: worldFoleyClip('demolition_stone', 0.085),
  footstep_grass_1: worldFoleyClip('footstep_grass_1', 0.12),
  footstep_grass_2: worldFoleyClip('footstep_grass_2', 0.12),
  footstep_grass_3: worldFoleyClip('footstep_grass_3', 0.12),
  footstep_dirt_1: worldFoleyClip('footstep_dirt_1', 0.12),
  footstep_dirt_2: worldFoleyClip('footstep_dirt_2', 0.12),
  footstep_dirt_3: worldFoleyClip('footstep_dirt_3', 0.12),
  footstep_timber_1: worldFoleyClip('footstep_timber_1', 0.115),
  footstep_timber_2: worldFoleyClip('footstep_timber_2', 0.115),
  footstep_timber_3: worldFoleyClip('footstep_timber_3', 0.115),
  footstep_stone_1: worldFoleyClip('footstep_stone_1', 0.11),
  footstep_stone_2: worldFoleyClip('footstep_stone_2', 0.11),
  footstep_stone_3: worldFoleyClip('footstep_stone_3', 0.11),
  footstep_water_1: worldFoleyClip('footstep_water_1', 0.105),
  footstep_water_2: worldFoleyClip('footstep_water_2', 0.105),
  footstep_water_3: worldFoleyClip('footstep_water_3', 0.105),
  fire_bucket_1: worldFoleyClip('fire_bucket_1', 0.095),
  fire_bucket_2: worldFoleyClip('fire_bucket_2', 0.095),
  fire_steam: worldFoleyClip('fire_steam', 0.075),
  fire_ignite: worldFoleyClip('fire_ignite', 0.09),
  fire_extinguish: worldFoleyClip('fire_extinguish', 0.075),
  animal_cattle_1: worldFoleyClip('animal_cattle_1', 0.045),
  animal_cattle_2: worldFoleyClip('animal_cattle_2', 0.045),
  animal_sheep_1: worldFoleyClip('animal_sheep_1', 0.045),
  animal_sheep_2: worldFoleyClip('animal_sheep_2', 0.045),
  animal_swine_1: worldFoleyClip('animal_swine_1', 0.045),
  animal_swine_2: worldFoleyClip('animal_swine_2', 0.045),
  animal_chicken_1: worldFoleyClip('animal_chicken_1', 0.04),
  animal_chicken_2: worldFoleyClip('animal_chicken_2', 0.04),
  animal_deer_1: worldFoleyClip('animal_deer_1', 0.04),
  animal_deer_2: worldFoleyClip('animal_deer_2', 0.04),
  season_winter_gust: worldFoleyClip('season_winter_gust', 0.035),
  season_autumn_leaves: worldFoleyClip('season_autumn_leaves', 0.035),
  season_rain_roof: worldFoleyClip('season_rain_roof', 0.04),
  event_residence_complete: worldFoleyClip('event_residence_complete', 0.075),
  event_residence_upgrade: worldFoleyClip('event_residence_upgrade', 0.075),
  event_raid_alarm: worldFoleyClip('event_raid_alarm', 0.11),
  event_burial: worldFoleyClip('event_burial', 0.065),
  event_trade_arrival: worldFoleyClip('event_trade_arrival', 0.075),
};
