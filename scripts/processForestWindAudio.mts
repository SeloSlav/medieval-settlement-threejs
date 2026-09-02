import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SOURCE_PATH = path.resolve(
  PROJECT_ROOT,
  'vendor/seedthree/assets/audio/wind_temperate.wav',
);
const OUTPUT_PATH = path.resolve(
  PROJECT_ROOT,
  'public/sounds/ambient/forest_wind_temperate_soft.wav',
);

const LOW_PASS_HZ = 2_600;
const OUTPUT_GAIN_DB = -7.5;

type PcmWav = {
  channels: number;
  sampleRate: number;
  samples: Float64Array;
};

function decodeMonoPcm16Wav(bytes: Buffer): PcmWav {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Forest wind source must be a RIFF/WAVE file.');
  }

  let formatOffset = -1;
  let formatLength = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (chunkId === 'fmt ') {
      formatOffset = payloadOffset;
      formatLength = chunkLength;
    } else if (chunkId === 'data') {
      dataOffset = payloadOffset;
      dataLength = chunkLength;
    }
    offset = payloadOffset + chunkLength + (chunkLength & 1);
  }

  if (formatOffset < 0 || formatLength < 16 || dataOffset < 0) {
    throw new Error('Forest wind source is missing its format or data chunk.');
  }

  const format = bytes.readUInt16LE(formatOffset);
  const channels = bytes.readUInt16LE(formatOffset + 2);
  const sampleRate = bytes.readUInt32LE(formatOffset + 4);
  const bitsPerSample = bytes.readUInt16LE(formatOffset + 14);
  if (format !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('Forest wind processor expects mono 16-bit PCM input.');
  }

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Float64Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = bytes.readInt16LE(dataOffset + index * 2) / 32_768;
  }
  return { channels, sampleRate, samples };
}

function circularLowPass(
  samples: Float64Array,
  sampleRate: number,
  cutoffHz: number,
): Float64Array {
  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = ((1 - cosine) / 2) / a0;
  const b1 = (1 - cosine) / a0;
  const b2 = b0;
  const a1 = (-2 * cosine) / a0;
  const a2 = (1 - alpha) / a0;
  const output = new Float64Array(samples.length);

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  // Warming the filter on two complete cycles makes its state periodic before
  // the captured pass, avoiding an artificial transient at the loop seam.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (let index = 0; index < samples.length; index += 1) {
      const x0 = samples[index]!;
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      if (cycle === 2) output[index] = y0;
    }
  }
  return output;
}

function encodeMonoPcm16Wav(samples: Float64Array, sampleRate: number): Buffer {
  const dataLength = samples.length * 2;
  const bytes = Buffer.alloc(44 + dataLength);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataLength, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]!));
    bytes.writeInt16LE(Math.round(clamped * 32_767), 44 + index * 2);
  }
  return bytes;
}

function metrics(samples: Float64Array): { peak: number; rms: number; meanDelta: number } {
  let peak = 0;
  let squareSum = 0;
  let deltaSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
    if (index > 0) deltaSum += Math.abs(sample - samples[index - 1]!);
  }
  return {
    peak,
    rms: Math.sqrt(squareSum / samples.length),
    meanDelta: deltaSum / (samples.length - 1),
  };
}

const source = decodeMonoPcm16Wav(await readFile(SOURCE_PATH));
const filtered = circularLowPass(source.samples, source.sampleRate, LOW_PASS_HZ);
const gain = 10 ** (OUTPUT_GAIN_DB / 20);
for (let index = 0; index < filtered.length; index += 1) filtered[index] *= gain;

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, encodeMonoPcm16Wav(filtered, source.sampleRate));

console.log('Processed forest wind', {
  source: metrics(source.samples),
  output: metrics(filtered),
  cutoffHz: LOW_PASS_HZ,
  gainDb: OUTPUT_GAIN_DB,
  outputPath: path.relative(PROJECT_ROOT, OUTPUT_PATH),
});
