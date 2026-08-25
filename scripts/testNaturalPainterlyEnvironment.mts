import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { float, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED } from '../src/scene/naiveArtPostEffect.ts';

const root = process.cwd();
const preferenceStorageKey = 'medieval-road-system.naturalPainterlyEnvironmentEnabled';

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function freshModuleUrl(relativePath: string, testCase: string): string {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('test', testCase);
  return url.href;
}

function createStorage(values = new Map<string, string>()): Storage {
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

async function testPreferenceContract(): Promise<void> {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storedValues = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(storedValues),
    });

    const preference = await import(freshModuleUrl(
      '../src/scene/naturalPainterlyPreference.ts',
      'default-on-and-listeners',
    ));
    assert.equal(
      preference.isNaturalPainterlyEnvironmentEnabled(),
      true,
      'the natural painterly treatment must be on when no preference has been stored',
    );

    const notifications: boolean[] = [];
    const unsubscribe = preference.subscribeNaturalPainterlyEnvironmentPreference(
      (enabled: boolean) => notifications.push(enabled),
    );
    preference.setNaturalPainterlyEnvironmentEnabled(true);
    assert.deepEqual(notifications, [], 'setting the existing value must not notify listeners');
    preference.setNaturalPainterlyEnvironmentEnabled(false);
    assert.equal(preference.isNaturalPainterlyEnvironmentEnabled(), false);
    assert.equal(
      storedValues.get(preferenceStorageKey),
      '0',
      'the opt-out preference must persist only the disabled state',
    );
    assert.deepEqual(notifications, [false]);
    preference.setNaturalPainterlyEnvironmentEnabled(false);
    assert.deepEqual(notifications, [false], 'repeated disabled writes must be silent');
    preference.setNaturalPainterlyEnvironmentEnabled(true);
    assert.equal(storedValues.has(preferenceStorageKey), false);
    assert.deepEqual(notifications, [false, true]);
    unsubscribe();
    preference.setNaturalPainterlyEnvironmentEnabled(false);
    assert.deepEqual(notifications, [false, true], 'unsubscribed listeners must stay detached');

    const persistedPreference = await import(freshModuleUrl(
      '../src/scene/naturalPainterlyPreference.ts',
      'persisted-opt-out',
    ));
    assert.equal(
      persistedPreference.isNaturalPainterlyEnvironmentEnabled(),
      false,
      'a fresh session must honor the persisted opt-out',
    );

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        ...createStorage(),
        getItem: () => {
          throw new Error('storage blocked');
        },
        removeItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
      } satisfies Storage,
    });
    const blockedPreference = await import(freshModuleUrl(
      '../src/scene/naturalPainterlyPreference.ts',
      'blocked-storage',
    ));
    assert.equal(
      blockedPreference.isNaturalPainterlyEnvironmentEnabled(),
      true,
      'unavailable browser storage must retain the default-on treatment',
    );
    const blockedNotifications: boolean[] = [];
    blockedPreference.subscribeNaturalPainterlyEnvironmentPreference(
      (enabled: boolean) => blockedNotifications.push(enabled),
    );
    blockedPreference.setNaturalPainterlyEnvironmentEnabled(false);
    assert.equal(blockedPreference.isNaturalPainterlyEnvironmentEnabled(), false);
    assert.deepEqual(
      blockedNotifications,
      [false],
      'the live in-memory toggle must still work when persistence is blocked',
    );
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    } else {
      delete (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    }
  }
}

function packedTextureBytes(texture: THREE.DataTexture): Uint8Array {
  const image = texture.image as {
    data?: ArrayBufferView;
    width?: number;
    height?: number;
  };
  assert.ok(image.data, 'the packed brush texture must expose deterministic CPU-side texels');
  return new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  );
}

function assertPackedTexture(texture: THREE.DataTexture): void {
  const image = texture.image as {
    data?: ArrayBufferView;
    width?: number;
    height?: number;
  };
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const bytes = packedTextureBytes(texture);
  assert.ok(width >= 32 && height >= 32, 'brush fields need enough resolution to avoid block noise');
  assert.equal(width, height, 'the packed brush field must remain square and tile consistently');
  assert.equal(bytes.length, width * height * 4, 'packed brush data must remain RGBA');
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  assert.equal(texture.generateMipmaps, true);
  assert.equal(texture.colorSpace, THREE.NoColorSpace, 'packed data channels must not be color transformed');
  assert.deepEqual(texture.userData.naturalPainterly, {
    seed: 0x5041494e,
    signature: 'natural-paint-strokes-rg-normal-b-broad-a-detail-v1',
    channels: {
      rg: 'randomized paint-stroke normal XY',
      b: 'broad diffuse and parallax-height stroke',
      a: 'fine high-contrast dry-brush stroke',
    },
  });

  for (let channel = 0; channel < 4; channel += 1) {
    let minimum = 255;
    let maximum = 0;
    for (let offset = channel; offset < bytes.length; offset += 4) {
      const value = bytes[offset]!;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    assert.ok(
      maximum - minimum >= 24,
      `packed brush channel ${channel} must contain a meaningful deterministic field`,
    );
  }
}

async function testMaterialContract(): Promise<void> {
  const painterly = await import('../src/scene/naturalPainterlyMaterial.ts');
  const expectedDebugModes = {
    Final: 0,
    Original: 1,
    BroadStroke: 2,
    DetailStroke: 3,
    BrushNormal: 4,
    ToonBands: 5,
    OilReflection: 6,
    RimErosion: 7,
    ScopeMask: 8,
  } as const;
  for (const [name, value] of Object.entries(expectedDebugModes)) {
    assert.equal(
      painterly.NaturalPainterlyDebugMode[name as keyof typeof expectedDebugModes],
      value,
      `debug mode ${name} must keep its stable diagnostic ordinal`,
    );
  }
  assert.ok(Number.isSafeInteger(painterly.NATURAL_PAINTERLY_TEXTURE_SEED));
  assert.match(
    painterly.NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
    /\S/,
    'the generated packed texture must publish a non-empty deterministic signature',
  );

  painterly.setNaturalPainterlyMaterialEnabled(true);
  painterly.setNaturalPainterlyDebugMode(painterly.NaturalPainterlyDebugMode.Final);
  const initialState = painterly.getNaturalPainterlyMaterialState();
  const initialEnabledUniform = initialState.enabledUniform;
  const initialDebugUniform = initialState.debugModeUniform;
  assert.equal(initialEnabledUniform.value, 1);
  assert.equal(initialDebugUniform.value, painterly.NaturalPainterlyDebugMode.Final);
  assertPackedTexture(initialState.packedTexture);

  const material = new MeshStandardNodeMaterial();
  const originalColorNode = vec3(0.18, 0.42, 0.09);
  const originalNormalNode = vec3(0, 0, 1);
  const originalRoughnessNode = float(0.81);
  material.colorNode = originalColorNode;
  material.normalNode = originalNormalNode;
  material.roughnessNode = originalRoughnessNode;
  const materialUuid = material.uuid;
  const countBeforeDecoration = initialState.decoratedMaterialCount;
  assert.strictEqual(
    painterly.applyNaturalPainterlyMaterial(material, { role: 'grass' }),
    material,
    'decoration must return the original material object',
  );
  assert.equal(material.uuid, materialUuid, 'decoration must retain the original material object');
  const metadata = material.userData.naturalPainterly as {
    version?: number;
    role?: string;
    signature?: string;
    textureSignature?: string;
  };
  assert.ok(metadata && (metadata.version ?? 0) >= 1);
  assert.equal(metadata.role, 'grass');
  assert.equal(
    metadata.signature ?? metadata.textureSignature,
    painterly.NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
  );
  assert.doesNotThrow(
    () => JSON.stringify(material.userData),
    'painterly userData must remain serializable for Three Material.clone()',
  );
  assert.notStrictEqual(material.colorNode, originalColorNode);
  assert.notStrictEqual(
    material.normalNode,
    originalNormalNode,
    'the painterly decorator must layer its brush normal over the authored PBR normal graph',
  );
  assert.notStrictEqual(
    material.roughnessNode,
    originalRoughnessNode,
    'the painterly decorator must layer the oil/dry-brush response over authored roughness',
  );
  const clonedMaterial = material.clone();
  assert.deepEqual(
    clonedMaterial.userData.naturalPainterly,
    material.userData.naturalPainterly,
    'Three Material.clone() must safely retain painterly metadata',
  );
  assert.equal(
    painterly.getNaturalPainterlyMaterialState().decoratedMaterialCount,
    countBeforeDecoration + 1,
  );

  const decoratedColorNode = material.colorNode;
  const decoratedNormalNode = material.normalNode;
  const decoratedRoughnessNode = material.roughnessNode;
  assert.strictEqual(painterly.applyNaturalPainterlyMaterial(material, { role: 'grass' }), material);
  assert.strictEqual(material.colorNode, decoratedColorNode, 'decoration must be idempotent');
  assert.strictEqual(material.normalNode, decoratedNormalNode, 'normal decoration must be idempotent');
  assert.strictEqual(
    material.roughnessNode,
    decoratedRoughnessNode,
    'roughness decoration must be idempotent',
  );
  assert.equal(
    painterly.getNaturalPainterlyMaterialState().decoratedMaterialCount,
    countBeforeDecoration + 1,
    'reapplying the decorator must not double-register a material',
  );

  const coverageMaterial = new MeshStandardNodeMaterial();
  const coverageNode = float(0.375);
  assert.strictEqual(
    painterly.applyNaturalPainterlyMaterial(coverageMaterial, {
      role: 'road',
      coverageNode,
    }),
    coverageMaterial,
    'semantic coverage must decorate in place',
  );
  assert.doesNotThrow(() => JSON.stringify(coverageMaterial.userData));

  const stableState = painterly.getNaturalPainterlyMaterialState();
  assert.strictEqual(stableState.enabledUniform, initialEnabledUniform);
  assert.strictEqual(stableState.debugModeUniform, initialDebugUniform);
  painterly.setNaturalPainterlyMaterialEnabled(false);
  assert.equal(painterly.getNaturalPainterlyMaterialEnabled(), false);
  assert.equal(initialEnabledUniform.value, 0);
  assert.equal(material.uuid, materialUuid);
  assert.strictEqual(material.colorNode, decoratedColorNode);
  assert.equal(
    painterly.getNaturalPainterlyMaterialState().decoratedMaterialCount,
    countBeforeDecoration + 2,
    'a live feature toggle must not replace or re-register materials',
  );
  painterly.setNaturalPainterlyMaterialEnabled(true);
  assert.equal(painterly.getNaturalPainterlyMaterialEnabled(), true);
  assert.equal(initialEnabledUniform.value, 1);
  assert.strictEqual(material.colorNode, decoratedColorNode);

  for (const value of Object.values(expectedDebugModes)) {
    painterly.setNaturalPainterlyDebugMode(value);
    assert.equal(painterly.getNaturalPainterlyDebugMode(), value);
    assert.equal(initialDebugUniform.value, value);
  }
  painterly.setNaturalPainterlyDebugMode(painterly.NaturalPainterlyDebugMode.Final);

  const duplicateUrl = new URL('../src/scene/naturalPainterlyMaterial.ts', import.meta.url);
  duplicateUrl.searchParams.set('test', 'deterministic-packed-texture');
  const duplicate = await import(duplicateUrl.href);
  const duplicateState = duplicate.getNaturalPainterlyMaterialState();
  assert.equal(
    duplicate.NATURAL_PAINTERLY_TEXTURE_SEED,
    painterly.NATURAL_PAINTERLY_TEXTURE_SEED,
  );
  assert.equal(
    duplicate.NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
    painterly.NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
  );
  assert.deepEqual(
    packedTextureBytes(duplicateState.packedTexture),
    packedTextureBytes(initialState.packedTexture),
    'the seed must reproduce byte-identical packed brush fields in a fresh module instance',
  );

  material.dispose();
  clonedMaterial.dispose();
  coverageMaterial.dispose();
}

function countRole(source: string, role: string): number {
  return (source.match(new RegExp(`role\\s*:\\s*['\"]${role}['\"]`, 'g')) ?? []).length;
}

function testSourceIntegrationContract(): void {
  const integrations = [
    ['src/terrain/TerrainGrassMaterial.ts', { terrain: 2 }],
    ['src/roads/RoadSurfaceMaterial.ts', { road: 3, soil: 1 }],
    ['src/vegetation/seedthree/seedThreeGrass.ts', { grass: 1 }],
    ['src/vegetation/seedthree/seedThreeWildflowers.ts', { foliage: 1 }],
    ['src/vegetation/seedthree/seedThreeForestBuilder.ts', { bark: 1, foliage: 1 }],
    ['src/props/ForestUndergrowth.ts', { undergrowth: 2 }],
    ['src/props/ForestFloorNettles.ts', { undergrowth: 2 }],
    ['src/props/ForestFloorIvy.ts', { undergrowth: 1 }],
  ] as const;

  for (const [relativePath, roles] of integrations) {
    const source = read(relativePath);
    assert.match(
      source,
      /naturalPainterlyMaterial\.ts/,
      `${relativePath} must import the shared natural painterly decorator`,
    );
    for (const [role, minimumCount] of Object.entries(roles)) {
      assert.ok(
        countRole(source, role) >= minimumCount,
        `${relativePath} must apply role ${role} at least ${minimumCount} time(s)`,
      );
    }
  }

  const roadSource = read('src/roads/RoadSurfaceMaterial.ts');
  assert.match(
    roadSource,
    /coverageNode:\s*sub\(float\(1\)[\s\S]*?bridgeBlend/,
    'the dirt-road treatment must exclude the bridge deck through semantic coverage',
  );

  const gameMenuSource = read('src/ui/GameMenu.ts');
  assert.match(
    gameMenuSource,
    /data-natural-painterly-checkbox[\s\S]*?Painterly natural environment/,
    'the Esc Visuals menu must expose the exact painterly setting label',
  );
  assert.ok(
    (gameMenuSource.match(/naturalPainterlyCheckbox\.checked\s*=\s*isNaturalPainterlyEnvironmentEnabled\(\)/g) ?? []).length >= 2,
    'the painterly checkbox must sync both at construction and whenever the menu opens',
  );
  assert.match(
    gameMenuSource,
    /naturalPainterlyCheckbox\.addEventListener\('change'[\s\S]*?setNaturalPainterlyEnvironmentEnabled\(this\.naturalPainterlyCheckbox\.checked\)/,
    'the Esc checkbox must write the live preference',
  );

  const sceneManagerSource = read('src/scene/SceneManager.ts');
  assert.match(
    sceneManagerSource,
    /setNaturalPainterlyMaterialEnabled\(isNaturalPainterlyEnvironmentEnabled\(\)\)/,
    'SceneManager must apply the persisted preference before rendering',
  );
  assert.match(
    sceneManagerSource,
    /subscribeNaturalPainterlyEnvironmentPreference\(\(enabled\)\s*=>\s*\{\s*setNaturalPainterlyMaterialEnabled\(enabled\)/,
    'SceneManager must forward preference changes to the shared live uniform',
  );
  assert.match(
    sceneManagerSource,
    /unsubscribeNaturalPainterlyPreference\?\.\(\)/,
    'SceneManager must detach the preference listener during disposal',
  );

  assert.equal(
    CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
    false,
    'the old fullscreen naïve-art pass must stay disabled so excluded subjects remain untouched',
  );
  assert.doesNotMatch(
    read('src/scene/PostProcessing.ts'),
    /naturalPainterlyMaterial|applyNaturalPainterlyMaterial/,
    'the scoped natural treatment must not migrate into fullscreen post-processing',
  );
  assert.doesNotMatch(
    read('src/scene/naturalPainterlyMaterial.ts'),
    /from\s+['\"][^'\"]*(?:buildings|settlement|sky)[\\/]/,
    'the central material module must not depend on building, character, or sky implementations',
  );

  const excludedPaths = [
    ...typescriptFilesBelow('src/buildings'),
    ...typescriptFilesBelow('src/settlement'),
    ...typescriptFilesBelow('src/sky'),
    'src/logistics/DeliveryAgentRenderer.ts',
  ];
  for (const relativePath of excludedPaths) {
    assert.doesNotMatch(
      read(relativePath),
      /naturalPainterlyMaterial|applyNaturalPainterlyMaterial/,
      `${relativePath} is outside the current natural-environment scope`,
    );
  }
}

function typescriptFilesBelow(relativeDirectory: string): string[] {
  const absoluteDirectory = join(root, relativeDirectory);
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory)) {
    const relativePath = join(relativeDirectory, entry);
    const absolutePath = join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...typescriptFilesBelow(relativePath));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(relativePath);
    }
  }
  return files;
}

await testPreferenceContract();
await testMaterialContract();
testSourceIntegrationContract();

console.log('Natural painterly environment preference, material, scope, and integration contracts passed.');
