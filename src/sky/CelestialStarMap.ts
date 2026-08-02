import * as THREE from 'three';
import {
  CLASSICAL_CONSTELLATION_LINES,
  NAKED_EYE_STAR_DATA,
} from './celestialCatalog.generated.ts';

const CATALOG_EPOCH = 2000;
export const CELESTIAL_SKY_EPOCH = 1550;
const DEFAULT_WIDTH = 2048;
const DEFAULT_HEIGHT = 1024;
const DEG_TO_RAD = Math.PI / 180;
const ARCSEC_TO_RAD = DEG_TO_RAD / 3600;

type EquatorialCoordinate = {
  rightAscensionDeg: number;
  declinationDeg: number;
};

type UnitVector = {
  x: number;
  y: number;
  z: number;
};

export type CelestialStarMapOptions = {
  width?: number;
  height?: number;
  epoch?: number;
};

/**
 * Builds a deterministic, offline celestial texture from real naked-eye star
 * coordinates. RGB stores the natural star field; alpha stores optional
 * classical Western constellation guides so the shader can toggle them without
 * rebuilding or duplicating the catalog texture.
 */
export function createCelestialStarMap(
  options: CelestialStarMapOptions = {},
): THREE.DataTexture {
  const generationStartedAt = performance.now();
  const width = Math.max(256, Math.floor(options.width ?? DEFAULT_WIDTH));
  const height = Math.max(128, Math.floor(options.height ?? DEFAULT_HEIGHT));
  const epoch = options.epoch ?? CELESTIAL_SKY_EPOCH;
  const pixels = new Uint8Array(width * height * 4);

  drawConstellationFigures(pixels, width, height, epoch);
  drawCatalogStars(pixels, width, height, epoch);

  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.name = `Gorski Kotar naked-eye sky (epoch ${epoch})`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.userData.catalogEpoch = epoch;
  texture.userData.starCount = NAKED_EYE_STAR_DATA.length / 4;
  texture.userData.constellationLineCount = CLASSICAL_CONSTELLATION_LINES.length;
  texture.userData.generationMs = Math.round(
    (performance.now() - generationStartedAt) * 10,
  ) / 10;
  texture.needsUpdate = true;
  return texture;
}

/** Precesses a J2000 equatorial coordinate to the chosen historical epoch. */
export function precessEquatorialCoordinate(
  rightAscensionDeg: number,
  declinationDeg: number,
  targetEpoch = CELESTIAL_SKY_EPOCH,
): EquatorialCoordinate {
  if (targetEpoch === CATALOG_EPOCH) {
    return { rightAscensionDeg: wrapDegrees(rightAscensionDeg), declinationDeg };
  }

  // IAU 1976/Meeus precession is amply accurate for a visual 16th-century sky.
  const centuries = (targetEpoch - CATALOG_EPOCH) / 100;
  const centuriesSquared = centuries * centuries;
  const centuriesCubed = centuriesSquared * centuries;
  const zeta = (
    2306.2181 * centuries
    + 0.30188 * centuriesSquared
    + 0.017998 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const z = (
    2306.2181 * centuries
    + 1.09468 * centuriesSquared
    + 0.018203 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const theta = (
    2004.3109 * centuries
    - 0.42665 * centuriesSquared
    - 0.041833 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const rightAscension = rightAscensionDeg * DEG_TO_RAD;
  const declination = declinationDeg * DEG_TO_RAD;
  const shiftedRightAscension = rightAscension + zeta;
  const cosDeclination = Math.cos(declination);
  const a = cosDeclination * Math.sin(shiftedRightAscension);
  const b = Math.cos(theta) * cosDeclination * Math.cos(shiftedRightAscension)
    - Math.sin(theta) * Math.sin(declination);
  const c = Math.sin(theta) * cosDeclination * Math.cos(shiftedRightAscension)
    + Math.cos(theta) * Math.sin(declination);

  return {
    rightAscensionDeg: wrapDegrees((Math.atan2(a, b) + z) / DEG_TO_RAD),
    declinationDeg: Math.asin(THREE.MathUtils.clamp(c, -1, 1)) / DEG_TO_RAD,
  };
}

function drawCatalogStars(
  pixels: Uint8Array,
  width: number,
  height: number,
  epoch: number,
): void {
  for (let index = 0; index < NAKED_EYE_STAR_DATA.length; index += 4) {
    const coordinate = precessEquatorialCoordinate(
      NAKED_EYE_STAR_DATA[index],
      NAKED_EYE_STAR_DATA[index + 1],
      epoch,
    );
    const magnitude = NAKED_EYE_STAR_DATA[index + 2];
    const colorIndex = NAKED_EYE_STAR_DATA[index + 3];
    const point = texturePoint(coordinate, width, height);
    const brightness = THREE.MathUtils.clamp(
      72 + (6.05 - magnitude) * 31,
      68,
      255,
    );
    const radius = magnitude < 0.2
      ? 2.5
      : magnitude < 1.5
        ? 1.85
        : magnitude < 3
          ? 1.25
          : magnitude < 4.6
            ? 0.8
            : 0.52;
    const horizontalRadius = radius * equirectangularHorizontalSplatScale(
      coordinate.declinationDeg,
      width,
      height,
    );
    drawStarGlow(
      pixels,
      width,
      height,
      point.x,
      point.y,
      Math.min(horizontalRadius, width / 3.4),
      radius,
      starColor(colorIndex),
      brightness / 255,
    );
  }
}

function drawConstellationFigures(
  pixels: Uint8Array,
  width: number,
  height: number,
  epoch: number,
): void {
  for (const packedLine of CLASSICAL_CONSTELLATION_LINES) {
    for (let index = 2; index < packedLine.length; index += 2) {
      const start = equatorialVector(precessEquatorialCoordinate(
        packedLine[index - 2],
        packedLine[index - 1],
        epoch,
      ));
      const end = equatorialVector(precessEquatorialCoordinate(
        packedLine[index],
        packedLine[index + 1],
        epoch,
      ));
      drawGreatCircleSegment(pixels, width, height, start, end);
    }
  }
}

function drawGreatCircleSegment(
  pixels: Uint8Array,
  width: number,
  height: number,
  start: UnitVector,
  end: UnitVector,
): void {
  const dot = THREE.MathUtils.clamp(
    start.x * end.x + start.y * end.y + start.z * end.z,
    -1,
    1,
  );
  const angle = Math.acos(dot);
  const steps = Math.max(2, Math.ceil(angle / (0.08 * DEG_TO_RAD)));
  const sinAngle = Math.sin(angle);

  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const vector = sinAngle > 1e-6
      ? {
          x: (
            start.x * Math.sin((1 - amount) * angle)
            + end.x * Math.sin(amount * angle)
          ) / sinAngle,
          y: (
            start.y * Math.sin((1 - amount) * angle)
            + end.y * Math.sin(amount * angle)
          ) / sinAngle,
          z: (
            start.z * Math.sin((1 - amount) * angle)
            + end.z * Math.sin(amount * angle)
          ) / sinAngle,
        }
      : start;
    const coordinate = vectorEquatorial(vector);
    const point = texturePoint(coordinate, width, height);
    const horizontalRadius = 0.62 * equirectangularHorizontalSplatScale(
      coordinate.declinationDeg,
      width,
      height,
    );
    drawConstellationGlow(
      pixels,
      width,
      height,
      point.x,
      point.y,
      Math.min(horizontalRadius, width / 3.4),
      0.62,
      0.018,
    );
  }
}

function drawStarGlow(
  pixels: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: readonly [number, number, number],
  strength: number,
): void {
  const extentX = Math.max(1, Math.ceil(radiusX * 1.7));
  const extentY = Math.max(1, Math.ceil(radiusY * 1.7));
  const sigmaXSquared = Math.max(0.22, radiusX * radiusX * 0.48);
  const sigmaYSquared = Math.max(0.22, radiusY * radiusY * 0.48);
  for (let offsetY = -extentY; offsetY <= extentY; offsetY += 1) {
    const y = Math.round(centerY + offsetY);
    if (y < 0 || y >= height) continue;
    for (let offsetX = -extentX; offsetX <= extentX; offsetX += 1) {
      const gaussianDistance = offsetX * offsetX / (2 * sigmaXSquared)
        + offsetY * offsetY / (2 * sigmaYSquared);
      const amount = strength * Math.exp(-gaussianDistance);
      if (amount < 0.012) continue;
      const x = positiveModulo(Math.round(centerX + offsetX), width);
      const pixelIndex = (y * width + x) * 4;
      pixels[pixelIndex] = Math.min(255, pixels[pixelIndex] + color[0] * amount);
      pixels[pixelIndex + 1] = Math.min(255, pixels[pixelIndex + 1] + color[1] * amount);
      pixels[pixelIndex + 2] = Math.min(255, pixels[pixelIndex + 2] + color[2] * amount);
    }
  }
}

function drawConstellationGlow(
  pixels: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  strength: number,
): void {
  const extentX = Math.max(1, Math.ceil(radiusX * 1.7));
  const extentY = Math.max(1, Math.ceil(radiusY * 1.7));
  const sigmaXSquared = Math.max(0.22, radiusX * radiusX * 0.48);
  const sigmaYSquared = Math.max(0.22, radiusY * radiusY * 0.48);
  for (let offsetY = -extentY; offsetY <= extentY; offsetY += 1) {
    const y = Math.round(centerY + offsetY);
    if (y < 0 || y >= height) continue;
    for (let offsetX = -extentX; offsetX <= extentX; offsetX += 1) {
      const gaussianDistance = offsetX * offsetX / (2 * sigmaXSquared)
        + offsetY * offsetY / (2 * sigmaYSquared);
      const amount = strength * Math.exp(-gaussianDistance);
      if (amount < 0.012) continue;
      const x = positiveModulo(Math.round(centerX + offsetX), width);
      const alphaIndex = (y * width + x) * 4 + 3;
      pixels[alphaIndex] = Math.min(255, pixels[alphaIndex] + 255 * amount);
    }
  }
}

function starColor(colorIndex: number): readonly [number, number, number] {
  const normalized = THREE.MathUtils.clamp((colorIndex + 0.3) / 2.2, 0, 1);
  if (normalized < 0.38) {
    const amount = normalized / 0.38;
    return [
      THREE.MathUtils.lerp(164, 235, amount),
      THREE.MathUtils.lerp(194, 240, amount),
      255,
    ];
  }
  const amount = (normalized - 0.38) / 0.62;
  return [
    255,
    THREE.MathUtils.lerp(245, 186, amount),
    THREE.MathUtils.lerp(240, 124, amount),
  ];
}

function equatorialVector(coordinate: EquatorialCoordinate): UnitVector {
  const rightAscension = coordinate.rightAscensionDeg * DEG_TO_RAD;
  const declination = coordinate.declinationDeg * DEG_TO_RAD;
  const cosDeclination = Math.cos(declination);
  return {
    x: cosDeclination * Math.cos(rightAscension),
    y: Math.sin(declination),
    z: cosDeclination * Math.sin(rightAscension),
  };
}

function vectorEquatorial(vector: UnitVector): EquatorialCoordinate {
  return {
    rightAscensionDeg: wrapDegrees(Math.atan2(vector.z, vector.x) / DEG_TO_RAD),
    declinationDeg: Math.asin(THREE.MathUtils.clamp(vector.y, -1, 1)) / DEG_TO_RAD,
  };
}

function texturePoint(
  coordinate: EquatorialCoordinate,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: wrapDegrees(coordinate.rightAscensionDeg) / 360 * width,
    y: (0.5 - coordinate.declinationDeg / 180) * (height - 1),
  };
}

/**
 * Equirectangular texels narrow toward the celestial poles. Expanding a
 * catalog splat horizontally by this factor makes it circular on the sphere
 * and prevents the radial "all stars meet here" artifact.
 */
export function equirectangularHorizontalSplatScale(
  declinationDeg: number,
  width: number,
  height: number,
): number {
  const cosDeclination = Math.max(
    Math.abs(Math.cos(declinationDeg * DEG_TO_RAD)),
    1 / 64,
  );
  const textureAspectCorrection = width / Math.max(2 * (height - 1), 1);
  return textureAspectCorrection / cosDeclination;
}

function wrapDegrees(value: number): number {
  return positiveModulo(value, 360);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
