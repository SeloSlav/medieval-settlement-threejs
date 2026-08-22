import type { RiverField } from '../rivers/RiverField.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import { sampleTerrainBlendWeights } from '../terrain/TerrainBlendWeights.ts';
import {
  forestCoreInfluence,
  forestDensityAt,
  mulberry32,
  type ForestCore,
} from '../props/forestField.ts';
import { riverFieldBounds } from './worldToMapPercent.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';

const MINIMAP_RESOLUTION = 512;
const ROWS_PER_YIELD = 32;
const RELIEF_GRID_RESOLUTION = 82;
const FOREST_GLYPH_SPACING = 16;
const GRASS_GLYPH_SPACING = 22;

const PARCHMENT_COLOR = { r: 214, g: 193, b: 147 } as const;
const WATER_WASH_COLOR = { r: 129, g: 151, b: 146 } as const;
const INK_COLOR = { r: 55, g: 43, b: 27 } as const;

type TerrainMinimapTerrain = Pick<Terrain, 'getHeightAt' | 'generationSize' | 'size'>;

export type TerrainMinimapImageOptions = {
  riverField: RiverField;
  terrain: TerrainMinimapTerrain;
  forestCores: readonly ForestCore[];
  seed: number;
};

export type TerrainMinimapImage = {
  canvas: HTMLCanvasElement;
  bounds: TerrainBounds;
};

/**
 * Draws the first-person field map as deterministic parchment-and-ink art.
 * It intentionally contains geography rather than any inferred settlement or
 * town boundary; the live compositor adds roads, real building footprints,
 * and resource woodcuts to a shared canvas after this base layer is complete.
 */
export async function createTerrainMinimapImage(
  options: TerrainMinimapImageOptions,
): Promise<TerrainMinimapImage> {
  const { riverField, terrain, seed } = options;
  const canvas = document.createElement('canvas');
  canvas.width = MINIMAP_RESOLUTION;
  canvas.height = MINIMAP_RESOLUTION;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire 2D canvas context for terrain minimap.');
  }

  const bounds = riverFieldBounds(riverField);
  const waterMask = await createParchmentRaster(context, riverField, seed);
  drawParchmentMottling(context, seed);
  await drawReliefLines(context, terrain, bounds, waterMask, seed);
  drawGrassGlyphs(context, options, bounds, waterMask);
  await yieldToMain();
  drawForestGlyphs(context, options, bounds, waterMask);
  drawWaterHatching(context, waterMask, seed);
  drawInkBorder(context);

  canvas.dataset.terrainStyle = 'medieval-parchment';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Hand-drawn parchment terrain map showing rivers, relief, grassland, and forest',
  );
  return { canvas, bounds };
}

async function createParchmentRaster(
  context: CanvasRenderingContext2D,
  riverField: RiverField,
  seed: number,
): Promise<Uint8Array> {
  const image = context.createImageData(MINIMAP_RESOLUTION, MINIMAP_RESOLUTION);
  const waterMask = new Uint8Array(MINIMAP_RESOLUTION * MINIMAP_RESOLUTION);
  const denominator = Math.max(MINIMAP_RESOLUTION - 1, 1);
  const riverDenominator = Math.max(riverField.resolution - 1, 1);

  for (let row = 0; row < MINIMAP_RESOLUTION; row++) {
    if (row > 0 && row % ROWS_PER_YIELD === 0) await yieldToMain();
    const riverRow = Math.round((row / denominator) * riverDenominator);

    for (let column = 0; column < MINIMAP_RESOLUTION; column++) {
      const riverColumn = Math.round((column / denominator) * riverDenominator);
      const pixelIndex = row * MINIMAP_RESOLUTION + column;
      waterMask[pixelIndex] = riverField.isRenderedWetAtGrid(riverColumn, riverRow) ? 1 : 0;
    }
  }

  for (let row = 0; row < MINIMAP_RESOLUTION; row++) {
    if (row > 0 && row % ROWS_PER_YIELD === 0) await yieldToMain();

    for (let column = 0; column < MINIMAP_RESOLUTION; column++) {
      const pixelIndex = row * MINIMAP_RESOLUTION + column;
      const isWater = waterMask[pixelIndex] === 1;
      const grain = mapHash(column, row, seed) - 0.5;
      const longFiber = Math.sin(column * 0.071 + row * 0.017 + seed * 0.0017) * 1.7;
      const base = isWater
        ? blendColors(PARCHMENT_COLOR, WATER_WASH_COLOR, 0.66 + grain * 0.08)
        : PARCHMENT_COLOR;
      const edgeStrength = waterBoundaryStrength(waterMask, column, row);
      const inkMix = edgeStrength * (0.72 + mapHash(column + 91, row - 37, seed) * 0.18);
      const paperVariation = grain * 12 + longFiber;
      const color = blendColors(
        {
          r: base.r + paperVariation,
          g: base.g + paperVariation * 0.82,
          b: base.b + paperVariation * 0.52,
        },
        INK_COLOR,
        inkMix,
      );
      const dataIndex = pixelIndex * 4;
      image.data[dataIndex] = clampByte(color.r);
      image.data[dataIndex + 1] = clampByte(color.g);
      image.data[dataIndex + 2] = clampByte(color.b);
      image.data[dataIndex + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return waterMask;
}

function drawParchmentMottling(context: CanvasRenderingContext2D, seed: number): void {
  const rng = mulberry32(seed ^ 0x7a4d_21c3);
  context.save();
  context.globalCompositeOperation = 'multiply';

  for (let index = 0; index < 22; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const radius = 22 + rng() * 74;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(101, 72, 34, ${0.018 + rng() * 0.025})`);
    gradient.addColorStop(1, 'rgba(101, 72, 34, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.42 + rng() * 0.48), rng() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

async function drawReliefLines(
  context: CanvasRenderingContext2D,
  terrain: TerrainMinimapTerrain,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
  seed: number,
): Promise<void> {
  const heights = new Float32Array(RELIEF_GRID_RESOLUTION * RELIEF_GRID_RESOLUTION);
  const sortedHeights: number[] = [];
  const denominator = RELIEF_GRID_RESOLUTION - 1;

  for (let row = 0; row < RELIEF_GRID_RESOLUTION; row++) {
    if (row > 0 && row % 16 === 0) await yieldToMain();
    const z = bounds.minZ + (row / denominator) * (bounds.maxZ - bounds.minZ);
    for (let column = 0; column < RELIEF_GRID_RESOLUTION; column++) {
      const x = bounds.minX + (column / denominator) * (bounds.maxX - bounds.minX);
      const height = terrain.getHeightAt(x, z);
      heights[row * RELIEF_GRID_RESOLUTION + column] = height;
      sortedHeights.push(height);
    }
  }

  sortedHeights.sort((a, b) => a - b);
  const quantiles = [0.38, 0.53, 0.66, 0.77, 0.86, 0.93];
  const levels = quantiles
    .map((quantile) => sortedHeights[Math.floor((sortedHeights.length - 1) * quantile)])
    .filter((level, index, values) => index === 0 || Math.abs(level - values[index - 1]) > 0.08);

  context.save();
  context.strokeStyle = 'rgba(66, 49, 29, 0.25)';
  context.lineWidth = 0.7;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash([2.2, 2.6]);

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex];
    context.lineDashOffset = mapHash(levelIndex, 19, seed) * 4;
    context.beginPath();

    for (let row = 0; row < RELIEF_GRID_RESOLUTION - 1; row++) {
      for (let column = 0; column < RELIEF_GRID_RESOLUTION - 1; column++) {
        const centerX = ((column + 0.5) / denominator) * (MINIMAP_RESOLUTION - 1);
        const centerY = ((row + 0.5) / denominator) * (MINIMAP_RESOLUTION - 1);
        if (isWaterPixel(waterMask, centerX, centerY)) continue;

        const topLeft = heights[row * RELIEF_GRID_RESOLUTION + column];
        const topRight = heights[row * RELIEF_GRID_RESOLUTION + column + 1];
        const bottomRight = heights[(row + 1) * RELIEF_GRID_RESOLUTION + column + 1];
        const bottomLeft = heights[(row + 1) * RELIEF_GRID_RESOLUTION + column];
        const segments = contourSegments(topLeft, topRight, bottomRight, bottomLeft, level);

        for (const [fromEdge, toEdge] of segments) {
          const from = contourEdgePoint(
            fromEdge,
            column,
            row,
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            level,
            denominator,
          );
          const to = contourEdgePoint(
            toEdge,
            column,
            row,
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            level,
            denominator,
          );
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
        }
      }
    }

    context.stroke();
  }

  context.restore();
}

function drawGrassGlyphs(
  context: CanvasRenderingContext2D,
  options: TerrainMinimapImageOptions,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
): void {
  const { terrain, forestCores, seed } = options;
  const extent = terrain.generationSize * 0.5;
  const terrainExtent = terrain.size * 0.5;
  context.save();
  context.strokeStyle = 'rgba(72, 55, 32, 0.46)';
  context.lineWidth = 0.72;
  context.lineCap = 'round';

  for (let row = 8; row < MINIMAP_RESOLUTION - 8; row += GRASS_GLYPH_SPACING) {
    for (let column = 8; column < MINIMAP_RESOLUTION - 8; column += GRASS_GLYPH_SPACING) {
      const jitterX = (mapHash(column, row, seed ^ 0x1821) - 0.5) * 13;
      const jitterY = (mapHash(column, row, seed ^ 0x2b77) - 0.5) * 13;
      const pixelX = column + jitterX;
      const pixelY = row + jitterY;
      if (isWaterPixel(waterMask, pixelX, pixelY)) continue;
      const world = pixelToWorld(pixelX, pixelY, bounds);
      const forestDensity = forestDensityAt(
        world.x,
        world.z,
        forestCores,
        extent,
        terrainExtent,
      );
      if (forestDensity > 0.34) continue;
      const [meadow, , dry] = sampleTerrainBlendWeights(world.x, world.z);
      const chance = 0.18 + meadow * 0.28 + dry * 0.12;
      if (mapHash(column + 17, row - 9, seed) > chance) continue;
      drawGrassTuft(
        context,
        pixelX,
        pixelY,
        1.3 + mapHash(column - 31, row + 42, seed) * 1.3,
        mapHash(column, row, seed ^ 0x51a4) - 0.5,
      );
    }
  }

  context.restore();
}

function drawForestGlyphs(
  context: CanvasRenderingContext2D,
  options: TerrainMinimapImageOptions,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
): void {
  const { terrain, forestCores, seed } = options;
  const extent = terrain.generationSize * 0.5;
  const terrainExtent = terrain.size * 0.5;
  context.save();
  context.strokeStyle = 'rgba(49, 40, 25, 0.82)';
  context.fillStyle = 'rgba(84, 72, 42, 0.08)';
  context.lineWidth = 0.9;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (let row = 8; row < MINIMAP_RESOLUTION - 8; row += FOREST_GLYPH_SPACING) {
    const rowOffset = (Math.floor(row / FOREST_GLYPH_SPACING) % 2) * (FOREST_GLYPH_SPACING * 0.5);
    for (let column = 8 + rowOffset; column < MINIMAP_RESOLUTION - 8; column += FOREST_GLYPH_SPACING) {
      const jitterX = (mapHash(column, row, seed ^ 0x731f) - 0.5) * 10;
      const jitterY = (mapHash(column, row, seed ^ 0x09d5) - 0.5) * 10;
      const pixelX = column + jitterX;
      const pixelY = row + jitterY;
      if (isWaterPixel(waterMask, pixelX, pixelY)) continue;
      const world = pixelToWorld(pixelX, pixelY, bounds);
      const density = forestDensityAt(
        world.x,
        world.z,
        forestCores,
        extent,
        terrainExtent,
      );
      const chance = clamp01((density - 0.2) / 0.67) * 0.96;
      if (mapHash(column + 43, row - 26, seed) > chance) continue;

      const coniferBias = forestConiferBiasAt(world.x, world.z, forestCores);
      const scale = 0.78 + mapHash(column - 12, row + 67, seed) * 0.38;
      const lean = (mapHash(column + 5, row + 8, seed ^ 0x4c17) - 0.5) * 0.8;
      if (mapHash(column - 19, row + 4, seed ^ 0x6a3d) < coniferBias) {
        drawConiferGlyph(context, pixelX, pixelY, scale, lean);
      } else {
        drawBroadleafGlyph(context, pixelX, pixelY, scale, lean);
      }
    }
  }

  context.restore();
}

function drawWaterHatching(
  context: CanvasRenderingContext2D,
  waterMask: Uint8Array,
  seed: number,
): void {
  context.save();
  context.strokeStyle = 'rgba(47, 58, 50, 0.54)';
  context.lineWidth = 0.75;
  context.lineCap = 'round';

  for (let row = 9; row < MINIMAP_RESOLUTION - 9; row += 13) {
    for (let column = 9; column < MINIMAP_RESOLUTION - 9; column += 17) {
      const jitterX = (mapHash(column, row, seed ^ 0x56ce) - 0.5) * 8;
      const jitterY = (mapHash(column, row, seed ^ 0x112f) - 0.5) * 6;
      const x = column + jitterX;
      const y = row + jitterY;
      const length = 4 + mapHash(column + 7, row + 3, seed) * 5;
      if (
        !isWaterPixel(waterMask, x, y)
        || !isWaterPixel(waterMask, x - length * 0.5, y)
        || !isWaterPixel(waterMask, x + length * 0.5, y)
      ) continue;
      context.beginPath();
      context.moveTo(x - length * 0.5, y);
      context.quadraticCurveTo(x - length * 0.2, y - 1.1, x, y);
      context.quadraticCurveTo(x + length * 0.2, y + 1.1, x + length * 0.5, y);
      context.stroke();
    }
  }

  context.restore();
}

function drawGrassTuft(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  lean: number,
): void {
  context.beginPath();
  context.moveTo(x, y + 1);
  context.lineTo(x + lean, y - height);
  context.moveTo(x, y + 1);
  context.lineTo(x - height * 0.7, y - height * 0.45);
  context.moveTo(x, y + 1);
  context.lineTo(x + height * 0.72, y - height * 0.55);
  context.stroke();
}

function drawConiferGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  lean: number,
): void {
  const height = 7.2 * scale;
  const halfWidth = 3.2 * scale;
  context.beginPath();
  context.moveTo(x + lean, y - height);
  context.lineTo(x - halfWidth * 0.54, y - height * 0.48);
  context.lineTo(x - halfWidth * 0.22, y - height * 0.51);
  context.lineTo(x - halfWidth, y - height * 0.08);
  context.lineTo(x + halfWidth, y - height * 0.08);
  context.lineTo(x + halfWidth * 0.2, y - height * 0.51);
  context.lineTo(x + halfWidth * 0.56, y - height * 0.48);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(x, y - height * 0.1);
  context.lineTo(x, y + 1.8 * scale);
  context.stroke();
}

function drawBroadleafGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  lean: number,
): void {
  const crownY = y - 4.2 * scale;
  const radius = 3.1 * scale;
  context.beginPath();
  context.moveTo(x - radius * 0.92, crownY + radius * 0.18);
  context.bezierCurveTo(
    x - radius * 1.06,
    crownY - radius * 0.58,
    x - radius * 0.36 + lean,
    crownY - radius * 1.1,
    x + lean,
    crownY - radius * 0.83,
  );
  context.bezierCurveTo(
    x + radius * 0.72 + lean,
    crownY - radius * 1.02,
    x + radius * 1.12,
    crownY - radius * 0.18,
    x + radius * 0.83,
    crownY + radius * 0.38,
  );
  context.bezierCurveTo(
    x + radius * 0.36,
    crownY + radius * 0.85,
    x - radius * 0.55,
    crownY + radius * 0.76,
    x - radius * 0.92,
    crownY + radius * 0.18,
  );
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(x, crownY + radius * 0.38);
  context.lineTo(x, y + 1.8 * scale);
  context.stroke();
}

function drawInkBorder(context: CanvasRenderingContext2D): void {
  context.save();
  context.strokeStyle = 'rgba(55, 43, 27, 0.72)';
  context.lineWidth = 1.4;
  context.strokeRect(5.5, 5.5, MINIMAP_RESOLUTION - 11, MINIMAP_RESOLUTION - 11);
  context.strokeStyle = 'rgba(55, 43, 27, 0.32)';
  context.lineWidth = 0.7;
  context.strokeRect(9.5, 9.5, MINIMAP_RESOLUTION - 19, MINIMAP_RESOLUTION - 19);
  context.restore();
}

function forestConiferBiasAt(
  x: number,
  z: number,
  forestCores: readonly ForestCore[],
): number {
  let strongestInfluence = 0;
  let coniferBias = 0.62;
  for (const core of forestCores) {
    const influence = forestCoreInfluence(x, z, core) * core.strength;
    if (influence <= strongestInfluence) continue;
    strongestInfluence = influence;
    coniferBias = core.coniferBias;
  }
  return coniferBias;
}

type ContourEdge = 0 | 1 | 2 | 3;
type ContourSegment = readonly [ContourEdge, ContourEdge];

function contourSegments(
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
  level: number,
): readonly ContourSegment[] {
  const cellCase = (topLeft >= level ? 1 : 0)
    | (topRight >= level ? 2 : 0)
    | (bottomRight >= level ? 4 : 0)
    | (bottomLeft >= level ? 8 : 0);
  return CONTOUR_SEGMENTS[cellCase];
}

const CONTOUR_SEGMENTS: readonly (readonly ContourSegment[])[] = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 0], [1, 2]],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [[0, 1], [2, 3]],
  [[1, 2]],
  [[1, 3]],
  [[0, 1]],
  [[3, 0]],
  [],
];

function contourEdgePoint(
  edge: ContourEdge,
  column: number,
  row: number,
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
  level: number,
  denominator: number,
): { x: number; y: number } {
  let gridX = column;
  let gridY = row;
  if (edge === 0) {
    gridX += inverseLerp(topLeft, topRight, level);
  } else if (edge === 1) {
    gridX += 1;
    gridY += inverseLerp(topRight, bottomRight, level);
  } else if (edge === 2) {
    gridX += inverseLerp(bottomLeft, bottomRight, level);
    gridY += 1;
  } else {
    gridY += inverseLerp(topLeft, bottomLeft, level);
  }
  return {
    x: (gridX / denominator) * (MINIMAP_RESOLUTION - 1),
    y: (gridY / denominator) * (MINIMAP_RESOLUTION - 1),
  };
}

function inverseLerp(from: number, to: number, value: number): number {
  const span = to - from;
  if (Math.abs(span) <= 1e-8) return 0.5;
  return clamp01((value - from) / span);
}

function waterBoundaryStrength(
  waterMask: Uint8Array,
  column: number,
  row: number,
): number {
  const center = waterMask[row * MINIMAP_RESOLUTION + column];
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (offsetX === 0 && offsetY === 0) continue;
      const x = column + offsetX;
      const y = row + offsetY;
      if (x < 0 || y < 0 || x >= MINIMAP_RESOLUTION || y >= MINIMAP_RESOLUTION) continue;
      if (waterMask[y * MINIMAP_RESOLUTION + x] !== center) return 0.72;
    }
  }
  for (const [offsetX, offsetY] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
    const x = column + offsetX;
    const y = row + offsetY;
    if (x < 0 || y < 0 || x >= MINIMAP_RESOLUTION || y >= MINIMAP_RESOLUTION) continue;
    if (waterMask[y * MINIMAP_RESOLUTION + x] !== center) return 0.2;
  }
  return 0;
}

function isWaterPixel(waterMask: Uint8Array, x: number, y: number): boolean {
  const column = Math.max(0, Math.min(MINIMAP_RESOLUTION - 1, Math.round(x)));
  const row = Math.max(0, Math.min(MINIMAP_RESOLUTION - 1, Math.round(y)));
  return waterMask[row * MINIMAP_RESOLUTION + column] === 1;
}

function pixelToWorld(
  x: number,
  y: number,
  bounds: TerrainBounds,
): { x: number; z: number } {
  return {
    x: bounds.minX + (x / (MINIMAP_RESOLUTION - 1)) * (bounds.maxX - bounds.minX),
    z: bounds.minZ + (y / (MINIMAP_RESOLUTION - 1)) * (bounds.maxZ - bounds.minZ),
  };
}

function mapHash(x: number, y: number, seed: number): number {
  let hash = Math.imul(Math.trunc(x) ^ seed, 0x45d9f3b)
    ^ Math.imul(Math.trunc(y) + seed * 3, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}

function blendColors(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  const clamped = clamp01(t);
  return {
    r: from.r + (to.r - from.r) * clamped,
    g: from.g + (to.g - from.g) * clamped,
    b: from.b + (to.b - from.b) * clamped,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
