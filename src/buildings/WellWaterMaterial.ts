import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cameraViewMatrix,
  dot,
  float,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  screenUV,
  sin,
  sub,
  vec2,
  vec3,
  vec4,
  viewportSafeUV,
  viewportSharedTexture,
} from 'three/tsl';
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';

type TslNode = {
  add(value: TslNode | number): TslNode;
  sub(value: TslNode | number): TslNode;
  mul(value: TslNode | number): TslNode;
  div(value: TslNode | number): TslNode;
  pow(value: TslNode | number): TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  xy: TslNode;
  xyz: TslNode;
  rgb: TslNode;
};

export type WellWaterDebugMode = 'final' | 'normal' | 'fresnel' | 'refraction';

type WellWaterShaderNodes = {
  readonly final: TslNode;
  readonly normal: TslNode;
  readonly fresnel: TslNode;
  readonly refraction: TslNode;
  readonly viewNormal: TslNode;
  readonly backdrop: TslNode;
  readonly backdropAlpha: TslNode;
  readonly opacity: TslNode;
  readonly roughness: TslNode;
};

/**
 * Perceptual controls for the well's deliberately calm, bounded water tier.
 * The world-space bands keep every well deterministic and synchronized with
 * the pause-aware river clock without paying for a per-building simulation.
 */
export const WELL_WATER_STYLE = {
  normalBands: [
    { directionX: 0.88, directionZ: 0.48, frequency: 4.1, speed: 0.72, slope: 0.052 },
    { directionX: -0.44, directionZ: 0.90, frequency: 6.4, speed: -0.51, slope: 0.032 },
    { directionX: 0.63, directionZ: -0.78, frequency: 10.2, speed: 0.93, slope: 0.014 },
  ],
  refractionStrength: 0.012,
  transmission: 0.64,
  opacity: 0.78,
  roughnessFloor: 0.285,
} as const;

let sharedWellWaterMaterial: MeshPhysicalNodeMaterial | null = null;
let sharedWellWaterNodes: WellWaterShaderNodes | null = null;
let activeDebugMode: WellWaterDebugMode = 'final';

function buildWellWaterShaderNodes(): WellWaterShaderNodes {
  const world = positionWorld as TslNode;
  const time = worldAnimationTime as unknown as TslNode;
  const [primary, cross, detail] = WELL_WATER_STYLE.normalBands;

  const primaryPhase = world.x
    .mul(primary.directionX * primary.frequency)
    .add(world.z.mul(primary.directionZ * primary.frequency))
    .sub(time.mul(primary.speed)) as TslNode;
  const crossPhase = world.x
    .mul(cross.directionX * cross.frequency)
    .add(world.z.mul(cross.directionZ * cross.frequency))
    .sub(time.mul(cross.speed)) as TslNode;
  const detailPhase = world.x
    .mul(detail.directionX * detail.frequency)
    .add(world.z.mul(detail.directionZ * detail.frequency))
    .sub(time.mul(detail.speed)) as TslNode;

  const primaryDerivative = (sin(primaryPhase.add(Math.PI * 0.5)) as TslNode).mul(primary.slope) as TslNode;
  const crossDerivative = (sin(crossPhase.add(Math.PI * 0.5)) as TslNode).mul(cross.slope) as TslNode;
  const detailDerivative = (sin(detailPhase.add(Math.PI * 0.5)) as TslNode).mul(detail.slope) as TslNode;
  const slopeX = primaryDerivative
    .mul(primary.directionX)
    .add(crossDerivative.mul(cross.directionX))
    .add(detailDerivative.mul(detail.directionX)) as TslNode;
  const slopeZ = primaryDerivative
    .mul(primary.directionZ)
    .add(crossDerivative.mul(cross.directionZ))
    .add(detailDerivative.mul(detail.directionZ)) as TslNode;
  const worldNormal = normalize(vec3(slopeX.mul(-1), float(1), slopeZ.mul(-1)) as TslNode) as TslNode;
  const viewNormal = normalize(
    (cameraViewMatrix as TslNode).mul(vec4(worldNormal, float(0)) as TslNode).xyz,
  ) as TslNode;

  const viewDirection = normalize((cameraPosition as TslNode).sub(world) as TslNode) as TslNode;
  const normalIncidence = min(float(1) as TslNode, abs(dot(viewDirection, worldNormal) as TslNode) as TslNode) as TslNode;
  const fresnel = pow(sub(float(1) as TslNode, normalIncidence) as TslNode, float(5) as TslNode) as TslNode;

  const slowBody = (sin(primaryPhase.mul(0.62).add(crossPhase.mul(0.18)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const glintCarrier = (sin(crossPhase.mul(0.54).sub(detailPhase.mul(0.23)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const glint = pow(glintCarrier, float(7) as TslNode) as TslNode;
  const deepTint = vec3(0.025, 0.095, 0.115) as TslNode;
  const liftedTint = vec3(0.055, 0.20, 0.22) as TslNode;
  const flowHighlight = vec3(0.34, 0.56, 0.54) as TslNode;
  const body = mix(deepTint, liftedTint, slowBody.mul(0.22).add(0.08) as TslNode) as TslNode;
  const highlightedBody = mix(body, flowHighlight, glint.mul(0.13) as TslNode) as TslNode;
  const skyReturn = (float(0.055) as TslNode).add(fresnel.mul(0.18)) as TslNode;
  const final = mix(highlightedBody, vec3(0.31, 0.38, 0.41) as TslNode, skyReturn) as TslNode;

  const surfaceDrift = vec2(
    (sin(primaryPhase.mul(0.37)) as TslNode).mul(0.0025),
    (sin(crossPhase.mul(0.29).add(Math.PI * 0.5)) as TslNode).mul(0.0025),
  ) as TslNode;
  const refractOffset = viewNormal.xy
    .mul(WELL_WATER_STYLE.refractionStrength)
    .add(surfaceDrift) as TslNode;
  const refractUv = viewportSafeUV((screenUV as TslNode).add(refractOffset) as TslNode) as TslNode;
  const sceneBehind = (viewportSharedTexture(refractUv) as TslNode).rgb as TslNode;
  // A deep stable share prevents the screen-space sample from turning the
  // narrow well opening into a bright terrain-colored portal.
  const backdrop = mix(sceneBehind, deepTint, float(0.76) as TslNode) as TslNode;

  return {
    final,
    normal: worldNormal.mul(0.5).add(0.5) as TslNode,
    fresnel: vec3(fresnel, fresnel, fresnel) as TslNode,
    refraction: sceneBehind,
    viewNormal,
    backdrop,
    backdropAlpha: float(0.78) as TslNode,
    opacity: float(WELL_WATER_STYLE.opacity) as TslNode,
    roughness: mix(
      float(0.34) as TslNode,
      float(WELL_WATER_STYLE.roughnessFloor) as TslNode,
      glint.mul(0.55) as TslNode,
    ) as TslNode,
  };
}

export function getSharedWellWaterMaterial(): MeshPhysicalNodeMaterial {
  if (sharedWellWaterMaterial) return sharedWellWaterMaterial;

  const nodes = buildWellWaterShaderNodes();
  const material = new MeshPhysicalNodeMaterial();
  material.name = 'Shared bounded well water';
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.roughness = 0.31;
  material.metalness = 0;
  material.ior = 1.33;
  material.transmission = WELL_WATER_STYLE.transmission;
  material.thickness = 0.48;
  material.attenuationDistance = 1.35;
  material.attenuationColor = new THREE.Color(0.10, 0.25, 0.24);
  material.specularIntensity = 0.48;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.colorNode = nodes[activeDebugMode];
  material.normalNode = nodes.viewNormal;
  material.opacityNode = nodes.opacity;
  material.backdropNode = nodes.backdrop;
  material.backdropAlphaNode = nodes.backdropAlpha;
  material.roughnessNode = nodes.roughness;
  material.userData.sharedBuildingMaterial = true;
  material.userData.waterQualityTier = 'bounded-normal-only';
  material.userData.waterVisualFamily = 'river-derived';
  material.userData.waterDebugModes = ['final', 'normal', 'fresnel', 'refraction'];
  sharedWellWaterNodes = nodes;
  sharedWellWaterMaterial = material;
  return material;
}

/** Switches the actual water output used by visual inspection tools. */
export function setSharedWellWaterDebugMode(mode: WellWaterDebugMode): void {
  activeDebugMode = mode;
  if (!sharedWellWaterMaterial || !sharedWellWaterNodes) return;
  sharedWellWaterMaterial.colorNode = sharedWellWaterNodes[mode];
  sharedWellWaterMaterial.needsUpdate = true;
}

export function disposeSharedWellWaterMaterial(): void {
  sharedWellWaterMaterial?.dispose();
  sharedWellWaterMaterial = null;
  sharedWellWaterNodes = null;
  activeDebugMode = 'final';
}
