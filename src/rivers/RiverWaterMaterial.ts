import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';
import { RIVER_WATER_PROFILE, type WaterSurfaceProfile } from './WaterSurfaceProfile.ts';
import { buildWaterOptics, waterLight, WATER_OPTICAL_MODES, type WaterOpticalMode } from './WaterOptics.ts';
import { acquireWaterSpectrum } from './WaterSpectrumRuntime.ts';
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';
import type { WebGPURenderer } from 'three/webgpu';

export type RiverWaterDebugMode = WaterOpticalMode;
export const RIVER_WATER_SURFACE_STYLE = { qualityTier: 'hydraulic-flow-screen-optics', refractionStrength: 0.023 } as const;
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

let sharedWaterMaterial: MeshPhysicalNodeMaterial | null = null;
let sharedShoreMaps: RiverWaterShoreMaps | null = null;
let sharedWaterProfile: WaterSurfaceProfile | null = null;
let activeDebugMode: RiverWaterDebugMode = 'final';
const lights = new WeakMap<THREE.Scene, THREE.DirectionalLight | null>();
const sunTarget = new THREE.Vector3();
const skyRatio = new THREE.Color(0.48,0.72,1.05);

export function getSharedRiverWaterMaterial(maps: RiverWaterShoreMaps, profile = RIVER_WATER_PROFILE): MeshPhysicalNodeMaterial {
  if (sharedWaterMaterial && sharedShoreMaps === maps && sharedWaterProfile === profile) return sharedWaterMaterial;
  disposeSharedRiverWaterMaterial();
  sharedWaterMaterial = createRiverWaterMaterial(maps, profile);
  sharedShoreMaps = maps;
  sharedWaterProfile = profile;
  return sharedWaterMaterial;
}

export function createRiverWaterMaterial(maps: RiverWaterShoreMaps, profile = RIVER_WATER_PROFILE): MeshPhysicalNodeMaterial {
  const spectrum = acquireWaterSpectrum(profile.id);
  const nodes = buildWaterOptics(maps,profile,spectrum?.binding);
  const material = new MeshPhysicalNodeMaterial();
  material.name = profile.id === 'coastal' ? 'CoastalWaterMaterial' : profile.id === 'inland' ? 'InlandWaterMaterial' : 'RiverWaterMaterial';
  // Explicit optical composite owns Fresnel/absorption. Disabling built-in
  // transmission removes duplicate scene rendering and physical BRDF work.
  material.transmission = 0;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.ior = 1.333;
  material.roughness = profile.roughness;
  material.attenuationDistance = profile.attenuationDistance;
  material.attenuationColor.setRGB(...profile.attenuationColor);
  material.polygonOffset = true;
  material.polygonOffsetFactor = material.polygonOffsetUnits = -1;
  material.positionNode = nodes.position;
  material.normalNode = nodes.normal;
  material.fragmentNode = vec4(nodes.colors[activeDebugMode], nodes.alpha);
  material.userData.waterQualityTier = RIVER_WATER_SURFACE_STYLE.qualityTier;
  material.userData.waterSurfaceProfile = profile.id;
  material.userData.waterDebugModes = WATER_OPTICAL_MODES;
  material.userData.channelRockCount = maps.channelRockCount ?? 0;
  material.userData.waterColorNodes = nodes.colors;
  material.userData.waterAlpha = nodes.alpha;
  material.onBeforeRender = (_renderer,scene) => {
    spectrum?.update(_renderer as unknown as WebGPURenderer,worldAnimationTime.value);
    if (!lights.has(scene)) {
      let key: THREE.DirectionalLight | null = null;
      scene.traverse(object => {
        if (object instanceof THREE.DirectionalLight && (!key || object.intensity > key.intensity)) key = object;
      });
      lights.set(scene,key);
    }
    const sun = lights.get(scene);
    if (sun) {
      sun.getWorldPosition(waterLight.direction.value);
      sun.target.getWorldPosition(sunTarget);
      waterLight.direction.value.sub(sunTarget).normalize();
      waterLight.sun.value.copy(sun.color);
      waterLight.intensity.value = sun.intensity;
    }
    if (scene.fog) waterLight.horizon.value.copy(scene.fog.color);
    else if (scene.background instanceof THREE.Color) waterLight.horizon.value.copy(scene.background);
    waterLight.zenith.value.copy(waterLight.horizon.value).multiply(skyRatio);
  };
  if(spectrum)material.addEventListener('dispose',()=>spectrum.dispose());
  return material;
}

export function normalizeRiverWaterNightAmount(amount: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0,0,1);
}
export function setSharedRiverWaterNightAmount(amount: number): void {
  waterLight.night.value = normalizeRiverWaterNightAmount(amount);
}
export function setSharedRiverWaterDebugMode(mode: RiverWaterDebugMode): void {
  activeDebugMode = mode;
  if (!sharedWaterMaterial) return;
  sharedWaterMaterial.fragmentNode = vec4(sharedWaterMaterial.userData.waterColorNodes[mode], sharedWaterMaterial.userData.waterAlpha);
  sharedWaterMaterial.needsUpdate = true;
}
export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
  sharedWaterProfile = null;
}
