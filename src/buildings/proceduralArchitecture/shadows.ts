import * as THREE from 'three';
import {
  getBuildingDetailCasterBatchStats,
  installBuildingDetailCasterBatches,
  type BuildingDetailCasterBatchStats,
} from '../buildingDetailShadowBatch.ts';
import { getFoundersCampShadowCasterStats } from '../foundersCampShadowCasters.ts';
import { markBuildingDetailShadowCaster } from '../buildingShadowProxy.ts';
import { isDynamicBuildingBatchBoundary } from '../staticBuildingBatch.ts';

const MIN_STRUCTURAL_CASTER_SPAN_METERS = 0.24;

/**
 * Builds exact, material-preserving shadow batches for the immutable structural
 * shell. Runtime stock, smoke, water, workers, and other mutable props remain
 * outside this pass.
 */
export function installProceduralShadowCasters(
  root: THREE.Group,
  name: string,
  isRuntimeBoundary: (object: THREE.Object3D) => boolean = isDynamicBuildingBatchBoundary,
): BuildingDetailCasterBatchStats {
  const foundersCamp = getFoundersCampShadowCasterStats(root);
  if (foundersCamp) {
    return {
      sourceDraws: foundersCamp.authoredSourceDraws,
      batchDraws: foundersCamp.shadowDraws,
      sourceTriangles: foundersCamp.authoredSourceTriangles,
      batchTriangles: foundersCamp.shadowTriangles,
      rejectedSources: 0,
    };
  }
  const existing = getBuildingDetailCasterBatchStats(root);
  if (existing) return existing;

  const visit = (object: THREE.Object3D, runtimeOwned: boolean): void => {
    const excluded = runtimeOwned || isRuntimeBoundary(object) || !object.visible;
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    if (mesh.isMesh && !excluded && isStructuralCaster(mesh)) {
      markBuildingDetailShadowCaster(mesh as THREE.Mesh);
    }
    for (const child of object.children) visit(child, excluded);
  };
  for (const child of root.children) visit(child, false);
  return installBuildingDetailCasterBatches(root, name);
}

function isStructuralCaster(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
): boolean {
  if (!mesh.geometry.getAttribute('position')) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (
    materials.length !== 1
    || materials.some((material) => (
      !material.visible
      || material.transparent
      || material.opacity < 1
      || isNonStructuralMaterial(material)
    ))
  ) {
    return false;
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  if (!bounds) return false;
  const size = bounds.getSize(new THREE.Vector3());
  size.set(
    Math.abs(size.x * mesh.scale.x),
    Math.abs(size.y * mesh.scale.y),
    Math.abs(size.z * mesh.scale.z),
  );
  return Math.max(size.x, size.y, size.z) >= MIN_STRUCTURAL_CASTER_SPAN_METERS;
}

function isNonStructuralMaterial(material: THREE.Material): boolean {
  const name = material.name.toLowerCase();
  return name.includes('smoke')
    || name.includes('water')
    || name.includes('foliage')
    || name.includes('crop')
    || name.includes('window glow')
    || name.includes('flame');
}
