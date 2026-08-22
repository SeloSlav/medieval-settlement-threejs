import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  normalize,
  normalWorldGeometry,
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
import {
  RIVER_WATER_PROFILE,
  type WaterSurfaceProfile,
} from './WaterSurfaceProfile.ts';
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

type WaterNormalBand = Readonly<{
  directionX: number;
  directionZ: number;
  frequency: number;
  speed: number;
  slope: number;
  phase: number;
  warp: number;
  aaStart: number;
  aaEnd: number;
}>;

type SurfaceResponse = Readonly<{
  slopeX: TslNode;
  slopeZ: TslNode;
  facet: TslNode;
  aaCoverage: TslNode;
}>;

export type RiverWaterDebugMode =
  | 'final'
  | 'normal'
  | 'fresnel'
  | 'surface-response'
  | 'flow-presence';

/**
 * Perceptual controls for the bounded, normal-only water tier.
 *
 * The lower frequencies survive the strategic camera while the finest band is
 * derivative filtered before it becomes smaller than a pixel. Flow bands are
 * authored in the local current frame; open-water bands stay in world space so
 * ponds form calm interference cells and coastal water retains travelling chop.
 */
export const RIVER_WATER_SURFACE_STYLE = {
  qualityTier: 'bounded-analytic-normal-only',
  refractionStrength: 0.055,
  flowBands: [
    { directionX: 0.91, directionZ: 0.41, frequency: 0.38, speed: 0.86, slope: 0.022, phase: 0.4, warp: 0.72, aaStart: 0.34, aaEnd: 1.05 },
    { directionX: -0.38, directionZ: 0.93, frequency: 0.67, speed: -1.14, slope: 0.019, phase: 2.2, warp: -0.46, aaStart: 0.3, aaEnd: 0.92 },
    { directionX: 0.76, directionZ: -0.65, frequency: 1.18, speed: 1.58, slope: 0.013, phase: 4.5, warp: 0.28, aaStart: 0.24, aaEnd: 0.76 },
  ] satisfies readonly WaterNormalBand[],
  openWaterBands: [
    { directionX: 0.86, directionZ: 0.51, frequency: 0.31, speed: 0.58, slope: 0.024, phase: 0.7, warp: 0.68, aaStart: 0.4, aaEnd: 1.2 },
    { directionX: -0.47, directionZ: 0.88, frequency: 0.54, speed: 0.82, slope: 0.022, phase: 2.8, warp: -0.52, aaStart: 0.34, aaEnd: 1.02 },
    { directionX: 0.68, directionZ: -0.73, frequency: 0.96, speed: 1.16, slope: 0.016, phase: 4.9, warp: 0.31, aaStart: 0.27, aaEnd: 0.82 },
    { directionX: -0.79, directionZ: -0.61, frequency: 1.72, speed: 1.72, slope: 0.009, phase: 1.6, warp: -0.18, aaStart: 0.2, aaEnd: 0.62 },
  ] satisfies readonly WaterNormalBand[],
} as const;

const riverNightAmount = uniform(0) as ScalarUniform;
const WATER_FOAM_COLOR = vec3(0.43, 0.61, 0.56) as TslNode;
const MENISCUS_COLOR = vec3(0.46, 0.64, 0.59) as TslNode;
const SHALLOW_WATER_TINT = vec3(0.07, 0.29, 0.32) as TslNode;
const DEEP_WATER_TINT = vec3(0.025, 0.095, 0.115) as TslNode;
const DEEP_WATER_LIGHT_TINT = vec3(0.045, 0.16, 0.19) as TslNode;
const COASTAL_SHALLOW_WATER_TINT = vec3(0.045, 0.245, 0.34) as TslNode;
const COASTAL_DEEP_WATER_TINT = vec3(0.018, 0.078, 0.155) as TslNode;
const COASTAL_DEEP_WATER_LIGHT_TINT = vec3(0.035, 0.145, 0.235) as TslNode;
const SHORE_FOAM_MAX = 0.16;
export const RIVER_WATER_TRANSMISSION = RIVER_WATER_PROFILE.transmission;
export const RIVER_WATER_ATTENUATION_DISTANCE = RIVER_WATER_PROFILE.attenuationDistance;
export const RIVER_DEEP_BACKDROP_STABILITY = 1;
export const RIVER_VISUAL_SHORE_EXPONENT = 3.8;
export const RIVER_OPTICAL_SHORE_EXPONENT = 2;
export const RIVER_BANK_BED_REVEAL = 0.72;
export const RIVER_FLOW_ROUGHNESS_FLOOR = 0.315;
export const RIVER_FLOW_HIGHLIGHT_STRENGTH = 0.072;
export const RIVER_OPEN_WATER_HIGHLIGHT_STRENGTH = 0.052;
export const RIVER_SKY_RETURN_STRENGTH = 0.16;

function decodeFlowDirection(
  shoreSample: TslNode,
): { flowDirX: TslNode; flowDirZ: TslNode; flowPresence: TslNode } {
  const flowRaw = (vec2(shoreSample.b, shoreSample.a) as TslNode)
    .mul(float(2) as TslNode)
    .sub(float(1) as TslNode) as TslNode;
  const flowLenSq = dot(flowRaw, flowRaw) as TslNode;
  // Neutral flow is stored in an 8-bit texture as [128, 128], which decodes to
  // a tiny positive vector rather than exact zero. Keep that quantization floor
  // firmly inside the still-water band instead of extrapolating the mix weight.
  const flowPresence = smoothstep(
    float(0.0008) as TslNode,
    float(0.02) as TslNode,
    flowLenSq,
  ) as TslNode;
  // Normalize with a finite floor rather than blending two unit directions.
  // Besides making exact-zero samples safe, this avoids a cancellation seam
  // when a northward current is half-way between the still and flowing masks.
  const inverseFlowLength = pow(
    max(flowLenSq, float(1e-8) as TslNode) as TslNode,
    float(-0.5) as TslNode,
  ) as TslNode;
  const flowDir = flowRaw.mul(inverseFlowLength) as TslNode;
  return { flowDirX: flowDir.x, flowDirZ: flowDir.y, flowPresence };
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

function bandAaWeight(phase: TslNode, band: WaterNormalBand): TslNode {
  return sub(
    float(1) as TslNode,
    smoothstep(
      float(band.aaStart) as TslNode,
      float(band.aaEnd) as TslNode,
      fwidth(phase) as TslNode,
    ) as TslNode,
  ) as TslNode;
}

function buildFlowSurfaceResponse(
  flowAlong: TslNode,
  flowCross: TslNode,
  flowDirX: TslNode,
  flowDirZ: TslNode,
  frameTime: TslNode,
): SurfaceResponse {
  const warp = (sin(
    flowAlong.mul(0.043).add(flowCross.mul(0.071)).sub(frameTime.mul(0.12)) as TslNode,
  ) as TslNode).mul(0.72).add(
    (sin(
      flowAlong.mul(-0.061).add(flowCross.mul(0.029)).add(frameTime.mul(0.09)) as TslNode,
    ) as TslNode).mul(0.38),
  ) as TslNode;

  let slopeX = float(0) as TslNode;
  let slopeZ = float(0) as TslNode;
  let aaCoverage = float(0) as TslNode;
  const signals: TslNode[] = [];

  for (const band of RIVER_WATER_SURFACE_STYLE.flowBands) {
    const directionX = flowDirX
      .mul(band.directionX)
      .add(flowDirZ.mul(band.directionZ)) as TslNode;
    const directionZ = flowDirZ
      .mul(band.directionX)
      .sub(flowDirX.mul(band.directionZ)) as TslNode;
    const phase = flowAlong
      .mul(band.directionX * band.frequency)
      .add(flowCross.mul(band.directionZ * band.frequency))
      .sub(frameTime.mul(band.speed))
      .add(warp.mul(band.warp))
      .add(band.phase) as TslNode;
    const aaWeight = bandAaWeight(phase, band);
    const wave = (sin(phase) as TslNode).mul(aaWeight) as TslNode;
    const derivative = (sin(phase.add(Math.PI * 0.5) as TslNode) as TslNode)
      .mul(band.slope)
      .mul(aaWeight) as TslNode;
    slopeX = slopeX.add(derivative.mul(directionX)) as TslNode;
    slopeZ = slopeZ.add(derivative.mul(directionZ)) as TslNode;
    aaCoverage = aaCoverage.add(aaWeight) as TslNode;
    signals.push(wave);
  }

  const crossing = pow(
    abs(signals[0].mul(signals[1]) as TslNode) as TslNode,
    float(1.7) as TslNode,
  ) as TslNode;
  const facet = crossing.mul(
    mix(
      float(0.58) as TslNode,
      float(1) as TslNode,
      abs(signals[2]) as TslNode,
    ) as TslNode,
  ) as TslNode;
  return {
    slopeX,
    slopeZ,
    facet,
    aaCoverage: aaCoverage.div(RIVER_WATER_SURFACE_STYLE.flowBands.length) as TslNode,
  };
}

function buildOpenWaterSurfaceResponse(
  wx: TslNode,
  wz: TslNode,
  frameTime: TslNode,
  standingWaveRatio: number,
): SurfaceResponse {
  const warp = (sin(
    wx.mul(0.031).sub(wz.mul(0.027)).add(frameTime.mul(0.055)) as TslNode,
  ) as TslNode).mul(0.76).add(
    (sin(
      wx.mul(-0.019).add(wz.mul(0.044)).sub(frameTime.mul(0.041)) as TslNode,
    ) as TslNode).mul(0.43),
  ) as TslNode;

  let slopeX = float(0) as TslNode;
  let slopeZ = float(0) as TslNode;
  let aaCoverage = float(0) as TslNode;
  const signals: TslNode[] = [];
  const standingRatio = float(standingWaveRatio) as TslNode;

  for (const band of RIVER_WATER_SURFACE_STYLE.openWaterBands) {
    const spatialPhase = wx
      .mul(band.directionX * band.frequency)
      .add(wz.mul(band.directionZ * band.frequency))
      .add(warp.mul(band.warp))
      .add(band.phase) as TslNode;
    const forwardPhase = spatialPhase.sub(frameTime.mul(band.speed)) as TslNode;
    const reversePhase = spatialPhase.add(frameTime.mul(band.speed)) as TslNode;
    const aaWeight = bandAaWeight(spatialPhase, band);
    const forwardWave = sin(forwardPhase) as TslNode;
    const standingWave = forwardWave
      .add(sin(reversePhase) as TslNode)
      .mul(0.5) as TslNode;
    const wave = (mix(forwardWave, standingWave, standingRatio) as TslNode)
      .mul(aaWeight) as TslNode;
    const forwardDerivative = sin(forwardPhase.add(Math.PI * 0.5) as TslNode) as TslNode;
    const standingDerivative = forwardDerivative
      .add(sin(reversePhase.add(Math.PI * 0.5) as TslNode) as TslNode)
      .mul(0.5) as TslNode;
    const derivative = (mix(forwardDerivative, standingDerivative, standingRatio) as TslNode)
      .mul(band.slope)
      .mul(aaWeight) as TslNode;
    slopeX = slopeX.add(derivative.mul(band.directionX)) as TslNode;
    slopeZ = slopeZ.add(derivative.mul(band.directionZ)) as TslNode;
    aaCoverage = aaCoverage.add(aaWeight) as TslNode;
    signals.push(wave);
  }

  const primaryCrossing = pow(
    abs(signals[0].mul(signals[1]) as TslNode) as TslNode,
    float(1.55) as TslNode,
  ) as TslNode;
  const detailCrossing = pow(
    abs(signals[2].mul(signals[3]) as TslNode) as TslNode,
    float(1.35) as TslNode,
  ) as TslNode;
  return {
    slopeX,
    slopeZ,
    facet: primaryCrossing.mul(0.76).add(detailCrossing.mul(0.24)) as TslNode,
    aaCoverage: aaCoverage.div(RIVER_WATER_SURFACE_STYLE.openWaterBands.length) as TslNode,
  };
}

function buildRiverWaterShaderNodes(
  shoreMaps: RiverWaterShoreMaps,
  profile: WaterSurfaceProfile,
) {
  const simDeltaAttr = attribute('simDelta', 'float') as TslNode;
  const position = positionLocal as TslNode;
  const worldPos = positionWorld as TslNode;
  const frameTime = worldAnimationTime as unknown as TslNode;

  const shoreSample = texture(shoreMaps.shoreTexture, buildWorldShoreUv(shoreMaps)) as TslNode;
  const featherSample = shoreSample.r;
  const foamBaseAttr = shoreSample.g;
  const { flowDirX, flowDirZ, flowPresence } = decodeFlowDirection(shoreSample);

  const wx = worldPos.x;
  const wz = worldPos.z;
  const { flowAlong, flowCross } = buildFlowCoordinates(wx, wz, flowDirX, flowDirZ);
  const shoreMask = pow(foamBaseAttr, float(1.05) as TslNode) as TslNode;
  // Compress the signed-distance ramp to an edge-only visual margin so the
  // channel settles quickly into one continuous body.
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
  const openWaterPresence = sub(float(1) as TslNode, flowPresence) as TslNode;
  const openWaterStrength = openWaterPresence
    .mul(float(profile.openWaterWaveScale) as TslNode) as TslNode;

  const flowResponse = buildFlowSurfaceResponse(
    flowAlong,
    flowCross,
    flowDirX,
    flowDirZ,
    frameTime,
  );
  const openWaterResponse = buildOpenWaterSurfaceResponse(
    wx,
    wz,
    frameTime,
    profile.standingWaveRatio,
  );
  const slopeX = flowResponse.slopeX
    .mul(flowPresence)
    .add(openWaterResponse.slopeX.mul(openWaterStrength)) as TslNode;
  const slopeZ = flowResponse.slopeZ
    .mul(flowPresence)
    .add(openWaterResponse.slopeZ.mul(openWaterStrength)) as TslNode;
  const flowFacet = flowResponse.facet.mul(flowPresence) as TslNode;
  const openWaterFacet = openWaterResponse.facet.mul(openWaterStrength) as TslNode;
  const surfaceFacet = min(
    float(1) as TslNode,
    flowFacet.add(openWaterFacet) as TslNode,
  ) as TslNode;
  const aaCoverage = mix(
    openWaterResponse.aaCoverage,
    flowResponse.aaCoverage,
    flowPresence,
  ) as TslNode;

  // This is deliberately a normal-only wave tier. The bounded CPU simulation
  // owns geometry motion; analytic facets own orientation, Fresnel and
  // refraction without drawing map-scale crests into a flat pond.
  const positionNode = vec3(
    position.x,
    position.y.add(simDeltaAttr),
    position.z,
  ) as TslNode;
  const baseNormalWorld = normalWorldGeometry as TslNode;
  // Reconstruct the heightfield gradient from the continuous mesh normal and
  // add the analytic ripple slope to it. This preserves bank/intersection
  // orientation instead of replacing every water vertex with a world-up plane.
  const rippleNormalWorld = normalize(vec3(
    baseNormalWorld.x.sub(slopeX.mul(baseNormalWorld.y)) as TslNode,
    baseNormalWorld.y,
    baseNormalWorld.z.sub(slopeZ.mul(baseNormalWorld.y)) as TslNode,
  ) as TslNode) as TslNode;
  const rippleNormalView = normalize(
    (cameraViewMatrix as TslNode)
      .mul(vec4(rippleNormalWorld, float(0) as TslNode) as TslNode)
      .xyz,
  ) as TslNode;
  const flatNormalView = normalize(
    (cameraViewMatrix as TslNode)
      .mul(
        vec4(
          float(0) as TslNode,
          float(1) as TslNode,
          float(0) as TslNode,
          float(0) as TslNode,
        ) as TslNode,
      )
      .xyz,
  ) as TslNode;

  // Shore foam is confined to the meniscus and uses crossed world-space
  // phases, so it never becomes another set of map-wide current ribbons.
  const foamWarp = (sin(
    wx.mul(0.037).sub(wz.mul(0.029)).add(frameTime.mul(0.11)) as TslNode,
  ) as TslNode).mul(0.58) as TslNode;
  const foamNoise = (sin(
    wx.mul(0.17).add(wz.mul(0.23)).add(foamWarp).add(frameTime.mul(0.44)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const foamWave = (sin(
    wx.mul(-0.31).add(wz.mul(0.19)).sub(foamWarp.mul(0.7)).sub(frameTime.mul(0.31)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const foamPulse = (sin(
    wx.mul(0.07).sub(wz.mul(0.41)).add(foamWarp.mul(0.34)).add(frameTime.mul(0.25)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const shoreBreakScale = 0.72 + profile.shoreBreakStrength * 0.78;
  const foamStrength = min(
    float(SHORE_FOAM_MAX * (0.82 + profile.shoreBreakStrength * 0.93)) as TslNode,
    (pow(shallowFactor, float(1.05) as TslNode) as TslNode).mul(
      (float(0.02) as TslNode)
        .add(foamNoise.mul(0.07))
        .add(foamWave.mul(0.055))
        .add(foamPulse.mul(0.035))
        .mul(shoreBreakScale) as TslNode,
    ) as TslNode,
  ) as TslNode;

  const viewDir = normalize((cameraPosition as TslNode).sub(worldPos) as TslNode) as TslNode;
  const viewDotUp = abs(dot(viewDir, vec3(0, 1, 0) as TslNode) as TslNode) as TslNode;
  const normalIncidence = min(
    float(1) as TslNode,
    abs(dot(viewDir, rippleNormalWorld) as TslNode) as TslNode,
  ) as TslNode;
  const fresnel = pow(
    sub(float(1) as TslNode, normalIncidence) as TslNode,
    float(5) as TslNode,
  ) as TslNode;
  const nightSkyReturn = (vec3(0.02, 0.043, 0.055) as TslNode)
    .mul(riverNightAmount)
    .mul(mix(float(0.62) as TslNode, float(1) as TslNode, depthFactor) as TslNode)
    .mul(mix(float(0.7) as TslNode, float(1) as TslNode, viewDotUp) as TslNode) as TslNode;
  const meniscus = (pow(shallowFactor, float(1.55) as TslNode) as TslNode)
    .mul(float(0.06) as TslNode) as TslNode;

  const bedWarp = (sin(
    wx.mul(0.027).sub(wz.mul(0.031)).add(1.4) as TslNode,
  ) as TslNode).mul(0.85) as TslNode;
  const bedNoiseA = (sin(
    wx.mul(0.083).add(wz.mul(0.067)).add(bedWarp) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const bedNoiseB = (sin(
    wx.mul(-0.061).add(wz.mul(0.097)).sub(bedWarp.mul(0.62)).add(2.7) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const bedNoiseC = (sin(
    wx.mul(0.129).sub(wz.mul(0.043)).add(bedWarp.mul(0.31)).add(4.1) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const bedTint = bedNoiseA
    .mul(bedNoiseB)
    .mul(0.72)
    .add(
      bedNoiseC
        .mul(sub(float(1) as TslNode, bedNoiseA) as TslNode)
        .mul(0.28),
    ) as TslNode;
  const seaTint = float(profile.seaTintStrength) as TslNode;
  const profileDeepTint = mix(DEEP_WATER_TINT, COASTAL_DEEP_WATER_TINT, seaTint) as TslNode;
  const profileDeepLightTint = mix(
    DEEP_WATER_LIGHT_TINT,
    COASTAL_DEEP_WATER_LIGHT_TINT,
    seaTint,
  ) as TslNode;
  const profileShallowTint = mix(
    SHALLOW_WATER_TINT,
    COASTAL_SHALLOW_WATER_TINT,
    seaTint,
  ) as TslNode;
  const layeredDeepTint = mix(profileDeepTint, profileDeepLightTint, bedTint) as TslNode;
  const waterTint = mix(layeredDeepTint, profileShallowTint, bankBedReveal) as TslNode;
  const highlightStrength = mix(
    float(RIVER_OPEN_WATER_HIGHLIGHT_STRENGTH) as TslNode,
    float(RIVER_FLOW_HIGHLIGHT_STRENGTH) as TslNode,
    flowPresence,
  ) as TslNode;
  const surfaceShimmer = depthFactor.mul(surfaceFacet).mul(highlightStrength) as TslNode;
  const surfaceHighlight = mix(
    vec3(0.34, 0.56, 0.54) as TslNode,
    vec3(0.24, 0.49, 0.64) as TslNode,
    seaTint,
  ) as TslNode;
  const tintedBody = mix(waterTint, surfaceHighlight, surfaceShimmer) as TslNode;
  const bodyColor = mix(tintedBody, WATER_FOAM_COLOR, foamStrength) as TslNode;
  const meniscusBody = mix(bodyColor, MENISCUS_COLOR, meniscus) as TslNode;
  const skyReturn = (float(0.055) as TslNode).add(
    fresnel.mul(float(RIVER_SKY_RETURN_STRENGTH - 0.055) as TslNode) as TslNode,
  ) as TslNode;
  const surfaceReturn = min(
    float(0.2) as TslNode,
    skyReturn.add(surfaceFacet.mul(float(0.025) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const colorNode = mix(
    meniscusBody,
    vec3(0.31, 0.38, 0.41) as TslNode,
    surfaceReturn,
  ) as TslNode;

  const bedColor = mix(
    vec3(0.19, 0.14, 0.09) as TslNode,
    vec3(0.34, 0.26, 0.17) as TslNode,
    bedTint,
  ) as TslNode;
  const stableBackdropColor = mix(
    profileDeepTint,
    bedColor,
    bankBedReveal.mul(float(RIVER_DEEP_BACKDROP_STABILITY) as TslNode) as TslNode,
  ) as TslNode;
  const normalDeltaView = rippleNormalView.sub(flatNormalView) as TslNode;
  const refractOffset = normalDeltaView.xy
    .mul(float(RIVER_WATER_SURFACE_STYLE.refractionStrength) as TslNode)
    .mul(depthFactor) as TslNode;
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
    float(0.5) as TslNode,
    float(0.86) as TslNode,
    opticalShallowFactor.mul(pow(viewDotUp, float(0.65) as TslNode) as TslNode) as TslNode,
  ) as TslNode;

  const thicknessNode = mix(float(0.05) as TslNode, float(0.78) as TslNode, opticalDepthFactor) as TslNode;
  const riverSpecularIntensity = mix(
    float(0.24) as TslNode,
    float(0.5) as TslNode,
    (pow(opticalShallowFactor, float(1.35) as TslNode) as TslNode)
      .add(opticalDepthFactor.mul(float(0.28) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const specularIntensityNode = mix(
    float(profile.specularIntensity) as TslNode,
    riverSpecularIntensity,
    flowPresence,
  ) as TslNode;
  const riverRoughnessNode = mix(
    float(0.345) as TslNode,
    float(RIVER_FLOW_ROUGHNESS_FLOOR) as TslNode,
    min(float(1) as TslNode, flowFacet.mul(0.7) as TslNode) as TslNode,
  ) as TslNode;
  const openWaterRoughnessNode = mix(
    float(Math.min(1, profile.roughness + 0.035)) as TslNode,
    float(profile.roughness) as TslNode,
    min(float(1) as TslNode, openWaterFacet.mul(0.62) as TslNode) as TslNode,
  ) as TslNode;
  const roughnessNode = mix(
    openWaterRoughnessNode,
    riverRoughnessNode,
    flowPresence,
  ) as TslNode;

  const animatedFeather = pow(featherSample, float(0.92) as TslNode) as TslNode;
  const volumeOpacity = mix(float(0.46) as TslNode, float(0.68) as TslNode, opticalDepthFactor) as TslNode;
  const surfaceFilm = opticalShallowFactor
    .mul(float(0.15) as TslNode)
    .add(opticalDepthFactor.mul(float(0.09) as TslNode) as TslNode) as TslNode;
  const opacityNode = animatedFeather.mul(
    min(float(0.82) as TslNode, volumeOpacity.add(surfaceFilm) as TslNode) as TslNode,
  ) as TslNode;

  const colorNodes: Record<RiverWaterDebugMode, TslNode> = {
    final: colorNode,
    normal: rippleNormalWorld.mul(0.5).add(0.5) as TslNode,
    fresnel: vec3(fresnel, fresnel, fresnel) as TslNode,
    'surface-response': vec3(flowFacet, openWaterFacet, aaCoverage) as TslNode,
    'flow-presence': vec3(flowPresence, openWaterPresence, shallowFactor) as TslNode,
  };

  return {
    positionNode,
    normalNode: rippleNormalView,
    colorNodes,
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
let sharedWaterProfile: WaterSurfaceProfile | null = null;
let sharedWaterColorNodes: Record<RiverWaterDebugMode, TslNode> | null = null;
let activeDebugMode: RiverWaterDebugMode = 'final';

export function getSharedRiverWaterMaterial(
  shoreMaps: RiverWaterShoreMaps,
  profile: WaterSurfaceProfile = RIVER_WATER_PROFILE,
): MeshPhysicalNodeMaterial {
  if (
    sharedWaterMaterial
    && sharedShoreMaps === shoreMaps
    && sharedWaterProfile === profile
  ) return sharedWaterMaterial;

  disposeSharedRiverWaterMaterial();

  const nodes = buildRiverWaterShaderNodes(shoreMaps, profile);
  const material = new MeshPhysicalNodeMaterial();
  material.name = profile.id === 'coastal'
    ? 'CoastalWaterMaterial'
    : profile.id === 'inland'
      ? 'InlandWaterMaterial'
      : 'RiverWaterMaterial';
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.roughness = profile.roughness;
  material.metalness = 0;
  material.ior = 1.33;
  material.transmission = profile.transmission;
  material.thickness = profile.id === 'coastal' ? 1.05 : 0.65;
  material.attenuationDistance = profile.attenuationDistance;
  material.attenuationColor = new THREE.Color(...profile.attenuationColor);
  material.specularIntensity = profile.specularIntensity;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.positionNode = nodes.positionNode;
  material.normalNode = nodes.normalNode;
  material.colorNode = nodes.colorNodes[activeDebugMode];
  (material as MeshPhysicalNodeMaterial & { emissiveNode: unknown }).emissiveNode = nodes.emissiveNode;
  material.opacityNode = nodes.opacityNode;
  material.backdropNode = nodes.backdropNode;
  material.backdropAlphaNode = nodes.backdropAlphaNode;
  material.thicknessNode = nodes.thicknessNode;
  material.specularIntensityNode = nodes.specularIntensityNode;
  material.roughnessNode = nodes.roughnessNode;
  material.userData.waterQualityTier = RIVER_WATER_SURFACE_STYLE.qualityTier;
  material.userData.waterSurfaceProfile = profile.id;
  material.userData.waterDebugModes = [
    'final',
    'normal',
    'fresnel',
    'surface-response',
    'flow-presence',
  ] satisfies RiverWaterDebugMode[];
  sharedWaterMaterial = material;
  sharedShoreMaps = shoreMaps;
  sharedWaterProfile = profile;
  sharedWaterColorNodes = nodes.colorNodes;
  return sharedWaterMaterial;
}

export function normalizeRiverWaterNightAmount(amount: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
}

export function setSharedRiverWaterNightAmount(amount: number): void {
  riverNightAmount.value = normalizeRiverWaterNightAmount(amount);
}

/** Switches the actual bounded-water output used by visual inspection tools. */
export function setSharedRiverWaterDebugMode(mode: RiverWaterDebugMode): void {
  activeDebugMode = mode;
  if (!sharedWaterMaterial || !sharedWaterColorNodes) return;
  sharedWaterMaterial.colorNode = sharedWaterColorNodes[mode];
  sharedWaterMaterial.needsUpdate = true;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
  sharedWaterProfile = null;
  sharedWaterColorNodes = null;
}
