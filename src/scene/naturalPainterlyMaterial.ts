import * as THREE from 'three';
import * as tsl from 'three/tsl';

/**
 * Material-local interpretation of Gabriel de Laubier's packed paint-stroke
 * workflow. Keeping this in the material graph (instead of post processing)
 * lets us opt natural surfaces in without touching characters, architecture,
 * water, or the sky.
 */

export const NATURAL_PAINTERLY_TEXTURE_SEED = 0x5041494e;
export const NATURAL_PAINTERLY_TEXTURE_SIGNATURE =
  'natural-paint-strokes-rg-normal-b-broad-a-detail-v1';

export const NATURAL_PAINTERLY_SURFACE_ROLES = [
  'terrain',
  'road',
  'soil',
  'grass',
  'foliage',
  'bark',
  'undergrowth',
] as const;

export type NaturalPainterlySurfaceRole =
  (typeof NATURAL_PAINTERLY_SURFACE_ROLES)[number];

export const NaturalPainterlyDebugMode = {
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

export type NaturalPainterlyDebugMode =
  (typeof NaturalPainterlyDebugMode)[keyof typeof NaturalPainterlyDebugMode];

type TslNode = {
  a: TslNode;
  add(value: unknown): TslNode;
  b: TslNode;
  clamp(minimum: unknown, maximum: unknown): TslNode;
  dFdx(): TslNode;
  dFdy(): TslNode;
  div(value: unknown): TslNode;
  g: TslNode;
  length(): TslNode;
  mul(value: unknown): TslNode;
  r: TslNode;
  rgb: TslNode;
  sub(value: unknown): TslNode;
  x: TslNode;
  xy: TslNode;
  xyz: TslNode;
  xz: TslNode;
  y: TslNode;
  z: TslNode;
};

type TslScalarUniform = TslNode & { value: number };
type TslVectorUniform = TslNode & { value: THREE.Vector3 };

type NaturalPainterlyNodeMaterial = THREE.Material & {
  color?: THREE.Color;
  colorNode?: TslNode | null;
  map?: THREE.Texture | null;
  normalNode?: TslNode | null;
  roughnessNode?: TslNode | null;
};

export type NaturalPainterlyMaterialOptions = {
  role: NaturalPainterlySurfaceRole;
  /** A scalar TSL node. Used by roads to leave bridge decking untouched. */
  coverageNode?: unknown;
};

type PainterlyRoleConfig = {
  uvScale: number;
  worldPhase: number;
  effectStrength: number;
  parallaxDepth: number;
  brushNormalStrength: number;
  toonStrength: number;
  reflectionStrength: number;
  rimStrength: number;
  shadowTint: readonly [number, number, number];
  lightTint: readonly [number, number, number];
};

const ROLE_CONFIG: Record<NaturalPainterlySurfaceRole, PainterlyRoleConfig> = {
  terrain: {
    uvScale: 24,
    worldPhase: 0.17,
    effectStrength: 0.82,
    parallaxDepth: 0.011,
    brushNormalStrength: 0.32,
    toonStrength: 0.3,
    reflectionStrength: 0.07,
    rimStrength: 0.1,
    shadowTint: [0.79, 0.83, 0.88],
    lightTint: [1.09, 1.045, 0.96],
  },
  road: {
    uvScale: 9,
    worldPhase: 0.24,
    effectStrength: 0.86,
    parallaxDepth: 0.014,
    brushNormalStrength: 0.38,
    toonStrength: 0.34,
    reflectionStrength: 0.08,
    rimStrength: 0.08,
    shadowTint: [0.78, 0.81, 0.86],
    lightTint: [1.1, 1.035, 0.93],
  },
  soil: {
    uvScale: 12,
    worldPhase: 0.21,
    effectStrength: 0.84,
    parallaxDepth: 0.013,
    brushNormalStrength: 0.36,
    toonStrength: 0.32,
    reflectionStrength: 0.075,
    rimStrength: 0.09,
    shadowTint: [0.79, 0.82, 0.86],
    lightTint: [1.09, 1.035, 0.94],
  },
  grass: {
    uvScale: 3.2,
    worldPhase: 0.13,
    effectStrength: 0.78,
    parallaxDepth: 0.007,
    brushNormalStrength: 0.48,
    toonStrength: 0.36,
    reflectionStrength: 0.07,
    rimStrength: 0.06,
    shadowTint: [0.76, 0.84, 0.8],
    lightTint: [1.08, 1.06, 0.94],
  },
  foliage: {
    uvScale: 4.4,
    worldPhase: 0.11,
    effectStrength: 0.8,
    parallaxDepth: 0.006,
    brushNormalStrength: 0.5,
    toonStrength: 0.38,
    reflectionStrength: 0.065,
    rimStrength: 0.055,
    shadowTint: [0.75, 0.83, 0.81],
    lightTint: [1.08, 1.055, 0.95],
  },
  bark: {
    uvScale: 5.8,
    worldPhase: 0.1,
    effectStrength: 0.84,
    parallaxDepth: 0.01,
    brushNormalStrength: 0.4,
    toonStrength: 0.35,
    reflectionStrength: 0.055,
    rimStrength: 0.12,
    shadowTint: [0.79, 0.81, 0.86],
    lightTint: [1.1, 1.035, 0.93],
  },
  undergrowth: {
    uvScale: 4,
    worldPhase: 0.14,
    effectStrength: 0.8,
    parallaxDepth: 0.007,
    brushNormalStrength: 0.46,
    toonStrength: 0.36,
    reflectionStrength: 0.065,
    rimStrength: 0.065,
    shadowTint: [0.76, 0.83, 0.81],
    lightTint: [1.08, 1.055, 0.95],
  },
};

const packedPaintTexture = createPackedPaintTexture();
const enabledUniform = tsl.uniform(1) as unknown as TslScalarUniform;
const debugModeUniform = tsl.uniform(0) as unknown as TslScalarUniform;
const lightDirectionUniform = tsl.uniform(
  new THREE.Vector3(0.42, 0.8, 0.34).normalize(),
) as unknown as TslVectorUniform;
const decoratedMaterials = new WeakSet<THREE.Material>();
let decoratedMaterialCount = 0;

// r185's runtime barrel contains these nodes, but its declarations omit them.
const tslRuntime = tsl as unknown as {
  positionViewDirection: TslNode;
  reflect(incident: unknown, normal: unknown): TslNode;
};

export function applyNaturalPainterlyMaterial<T extends THREE.Material>(
  material: T,
  options: NaturalPainterlyMaterialOptions,
): T {
  if (decoratedMaterials.has(material) || material.userData.naturalPainterly) {
    return material;
  }

  const target = material as T & NaturalPainterlyNodeMaterial;
  const originalColor = resolveOriginalColorNode(target);
  const config = ROLE_CONFIG[options.role];
  const coverage = (options.coverageNode ?? tsl.float(1)) as TslNode;

  const baseUv = (tsl.uv() as unknown as TslNode)
    .mul(tsl.float(config.uvScale))
    .add((tsl.positionWorld as unknown as TslNode).xz.mul(tsl.float(config.worldPhase)));
  const initialStroke = tsl.texture(packedPaintTexture, baseUv as never) as unknown as TslNode;
  const viewDirection = tsl.normalize(tslRuntime.positionViewDirection as never) as unknown as TslNode;
  const geometryNormal = tsl.normalize(tsl.normalViewGeometry) as unknown as TslNode;
  const grazingDenominator = tsl.max(
    tsl.abs(tsl.dot(geometryNormal as never, viewDirection as never)),
    tsl.float(0.28),
  ) as unknown as TslNode;
  const parallaxOffset = viewDirection.xy
    .div(grazingDenominator)
    .mul(initialStroke.b.sub(tsl.float(0.5)))
    .mul(tsl.float(config.parallaxDepth));
  const paintUv = baseUv.add(parallaxOffset);
  const packedStroke = tsl.texture(packedPaintTexture, paintUv as never) as unknown as TslNode;

  // RG is a randomized paint-stroke normal. It intentionally perturbs the
  // custom toon/reflection response, while the original material normal graph
  // remains responsible for PBR lighting and therefore survives an OFF toggle.
  const brushXY = packedStroke.xy.mul(tsl.float(2)).sub(tsl.float(1));
  const brushNormal = tsl.normalize(
    geometryNormal.add(tsl.vec3(
      brushXY.x.mul(tsl.float(config.brushNormalStrength)),
      brushXY.y.mul(tsl.float(config.brushNormalStrength)),
      tsl.float(0),
    )),
  ) as unknown as TslNode;
  const viewLightDirection = tsl.normalize(
    (tsl.cameraViewMatrix as unknown as TslNode).mul(tsl.vec4(lightDirectionUniform, 0)).xyz,
  ) as unknown as TslNode;
  const diffuseResponse = (tsl.dot(
    brushNormal as never,
    viewLightDirection as never,
  ) as unknown as TslNode)
    .mul(tsl.float(0.5))
    .add(tsl.float(0.5)) as unknown as TslNode;
  const lowerBand = debugStep(0.34, diffuseResponse);
  const upperBand = debugStep(0.68, diffuseResponse);
  // Exactly the reference's three authored values: 0, .25, and 1.
  const toonBands = lowerBand.mul(tsl.float(0.25)).add(upperBand.mul(tsl.float(0.75)));

  const baseRgb = originalColor.rgb;
  const broadStroke = tsl.smoothstep(
    tsl.float(0.12),
    tsl.float(0.88),
    packedStroke.b as never,
  ) as unknown as TslNode;
  const detailStroke = tsl.smoothstep(
    tsl.float(0.28),
    tsl.float(0.8),
    packedStroke.a as never,
  ) as unknown as TslNode;
  const pigmentShadow = baseRgb.mul(tsl.vec3(...config.shadowTint));
  const pigmentLight = baseRgb.mul(tsl.vec3(...config.lightTint));
  let paintedRgb = tsl.mix(
    pigmentShadow,
    pigmentLight,
    broadStroke as never,
  ) as unknown as TslNode;
  const dryBrushGain = tsl.mix(
    tsl.float(0.92),
    tsl.float(1.075),
    detailStroke as never,
  ) as unknown as TslNode;
  paintedRgb = paintedRgb.mul(dryBrushGain);

  const toonTint = tsl.mix(
    tsl.vec3(0.78, 0.82, 0.9),
    tsl.vec3(1.085, 1.045, 0.96),
    toonBands as never,
  ) as unknown as TslNode;
  paintedRgb = paintedRgb.mul(tsl.mix(
    tsl.vec3(1),
    toonTint as never,
    tsl.float(config.toonStrength),
  ));

  // Swizzled/pivoted UVs prevent the oily reflection strokes from sitting on
  // top of the diffuse strokes, matching the key trick in the source material.
  const reflected = tslRuntime.reflect(
    viewDirection.mul(tsl.float(-1)) as never,
    brushNormal as never,
  ) as unknown as TslNode;
  const reflectionAlignment = tsl.pow(
    tsl.max(tsl.dot(reflected as never, viewLightDirection as never), tsl.float(0)),
    tsl.float(9),
  ) as unknown as TslNode;
  const reflectionUv = tsl.vec2(
    paintUv.y.add(broadStroke.mul(tsl.float(0.17))),
    paintUv.x.mul(tsl.float(-1)).add(detailStroke.mul(tsl.float(0.11))),
  );
  const reflectionStroke = tsl.texture(
    packedPaintTexture,
    reflectionUv,
  ) as unknown as TslNode;
  const reflectionMask = reflectionAlignment
    .mul(tsl.smoothstep(
      tsl.float(0.34),
      tsl.float(0.86),
      reflectionStroke.a as never,
    ))
    .mul(tsl.float(config.reflectionStrength));
  const oilColor = tsl.mix(
    tsl.vec3(0.08, 0.2, 0.23),
    tsl.vec3(0.34, 0.16, 0.075),
    reflectionStroke.r as never,
  ) as unknown as TslNode;
  paintedRgb = paintedRgb.add(oilColor.mul(reflectionMask));

  // The reference erodes an inflated duplicate mesh at the rim. Duplicating
  // every terrain/forest instance would be prohibitive, and eroding alpha cards
  // would shimmer, so phase one uses the same Fresnel/detail/curvature causes
  // as stable pigment erosion without changing coverage or silhouettes.
  const facing = tsl.max(
    tsl.dot(geometryNormal as never, viewDirection as never),
    tsl.float(0),
  ) as unknown as TslNode;
  const fresnel = tsl.pow(
    (tsl.float(1) as unknown as TslNode).sub(facing) as never,
    tsl.float(2.2),
  ) as unknown as TslNode;
  const curvature = tsl.smoothstep(
    tsl.float(0.018),
    tsl.float(0.22),
    geometryNormal.dFdx().length().add(geometryNormal.dFdy().length()),
  ) as unknown as TslNode;
  const rimErosion = fresnel
    .mul(curvature)
    .mul(detailStroke)
    .mul(tsl.float(config.rimStrength));
  paintedRgb = tsl.mix(
    paintedRgb as never,
    paintedRgb.mul(tsl.vec3(0.56, 0.66, 0.76)) as never,
    rimErosion as never,
  ) as unknown as TslNode;

  // Keep the authored PBR graphs as the OFF branch. The brush normal and
  // dry/oily roughness only enter through the same shared live uniform.
  const surfacePaintAmount = enabledUniform
    .mul(coverage)
    .mul(tsl.float(config.effectStrength))
    .clamp(tsl.float(0), tsl.float(1));
  if (target.normalNode) {
    const originalNormal = target.normalNode;
    const strokeNormal = tsl.normalize(tsl.mix(
      originalNormal as never,
      brushNormal as never,
      tsl.float(0.42),
    )) as unknown as TslNode;
    target.normalNode = tsl.mix(
      originalNormal as never,
      strokeNormal as never,
      surfacePaintAmount.mul(tsl.float(0.62)) as never,
    ) as unknown as TslNode;
  }
  if (target.roughnessNode) {
    const originalRoughness = target.roughnessNode;
    const strokeRoughness = originalRoughness
      .mul(tsl.mix(tsl.float(0.9), tsl.float(1.07), broadStroke as never))
      .add(detailStroke.mul(tsl.float(0.035)))
      .sub(reflectionMask.mul(tsl.float(0.32)))
      .clamp(tsl.float(0.08), tsl.float(1));
    target.roughnessNode = tsl.mix(
      originalRoughness as never,
      strokeRoughness as never,
      surfacePaintAmount.mul(tsl.float(0.58)) as never,
    ) as unknown as TslNode;
  }

  let debugRgb = paintedRgb;
  debugRgb = selectDebug(debugRgb, baseRgb, NaturalPainterlyDebugMode.Original);
  debugRgb = selectDebug(
    debugRgb,
    tsl.vec3(broadStroke),
    NaturalPainterlyDebugMode.BroadStroke,
  );
  debugRgb = selectDebug(
    debugRgb,
    tsl.vec3(detailStroke),
    NaturalPainterlyDebugMode.DetailStroke,
  );
  debugRgb = selectDebug(
    debugRgb,
    brushNormal.mul(tsl.float(0.5)).add(tsl.float(0.5)),
    NaturalPainterlyDebugMode.BrushNormal,
  );
  debugRgb = selectDebug(
    debugRgb,
    tsl.vec3(toonBands),
    NaturalPainterlyDebugMode.ToonBands,
  );
  debugRgb = selectDebug(
    debugRgb,
    oilColor.mul(reflectionMask.mul(tsl.float(4))).clamp(tsl.float(0), tsl.float(1)),
    NaturalPainterlyDebugMode.OilReflection,
  );
  debugRgb = selectDebug(
    debugRgb,
    tsl.vec3(rimErosion.mul(tsl.float(5)).clamp(tsl.float(0), tsl.float(1))),
    NaturalPainterlyDebugMode.RimErosion,
  );
  debugRgb = selectDebug(
    debugRgb,
    tsl.vec3(coverage),
    NaturalPainterlyDebugMode.ScopeMask,
  );

  const debugActive = tsl.smoothstep(
    tsl.float(0.25),
    tsl.float(0.75),
    debugModeUniform as never,
  ) as unknown as TslNode;
  const configuredStrength = tsl.mix(
    tsl.float(config.effectStrength),
    tsl.float(1),
    debugActive as never,
  ) as unknown as TslNode;
  const enabledAmount = enabledUniform.mul(coverage).mul(configuredStrength).clamp(
    tsl.float(0),
    tsl.float(1),
  );
  const finalRgb = tsl.mix(baseRgb, debugRgb as never, enabledAmount as never) as unknown as TslNode;
  // SplitNode expands a vec3 source to vec4 when `.a` is requested, yielding
  // alpha=1. Vec4 foliage graphs retain their exact authored alpha expression.
  target.colorNode = tsl.vec4(finalRgb, originalColor.a) as unknown as TslNode;

  decoratedMaterials.add(material);
  decoratedMaterialCount += 1;
  material.userData.naturalPainterly = {
    version: 1,
    role: options.role,
    textureSignature: NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
  };
  return material;
}

export function setNaturalPainterlyMaterialEnabled(enabled: boolean): void {
  enabledUniform.value = enabled ? 1 : 0;
}

export function getNaturalPainterlyMaterialEnabled(): boolean {
  return enabledUniform.value >= 0.5;
}

export function setNaturalPainterlyDebugMode(mode: NaturalPainterlyDebugMode): void {
  debugModeUniform.value = THREE.MathUtils.clamp(
    Math.round(Number.isFinite(mode) ? mode : NaturalPainterlyDebugMode.Final),
    NaturalPainterlyDebugMode.Final,
    NaturalPainterlyDebugMode.ScopeMask,
  );
}

export function getNaturalPainterlyDebugMode(): NaturalPainterlyDebugMode {
  return debugModeUniform.value as NaturalPainterlyDebugMode;
}

export function setNaturalPainterlyLightDirection(direction: THREE.Vector3): void {
  if (direction.lengthSq() <= 1e-8) return;
  lightDirectionUniform.value.copy(direction).normalize();
}

export function getNaturalPainterlyMaterialState(): {
  enabledUniform: TslScalarUniform;
  debugModeUniform: TslScalarUniform;
  lightDirectionUniform: TslVectorUniform;
  packedTexture: THREE.DataTexture;
  decoratedMaterialCount: number;
} {
  return {
    enabledUniform,
    debugModeUniform,
    lightDirectionUniform,
    packedTexture: packedPaintTexture,
    decoratedMaterialCount,
  };
}

function resolveOriginalColorNode(material: NaturalPainterlyNodeMaterial): TslNode {
  if (material.colorNode) return material.colorNode;
  const tint = tsl.uniform(material.color?.clone() ?? new THREE.Color(0xffffff));
  if (material.map) {
    return (tsl.texture(material.map) as unknown as TslNode)
      .mul(tsl.vec4(tint, 1));
  }
  return tsl.vec4(tint, 1) as unknown as TslNode;
}

function selectDebug(current: TslNode, diagnostic: unknown, mode: NaturalPainterlyDebugMode): TslNode {
  const lower = tsl.smoothstep(
    tsl.float(mode - 0.49),
    tsl.float(mode - 0.48),
    debugModeUniform as never,
  ) as unknown as TslNode;
  const upper = (tsl.float(1) as unknown as TslNode).sub(tsl.smoothstep(
    tsl.float(mode + 0.48),
    tsl.float(mode + 0.49),
    debugModeUniform as never,
  )) as unknown as TslNode;
  return tsl.mix(current as never, diagnostic as never, lower.mul(upper) as never) as unknown as TslNode;
}

/** Runtime-typed replacement for step; @types/three omitted it in r185. */
function debugStep(edge: number, value: TslNode): TslNode {
  return tsl.smoothstep(
    tsl.float(edge - 0.002),
    tsl.float(edge + 0.002),
    value as never,
  ) as unknown as TslNode;
}

function createPackedPaintTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const random = createDeterministicRandom(NATURAL_PAINTERLY_TEXTURE_SEED);

  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    const grain = Math.floor(random() * 11) - 5;
    data[offset] = 128;
    data[offset + 1] = 128;
    data[offset + 2] = THREE.MathUtils.clamp(112 + grain, 0, 255);
    data[offset + 3] = THREE.MathUtils.clamp(22 + grain, 0, 255);
  }

  for (let stroke = 0; stroke < 190; stroke += 1) {
    const angle = random() * Math.PI * 2;
    const normalAngle = angle + (random() - 0.5) * 1.2;
    splatStroke(data, size, {
      centerX: random() * size,
      centerY: random() * size,
      angle,
      halfLength: 5 + random() * 18,
      halfWidth: 1.4 + random() * 4.2,
      normalX: Math.cos(normalAngle) * (0.3 + random() * 0.62),
      normalY: Math.sin(normalAngle) * (0.3 + random() * 0.62),
      broad: 0.1 + random() * 0.84,
      detail: 0.12 + random() * 0.28,
      opacity: 0.42 + random() * 0.5,
    });
  }

  for (let stroke = 0; stroke < 430; stroke += 1) {
    const angle = random() * Math.PI * 2;
    splatStroke(data, size, {
      centerX: random() * size,
      centerY: random() * size,
      angle,
      halfLength: 1.8 + random() * 7,
      halfWidth: 0.55 + random() * 1.7,
      normalX: Math.cos(angle) * (0.14 + random() * 0.3),
      normalY: Math.sin(angle) * (0.14 + random() * 0.3),
      broad: 0.3 + random() * 0.45,
      detail: 0.5 + random() * 0.5,
      opacity: 0.48 + random() * 0.48,
    });
  }

  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'Natural painterly packed RG-normal B-broad A-detail';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  texture.userData.naturalPainterly = {
    seed: NATURAL_PAINTERLY_TEXTURE_SEED,
    signature: NATURAL_PAINTERLY_TEXTURE_SIGNATURE,
    channels: {
      rg: 'randomized paint-stroke normal XY',
      b: 'broad diffuse and parallax-height stroke',
      a: 'fine high-contrast dry-brush stroke',
    },
  };
  return texture;
}

type StrokeSplat = {
  centerX: number;
  centerY: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
  normalX: number;
  normalY: number;
  broad: number;
  detail: number;
  opacity: number;
};

function splatStroke(
  data: Uint8Array,
  size: number,
  stroke: StrokeSplat,
): void {
  const cosine = Math.cos(stroke.angle);
  const sine = Math.sin(stroke.angle);
  const radius = Math.ceil(stroke.halfLength + stroke.halfWidth + 2);
  const minX = Math.floor(stroke.centerX) - radius;
  const maxX = Math.ceil(stroke.centerX) + radius;
  const minY = Math.floor(stroke.centerY) - radius;
  const maxY = Math.ceil(stroke.centerY) + radius;

  for (let sourceY = minY; sourceY <= maxY; sourceY += 1) {
    for (let sourceX = minX; sourceX <= maxX; sourceX += 1) {
      const deltaX = sourceX + 0.5 - stroke.centerX;
      const deltaY = sourceY + 0.5 - stroke.centerY;
      const along = (deltaX * cosine + deltaY * sine) / stroke.halfLength;
      const across = (-deltaX * sine + deltaY * cosine) / stroke.halfWidth;
      const distance = Math.sqrt(along * along + across * across);
      if (distance >= 1) continue;

      const bristle = 0.72 + 0.28 * Math.cos(across * 11 + along * 5.3);
      const feather = (1 - distance * distance) * bristle * stroke.opacity;
      const x = ((sourceX % size) + size) % size;
      const y = ((sourceY % size) + size) % size;
      const offset = (y * size + x) * 4;
      blendByte(data, offset, 128 + stroke.normalX * 105, feather * 0.72);
      blendByte(data, offset + 1, 128 + stroke.normalY * 105, feather * 0.72);
      blendByte(data, offset + 2, stroke.broad * 255, feather);
      blendByte(data, offset + 3, stroke.detail * 255, feather);
    }
  }
}

function blendByte(data: Uint8Array, index: number, target: number, amount: number): void {
  data[index] = THREE.MathUtils.clamp(
    Math.round(THREE.MathUtils.lerp(data[index] ?? 0, target, THREE.MathUtils.clamp(amount, 0, 1))),
    0,
    255,
  );
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
