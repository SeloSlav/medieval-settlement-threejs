import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type SoundEffectAsset = {
  id: string;
  group: string;
  kind: 'sound-effect';
  output: string;
  prompt: string;
  durationSeconds: number;
  loop: boolean;
  promptInfluence: number;
};

type MusicAsset = {
  id: string;
  group: string;
  kind: 'music';
  output: string;
  prompt: string;
  musicLengthMs: number;
  forceInstrumental: boolean;
};

type AudioAsset = SoundEffectAsset | MusicAsset;

type AudioManifest = {
  schemaVersion: number;
  assets: AudioAsset[];
};

type GenerationRecord = {
  id: string;
  output: string;
  generatedAt: string;
  endpoint: string;
  modelId: string;
  outputFormat: string;
  sha256: string;
  byteLength: number;
  songId?: string;
  characterCost?: string;
};

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  'scripts',
  'audio',
  'elevenlabs-audio-manifest.json',
);
const GENERATION_REPORT_PATH = path.join(
  PROJECT_ROOT,
  'public',
  'sounds',
  'elevenlabs-generation.json',
);
const SOUND_EFFECT_MODEL = 'eleven_text_to_sound_v2';
const SOUND_EFFECT_FORMAT = 'mp3_44100_128';
const MUSIC_MODEL = 'music_v2';
const MUSIC_FORMAT = 'mp3_48000_192';
const SOUND_EFFECT_CREDITS_PER_SECOND = 40;

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[name] = value;
  }
  return result;
}

async function loadLocalApiKey(): Promise<string | undefined> {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  for (const filename of ['.env.audio.local', '.env.local']) {
    try {
      const values = parseEnvFile(
        await readFile(path.join(PROJECT_ROOT, filename), 'utf8'),
      );
      if (values.ELEVENLABS_API_KEY) return values.ELEVENLABS_API_KEY;
    } catch {
      // Optional local files are intentionally absent in a clean checkout.
    }
  }
  return undefined;
}

async function fileExists(filename: string): Promise<boolean> {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function selectedAssets(manifest: AudioManifest): {
  assets: AudioAsset[];
  force: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const ids = new Set<string>();
  const groups = new Set<string>();
  let all = false;
  let force = false;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--id') {
      const id = args[index + 1];
      if (!id) throw new Error('--id requires an asset id.');
      ids.add(id);
      index += 1;
    } else if (arg === '--group') {
      const group = args[index + 1];
      if (!group) throw new Error('--group requires a group name.');
      groups.add(group);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printUsage(manifest);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!all && ids.size === 0 && groups.size === 0) {
    printUsage(manifest);
    process.exit(0);
  }

  for (const id of ids) {
    if (!manifest.assets.some((asset) => asset.id === id)) {
      throw new Error(`Unknown asset id: ${id}`);
    }
  }
  for (const group of groups) {
    if (!manifest.assets.some((asset) => asset.group === group)) {
      throw new Error(`Unknown asset group: ${group}`);
    }
  }

  return {
    assets: manifest.assets.filter((asset) => (
      all || ids.has(asset.id) || groups.has(asset.group)
    )),
    force,
    dryRun,
  };
}

function printUsage(manifest: AudioManifest): void {
  const groups = [...new Set(manifest.assets.map((asset) => asset.group))];
  console.log('ElevenLabs game-audio generator');
  console.log('');
  console.log('Usage:');
  console.log('  npm run audio:generate -- --group soundtrack');
  console.log('  npm run audio:generate -- --id ambient-river --force');
  console.log('  npm run audio:generate -- --all --dry-run');
  console.log('  npm run audio:generate -- --all --force');
  console.log('');
  console.log(`Groups: ${groups.join(', ')}`);
  console.log(`Assets: ${manifest.assets.length}`);
  console.log('');
  console.log('The key is read from ELEVENLABS_API_KEY, .env.audio.local, or .env.local.');
  console.log('Existing files are skipped unless --force is supplied.');
}

function printCostEnvelope(assets: AudioAsset[]): void {
  const soundSeconds = assets.reduce(
    (total, asset) => total + (
      asset.kind === 'sound-effect' ? asset.durationSeconds : 0
    ),
    0,
  );
  const musicSeconds = assets.reduce(
    (total, asset) => total + (
      asset.kind === 'music' ? asset.musicLengthMs / 1000 : 0
    ),
    0,
  );
  console.log(
    `Selected ${assets.length} assets: ${soundSeconds.toFixed(1)} s of sound effects`
    + ` (~${Math.ceil(soundSeconds * SOUND_EFFECT_CREDITS_PER_SECOND)} credits at the documented`
    + ` duration-based rate) and ${musicSeconds.toFixed(0)} s of music.`,
  );
  console.log('Music cost depends on the current ElevenLabs plan and is not estimated here.');
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  let detail = text;
  try {
    const parsed = JSON.parse(text) as {
      detail?: unknown;
    };
    detail = typeof parsed.detail === 'string'
      ? parsed.detail
      : JSON.stringify(parsed.detail ?? parsed);
  } catch {
    // Plain-text and HTML failures are still useful as-is.
  }
  return new Error(
    `ElevenLabs request failed (${response.status} ${response.statusText}): ${detail}`,
  );
}

async function generateSoundEffect(
  asset: SoundEffectAsset,
  apiKey: string,
): Promise<{ bytes: Uint8Array; record: Omit<GenerationRecord, 'sha256' | 'byteLength'> }> {
  const endpoint = new URL('https://api.elevenlabs.io/v1/sound-generation');
  endpoint.searchParams.set('output_format', SOUND_EFFECT_FORMAT);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: asset.prompt,
      duration_seconds: asset.durationSeconds,
      loop: asset.loop,
      prompt_influence: asset.promptInfluence,
      model_id: SOUND_EFFECT_MODEL,
    }),
  });
  if (!response.ok) throw await responseError(response);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    record: {
      id: asset.id,
      output: asset.output,
      generatedAt: new Date().toISOString(),
      endpoint: endpoint.pathname,
      modelId: SOUND_EFFECT_MODEL,
      outputFormat: SOUND_EFFECT_FORMAT,
      characterCost: response.headers.get('character-cost') ?? undefined,
    },
  };
}

async function generateMusic(
  asset: MusicAsset,
  apiKey: string,
): Promise<{ bytes: Uint8Array; record: Omit<GenerationRecord, 'sha256' | 'byteLength'> }> {
  const endpoint = new URL('https://api.elevenlabs.io/v1/music');
  endpoint.searchParams.set('output_format', MUSIC_FORMAT);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      prompt: asset.prompt,
      music_length_ms: asset.musicLengthMs,
      model_id: MUSIC_MODEL,
      force_instrumental: asset.forceInstrumental,
      sign_with_c2pa: true,
    }),
  });
  if (!response.ok) throw await responseError(response);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    record: {
      id: asset.id,
      output: asset.output,
      generatedAt: new Date().toISOString(),
      endpoint: endpoint.pathname,
      modelId: MUSIC_MODEL,
      outputFormat: MUSIC_FORMAT,
      songId: response.headers.get('song-id') ?? undefined,
    },
  };
}

async function readGenerationReport(): Promise<GenerationRecord[]> {
  try {
    const parsed = JSON.parse(
      await readFile(GENERATION_REPORT_PATH, 'utf8'),
    ) as { generations?: GenerationRecord[] };
    return parsed.generations ?? [];
  } catch {
    return [];
  }
}

async function saveGenerationReport(records: GenerationRecord[]): Promise<void> {
  await mkdir(path.dirname(GENERATION_REPORT_PATH), { recursive: true });
  await writeFile(
    GENERATION_REPORT_PATH,
    `${JSON.stringify({
      schemaVersion: 1,
      note: 'Generated files only; the ElevenLabs API key is never stored here.',
      generations: records.sort((a, b) => a.id.localeCompare(b.id)),
    }, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, 'utf8'),
  ) as AudioManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error(`Unsupported audio manifest: ${MANIFEST_PATH}`);
  }

  const selection = selectedAssets(manifest);
  printCostEnvelope(selection.assets);
  if (selection.dryRun) {
    for (const asset of selection.assets) {
      console.log(`[dry-run] ${asset.id} -> ${asset.output}`);
    }
    return;
  }

  const apiKey = await loadLocalApiKey();
  if (!apiKey) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set. Put it in .env.audio.local (gitignored)'
      + ' or set it in the terminal environment.',
    );
  }

  const report = await readGenerationReport();
  const reportById = new Map(report.map((record) => [record.id, record]));

  for (const asset of selection.assets) {
    const outputPath = path.resolve(PROJECT_ROOT, asset.output);
    const relativeOutput = path.relative(PROJECT_ROOT, outputPath);
    if (!selection.force && await fileExists(outputPath)) {
      console.log(`[skip] ${asset.id}: ${relativeOutput} already exists`);
      continue;
    }

    console.log(`[generate] ${asset.id} -> ${relativeOutput}`);
    const generated = asset.kind === 'sound-effect'
      ? await generateSoundEffect(asset, apiKey)
      : await generateMusic(asset, apiKey);
    if (generated.bytes.byteLength === 0) {
      throw new Error(`ElevenLabs returned an empty file for ${asset.id}.`);
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated.bytes);
    const completeRecord: GenerationRecord = {
      ...generated.record,
      byteLength: generated.bytes.byteLength,
      sha256: createHash('sha256').update(generated.bytes).digest('hex'),
    };
    reportById.set(asset.id, completeRecord);
    await saveGenerationReport([...reportById.values()]);
    console.log(`[saved] ${asset.id}: ${generated.bytes.byteLength} bytes`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
