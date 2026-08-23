import * as THREE from 'three';
import type { RiverField } from '../rivers/RiverField.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { forEachRiverFieldSample, mapRiverFieldRowForPlaneGeometry } from '../map/rasterizeRiverFieldBounds.ts';
import { sampleAuthoritativeWellGroundwaterScore } from './sampleAuthoritativeHydrology.ts';

const OVERLAY_RESOLUTION = 512;
const OVERLAY_MESH_SEGMENTS = 96;
const OVERLAY_HEIGHT_OFFSET = 0.4;

export type HydrologyOverlayOptions = {
  terrain: Terrain;
  riverField: RiverField;
  parent: THREE.Object3D;
};

export class HydrologyOverlay {
  private readonly terrain: Terrain;
  private readonly mesh: THREE.Mesh;
  private visible = false;

  constructor(options: HydrologyOverlayOptions) {
    this.terrain = options.terrain;
    const { riverField } = options;
    const texture = createHydrologyTexture(riverField);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });

    // Match the full river-field extent and drape the layer over relief so
    // groundwater remains readable in both meadow and mountain presets.
    const geometry = new THREE.PlaneGeometry(
      riverField.spanX,
      riverField.spanZ,
      OVERLAY_MESH_SEGMENTS,
      OVERLAY_MESH_SEGMENTS,
    );
    geometry.rotateX(-Math.PI * 0.5);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const centerX = riverField.startX + riverField.spanX * 0.5;
    const centerZ = riverField.startZ + riverField.spanZ * 0.5;
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index) + centerX;
      const z = position.getZ(index) + centerZ;
      position.setY(index, this.terrain.getHeightAt(x, z) + OVERLAY_HEIGHT_OFFSET);
    }
    position.needsUpdate = true;
    geometry.translate(centerX, 0, centerZ);
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Hydrology overlay';
    this.mesh.renderOrder = 4;
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

  getTerrainHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z) + OVERLAY_HEIGHT_OFFSET;
  }
}

function createHydrologyTexture(riverField: RiverField): THREE.DataTexture {
  const resolution = OVERLAY_RESOLUTION;
  const data = new Uint8Array(resolution * resolution * 4);

  forEachRiverFieldSample(riverField, resolution, ({ x, z, row, column }) => {
    const dataRow = mapRiverFieldRowForPlaneGeometry(row, resolution);
    const index = (dataRow * resolution + column) * 4;
    // RiverField is consulted only as a surface-water exclusion mask. The
    // overlay must never tint rivers, the sea, ponds, or lakes: those features
    // are unrelated to the underground network used by wells.
    const surfaceWater = riverField.isRenderedWetAt(x, z);
    const groundwater = surfaceWater ? 0 : sampleAuthoritativeWellGroundwaterScore(x, z);
    const alpha = groundwaterOverlayAlpha(surfaceWater, groundwater);
    if (alpha === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      return;
    }

    const color = hydrologyColor(groundwater);
    data[index] = color.r;
    data[index + 1] = color.g;
    data[index + 2] = color.b;
    data[index + 3] = alpha;
  });

  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
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

export function groundwaterOverlayAlpha(surfaceWater: boolean, groundwaterScore: number): number {
  if (surfaceWater) return 0;
  const score = Math.max(0, Math.min(1, groundwaterScore));
  return Math.round(180 + score * 55);
}

function hydrologyColor(score: number): { r: number; g: number; b: number } {
  const dry = { r: 24, g: 34, b: 58 };
  const fair = { r: 38, g: 92, b: 148 };
  const rich = { r: 28, g: 132, b: 198 };
  const prime = { r: 72, g: 178, b: 228 };

  if (score < 0.33) return lerpColor(dry, fair, score / 0.33);
  if (score < 0.66) return lerpColor(fair, rich, (score - 0.33) / 0.33);
  return lerpColor(rich, prime, (score - 0.66) / 0.34);
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
