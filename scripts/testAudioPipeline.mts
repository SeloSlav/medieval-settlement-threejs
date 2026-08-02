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
  CHURCH_BELL_CLIP,
  COMBAT_AUDIO_CLIPS,
  FARM_WORKERS_SINGING_CLIP,
  FIRE_CRACKLE_CLIP,
  MUSIC_TRACKS,
  RIVER_WATER_CLIP,
  UI_SOUNDS,
  WORKER_ACTIVITY_CLIPS,
  type AudioClipDefinition,
} from '../src/audio/audioCatalog.ts';
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
  evaluateAmbientRules,
  OVERVIEW_ENTER_DISTANCE,
  OVERVIEW_EXIT_DISTANCE,
  selectAmbientWeatherLayer,
} from '../src/audio/ambientRules.ts';
import {
  DEFAULT_AMBIENCE_VOLUME,
  DEFAULT_MUSIC_VOLUME,
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
    CHURCH_BELL_CLIP,
    RIVER_WATER_CLIP,
    FARM_WORKERS_SINGING_CLIP,
    FIRE_CRACKLE_CLIP,
    ...Object.values(MUSIC_TRACKS),
    ...Object.values(UI_SOUNDS),
    ...Object.values(WORKER_ACTIVITY_CLIPS).flat(),
    ...Object.values(COMBAT_AUDIO_CLIPS).flat(),
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
    shadowRadius: 80,
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
