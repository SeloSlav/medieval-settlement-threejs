import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  supportsNodeMaterials,
  type RendererBackendKind,
} from '../scene/RendererBackend.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import { CULTIVATED_SOIL_TEXTURE_PATHS } from './cultivatedSoilAssets.ts';

export type FieldSoilIdentity =
  | 'ploughed'
  | 'seedbed'
  | 'fallow'
  | 'growing'
  | 'harvested';

export type FieldSoilDebugMode =
  | 'final'
  | 'albedo'
  | 'normal'
  | 'roughness'
  | 'edge-blend';

type FieldSoilTexturePaths = {
  albedo: string;
  normal: string;
  roughness: string;
  ao?: string;
  height: string;
};

type FieldSoilIdentitySpec = {
  label: string;
  paths: FieldSoilTexturePaths;
  metresPerTile: number;
  normalStrength: number;
  patina: string;
  source: 'FAL PATINA' | 'backyard-garden';
  warpPhase: number;
};

type FieldSoilTextureSet = {
  albedo: THREE.Texture | null;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  ao: THREE.Texture | null;
};

type TslNode = {
  r: TslNode;
  rgb: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  add(value: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

type FieldSoilNodeMaterial = MeshStandardNodeMaterial & THREE.MeshStandardMaterial;

const tsl = TSL as unknown as {
  attribute(name: string, type: string): TslNode;
  float(value: unknown): TslNode;
  normalMap(value: unknown, scale?: unknown): TslNode;
  positionWorld: TslNode;
  sin(value: unknown): TslNode;
  texture(texture: THREE.Texture, uvNode?: unknown): TslNode;
  vec2(x: unknown, y?: unknown): TslNode;
  vec3(x: unknown, y?: unknown, z?: unknown): TslNode;
  vec4(x: unknown, y?: unknown, z?: unknown, w?: unknown): TslNode;
  vertexColor(index?: number): TslNode;
};

const GENERATED_ROOT = '/assets/textures/terrain/field_soil_states_v1';
const generatedPaths = (state: Exclude<FieldSoilIdentity, 'growing'>): FieldSoilTexturePaths => ({
  albedo: `${GENERATED_ROOT}/${state}/albedo.png`,
  normal: `${GENERATED_ROOT}/${state}/normal.png`,
  roughness: `${GENERATED_ROOT}/${state}/roughness.png`,
  ao: `${GENERATED_ROOT}/${state}/ao.png`,
  height: `${GENERATED_ROOT}/${state}/height.png`,
});

export const FIELD_SOIL_IDENTITIES: Readonly<Record<FieldSoilIdentity, FieldSoilIdentitySpec>> = Object.freeze({
  ploughed: Object.freeze({
    label: 'Freshly turned plough soil',
    paths: Object.freeze(generatedPaths('ploughed')),
    metresPerTile: 2.8,
    normalStrength: 0.48,
    patina: 'fresh dark clods with restrained cavity moisture',
    source: 'FAL PATINA',
    warpPhase: 0.7,
  }),
  seedbed: Object.freeze({
    label: 'Fine harrowed seedbed',
    paths: Object.freeze(generatedPaths('seedbed')),
    metresPerTile: 2.4,
    normalStrength: 0.34,
    patina: 'settled fine crumbs and dry seedbed dust',
    source: 'FAL PATINA',
    warpPhase: 2.1,
  }),
  fallow: Object.freeze({
    label: 'Weathered fallow earth',
    paths: Object.freeze(generatedPaths('fallow')),
    metresPerTile: 3.2,
    normalStrength: 0.3,
    patina: 'greyed old clods, decomposed litter, and restrained biological age',
    source: 'FAL PATINA',
    warpPhase: 4.4,
  }),
  growing: Object.freeze({
    label: 'Established cultivated loam',
    paths: Object.freeze({
      ...CULTIVATED_SOIL_TEXTURE_PATHS,
      height: '/assets/textures/terrain/mammoth_terrain_dirt/height.png',
    }),
    metresPerTile: 2.2,
    normalStrength: 0.38,
    patina: 'dark established humus retained from the backyard garden beds',
    source: 'backyard-garden',
    warpPhase: 5.8,
  }),
  harvested: Object.freeze({
    label: 'Dry harvested earth',
    paths: Object.freeze(generatedPaths('harvested')),
    metresPerTile: 2.9,
    normalStrength: 0.28,
    patina: 'sun-dried compacted crumbs with pulverized chaff dust',
    source: 'FAL PATINA',
    warpPhase: 7.3,
  }),
});

const textureSets = new Map<FieldSoilIdentity, FieldSoilTextureSet>();

function loadTexture(path: string, colorSpace: THREE.ColorSpace): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

function texturesFor(identity: FieldSoilIdentity): FieldSoilTextureSet {
  const cached = textureSets.get(identity);
  if (cached) return cached;
  const paths = FIELD_SOIL_IDENTITIES[identity].paths;
  const textures = {
    albedo: loadTexture(paths.albedo, THREE.SRGBColorSpace),
    normal: loadTexture(paths.normal, THREE.NoColorSpace),
    roughness: loadTexture(paths.roughness, THREE.NoColorSpace),
    ao: paths.ao ? loadTexture(paths.ao, THREE.NoColorSpace) : null,
  };
  textureSets.set(identity, textures);
  return textures;
}

function organicUvNode(spec: FieldSoilIdentitySpec): TslNode {
  const world = tsl.positionWorld;
  const inverseScale = 1 / spec.metresPerTile;
  // Two broad, incommensurate fields gently bend the world-metric sampling
  // domain. Every PBR channel consumes this exact coordinate, so clods, cavity
  // AO, roughness and normals remain causally registered while repetition is
  // harder to recognize across a large field.
  const warpX = tsl.sin(
    world.x.mul(0.173).add(world.z.mul(0.119)).add(spec.warpPhase),
  ).mul(0.075).add(tsl.sin(
    world.x.mul(-0.061).add(world.z.mul(0.087)).add(spec.warpPhase * 1.7),
  ).mul(0.045));
  const warpY = tsl.sin(
    world.z.mul(0.151).sub(world.x.mul(0.107)).add(spec.warpPhase * 0.73),
  ).mul(0.072).add(tsl.sin(
    world.z.mul(-0.053).sub(world.x.mul(0.079)).add(spec.warpPhase * 2.13),
  ).mul(0.042));
  return tsl.vec2(
    world.x.mul(inverseScale).add(warpX),
    world.z.mul(inverseScale).add(warpY),
  );
}

function configureInspectionBreadcrumbs(
  material: THREE.Material,
  identity: FieldSoilIdentity,
  debugMode: FieldSoilDebugMode,
): void {
  const spec = FIELD_SOIL_IDENTITIES[identity];
  material.name = `${spec.label} (${debugMode})`;
  material.userData.fieldSoilIdentity = identity;
  material.userData.fieldSoilSource = spec.source;
  material.userData.fieldSoilPatina = spec.patina;
  material.userData.pbrTexturePaths = spec.paths;
  material.userData.metricUvMeters = spec.metresPerTile;
  material.userData.organicRepeat = {
    coordinateDomain: 'world-xz-metres',
    method: 'shared two-band continuous coordinate warp',
    phase: spec.warpPhase,
  };
  material.userData.debugMode = debugMode;
}

function createNodeMaterial(
  identity: FieldSoilIdentity,
  debugMode: FieldSoilDebugMode,
): THREE.Material {
  const spec = FIELD_SOIL_IDENTITIES[identity];
  const textures = texturesFor(identity);
  const material = new MeshStandardNodeMaterial() as FieldSoilNodeMaterial;
  const organicUv = organicUvNode(spec);
  const edgeBlend = tsl.attribute('fieldEdgeBlend', 'float');
  const albedoSample = textures.albedo
    ? tsl.texture(textures.albedo, organicUv)
    : tsl.vec4(0.42, 0.31, 0.22, 1);
  const normalSample = textures.normal
    ? tsl.texture(textures.normal, organicUv)
    : tsl.vec4(0.5, 0.5, 1, 1);
  const roughnessSample = textures.roughness
    ? tsl.texture(textures.roughness, organicUv)
    : tsl.vec4(0.96);
  const vertexTint = tsl.vertexColor().rgb;

  if (debugMode === 'edge-blend') {
    material.colorNode = tsl.vec4(tsl.vec3(edgeBlend), tsl.float(1)) as never;
  } else if (debugMode === 'normal') {
    material.colorNode = tsl.vec4(normalSample.rgb, tsl.float(1)) as never;
  } else if (debugMode === 'roughness') {
    material.colorNode = tsl.vec4(tsl.vec3(roughnessSample.r), tsl.float(1)) as never;
  } else if (debugMode === 'albedo') {
    material.colorNode = tsl.vec4(albedoSample.rgb.mul(vertexTint), tsl.float(1)) as never;
  } else {
    material.colorNode = tsl.vec4(albedoSample.rgb.mul(vertexTint), edgeBlend) as never;
  }

  if (debugMode === 'final' && textures.normal) {
    material.normalNode = tsl.normalMap(
      normalSample,
      tsl.vec2(spec.normalStrength, spec.normalStrength),
    ) as never;
  }
  material.roughnessNode = debugMode === 'final' ? roughnessSample.r as never : tsl.float(1) as never;
  if (debugMode === 'final' && textures.ao) {
    material.aoNode = tsl.texture(textures.ao, organicUv).r as never;
  }
  material.opacityNode = debugMode === 'final' ? edgeBlend as never : tsl.float(1) as never;
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  material.aoMap = textures.ao;
  material.vertexColors = debugMode === 'final' || debugMode === 'albedo';
  material.roughness = 1;
  material.metalness = 0;
  material.transparent = debugMode === 'final';
  material.depthWrite = debugMode !== 'final';
  material.alphaTest = 0;
  configureInspectionBreadcrumbs(material, identity, debugMode);
  return material;
}

function fieldOrganicWarpGlsl(phase: number): string {
  return `
vec2 fieldOrganicWarp(vec2 worldXZ) {
  float warpX = sin(worldXZ.x * 0.173 + worldXZ.y * 0.119 + ${phase.toFixed(4)}) * 0.075
    + sin(worldXZ.x * -0.061 + worldXZ.y * 0.087 + ${(phase * 1.7).toFixed(4)}) * 0.045;
  float warpY = sin(worldXZ.y * 0.151 - worldXZ.x * 0.107 + ${(phase * 0.73).toFixed(4)}) * 0.072
    + sin(worldXZ.y * -0.053 - worldXZ.x * 0.079 + ${(phase * 2.13).toFixed(4)}) * 0.042;
  return vec2(warpX, warpY);
}
`;
}

function createWebGlMaterial(
  identity: FieldSoilIdentity,
  debugMode: FieldSoilDebugMode,
): THREE.Material {
  const spec = FIELD_SOIL_IDENTITIES[identity];
  const textures = texturesFor(identity);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.albedo,
    normalMap: debugMode === 'final' ? textures.normal : null,
    normalScale: new THREE.Vector2(spec.normalStrength, spec.normalStrength),
    roughnessMap: debugMode === 'final' ? textures.roughness : null,
    aoMap: debugMode === 'final' ? textures.ao : null,
    aoMapIntensity: 0.72,
    vertexColors: debugMode === 'final' || debugMode === 'albedo',
    roughness: 1,
    metalness: 0,
    transparent: debugMode === 'final',
    depthWrite: debugMode !== 'final',
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  chainMaterialShaderPatch(
    material,
    `field-soil-v1-${identity}-${debugMode}`,
    (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
attribute float fieldEdgeBlend;
varying float vFieldEdgeBlend;
${fieldOrganicWarpGlsl(spec.warpPhase)}`,
      ).replace(
        'void main() {',
        'void main() {\n  vFieldEdgeBlend = fieldEdgeBlend;',
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  vec2 fieldWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
  vec2 fieldSurfaceUv = fieldWorldXZ * ${(1 / spec.metresPerTile).toFixed(8)}
    + fieldOrganicWarp(fieldWorldXZ);
#ifdef USE_MAP
  vMapUv = fieldSurfaceUv;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = fieldSurfaceUv;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = fieldSurfaceUv;
#endif
#ifdef USE_AOMAP
  vAoMapUv = fieldSurfaceUv;
#endif`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying float vFieldEdgeBlend;',
      ).replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.a *= vFieldEdgeBlend;',
      );
      if (debugMode === 'edge-blend') {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'gl_FragColor = vec4(vec3(vFieldEdgeBlend), 1.0);',
        );
      } else if (debugMode === 'normal') {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);',
        );
      } else if (debugMode === 'roughness') {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'gl_FragColor = vec4(vec3(roughnessFactor), 1.0);',
        );
      }
    },
  );
  configureInspectionBreadcrumbs(material, identity, debugMode);
  return material;
}

export function createFieldSoilMaterial(
  identity: FieldSoilIdentity,
  rendererBackend: RendererBackendKind,
  debugMode: FieldSoilDebugMode = 'final',
): THREE.Material {
  return supportsNodeMaterials(rendererBackend)
    ? createNodeMaterial(identity, debugMode)
    : createWebGlMaterial(identity, debugMode);
}
