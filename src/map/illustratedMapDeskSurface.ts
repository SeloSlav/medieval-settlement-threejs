import type { TerrainBounds } from '../terrain/Terrain.ts';

/** Stable art seed so the held map and strategic map show the same desk. */
export const ILLUSTRATED_MAP_DESK_TEXTURE_SEED = 0x1550c0de;
export const ILLUSTRATED_MAP_DESK_TEXTURE_RESOLUTION = 1024;
/** Margin on each side, expressed against the map's longest world dimension. */
export const ILLUSTRATED_MAP_DESK_MARGIN_RATIO = 0.45;
export const ILLUSTRATED_MAP_DESK_FADE_START = 0.88;
export const ILLUSTRATED_MAP_DESK_ALPHA_FADE_START = 0.96;

export type IllustratedMapDeskMetrics = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  margin: number;
};

export function illustratedMapDeskMetrics(
  bounds: TerrainBounds,
): IllustratedMapDeskMetrics {
  const mapWidth = bounds.maxX - bounds.minX;
  const mapDepth = bounds.maxZ - bounds.minZ;
  const margin = Math.max(mapWidth, mapDepth) * ILLUSTRATED_MAP_DESK_MARGIN_RATIO;
  return {
    centerX: (bounds.minX + bounds.maxX) * 0.5,
    centerZ: (bounds.minZ + bounds.maxZ) * 0.5,
    width: mapWidth + margin * 2,
    depth: mapDepth + margin * 2,
    margin,
  };
}

export function illustratedMapDeskColourGainAt(squareRadius: number): number {
  return 1 - smoothstep(ILLUSTRATED_MAP_DESK_FADE_START, 1, squareRadius) * 0.94;
}

export function illustratedMapDeskAlphaAt(squareRadius: number): number {
  return 1 - smoothstep(ILLUSTRATED_MAP_DESK_ALPHA_FADE_START, 1, squareRadius);
}

/**
 * Draw a deterministic, code-native oak desktop. The macro plank seams,
 * flowing grain, knots, wear, and edge response all derive from one seed.
 * Its blackened transparent outer pixels blend into the map scene's black
 * clear colour without a post-processing dependency.
 */
export function createIllustratedMapDeskCanvas(
  resolution = ILLUSTRATED_MAP_DESK_TEXTURE_RESOLUTION,
): HTMLCanvasElement {
  const size = Math.max(64, Math.round(resolution));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.dataset.mapLayer = 'procedural-dark-oak-desk';
  canvas.dataset.textureSeed = String(ILLUSTRATED_MAP_DESK_TEXTURE_SEED);

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return canvas;
  const rng = mulberry32(ILLUSTRATED_MAP_DESK_TEXTURE_SEED);
  const scale = size / ILLUSTRATED_MAP_DESK_TEXTURE_RESOLUTION;

  const base = context.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#150c09');
  base.addColorStop(0.38, '#382016');
  base.addColorStop(0.68, '#2b160f');
  base.addColorStop(1, '#100907');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  const plankCount = 6;
  const plankHeight = size / plankCount;
  for (let plank = 0; plank < plankCount; plank += 1) {
    const top = plank * plankHeight;
    drawPlank(context, rng, top, plankHeight, size, scale, plank);
  }

  // A restrained pool of warm ambient light links the wood to the parchment
  // without lowering ink contrast inside the paper itself.
  const ambient = context.createRadialGradient(
    size * 0.48,
    size * 0.45,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.64,
  );
  ambient.addColorStop(0, 'rgba(160, 104, 56, 0.19)');
  ambient.addColorStop(0.56, 'rgba(96, 55, 30, 0.08)');
  ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = ambient;
  context.fillRect(0, 0, size, size);

  applyDeskEdgeFade(context, size);
  return canvas;
}

function drawPlank(
  context: CanvasRenderingContext2D,
  rng: () => number,
  top: number,
  height: number,
  width: number,
  scale: number,
  plank: number,
): void {
  const valueShift = (rng() - 0.5) * 22;
  const plankWash = context.createLinearGradient(0, top, 0, top + height);
  plankWash.addColorStop(0, rgba(76 + valueShift, 42 + valueShift * 0.45, 26, 0.62));
  plankWash.addColorStop(0.45, rgba(46 + valueShift, 24 + valueShift * 0.35, 16, 0.36));
  plankWash.addColorStop(1, rgba(25 + valueShift * 0.4, 13, 10, 0.58));
  context.fillStyle = plankWash;
  context.fillRect(0, top, width, height);

  if (plank > 0) {
    context.fillStyle = 'rgba(5, 3, 2, 0.82)';
    context.fillRect(0, top - 1.7 * scale, width, 3.2 * scale);
    context.fillStyle = 'rgba(133, 79, 42, 0.2)';
    context.fillRect(0, top + 1.4 * scale, width, 1.1 * scale);
  }

  context.save();
  context.beginPath();
  context.rect(0, top + 3 * scale, width, height - 6 * scale);
  context.clip();
  context.lineCap = 'round';

  const grainLines = 36;
  for (let index = 0; index < grainLines; index += 1) {
    const y = top + rng() * height;
    const amplitude = (1.6 + rng() * 6.4) * scale;
    const phase = rng() * Math.PI * 2;
    const bend = (rng() - 0.5) * 9 * scale;
    context.beginPath();
    context.moveTo(-12 * scale, y);
    const segments = 9;
    for (let segment = 1; segment <= segments; segment += 1) {
      const x = (segment / segments) * (width + 24 * scale) - 12 * scale;
      const wave = Math.sin(segment * (0.68 + rng() * 0.18) + phase) * amplitude;
      context.lineTo(x, y + wave + bend * (segment / segments - 0.5));
    }
    const lightLine = index % 4 === 0;
    context.strokeStyle = lightLine
      ? `rgba(174, 105, 58, ${0.06 + rng() * 0.06})`
      : `rgba(12, 7, 5, ${0.12 + rng() * 0.18})`;
    context.lineWidth = (lightLine ? 0.7 : 0.9 + rng() * 1.25) * scale;
    context.stroke();
  }

  const knotCount = 1 + Math.floor(rng() * 2);
  for (let knot = 0; knot < knotCount; knot += 1) {
    const x = (0.08 + rng() * 0.84) * width;
    const y = top + (0.2 + rng() * 0.6) * height;
    const radiusX = (8 + rng() * 16) * scale;
    const radiusY = radiusX * (0.24 + rng() * 0.18);
    for (let ring = 3; ring >= 0; ring -= 1) {
      context.beginPath();
      context.ellipse(
        x,
        y,
        radiusX * (0.48 + ring * 0.2),
        radiusY * (0.54 + ring * 0.22),
        (rng() - 0.5) * 0.16,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = `rgba(9, 5, 3, ${0.14 + (3 - ring) * 0.11})`;
      context.lineWidth = (0.8 + (3 - ring) * 0.34) * scale;
      context.stroke();
    }
    context.fillStyle = 'rgba(8, 4, 3, 0.62)';
    context.beginPath();
    context.ellipse(x, y, radiusX * 0.23, radiusY * 0.34, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function applyDeskEdgeFade(
  context: CanvasRenderingContext2D,
  size: number,
): void {
  const image = context.getImageData(0, 0, size, size);
  const pixels = image.data;
  const denominator = Math.max(size - 1, 1);

  for (let y = 0; y < size; y += 1) {
    const ny = Math.abs((y / denominator) * 2 - 1);
    for (let x = 0; x < size; x += 1) {
      const nx = Math.abs((x / denominator) * 2 - 1);
      const squareRadius = Math.max(nx, ny);
      const offset = (y * size + x) * 4;
      const colourGain = illustratedMapDeskColourGainAt(squareRadius);
      const alphaGain = illustratedMapDeskAlphaAt(squareRadius);
      pixels[offset] = Math.round(pixels[offset] * colourGain);
      pixels[offset + 1] = Math.round(pixels[offset + 1] * colourGain);
      pixels[offset + 2] = Math.round(pixels[offset + 2] * colourGain);
      pixels[offset + 3] = Math.round(pixels[offset + 3] * alphaGain);
    }
  }
  context.putImageData(image, 0, 0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function rgba(red: number, green: number, blue: number, alpha: number): string {
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`;
}
