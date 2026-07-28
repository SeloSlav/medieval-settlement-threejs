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
