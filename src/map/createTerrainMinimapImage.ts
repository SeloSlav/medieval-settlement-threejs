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
  ILLUSTRATED_TERRAIN_FIELDS,
  ILLUSTRATED_TERRAIN_STYLE,
  isGuaranteedIllustratedMountainSummit,
  resolveIllustratedElevationStats,
  sampleIllustratedElevationField,
  type IllustratedElevationStats,
} from './illustratedTerrainFields.ts';
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
const RELIEF_GRID_RESOLUTION = 82;
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
  elevation: IllustratedElevationStats & {
    contourLevelCount: number;
    mountainRangeCount: number;
    mountainPeakCount: number;
    forcedMountainRangeCount: number;
    strongestMountainProminence: number;
    summitCoverageGuaranteed: boolean;
  };
  woodland: IllustratedWoodlandProjection['diagnostics'] & {
    drawnTreeGlyphCount: number;
    suppressedForMountainCount: number;
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
    relief.mountainFootprints,
  );
  drawWaterHatching(context, waterMask, seed);
  drawInkBorder(context);

  const diagnostics: IllustratedTerrainMapDiagnostics = {
    fieldContract: ILLUSTRATED_TERRAIN_FIELD_CONTRACT,
    seed,
    elevation: relief.diagnostics,
    woodland: woodlandDiagnostics,
  };

  canvas.dataset.terrainStyle = 'medieval-parchment';
  canvas.dataset.terrainFieldContract = ILLUSTRATED_TERRAIN_FIELD_CONTRACT;
  canvas.dataset.terrainSeed = String(seed >>> 0);
  canvas.dataset.palette = 'aged-rag-warm-grey';
  canvas.dataset.paperField = 'broad-middle-tooth-fibres-edge-patina';
  canvas.dataset.terrainMarkMaking = 'seeded-organic-charcoal-etching';
  canvas.dataset.terrainHierarchy = 'roads-buildings-stamps-over-relief';
  canvas.dataset.mountainRanges = String(diagnostics.elevation.mountainRangeCount);
  canvas.dataset.mountainSummitCovered = String(diagnostics.elevation.summitCoverageGuaranteed);
  canvas.dataset.woodlandSource = 'accepted-tree-placements';
  canvas.dataset.woodlandSourceTrees = String(diagnostics.woodland.sourceTreeCount);
  canvas.dataset.woodlandProjectedGlyphs = String(diagnostics.woodland.treeGlyphCount);
  canvas.dataset.woodlandGlyphs = String(diagnostics.woodland.drawnTreeGlyphCount);
  canvas.dataset.woodlandMountainSuppressions = String(diagnostics.woodland.suppressedForMountainCount);
  canvas.dataset.woodlandOrphans = String(diagnostics.woodland.orphanGlyphCount);
  canvas.dataset.woodlandSignature = diagnostics.woodland.signature;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Hand-drawn parchment terrain map showing rivers, relief, grassland, and forest',
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
      const authorX = column / MAP_ART_SCALE;
      const authorY = row / MAP_ART_SCALE;
      const longFiber = (
        Math.sin(authorX * 0.071 + authorY * 0.017 + seed * 0.0017) * 0.68
          + Math.sin(authorX * 0.193 - authorY * 0.011 + seed * 0.00091) * 0.32
      ) * paperStyle.fibreAmplitude;
      const broadSample = sampleValueNoiseGrid(broadMottle, column, row);
      const middleSample = sampleValueNoiseGrid(middleMottle, column, row);
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
  context.save();
  context.globalCompositeOperation = 'multiply';

  for (let index = 0; index < 22; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const radius = (22 + rng() * 74) * MAP_ART_SCALE;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const stain = ILLUSTRATED_TERRAIN_STYLE.paper.stain;
    const stainAlpha = ILLUSTRATED_TERRAIN_STYLE.paper.stainAlphaMin
      + rng() * ILLUSTRATED_TERRAIN_STYLE.paper.stainAlphaRange;
    gradient.addColorStop(0, `rgba(${stain.r}, ${stain.g}, ${stain.b}, ${stainAlpha})`);
    gradient.addColorStop(1, `rgba(${stain.r}, ${stain.g}, ${stain.b}, 0)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.42 + rng() * 0.48), rng() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = 'screen';
  for (let index = 0; index < 12; index++) {
    const x = rng() * MINIMAP_RESOLUTION;
    const y = rng() * MINIMAP_RESOLUTION;
    const radius = (34 + rng() * 92) * MAP_ART_SCALE;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(231, 227, 216, ${0.018 + rng() * 0.022})`);
    gradient.addColorStop(1, 'rgba(231, 227, 216, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.4 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

type ElevationArtGrid = {
  heights: Float32Array;
  stats: IllustratedElevationStats;
};

type ReliefDrawingDiagnostics = IllustratedElevationStats & {
  contourLevelCount: number;
  mountainRangeCount: number;
  mountainPeakCount: number;
  forcedMountainRangeCount: number;
  strongestMountainProminence: number;
  summitCoverageGuaranteed: boolean;
};

type ReliefDrawingResult = {
  diagnostics: ReliefDrawingDiagnostics;
  mountainFootprints: IllustratedFeatureFootprint[];
};

type IllustratedFeatureFootprint = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

async function drawReliefLines(
  context: CanvasRenderingContext2D,
  terrain: TerrainMinimapTerrain,
  bounds: TerrainBounds,
  waterMask: Uint8Array,
  seed: number,
): Promise<ReliefDrawingResult> {
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
  const levels = ILLUSTRATED_TERRAIN_FIELDS.elevation.contourQuantiles
    .map((quantile) => sortedHeights[Math.floor((sortedHeights.length - 1) * quantile)])
    .filter((level, index, values) => index === 0 || Math.abs(level - values[index - 1]) > 0.08);
  const stats = resolveIllustratedElevationStats(heights);

  context.save();
  const contourInk = ILLUSTRATED_TERRAIN_STYLE.contours.ink;
  context.strokeStyle = `rgba(${contourInk.r}, ${contourInk.g}, ${contourInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.contours.alpha})`;
  context.lineWidth = ILLUSTRATED_TERRAIN_STYLE.contours.lineWidthAuthorPixels
    * MAP_ART_SCALE;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash([2 * MAP_ART_SCALE, 3.1 * MAP_ART_SCALE]);

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex];
    context.lineDashOffset = mapHash(levelIndex, 19, seed) * 4 * MAP_ART_SCALE;
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
  const mountainDiagnostics = await drawMountainRanges(
    context,
    { heights, stats },
    waterMask,
    seed,
  );
  return {
    diagnostics: {
      ...stats,
      contourLevelCount: levels.length,
      mountainRangeCount: mountainDiagnostics.mountainRangeCount,
      mountainPeakCount: mountainDiagnostics.mountainPeakCount,
      forcedMountainRangeCount: mountainDiagnostics.forcedMountainRangeCount,
      strongestMountainProminence: mountainDiagnostics.strongestMountainProminence,
      summitCoverageGuaranteed: mountainDiagnostics.summitCoverageGuaranteed,
    },
    mountainFootprints: mountainDiagnostics.mountainFootprints,
  };
}

async function drawMountainRanges(
  context: CanvasRenderingContext2D,
  elevation: ElevationArtGrid,
  waterMask: Uint8Array,
  seed: number,
): Promise<{
  mountainRangeCount: number;
  mountainPeakCount: number;
  forcedMountainRangeCount: number;
  strongestMountainProminence: number;
  summitCoverageGuaranteed: boolean;
  mountainFootprints: IllustratedFeatureFootprint[];
}> {
  const spacing = ILLUSTRATED_TERRAIN_FIELDS.elevation.mountainSpacingAuthorPixels
    * MAP_ART_SCALE;
  const inset = 18 * MAP_ART_SCALE;
  let mountainRangeCount = 0;
  let mountainPeakCount = 0;
  let rowIndex = 0;
  const drawnRanges: IllustratedFeatureFootprint[] = [];

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (let row = inset; row < MINIMAP_RESOLUTION - inset; row += spacing) {
    if (rowIndex > 0 && rowIndex % 4 === 0) await yieldToMain();
    const stagger = rowIndex % 2 === 0 ? 0 : spacing * 0.5;
    let columnIndex = 0;
    for (
      let column = inset + stagger;
      column < MINIMAP_RESOLUTION - inset;
      column += spacing
    ) {
      const jitterX = (
        mapHash(columnIndex, rowIndex, seed ^ 0x5e11) - 0.5
      ) * spacing * 0.52;
      const jitterY = (
        mapHash(columnIndex, rowIndex, seed ^ 0x197b) - 0.5
      ) * spacing * 0.42;
      const pixelX = column + jitterX;
      const pixelY = row + jitterY;
      const field = sampleElevationGridField(elevation, pixelX, pixelY);
      const prominence = field.mountainProminence;
      if (prominence < ILLUSTRATED_TERRAIN_FIELDS.elevation.mountainStart) {
        columnIndex++;
        continue;
      }
      const placementChance = clamp01((prominence - 0.1) / 0.72) * 0.96;
      if (mapHash(columnIndex + 71, rowIndex - 43, seed) > placementChance) {
        columnIndex++;
        continue;
      }

      const rangeScale = resolveMountainRangeScale(prominence, columnIndex, rowIndex, seed);
      const footprintRadiusX = 14 * rangeScale;
      const footprintRadiusY = 8.5 * rangeScale;
      if (intersectsFeatureFootprints(
        pixelX,
        pixelY,
        footprintRadiusX,
        footprintRadiusY,
        drawnRanges,
      )) {
        columnIndex++;
        continue;
      }
      if (!isLandFootprintClear(
        waterMask,
        pixelX,
        pixelY,
        footprintRadiusX,
        footprintRadiusY,
      )) {
        columnIndex++;
        continue;
      }

      const peakCount = resolveMountainPeakCount(prominence, columnIndex, rowIndex, seed);
      drawMountainRangeGlyph(
        context,
        pixelX,
        pixelY,
        rangeScale,
        peakCount,
        prominence,
        seed ^ Math.imul(rowIndex + 1, 0x45d9f3b) ^ Math.imul(columnIndex + 1, 0x27d4eb2d),
      );
      mountainRangeCount++;
      mountainPeakCount += peakCount;
      drawnRanges.push({
        x: pixelX,
        y: pixelY,
        radiusX: footprintRadiusX,
        radiusY: footprintRadiusY,
      });
      columnIndex++;
    }
    rowIndex++;
  }

  const strongestSummit = await findStrongestGuaranteedMountainCandidate(
    elevation,
    waterMask,
    seed,
    inset,
  );
  let forcedMountainRangeCount = 0;
  let summitCoverageGuaranteed = strongestSummit === null;
  if (strongestSummit) {
    const coverageRadius = spacing
      * ILLUSTRATED_TERRAIN_FIELDS.elevation.guaranteedCoverageRadiusSpacing;
    const summitAlreadyCovered = drawnRanges.some((range) => Math.hypot(
      range.x - strongestSummit.x,
      range.y - strongestSummit.y,
    ) <= coverageRadius);
    if (!summitAlreadyCovered) {
      const peakCount = Math.max(
        3,
        resolveMountainPeakCount(
          strongestSummit.prominence,
          strongestSummit.gridColumn,
          strongestSummit.gridRow,
          seed,
        ),
      );
      drawMountainRangeGlyph(
        context,
        strongestSummit.x,
        strongestSummit.y,
        strongestSummit.rangeScale,
        peakCount,
        strongestSummit.prominence,
        seed
          ^ Math.imul(strongestSummit.gridRow + 1, 0x45d9f3b)
          ^ Math.imul(strongestSummit.gridColumn + 1, 0x27d4eb2d),
      );
      mountainRangeCount++;
      mountainPeakCount += peakCount;
      forcedMountainRangeCount = 1;
      drawnRanges.push({
        x: strongestSummit.x,
        y: strongestSummit.y,
        radiusX: 14 * strongestSummit.rangeScale,
        radiusY: 8.5 * strongestSummit.rangeScale,
      });
    }
    summitCoverageGuaranteed = true;
  }

  context.restore();
  return {
    mountainRangeCount,
    mountainPeakCount,
    forcedMountainRangeCount,
    strongestMountainProminence: strongestSummit?.prominence ?? 0,
    summitCoverageGuaranteed,
    mountainFootprints: drawnRanges,
  };
}

type GuaranteedMountainCandidate = {
  x: number;
  y: number;
  gridColumn: number;
  gridRow: number;
  rawHeight: number;
  prominence: number;
  rangeScale: number;
};

async function findStrongestGuaranteedMountainCandidate(
  elevation: ElevationArtGrid,
  waterMask: Uint8Array,
  seed: number,
  inset: number,
): Promise<GuaranteedMountainCandidate | null> {
  let strongest: GuaranteedMountainCandidate | null = null;
  const denominator = RELIEF_GRID_RESOLUTION - 1;

  for (let gridRow = 0; gridRow < RELIEF_GRID_RESOLUTION; gridRow++) {
    if (gridRow > 0 && gridRow % 12 === 0) await yieldToMain();
    for (let gridColumn = 0; gridColumn < RELIEF_GRID_RESOLUTION; gridColumn++) {
      const sourceX = gridColumn / denominator * (MINIMAP_RESOLUTION - 1);
      const sourceY = gridRow / denominator * (MINIMAP_RESOLUTION - 1);
      const field = sampleElevationGridField(elevation, sourceX, sourceY);
      if (!isGuaranteedIllustratedMountainSummit(field)) continue;

      const x = Math.max(inset, Math.min(MINIMAP_RESOLUTION - inset, sourceX));
      const y = Math.max(inset, Math.min(MINIMAP_RESOLUTION - inset, sourceY));
      const rangeScale = resolveMountainRangeScale(
        field.mountainProminence,
        gridColumn,
        gridRow,
        seed,
      );
      if (!isLandFootprintClear(
        waterMask,
        x,
        y,
        14 * rangeScale,
        8.5 * rangeScale,
      )) continue;

      const rawHeight = elevation.heights[
        gridRow * RELIEF_GRID_RESOLUTION + gridColumn
      ] ?? elevation.stats.minimum;
      if (
        strongest
        && rawHeight < strongest.rawHeight - 1e-5
      ) continue;
      if (
        strongest
        && Math.abs(rawHeight - strongest.rawHeight) <= 1e-5
        && field.mountainProminence <= strongest.prominence
      ) continue;
      strongest = {
        x,
        y,
        gridColumn,
        gridRow,
        rawHeight,
        prominence: field.mountainProminence,
        rangeScale,
      };
    }
  }
  return strongest;
}

function resolveMountainRangeScale(
  prominence: number,
  gridColumn: number,
  gridRow: number,
  seed: number,
): number {
  return (
    ILLUSTRATED_TERRAIN_STYLE.mountains.scaleBase
      + prominence * ILLUSTRATED_TERRAIN_STYLE.mountains.scaleProminence
      + mapHash(gridColumn - 19, gridRow + 31, seed)
        * ILLUSTRATED_TERRAIN_STYLE.mountains.scaleVariation
  ) * MAP_ART_SCALE;
}

function resolveMountainPeakCount(
  prominence: number,
  gridColumn: number,
  gridRow: number,
  seed: number,
): number {
  return Math.min(
    3,
    2 + Math.floor(
      prominence * 0.85 + mapHash(gridColumn, gridRow, seed ^ 0x33f1) * 0.5,
    ),
  );
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
  context.strokeStyle = `rgba(${grassInk.r}, ${grassInk.g}, ${grassInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.grassland.alpha})`;
  context.lineWidth = ILLUSTRATED_TERRAIN_STYLE.grassland.lineWidthAuthorPixels
    * MAP_ART_SCALE;
  context.lineCap = 'round';

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
      const chance = 0.18 + meadow * 0.28 + dry * 0.12;
      if (mapHash(column + 17, row - 9, seed) > chance) continue;
      drawGrassTuft(
        context,
        pixelX,
        pixelY,
        (1.3 + mapHash(column - 31, row + 42, seed) * 1.3) * MAP_ART_SCALE,
        (mapHash(column, row, seed ^ 0x51a4) - 0.5) * MAP_ART_SCALE,
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
  mountainFootprints: readonly IllustratedFeatureFootprint[],
): Promise<IllustratedTerrainMapDiagnostics['woodland']> {
  const glyphs = [...projection.glyphs].sort((a, b) => (
    a.authorY - b.authorY
      || a.authorX - b.authorX
      || a.layoutIndex - b.layoutIndex
  ));
  context.save();
  const woodlandInk = ILLUSTRATED_TERRAIN_STYLE.paper.terrainInk;
  context.strokeStyle = `rgba(${woodlandInk.r}, ${woodlandInk.g}, ${woodlandInk.b}, ${ILLUSTRATED_TERRAIN_STYLE.woodland.outlineAlpha})`;
  context.fillStyle = `rgba(83, 86, 72, ${ILLUSTRATED_TERRAIN_STYLE.woodland.fillAlpha})`;
  context.lineWidth = ILLUSTRATED_TERRAIN_STYLE.woodland.lineWidthAuthorPixels
    * MAP_ART_SCALE;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let drawnTreeGlyphCount = 0;
  let suppressedForMountainCount = 0;
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
    if (intersectsFeatureFootprints(
      pixelX,
      pixelY - symbolScale * 2.8,
      symbolScale * 3.5,
      symbolScale * 5.2,
      mountainFootprints,
    )) {
      suppressedForMountainCount++;
      continue;
    }
    const lean = (
      mapHash(glyph.layoutIndex, 73, seed ^ 0x731f) - 0.5
    ) * symbolScale * 0.22;
    if (glyph.conifer) {
      drawConiferGlyph(context, pixelX, pixelY, symbolScale, lean);
    } else {
      drawBroadleafGlyph(context, pixelX, pixelY, symbolScale, lean);
    }
    drawnTreeGlyphCount++;
  }

  context.restore();
  return {
    ...projection.diagnostics,
    drawnTreeGlyphCount,
    suppressedForMountainCount,
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

function sampleElevationGridField(
  elevation: ElevationArtGrid,
  pixelX: number,
  pixelY: number,
): ReturnType<typeof sampleIllustratedElevationField> {
  const gridX = clamp01(pixelX / (MINIMAP_RESOLUTION - 1))
    * (RELIEF_GRID_RESOLUTION - 1);
  const gridY = clamp01(pixelY / (MINIMAP_RESOLUTION - 1))
    * (RELIEF_GRID_RESOLUTION - 1);
  const centerColumn = Math.round(gridX);
  const centerRow = Math.round(gridY);
  const height = sampleElevationGridHeight(elevation.heights, gridX, gridY);
  let neighbourSum = 0;
  let neighbourMinimum = Infinity;
  let neighbourMaximum = -Infinity;
  let neighbourCount = 0;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
      if (rowOffset === 0 && columnOffset === 0) continue;
      const sample = elevation.heights[
        clampGridIndex(centerRow + rowOffset) * RELIEF_GRID_RESOLUTION
          + clampGridIndex(centerColumn + columnOffset)
      ] ?? height;
      neighbourSum += sample;
      neighbourMinimum = Math.min(neighbourMinimum, sample);
      neighbourMaximum = Math.max(neighbourMaximum, sample);
      neighbourCount++;
    }
  }

  const neighbourMean = neighbourCount > 0 ? neighbourSum / neighbourCount : height;
  const normalizedX = clamp01(pixelX / (MINIMAP_RESOLUTION - 1));
  const normalizedY = clamp01(pixelY / (MINIMAP_RESOLUTION - 1));
  return sampleIllustratedElevationField({
    height,
    neighbourRange: Math.max(0, neighbourMaximum - neighbourMinimum),
    heightAboveNeighbourMean: height - neighbourMean,
    edgeProximity: Math.max(
      Math.abs(normalizedX * 2 - 1),
      Math.abs(normalizedY * 2 - 1),
    ),
    stats: elevation.stats,
  });
}

function sampleElevationGridHeight(
  heights: Float32Array,
  gridX: number,
  gridY: number,
): number {
  const column0 = clampGridIndex(Math.floor(gridX));
  const row0 = clampGridIndex(Math.floor(gridY));
  const column1 = clampGridIndex(column0 + 1);
  const row1 = clampGridIndex(row0 + 1);
  const tx = clamp01(gridX - column0);
  const ty = clamp01(gridY - row0);
  const topLeft = heights[row0 * RELIEF_GRID_RESOLUTION + column0] ?? 0;
  const topRight = heights[row0 * RELIEF_GRID_RESOLUTION + column1] ?? topLeft;
  const bottomLeft = heights[row1 * RELIEF_GRID_RESOLUTION + column0] ?? topLeft;
  const bottomRight = heights[row1 * RELIEF_GRID_RESOLUTION + column1] ?? bottomLeft;
  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;
  return top * (1 - ty) + bottom * ty;
}

function clampGridIndex(value: number): number {
  return Math.max(0, Math.min(RELIEF_GRID_RESOLUTION - 1, value));
}

function drawMountainRangeGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  peakCount: number,
  prominence: number,
  seed: number,
): void {
  const rangeWidth = (17 + peakCount * 3.8 + prominence * 5) * scale;
  const peakSpacing = rangeWidth / Math.max(peakCount - 0.25, 1);
  context.save();
  const mountainStyle = ILLUSTRATED_TERRAIN_STYLE.mountains;
  const mountainInk = ILLUSTRATED_TERRAIN_STYLE.paper.terrainInk;
  context.strokeStyle = `rgba(${mountainInk.r}, ${mountainInk.g}, ${mountainInk.b}, ${mountainStyle.outlineAlphaMin + prominence * mountainStyle.outlineAlphaProminence})`;
  context.fillStyle = `rgba(111, 105, 91, ${mountainStyle.fillAlphaMin + prominence * mountainStyle.fillAlphaProminence})`;
  context.lineWidth = (0.54 + prominence * 0.1) * MAP_ART_SCALE;

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex++) {
    const horizontal = peakCount <= 1
      ? 0
      : peakIndex / (peakCount - 1) - 0.5;
    const peakX = x
      + horizontal * rangeWidth * 0.7
      + (mapHash(peakIndex, 11, seed) - 0.5) * peakSpacing * 0.36;
    const baselineY = y
      + (mapHash(peakIndex, 29, seed) - 0.5) * 2.2 * scale
      + Math.abs(horizontal) * 1.15 * scale;
    const height = (
      8.2
        + prominence * 5.8
        + mapHash(peakIndex, 47, seed) * 3.1
    ) * scale * (1 - Math.abs(horizontal) * 0.12);
    const halfWidth = peakSpacing * (
      0.68 + mapHash(peakIndex, 67, seed) * 0.18
    );
    drawMountainPeak(
      context,
      peakX,
      baselineY,
      halfWidth,
      height,
      mapHash(peakIndex, 83, seed) > 0.5 ? 1 : -1,
      scale,
    );
  }

  context.strokeStyle = `rgba(${mountainInk.r}, ${mountainInk.g}, ${mountainInk.b}, ${mountainStyle.baselineAlphaMin + prominence * mountainStyle.baselineAlphaProminence})`;
  context.lineWidth = 0.46 * MAP_ART_SCALE;
  context.beginPath();
  context.moveTo(x - rangeWidth * 0.47, y + 1.3 * scale);
  context.quadraticCurveTo(
    x - rangeWidth * 0.17,
    y - 0.5 * scale,
    x + rangeWidth * 0.06,
    y + 0.9 * scale,
  );
  context.quadraticCurveTo(
    x + rangeWidth * 0.28,
    y + 2 * scale,
    x + rangeWidth * 0.49,
    y + 0.45 * scale,
  );
  context.stroke();
  context.restore();
}

function drawMountainPeak(
  context: CanvasRenderingContext2D,
  x: number,
  baselineY: number,
  halfWidth: number,
  height: number,
  shadedSide: -1 | 1,
  scale: number,
): void {
  const summitY = baselineY - height;
  const summitNotch = Math.max(0.8 * scale, halfWidth * 0.075);
  context.beginPath();
  context.moveTo(x - halfWidth, baselineY);
  context.quadraticCurveTo(
    x - halfWidth * 0.45,
    baselineY - height * 0.42,
    x - summitNotch,
    summitY + summitNotch * 0.28,
  );
  context.lineTo(x, summitY);
  context.lineTo(x + summitNotch * 0.72, summitY + summitNotch * 0.95);
  context.lineTo(x + summitNotch * 1.42, summitY + summitNotch * 0.52);
  context.quadraticCurveTo(
    x + halfWidth * 0.52,
    baselineY - height * 0.38,
    x + halfWidth,
    baselineY,
  );
  context.quadraticCurveTo(x, baselineY + height * 0.08, x - halfWidth, baselineY);
  context.closePath();
  context.fill();
  context.stroke();

  const sideX = x + halfWidth * shadedSide;
  context.beginPath();
  context.moveTo(x + summitNotch * 0.34 * shadedSide, summitY + summitNotch * 0.72);
  context.quadraticCurveTo(
    x + halfWidth * 0.2 * shadedSide,
    summitY + height * 0.38,
    sideX * 0.72 + x * 0.28,
    baselineY - height * 0.08,
  );
  context.stroke();

  context.save();
  context.globalAlpha *= 0.62;
  context.lineWidth = 0.48 * MAP_ART_SCALE;
  for (let hatchIndex = 1; hatchIndex <= 3; hatchIndex++) {
    const t = 0.24 + hatchIndex * 0.16;
    const slopeX = x + halfWidth * shadedSide * t;
    const slopeY = summitY + height * t;
    context.beginPath();
    context.moveTo(slopeX, slopeY);
    context.lineTo(
      slopeX + halfWidth * shadedSide * (0.11 + hatchIndex * 0.025),
      slopeY + height * 0.13,
    );
    context.stroke();
  }
  context.restore();
}

function isLandFootprintClear(
  waterMask: Uint8Array,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): boolean {
  return !isWaterPixel(waterMask, x, y)
    && !isWaterPixel(waterMask, x - radiusX * 0.72, y)
    && !isWaterPixel(waterMask, x + radiusX * 0.72, y)
    && !isWaterPixel(waterMask, x, y - radiusY * 0.72)
    && !isWaterPixel(waterMask, x, y + radiusY * 0.72);
}

function intersectsFeatureFootprints(
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  footprints: readonly IllustratedFeatureFootprint[],
): boolean {
  for (const footprint of footprints) {
    const combinedX = Math.max(1, radiusX + footprint.radiusX);
    const combinedY = Math.max(1, radiusY + footprint.radiusY);
    const dx = (x - footprint.x) / combinedX;
    const dy = (y - footprint.y) / combinedY;
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
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
  const width = height * (0.68 + variant * 0.2);
  const baseY = y + MAP_ART_SCALE * 0.55;
  context.beginPath();
  context.moveTo(x - width, baseY);
  context.quadraticCurveTo(
    x - width * 0.56,
    y - height * (0.25 + variant * 0.16),
    x - width * 0.12 + lean * 0.32,
    baseY - height * 0.08,
  );
  context.moveTo(x - width * 0.08, baseY - height * 0.03);
  context.quadraticCurveTo(
    x + width * 0.42 + lean * 0.45,
    y - height * (0.38 + (1 - variant) * 0.12),
    x + width,
    baseY - height * 0.02,
  );
  if (variant > 0.68) {
    context.moveTo(x + width * 1.18, baseY - height * 0.02);
    context.lineTo(x + width * 1.42, baseY - height * 0.08);
  }
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
