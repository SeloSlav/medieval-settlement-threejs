import type { BuildingKind } from '../generated/gameBalance.ts';

export type AmbientLayerId =
  | 'birds_wind_day'
  | 'founders_camp_day'
  | 'village_day'
  | 'town_interior_day'
  | 'night_insects'
  | 'open_wind_overview'
  | 'light_rain';

export type ProductionPocketKind =
  | 'wood'
  | 'metal-stone'
  | 'food-farm'
  | 'textile-leather';

export type MusicTrackId =
  | 'a_charter_beneath_the_firs'
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

/** Isolated weapon, projectile, impact, and formation-movement Foley. */
export type CombatAudioSoundKind =
  | 'spear-pike'
  | 'sword-sidearm'
  | 'halberd-polearm'
  | 'bow'
  | 'crossbow'
  | 'shield-armor'
  | 'charge';

export type CombatVoiceSide = 'defender' | 'raider';
export type CombatVoiceCue = 'battle' | 'charge' | 'damage' | 'flee' | 'rout';
export type CombatVoiceSoundKind = `${CombatVoiceSide}-${CombatVoiceCue}`;

export type MilitaryOrderSoundId = `military_order_${1 | 2 | 3 | 4 | 5 | 6}`;

export type UiSoundId =
  | 'road_place'
  | 'dry_stone_wall_place'
  | 'road_remove'
  | 'dry_stone_wall_remove'
  | 'edit_undo'
  | 'edit_redo'
  | 'building_place'
  | 'chicken_coop_select'
  | 'goat_pen_select'
  | 'pig_pen_select'
  | 'confirm'
  | 'error'
  | 'setup_portrait_select'
  | 'setup_choice'
  | 'setup_preset'
  | 'setup_adjust'
  | 'setup_back'
  | 'setup_advance'
  | 'setup_commit'
  | 'game_press'
  | 'game_tab'
  | 'game_toggle'
  | 'game_panel'
  | 'game_cancel'
  | 'game_transaction'
  | 'development_unlock'
  | 'game_danger'
  | 'illustrated_map_enter'
  | MilitaryOrderSoundId
  | 'military_company_select'
  | 'quarry_select'
  | 'foraging_select';

export type PersonSelectionVoice = 'male' | 'female';

export type ChapelBellTier = 1 | 2 | 3;

export type BuildingAudioKind = Exclude<
  BuildingKind,
  'chapel'
> | 'residence';

export type FootstepSurface =
  | 'grass'
  | 'forest'
  | 'dirt'
  | 'timber'
  | 'stone'
  | 'water';

export type FootstepGait = 'crouch' | 'walk' | 'sprint' | 'landing';
export type FootstepSide = 'left' | 'right';

export type FootstepMotion = {
  gait: FootstepGait;
  side: FootstepSide;
  /** Actual horizontal speed normalized to the active gait's target speed. */
  speedRatio: number;
};

export type FootstepEvent = FootstepMotion & {
  surface: FootstepSurface;
};

export type ThreatAlertSoundKind =
  | 'wildlife-town-entry'
  | 'bandit-camp-established'
  | 'bandit-town-entry'
  | 'ottoman-map-entry';

export type WorldNotificationSoundId =
  | 'event_raid_alarm'
  | 'event_fire_alarm'
  | 'event_bandit_theft'
  | 'event_bandit_camp_destroyed'
  | 'event_mercenary_arrival'
  | 'event_mercenary_leaving'
  | 'event_mercenary_departure'
  | 'event_raid_victory'
  | 'event_raid_loss';

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
  | 'animal_goat_1'
  | 'animal_goat_2'
  | 'animal_swine_1'
  | 'animal_swine_2'
  | 'animal_chicken_1'
  | 'animal_chicken_2'
  | 'animal_deer_1'
  | 'animal_deer_2'
  | 'animal_horse_1'
  | 'animal_horse_2'
  | 'parcel_remove'
  | 'season_winter_gust'
  | 'season_autumn_leaves'
  | 'season_rain_roof'
  | 'event_residence_complete'
  | 'event_residence_upgrade'
  | WorldNotificationSoundId
  | 'event_ottoman_raiders_detected'
  | 'event_bandit_camp_established'
  | 'event_bandits_town_entry'
  | 'event_wildlife_town_entry'
  | 'event_burial'
  | 'event_trade_arrival';

export const AMBIENT_LAYERS: Record<AmbientLayerId, AudioClipDefinition> = {
  birds_wind_day: { path: '/sounds/ambient/birds_wind_day.mp3', volume: 0.95, loop: true },
  founders_camp_day: { path: '/sounds/ambient/founders_camp_day.mp3', volume: 0.12, loop: true },
  village_day: { path: '/sounds/ambient/village_day.mp3', volume: 0.45, loop: true },
  town_interior_day: { path: '/sounds/ambient/town_interior_day.mp3', volume: 0.16, loop: true },
  night_insects: { path: '/sounds/ambient/night_insects.mp3', volume: 0.75, loop: true },
  open_wind_overview: { path: '/sounds/ambient/open_wind_overview.mp3', volume: 0.8, loop: true },
  light_rain: { path: '/sounds/ambient/light_rain.mp3', volume: 0.7, loop: true },
};

/** Quiet close-work loops spatially anchored to at most two active workshop families. */
export const PRODUCTION_POCKET_CLIPS: Record<ProductionPocketKind, AudioClipDefinition> = {
  wood: { path: '/sounds/ambient/worksite_wood.mp3', volume: 0.04, loop: true },
  'metal-stone': { path: '/sounds/ambient/worksite_metal_stone.mp3', volume: 0.06, loop: true },
  'food-farm': { path: '/sounds/ambient/worksite_food_farm.mp3', volume: 0.06, loop: true },
  'textile-leather': { path: '/sounds/ambient/worksite_textile_leather.mp3', volume: 0.14, loop: true },
};

/** Church-selection cue; never scheduled from the game clock. */
export const CHAPEL_BELL_CLIP: AudioClipDefinition = {
  path: '/sounds/buildings/chapel_bell.mp3',
  volume: 0.28,
};

/** Continuous rushing water used by the river's spatial audio source. */
export const RIVER_WATER_CLIP: AudioClipDefinition = {
  path: '/sounds/ambient/river_water_rushing.mp3',
  volume: 0.28,
  loop: true,
};

/** Context-selected, non-looping score with deliberate silence between cues. */
export const MUSIC_TRACKS: Record<MusicTrackId, AudioClipDefinition> = {
  a_charter_beneath_the_firs: {
    path: '/sounds/music/a_charter_beneath_the_firs.mp3',
    volume: 0.115,
  },
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

/** The score cue selected for planning/loading, then retained in gameplay rotation. */
export const STARTUP_MUSIC_TRACK_ID = 'a_charter_beneath_the_firs' as const;
export const STARTUP_MUSIC_CLIP = MUSIC_TRACKS[STARTUP_MUSIC_TRACK_ID];

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
  'spear-pike': combatVariants('pike_melee', 4, 0.2),
  'sword-sidearm': combatVariants('sword_sidearm_melee', 4, 0.18),
  'halberd-polearm': combatVariants('halberd_polearm_melee', 4, 0.19),
  bow: combatVariants('bow_attack', 3, 0.16),
  crossbow: combatVariants('crossbow_attack', 3, 0.17),
  'shield-armor': combatVariants('shield_armor_impact', 4, 0.16),
  charge: combatVariants('formation_charge', 3, 0.14),
};

function combatVoiceVariants(
  side: CombatVoiceSide,
  cue: CombatVoiceCue,
  volume: number,
): readonly AudioClipDefinition[] {
  return Array.from({ length: 3 }, (_, index) => ({
    path: `/sounds/combat/voices/${side}_${cue}_${index + 1}.mp3`,
    volume,
  }));
}

/**
 * Strictly nonverbal human reactions. These clips contain no commands,
 * dialogue, chants, or intelligible language; overlapping isolated voices in
 * the runtime mixer creates the battlefield group texture.
 */
export const COMBAT_VOICE_CLIPS: Record<
  CombatVoiceSoundKind,
  readonly AudioClipDefinition[]
> = {
  'defender-battle': combatVoiceVariants('defender', 'battle', 0.075),
  'defender-charge': combatVoiceVariants('defender', 'charge', 0.085),
  'defender-damage': combatVoiceVariants('defender', 'damage', 0.065),
  'defender-flee': combatVoiceVariants('defender', 'flee', 0.07),
  'defender-rout': combatVoiceVariants('defender', 'rout', 0.075),
  'raider-battle': combatVoiceVariants('raider', 'battle', 0.075),
  'raider-charge': combatVoiceVariants('raider', 'charge', 0.085),
  'raider-damage': combatVoiceVariants('raider', 'damage', 0.065),
  'raider-flee': combatVoiceVariants('raider', 'flee', 0.07),
  'raider-rout': combatVoiceVariants('raider', 'rout', 0.075),
};

function combatDeathVariants(
  voice: 'male' | 'female',
): readonly AudioClipDefinition[] {
  return Array.from({ length: 5 }, (_, index) => ({
    path: `/sounds/combat/selo/${voice}_dying_${index + 1}.mp3`,
    volume: 0.11,
  }));
}

export const COMBAT_DEATH_CLIPS = {
  man: combatDeathVariants('male'),
  woman: combatDeathVariants('female'),
} as const;

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
  dry_stone_wall_place: { path: '/sounds/ui/dry_stone_wall_place.mp3', volume: 0.22 },
  road_remove: { path: '/sounds/ui/road_remove.mp3', volume: 0.17 },
  dry_stone_wall_remove: { path: '/sounds/ui/dry_stone_wall_remove.mp3', volume: 0.19 },
  edit_undo: { path: '/sounds/ui/edit_undo.mp3', volume: 0.13 },
  edit_redo: { path: '/sounds/ui/edit_redo.mp3', volume: 0.13 },
  building_place: { path: '/sounds/ui/building_place.mp3', volume: 0.34 },
  chicken_coop_select: { path: '/sounds/ui/chicken_coop_select.mp3', volume: 0.2 },
  goat_pen_select: { path: '/sounds/ui/goat_pen_select.mp3', volume: 0.2 },
  pig_pen_select: { path: '/sounds/ui/pig_pen_select.mp3', volume: 0.2 },
  confirm: { path: '/sounds/ui/confirm.mp3', volume: 0.28 },
  error: { path: '/sounds/ui/error.mp3', volume: 0.3 },
  // New-world setup uses a coherent material palette while transient weight
  // carries meaning: browse < edit < navigate < commit.
  setup_portrait_select: { path: '/sounds/ui/setup_portrait_select.mp3', volume: 0.16 },
  setup_choice: { path: '/sounds/ui/setup_choice.mp3', volume: 0.24 },
  setup_preset: { path: '/sounds/ui/setup_preset.mp3', volume: 0.13 },
  setup_adjust: { path: '/sounds/ui/setup_adjust.mp3', volume: 0.09 },
  setup_back: { path: '/sounds/ui/setup_back.mp3', volume: 0.24 },
  setup_advance: { path: '/sounds/ui/setup_advance.mp3', volume: 0.45 },
  setup_commit: { path: '/sounds/ui/setup_commit.mp3', volume: 0.42 },
  game_press: { path: '/sounds/ui/game_press.mp3', volume: 0.16 },
  game_tab: { path: '/sounds/ui/game_tab.mp3', volume: 0.35 },
  game_toggle: { path: '/sounds/ui/game_toggle.mp3', volume: 0.15 },
  game_panel: { path: '/sounds/ui/game_panel.mp3', volume: 0.11 },
  game_cancel: { path: '/sounds/ui/game_cancel.mp3', volume: 0.1 },
  game_transaction: { path: '/sounds/ui/game_transaction.mp3', volume: 0.19 },
  development_unlock: { path: '/sounds/ui/development_unlock.mp3', volume: 0.65 },
  game_danger: { path: '/sounds/ui/game_danger.mp3', volume: 0.23 },
  illustrated_map_enter: { path: '/sounds/ui/illustrated_map_enter.mp3', volume: 0.14 },
  military_order_1: { path: '/sounds/ui/military_order_1.mp3', volume: 0.22 },
  military_order_2: { path: '/sounds/ui/military_order_2.mp3', volume: 0.22 },
  military_order_3: { path: '/sounds/ui/military_order_3.mp3', volume: 0.22 },
  military_order_4: { path: '/sounds/ui/military_order_4.mp3', volume: 0.22 },
  military_order_5: { path: '/sounds/ui/military_order_5.mp3', volume: 0.22 },
  military_order_6: { path: '/sounds/ui/military_order_6.mp3', volume: 0.22 },
  military_company_select: { path: '/sounds/ui/military_company_select.mp3', volume: 0.18 },
  quarry_select: { path: '/sounds/ui/quarry_select.mp3', volume: 0.14 },
  foraging_select: { path: '/sounds/ui/foraging_select.mp3', volume: 0.13 },
};

export const MILITARY_ORDER_SOUND_IDS = [
  'military_order_1',
  'military_order_2',
  'military_order_3',
  'military_order_4',
  'military_order_5',
  'military_order_6',
] as const satisfies readonly MilitaryOrderSoundId[];

export function pickMilitaryOrderSoundId(
  previous: MilitaryOrderSoundId | null,
  randomValue = Math.random(),
): MilitaryOrderSoundId {
  const candidates = previous == null
    ? MILITARY_ORDER_SOUND_IDS
    : MILITARY_ORDER_SOUND_IDS.filter((id) => id !== previous);
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.max(0, Math.min(0.999999999, randomValue))
    : 0;
  return candidates[Math.floor(boundedRandom * candidates.length)]
    ?? MILITARY_ORDER_SOUND_IDS[0];
}

function personSelectionVariants(
  voice: PersonSelectionVoice,
): readonly AudioClipDefinition[] {
  return Array.from({ length: 6 }, (_, index) => ({
    path: `/sounds/people/${voice}/person_selected_${index + 1}.mp3`,
    volume: 0.6,
  }));
}

/** Authorized Selo Empire acknowledgement lines, played only on direct agent clicks. */
export const PERSON_SELECTION_CLIPS: Record<
  PersonSelectionVoice,
  readonly AudioClipDefinition[]
> = {
  male: personSelectionVariants('male'),
  female: personSelectionVariants('female'),
};

/** Short ElevenLabs-generated ox reactions, played only on direct ox clicks. */
export const OX_SELECTION_CLIPS: readonly AudioClipDefinition[] = Array.from(
  { length: 3 },
  (_, index) => ({
    path: `/sounds/animals/ox_selected_${index + 1}.mp3`,
    volume: 0.48,
  }),
);

/** Dedicated acknowledgement for direct guard-dog agent clicks. */
export const DOG_SELECTION_CLIP: AudioClipDefinition = {
  path: '/sounds/animals/dog_selected.mp3',
  volume: 0.42,
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
  mine: { path: '/sounds/buildings/mine.mp3', volume: 0.065 },
  charcoal_burner: { path: '/sounds/buildings/charcoal_burner.mp3', volume: 0.05 },
  smithy: { path: '/sounds/buildings/smithy.mp3', volume: 0.065 },
  weaponsmith_armorer: { path: '/sounds/buildings/weaponsmith_armorer.mp3', volume: 0.06 },
  bowyer_fletcher: { path: '/sounds/buildings/bowyer_fletcher.mp3', volume: 0.055 },
  potter_kiln: { path: '/sounds/buildings/potter_kiln.mp3', volume: 0.055 },
  well: { path: '/sounds/buildings/well.mp3', volume: 0.05 },
  hunters_hall: { path: '/sounds/buildings/hunters_hall.mp3', volume: 0.05 },
  foragers_shed: { path: '/sounds/buildings/foragers_shed.mp3', volume: 0.045 },
  fishing_camp: { path: '/sounds/buildings/fishing_camp.mp3', volume: 0.05 },
  wayside_shrine: { path: '/sounds/buildings/wayside_shrine.mp3', volume: 0.04 },
  marketplace: { path: '/sounds/buildings/marketplace.mp3', volume: 0.04 },
  trading_post: { path: '/sounds/buildings/trading_post.mp3', volume: 0.05 },
  town_hall: { path: '/sounds/buildings/town_hall.mp3', volume: 0.04 },
  stable: { path: '/sounds/buildings/stable.mp3', volume: 0.05 },
  cavalry_yard: { path: '/sounds/buildings/cavalry_yard.mp3', volume: 0.05 },
  kennel: { path: '/sounds/buildings/kennel.mp3', volume: 0.05 },
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
  spinning_retting_house: { path: '/sounds/buildings/spinning_retting_house.mp3', volume: 0.05 },
  weaver: { path: '/sounds/buildings/weaver.mp3', volume: 0.05 },
  tannery: { path: '/sounds/buildings/tannery.mp3', volume: 0.05 },
  cobbler: { path: '/sounds/buildings/cobbler.mp3', volume: 0.05 },
  chandlery: { path: '/sounds/buildings/chandlery.mp3', volume: 0.05 },
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
  footstep_grass_1: worldFoleyClip('footstep_grass_1', 0.14),
  footstep_grass_2: worldFoleyClip('footstep_grass_2', 0.14),
  footstep_grass_3: worldFoleyClip('footstep_grass_3', 0.14),
  footstep_forest_1: worldFoleyClip('footstep_forest_1', 0.145),
  footstep_forest_2: worldFoleyClip('footstep_forest_2', 0.145),
  footstep_forest_3: worldFoleyClip('footstep_forest_3', 0.145),
  footstep_dirt_1: worldFoleyClip('footstep_dirt_1', 0.14),
  footstep_dirt_2: worldFoleyClip('footstep_dirt_2', 0.14),
  footstep_dirt_3: worldFoleyClip('footstep_dirt_3', 0.14),
  footstep_timber_1: worldFoleyClip('footstep_timber_1', 0.115),
  footstep_timber_2: worldFoleyClip('footstep_timber_2', 0.115),
  footstep_timber_3: worldFoleyClip('footstep_timber_3', 0.115),
  footstep_stone_1: worldFoleyClip('footstep_stone_1', 0.11),
  footstep_stone_2: worldFoleyClip('footstep_stone_2', 0.11),
  footstep_stone_3: worldFoleyClip('footstep_stone_3', 0.11),
  footstep_water_1: worldFoleyClip('footstep_water_1', 0.15),
  footstep_water_2: worldFoleyClip('footstep_water_2', 0.15),
  footstep_water_3: worldFoleyClip('footstep_water_3', 0.15),
  fire_bucket_1: worldFoleyClip('fire_bucket_1', 0.095),
  fire_bucket_2: worldFoleyClip('fire_bucket_2', 0.095),
  fire_steam: worldFoleyClip('fire_steam', 0.075),
  fire_ignite: worldFoleyClip('fire_ignite', 0.09),
  fire_extinguish: worldFoleyClip('fire_extinguish', 0.075),
  animal_cattle_1: worldFoleyClip('animal_cattle_1', 0.045),
  animal_cattle_2: worldFoleyClip('animal_cattle_2', 0.045),
  animal_sheep_1: worldFoleyClip('animal_sheep_1', 0.045),
  animal_sheep_2: worldFoleyClip('animal_sheep_2', 0.045),
  animal_goat_1: worldFoleyClip('animal_goat_1', 0.045),
  animal_goat_2: worldFoleyClip('animal_goat_2', 0.045),
  animal_swine_1: worldFoleyClip('animal_swine_1', 0.045),
  animal_swine_2: worldFoleyClip('animal_swine_2', 0.045),
  animal_chicken_1: worldFoleyClip('animal_chicken_1', 0.04),
  animal_chicken_2: worldFoleyClip('animal_chicken_2', 0.04),
  animal_deer_1: worldFoleyClip('animal_deer_1', 0.04),
  animal_deer_2: worldFoleyClip('animal_deer_2', 0.04),
  animal_horse_1: worldFoleyClip('animal_horse_1', 0.045),
  animal_horse_2: worldFoleyClip('animal_horse_2', 0.045),
  parcel_remove: worldFoleyClip('parcel_remove', 0.075),
  season_winter_gust: worldFoleyClip('season_winter_gust', 0.035),
  season_autumn_leaves: worldFoleyClip('season_autumn_leaves', 0.035),
  season_rain_roof: worldFoleyClip('season_rain_roof', 0.04),
  event_residence_complete: worldFoleyClip('event_residence_complete', 0.075),
  event_residence_upgrade: worldFoleyClip('event_residence_upgrade', 0.075),
  event_raid_alarm: worldFoleyClip('event_raid_alarm', 0.11),
  event_fire_alarm: worldFoleyClip('event_fire_alarm', 0.2),
  event_bandit_theft: worldFoleyClip('event_bandit_theft', 0.18),
  event_bandit_camp_destroyed: worldFoleyClip('event_bandit_camp_destroyed', 0.16),
  event_mercenary_arrival: worldFoleyClip('event_mercenary_arrival', 0.16),
  event_mercenary_leaving: worldFoleyClip('event_mercenary_leaving', 0.16),
  event_mercenary_departure: worldFoleyClip('event_mercenary_departure', 0.14),
  event_raid_victory: worldFoleyClip('event_raid_victory', 0.18),
  event_raid_loss: worldFoleyClip('event_raid_loss', 0.2),
  event_ottoman_raiders_detected: worldFoleyClip('event_ottoman_raiders_detected', 0.54),
  event_bandit_camp_established: worldFoleyClip('event_bandit_camp_established', 0.14),
  event_bandits_town_entry: worldFoleyClip('event_bandits_town_entry', 0.18),
  event_wildlife_town_entry: worldFoleyClip('event_wildlife_town_entry', 0.18),
  event_burial: worldFoleyClip('event_burial', 0.065),
  event_trade_arrival: worldFoleyClip('event_trade_arrival', 0.075),
};
