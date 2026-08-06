import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  distance,
  dot,
  float,
  max,
  min,
  mix,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  sub,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportSafeUV,
  viewportSharedTexture,
} from 'three/tsl';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';

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
  xyz: TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  a: TslNode;
  rgb: TslNode;
};

type ScalarUniform = TslNode & {
  value: number;
};

type ColorUniform = TslNode & {
  value: THREE.Color;
};

type VectorUniform = TslNode & {
  value: THREE.Vector3;
};

const riverNightAmount = uniform(0) as ScalarUniform;
const riverSkyZenith = uniform(new THREE.Color(0x2f72b0)) as unknown as ColorUniform;
const riverSkyHorizon = uniform(new THREE.Color(0xa7c2d0)) as unknown as ColorUniform;
const riverCloudColor = uniform(new THREE.Color(0xd6dddf)) as unknown as ColorUniform;
const riverCelestialColor = uniform(new THREE.Color(0xfff2dc)) as unknown as ColorUniform;
const riverCelestialDirection = uniform(new THREE.Vector3(0.35, 0.75, -0.56).normalize()) as unknown as VectorUniform;
const riverCelestialIntensity = uniform(1) as ScalarUniform;
const riverCloudReflectionStrength = uniform(0.34) as ScalarUniform;
const WATER_FOAM_COLOR = vec3(0.43, 0.61, 0.56) as TslNode;
const MENISCUS_COLOR = vec3(0.46, 0.64, 0.59) as TslNode;
const SHALLOW_WATER_TINT = vec3(0.145, 0.46, 0.44) as TslNode;
const DEEP_WATER_TINT = vec3(0.055, 0.165, 0.14) as TslNode;
const DEEP_WATER_LIGHT_TINT = vec3(0.085, 0.225, 0.195) as TslNode;
const SHORE_LAP_MAX = 0.11;
const SHORE_FOAM_MAX = 0.16;
const FLOW_WAVE_HEIGHT = 0.048;
export const RIVER_WATER_TRANSMISSION = 0.72;
export const RIVER_WATER_ATTENUATION_DISTANCE = 2.6;
export const RIVER_DEEP_BACKDROP_STABILITY = 1;
export const RIVER_VISUAL_SHORE_EXPONENT = 3.8;
export const RIVER_OPTICAL_SHORE_EXPONENT = 2;
export const RIVER_BANK_BED_REVEAL = 0.72;
export const RIVER_FLOW_ROUGHNESS_FLOOR = 0.315;
export const RIVER_FLOW_HIGHLIGHT_STRENGTH = 0.2;
export const RIVER_SKY_RETURN_STRENGTH = 0.56;
export const RIVER_REFLECTION_FRESNEL_FLOOR = 0.39;
export const RIVER_CLOSE_REFLECTION_DISTANCE = 155;
export const RIVER_PAINTERLY_REFLECTION_SAMPLES = 2;

export type RiverWaterReflectionState = Readonly<{
  solarElevationDeg: number;
  nightAmount: number;
  celestialColor: THREE.ColorRepresentation;
  celestialDirection: THREE.Vector3;
  celestialIntensity: number;
  weatherTint?: THREE.ColorRepresentation;
  weatherBlend?: number;
}>;

type RiverWaterSkyPalette = Readonly<{
  zenith: THREE.Color;
  horizon: THREE.Color;
  cloud: THREE.Color;
}>;

type SkyPaletteEntry = Readonly<{
  elevation: number;
  zenith: number;
  horizon: number;
}>;

const SKY_PALETTE: readonly SkyPaletteEntry[] = [
  { elevation: -18, zenith: 0x03040e, horizon: 0x080b1a },
  { elevation: -6, zenith: 0x06121d, horizon: 0x301f30 },
  { elevation: 0, zenith: 0x12214d, horizon: 0xff8f52 },
  { elevation: 8, zenith: 0x2957b3, horizon: 0xffc28c },
  { elevation: 30, zenith: 0x2661d1, horizon: 0x9ec7eb },
  { elevation: 70, zenith: 0x1c59cc, horizon: 0x99c2e6 },
] as const;
const PALETTE_COLOR_A = new THREE.Color();
const PALETTE_COLOR_B = new THREE.Color();
const WEATHER_TINT = new THREE.Color();

export function computeRiverWaterSkyPalette(
  solarElevationDeg: number,
  nightAmount: number,
  weatherTint: THREE.ColorRepresentation = 0x9fbccc,
  weatherBlend = 0,
): RiverWaterSkyPalette {
  const elevation = Number.isFinite(solarElevationDeg) ? solarElevationDeg : 30;
  let lower = SKY_PALETTE[0];
  let upper = SKY_PALETTE[SKY_PALETTE.length - 1];
  for (let i = 0; i < SKY_PALETTE.length - 1; i += 1) {
    if (elevation <= SKY_PALETTE[i + 1].elevation) {
      lower = SKY_PALETTE[i];
      upper = SKY_PALETTE[i + 1];
      break;
    }
  }
  if (elevation <= SKY_PALETTE[0].elevation) upper = lower;
  if (elevation >= SKY_PALETTE[SKY_PALETTE.length - 1].elevation) lower = upper;
  const span = Math.max(1e-6, upper.elevation - lower.elevation);
  const blend = THREE.MathUtils.clamp((elevation - lower.elevation) / span, 0, 1);
  const atmosphericBlend = THREE.MathUtils.clamp(
    Number.isFinite(weatherBlend) ? weatherBlend : 0,
    0,
    1,
  );
  const night = normalizeRiverWaterNightAmount(nightAmount);
  WEATHER_TINT.set(weatherTint);
  const zenith = PALETTE_COLOR_A.setHex(lower.zenith)
    .lerp(PALETTE_COLOR_B.setHex(upper.zenith), blend)
    .lerp(WEATHER_TINT, atmosphericBlend * 0.42)
    .clone();
  const horizon = PALETTE_COLOR_A.setHex(lower.horizon)
    .lerp(PALETTE_COLOR_B.setHex(upper.horizon), blend)
    .lerp(WEATHER_TINT, atmosphericBlend * 0.64)
    .clone();
  const cloud = horizon.clone().lerp(
    PALETTE_COLOR_B.setHex(night > 0.5 ? 0x243549 : 0xe6ecec),
    THREE.MathUtils.lerp(0.36, 0.62, 1 - night),
  );
  return { zenith, horizon, cloud };
}

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
  const frameTime = worldAnimationTime as unknown as TslNode;

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
  const bankBedReveal = opticalShallowFactor.mul(float(RIVER_BANK_BED_REVEAL) as TslNode) as TslNode;
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
  const ribbonCrestA = pow(ribbonCarrierA, float(5.5) as TslNode) as TslNode;
  const ribbonCrestB = pow(ribbonCarrierB, float(7) as TslNode) as TslNode;
  const flowStructure = ribbonCrestA
    .mul(pow(alongBreakupA, float(1.65) as TslNode) as TslNode)
    .mul(float(0.68) as TslNode)
    .add(
      ribbonCrestB
        .mul(pow(alongBreakupB, float(1.9) as TslNode) as TslNode)
        .mul(float(0.32) as TslNode) as TslNode,
    ) as TslNode;
  const flowShimmer = depthFactor
    .mul(flowStructure)
    .mul(float(RIVER_FLOW_HIGHLIGHT_STRENGTH) as TslNode) as TslNode;

  const viewDir = normalize((cameraPosition as TslNode).sub(worldPos) as TslNode) as TslNode;
  const viewDotUp = abs(dot(viewDir, vec3(0, 1, 0) as TslNode) as TslNode) as TslNode;
  const viewDistance = distance(cameraPosition as TslNode, worldPos) as TslNode;
  const closeDetail = sub(
    float(1) as TslNode,
    smoothstep(
      float(42) as TslNode,
      float(RIVER_CLOSE_REFLECTION_DISTANCE) as TslNode,
      viewDistance,
    ) as TslNode,
  ) as TslNode;

  // The mesh displacement supplies broad silhouette motion. A separate bounded
  // analytic normal adds the fine ripples that make reflected shapes break into
  // painterly strokes up close without tessellation, normal maps, or another pass.
  const primarySlope = (sin(
    flowAlong.mul(0.38).sub(frameTime.mul(2.05)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(depthFactor)
    .mul(0.052) as TslNode;
  const crossSlope = (sin(
    flowCross.mul(0.72).add(frameTime.mul(1.35)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(depthFactor)
    .mul(0.043) as TslNode;
  const microA = (sin(
    flowAlong.mul(2.15).sub(frameTime.mul(3.2)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(closeDetail)
    .mul(0.032) as TslNode;
  const microB = (sin(
    flowCross.mul(3.1).add(frameTime.mul(2.45)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(closeDetail)
    .mul(0.024) as TslNode;
  const rippleSlopeX = primarySlope.mul(flowDirX)
    .add(crossSlope.mul(flowDirZ))
    .add(microA.mul(flowDirX))
    .add(microB.mul(flowDirZ)) as TslNode;
  const rippleSlopeZ = primarySlope.mul(flowDirZ)
    .sub(crossSlope.mul(flowDirX))
    .add(microA.mul(flowDirZ))
    .sub(microB.mul(flowDirX)) as TslNode;
  const rippleNormalWorld = normalize(vec3(
    rippleSlopeX.mul(-1),
    float(1) as TslNode,
    rippleSlopeZ.mul(-1),
  ) as TslNode) as TslNode;
  const normalNode = normalize(
    (cameraViewMatrix as TslNode).mul(vec4(rippleNormalWorld, float(0) as TslNode) as TslNode).xyz,
  ) as TslNode;

  // Reflect the live time-of-day palette for every solar state. The procedural
  // cloud mass is deliberately low-frequency; flow normals and screen-space
  // shoreline colour provide the smaller painterly breakup.
  const incidentDir = viewDir.mul(-1) as TslNode;
  const reflectionDir = normalize(
    incidentDir.sub(
      rippleNormalWorld.mul(
        (dot(incidentDir, rippleNormalWorld) as TslNode).mul(2),
      ) as TslNode,
    ) as TslNode,
  ) as TslNode;
  const reflectedElevation = max(float(0) as TslNode, reflectionDir.y) as TslNode;
  const skyGradient = pow(reflectedElevation, float(0.42) as TslNode) as TslNode;
  const clearSkyReflection = mix(
    riverSkyHorizon,
    riverSkyZenith,
    skyGradient,
  ) as TslNode;
  const cloudPhaseA = (sin(
    reflectionDir.x.mul(9.7)
      .add(reflectionDir.z.mul(6.1))
      .add(frameTime.mul(0.018)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const cloudPhaseB = (sin(
    reflectionDir.x.mul(17.3)
      .sub(reflectionDir.z.mul(12.7))
      .sub(frameTime.mul(0.011)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const cloudMass = pow(
    cloudPhaseA.mul(0.64).add(cloudPhaseB.mul(0.36)) as TslNode,
    float(2.35) as TslNode,
  ) as TslNode;
  const skyReflection = mix(
    clearSkyReflection,
    riverCloudColor,
    cloudMass.mul(riverCloudReflectionStrength) as TslNode,
  ) as TslNode;
  const celestialAlignment = max(
    float(0) as TslNode,
    dot(reflectionDir, riverCelestialDirection) as TslNode,
  ) as TslNode;
  const celestialReturn = riverCelestialColor
    .mul(riverCelestialIntensity)
    .mul(
      (pow(celestialAlignment, float(180) as TslNode) as TslNode)
        .mul(1.35)
        .add((pow(celestialAlignment, float(18) as TslNode) as TslNode).mul(0.09)) as TslNode,
    ) as TslNode;

  const reflectionReach = mix(
    float(0.026) as TslNode,
    float(0.105) as TslNode,
    pow(sub(float(1) as TslNode, viewDotUp) as TslNode, float(0.7) as TslNode) as TslNode,
  ) as TslNode;
  const reflectionDistortion = vec2(
    rippleSlopeX.mul(0.11),
    rippleSlopeZ.mul(0.075),
  ) as TslNode;
  const nearReflectionUv = viewportSafeUV(
    (screenUV as TslNode)
      .add(reflectionDistortion)
      .add(vec2(float(0) as TslNode, reflectionReach.mul(-1)) as TslNode) as TslNode,
  ) as TslNode;
  const farReflectionUv = viewportSafeUV(
    (screenUV as TslNode)
      .sub(reflectionDistortion.mul(0.55) as TslNode)
      .add(vec2(float(0) as TslNode, reflectionReach.mul(-1.8)) as TslNode) as TslNode,
  ) as TslNode;
  const nearReflection = (viewportSharedTexture(nearReflectionUv) as TslNode).rgb as TslNode;
  const farReflection = (viewportSharedTexture(farReflectionUv) as TslNode).rgb as TslNode;
  const reflectedSurroundings = nearReflection.mul(0.68).add(farReflection.mul(0.32)) as TslNode;
  const surroundingsLuma = dot(
    reflectedSurroundings,
    vec3(0.2126, 0.7152, 0.0722) as TslNode,
  ) as TslNode;
  const painterlySurroundings = mix(
    vec3(surroundingsLuma.mul(0.64)) as TslNode,
    reflectedSurroundings.mul(0.78) as TslNode,
    float(0.74) as TslNode,
  ) as TslNode;
  const surroundingsReturn = closeDetail
    .mul(pow(sub(float(1) as TslNode, viewDotUp) as TslNode, float(0.62) as TslNode) as TslNode)
    .mul(depthFactor)
    .mul(mix(float(0.2) as TslNode, float(0.42) as TslNode, flowStructure) as TslNode) as TslNode;
  const reflectedSurface = mix(skyReflection, painterlySurroundings, surroundingsReturn) as TslNode;
  const fresnel = pow(
    sub(float(1) as TslNode, viewDotUp) as TslNode,
    float(3.4) as TslNode,
  ) as TslNode;
  const reflectionEnergy = mix(
    float(RIVER_REFLECTION_FRESNEL_FLOOR) as TslNode,
    float(RIVER_SKY_RETURN_STRENGTH) as TslNode,
    fresnel,
  ) as TslNode;
  const reflectionNode = reflectedSurface
    .mul(reflectionEnergy)
    .mul(mix(float(0.62) as TslNode, float(1) as TslNode, depthFactor) as TslNode)
    .add(celestialReturn) as TslNode;

  // Preserve a small photographic adaptation floor at night in addition to
  // the real palette reflection so moonless water never collapses to black.
  const nightSkyReturn = (vec3(0.02, 0.043, 0.055) as TslNode)
    .mul(riverNightAmount)
    .mul(mix(float(0.62) as TslNode, float(1) as TslNode, depthFactor) as TslNode)
    .mul(mix(float(0.7) as TslNode, float(1) as TslNode, viewDotUp) as TslNode) as TslNode;
  const meniscus = (pow(shallowFactor, float(1.55) as TslNode) as TslNode).mul(float(0.06) as TslNode) as TslNode;
  const bedNoiseA = (sin(worldPos.x.mul(0.11).add(worldPos.z.mul(0.09)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedNoiseB = (sin(worldPos.x.mul(0.23).sub(worldPos.z.mul(0.17)).add(float(2.7) as TslNode) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const bedTint = bedNoiseA.mul(0.58).add(bedNoiseB.mul(0.42)) as TslNode;
  const layeredDeepTint = mix(DEEP_WATER_TINT, DEEP_WATER_LIGHT_TINT, bedTint) as TslNode;
  const waterTint = mix(layeredDeepTint, SHALLOW_WATER_TINT, bankBedReveal) as TslNode;
  const flowHighlight = vec3(0.34, 0.56, 0.54) as TslNode;
  const tintedBody = mix(waterTint, flowHighlight, flowShimmer) as TslNode;
  const bodyColor = mix(tintedBody, WATER_FOAM_COLOR, foamStrength) as TslNode;
  const meniscusBody = mix(bodyColor, MENISCUS_COLOR, meniscus) as TslNode;
  const reflectedColorWeight = reflectionEnergy.mul(
    mix(float(0.58) as TslNode, float(0.86) as TslNode, depthFactor) as TslNode,
  ) as TslNode;
  const colorNode = mix(meniscusBody, reflectedSurface, reflectedColorWeight) as TslNode;
  const bedColor = mix(
    vec3(0.19, 0.14, 0.09) as TslNode,
    vec3(0.34, 0.26, 0.17) as TslNode,
    bedTint,
  ) as TslNode;
  const stableBackdropColor = mix(
    DEEP_WATER_TINT,
    bedColor,
    bankBedReveal.mul(float(RIVER_DEEP_BACKDROP_STABILITY) as TslNode) as TslNode,
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
    float(0.72) as TslNode,
    float(0.88) as TslNode,
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
  const volumeOpacity = mix(float(0.4) as TslNode, float(0.68) as TslNode, opticalDepthFactor) as TslNode;
  const surfaceFilm = opticalShallowFactor
    .mul(float(0.14) as TslNode)
    .add(opticalDepthFactor.mul(float(0.1) as TslNode) as TslNode) as TslNode;
  const opacityNode = animatedFeather.mul(
    min(float(0.82) as TslNode, volumeOpacity.add(surfaceFilm) as TslNode) as TslNode,
  ) as TslNode;

  return {
    positionNode,
    normalNode,
    colorNode,
    emissiveNode: reflectionNode.add(nightSkyReturn) as TslNode,
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
  material.attenuationColor = new THREE.Color(0.12, 0.28, 0.24);
  material.specularIntensity = 0.5;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.positionNode = nodes.positionNode;
  material.normalNode = nodes.normalNode;
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

export function setSharedRiverWaterReflectionState(state: RiverWaterReflectionState): void {
  const night = normalizeRiverWaterNightAmount(state.nightAmount);
  const weatherBlend = THREE.MathUtils.clamp(
    Number.isFinite(state.weatherBlend) ? state.weatherBlend ?? 0 : 0,
    0,
    1,
  );
  const palette = computeRiverWaterSkyPalette(
    state.solarElevationDeg,
    night,
    state.weatherTint,
    weatherBlend,
  );
  riverSkyZenith.value.copy(palette.zenith);
  riverSkyHorizon.value.copy(palette.horizon);
  riverCloudColor.value.copy(palette.cloud);
  riverCelestialColor.value.set(state.celestialColor);
  riverCelestialDirection.value.copy(state.celestialDirection).normalize();
  riverCelestialIntensity.value = THREE.MathUtils.clamp(
    Number.isFinite(state.celestialIntensity) ? state.celestialIntensity : 0,
    0,
    1.35,
  );
  riverCloudReflectionStrength.value = THREE.MathUtils.clamp(
    0.3 + weatherBlend * 0.42,
    0.3,
    0.72,
  );
  riverNightAmount.value = night;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
}
