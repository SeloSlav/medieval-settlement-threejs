import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  mix,
  normalize,
  normalViewGeometry,
  smoothstep,
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
  sub: (value: unknown) => TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  mix: mix as (a: unknown, b: unknown, amount: unknown) => TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  normalViewGeometry: normalViewGeometry as TslNode,
  smoothstep: smoothstep as (low: unknown, high: unknown, value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture, uvNode?: unknown) => TslNode,
  uv: uv as () => TslNode,
  vec2: vec2 as (...values: unknown[]) => TslNode,
  vec4: vec4 as (...values: unknown[]) => TslNode,
};

const STEM_COLORS = [new THREE.Color(0x658b48), new THREE.Color(0x739b52)] as const;
const FLOWER_CARD_COLOR = new THREE.Color(0xffffff);
const WILDFLOWER_ATLAS_PATH =
  '/assets/textures/vegetation/wildflowers/gorski-kotar-wildflower-atlas-v2.png';
export const WILDFLOWER_ATLAS_CELL_SCALE = [1 / 5, 1] as const;
/** Larger heads remain legible at the game's closest strategic-camera zoom. */
export const SEEDTHREE_WILDFLOWER_HEAD_SCALE = 1.25;
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
    id: 'queen-annes-lace',
    label: "Queen Anne's lace",
    texturePath: '/assets/textures/vegetation/wildflowers/queen-annes-lace-head.png',
    atlasOffset: [0, 0],
    heightScale: [1.2, 1.65],
    widthScale: [0.92, 1.08],
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
  // Every species keeps one readable central stem. Queen Anne's lace reveals
  // the separately masked side branches below, while the other species retain
  // their botanically simpler silhouettes.
  const stalks = [
    { x: 0, z: 0, height: 0.36, leanX: 0.008, leanZ: -0.004, yaw: 0.25, bloomScale: 1 },
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

  // Cow parsley / Queen Anne's lace reads as a loose spray, not a lollipop.
  // Each side stem splits from the central stalk, changes direction once, and
  // ends at a differently sized and tilted umbel. Uneven split heights and
  // head elevations keep the silhouette organic at strategic-camera distance.
  const queenAnneBranches = [
    {
      splitHeight: 0.105,
      elbow: [0.042, 0.205, 0.022],
      tip: [0.104, 0.31, 0.055],
      yaw: 0.46,
      headRadius: 0.021,
    },
    {
      splitHeight: 0.132,
      elbow: [-0.038, 0.235, 0.047],
      tip: [-0.105, 0.352, 0.082],
      yaw: 2.48,
      headRadius: 0.024,
    },
    {
      splitHeight: 0.158,
      elbow: [0.018, 0.264, -0.055],
      tip: [0.06, 0.388, -0.112],
      yaw: 5.22,
      headRadius: 0.019,
    },
    {
      splitHeight: 0.185,
      elbow: [-0.045, 0.284, -0.034],
      tip: [-0.1, 0.408, -0.064],
      yaw: 3.7,
      headRadius: 0.022,
    },
    {
      splitHeight: 0.215,
      elbow: [0.055, 0.302, 0.002],
      tip: [0.123, 0.382, 0.018],
      yaw: 0.15,
      headRadius: 0.02,
    },
  ] as const;

  queenAnneBranches.forEach((branch, index) => {
    const splitFraction = branch.splitHeight / stalks[0].height;
    const split = new THREE.Vector3(
      stalks[0].leanX * splitFraction,
      branch.splitHeight,
      stalks[0].leanZ * splitFraction,
    );
    const elbow = new THREE.Vector3(...branch.elbow);
    const tip = new THREE.Vector3(...branch.tip);
    const jointWindWeight = THREE.MathUtils.lerp(splitFraction, 1, 0.62);
    const stemColor = STEM_COLORS[(index + 1) % STEM_COLORS.length]!;

    appendStemTube(
      buffers,
      split,
      elbow,
      0.0026,
      branch.yaw,
      stemColor,
      splitFraction,
      jointWindWeight,
      1,
    );
    appendStemTube(
      buffers,
      elbow,
      tip,
      0.00215,
      branch.yaw + 0.31,
      stemColor,
      jointWindWeight,
      1,
      1,
    );
    appendFlowerHeadCard(
      buffers,
      tip,
      branch.yaw + (index % 2 === 0 ? 0.18 : -0.13),
      branch.headRadius * headScale,
      1,
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
  // The existing flower mask packs two binary values so the branching plant
  // does not consume another WebGPU vertex-buffer slot: 0/1 are central
  // stem/head and 2/3 are Queen Anne branch stem/head.
  const packedFlowerMask = tsl.attribute('flowerMask', 'float');
  const queenAnneBranchMask = tsl.smoothstep(
    tsl.float(1.49),
    tsl.float(1.51),
    packedFlowerMask,
  );
  const flowerMask = packedFlowerMask.sub(queenAnneBranchMask.mul(tsl.float(2)));
  const flowerAnchor = tsl.attribute('aAnchorPos', 'vec4');
  // Atlas cell zero is Queen Anne's lace. Deriving the instance flag from the
  // existing anchor keeps the complete flower pipeline within WebGPU's eight
  // vertex-buffer minimum limit.
  const whiteUmbel = tsl.float(1).sub(
    tsl.smoothstep(tsl.float(0.01), tsl.float(0.02), flowerAnchor.w),
  );
  const atlasUv = tsl.uv()
    .mul(tsl.vec2(WILDFLOWER_ATLAS_CELL_SCALE[0], WILDFLOWER_ATLAS_CELL_SCALE[1]))
    .add(tsl.vec2(flowerAnchor.w, 0));
  const texel = tsl.texture(texture, atlasUv);
  const stemTexel = tsl.texture(stemTexture, tsl.uv());
  // Alpha stays in colorNode so the material opacity still controls the
  // close-ground LOD fade applied by GrassBladeField.
  const surfaceColor = tsl.mix(
    tsl.vec4(baseColor, tsl.float(1)).mul(stemTexel),
    texel,
    flowerMask,
  );
  material.colorNode = surfaceColor.mul(
    tsl.mix(tsl.float(1), whiteUmbel, queenAnneBranchMask),
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
}

function appendStemTube(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  radius: number,
  yaw: number,
  color: THREE.Color,
  windWeightStart = 0,
  windWeightEnd = 1,
  queenAnneBranchMask = 0,
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
        THREE.MathUtils.lerp(windWeightStart, windWeightEnd, t),
        queenAnneBranchMask,
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

function appendFlowerHeadCard(
  buffers: WildflowerBuffers,
  center: THREE.Vector3,
  yaw: number,
  radius: number,
  queenAnneBranchMask = 0,
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
    queenAnneBranchMask,
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
      queenAnneBranchMask,
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
  queenAnneBranchMask = 0,
): WildflowerVertex {
  return {
    position,
    normal,
    color,
    uv,
    flowerMask: flowerMask + queenAnneBranchMask * 2,
    windWeight,
  };
}

function appendVertex(buffers: WildflowerBuffers, item: WildflowerVertex): void {
  buffers.positions.push(item.position.x, item.position.y, item.position.z);
  buffers.normals.push(item.normal.x, item.normal.y, item.normal.z);
  buffers.colors.push(item.color.r, item.color.g, item.color.b);
  buffers.uvs.push(item.uv[0], item.uv[1]);
  buffers.flowerMasks.push(item.flowerMask);
  buffers.windWeights.push(item.windWeight);
}
