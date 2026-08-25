import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  normalMap,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sub,
  texture,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { applyNaturalPainterlyMaterial } from '../scene/naturalPainterlyMaterial.ts';
import type { TextureSet } from './RoadTextureLoader.ts';

type TslNode = {
  add(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  rgb: TslNode;
  x: TslNode;
  z: TslNode;
};

type TslScalarUniform = TslNode & {
  value: number;
};

// Calibrated against the supplied #786b61 grey-brown dirt reference after
// the road's low-frequency tint is applied.
const ROAD_DIRT_REFERENCE_TINT: [number, number, number] = [1.297, 1.206, 1.197];
const ROAD_DIRT_EDGE_REFERENCE_TINT: [number, number, number] = [1.326, 1.2, 1.153];

export type RoadWeatherUniforms = {
  wetness: TslScalarUniform;
  frost: TslScalarUniform;
};

export function createRoadWeatherUniforms(): RoadWeatherUniforms {
  return {
    wetness: uniform(0) as unknown as TslScalarUniform,
    frost: uniform(0) as unknown as TslScalarUniform,
  };
}

function greyCoolRoadColor(map: TslNode, desaturate: number, tint: [number, number, number]): TslNode {
  const luminance = map.r
    .mul(float(0.299) as TslNode)
    .add(map.g.mul(float(0.587) as TslNode))
    .add(map.b.mul(float(0.114) as TslNode));
  const desaturated = mix(map.rgb, vec3(luminance, luminance, luminance) as TslNode, float(desaturate) as TslNode) as TslNode;
  return desaturated.mul(vec3(tint[0], tint[1], tint[2]) as TslNode);
}

function buildRoadColorNode(textures: TextureSet, desaturate: number, tint: [number, number, number]): TslNode {
  const sample = texture(textures.albedo, uv() as TslNode) as TslNode;
  const baseColor = greyCoolRoadColor(sample, desaturate, tint);
  const world = positionWorld as TslNode;
  const macroA = (sin(
    world.x
      .mul(float(0.043) as TslNode)
      .add(world.z.mul(float(0.031) as TslNode)) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macroB = (sin(
    world.x
      .mul(float(-0.019) as TslNode)
      .add(world.z.mul(float(0.067) as TslNode))
      .add(float(1.73) as TslNode) as TslNode,
  ) as TslNode).mul(float(0.5) as TslNode).add(float(0.5) as TslNode);
  const macro = macroA.mul(float(0.62) as TslNode).add(macroB.mul(float(0.38) as TslNode));
  const macroTint = mix(
    vec3(0.88, 0.84, 0.77) as TslNode,
    vec3(1.04, 1.02, 0.97) as TslNode,
    macro,
  ) as TslNode;
  return baseColor.mul(macroTint);
}

function buildRoadRutMask(textures: TextureSet): TslNode {
  if (!textures.rutMask) return float(0) as TslNode;
  return pow(
    (texture(textures.rutMask, uv() as TslNode) as TslNode).r,
    float(1.18) as TslNode,
  ) as TslNode;
}

function applyRoadRutColor(baseColor: TslNode, rutMask: TslNode): TslNode {
  const compacted = baseColor.mul(vec3(0.66, 0.62, 0.56) as TslNode);
  return mix(
    baseColor,
    compacted,
    rutMask.mul(float(0.44) as TslNode),
  ) as TslNode;
}

function applyRoadWeatherColor(
  baseColor: TslNode,
  weather: RoadWeatherUniforms,
  frostStrength = 1,
): TslNode {
  const wetTint = baseColor.mul(vec3(0.48, 0.47, 0.44) as TslNode);
  const wetColor = mix(
    baseColor,
    wetTint,
    weather.wetness.mul(float(0.48) as TslNode),
  ) as TslNode;
  return mix(
    wetColor,
    vec3(0.5, 0.54, 0.57) as TslNode,
    weather.frost.mul(float(0.15 * frostStrength) as TslNode),
  ) as TslNode;
}

function applyRoadWeatherRoughness(
  baseRoughness: TslNode,
  weather: RoadWeatherUniforms,
): TslNode {
  const wetRoughness = mix(
    baseRoughness,
    float(0.42) as TslNode,
    weather.wetness.mul(float(0.82) as TslNode),
  ) as TslNode;
  return mix(
    wetRoughness,
    float(0.9) as TslNode,
    weather.frost.mul(float(0.78) as TslNode),
  ) as TslNode;
}

function buildMuddyBankColorNode(textures: TextureSet): TslNode {
  const sample = texture(textures.albedo, uv() as TslNode) as TslNode;
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
  const wetEdge = pow((uv() as TslNode).x, float(1.35) as TslNode) as TslNode;
  const dampTint = warmTint.mul(vec3(0.42, 0.38, 0.33) as TslNode);
  return mix(
    warmTint.mul(float(0.86) as TslNode),
    dampTint,
    wetEdge.mul(float(0.78) as TslNode),
  ) as TslNode;
}

function buildBankOpacityNode(_textures: TextureSet): TslNode {
  const edgeFade = attribute('edgeFade', 'float') as TslNode;
  // The old striped edge-mask texture turned into a dotted one-pixel contour
  // when the shoulder was minified. An analytic feather has a true-zero outer
  // band and stays continuous at every camera scale. Keep this mask separate
  // from the albedo UVs so junction dirt can follow one road orientation
  // instead of forming a radial texture knot.
  return (smoothstep(
    float(0.08) as TslNode,
    float(0.82) as TslNode,
    edgeFade,
  ) as TslNode).mul(float(0.94) as TslNode) as TslNode;
}

function buildRiverBankOpacityNode(): TslNode {
  const uvNode = uv() as TslNode;
  // Leave a true-zero outer band before the bank begins its broad analytic
  // fade. A sublinear power here amplified tiny raster coverage into a dark
  // stitched contour around the river.
  return (smoothstep(
    float(0.08) as TslNode,
    float(0.62) as TslNode,
    uvNode.x,
  ) as TslNode).mul(float(0.94) as TslNode) as TslNode;
}

export function createRoadCoreMaterial(
  dirtTextures: TextureSet,
  weather: RoadWeatherUniforms,
  bridgeTextures?: TextureSet,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Road core';
  material.color.set(0xffffff);
  material.roughness = 0.99;
  material.metalness = 0;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  const rutMask = buildRoadRutMask(dirtTextures);
  const dirtColor = applyRoadRutColor(
    buildRoadColorNode(dirtTextures, 0.72, ROAD_DIRT_REFERENCE_TINT),
    rutMask,
  );
  if (bridgeTextures) {
    const woodColor = buildRoadColorNode(bridgeTextures, 0.38, [1.02, 0.96, 0.88]);
    const bridgeBlend = pow(attribute('bridgeBlend', 'float') as TslNode, float(0.92) as TslNode) as TslNode;
    const surfaceColor = mix(dirtColor, woodColor, bridgeBlend) as TslNode;
    material.colorNode = applyRoadWeatherColor(surfaceColor, weather);

    const dirtNormal = normalMap(texture(dirtTextures.normal, uv()));
    const woodNormal = normalMap(texture(bridgeTextures.normal, uv()));
    material.normalNode = mix(dirtNormal, woodNormal, bridgeBlend);

    const dirtRoughBase = (texture(dirtTextures.roughness, uv() as TslNode) as TslNode).r;
    const dirtRough = mix(
      dirtRoughBase,
      float(0.58) as TslNode,
      rutMask.mul(float(0.46) as TslNode),
    ) as TslNode;
    const woodRough = (texture(bridgeTextures.roughness, uv() as TslNode) as TslNode).r;
    const surfaceRoughness = mix(
      dirtRough,
      woodRough.mul(float(0.94) as TslNode),
      bridgeBlend,
    ) as TslNode;
    material.roughnessNode = applyRoadWeatherRoughness(surfaceRoughness, weather);
    if (dirtTextures.ao) material.aoNode = (texture(dirtTextures.ao, uv() as TslNode) as TslNode).r;
    applyNaturalPainterlyMaterial(material, {
      role: 'road',
      coverageNode: sub(float(1) as TslNode, bridgeBlend) as never,
    });
  } else {
    material.colorNode = applyRoadWeatherColor(dirtColor, weather);
    material.normalNode = normalMap(texture(dirtTextures.normal, uv()));
    const dirtRoughnessBase = (texture(dirtTextures.roughness, uv() as TslNode) as TslNode).r;
    const dirtRoughness = mix(
      dirtRoughnessBase,
      float(0.58) as TslNode,
      rutMask.mul(float(0.46) as TslNode),
    ) as TslNode;
    material.roughnessNode = applyRoadWeatherRoughness(dirtRoughness, weather);
    if (dirtTextures.ao) material.aoNode = (texture(dirtTextures.ao, uv() as TslNode) as TslNode).r;
    applyNaturalPainterlyMaterial(material, { role: 'road' });
  }
  return material;
}

export function createRoadEdgeMaterial(
  textures: TextureSet,
  weather: RoadWeatherUniforms,
  fadeBridgeEdges = true,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Road edge blend';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.transparent = true;
  material.premultipliedAlpha = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  const edgeColor = buildRoadColorNode(textures, 0.78, ROAD_DIRT_EDGE_REFERENCE_TINT);
  material.colorNode = applyRoadWeatherColor(edgeColor, weather, 1.12);
  const edgeRoughness = (texture(textures.roughness, uv() as TslNode) as TslNode).r;
  material.roughnessNode = applyRoadWeatherRoughness(edgeRoughness, weather);
  let opacity = buildBankOpacityNode(textures);
  if (fadeBridgeEdges) {
    const bridgeBlendAttr = attribute('bridgeBlend', 'float') as TslNode;
    const edgeKeep = sub(float(1) as TslNode, bridgeBlendAttr) as TslNode;
    opacity = opacity.mul(edgeKeep) as TslNode;
  }
  material.opacityNode = opacity;
  applyNaturalPainterlyMaterial(material, { role: 'road' });
  return material;
}

export function createRiverBankMaterial(textures: TextureSet): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'River bank mud';
  material.color.set(0xffffff);
  material.roughness = 0.9;
  material.metalness = 0;
  material.transparent = true;
  material.premultipliedAlpha = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -3;
  material.polygonOffsetUnits = -8;
  material.colorNode = buildMuddyBankColorNode(textures);
  material.normalNode = normalMap(texture(textures.normal, uv()));
  const roughSample = (texture(textures.roughness, uv() as TslNode) as TslNode).r;
  const baseRoughness = mix(roughSample, float(0.58) as TslNode, float(0.42) as TslNode);
  const wetEdge = pow((uv() as TslNode).x, float(1.35) as TslNode) as TslNode;
  material.roughnessNode = mix(
    baseRoughness,
    float(0.34) as TslNode,
    wetEdge.mul(float(0.74) as TslNode),
  );
  if (textures.ao) material.aoNode = (texture(textures.ao, uv() as TslNode) as TslNode).r;
  material.opacityNode = buildRiverBankOpacityNode();
  applyNaturalPainterlyMaterial(material, { role: 'soil' });
  return material;
}
