import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  mix,
  normalize,
  normalViewGeometry,
  texture,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import { loadBitmapTexture } from '../../utils/textureLoad.ts';
import { createPinnedGrassWindPosition } from './seedThreeGrass.ts';

type TslNode = {
  a: TslNode;
  rgb: TslNode;
  w: TslNode;
  xyz: TslNode;
  add: (value: unknown) => TslNode;
  mul: (value: unknown) => TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  mix: mix as (a: unknown, b: unknown, amount: unknown) => TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  normalViewGeometry: normalViewGeometry as TslNode,
  texture: texture as (map: THREE.Texture, uvNode?: unknown) => TslNode,
  uv: uv as () => TslNode,
  vec2: vec2 as (...values: unknown[]) => TslNode,
  vec4: vec4 as (...values: unknown[]) => TslNode,
};

const STEM_COLORS = [new THREE.Color(0x557340), new THREE.Color(0x66844b)] as const;
const FLOWER_CARD_COLOR = new THREE.Color(0xffffff);
const WILDFLOWER_ATLAS_PATH =
  '/assets/textures/vegetation/wildflowers/gorski-kotar-wildflower-atlas.png';
export const WILDFLOWER_ATLAS_CELL_SCALE = [1 / 5, 1] as const;
const STEM_TEXTURE_WIDTH = 32;
const STEM_TEXTURE_HEIGHT = 128;

type WildflowerVertex = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  color: THREE.Color;
  uv: readonly [number, number];
  flowerMask: number;
  windWeight: number;
};

type WildflowerBuffers = {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  flowerMasks: number[];
  windWeights: number[];
  indices: number[];
};

export const SEEDTHREE_WILDFLOWER_VARIANTS = [
  {
    id: 'daisy-star-aster',
    label: 'Daisy star-aster',
    texturePath: '/assets/textures/vegetation/wildflowers/daisy-star-aster-head.png',
    atlasOffset: [0, 0],
    heightScale: [1.2, 1.65],
    widthScale: [0.78, 1],
  },
  {
    id: 'clusius-gentian',
    label: 'Clusius gentian',
    texturePath: '/assets/textures/vegetation/wildflowers/clusius-gentian-head.png',
    atlasOffset: [1 / 5, 0],
    heightScale: [1.05, 1.4],
    widthScale: [0.64, 0.82],
  },
  {
    id: 'grey-hawkbit',
    label: 'Grey hawkbit',
    texturePath: '/assets/textures/vegetation/wildflowers/grey-hawkbit-head.png',
    atlasOffset: [2 / 5, 0],
    heightScale: [1.2, 1.65],
    widthScale: [0.72, 0.94],
  },
  {
    id: 'bulbiferous-lily',
    label: 'Bulbiferous lily',
    texturePath: '/assets/textures/vegetation/wildflowers/bulbiferous-lily-head.png',
    atlasOffset: [3 / 5, 0],
    heightScale: [1.35, 1.95],
    widthScale: [0.9, 1.12],
  },
  {
    id: 'red-campion',
    label: 'Red campion',
    texturePath: '/assets/textures/vegetation/wildflowers/red-campion-head.png',
    atlasOffset: [4 / 5, 0],
    heightScale: [1.25, 1.72],
    widthScale: [0.7, 0.92],
  },
] as const;

let textureCache: THREE.Texture | null = null;
let stemTextureCache: THREE.DataTexture | null = null;

export async function loadSeedThreeWildflowerAtlas(
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  if (textureCache) return textureCache;

  textureCache = await loadBitmapTexture(WILDFLOWER_ATLAS_PATH, maxAnisotropy, {
    srgb: true,
    anisotropyLimit: 4,
    wrapping: THREE.ClampToEdgeWrapping,
  });
  return textureCache;
}

export function createSeedThreeWildflowerGeometry(headScale: number): THREE.BufferGeometry {
  const buffers: WildflowerBuffers = {
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    flowerMasks: [],
    windWeights: [],
    indices: [],
  };
  const stalks = [
    { x: -0.085, z: 0.025, height: 0.31, leanX: -0.018, leanZ: 0.008, yaw: 0.25, bloomScale: 0.92 },
    { x: 0.035, z: -0.045, height: 0.4, leanX: 0.022, leanZ: -0.012, yaw: 2.2, bloomScale: 1.04 },
    { x: 0.1, z: 0.06, height: 0.27, leanX: 0.015, leanZ: 0.018, yaw: 4.35, bloomScale: 0.82 },
    { x: -0.018, z: 0.105, height: 0.35, leanX: -0.008, leanZ: 0.02, yaw: 5.45, bloomScale: 0.88 },
    { x: 0.115, z: -0.072, height: 0.32, leanX: 0.02, leanZ: -0.014, yaw: 1.3, bloomScale: 0.86 },
  ] as const;

  stalks.forEach((stalk, index) => {
    appendStalk(buffers, stalk, index);
    appendFlowerHeadCard(
      buffers,
      new THREE.Vector3(
        stalk.x + stalk.leanX,
        stalk.height,
        stalk.z + stalk.leanZ,
      ),
      stalk.yaw,
      0.038 * stalk.bloomScale * headScale,
    );
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(buffers.indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('flowerMask', new THREE.Float32BufferAttribute(buffers.flowerMasks, 1));
  geometry.setAttribute('windWeight', new THREE.Float32BufferAttribute(buffers.windWeights, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSeedThreeWildflowerMaterial(
  texture: THREE.Texture,
  label: string,
): THREE.Material {
  const material = new MeshStandardNodeMaterial();
  const stemTexture = stemTextureCache ??= createStemSurfaceTexture();
  Object.assign(material, { map: texture });
  material.name = `SeedThree textured ${label}`;
  material.side = THREE.DoubleSide;
  material.alphaTest = 0.18;
  material.roughness = 0.88;
  material.metalness = 0;
  material.color.set(0xffffff);
  material.forceSinglePass = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const baseColor = tsl.attribute('color', 'vec3');
  const flowerMask = tsl.attribute('flowerMask', 'float');
  const flowerAnchor = tsl.attribute('aAnchorPos', 'vec4');
  const atlasUv = tsl.uv()
    .mul(tsl.vec2(WILDFLOWER_ATLAS_CELL_SCALE[0], WILDFLOWER_ATLAS_CELL_SCALE[1]))
    .add(tsl.vec2(flowerAnchor.w, 0));
  const texel = tsl.texture(texture, atlasUv);
  const stemTexel = tsl.texture(stemTexture, tsl.uv());
  // Alpha stays in colorNode so the material opacity still controls the
  // close-ground LOD fade applied by GrassBladeField.
  material.colorNode = tsl.mix(
    tsl.vec4(baseColor, tsl.float(1)).mul(stemTexel),
    texel,
    flowerMask,
  );
  // A separate weight keeps every point of the head card attached to its stem
  // rather than bending the image according to its texture UV.
  material.positionNode = createPinnedGrassWindPosition('windWeight', 'vec4');
  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  material.normalNode = tsl.normalize(tsl.mix(tsl.normalViewGeometry, upView, flowerMask));
  material.userData.stemTexture = 'procedural wildflower stem fibers';
  return material;
}

export function disposeSeedThreeWildflowerTextureCache(): void {
  textureCache?.dispose();
  stemTextureCache?.dispose();
  textureCache = null;
  stemTextureCache = null;
}

function appendStalk(
  buffers: WildflowerBuffers,
  stalk: {
    x: number;
    z: number;
    height: number;
    leanX: number;
    leanZ: number;
    yaw: number;
  },
  colorIndex: number,
): void {
  const root = new THREE.Vector3(stalk.x, 0, stalk.z);
  const tip = new THREE.Vector3(
    stalk.x + stalk.leanX,
    stalk.height,
    stalk.z + stalk.leanZ,
  );
  const radius = 0.0036;
  const stemColor = STEM_COLORS[colorIndex % STEM_COLORS.length]!;

  appendStemTube(buffers, root, tip, radius, stalk.yaw, stemColor);

  appendLeaf(buffers, root, tip, stalk.yaw + 0.8, 0.34, 0.115, stemColor);
  appendLeaf(
    buffers,
    root,
    tip,
    stalk.yaw + Math.PI + 0.35,
    0.53,
    0.09,
    STEM_COLORS[(colorIndex + 1) % STEM_COLORS.length]!,
  );
}

function appendStemTube(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  radius: number,
  yaw: number,
  color: THREE.Color,
): void {
  const axis = tip.clone().sub(root).normalize();
  const radialA = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))
    .addScaledVector(axis, -axis.dot(new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))))
    .normalize();
  const radialB = new THREE.Vector3().crossVectors(axis, radialA).normalize();
  const ringFractions = [0, 0.28, 0.54, 0.78, 1] as const;
  const radialSegments = 7;
  const base = buffers.positions.length / 3;

  for (let ring = 0; ring < ringFractions.length; ring++) {
    const t = ringFractions[ring]!;
    const center = root.clone().lerp(tip, t);
    const nodeSwelling = ring === 1 || ring === 3 ? 1.08 : 1;
    const ringRadius = radius * THREE.MathUtils.lerp(1, 0.58, t) * nodeSwelling;
    const ringColor = color.clone().multiplyScalar(
      ring === 1 || ring === 3 ? 0.86 : THREE.MathUtils.lerp(0.9, 1.08, t),
    );

    for (let sideIndex = 0; sideIndex <= radialSegments; sideIndex++) {
      const angle = (sideIndex / radialSegments) * Math.PI * 2;
      const radial = radialA.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(radialB, Math.sin(angle));
      appendVertex(buffers, vertex(
        center.clone().addScaledVector(radial, ringRadius),
        radial,
        ringColor,
        [sideIndex / radialSegments, t * 3.25],
        0,
        t,
      ));
    }
  }

  const stride = radialSegments + 1;
  for (let ring = 0; ring < ringFractions.length - 1; ring++) {
    for (let sideIndex = 0; sideIndex < radialSegments; sideIndex++) {
      const a = base + ring * stride + sideIndex;
      const b = a + 1;
      const d = base + (ring + 1) * stride + sideIndex;
      const c = d + 1;
      buffers.indices.push(a, b, c, a, c, d);
    }
  }
}

function appendLeaf(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  yaw: number,
  heightFraction: number,
  length: number,
  color: THREE.Color,
): void {
  const stemPoint = root.clone().lerp(tip, heightFraction);
  const direction = new THREE.Vector3(
    Math.cos(yaw),
    0.28,
    Math.sin(yaw),
  ).normalize();
  const sideDirection = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const leafTip = stemPoint.clone().addScaledVector(direction, length);
  const normal = new THREE.Vector3(0, 1, 0);
  const leafTipWeight = Math.min(1, heightFraction + 0.12);
  const rowFractions = [0, 0.24, 0.52, 0.79, 1] as const;
  const rowWidths = [0, 0.58, 1, 0.62, 0] as const;
  const halfWidth = Math.min(0.014, length * 0.12);
  const base = buffers.positions.length / 3;
  for (let row = 0; row < rowFractions.length; row++) {
    const t = rowFractions[row]!;
    const center = stemPoint.clone().lerp(leafTip, t)
      .addScaledVector(normal, Math.sin(t * Math.PI) * 0.006);
    const width = halfWidth * rowWidths[row]!;
    const rowColor = color.clone().multiplyScalar(THREE.MathUtils.lerp(0.84, 1.04, t));
    for (let column = 0; column < 3; column++) {
      const across = column - 1;
      const point = center.clone()
        .addScaledVector(sideDirection, across * width)
        .addScaledVector(normal, -Math.abs(across) * Math.sin(t * Math.PI) * 0.0018);
      appendVertex(buffers, vertex(
        point,
        normal,
        column === 1 ? rowColor.clone().multiplyScalar(1.08) : rowColor,
        [column * 0.5, t],
        0,
        THREE.MathUtils.lerp(heightFraction, leafTipWeight, t),
      ));
    }
  }
  for (let row = 0; row < rowFractions.length - 1; row++) {
    const lower = base + row * 3;
    const upper = lower + 3;
    buffers.indices.push(
      lower, upper, upper + 1,
      lower, upper + 1, lower + 1,
      lower + 1, upper + 1, upper + 2,
      lower + 1, upper + 2, lower + 2,
    );
  }
}

function appendFlowerHeadCard(
  buffers: WildflowerBuffers,
  center: THREE.Vector3,
  yaw: number,
  radius: number,
): void {
  const tiltDirection = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const normal = new THREE.Vector3(
    tiltDirection.x * 0.24,
    0.95,
    tiltDirection.z * 0.24,
  ).normalize();
  const axisU = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  const axisV = new THREE.Vector3().crossVectors(normal, axisU).normalize();
  const halfSize = radius * 1.06;
  const liftedCenter = center.clone().addScaledVector(normal, 0.006);
  const segments = 12;
  const base = buffers.positions.length / 3;

  appendVertex(buffers, vertex(
    liftedCenter.clone().addScaledVector(normal, 0.0045),
    normal,
    FLOWER_CARD_COLOR,
    [0.5, 0.5],
    1,
    1,
  ));
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    const organicRadius = halfSize * (1 + Math.sin(angle * 5 + yaw) * 0.025);
    const point = liftedCenter.clone()
      .addScaledVector(axisU, Math.cos(angle) * organicRadius)
      .addScaledVector(axisV, Math.sin(angle) * organicRadius)
      .addScaledVector(normal, -0.0025 + Math.cos(angle * 3) * 0.0012);
    appendVertex(buffers, vertex(
      point,
      normal,
      FLOWER_CARD_COLOR,
      [0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5],
      1,
      1,
    ));
  }
  for (let index = 0; index < segments; index++) {
    buffers.indices.push(base, base + index + 1, base + index + 2);
  }
}

function createStemSurfaceTexture(): THREE.DataTexture {
  const pixels = new Uint8Array(STEM_TEXTURE_WIDTH * STEM_TEXTURE_HEIGHT * 4);
  for (let y = 0; y < STEM_TEXTURE_HEIGHT; y++) {
    const v = y / (STEM_TEXTURE_HEIGHT - 1);
    const nodeBand = Math.exp(-Math.pow((v * 4.1) % 1 - 0.52, 2) / 0.005);
    for (let x = 0; x < STEM_TEXTURE_WIDTH; x++) {
      const index = (y * STEM_TEXTURE_WIDTH + x) * 4;
      const fiber = Math.sin(x * 1.31 + y * 0.17)
        + Math.sin(x * 3.77 - y * 0.09) * 0.34;
      const grain = ((x * 29 + y * 47 + (x * y) % 17) % 23) / 22 - 0.5;
      const value = THREE.MathUtils.clamp(
        222 + fiber * 8 + grain * 7 - nodeBand * 28,
        165,
        244,
      );
      pixels[index] = value * 0.93;
      pixels[index + 1] = value;
      pixels[index + 2] = value * 0.88;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    pixels,
    STEM_TEXTURE_WIDTH,
    STEM_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'Procedural wildflower stem fibers';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function vertex(
  position: THREE.Vector3,
  normal: THREE.Vector3,
  color: THREE.Color,
  uv: readonly [number, number],
  flowerMask: number,
  windWeight: number,
): WildflowerVertex {
  return { position, normal, color, uv, flowerMask, windWeight };
}

function appendVertex(buffers: WildflowerBuffers, item: WildflowerVertex): void {
  buffers.positions.push(item.position.x, item.position.y, item.position.z);
  buffers.normals.push(item.normal.x, item.normal.y, item.normal.z);
  buffers.colors.push(item.color.r, item.color.g, item.color.b);
  buffers.uvs.push(item.uv[0], item.uv[1]);
  buffers.flowerMasks.push(item.flowerMask);
  buffers.windWeights.push(item.windWeight);
}
