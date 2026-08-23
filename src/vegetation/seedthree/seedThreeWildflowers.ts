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
  x: TslNode;
  xyz: TslNode;
  y: TslNode;
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
export const WILDFLOWER_ATLAS_CELL_SCALE = [1 / 5, 1 / 2] as const;
/** Larger heads remain legible among the denser grass at maximum strategic zoom. */
export const SEEDTHREE_WILDFLOWER_HEAD_SCALE = 1.5;
// The regenerated lily's darkest throat pixel is at source UV (0.50, 0.63).
// Runtime V is flipped, placing the pit 0.28 radii below the card center.
const LILY_THROAT_AXIS_V_OFFSET = -0.28;
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

type FlowerFrame = {
  surfaceCenter: THREE.Vector3;
  normal: THREE.Vector3;
  axisU: THREE.Vector3;
  axisV: THREE.Vector3;
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
    // Still exaggerated enough for the strategic camera, but visibly shorter
    // than the meadow flowers as a naturally near-stemless alpine gentian.
    heightScale: [0.58, 0.78],
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
  // the separately masked side branches below, while species-specific foliage
  // and inflorescences are packed into the same flowerMask attribute.
  const stalks = [
    { x: 0, z: 0, height: 0.36, leanX: 0.008, leanZ: -0.004, yaw: 0.25, bloomScale: 1 },
  ] as const;

  stalks.forEach((stalk, index) => {
    appendStalk(buffers, stalk, index);
  });

  const centralTip = new THREE.Vector3(
    stalks[0].x + stalks[0].leanX,
    stalks[0].height,
    stalks[0].z + stalks[0].leanZ,
  );

  // Preserve the authored white umbel exactly; only its packed visibility band
  // differs now that every non-white species owns a botanical silhouette.
  appendFlowerHeadCard(
    buffers,
    centralTip,
    stalks[0].yaw,
    0.038 * stalks[0].bloomScale * headScale,
    1,
  );

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

  // Clusius gentian: one large terminal trumpet over a stiff basal rosette,
  // with only two small, decussate stem-leaf pairs. The stem remains simple.
  appendFlowerHeadCard(buffers, centralTip, 0.18, 0.038 * headScale, 2, 0.08);
  const gentianLeafColor = new THREE.Color(0x587642);
  const gentianRosette = [
    { yaw: 0.08, length: 0.082, width: 0.021, lift: 0.012 },
    { yaw: 1.02, length: 0.069, width: 0.019, lift: 0.009 },
    { yaw: 2.04, length: 0.088, width: 0.022, lift: 0.014 },
    { yaw: 3.08, length: 0.073, width: 0.02, lift: 0.01 },
    { yaw: 4.16, length: 0.078, width: 0.021, lift: 0.013 },
    { yaw: 5.26, length: 0.066, width: 0.018, lift: 0.008 },
  ] as const;
  gentianRosette.forEach((leaf) => {
    appendFoliageBlade(
      buffers,
      new THREE.Vector3(0, 0.004, 0),
      new THREE.Vector3(
        Math.cos(leaf.yaw) * leaf.length,
        leaf.lift,
        Math.sin(leaf.yaw) * leaf.length,
      ),
      leaf.width,
      gentianLeafColor,
      2,
      'lanceolate',
    );
  });
  [
    { height: 0.115, yaw: 0.34, length: 0.037, width: 0.0095 },
    { height: 0.205, yaw: 1.91, length: 0.03, width: 0.0075 },
  ].forEach((pair) => {
    for (const side of [0, Math.PI]) {
      const yaw = pair.yaw + side;
      const root = pointAlongCentralStalk(stalks[0], pair.height);
      appendFoliageBlade(
        buffers,
        root,
        root.clone().add(new THREE.Vector3(
          Math.cos(yaw) * pair.length,
          pair.length * 0.42,
          Math.sin(yaw) * pair.length,
        )),
        pair.width,
        gentianLeafColor,
        2,
        'lanceolate',
        pair.height / stalks[0].height,
      );
    }
  });

  // Grey hawkbit: a solitary, leafless scape over a low hoary, lobed rosette.
  appendFlowerHeadCard(buffers, centralTip, 0.52, 0.029 * headScale, 3, 0.16);
  const hawkbitLeafColor = new THREE.Color(0x788767);
  [0.18, 0.92, 1.68, 2.49, 3.2, 4.02, 4.78, 5.57].forEach((yaw, index) => {
    const length = 0.082 + (index % 3) * 0.012;
    appendFoliageBlade(
      buffers,
      new THREE.Vector3(0, 0.004 + (index % 2) * 0.001, 0),
      new THREE.Vector3(
        Math.cos(yaw) * length,
        0.009 + (index % 2) * 0.004,
        Math.sin(yaw) * length,
      ),
      0.015 + (index % 2) * 0.002,
      hawkbitLeafColor,
      3,
      'lobed',
    );
  });

  // Bulbiferous lily: a stout leafy axis with a loose spiral of lanceolate
  // leaves and short upper pedicels carrying an upright three-flower cluster.
  const centralLilyRadius = 0.044 * headScale;
  const centralLilyFrame = appendFlowerHeadCard(
    buffers,
    centralTip,
    0.66,
    centralLilyRadius,
    4,
    0.34,
  );
  appendLilyReproductiveOrgans(buffers, centralLilyFrame, centralLilyRadius, 4);
  const lilyLeafColor = new THREE.Color(0x4f7c3c);
  [
    { height: 0.052, yaw: 0.15, length: 0.07, width: 0.009 },
    { height: 0.086, yaw: 2.48, length: 0.083, width: 0.011 },
    { height: 0.122, yaw: 4.72, length: 0.075, width: 0.01 },
    { height: 0.158, yaw: 0.83, length: 0.088, width: 0.0115 },
    { height: 0.194, yaw: 3.17, length: 0.079, width: 0.01 },
    { height: 0.23, yaw: 5.38, length: 0.068, width: 0.009 },
    { height: 0.263, yaw: 1.48, length: 0.059, width: 0.008 },
    { height: 0.292, yaw: 3.83, length: 0.05, width: 0.007 },
  ].forEach((leaf) => {
    const root = pointAlongCentralStalk(stalks[0], leaf.height);
    appendFoliageBlade(
      buffers,
      root,
      root.clone().add(new THREE.Vector3(
        Math.cos(leaf.yaw) * leaf.length,
        leaf.length * 0.18,
        Math.sin(leaf.yaw) * leaf.length,
      )),
      leaf.width,
      lilyLeafColor,
      4,
      'lanceolate',
      leaf.height / stalks[0].height,
    );
  });
  const lilyPedicels = [
    {
      splitHeight: 0.242,
      elbow: [0.026, 0.29, 0.015],
      tip: [0.061, 0.352, 0.027],
      yaw: 0.38,
      headRadius: 0.037,
    },
    {
      splitHeight: 0.268,
      elbow: [-0.026, 0.31, -0.019],
      tip: [-0.056, 0.371, -0.041],
      yaw: 3.8,
      headRadius: 0.035,
    },
  ] as const;
  lilyPedicels.forEach((branch, index) => {
    const split = pointAlongCentralStalk(stalks[0], branch.splitHeight);
    const elbow = new THREE.Vector3(...branch.elbow);
    const tip = new THREE.Vector3(...branch.tip);
    const splitWeight = branch.splitHeight / stalks[0].height;
    const elbowWeight = THREE.MathUtils.lerp(splitWeight, 1, 0.58);
    appendStemTube(
      buffers,
      split,
      elbow,
      0.0028,
      branch.yaw,
      STEM_COLORS[index % STEM_COLORS.length]!,
      splitWeight,
      elbowWeight,
      4,
    );
    appendStemTube(
      buffers,
      elbow,
      tip,
      0.00225,
      branch.yaw + 0.24,
      STEM_COLORS[index % STEM_COLORS.length]!,
      elbowWeight,
      1,
      4,
    );
    const headRadius = branch.headRadius * headScale;
    const lilyFrame = appendFlowerHeadCard(
      buffers,
      tip,
      branch.yaw,
      headRadius,
      4,
      0.46,
    );
    appendLilyReproductiveOrgans(buffers, lilyFrame, headRadius, 4);
  });

  // Red campion: opposite decussate leaves below an open, forked terminal
  // cyme. Each primary branch divides again instead of radiating from one hub.
  appendFlowerHeadCard(buffers, centralTip, 0.28, 0.017 * headScale, 5, 0.24);
  const campionLeafColor = new THREE.Color(0x537a43);
  [
    { height: 0.064, yaw: 0.22, length: 0.061, width: 0.016 },
    { height: 0.124, yaw: 1.79, length: 0.056, width: 0.015 },
    { height: 0.184, yaw: 0.26, length: 0.049, width: 0.013 },
    { height: 0.241, yaw: 1.84, length: 0.04, width: 0.011 },
  ].forEach((pair) => {
    for (const side of [0, Math.PI]) {
      const yaw = pair.yaw + side;
      const root = pointAlongCentralStalk(stalks[0], pair.height);
      appendFoliageBlade(
        buffers,
        root,
        root.clone().add(new THREE.Vector3(
          Math.cos(yaw) * pair.length,
          pair.length * 0.32,
          Math.sin(yaw) * pair.length,
        )),
        pair.width,
        campionLeafColor,
        5,
        'ovate',
        pair.height / stalks[0].height,
      );
    }
  });
  const campionCymes = [
    {
      splitHeight: 0.185,
      elbow: [0.042, 0.27, 0.02],
      tips: [
        [0.085, 0.345, 0.041],
        [0.025, 0.36, 0.071],
      ],
      yaw: 0.42,
    },
    {
      splitHeight: 0.215,
      elbow: [-0.046, 0.291, -0.018],
      tips: [
        [-0.089, 0.367, -0.052],
        [-0.052, 0.345, 0.046],
      ],
      yaw: 3.54,
    },
  ] as const;
  campionCymes.forEach((cyme, cymeIndex) => {
    const split = pointAlongCentralStalk(stalks[0], cyme.splitHeight);
    const elbow = new THREE.Vector3(...cyme.elbow);
    const splitWeight = cyme.splitHeight / stalks[0].height;
    const elbowWeight = THREE.MathUtils.lerp(splitWeight, 1, 0.5);
    const stemColor = STEM_COLORS[(cymeIndex + 1) % STEM_COLORS.length]!;
    appendStemTube(
      buffers,
      split,
      elbow,
      0.00245,
      cyme.yaw,
      stemColor,
      splitWeight,
      elbowWeight,
      5,
    );
    cyme.tips.forEach((tipTuple, tipIndex) => {
      const tip = new THREE.Vector3(...tipTuple);
      appendStemTube(
        buffers,
        elbow,
        tip,
        0.00185,
        cyme.yaw + (tipIndex === 0 ? -0.3 : 0.34),
        stemColor,
        elbowWeight,
        1,
        5,
      );
      appendFlowerHeadCard(
        buffers,
        tip,
        cyme.yaw + tipIndex * 0.5,
        (0.015 + tipIndex * 0.0015) * headScale,
        5,
        0.3,
      );
    });
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

/**
 * The authored source geometry contains every species so the lineup and atlas
 * diagnostics can still inspect the complete botanical kit. Runtime meadow
 * instances are species-owned: filtering the indexed triangles here prevents
 * every stem from executing the vertex work for four invisible plants.
 */
export function createSeedThreeWildflowerVariantGeometries(
  headScale: number,
): THREE.BufferGeometry[] {
  const combined = createSeedThreeWildflowerGeometry(headScale);
  const variants = SEEDTHREE_WILDFLOWER_VARIANTS.map((variant, variantIndex) => {
    const geometry = extractWildflowerVariantGeometry(combined, variantIndex);
    geometry.name = `SeedThree ${variant.label} geometry`;
    geometry.userData.wildflowerVariant = variant.id;
    geometry.userData.trianglesPerInstance = (geometry.index?.count ?? 0) / 3;
    return geometry;
  });
  combined.dispose();
  return variants;
}

/**
 * Strategic/settlement footprint LOD. It keeps the same atlas cell, rooted
 * wind weights, terrain anchor, height envelope, and species-owned silhouette
 * while replacing botanical tubes and close-inspection foliage with crossed
 * stem ribbons plus the few heads that define the plant at screen scale.
 */
export function createSeedThreeWildflowerFootprintGeometries(
  headScale: number,
): THREE.BufferGeometry[] {
  const headRadii = [0.038, 0.038, 0.029, 0.044, 0.022] as const;
  const headYaws = [0.25, 0.18, 0.52, 0.66, 0.28] as const;
  const headTilts = [0.24, 0.08, 0.16, 0.34, 0.24] as const;
  const accentHeads: ReadonlyArray<readonly {
    splitHeight: number;
    tip: readonly [number, number, number];
    yaw: number;
    radius: number;
  }[]> = [
    [
      { splitHeight: 0.17, tip: [0.086, 0.325, 0.044], yaw: 0.52, radius: 0.022 },
      { splitHeight: 0.2, tip: [-0.082, 0.35, -0.038], yaw: 3.68, radius: 0.021 },
    ],
    [],
    [],
    [
      { splitHeight: 0.235, tip: [0.052, 0.365, 0.028], yaw: 0.9, radius: 0.031 },
      { splitHeight: 0.25, tip: [-0.05, 0.35, -0.025], yaw: 3.94, radius: 0.028 },
    ],
    [
      { splitHeight: 0.205, tip: [0.054, 0.335, 0.03], yaw: 0.72, radius: 0.018 },
      { splitHeight: 0.225, tip: [-0.052, 0.35, -0.028], yaw: 3.82, radius: 0.017 },
    ],
  ];

  return SEEDTHREE_WILDFLOWER_VARIANTS.map((variant, variantIndex) => {
    const buffers: WildflowerBuffers = {
      positions: [],
      normals: [],
      colors: [],
      uvs: [],
      flowerMasks: [],
      windWeights: [],
      indices: [],
    };
    const structureMask = variantIndex + 1;
    const centralTip = new THREE.Vector3(0.008, 0.36, -0.004);
    appendStemCrossRibbon(
      buffers,
      new THREE.Vector3(0, 0, 0),
      centralTip,
      0.0036,
      headYaws[variantIndex]!,
      STEM_COLORS[variantIndex % STEM_COLORS.length]!,
      structureMask,
    );
    appendFlowerHeadCard(
      buffers,
      centralTip,
      headYaws[variantIndex]!,
      headRadii[variantIndex]! * headScale,
      structureMask,
      headTilts[variantIndex]!,
    );
    for (const accent of accentHeads[variantIndex]!) {
      const splitFraction = accent.splitHeight / centralTip.y;
      const split = centralTip.clone().multiplyScalar(splitFraction);
      const tip = new THREE.Vector3(...accent.tip);
      appendStemCrossRibbon(
        buffers,
        split,
        tip,
        0.0022,
        accent.yaw,
        STEM_COLORS[(variantIndex + 1) % STEM_COLORS.length]!,
        structureMask,
        splitFraction,
      );
      appendFlowerHeadCard(
        buffers,
        tip,
        accent.yaw,
        accent.radius * headScale,
        structureMask,
      );
    }

    const geometry = createWildflowerBufferGeometry(buffers);
    geometry.name = `SeedThree ${variant.label} footprint LOD`;
    geometry.userData.wildflowerVariant = variant.id;
    geometry.userData.geometryLod = 'footprint';
    geometry.userData.trianglesPerInstance = (geometry.index?.count ?? 0) / 3;
    geometry.computeBoundingBox();
    return geometry;
  });
}

function createWildflowerBufferGeometry(
  buffers: WildflowerBuffers,
): THREE.BufferGeometry {
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

function extractWildflowerVariantGeometry(
  combined: THREE.BufferGeometry,
  variantIndex: number,
): THREE.BufferGeometry {
  const sourceIndex = combined.index;
  const packedMask = combined.getAttribute('flowerMask');
  if (!sourceIndex || !packedMask) {
    throw new Error('Wildflower variant extraction requires indexed flowerMask geometry.');
  }

  const structureLow = (variantIndex + 1) * 2 - 0.5;
  const structureHigh = (variantIndex + 1) * 2 + 1.5;
  const selectedOldIndices: number[] = [];
  for (let offset = 0; offset < sourceIndex.count; offset += 3) {
    const oldIndex = sourceIndex.getX(offset);
    const mask = packedMask.getX(oldIndex);
    if (mask < 1.5 || (mask >= structureLow && mask < structureHigh)) {
      selectedOldIndices.push(
        oldIndex,
        sourceIndex.getX(offset + 1),
        sourceIndex.getX(offset + 2),
      );
    }
  }

  const oldToNew = new Map<number, number>();
  const newToOld: number[] = [];
  const remappedIndex = selectedOldIndices.map((oldIndex) => {
    const existing = oldToNew.get(oldIndex);
    if (existing !== undefined) return existing;
    const next = newToOld.length;
    oldToNew.set(oldIndex, next);
    newToOld.push(oldIndex);
    return next;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(remappedIndex);
  for (const [name, source] of Object.entries(combined.attributes)) {
    if ('isInterleavedBufferAttribute' in source) {
      throw new Error(`Wildflower variant extraction cannot copy interleaved ${name}.`);
    }
    const values = new Float32Array(newToOld.length * source.itemSize);
    const sourceValues = source.array as ArrayLike<number>;
    for (let newIndex = 0; newIndex < newToOld.length; newIndex++) {
      const oldIndex = newToOld[newIndex]!;
      for (let component = 0; component < source.itemSize; component++) {
        values[newIndex * source.itemSize + component] =
          sourceValues[oldIndex * source.itemSize + component] ?? 0;
      }
    }
    geometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(values, source.itemSize, source.normalized),
    );
  }
  geometry.computeBoundingBox();
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
  // The flower mask packs surface kind in its low bit (stem/foliage = 0,
  // flower = 1) and a two-value structural band above it. This keeps all five
  // botanical silhouettes in one geometry without another WebGPU buffer.
  const packedFlowerMask = tsl.attribute('flowerMask', 'float');
  const queenAnneBranchMask = tsl.smoothstep(
    tsl.float(1.49),
    tsl.float(1.51),
    packedFlowerMask,
  ).sub(tsl.smoothstep(
    tsl.float(3.49),
    tsl.float(3.51),
    packedFlowerMask,
  ));
  const gentianStructureMask = tsl.smoothstep(
    tsl.float(3.49),
    tsl.float(3.51),
    packedFlowerMask,
  ).sub(tsl.smoothstep(
    tsl.float(5.49),
    tsl.float(5.51),
    packedFlowerMask,
  ));
  const hawkbitStructureMask = tsl.smoothstep(
    tsl.float(5.49),
    tsl.float(5.51),
    packedFlowerMask,
  ).sub(tsl.smoothstep(
    tsl.float(7.49),
    tsl.float(7.51),
    packedFlowerMask,
  ));
  const lilyStructureMask = tsl.smoothstep(
    tsl.float(7.49),
    tsl.float(7.51),
    packedFlowerMask,
  ).sub(tsl.smoothstep(
    tsl.float(9.49),
    tsl.float(9.51),
    packedFlowerMask,
  ));
  const campionStructureMask = tsl.smoothstep(
    tsl.float(9.49),
    tsl.float(9.51),
    packedFlowerMask,
  );
  const flowerMask = packedFlowerMask
    .sub(queenAnneBranchMask.mul(tsl.float(2)))
    .sub(gentianStructureMask.mul(tsl.float(4)))
    .sub(hawkbitStructureMask.mul(tsl.float(6)))
    .sub(lilyStructureMask.mul(tsl.float(8)))
    .sub(campionStructureMask.mul(tsl.float(10)));
  const flowerAnchor = tsl.attribute('aAnchorPos', 'vec4');
  // Atlas cell zero is Queen Anne's lace. Deriving the instance flag from the
  // existing anchor keeps the complete flower pipeline within WebGPU's eight
  // vertex-buffer minimum limit.
  const whiteUmbel = tsl.float(1).sub(
    tsl.smoothstep(tsl.float(0.01), tsl.float(0.02), flowerAnchor.w),
  );
  const gentianOrLater = tsl.smoothstep(tsl.float(0.09), tsl.float(0.11), flowerAnchor.w);
  const hawkbitOrLater = tsl.smoothstep(tsl.float(0.29), tsl.float(0.31), flowerAnchor.w);
  const lilyOrLater = tsl.smoothstep(tsl.float(0.49), tsl.float(0.51), flowerAnchor.w);
  const campionOnly = tsl.smoothstep(tsl.float(0.69), tsl.float(0.71), flowerAnchor.w);
  const gentianOnly = gentianOrLater.sub(hawkbitOrLater);
  const hawkbitOnly = hawkbitOrLater.sub(lilyOrLater);
  const lilyOnly = lilyOrLater.sub(campionOnly);
  const sharedStructureMask = tsl.float(1).sub(tsl.smoothstep(
    tsl.float(1.49),
    tsl.float(1.51),
    packedFlowerMask,
  ));
  const structureVisibility = sharedStructureMask
    .add(queenAnneBranchMask.mul(whiteUmbel))
    .add(gentianStructureMask.mul(gentianOnly))
    .add(hawkbitStructureMask.mul(hawkbitOnly))
    .add(lilyStructureMask.mul(lilyOnly))
    .add(campionStructureMask.mul(campionOnly));
  const geometryUv = tsl.uv();
  const atlasUv = geometryUv
    .mul(tsl.vec2(WILDFLOWER_ATLAS_CELL_SCALE[0], WILDFLOWER_ATLAS_CELL_SCALE[1]))
    .add(tsl.vec2(flowerAnchor.w, WILDFLOWER_ATLAS_CELL_SCALE[1]));
  const texel = tsl.texture(texture, atlasUv);
  const stemTexel = tsl.texture(stemTexture, geometryUv);
  // Foliage stores a negative V coordinate so it can share the stem/foliage
  // surface bit while sampling the species-matched leaf in the atlas's lower
  // row. Stems retain their procedural fibers and flower heads use the top row.
  const foliageMask = tsl.float(1).sub(tsl.smoothstep(
    tsl.float(-0.0005),
    tsl.float(0),
    geometryUv.y,
  )).mul(tsl.float(1).sub(flowerMask));
  const leafAtlasUv = tsl.vec2(
    geometryUv.x.mul(tsl.float(WILDFLOWER_ATLAS_CELL_SCALE[0])).add(flowerAnchor.w),
    tsl.float(0).sub(geometryUv.y)
      .mul(tsl.float(WILDFLOWER_ATLAS_CELL_SCALE[1])),
  );
  const leafTexel = tsl.texture(texture, leafAtlasUv);
  const stemAndLeafColor = tsl.mix(
    tsl.vec4(baseColor, tsl.float(1)).mul(stemTexel),
    leafTexel,
    foliageMask,
  );
  // Alpha stays in colorNode so the material opacity still controls the
  // close-ground LOD fade applied by GrassBladeField.
  const surfaceColor = tsl.mix(
    stemAndLeafColor,
    texel,
    flowerMask,
  );
  material.colorNode = surfaceColor.mul(structureVisibility);
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

function pointAlongCentralStalk(
  stalk: {
    x: number;
    z: number;
    height: number;
    leanX: number;
    leanZ: number;
  },
  height: number,
): THREE.Vector3 {
  const fraction = THREE.MathUtils.clamp(height / stalk.height, 0, 1);
  return new THREE.Vector3(
    stalk.x + stalk.leanX * fraction,
    height,
    stalk.z + stalk.leanZ * fraction,
  );
}

function appendFoliageBlade(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  halfWidth: number,
  color: THREE.Color,
  structureMask: number,
  profile: 'lanceolate' | 'lobed' | 'ovate',
  windWeightStart = 0,
): void {
  const axis = tip.clone().sub(root).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const normal = new THREE.Vector3().crossVectors(axis, side).normalize();
  if (normal.y < 0) normal.negate();

  const fractions = profile === 'lobed'
    ? [0, 0.13, 0.27, 0.41, 0.56, 0.71, 0.85, 1]
    : [0, 0.18, 0.38, 0.6, 0.8, 1];
  const widths = profile === 'lobed'
    ? [0.08, 0.7, 0.38, 1, 0.44, 0.78, 0.32, 0.03]
    : profile === 'ovate'
      ? [0.08, 0.58, 0.94, 1, 0.62, 0.04]
      : [0.08, 0.55, 0.92, 1, 0.62, 0.03];
  const base = buffers.positions.length / 3;

  fractions.forEach((fraction, row) => {
    const center = root.clone().lerp(tip, fraction)
      .addScaledVector(normal, Math.sin(Math.PI * fraction) * halfWidth * 0.12);
    const windWeight = THREE.MathUtils.lerp(windWeightStart, 1, fraction);
    for (const sideSign of [-1, 1]) {
      appendVertex(buffers, vertex(
        center.clone().addScaledVector(side, halfWidth * widths[row]! * sideSign),
        normal,
        color,
        [sideSign < 0 ? 0 : 1, -0.001 - fraction],
        0,
        windWeight,
        structureMask,
      ));
    }
  });

  for (let row = 0; row < fractions.length - 1; row++) {
    const a = base + row * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    buffers.indices.push(a, b, c, b, d, c);
  }
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

function appendStemCrossRibbon(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  halfWidth: number,
  yaw: number,
  color: THREE.Color,
  structureMask: number,
  windWeightStart = 0,
): void {
  appendStemRibbon(
    buffers,
    root,
    tip,
    halfWidth,
    yaw,
    color,
    structureMask,
    windWeightStart,
  );
  appendStemRibbon(
    buffers,
    root,
    tip,
    halfWidth,
    yaw + Math.PI * 0.5,
    color,
    structureMask,
    windWeightStart,
  );
}

function appendStemRibbon(
  buffers: WildflowerBuffers,
  root: THREE.Vector3,
  tip: THREE.Vector3,
  halfWidth: number,
  yaw: number,
  color: THREE.Color,
  structureMask: number,
  windWeightStart: number,
): void {
  const side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))
    .multiplyScalar(halfWidth);
  const axis = tip.clone().sub(root).normalize();
  const normal = new THREE.Vector3().crossVectors(side, axis).normalize();
  const base = buffers.positions.length / 3;
  appendVertex(buffers, vertex(
    root.clone().sub(side),
    normal,
    color,
    [0, 0],
    0,
    windWeightStart,
    structureMask,
  ));
  appendVertex(buffers, vertex(
    root.clone().add(side),
    normal,
    color,
    [1, 0],
    0,
    windWeightStart,
    structureMask,
  ));
  appendVertex(buffers, vertex(
    tip.clone().sub(side),
    normal,
    color,
    [0, 3.25],
    0,
    1,
    structureMask,
  ));
  appendVertex(buffers, vertex(
    tip.clone().add(side),
    normal,
    color,
    [1, 3.25],
    0,
    1,
    structureMask,
  ));
  buffers.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
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

function appendPolylineTube(
  buffers: WildflowerBuffers,
  points: readonly THREE.Vector3[],
  radii: readonly number[],
  preferredRadial: THREE.Vector3,
  color: THREE.Color,
  structureMask: number,
  radialSegments = 5,
): void {
  const base = buffers.positions.length / 3;
  let transportedRadial = preferredRadial.clone();

  points.forEach((point, ring) => {
    const previous = points[Math.max(0, ring - 1)]!;
    const next = points[Math.min(points.length - 1, ring + 1)]!;
    const tangent = next.clone().sub(previous).normalize();
    transportedRadial.addScaledVector(tangent, -transportedRadial.dot(tangent));
    if (transportedRadial.lengthSq() < 1e-8) {
      transportedRadial.crossVectors(tangent, new THREE.Vector3(0, 1, 0));
      if (transportedRadial.lengthSq() < 1e-8) transportedRadial.set(1, 0, 0);
    }
    transportedRadial.normalize();
    const radialB = new THREE.Vector3().crossVectors(tangent, transportedRadial).normalize();

    for (let sideIndex = 0; sideIndex < radialSegments; sideIndex++) {
      const angle = (sideIndex / radialSegments) * Math.PI * 2;
      const radial = transportedRadial.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(radialB, Math.sin(angle));
      appendVertex(buffers, vertex(
        point.clone().addScaledVector(radial, radii[ring]!),
        radial,
        color,
        [sideIndex / radialSegments, ring / Math.max(points.length - 1, 1)],
        0,
        1,
        structureMask,
      ));
    }
  });

  for (let ring = 0; ring < points.length - 1; ring++) {
    for (let sideIndex = 0; sideIndex < radialSegments; sideIndex++) {
      const nextSide = (sideIndex + 1) % radialSegments;
      const a = base + ring * radialSegments + sideIndex;
      const b = base + ring * radialSegments + nextSide;
      const c = base + (ring + 1) * radialSegments + nextSide;
      const d = base + (ring + 1) * radialSegments + sideIndex;
      buffers.indices.push(a, b, c, a, c, d);
    }
  }
}

function appendSpindle(
  buffers: WildflowerBuffers,
  center: THREE.Vector3,
  axis: THREE.Vector3,
  length: number,
  radius: number,
  frameRadial: THREE.Vector3,
  color: THREE.Color,
  structureMask: number,
): void {
  const direction = axis.clone().normalize();
  const half = direction.clone().multiplyScalar(length * 0.5);
  const points = [
    center.clone().sub(half),
    center.clone().addScaledVector(direction, -length * 0.18),
    center.clone().addScaledVector(direction, length * 0.18),
    center.clone().add(half),
  ];
  appendPolylineTube(
    buffers,
    points,
    [radius * 0.12, radius, radius, radius * 0.12],
    frameRadial,
    color,
    structureMask,
  );
}

function appendLilyReproductiveOrgans(
  buffers: WildflowerBuffers,
  frame: FlowerFrame,
  flowerRadius: number,
  structureMask: number,
): void {
  const filamentColor = new THREE.Color(0xd98a3f);
  const antherColor = new THREE.Color(0x71341f);
  const styleColor = new THREE.Color(0xf2ad55);
  const stigmaColor = new THREE.Color(0xb76536);
  const filamentRadius = Math.max(0.00025, flowerRadius * 0.0068);
  const throatCenter = frame.surfaceCenter.clone().addScaledVector(
    frame.axisV,
    flowerRadius * LILY_THROAT_AXIS_V_OFFSET,
  );

  for (let index = 0; index < 6; index++) {
    const angle = (index / 6) * Math.PI * 2 + 0.17;
    const radial = frame.axisU.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(frame.axisV, Math.sin(angle));
    const tangent = frame.axisU.clone().multiplyScalar(-Math.sin(angle))
      .addScaledVector(frame.axisV, Math.cos(angle));
    const reach = flowerRadius * (0.31 + (index % 2) * 0.035);
    const root = throatCenter.clone()
      .addScaledVector(radial, flowerRadius * 0.012)
      .addScaledVector(frame.normal, flowerRadius * 0.018);
    const elbow = throatCenter.clone()
      .addScaledVector(radial, reach * 0.48)
      .addScaledVector(frame.normal, flowerRadius * (0.09 + (index % 3) * 0.014));
    const tip = throatCenter.clone()
      .addScaledVector(radial, reach)
      .addScaledVector(frame.normal, flowerRadius * (0.15 + (index % 2) * 0.025));
    appendPolylineTube(
      buffers,
      [root, elbow, tip],
      [filamentRadius, filamentRadius * 0.84, filamentRadius * 0.62],
      tangent,
      filamentColor,
      structureMask,
    );
    appendSpindle(
      buffers,
      tip.clone().addScaledVector(frame.normal, flowerRadius * 0.01),
      tangent,
      flowerRadius * 0.092,
      flowerRadius * 0.019,
      frame.normal,
      antherColor,
      structureMask,
    );
  }

  const styleRoot = throatCenter.clone()
    .addScaledVector(frame.normal, flowerRadius * 0.022);
  const styleElbow = throatCenter.clone()
    .addScaledVector(frame.axisU, flowerRadius * 0.024)
    .addScaledVector(frame.normal, flowerRadius * 0.13);
  const styleTip = throatCenter.clone()
    .addScaledVector(frame.axisU, flowerRadius * 0.052)
    .addScaledVector(frame.normal, flowerRadius * 0.24);
  appendPolylineTube(
    buffers,
    [styleRoot, styleElbow, styleTip],
    [filamentRadius * 1.18, filamentRadius, filamentRadius * 0.78],
    frame.axisV,
    styleColor,
    structureMask,
    6,
  );
  for (let lobe = 0; lobe < 3; lobe++) {
    const angle = (lobe / 3) * Math.PI * 2;
    const axis = frame.axisU.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(frame.axisV, Math.sin(angle));
    appendSpindle(
      buffers,
      styleTip.clone().addScaledVector(axis, flowerRadius * 0.015),
      axis,
      flowerRadius * 0.043,
      flowerRadius * 0.013,
      frame.normal,
      stigmaColor,
      structureMask,
    );
  }
}

function appendFlowerHeadCard(
  buffers: WildflowerBuffers,
  center: THREE.Vector3,
  yaw: number,
  radius: number,
  structureMask = 0,
  tilt = 0.24,
): FlowerFrame {
  const tiltDirection = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const normal = new THREE.Vector3(
    tiltDirection.x * tilt,
    0.95,
    tiltDirection.z * tilt,
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
    structureMask,
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
      structureMask,
    ));
  }
  for (let index = 0; index < segments; index++) {
    buffers.indices.push(base, base + index + 1, base + index + 2);
  }
  return {
    surfaceCenter: liftedCenter.clone().addScaledVector(normal, 0.0045),
    normal,
    axisU,
    axisV,
  };
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
  structureMask = 0,
): WildflowerVertex {
  return {
    position,
    normal,
    color,
    uv,
    flowerMask: flowerMask + structureMask * 2,
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
