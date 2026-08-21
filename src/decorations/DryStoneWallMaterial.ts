import * as THREE from 'three';

export type DryStoneWallMaterialSet = {
  stone: THREE.MeshStandardMaterial;
  previewValid: THREE.MeshStandardMaterial;
  previewInvalid: THREE.MeshStandardMaterial;
  dispose: () => void;
};

type SurfacePalette = {
  low: readonly [number, number, number];
  high: readonly [number, number, number];
  pit: readonly [number, number, number];
  roughness: readonly [number, number];
  normalStrength: number;
};

const TEXTURE_SIZE = 128;

/** Dedicated, deterministic wall texture bundle; no building masonry atlas is reused. */
export function createDryStoneWallMaterials(): DryStoneWallMaterialSet {
  const stoneTextures = createSurfaceTextures(0x5e10, {
    low: [102, 102, 102],
    high: [160, 160, 160],
    pit: [65, 65, 65],
    roughness: [218, 248],
    normalStrength: 2.7,
  });
  const stone = new THREE.MeshStandardMaterial({
    name: 'Dry-stone wall · weathered limestone',
    color: 0xffffff,
    map: stoneTextures.albedo,
    normalMap: stoneTextures.normal,
    normalScale: new THREE.Vector2(0.52, 0.52),
    roughness: 0.95,
    roughnessMap: stoneTextures.roughness,
    metalness: 0,
    vertexColors: true,
  });
  stone.userData.dryStoneWallSurface = {
    textureOwnership: 'dedicated-generated-pbr',
    perceptualTextureScale: 1.35,
    roughnessRange: [0.86, 1],
    microNormalStrength: 0.52,
    materialIdentityWeights: { limestone: 1, dampBase: 0.18 },
    debugModes: ['final', 'courses', 'variants'],
  };

  const previewValid = new THREE.MeshStandardMaterial({
    name: 'Dry-stone wall preview · valid',
    color: 0xa3b88a,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const previewInvalid = new THREE.MeshStandardMaterial({
    name: 'Dry-stone wall preview · invalid',
    color: 0xc84b43,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });

  return {
    stone,
    previewValid,
    previewInvalid,
    dispose: () => {
      stone.dispose();
      previewValid.dispose();
      previewInvalid.dispose();
      for (const texture of [
        stoneTextures.albedo,
        stoneTextures.normal,
        stoneTextures.roughness,
      ]) texture.dispose();
    },
  };
}

function createSurfaceTextures(seed: number, palette: SurfacePalette): {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
} {
  const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  const albedoData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const roughnessData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const broad = periodicValueNoise(x, y, 8, seed);
      const medium = periodicValueNoise(x, y, 20, seed + 37);
      const grain = periodicValueNoise(x, y, 48, seed + 83);
      const cellularPit = hash2(x, y, seed + 151);
      const pit = cellularPit > 0.978
        ? THREE.MathUtils.clamp((cellularPit - 0.978) * 34, 0, 0.82)
        : 0;
      const height = THREE.MathUtils.clamp(
        broad * 0.5 + medium * 0.32 + grain * 0.18 - pit * 0.6,
        0,
        1,
      );
      const index = y * TEXTURE_SIZE + x;
      heights[index] = height;

      const vein = Math.pow(Math.abs(medium - 0.5) * 2, 4) * 0.18;
      const value = THREE.MathUtils.clamp(height * 0.86 + broad * 0.14 - vein, 0, 1);
      const color = pit > 0.08
        ? mixRgb(palette.low, palette.pit, pit)
        : mixRgb(palette.low, palette.high, value);
      writeRgba(albedoData, index, color[0], color[1], color[2], 255);

      const roughness = THREE.MathUtils.lerp(
        palette.roughness[0],
        palette.roughness[1],
        THREE.MathUtils.clamp(0.3 + grain * 0.55 + pit * 0.4, 0, 1),
      );
      writeRgba(roughnessData, index, roughness, roughness, roughness, 255);
    }
  }

  const normalData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const left = heights[y * TEXTURE_SIZE + wrap(x - 1, TEXTURE_SIZE)];
      const right = heights[y * TEXTURE_SIZE + wrap(x + 1, TEXTURE_SIZE)];
      const down = heights[wrap(y - 1, TEXTURE_SIZE) * TEXTURE_SIZE + x];
      const up = heights[wrap(y + 1, TEXTURE_SIZE) * TEXTURE_SIZE + x];
      const normal = new THREE.Vector3(
        (left - right) * palette.normalStrength,
        (down - up) * palette.normalStrength,
        1,
      ).normalize();
      const index = y * TEXTURE_SIZE + x;
      writeRgba(
        normalData,
        index,
        (normal.x * 0.5 + 0.5) * 255,
        (normal.y * 0.5 + 0.5) * 255,
        normal.z * 255,
        255,
      );
    }
  }

  const albedo = dataTexture(albedoData, true, 'Dry-stone limestone albedo');
  const normal = dataTexture(normalData, false, 'Dry-stone limestone OpenGL normal');
  const roughness = dataTexture(roughnessData, false, 'Dry-stone limestone roughness');
  return { albedo, normal, roughness };
}

function dataTexture(data: Uint8Array, srgb: boolean, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function periodicValueNoise(x: number, y: number, cells: number, seed: number): number {
  const px = x / TEXTURE_SIZE * cells;
  const py = y / TEXTURE_SIZE * cells;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = smooth(px - x0);
  const ty = smooth(py - y0);
  const a = hash2(wrap(x0, cells), wrap(y0, cells), seed);
  const b = hash2(wrap(x0 + 1, cells), wrap(y0, cells), seed);
  const c = hash2(wrap(x0, cells), wrap(y0 + 1, cells), seed);
  const d = hash2(wrap(x0 + 1, cells), wrap(y0 + 1, cells), seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    ty,
  );
}

function hash2(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed, 0x45d9f3b) ^ Math.imul(y + seed * 7, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(a[0], b[0], amount),
    THREE.MathUtils.lerp(a[1], b[1], amount),
    THREE.MathUtils.lerp(a[2], b[2], amount),
  ];
}

function writeRgba(
  target: Uint8Array,
  index: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const offset = index * 4;
  target[offset] = Math.round(r);
  target[offset + 1] = Math.round(g);
  target[offset + 2] = Math.round(b);
  target[offset + 3] = Math.round(a);
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}
