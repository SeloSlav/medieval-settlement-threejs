import * as THREE from 'three';
import {
  getCurrentPlayerCompanyStandardArt,
  resolveMercenaryCompanyStandardArt,
  resolveOttomanCompanyStandardArt,
  type CroatianCheckerboardBannerArt,
  type LordHeraldryBannerArt,
  type MercenaryCompanyStandardArt,
  type OttomanFieldStandardPanelArt,
} from './companyStandardArt.ts';
import type { CompanyStandardArtwork } from './CompanyStandardRenderer.ts';

export const COMPANY_STANDARD_TEXTURE_WIDTH = 512;
export const COMPANY_STANDARD_TEXTURE_MEMORY_BUDGET_BYTES = 4_000_000;

export type CompanyStandardTextureSet = {
  artwork: CompanyStandardArtwork;
  cacheKey: string;
  ready: Promise<void>;
  estimatedGpuBytes: number;
  dispose(): void;
};

/**
 * Compiles character-creation heraldry and the three faction identities into
 * four shared cloth maps. Every company instances these same maps, so adding
 * standards changes neither texture count nor material count as armies grow.
 */
export function createCompanyStandardTextures(): CompanyStandardTextureSet {
  const player = getCurrentPlayerCompanyStandardArt();
  const mercenary = resolveMercenaryCompanyStandardArt();
  const ottoman = resolveOttomanCompanyStandardArt();
  const heraldryCanvas = bannerCanvas(player.upper.aspectRatio);
  const croatianCanvas = bannerCanvas(player.lower.aspectRatio);
  const mercenaryCanvas = bannerCanvas(mercenary.panel.aspectRatio);
  const ottomanCanvas = bannerCanvas(ottoman.panel.aspectRatio);

  paintHeraldryBanner(heraldryCanvas, player.upper);
  paintCroatianBanner(croatianCanvas, player.lower);
  paintMercenaryBanner(mercenaryCanvas, mercenary);
  paintOttomanBanner(ottomanCanvas, ottoman.panel);

  const playerHeraldry = clothTexture(heraldryCanvas, 'Lord heraldry company-standard cloth');
  const playerCroatian = clothTexture(croatianCanvas, 'Croatian checkerboard company-standard cloth');
  const mercenaryTexture = clothTexture(mercenaryCanvas, 'Mercenary frog company-standard cloth');
  const ottomanTexture = clothTexture(ottomanCanvas, 'Ottoman field-standard cloth');
  const textures = [playerHeraldry, playerCroatian, mercenaryTexture, ottomanTexture] as const;
  let disposed = false;
  const ready = loadChargeMask(player.upper.chargeMaskUrl).then((image) => {
    if (disposed || !image) return;
    paintHeraldryCharges(heraldryCanvas, player.upper, image);
    finishClothSurface(heraldryCanvas, player.upper.trimColor, 0x17a9_42b3);
    playerHeraldry.needsUpdate = true;
  });
  const estimatedGpuBytes = textures.reduce(
    (total, texture) => total
      + Math.ceil(texture.image.width * texture.image.height * 4 * 4 / 3),
    0,
  );

  return {
    artwork: {
      playerHeraldry,
      playerCroatian,
      mercenary: mercenaryTexture,
      ottoman: ottomanTexture,
    },
    cacheKey: `${player.cacheKey}|${mercenary.cacheKey}|${ottoman.cacheKey}`,
    ready,
    estimatedGpuBytes,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) texture.dispose();
    },
  };
}

function bannerCanvas(aspectRatio: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Company-standard textures require a browser canvas.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = COMPANY_STANDARD_TEXTURE_WIDTH;
  canvas.height = Math.max(256, Math.round(canvas.width / aspectRatio));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to acquire company-standard canvas context.');
  return context;
}

function clothTexture(canvas: HTMLCanvasElement, name: string): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

function paintHeraldryBanner(
  canvas: HTMLCanvasElement,
  art: LordHeraldryBannerArt,
): void {
  const context = context2d(canvas);
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = art.fieldColor;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width * 0.5, height * 0.5);
  context.rotate(art.patternAngleDegrees * Math.PI / 180);
  context.translate(-width * 0.5, -height * 0.5);
  context.fillStyle = art.patternColor;
  const overscan = Math.ceil(Math.hypot(width, height));
  const left = (width - overscan) * 0.5;
  const top = (height - overscan) * 0.5;
  switch (art.pattern) {
    case 'solid':
      break;
    case 'per-pale':
      context.fillRect(width * 0.5, top, overscan * 0.5, overscan);
      break;
    case 'per-fess':
      context.fillRect(left, height * 0.5, overscan, overscan * 0.5);
      break;
    case 'bend':
    case 'bend-sinister': {
      context.save();
      context.translate(width * 0.5, height * 0.5);
      context.rotate((art.pattern === 'bend' ? -1 : 1) * Math.PI * 0.25);
      context.fillRect(-overscan * 0.12, -overscan, overscan * 0.24, overscan * 2);
      context.restore();
      break;
    }
    case 'quarterly':
      context.fillRect(0, 0, width * 0.5, height * 0.5);
      context.fillRect(width * 0.5, height * 0.5, width * 0.5, height * 0.5);
      break;
    case 'checky': {
      const cells = Math.max(2, Math.round(art.patternTiling * 2));
      const cellWidth = width / cells;
      const cellHeight = height / cells;
      for (let row = 0; row < cells; row += 1) {
        for (let column = 0; column < cells; column += 1) {
          if (((row + column) & 1) !== 0) continue;
          context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
        }
      }
      break;
    }
    case 'stripes': {
      const stripes = Math.max(2, Math.round(art.patternTiling * 2));
      const stripeWidth = width / stripes;
      for (let stripe = 1; stripe < stripes; stripe += 2) {
        context.fillRect(stripe * stripeWidth, top, stripeWidth + 1, overscan);
      }
      break;
    }
    case 'chevron': {
      context.lineWidth = height * 0.16;
      context.lineJoin = 'miter';
      context.beginPath();
      context.moveTo(width * 0.08, height * 0.7);
      context.lineTo(width * 0.5, height * 0.3);
      context.lineTo(width * 0.92, height * 0.7);
      context.strokeStyle = art.patternColor;
      context.stroke();
      break;
    }
    case 'saltire':
      strokeCross(context, width, height, true, art.patternColor);
      break;
    case 'cross':
      strokeCross(context, width, height, false, art.patternColor);
      break;
    case 'lozengy': {
      const columns = Math.max(2, Math.round(art.patternTiling));
      const diamondWidth = width / columns;
      const diamondHeight = height / columns;
      for (let row = -1; row <= columns + 1; row += 1) {
        for (let column = -1; column <= columns + 1; column += 1) {
          if (((row + column) & 1) !== 0) continue;
          const x = column * diamondWidth + (row & 1 ? diamondWidth * 0.5 : 0);
          const y = row * diamondHeight * 0.5;
          context.beginPath();
          context.moveTo(x, y - diamondHeight * 0.5);
          context.lineTo(x + diamondWidth * 0.5, y);
          context.lineTo(x, y + diamondHeight * 0.5);
          context.lineTo(x - diamondWidth * 0.5, y);
          context.closePath();
          context.fill();
        }
      }
      break;
    }
  }
  context.restore();
  finishClothSurface(canvas, art.trimColor, 0x17a9_42b3);
}

function strokeCross(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  diagonal: boolean,
  color: string,
): void {
  context.strokeStyle = color;
  context.lineWidth = Math.min(width, height) * 0.14;
  context.lineCap = 'square';
  context.beginPath();
  if (diagonal) {
    context.moveTo(0, 0);
    context.lineTo(width, height);
    context.moveTo(width, 0);
    context.lineTo(0, height);
  } else {
    context.moveTo(width * 0.5, 0);
    context.lineTo(width * 0.5, height);
    context.moveTo(0, height * 0.5);
    context.lineTo(width, height * 0.5);
  }
  context.stroke();
}

function paintHeraldryCharges(
  canvas: HTMLCanvasElement,
  art: LordHeraldryBannerArt,
  image: HTMLImageElement,
): void {
  const context = context2d(canvas);
  const shortest = Math.min(canvas.width, canvas.height);
  const mask = document.createElement('canvas');
  mask.width = image.naturalWidth || image.width;
  mask.height = image.naturalHeight || image.height;
  const maskContext = context2d(mask);
  maskContext.drawImage(image, 0, 0, mask.width, mask.height);
  maskContext.globalCompositeOperation = 'source-in';
  maskContext.fillStyle = art.chargeColor;
  maskContext.fillRect(0, 0, mask.width, mask.height);
  maskContext.globalCompositeOperation = 'source-over';
  context.save();
  context.shadowColor = 'rgba(25, 15, 7, 0.42)';
  context.shadowBlur = 4;
  context.shadowOffsetY = 3;
  for (const placement of art.chargePlacements) {
    const size = shortest * placement.scale;
    context.drawImage(
      mask,
      placement.u * canvas.width - size * 0.5,
      placement.v * canvas.height - size * 0.5,
      size,
      size,
    );
  }
  context.restore();
}

function paintCroatianBanner(
  canvas: HTMLCanvasElement,
  art: CroatianCheckerboardBannerArt,
): void {
  const context = context2d(canvas);
  const cellWidth = canvas.width / art.columns;
  const cellHeight = canvas.height / art.rows;
  for (let row = 0; row < art.rows; row += 1) {
    for (let column = 0; column < art.columns; column += 1) {
      context.fillStyle = ((row + column) & 1) === 0 ? art.red : art.white;
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
    }
  }
  finishClothSurface(canvas, art.trimColor, 0x6e2f_91c5);
}

function paintOttomanBanner(
  canvas: HTMLCanvasElement,
  art: OttomanFieldStandardPanelArt,
): void {
  const context = context2d(canvas);
  for (const band of art.bands) {
    context.fillStyle = band.color;
    context.fillRect(
      0,
      band.startV * canvas.height,
      canvas.width,
      (band.endV - band.startV) * canvas.height + 1,
    );
  }
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = art.emblem.color;
  context.shadowColor = 'rgba(35, 17, 5, 0.46)';
  context.shadowBlur = 4;
  context.shadowOffsetY = 2;
  for (const stroke of art.emblem.strokes) {
    context.lineWidth = Math.max(2, stroke.widthUv * canvas.width);
    context.beginPath();
    stroke.points.forEach(([u, v], index) => {
      if (index === 0) context.moveTo(u * canvas.width, v * canvas.height);
      else context.lineTo(u * canvas.width, v * canvas.height);
    });
    context.stroke();
  }
  context.restore();
  finishClothSurface(canvas, art.trimColor, 0xd3c4_7f19);
}

function paintMercenaryBanner(
  canvas: HTMLCanvasElement,
  art: MercenaryCompanyStandardArt,
): void {
  const context = context2d(canvas);
  const { width, height } = canvas;
  context.fillStyle = art.panel.fieldColor;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = art.panel.bendColor;
  context.lineWidth = height * 0.22;
  context.beginPath();
  context.moveTo(-width * 0.08, height * 0.86);
  context.lineTo(width * 1.08, height * 0.14);
  context.stroke();
  context.restore();

  // A broad, heraldic frog: intentionally readable and a little ridiculous.
  context.save();
  context.translate(width * 0.54, height * 0.53);
  context.fillStyle = art.panel.emblemColor;
  context.strokeStyle = art.panel.trimColor;
  context.lineWidth = Math.max(3, height * 0.018);
  context.beginPath();
  context.ellipse(0, height * 0.03, width * 0.16, height * 0.15, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  for (const side of [-1, 1] as const) {
    context.beginPath();
    context.ellipse(side * width * 0.11, -height * 0.11, width * 0.055, height * 0.06, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(side * width * 0.1, height * 0.09);
    context.lineTo(side * width * 0.24, height * 0.2);
    context.lineTo(side * width * 0.3, height * 0.16);
    context.stroke();
  }
  context.fillStyle = art.panel.fieldColor;
  context.beginPath();
  context.arc(-width * 0.11, -height * 0.12, height * 0.013, 0, Math.PI * 2);
  context.arc(width * 0.11, -height * 0.12, height * 0.013, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(0, height * 0.035, width * 0.075, 0.1 * Math.PI, 0.9 * Math.PI);
  context.stroke();
  context.restore();
  finishClothSurface(canvas, art.panel.trimColor, 0x4b75_a9d3);
}

function finishClothSurface(
  canvas: HTMLCanvasElement,
  trimColor: string,
  seed: number,
): void {
  const context = context2d(canvas);
  const width = canvas.width;
  const height = canvas.height;
  context.save();
  context.globalCompositeOperation = 'soft-light';
  for (let x = 0; x < width; x += 3) {
    context.strokeStyle = x % 6 === 0
      ? 'rgba(255,255,255,0.075)'
      : 'rgba(15,10,7,0.055)';
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
  for (let y = 1; y < height; y += 4) {
    context.strokeStyle = y % 8 === 1
      ? 'rgba(255,255,255,0.05)'
      : 'rgba(13,9,6,0.045)';
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
  let random = seed >>> 0;
  for (let mark = 0; mark < 88; mark += 1) {
    random = Math.imul(random ^ (random >>> 15), 0x2c1b_3c6d) >>> 0;
    const x = random % width;
    random = Math.imul(random ^ (random >>> 12), 0x297a_2d39) >>> 0;
    const y = random % height;
    const radius = 2 + (random >>> 17) % 11;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(24,14,7,0.08)');
    gradient.addColorStop(1, 'rgba(24,14,7,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();

  const trim = Math.max(4, Math.round(Math.min(width, height) * 0.018));
  context.strokeStyle = trimColor;
  context.lineWidth = trim;
  context.strokeRect(trim * 0.5, trim * 0.5, width - trim, height - trim);
  context.strokeStyle = 'rgba(255, 240, 177, 0.24)';
  context.lineWidth = 1;
  context.strokeRect(trim + 0.5, trim + 0.5, width - trim * 2 - 1, height - trim * 2 - 1);
}

function loadChargeMask(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
