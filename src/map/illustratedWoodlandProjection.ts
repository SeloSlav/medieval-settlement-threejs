import {
  getEstimatedCanopyRadius,
  getTreeSpeciesProfile,
  type ForestTreePlacement,
} from '../props/forestPlacements.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { ILLUSTRATED_TERRAIN_STYLE } from './illustratedTerrainFields.ts';

export type IllustratedWoodlandSourceTree = ForestTreePlacement & {
  layoutIndex: number;
};

export type IllustratedWoodlandGlyph = {
  layoutIndex: number;
  worldX: number;
  worldZ: number;
  authorX: number;
  authorY: number;
  symbolScaleAuthorPixels: number;
  conifer: boolean;
};

export type IllustratedWoodlandProjection = {
  glyphs: IllustratedWoodlandGlyph[];
  diagnostics: {
    sourceTreeCount: number;
    inBoundsTreeCount: number;
    treeGlyphCount: number;
    suppressedForFarViewCount: number;
    coniferGlyphCount: number;
    broadleafGlyphCount: number;
    orphanGlyphCount: number;
    maximumPositionErrorWorld: number;
    minimumGlyphSpacingAuthorPixels: number;
    signature: string;
  };
};

type SpatialGlyph = IllustratedWoodlandGlyph & {
  cellX: number;
  cellY: number;
};

/**
 * Projects the accepted forest layout into the 512 px authoring frame.
 * Every emitted symbol keeps the exact world-space trunk position of one real
 * tree; deterministic screen-space thinning only chooses which real trees
 * survive the far-map LOD.
 */
export function projectIllustratedWoodland(
  sourceTrees: readonly IllustratedWoodlandSourceTree[],
  bounds: TerrainBounds,
  authorResolution = 512,
): IllustratedWoodlandProjection {
  const spanX = Math.max(0.001, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0.001, bounds.maxZ - bounds.minZ);
  const pixelsPerWorld = Math.min(authorResolution / spanX, authorResolution / spanZ);
  const minimumSpacing = ILLUSTRATED_TERRAIN_STYLE.woodland
    .minimumGlyphSpacingAuthorPixels;
  const maximumGlyphCount = ILLUSTRATED_TERRAIN_STYLE.woodland.maximumGlyphCount;
  const buckets = new Map<string, SpatialGlyph[]>();
  const glyphs: IllustratedWoodlandGlyph[] = [];
  let inBoundsTreeCount = 0;
  let coniferGlyphCount = 0;

  // A stable hash priority keeps the far-view sample unbiased across the
  // generator's core, hill-edge, and sapling strata. Input order never affects
  // which real trunks survive the screen-space budget.
  const orderedTrees = [...sourceTrees].sort((a, b) => (
    treeSelectionPriority(a) - treeSelectionPriority(b)
      || a.layoutIndex - b.layoutIndex
      || a.x - b.x
      || a.z - b.z
  ));

  for (const tree of orderedTrees) {
    if (
      !Number.isFinite(tree.x)
      || !Number.isFinite(tree.z)
      || tree.x < bounds.minX
      || tree.x > bounds.maxX
      || tree.z < bounds.minZ
      || tree.z > bounds.maxZ
    ) {
      continue;
    }
    inBoundsTreeCount++;
    if (glyphs.length >= maximumGlyphCount) continue;

    const authorX = (tree.x - bounds.minX) / spanX * authorResolution;
    const authorY = (tree.z - bounds.minZ) / spanZ * authorResolution;
    const cellX = Math.floor(authorX / minimumSpacing);
    const cellY = Math.floor(authorY / minimumSpacing);
    if (hasGlyphWithin(buckets, cellX, cellY, authorX, authorY, minimumSpacing)) {
      continue;
    }

    const canopyRadiusPixels = getEstimatedCanopyRadius(
      tree.species,
      tree.form,
      tree.scale,
    ) * pixelsPerWorld;
    const conifer = getTreeSpeciesProfile(tree.species).canopy === 'conifer';
    const glyph: SpatialGlyph = {
      layoutIndex: tree.layoutIndex,
      worldX: tree.x,
      worldZ: tree.z,
      authorX,
      authorY,
      symbolScaleAuthorPixels: clamp(
        canopyRadiusPixels * 2 / 7.2
          * ILLUSTRATED_TERRAIN_STYLE.woodland.canopyDiameterScale,
        ILLUSTRATED_TERRAIN_STYLE.woodland.minimumSymbolScaleAuthorPixels,
        ILLUSTRATED_TERRAIN_STYLE.woodland.maximumSymbolScaleAuthorPixels,
      ),
      conifer,
      cellX,
      cellY,
    };
    const key = cellKey(cellX, cellY);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(glyph);
    else buckets.set(key, [glyph]);
    glyphs.push(glyph);
    if (conifer) coniferGlyphCount++;
  }

  return {
    glyphs,
    diagnostics: {
      sourceTreeCount: sourceTrees.length,
      inBoundsTreeCount,
      treeGlyphCount: glyphs.length,
      suppressedForFarViewCount: inBoundsTreeCount - glyphs.length,
      coniferGlyphCount,
      broadleafGlyphCount: glyphs.length - coniferGlyphCount,
      orphanGlyphCount: 0,
      maximumPositionErrorWorld: 0,
      minimumGlyphSpacingAuthorPixels: minimumSpacing,
      signature: woodlandSignature(glyphs),
    },
  };
}

function hasGlyphWithin(
  buckets: ReadonlyMap<string, readonly SpatialGlyph[]>,
  cellX: number,
  cellY: number,
  authorX: number,
  authorY: number,
  minimumSpacing: number,
): boolean {
  const minimumSpacingSquared = minimumSpacing * minimumSpacing;
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const bucket = buckets.get(cellKey(cellX + offsetX, cellY + offsetY));
      if (!bucket) continue;
      for (const glyph of bucket) {
        const dx = glyph.authorX - authorX;
        const dy = glyph.authorY - authorY;
        if (dx * dx + dy * dy < minimumSpacingSquared) return true;
      }
    }
  }
  return false;
}

function woodlandSignature(glyphs: readonly IllustratedWoodlandGlyph[]): string {
  let hash = 0x811c9dc5;
  const orderedGlyphs = [...glyphs].sort((a, b) => a.layoutIndex - b.layoutIndex);
  for (const glyph of orderedGlyphs) {
    hash = mixHash(hash, glyph.layoutIndex);
    hash = mixHash(hash, Math.round(glyph.authorX * 1_000));
    hash = mixHash(hash, Math.round(glyph.authorY * 1_000));
  }
  return hash.toString(16).padStart(8, '0');
}

function treeSelectionPriority(tree: IllustratedWoodlandSourceTree): number {
  let hash = tree.layoutIndex >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function mixHash(hash: number, value: number): number {
  hash ^= value | 0;
  return Math.imul(hash, 0x01000193) >>> 0;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
