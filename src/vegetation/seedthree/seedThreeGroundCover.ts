import * as THREE from 'three';
import {
  addGroundCoverInstanceAttributes,
  createCardClumpGeometry,
  createGroundCoverMaterial,
  disposeGroundCoverTextures,
  groundCoverWindVector,
  loadGroundCoverTextures,
} from '@seedthree/core/ground-cover.js';
import { applyFoliageDoubleSideNormals } from '../../scene/foliageDoubleSideNormals.ts';
import {
  supportsNodeMaterials,
  type RendererBackendKind,
} from '../../scene/RendererBackend.ts';
import { createRootedFoliageWindPosition } from './seedThreeFoliageWind.ts';

export type SeedThreeGroundCoverTextureSources = {
  albedo: string | undefined;
  normal?: string | undefined;
  roughness?: string | undefined;
  translucency?: string | undefined;
};

export type SeedThreeGroundCoverTextures = {
  albedo: THREE.Texture;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  translucency: THREE.Texture | null;
};

export type SeedThreeCardGeometrySpec = {
  quads: number;
  width: number;
  tiltMin: number;
  tiltSpan: number;
  heightMin: number;
  heightSpan: number;
  baseSpread: number;
};

export type SeedThreeGroundCoverInstanceAttributes = {
  tint: THREE.InstancedBufferAttribute;
  anchor: THREE.InstancedBufferAttribute;
  wind: THREE.InstancedBufferAttribute;
};

export type SeedThreeGroundCoverPositionNode =
  ReturnType<typeof createRootedFoliageWindPosition>;

export function loadSeedThreeGroundCoverTextures(
  sources: SeedThreeGroundCoverTextureSources,
  maxAnisotropy: number,
): Promise<SeedThreeGroundCoverTextures> {
  return loadGroundCoverTextures(sources, maxAnisotropy);
}

/**
 * Use SeedThree's shared WebGPU material while retaining Medieval Roads'
 * established WebGL fallback and r185-specific wind node.
 */
export function createSeedThreeGroundCoverMaterial(
  name: string,
  textures: SeedThreeGroundCoverTextures,
  rendererBackend: RendererBackendKind,
  transmitRGB: [number, number, number],
  windAmount = 0.16,
  positionNode?: SeedThreeGroundCoverPositionNode,
): THREE.Material {
  if (!supportsNodeMaterials(rendererBackend)) {
    const material = new THREE.MeshStandardMaterial({
      name,
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    // Card normals need a deliberately shallow relief response: a full-strength
    // tangent-space map turns thin cereal tissue nearly black at field density.
    material.normalScale.set(0.16, 0.16);
    // WebGPU uses SeedThree's translucency/SSS path. Give the WebGL fallback a
    // restrained, albedo-shaped transmission fill so backlit leaves stay legible.
    material.emissive.set(0xffffff);
    material.emissiveIntensity = 0.42;
    material.emissiveMap = textures.albedo;
    applyFoliageDoubleSideNormals(material);
    return material;
  }

  return createGroundCoverMaterial({
    name,
    textures,
    transmit: transmitRGB,
    windAmount,
    positionNode: positionNode ?? createRootedFoliageWindPosition(windAmount),
  });
}

export function createSeedThreeCardClumpGeometry(
  spec: SeedThreeCardGeometrySpec,
): THREE.BufferGeometry {
  return createCardClumpGeometry(spec);
}

export function addSeedThreeGroundCoverInstanceAttributes(
  geometry: THREE.BufferGeometry,
  capacity: number,
): SeedThreeGroundCoverInstanceAttributes {
  return addGroundCoverInstanceAttributes(geometry, capacity);
}

export function seedThreeGroundCoverWindVector(
  yaw: number,
  scale: THREE.Vector3,
  out?: THREE.Vector3,
): THREE.Vector3 {
  return groundCoverWindVector(yaw, scale, out);
}

export function disposeSeedThreeGroundCoverTextures(
  textures: SeedThreeGroundCoverTextures,
): void {
  disposeGroundCoverTextures(textures);
}
