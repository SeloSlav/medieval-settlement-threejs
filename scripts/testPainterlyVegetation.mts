import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, vec4 } from 'three/tsl';

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
const painterly = await import(
  '../src/vegetation/painterly/painterlyVegetationMaterial.ts'
);

assert.deepEqual(
  painterly.PAINTERLY_GROUND_SETTINGS,
  {
    brushScale: 2.2,
    sourceAlbedoWeight: 1,
    normalStrength: 1.16,
    strokeContrast: 0.92,
    detailStrength: 1.5,
    shadowThreshold: -0.61,
    lightThreshold: 0.36,
    bandSoftness: 0.075,
    shadowValue: 0.16,
    midtoneValue: 0.33,
    oilStrength: 0.06,
    oilThreshold: 0.34,
    nativeSheen: 0.04,
    roughnessVariation: 0.32,
    rimStrength: 0.18,
    rimPower: 5,
  },
  'ground surfaces must retain the exported texture-study treatment',
);
assert.deepEqual(
  painterly.PAINTERLY_GROUND_PROJECTION_SETTINGS,
  {
    secondaryRotationCos: 0.75471,
    secondaryRotationSin: 0.65606,
    secondaryScale: 1.137,
    secondaryOffsetX: 0.317,
    secondaryOffsetY: 0.619,
    secondaryBlend: 0.32,
  },
  'large-world deperiodization must remain separate from the imported lab treatment',
);

assert.equal(
  preferences.isPainterlyVegetationEnabled(),
  false,
  'painterly vegetation must be off by default',
);

const material = new MeshStandardNodeMaterial();
const groundMaterial = new MeshStandardNodeMaterial();
groundMaterial.colorNode = vec4(0.34, 0.42, 0.27, 1);
groundMaterial.aoNode = float(0.72);
const nativeColorNode = material.colorNode;
const nativeNormalNode = material.normalNode;
const nativeRoughnessNode = material.roughnessNode;
const hadOwnSetupOutput = Object.prototype.hasOwnProperty.call(material, 'setupOutput');
const nativeGroundColorNode = groundMaterial.colorNode;
const nativeGroundNormalNode = groundMaterial.normalNode;
const nativeGroundRoughnessNode = groundMaterial.roughnessNode;
const nativeGroundAoNode = groundMaterial.aoNode;
const groundHadOwnSetupOutput = Object.prototype.hasOwnProperty.call(
  groundMaterial,
  'setupOutput',
);

painterly.applyPainterlyVegetationMaterial(material, 'deciduous-leaf');
painterly.applyPainterlyVegetationMaterial(groundMaterial, 'terrain-ground', {
  aoNodeWhilePainted: float(1),
});
let diagnostics = painterly.getPainterlyVegetationDiagnostics();
assert.equal(diagnostics.enabled, false);
assert.equal(diagnostics.registeredMaterials, 2);
assert.equal(diagnostics.installedMaterials, 0);
assert.equal(diagnostics.roles['deciduous-leaf'], 1);
assert.equal(diagnostics.roles['terrain-ground'], 1);
assert.equal(
  diagnostics.texture,
  null,
  'the packed brush texture must remain lazy while the option is off',
);
assert.equal(material.colorNode, nativeColorNode);

preferences.setPainterlyVegetationEnabled(true);
diagnostics = painterly.getPainterlyVegetationDiagnostics();
assert.equal(diagnostics.enabled, true);
assert.equal(diagnostics.installedMaterials, 2);
assert.equal(diagnostics.texture?.seedHex, 'ed5884fa');
assert.notEqual(material.colorNode, nativeColorNode);
assert.notEqual(material.normalNode, nativeNormalNode);
assert.notEqual(material.roughnessNode, nativeRoughnessNode);
assert.equal(material.userData.painterlyVegetationInstalled, true);
assert.equal(
  Object.prototype.hasOwnProperty.call(material, 'setupOutput'),
  true,
  'enabled materials must own the post-light painter hook',
);
material.fog = false;
const painterOutput = material.setupOutput({}, vec4(0.4, 0.5, 0.3, 1));
assert.ok(painterOutput, 'the complete post-light painter graph must construct');
assert.notEqual(groundMaterial.colorNode, nativeGroundColorNode);
assert.notEqual(groundMaterial.normalNode, nativeGroundNormalNode);
assert.notEqual(groundMaterial.roughnessNode, nativeGroundRoughnessNode);
assert.notEqual(groundMaterial.aoNode, nativeGroundAoNode);
assert.equal(groundMaterial.userData.painterlyVegetationRole, 'terrain-ground');
assert.equal(groundMaterial.userData.painterlyVegetationInstalled, true);
assert.equal(
  groundMaterial.userData.painterlyVegetationCoordinateSpace,
  'surface-uv',
  'terrain paint must follow the authored warped terrain UV field',
);
assert.equal(
  groundMaterial.userData.painterlyVegetationDeperiodized,
  true,
  'ground surfaces must blend a decorrelated projection to hide the source tile period',
);
assert.equal(
  groundMaterial.userData.painterlyVegetationUsesReducedAo,
  true,
  'sampler-limited terrain must replace micro-AO while paint is enabled',
);
const groundPainterOutput = groundMaterial.setupOutput({}, vec4(0.4, 0.5, 0.3, 1));
assert.ok(
  groundPainterOutput,
  'the exported ground-paint post-light graph must construct',
);

preferences.setPainterlyVegetationEnabled(false);
diagnostics = painterly.getPainterlyVegetationDiagnostics();
assert.equal(diagnostics.installedMaterials, 0);
assert.equal(material.colorNode, nativeColorNode);
assert.equal(material.normalNode, nativeNormalNode);
assert.equal(material.roughnessNode, nativeRoughnessNode);
assert.equal(groundMaterial.colorNode, nativeGroundColorNode);
assert.equal(groundMaterial.normalNode, nativeGroundNormalNode);
assert.equal(groundMaterial.roughnessNode, nativeGroundRoughnessNode);
assert.equal(groundMaterial.aoNode, nativeGroundAoNode);
assert.equal(
  groundMaterial.userData.painterlyVegetationCoordinateSpace,
  undefined,
  'disabling must remove painter projection diagnostics',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(material, 'setupOutput'),
  hadOwnSetupOutput,
  'disabling must restore the material setupOutput ownership exactly',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(groundMaterial, 'setupOutput'),
  groundHadOwnSetupOutput,
  'disabling must restore ground setupOutput ownership exactly',
);
assert.equal(
  storage.has('medieval-road-system.painterlyVegetationEnabled'),
  false,
  'the default false preference should be represented by no storage entry',
);

const requiredRegistrations = [
  ['../src/terrain/TerrainGrassMaterial.ts', "'terrain-ground'"],
  ['../src/roads/RoadSurfaceMaterial.ts', "'road-ground'"],
  ['../src/roads/RoadSurfaceMaterial.ts', "'river-bank'"],
  ['../src/grass/GrassBladeField.ts', "'grass-blade'"],
  ['../src/rivers/RiverReeds.ts', "'ground-cover'"],
  ['../src/residences/backyardGardenMesh.ts', "'terrain-ground'"],
] as const;
for (const [relativePath, role] of requiredRegistrations) {
  assert.match(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    new RegExp(`applyPainterlyVegetationMaterial\\([^;]+${role}`),
    `${relativePath} must register its final material as ${role}`,
  );
}

material.dispose();
groundMaterial.dispose();
assert.equal(
  painterly.getPainterlyVegetationDiagnostics().registeredMaterials,
  0,
  'disposed shared materials must leave the live registry',
);

console.log('Painterly vegetation preference and material registry checks passed.');
