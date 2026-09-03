import type { RiverField } from '../rivers/RiverField.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import { sampleTerrainBlendWeights } from '../terrain/TerrainBlendWeights.ts';
import {
  mulberry32,
} from '../props/forestField.ts';
import { riverFieldBounds } from './worldToMapPercent.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import {
  ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
  ILLUSTRATED_TERRAIN_STYLE,
  resolveIllustratedElevationStats,
  type IllustratedElevationStats,
} from './illustratedTerrainFields.ts';
import {
  MAP_CONTOUR_LEVELS,
  resolveTerrainContourLevels,
  traceTerrainContours,
  type TerrainContourPath,
} from './terrainContours.ts';
import {
  projectIllustratedWoodland,
  type IllustratedWoodlandGlyph,
  type IllustratedWoodlandProjection,
  type IllustratedWoodlandSourceTree,
} from './illustratedWoodlandProjection.ts';

// Keep the original 512 px composition as the authoring grid, but rasterize it
// at 4x resolution. The strategic plane can cover a 1440p/4K viewport, where
// the old texture otherwise enlarged each source pixel into a visible block.
const MAP_ART_RESOLUTION = 512;
const MINIMAP_RESOLUTION = 2048;
const MAP_ART_SCALE = MINIMAP_RESOLUTION / MAP_ART_RESOLUTION;
const ROWS_PER_YIELD = 32 * MAP_ART_SCALE;
const RELIEF_GRID_RESOLUTION = 161;
const GRASS_GLYPH_SPACING = ILLUSTRATED_TERRAIN_STYLE.grassland
  .glyphSpacingAuthorPixels * MAP_ART_SCALE;

const PARCHMENT_COLOR = ILLUSTRATED_TERRAIN_STYLE.paper.base;
const WATER_WASH_COLOR = ILLUSTRATED_TERRAIN_STYLE.paper.waterWash;
const INK_COLOR = ILLUSTRATED_TERRAIN_STYLE.paper.terrainInk;

type TerrainMinimapTerrain = Pick<Terrain, 'getHeightAt' | 'generationSize' | 'size'>;

export type TerrainMinimapImageOptions = {
  riverField: RiverField;
  terrain: TerrainMinimapTerrain;
  treePlacements: readonly IllustratedWoodlandSourceTree[];
  seed: number;
};

export type TerrainMinimapImage = {
  canvas: HTMLCanvasElement;
  bounds: TerrainBounds;
  diagnostics: IllustratedTerrainMapDiagnostics;
};

export type IllustratedTerrainMapDiagnostics = {
  fieldContract: typeof ILLUSTRATED_TERRAIN_FIELD_CONTRACT;
  seed: number;
  elevation: ReliefDrawingDiagnostics;
  woodland: IllustratedWoodlandProjection['diagnostics'] & {
    drawnTreeGlyphCount: number;
    suppressedForWaterCount: number;
  };
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
  const woodlandProjection = projectIllustratedWoodland(
    options.treePlacements,
    bounds,
    MAP_ART_RESOLUTION,
  );
  const waterMask = await createParchmentRaster(context, riverField, seed);
  drawParchmentMottling(context, seed);
  drawGrassGlyphs(context, woodlandProjection.glyphs, seed, bounds, waterMask);
  await yieldToMain();
  const relief = await drawReliefLines(context, terrain, bounds, waterMask, seed);
  const woodlandDiagnostics = await drawForestGlyphs(
    context,
    woodlandProjection,
    seed,
    waterMask,
  );
  drawWaterHatching(context, waterMask, seed);
  drawInkBorder(context);

  const diagnostics: IllustratedTerrainMapDiagnostics = {
    fieldContract: ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
    seed,
    elevation: relief,
    woodland: woodlandDiagnostics,
  };

  canvas.dataset.terrainStyle = 'medieval-parchment';
  canvas.dataset.terrainFieldContract = ILLUSTRATED_TERRAIN_FIELD_CONTRACT;
  canvas.dataset.terrainSeed = String(seed >>> 0);
  canvas.dataset.palette = 'aged-rag-warm-grey';
  canvas.dataset.paperField = 'broad-middle-tooth-fibres-edge-patina';
  canvas.dataset.terrainMarkMaking = 'seeded-organic-charcoal-etching';
  canvas.dataset.terrainHierarchy = 'roads-buildings-stamps-over-relief';
  canvas.dataset.elevationStyle = 'dotted-charcoal-contours';
  canvas.dataset.contourIntervalMeters = String(diagnostics.elevation.contourIntervalMeters);
  canvas.dataset.contourLevels = String(diagnostics.elevation.contourLevelCount);
  canvas.dataset.contourPaths = String(diagnostics.elevation.contourPathCount);
  canvas.dataset.woodlandSource = 'accepted-tree-placements';
  canvas.dataset.woodlandSourceTrees = String(diagnostics.woodland.sourceTreeCount);
  canvas.dataset.woodlandProjectedGlyphs = String(diagnostics.woodland.treeGlyphCount);
  canvas.dataset.woodlandGlyphs = String(diagnostics.woodland.drawnTreeGlyphCount);
  canvas.dataset.woodlandOrphans = String(diagnostics.woodland.orphanGlyphCount);
  canvas.dataset.woodlandSignature = diagnostics.woodland.signature;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Hand-drawn parchment terrain map showing rivers, dotted elevation contours, grassland, and forest',
  );
  return { canvas, bounds, diagnostics };
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
  const sourceWaterMask = createRenderedWaterMask(riverField);
  const paperStyle = ILLUSTRATED_TERRAIN_STYLE.paper;
  const broadMottle = createValueNoiseGrid(
    MINIMAP_RESOLUTION,
    MINIMAP_RESOLUTION,
    paperStyle.broadMottleCellAuthorPixels * MAP_ART_SCALE,
    seed ^ 0x5f35_2a91,
  );
  const middleMottle = createValueNoiseGrid(
    MINIMAP_RESOLUTION,
    MINIMAP_RESOLUTION,
    paperStyle.middleMottleCellAuthorPixels * MAP_ART_SCALE,
    seed ^ 0x26d4_7c13,
  );
  const fibreBasis = createPaperFibreBasis(
    MINIMAP_RESOLUTION,
    MINIMAP_RESOLUTION,
    seed,
  );

  for (let row = 0; row < MINIMAP_RESOLUTION; row++) {
    if (row > 0 && row % ROWS_PER_YIELD === 0) await yieldToMain();
    const riverRow = (row / denominator) * riverDenominator;

    for (let column = 0; column < MINIMAP_RESOLUTION; column++) {
      const riverColumn = (column / denominator) * riverDenominator;
      const pixelIndex = row * MINIMAP_RESOLUTION + column;
      const wetCoverage = sampleBinaryMaskBilinear(sourceWaterMask, riverField.resolution, riverColumn, riverRow);
      waterMask[pixelIndex] = wetCoverage >= 0.5 ? 1 : 0;
    }
  }

  for (let row = 0; row < MINIMAP_RESOLUTION; row++) {
    if (row > 0 && row % ROWS_PER_YIELD === 0) await yieldToMain();

    for (let column = 0; column < MINIMAP_RESOLUTION; column++) {
      const pixelIndex = row * MINIMAP_RESOLUTION + column;
      const isWater = waterMask[pixelIndex] === 1;
      const grain = mapHash(column, row, seed) - 0.5;
      const longFiber = (
        fibreBasis.sinColumnPrimary[column] * fibreBasis.cosRowPrimary[row]
          + fibreBasis.cosColumnPrimary[column] * fibreBasis.sinRowPrimary[row]
      ) * 0.68 * paperStyle.fibreAmplitude + (
        fibreBasis.sinColumnSecondary[column] * fibreBasis.cosRowSecondary[row]
          + fibreBasis.cosColumnSecondary[column] * fibreBasis.sinRowSecondary[row]
      ) * 0.32 * paperStyle.fibreAmplitude;
      const broadSample = sampleValueNoiseGridPixel(broadMottle, column, row);
      const middleSample = sampleValueNoiseGridPixel(middleMottle, column, row);
      const edgeDistance = Math.min(
        column,
        row,
        MINIMAP_RESOLUTION - 1 - column,
        MINIMAP_RESOLUTION - 1 - row,
      );
      const edgeWidth = paperStyle.edgePatinaWidthAuthorPixels * MAP_ART_SCALE
        * (0.78 + broadSample * 0.46);
      const edgePatina = 1 - smoothstep01(edgeDistance / Math.max(1, edgeWidth));
      const base = isWater
        ? blendColors(PARCHMENT_COLOR, WATER_WASH_COLOR, 0.62 + grain * 0.07)
        : PARCHMENT_COLOR;
      const edgeStrength = waterBoundaryStrength(waterMask, column, row);
      const inkMix = edgeStrength * (0.72 + mapHash(column + 91, row - 37, seed) * 0.18);
      const paperVariation = (broadSample * 2 - 1) * paperStyle.broadMottleAmplitude
        + (middleSample * 2 - 1) * paperStyle.middleMottleAmplitude
        + grain * paperStyle.grainAmplitude
        + longFiber
        - edgePatina * paperStyle.edgeDarkening;
      const color = blendColors(
        {
          r: base.r + paperVariation,
          g: base.g + paperVariation * 0.96,
          b: base.b + paperVariation * 0.9,
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

function createRenderedWaterMask(riverField: RiverField): Uint8Array {
  const mask = new Uint8Array(riverField.resolution * riverField.resolution);
  for (let row = 0; row < riverField.resolution; row++) {
    for (let column = 0; column < riverField.resolution; column++) {
      mask[row * riverField.resolution + column] = riverField.isRenderedWetAtGrid(column, row) ? 1 : 0;
    }
  }
  return mask;
}

function sampleBinaryMaskBilinear(mask: Uint8Array, resolution: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(resolution - 1, x0 + 1);
  const y1 = Math.min(resolution - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = mask[y0 * resolution + x0] * (1 - tx) + mask[y0 * resolution + x1] * tx;
  const bottom = mask[y1 * resolution + x0] * (1 - tx) + mask[y1 * resolution + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function drawParchmentMottling(context: CanvasRenderingContext2D, seed: number): void {
  const rng = mulberry32(seed ^ 0x7a4d_21c3);
  const paperStyle = ILLUSTRATED_TERRAIN_STYLE.paper;
  context.save();
  context.globalCompositeOperation = 'multiply';

  // Broad handling stains carry most of the old rag-paper identity. Their
  // irregular ellipses deliberately overlap the coherent raster field rather
  // than acting as a uniform vignette.
  for (let index = 0; index < paperStyle.stainCount; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const radius = (18 + rng() * 108) * MAP_ART_SCALE;
    const stain = paperStyle.stain;
    const stainAlpha = paperStyle.stainAlphaMin
      + rng() * paperStyle.stainAlphaRange;
    drawFeatheredPaperOval(context, {
      x,
      y,
      radius,
      aspect: 0.3 + rng() * 0.58,
      rotation: rng() * Math.PI,
      color: stain,
      alpha: stainAlpha,
    });
  }

  // Hairline pulp fibres and sparse foxing live below the drawing ink. Their
  // very low alpha becomes material tooth after minification instead of noise.
  context.lineCap = 'round';
  for (let index = 0; index < paperStyle.fibreCount; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const length = (10 + rng() * 76) * MAP_ART_SCALE;
    const angle = (rng() - 0.5) * 0.46 + (rng() > 0.9 ? Math.PI * 0.5 : 0);
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    const bend = (rng() - 0.5) * 4.5 * MAP_ART_SCALE;
    context.strokeStyle = `rgba(${paperStyle.stain.r}, ${paperStyle.stain.g}, ${paperStyle.stain.b}, ${0.012 + rng() * 0.022})`;
    context.lineWidth = (0.12 + rng() * 0.34) * MAP_ART_SCALE;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(
      (x + endX) * 0.5 - Math.sin(angle) * bend,
      (y + endY) * 0.5 + Math.cos(angle) * bend,
      endX,
      endY,
    );
    context.stroke();
  }

  for (let index = 0; index < paperStyle.foxingCount; index++) {
    const radius = (0.12 + rng() ** 2 * 1.05) * MAP_ART_SCALE;
    context.fillStyle = `rgba(${paperStyle.stain.r}, ${paperStyle.stain.g}, ${paperStyle.stain.b}, ${0.012 + rng() * 0.04})`;
    context.beginPath();
    context.arc(
      rng() * MINIMAP_RESOLUTION,
      rng() * MINIMAP_RESOLUTION,
      radius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.globalCompositeOperation = 'screen';
  for (let index = 0; index < paperStyle.bleachCount; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const radius = (28 + rng() * 88) * MAP_ART_SCALE;
    const bleach = paperStyle.bleach;
    const bleachAlpha = paperStyle.bleachAlphaMin
      + rng() * paperStyle.bleachAlphaRange;
    drawFeatheredPaperOval(context, {
      x,
      y,
      radius,
      aspect: 0.4 + rng() * 0.5,
      rotation: rng() * Math.PI,
      color: bleach,
      alpha: bleachAlpha,
    });
  }

  context.restore();
}

/**
 * Draw the gradient in the same transformed space as the oval. A circular
 * gradient clipped by a narrow ellipse keeps substantial opacity at its short
 * sides, which turns subtle paper weathering into a clearly outlined badge.
 */
function drawFeatheredPaperOval(
  context: CanvasRenderingContext2D,
  options: {
    x: number;
    y: number;
    radius: number;
    aspect: number;
    rotation: number;
    color: { r: number; g: number; b: number };
    alpha: number;
  },
): void {
  const { x, y, radius, aspect, rotation, color, alpha } = options;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(1, aspect);

  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
  gradient.addColorStop(0.28, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.78})`);
  gradient.addColorStop(0.62, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.32})`);
  gradient.addColorStop(0.84, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.08})`);
  gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

type ReliefDrawingDiagnostics = IllustratedElevationStats & {
  contourIntervalMeters: number;
  contourLevelCount: number;
  contourPathCount: number;
  contourMarkCount: number;
};

async function drawReliefLines(
  context: CanvasRenderingContext2D,
  terrain: TerrainMinimapTerrain,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
  seed: number,
): Promise<ReliefDrawingDiagnostics> {
  const heights = new Float32Array(RELIEF_GRID_RESOLUTION * RELIEF_GRID_RESOLUTION);
  const denominator = RELIEF_GRID_RESOLUTION - 1;
  for (let row = 0; row < RELIEF_GRID_RESOLUTION; row++) {
    if (row > 0 && row % 16 === 0) await yieldToMain();
    const z = bounds.minZ + row / denominator * (bounds.maxZ - bounds.minZ);
    for (let column = 0; column < RELIEF_GRID_RESOLUTION; column++) {
      const x = bounds.minX + column / denominator * (bounds.maxX - bounds.minX);
      heights[row * RELIEF_GRID_RESOLUTION + column] = terrain.getHeightAt(x, z);
    }
  }
  const stats = resolveIllustratedElevationStats(heights);
  const { intervalMeters, levels } = resolveTerrainContourLevels(stats.minimum, stats.maximum);
  const diagnostics: ReliefDrawingDiagnostics = {
    ...stats,
    contourIntervalMeters: intervalMeters,
    contourLevelCount: levels.length,
    contourPathCount: 0,
    contourMarkCount: 0,
  };
  if (!levels.length) return diagnostics;

  // A separate ink sheet lets the exact river mask erase charcoal from water,
  // including thin tributaries that can run through a single contour cell.
  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = MINIMAP_RESOLUTION;
  inkCanvas.height = MINIMAP_RESOLUTION;
  const ink = inkCanvas.getContext('2d')!;
  ink.lineCap = 'round';
  ink.lineJoin = 'round';
  for (const level of levels) {
    const paths = traceTerrainContours(heights, RELIEF_GRID_RESOLUTION, level);
    const index = Math.round(level / intervalMeters);
    const isIndex = index % MAP_CONTOUR_LEVELS.indexEvery === 0;
    diagnostics.contourPathCount += paths.length;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      diagnostics.contourMarkCount += drawCharcoalContour(
        ink, paths[pathIndex], isIndex,
        seed ^ Math.imul(index, 0x45d9f3b) ^ Math.imul(pathIndex + 1, 0x119de1f3),
      );
    }
    await yieldToMain();
  }

  const pixels = ink.getImageData(0, 0, MINIMAP_RESOLUTION, MINIMAP_RESOLUTION);
  for (let row = 0; row < MINIMAP_RESOLUTION; row++) {
    if (row > 0 && row % ROWS_PER_YIELD === 0) await yieldToMain();
    for (let column = 0; column < MINIMAP_RESOLUTION; column++) {
      const index = row * MINIMAP_RESOLUTION + column;
      if (waterMask[index]) pixels.data[index * 4 + 3] = 0;
    }
  }
  ink.putImageData(pixels, 0, 0);
  context.save();
  context.beginPath();
  context.rect(5 * MAP_ART_SCALE, 5 * MAP_ART_SCALE,
    MINIMAP_RESOLUTION - 10 * MAP_ART_SCALE, MINIMAP_RESOLUTION - 10 * MAP_ART_SCALE);
  context.clip();
  context.drawImage(inkCanvas, 0, 0);
  context.restore();
  return diagnostics;
}

function drawCharcoalContour(
  context: CanvasRenderingContext2D,
  path: TerrainContourPath,
  isIndex: boolean,
  seed: number,
): number {
  const style = ILLUSTRATED_TERRAIN_STYLE.contours;
  const random = mulberry32(seed);
  const color = style.ink;
  const alpha = isIndex ? style.indexAlpha : style.alpha;
  const width = isIndex ? style.indexWidthAuthorPixels : style.lineWidthAuthorPixels;
  let distanceToMark = random() * style.spacingAuthorPixels * MAP_ART_SCALE;
  let markCount = 0;

  for (let pointIndex = 1; pointIndex < path.points.length; pointIndex++) {
    const from = path.points[pointIndex - 1];
    const to = path.points[pointIndex];
    const dx = (to.x - from.x) * (MINIMAP_RESOLUTION - 1);
    const dy = (to.y - from.y) * (MINIMAP_RESOLUTION - 1);
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const tangentX = dx / length;
    const tangentY = dy / length;
    while (distanceToMark < length) {
      const drift = (random() - 0.5) * style.driftAuthorPixels * MAP_ART_SCALE;
      const x = from.x * (MINIMAP_RESOLUTION - 1) + tangentX * distanceToMark - tangentY * drift;
      const y = from.y * (MINIMAP_RESOLUTION - 1) + tangentY * distanceToMark + tangentX * drift;
      const halfLength = (style.markLengthMinAuthorPixels
        + random() ** 2 * style.markLengthRangeAuthorPixels) * MAP_ART_SCALE * 0.5;
      const pressure = 0.7 + random() * 0.6;
      const markWidth = width * (0.75 + random() * 0.5) * MAP_ART_SCALE;

      context.beginPath();
      context.moveTo(x - tangentX * halfLength, y - tangentY * halfLength);
      context.lineTo(x + tangentX * halfLength, y + tangentY * halfLength);
      // A soft rub below each mark and an uneven dark core mimic charcoal
      // catching the paper tooth, without a continuous machine-dashed line.
      context.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * style.rubAlphaScale})`;
      context.lineWidth = markWidth * style.rubWidthScale;
      context.stroke();
      context.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * pressure})`;
      context.lineWidth = markWidth;
      context.stroke();

      const toothOffset = (random() - 0.5) * markWidth * 1.9;
      context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.5})`;
      context.beginPath();
      context.arc(x - tangentY * toothOffset, y + tangentX * toothOffset,
        (0.09 + random() * 0.15) * MAP_ART_SCALE, 0, Math.PI * 2);
      context.fill();
      markCount++;
      // Carry the distance through cell boundaries so no square grid shows.
      distanceToMark += style.spacingAuthorPixels * (0.72 + random() * 0.56) * MAP_ART_SCALE;
    }
    distanceToMark -= length;
  }
  return markCount;
}

function drawGrassGlyphs(
  context: CanvasRenderingContext2D,
  woodlandGlyphs: readonly IllustratedWoodlandGlyph[],
  seed: number,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
): void {
  context.save();
  const grassInk = ILLUSTRATED_TERRAIN_STYLE.grassland.ink;
  context.globalCompositeOperation = 'multiply';
  context.strokeStyle = `rgba(${grassInk.r}, ${grassInk.g}, ${grassInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.grassland.alpha})`;
  context.lineWidth = ILLUSTRATED_TERRAIN_STYLE.grassland.lineWidthAuthorPixels
    * MAP_ART_SCALE;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const patchField = createValueNoiseGrid(
    MINIMAP_RESOLUTION,
    MINIMAP_RESOLUTION,
    ILLUSTRATED_TERRAIN_STYLE.grassland.patchCellAuthorPixels * MAP_ART_SCALE,
    seed ^ 0x2f5c_61a7,
  );

  const inset = 8 * MAP_ART_SCALE;
  for (let row = inset; row < MINIMAP_RESOLUTION - inset; row += GRASS_GLYPH_SPACING) {
    for (let column = inset; column < MINIMAP_RESOLUTION - inset; column += GRASS_GLYPH_SPACING) {
      const jitterX = (mapHash(column, row, seed ^ 0x1821) - 0.5) * 13 * MAP_ART_SCALE;
      const jitterY = (mapHash(column, row, seed ^ 0x2b77) - 0.5) * 13 * MAP_ART_SCALE;
      const pixelX = column + jitterX;
      const pixelY = row + jitterY;
      if (isWaterPixel(waterMask, pixelX, pixelY)) continue;
      if (hasWoodlandGlyphNear(woodlandGlyphs, pixelX, pixelY, 6.5)) continue;
      const world = pixelToWorld(pixelX, pixelY, bounds);
      const [meadow, , dry] = sampleTerrainBlendWeights(world.x, world.z);
      const patch = smoothstep01(
        (sampleValueNoiseGrid(patchField, pixelX, pixelY) - 0.31) / 0.5,
      );
      const chance = (0.12 + meadow * 0.3 + dry * 0.13) * (0.22 + patch * 1.38);
      if (mapHash(column + 17, row - 9, seed) > chance) continue;
      const height = (1.55 + mapHash(column - 31, row + 42, seed) * 1.65)
        * MAP_ART_SCALE;
      drawGrassTuft(
        context,
        pixelX,
        pixelY,
        height,
        (mapHash(column, row, seed ^ 0x51a4) - 0.5) * height * 0.58,
        mapHash(column + 57, row - 22, seed ^ 0x81a7),
      );
    }
  }

  context.restore();
}

async function drawForestGlyphs(
  context: CanvasRenderingContext2D,
  projection: IllustratedWoodlandProjection,
  seed: number,
  waterMask: Uint8Array,
): Promise<IllustratedTerrainMapDiagnostics['woodland']> {
  const glyphs = [...projection.glyphs].sort((a, b) => (
    a.authorY - b.authorY
      || a.authorX - b.authorX
      || a.layoutIndex - b.layoutIndex
  ));
  context.save();
  const woodlandInk = ILLUSTRATED_TERRAIN_STYLE.paper.terrainInk;
  context.globalCompositeOperation = 'multiply';
  context.strokeStyle = `rgba(${woodlandInk.r}, ${woodlandInk.g}, ${woodlandInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.woodland.outlineAlpha})`;
  context.fillStyle = `rgba(${woodlandInk.r}, ${woodlandInk.g}, ${woodlandInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.woodland.fillAlpha})`;
  context.lineWidth = ILLUSTRATED_TERRAIN_STYLE.woodland.lineWidthAuthorPixels
    * MAP_ART_SCALE;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let drawnTreeGlyphCount = 0;
  let suppressedForWaterCount = 0;

  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex++) {
    if (glyphIndex > 0 && glyphIndex % 384 === 0) await yieldToMain();
    const glyph = glyphs[glyphIndex];
    const pixelX = glyph.authorX / MAP_ART_RESOLUTION * (MINIMAP_RESOLUTION - 1);
    const pixelY = glyph.authorY / MAP_ART_RESOLUTION * (MINIMAP_RESOLUTION - 1);
    if (isWaterPixel(waterMask, pixelX, pixelY)) {
      suppressedForWaterCount++;
      continue;
    }
    const symbolScale = glyph.symbolScaleAuthorPixels * MAP_ART_SCALE;
    const lean = (
      mapHash(glyph.layoutIndex, 73, seed ^ 0x731f) - 0.5
    ) * symbolScale * 4;
    const rotation = (
      mapHash(glyph.layoutIndex, 149, seed ^ 0x4d2b) - 0.5
    ) * 0.34;
    const variantCount = glyph.conifer
      ? ILLUSTRATED_TERRAIN_STYLE.woodland.coniferSilhouetteVariants
      : ILLUSTRATED_TERRAIN_STYLE.woodland.broadleafSilhouetteVariants;
    const variant = Math.min(
      variantCount - 1,
      Math.floor(mapHash(glyph.layoutIndex, 211, seed ^ 0x1f83) * variantCount),
    );
    context.save();
    context.translate(pixelX, pixelY);
    context.rotate(rotation);
    if (glyph.conifer) {
      drawConiferGlyph(context, 0, 0, symbolScale, lean, variant);
    } else {
      drawBroadleafGlyph(context, 0, 0, symbolScale, lean, variant);
    }
    context.restore();
    drawnTreeGlyphCount++;
  }

  context.restore();
  return {
    ...projection.diagnostics,
    drawnTreeGlyphCount,
    suppressedForWaterCount,
  };
}

function hasWoodlandGlyphNear(
  glyphs: readonly IllustratedWoodlandGlyph[],
  pixelX: number,
  pixelY: number,
  radiusAuthorPixels: number,
): boolean {
  const authorX = pixelX / (MINIMAP_RESOLUTION - 1) * MAP_ART_RESOLUTION;
  const authorY = pixelY / (MINIMAP_RESOLUTION - 1) * MAP_ART_RESOLUTION;
  const radiusSquared = radiusAuthorPixels * radiusAuthorPixels;
  return glyphs.some((glyph) => {
    const dx = glyph.authorX - authorX;
    const dy = glyph.authorY - authorY;
    return dx * dx + dy * dy <= radiusSquared;
  });
}

function drawWaterHatching(
  context: CanvasRenderingContext2D,
  waterMask: Uint8Array,
  seed: number,
): void {
  context.save();
  context.strokeStyle = 'rgba(47, 58, 50, 0.54)';
  context.lineWidth = 0.75 * MAP_ART_SCALE;
  context.lineCap = 'round';

  const inset = 9 * MAP_ART_SCALE;
  for (let row = inset; row < MINIMAP_RESOLUTION - inset; row += 13 * MAP_ART_SCALE) {
    for (let column = inset; column < MINIMAP_RESOLUTION - inset; column += 17 * MAP_ART_SCALE) {
      const jitterX = (mapHash(column, row, seed ^ 0x56ce) - 0.5) * 8 * MAP_ART_SCALE;
      const jitterY = (mapHash(column, row, seed ^ 0x112f) - 0.5) * 6 * MAP_ART_SCALE;
      const x = column + jitterX;
      const y = row + jitterY;
      const length = (4 + mapHash(column + 7, row + 3, seed) * 5) * MAP_ART_SCALE;
      if (
        !isWaterPixel(waterMask, x, y) ||
        !isWaterPixel(waterMask, x - length * 0.5, y) ||
        !isWaterPixel(waterMask, x + length * 0.5, y)
      )
        continue;
      context.beginPath();
      context.moveTo(x - length * 0.5, y);
      context.quadraticCurveTo(x - length * 0.2, y - 1.1 * MAP_ART_SCALE, x, y);
      context.quadraticCurveTo(x + length * 0.2, y + 1.1 * MAP_ART_SCALE, x + length * 0.5, y);
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
  variant: number,
): void {
  const variantIndex = Math.min(9, Math.floor(variant * 10));
  const bladeCount = 3 + variantIndex % 5;
  const width = height * (0.78 + glyphVariantHash(variantIndex, 1, 0x35) * 0.5);
  const baseY = y + MAP_ART_SCALE * (0.34 + glyphVariantHash(variantIndex, 2, 0x51) * 0.22);
  const baseLineWidth = context.lineWidth;

  context.save();
  for (let blade = 0; blade < bladeCount; blade++) {
    const slot = bladeCount === 1 ? 0.5 : blade / (bladeCount - 1);
    const rootJitter = (glyphVariantHash(variantIndex, blade, 0x83) - 0.5) * width * 0.2;
    const rootX = x + (slot - 0.5) * width * 0.72 + rootJitter;
    const bladeHeight = height * (
      0.48 + glyphVariantHash(variantIndex, blade, 0xa7) * 0.52
    );
    const fan = (slot - 0.5) * width * (
      0.72 + glyphVariantHash(variantIndex, blade, 0xc1) * 0.42
    );
    const tipX = rootX + fan + lean * (
      0.28 + glyphVariantHash(variantIndex, blade, 0xe5) * 0.52
    );
    const tipY = baseY - bladeHeight;
    const bend = (glyphVariantHash(variantIndex, blade, 0x107) - 0.5) * width * 0.48;
    context.globalAlpha = 0.72 + glyphVariantHash(variantIndex, blade, 0x12b) * 0.28;
    context.lineWidth = baseLineWidth * (
      0.76 + glyphVariantHash(variantIndex, blade, 0x14f) * 0.3
    );
    context.beginPath();
    context.moveTo(rootX, baseY);
    context.quadraticCurveTo(
      (rootX + tipX) * 0.5 + bend,
      baseY - bladeHeight * (0.34 + glyphVariantHash(variantIndex, blade, 0x173) * 0.2),
      tipX,
      tipY,
    );
    context.stroke();
  }

  context.globalAlpha = 0.54 + glyphVariantHash(variantIndex, 7, 0x197) * 0.26;
  context.lineWidth = baseLineWidth * 0.72;
  context.beginPath();
  context.moveTo(x - width * 0.5, baseY + MAP_ART_SCALE * 0.08);
  context.quadraticCurveTo(
    x + lean * 0.18,
    baseY - MAP_ART_SCALE * (0.08 + variant * 0.16),
    x + width * (0.24 + variant * 0.34),
    baseY,
  );
  context.stroke();
  context.restore();
}

function drawConiferGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  lean: number,
  variant: number,
): void {
  const height = (8.1 + glyphVariantHash(variant, 0, 0x211) * 1.55) * scale;
  const halfWidth = (2.8 + glyphVariantHash(variant, 1, 0x239) * 0.85) * scale;
  const tierCount = 3 + variant % 4;
  const baseLineWidth = context.lineWidth;

  context.save();
  context.lineWidth = baseLineWidth * 0.82;
  context.globalAlpha = 0.92;
  context.beginPath();
  context.moveTo(x, y + 1.7 * scale);
  context.bezierCurveTo(
    x - lean * 0.08,
    y - height * 0.26,
    x + lean * 0.56,
    y - height * 0.72,
    x + lean,
    y - height,
  );
  context.stroke();

  for (let tier = 0; tier < tierCount; tier++) {
    const along = (tier + 1) / (tierCount + 0.72);
    const tierY = y - height + along * height * 0.9;
    const centerX = x + lean * (1 - along * 0.92);
    const tierWidth = halfWidth * Math.pow(along, 0.7)
      * (0.8 + glyphVariantHash(variant, tier, 0x263) * 0.38);
    const leftLength = tierWidth * (0.72 + glyphVariantHash(variant, tier, 0x28d) * 0.44);
    const rightLength = tierWidth * (0.7 + glyphVariantHash(variant, tier, 0x2b7) * 0.46);
    const leftDrop = scale * (0.25 + glyphVariantHash(variant, tier, 0x2e1) * 0.78);
    const rightDrop = scale * (0.25 + glyphVariantHash(variant, tier, 0x30b) * 0.78);

    context.globalAlpha = 0.7 + glyphVariantHash(variant, tier, 0x335) * 0.3;
    context.lineWidth = baseLineWidth * (
      0.84 + glyphVariantHash(variant, tier, 0x35f) * 0.2
    );
    context.beginPath();
    context.moveTo(centerX, tierY - scale * 0.18);
    context.quadraticCurveTo(
      centerX - leftLength * 0.42,
      tierY - scale * (0.18 + glyphVariantHash(variant, tier, 0x389) * 0.35),
      centerX - leftLength,
      tierY + leftDrop,
    );
    context.stroke();
    context.globalAlpha *= 0.84 + glyphVariantHash(variant, tier, 0x3b3) * 0.16;
    context.beginPath();
    context.moveTo(centerX + scale * 0.03, tierY);
    context.quadraticCurveTo(
      centerX + rightLength * 0.46,
      tierY - scale * (0.12 + glyphVariantHash(variant, tier, 0x3dd) * 0.38),
      centerX + rightLength,
      tierY + rightDrop,
    );
    context.stroke();

    if ((variant + tier) % 2 === 0) {
      context.globalAlpha *= 0.58;
      context.lineWidth = baseLineWidth * 0.58;
      context.beginPath();
      context.moveTo(centerX - leftLength * 0.18, tierY + scale * 0.02);
      context.lineTo(centerX - leftLength * 0.68, tierY - scale * 0.5);
      context.moveTo(centerX + rightLength * 0.2, tierY + scale * 0.08);
      context.lineTo(centerX + rightLength * 0.64, tierY - scale * 0.42);
      context.stroke();
    }
  }

  context.globalAlpha = 0.82;
  context.lineWidth = baseLineWidth * 0.7;
  context.beginPath();
  context.moveTo(x + lean, y - height);
  context.quadraticCurveTo(
    x + lean + scale * (variant % 2 === 0 ? -0.32 : 0.32),
    y - height - scale * 0.56,
    x + lean * 1.02,
    y - height - scale * 0.92,
  );
  context.stroke();
  context.restore();
}

function drawBroadleafGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  lean: number,
  variant: number,
): void {
  const crownY = y - (4.7 + glyphVariantHash(variant, 0, 0x401) * 0.65) * scale;
  const radiusX = (3.55 + glyphVariantHash(variant, 1, 0x42b) * 0.95) * scale;
  const radiusY = (3.25 + glyphVariantHash(variant, 2, 0x455) * 0.88) * scale;
  const pointCount = 9 + variant % 4;
  const points: Array<{ x: number; y: number }> = [];
  const phase = glyphVariantHash(variant, 3, 0x47f) * Math.PI * 2;
  const baseLineWidth = context.lineWidth;

  for (let point = 0; point < pointCount; point++) {
    const angle = -Math.PI * 0.5 + point / pointCount * Math.PI * 2;
    const lobe = 0.76
      + glyphVariantHash(variant, point, 0x4a9) * 0.3
      + Math.sin(angle * (3 + variant % 3) + phase) * 0.08;
    const upperLean = Math.max(0, -Math.sin(angle)) * lean;
    points.push({
      x: x + Math.cos(angle) * radiusX * lobe + upperLean,
      y: crownY + Math.sin(angle) * radiusY * lobe,
    });
  }

  context.save();
  context.beginPath();
  const first = midpoint(points[pointCount - 1], points[0]);
  context.moveTo(first.x, first.y);
  for (let point = 0; point < pointCount; point++) {
    const next = points[(point + 1) % pointCount];
    const end = midpoint(points[point], next);
    context.quadraticCurveTo(points[point].x, points[point].y, end.x, end.y);
  }
  context.closePath();
  context.fill();

  // Draw each lobe independently so pressure breakup varies around the crown
  // instead of producing a pristine vector outline.
  for (let point = 0; point < pointCount; point++) {
    const previous = points[(point + pointCount - 1) % pointCount];
    const next = points[(point + 1) % pointCount];
    const start = midpoint(previous, points[point]);
    const end = midpoint(points[point], next);
    context.globalAlpha = 0.7 + glyphVariantHash(variant, point, 0x4d3) * 0.3;
    context.lineWidth = baseLineWidth * (
      0.84 + glyphVariantHash(variant, point, 0x4fd) * 0.22
    );
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(points[point].x, points[point].y, end.x, end.y);
    context.stroke();
  }

  // Forked trunk and uneven interior canopy scratches supply the etched mass
  // that survives the strategic map's trilinear minification.
  context.globalAlpha = 0.68;
  context.lineWidth = baseLineWidth * 0.76;
  context.beginPath();
  context.moveTo(x - scale * 0.1, y + 1.75 * scale);
  context.bezierCurveTo(
    x + scale * 0.12,
    y - scale * 0.5,
    x + lean * 0.34,
    crownY + radiusY * 0.48,
    x + lean * 0.54,
    crownY + radiusY * 0.05,
  );
  context.stroke();

  const branchCount = 2 + variant % 4;
  for (let branch = 0; branch < branchCount; branch++) {
    const side = (branch + variant) % 2 === 0 ? -1 : 1;
    const branchHeight = 0.12 + branch / Math.max(1, branchCount - 1) * 0.54;
    const originX = x + lean * branchHeight * 0.48;
    const originY = y - scale * 0.45 - branchHeight * radiusY * 1.35;
    const endX = x + lean * 0.55 + side * radiusX * (
      0.34 + glyphVariantHash(variant, branch, 0x527) * 0.34
    );
    const endY = crownY - radiusY * (
      0.05 + glyphVariantHash(variant, branch, 0x551) * 0.48
    );
    context.globalAlpha = 0.42 + glyphVariantHash(variant, branch, 0x57b) * 0.24;
    context.lineWidth = baseLineWidth * 0.58;
    context.beginPath();
    context.moveTo(originX, originY);
    context.quadraticCurveTo(
      (originX + endX) * 0.5 + side * scale * 0.2,
      (originY + endY) * 0.5 - scale * 0.28,
      endX,
      endY,
    );
    context.stroke();
  }

  const hatchCount = 3 + (variant * 3) % 4;
  for (let hatch = 0; hatch < hatchCount; hatch++) {
    const px = x + lean * 0.52 + (
      glyphVariantHash(variant, hatch, 0x5a5) - 0.5
    ) * radiusX * 1.18;
    const py = crownY + (
      glyphVariantHash(variant, hatch, 0x5cf) - 0.5
    ) * radiusY * 1.05;
    const curlRadius = scale * (0.52 + glyphVariantHash(variant, hatch, 0x5f9) * 0.7);
    context.globalAlpha = 0.5 + glyphVariantHash(variant, hatch, 0x623) * 0.3;
    context.lineWidth = baseLineWidth * 0.62;
    context.beginPath();
    context.moveTo(px - curlRadius, py + curlRadius * 0.2);
    context.quadraticCurveTo(
      px - curlRadius * 0.08,
      py - curlRadius,
      px + curlRadius,
      py + curlRadius * 0.12,
    );
    context.stroke();
  }
  context.restore();
}

function drawInkBorder(context: CanvasRenderingContext2D): void {
  context.save();
  context.strokeStyle = 'rgba(55, 43, 27, 0.72)';
  context.lineWidth = 1.4 * MAP_ART_SCALE;
  context.strokeRect(
    5.5 * MAP_ART_SCALE,
    5.5 * MAP_ART_SCALE,
    MINIMAP_RESOLUTION - 11 * MAP_ART_SCALE,
    MINIMAP_RESOLUTION - 11 * MAP_ART_SCALE,
  );
  context.strokeStyle = 'rgba(55, 43, 27, 0.32)';
  context.lineWidth = 0.7 * MAP_ART_SCALE;
  context.strokeRect(
    9.5 * MAP_ART_SCALE,
    9.5 * MAP_ART_SCALE,
    MINIMAP_RESOLUTION - 19 * MAP_ART_SCALE,
    MINIMAP_RESOLUTION - 19 * MAP_ART_SCALE,
  );
  context.restore();
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

type ValueNoiseGrid = {
  cellSize: number;
  columns: number;
  rows: number;
  values: Float32Array;
  xIndex: Uint16Array;
  xBlend: Float32Array;
  yIndex: Uint16Array;
  yBlend: Float32Array;
};

type PaperFibreBasis = {
  sinColumnPrimary: Float32Array;
  cosColumnPrimary: Float32Array;
  sinRowPrimary: Float32Array;
  cosRowPrimary: Float32Array;
  sinColumnSecondary: Float32Array;
  cosColumnSecondary: Float32Array;
  sinRowSecondary: Float32Array;
  cosRowSecondary: Float32Array;
};

function createValueNoiseGrid(
  width: number,
  height: number,
  cellSize: number,
  seed: number,
): ValueNoiseGrid {
  const safeCellSize = Math.max(1, cellSize);
  const columns = Math.ceil(width / safeCellSize) + 2;
  const rows = Math.ceil(height / safeCellSize) + 2;
  const values = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      values[row * columns + column] = mapHash(column, row, seed);
    }
  }
  const xAxis = createValueNoiseAxis(width, safeCellSize, columns);
  const yAxis = createValueNoiseAxis(height, safeCellSize, rows);
  return {
    cellSize: safeCellSize,
    columns,
    rows,
    values,
    xIndex: xAxis.index,
    xBlend: xAxis.blend,
    yIndex: yAxis.index,
    yBlend: yAxis.blend,
  };
}

function createValueNoiseAxis(
  length: number,
  cellSize: number,
  gridLength: number,
): { index: Uint16Array; blend: Float32Array } {
  const index = new Uint16Array(length);
  const blend = new Float32Array(length);
  for (let pixel = 0; pixel < length; pixel++) {
    const gridPosition = pixel / cellSize;
    const cell = Math.min(gridLength - 2, Math.floor(gridPosition));
    index[pixel] = cell;
    blend[pixel] = smoothstep01(gridPosition - cell);
  }
  return { index, blend };
}

function sampleValueNoiseGridPixel(
  grid: ValueNoiseGrid,
  x: number,
  y: number,
): number {
  const x0 = grid.xIndex[x];
  const y0 = grid.yIndex[y];
  const tx = grid.xBlend[x];
  const ty = grid.yBlend[y];
  const topOffset = y0 * grid.columns + x0;
  const bottomOffset = topOffset + grid.columns;
  const top = grid.values[topOffset] * (1 - tx)
    + grid.values[topOffset + 1] * tx;
  const bottom = grid.values[bottomOffset] * (1 - tx)
    + grid.values[bottomOffset + 1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleValueNoiseGrid(grid: ValueNoiseGrid, x: number, y: number): number {
  const gridX = Math.max(0, x) / grid.cellSize;
  const gridY = Math.max(0, y) / grid.cellSize;
  const x0 = Math.min(grid.columns - 2, Math.floor(gridX));
  const y0 = Math.min(grid.rows - 2, Math.floor(gridY));
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep01(gridX - x0);
  const ty = smoothstep01(gridY - y0);
  const top = grid.values[y0 * grid.columns + x0] * (1 - tx)
    + grid.values[y0 * grid.columns + x1] * tx;
  const bottom = grid.values[y1 * grid.columns + x0] * (1 - tx)
    + grid.values[y1 * grid.columns + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function createPaperFibreBasis(
  width: number,
  height: number,
  seed: number,
): PaperFibreBasis {
  const sinColumnPrimary = new Float32Array(width);
  const cosColumnPrimary = new Float32Array(width);
  const sinColumnSecondary = new Float32Array(width);
  const cosColumnSecondary = new Float32Array(width);
  const sinRowPrimary = new Float32Array(height);
  const cosRowPrimary = new Float32Array(height);
  const sinRowSecondary = new Float32Array(height);
  const cosRowSecondary = new Float32Array(height);
  for (let column = 0; column < width; column++) {
    const authorX = column / MAP_ART_SCALE;
    const primary = authorX * 0.071;
    const secondary = authorX * 0.193;
    sinColumnPrimary[column] = Math.sin(primary);
    cosColumnPrimary[column] = Math.cos(primary);
    sinColumnSecondary[column] = Math.sin(secondary);
    cosColumnSecondary[column] = Math.cos(secondary);
  }
  for (let row = 0; row < height; row++) {
    const authorY = row / MAP_ART_SCALE;
    const primary = authorY * 0.017 + seed * 0.0017;
    const secondary = -authorY * 0.011 + seed * 0.00091;
    sinRowPrimary[row] = Math.sin(primary);
    cosRowPrimary[row] = Math.cos(primary);
    sinRowSecondary[row] = Math.sin(secondary);
    cosRowSecondary[row] = Math.cos(secondary);
  }
  return {
    sinColumnPrimary,
    cosColumnPrimary,
    sinRowPrimary,
    cosRowPrimary,
    sinColumnSecondary,
    cosColumnSecondary,
    sinRowSecondary,
    cosRowSecondary,
  };
}

function glyphVariantHash(variant: number, feature: number, salt: number): number {
  return mapHash(
    variant * 131 + salt,
    feature * 197 - salt,
    salt ^ Math.imul(variant + 1, 0x45d9f3b),
  );
}

function midpoint(
  first: { x: number; y: number },
  second: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (first.x + second.x) * 0.5,
    y: (first.y + second.y) * 0.5,
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

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}
