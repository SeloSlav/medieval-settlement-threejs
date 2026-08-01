import type * as THREE from 'three';

/** Forest foliage is diffuse/transmissive; a sun-driven glossy lobe reads as shimmer. */
export const SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY = 0;

/**
 * Stabilize animated forest cards against alpha-edge and sun-specular shimmer.
 *
 * Without this, sub-pixel leaves switch between fully drawn and fully discarded
 * as a walking camera moves. Physical foliage also inherits a glossy specular
 * lobe which flashes under the daytime directional light as wind changes its
 * normals, even at maximum roughness.
 */
export function stabilizeSeedThreeForestCardMaterial(
  material: THREE.Material,
): THREE.Material {
  const physicalMaterial = material as THREE.Material & { specularIntensity?: number };
  let changed = false;
  if (!material.alphaToCoverage) {
    material.alphaToCoverage = true;
    changed = true;
  }
  if (
    typeof physicalMaterial.specularIntensity === 'number'
    && physicalMaterial.specularIntensity !== SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY
  ) {
    // Preserve diffuse light, shadows, and SSS while removing moving sun glints.
    physicalMaterial.specularIntensity = SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY;
    changed = true;
  }
  // Shared prototype materials may already have a compiled pipeline.
  if (changed) material.needsUpdate = true;
  return material;
}
