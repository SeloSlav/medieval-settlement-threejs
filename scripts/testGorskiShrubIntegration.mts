import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { generateDichotomous } from '../vendor/seedthree/src/core/dichotomous.js';
import { Rng } from '../vendor/seedthree/src/core/rng.js';
import { bilberry } from '../vendor/seedthree/src/species/bilberry.js';
import { commonHornbeamHedge } from '../vendor/seedthree/src/species/common-hornbeam-hedge.js';
import { commonJuniper } from '../vendor/seedthree/src/species/common-juniper.js';
import { raspberry } from '../vendor/seedthree/src/species/raspberry.js';
import { stingingNettle } from '../src/vegetation/seedthree/stingingNettlePreset.ts';
import { createCommonDogwoodVariantPreset } from '../src/vegetation/seedthree/commonDogwoodPreset.ts';
import {
  GORSKI_SHRUB_TERMINAL_TAPER_START,
  GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE,
  GORSKI_SHRUB_VARIANT_COUNT,
  RASPBERRY_FRUIT_ANCHOR_LIMIT,
  createGorskiShrubPrototype,
  type GorskiShrubKind,
} from '../src/vegetation/seedthree/gorskiShrubPrototypes.ts';
import { MAX_RASPBERRIES_PER_CLUMP } from '../src/foraging/berryPatchPresentation.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT = 8;
const undergrowthRuntimeAttributes = ['aAnchorPos', 'aWindVec'] as const;
const kinds: GorskiShrubKind[] = [
  'bush',
  'fern',
  'juniper',
  'raspberry',
  'field-hornbeam',
  'nettle',
];
const limits: Record<GorskiShrubKind, {
  triangles: [number, number];
  width: [number, number];
  height: [number, number];
}> = {
  bush: { triangles: [3_000, 6_500], width: [0.8, 1.2], height: [0.5, 0.8] },
  fern: { triangles: [120, 180], width: [0.8, 1.35], height: [0.5, 0.9] },
  juniper: { triangles: [6_000, 12_000], width: [1.7, 2.5], height: [1.2, 1.8] },
  raspberry: { triangles: [4_500, 7_500], width: [1.2, 1.7], height: [0.85, 1.2] },
  'field-hornbeam': { triangles: [4_500, 5_200], width: [1.1, 1.5], height: [0.8, 0.95] },
  nettle: { triangles: [120, 140], width: [0.28, 0.5], height: [0.7, 0.84] },
};

assert.equal(stingingNettle.category, 'shrub');
assert.equal(stingingNettle.foliageType, 'singleLeaves');
assert.equal(
  stingingNettle.foliage.mode,
  'leaves',
  'stinging nettles must use SeedThree leaf mode rather than baked spray clusters',
);
assert.equal(
  stingingNettle.foliage.whorlSize,
  2,
  'young nettles must grow leaves as opposite pairs',
);
assert.equal(stingingNettle.foliage.rotate, 90, 'successive nettle leaf pairs must be decussate');
assert.equal(stingingNettle.bark, 'stinging_nettle_stem_albedo.png');
assert.equal(stingingNettle.leaf, 'stinging_nettle_single_albedo.png');

assertTerminalStemTaper(
  'stinging nettle',
  stingingNettle,
  `gorski:${stingingNettle.name}:0`,
);
const dogwoodTaperPreset = createCommonDogwoodVariantPreset(0);
assertTerminalStemTaper(
  'common dogwood',
  dogwoodTaperPreset.preset,
  dogwoodTaperPreset.seed,
);

const startedAt = performance.now();
const firstPass = prototypeSignatures();
const secondPass = prototypeSignatures();
const generationMs = performance.now() - startedAt;
assert.deepEqual(
  secondPass,
  firstPass,
  'the same species/variant seeds must reproduce identical shrub geometry',
);
assert.ok(
  generationMs < 5_000,
  `two complete 15-prototype seed sweeps should stay below the startup safety budget (took ${generationMs.toFixed(1)} ms)`,
);

assertGlb('apple.glb', 1_000_000);
assertGlb('cherry_pair.glb', 1_000_000);
assertGlb('raspberry_cluster.glb', 50_000);

const bilberryAlbedo = readFileSync(
  `${projectRoot}vendor/seedthree/assets/leaves/bilberry_albedo.png`,
);
assert.deepEqual(
  [...bilberryAlbedo.subarray(0, 8)],
  [137, 80, 78, 71, 13, 10, 26, 10],
  'the fruit-free bilberry spray must remain a PNG',
);
assert.equal(
  bilberryAlbedo[25],
  6,
  'the fruit-free bilberry spray must retain an RGBA alpha channel',
);
assert.notEqual(
  createHash('sha256').update(bilberryAlbedo).digest('hex'),
  '3a991937b1a259832edddf08eeade1bd85da3031e551f71c5bba974403a7dd8f',
  'the retired bilberry card with baked-in fruit must not be restored',
);

const juniperAlbedo = readFileSync(
  `${projectRoot}vendor/seedthree/assets/leaves/juniper_scrub_albedo.png`,
);
assert.deepEqual(
  [...juniperAlbedo.subarray(0, 8)],
  [137, 80, 78, 71, 13, 10, 26, 10],
  'the foliage-only juniper spray must remain a PNG',
);
assert.equal(
  juniperAlbedo[25],
  6,
  'the foliage-only juniper spray must retain an RGBA alpha channel',
);

const raspberrySpray = readFileSync(
  `${projectRoot}vendor/seedthree/assets/leaves/raspberry_spray_albedo.png`,
);
assert.deepEqual(
  [...raspberrySpray.subarray(0, 8)],
  [137, 80, 78, 71, 13, 10, 26, 10],
  'the generated raspberry leaf spray must remain a PNG',
);
assert.equal(
  raspberrySpray[25],
  6,
  'the raspberry spray must retain an RGBA alpha channel for cutout foliage',
);

const shrubTextureContracts = [
  { name: 'bilberry', preset: bilberry, foliageBase: 'bilberry' },
  { name: 'common juniper', preset: commonJuniper, foliageBase: 'juniper_scrub' },
  { name: 'raspberry', preset: raspberry, foliageBase: 'raspberry_spray' },
  { name: 'field hornbeam', preset: commonHornbeamHedge, foliageBase: 'hornbeam_hedge_spray' },
  { name: 'stinging nettle', preset: stingingNettle, foliageBase: 'stinging_nettle_single' },
] as const;
const localNettleAssetDir = `${projectRoot}src/assets/vegetation/stinging-nettle`;
const albedoOwners = new Map<string, string>();
for (const contract of shrubTextureContracts) {
  const barkBase = String(contract.preset.bark).replace(/_albedo\.png$/, '');
  const assetDir = contract.name === 'stinging nettle' ? localNettleAssetDir : undefined;
  assertTextureSet(
    contract.name,
    'bark',
    barkBase,
    ['albedo', 'normal', 'roughness'],
    assetDir,
  );
  assertTextureSet(
    contract.name,
    'leaves',
    contract.foliageBase,
    ['albedo', 'normal', 'roughness', 'translucency'],
    assetDir,
  );
}
assertTextureSet('fern', 'leaves', 'fern', ['albedo', 'normal', 'roughness', 'translucency']);
assert.equal(
  existsSync(`${projectRoot}vendor/seedthree/assets/bark/fern_branch_albedo.png`),
  false,
  'fern must keep its rachis in its own foliage card instead of borrowing woody bark',
);

const berryVisuals = readFileSync(`${projectRoot}src/foraging/BerryPatchVisuals.ts`, 'utf8');
assert.match(berryVisuals, /createGorskiShrubPrototype\('raspberry'/);
assert.match(berryVisuals, /raspberry_cluster\.glb/);
assert.match(berryVisuals, /Depleting real raspberry fruit instances/);
assert.match(berryVisuals, /fruitMesh\.count = visibleFruitCount/);
assert.match(berryVisuals, /targetDiameterM = \[0\.017, 0\.022\]/);
assert.match(berryVisuals, /RASPBERRY_CANE_HEIGHT_MULTIPLIER/);
assert.match(berryVisuals, /berryThicketRadiusScale/);
assert.doesNotMatch(berryVisuals, /bakeRaspberryFruitIntoPrototype/);
assert.doesNotMatch(berryVisuals, /raspberry_patch_albedo\.png|createSeedThreeCardClumpGeometry/);

const undergrowthVisuals = readFileSync(`${projectRoot}src/props/ForestUndergrowth.ts`, 'utf8');
const shrubPrototypesSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/gorskiShrubPrototypes.ts`,
  'utf8',
);
assert.match(
  shrubPrototypesSource,
  /terminalTaperStart:\s*GORSKI_SHRUB_TERMINAL_TAPER_START[\s\S]*terminalTipRadiusScale:\s*GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE/,
  'production shrub generation must opt into the tested terminal growing-point taper',
);
const seedThreeTexturesSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeTextures.ts`,
  'utf8',
);
assert.match(
  shrubPrototypesSource,
  /from '\.\/stingingNettlePreset\.ts'/,
  'the project must own the nettle preset instead of depending on a dirty vendor submodule',
);
assert.doesNotMatch(shrubPrototypesSource, /@seedthree\/species\/stinging-nettle/);
assert.match(
  seedThreeTexturesSource,
  /\.\.\/\.\.\/assets\/vegetation\/stinging-nettle\/stinging_nettle_/,
  'the production texture graph must bundle the project-owned nettle PBR maps',
);
assert.doesNotMatch(
  seedThreeTexturesSource,
  /vendor\/seedthree\/assets\/(?:bark|leaves)\/[^'\n]*stinging_nettle/,
  'the production nettle texture graph must not depend on hidden vendor worktree files',
);
assert.match(undergrowthVisuals, /GORSKI_SHRUB_VARIANT_COUNT/);
assert.match(undergrowthVisuals, /new THREE\.InstancedMesh/);
assert.doesNotMatch(
  undergrowthVisuals,
  /aTint/,
  'forest undergrowth must use InstancedMesh.instanceColor instead of a duplicate tint buffer',
);
assert.match(
  undergrowthVisuals,
  /SeedThree curved fern fronds[\s\S]*?albedoTint: \[0\.58, 0\.66, 0\.52\][\s\S]*?transmissionAmbient: 0[\s\S]*?transmissionAlbedoWeight: 1[\s\S]*?transmissionScale: 0\.9/,
  'fern fronds must keep their albedo grounded and their translucency tied to leaf detail',
);
assert.match(
  undergrowthVisuals,
  /material\.colorNode = options\.albedoTint === undefined[\s\S]*?\? texel[\s\S]*?: tsl\.vec4\(texel\.rgb\.mul\(albedoTintNode\), texel\.a\)/,
  'the WebGPU card material must apply its species tint without losing cutout alpha',
);
assert.doesNotMatch(
  `${undergrowthVisuals}\n${shrubPrototypesSource}\n${seedThreeTexturesSource}`,
  /bilberry_berry\.glb|juniper_berry\.glb|selectFoliageSurfaceAnchors|createUndergrowthFruitInstances/,
  'ordinary bilberry and juniper shrubs must not load, anchor, or render berry GLBs',
);
assert.doesNotMatch(undergrowthVisuals, /createCardClumpGeometry/);
assert.doesNotMatch(
  `${undergrowthVisuals}\n${berryVisuals}`,
  /creosote_branch_|sagebrush_branch_|blackbrush_branch_|american_beech_(?:single_)?/,
  'Gorski shrubs must not reuse unrelated desert-shrub or beech texture sets',
);

console.log(
  `Gorski shrub integration tests passed (${generationMs.toFixed(1)} ms deterministic seed sweep)`,
);

function assertTerminalStemTaper(
  name: string,
  preset: {
    readonly params: Record<string, unknown>;
    readonly foliage: { readonly clusterSize?: number };
  },
  seed: string,
): void {
  const generated = generateDichotomous(
    {
      ...preset.params,
      terminalTaperStart: GORSKI_SHRUB_TERMINAL_TAPER_START,
      terminalTipRadiusScale: GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE,
      tipClearance: (preset.foliage.clusterSize ?? 0.3) * 0.9,
    },
    new Rng(seed),
  );
  assert.ok(generated.terminalStems.length > 0, `${name} needs terminal leafy shoots`);
  for (const [stemIndex, stem] of generated.terminalStems.entries()) {
    const radii = stem.radii as number[];
    assert.ok(radii.length >= 4, `${name} terminal ${stemIndex} needs a resolved taper profile`);
    const finalRadiusRatio = radii.at(-1)! / radii[0]!;
    assert.ok(
      finalRadiusRatio <= GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE + 0.001,
      `${name} terminal ${stemIndex} ends at ${(finalRadiusRatio * 100).toFixed(1)}% of its base radius`,
    );
    assert.ok(
      radii.at(-2)! > radii.at(-1)! * 2,
      `${name} terminal ${stemIndex} must narrow progressively into its growing point`,
    );
  }
}

function prototypeSignatures(): Record<string, string> {
  const signatures: Record<string, string> = {};
  for (const kind of kinds) {
    for (let variant = 0; variant < GORSKI_SHRUB_VARIANT_COUNT; variant++) {
      const prototype = createGorskiShrubPrototype(kind, variant);
      const geometry = prototype.geometry;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      const width = Math.max(size.x, size.z);
      const limitsForKind = limits[kind];
      assert.ok(
        prototype.triangleCount >= limitsForKind.triangles[0]
          && prototype.triangleCount <= limitsForKind.triangles[1],
        `${kind} variant ${variant} has ${prototype.triangleCount} triangles outside its authored budget`,
      );
      assert.ok(
        width >= limitsForKind.width[0] && width <= limitsForKind.width[1],
        `${kind} variant ${variant} width ${width.toFixed(2)} m is outside its botanical envelope`,
      );
      assert.ok(
        size.y >= limitsForKind.height[0] && size.y <= limitsForKind.height[1],
        `${kind} variant ${variant} height ${size.y.toFixed(2)} m is outside its botanical envelope`,
      );
      if (kind === 'fern') {
        assert.equal(
          geometry.groups.length,
          1,
          `fern variant ${variant} must render as a single frond-card group without duplicate stem geometry`,
        );
        assert.equal(geometry.groups[0]?.materialIndex, 0);
        assert.equal(
          geometry.userData.fernRachisStrategy,
          'foliage-card-owned',
          `fern variant ${variant} must keep its green rachis inside the alpha-cutout frond silhouette`,
        );
      } else {
        assert.equal(
          geometry.groups.length,
          2,
          `${kind} variant ${variant} must retain separate wood/stem and foliage material groups`,
        );
      }
      if (kind === 'nettle') {
        assert.equal(
          geometry.userData.seedThreeGenerator,
          'dichotomous/opposite-paired-leaves',
          `nettle variant ${variant} must retain the opposite-pair SeedThree prototype contract`,
        );
      }
      assert.ok(
        geometry.getAttribute('aRootWeight'),
        `${kind} variant ${variant} must carry rooted wind weights`,
      );
      if (kind === 'bush') {
        for (const attributeName of undergrowthRuntimeAttributes) {
          geometry.setAttribute(
            attributeName,
            new THREE.InstancedBufferAttribute(new Float32Array(3), 3),
          );
        }
        const mesh = new THREE.InstancedMesh(
          geometry,
          new THREE.MeshBasicMaterial(),
          1,
        );
        mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        const vertexBuffers = new Set<THREE.BufferAttribute | THREE.InterleavedBuffer>([
          ...Object.values(geometry.attributes).map((attribute) => (
            attribute instanceof THREE.InterleavedBufferAttribute
              ? attribute.data
              : attribute
          )),
          mesh.instanceMatrix,
          mesh.instanceColor!,
        ]);
        assert.ok(
          vertexBuffers.size <= PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT,
          `bilberry variant ${variant} requires ${vertexBuffers.size} vertex buffers; portable WebGPU permits ${PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT}`,
        );
        (mesh.material as THREE.Material).dispose();
      }
      if (kind === 'raspberry') {
        assert.ok(
          prototype.fruitAnchors.length >= MAX_RASPBERRIES_PER_CLUMP,
          `raspberry variant ${variant} must expose all ${MAX_RASPBERRIES_PER_CLUMP} visible fruit anchors`,
        );
        assert.ok(
          prototype.fruitAnchors.length <= RASPBERRY_FRUIT_ANCHOR_LIMIT,
          `raspberry variant ${variant} exceeded its authored fruit-anchor budget`,
        );
      } else {
        assert.equal(
          prototype.fruitAnchors.length,
          0,
          `${kind} variant ${variant} must not allocate unused fruit anchors`,
        );
      }
      signatures[`${kind}:${variant}`] = [
        geometryHash(geometry),
        prototype.fruitAnchors
          .map((anchor) => anchor.toArray().map((value) => value.toFixed(6)).join(','))
          .join(';'),
      ].join(':');
      geometry.dispose();
    }
  }
  return signatures;
}

function assertTextureSet(
  owner: string,
  folder: 'bark' | 'leaves',
  base: string,
  maps: ReadonlyArray<'albedo' | 'normal' | 'roughness' | 'translucency'>,
  assetDir?: string,
): void {
  for (const map of maps) {
    const path = assetDir
      ? `${assetDir}/${base}_${map}.png`
      : `${projectRoot}vendor/seedthree/assets/${folder}/${base}_${map}.png`;
    assert.ok(existsSync(path), `${owner} must provide its own ${map} texture (${base}_${map}.png)`);
    if (map !== 'albedo') continue;
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    const existingOwner = albedoOwners.get(hash);
    assert.equal(
      existingOwner,
      undefined,
      `${owner} must not reuse ${existingOwner ?? 'another species'}'s ${folder} albedo bytes`,
    );
    albedoOwners.set(hash, `${owner} ${folder}`);
  }
}

function geometryHash(geometry: THREE.BufferGeometry): string {
  const hash = createHash('sha256');
  for (const name of ['position', 'normal', 'uv', 'aRootWeight']) {
    const attribute = geometry.getAttribute(name);
    assert.ok(attribute, `prototype geometry is missing ${name}`);
    updateHash(hash, attribute.array);
  }
  if (geometry.index) updateHash(hash, geometry.index.array);
  return hash.digest('hex');
}

function updateHash(
  hash: ReturnType<typeof createHash>,
  array: THREE.TypedArray,
): void {
  hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

function assertGlb(fileName: string, minimumBytes: number): void {
  const bytes = readFileSync(`${projectRoot}vendor/seedthree/assets/fruits/${fileName}`);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'glTF', `${fileName} must be a binary glTF`);
  assert.equal(bytes.readUInt32LE(4), 2, `${fileName} must use glTF 2.0`);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength, `${fileName} must have a valid GLB length header`);
  assert.ok(bytes.byteLength >= minimumBytes, `${fileName} appears truncated`);
}
