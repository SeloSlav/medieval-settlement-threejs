import assert from 'node:assert/strict';
import * as THREE from 'three';
import { vec4 } from 'three/tsl';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const preferences = await import('../src/scene/painterlyVegetationPreference.ts');
const painterly = await import('../src/vegetation/painterly/painterlyVegetationMaterial.ts');
const { PainterlySceneMaterialCoverage } = await import(
  '../src/scene/PainterlySceneMaterialCoverage.ts'
);

assert.deepEqual(
  painterly.PAINTERLY_SCENE_SURFACE_SETTINGS,
  {
    brushScale: 0.7,
    parallaxDepth: 0.048,
    normalStrength: 0.9,
    strokeContrast: 0.9,
    detailStrength: 0.72,
    shadowThreshold: -0.68,
    lightThreshold: 0.28,
    bandSoftness: 0.03,
    shadowValue: 0.04,
    midtoneValue: 0.4,
    oilStrength: 0,
    oilThreshold: 0.34,
    nativeSheen: 0,
    highlightBrushiness: 1.08,
    highlightSteps: 4,
    roughnessVariation: 0.36,
    rimStrength: 0.48,
    rimPower: 5,
    edgeErosion: 0.82,
    edgeBristleReach: 0.76,
    erosionScale: 0.66,
    curvatureGuard: 8,
    shadowErosion: 1,
    shadowMaskOffset: -0.05,
    shadowBrushScale: 0.72,
    outerRimWidth: 0,
    rimContinuity: 0.5,
    outlineWidth: 0,
    outlineJitter: 0,
    outlineSeparation: 1.35,
    outlineBreakup: 0.78,
    outlineStrokeWidth: 1.45,
    outlineWidthVariation: 0.68,
  },
  'scene surfaces must retain the exported building paint-lab controls',
);

const scene = new THREE.Scene();
const building = new THREE.Mesh(
  new THREE.BoxGeometry(4, 3, 2),
  new THREE.MeshStandardMaterial({ color: 0xb58a62, roughness: 0.9 }),
);
building.name = 'Test timber building';
const texturedResource = new THREE.Mesh(
  new THREE.CylinderGeometry(0.4, 0.45, 1.2, 12),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: new THREE.Texture(),
    roughness: 0.86,
  }),
);
texturedResource.name = 'Test barrel resource';
const water = new THREE.Mesh(
  new THREE.CircleGeometry(1, 12),
  new THREE.MeshPhysicalMaterial({ transmission: 0.8 }),
);
water.material.userData.waterQualityTier = 'test-water';
const overlay = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  }),
);
const collision = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ visible: false }),
);
const basicMarker = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.1, 12),
  new THREE.MeshBasicMaterial({ color: 0xff0000 }),
);
scene.add(building, texturedResource, water, overlay, collision, basicMarker);

const coverage = new PainterlySceneMaterialCoverage(scene, 1);
assert.equal(coverage.getDiagnostics().scans, 0, 'disabled startup must remain lazy');
preferences.setPainterlyVegetationEnabled(true);

let diagnostics = coverage.getDiagnostics();
assert.equal(diagnostics.newlyRegisteredMaterials, 2);
assert.equal(diagnostics.skippedSpecializedMaterials, 1);
assert.equal(diagnostics.skippedBlendedMaterials, 1);
assert.equal(diagnostics.skippedInvisibleMaterials, 1);
assert.equal(diagnostics.skippedUnsupportedMaterials, 1);
assert.equal(building.material.userData.painterlyVegetationRole, 'scene-surface');
assert.equal(
  building.material.userData.painterlyVegetationCoordinateSpace,
  'object-triplanar',
);
assert.equal(
  texturedResource.material.userData.painterlyVegetationCoordinateSpace,
  'uv',
);
assert.equal(water.material.userData.painterlyVegetationRegistered, undefined);
assert.ok(
  (building.material as THREE.MeshStandardMaterial & {
    setupOutput: (builder: unknown, output: unknown) => unknown;
  }).setupOutput({}, vec4(0.5, 0.4, 0.3, 1)),
  'the triplanar scene-surface output graph must construct',
);
assert.ok(
  (texturedResource.material as THREE.MeshStandardMaterial & {
    setupOutput: (builder: unknown, output: unknown) => unknown;
  }).setupOutput({}, vec4(0.5, 0.4, 0.3, 1)),
  'the UV scene-surface output graph must construct',
);

const nativeBuildingPaintNode = building.material.colorNode;
building.material.map = new THREE.Texture();
diagnostics = coverage.synchronizeNow();
assert.equal(diagnostics.refreshedMaterials, 1);
assert.notEqual(
  building.material.colorNode,
  nativeBuildingPaintNode,
  'asynchronously hydrated surface textures must rebuild the paint source graph',
);

const lateBench = new THREE.Mesh(
  new THREE.BoxGeometry(2, 0.2, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x6b4528, roughness: 0.95 }),
);
scene.add(lateBench);
coverage.update();
assert.equal(
  lateBench.material.userData.painterlyVegetationInstalled,
  true,
  'late-created scene materials must join the active paint treatment',
);

preferences.setPainterlyVegetationEnabled(false);
assert.equal(building.material.userData.painterlyVegetationInstalled, false);
assert.equal(lateBench.material.userData.painterlyVegetationInstalled, false);

coverage.dispose();
for (const object of scene.children) {
  if (!(object as THREE.Mesh).isMesh) continue;
  const mesh = object as THREE.Mesh;
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) material.dispose();
}

diagnostics = coverage.getDiagnostics();
assert.equal(diagnostics.enabled, false);
console.log('Scene-wide painterly material coverage checks passed.');
