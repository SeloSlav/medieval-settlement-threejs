import { createHash } from 'node:crypto';
import {
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  AMBIENT_LAYERS,
  BUILDING_AUDIO_CLIPS,
  CHAPEL_BELL_CLIP,
  COMBAT_AUDIO_CLIPS,
  COMBAT_DEATH_CLIPS,
  COMBAT_VOICE_CLIPS,
  DOG_SELECTION_CLIP,
  FARM_WORKERS_SINGING_CLIP,
  FIRE_CRACKLE_CLIP,
  MILITARY_ORDER_SOUND_IDS,
  MUSIC_TRACKS,
  OX_SELECTION_CLIPS,
  PERSON_SELECTION_CLIPS,
  PRODUCTION_POCKET_CLIPS,
  RIVER_WATER_CLIP,
  UI_SOUNDS,
  WORKER_ACTIVITY_CLIPS,
  WORLD_FOLEY_CLIPS,
  pickMilitaryOrderSoundId,
  type AudioClipDefinition,
} from '../src/audio/audioCatalog.ts';
import {
  AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE,
  AGENT_SELECTION_QUIET_GAIN,
  AGENT_SELECTION_QUIET_ORBIT_DISTANCE,
  AgentSelectionAudio,
  agentSelectionZoomGain,
  pickSelectionClipIndex,
} from '../src/audio/AgentSelectionAudio.ts';
import { BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import {
  BuildingAudio,
  buildingAudioTailGain,
  BUILDING_AUDIO_TAIL_SECONDS,
} from '../src/audio/BuildingAudio.ts';
import {
  worldFoleyGain,
  worldFoleyTailGain,
  WORLD_FOLEY_CUTOFF_DISTANCE,
  WORLD_FOLEY_MAX_ZOOM_DISTANCE,
  WORLD_FOLEY_TAIL_SECONDS,
} from '../src/audio/WorldFoleyAudio.ts';
import {
  fireAudioGain,
  FIRE_AUDIO_CUTOFF_DISTANCE,
  FIRE_AUDIO_FULL_VOLUME_DISTANCE,
  FIRE_AUDIO_MAX_ZOOM_DISTANCE,
} from '../src/audio/FireAudio.ts';
import {
  AMBIENT_LAYER_FADES,
  AMBIENT_SCORE_DUCK_GAIN,
} from '../src/audio/AmbientAudio.ts';
import {
  FOREST_WIND_CLIP_VOLUME,
  FOREST_WIND_FADE_IN_SECONDS,
  FOREST_WIND_FADE_OUT_SECONDS,
  FOREST_WIND_URL,
} from '../src/audio/ForestWindAudio.ts';
import {
  FOREST_WIND_FIRST_PERSON_FLOOR,
  FOREST_WIND_SILENT_RTS_DISTANCE,
  forestWindTargetMix,
} from '../src/audio/forestWindRules.ts';
import {
  buildSettlementZones,
  evaluateAmbientRules,
  OVERVIEW_ENTER_DISTANCE,
  OVERVIEW_EXIT_DISTANCE,
  selectAmbientWeatherLayer,
} from '../src/audio/ambientRules.ts';
import type { BuildingState } from '../src/resources/types.ts';
import {
  DEFAULT_AMBIENCE_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SOUND_EFFECTS_VOLUME,
} from '../src/audio/audioPreferences.ts';
import {
  hasAmbientRiverSound,
  riverAudioGain,
} from '../src/audio/RiverAudio.ts';
import { productionPocketVolume } from '../src/audio/ProductionPocketAudio.ts';
import {
  buildProductionPocketTargets,
  PRODUCTION_POCKET_MAX_ACTIVE,
  productionPocketDistanceGain,
  productionPocketZoomGain,
} from '../src/audio/productionPocketRules.ts';
import {
  buildCombatAudioSources,
  CombatAudio,
  combatAudioLoadoutForFighter,
  combatAudioGain,
  combatVoiceGain,
  combatVoiceSideForFaction,
  COMBAT_AUDIO_CHARGE_POOL_SIZE,
  COMBAT_AUDIO_CUTOFF_DISTANCE,
  COMBAT_AUDIO_MAX_EDGE_PLAYS_PER_TICK,
  COMBAT_AUDIO_MAX_SCHEDULED_PLAYS_PER_TICK,
  COMBAT_AUDIO_MAX_SOURCES,
  COMBAT_AUDIO_MAX_VOICE_EDGE_PLAYS_PER_TICK,
  COMBAT_AUDIO_MAX_ZOOM_DISTANCE,
  COMBAT_AUDIO_VOICE_MAX_ZOOM_DISTANCE,
  COMBAT_AUDIO_VOICE_POOL_SIZE,
  COMBAT_AUDIO_WEAPON_POOL_SIZE,
  createCombatAudioSourceWorkspace,
} from '../src/audio/CombatAudio.ts';

type AudioAsset = {
  id: string;
  group: string;
  kind: 'sound-effect' | 'music';
  output: string;
  prompt: string;
  durationSeconds?: number;
  loop?: boolean;
  promptInfluence?: number;
  musicLengthMs?: number;
  forceInstrumental?: boolean;
};

type AudioManifest = {
  schemaVersion: number;
  assets: AudioAsset[];
};

type GenerationRecord = {
  id: string;
  output: string;
  modelId: string;
  outputFormat: string;
  sha256: string;
  byteLength: number;
};

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  'scripts',
  'audio',
  'elevenlabs-audio-manifest.json',
);
const REPORT_PATH = path.join(
  PROJECT_ROOT,
  'public',
  'sounds',
  'elevenlabs-generation.json',
);
const REQUIRE_GENERATED = process.argv.includes('--require-generated');
const EXPECTED_FARM_SONG_SHA256 =
  '4c7639f2abcbdad954db703744a0866b3e81afa4d2f27d6bd51907819e26f1c5';
const EXPECTED_SELO_OVERVIEW_WIND_SHA256 =
  '388cdc56f19ea6d106af8d46c78b5d6bfa3cb6ea860542998f3190129a2d8305';
const EXPECTED_SELO_VILLAGE_DAY_SHA256 =
  '7fcd2f6cda2522b6f6991e550f4990e52e18a1f74d2e1ff703ea723270f611ae';
const EXPECTED_USER_FOREST_WIND_SHA256 =
  '0744372614a5259f400659de6dc9b7c263aa2552a23aa554f2c0ba3f5fd8ea8a';
const EXPECTED_USER_GAME_CANCEL_SHA256 =
  'a257077139f6a372dcdd7c29db1a9e1383e74aaec043e655015ff57a40482c74';
const EXPECTED_USER_DEVELOPMENT_UNLOCK_SHA256 =
  '38e10625738380fac0495a6c577322fa0b54e4c01b9ced1b70ed8f4eaf73d54c';
const EXPECTED_USER_RIVER_WATER_SHA256 =
  '883cbb48bc7f4a7858ac06f1d4a012084eb6164b46fcb2e208c630d72a6145e9';
const EXPECTED_USER_MONASTERY_SHA256 =
  'e236b988dca2183ab62ce3b21f4be85bf1ef74488195b802cef2ac43d9a921c5';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalizedAssetOutput(output: string): string {
  const resolved = path.resolve(PROJECT_ROOT, output);
  const soundRoot = path.resolve(PROJECT_ROOT, 'public', 'sounds');
  invariant(
    resolved.startsWith(`${soundRoot}${path.sep}`),
    `Asset output escapes public/sounds: ${output}`,
  );
  invariant(
    path.extname(resolved).toLowerCase() === '.mp3',
    `Asset output must be an MP3: ${output}`,
  );
  return resolved;
}

function runtimeClips(): AudioClipDefinition[] {
  return [
    ...Object.values(AMBIENT_LAYERS),
    CHAPEL_BELL_CLIP,
    ...Object.values(PRODUCTION_POCKET_CLIPS),
    RIVER_WATER_CLIP,
    FARM_WORKERS_SINGING_CLIP,
    FIRE_CRACKLE_CLIP,
    ...Object.values(MUSIC_TRACKS),
    ...Object.values(UI_SOUNDS),
    ...Object.values(PERSON_SELECTION_CLIPS).flat(),
    ...OX_SELECTION_CLIPS,
    DOG_SELECTION_CLIP,
    ...Object.values(WORKER_ACTIVITY_CLIPS).flat(),
    ...Object.values(COMBAT_AUDIO_CLIPS).flat(),
    ...Object.values(COMBAT_VOICE_CLIPS).flat(),
    ...Object.values(COMBAT_DEATH_CLIPS).flat(),
    ...Object.values(BUILDING_AUDIO_CLIPS),
    ...Object.values(WORLD_FOLEY_CLIPS),
  ];
}

async function isReadableFile(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function sha256(filename: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
}

async function assertMp3(filename: string): Promise<void> {
  const bytes = await readFile(filename);
  invariant(bytes.byteLength >= 1000, `Audio file is implausibly small: ${filename}`);
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const isMpegFrame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  invariant(isId3 || isMpegFrame, `Audio file does not have an MP3 header: ${filename}`);
}

async function assertWav(filename: string): Promise<void> {
  const bytes = await readFile(filename);
  invariant(bytes.byteLength >= 1000, `Audio file is implausibly small: ${filename}`);
  invariant(
    bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WAVE',
    `Audio file does not have a WAV header: ${filename}`,
  );
}

async function main(): Promise<void> {
  invariant(
    DEFAULT_MUSIC_VOLUME >= 0.7 && DEFAULT_MUSIC_VOLUME <= 1,
    'Default music volume should start clearly audible while retaining headroom',
  );
  invariant(
    DEFAULT_AMBIENCE_VOLUME >= 0.7 && DEFAULT_AMBIENCE_VOLUME <= 0.9,
    'Default ambience should support rather than mask the score',
  );
  invariant(
    DEFAULT_SOUND_EFFECTS_VOLUME >= 0.7 && DEFAULT_SOUND_EFFECTS_VOLUME <= 0.9,
    'Default sound effects should remain clear without overpowering the score',
  );
  invariant(
    riverAudioGain(0) === 0
    && Math.abs(
      riverAudioGain(0.5) - (RIVER_WATER_CLIP.volume ?? 1) * 0.5,
    ) < 1e-9,
    'The ambience volume must scale the positional river loop',
  );
  invariant(
    !hasAmbientRiverSound({ corridors: [] }),
    'Pond-only water layouts must not emit the spatial rushing-river loop',
  );
  invariant(
    hasAmbientRiverSound({
      corridors: [{
        points: [
          { x: 0, z: 0, progress: 0, halfWidth: 4, channelDepth: 2 },
          { x: 12, z: 4, progress: 1, halfWidth: 5, channelDepth: 2 },
        ],
      }],
    }),
    'A real river corridor must retain spatial river ambience',
  );
  invariant(
    OVERVIEW_ENTER_DISTANCE - OVERVIEW_EXIT_DISTANCE >= 20,
    'Overview ambience needs enough zoom hysteresis to avoid wheel-boundary hunting',
  );
  const belowOverview = evaluateAmbientRules({
    settlementZones: [],
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: OVERVIEW_ENTER_DISTANCE - 0.01,
    previous: {
      overviewActive: false,
      foundersCampActive: false,
      villageActive: false,
      townInteriorActive: false,
    },
    isNight: false,
  });
  const retainedOverview = evaluateAmbientRules({
    settlementZones: [],
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: OVERVIEW_EXIT_DISTANCE + 0.01,
    previous: {
      overviewActive: true,
      foundersCampActive: false,
      villageActive: false,
      townInteriorActive: false,
    },
    isNight: false,
  });
  invariant(
    !belowOverview.state.overviewActive && retainedOverview.state.overviewActive,
    'Overview ambience should retain its prior state throughout the hysteresis band',
  );
  invariant(
    AMBIENT_LAYER_FADES.open_wind_overview.inSeconds >= 5
    && AMBIENT_LAYER_FADES.open_wind_overview.outSeconds
      > AMBIENT_LAYER_FADES.open_wind_overview.inSeconds,
    'Overview wind should crossfade gradually and release more slowly than it enters',
  );
  invariant(
    AMBIENT_LAYER_FADES.light_rain.inSeconds >= 4
    && AMBIENT_SCORE_DUCK_GAIN >= 0.8
    && AMBIENT_SCORE_DUCK_GAIN <= 0.92,
    'Weather fades and score ducking should remain subtle rather than abrupt',
  );
  invariant(
    selectAmbientWeatherLayer(true, false) === 'light_rain',
    'Rain should remain audible below overview zoom',
  );
  invariant(
    selectAmbientWeatherLayer(true, true) === null,
    'Overview zoom should remove rain from the wind-only ambience mix',
  );
  const townHall = {
    id: 'town-hall-a',
    kind: 'town_hall',
    x: 0,
    z: 0,
    workRadius: 140,
    constructionComplete: true,
    assignedLabor: 1,
  } as BuildingState;
  const staffedSmithy = {
    id: 'smithy-a',
    kind: 'smithy',
    x: 160,
    z: 0,
    workRadius: 48,
    constructionComplete: true,
    assignedLabor: 2,
    productionRatePercent: 50,
  } as BuildingState;
  const townZones = buildSettlementZones([townHall, staffedSmithy], []);
  invariant(
    townZones.length === 1,
    'Remote production buildings must not create false generic settlement beds',
  );
  const outskirtsAmbience = evaluateAmbientRules({
    settlementZones: townZones,
    cameraTarget: { x: 90, z: 0 },
    orbitDistance: 88,
    previous: {
      overviewActive: false,
      foundersCampActive: false,
      villageActive: false,
      townInteriorActive: false,
    },
    isNight: false,
  });
  const interiorAmbience = evaluateAmbientRules({
    settlementZones: townZones,
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: 24,
    previous: {
      overviewActive: false,
      foundersCampActive: false,
      villageActive: true,
      townInteriorActive: false,
    },
    isNight: false,
  });
  invariant(
    outskirtsAmbience.overlayLayer === 'village_day'
    && outskirtsAmbience.overlayMix > 0
    && outskirtsAmbience.detailLayer === null,
    'Settlement outskirts need the distant bed without close-town detail',
  );
  invariant(
    interiorAmbience.detailLayer === 'town_interior_day'
    && interiorAmbience.detailMix > 0.95
    && interiorAmbience.overlayMix < 0.7,
    'Town cores need strong close detail while making space in the distant bed',
  );
  const foundersCamp = {
    id: 'founders-camp-a',
    kind: 'founders_camp',
    x: 0,
    z: 0,
    workRadius: 80,
    constructionComplete: true,
    assignedLabor: 1,
  } as BuildingState;
  const foundersCampZones = buildSettlementZones([foundersCamp], []);
  const foundersCampAmbience = evaluateAmbientRules({
    settlementZones: foundersCampZones,
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: 88,
    previous: {
      overviewActive: false,
      foundersCampActive: false,
      villageActive: false,
      townInteriorActive: false,
    },
    isNight: false,
  });
  invariant(
    foundersCampZones.length === 1
    && foundersCampZones[0]?.kind === 'founders-camp'
    && foundersCampAmbience.overlayLayer === 'founders_camp_day'
    && foundersCampAmbience.overlayMix > 0.95
    && foundersCampAmbience.detailLayer === null,
    'An isolated founders camp needs its restrained pre-town loop without village or town detail',
  );
  const earlyCampZones = buildSettlementZones([
    foundersCamp,
    {
      id: 'early-well-a',
      kind: 'well',
      x: 8,
      z: 0,
      workRadius: 20,
      constructionComplete: true,
      assignedLabor: 0,
    } as BuildingState,
  ], []);
  const earlyCampAmbience = evaluateAmbientRules({
    settlementZones: earlyCampZones,
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: 88,
    previous: {
      overviewActive: false,
      foundersCampActive: true,
      villageActive: false,
      townInteriorActive: false,
    },
    isNight: false,
  });
  invariant(
    earlyCampAmbience.overlayLayer === 'founders_camp_day'
    && earlyCampAmbience.detailLayer === null,
    'Nearby early structures must not turn the founders camp into a busy town mix',
  );
  invariant(
    productionPocketZoomGain(24) === 1
    && productionPocketZoomGain(104) === 0
    && productionPocketDistanceGain(10) === 1
    && productionPocketDistanceGain(72) === 0,
    'Production pockets must require both close zoom and local proximity',
  );
  const productionTargets = buildProductionPocketTargets({
    buildings: [
      { ...staffedSmithy, x: 5 },
      {
        ...staffedSmithy,
        id: 'carpenter-a',
        kind: 'carpenter',
        x: 8,
      },
      {
        ...staffedSmithy,
        id: 'bakery-a',
        kind: 'bakery',
        x: 12,
      },
      {
        ...staffedSmithy,
        id: 'weaver-idle',
        kind: 'weaver',
        x: 3,
        assignedLabor: 0,
      },
    ],
    listener: { x: 0, z: 0 },
    orbitDistance: 24,
    isNight: false,
    laborPaused: false,
  });
  invariant(
    productionTargets.length === PRODUCTION_POCKET_MAX_ACTIVE
    && productionTargets.some((target) => target.kind === 'metal-stone')
    && productionTargets.some((target) => target.kind === 'wood')
    && productionTargets.every((target) => target.sourceId !== 'weaver-idle'),
    'The nearest active workshop families must win the bounded positional mix',
  );
  invariant(
    buildProductionPocketTargets({
      buildings: [staffedSmithy],
      listener: { x: 0, z: 0 },
      orbitDistance: 24,
      isNight: false,
      laborPaused: true,
    }).length === 0,
    'Scheduled labor pauses must silence production pockets',
  );
  invariant(
    productionPocketVolume(PRODUCTION_POCKET_CLIPS.wood, 1, 0.5, 1)
      === (PRODUCTION_POCKET_CLIPS.wood.volume ?? 1) * 0.5,
    'The ambience preference must scale positional production loops',
  );
  invariant(
    forestWindTargetMix({
      canopyCover: 1,
      orbitDistance: FOREST_WIND_SILENT_RTS_DISTANCE,
      firstPersonActive: false,
    }) === 0,
    'Soft forest wind must stay out of ordinary strategic views',
  );
  invariant(
    forestWindTargetMix({ canopyCover: 0, orbitDistance: 12, firstPersonActive: false }) === 0
    && forestWindTargetMix({ canopyCover: 1, orbitDistance: 12, firstPersonActive: false }) === 1,
    'Close RTS wind must require measured nearby canopy',
  );
  invariant(
    forestWindTargetMix({ canopyCover: 0, orbitDistance: 240, firstPersonActive: true })
      === FOREST_WIND_FIRST_PERSON_FLOOR
    && forestWindTargetMix({ canopyCover: 1, orbitDistance: 240, firstPersonActive: true }) === 1,
    'First person must retain a faint breeze that rises to full level under canopy',
  );
  invariant(
    FOREST_WIND_CLIP_VOLUME <= 0.05
    && FOREST_WIND_FADE_IN_SECONDS >= 2
    && FOREST_WIND_FADE_OUT_SECONDS > FOREST_WIND_FADE_IN_SECONDS,
    'Soft forest wind must remain subtle and release more slowly than it enters',
  );
  const forestWindPath = path.resolve(PROJECT_ROOT, `public${FOREST_WIND_URL}`);
  invariant(
    await sha256(forestWindPath) === EXPECTED_USER_FOREST_WIND_SHA256,
    'The user-provided forest wind does not match its recorded source hash',
  );

  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, 'utf8'),
  ) as AudioManifest;
  invariant(manifest.schemaVersion === 1, 'Unsupported audio manifest schema.');
  invariant(manifest.assets.length > 0, 'Audio manifest is empty.');

  const ids = new Set<string>();
  const outputs = new Set<string>();
  for (const asset of manifest.assets) {
    invariant(!ids.has(asset.id), `Duplicate audio asset id: ${asset.id}`);
    invariant(!outputs.has(asset.output), `Duplicate audio output: ${asset.output}`);
    ids.add(asset.id);
    outputs.add(asset.output);
    normalizedAssetOutput(asset.output);
    invariant(asset.prompt.trim().length > 0, `Missing prompt for ${asset.id}`);

    if (asset.kind === 'sound-effect') {
      invariant(asset.prompt.length <= 450, `Sound prompt exceeds 450 characters: ${asset.id}`);
      invariant(
        asset.durationSeconds != null
        && asset.durationSeconds >= 0.5
        && asset.durationSeconds <= 30,
        `Invalid sound-effect duration: ${asset.id}`,
      );
      invariant(typeof asset.loop === 'boolean', `Missing loop setting: ${asset.id}`);
      invariant(
        asset.promptInfluence != null
        && asset.promptInfluence >= 0
        && asset.promptInfluence <= 1,
        `Invalid prompt influence: ${asset.id}`,
      );
    } else {
      invariant(asset.prompt.length <= 4100, `Music prompt exceeds 4100 characters: ${asset.id}`);
      invariant(
        asset.musicLengthMs != null
        && asset.musicLengthMs >= 3000
        && asset.musicLengthMs <= 600_000,
        `Invalid music duration: ${asset.id}`,
      );
      invariant(
        asset.forceInstrumental === true,
        `Game soundtrack must be explicitly instrumental: ${asset.id}`,
      );
    }
  }

  const combatSuiteAssets = manifest.assets.filter((asset) => (
    asset.group === 'combat-weapon-suite-v2'
  ));
  invariant(
    combatSuiteAssets.length === 21
    && Math.abs(combatSuiteAssets.reduce(
      (sum, asset) => sum + (asset.durationSeconds ?? 0),
      0,
    ) - 28) < 1e-9,
    'Combat weapon suite v2 must retain its 21 isolated cues and 28-second cost envelope',
  );
  invariant(
    combatSuiteAssets.every((asset) => (
      asset.loop === false
      && /no voice/i.test(asset.prompt)
      && /no (?:shout|shouting)/i.test(asset.prompt)
      && /no (?:chant|battle cry)/i.test(asset.prompt)
    )),
    'Every new combat cue must explicitly exclude speech, shouts, and chants',
  );
  const automaticCombatClips = Object.values(COMBAT_AUDIO_CLIPS).flat();
  invariant(
    automaticCombatClips.length === 25
    && automaticCombatClips.every((clip) => !/(?:selo|person_attack|angry_fighting|voice)/i.test(clip.path)),
    'Automatic combat playback must contain only weapon, shot, impact, and charge Foley',
  );
  for (const clip of automaticCombatClips) {
    const asset = manifest.assets.find((candidate) => (
      clip.path === `/${candidate.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`
    ));
    invariant(asset, `Combat runtime clip has no manifest source: ${clip.path}`);
  }

  const combatVoiceAssets = manifest.assets.filter((asset) => (
    asset.group === 'combat-nonverbal-voices-v1'
  ));
  invariant(
    combatVoiceAssets.length === 30
    && Math.abs(combatVoiceAssets.reduce(
      (sum, asset) => sum + (asset.durationSeconds ?? 0),
      0,
    ) - 31.8) < 1e-9,
    'Combat nonverbal voice suite must retain 30 isolated cues and its 31.8-second cost envelope',
  );
  invariant(
    combatVoiceAssets.every((asset) => (
      asset.loop === false
      && /strictly nonverbal/i.test(asset.prompt)
      && /no words/i.test(asset.prompt)
      && /commands/i.test(asset.prompt)
      && /intelligible language/i.test(asset.prompt)
      && /crowd/i.test(asset.prompt)
    )),
    'Every combat human cue must explicitly exclude words, commands, language, and crowds',
  );
  const automaticCombatVoiceClips = Object.values(COMBAT_VOICE_CLIPS).flat();
  invariant(
    automaticCombatVoiceClips.length === 30
    && automaticCombatVoiceClips.every((clip) => (
      /^\/sounds\/combat\/voices\/(?:defender|raider)_(?:battle|charge|damage|flee|rout)_\d+\.mp3$/.test(clip.path)
      && !/(?:selo|person_attack|angry_fighting)/i.test(clip.path)
    )),
    'Automatic combat voices must use only the strictly nonverbal status-routed suite',
  );
  for (const clip of automaticCombatVoiceClips) {
    const asset = combatVoiceAssets.find((candidate) => (
      clip.path === `/${candidate.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`
    ));
    invariant(asset, `Combat voice runtime clip has no suite manifest source: ${clip.path}`);
  }

  const combatDeathAssets = manifest.assets.filter((asset) => (
    asset.group === 'combat-death-voices-v1'
  ));
  invariant(
    combatDeathAssets.length === 8
    && Math.abs(combatDeathAssets.reduce(
      (sum, asset) => sum + (asset.durationSeconds ?? 0),
      0,
    ) - 9.5) < 1e-9,
    'Combat death suite must retain eight deliberately varied new reactions and its 9.5-second cost envelope',
  );
  invariant(
    combatDeathAssets.every((asset) => (
      asset.loop === false
      && /strictly nonverbal/i.test(asset.prompt)
      && /no words/i.test(asset.prompt)
      && /intelligible language/i.test(asset.prompt)
      && /crowd/i.test(asset.prompt)
    )),
    'Every death reaction must explicitly exclude language and crowds',
  );
  invariant(
    COMBAT_DEATH_CLIPS.man.length === 5
    && COMBAT_DEATH_CLIPS.woman.length === 5,
    'Each death voice needs five runtime variants rather than one clip with pitch variation',
  );
  for (const clip of [
    ...COMBAT_DEATH_CLIPS.man.slice(1),
    ...COMBAT_DEATH_CLIPS.woman.slice(1),
  ]) {
    const asset = combatDeathAssets.find((candidate) => (
      clip.path === `/${candidate.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`
    ));
    invariant(asset, `Generated death runtime clip has no suite manifest source: ${clip.path}`);
  }

  const buildingAssets = manifest.assets.filter((asset) => (
    asset.group === 'building-foley'
  ));
  const buildingAudioKinds = BUILDING_KINDS.filter(
    (kind) => kind !== 'chapel',
  ) as Exclude<(typeof BUILDING_KINDS)[number], 'chapel'>[];
  const runtimeBuildingKinds = [...buildingAudioKinds, 'residence'] as const;
  invariant(
    Object.keys(BUILDING_AUDIO_CLIPS).length === runtimeBuildingKinds.length,
    'Building Foley runtime catalog must cover every non-chapel building kind plus residences',
  );
  for (const kind of runtimeBuildingKinds) {
    const clip = BUILDING_AUDIO_CLIPS[kind];
    invariant(clip, `Missing building Foley runtime mapping: ${kind}`);
    if (kind === 'monastery') {
      invariant(
        clip.path === '/sounds/buildings/monastery.mp3',
        'The monastery must retain its dedicated user-provided selection cue',
      );
      continue;
    }
    const asset = buildingAssets.find((candidate) => (
      clip.path === `/${candidate.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`
    ));
    invariant(
      asset,
      `Building Foley mapping has no generated manifest source: ${kind} -> ${clip.path}`,
    );
    invariant(
      asset.durationSeconds != null
      && asset.durationSeconds >= 1
      && asset.durationSeconds <= 3,
      `Building Foley must remain within 1-3 seconds: ${kind}`,
    );
    invariant(
      !/\bfad(?:e|es|ed|ing)?\b/i.test(asset.prompt),
      `Building Foley processing instructions must stay out of the prompt: ${kind}`,
    );
    invariant(
      clip.path === `/${asset.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`,
      `Building Foley runtime path differs from its manifest output: ${kind}`,
    );
  }
  const deliberatelyDistinctBuildingKinds = [
    'weaponsmith_armorer',
    'bowyer_fletcher',
    'well',
    'stable',
    'cavalry_yard',
    'kennel',
    'spinning_retting_house',
    'tannery',
    'cobbler',
    'chandlery',
  ] as const;
  invariant(
    new Set(deliberatelyDistinctBuildingKinds.map((kind) => (
      BUILDING_AUDIO_CLIPS[kind].path
    ))).size === deliberatelyDistinctBuildingKinds.length,
    'Recognition-critical facilities must not fall back to another building family cue',
  );
  const wellAsset = buildingAssets.find((asset) => asset.id === 'building-well');
  invariant(
    wellAsset && /splash/i.test(wellAsset.prompt) && /dominant/i.test(wellAsset.prompt),
    'The well prompt must keep water splash dominant over its windlass mechanics',
  );
  const appBootstrapSource = await readFile(
    path.join(PROJECT_ROOT, 'src', 'app', 'appBootstrap.ts'),
    'utf8',
  );
  invariant(
    !/building\.kind\s*!==\s*['"]wayside_shrine['"]/.test(appBootstrapSource),
    'Wayside Shrine has an authored selection cue and must not be muted by the click handler',
  );
  invariant(
    (appBootstrapSource.match(/playUiSound\('building_place'\)/g) ?? []).length === 3,
    'Every building, residence, and vineyard placement path must share building_place',
  );
  const worldFoleySource = await readFile(
    path.join(PROJECT_ROOT, 'src', 'audio', 'WorldFoleyAudio.ts'),
    'utf8',
  );
  invariant(
    !/event_building_complete/.test(worldFoleySource)
    && !/construction_(?:timber|stone)/.test(worldFoleySource)
    && !/playAt\('event_residence_complete'/.test(worldFoleySource),
    'Building and residence completion must remain silent',
  );
  const appSource = await readFile(
    path.join(PROJECT_ROOT, 'src', 'app', 'App.ts'),
    'utf8',
  );
  invariant(
    /ambientAudio\?\.tick\(dt\)/.test(appSource)
    && !/ambientAudio\?\.tick\(worldDt\)/.test(appSource),
    'Ambient audio must use real frame time rather than simulation-scaled time',
  );
  const ambientControllerSource = await readFile(
    path.join(PROJECT_ROOT, 'src', 'audio', 'AmbientAudioController.ts'),
    'utf8',
  );
  invariant(
    !/ChapelBellPlayer|chapelBell\.tick|calendarMinute/.test(ambientControllerSource)
    && /playChapelSelection\([\s\S]{0,180}this\.buildingAudio\.playChapel/.test(ambientControllerSource),
    'The chapel bell must play only through explicit chapel selection',
  );
  const realtimeAmbientSources = await Promise.all([
    'AmbientAudio.ts',
    'ForestWindAudio.ts',
    'FireAudio.ts',
    'FarmWorkerSongAudio.ts',
  ].map((filename) => readFile(
    path.join(PROJECT_ROOT, 'src', 'audio', filename),
    'utf8',
  )));
  invariant(
    realtimeAmbientSources.every((source) => (
      /defaultPlaybackRate\s*=\s*1/.test(source)
      && /playbackRate\s*=\s*1/.test(source)
    )),
    'HTML ambient loops must explicitly retain real-time playback rates',
  );
  const spatialAmbientSources = await Promise.all([
    'ProductionPocketAudio.ts',
    'RiverAudio.ts',
  ].map((filename) => readFile(
    path.join(PROJECT_ROOT, 'src', 'audio', filename),
    'utf8',
  )));
  invariant(
    spatialAmbientSources.every((source) => /setPlaybackRate\(1\)/.test(source)),
    'Spatial ambient loops must explicitly retain real-time playback rates',
  );
  const chapelBellAssets = manifest.assets.filter((asset) => (
    asset.group === 'chapel-bells'
  ));
  invariant(
    chapelBellAssets.length === 1,
    'Church selection must retain one canonical bell recording',
  );
  const chapelBellAsset = chapelBellAssets[0];
  invariant(
    chapelBellAsset?.id === 'chapel-bell'
    && chapelBellAsset.loop === false
    && chapelBellAsset.durationSeconds != null
    && chapelBellAsset.durationSeconds >= 0.5
    && chapelBellAsset.durationSeconds <= 3,
    'The canonical church bell must be one short non-looping toll',
  );
  invariant(
    CHAPEL_BELL_CLIP.path
      === `/${chapelBellAsset.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`,
    'The canonical church bell runtime path differs from its manifest output',
  );
  invariant(
    buildingAudioTailGain(BUILDING_AUDIO_TAIL_SECONDS) === 1
    && buildingAudioTailGain(BUILDING_AUDIO_TAIL_SECONDS * 0.5) === 0.5
    && buildingAudioTailGain(0) === 0,
    'Building Foley needs a smooth playback-only tail envelope',
  );
  invariant(
    PERSON_SELECTION_CLIPS.male.length === 6
    && PERSON_SELECTION_CLIPS.female.length === 6
    && OX_SELECTION_CLIPS.length === 3
    && DOG_SELECTION_CLIP.path === '/sounds/animals/dog_selected.mp3',
    'Direct agent selection needs six lines per voice, three ox reactions, and one dog reaction',
  );
  invariant(
    agentSelectionZoomGain(AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE) === 1
    && agentSelectionZoomGain(AGENT_SELECTION_QUIET_ORBIT_DISTANCE) === AGENT_SELECTION_QUIET_GAIN
    && agentSelectionZoomGain(240) === AGENT_SELECTION_QUIET_GAIN
    && agentSelectionZoomGain(240, true) === 1
    && agentSelectionZoomGain(44) > AGENT_SELECTION_QUIET_GAIN
    && agentSelectionZoomGain(44) < 1,
    'Click-to-select acknowledgements must fall to a quiet floor outside intimate zoom',
  );
  for (const voice of ['male', 'female'] as const) {
    PERSON_SELECTION_CLIPS[voice].forEach((clip, index) => {
      invariant(
        clip.path === `/sounds/people/${voice}/person_selected_${index + 1}.mp3`,
        `Unexpected ${voice} selection clip path at index ${index}`,
      );
    });
  }
  for (let previous = 0; previous < 6; previous += 1) {
    for (const randomValue of [0, 0.2, 0.5, 0.8, 0.999999]) {
      invariant(
        pickSelectionClipIndex(6, previous, randomValue) !== previous,
        'Random selection acknowledgements must avoid immediate repeats',
      );
    }
  }
  const selectionAudioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const selectionPlays: Array<{ src: string; volume: number; playbackRate: number }> = [];
  class FakeSelectionAudioElement {
    paused = true;
    currentTime = 0;
    preload = '';
    src = '';
    volume = 0;
    playbackRate = 1;

    pause(): void {
      this.paused = true;
    }

    play(): Promise<void> {
      this.paused = false;
      selectionPlays.push({
        src: this.src,
        volume: this.volume,
        playbackRate: this.playbackRate,
      });
      return Promise.resolve();
    }

    removeAttribute(name: string): void {
      if (name === 'src') this.src = '';
    }
  }
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeSelectionAudioElement,
  });
  try {
    const selectionMixer = new AgentSelectionAudio(() => 0);
    selectionMixer.setVolume(0.5);
    selectionMixer.play('man');
    selectionMixer.play('man');
    selectionMixer.play('woman');
    selectionMixer.play('ox');
    selectionMixer.play('dog');
    selectionMixer.play('military-company', AGENT_SELECTION_QUIET_GAIN);
    invariant(
      selectionPlays.length === 6
      && selectionPlays[0]?.src === PERSON_SELECTION_CLIPS.male[0]?.path
      && selectionPlays[1]?.src === PERSON_SELECTION_CLIPS.male[1]?.path
      && selectionPlays[2]?.src === PERSON_SELECTION_CLIPS.female[0]?.path
      && selectionPlays[3]?.src === OX_SELECTION_CLIPS[0]?.path
      && selectionPlays[4]?.src === DOG_SELECTION_CLIP.path
      && selectionPlays[5]?.src === UI_SOUNDS.military_company_select.path,
      'Direct clicks must choose the matching person, animal, or company acknowledgement',
    );
    invariant(
      selectionPlays[0]?.volume === (PERSON_SELECTION_CLIPS.male[0]?.volume ?? 1) * 0.5
      && selectionPlays[5]?.volume
        === (UI_SOUNDS.military_company_select.volume ?? 1) * 0.5 * AGENT_SELECTION_QUIET_GAIN
      && selectionPlays.every((play) => play.playbackRate >= 0.96 && play.playbackRate <= 1.04),
      'Selection acknowledgements must respect effects volume, zoom falloff, and restrained pitch variation',
    );
    selectionMixer.setEnabled(false);
    selectionMixer.play('man');
    invariant(selectionPlays.length === 6, 'Master audio mute must suppress selection cues');
    selectionMixer.dispose();
  } finally {
    if (selectionAudioDescriptor) {
      Object.defineProperty(globalThis, 'Audio', selectionAudioDescriptor);
    } else {
      delete (globalThis as { Audio?: unknown }).Audio;
    }
  }
  const buildingAudioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const buildingPlayback: Array<{
    paused: boolean;
    plays: number;
    src: string;
  }> = [];
  class FakeBuildingAudioElement {
    paused = true;
    plays = 0;
    volume = 0;
    currentTime = 0;
    duration = 2;
    playbackRate = 1;
    preload = '';
    src = '';

    constructor() {
      buildingPlayback.push(this);
    }

    pause(): void {
      this.paused = true;
    }

    play(): Promise<void> {
      this.paused = false;
      this.plays += 1;
      return Promise.resolve();
    }

    removeAttribute(): void {
      this.src = '';
    }
  }
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeBuildingAudioElement,
  });
  try {
    const buildingMixer = new BuildingAudio();
    for (let index = 0; index < 100; index += 1) buildingMixer.tick(0.1);
    invariant(
      buildingPlayback.length === 0,
      'Building Foley frame ticks must never create or schedule playback',
    );
    buildingMixer.play('town_hall', 'building:test-town-hall');
    invariant(
      buildingPlayback.filter((audio) => audio.plays > 0).length === 1
      && buildingPlayback.some((audio) => (
        audio.plays === 1
        && audio.src === BUILDING_AUDIO_CLIPS.town_hall.path
      )),
      'Explicit building selection must play exactly its authored cue',
    );
    buildingMixer.playChapel(2, 'building:test-chapel');
    invariant(
      buildingPlayback.some((audio) => (
        audio.plays === 1
        && audio.src === CHAPEL_BELL_CLIP.path
        && audio.playbackRate === 1
      )),
      'Explicit chapel selection must use the canonical toll at the original pitch',
    );
    buildingMixer.dispose();
  } finally {
    if (buildingAudioDescriptor) {
      Object.defineProperty(globalThis, 'Audio', buildingAudioDescriptor);
    } else {
      delete (globalThis as { Audio?: unknown }).Audio;
    }
  }
  const closeBuildingView = {
    centerX: 0,
    centerZ: 0,
    viewRadius: 120,
    orbitDistance: 18,
  };
  invariant(
    MILITARY_ORDER_SOUND_IDS.length === 6
    && new Set(MILITARY_ORDER_SOUND_IDS.map((id) => UI_SOUNDS[id].path)).size === 6,
    'Military move and attack orders must share six distinct acknowledgement clips',
  );
  invariant(
    pickMilitaryOrderSoundId(null, 0) === 'military_order_1'
    && pickMilitaryOrderSoundId(null, 0.999999) === 'military_order_6'
    && pickMilitaryOrderSoundId('military_order_1', 0) !== 'military_order_1',
    'Military order acknowledgement selection must cover the pool without immediate repeats',
  );
  const worldAssets = manifest.assets.filter((asset) => (
    asset.group === 'world-foley'
    || asset.group === 'movement-foley'
    || asset.group === 'threat-alerts'
    || asset.group === 'threat-announcements-v2'
    || (
      asset.group === 'gameplay-gap-pass-v1'
      && asset.output.replaceAll('\\', '/').startsWith('public/sounds/world/')
    )
  ));
  invariant(
    worldAssets.length === Object.keys(WORLD_FOLEY_CLIPS).length
    && worldAssets.length === 68,
    'World Foley manifest and runtime catalog must retain all 68 cues',
  );
  for (const [id, clip] of Object.entries(WORLD_FOLEY_CLIPS)) {
    const asset = worldAssets.find((candidate) => (
      candidate.id === `world-${id.replaceAll('_', '-')}`
    ));
    invariant(asset, `Missing world Foley manifest entry: ${id}`);
    const minimumDuration = asset.group === 'movement-foley' ? 0.8 : 1;
    invariant(
      asset.durationSeconds != null
      && asset.durationSeconds >= minimumDuration
      && asset.durationSeconds <= 3,
      `World Foley must remain within ${minimumDuration}-3 seconds: ${id}`,
    );
    invariant(
      !/\bfad(?:e|es|ed|ing)?\b/i.test(asset.prompt),
      `World Foley processing instructions must stay out of the prompt: ${id}`,
    );
    invariant(
      clip.path === `/${asset.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`,
      `World Foley runtime path differs from its manifest output: ${id}`,
    );
  }
  invariant(
    worldFoleyTailGain(WORLD_FOLEY_TAIL_SECONDS) === 1
    && worldFoleyTailGain(WORLD_FOLEY_TAIL_SECONDS * 0.5) === 0.5
    && worldFoleyTailGain(0) === 0,
    'World Foley needs a smooth playback-only tail envelope',
  );
  invariant(
    worldFoleyGain(0, 0, closeBuildingView) === 1
    && worldFoleyGain(WORLD_FOLEY_CUTOFF_DISTANCE, 0, closeBuildingView) === 0
    && worldFoleyGain(0, 0, {
      ...closeBuildingView,
      orbitDistance: WORLD_FOLEY_MAX_ZOOM_DISTANCE + 1,
    }) === 0,
    'World Foley must remain bounded by distance and inspection zoom',
  );

  const missingRuntimeFiles: string[] = [];
  for (const clip of runtimeClips()) {
    invariant(
      clip.volume == null || (clip.volume >= 0 && clip.volume <= 1),
      `Runtime clip volume is outside 0..1: ${clip.path}`,
    );
    const output = `public${clip.path}`;
    const filename = path.resolve(PROJECT_ROOT, output);
    if (await isReadableFile(filename)) {
      await assertMp3(filename);
      continue;
    }
    invariant(
      outputs.has(output),
      `Runtime clip is neither present nor generated by the manifest: ${clip.path}`,
    );
    missingRuntimeFiles.push(output);
  }

  const farmSongPath = path.resolve(
    PROJECT_ROOT,
    `public${FARM_WORKERS_SINGING_CLIP.path}`,
  );
  invariant(
    await sha256(farmSongPath) === EXPECTED_FARM_SONG_SHA256,
    'The imported Selo Empire farm song does not match its recorded source hash.',
  );

  const overviewWindPath = path.resolve(
    PROJECT_ROOT,
    `public${AMBIENT_LAYERS.open_wind_overview.path}`,
  );
  invariant(
    await sha256(overviewWindPath) === EXPECTED_SELO_OVERVIEW_WIND_SHA256,
    'The imported Selo Empire overview wind does not match its recorded source hash.',
  );

  const villageDayPath = path.resolve(
    PROJECT_ROOT,
    `public${AMBIENT_LAYERS.village_day.path}`,
  );
  invariant(
    await sha256(villageDayPath) === EXPECTED_SELO_VILLAGE_DAY_SHA256,
    'The imported Selo Empire village ambience does not match its recorded source hash.',
  );

  const gameCancelPath = path.resolve(
    PROJECT_ROOT,
    `public${UI_SOUNDS.game_cancel.path}`,
  );
  invariant(
    await sha256(gameCancelPath) === EXPECTED_USER_GAME_CANCEL_SHA256,
    'The user-provided wooden latch cancel cue does not match its recorded source hash.',
  );
  const developmentUnlockPath = path.resolve(
    PROJECT_ROOT,
    `public${UI_SOUNDS.development_unlock.path}`,
  );
  invariant(
    await sha256(developmentUnlockPath) === EXPECTED_USER_DEVELOPMENT_UNLOCK_SHA256,
    'The user-provided development unlock cue does not match its recorded source hash.',
  );
  const riverWaterPath = path.resolve(PROJECT_ROOT, `public${RIVER_WATER_CLIP.path}`);
  invariant(
    await sha256(riverWaterPath) === EXPECTED_USER_RIVER_WATER_SHA256,
    'The user-provided river-water ambience does not match its recorded source hash.',
  );
  const monasteryPath = path.resolve(
    PROJECT_ROOT,
    `public${BUILDING_AUDIO_CLIPS.monastery.path}`,
  );
  invariant(
    await sha256(monasteryPath) === EXPECTED_USER_MONASTERY_SHA256,
    'The user-provided monastery selection cue does not match its recorded source hash.',
  );

  invariant(
    fireAudioGain(0, 1, 12) === 1,
    'Close, intense fire should reach full normalized gain.',
  );
  invariant(
    fireAudioGain(FIRE_AUDIO_FULL_VOLUME_DISTANCE, 0, 12) > 0,
    'A close low-intensity fire should remain audible.',
  );
  invariant(
    fireAudioGain(FIRE_AUDIO_CUTOFF_DISTANCE, 1, 12) === 0,
    'Fire must be silent at its distance cutoff.',
  );
  invariant(
    fireAudioGain(0, 1, FIRE_AUDIO_MAX_ZOOM_DISTANCE + 1) === 0,
    'Fire must be silent beyond its zoom cutoff.',
  );
  const closeCombatView = {
    centerX: 0,
    centerZ: 0,
    listenerX: 0,
    listenerZ: 0,
    viewRadius: 120,
    orbitDistance: 18,
  };
  invariant(
    combatAudioGain(0, 0, closeCombatView) === 1,
    'close zoomed-in melee should reach full normalized gain',
  );
  invariant(
    combatAudioGain(COMBAT_AUDIO_CUTOFF_DISTANCE, 0, closeCombatView) === 0,
    'melee audio must be silent at its distance cutoff',
  );
  invariant(
    combatAudioGain(0, 0, {
      ...closeCombatView,
      orbitDistance: COMBAT_AUDIO_MAX_ZOOM_DISTANCE + 1,
    }) === 0,
    'melee audio must be silent at strategic overview zoom',
  );
  const midZoomCombatView = {
    ...closeCombatView,
    orbitDistance: 60,
  };
  invariant(
    combatAudioGain(0, 0, midZoomCombatView) > 0
    && combatAudioGain(0, 0, midZoomCombatView) < 1,
    'weapon Foley should fade continuously with camera zoom before its cutoff',
  );
  invariant(
    combatVoiceGain(0, 0, closeCombatView) > 0
    && combatVoiceGain(0, 0, closeCombatView)
      < combatAudioGain(0, 0, closeCombatView)
    && combatVoiceGain(0, 0, {
      ...closeCombatView,
      orbitDistance: COMBAT_AUDIO_VOICE_MAX_ZOOM_DISTANCE,
    }) === 0,
    'human reactions must use a tighter close-camera envelope than weapons',
  );
  const engagementSources = buildCombatAudioSources([
    { id: 'guard', faction: 'guard', status: 'fighting', health: 80, x: 0, z: 0, attackCooldown: 0.1, issuedPolearms: 1 },
    { id: 'raider', faction: 'raider', status: 'fighting', health: 70, x: 2, z: 0, attackCooldown: 0.2 },
    { id: 'crossbow', faction: 'crossbow', status: 'fighting', health: 70, x: 24, z: 0, attackCooldown: 0.3 },
    { id: 'charge', faction: 'bowman', status: 'advancing', health: 70, x: 4, z: 0, targetKind: 'combat-agent' },
    { id: 'ordinary-advance', faction: 'bandit', status: 'advancing', health: 70, x: 5, z: 0, targetKind: 'building' },
    { id: 'retreating', faction: 'raider', status: 'retreating', health: 40, x: 1, z: 0 },
  ]);
  invariant(
    engagementSources.length === 5
    && engagementSources.some((source) => (
      source.id === 'guard'
      && source.weaponFamily === 'spear-pike'
      && source.defensiveImpact
    ))
    && engagementSources.some((source) => (
      source.id === 'raider' && source.weaponFamily === 'sword-sidearm'
    ))
    && engagementSources.some((source) => (
      source.id === 'crossbow'
      && source.weaponFamily === 'crossbow'
      && source.x === 24
    ))
    && engagementSources.some((source) => (
      source.id === 'charge' && source.phase === 'charge'
    ))
    && engagementSources.some((source) => (
      source.id === 'retreating'
      && source.phase === 'flee'
      && source.voiceSide === 'raider'
    )),
    'combat audio should retain attackers, combat-target charges, and status-routed flee voices',
  );
  invariant(
    !engagementSources.some((source) => source.id === 'ordinary-advance'),
    'generic advancing bandits must not emit formation-charge Foley',
  );
  const expectedPrimaryFamilies = new Map([
    ['guard', 'spear-pike'],
    ['raider', 'sword-sidearm'],
    ['bandit', 'spear-pike'],
    ['militia', 'spear-pike'],
    ['spearman', 'spear-pike'],
    ['man-at-arms', 'sword-sidearm'],
    ['crossbow', 'crossbow'],
    ['mercenary-spear', 'spear-pike'],
    ['footman', 'sword-sidearm'],
    ['polearm', 'halberd-polearm'],
    ['bowman', 'bow'],
  ] as const);
  for (const [faction, family] of expectedPrimaryFamilies) {
    invariant(
      combatAudioLoadoutForFighter({ faction }).primary === family,
      `${faction} combat Foley should route to ${family}`,
    );
  }
  invariant(
    combatVoiceSideForFaction('raider') === 'raider'
    && combatVoiceSideForFaction('bandit') === 'raider'
    && combatVoiceSideForFaction('guard') === 'defender',
    'combat voice timbres should route raiders/bandits separately from defenders',
  );
  const reusableCombatFighters = [
    { id: 'Z-guard', faction: 'guard' as const, status: 'fighting' as const, health: 80, x: 0, z: 0 },
    { id: 'a-raider', faction: 'raider' as const, status: 'fighting' as const, health: 70, x: 2, z: 0 },
  ];
  const combatSourceWorkspace = createCombatAudioSourceWorkspace();
  const reusableCombatSources = buildCombatAudioSources(
    reusableCombatFighters,
    combatSourceWorkspace,
  );
  const reusableCombatSource = reusableCombatSources[0];
  invariant(
    reusableCombatSource?.id === 'Z-guard',
    'bounded combat sources should retain stable per-fighter IDs',
  );
  reusableCombatFighters[1]!.x = 4;
  const updatedCombatSources = buildCombatAudioSources(
    reusableCombatFighters,
    combatSourceWorkspace,
  );
  invariant(
    updatedCombatSources === reusableCombatSources
    && updatedCombatSources[0] === reusableCombatSource
    && updatedCombatSources.some((source) => source.id === 'a-raider' && source.x === 4),
    'combat source workspace should reuse its result array and records while updating positions',
  );
  const reusablePairingStarted = performance.now();
  for (let index = 0; index < 50_000; index += 1) {
    buildCombatAudioSources(reusableCombatFighters, combatSourceWorkspace);
  }
  const reusablePairingElapsedMs = performance.now() - reusablePairingStarted;
  invariant(
    reusablePairingElapsedMs < 250,
    `50,000 retained combat-audio source builds took ${reusablePairingElapsedMs.toFixed(1)}ms`,
  );
  const isolatedRangedSource = buildCombatAudioSources([
    { id: 'bow-far', faction: 'bowman', status: 'fighting', health: 80, x: 20, z: 0, attackCooldown: 0 },
  ], undefined, closeCombatView);
  invariant(
    isolatedRangedSource.length === 1
    && isolatedRangedSource[0]?.id === 'bow-far'
    && isolatedRangedSource[0]?.weaponFamily === 'bow',
    'ranged attacks must emit from their fighter even without a nearby melee pair',
  );
  const visibleStanceSources = buildCombatAudioSources([
    {
      id: 'crossbow-ranged-stance', faction: 'crossbow', status: 'fighting', health: 80,
      x: 1, z: 0, attackCooldown: 0, activeWeaponFamily: 'crossbow',
    },
    {
      id: 'crossbow-sidearm-stance', faction: 'crossbow', status: 'fighting', health: 80,
      x: 2, z: 0, attackCooldown: 0, activeWeaponFamily: 'sword-sidearm',
    },
    {
      id: 'mercenary-visible-pike', faction: 'mercenary-spear', status: 'fighting', health: 80,
      x: 3, z: 0, attackCooldown: 0, activeWeaponFamily: 'spear-pike',
    },
  ], undefined, closeCombatView);
  invariant(
    visibleStanceSources.find((source) => source.id === 'crossbow-ranged-stance')?.weaponFamily
      === 'crossbow'
    && visibleStanceSources.find((source) => source.id === 'crossbow-sidearm-stance')?.weaponFamily
      === 'sword-sidearm'
    && visibleStanceSources.find((source) => source.id === 'mercenary-visible-pike')?.weaponFamily
      === 'spear-pike',
    'combat Foley must follow the weapon family visibly held in the active stance',
  );
  const villagerAudioIntegration = await readFile(
    path.join(PROJECT_ROOT, 'src', 'settlement', 'VillagerRenderer.ts'),
    'utf8',
  );
  invariant(
    /const activeWeaponFamily\s*=\s*combatWeaponSoundFamily\(/.test(villagerAudioIntegration)
    && /fighter\.activeWeaponFamily\s*=\s*activeWeaponFamily/.test(villagerAudioIntegration)
    && /case 'sword-shield': return 'sword-sidearm'/.test(villagerAudioIntegration)
    && /case 'crossbow': return 'crossbow'/.test(villagerAudioIntegration)
    && /buildCombatAudioSources\([\s\S]{0,180}this\.combatAudioSourceWorkspace,[\s\S]{0,80}activeView/.test(villagerAudioIntegration),
    'villager combat audio must publish the rendered weapon stance and listener view into source selection',
  );
  const combatStressFighters = Array.from(
    { length: 100_000 },
    (_, index) => ({
      id: `guard-stress-${index}`,
      faction: 'guard' as const,
      status: 'fighting' as const,
      health: 100,
      x: index * 10,
      z: 0,
    }),
  );
  for (let index = 0; index < COMBAT_AUDIO_MAX_SOURCES; index += 1) {
    combatStressFighters.push({
      id: `raider-stress-${index}`,
      faction: 'raider',
      status: 'fighting',
      health: 100,
      x: index * 10 + 1,
      z: 0,
    });
  }
  const combatPairingStarted = performance.now();
  const combatStressSources = buildCombatAudioSources(combatStressFighters);
  const combatPairingElapsedMs = performance.now() - combatPairingStarted;
  invariant(
    combatStressSources.length === COMBAT_AUDIO_MAX_SOURCES,
    'combat audio should retain an even bounded source budget across both sides',
  );
  invariant(
    combatPairingElapsedMs < 250,
    `combat audio source selection should remain bounded with 100,000 defenders; took ${combatPairingElapsedMs.toFixed(1)}ms`,
  );
  const everyWeaponFamily = [
    'spear-pike',
    'sword-sidearm',
    'halberd-polearm',
    'bow',
    'crossbow',
  ] as const;
  const listenerSelectionFighters = [
    ...Array.from({ length: 120 }, (_, index) => ({
      id: `far-first-${index}`,
      faction: 'guard' as const,
      status: 'fighting' as const,
      health: 100,
      x: 500 + index,
      z: 500,
      activeWeaponFamily: 'spear-pike' as const,
    })),
    ...Array.from({ length: 60 }, (_, index) => ({
      id: `near-spear-${index}`,
      faction: 'guard' as const,
      status: 'fighting' as const,
      health: 100,
      x: 1 + index * 0.04,
      z: index % 2 * 0.1,
      activeWeaponFamily: 'spear-pike' as const,
    })),
    ...everyWeaponFamily.slice(1).map((activeWeaponFamily, index) => ({
      id: `near-reserved-family-${activeWeaponFamily}`,
      faction: 'guard' as const,
      status: 'fighting' as const,
      health: 100,
      x: 8 + index,
      z: 0,
      activeWeaponFamily,
    })),
  ];
  const listenerSelectedSources = buildCombatAudioSources(
    listenerSelectionFighters,
    undefined,
    closeCombatView,
  );
  const listenerSelectedFamilies = new Set(
    listenerSelectedSources.map((source) => source.weaponFamily),
  );
  invariant(
    listenerSelectedSources.length === COMBAT_AUDIO_MAX_SOURCES / 2
    && listenerSelectedSources.every((source) => source.x < 20)
    && everyWeaponFamily.every((family) => listenerSelectedFamilies.has(family)),
    'listener-aware source selection must reject far first IDs while reserving every nearby weapon family',
  );
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const combatPlayback: Array<{
    paused: boolean;
    ended: boolean;
    plays: number;
    volume: number;
    playbackRate: number;
    src: string;
  }> = [];
  class FakeCombatAudioElement {
    paused = true;
    ended = false;
    plays = 0;
    volume = 0;
    currentTime = 0;
    playbackRate = 1;
    preload = '';
    src = '';

    constructor() {
      combatPlayback.push(this);
    }

    pause(): void {
      this.paused = true;
    }

    play(): Promise<void> {
      this.paused = false;
      this.plays += 1;
      return Promise.resolve();
    }

    removeAttribute(): void {
      this.src = '';
    }
  }
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeCombatAudioElement,
  });
  try {
    invariant(
      COMBAT_AUDIO_WEAPON_POOL_SIZE === 36
      && COMBAT_AUDIO_CHARGE_POOL_SIZE === 6
      && COMBAT_AUDIO_MAX_EDGE_PLAYS_PER_TICK === 8
      && COMBAT_AUDIO_MAX_SCHEDULED_PLAYS_PER_TICK === 3
      && COMBAT_AUDIO_VOICE_POOL_SIZE === 4
      && COMBAT_AUDIO_MAX_VOICE_EDGE_PLAYS_PER_TICK === 1,
      'combat mix must favor a large weapon bed while keeping human reactions tightly bounded',
    );
    const edgeSources = buildCombatAudioSources([
      { id: 'edge-pike', faction: 'spearman', status: 'fighting', health: 80, x: 0, z: 0, attackCooldown: 0 },
      { id: 'edge-sword', faction: 'raider', status: 'fighting', health: 80, x: 1, z: 0, attackCooldown: 0 },
      { id: 'edge-halberd', faction: 'polearm', status: 'fighting', health: 80, x: 2, z: 0, attackCooldown: 0 },
      { id: 'edge-bow', faction: 'bowman', status: 'fighting', health: 80, x: 3, z: 0, attackCooldown: 0 },
      { id: 'edge-crossbow', faction: 'crossbow', status: 'fighting', health: 80, x: 4, z: 0, attackCooldown: 0 },
    ]);
    const combatMixer = new CombatAudio();
    combatMixer.tick(0, edgeSources, closeCombatView);
    for (const source of edgeSources) source.attackCooldown = 1;
    combatMixer.tick(0.016, edgeSources, closeCombatView);
    const weaponVoices = combatPlayback.slice();
    invariant(
      weaponVoices.length === COMBAT_AUDIO_WEAPON_POOL_SIZE
      && weaponVoices.filter((audio) => audio.plays > 0).length
        === Math.min(edgeSources.length, COMBAT_AUDIO_MAX_EDGE_PLAYS_PER_TICK),
      'one update should preserve real cooldown-reset attacks as overlapping weapon voices',
    );
    invariant(
      weaponVoices
        .filter((audio) => audio.plays > 0)
        .every((audio) => (
          audio.volume > 0
          && /\/sounds\/combat\/(?:pike_melee|sword_sidearm_melee|halberd_polearm_melee|bow_attack|crossbow_attack|shield_armor_impact)_\d+\.mp3/.test(audio.src)
          && !/(?:selo|person_attack|angry_fighting|voice)/i.test(audio.src)
        )),
      'cooldown-edge playback must be weapon-matched and contain no spoken/chanted combat path',
    );
    for (let burst = 0; burst < 8; burst += 1) {
      for (const source of edgeSources) source.attackCooldown = 0;
      combatMixer.tick(0.016, edgeSources, closeCombatView);
      for (const source of edgeSources) source.attackCooldown = 1;
      combatMixer.tick(0.016, edgeSources, closeCombatView);
    }
    invariant(
      weaponVoices.reduce((sum, audio) => sum + audio.plays, 0)
        === COMBAT_AUDIO_WEAPON_POOL_SIZE
      && weaponVoices.every((audio) => audio.plays <= 1),
      'a saturated combat pool must drop excess events without cutting or stealing active one-shots',
    );
    combatMixer.tick(0.1, [], closeCombatView);
    invariant(
      weaponVoices.every((audio) => audio.paused),
      'all weapon one-shots should stop as soon as the live engagement ends',
    );
    combatMixer.dispose();

    const stancePlaybackStart = combatPlayback.length;
    const stanceMixer = new CombatAudio();
    stanceMixer.tick(0, visibleStanceSources, closeCombatView);
    for (const source of visibleStanceSources) source.attackCooldown = 1;
    stanceMixer.tick(0.016, visibleStanceSources, closeCombatView);
    const stancePlayback = combatPlayback.slice(stancePlaybackStart)
      .filter((audio) => audio.plays > 0)
      .map((audio) => audio.src);
    invariant(
      stancePlayback.length === 3
      && stancePlayback.some((src) => /\/sounds\/combat\/crossbow_attack_\d+\.mp3/.test(src))
      && stancePlayback.some((src) => /\/sounds\/combat\/sword_sidearm_melee_\d+\.mp3/.test(src))
      && stancePlayback.some((src) => /\/sounds\/combat\/pike_melee_\d+\.mp3/.test(src)),
      'cooldown edges must play the ranged crossbow, fallback sidearm, and mercenary pike actually shown',
    );
    stanceMixer.dispose();

    const fallbackStart = combatPlayback.length;
    const fallbackMixer = new CombatAudio();
    const fallbackSources = buildCombatAudioSources([
      { id: 'fallback-raider', faction: 'raider', status: 'fighting', health: 80, x: 0, z: 0 },
    ]);
    fallbackMixer.tick(0, fallbackSources, closeCombatView);
    fallbackMixer.tick(0.4, fallbackSources, closeCombatView);
    const fallbackVoices = combatPlayback.slice(fallbackStart);
    invariant(
      fallbackVoices.some((audio) => audio.plays === 1),
      'authored showcases and missed server edges need deterministic scheduled attack fallback',
    );
    fallbackMixer.dispose();

    const meleeBedStart = combatPlayback.length;
    const meleeBedMixer = new CombatAudio();
    const meleeBedSources = buildCombatAudioSources(Array.from(
      { length: 16 },
      (_, index) => ({
        id: `melee-bed-${index}`,
        faction: index % 2 === 0 ? 'guard' as const : 'raider' as const,
        status: 'fighting' as const,
        health: 80,
        x: index * 0.15,
        z: index % 3 * 0.2,
      }),
    ));
    meleeBedMixer.tick(0, meleeBedSources, closeCombatView);
    meleeBedMixer.tick(0.4, meleeBedSources, closeCombatView);
    const meleeBedVoices = combatPlayback.slice(meleeBedStart)
      .filter((audio) => audio.plays === 1);
    invariant(
      meleeBedVoices.length === COMBAT_AUDIO_MAX_SCHEDULED_PLAYS_PER_TICK
      && new Set(meleeBedVoices.map((audio) => audio.playbackRate)).size > 1,
      'a dense melee tick should layer three independently pitched weapon clashes',
    );
    meleeBedMixer.dispose();

    const chargeStart = combatPlayback.length;
    const chargeMixer = new CombatAudio();
    const chargeSources = buildCombatAudioSources([
      { id: 'charge-one', faction: 'spearman', status: 'advancing', health: 80, x: 0, z: 0, targetKind: 'combat-agent' },
      { id: 'charge-two', faction: 'raider', status: 'advancing', health: 80, x: 1, z: 0, targetKind: 'combat-agent' },
    ]);
    chargeMixer.tick(0, chargeSources, closeCombatView);
    chargeMixer.tick(1.8, chargeSources, closeCombatView);
    const chargeVoices = combatPlayback.slice(chargeStart);
    const chargeHumanVoices = chargeVoices.slice(0, COMBAT_AUDIO_VOICE_POOL_SIZE);
    const chargeMovementVoices = chargeVoices.slice(COMBAT_AUDIO_VOICE_POOL_SIZE);
    invariant(
      chargeMovementVoices.length === COMBAT_AUDIO_CHARGE_POOL_SIZE
      && chargeMovementVoices.filter((audio) => (
        audio.plays === 1
        && /\/sounds\/combat\/formation_charge_\d+\.mp3/.test(audio.src)
      )).length === 1
      && chargeHumanVoices.length === COMBAT_AUDIO_VOICE_POOL_SIZE
      && chargeHumanVoices.filter((audio) => (
        audio.plays === 1
        && /\/sounds\/combat\/voices\/(?:defender|raider)_charge_\d+\.mp3/.test(audio.src)
      )).length === 1,
      'combat-target advances should layer bounded formation movement and one quiet charge effort',
    );
    chargeMixer.dispose();

    const reactionStart = combatPlayback.length;
    const reactionMixer = new CombatAudio();
    const reactionSources = buildCombatAudioSources([{
      id: 'defender-reaction',
      faction: 'guard',
      status: 'fighting',
      health: 100,
      x: 0,
      z: 0,
      attackCooldown: 0,
    }]);
    const reactionSource = reactionSources[0]!;
    reactionMixer.tick(0, reactionSources, closeCombatView);
    reactionSource.health = 70;
    reactionMixer.tick(0.016, reactionSources, closeCombatView);
    reactionSource.status = 'retreating';
    reactionSource.phase = 'flee';
    reactionMixer.tick(0.016, reactionSources, closeCombatView);
    const reactionVoices = combatPlayback.slice(reactionStart);
    invariant(
      reactionVoices.length === COMBAT_AUDIO_VOICE_POOL_SIZE
      && reactionVoices.filter((audio) => (
        audio.plays === 1
        && /\/sounds\/combat\/voices\/defender_damage_\d+\.mp3/.test(audio.src)
      )).length === 1
      && reactionVoices.every((audio) => (
        !/(?:selo|person_attack|angry_fighting)/i.test(audio.src)
      )),
      'back-to-back health and retreat edges should collapse to one quiet nonverbal reaction',
    );
    reactionMixer.dispose();

    const battleVoiceStart = combatPlayback.length;
    const battleVoiceMixer = new CombatAudio();
    const battleVoiceSources = buildCombatAudioSources([{
      id: 'raider-battle-voice',
      faction: 'raider',
      status: 'fighting',
      health: 100,
      x: 0,
      z: 0,
    }]);
    battleVoiceMixer.tick(0, battleVoiceSources, closeCombatView);
    battleVoiceMixer.tick(6.5, battleVoiceSources, closeCombatView);
    invariant(
      combatPlayback.slice(battleVoiceStart).some((audio) => (
        audio.plays === 1
        && /\/sounds\/combat\/voices\/raider_battle_\d+\.mp3/.test(audio.src)
      )),
      'active raider melee should receive sparse nonverbal battle exertions',
    );
    battleVoiceMixer.dispose();

    const fleeVoiceStart = combatPlayback.length;
    const fleeVoiceMixer = new CombatAudio();
    const fleeVoiceSources = buildCombatAudioSources([{
      id: 'raider-flee-voice',
      faction: 'bandit',
      status: 'retreating',
      health: 40,
      x: 0,
      z: 0,
    }]);
    fleeVoiceMixer.tick(0, fleeVoiceSources, closeCombatView);
    fleeVoiceMixer.tick(3.5, fleeVoiceSources, closeCombatView);
    invariant(
      combatPlayback.slice(fleeVoiceStart).some((audio) => (
        audio.plays === 1
        && /\/sounds\/combat\/voices\/raider_flee_\d+\.mp3/.test(audio.src)
      )),
      'retreating raiders should receive sparse nonverbal flee panic',
    );
    fleeVoiceMixer.dispose();

    const voiceStressStart = combatPlayback.length;
    const voiceStressMixer = new CombatAudio();
    const voiceStressSources = buildCombatAudioSources(Array.from(
      { length: 120 },
      (_, index) => ({
        id: `voice-stress-${index}`,
        faction: index % 2 === 0 ? 'guard' as const : 'raider' as const,
        status: 'fighting' as const,
        health: 100,
        x: (index % 12) * 0.3,
        z: Math.floor(index / 12) * 0.3,
      }),
    ));
    voiceStressMixer.tick(0, voiceStressSources, closeCombatView);
    for (const source of voiceStressSources) source.health = 80;
    voiceStressMixer.tick(0.016, voiceStressSources, closeCombatView);
    const voiceStressPool = combatPlayback.slice(voiceStressStart);
    invariant(
      voiceStressSources.length === COMBAT_AUDIO_MAX_SOURCES
      && voiceStressPool.length === COMBAT_AUDIO_VOICE_POOL_SIZE
      && voiceStressPool.filter((audio) => audio.plays === 1).length
        === COMBAT_AUDIO_MAX_VOICE_EDGE_PLAYS_PER_TICK,
      'a 100-plus-agent damage burst must collapse to one reaction in a four-voice pool',
    );
    voiceStressMixer.dispose();

    const deathStart = combatPlayback.length;
    const deathMixer = new CombatAudio();
    const superCloseCombatView = {
      ...closeCombatView,
      orbitDistance: 8,
    };
    invariant(
      deathMixer.playDeath('death-one', 'man', 0, 0, superCloseCombatView)
      && !deathMixer.playDeath('death-clustered', 'woman', 0, 0, superCloseCombatView)
      && !deathMixer.playDeath('death-far', 'man', 0, 0, {
        ...superCloseCombatView,
        orbitDistance: COMBAT_AUDIO_VOICE_MAX_ZOOM_DISTANCE,
      }),
      'death voices should play only near the camera and collapse clustered casualties',
    );
    deathMixer.tick(0.5, [], superCloseCombatView);
    invariant(
      deathMixer.playDeath('death-two', 'woman', 0, 0, superCloseCombatView),
      'a later nearby casualty should remain audible after the death-voice interval',
    );
    const deathVoices = combatPlayback.slice(deathStart);
    const playedDeathVoices = deathVoices.filter((audio) => audio.plays === 1);
    invariant(
      deathVoices.length === 2
      && playedDeathVoices.length === 2
      && playedDeathVoices.every((audio) => (
        audio.volume > 0
        && audio.volume < 0.04
        && /\/sounds\/combat\/selo\/(?:male|female)_dying_\d+\.mp3/.test(audio.src)
      ))
      && playedDeathVoices[0]?.playbackRate !== playedDeathVoices[1]?.playbackRate,
      'death voices should stay far below weapon level and vary character pitch',
    );
    deathMixer.dispose();
  } finally {
    if (audioDescriptor) {
      Object.defineProperty(globalThis, 'Audio', audioDescriptor);
    } else {
      delete (globalThis as { Audio?: unknown }).Audio;
    }
  }

  if (REQUIRE_GENERATED) {
    invariant(
      missingRuntimeFiles.length === 0,
      `Generated runtime files are missing:\n${missingRuntimeFiles.join('\n')}`,
    );
    const report = JSON.parse(
      await readFile(REPORT_PATH, 'utf8'),
    ) as { schemaVersion: number; generations: GenerationRecord[] };
    invariant(report.schemaVersion === 1, 'Unsupported generation report schema.');
    const records = new Map(report.generations.map((record) => [record.id, record]));
    for (const asset of manifest.assets) {
      const filename = normalizedAssetOutput(asset.output);
      invariant(await isReadableFile(filename), `Generated output is missing: ${asset.output}`);
      await assertMp3(filename);
      const record = records.get(asset.id);
      invariant(record, `Generation report is missing ${asset.id}`);
      invariant(record.output === asset.output, `Generation output mismatch for ${asset.id}`);
      invariant(
        record.modelId === (
          asset.kind === 'music' ? 'music_v2' : 'eleven_text_to_sound_v2'
        ),
        `Generation model mismatch for ${asset.id}`,
      );
      invariant(record.byteLength === (await stat(filename)).size, `Byte count mismatch for ${asset.id}`);
      invariant(record.sha256 === await sha256(filename), `SHA-256 mismatch for ${asset.id}`);
    }
    const deathHashes = combatDeathAssets.map((asset) => records.get(asset.id)?.sha256);
    invariant(
      deathHashes.every(Boolean) && new Set(deathHashes).size === combatDeathAssets.length,
      'Every generated death reaction must have distinct encoded audio',
    );
  }

  console.log(
    `Audio pipeline valid: ${manifest.assets.length} generated targets,`
    + ` ${runtimeClips().length} runtime clip references,`
    + ` ${missingRuntimeFiles.length} files pending generation.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
