import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
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
  const world = positionWorld as TslNode;
  const macroA = (sin(
    world.x
      .mul(float(0.012) as TslNode)
      .add(world.z.mul(float(0.009) as TslNode)) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macroB = (sin(
    world.x
      .mul(float(-0.026) as TslNode)
      .add(world.z.mul(float(0.021) as TslNode))
      .add(float(2.41) as TslNode) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macro = macroA.mul(float(0.66) as TslNode).add(macroB.mul(float(0.34) as TslNode));
  const macroTint = mix(
    vec3(0.9, 0.94, 0.85) as TslNode,
    vec3(1.045, 1.025, 0.95) as TslNode,
    macro,
  ) as TslNode;
  const colorNode = blendedColor.mul(macroTint);

  const meadowNormal = texture(textures.meadow.normal, grassUv) as TslNode;
  const denseNormal = texture(textures.dense.normal, grassUv) as TslNode;
  const dryNormal = texture(textures.dry.normal, grassUv) as TslNode;
  const blendedNormalSample = meadowNormal.mul(w.x).add(denseNormal.mul(w.y)).add(dryNormal.mul(w.z));
  const normalNode = normalMap(blendedNormalSample);

  const meadowRoughness = (texture(textures.meadow.roughness, grassUv) as TslNode).r;
  const denseRoughness = (texture(textures.dense.roughness, grassUv) as TslNode).r;
  const dryRoughness = (texture(textures.dry.roughness, grassUv) as TslNode).r;
  const roughnessNode = meadowRoughness.mul(w.x).add(denseRoughness.mul(w.y)).add(dryRoughness.mul(w.z));

  const meadowAo = (texture(textures.meadow.ao!, grassUv) as TslNode).r;
  const denseAo = (texture(textures.dense.ao!, grassUv) as TslNode).r;
  const dryAo = (texture(textures.dry.ao!, grassUv) as TslNode).r;
  const aoNode = meadowAo.mul(w.x).add(denseAo.mul(w.y)).add(dryAo.mul(w.z));

  return { colorNode, normalNode, roughnessNode, aoNode, grassUv, macro };
}

function buildTerrainFrostMask(
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure: TslNode = float(1) as TslNode,
): TslNode {
  const patchiness = mix(
    float(0.18) as TslNode,
    float(0.52) as TslNode,
    smoothstep(
      float(0.24) as TslNode,
      float(0.82) as TslNode,
      macro,
    ) as TslNode,
  ) as TslNode;
  return weather.frost
    .mul(patchiness)
    .mul(exposure)
    .mul(float(0.42) as TslNode) as TslNode;
}

function applyTerrainFrostColor(
  baseColor: TslNode,
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure?: TslNode,
): TslNode {
  const frostMask = buildTerrainFrostMask(macro, weather, exposure);
  const luminance = baseColor.r
    .mul(float(0.299) as TslNode)
    .add(baseColor.g.mul(float(0.587) as TslNode))
    .add(baseColor.b.mul(float(0.114) as TslNode));
  const cooledGround = mix(
    baseColor,
    (vec3(luminance, luminance, luminance) as TslNode)
      .mul(vec3(0.9, 0.96, 1) as TslNode)
      .add(vec3(0.025, 0.032, 0.038) as TslNode) as TslNode,
    float(0.6) as TslNode,
  ) as TslNode;
  return mix(baseColor, cooledGround, frostMask) as TslNode;
}

function applyTerrainFrostRoughness(
  baseRoughness: TslNode,
  macro: TslNode,
  weather: RoadWeatherUniforms,
  exposure?: TslNode,
): TslNode {
  return mix(
    baseRoughness,
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
  const roadWear = pow(attribute('roadWearBlend', 'float') as TslNode, float(0.62) as TslNode) as TslNode;
  const quarryPad = pow(attribute('quarryPadBlend', 'float') as TslNode, float(0.74) as TslNode) as TslNode;
  // Terrain undercoat only — bank mesh overlay carries the inner mud detail.
  const shoreUndercoat = shoreBlend.mul(float(0.58) as TslNode) as TslNode;
  const grassWithShore = mix(blendNodes.colorNode, mudColor, shoreUndercoat) as TslNode;
  const meadowWithQuarry = mix(grassWithShore, quarryColor, quarryPad) as TslNode;
  const meadowWithWear = mix(meadowWithQuarry, wearColor, roadWear) as TslNode;
  const baseColorNode = applyCloseZoomDirtBlend(
    meadowWithWear,
    dirtColor,
    shoreBlend,
    roadWear,
    quarryPad,
  );
  const frostExposure = sub(
    float(1) as TslNode,
    shoreBlend.mul(float(0.82) as TslNode),
  ) as TslNode;
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
