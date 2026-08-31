import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  MILITARY_EQUIPMENT_MATERIAL_ROLES,
  MILITARY_EQUIPMENT_TEXTURE_SIZE,
  createMilitaryEquipmentMaterials,
  disposeMilitaryEquipmentMaterials,
  militaryEquipmentMaterialDiagnostics,
  type MilitaryEquipmentMaterialRole,
  type MilitaryEquipmentMaterials,
} from '../src/settlement/militaryEquipmentMaterials.ts';

const TEXTURED_ROLES = [
  'ash',
  'walnut',
  'bone',
  'steel',
  'bluedSteel',
  'brass',
  'leather',
  'oxblood',
  'paintedWood',
  'feather',
] as const satisfies readonly Exclude<MilitaryEquipmentMaterialRole, 'cord'>[];

const sourceText = readFileSync(
  new URL('../src/settlement/militaryEquipmentMaterials.ts', import.meta.url),
  'utf8',
);
for (const forbidden of [
  /\bCanvasTexture\b/,
  /\bTextureLoader\b/,
  /\bImageLoader\b/,
  /\bXMLHttpRequest\b/,
  /\bfetch\s*\(/,
  /\bdocument\s*\./,
  /Math\.random\s*\(/,
]) {
  assert.equal(
    forbidden.test(sourceText),
    false,
    `runtime material synthesis must stay deterministic and IO-free (${forbidden})`,
  );
}

const startedAt = performance.now();
const materials = createMilitaryEquipmentMaterials({
  anisotropy: 8,
  seed: 0x41a0cafe,
});
const creationMilliseconds = performance.now() - startedAt;
const diagnostics = militaryEquipmentMaterialDiagnostics(materials);

assert.deepEqual(
  Object.keys(materials).sort(),
  [...MILITARY_EQUIPMENT_MATERIAL_ROLES].sort(),
  'the shared library must preserve the complete militaryEquipment Materials contract',
);
assert.equal(diagnostics.materialCount, 11);
assert.equal(diagnostics.pbrMaterialCount, 10);
assert.equal(diagnostics.textureResolution, 128);
assert.equal(MILITARY_EQUIPMENT_TEXTURE_SIZE, 128);
assert.equal(diagnostics.textureCount, 24, 'family response-map sharing should hold the catalog to 24 maps');
assert.equal(diagnostics.textureReferenceCount, 30);
assert.equal(diagnostics.sharedTextureReferences, 6);
assert.equal(
  diagnostics.sourceTextureBytes,
  24 * 128 * 128 * 4,
  'resident source-map bytes must remain explicit and compact',
);
assert.ok(
  diagnostics.estimatedMipmappedTextureBytes < 2.2 * 1024 * 1024,
  'the complete mipmapped weapon surface set should stay under 2.2 MiB',
);
assert.ok(
  creationMilliseconds < 5_000,
  `deterministic map authoring should remain a bounded startup task (got ${creationMilliseconds.toFixed(1)} ms)`,
);

const materialNames = new Set<string>();
const allTextures = collectTextures(materials);
assert.equal(allTextures.size, diagnostics.textureCount);

for (const role of TEXTURED_ROLES) {
  const material = materials[role];
  assert.ok(material instanceof THREE.MeshStandardMaterial, `${role} must use lit PBR`);
  assert.equal(materialNames.has(material.name), false, `${role} must retain a unique batching identity`);
  materialNames.add(material.name);
  assert.equal(material.color.getHex(), 0xffffff, `${role} albedo tint must not be applied twice`);
  assert.ok(material.map instanceof THREE.DataTexture, `${role} requires procedural albedo`);
  assert.ok(material.roughnessMap instanceof THREE.DataTexture, `${role} requires causal roughness`);
  assert.ok(material.normalMap instanceof THREE.DataTexture, `${role} requires height-derived normals`);
  assert.equal(material.normalMapType, THREE.TangentSpaceNormalMap);
  assert.ok(material.normalScale.x > 0 && material.normalScale.x <= 0.75);
  assert.equal(material.normalScale.x, material.normalScale.y);
  assert.ok(material.roughness >= 0.45 && material.roughness <= 1);
  assert.ok(material.metalness >= 0 && material.metalness <= 1);
  assert.ok(material.envMapIntensity >= 0.6 && material.envMapIntensity <= 1.1);

  const family = material.userData.militaryEquipmentSurfaceFamily;
  const causalFields = material.userData.militaryEquipmentCausalFields as string[];
  assert.equal(typeof family, 'string');
  assert.ok(causalFields.length >= 3, `${role} must disclose its shared material causes`);

  validateTexture(material.map, 'albedo', family, causalFields);
  validateTexture(material.roughnessMap, 'roughness', family, causalFields);
  validateTexture(material.normalMap, 'normal', family, causalFields);
  assert.ok(channelRange(material.map, 0) >= 3, `${role} albedo cannot be a flat swatch`);
  assert.ok(channelRange(material.roughnessMap, 1) >= 4, `${role} needs microsurface variation`);
  assert.ok(
    channelRange(material.normalMap, 0) >= 5 || channelRange(material.normalMap, 1) >= 5,
    `${role} needs non-flat tangent normals`,
  );

  const luminance = albedoLuminance(material.map);
  const roughness = channelValues(material.roughnessMap, 1);
  assert.ok(
    Math.abs(correlation(luminance, roughness)) >= 0.035,
    `${role} albedo and roughness must respond measurably to common causes`,
  );
}

assert.ok(materials.cord instanceof THREE.LineBasicMaterial);
assert.equal(materials.cord.name, 'Hemp bow cord');
assert.equal(materials.cord.userData.militaryEquipmentMaterialRole, 'cord');
assert.match(
  String(materials.cord.userData.militaryEquipmentLineCompatibility),
  /LineBasicMaterial/,
  'bow strings must retain the THREE.Line-compatible material contract',
);
assert.equal(materials.feather.side, THREE.DoubleSide);
assert.ok(materials.steel.metalness >= 0.9);
assert.ok(materials.bluedSteel.metalness >= 0.8);
assert.ok(materials.brass.metalness >= 0.85);
for (const role of ['ash', 'walnut', 'bone', 'leather', 'oxblood', 'paintedWood', 'feather'] as const) {
  assert.equal(materials[role].metalness, 0, `${role} must remain dielectric`);
}

assertSharedResponse(materials.ash, materials.walnut, 'wood');
assertSharedResponse(materials.steel, materials.bluedSteel, 'forged steel');
assertSharedResponse(materials.leather, materials.oxblood, 'leather');
assert.notEqual(materials.ash.map, materials.walnut.map);
assert.notEqual(materials.steel.map, materials.bluedSteel.map);
assert.notEqual(materials.leather.map, materials.oxblood.map);

const deterministicTwin = createMilitaryEquipmentMaterials({
  anisotropy: 8,
  seed: 0x41a0cafe,
});
for (const role of TEXTURED_ROLES) {
  for (const channel of ['map', 'roughnessMap', 'normalMap'] as const) {
    assert.equal(
      textureHash(materials[role][channel]),
      textureHash(deterministicTwin[role][channel]),
      `${role} ${channel} bytes must be deterministic for the same seed`,
    );
  }
}

const authoredVariant = createMilitaryEquipmentMaterials({
  anisotropy: 99,
  seed: 0x41a0caff,
  textureScale: 2,
});
assert.notEqual(
  textureHash(materials.ash.map),
  textureHash(authoredVariant.ash.map),
  'the explicit seed control must author a distinct deterministic finish',
);
assert.equal(authoredVariant.ash.map!.anisotropy, 16, 'anisotropy must clamp to a safe ceiling');
assert.equal(authoredVariant.ash.map!.repeat.x, materials.ash.map!.repeat.x * 2);
assert.equal(authoredVariant.ash.map!.repeat.y, materials.ash.map!.repeat.y * 2);

const textureDisposeCounts = new Map<THREE.Texture, number>();
const materialDisposeCounts = new Map<THREE.Material, number>();
for (const texture of allTextures) {
  textureDisposeCounts.set(texture, 0);
  texture.addEventListener('dispose', () => {
    textureDisposeCounts.set(texture, (textureDisposeCounts.get(texture) ?? 0) + 1);
  });
}
for (const role of MILITARY_EQUIPMENT_MATERIAL_ROLES) {
  const material = materials[role];
  materialDisposeCounts.set(material, 0);
  material.addEventListener('dispose', () => {
    materialDisposeCounts.set(material, (materialDisposeCounts.get(material) ?? 0) + 1);
  });
}
disposeMilitaryEquipmentMaterials(materials);
disposeMilitaryEquipmentMaterials(materials);
assert.deepEqual([...textureDisposeCounts.values()], Array(allTextures.size).fill(1));
assert.deepEqual(
  [...materialDisposeCounts.values()],
  Array(MILITARY_EQUIPMENT_MATERIAL_ROLES.length).fill(1),
);
disposeMilitaryEquipmentMaterials(deterministicTwin);
disposeMilitaryEquipmentMaterials(authoredVariant);

console.log(
  `test:military-equipment-materials passed (${diagnostics.pbrMaterialCount} PBR roles, `
    + `${diagnostics.textureCount} shared 128px maps, `
    + `${(diagnostics.estimatedMipmappedTextureBytes / 1024 / 1024).toFixed(2)} MiB with mips, `
    + `${creationMilliseconds.toFixed(1)} ms synthesis)`,
);

function validateTexture(
  texture: THREE.DataTexture,
  channel: 'albedo' | 'roughness' | 'normal',
  family: unknown,
  causalFields: readonly string[],
): void {
  const image = texture.image as { data: unknown; width: number; height: number };
  assert.ok(image.data instanceof Uint8Array);
  assert.equal(image.width, 128);
  assert.equal(image.height, 128);
  assert.equal(image.data.length, 128 * 128 * 4);
  assert.equal(texture.format, THREE.RGBAFormat);
  assert.equal(texture.type, THREE.UnsignedByteType);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(texture.generateMipmaps, true);
  assert.ok(texture.version > 0, `${texture.name} must be queued for GPU upload`);
  assert.equal(texture.flipY, false);
  assert.equal(texture.anisotropy, 8);
  assert.equal(
    texture.colorSpace,
    channel === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  );
  assert.equal(texture.userData.militaryEquipmentTextureChannel, channel);
  assert.equal(texture.userData.militaryEquipmentSurfaceFamily, family);
  assert.deepEqual(texture.userData.militaryEquipmentCausalFields, causalFields);
  assert.equal(
    texture.userData.militaryEquipmentHeightDerived,
    channel === 'normal',
  );
}

function assertSharedResponse(
  first: THREE.MeshStandardMaterial,
  second: THREE.MeshStandardMaterial,
  label: string,
): void {
  assert.equal(first.roughnessMap, second.roughnessMap, `${label} roles should share roughness data`);
  assert.equal(first.normalMap, second.normalMap, `${label} roles should share normal data`);
}

function collectTextures(materials: MilitaryEquipmentMaterials): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  for (const role of TEXTURED_ROLES) {
    for (const texture of [
      materials[role].map,
      materials[role].roughnessMap,
      materials[role].normalMap,
    ]) {
      assert.ok(texture);
      textures.add(texture);
    }
  }
  return textures;
}

function textureBytes(texture: THREE.Texture | null): Uint8Array {
  assert.ok(texture instanceof THREE.DataTexture);
  const image = texture.image as { data: unknown };
  assert.ok(image.data instanceof Uint8Array);
  return image.data;
}

function textureHash(texture: THREE.Texture | null): string {
  return createHash('sha256').update(textureBytes(texture)).digest('hex');
}

function channelValues(texture: THREE.DataTexture, channel: 0 | 1 | 2): number[] {
  const data = textureBytes(texture);
  const values: number[] = [];
  for (let offset = channel; offset < data.length; offset += 4) values.push(data[offset]!);
  return values;
}

function channelRange(texture: THREE.DataTexture, channel: 0 | 1 | 2): number {
  const values = channelValues(texture, channel);
  return Math.max(...values) - Math.min(...values);
}

function albedoLuminance(texture: THREE.DataTexture): number[] {
  const data = textureBytes(texture);
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 4) {
    values.push(
      data[offset]! * 0.2126
        + data[offset + 1]! * 0.7152
        + data[offset + 2]! * 0.0722,
    );
  }
  return values;
}

function correlation(left: readonly number[], right: readonly number[]): number {
  assert.equal(left.length, right.length);
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}
