import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { vec4, uniform } from 'three/tsl';
import * as TSL from 'three/tsl';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';
import { RIVER_WATER_PROFILE, type WaterSurfaceProfile } from './WaterSurfaceProfile.ts';
import { buildWaterOptics, waterLight, WATER_OPTICAL_MODES, type WaterOpticalMode } from './WaterOptics.ts';
import { acquireWaterSpectrum } from './WaterSpectrumRuntime.ts';
import { retainWaterSurfaceNoise } from './WaterSurfaceNoise.ts';
import type { WebGPURenderer } from 'three/webgpu';

export type RiverWaterDebugMode = WaterOpticalMode;
export const RIVER_WATER_SURFACE_STYLE = { qualityTier: 'hydraulic-flow-screen-optics', refractionStrength: 0.023 } as const;

let sharedWaterMaterial: MeshPhysicalNodeMaterial | null = null;
const materialInputs = new WeakMap<THREE.Material,{maps:RiverWaterShoreMaps;profile:WaterSurfaceProfile}>();
/** Read-only authoring/QA access; weak ownership never extends resource lifetime. */
export function getWaterMaterialInputs(material:THREE.Material) { return materialInputs.get(material); }
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
  const releaseNoise = retainWaterSurfaceNoise();
  const spectrum = acquireWaterSpectrum(profile.id);
  const nodes = buildWaterOptics(maps,profile,spectrum?.binding);
  const material = new MeshPhysicalNodeMaterial();
  materialInputs.set(material,{maps,profile});
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
  material.polygonOffset = true;
  material.polygonOffsetFactor = material.polygonOffsetUnits = -1;
  material.positionNode = nodes.position;
  material.normalNode = nodes.normal;
  const fragments = Object.fromEntries(WATER_OPTICAL_MODES.map(mode=>[mode,vec4(nodes.colors[mode],nodes.alpha)]));
  material.fragmentNode = fragments[activeDebugMode];
  // A custom fragment bypasses NodeMaterial's MRT branch. Preserve the real
  // scene pass's attachment contract without evaluating a second water BRDF.
  // Water already composites the opaque bed; its indirect channel is zero so
  // the post AO pass cannot darken that radiance a second time.
  const nodeMaterial = material as any;
  const setupOutput = nodeMaterial.setupOutput.bind(material);
  nodeMaterial.setupOutput = (builder:any,fragment:any) => {
    const color = setupOutput(builder,fragment);
    const sceneMrt = builder.renderer.getMRT();
    if (!builder.renderer.getRenderTarget() || !sceneMrt) return color;
    const outputs:Record<string,any> = {output:color};
    if (sceneMrt.has('normal')) outputs.normal = vec4(nodes.normal,1);
    if (sceneMrt.has('indirect')) outputs.indirect = vec4(0);
    return sceneMrt.merge((TSL as unknown as Record<string,any>).mrt(outputs));
  };
  material.userData.waterQualityTier = RIVER_WATER_SURFACE_STYLE.qualityTier;
  material.userData.waterSurfaceProfile = profile.id;
  material.userData.waterDebugModes = WATER_OPTICAL_MODES;
  material.userData.channelRockCount = maps.channelRockCount ?? 0;
  material.userData.waterColorNodes = nodes.colors;
  material.userData.waterAlpha = nodes.alpha;
  material.userData.waterFragmentNodes = fragments;
  material.onBeforeRender = (_renderer,scene) => {
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
  // WebGPURenderer calls Object3D hooks, but not Material.onBeforeRender.
  // A retained node update makes the optical state part of the real node graph.
  const updateNode = (uniform(0) as any).onObjectUpdate((frame:{renderer:WebGPURenderer;scene:THREE.Scene}) => {
    spectrum?.markVisible(frame.renderer);
    material.onBeforeRender(frame.renderer as never,frame.scene,null as never,null as never,null as never,null as never);
    return 0;
  });
  material.positionNode = nodes.position.add(updateNode);
  material.addEventListener('dispose',()=>{spectrum?.dispose();releaseNoise();});
  return material;
}

export function normalizeRiverWaterNightAmount(amount: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0,0,1);
}
export function setSharedRiverWaterNightAmount(amount: number): void {
  waterLight.night.value = normalizeRiverWaterNightAmount(amount);
}
export function setSharedWaterRainAmount(amount:number):void {
  waterLight.rain.value = normalizeRiverWaterNightAmount(amount);
}
export function setSharedRiverWaterDebugMode(mode: RiverWaterDebugMode): void {
  activeDebugMode = mode;
  if (!sharedWaterMaterial) return;
  sharedWaterMaterial.fragmentNode = sharedWaterMaterial.userData.waterFragmentNodes[mode];
  sharedWaterMaterial.needsUpdate = true;
}
export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
  sharedShoreMaps = null;
  sharedWaterProfile = null;
}
