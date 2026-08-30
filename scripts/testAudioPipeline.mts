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
  CHAPEL_BELL_CLIPS,
  COMBAT_AUDIO_CLIPS,
  COMBAT_DEATH_CLIPS,
  FARM_WORKERS_SINGING_CLIP,
  FIRE_CRACKLE_CLIP,
  MUSIC_TRACKS,
  OX_SELECTION_CLIPS,
  PERSON_SELECTION_CLIPS,
  RIVER_WATER_CLIP,
  UI_SOUNDS,
  WORKER_ACTIVITY_CLIPS,
  WORLD_FOLEY_CLIPS,
  type AudioClipDefinition,
} from '../src/audio/audioCatalog.ts';
import {
  AgentSelectionAudio,
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
  SEEDTHREE_TEMPERATE_WIND_URL,
} from '../src/audio/ForestWindAudio.ts';
import {
  FOREST_WIND_FIRST_PERSON_FLOOR,
  FOREST_WIND_SILENT_RTS_DISTANCE,
  forestWindTargetMix,
} from '../src/audio/forestWindRules.ts';
import {
  evaluateAmbientRules,
  OVERVIEW_ENTER_DISTANCE,
  OVERVIEW_EXIT_DISTANCE,
  selectAmbientWeatherLayer,
} from '../src/audio/ambientRules.ts';
import {
  DEFAULT_AMBIENCE_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SOUND_EFFECTS_VOLUME,
} from '../src/audio/audioPreferences.ts';
import { riverAudioGain } from '../src/audio/RiverAudio.ts';
import {
  buildCombatAudioSources,
  CombatAudio,
  combatAudioGain,
  COMBAT_AUDIO_CUTOFF_DISTANCE,
  COMBAT_AUDIO_MAX_SOURCES,
  COMBAT_AUDIO_MAX_ZOOM_DISTANCE,
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
const EXPECTED_SEEDTHREE_TEMPERATE_WIND_SHA256 =
  'abb8b3d6bd7988734b148bfda5135b740a54d4fe516ce1d71ee07e0cb3642328';

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
    ...Object.values(CHAPEL_BELL_CLIPS),
    RIVER_WATER_CLIP,
    FARM_WORKERS_SINGING_CLIP,
    FIRE_CRACKLE_CLIP,
    ...Object.values(MUSIC_TRACKS),
    ...Object.values(UI_SOUNDS),
    ...Object.values(PERSON_SELECTION_CLIPS).flat(),
    ...OX_SELECTION_CLIPS,
    ...Object.values(WORKER_ACTIVITY_CLIPS).flat(),
    ...Object.values(COMBAT_AUDIO_CLIPS).flat(),
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
    OVERVIEW_ENTER_DISTANCE - OVERVIEW_EXIT_DISTANCE >= 20,
    'Overview ambience needs enough zoom hysteresis to avoid wheel-boundary hunting',
  );
  const belowOverview = evaluateAmbientRules({
    settlementZones: [],
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: OVERVIEW_ENTER_DISTANCE - 0.01,
    previous: { overviewActive: false, villageActive: false },
    isNight: false,
  });
  const retainedOverview = evaluateAmbientRules({
    settlementZones: [],
    cameraTarget: { x: 0, z: 0 },
    orbitDistance: OVERVIEW_EXIT_DISTANCE + 0.01,
    previous: { overviewActive: true, villageActive: false },
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
  invariant(
    forestWindTargetMix({
      canopyCover: 1,
      orbitDistance: FOREST_WIND_SILENT_RTS_DISTANCE,
      firstPersonActive: false,
    }) === 0,
    'SeedThree forest wind must stay out of ordinary strategic views',
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
    'SeedThree forest wind must remain subtle and release more slowly than it enters',
  );
  const seedThreeWindPath = fileURLToPath(SEEDTHREE_TEMPERATE_WIND_URL);
  await assertWav(seedThreeWindPath);
  invariant(
    await sha256(seedThreeWindPath) === EXPECTED_SEEDTHREE_TEMPERATE_WIND_SHA256,
    'The SeedThree temperate wind loop does not match its vendored source hash',
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
  const chapelBellAssets = manifest.assets.filter((asset) => (
    asset.group === 'chapel-bells'
  ));
  invariant(
    chapelBellAssets.length === 3,
    'Chapel bells must provide one isolated toll for each church tier',
  );
  for (const tier of [1, 2, 3] as const) {
    const asset = chapelBellAssets.find((candidate) => (
      candidate.id === `chapel-bell-tier-${tier}`
    ));
    invariant(asset, `Missing tier-${tier} chapel bell`);
    invariant(
      asset.loop === false
      && asset.durationSeconds != null
      && asset.durationSeconds >= 6
      && asset.durationSeconds <= 8,
      `Tier-${tier} chapel bell must be one non-looping natural-decay toll`,
    );
    invariant(
      CHAPEL_BELL_CLIPS[tier].path
        === `/${asset.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`,
      `Tier-${tier} chapel bell runtime path differs from its manifest output`,
    );
  }
  invariant(
    buildingAudioTailGain(BUILDING_AUDIO_TAIL_SECONDS) === 1
    && buildingAudioTailGain(BUILDING_AUDIO_TAIL_SECONDS * 0.5) === 0.5
    && buildingAudioTailGain(0) === 0,
    'Building Foley needs a smooth playback-only tail envelope',
  );
  invariant(
    PERSON_SELECTION_CLIPS.male.length === 6
    && PERSON_SELECTION_CLIPS.female.length === 6
    && OX_SELECTION_CLIPS.length === 3,
    'Direct agent selection needs six legacy lines per voice and three ox reactions',
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
    invariant(
      selectionPlays.length === 4
      && selectionPlays[0]?.src === PERSON_SELECTION_CLIPS.male[0]?.path
      && selectionPlays[1]?.src === PERSON_SELECTION_CLIPS.male[1]?.path
      && selectionPlays[2]?.src === PERSON_SELECTION_CLIPS.female[0]?.path
      && selectionPlays[3]?.src === OX_SELECTION_CLIPS[0]?.path,
      'Direct clicks must choose the matching person voice or ox clip without repeating',
    );
    invariant(
      selectionPlays[0]?.volume === (PERSON_SELECTION_CLIPS.male[0]?.volume ?? 1) * 0.5
      && selectionPlays.every((play) => play.playbackRate >= 0.96 && play.playbackRate <= 1.04),
      'Selection acknowledgements must respect effects volume and restrained pitch variation',
    );
    selectionMixer.setEnabled(false);
    selectionMixer.play('man');
    invariant(selectionPlays.length === 4, 'Master audio mute must suppress selection cues');
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
        && audio.src === CHAPEL_BELL_CLIPS[2].path
        && audio.playbackRate === 1
      )),
      'Explicit chapel selection must use its tier toll at the original pitch',
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
  const worldAssets = manifest.assets.filter((asset) => (
    asset.group === 'world-foley' || asset.group === 'movement-foley'
  ));
  invariant(
    worldAssets.length === Object.keys(WORLD_FOLEY_CLIPS).length
    && worldAssets.length === 51,
    'World Foley manifest and runtime catalog must retain all 51 cues',
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
  const engagementSources = buildCombatAudioSources([
    { id: 'guard', faction: 'guard', status: 'fighting', health: 80, x: 0, z: 0 },
    { id: 'raider', faction: 'raider', status: 'fighting', health: 70, x: 2, z: 0 },
    { id: 'retreating', faction: 'raider', status: 'retreating', health: 40, x: 1, z: 0 },
  ]);
  invariant(
    engagementSources.length === 1
    && engagementSources[0]?.id === 'guard:raider',
    'only a live opposing pair in the fighting state should emit melee sound',
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
    reusableCombatSource?.id === 'Z-guard:a-raider',
    'combat pair IDs must preserve default UTF-16 sort ordering',
  );
  reusableCombatFighters[1]!.x = 4;
  const updatedCombatSources = buildCombatAudioSources(
    reusableCombatFighters,
    combatSourceWorkspace,
  );
  invariant(
    updatedCombatSources === reusableCombatSources
    && updatedCombatSources[0] === reusableCombatSource
    && updatedCombatSources[0]?.x === 2,
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
  const surroundedSource = buildCombatAudioSources([
    { id: 'guard-far', faction: 'guard', status: 'fighting', health: 80, x: 4, z: 0 },
    { id: 'guard-near', faction: 'guard', status: 'fighting', health: 80, x: 1, z: 0 },
    { id: 'raider-one', faction: 'raider', status: 'fighting', health: 70, x: 0, z: 0 },
  ]);
  invariant(
    surroundedSource.length === 1
    && surroundedSource[0]?.id === 'guard-near:raider-one',
    'a surrounded raider should emit one source at its nearest live opponent',
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
    'combat audio should retain one bounded source for every active raider',
  );
  invariant(
    combatPairingElapsedMs < 250,
    `combat audio pairing should remain bounded with 100,000 defenders; took ${combatPairingElapsedMs.toFixed(1)}ms`,
  );
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const combatPlayback: Array<{ paused: boolean; plays: number; volume: number }> = [];
  class FakeCombatAudioElement {
    paused = true;
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
    const combatMixer = new CombatAudio();
    combatMixer.tick(0, engagementSources, closeCombatView);
    combatMixer.tick(0.3, engagementSources, closeCombatView);
    invariant(
      combatPlayback.some((audio) => audio.plays > 0 && audio.volume > 0),
      'live close-range melee should trigger a spatially attenuated one-shot',
    );
    combatMixer.tick(0.1, [], closeCombatView);
    invariant(
      combatPlayback.every((audio) => audio.paused),
      'all melee one-shots should stop as soon as the live engagement ends',
    );
    combatMixer.dispose();
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
