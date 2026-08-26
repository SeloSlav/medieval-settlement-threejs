import * as THREE from 'three';
import {
  applyPainterlyVegetationMaterial,
  isPainterlyMaterialRegistered,
  refreshPainterlyMaterial,
} from '../vegetation/painterly/painterlyVegetationMaterial.ts';
import {
  isPainterlyVegetationEnabled,
  subscribePainterlyVegetationPreference,
} from './painterlyVegetationPreference.ts';

const DEFAULT_SCAN_INTERVAL_FRAMES = 30;

type SurfaceMaterial = THREE.Material & {
  alphaMap?: THREE.Texture | null;
  depthWrite?: boolean;
  isMeshPhysicalMaterial?: boolean;
  isMeshPhysicalNodeMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  isMeshStandardNodeMaterial?: boolean;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  opacity?: number;
  roughnessMap?: THREE.Texture | null;
  transmission?: number;
};

export type PainterlySceneCoverageDiagnostics = {
  enabled: boolean;
  scans: number;
  visitedObjects: number;
  candidateMaterials: number;
  newlyRegisteredMaterials: number;
  refreshedMaterials: number;
  alreadyRegisteredMaterials: number;
  skippedUnsupportedMaterials: number;
  skippedInvisibleMaterials: number;
  skippedBlendedMaterials: number;
  skippedSpecializedMaterials: number;
};

/**
 * Discovers visible solid materials that enter the live world after startup.
 * This keeps the experimental checkbox scene-wide without coupling every
 * building, prop, resource, animal, and late-loaded GLB to the paint adapter.
 */
export class PainterlySceneMaterialCoverage {
  private enabled = isPainterlyVegetationEnabled();
  private frame = 0;
  private readonly scene: THREE.Object3D;
  private readonly scanIntervalFrames: number;
  private readonly unsubscribe: () => void;
  private readonly textureSignatures = new WeakMap<THREE.Material, string>();
  private diagnostics: PainterlySceneCoverageDiagnostics = emptyDiagnostics(this.enabled);

  constructor(
    scene: THREE.Object3D,
    scanIntervalFrames = DEFAULT_SCAN_INTERVAL_FRAMES,
  ) {
    this.scene = scene;
    this.scanIntervalFrames = scanIntervalFrames;
    this.unsubscribe = subscribePainterlyVegetationPreference((enabled) => {
      this.enabled = enabled;
      this.diagnostics.enabled = enabled;
      if (enabled) this.synchronizeNow();
    });
    if (this.enabled) this.synchronizeNow();
  }

  update(): void {
    if (!this.enabled) return;
    this.frame += 1;
    if (this.frame % Math.max(1, this.scanIntervalFrames) === 0) {
      this.synchronizeNow();
    }
  }

  synchronizeNow(): PainterlySceneCoverageDiagnostics {
    const next = emptyDiagnostics(this.enabled);
    next.scans = this.diagnostics.scans + 1;
    const visitedMaterials = new Set<THREE.Material>();

    this.scene.traverse((object) => {
      next.visitedObjects += 1;
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (visitedMaterials.has(material)) continue;
        visitedMaterials.add(material);
        this.registerMaterial(mesh, material, next);
      }
    });

    this.diagnostics = next;
    return this.getDiagnostics();
  }

  getDiagnostics(): PainterlySceneCoverageDiagnostics {
    return { ...this.diagnostics };
  }

  dispose(): void {
    this.unsubscribe();
  }

  private registerMaterial(
    mesh: THREE.Mesh,
    material: THREE.Material,
    diagnostics: PainterlySceneCoverageDiagnostics,
  ): void {
    if (isPainterlyMaterialRegistered(material)) {
      if (material.userData.painterlySceneCoverage === true) {
        const signature = materialTextureSignature(material as SurfaceMaterial);
        if (this.textureSignatures.get(material) !== signature) {
          refreshPainterlyMaterial(material);
          this.textureSignatures.set(material, signature);
          diagnostics.refreshedMaterials += 1;
        }
      }
      diagnostics.alreadyRegisteredMaterials += 1;
      return;
    }

    const surface = material as SurfaceMaterial;
    if (!isSupportedSurfaceMaterial(surface)) {
      diagnostics.skippedUnsupportedMaterials += 1;
      return;
    }
    if (
      material.visible === false
      || surface.opacity === 0
      || material.colorWrite === false
    ) {
      diagnostics.skippedInvisibleMaterials += 1;
      return;
    }
    if (
      material.transparent === true
      && material.alphaTest <= 0
      && (surface.depthWrite === false || (surface.opacity ?? 1) < 0.98)
    ) {
      diagnostics.skippedBlendedMaterials += 1;
      return;
    }
    if (isSpecializedSurface(mesh, surface)) {
      diagnostics.skippedSpecializedMaterials += 1;
      return;
    }

    // Material.copy() duplicates userData but not this module's WeakMap
    // registration. Clear stale clone diagnostics before adopting the clone.
    clearStalePainterlyCloneFlags(material);
    const usesAuthoredUv = Boolean(
      surface.map
      || surface.alphaMap
      || surface.normalMap
      || surface.roughnessMap
      || material.alphaTest > 0,
    );
    applyPainterlyVegetationMaterial(material, 'scene-surface', {
      surfaceProjection: usesAuthoredUv ? 'uv' : 'object-triplanar',
      objectTextureScale: resolveObjectTextureScale(mesh, material),
    });
    material.userData.painterlySceneCoverage = true;
    this.textureSignatures.set(material, materialTextureSignature(surface));
    diagnostics.candidateMaterials += 1;
    diagnostics.newlyRegisteredMaterials += 1;
  }
}

function isSupportedSurfaceMaterial(material: SurfaceMaterial): boolean {
  return material.isMeshStandardMaterial === true
    || material.isMeshPhysicalMaterial === true
    || material.isMeshStandardNodeMaterial === true
    || material.isMeshPhysicalNodeMaterial === true;
}

function isSpecializedSurface(mesh: THREE.Mesh, material: SurfaceMaterial): boolean {
  if (material.userData.painterlySceneMaterial === false) return true;
  if (material.userData.waterQualityTier || material.userData.waterVisualFamily) return true;
  if ((material.transmission ?? 0) > 0.001) return true;
  const semanticName = `${mesh.name} ${material.name}`.toLowerCase();
  return /(?:^|\s)(?:water|smoke|shadow|collision|occlusion)(?:\s|$)/.test(semanticName);
}

function resolveObjectTextureScale(mesh: THREE.Mesh, material: THREE.Material): number {
  const metricUvMeters = material.userData.metricUvMeters;
  if (typeof metricUvMeters === 'number' && metricUvMeters > 0) {
    return THREE.MathUtils.clamp(1 / metricUvMeters, 0.22, 1.4);
  }
  const geometry = mesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const diameter = Math.max(geometry.boundingSphere?.radius ?? 1, 0.2) * 2;
  return THREE.MathUtils.clamp(
    1.2 / (diameter * 0.7),
    0.22,
    1.4,
  );
}

function clearStalePainterlyCloneFlags(material: THREE.Material): void {
  delete material.userData.painterlyVegetationRegistered;
  delete material.userData.painterlyVegetationInstalled;
  delete material.userData.painterlyVegetationRole;
  delete material.userData.painterlyVegetationTexture;
  delete material.userData.painterlyVegetationUsesReducedAo;
  delete material.userData.painterlyVegetationCoordinateSpace;
  delete material.userData.painterlyVegetationDeperiodized;
}

function materialTextureSignature(material: SurfaceMaterial): string {
  return [
    material.map?.uuid ?? '-',
    material.alphaMap?.uuid ?? '-',
    material.normalMap?.uuid ?? '-',
    material.roughnessMap?.uuid ?? '-',
  ].join('|');
}

function emptyDiagnostics(enabled: boolean): PainterlySceneCoverageDiagnostics {
  return {
    enabled,
    scans: 0,
    visitedObjects: 0,
    candidateMaterials: 0,
    newlyRegisteredMaterials: 0,
    refreshedMaterials: 0,
    alreadyRegisteredMaterials: 0,
    skippedUnsupportedMaterials: 0,
    skippedInvisibleMaterials: 0,
    skippedBlendedMaterials: 0,
    skippedSpecializedMaterials: 0,
  };
}
