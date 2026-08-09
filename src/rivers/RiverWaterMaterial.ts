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
import {
  RIVER_WATER_PROFILE,
  type WaterSurfaceProfile,
} from './WaterSurfaceProfile.ts';

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
export const RIVER_CLOUD_REFLECTION_CLEAR = 0.07;
export const RIVER_CLOUD_REFLECTION_MAX = 0.18;
const riverCloudReflectionStrength = uniform(RIVER_CLOUD_REFLECTION_CLEAR) as ScalarUniform;
const WATER_FOAM_COLOR = vec3(0.43, 0.61, 0.56) as TslNode;
const SEA_FOAM_COLOR = vec3(0.86, 0.93, 0.92) as TslNode;
const MENISCUS_COLOR = vec3(0.46, 0.64, 0.59) as TslNode;
const SHALLOW_WATER_TINT = vec3(0.145, 0.46, 0.44) as TslNode;
const DEEP_WATER_TINT = vec3(0.055, 0.165, 0.14) as TslNode;
const DEEP_WATER_LIGHT_TINT = vec3(0.085, 0.225, 0.195) as TslNode;
const SEA_SHALLOW_WATER_TINT = vec3(0.08, 0.39, 0.46) as TslNode;
const SEA_DEEP_WATER_TINT = vec3(0.018, 0.095, 0.18) as TslNode;
const SEA_CREST_SCATTER_TINT = vec3(0.16, 0.54, 0.5) as TslNode;
const SHORE_LAP_MAX = 0.11;
const SHORE_FOAM_MAX = 0.16;
const FLOW_WAVE_HEIGHT = 0.048;
export const RIVER_WATER_TRANSMISSION = RIVER_WATER_PROFILE.transmission;
export const RIVER_WATER_ATTENUATION_DISTANCE = RIVER_WATER_PROFILE.attenuationDistance;
export const RIVER_DEEP_BACKDROP_STABILITY = 1;
export const RIVER_VISUAL_SHORE_EXPONENT = 3.8;
export const RIVER_OPTICAL_SHORE_EXPONENT = 2;
export const RIVER_BANK_BED_REVEAL = 0.72;
export const RIVER_FLOW_ROUGHNESS_FLOOR = 0.315;
export const RIVER_FLOW_HIGHLIGHT_STRENGTH = 0.085;
export const RIVER_SKY_RETURN_STRENGTH = 0.46;
export const RIVER_REFLECTION_FRESNEL_FLOOR = 0.24;
export const RIVER_CLOSE_REFLECTION_DISTANCE = 115;
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

function decodeFlowDirection(
  shoreSample: TslNode,
): { flowDirX: TslNode; flowDirZ: TslNode; flowPresence: TslNode } {
  const flowRaw = (vec2(shoreSample.b, shoreSample.a) as TslNode).mul(float(2) as TslNode).sub(float(1) as TslNode) as TslNode;
  const flowLenSq = dot(flowRaw, flowRaw) as TslNode;
  const fallbackDir = vec2(float(0) as TslNode, float(-1) as TslNode) as TslNode;
  const flowPresence = smoothstep(
    float(0.0004) as TslNode,
    float(0.035) as TslNode,
    flowLenSq,
  ) as TslNode;
  const flowDir = mix(
    fallbackDir,
    normalize(flowRaw) as TslNode,
    flowPresence,
  ) as TslNode;
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

type SpectralWave = Readonly<{
  directionX: number;
  directionZ: number;
  wavelength: number;
  amplitude: number;
  phase: number;
  displacesMesh: boolean;
}>;

// An inexpensive, deterministic approximation of spectral cascade behaviour.
// The visual brief is informed by web-ocean-3d's multi-scale JONSWAP surface,
// but these waves and their TSL implementation are original to Selo Empire.
const OPEN_WATER_SPECTRUM: readonly SpectralWave[] = [
  { directionX: 0.985, directionZ: 0.174, wavelength: 52, amplitude: 0.16, phase: 0.3, displacesMesh: true },
  { directionX: 0.996, directionZ: -0.087, wavelength: 27, amplitude: 0.095, phase: 2.1, displacesMesh: true },
  { directionX: 0.94, directionZ: 0.342, wavelength: 13, amplitude: 0.047, phase: 4.4, displacesMesh: true },
  { directionX: 0.819, directionZ: -0.574, wavelength: 6, amplitude: 0.018, phase: 1.4, displacesMesh: false },
  { directionX: 0.643, directionZ: 0.766, wavelength: 2.6, amplitude: 0.007, phase: 5.2, displacesMesh: false },
] as const;

export const OPEN_WATER_SPECTRAL_BAND_COUNT = OPEN_WATER_SPECTRUM.length;

type SpectralWaveNodes = Readonly<{
  displacement: TslNode;
  slopeX: TslNode;
  slopeZ: TslNode;
  crestSignal: TslNode;
}>;

function buildOpenWaterSpectrum(
  wx: TslNode,
  wz: TslNode,
  frameTime: TslNode,
  standingWaveRatio: number,
): SpectralWaveNodes {
  let displacement = float(0) as TslNode;
  let slopeX = float(0) as TslNode;
  let slopeZ = float(0) as TslNode;
  let crest = float(0) as TslNode;
  let amplitudeSum = 0;

  for (const wave of OPEN_WATER_SPECTRUM) {
    const waveNumber = (Math.PI * 2) / wave.wavelength;
    const angularFrequency = Math.sqrt(9.81 * waveNumber);
    const spatialPhase = wx
      .mul(wave.directionX * waveNumber)
      .add(wz.mul(wave.directionZ * waveNumber))
      .add(float(wave.phase) as TslNode) as TslNode;
    const forwardPhase = spatialPhase.sub(frameTime.mul(angularFrequency)) as TslNode;
    const reversePhase = spatialPhase.add(frameTime.mul(angularFrequency)) as TslNode;
    const travellingHeight = sin(forwardPhase) as TslNode;
    const standingHeight = (sin(forwardPhase) as TslNode)
      .add(sin(reversePhase) as TslNode)
      .mul(0.5) as TslNode;
    const waveHeight = mix(
      travellingHeight,
      standingHeight,
      float(standingWaveRatio) as TslNode,
    ) as TslNode;
    const travellingDerivative = sin(forwardPhase.add(Math.PI * 0.5) as TslNode) as TslNode;
    const standingDerivative = travellingDerivative
      .add(sin(reversePhase.add(Math.PI * 0.5) as TslNode) as TslNode)
      .mul(0.5) as TslNode;
    const waveDerivative = mix(
      travellingDerivative,
      standingDerivative,
      float(standingWaveRatio) as TslNode,
    ) as TslNode;

    if (wave.displacesMesh) {
      displacement = displacement.add(waveHeight.mul(wave.amplitude)) as TslNode;
    }
    const slopeAmplitude = wave.amplitude * waveNumber;
    slopeX = slopeX.add(waveDerivative.mul(slopeAmplitude * wave.directionX)) as TslNode;
    slopeZ = slopeZ.add(waveDerivative.mul(slopeAmplitude * wave.directionZ)) as TslNode;
    crest = crest.add(waveHeight.mul(wave.amplitude)) as TslNode;
    amplitudeSum += wave.amplitude;
  }

  return {
    displacement,
    slopeX,
    slopeZ,
    crestSignal: crest.div(amplitudeSum).mul(0.5).add(0.5) as TslNode,
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
  const openWaterPresence = sub(float(1) as TslNode, flowPresence) as TslNode;
  const openWaterWaveStrength = openWaterPresence
    .mul(float(profile.openWaterWaveScale) as TslNode) as TslNode;
  const openWaterSpectrum = buildOpenWaterSpectrum(
    wx,
    wz,
    frameTime,
    profile.standingWaveRatio,
  );
  const waveSetPhase = (sin(
    frameTime.mul(0.21).sub(wx.mul(0.003)).add(wz.mul(0.006)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const waveSetEnvelope = mix(
    float(0.58) as TslNode,
    float(1) as TslNode,
    waveSetPhase,
  ) as TslNode;
  // Fade spectral displacement through the final shallow band; the existing
  // shoreline lap reaches the clipped edge without opening terrain cracks.
  const openWaterInterior = pow(depthFactor, float(0.38) as TslNode) as TslNode;
  const openWaterDisplacement = openWaterSpectrum.displacement
    .mul(openWaterWaveStrength)
    .mul(openWaterInterior)
    .mul(waveSetEnvelope) as TslNode;

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
  const ripple = (sin(rippleSeed) as TslNode)
    .mul(0.5)
    .sub(0.25)
    .mul(channelMask)
    .mul(flowPresence)
    .mul(0.038) as TslNode;

  // Keep the broad surface continuous in world space. Building the whole wave
  // field in each texel's flow frame made parallel bands rotate abruptly where
  // river directions met, which read as hard chevrons from the RTS camera.
  const surfaceWarp = (sin(
    wx.mul(0.023).sub(wz.mul(0.019)).add(frameTime.mul(0.12)) as TslNode,
  ) as TslNode).mul(0.72) as TslNode;
  const surfaceWavePhaseA = wx.mul(0.31)
    .add(wz.mul(0.19))
    .add(surfaceWarp)
    .sub(frameTime.mul(1.48)) as TslNode;
  const surfaceWavePhaseB = wx.mul(-0.21)
    .add(wz.mul(0.36))
    .sub(surfaceWarp.mul(0.58) as TslNode)
    .add(frameTime.mul(1.08))
    .add(float(1.7) as TslNode) as TslNode;
  const surfaceWaveA = sin(surfaceWavePhaseA) as TslNode;
  const surfaceWaveB = sin(surfaceWavePhaseB) as TslNode;
  const downstreamWave = sin(
    flowAlong.mul(0.17).sub(frameTime.mul(0.92)).add(surfaceWarp.mul(0.3) as TslNode) as TslNode,
  ) as TslNode;
  const flowDisplacement = surfaceWaveA
    .mul(0.49)
    .add(surfaceWaveB.mul(0.39) as TslNode)
    .add(downstreamWave.mul(0.12) as TslNode)
    .mul(depthFactor)
    .mul(flowPresence)
    .mul(float(FLOW_WAVE_HEIGHT * 0.82) as TslNode) as TslNode;

  const positionNode = vec3(
    position.x,
    position.y.add(
      simDeltaAttr
        .add(lap)
        .add(ripple)
        .add(flowDisplacement)
        .add(openWaterDisplacement),
    ),
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
  const riverFoamStrength = min(
    float(SHORE_FOAM_MAX) as TslNode,
    (pow(shallowFactor, float(1.05) as TslNode) as TslNode).mul(
      (float(0.025) as TslNode)
        .add(foamNoise.mul(0.11))
        .add(foamWave.mul(0.07))
        .add(foamPulse.mul(0.05)) as TslNode,
    ) as TslNode,
  ) as TslNode;

  // A warped, multi-directional drift field makes small broken glints without
  // drawing contour-parallel ribbons. Only the low-contrast pulse below follows
  // the river, so water still suggests a current without exposing flow-map joins.
  const driftWarpA = (sin(
    wx.mul(0.019).add(wz.mul(0.027)).sub(frameTime.mul(0.09)) as TslNode,
  ) as TslNode).mul(0.88) as TslNode;
  const driftWarpB = (sin(
    wx.mul(-0.026).add(wz.mul(0.016)).add(frameTime.mul(0.07)) as TslNode,
  ) as TslNode).mul(0.74) as TslNode;
  const driftA = (sin(
    wx.mul(0.115).add(wz.mul(0.071)).add(driftWarpA).sub(frameTime.mul(0.42)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const driftB = (sin(
    wx.mul(-0.083).add(wz.mul(0.139)).add(driftWarpB).add(frameTime.mul(0.33)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const driftC = (sin(
    wx.mul(0.221).sub(wz.mul(0.176)).sub(driftWarpA.mul(0.41) as TslNode).sub(frameTime.mul(0.71)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const driftMass = driftA.mul(0.46).add(driftB.mul(0.34)).add(driftC.mul(0.2)) as TslNode;
  const brokenDrift = smoothstep(
    float(0.49) as TslNode,
    float(0.78) as TslNode,
    driftMass,
  ) as TslNode;
  const downstreamPulse = (sin(
    flowAlong.mul(0.1).sub(frameTime.mul(0.48)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const flowStructure = brokenDrift.mul(
    mix(float(0.84) as TslNode, float(1) as TslNode, downstreamPulse) as TslNode,
  ) as TslNode;
  const flowShimmer = depthFactor
    .mul(flowStructure)
    .mul(flowPresence)
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
    surfaceWavePhaseA.add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(depthFactor)
    .mul(0.038) as TslNode;
  const crossSlope = (sin(
    surfaceWavePhaseB.add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(depthFactor)
    .mul(0.031) as TslNode;
  const microWarp = (sin(
    wx.mul(0.071).sub(wz.mul(0.054)).add(frameTime.mul(0.31)) as TslNode,
  ) as TslNode).mul(0.46) as TslNode;
  const microA = (sin(
    wx.mul(1.31).add(wz.mul(0.77)).add(microWarp).sub(frameTime.mul(2.62)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(closeDetail)
    .mul(0.014) as TslNode;
  const microB = (sin(
    wx.mul(-0.91).add(wz.mul(1.46)).sub(microWarp.mul(0.63) as TslNode).add(frameTime.mul(2.13)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode)
    .mul(closeDetail)
    .mul(0.012) as TslNode;
  const currentSlope = (sin(
    flowAlong.mul(0.19).sub(frameTime.mul(0.94)).add(Math.PI * 0.5) as TslNode,
  ) as TslNode).mul(depthFactor).mul(0.007) as TslNode;
  const riverRippleSlopeX = primarySlope.mul(0.853)
    .sub(crossSlope.mul(0.504) as TslNode)
    .add(microA.mul(0.862))
    .sub(microB.mul(0.529) as TslNode)
    .add(currentSlope.mul(flowDirX)) as TslNode;
  const riverRippleSlopeZ = primarySlope.mul(0.522)
    .add(crossSlope.mul(0.864))
    .add(microA.mul(0.507))
    .add(microB.mul(0.849))
    .add(currentSlope.mul(flowDirZ)) as TslNode;
  const openWaterNormalStrength = openWaterWaveStrength
    .mul(openWaterInterior)
    .mul(mix(float(0.74) as TslNode, float(1) as TslNode, waveSetPhase) as TslNode) as TslNode;
  const rippleSlopeX = riverRippleSlopeX
    .mul(flowPresence)
    .add(openWaterSpectrum.slopeX.mul(openWaterNormalStrength)) as TslNode;
  const rippleSlopeZ = riverRippleSlopeZ
    .mul(flowPresence)
    .add(openWaterSpectrum.slopeZ.mul(openWaterNormalStrength)) as TslNode;
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
  const openWaterCrest = smoothstep(
    float(0.71) as TslNode,
    float(0.93) as TslNode,
    openWaterSpectrum.crestSignal,
  ) as TslNode;
  const shoreBreakBand = min(
    float(1) as TslNode,
    shallowFactor.mul(depthFactor).mul(float(4.8) as TslNode) as TslNode,
  ) as TslNode;
  const shoreBreakSet = smoothstep(
    float(0.34) as TslNode,
    float(0.78) as TslNode,
    waveSetPhase,
  ) as TslNode;
  // Whitecaps need a different field from wave height. Without this breakup,
  // the largest spectral band draws map-wide parallel ribbons from the RTS
  // camera even though the underlying multi-directional slopes are sound.
  const crestBreakupWarp = (sin(
    wx.mul(0.018).add(wz.mul(0.023)).add(frameTime.mul(0.05)) as TslNode,
  ) as TslNode).mul(0.82) as TslNode;
  const crestBreakupA = (sin(
    wx.mul(0.083)
      .sub(wz.mul(0.071))
      .add(crestBreakupWarp)
      .sub(frameTime.mul(0.16)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const crestBreakupB = (sin(
    wx.mul(-0.057)
      .add(wz.mul(0.109))
      .sub(crestBreakupWarp.mul(0.64) as TslNode)
      .add(frameTime.mul(0.12)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const crestBreakupC = (sin(
    wx.mul(0.151)
      .add(wz.mul(0.041))
      .add(crestBreakupWarp.mul(0.37) as TslNode)
      .sub(frameTime.mul(0.21)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const crestBreakup = smoothstep(
    float(0.43) as TslNode,
    float(0.74) as TslNode,
    crestBreakupA.mul(0.46).add(crestBreakupB.mul(0.34)).add(crestBreakupC.mul(0.2)) as TslNode,
  ) as TslNode;
  const openWaterFoam = openWaterCrest
    .mul(crestBreakup)
    .mul(depthFactor)
    .mul(0.17)
    .add(
      shoreBreakBand
        .mul(shoreBreakSet)
        .mul(float(0.48 * profile.shoreBreakStrength) as TslNode) as TslNode,
    )
    .mul(openWaterWaveStrength) as TslNode;
  const foamStrength = min(
    float(0.68) as TslNode,
    riverFoamStrength
      .mul(mix(float(0.44) as TslNode, float(1) as TslNode, flowPresence) as TslNode)
      .add(openWaterFoam) as TslNode,
  ) as TslNode;
  const reflectedElevation = max(float(0) as TslNode, reflectionDir.y) as TslNode;
  const skyGradient = pow(reflectedElevation, float(0.42) as TslNode) as TslNode;
  const clearSkyReflection = mix(
    riverSkyHorizon,
    riverSkyZenith,
    skyGradient,
  ) as TslNode;
  // Broad warped lobes avoid the regular two-sine lattice that looked like a
  // white grid on overhead water. The cloud tint is deliberately a small
  // modulation of the continuous sky gradient, not a second opaque surface.
  const cloudWarp = (sin(
    reflectionDir.x.mul(1.6)
      .sub(reflectionDir.z.mul(2.1))
      .add(frameTime.mul(0.006)) as TslNode,
  ) as TslNode).mul(0.44) as TslNode;
  const cloudPhaseA = (sin(
    reflectionDir.x.mul(3.4)
      .add(reflectionDir.z.mul(2.2))
      .add(cloudWarp)
      .add(frameTime.mul(0.009)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const cloudPhaseB = (sin(
    reflectionDir.x.mul(-2.5)
      .add(reflectionDir.z.mul(4.1))
      .sub(cloudWarp.mul(0.72) as TslNode)
      .sub(frameTime.mul(0.007)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const cloudPhaseC = (sin(
    reflectionDir.x.mul(4.7)
      .sub(reflectionDir.z.mul(3.2))
      .add(cloudWarp.mul(0.37) as TslNode)
      .add(frameTime.mul(0.004)) as TslNode,
  ) as TslNode).mul(0.5).add(0.5) as TslNode;
  const cloudMass = smoothstep(
    float(0.48) as TslNode,
    float(0.82) as TslNode,
    cloudPhaseA.mul(0.45).add(cloudPhaseB.mul(0.35)).add(cloudPhaseC.mul(0.2)) as TslNode,
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
    vec3(surroundingsLuma.mul(0.58)) as TslNode,
    reflectedSurroundings.mul(0.7) as TslNode,
    float(0.68) as TslNode,
  ) as TslNode;
  const surroundingsReturn = closeDetail
    .mul(pow(sub(float(1) as TslNode, viewDotUp) as TslNode, float(1.65) as TslNode) as TslNode)
    .mul(depthFactor)
    .mul(mix(float(0.045) as TslNode, float(0.12) as TslNode, flowStructure) as TslNode) as TslNode;
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
  const riverWaterTint = mix(layeredDeepTint, SHALLOW_WATER_TINT, bankBedReveal) as TslNode;
  const seaWaterTint = mix(
    SEA_DEEP_WATER_TINT,
    SEA_SHALLOW_WATER_TINT,
    bankBedReveal,
  ) as TslNode;
  const seaTintWeight = openWaterPresence
    .mul(float(profile.seaTintStrength) as TslNode) as TslNode;
  const waterTint = mix(riverWaterTint, seaWaterTint, seaTintWeight) as TslNode;
  const flowHighlight = vec3(0.34, 0.56, 0.54) as TslNode;
  const flowTintedBody = mix(waterTint, flowHighlight, flowShimmer) as TslNode;
  const backlitCrest = max(
    float(0) as TslNode,
    (dot(viewDir, riverCelestialDirection) as TslNode).mul(-1),
  ) as TslNode;
  const crestScatter = openWaterCrest
    .mul(openWaterWaveStrength)
    .mul(pow(backlitCrest, float(1.6) as TslNode) as TslNode)
    .mul(riverCelestialIntensity)
    .mul(0.32) as TslNode;
  const tintedBody = mix(
    flowTintedBody,
    SEA_CREST_SCATTER_TINT,
    crestScatter,
  ) as TslNode;
  const foamColor = mix(WATER_FOAM_COLOR, SEA_FOAM_COLOR, seaTintWeight) as TslNode;
  const bodyColor = mix(tintedBody, foamColor, foamStrength) as TslNode;
  const meniscusBody = mix(bodyColor, MENISCUS_COLOR, meniscus) as TslNode;
  const reflectedColorWeight = reflectionEnergy.mul(
    mix(float(0.48) as TslNode, float(0.72) as TslNode, depthFactor) as TslNode,
  ).mul(mix(float(1) as TslNode, float(1.12) as TslNode, seaTintWeight) as TslNode) as TslNode;
  const colorNode = mix(meniscusBody, reflectedSurface, reflectedColorWeight) as TslNode;
  const bedColor = mix(
    vec3(0.19, 0.14, 0.09) as TslNode,
    vec3(0.34, 0.26, 0.17) as TslNode,
    bedTint,
  ) as TslNode;
  const stableDeepWaterTint = mix(
    DEEP_WATER_TINT,
    SEA_DEEP_WATER_TINT,
    seaTintWeight,
  ) as TslNode;
  const stableBackdropColor = mix(
    stableDeepWaterTint,
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

  const riverThicknessNode = mix(float(0.05) as TslNode, float(0.78) as TslNode, opticalDepthFactor) as TslNode;
  const thicknessNode = mix(
    riverThicknessNode,
    float(1.42) as TslNode,
    seaTintWeight.mul(opticalDepthFactor) as TslNode,
  ) as TslNode;
  const riverSpecularIntensity = mix(
    float(0.24) as TslNode,
    float(0.5) as TslNode,
    (pow(opticalShallowFactor, float(1.35) as TslNode) as TslNode)
      .add(opticalDepthFactor.mul(float(0.28) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const specularIntensityNode = mix(
    riverSpecularIntensity,
    float(profile.specularIntensity) as TslNode,
    seaTintWeight,
  ) as TslNode;
  const riverRoughnessNode = mix(
    float(0.34) as TslNode,
    float(RIVER_FLOW_ROUGHNESS_FLOOR) as TslNode,
    min(
      float(1) as TslNode,
      flowStructure.mul(depthFactor).mul(float(0.62) as TslNode) as TslNode,
    ) as TslNode,
  ) as TslNode;
  const roughnessNode = mix(
    riverRoughnessNode,
    float(profile.roughness) as TslNode,
    seaTintWeight,
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
    emissiveNode: celestialReturn.add(nightSkyReturn) as TslNode,
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

export function getSharedRiverWaterMaterial(
  shoreMaps: RiverWaterShoreMaps,
  profile: WaterSurfaceProfile = RIVER_WATER_PROFILE,
): MeshPhysicalNodeMaterial {
  if (
    sharedWaterMaterial
    && sharedShoreMaps === shoreMaps
    && sharedWaterProfile?.id === profile.id
  ) return sharedWaterMaterial;

  disposeSharedRiverWaterMaterial();

  const nodes = buildRiverWaterShaderNodes(shoreMaps, profile);
  const material = new MeshPhysicalNodeMaterial();
  material.name = profile.id === 'coastal'
    ? 'CoastalWaterMaterial'
    : 'RiverWaterMaterial';
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.roughness = profile.roughness;
  material.metalness = 0;
  material.ior = 1.33;
  material.transmission = profile.transmission;
  material.thickness = profile.id === 'coastal' ? 1.2 : 0.65;
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
  sharedWaterProfile = profile;
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
    RIVER_CLOUD_REFLECTION_CLEAR + weatherBlend * 0.11,
    RIVER_CLOUD_REFLECTION_CLEAR,
    RIVER_CLOUD_REFLECTION_MAX,
  );
  riverNightAmount.value = night;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
  sharedWaterProfile = null;
}
