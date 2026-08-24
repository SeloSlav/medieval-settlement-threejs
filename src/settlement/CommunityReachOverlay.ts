import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type {
  BuildingState,
  ResidenceState,
  SettlementState,
} from '../resources/types.ts';
import {
  COMMUNITY_REACH_RESOLUTION,
  communityReachSettlementAt,
  rasterizeCommunityReach,
  type CommunityReachRaster,
} from './CommunityReachRaster.ts';

export * from './CommunityReachRaster.ts';

const OVERLAY_MESH_SEGMENTS = 96;
const OVERLAY_HEIGHT_OFFSET = 0.42;

export type CommunityReachOverlayOptions = {
  terrain: Terrain;
  parent: THREE.Object3D;
};

/** Lazy terrain-draped renderer for the pure community reach raster. */
export class CommunityReachOverlay {
  private readonly terrain: Terrain;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private texture: THREE.DataTexture | null = null;
  private raster: CommunityReachRaster | null = null;
  private visible = false;

  constructor(options: CommunityReachOverlayOptions) {
    this.terrain = options.terrain;
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(createDrapedGeometry(options.terrain), this.material);
    this.mesh.name = 'Community reach overlay';
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    options.parent.add(this.mesh);
  }

  setState(
    settlements: Iterable<SettlementState>,
    buildings: Iterable<BuildingState>,
    residences: Iterable<ResidenceState>,
  ): void {
    this.raster = rasterizeCommunityReach({
      resolution: COMMUNITY_REACH_RESOLUTION,
      bounds: this.terrain.bounds,
      settlements,
      buildings,
      residences,
    });
    const texture = new THREE.DataTexture(
      this.raster.rgba,
      this.raster.resolution,
      this.raster.resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.name = 'Community reach';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    this.texture?.dispose();
    this.texture = texture;
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  settlementAt(x: number, z: number): string | null {
    return this.raster
      ? communityReachSettlementAt(this.raster, this.terrain.bounds, x, z)
      : null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

function createDrapedGeometry(terrain: Terrain): THREE.BufferGeometry {
  const width = terrain.bounds.maxX - terrain.bounds.minX;
  const depth = terrain.bounds.maxZ - terrain.bounds.minZ;
  const centerX = (terrain.bounds.minX + terrain.bounds.maxX) * 0.5;
  const centerZ = (terrain.bounds.minZ + terrain.bounds.maxZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(width, depth, OVERLAY_MESH_SEGMENTS, OVERLAY_MESH_SEGMENTS);
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index) + centerX;
    const z = positions.getZ(index) + centerZ;
    positions.setY(index, terrain.getHeightAt(x, z) + OVERLAY_HEIGHT_OFFSET);
  }
  positions.needsUpdate = true;
  geometry.translate(centerX, 0, centerZ);
  geometry.computeBoundingSphere();
  return geometry;
}
