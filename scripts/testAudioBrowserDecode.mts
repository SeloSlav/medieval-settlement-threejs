import { createServer } from 'node:http';
import {
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  AMBIENT_LAYERS,
  BUILDING_AUDIO_CLIPS,
  CHURCH_BELL_CLIP,
  COMBAT_AUDIO_CLIPS,
  FARM_WORKERS_SINGING_CLIP,
  FIRE_CRACKLE_CLIP,
  MUSIC_TRACKS,
  RIVER_WATER_CLIP,
  UI_SOUNDS,
  WORKER_ACTIVITY_CLIPS,
  WORLD_FOLEY_CLIPS,
  type AudioClipDefinition,
} from '../src/audio/audioCatalog.ts';
import {
  DEFAULT_AMBIENCE_VOLUME,
  DEFAULT_MUSIC_VOLUME,
} from '../src/audio/audioPreferences.ts';
import { AMBIENT_SCORE_DUCK_GAIN } from '../src/audio/AmbientAudio.ts';

type AudioAsset = {
  id: string;
  kind: 'sound-effect' | 'music';
  output: string;
  durationSeconds?: number;
  musicLengthMs?: number;
  loop?: boolean;
};

type DecodeMetrics = {
  path: string;
  duration: number;
  sampleRate: number;
  channels: number;
  peak: number;
  rms: number;
  firstRms: number;
  lastRms: number;
  boundaryJump: number;
};

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DIST_ROOT = path.resolve(PROJECT_ROOT, 'dist');
const MANIFEST_PATH = path.resolve(
  PROJECT_ROOT,
  'scripts',
  'audio',
  'elevenlabs-audio-manifest.json',
);
const AUDIO_TEST_PATH = '/__audio_decode_test__';
// Lossy MP3 reconstruction can overshoot full scale slightly in floating-point
// decoders even when the encoded source is not hard-clipped.
const MAX_DECODED_PEAK = 1.2;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
    ...Object.values(BUILDING_AUDIO_CLIPS),
    ...Object.values(WORLD_FOLEY_CLIPS),
  ];
}

function contentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.mp3': return 'audio/mpeg';
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

async function startStaticServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(
        request.url ?? '/',
        'http://127.0.0.1',
      ).pathname;
      if (requestPath === AUDIO_TEST_PATH) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>Audio decode test</title>');
        return;
      }
      const relative = decodeURIComponent(requestPath).replace(/^\/+/, '');
      const filename = path.resolve(DIST_ROOT, relative || 'index.html');
      invariant(
        filename === DIST_ROOT || filename.startsWith(`${DIST_ROOT}${path.sep}`),
        'Request escaped dist.',
      );
      const fileStat = await stat(filename);
      invariant(fileStat.isFile(), 'Not a file.');
      response.writeHead(200, {
        'Content-Type': contentType(filename),
        'Content-Length': fileStat.size,
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(filename));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  invariant(address && typeof address === 'object', 'Static test server did not bind.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, 'utf8'),
  ) as { assets: AudioAsset[] };
  const expectedByPath = new Map(
    manifest.assets.map((asset) => [
      `/${asset.output.replace(/^public[\\/]/, '').replaceAll('\\', '/')}`,
      asset,
    ]),
  );
  const paths = [...new Set(runtimeClips().map((clip) => clip.path))].sort();
  const staticServer = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${staticServer.origin}${AUDIO_TEST_PATH}`);
    const metrics = await page.evaluate(async (audioPaths): Promise<DecodeMetrics[]> => {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const results: DecodeMetrics[] = [];
      try {
        for (const audioPath of audioPaths) {
          const response = await fetch(audioPath, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`${audioPath} returned HTTP ${response.status}`);
          }
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          let peak = 0;
          let sumSquares = 0;
          let sampleCount = 0;
          let firstSquares = 0;
          let lastSquares = 0;
          let edgeCount = 0;
          const edgeFrames = Math.max(1, Math.floor(buffer.sampleRate * 0.1));
          const stride = Math.max(1, Math.floor(buffer.length / 200_000));
          for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
            const channel = buffer.getChannelData(channelIndex);
            for (let index = 0; index < channel.length; index += stride) {
              const value = channel[index] ?? 0;
              peak = Math.max(peak, Math.abs(value));
              sumSquares += value * value;
              sampleCount += 1;
            }
            for (let index = 0; index < edgeFrames; index += 1) {
              const first = channel[index] ?? 0;
              const last = channel[channel.length - edgeFrames + index] ?? 0;
              firstSquares += first * first;
              lastSquares += last * last;
              edgeCount += 1;
            }
          }
          const firstSample = buffer.getChannelData(0)[0] ?? 0;
          const lastSample = buffer.getChannelData(0)[buffer.length - 1] ?? 0;
          results.push({
            path: audioPath,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
            peak,
            rms: Math.sqrt(sumSquares / Math.max(1, sampleCount)),
            firstRms: Math.sqrt(firstSquares / Math.max(1, edgeCount)),
            lastRms: Math.sqrt(lastSquares / Math.max(1, edgeCount)),
            boundaryJump: Math.abs(lastSample - firstSample),
          });
        }
      } finally {
        await context.close();
      }
      return results;
    }, paths);

    for (const metric of metrics) {
      invariant(Number.isFinite(metric.duration) && metric.duration > 0, `Invalid duration: ${metric.path}`);
      invariant(metric.sampleRate >= 22_050, `Low sample rate: ${metric.path}`);
      invariant(metric.channels >= 1 && metric.channels <= 2, `Unexpected channel count: ${metric.path}`);
      invariant(
        metric.peak > 0.001,
        `Silent decode peak ${metric.peak.toFixed(6)}: ${metric.path}`,
      );
      invariant(
        metric.peak <= MAX_DECODED_PEAK,
        `Clipped decode peak ${metric.peak.toFixed(6)}: ${metric.path}`,
      );
      invariant(metric.rms > 0.0001, `Decoded audio is effectively silent: ${metric.path}`);

      const asset = expectedByPath.get(metric.path);
      if (!asset) continue;
      const expectedDuration = asset.kind === 'music'
        ? (asset.musicLengthMs ?? 0) / 1000
        : asset.durationSeconds ?? 0;
      invariant(
        Math.abs(metric.duration - expectedDuration) <= 0.75,
        `${metric.path} duration ${metric.duration.toFixed(3)} s differs from requested`
        + ` ${expectedDuration.toFixed(3)} s.`,
      );
      if (asset.loop) {
        invariant(
          metric.firstRms > 0.0001 && metric.lastRms > 0.0001,
          `Loop has a silent encoded edge: ${metric.path}`,
        );
      }
    }

    const metricByPath = new Map(
      metrics.map((metric) => [metric.path, metric]),
    );
    const defaultEffectiveRms = (
      clip: AudioClipDefinition,
      preferenceGain: number,
    ): number => {
      const metric = metricByPath.get(clip.path);
      invariant(metric, `Missing decode metrics for ${clip.path}`);
      return metric.rms * (clip.volume ?? 1) * preferenceGain;
    };
    const scoreRmsValues = Object.values(MUSIC_TRACKS).map((clip) => (
      defaultEffectiveRms(clip, DEFAULT_MUSIC_VOLUME)
    ));
    const averageScoreRms =
      scoreRmsValues.reduce((sum, value) => sum + value, 0)
      / scoreRmsValues.length;
    const dayRms = defaultEffectiveRms(
      AMBIENT_LAYERS.birds_wind_day,
      DEFAULT_AMBIENCE_VOLUME,
    );
    const villageRms = defaultEffectiveRms(
      AMBIENT_LAYERS.village_day,
      DEFAULT_AMBIENCE_VOLUME,
    );
    const rainRms = defaultEffectiveRms(
      AMBIENT_LAYERS.light_rain,
      DEFAULT_AMBIENCE_VOLUME,
    );
    const busyAmbienceUnderScore = Math.hypot(dayRms, villageRms, rainRms)
      * AMBIENT_SCORE_DUCK_GAIN;
    const overviewWindRms = defaultEffectiveRms(
      AMBIENT_LAYERS.open_wind_overview,
      DEFAULT_AMBIENCE_VOLUME,
    );
    invariant(
      averageScoreRms >= busyAmbienceUnderScore * 1.2
      && averageScoreRms <= busyAmbienceUnderScore * 2.2,
      'Decoded score and busy ambience are outside the intended default balance',
    );
    invariant(
      overviewWindRms >= dayRms * 1.4
      && overviewWindRms <= dayRms * 2.2,
      'Decoded overview wind should be broader than the close daytime bed without dominating it',
    );

    const totalSeconds = metrics.reduce((sum, metric) => sum + metric.duration, 0);
    const quietest = [...metrics].sort((a, b) => a.rms - b.rms)[0];
    const loudest = [...metrics].sort((a, b) => b.rms - a.rms)[0];
    const highestPeak = [...metrics].sort((a, b) => b.peak - a.peak)[0];
    console.log(
      `Browser decoded ${metrics.length} runtime clips (${totalSeconds.toFixed(1)} s total).`,
    );
    console.log(
      `Decoded PCM range: RMS ${quietest.rms.toFixed(4)} (${quietest.path})`
      + ` to ${loudest.rms.toFixed(4)} (${loudest.path}).`,
    );
    console.log(
      `Highest decoded peak: ${highestPeak.peak.toFixed(4)} (${highestPeak.path}).`,
    );
    console.log(
      `Default mix RMS: score ${averageScoreRms.toFixed(4)},`
      + ` busy ambience under score ${busyAmbienceUnderScore.toFixed(4)},`
      + ` overview wind ${overviewWindRms.toFixed(4)}.`,
    );
    if (process.argv.includes('--mix-details')) {
      const clipByPath = new Map(
        runtimeClips().map((clip) => [clip.path, clip]),
      );
      for (const metric of metrics.filter((entry) => (
        entry.path.startsWith('/sounds/music/')
        || entry.path.startsWith('/sounds/combat/')
        || Object.values(AMBIENT_LAYERS).some((clip) => clip.path === entry.path)
      ))) {
        const clip = clipByPath.get(metric.path);
        const preferenceGain = metric.path.startsWith('/sounds/music/')
          ? DEFAULT_MUSIC_VOLUME
          : metric.path.startsWith('/sounds/combat/')
            ? 1
            : DEFAULT_AMBIENCE_VOLUME;
        const effectiveRms =
          metric.rms * (clip?.volume ?? 1) * preferenceGain;
        console.log(
          `${metric.path}: source RMS ${metric.rms.toFixed(4)},`
          + ` default effective RMS ${effectiveRms.toFixed(4)}`,
        );
      }
    }
  } finally {
    await browser.close();
    await staticServer.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
