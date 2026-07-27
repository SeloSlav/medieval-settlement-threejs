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

const WATER_FOAM_COLOR = vec3(0.74, 0.86, 0.82) as TslNode;
const MENISCUS_COLOR = vec3(0.8, 0.9, 0.86) as TslNode;
const SHALLOW_WATER_TINT = vec3(0.24, 0.46, 0.42) as TslNode;
const DEEP_WATER_TINT = vec3(0.08, 0.17, 0.15) as TslNode;
const SHORE_LAP_MAX = 0.11;
const SHORE_FOAM_MAX = 0.48;
const FLOW_STREAK_STRENGTH = 0.28;
const FLOW_WAVE_HEIGHT = 0.048;

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
  const depthFactor = pow(sub(float(1) as TslNode, foamBaseAttr) as TslNode, float(0.88) as TslNode) as TslNode;
  const shallowFactor = shoreMask;
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

  const foamNoise = (sin(flowAlong.mul(0.19).add(flowCross.mul(0.17)).add(frameTime.mul(0.44)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamWave = (sin(frameTime.mul(4.4).add(flowAlong.mul(0.19)).sub(flowCross.mul(0.16)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamPulse = (sin(frameTime.mul(6.1).add(flowAlong.mul(0.11)).sub(flowCross.mul(0.27)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamStrength = min(
    float(SHORE_FOAM_MAX) as TslNode,
    (pow(shoreMask, float(1.45) as TslNode) as TslNode).mul(
      (float(0.14) as TslNode)
        .add(foamNoise.mul(0.26))
        .add(foamWave.mul(0.22))
        .add(foamPulse.mul(0.18)) as TslNode,
    ) as TslNode,
  ) as TslNode;

  const flowStreakA = (sin(flowAlong.mul(0.44).sub(frameTime.mul(1.95)) as TslNode) as TslNode).mul(0.5).add(0.5) as TslNode;
  const flowStreakB = (sin(flowCross.mul(1.65).add(frameTime.mul(0.72)) as TslNode) as TslNode).mul(0.5).add(0.5) as TslNode;
  const flowStreakC = (sin(flowAlong.mul(0.18).sub(frameTime.mul(0.95)).add(flowCross.mul(0.31)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const flowShimmer = depthFactor.mul(
    flowStreakA.mul(0.42).add(flowStreakB.mul(0.33)).add(flowStreakC.mul(0.25)) as TslNode,
  ).mul(float(FLOW_STREAK_STRENGTH) as TslNode) as TslNode;

  const meniscus = (pow(shoreMask, float(2.8) as TslNode) as TslNode).mul(float(0.22) as TslNode) as TslNode;
  const waterTint = mix(SHALLOW_WATER_TINT, DEEP_WATER_TINT, depthFactor) as TslNode;
  const flowHighlight = vec3(0.34, 0.58, 0.54) as TslNode;
  const tintedBody = mix(waterTint, flowHighlight, flowShimmer) as TslNode;
  const bodyColor = mix(tintedBody, WATER_FOAM_COLOR, foamStrength) as TslNode;
  const colorNode = mix(bodyColor, MENISCUS_COLOR, meniscus) as TslNode;

  const viewDir = normalize((cameraPosition as TslNode).sub(worldPos) as TslNode) as TslNode;
  const viewDotUp = abs(dot(viewDir, vec3(0, 1, 0) as TslNode) as TslNode) as TslNode;
  const bedNoiseA = (sin(worldPos.x.mul(0.11).add(worldPos.z.mul(0.09)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedNoiseB = (sin(worldPos.x.mul(0.23).sub(worldPos.z.mul(0.17)).add(float(2.7) as TslNode) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedTint = bedNoiseA.mul(0.58).add(bedNoiseB.mul(0.42)) as TslNode;
  const bedColor = mix(
    vec3(0.19, 0.14, 0.09) as TslNode,
    vec3(0.34, 0.26, 0.17) as TslNode,
    bedTint,
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
  const bedVisibility = shallowFactor
    .mul(pow(viewDotUp, float(0.72) as TslNode) as TslNode)
    .mul(float(0.86) as TslNode)
    .add(depthFactor.mul(float(0.14) as TslNode) as TslNode) as TslNode;
  const backdropNode = mix(sceneBehind, bedColor, bedVisibility) as TslNode;
  const backdropAlphaNode = mix(
    float(0.38) as TslNode,
    float(0.82) as TslNode,
    shallowFactor.mul(pow(viewDotUp, float(0.65) as TslNode) as TslNode) as TslNode,
  ) as TslNode;

  const thicknessNode = mix(float(0.05) as TslNode, float(0.78) as TslNode, depthFactor) as TslNode;
  const specularIntensityNode = mix(
    float(0.24) as TslNode,
    float(0.5) as TslNode,
    (pow(shoreMask, float(1.55) as TslNode) as TslNode).add(depthFactor.mul(float(0.28) as TslNode) as TslNode) as TslNode,
  ) as TslNode;

  const animatedFeather = pow(featherSample, float(0.92) as TslNode) as TslNode;
  const volumeOpacity = mix(float(0.46) as TslNode, float(0.74) as TslNode, depthFactor) as TslNode;
  const surfaceFilm = shoreMask.mul(float(0.24) as TslNode).add(depthFactor.mul(float(0.14) as TslNode) as TslNode) as TslNode;
  const opacityNode = animatedFeather.mul(
    min(float(0.9) as TslNode, volumeOpacity.add(surfaceFilm) as TslNode) as TslNode,
  ) as TslNode;

  return {
    positionNode,
    colorNode,
    opacityNode,
    backdropNode,
    backdropAlphaNode,
    thicknessNode,
    specularIntensityNode,
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
  material.transmission = 0.82;
  material.thickness = 0.65;
  material.attenuationDistance = 1.75;
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
  material.opacityNode = nodes.opacityNode;
  material.backdropNode = nodes.backdropNode;
  material.backdropAlphaNode = nodes.backdropAlphaNode;
  material.thicknessNode = nodes.thicknessNode;
  material.specularIntensityNode = nodes.specularIntensityNode;
  sharedWaterMaterial = material;
  sharedShoreMaps = shoreMaps;
  return sharedWaterMaterial;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
}
