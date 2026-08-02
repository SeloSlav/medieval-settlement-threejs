import assert from 'node:assert/strict';
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
import { MAP_SIZE_PRESETS } from '../src/world/worldGenerationSettings.ts';
import {
  createSkyMaterial,
  setPerlinNoiseTexture,
} from '../vendor/sky-cloud-3d/SkyCloudMesh.js';

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

const noise2d = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
noise2d.needsUpdate = true;
const skyMaterial = createSkyMaterial({ perlinTexture: noise2d });
const skyNodes = skyMaterial.userData.skyCloudNodes as {
  staticNoiseMode: number;
};
assert.equal(skyNodes.staticNoiseMode, 0,
  'the production 2D Perlin path must compile as a static shader specialization');
const twoDimensionalColorNode = skyMaterial.colorNode;
const replacement2d = noise2d.clone();
setPerlinNoiseTexture(skyMaterial, replacement2d);
assert.equal(skyMaterial.colorNode, twoDimensionalColorNode,
  'replacing a 2D texture must retain the already-specialized node graph');
const volumeNoise = new THREE.Data3DTexture(new Uint8Array([128]), 1, 1, 1);
volumeNoise.needsUpdate = true;
setPerlinNoiseTexture(skyMaterial, volumeNoise);
assert.equal(skyNodes.staticNoiseMode, 1,
  'the generic API must preserve its exact 3D-volume specialization');
assert.notEqual(skyMaterial.colorNode, twoDimensionalColorNode,
  'switching noise dimensionality must rebuild the specialized graph');
skyMaterial.dispose();
noise2d.dispose();
replacement2d.dispose();
volumeNoise.dispose();

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
  { month: 3, monthDay: 1, preciseCalendarDay: 20.5 },
  21,
);
const summerAngle = computeSiderealAngle(
  { month: 6, monthDay: 1, preciseCalendarDay: 110.5 },
  21,
);
const seasonalRotation = positiveModulo(summerAngle - springAngle, Math.PI * 2);
assert.ok(
  Math.abs(seasonalRotation - Math.PI / 2) < 1e-9,
  'the same evening hour should reveal a quarter-turn of new sky after one fictional season',
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

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
