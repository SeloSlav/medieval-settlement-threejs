import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  fwidth,
  max,
  mix,
  normalMap,
  pow,
  positionWorld,
  sin,
  smoothstep,
  sub,
  texture,
  uv,
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
  add(value: TslNode): TslNode;
  div(value: TslNode): TslNode;
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

function buildGrassBlendNodes(textures: TerrainBlendTextureSet) {
  const grassUv = uv() as TslNode;
  const weightsRaw = (vertexColor() as TslNode).xyz;
  const weightSum = max(weightsRaw.x.add(weightsRaw.y).add(weightsRaw.z), float(0.0001) as TslNode) as TslNode;
  const w = weightsRaw.div(weightSum);

  const meadowColor = texture(textures.meadow.albedo, grassUv) as TslNode;
  const denseColor = texture(textures.dense.albedo, grassUv) as TslNode;
  const dryColor = texture(textures.dry.albedo, grassUv) as TslNode;
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
  // These are the measured linear-space averages of the three existing grass
  // albedos. At overview distance they behave like stable mip-tail colors,
  // while the original samples fade back to full strength for close/FP views.
  const biomeBaseColor = (vec3(0.1, 0.108, 0.04) as TslNode)
    .mul(w.x)
    .add((vec3(0.05, 0.055, 0.029) as TslNode).mul(w.y))
    .add((vec3(0.18, 0.17, 0.078) as TslNode).mul(w.z));
  const albedoDetailStrength = mix(
    float(0.24) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const resolvedAlbedo = mix(
    biomeBaseColor,
    blendedColor,
    albedoDetailStrength,
  ) as TslNode;
  const world = positionWorld as TslNode;
  // Domain-warped oblique waves form broad ecological masses without another
  // texture read or the obvious dots/checker cells produced by hash noise.
  // Existing biome weights stay authoritative; this makes their lowland,
  // meadow and dry-shoulder hierarchy legible from overview distance.
  const macroWarp = sin(
    world.x
      .mul(float(0.0031) as TslNode)
      .add(world.z.mul(float(-0.0043) as TslNode))
      .add(float(1.73) as TslNode) as TslNode,
  ) as TslNode;
  const macroA = (sin(
    world.x
      .mul(float(0.0076) as TslNode)
      .add(world.z.mul(float(0.0049) as TslNode))
      .add(macroWarp.mul(float(1.12) as TslNode)) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macroB = (sin(
    world.x
      .mul(float(-0.018) as TslNode)
      .add(world.z.mul(float(0.013) as TslNode))
      .add(macroWarp.mul(float(-1.67) as TslNode))
      .add(float(2.41) as TslNode) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macro = macroA.mul(float(0.68) as TslNode).add(macroB.mul(float(0.32) as TslNode));

  const geometricNormal = attribute('normal', 'vec3') as TslNode;
  const slope = smoothstep(
    float(0.035) as TslNode,
    float(0.2) as TslNode,
    sub(float(1) as TslNode, geometricNormal.y) as TslNode,
  ) as TslNode;
  const frostExposure = mix(
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
  const moisture = smoothstep(
    float(0.18) as TslNode,
    float(0.84) as TslNode,
    w.y
      .mul(float(0.38) as TslNode)
      .add(lowland.mul(float(0.23) as TslNode))
      .add(macro.mul(float(0.39) as TslNode)) as TslNode,
  ) as TslNode;
  const dryShoulder = smoothstep(
    float(0.22) as TslNode,
    float(0.86) as TslNode,
    w.z
      .mul(float(0.58) as TslNode)
      .add(slope.mul(float(0.3) as TslNode))
      .add(sub(float(0.12) as TslNode, lowland.mul(float(0.12) as TslNode)) as TslNode) as TslNode,
  ) as TslNode;
  const openMeadow = smoothstep(
    float(0.36) as TslNode,
    float(0.74) as TslNode,
    w.x
      .mul(float(0.62) as TslNode)
      .add(macroA.mul(float(0.24) as TslNode))
      .add((sub(float(1) as TslNode, slope) as TslNode).mul(float(0.14) as TslNode)) as TslNode,
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
  const macroTint = mix(
    vec3(1.055, 1.015, 0.875) as TslNode,
    vec3(0.755, 0.9, 0.7) as TslNode,
    moisture.mul(float(0.68) as TslNode),
  ) as TslNode;
  const ecologyTint = mix(
    macroTint,
    vec3(1.06, 0.955, 0.76) as TslNode,
    dryShoulder.mul(float(0.4) as TslNode),
  ) as TslNode;
  const forestTint = mix(
    ecologyTint,
    vec3(0.72, 0.84, 0.66) as TslNode,
    forestEdge.mul(float(0.38) as TslNode),
  ) as TslNode;
  const drainageTint = mix(
    forestTint,
    vec3(0.68, 0.83, 0.72) as TslNode,
    drainageFold.mul(float(0.3) as TslNode),
  ) as TslNode;
  const hierarchyTint = mix(
    drainageTint,
    vec3(1.08, 1.02, 0.82) as TslNode,
    openMeadow.mul(float(0.2) as TslNode),
  ) as TslNode;
  // The slow value drift is deliberately correlated with moisture instead of
  // being another noise layer: open, better-drained ground catches light while
  // broad damp folds hold a slightly deeper soil/grass value.
  const broadSoilValue = mix(
    vec3(1.06, 1.04, 0.93) as TslNode,
    vec3(0.875, 0.925, 0.855) as TslNode,
    macro,
  ) as TslNode;
  const colorNode = resolvedAlbedo.mul(hierarchyTint).mul(broadSoilValue);

  const meadowNormal = texture(textures.meadow.normal, grassUv) as TslNode;
  const denseNormal = texture(textures.dense.normal, grassUv) as TslNode;
  const dryNormal = texture(textures.dry.normal, grassUv) as TslNode;
  const blendedNormalSample = meadowNormal.mul(w.x).add(denseNormal.mul(w.y)).add(dryNormal.mul(w.z));
  const normalDetailStrength = mix(
    float(0.1) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const resolvedNormalSample = mix(
    vec3(0.5, 0.5, 1) as TslNode,
    blendedNormalSample,
    normalDetailStrength,
  ) as TslNode;
  const normalNode = normalMap(resolvedNormalSample);

  const meadowRoughness = (texture(textures.meadow.roughness, grassUv) as TslNode).r;
  const denseRoughness = (texture(textures.dense.roughness, grassUv) as TslNode).r;
  const dryRoughness = (texture(textures.dry.roughness, grassUv) as TslNode).r;
  const blendedRoughness = meadowRoughness.mul(w.x).add(denseRoughness.mul(w.y)).add(dryRoughness.mul(w.z));
  const roughnessDetailStrength = mix(
    float(0.26) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const roughnessNode = mix(
    float(0.86) as TslNode,
    blendedRoughness,
    roughnessDetailStrength,
  ) as TslNode;

  const meadowAo = (texture(textures.meadow.ao!, grassUv) as TslNode).r;
  const denseAo = (texture(textures.dense.ao!, grassUv) as TslNode).r;
  const dryAo = (texture(textures.dry.ao!, grassUv) as TslNode).r;
  const blendedAo = meadowAo.mul(w.x).add(denseAo.mul(w.y)).add(dryAo.mul(w.z));
  const aoDetailStrength = mix(
    float(0.3) as TslNode,
    float(1) as TslNode,
    closeMaterialDetail,
  ) as TslNode;
  const aoNode = mix(
    float(1) as TslNode,
    blendedAo,
    aoDetailStrength,
  ) as TslNode;

  return { colorNode, normalNode, roughnessNode, aoNode, grassUv, macro, frostExposure };
}

function applyRiparianEcologyColor(
  baseColor: TslNode,
  shoreBlend: TslNode,
): TslNode {
  const riparianReach = (pow(
    shoreBlend,
    float(0.38) as TslNode,
  ) as TslNode).mul(float(0.34) as TslNode) as TslNode;
  const coolBankColor = baseColor.mul(vec3(0.71, 0.84, 0.72) as TslNode);
  return mix(baseColor, coolBankColor, riparianReach) as TslNode;
}

function buildTerrainFrostMask(
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure: TslNode = float(1) as TslNode,
): TslNode {
  const patchiness = mix(
    float(0.08) as TslNode,
    float(0.82) as TslNode,
    smoothstep(
      float(0.34) as TslNode,
      float(0.7) as TslNode,
      macro,
    ) as TslNode,
  ) as TslNode;
  return weather.frost
    .mul(patchiness)
    .mul(exposure)
    .mul(float(0.8) as TslNode) as TslNode;
}

function buildTerrainWetMask(
  macro: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const patchiness = mix(
    float(0.14) as TslNode,
    float(0.58) as TslNode,
    smoothstep(
      float(0.26) as TslNode,
      float(0.74) as TslNode,
      macro,
    ) as TslNode,
  ) as TslNode;
  return weather.wetness.mul(patchiness) as TslNode;
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
  macro: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const wetTint = baseColor.mul(vec3(0.64, 0.72, 0.67) as TslNode);
  const wetGround = mix(
    baseColor,
    wetTint,
    buildTerrainWetMask(macro, weather),
  ) as TslNode;
  return applyTerrainRainHaze(wetGround, weather);
}

function applyTerrainFrostColor(
  baseColor: TslNode,
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure?: TslNode,
): TslNode {
  const weatheredGround = applyTerrainWetColor(baseColor, macro, weather);
  const frostMask = buildTerrainFrostMask(macro, weather, exposure);
  const luminance = weatheredGround.r
    .mul(float(0.299) as TslNode)
    .add(weatheredGround.g.mul(float(0.587) as TslNode))
    .add(weatheredGround.b.mul(float(0.114) as TslNode));
  const cooledGround = mix(
    weatheredGround,
    (vec3(luminance, luminance, luminance) as TslNode)
      .mul(vec3(1.02, 1.07, 1.11) as TslNode)
      .add(vec3(0.095, 0.105, 0.12) as TslNode) as TslNode,
    float(0.88) as TslNode,
  ) as TslNode;
  return mix(weatheredGround, cooledGround, frostMask) as TslNode;
}

function applyTerrainFrostRoughness(
  baseRoughness: TslNode,
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure?: TslNode,
): TslNode {
  const wetRoughness = mix(
    baseRoughness,
    float(0.46) as TslNode,
    weather.wetness.mul(float(0.7) as TslNode),
  ) as TslNode;
  return mix(
    wetRoughness,
    float(0.94) as TslNode,
    buildTerrainFrostMask(macro, weather, exposure),
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

function buildDirtGroundColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  return sample.rgb.mul(vec3(0.52, 0.42, 0.3) as TslNode);
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

function applyCloseZoomDirtBlend(
  meadowColor: TslNode,
  dirtColor: TslNode,
  shoreBlend: TslNode,
  roadWear: TslNode,
  quarryPad: TslNode,
): TslNode {
  const zoomGate = attribute('dirtZoomGate', 'float') as TslNode;
  const proximity = buildProximityDirtMask();
  const wornMask = max(max(shoreBlend, roadWear) as TslNode, quarryPad) as TslNode;
  const openGround = sub(float(1) as TslNode, wornMask) as TslNode;
  const dirtAmount = zoomGate.mul(proximity).mul(openGround) as TslNode;
  const meadowWeight = sub(float(1) as TslNode, dirtAmount) as TslNode;
  return mix(dirtColor, meadowColor, meadowWeight) as TslNode;
}

export function createTerrainGrassMaterial(
  textures: TerrainBlendTextureSet,
  weather: RoadWeatherUniforms,
): MeshStandardNodeMaterial {
  const blendNodes = buildGrassBlendNodes(textures);
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.colorNode = applyTerrainFrostColor(
    blendNodes.colorNode,
    blendNodes.macro,
    weather,
    blendNodes.frostExposure,
  );
  material.normalNode = blendNodes.normalNode;
  material.roughnessNode = applyTerrainFrostRoughness(
    blendNodes.roughnessNode,
    blendNodes.macro,
    weather,
  );
  material.aoNode = blendNodes.aoNode;
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
  weather: RoadWeatherUniforms,
): MeshStandardNodeMaterial {
  const blendNodes = buildGrassBlendNodes(grassTextures);
  const mudColor = buildMuddyRoadColorNode(roadTextures, blendNodes.grassUv);
  const dirtColor = buildDirtGroundColorNode(roadTextures, blendNodes.grassUv);
  const quarryColor = buildQuarryRockColorNode(roadTextures, blendNodes.grassUv);
  const wearColor = buildTrampledWearColorNode(roadTextures, blendNodes.grassUv);
  const shoreBlendRaw = attribute('shoreBlend', 'float') as TslNode;
  const shoreBlend = pow(shoreBlendRaw, float(0.82) as TslNode) as TslNode;
  const roadWearRaw = attribute('roadWearBlend', 'float') as TslNode;
  const roadWearCore = pow(roadWearRaw, float(0.62) as TslNode) as TslNode;
  const roadWearHalo = (pow(roadWearRaw, float(0.32) as TslNode) as TslNode)
    .mul(float(0.18) as TslNode) as TslNode;
  const roadWear = max(roadWearCore, roadWearHalo) as TslNode;
  const quarryPad = pow(attribute('quarryPadBlend', 'float') as TslNode, float(0.74) as TslNode) as TslNode;
  // Terrain undercoat only — bank mesh overlay carries the inner mud detail.
  const shoreUndercoat = shoreBlend.mul(float(0.58) as TslNode) as TslNode;
  const riparianGrass = applyRiparianEcologyColor(blendNodes.colorNode, shoreBlend);
  const grassWithShore = mix(riparianGrass, mudColor, shoreUndercoat) as TslNode;
  const meadowWithQuarry = mix(grassWithShore, quarryColor, quarryPad) as TslNode;
  const meadowWithWear = mix(meadowWithQuarry, wearColor, roadWear) as TslNode;
  const baseColorNode = applyCloseZoomDirtBlend(
    meadowWithWear,
    dirtColor,
    shoreBlend,
    roadWear,
    quarryPad,
  );
  const frostExposure = (sub(
    float(1) as TslNode,
    shoreBlend.mul(float(0.82) as TslNode),
  ) as TslNode).mul(blendNodes.frostExposure) as TslNode;
  const colorNode = applyTerrainFrostColor(
    baseColorNode,
    blendNodes.macro,
    weather,
    frostExposure,
  );

  const roadRoughness = (texture(roadTextures.roughness, blendNodes.grassUv) as TslNode).r;
  const muddyRoughness = mix(roadRoughness, float(0.58) as TslNode, float(0.42) as TslNode);
  const quarryRoughness = mix(roadRoughness, float(0.84) as TslNode, float(0.46) as TslNode);
  const wornRoughness = mix(roadRoughness, float(0.72) as TslNode, float(0.38) as TslNode);
  const dirtRoughness = mix(roadRoughness, float(0.82) as TslNode, float(0.24) as TslNode);
  const roughnessWithShore = mix(blendNodes.roughnessNode, muddyRoughness, shoreUndercoat);
  const roughnessWithQuarry = mix(roughnessWithShore, quarryRoughness, quarryPad);
  const roughnessWithWear = mix(roughnessWithQuarry, wornRoughness, roadWear);
  const zoomGate = attribute('dirtZoomGate', 'float') as TslNode;
  const proximity = buildProximityDirtMask();
  const openGround = sub(float(1) as TslNode, max(max(shoreBlend, roadWear) as TslNode, quarryPad) as TslNode) as TslNode;
  const dirtAmount = zoomGate.mul(proximity).mul(openGround) as TslNode;
  const meadowWeight = sub(float(1) as TslNode, dirtAmount) as TslNode;
  const baseRoughnessNode = mix(
    dirtRoughness,
    roughnessWithWear as TslNode,
    meadowWeight as TslNode,
  ) as TslNode;
  const roughnessNode = applyTerrainFrostRoughness(
    baseRoughnessNode,
    blendNodes.macro,
    weather,
    frostExposure,
  );

  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain with river shore';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.colorNode = colorNode;
  material.normalNode = blendNodes.normalNode;
  material.roughnessNode = roughnessNode;
  material.aoNode = blendNodes.aoNode;
  return material;
}
