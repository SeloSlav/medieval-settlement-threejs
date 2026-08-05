import * as THREE from 'three';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import { windSiteScore } from './windField.ts';

export const WIND_OVERLAY_RESOLUTION = 192;
const OVERLAY_MESH_SEGMENTS = 96;
const OVERLAY_HEIGHT_OFFSET = 0.42;

export type WindRasterOptions = {
  seed: number;
  resolution: number;
  bounds: TerrainBounds;
};

export class WindOverlay {
  private readonly mesh: THREE.Mesh;
  private visible = false;

  constructor(options: { terrain: Terrain; parent: THREE.Object3D }) {
    const texture = createWindTexture(options.terrain.bounds);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(createDrapedGeometry(options.terrain), material);
    this.mesh.name = 'Wind exposure overlay';
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    options.parent.add(this.mesh);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.map?.dispose();
      material.dispose();
    }
    this.mesh.removeFromParent();
  }
}

export function rasterizeWindExposure(options: WindRasterOptions): Uint8Array {
  const resolution = Math.max(2, Math.floor(options.resolution));
  const data = new Uint8Array(resolution * resolution * 4);
  for (let row = 0; row < resolution; row++) {
    const z = options.bounds.minZ
      + row / (resolution - 1) * (options.bounds.maxZ - options.bounds.minZ);
    const dataRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column++) {
      const x = options.bounds.minX
        + column / (resolution - 1) * (options.bounds.maxX - options.bounds.minX);
      const score = windSiteScore(options.seed, x, z);
      const color = windExposureColor(score);
      const index = (dataRow * resolution + column) * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = color.a;
    }
  }
  return data;
}

export function windExposureColor(score: number): { r: number; g: number; b: number; a: number } {
  const sheltered = { r: 70, g: 66, b: 98 };
  const weak = { r: 70, g: 111, b: 146 };
  const good = { r: 80, g: 163, b: 165 };
  const strong = { r: 215, g: 224, b: 177 };
  const clamped = Math.max(0, Math.min(1, score));
  const rgb = clamped < 0.4
    ? lerpColor(sheltered, weak, clamped / 0.4)
    : clamped < 0.7
      ? lerpColor(weak, good, (clamped - 0.4) / 0.3)
      : lerpColor(good, strong, (clamped - 0.7) / 0.3);
  return { ...rgb, a: Math.round(178 + clamped * 55) };
}

function createWindTexture(bounds: TerrainBounds): THREE.DataTexture {
  const data = rasterizeWindExposure({
    seed: getActiveWorldGeneration().seed,
    resolution: WIND_OVERLAY_RESOLUTION,
    bounds,
  });
  const texture = new THREE.DataTexture(
    data,
    WIND_OVERLAY_RESOLUTION,
    WIND_OVERLAY_RESOLUTION,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'Wind exposure';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function createDrapedGeometry(terrain: Terrain): THREE.BufferGeometry {
  const width = terrain.bounds.maxX - terrain.bounds.minX;
  const depth = terrain.bounds.maxZ - terrain.bounds.minZ;
  const centerX = (terrain.bounds.minX + terrain.bounds.maxX) * 0.5;
  const centerZ = (terrain.bounds.minZ + terrain.bounds.maxZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(width, depth, OVERLAY_MESH_SEGMENTS, OVERLAY_MESH_SEGMENTS);
  geometry.rotateX(-Math.PI * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index) + centerX;
    const z = position.getZ(index) + centerZ;
    position.setY(index, terrain.getHeightAt(x, z) + OVERLAY_HEIGHT_OFFSET);
  }
  position.needsUpdate = true;
  geometry.translate(centerX, 0, centerZ);
  geometry.computeBoundingSphere();
  return geometry;
}

function lerpColor(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}
