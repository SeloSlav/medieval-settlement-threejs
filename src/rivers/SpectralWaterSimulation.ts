import * as THREE from 'three';
import {
  StorageTexture,
  WebGPURenderer,
  type ComputeNode,
} from 'three/webgpu';
import {
  Fn,
  exp,
  float,
  int,
  instanceIndex,
  ivec2,
  max,
  min,
  round,
  smoothstep,
  textureLoad,
  textureStore,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { WaterSurfaceProfileId } from './WaterSurfaceProfile.ts';

/**
 * Spectral sea port adapted from siliconjungle/inkwell-webgpu-water.
 *
 * The source implementation is MIT licensed, Copyright (c) 2026 James Addison.
 * See vendor/inkwell-webgpu-water/LICENSE and README.md in that directory.
 *
 * This adapter keeps the reference's deterministic JONSWAP/TMA cascade data,
 * conjugate packing, two-field Stockham IFFT, fold derivatives, and persistent
 * compression foam. Three.js owns the GPU resources and command submission so
 * the result can be sampled directly by the game's TSL water material.
 */

export const SPECTRAL_WATER_RESOLUTION = 128;
export const SPECTRAL_WATER_LOG_SIZE = Math.log2(SPECTRAL_WATER_RESOLUTION);
export const SPECTRAL_WATER_SEED = 0x51f15e;

export type SpectralCascadeConfig = Readonly<{
  lengthScale: number;
  cutoffLow: number;
  cutoffHigh: number;
  amplitudeScale: number;
  choppiness: number;
  secondaryScale: number;
  seed: number;
  /** Finest resolved wavelength, used for footprint-based material LOD. */
  shortestWavelength: number;
  /** This cascade affects geometry as well as normals. */
  displacesMesh: boolean;
}>;

export const SPECTRAL_WATER_CASCADES: readonly SpectralCascadeConfig[] = Object.freeze([
  Object.freeze({
    lengthScale: 240,
    cutoffLow: 0.024,
    cutoffHigh: 0.30,
    amplitudeScale: 0.45,
    choppiness: 1.18,
    secondaryScale: 0.22,
    seed: SPECTRAL_WATER_SEED,
    shortestWavelength: 17.45,
    displacesMesh: true,
  }),
  Object.freeze({
    lengthScale: 64,
    cutoffLow: 0.30,
    cutoffHigh: 1.22,
    amplitudeScale: 0.45,
    choppiness: 1.05,
    secondaryScale: 0.08,
    seed: 0x72a93b,
    shortestWavelength: 5.15,
    displacesMesh: true,
  }),
  // Decimetre-to-metre waves shade the interface only. Carrying this band
  // into the game mesh would alias at strategic-camera tessellation density.
  Object.freeze({
    lengthScale: 12,
    cutoffLow: 1.22,
    cutoffHigh: 24,
    amplitudeScale: 0.82,
    choppiness: 0.4,
    secondaryScale: 0,
    seed: 0x19ce47,
    shortestWavelength: 0.262,
    displacesMesh: false,
  }),
]);

export const SPECTRAL_WATER_CASCADE_COUNT = SPECTRAL_WATER_CASCADES.length;

export type SpectralCascadeData = Readonly<{
  initialSpectrum: Float32Array;
  waveData: Float32Array;
}>;

export type SpectralCascadeBinding = Readonly<{
  config: SpectralCascadeConfig;
  field0: StorageTexture;
  field1: StorageTexture;
  foam0: StorageTexture;
  foam1: StorageTexture;
}>;

export type SpectralWaterBinding = Readonly<{
  resolution: number;
  cascades: readonly SpectralCascadeBinding[];
  foamPing: ReturnType<typeof uniform>;
}>;

type CascadeRuntime = {
  binding: SpectralCascadeBinding;
  initialTexture: THREE.DataTexture;
  waveTexture: THREE.DataTexture;
  fieldPing: readonly [readonly [StorageTexture, StorageTexture], readonly [StorageTexture, StorageTexture]];
  evolutionNode: ComputeNode;
  fftNodes: readonly ComputeNode[];
  foamNodes: readonly [ComputeNode, ComputeNode];
};

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function spectrumNormalisationFactor(spread: number): number {
  const s2 = spread * spread;
  const s3 = s2 * spread;
  const s4 = s3 * spread;
  return spread < 5
    ? -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * spread + 0.163
    : -4.8e-8 * s4 + 1.07e-5 * s3 - 9.53e-4 * s2 + 5.9e-2 * spread + 0.393;
}

export function buildSpectralCascadeData(
  size: number,
  config: SpectralCascadeConfig,
): SpectralCascadeData {
  if (!Number.isInteger(Math.log2(size))) {
    throw new Error('Spectral water resolution must be a power of two.');
  }

  const { lengthScale, cutoffLow, cutoffHigh, amplitudeScale, secondaryScale, seed } = config;
  const gravity = 9.81;
  const depth = 54;
  const windSpeed = 11.5;
  const fetch = 120_000;
  const windAngle = -0.48;
  const peakEnhancement = 3.3;
  const swell = 0.38;
  const deltaK = Math.PI * 2 / lengthScale;
  const alpha = 0.076 * Math.pow(gravity * fetch / (windSpeed * windSpeed), -0.22);
  const peakOmega = 22 * Math.pow(windSpeed * fetch / (gravity * gravity), -0.33);
  const initialK = new Float32Array(size * size * 2);
  const waveData = new Float32Array(size * size * 4);
  const random = deterministicRandom(seed);
  const gaussian = (): readonly [number, number] => {
    const u = Math.max(random(), 1e-7);
    const v = random();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = Math.PI * 2 * v;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x - size / 2;
      const nz = y - size / 2;
      const kx = nx * deltaK;
      const kz = nz * deltaK;
      const kLength = Math.hypot(kx, kz);
      const pixel = y * size + x;
      const waveOffset = pixel * 4;
      if (kLength < cutoffLow || kLength > cutoffHigh) {
        waveData.set([0, 1, 0, 0], waveOffset);
        continue;
      }

      const kh = Math.min(kLength * depth, 20);
      const tanhKh = Math.tanh(kh);
      const omega = Math.sqrt(gravity * kLength * tanhKh);
      const sechSquared = 1 - tanhKh * tanhKh;
      const frequencyDerivative = gravity * (depth * kLength * sechSquared + tanhKh)
        / Math.max(omega * 2, 1e-5);
      const omegaH = omega * Math.sqrt(depth / gravity);
      const tma = omegaH <= 1
        ? 0.5 * omegaH * omegaH
        : omegaH < 2
          ? 1 - 0.5 * (2 - omegaH) * (2 - omegaH)
          : 1;
      const sigma = omega <= peakOmega ? 0.07 : 0.09;
      const peakDistance = (omega - peakOmega) / Math.max(sigma * peakOmega, 1e-5);
      const peakShape = Math.exp(-0.5 * peakDistance * peakDistance);
      const peakRatio = peakOmega / omega;
      const jonswap = tma * alpha * gravity * gravity / Math.pow(omega, 5)
        * Math.exp(-1.25 * Math.pow(peakRatio, 4))
        * Math.pow(peakEnhancement, peakShape);
      const theta = wrapAngle(Math.atan2(kz, kx) - windAngle);
      const omegaRatio = omega / peakOmega;
      const spreadPower = (
        (omega > peakOmega
          ? 9.77 * Math.pow(omegaRatio, -2.5)
          : 6.97 * Math.pow(omegaRatio, 5))
        + 16 * Math.tanh(Math.min(omegaRatio, 20)) * swell * swell
      ) * 0.58;
      const focusedDirection = spectrumNormalisationFactor(spreadPower)
        * Math.pow(Math.abs(Math.cos(theta * 0.5)), 2 * spreadPower);
      const broadDirection = 2 / Math.PI * Math.pow(Math.max(Math.cos(theta), 0), 2);
      const direction = focusedDirection * 0.68 + broadDirection * 0.32;
      const shortWaveFade = Math.exp(-0.00016 * kLength * kLength);
      let spectralDensity = jonswap * direction * shortWaveFade;

      if (secondaryScale > 0) {
        const swellWindSpeed = 8.4;
        const swellFetch = 310_000;
        const swellPeakOmega = 22
          * Math.pow(swellWindSpeed * swellFetch / (gravity * gravity), -0.33);
        const swellAlpha = 0.076
          * Math.pow(gravity * swellFetch / (swellWindSpeed * swellWindSpeed), -0.22);
        const swellSigma = omega <= swellPeakOmega ? 0.07 : 0.09;
        const swellPeakDistance = (omega - swellPeakOmega)
          / Math.max(swellSigma * swellPeakOmega, 1e-5);
        const swellPeakShape = Math.exp(-0.5 * swellPeakDistance * swellPeakDistance);
        const swellPeakRatio = swellPeakOmega / omega;
        const swellSpectrum = tma * swellAlpha * gravity * gravity / Math.pow(omega, 5)
          * Math.exp(-1.25 * Math.pow(swellPeakRatio, 4))
          * Math.pow(2.6, swellPeakShape);
        const swellTheta = wrapAngle(Math.atan2(kz, kx) - (windAngle + 0.82));
        const swellRatio = omega / swellPeakOmega;
        const swellSpread = (
          (omega > swellPeakOmega
            ? 9.77 * Math.pow(swellRatio, -2.5)
            : 6.97 * Math.pow(swellRatio, 5))
          + 9
        ) * 0.72;
        const swellDirection = spectrumNormalisationFactor(swellSpread)
          * Math.pow(Math.abs(Math.cos(swellTheta * 0.5)), 2 * swellSpread);
        spectralDensity += swellSpectrum * swellDirection * shortWaveFade * secondaryScale;
      }

      const amplitude = Math.sqrt(Math.max(
        0,
        2 * spectralDensity * Math.abs(frequencyDerivative) / kLength * deltaK * deltaK,
      )) * amplitudeScale;
      const noise = gaussian();
      initialK[pixel * 2] = noise[0] * amplitude;
      initialK[pixel * 2 + 1] = noise[1] * amplitude;
      waveData.set([kx, 1 / kLength, kz, omega], waveOffset);
    }
  }

  const initialSpectrum = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      const mirror = ((size - y) % size) * size + ((size - x) % size);
      initialSpectrum.set([
        initialK[pixel * 2],
        initialK[pixel * 2 + 1],
        initialK[mirror * 2],
        -initialK[mirror * 2 + 1],
      ], pixel * 4);
    }
  }
  return { initialSpectrum, waveData };
}

export function buildStockhamTwiddle(size: number): Float32Array {
  const logSize = Math.log2(size);
  if (!Number.isInteger(logSize)) {
    throw new Error('Stockham IFFT size must be a power of two.');
  }
  const twiddle = new Float32Array(logSize * size * 4);
  for (let stage = 0; stage < logSize; stage++) {
    const block = size >> (stage + 1);
    for (let output = 0; output < size / 2; output++) {
      const first = (2 * block * Math.floor(output / block) + output % block) % size;
      const angle = -2 * Math.PI / size * Math.floor(output / block) * block;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const base = (stage * size + output) * 4;
      const opposite = (stage * size + output + size / 2) * 4;
      twiddle.set([cosine, sine, first, first + block], base);
      twiddle.set([-cosine, -sine, first, first + block], opposite);
    }
  }
  return twiddle;
}

type Complex = readonly [number, number];

function transformStockhamAxis(
  input: readonly Complex[],
  size: number,
  axis: 'x' | 'y',
  twiddle: Float32Array,
): Complex[] {
  let source = input.map((value) => [value[0], value[1]] as Complex);
  const logSize = Math.log2(size);
  for (let stage = 0; stage < logSize; stage++) {
    const output: Complex[] = new Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const transformIndex = axis === 'x' ? x : y;
        const tableOffset = (stage * size + transformIndex) * 4;
        const twiddleReal = twiddle[tableOffset];
        const twiddleImag = -twiddle[tableOffset + 1];
        const first = Math.round(twiddle[tableOffset + 2]);
        const second = Math.round(twiddle[tableOffset + 3]);
        const indexA = axis === 'x' ? y * size + first : first * size + x;
        const indexB = axis === 'x' ? y * size + second : second * size + x;
        const a = source[indexA];
        const b = source[indexB];
        output[y * size + x] = [
          a[0] + twiddleReal * b[0] - twiddleImag * b[1],
          a[1] + twiddleReal * b[1] + twiddleImag * b[0],
        ];
      }
    }
    source = output;
  }
  return source;
}

/** CPU contract for the two canonical centered-spectrum IFFT tests. */
export function validateSpectralIfft(size = 8): Readonly<{
  dcMaxError: number;
  frequencyMaxError: number;
}> {
  const twiddle = buildStockhamTwiddle(size);
  const transform = (input: Complex[]): Complex[] => {
    const horizontal = transformStockhamAxis(input, size, 'x', twiddle);
    const vertical = transformStockhamAxis(horizontal, size, 'y', twiddle);
    return vertical.map((value, index) => {
      const x = index % size;
      const y = Math.floor(index / size);
      const checker = (x + y) % 2 === 0 ? 1 : -1;
      return [value[0] * checker, value[1] * checker] as Complex;
    });
  };

  const dc = Array.from({ length: size * size }, () => [0, 0] as Complex);
  dc[(size / 2) * size + size / 2] = [1, 0];
  const dcSpatial = transform(dc);
  let dcMaxError = 0;
  for (const value of dcSpatial) {
    dcMaxError = Math.max(dcMaxError, Math.abs(value[0] - 1), Math.abs(value[1]));
  }

  const frequency = Array.from({ length: size * size }, () => [0, 0] as Complex);
  frequency[(size / 2) * size + size / 2 + 1] = [1, 0];
  const frequencySpatial = transform(frequency);
  let frequencyMaxError = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = frequencySpatial[y * size + x];
      const angle = 2 * Math.PI * x / size;
      frequencyMaxError = Math.max(
        frequencyMaxError,
        Math.abs(value[0] - Math.cos(angle)),
        Math.abs(value[1] - Math.sin(angle)),
      );
    }
  }
  return { dcMaxError, frequencyMaxError };
}

function createDataTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createStorageTexture(size: number, name: string, filter = THREE.LinearFilter): StorageTexture {
  const texture = new StorageTexture(size, size);
  texture.name = name;
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.mipmapsAutoUpdate = false;
  texture.needsUpdate = true;
  return texture;
}

function complexMultiply(a: any, b: any): any {
  return vec2(
    a.x.mul(b.x).sub(a.y.mul(b.y)),
    a.x.mul(b.y).add(a.y.mul(b.x)),
  );
}

function butterfly(a: any, b: any, twiddle: any): any {
  const lower = complexMultiply(twiddle, b.xy);
  const upper = complexMultiply(twiddle, b.zw);
  return vec4(a.xy.add(lower), a.zw.add(upper));
}

function createEvolutionNode(options: {
  size: number;
  initialTexture: THREE.DataTexture;
  waveTexture: THREE.DataTexture;
  output0: StorageTexture;
  output1: StorageTexture;
  timeNode: any;
  name: string;
}): ComputeNode {
  const computeFn = Fn(() => {
    const x = int(instanceIndex.mod(options.size));
    const y = int(instanceIndex.div(options.size));
    const coord = ivec2(x, y);
    const initial = textureLoad(options.initialTexture, coord);
    const wave = textureLoad(options.waveTexture, coord);
    const phase = wave.w.mul(options.timeNode);
    const exponent = vec2(phase.cos(), phase.sin()) as any;
    const h: any = complexMultiply(initial.xy, exponent)
      .add(complexMultiply(initial.zw, vec2(exponent.x, exponent.y.negate())));
    const ih = vec2(h.y.negate(), h.x) as any;
    const displacementX = ih.mul(wave.x).mul(wave.y);
    const displacementY = h;
    const displacementZ = ih.mul(wave.z).mul(wave.y);
    const displacementXdx = h.negate().mul(wave.x).mul(wave.x).mul(wave.y);
    const displacementYdx = ih.mul(wave.x);
    const displacementZdx = h.negate().mul(wave.x).mul(wave.z).mul(wave.y);
    const displacementYdz = ih.mul(wave.z);
    const displacementZdz = h.negate().mul(wave.z).mul(wave.z).mul(wave.y);
    const dxDz = vec2(
      displacementX.x.sub(displacementZ.y),
      displacementX.y.add(displacementZ.x),
    );
    const dyDxz = vec2(
      displacementY.x.sub(displacementZdx.y),
      displacementY.y.add(displacementZdx.x),
    );
    const dyxDyz = vec2(
      displacementYdx.x.sub(displacementYdz.y),
      displacementYdx.y.add(displacementYdz.x),
    );
    const dxxDzz = vec2(
      displacementXdx.x.sub(displacementZdz.y),
      displacementXdx.y.add(displacementZdz.x),
    );
    textureStore(options.output0, coord, vec4(dxDz, dyDxz)).toWriteOnly();
    textureStore(options.output1, coord, vec4(dyxDyz, dxxDzz)).toWriteOnly();
  });
  return computeFn().compute(options.size * options.size, [64]).setName(options.name);
}

function createFftNode(options: {
  size: number;
  stage: number;
  axis: 'x' | 'y';
  input0: StorageTexture;
  input1: StorageTexture;
  output0: StorageTexture;
  output1: StorageTexture;
  twiddleTexture: THREE.DataTexture;
  finalize: boolean;
  name: string;
}): ComputeNode {
  const computeFn = Fn(() => {
    const x = int(instanceIndex.mod(options.size));
    const y = int(instanceIndex.div(options.size));
    const transformIndex = options.axis === 'x' ? x : y;
    const table = textureLoad(options.twiddleTexture, ivec2(transformIndex, options.stage));
    const first = int(round(table.z));
    const second = int(round(table.w));
    const coord0 = options.axis === 'x' ? ivec2(first, y) : ivec2(x, first);
    const coord1 = options.axis === 'x' ? ivec2(second, y) : ivec2(x, second);
    const inverseTwiddle = vec2(table.x, table.y.negate());
    let value0: any = butterfly(
      textureLoad(options.input0, coord0),
      textureLoad(options.input0, coord1),
      inverseTwiddle,
    );
    let value1: any = butterfly(
      textureLoad(options.input1, coord0),
      textureLoad(options.input1, coord1),
      inverseTwiddle,
    );
    if (options.finalize) {
      const checker = (float(1) as any).sub(int(x.add(y)).mod(2).toFloat().mul(2));
      value0 = value0.mul(checker);
      value1 = value1.mul(checker);
    }
    const outputCoord = ivec2(x, y);
    textureStore(options.output0, outputCoord, value0).toWriteOnly();
    textureStore(options.output1, outputCoord, value1).toWriteOnly();
  });
  return computeFn().compute(options.size * options.size, [64]).setName(options.name);
}

function createFoamNode(options: {
  size: number;
  field0: StorageTexture;
  field1: StorageTexture;
  previous: StorageTexture;
  output: StorageTexture;
  choppiness: number;
  dtNode: any;
  name: string;
}): ComputeNode {
  const computeFn = Fn(() => {
    const x = int(instanceIndex.mod(options.size));
    const y = int(instanceIndex.div(options.size));
    const coord = ivec2(x, y);
    const field0 = textureLoad(options.field0, coord);
    const field1 = textureLoad(options.field1, coord);
    const previous = textureLoad(options.previous, coord).r;
    const crossDerivative = field0.a.mul(options.choppiness);
    const horizontalX = field1.b.mul(options.choppiness);
    const horizontalZ = field1.a.mul(options.choppiness);
    const jacobian = (float(1) as any).add(horizontalX)
      .mul((float(1) as any).add(horizontalZ))
      .sub(crossDerivative.mul(crossDerivative));
    const compression = max(float(0), (float(1) as any).sub(jacobian)) as any;
    const breaking = smoothstep(float(0.14), float(0.52), compression);
    const decay = exp(options.dtNode.mul(-0.58)) as any;
    const recovered = previous.mul(decay);
    const next = min(float(1), max(recovered, breaking));
    textureStore(options.output, coord, vec4(next, compression, jacobian, float(1))).toWriteOnly();
  });
  return computeFn().compute(options.size * options.size, [64]).setName(options.name);
}

function activeCascadeCount(profileId: WaterSurfaceProfileId): number {
  if (profileId === 'coastal') return SPECTRAL_WATER_CASCADE_COUNT;
  if (profileId === 'inland') return 2;
  return 0;
}

export class SpectralWaterSimulation {
  readonly binding: SpectralWaterBinding;

  private readonly renderer: WebGPURenderer;
  private readonly timeNode = uniform(0);
  private readonly dtNode = uniform(1 / 60);
  private readonly foamPingNode = uniform(0);
  private readonly twiddleTexture: THREE.DataTexture;
  private readonly runtimes: CascadeRuntime[];
  private readonly evolutionBatch: ComputeNode[];
  private readonly fftBatches: ComputeNode[][];
  private foamPing = 0;
  private disposed = false;

  static supportsProfile(profileId: WaterSurfaceProfileId): boolean {
    return activeCascadeCount(profileId) > 0;
  }

  constructor(renderer: WebGPURenderer, profileId: WaterSurfaceProfileId) {
    this.renderer = renderer;
    const size = SPECTRAL_WATER_RESOLUTION;
    const logSize = SPECTRAL_WATER_LOG_SIZE;
    const twiddleTexture = createDataTexture(buildStockhamTwiddle(size), size, logSize);
    twiddleTexture.name = 'Spectral water Stockham twiddle table';
    this.twiddleTexture = twiddleTexture;
    const runtimes: CascadeRuntime[] = [];

    for (const [cascadeIndex, config] of SPECTRAL_WATER_CASCADES
      .slice(0, activeCascadeCount(profileId)).entries()) {
      const data = buildSpectralCascadeData(size, config);
      const initialTexture = createDataTexture(data.initialSpectrum, size, size);
      const waveTexture = createDataTexture(data.waveData, size, size);
      initialTexture.name = `Spectral water cascade ${cascadeIndex} initial spectrum`;
      waveTexture.name = `Spectral water cascade ${cascadeIndex} wave data`;

      const fieldPing = [
        [
          createStorageTexture(size, `Spectral water cascade ${cascadeIndex} field 0 ping`),
          createStorageTexture(size, `Spectral water cascade ${cascadeIndex} field 1 ping`),
        ],
        [
          createStorageTexture(size, `Spectral water cascade ${cascadeIndex} field 0 pong`),
          createStorageTexture(size, `Spectral water cascade ${cascadeIndex} field 1 pong`),
        ],
      ] as const;
      const foam0 = createStorageTexture(
        size,
        `Spectral water cascade ${cascadeIndex} foam history ping`,
        THREE.LinearFilter,
      );
      const foam1 = createStorageTexture(
        size,
        `Spectral water cascade ${cascadeIndex} foam history pong`,
        THREE.LinearFilter,
      );
      const evolutionNode = createEvolutionNode({
        size,
        initialTexture,
        waveTexture,
        output0: fieldPing[0][0],
        output1: fieldPing[0][1],
        timeNode: this.timeNode,
        name: `Evolve spectral water cascade ${cascadeIndex}`,
      });
      const fftNodes: ComputeNode[] = [];
      let sourcePing = 0;
      for (const axis of ['x', 'y'] as const) {
        for (let stage = 0; stage < logSize; stage++) {
          const destinationPing = 1 - sourcePing;
          fftNodes.push(createFftNode({
            size,
            stage,
            axis,
            input0: fieldPing[sourcePing][0],
            input1: fieldPing[sourcePing][1],
            output0: fieldPing[destinationPing][0],
            output1: fieldPing[destinationPing][1],
            twiddleTexture,
            finalize: axis === 'y' && stage === logSize - 1,
            name: `IFFT spectral water cascade ${cascadeIndex} ${axis} stage ${stage}`,
          }));
          sourcePing = destinationPing;
        }
      }
      if (sourcePing !== 0) {
        throw new Error('Spectral IFFT parity changed; material binding must be updated.');
      }
      const foamNodes = [
        createFoamNode({
          size,
          field0: fieldPing[0][0],
          field1: fieldPing[0][1],
          previous: foam0,
          output: foam1,
          choppiness: config.choppiness,
          dtNode: this.dtNode,
          name: `Update spectral water cascade ${cascadeIndex} foam 0 to 1`,
        }),
        createFoamNode({
          size,
          field0: fieldPing[0][0],
          field1: fieldPing[0][1],
          previous: foam1,
          output: foam0,
          choppiness: config.choppiness,
          dtNode: this.dtNode,
          name: `Update spectral water cascade ${cascadeIndex} foam 1 to 0`,
        }),
      ] as const;
      const binding: SpectralCascadeBinding = {
        config,
        field0: fieldPing[0][0],
        field1: fieldPing[0][1],
        foam0,
        foam1,
      };
      runtimes.push({
        binding,
        initialTexture,
        waveTexture,
        fieldPing,
        evolutionNode,
        fftNodes,
        foamNodes,
      });
    }

    this.runtimes = runtimes;
    this.evolutionBatch = runtimes.map((runtime) => runtime.evolutionNode);
    this.fftBatches = Array.from({ length: logSize * 2 }, (_, stage) =>
      runtimes.map((runtime) => runtime.fftNodes[stage]));
    this.binding = {
      resolution: size,
      cascades: runtimes.map((runtime) => runtime.binding),
      foamPing: this.foamPingNode,
    };
  }

  update(timeSeconds: number, dtSeconds: number): void {
    if (this.disposed || this.runtimes.length === 0) return;
    this.timeNode.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    this.dtNode.value = THREE.MathUtils.clamp(
      Number.isFinite(dtSeconds) ? dtSeconds : 0,
      1 / 240,
      1 / 20,
    );

    // Independent cascades share one command pass per stage. Stage boundaries
    // remain explicit so every IFFT read observes the preceding writes.
    this.renderer.compute(this.evolutionBatch);
    for (const batch of this.fftBatches) this.renderer.compute(batch);
    const foamBatch = this.runtimes.map((runtime) => runtime.foamNodes[this.foamPing]);
    this.renderer.compute(foamBatch);
    this.foamPing = 1 - this.foamPing;
    this.foamPingNode.value = this.foamPing;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const runtime of this.runtimes) {
      runtime.evolutionNode.dispose();
      for (const node of runtime.fftNodes) node.dispose();
      for (const node of runtime.foamNodes) node.dispose();
      runtime.initialTexture.dispose();
      runtime.waveTexture.dispose();
      for (const pair of runtime.fieldPing) {
        pair[0].dispose();
        pair[1].dispose();
      }
      runtime.binding.foam0.dispose();
      runtime.binding.foam1.dispose();
    }
    this.twiddleTexture.dispose();
  }
}

export function createSpectralWaterSimulation(
  renderer: WebGPURenderer,
  profileId: WaterSurfaceProfileId,
): SpectralWaterSimulation | null {
  return SpectralWaterSimulation.supportsProfile(profileId)
    ? new SpectralWaterSimulation(renderer, profileId)
    : null;
}
