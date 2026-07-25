import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CELESTIAL_SKY_EPOCH,
  createCelestialStarMap,
  precessEquatorialCoordinate,
} from '../src/sky/CelestialStarMap.ts';
import {
  CLASSICAL_CONSTELLATION_LINES,
  NAKED_EYE_STAR_DATA,
} from '../src/sky/celestialCatalog.generated.ts';
import { computeSiderealAngle } from '../src/world/dayNightPresentation.ts';

assert.equal(CELESTIAL_SKY_EPOCH, 1550);
assert.ok(NAKED_EYE_STAR_DATA.length / 4 > 5_000, 'catalog should contain the naked-eye sky');
assert.ok(
  CLASSICAL_CONSTELLATION_LINES.length >= 80,
  'classical northern constellation figures should include their component polylines',
);

const map = createCelestialStarMap({ width: 512, height: 256 });
assert.equal(map.image.width, 512);
assert.equal(map.image.height, 256);
assert.equal(map.userData.catalogEpoch, 1550);
const pixels = map.image.data as Uint8Array;
let illuminatedPixels = 0;
const longitudeEnergy = new Array<number>(16).fill(0);
for (let y = 0; y < map.image.height; y += 1) {
  for (let x = 0; x < map.image.width; x += 1) {
    const offset = (y * map.image.width + x) * 4;
    const energy = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
    if (energy > 0) illuminatedPixels += 1;
    longitudeEnergy[Math.floor(x / map.image.width * longitudeEnergy.length)] += energy;
  }
}
assert.ok(illuminatedPixels > 4_000, 'catalog stars and constellation strokes should populate the sky');
assert.ok(
  new Set(longitudeEnergy).size > 12,
  'longitude bands should vary naturally rather than repeat as a short procedural period',
);

const referenceJ2000 = { rightAscensionDeg: 0, declinationDeg: 0 };
const reference1550 = precessEquatorialCoordinate(
  referenceJ2000.rightAscensionDeg,
  referenceJ2000.declinationDeg,
);
const precessionDistance = equatorialAngularDistance(referenceJ2000, reference1550);
assert.ok(
  precessionDistance > THREE.MathUtils.degToRad(5)
    && precessionDistance < THREE.MathUtils.degToRad(8),
  'the historical epoch should visibly account for roughly 450 years of axial precession',
);

const springAngle = computeSiderealAngle(
  { month: 3, monthDay: 1, preciseCalendarDay: 20.5 },
  21,
);
const summerAngle = computeSiderealAngle(
  { month: 6, monthDay: 1, preciseCalendarDay: 50.5 },
  21,
);
const seasonalRotation = positiveModulo(summerAngle - springAngle, Math.PI * 2);
assert.ok(
  Math.abs(seasonalRotation - Math.PI / 2) < 1e-9,
  'the same evening hour should reveal a quarter-turn of new sky after one fictional season',
);

map.dispose();
console.log('celestial sky tests passed');

function equatorialAngularDistance(
  a: { rightAscensionDeg: number; declinationDeg: number },
  b: { rightAscensionDeg: number; declinationDeg: number },
): number {
  const aRa = THREE.MathUtils.degToRad(a.rightAscensionDeg);
  const aDec = THREE.MathUtils.degToRad(a.declinationDeg);
  const bRa = THREE.MathUtils.degToRad(b.rightAscensionDeg);
  const bDec = THREE.MathUtils.degToRad(b.declinationDeg);
  const dot = Math.sin(aDec) * Math.sin(bDec)
    + Math.cos(aDec) * Math.cos(bDec) * Math.cos(aRa - bRa);
  return Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
