import type { TerrainBounds } from '../terrain/Terrain.ts';

export const ILLUSTRATED_MAP_DESK_TEXTURE_ASSET =
  'assets/ui/map/aged-dark-oak-tabletop.png';
export const ILLUSTRATED_MAP_DESK_TEXTURE_RESOLUTION = 1254;
/** Margin on each side, expressed against the map's longest world dimension. */
export const ILLUSTRATED_MAP_DESK_MARGIN_RATIO = 0.45;
/** Begin the long desk-to-black transition just beyond the parchment edge. */
export const ILLUSTRATED_MAP_DESK_FADE_START = 0.6;

export type IllustratedMapDeskMetrics = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  margin: number;
};

export type IllustratedMapDeskCanvasOptions = {
  /** Longest canvas edge in pixels. */
  resolution?: number;
  /** Width divided by height, used to crop the source without stretching it. */
  aspect?: number;
  /** Called after the photographic texture has replaced the immediate fallback. */
  onReady?: (canvas: HTMLCanvasElement) => void;
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
  return 1 - smoothstep(ILLUSTRATED_MAP_DESK_FADE_START, 1, squareRadius);
}

/**
 * Crop one continuous high-resolution oak surface into a canvas tailored to
 * its destination, then bake a broad fade to exact black into the pixels.
 * The DOM map and the world-space map use the same source art and fade model
 * while retaining their own aspect ratios, so neither presentation stretches
 * the timber grain or reveals board seams.
 */
export function createIllustratedMapDeskCanvas(
  options: IllustratedMapDeskCanvasOptions = {},
): HTMLCanvasElement {
  const longestEdge = Math.max(
    64,
    Math.round(options.resolution ?? ILLUSTRATED_MAP_DESK_TEXTURE_RESOLUTION),
  );
  const aspect = Math.max(0.25, Math.min(4, options.aspect ?? 1));
  const canvas = document.createElement('canvas');
  if (aspect >= 1) {
    canvas.width = longestEdge;
    canvas.height = Math.max(64, Math.round(longestEdge / aspect));
  } else {
    canvas.width = Math.max(64, Math.round(longestEdge * aspect));
    canvas.height = longestEdge;
  }
  canvas.dataset.mapLayer = 'real-dark-oak-desk';
  canvas.dataset.textureAsset = ILLUSTRATED_MAP_DESK_TEXTURE_ASSET;
  canvas.dataset.textureState = 'loading';

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return canvas;

  // Give both render paths a stable, seam-free surface immediately. The real
  // asset replaces this during the same load without changing canvas identity.
  drawDeskFallback(context, canvas.width, canvas.height);
  applyDeskEdgeFade(context, canvas.width, canvas.height);

  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('load', () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawImageCover(context, image, canvas.width, canvas.height);
    applyDeskEdgeFade(context, canvas.width, canvas.height);
    canvas.dataset.textureState = 'ready';
    options.onReady?.(canvas);
  }, { once: true });
  image.addEventListener('error', () => {
    canvas.dataset.textureState = 'error';
    console.error(`Illustrated map desk texture failed to load: ${image.src}`);
  }, { once: true });
  image.src = illustratedMapDeskTextureUrl();

  return canvas;
}

function illustratedMapDeskTextureUrl(): string {
  const baseUrl = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${baseUrl}${ILLUSTRATED_MAP_DESK_TEXTURE_ASSET}`;
}

function drawDeskFallback(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const wash = context.createRadialGradient(
    width * 0.5,
    height * 0.46,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.68,
  );
  wash.addColorStop(0, '#59351f');
  wash.addColorStop(0.58, '#3b2115');
  wash.addColorStop(1, '#1b0e09');
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  const sourceAspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
  const destinationAspect = width / Math.max(height, 1);
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceAspect > destinationAspect) {
    sourceWidth = image.naturalHeight * destinationAspect;
    sourceX = (image.naturalWidth - sourceWidth) * 0.5;
  } else {
    sourceHeight = image.naturalWidth / destinationAspect;
    sourceY = (image.naturalHeight - sourceHeight) * 0.5;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
}

function applyDeskEdgeFade(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const widthDenominator = Math.max(width - 1, 1);
  const heightDenominator = Math.max(height - 1, 1);

  for (let y = 0; y < height; y += 1) {
    const ny = Math.abs((y / heightDenominator) * 2 - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = Math.abs((x / widthDenominator) * 2 - 1);
      const colourGain = illustratedMapDeskColourGainAt(Math.max(nx, ny));
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.round(pixels[offset] * colourGain);
      pixels[offset + 1] = Math.round(pixels[offset + 1] * colourGain);
      pixels[offset + 2] = Math.round(pixels[offset + 2] * colourGain);
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}
