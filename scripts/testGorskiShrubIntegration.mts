import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  GORSKI_SHRUB_VARIANT_COUNT,
  JUNIPER_BERRY_ANCHOR_LIMIT,
  RASPBERRY_FRUIT_ANCHOR_LIMIT,
  createGorskiShrubPrototype,
  type GorskiShrubKind,
} from '../src/vegetation/seedthree/gorskiShrubPrototypes.ts';
import { MAX_RASPBERRIES_PER_CLUMP } from '../src/foraging/berryPatchPresentation.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const kinds: GorskiShrubKind[] = ['bush', 'fern', 'juniper', 'raspberry'];
const limits: Record<GorskiShrubKind, {
  triangles: [number, number];
  width: [number, number];
  height: [number, number];
}> = {
  bush: { triangles: [3_000, 6_500], width: [0.8, 1.2], height: [0.5, 0.8] },
  fern: { triangles: [120, 180], width: [0.8, 1.35], height: [0.5, 0.9] },
  juniper: { triangles: [6_000, 12_000], width: [1.7, 2.5], height: [1.2, 1.8] },
  raspberry: { triangles: [4_500, 7_500], width: [1.2, 1.7], height: [0.85, 1.2] },
};

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
  `two complete 12-prototype seed sweeps should stay below the startup safety budget (took ${generationMs.toFixed(1)} ms)`,
);

assertGlb('apple.glb', 1_000_000);
assertGlb('cherry_pair.glb', 1_000_000);
assertGlb('juniper_berry.glb', 30_000);
assertGlb('raspberry_cluster.glb', 50_000);

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
assert.match(undergrowthVisuals, /GORSKI_SHRUB_VARIANT_COUNT/);
assert.match(undergrowthVisuals, /new THREE\.InstancedMesh/);
assert.match(undergrowthVisuals, /juniper_berry\.glb/);
assert.match(undergrowthVisuals, /targetDiameterM = \[0\.0065, 0\.009\]/);
assert.match(undergrowthVisuals, /JUNIPER_FEMALE_FRUIT_CHANCE/);
assert.match(undergrowthVisuals, /Instanced ripe common-juniper berry cones/);
assert.doesNotMatch(undergrowthVisuals, /createCardClumpGeometry/);

console.log(
  `Gorski shrub integration tests passed (${generationMs.toFixed(1)} ms deterministic seed sweep)`,
);

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
      assert.ok(
        geometry.getAttribute('aRootWeight'),
        `${kind} variant ${variant} must carry rooted wind weights`,
      );
      if (kind === 'raspberry') {
        assert.ok(
          prototype.fruitAnchors.length >= MAX_RASPBERRIES_PER_CLUMP,
          `raspberry variant ${variant} must expose all ${MAX_RASPBERRIES_PER_CLUMP} visible fruit anchors`,
        );
        assert.ok(
          prototype.fruitAnchors.length <= RASPBERRY_FRUIT_ANCHOR_LIMIT,
          `raspberry variant ${variant} exceeded its authored fruit-anchor budget`,
        );
      } else if (kind === 'juniper') {
        assert.equal(
          prototype.fruitAnchors.length,
          JUNIPER_BERRY_ANCHOR_LIMIT,
          `juniper variant ${variant} must expose its full berry-cone anchor budget`,
        );
      } else {
        assert.equal(prototype.fruitAnchors.length, 0);
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
