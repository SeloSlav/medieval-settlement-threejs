import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  CELESTIAL_SKY_EPOCH,
  createCelestialStarMap,
  equirectangularHorizontalSplatScale,
  precessEquatorialCoordinate,
} from '../src/sky/CelestialStarMap.ts';
import {
  CLASSICAL_CONSTELLATION_LINES,
  NAKED_EYE_STAR_DATA,
} from '../src/sky/celestialCatalog.generated.ts';
import {
  createCelestialStarMapPlaceholder,
  hydrateCelestialStarMapTexture,
} from '../src/sky/CelestialStarMapLoader.ts';
import { computeSiderealAngle } from '../src/world/dayNightPresentation.ts';
import {
  maximumOpaqueWorldDistanceFromCamera,
  SKY_DEPTH_OCCLUSION_RADIUS,
  SKY_OPAQUE_LAST_RENDER_ORDER,
} from '../src/sky/skyDepthOcclusionPolicy.ts';
import {
  GORSKI_KOTAR_1550_TO_J2000_PRECESSION,
  GORSKI_KOTAR_CELESTIAL_EPOCH,
  GORSKI_KOTAR_LATITUDE_DEG,
  GORSKI_KOTAR_LONGITUDE_DEG,
} from '../src/sky/gorskiKotarCelestial.ts';
import { MAP_SIZE_PRESETS } from '../src/world/worldGenerationSettings.ts';

const maxOrbitDistance = 88 / 0.3;
for (const dimensions of Object.values(MAP_SIZE_PRESETS)) {
  assert.ok(
    maximumOpaqueWorldDistanceFromCamera({
      terrainSize: dimensions.terrainSize,
      playableSize: dimensions.playableSize,
      maxOrbitDistance,
    }) < SKY_DEPTH_OCCLUSION_RADIUS,
    `${dimensions.label} world opaques must remain in front of the depth-occluded sky`,
  );
}
assert.ok(SKY_OPAQUE_LAST_RENDER_ORDER > 0,
  'the depth-occluded sky must sort after ordinary opaque world geometry');

const eanpaSource = fs.readFileSync('vendor/eanpa-sky/engine/sky_system.js', 'utf8');
const eanpaLicense = fs.readFileSync('vendor/eanpa-sky/LICENSE', 'utf8');
const skyFacadeSource = fs.readFileSync('src/sky/SkyCloudMesh.ts', 'utf8');
assert.match(eanpaLicense, /MIT License/);
assert.match(eanpaSource, /export async function makeSkySystem/);
assert.match(eanpaSource, /observerLatitude/);
assert.match(eanpaSource, /siderealAngle/);
assert.match(eanpaSource, /setSunDirection/);
assert.match(eanpaSource, /constellationVisibility/);
assert.match(eanpaSource, /starBackdropNode/);
assert.match(eanpaSource, /starBackdropTransform/);
assert.match(eanpaSource, /backdrop\.mul\(backdrop\)\.mul\(1\.6\)/);
assert.match(eanpaSource, /fract\(float\(0\.5\)\.sub\(/);
assert.match(skyFacadeSource, /vendor\/eanpa-sky\/engine\/sky_system\.js/);
assert.match(skyFacadeSource, /starmap_tycho_4k\.jpg/);
assert.doesNotMatch(skyFacadeSource, /sky-cloud-3d/);
assert.equal(
  fs.statSync('vendor/eanpa-sky/assets/starmap_tycho_4k.jpg').size,
  3_009_146,
  'the pinned Eanpa 4096x2048 Tycho panorama must be vendored intact',
);
assert.equal(fs.existsSync('vendor/sky-cloud-3d'), false,
  'the retired non-commercial sky package must not remain in the tree');

assert.equal(CELESTIAL_SKY_EPOCH, 1550);
assert.equal(GORSKI_KOTAR_CELESTIAL_EPOCH, 1550);
assert.equal(GORSKI_KOTAR_LATITUDE_DEG, 45.6);
assert.equal(GORSKI_KOTAR_LONGITUDE_DEG, 14.9);
assert.ok(NAKED_EYE_STAR_DATA.length / 4 > 5_000, 'catalog should contain the naked-eye sky');
assert.ok(
  CLASSICAL_CONSTELLATION_LINES.length >= 80,
  'classical northern constellation figures should include their component polylines',
);

const map = createCelestialStarMap({ width: 512, height: 256 });
assert.equal(map.image.width, 512);
assert.equal(map.image.height, 256);
assert.equal(map.userData.catalogEpoch, 1550);
assert.equal(typeof map.userData.generationMs, 'number');
assert.ok(map.userData.generationMs >= 0, 'celestial generation timing must be recorded');
const pixels = map.image.data as Uint8Array;
let illuminatedPixels = 0;
let constellationPixels = 0;
const longitudeEnergy = new Array<number>(16).fill(0);
for (let y = 0; y < map.image.height; y += 1) {
  for (let x = 0; x < map.image.width; x += 1) {
    const offset = (y * map.image.width + x) * 4;
    const energy = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
    if (energy > 0) illuminatedPixels += 1;
    if (pixels[offset + 3] > 0) constellationPixels += 1;
    longitudeEnergy[Math.floor(x / map.image.width * longitudeEnergy.length)] += energy;
  }
}
assert.ok(illuminatedPixels > 2_000, 'catalog stars should populate the sky independently');
assert.ok(constellationPixels > 1_000, 'constellation guides should occupy the alpha channel');
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
const reference1550Vector = equatorialVector(reference1550);
const recoveredJ2000Vector = applyMatrix3(
  GORSKI_KOTAR_1550_TO_J2000_PRECESSION,
  reference1550Vector,
);
assert.ok(
  new THREE.Vector3(...recoveredJ2000Vector).angleTo(new THREE.Vector3(1, 0, 0)) < 1e-7,
  'the Tycho backdrop must be inverse-precessed to J2000 before epoch-1550 sampling',
);
assertRotationMatrix(GORSKI_KOTAR_1550_TO_J2000_PRECESSION);

assert.ok(
  Math.abs(
    equirectangularHorizontalSplatScale(
      45.6,
      map.image.width,
      map.image.height,
    ) - 1 / Math.cos(THREE.MathUtils.degToRad(45.6)),
  ) < 0.01,
  'star splats around the Gorski Kotar zenith should remain circular on the sphere',
);
assert.ok(
  equirectangularHorizontalSplatScale(
    86.8,
    map.image.width,
    map.image.height,
  ) > 15,
  'near-polar star splats should compensate for equirectangular convergence',
);

const springAngle = computeSiderealAngle(
  { month: 3, monthDay: 1, preciseCalendarDay: 60 + 21 / 24 },
  21,
);
const summerAngle = computeSiderealAngle(
  { month: 6, monthDay: 1, preciseCalendarDay: 150 + 21 / 24 },
  21,
);
const seasonalRotation = positiveModulo(summerAngle - springAngle, Math.PI * 2);
assert.ok(
  Math.abs(seasonalRotation - Math.PI / 2) < THREE.MathUtils.degToRad(2),
  'the same evening hour should reveal roughly a quarter-turn of new sky after one fictional season',
);
const firstNightAngle = computeSiderealAngle(
  { month: 1, monthDay: 1, preciseCalendarDay: 21 / 24 },
  21,
);
const nextNightAngle = computeSiderealAngle(
  { month: 1, monthDay: 2, preciseCalendarDay: 1 + 21 / 24 },
  21,
);
assert.ok(
  Math.abs(
    positiveModulo(nextNightAngle - firstNightAngle, Math.PI * 2)
      - THREE.MathUtils.degToRad(0.9856)
  ) < THREE.MathUtils.degToRad(0.01),
  'the star field should advance by the sidereal-vs-solar offset on consecutive nights',
);

map.dispose();

const fullMap = createCelestialStarMap();
assert.equal(fullMap.image.width, 2048);
assert.equal(fullMap.image.height, 1024);
const fullGenerationMs = fullMap.userData.generationMs as number;
assert.ok(Number.isFinite(fullGenerationMs));
fullMap.dispose();

const placeholder = createCelestialStarMapPlaceholder();
const placeholderUuid = placeholder.uuid;
const placeholderVersion = placeholder.version;
let placeholderDisposals = 0;
placeholder.addEventListener('dispose', () => {
  placeholderDisposals += 1;
});
const loadedPixels = new Uint8Array([
  10, 20, 30, 40,
  50, 60, 70, 80,
]);
const loadedMap = new THREE.DataTexture(
  loadedPixels,
  2,
  1,
  THREE.RGBAFormat,
);
loadedMap.name = 'Loaded test sky';
loadedMap.wrapS = THREE.RepeatWrapping;
loadedMap.wrapT = THREE.ClampToEdgeWrapping;
loadedMap.minFilter = THREE.LinearFilter;
loadedMap.magFilter = THREE.NearestFilter;
loadedMap.flipY = false;
loadedMap.colorSpace = THREE.NoColorSpace;
loadedMap.userData.catalogEpoch = CELESTIAL_SKY_EPOCH;
hydrateCelestialStarMapTexture(placeholder, loadedMap);
assert.equal(
  placeholderDisposals,
  1,
  'hydration must release the placeholder GPU allocation before changing texture dimensions',
);
assert.equal(
  placeholder.uuid,
  placeholderUuid,
  'deferred hydration must preserve the texture object bound to the sky shader',
);
assert.equal(placeholder.image.width, 2);
assert.equal(placeholder.image.height, 1);
assert.equal(placeholder.image.data, loadedPixels);
assert.equal(placeholder.name, loadedMap.name);
assert.equal(placeholder.magFilter, loadedMap.magFilter);
assert.equal(placeholder.userData.catalogEpoch, CELESTIAL_SKY_EPOCH);
assert.equal(placeholder.userData.isCelestialStarMapPlaceholder, false);
assert.ok(
  placeholder.version > placeholderVersion,
  'hydration must flag the existing texture for a GPU upload',
);
placeholder.dispose();
loadedMap.dispose();

console.log(
  `celestial sky tests passed (2048x1024 generated in ${fullGenerationMs.toFixed(1)} ms; 8 MiB RGBA)`,
);

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

function equatorialVector(
  coordinate: { rightAscensionDeg: number; declinationDeg: number },
): readonly [number, number, number] {
  const rightAscension = THREE.MathUtils.degToRad(coordinate.rightAscensionDeg);
  const declination = THREE.MathUtils.degToRad(coordinate.declinationDeg);
  const cosDeclination = Math.cos(declination);
  return [
    cosDeclination * Math.cos(rightAscension),
    Math.sin(declination),
    cosDeclination * Math.sin(rightAscension),
  ];
}

function applyMatrix3(
  matrix: readonly number[],
  vector: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function assertRotationMatrix(matrix: readonly number[]): void {
  const rows = [
    new THREE.Vector3(matrix[0], matrix[1], matrix[2]),
    new THREE.Vector3(matrix[3], matrix[4], matrix[5]),
    new THREE.Vector3(matrix[6], matrix[7], matrix[8]),
  ];
  for (const row of rows) {
    assert.ok(Math.abs(row.length() - 1) < 1e-10, 'precession rows must have unit length');
  }
  assert.ok(Math.abs(rows[0].dot(rows[1])) < 1e-10);
  assert.ok(Math.abs(rows[0].dot(rows[2])) < 1e-10);
  assert.ok(Math.abs(rows[1].dot(rows[2])) < 1e-10);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
