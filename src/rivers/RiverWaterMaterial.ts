import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  dot,
  float,
  min,
  mix,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  pow,
  screenUV,
  sin,
  sub,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  viewportSafeUV,
  viewportSharedTexture,
} from 'three/tsl';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';

type TslNode = {
  add(value: TslNode | number): TslNode;
  sub(value: TslNode | number): TslNode;
  mul(value: TslNode | number): TslNode;
  div(value: TslNode | number): TslNode;
  pow(value: TslNode | number): TslNode;
  y: TslNode;
  x: TslNode;
  z: TslNode;
  xy: TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  a: TslNode;
  rgb: TslNode;
};

type ScalarUniform = TslNode & {
  value: number;
};

const riverNightAmount = uniform(0) as ScalarUniform;
const WATER_FOAM_COLOR = vec3(0.52, 0.7, 0.66) as TslNode;
const MENISCUS_COLOR = vec3(0.57, 0.75, 0.7) as TslNode;
const SHALLOW_WATER_TINT = vec3(0.145, 0.46, 0.44) as TslNode;
const DEEP_WATER_TINT = vec3(0.085, 0.235, 0.205) as TslNode;
const DEEP_WATER_LIGHT_TINT = vec3(0.115, 0.295, 0.265) as TslNode;
const SHORE_LAP_MAX = 0.11;
const SHORE_FOAM_MAX = 0.24;
const FLOW_WAVE_HEIGHT = 0.048;
export const RIVER_WATER_TRANSMISSION = 0.82;
export const RIVER_WATER_ATTENUATION_DISTANCE = 1.75;
export const RIVER_DEEP_BACKDROP_STABILITY = 1;
export const RIVER_VISUAL_SHORE_EXPONENT = 3.8;
export const RIVER_OPTICAL_SHORE_EXPONENT = 2.45;
export const RIVER_FLOW_ROUGHNESS_FLOOR = 0.315;
export const RIVER_FLOW_HIGHLIGHT_STRENGTH = 0.2;
export const RIVER_SKY_RETURN_STRENGTH = 0.18;

function decodeFlowDirection(shoreSample: TslNode): { flowDirX: TslNode; flowDirZ: TslNode } {
  const flowRaw = (vec2(shoreSample.b, shoreSample.a) as TslNode).mul(float(2) as TslNode).sub(float(1) as TslNode) as TslNode;
  const flowLenSq = dot(flowRaw, flowRaw) as TslNode;
  const fallbackDir = vec2(float(0) as TslNode, float(-1) as TslNode) as TslNode;
  const hasFlow = (flowLenSq as TslNode).sub(float(0.0004) as TslNode) as TslNode;
  const flowDir = mix(
    fallbackDir,
    normalize(flowRaw) as TslNode,
    min(float(1) as TslNode, hasFlow.mul(float(2500) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  return { flowDirX: flowDir.x, flowDirZ: flowDir.y };
}

function buildFlowCoordinates(
  wx: TslNode,
  wz: TslNode,
  flowDirX: TslNode,
  flowDirZ: TslNode,
): { flowAlong: TslNode; flowCross: TslNode } {
  const flowAlong = wx.mul(flowDirX).add(wz.mul(flowDirZ)) as TslNode;
  const flowCross = wx.mul(flowDirZ).sub(wz.mul(flowDirX)) as TslNode;
  return { flowAlong, flowCross };
}

function buildWorldShoreUv(maps: RiverWaterShoreMaps): TslNode {
  const world = positionWorld as TslNode;
  return vec2(
    world.x.sub(float(maps.originX) as TslNode).mul(float(maps.invSpanX) as TslNode),
    world.z.sub(float(maps.originZ) as TslNode).mul(float(maps.invSpanZ) as TslNode),
  ) as TslNode;
}

function buildRiverWaterShaderNodes(shoreMaps: RiverWaterShoreMaps) {
  const simDeltaAttr = attribute('simDelta', 'float') as TslNode;
  const position = positionLocal as TslNode;
  const worldPos = positionWorld as TslNode;
  const frameTime = time as TslNode;

  const shoreSample = texture(shoreMaps.shoreTexture, buildWorldShoreUv(shoreMaps)) as TslNode;
  const featherSample = shoreSample.r;
  const foamBaseAttr = shoreSample.g;
  const { flowDirX, flowDirZ } = decodeFlowDirection(shoreSample);

  const wx = worldPos.x;
  const wz = worldPos.z;
  const { flowAlong, flowCross } = buildFlowCoordinates(wx, wz, flowDirX, flowDirZ);
  const shoreMask = pow(foamBaseAttr, float(1.05) as TslNode) as TslNode;
  // The signed-distance texture has useful organic contour lobes for the
  // shoreline, but mapping its broad ramp directly into all water optics made
  // those lobes read as disconnected black pools. Compress it to an edge-only
  // visual margin so the channel quickly settles into one continuous body.
  const shallowFactor = pow(
    shoreMask,
    float(RIVER_VISUAL_SHORE_EXPONENT) as TslNode,
  ) as TslNode;
  const depthFactor = sub(float(1) as TslNode, shallowFactor) as TslNode;
  const opticalShallowFactor = pow(
    shoreMask,
    float(RIVER_OPTICAL_SHORE_EXPONENT) as TslNode,
  ) as TslNode;
  const opticalDepthFactor = sub(float(1) as TslNode, opticalShallowFactor) as TslNode;
  const channelMask = mix(shoreMask, float(1) as TslNode, pow(depthFactor, float(0.62) as TslNode) as TslNode) as TslNode;

  const lapA = sin(
    frameTime.mul(2.35).add(flowAlong.mul(0.34)).add(flowCross.mul(0.12)) as TslNode,
  ) as TslNode;
  const lapB = sin(
    frameTime.mul(3.85).sub(flowAlong.mul(0.21)).add(flowCross.mul(0.31)) as TslNode,
  ) as TslNode;
  const lapC = sin(
    frameTime.mul(1.65).add(flowAlong.mul(0.11)).sub(flowCross.mul(0.27)) as TslNode,
  ) as TslNode;
  const lap = channelMask
    .mul(float(SHORE_LAP_MAX) as TslNode)
    .mul(lapA.mul(0.52).add(lapB.mul(0.33)).add(lapC.mul(0.15)) as TslNode) as TslNode;

  const rippleSeed = flowAlong.mul(0.16).add(frameTime.mul(0.28)).add(flowCross.mul(0.16)).sub(frameTime.mul(0.22)) as TslNode;
  const ripple = (sin(rippleSeed) as TslNode).mul(0.5).sub(0.25).mul(channelMask).mul(0.038) as TslNode;

  const flowWavePrimary = sin(flowAlong.mul(0.38).sub(frameTime.mul(2.05)) as TslNode) as TslNode;
  const flowWaveSecondary = sin(flowCross.mul(0.72).add(frameTime.mul(1.35)) as TslNode) as TslNode;
  const flowDisplacement = flowWavePrimary
    .mul(0.62)
    .add(flowWaveSecondary.mul(0.38) as TslNode)
    .mul(depthFactor)
    .mul(float(FLOW_WAVE_HEIGHT) as TslNode) as TslNode;

  const positionNode = vec3(
    position.x,
    position.y.add(simDeltaAttr.add(lap).add(ripple).add(flowDisplacement)),
    position.z,
  ) as TslNode;

  const foamNoise = (sin(flowAlong.mul(0.41).add(flowCross.mul(0.73)).add(frameTime.mul(0.44)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamWave = (sin(frameTime.mul(4.4).add(flowAlong.mul(0.68)).sub(flowCross.mul(0.51)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamPulse = (sin(frameTime.mul(6.1).add(flowAlong.mul(0.29)).sub(flowCross.mul(0.93)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamStrength = min(
    float(SHORE_FOAM_MAX) as TslNode,
    (pow(shallowFactor, float(1.05) as TslNode) as TslNode).mul(
      (float(0.025) as TslNode)
        .add(foamNoise.mul(0.11))
        .add(foamWave.mul(0.07))
        .add(foamPulse.mul(0.05)) as TslNode,
    ) as TslNode,
  ) as TslNode;

  const ribbonMeander = (sin(
    flowAlong.mul(0.095).sub(frameTime.mul(0.58)) as TslNode,
  ) as TslNode).mul(float(0.31) as TslNode) as TslNode;
  const ribbonCarrierA = (sin(
    flowCross.mul(1.85).add(ribbonMeander) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const ribbonCarrierB = (sin(
    flowCross
      .mul(3.45)
      .sub(ribbonMeander.mul(float(0.72) as TslNode) as TslNode)
      .add(flowAlong.mul(float(0.028) as TslNode) as TslNode) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const alongBreakupA = (sin(
    flowAlong.mul(0.48).add(flowCross.mul(0.11)).sub(frameTime.mul(1.15)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const alongBreakupB = sub(float(1) as TslNode, alongBreakupA) as TslNode;
  const ribbonCrestA = pow(ribbonCarrierA, float(7.5) as TslNode) as TslNode;
  const ribbonCrestB = pow(ribbonCarrierB, float(9) as TslNode) as TslNode;
  const flowStructure = ribbonCrestA
    .mul(pow(alongBreakupA, float(2.25) as TslNode) as TslNode)
    .mul(float(0.68) as TslNode)
    .add(
      ribbonCrestB
        .mul(pow(alongBreakupB, float(2.6) as TslNode) as TslNode)
        .mul(float(0.32) as TslNode) as TslNode,
    ) as TslNode;
  const flowShimmer = depthFactor
    .mul(flowStructure)
    .mul(float(RIVER_FLOW_HIGHLIGHT_STRENGTH) as TslNode) as TslNode;

  const viewDir = normalize((cameraPosition as TslNode).sub(worldPos) as TslNode) as TslNode;
  const viewDotUp = abs(dot(viewDir, vec3(0, 1, 0) as TslNode) as TslNode) as TslNode;
  // Reuse the existing depth and view factors for a restrained night-only sky
  // return. This adds no texture lookup, pass, or draw and is exactly zero by day.
  const nightSkyReturn = (vec3(0.014, 0.032, 0.043) as TslNode)
    .mul(riverNightAmount)
    .mul(mix(float(0.35) as TslNode, float(1) as TslNode, depthFactor) as TslNode)
    .mul(mix(float(0.65) as TslNode, float(1) as TslNode, viewDotUp) as TslNode) as TslNode;
  const meniscus = (pow(shallowFactor, float(1.55) as TslNode) as TslNode).mul(float(0.1) as TslNode) as TslNode;
  const bedNoiseA = (sin(worldPos.x.mul(0.11).add(worldPos.z.mul(0.09)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedNoiseB = (sin(worldPos.x.mul(0.23).sub(worldPos.z.mul(0.17)).add(float(2.7) as TslNode) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedTint = bedNoiseA.mul(0.58).add(bedNoiseB.mul(0.42)) as TslNode;
  const layeredDeepTint = mix(DEEP_WATER_TINT, DEEP_WATER_LIGHT_TINT, bedTint) as TslNode;
  const waterTint = mix(SHALLOW_WATER_TINT, layeredDeepTint, opticalDepthFactor) as TslNode;
  const flowHighlight = vec3(0.34, 0.56, 0.54) as TslNode;
  const tintedBody = mix(waterTint, flowHighlight, flowShimmer) as TslNode;
  const bodyColor = mix(tintedBody, WATER_FOAM_COLOR, foamStrength) as TslNode;
  const meniscusBody = mix(bodyColor, MENISCUS_COLOR, meniscus) as TslNode;
  const skyReturn = (pow(
    sub(float(1) as TslNode, viewDotUp) as TslNode,
    float(0.95) as TslNode,
  ) as TslNode).mul(float(RIVER_SKY_RETURN_STRENGTH) as TslNode) as TslNode;
  const surfaceReturn = min(
    float(0.22) as TslNode,
    skyReturn.add(flowStructure.mul(float(0.035) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const colorNode = mix(
    meniscusBody,
    vec3(0.28, 0.43, 0.46) as TslNode,
    surfaceReturn,
  ) as TslNode;
  const bedColor = mix(
    vec3(0.19, 0.14, 0.09) as TslNode,
    vec3(0.34, 0.26, 0.17) as TslNode,
    bedTint,
  ) as TslNode;
  const stableBackdropColor = mix(
    bedColor,
    DEEP_WATER_TINT,
    opticalDepthFactor.mul(float(RIVER_DEEP_BACKDROP_STABILITY) as TslNode) as TslNode,
  ) as TslNode;

  const flowWobble = sin(flowAlong.mul(0.52).sub(frameTime.mul(2.35)) as TslNode) as TslNode;
  const crossWobble = sin(flowCross.mul(0.41).add(frameTime.mul(1.65)) as TslNode) as TslNode;
  const refractFlow = vec2(flowWobble.mul(flowDirX), flowWobble.mul(flowDirZ)) as TslNode;
  const refractCross = vec2(crossWobble.mul(flowDirZ), crossWobble.mul(flowDirX).mul(float(-1) as TslNode)) as TslNode;
  const refractOffset = (normalView as TslNode).xy
    .mul(float(0.018) as TslNode)
    .add(refractFlow.mul(depthFactor.mul(float(0.014) as TslNode) as TslNode) as TslNode)
    .add(refractCross.mul(depthFactor.mul(float(0.009) as TslNode) as TslNode) as TslNode) as TslNode;
  const refractUv = viewportSafeUV((screenUV as TslNode).add(refractOffset) as TslNode) as TslNode;
  const sceneBehind = (viewportSharedTexture(refractUv) as TslNode).rgb as TslNode;
  const shallowBackdropStability = shallowFactor
    .mul(pow(viewDotUp, float(0.72) as TslNode) as TslNode)
    .mul(float(0.86) as TslNode) as TslNode;
  const backdropStability = min(
    float(1) as TslNode,
    shallowBackdropStability.add(
      depthFactor.mul(float(RIVER_DEEP_BACKDROP_STABILITY) as TslNode) as TslNode,
    ) as TslNode,
  ) as TslNode;
  const backdropNode = mix(sceneBehind, stableBackdropColor, backdropStability) as TslNode;
  const backdropAlphaNode = mix(
    float(0.38) as TslNode,
    float(0.82) as TslNode,
    opticalShallowFactor.mul(pow(viewDotUp, float(0.65) as TslNode) as TslNode) as TslNode,
  ) as TslNode;

  const thicknessNode = mix(float(0.05) as TslNode, float(0.78) as TslNode, opticalDepthFactor) as TslNode;
  const specularIntensityNode = mix(
    float(0.24) as TslNode,
    float(0.5) as TslNode,
    (pow(opticalShallowFactor, float(1.35) as TslNode) as TslNode)
      .add(opticalDepthFactor.mul(float(0.28) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const roughnessNode = mix(
    float(0.34) as TslNode,
    float(RIVER_FLOW_ROUGHNESS_FLOOR) as TslNode,
    min(
      float(1) as TslNode,
      flowStructure.mul(depthFactor).mul(float(0.62) as TslNode) as TslNode,
    ) as TslNode,
  ) as TslNode;

  const animatedFeather = pow(featherSample, float(0.92) as TslNode) as TslNode;
  const volumeOpacity = mix(float(0.42) as TslNode, float(0.66) as TslNode, opticalDepthFactor) as TslNode;
  const surfaceFilm = opticalShallowFactor
    .mul(float(0.18) as TslNode)
    .add(opticalDepthFactor.mul(float(0.08) as TslNode) as TslNode) as TslNode;
  const opacityNode = animatedFeather.mul(
    min(float(0.82) as TslNode, volumeOpacity.add(surfaceFilm) as TslNode) as TslNode,
  ) as TslNode;

  return {
    positionNode,
    colorNode,
    emissiveNode: nightSkyReturn,
    opacityNode,
    backdropNode,
    backdropAlphaNode,
    thicknessNode,
    specularIntensityNode,
    roughnessNode,
  };
}

let sharedWaterMaterial: MeshPhysicalNodeMaterial | null = null;
let sharedShoreMaps: RiverWaterShoreMaps | null = null;

export function getSharedRiverWaterMaterial(shoreMaps: RiverWaterShoreMaps): MeshPhysicalNodeMaterial {
  if (sharedWaterMaterial && sharedShoreMaps === shoreMaps) return sharedWaterMaterial;

  disposeSharedRiverWaterMaterial();

  const nodes = buildRiverWaterShaderNodes(shoreMaps);
  const material = new MeshPhysicalNodeMaterial();
  material.name = 'RiverWaterMaterial';
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.roughness = 0.3;
  material.metalness = 0;
  material.ior = 1.33;
  material.transmission = RIVER_WATER_TRANSMISSION;
  material.thickness = 0.65;
  material.attenuationDistance = RIVER_WATER_ATTENUATION_DISTANCE;
  material.attenuationColor = new THREE.Color(0.14, 0.22, 0.12);
  material.specularIntensity = 0.5;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.positionNode = nodes.positionNode;
  material.colorNode = nodes.colorNode;
  (material as MeshPhysicalNodeMaterial & { emissiveNode: unknown }).emissiveNode = nodes.emissiveNode;
  material.opacityNode = nodes.opacityNode;
  material.backdropNode = nodes.backdropNode;
  material.backdropAlphaNode = nodes.backdropAlphaNode;
  material.thicknessNode = nodes.thicknessNode;
  material.specularIntensityNode = nodes.specularIntensityNode;
  material.roughnessNode = nodes.roughnessNode;
  sharedWaterMaterial = material;
  sharedShoreMaps = shoreMaps;
  return sharedWaterMaterial;
}

export function normalizeRiverWaterNightAmount(amount: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
}

export function setSharedRiverWaterNightAmount(amount: number): void {
  riverNightAmount.value = normalizeRiverWaterNightAmount(amount);
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
}
