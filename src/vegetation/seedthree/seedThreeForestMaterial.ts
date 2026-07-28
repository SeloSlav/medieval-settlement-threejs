import type * as THREE from 'three';

/**
 * Smooth alpha-tested branch-card edges through the renderer's MSAA coverage.
 *
 * Without this, sub-pixel leaves switch between fully drawn and fully discarded
 * as a walking camera moves, which makes distant crowns shimmer in first person.
 */
export function stabilizeSeedThreeForestCardMaterial(
  material: THREE.Material,
): THREE.Material {
  if (!material.alphaToCoverage) {
    material.alphaToCoverage = true;
    // Shared prototype materials may already have a compiled pipeline.
    material.needsUpdate = true;
  }
  return material;
}
