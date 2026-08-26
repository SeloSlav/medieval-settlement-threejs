import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

export type PaintTextureSeed = number | string;

export interface PaintTextureOptions {
  /** Square texture resolution in pixels. Values are clamped to 32..2048. */
  size?: number;
  /** Stable numeric or string seed. */
  seed?: PaintTextureSeed;
  /** Large marks that form the blue-channel diffuse breakup. */
  broadStrokeCount?: number;
  /** Smaller marks that form the alpha-channel secondary breakup. */
  detailStrokeCount?: number;
  /** Density of the comb-like bristle ridges inside each mark. */
  bristleDensity?: number;
  /** Strength of the tangent-space normal encoded in red and green. */
  normalStrength?: number;
}

export interface PaintTextureMetadata {
  readonly width: number;
  readonly height: number;
  readonly seed: PaintTextureSeed;
  readonly seedHash: number;
  readonly seedHex: string;
  readonly broadStrokeCount: number;
  readonly detailStrokeCount: number;
  readonly bristleDensity: number;
  readonly normalStrength: number;
  readonly repeating: true;
  readonly channels: {
    readonly r: 'tangentNormalX';
    readonly g: 'tangentNormalY';
    readonly b: 'broadDiffuseStrokeMask';
    readonly a: 'secondaryDetailStrokeMask';
  };
}

export interface PaintTextureResult {
  readonly texture: DataTexture;
  readonly metadata: PaintTextureMetadata;
}

interface Stroke {
  readonly centerX: number;
  readonly centerY: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly cosine: number;
  readonly sine: number;
  readonly phase: number;
  readonly phase2: number;
  readonly bristleFrequency: number;
  readonly edgeFrequency: number;
  readonly height: number;
  readonly opacity: number;
  /** Broad per-mark tilt, matching the reference's randomized stroke normals. */
  readonly normalX: number;
  readonly normalY: number;
  readonly noiseSeed: number;
}

const TAU = Math.PI * 2;
const DEFAULT_SEED = 0x7f4a_7c15;

/**
 * Builds the packed painterly lookup used by the material.
 *
 * The generator is deliberately CPU-side and deterministic so the exact same
 * texture can be reproduced in screenshots, tests, and offline exports. All
 * structural fields wrap toroidally; mip filtering therefore remains clean at
 * UV tile boundaries.
 */
export function createPaintTexture(
  options: PaintTextureOptions = {},
): PaintTextureResult {
  const size = integerOption(options.size, 512, 32, 2048);
  const seed = options.seed ?? DEFAULT_SEED;
  const seedHash = hashSeed(seed);
  const random = mulberry32(seedHash);
  const broadStrokeCount = integerOption(
    options.broadStrokeCount,
    Math.round(18 + size * 0.075),
    1,
    512,
  );
  const detailStrokeCount = integerOption(
    options.detailStrokeCount,
    Math.round(56 + size * 0.25),
    1,
    2048,
  );
  const bristleDensity = finiteOption(options.bristleDensity, 1, 0.2, 4);
  const normalStrength = finiteOption(options.normalStrength, 3.8, 0.05, 16);

  const texelCount = size * size;
  const height = new Float32Array(texelCount);
  const broadMask = new Float32Array(texelCount);
  const detailMask = new Float32Array(texelCount);
  const strokeNormalX = new Float32Array(texelCount);
  const strokeNormalY = new Float32Array(texelCount);
  const strokeNormalDeposit = new Float32Array(texelCount);

  addPeriodicCanvasGrain(height, size, random, seedHash);

  for (let index = 0; index < broadStrokeCount; index += 1) {
    const stroke = createBroadStroke(size, random, bristleDensity, index, seedHash);
    stampStroke(
      height,
      broadMask,
      strokeNormalX,
      strokeNormalY,
      strokeNormalDeposit,
      size,
      stroke,
      false,
    );
  }

  for (let index = 0; index < detailStrokeCount; index += 1) {
    const stroke = createDetailStroke(size, random, bristleDensity, index, seedHash);
    stampStroke(
      height,
      detailMask,
      strokeNormalX,
      strokeNormalY,
      strokeNormalDeposit,
      size,
      stroke,
      true,
    );
  }

  const data = packChannels(
    height,
    broadMask,
    detailMask,
    strokeNormalX,
    strokeNormalY,
    strokeNormalDeposit,
    size,
    seedHash,
    normalStrength,
  );
  const metadata: PaintTextureMetadata = {
    width: size,
    height: size,
    seed,
    seedHash,
    seedHex: seedHash.toString(16).padStart(8, '0'),
    broadStrokeCount,
    detailStrokeCount,
    bristleDensity,
    normalStrength,
    repeating: true,
    channels: {
      r: 'tangentNormalX',
      g: 'tangentNormalY',
      b: 'broadDiffuseStrokeMask',
      a: 'secondaryDetailStrokeMask',
    },
  };

  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.name = `paint-packed-${metadata.seedHex}-${size}`;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = NoColorSpace;
  texture.userData.paintTexture = metadata;
  texture.needsUpdate = true;

  return { texture, metadata };
}

function createBroadStroke(
  size: number,
  random: () => number,
  bristleDensity: number,
  index: number,
  seed: number,
): Stroke {
  // A small family of directions makes neighboring strokes read as authored
  // brushwork while the jitter prevents an obvious procedural grid.
  const directionFamily = [
    -0.08,
    Math.PI * 0.5 + 0.06,
    Math.PI * 0.25,
    -Math.PI * 0.31,
  ];
  const family = directionFamily[Math.floor(random() * directionFamily.length)] ?? 0;
  const angle = family + (random() - 0.5) * 0.42;
  const normalAngle = random() * TAU;
  const normalTilt = 0.38 + random() * 0.44;

  return {
    centerX: random() * size,
    centerY: random() * size,
    halfLength: size * (0.11 + random() * 0.18),
    halfWidth: Math.max(3, size * (0.018 + random() * 0.052)),
    cosine: Math.cos(angle),
    sine: Math.sin(angle),
    phase: random() * TAU,
    phase2: random() * TAU,
    bristleFrequency: Math.PI * (0.34 + random() * 0.7) * bristleDensity,
    edgeFrequency: 0.035 + random() * 0.09,
    height: 0.34 + random() * 0.46,
    opacity: 0.55 + random() * 0.43,
    normalX: Math.cos(normalAngle) * normalTilt,
    normalY: Math.sin(normalAngle) * normalTilt,
    noiseSeed: mixUint(seed, index + 0x2e51),
  };
}

function createDetailStroke(
  size: number,
  random: () => number,
  bristleDensity: number,
  index: number,
  seed: number,
): Stroke {
  const angle = random() < 0.72
    ? (random() < 0.55 ? 0 : Math.PI * 0.5) + (random() - 0.5) * 0.6
    : random() * Math.PI;
  const bristleNormalAngle = angle + Math.PI * 0.5;
  const bristleTilt = 0.08 + random() * 0.16;

  return {
    centerX: random() * size,
    centerY: random() * size,
    halfLength: size * (0.025 + random() * 0.085),
    halfWidth: Math.max(1.15, size * (0.0025 + random() * 0.012)),
    cosine: Math.cos(angle),
    sine: Math.sin(angle),
    phase: random() * TAU,
    phase2: random() * TAU,
    bristleFrequency: Math.PI * (0.65 + random() * 1.65) * bristleDensity,
    edgeFrequency: 0.08 + random() * 0.22,
    height: 0.12 + random() * 0.29,
    opacity: 0.52 + random() * 0.48,
    normalX: Math.cos(bristleNormalAngle) * bristleTilt,
    normalY: Math.sin(bristleNormalAngle) * bristleTilt,
    noiseSeed: mixUint(seed ^ 0xa511_e9b3, index + 0x68bc),
  };
}

function stampStroke(
  height: Float32Array,
  mask: Float32Array,
  normalX: Float32Array,
  normalY: Float32Array,
  normalDeposit: Float32Array,
  size: number,
  stroke: Stroke,
  isDetail: boolean,
): void {
  const extentX = Math.ceil(
    Math.abs(stroke.cosine) * stroke.halfLength
    + Math.abs(stroke.sine) * stroke.halfWidth
    + 2,
  );
  const extentY = Math.ceil(
    Math.abs(stroke.sine) * stroke.halfLength
    + Math.abs(stroke.cosine) * stroke.halfWidth
    + 2,
  );
  const originX = Math.floor(stroke.centerX);
  const originY = Math.floor(stroke.centerY);

  for (let offsetY = -extentY; offsetY <= extentY; offsetY += 1) {
    const sampleY = originY + offsetY;
    const dy = sampleY + 0.5 - stroke.centerY;
    const wrappedY = positiveModulo(sampleY, size);

    for (let offsetX = -extentX; offsetX <= extentX; offsetX += 1) {
      const sampleX = originX + offsetX;
      const dx = sampleX + 0.5 - stroke.centerX;
      const along = dx * stroke.cosine + dy * stroke.sine;
      const across = -dx * stroke.sine + dy * stroke.cosine;
      const normalizedAlong = along / stroke.halfLength;
      const normalizedAcross = across / stroke.halfWidth;

      if (Math.abs(normalizedAlong) > 1.12 || Math.abs(normalizedAcross) > 1.18) {
        continue;
      }

      const wrappedX = positiveModulo(sampleX, size);
      const texel = wrappedY * size + wrappedX;
      const grain = hash2D(wrappedX, wrappedY, stroke.noiseSeed);
      const edgeWobble =
        Math.sin(along * stroke.edgeFrequency + stroke.phase2) * 0.075
        + (grain - 0.5) * (isDetail ? 0.13 : 0.075);
      const ellipticalDistance = Math.hypot(
        normalizedAlong * (1 + edgeWobble * 0.28),
        normalizedAcross,
      );
      const capFray = 1 - smoothstep(0.7, 1.04, Math.abs(normalizedAlong));
      let coverage = 1 - smoothstep(
        0.74 + edgeWobble,
        1.045 + edgeWobble,
        ellipticalDistance,
      );
      coverage *= mix(0.72, 1, capFray);
      if (coverage <= 0.001) continue;

      const bristleWave = Math.sin(
        across * stroke.bristleFrequency
        + stroke.phase
        + Math.sin(along * stroke.edgeFrequency * 1.7 + stroke.phase2) * 0.58,
      );
      const bristleRidge = Math.pow(0.5 + bristleWave * 0.5, isDetail ? 3.4 : 2.2);
      const loadVariation = 0.7
        + Math.sin(along * stroke.edgeFrequency * 0.64 + stroke.phase) * 0.16
        + (grain - 0.5) * 0.2;
      const dryBrush = smoothstep(
        isDetail ? 0.26 : 0.16,
        isDetail ? 0.7 : 0.76,
        0.58 * bristleRidge + 0.42 * grain,
      );
      const deposited = coverage * saturate(loadVariation);
      const maskValue = deposited
        * stroke.opacity
        * mix(isDetail ? 0.18 : 0.47, 1, dryBrush);

      // Screen-like accumulation preserves crisp individual marks in overlap
      // zones instead of averaging them into featureless grey.
      mask[texel] = 1 - (1 - mask[texel]) * (1 - saturate(maskValue));
      height[texel] += stroke.height
        * deposited
        * (0.35 + 0.65 * bristleRidge)
        * (isDetail ? 0.72 : 1);

      // The source material's most important texture feature is not simply a
      // height-derived normal: every deposited mark owns a strongly randomized
      // tilt. Later strokes partially cover earlier ones, while the narrow
      // detail marks add a weaker across-bristle direction on top.
      const normalBlend = saturate(
        deposited * stroke.opacity * (isDetail ? 0.18 : 0.76),
      );
      normalX[texel] = mix(normalX[texel] ?? 0, stroke.normalX, normalBlend);
      normalY[texel] = mix(normalY[texel] ?? 0, stroke.normalY, normalBlend);
      normalDeposit[texel] = 1 - (1 - (normalDeposit[texel] ?? 0)) * (1 - normalBlend);
    }
  }
}

function addPeriodicCanvasGrain(
  height: Float32Array,
  size: number,
  random: () => number,
  seed: number,
): void {
  const modes = Array.from({ length: 9 }, (_, index) => {
    const axisBias = index % 3;
    const magnitude = 10 + Math.floor(random() * 48);
    const waveX = axisBias === 0
      ? magnitude
      : Math.max(1, Math.round((random() - 0.5) * magnitude * 0.46));
    const waveY = axisBias === 1
      ? magnitude
      : Math.max(1, Math.round((random() - 0.5) * magnitude * 0.46));
    return {
      phase: random() * TAU,
      waveX,
      waveY,
      weight: 1 / (1 + index * 0.42),
    };
  });

  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      let waves = 0;
      let weightSum = 0;
      for (const mode of modes) {
        waves += Math.sin(
          TAU * (mode.waveX * u + mode.waveY * v) + mode.phase,
        ) * mode.weight;
        weightSum += mode.weight;
      }
      const stochastic = hash2D(x, y, seed ^ 0x9e37_79b9) - 0.5;
      height[y * size + x] = waves / weightSum * 0.055 + stochastic * 0.018;
    }
  }
}

function packChannels(
  height: Float32Array,
  broadMask: Float32Array,
  detailMask: Float32Array,
  strokeNormalX: Float32Array,
  strokeNormalY: Float32Array,
  strokeNormalDeposit: Float32Array,
  size: number,
  seed: number,
  normalStrength: number,
): Uint8Array {
  const packed = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    const yMinus = positiveModulo(y - 1, size);
    const yPlus = positiveModulo(y + 1, size);
    const v = (y + 0.5) / size;

    for (let x = 0; x < size; x += 1) {
      const xMinus = positiveModulo(x - 1, size);
      const xPlus = positiveModulo(x + 1, size);
      const center = y * size + x;

      // Wrapped Sobel derivatives make the reconstructed normal tile without a
      // lighting seam, including after the texture is sampled across UV 0/1.
      const gradientX = (
        height[yMinus * size + xPlus]
        + 2 * height[center - x + xPlus]
        + height[yPlus * size + xPlus]
        - height[yMinus * size + xMinus]
        - 2 * height[center - x + xMinus]
        - height[yPlus * size + xMinus]
      ) * 0.125 * normalStrength;
      const gradientY = (
        height[yPlus * size + xMinus]
        + 2 * height[yPlus * size + x]
        + height[yPlus * size + xPlus]
        - height[yMinus * size + xMinus]
        - 2 * height[yMinus * size + x]
        - height[yMinus * size + xPlus]
      ) * 0.125 * normalStrength;
      const strokeNormalWeight = smoothstep(
        0.04,
        0.72,
        strokeNormalDeposit[center] ?? 0,
      );
      const strokeNormalScale = normalStrength / 3.8;
      const combinedNormalX = -gradientX * 0.48
        + (strokeNormalX[center] ?? 0) * strokeNormalWeight * strokeNormalScale;
      const combinedNormalY = -gradientY * 0.48
        + (strokeNormalY[center] ?? 0) * strokeNormalWeight * strokeNormalScale;
      const inverseLength = 1 / Math.hypot(combinedNormalX, combinedNormalY, 1);
      const normalX = combinedNormalX * inverseLength;
      const normalY = combinedNormalY * inverseLength;

      const lowFrequency = periodicFbm(
        (x + 0.5) / size,
        v,
        seed ^ 0x85eb_ca6b,
      );
      const broad = smoothstep(
        0.06,
        0.91,
        broadMask[center] * 0.88 + lowFrequency * 0.23,
      );
      const fleck = hash2D(x, y, seed ^ 0xc2b2_ae35);
      const detailSource = detailMask[center] * 1.18
        + Math.max(0, broadMask[center] - 0.3) * 0.28
        + (lowFrequency - 0.42) * 0.12
        + Math.max(0, fleck - 0.82) * 0.46;
      const detail = Math.pow(smoothstep(0.08, 0.58, detailSource), 0.82);

      const output = center * 4;
      packed[output] = toByte(normalX * 0.5 + 0.5);
      packed[output + 1] = toByte(normalY * 0.5 + 0.5);
      packed[output + 2] = toByte(broad);
      packed[output + 3] = toByte(detail);
    }
  }

  return packed;
}

function periodicFbm(u: number, v: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.57;
  let amplitudeSum = 0;
  let cells = 3;

  for (let octave = 0; octave < 4; octave += 1) {
    sum += periodicValueNoise(u, v, cells, mixUint(seed, octave)) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.48;
    cells *= 2;
  }

  return sum / amplitudeSum;
}

function periodicValueNoise(
  u: number,
  v: number,
  cells: number,
  seed: number,
): number {
  const gridX = u * cells;
  const gridY = v * cells;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = positiveModulo(x0 + 1, cells);
  const y1 = positiveModulo(y0 + 1, cells);
  const wrappedX0 = positiveModulo(x0, cells);
  const wrappedY0 = positiveModulo(y0, cells);
  const blendX = smootherstep(gridX - x0);
  const blendY = smootherstep(gridY - y0);
  const bottom = mix(
    hash2D(wrappedX0, wrappedY0, seed),
    hash2D(x1, wrappedY0, seed),
    blendX,
  );
  const top = mix(
    hash2D(wrappedX0, y1, seed),
    hash2D(x1, y1, seed),
    blendX,
  );
  return mix(bottom, top, blendY);
}

function hashSeed(seed: PaintTextureSeed): number {
  const text = typeof seed === 'number' && Number.isFinite(seed)
    ? seed.toString(17)
    : String(seed);
  let hash = 0x811c_9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return avalanche(hash >>> 0) || DEFAULT_SEED;
}

function mixUint(seed: number, value: number): number {
  return avalanche(seed ^ Math.imul(value, 0x9e37_79b1));
}

function hash2D(x: number, y: number, seed: number): number {
  let hash = seed;
  hash ^= Math.imul(x, 0x8da6_b343);
  hash ^= Math.imul(y, 0xd816_3841);
  return avalanche(hash) / 0xffff_ffff;
}

function avalanche(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb_352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846c_a68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function integerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const finite = Number.isFinite(value) ? value as number : fallback;
  return Math.round(clamp(finite, minimum, maximum));
}

function finiteOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const finite = Number.isFinite(value) ? value as number : fallback;
  return clamp(finite, minimum, maximum);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function smootherstep(value: number): number {
  const x = saturate(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = saturate((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function saturate(value: number): number {
  return clamp(value, 0, 1);
}

function toByte(value: number): number {
  return Math.round(saturate(value) * 255);
}

