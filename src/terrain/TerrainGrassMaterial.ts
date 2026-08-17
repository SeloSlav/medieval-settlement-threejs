import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  bumpMap,
  cameraPosition,
  float,
  fract,
  fwidth,
  max,
  mix,
  normalMap,
  normalize,
  pow,
  positionWorld,
  smoothstep,
  sub,
  texture,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import {
  DIRT_PROXIMITY_INNER_SQ,
  DIRT_PROXIMITY_OUTER_SQ,
} from '../grass/grassLodMath.ts';
import type { RoadWeatherUniforms } from '../roads/RoadSurfaceMaterial.ts';
import type { TextureSet } from '../roads/RoadTextureLoader.ts';
import type { TerrainBlendTextureSet } from '../roads/RoadTextureLoader.ts';

type TslNode = {
  abs(): TslNode;
  add(value: TslNode): TslNode;
  dFdx(): TslNode;
  dFdy(): TslNode;
  div(value: TslNode): TslNode;
  grad(gradX: TslNode, gradY: TslNode): TslNode;
  level(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  sub(value: TslNode): TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  rgb: TslNode;
  xyz: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
};

export const TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR = 1;
export const TERRAIN_FULL_RAIN_NORMAL_DETAIL_FLOOR = 0.04;
export const TERRAIN_FULL_RAIN_AO_DETAIL_FLOOR = 0.04;
export const TERRAIN_FULL_RAIN_ROUGHNESS_DETAIL_FLOOR = 0.08;
export const TERRAIN_FULL_RAIN_DIRT_DETAIL_FLOOR = 1;
export const TERRAIN_SNOW_REVEAL_WIDTH = 0.2;
export const TERRAIN_SNOW_REVEAL_RANGE = 1.22;
export const TERRAIN_SNOW_TEXTURE_WEIGHT = 0.54;
export const TERRAIN_SNOW_MAX_COVERAGE = 0.96;
export const TERRAIN_SHORE_RAIN_FADE_START = 0.08;
export const TERRAIN_SHORE_RAIN_FADE_END = 0.72;
export const TERRAIN_SHORE_BLEND_FLOOR = 0.045;
export const TERRAIN_ROAD_WEAR_BLEND_FLOOR = 0.055;

export function stableTerrainBlendWeight(
  raw: number,
  floor: number,
): number {
  const t = Math.max(0, Math.min(1, (raw - floor) / (1 - floor)));
  return t * t * (3 - 2 * t);
}

export function terrainShoreRainVisibility(wetness: number): number {
  const t = Math.max(
    0,
    Math.min(
      1,
      (wetness - TERRAIN_SHORE_RAIN_FADE_START)
        / (TERRAIN_SHORE_RAIN_FADE_END - TERRAIN_SHORE_RAIN_FADE_START),
    ),
  );
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Maps an unbounded terrain coordinate onto a continuous mirrored unit tile.
 * Packed atlas regions cannot rely on the texture sampler's wrap mode in V,
 * because the sampler would cross into a neighbouring material region.
 */
export function mirroredTerrainAtlasCoordinate(value: number): number {
  const half = value * 0.5;
  const halfFraction = half - Math.floor(half);
  return 1 - Math.abs(halfFraction * 2 - 1);
}

function resolveTerrainWeather(
  weather?: RoadWeatherUniforms,
): RoadWeatherUniforms {
  if (weather?.wetness && weather?.frost) return weather;
  return {
    wetness: float(0) as unknown as RoadWeatherUniforms['wetness'],
    frost: float(0) as unknown as RoadWeatherUniforms['frost'],
  };
}

function mirroredTerrainAtlasUv(sourceUv: TslNode): TslNode {
  // Manual fract-only wrapping creates a jump from one image edge to the
  // other at every integer UV. The authored snow and litter are not edge-
  // matched, so that jump appeared as evenly spaced dashed seams across the
  // terrain. A triangle-wave fold meets each repeated tile at the same image
  // edge and preserves continuity while keeping packed V samples isolated.
  return sub(
    float(1) as TslNode,
    (fract(sourceUv.mul(float(0.5) as TslNode)) as TslNode)
      .mul(float(2) as TslNode)
      .sub(float(1) as TslNode)
      .abs(),
  ) as TslNode;
}

function packedDrySnowUv(grassUv: TslNode, snow: boolean): TslNode {
  const tileUv = mirroredTerrainAtlasUv(grassUv);
  // Texture.flipY maps the image rows to forest, snow, then dry from low to
  // high V. Small gutters keep neighbouring materials out of generated mips.
  return vec2(
    tileUv.x,
    tileUv.y
      .mul(float(0.329) as TslNode)
      .add(float(snow ? 0.335 : 0.668) as TslNode),
  ) as TslNode;
}

function packedForestLitterUv(forestUv: TslNode): TslNode {
  const tileUv = mirroredTerrainAtlasUv(forestUv);
  // Keep a full-mip safety border inside the leaf third of the packed atlas.
  // Without this inset, distant litter samples can pull pale snow texels into
  // the tile and turn its repeated wrap seams into straight white dashes.
  return vec2(
    tileUv.x,
    tileUv.y
      .mul(float(0.28) as TslNode)
      .add(float(0.026) as TslNode),
  ) as TslNode;
}

function packedForestLitterGradient(gradient: TslNode): TslNode {
  return vec2(
    gradient.x,
    gradient.y.mul(float(0.28) as TslNode),
  ) as TslNode;
}

function buildGrassBlendNodes(
  textures: TerrainBlendTextureSet,
  weather: RoadWeatherUniforms,
) {
  const grassUv = uv() as TslNode;
  const weightsRaw = (vertexColor() as TslNode).xyz;
  const weightSum = max(weightsRaw.x.add(weightsRaw.y).add(weightsRaw.z), float(0.0001) as TslNode) as TslNode;
  const w = weightsRaw.div(weightSum);

  // Give every authored grass family its own orientation and scale. Sharing a
  // UV made their mip tails line up at strategic zoom, so three samples read as
  // a single repeated grass map instead of interwoven ground cover.
  const meadowUv = grassUv;
  const denseUv = vec2(
    grassUv.x
      .mul(float(0.78) as TslNode)
      .sub(grassUv.y.mul(float(0.56) as TslNode))
      .add(float(0.37) as TslNode),
    grassUv.x
      .mul(float(0.56) as TslNode)
      .add(grassUv.y.mul(float(0.78) as TslNode))
      .add(float(0.19) as TslNode),
  ) as TslNode;
  const dryUv = vec2(
    grassUv.x
      .mul(float(0.65) as TslNode)
      .add(grassUv.y.mul(float(0.69) as TslNode))
      .add(float(0.61) as TslNode),
    grassUv.x
      .mul(float(-0.69) as TslNode)
      .add(grassUv.y.mul(float(0.65) as TslNode))
      .add(float(0.43) as TslNode),
  ) as TslNode;
  // Leaf forms need a much smaller world scale than grass clumps. Rotation
  // breaks alignment with every meadow family while keeping the generated
  // tile stable in world space at all camera distances.
  const forestUv = vec2(
    grassUv.x
      .mul(float(9) as TslNode)
      .sub(grassUv.y.mul(float(7.6) as TslNode))
      .add(float(0.23) as TslNode),
    grassUv.x
      .mul(float(7.6) as TslNode)
      .add(grassUv.y.mul(float(9) as TslNode))
      .add(float(0.67) as TslNode),
  ) as TslNode;
  const meadowColor = texture(textures.meadow.albedo, meadowUv) as TslNode;
  const denseColor = texture(textures.dense.albedo, denseUv) as TslNode;
  const dryColor = texture(
    textures.dry.albedo,
    packedDrySnowUv(dryUv, false),
  ) as TslNode;
  const forestColor = (texture(
    textures.dry.albedo,
    packedForestLitterUv(forestUv),
  ) as TslNode).grad(
    packedForestLitterGradient(forestUv.dFdx()),
    packedForestLitterGradient(forestUv.dFdy()),
  ) as TslNode;
  const forestBlend = smoothstep(
    float(0.04) as TslNode,
    float(0.96) as TslNode,
    attribute('forestBlend', 'float') as TslNode,
  ) as TslNode;
  const forestLuminance = forestColor.r
    .mul(float(0.299) as TslNode)
    .add(forestColor.g.mul(float(0.587) as TslNode))
    .add(forestColor.b.mul(float(0.114) as TslNode)) as TslNode;
  const forestGrain = smoothstep(
    float(0.008) as TslNode,
    float(0.12) as TslNode,
    forestLuminance,
  ) as TslNode;
  // The atlas is already an authored sRGB albedo. Keep its decoded linear
  // luminance intact at close range instead of applying a second brown tint.
  const forestDetailColorNode = forestColor.rgb;
  // Bound the high-frequency litter contrast for mip-stable views while
  // preserving the atlas mean. The former near-black remap halved the source
  // luminance before lighting and made the whole forest footprint a dark basin.
  const forestDetailStableColorNode = mix(
    vec3(0.024, 0.015, 0.01) as TslNode,
    vec3(0.16, 0.095, 0.055) as TslNode,
    forestGrain,
  ) as TslNode;
  const blendedColor = meadowColor.rgb
    .mul(w.x)
    .add(denseColor.rgb.mul(w.y))
    .add(dryColor.rgb.mul(w.z));
  const zoomDetailGate = attribute('dirtZoomGate', 'float') as TslNode;
  const texelFootprint = max(
    fwidth(grassUv.x) as TslNode,
    fwidth(grassUv.y) as TslNode,
  ) as TslNode;
  const footprintDetailGate = sub(
    float(1) as TslNode,
    smoothstep(
      float(0.00075) as TslNode,
      float(0.0022) as TslNode,
      texelFootprint,
    ) as TslNode,
  ) as TslNode;
  const closeMaterialDetail = zoomDetailGate.mul(footprintDetailGate) as TslNode;
  const world = positionWorld as TslNode;
  // Low-frequency samples of the authored grass maps form irregular coverage
  // splotches. Their different rotations, scales and offsets prevent any one
  // direction or repetition interval from spanning the whole strategic map.
  // Reusing existing albedo bindings adds no new sampler resources.
  const meadowPatchUv = meadowUv
    .mul(float(0.024) as TslNode)
    .add(vec2(0.17, 0.63) as TslNode) as TslNode;
  const densePatchUv = denseUv
    .mul(float(0.019) as TslNode)
    .add(vec2(0.74, 0.29) as TslNode) as TslNode;
  const dryPatchUv = dryUv
    .mul(float(0.029) as TslNode)
    .add(vec2(0.41, 0.86) as TslNode) as TslNode;
  const meadowPatchColor = (texture(
    textures.meadow.albedo,
    meadowPatchUv,
  ) as TslNode).level(float(2) as TslNode) as TslNode;
  const densePatchColor = (texture(
    textures.dense.albedo,
    densePatchUv,
  ) as TslNode).level(float(2) as TslNode) as TslNode;
  const dryPatchColor = (texture(
    textures.dry.albedo,
    packedDrySnowUv(dryPatchUv, false),
  ) as TslNode).level(float(2) as TslNode) as TslNode;
  const meadowPatch = smoothstep(
    float(0.035) as TslNode,
    float(0.17) as TslNode,
    meadowPatchColor.r
      .mul(float(0.299) as TslNode)
      .add(meadowPatchColor.g.mul(float(0.587) as TslNode))
      .add(meadowPatchColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const densePatch = smoothstep(
    float(0.016) as TslNode,
    float(0.105) as TslNode,
    densePatchColor.r
      .mul(float(0.299) as TslNode)
      .add(densePatchColor.g.mul(float(0.587) as TslNode))
      .add(densePatchColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const dryPatch = smoothstep(
    float(0.055) as TslNode,
    float(0.28) as TslNode,
    dryPatchColor.r
      .mul(float(0.299) as TslNode)
      .add(dryPatchColor.g.mul(float(0.587) as TslNode))
      .add(dryPatchColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const macroA = meadowPatch
    .mul(float(0.58) as TslNode)
    .add((sub(float(1) as TslNode, densePatch) as TslNode).mul(float(0.27) as TslNode))
    .add(dryPatch.mul(float(0.15) as TslNode)) as TslNode;
  const macroB = dryPatch
    .mul(float(0.58) as TslNode)
    .add(densePatch.mul(float(0.27) as TslNode))
    .add((sub(float(1) as TslNode, meadowPatch) as TslNode).mul(float(0.15) as TslNode)) as TslNode;
  const macro = macroA.mul(float(0.68) as TslNode).add(macroB.mul(float(0.32) as TslNode));
  // Strategic cameras cannot resolve individual leaf silhouettes, but the
  // woodland ground should still read as leaf litter rather than a flat brown
  // biome tint. Preserve a contrast-bounded version of the authored atlas at
  // every zoom, then reveal its full color as the camera and pixel footprint
  // can support it. The bounded overview colors keep twig-shaped texels from
  // aliasing into bright screen-space dashes.
  const forestOverviewVariation = macroA
    .mul(float(0.62) as TslNode)
    .add(macroB.mul(float(0.38) as TslNode)) as TslNode;
  const forestOverviewColorNode = mix(
    vec3(0.032, 0.02, 0.012) as TslNode,
    vec3(0.092, 0.055, 0.03) as TslNode,
    forestOverviewVariation,
  ) as TslNode;
  const forestOverviewTexturedColorNode = mix(
    forestOverviewColorNode,
    forestDetailStableColorNode,
    float(0.72) as TslNode,
  ) as TslNode;
  const forestColorNode = mix(
    forestOverviewTexturedColorNode,
    forestDetailColorNode,
    closeMaterialDetail,
  ) as TslNode;
  const forestStableColorNode = mix(
    forestOverviewTexturedColorNode,
    forestDetailStableColorNode,
    closeMaterialDetail,
  ) as TslNode;

  // Strategic zoom uses three broad, overlapping coverages instead of the
  // near-camera vertex mix alone. A small baseline keeps each texture present;
  // the three independent fields then gather light meadow, pale dry grass and
  // dense green into soft-edged islands with substantial overlap between them.
  const lightOverlap = smoothstep(
    float(0.22) as TslNode,
    float(0.78) as TslNode,
    meadowPatch
      .mul(float(0.72) as TslNode)
      .add((sub(float(1) as TslNode, densePatch) as TslNode).mul(float(0.18) as TslNode))
      .add((sub(float(1) as TslNode, dryPatch) as TslNode).mul(float(0.1) as TslNode)) as TslNode,
  ) as TslNode;
  const darkOverlap = smoothstep(
    float(0.22) as TslNode,
    float(0.78) as TslNode,
    densePatch
      .mul(float(0.72) as TslNode)
      .add((sub(float(1) as TslNode, meadowPatch) as TslNode).mul(float(0.18) as TslNode))
      .add(dryPatch.mul(float(0.1) as TslNode)) as TslNode,
  ) as TslNode;
  const dryOverlap = smoothstep(
    float(0.22) as TslNode,
    float(0.78) as TslNode,
    dryPatch
      .mul(float(0.72) as TslNode)
      .add((sub(float(1) as TslNode, meadowPatch) as TslNode).mul(float(0.18) as TslNode))
      .add((sub(float(1) as TslNode, densePatch) as TslNode).mul(float(0.1) as TslNode)) as TslNode,
  ) as TslNode;
  const overviewLightWeight = w.x
    .mul(float(0.25) as TslNode)
    .add(lightOverlap.mul(float(0.68) as TslNode))
    .add(float(0.08) as TslNode) as TslNode;
  const overviewDarkWeight = w.y
    .mul(float(0.18) as TslNode)
    .add(darkOverlap.mul(float(0.62) as TslNode))
    .add(float(0.035) as TslNode) as TslNode;
  const overviewDryWeight = w.z
    .mul(float(0.15) as TslNode)
    .add(dryOverlap.mul(float(0.58) as TslNode))
    .add(float(0.035) as TslNode) as TslNode;
  const overviewWeightSum = max(
    overviewLightWeight.add(overviewDarkWeight).add(overviewDryWeight),
    float(0.0001) as TslNode,
  ) as TslNode;
  const overviewLight = overviewLightWeight.div(overviewWeightSum) as TslNode;
  const overviewDark = overviewDarkWeight.div(overviewWeightSum) as TslNode;
  const overviewDry = overviewDryWeight.div(overviewWeightSum) as TslNode;

  // Linear-space target families: fresh meadow green, shaded dark grass, and
  // a restrained green-dry layer. The authored albedos still supply the grain,
  // with a stable base preventing their distant mip averages from flattening.
  const overviewLightColor = vec3(0.12, 0.24, 0.045) as TslNode;
  const overviewDarkColor = vec3(0.022, 0.052, 0.01) as TslNode;
  const overviewDryColor = vec3(0.2, 0.225, 0.065) as TslNode;
  const overviewBaseColor = overviewLightColor
    .mul(overviewLight)
    .add(overviewDarkColor.mul(overviewDark))
    .add(overviewDryColor.mul(overviewDry));
  const meadowGrain = smoothstep(
    float(0.025) as TslNode,
    float(0.22) as TslNode,
    meadowColor.r
      .mul(float(0.299) as TslNode)
      .add(meadowColor.g.mul(float(0.587) as TslNode))
      .add(meadowColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const denseGrain = smoothstep(
    float(0.018) as TslNode,
    float(0.16) as TslNode,
    denseColor.r
      .mul(float(0.299) as TslNode)
      .add(denseColor.g.mul(float(0.587) as TslNode))
      .add(denseColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const dryGrain = smoothstep(
    float(0.04) as TslNode,
    float(0.32) as TslNode,
    dryColor.r
      .mul(float(0.299) as TslNode)
      .add(dryColor.g.mul(float(0.587) as TslNode))
      .add(dryColor.b.mul(float(0.114) as TslNode)) as TslNode,
  ) as TslNode;
  const overviewSampleColor = (mix(
    overviewLightColor.mul(float(0.62) as TslNode),
    overviewLightColor.mul(float(1.38) as TslNode),
    meadowGrain,
  ) as TslNode)
    .mul(overviewLight)
    .add((mix(
      overviewDarkColor.mul(float(0.6) as TslNode),
      overviewDarkColor.mul(float(1.4) as TslNode),
      denseGrain,
    ) as TslNode).mul(overviewDark))
    .add((mix(
      overviewDryColor.mul(float(0.62) as TslNode),
      overviewDryColor.mul(float(1.38) as TslNode),
      dryGrain,
    ) as TslNode).mul(overviewDry));
  const overviewTexturedColor = mix(
    overviewBaseColor,
    overviewSampleColor,
    float(0.88) as TslNode,
  ) as TslNode;
  const grassColorNode = mix(
    overviewTexturedColor,
    blendedColor,
    closeMaterialDetail,
  ) as TslNode;
  const grassStableColorNode = mix(
    overviewBaseColor,
    (vec3(0.085, 0.13, 0.035) as TslNode)
      .mul(w.x)
      .add((vec3(0.038, 0.066, 0.02) as TslNode).mul(w.y))
      .add((vec3(0.145, 0.16, 0.055) as TslNode).mul(w.z)),
    closeMaterialDetail,
  ) as TslNode;
  const geometricNormal = attribute('normal', 'vec3') as TslNode;
  const slope = smoothstep(
    float(0.035) as TslNode,
    float(0.2) as TslNode,
    sub(float(1) as TslNode, geometricNormal.y) as TslNode,
  ) as TslNode;
  const flatFrostExposure = mix(
    float(0.36) as TslNode,
    float(1) as TslNode,
    smoothstep(
      float(0.72) as TslNode,
      float(0.96) as TslNode,
      geometricNormal.y,
    ) as TslNode,
  ) as TslNode;
  const lowland = sub(
    float(1) as TslNode,
    smoothstep(
      float(-1.5) as TslNode,
      float(13.5) as TslNode,
      world.y,
    ) as TslNode,
  ) as TslNode;
  // Sustained rain resolves toward fragment-evaluated ecological fields. These
  // reuse only the existing world-space macro waves so the result retains
  // broad ecological variation without tracing the stepped elevation samples
  // of carved drainage channels or exposing vertex-biome derivative changes
  // along the terrain triangle split.
  const rainMoisture = smoothstep(
    float(0.16) as TslNode,
    float(0.84) as TslNode,
    macroA
      .mul(float(0.36) as TslNode)
      .add(macroB.mul(float(0.64) as TslNode)) as TslNode,
  ) as TslNode;
  const moisture = smoothstep(
    float(0.18) as TslNode,
    float(0.84) as TslNode,
    w.y
      .mul(float(0.38) as TslNode)
      .add(lowland.mul(float(0.23) as TslNode))
      .add(macro.mul(float(0.39) as TslNode)) as TslNode,
  ) as TslNode;
  const drainageFold = smoothstep(
    float(0.42) as TslNode,
    float(0.78) as TslNode,
    lowland
      .mul(float(0.48) as TslNode)
      .add(w.y.mul(float(0.2) as TslNode))
      .add(macroB.mul(float(0.32) as TslNode)) as TslNode,
  ) as TslNode;
  const forestEdge = smoothstep(
    float(0.3) as TslNode,
    float(0.72) as TslNode,
    w.y
      .mul(float(0.62) as TslNode)
      .add((sub(float(1) as TslNode, macroA) as TslNode).mul(float(0.24) as TslNode))
      .add(slope.mul(float(0.14) as TslNode)) as TslNode,
  ) as TslNode;
  const broadFrostExposure = smoothstep(
    float(0.22) as TslNode,
    float(0.62) as TslNode,
    macro,
  ) as TslNode;
  const ecologicalShelter = max(
    max(forestEdge, forestBlend) as TslNode,
    drainageFold.mul(float(0.68) as TslNode),
  ) as TslNode;
  const frostExposure = flatFrostExposure
    .mul(mix(
      float(0.28) as TslNode,
      float(1) as TslNode,
      broadFrostExposure,
    ) as TslNode)
    .mul(mix(
      float(1) as TslNode,
      float(0.42) as TslNode,
      ecologicalShelter,
    ) as TslNode) as TslNode;
  const rainMacro = macroA
    .mul(float(0.62) as TslNode)
    .add(macroB.mul(float(0.38) as TslNode)) as TslNode;
  const rainMacroColor = mix(
    vec3(0.076, 0.088, 0.038) as TslNode,
    vec3(0.118, 0.122, 0.052) as TslNode,
    rainMacro,
  ) as TslNode;
  const rainDrainageTint = mix(
    vec3(1.02, 1.01, 0.94) as TslNode,
    vec3(0.82, 0.91, 0.83) as TslNode,
    rainMoisture.mul(float(0.45) as TslNode),
  ) as TslNode;
  const grassRainStableColorNode = rainMacroColor
    .mul(rainDrainageTint) as TslNode;
  const forestRainStableColorNode = forestStableColorNode
    .mul(vec3(0.72, 0.78, 0.74) as TslNode) as TslNode;
  const rainStableColorNode = mix(
    grassRainStableColorNode,
    forestRainStableColorNode,
    forestBlend,
  ) as TslNode;
  // Preserve the original authored grass/dirt presentation in fair weather.
  // Broad ecological fields continue to drive weather and frost, but must not
  // tint the entire terrain green before the close-zoom dirt blend is applied.
  const stableColorNode = mix(
    grassStableColorNode,
    forestStableColorNode,
    forestBlend,
  ) as TslNode;
  const colorNode = mix(
    grassColorNode,
    forestColorNode,
    forestBlend,
  ) as TslNode;
  const meadowNormal = texture(textures.meadow.normal, meadowUv) as TslNode;
  const denseNormal = texture(textures.dense.normal, denseUv) as TslNode;
  const dryNormal = texture(textures.dry.normal, dryUv) as TslNode;
  const blendedNormalSample = meadowNormal.mul(w.x).add(denseNormal.mul(w.y)).add(dryNormal.mul(w.z));
  const normalDetailStrength = mix(
    float(0.1) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const rainNormalVisibility = mix(
    float(1) as TslNode,
    float(TERRAIN_FULL_RAIN_NORMAL_DETAIL_FLOOR) as TslNode,
    weather.wetness,
  ) as TslNode;
  const resolvedNormalSample = mix(
    vec3(0.5, 0.5, 1) as TslNode,
    blendedNormalSample,
    normalDetailStrength.mul(rainNormalVisibility),
  ) as TslNode;
  const grassNormalNode = normalMap(resolvedNormalSample);
  const forestBumpNode = bumpMap(
    forestLuminance,
    float(0.18) as TslNode,
  ) as TslNode;
  const forestNormalNode = normalize(
    mix(
      grassNormalNode,
      forestBumpNode,
      closeMaterialDetail.mul(rainNormalVisibility),
    ) as TslNode,
  ) as TslNode;
  const normalNode = normalize(
    mix(grassNormalNode, forestNormalNode, forestBlend) as TslNode,
  ) as TslNode;

  const meadowRoughness = (texture(textures.meadow.roughness, meadowUv) as TslNode).r;
  const denseRoughness = (texture(textures.dense.roughness, denseUv) as TslNode).r;
  const dryRoughness = (texture(textures.dry.roughness, dryUv) as TslNode).r;
  const blendedRoughness = meadowRoughness.mul(w.x).add(denseRoughness.mul(w.y)).add(dryRoughness.mul(w.z));
  const roughnessDetailStrength = mix(
    float(0.26) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const grassRoughnessNode = mix(
    float(0.86) as TslNode,
    blendedRoughness,
    roughnessDetailStrength,
  ) as TslNode;
  const forestDetailRoughnessNode = mix(
    float(0.97) as TslNode,
    float(0.86) as TslNode,
    forestGrain,
  ) as TslNode;
  const forestRoughnessNode = mix(
    float(0.94) as TslNode,
    forestDetailRoughnessNode,
    closeMaterialDetail,
  ) as TslNode;
  const roughnessNode = mix(
    grassRoughnessNode,
    forestRoughnessNode,
    forestBlend,
  ) as TslNode;

  const meadowAo = (texture(textures.meadow.ao!, meadowUv) as TslNode).r;
  const denseAo = (texture(textures.dense.ao!, denseUv) as TslNode).r;
  const dryAo = (texture(textures.dry.ao!, dryUv) as TslNode).r;
  const blendedAo = meadowAo.mul(w.x).add(denseAo.mul(w.y)).add(dryAo.mul(w.z));
  const aoDetailStrength = mix(
    float(0.3) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const rainAoVisibility = mix(
    float(1) as TslNode,
    float(TERRAIN_FULL_RAIN_AO_DETAIL_FLOOR) as TslNode,
    weather.wetness,
  ) as TslNode;
  const grassAoNode = mix(
    float(1) as TslNode,
    blendedAo,
    aoDetailStrength.mul(rainAoVisibility),
  ) as TslNode;
  const forestDetailAoNode = mix(
    float(0.9) as TslNode,
    float(0.99) as TslNode,
    forestGrain,
  ) as TslNode;
  const forestAoNode = mix(
    float(0.95) as TslNode,
    forestDetailAoNode,
    closeMaterialDetail.mul(rainAoVisibility),
  ) as TslNode;
  const aoNode = mix(
    grassAoNode,
    forestAoNode,
    forestBlend,
  ) as TslNode;

  return {
    colorNode,
    stableColorNode,
    normalNode,
    roughnessNode,
    aoNode,
    grassColorNode,
    grassStableColorNode,
    grassRainStableColorNode,
    grassNormalNode,
    grassRoughnessNode,
    grassAoNode,
    forestColorNode,
    forestStableColorNode,
    forestRainStableColorNode,
    forestNormalNode,
    forestRoughnessNode,
    forestAoNode,
    forestBlend,
    grassUv,
    macro,
    moisture,
    rainMoisture,
    rainStableColorNode,
    frostExposure,
  };
}

function applyRiparianEcologyColor(
  baseColor: TslNode,
  shoreBlend: TslNode,
): TslNode {
  // Keep the outer bank tail proportional to actual coverage. A fractional
  // power here used to turn tiny interpolated mask values into a dark,
  // sub-pixel contour around the whole river.
  const riparianReach = shoreBlend.mul(float(0.34) as TslNode) as TslNode;
  const coolBankColor = baseColor.mul(vec3(0.71, 0.84, 0.72) as TslNode);
  return mix(baseColor, coolBankColor, riparianReach) as TslNode;
}

function buildTerrainSnowNodes(
  textures: TextureSet,
  grassUv: TslNode,
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure: TslNode = float(1) as TslNode,
): {
  colorNode: TslNode;
  roughnessNode: TslNode;
  aoNode: TslNode;
  mask: TslNode;
} {
  // Snow shares the dry-grass albedo sampler through a two-surface atlas.
  // Keeping the binding count unchanged preserves the WebGPU portable
  // fragment-stage limit while still providing authored snow micro-detail.
  const colorSample = texture(
    textures.albedo,
    packedDrySnowUv(grassUv, true),
  ) as TslNode;
  const textureRelief = colorSample.r
    .mul(float(0.72) as TslNode)
    .add(colorSample.b.mul(float(0.28) as TslNode)) as TslNode;
  const revealSignal = mix(
    macro,
    textureRelief,
    float(TERRAIN_SNOW_TEXTURE_WEIGHT) as TslNode,
  ) as TslNode;
  // Move the reveal threshold through the macro field and snow micro-height as
  // coverage grows. This produces expanding settled patches rather than a
  // uniform white cross-fade over every grass texel.
  const revealStart = sub(
    float(1.01) as TslNode,
    weather.frost.mul(float(TERRAIN_SNOW_REVEAL_RANGE) as TslNode),
  ) as TslNode;
  const mask = (smoothstep(
    revealStart,
    revealStart.add(float(TERRAIN_SNOW_REVEAL_WIDTH) as TslNode),
    revealSignal,
  ) as TslNode)
    .mul(exposure)
    .mul(float(TERRAIN_SNOW_MAX_COVERAGE) as TslNode) as TslNode;
  return {
    colorNode: colorSample.rgb,
    roughnessNode: float(0.95) as TslNode,
    aoNode: float(0.98) as TslNode,
    mask,
  };
}

function buildTerrainWetMask(
  moisture: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const drainage = mix(
    float(0.1) as TslNode,
    float(0.32) as TslNode,
    smoothstep(
      float(0.22) as TslNode,
      float(0.82) as TslNode,
      moisture,
    ) as TslNode,
  ) as TslNode;
  return weather.wetness.mul(drainage) as TslNode;
}

function applyTerrainRainHaze(
  baseColor: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const world = positionWorld as TslNode;
  const cam = cameraPosition as TslNode;
  const dx = sub(world.x, cam.x) as TslNode;
  const dz = sub(world.z, cam.z) as TslNode;
  const distanceSq = dx.mul(dx).add(dz.mul(dz)) as TslNode;
  const distanceHaze = smoothstep(
    float(3600) as TslNode,
    float(32400) as TslNode,
    distanceSq,
  ) as TslNode;
  const lowGround = sub(
    float(1) as TslNode,
    smoothstep(
      float(4) as TslNode,
      float(24) as TslNode,
      world.y,
    ) as TslNode,
  ) as TslNode;
  const hazeStrength = weather.wetness
    .mul(distanceHaze)
    .mul(mix(
      float(0.025) as TslNode,
      float(0.095) as TslNode,
      lowGround,
    ) as TslNode) as TslNode;
  return mix(
    baseColor,
    vec3(0.19, 0.24, 0.25) as TslNode,
    hazeStrength,
  ) as TslNode;
}

function applyTerrainWetColor(
  baseColor: TslNode,
  stableColor: TslNode,
  rainStableColor: TslNode,
  moisture: TslNode,
  rainMoisture: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  // Rain resolves close albedo toward the existing mip-tail ecology color.
  // Broad moisture drainage remains, while woven/crosshatch detail does not
  // become a high-contrast wetness mask.
  const weatherStableColor = mix(
    stableColor,
    rainStableColor,
    weather.wetness,
  ) as TslNode;
  const rainResolvedColor = mix(
    baseColor,
    weatherStableColor,
    weather.wetness.mul(
      float(1 - TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR) as TslNode,
    ),
  ) as TslNode;
  const weatherMoisture = mix(
    moisture,
    rainMoisture,
    weather.wetness,
  ) as TslNode;
  const wetTint = rainResolvedColor.mul(vec3(0.78, 0.82, 0.78) as TslNode);
  const wetGround = mix(
    rainResolvedColor,
    wetTint,
    buildTerrainWetMask(weatherMoisture, weather),
  ) as TslNode;
  return applyTerrainRainHaze(wetGround, weather);
}

function applyTerrainSnowColor(
  baseColor: TslNode,
  snowColor: TslNode,
  snowMask: TslNode,
): TslNode {
  return mix(baseColor, snowColor, snowMask) as TslNode;
}

function applyTerrainSnowRoughness(
  baseRoughness: TslNode,
  snowRoughness: TslNode,
  snowMask: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const wetRoughness = mix(
    baseRoughness,
    float(0.72) as TslNode,
    weather.wetness.mul(
      float(1 - TERRAIN_FULL_RAIN_ROUGHNESS_DETAIL_FLOOR) as TslNode,
    ),
  ) as TslNode;
  return mix(
    wetRoughness,
    snowRoughness,
    snowMask,
  ) as TslNode;
}

function buildMuddyRoadColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  const luminance = sample.r
    .mul(float(0.299) as TslNode)
    .add(sample.g.mul(float(0.587) as TslNode))
    .add(sample.b.mul(float(0.114) as TslNode));
  const desaturated = mix(
    sample.rgb,
    vec3(luminance, luminance, luminance) as TslNode,
    float(0.34) as TslNode,
  ) as TslNode;
  const warmTint = desaturated.mul(vec3(0.72, 0.54, 0.38) as TslNode);
  return warmTint.mul(float(0.86) as TslNode);
}

function buildQuarryRockColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  const luminance = sample.r
    .mul(float(0.299) as TslNode)
    .add(sample.g.mul(float(0.587) as TslNode))
    .add(sample.b.mul(float(0.114) as TslNode));
  const desaturated = mix(
    sample.rgb,
    vec3(luminance, luminance, luminance) as TslNode,
    float(0.62) as TslNode,
  ) as TslNode;
  return desaturated.mul(vec3(0.62, 0.6, 0.56) as TslNode).mul(float(0.94) as TslNode);
}

function buildLayeredDirtGroundNodes(
  roadTextures: TextureSet,
  grassUv: TslNode,
): {
  colorNode: TslNode;
  normalNode: TslNode;
  roughnessNode: TslNode;
  aoNode: TslNode;
} {
  // Three differently scaled authored soil samples replace the former single
  // green-shiftable mip tail. Reusing the terrain's existing road albedo and
  // roughness bindings keeps the WebGPU fragment stage within its 16-texture
  // portability limit while restoring stones, clods and granular variation.
  const broadUv = grassUv.mul(float(1.72) as TslNode) as TslNode;
  const detailUv = grassUv.mul(float(6.4) as TslNode) as TslNode;
  const pebbleUv = grassUv.mul(float(3.35) as TslNode) as TslNode;
  const broadColor = texture(roadTextures.albedo, broadUv) as TslNode;
  const detailColor = texture(roadTextures.albedo, detailUv) as TslNode;
  const pebbleColor = texture(roadTextures.albedo, pebbleUv) as TslNode;
  const broadHeight = broadColor.r
    .mul(float(0.42) as TslNode)
    .add(broadColor.g.mul(float(0.46) as TslNode))
    .add(broadColor.b.mul(float(0.12) as TslNode)) as TslNode;
  const detailHeight = detailColor.r
    .mul(float(0.42) as TslNode)
    .add(detailColor.g.mul(float(0.46) as TslNode))
    .add(detailColor.b.mul(float(0.12) as TslNode)) as TslNode;
  const layerHeight = broadHeight
    .mul(float(0.38) as TslNode)
    .add(detailHeight.mul(float(0.62) as TslNode)) as TslNode;
  const detailWeight = mix(
    float(0.22) as TslNode,
    float(0.52) as TslNode,
    smoothstep(
      float(0.34) as TslNode,
      float(0.7) as TslNode,
      layerHeight,
    ) as TslNode,
  ) as TslNode;
  const mineralSoil = mix(broadColor.rgb, detailColor.rgb, detailWeight) as TslNode;
  const layeredSoil = mix(
    mineralSoil,
    pebbleColor.rgb,
    float(0.18) as TslNode,
  ) as TslNode;
  const soilLuminance = layeredSoil.r
    .mul(float(0.299) as TslNode)
    .add(layeredSoil.g.mul(float(0.587) as TslNode))
    .add(layeredSoil.b.mul(float(0.114) as TslNode)) as TslNode;
  // Match the supplied cool grey-brown dirt reference (#786b61 average)
  // without flattening the authored stones, clods, or granular contrast.
  const greyBrownSoil = mix(
    layeredSoil,
    vec3(soilLuminance, soilLuminance, soilLuminance) as TslNode,
    float(0.72) as TslNode,
  ) as TslNode;
  const colorNode = greyBrownSoil.mul(
    vec3(1.244, 1.121, 1.041) as TslNode,
  ) as TslNode;

  const bumpHeight = broadHeight
    .mul(float(0.34) as TslNode)
    .add(detailHeight.mul(float(0.66) as TslNode)) as TslNode;
  const normalNode = bumpMap(
    bumpHeight,
    float(0.18) as TslNode,
  ) as TslNode;

  const broadRoughness = (texture(roadTextures.roughness, broadUv) as TslNode).r;
  const detailRoughness = (texture(roadTextures.roughness, detailUv) as TslNode).r;
  const pebbleRoughness = (texture(roadTextures.roughness, pebbleUv) as TslNode).r;
  const mineralRoughness = mix(
    broadRoughness,
    detailRoughness,
    float(0.38) as TslNode,
  ) as TslNode;
  const roughnessNode = mix(
    mineralRoughness,
    pebbleRoughness,
    float(0.16) as TslNode,
  ) as TslNode;
  const aoNode = mix(
    float(0.82) as TslNode,
    float(1) as TslNode,
    layerHeight,
  ) as TslNode;
  return { colorNode, normalNode, roughnessNode, aoNode };
}

function buildProximityDirtMask(): TslNode {
  const world = positionWorld as TslNode;
  const cam = cameraPosition as TslNode;
  const dx = sub(world.x, cam.x) as TslNode;
  const dz = sub(world.z, cam.z) as TslNode;
  const horizDistSq = dx.mul(dx).add(dz.mul(dz)) as TslNode;
  return sub(
    float(1) as TslNode,
    smoothstep(
      float(DIRT_PROXIMITY_INNER_SQ) as TslNode,
      float(DIRT_PROXIMITY_OUTER_SQ) as TslNode,
      horizDistSq,
    ) as TslNode,
  ) as TslNode;
}

function buildCloseZoomDirtAmount(
  shoreBlend: TslNode,
  roadWear: TslNode,
  quarryPad: TslNode,
  weather?: RoadWeatherUniforms,
): TslNode {
  const zoomGate = attribute('dirtZoomGate', 'float') as TslNode;
  const proximity = buildProximityDirtMask();
  const wornMask = max(max(shoreBlend, roadWear) as TslNode, quarryPad) as TslNode;
  const openGround = sub(float(1) as TslNode, wornMask) as TslNode;
  const rainDirtVisibility = mix(
    float(1) as TslNode,
    float(TERRAIN_FULL_RAIN_DIRT_DETAIL_FLOOR) as TslNode,
    weather?.wetness ?? (float(0) as TslNode),
  ) as TslNode;
  const dirtAmount = zoomGate
    .mul(proximity)
    .mul(openGround)
    .mul(rainDirtVisibility) as TslNode;
  return dirtAmount;
}

function applyCloseZoomDirtBlend(
  meadowColor: TslNode,
  dirtColor: TslNode,
  dirtAmount: TslNode,
): TslNode {
  const meadowWeight = sub(float(1) as TslNode, dirtAmount) as TslNode;
  return mix(dirtColor, meadowColor, meadowWeight) as TslNode;
}

export function createTerrainGrassMaterial(
  textures: TerrainBlendTextureSet,
  weather?: RoadWeatherUniforms,
): MeshStandardNodeMaterial {
  const resolvedWeather = resolveTerrainWeather(weather);
  const blendNodes = buildGrassBlendNodes(textures, resolvedWeather);
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  const wetColorNode = applyTerrainWetColor(
    blendNodes.colorNode,
    blendNodes.stableColorNode,
    blendNodes.rainStableColorNode,
    blendNodes.moisture,
    blendNodes.rainMoisture,
    resolvedWeather,
  );
  const snowNodes = buildTerrainSnowNodes(
    textures.dry,
    blendNodes.grassUv,
    blendNodes.macro,
    resolvedWeather,
    blendNodes.frostExposure,
  );
  material.colorNode = applyTerrainSnowColor(
    wetColorNode,
    snowNodes.colorNode,
    snowNodes.mask,
  );
  material.normalNode = blendNodes.normalNode;
  material.roughnessNode = applyTerrainSnowRoughness(
    blendNodes.roughnessNode,
    snowNodes.roughnessNode,
    snowNodes.mask,
    resolvedWeather,
  );
  material.aoNode = mix(
    blendNodes.aoNode,
    snowNodes.aoNode,
    snowNodes.mask,
  ) as TslNode;
  return material;
}

function buildTrampledWearColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  const luminance = sample.r
    .mul(float(0.299) as TslNode)
    .add(sample.g.mul(float(0.587) as TslNode))
    .add(sample.b.mul(float(0.114) as TslNode));
  const desaturated = mix(
    sample.rgb,
    vec3(luminance, luminance, luminance) as TslNode,
    float(0.52) as TslNode,
  ) as TslNode;
  const wornTint = desaturated.mul(vec3(0.68, 0.64, 0.52) as TslNode);
  return wornTint.mul(float(0.9) as TslNode);
}

export function createTerrainGrassMaterialWithRiverShore(
  grassTextures: TerrainBlendTextureSet,
  roadTextures: TextureSet,
  weather?: RoadWeatherUniforms,
): MeshStandardNodeMaterial {
  const resolvedWeather = resolveTerrainWeather(weather);
  const blendNodes = buildGrassBlendNodes(grassTextures, resolvedWeather);
  const mudColor = buildMuddyRoadColorNode(roadTextures, blendNodes.grassUv);
  const dirtSurface = buildLayeredDirtGroundNodes(
    roadTextures,
    blendNodes.grassUv,
  );
  const quarryColor = buildQuarryRockColorNode(roadTextures, blendNodes.grassUv);
  const wearColor = buildTrampledWearColorNode(roadTextures, blendNodes.grassUv);
  const shoreBlendRaw = attribute('shoreBlend', 'float') as TslNode;
  // Drop interpolation residue to a true zero, then ease the authored mask
  // over its full remaining range. Sublinear powers amplify near-zero vertex
  // tails and collapse them into dotted one-pixel rings at overview zoom.
  const shoreBlend = smoothstep(
    float(TERRAIN_SHORE_BLEND_FLOOR) as TslNode,
    float(1) as TslNode,
    shoreBlendRaw,
  ) as TslNode;
  const roadWearRaw = attribute('roadWearBlend', 'float') as TslNode;
  const roadWear = smoothstep(
    float(TERRAIN_ROAD_WEAR_BLEND_FLOOR) as TslNode,
    float(1) as TslNode,
    roadWearRaw,
  ) as TslNode;
  const quarryPad = pow(
    attribute('quarryPadBlend', 'float') as TslNode,
    float(0.74) as TslNode,
  ) as TslNode;
  const wornMask = max(max(shoreBlend, roadWear) as TslNode, quarryPad) as TslNode;
  const forestSurfaceBlend = blendNodes.forestBlend.mul(
    sub(float(1) as TslNode, wornMask) as TslNode,
  ) as TslNode;
  // Terrain undercoat only — bank mesh overlay carries the inner mud detail.
  // During sustained rain the authored river meshes remain the authoritative
  // bank detail. Resolve the broad vertex shore field once, then use that same
  // mask through every terrain color and roughness branch so a narrow,
  // sub-pixel field cannot appear as dotted drainage contours.
  const shoreRainVisibility = sub(
    float(1) as TslNode,
    smoothstep(
      float(TERRAIN_SHORE_RAIN_FADE_START) as TslNode,
      float(TERRAIN_SHORE_RAIN_FADE_END) as TslNode,
      resolvedWeather.wetness,
    ) as TslNode,
  ) as TslNode;
  const weatherResolvedShoreBlend = shoreBlend.mul(shoreRainVisibility) as TslNode;
  // Authored road meshes carry the wet-road silhouette. The sub-pixel terrain
  // undercoat can quantize into dotted paths once rain smooths the meadow, so
  // fade only that redundant vertex mask with the same sustained-rain gate.
  const weatherResolvedRoadWear = roadWear.mul(shoreRainVisibility) as TslNode;
  // River banks and road shoulders have dedicated, continuously feathered
  // meshes. Keep vertex masks for close-dirt exclusion, but do not tint the
  // exposed terrain with them: even a well-clamped vertex field can collapse
  // to a one-pixel contour at strategic zoom levels.
  const terrainColorShoreBlend = float(0) as TslNode;
  const terrainColorRoadWear = float(0) as TslNode;
  const dirtAmount = buildCloseZoomDirtAmount(
    weatherResolvedShoreBlend,
    weatherResolvedRoadWear,
    quarryPad,
    resolvedWeather,
  );
  // Brown soil uses a broad 200-650% handoff. It first becomes readable with
  // SeedThree groundcover, then gradually takes over toward ground level.
  const dirtSurfaceAmount = dirtAmount;
  const meadowWeight = sub(float(1) as TslNode, dirtSurfaceAmount) as TslNode;
  const shoreUndercoat = terrainColorShoreBlend.mul(float(0.58) as TslNode);
  const riparianGrass = applyRiparianEcologyColor(
    blendNodes.grassColorNode,
    terrainColorShoreBlend,
  );
  const stableRiparianGrass = applyRiparianEcologyColor(
    blendNodes.grassStableColorNode,
    terrainColorShoreBlend,
  );
  const grassWithShore = mix(riparianGrass, mudColor, shoreUndercoat) as TslNode;
  const stableGrassWithShore = mix(
    stableRiparianGrass,
    mudColor,
    shoreUndercoat,
  ) as TslNode;
  const meadowWithQuarry = mix(grassWithShore, quarryColor, quarryPad) as TslNode;
  const stableMeadowWithQuarry = mix(
    stableGrassWithShore,
    quarryColor,
    quarryPad,
  ) as TslNode;
  const meadowWithWear = mix(
    meadowWithQuarry,
    wearColor,
    terrainColorRoadWear,
  ) as TslNode;
  const stableMeadowWithWear = mix(
    stableMeadowWithQuarry,
    wearColor,
    terrainColorRoadWear,
  ) as TslNode;
  const grassOrDirtColorNode = applyCloseZoomDirtBlend(
    meadowWithWear,
    dirtSurface.colorNode,
    dirtSurfaceAmount,
  );
  const stableGrassOrDirtColorNode = applyCloseZoomDirtBlend(
    stableMeadowWithWear,
    dirtSurface.colorNode,
    dirtSurfaceAmount,
  );
  // Apply the forest surface last so its feathered boundary resolves toward
  // grass in overview and toward close dirt without either material leaking
  // back into the contiguous woodland interior.
  const baseColorNode = mix(
    grassOrDirtColorNode,
    blendNodes.forestColorNode,
    forestSurfaceBlend,
  ) as TslNode;
  const stableBaseColorNode = mix(
    stableGrassOrDirtColorNode,
    blendNodes.forestStableColorNode,
    forestSurfaceBlend,
  ) as TslNode;
  // Rain resolves the meadow to a stable low-frequency color, but the close
  // dirt layer must remain brown and textured instead of being replaced by
  // the green rain-meadow fallback.
  const rainStableGrassOrDirtColorNode = applyCloseZoomDirtBlend(
    blendNodes.grassRainStableColorNode,
    dirtSurface.colorNode,
    dirtSurfaceAmount,
  );
  const rainStableBaseColorNode = mix(
    rainStableGrassOrDirtColorNode,
    blendNodes.forestRainStableColorNode,
    forestSurfaceBlend,
  ) as TslNode;
  const wetBaseColorNode = applyTerrainWetColor(
    baseColorNode,
    stableBaseColorNode,
    rainStableBaseColorNode,
    blendNodes.moisture,
    blendNodes.rainMoisture,
    resolvedWeather,
  );
  const snowExposure = (sub(
    float(1) as TslNode,
    shoreBlend.mul(float(0.82) as TslNode),
  ) as TslNode).mul(blendNodes.frostExposure) as TslNode;
  const snowNodes = buildTerrainSnowNodes(
    grassTextures.dry,
    blendNodes.grassUv,
    blendNodes.macro,
    resolvedWeather,
    snowExposure,
  );
  const colorNode = applyTerrainSnowColor(
    wetBaseColorNode,
    snowNodes.colorNode,
    snowNodes.mask,
  );

  const roadRoughness = (texture(roadTextures.roughness, blendNodes.grassUv) as TslNode).r;
  const muddyRoughness = mix(roadRoughness, float(0.58) as TslNode, float(0.42) as TslNode);
  const quarryRoughness = mix(roadRoughness, float(0.84) as TslNode, float(0.46) as TslNode);
  const wornRoughness = mix(roadRoughness, float(0.72) as TslNode, float(0.38) as TslNode);
  const roughnessWithShore = mix(blendNodes.roughnessNode, muddyRoughness, shoreUndercoat);
  const roughnessWithQuarry = mix(roughnessWithShore, quarryRoughness, quarryPad);
  const roughnessWithWear = mix(
    roughnessWithQuarry,
    wornRoughness,
    terrainColorRoadWear,
  );
  const grassOrDirtRoughnessNode = mix(
    dirtSurface.roughnessNode,
    roughnessWithWear as TslNode,
    meadowWeight as TslNode,
  ) as TslNode;
  const baseRoughnessNode = mix(
    grassOrDirtRoughnessNode,
    blendNodes.forestRoughnessNode,
    forestSurfaceBlend,
  ) as TslNode;
  const roughnessNode = applyTerrainSnowRoughness(
    baseRoughnessNode,
    snowNodes.roughnessNode,
    snowNodes.mask,
    resolvedWeather,
  );
  const grassOrDirtNormalNode = normalize(
    mix(
      blendNodes.grassNormalNode,
      dirtSurface.normalNode,
      dirtSurfaceAmount,
    ) as TslNode,
  ) as TslNode;
  const baseNormalNode = normalize(
    mix(
      grassOrDirtNormalNode,
      blendNodes.forestNormalNode,
      forestSurfaceBlend,
    ) as TslNode,
  ) as TslNode;
  const grassOrDirtAoNode = mix(
    blendNodes.grassAoNode,
    dirtSurface.aoNode,
    dirtSurfaceAmount,
  ) as TslNode;
  const baseAoNode = mix(
    grassOrDirtAoNode,
    blendNodes.forestAoNode,
    forestSurfaceBlend,
  ) as TslNode;

  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain with river shore';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.colorNode = colorNode;
  material.normalNode = baseNormalNode;
  material.roughnessNode = roughnessNode;
  material.aoNode = mix(
    baseAoNode,
    snowNodes.aoNode,
    snowNodes.mask,
  ) as TslNode;
  return material;
}
