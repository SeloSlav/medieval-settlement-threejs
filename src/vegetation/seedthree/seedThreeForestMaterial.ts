import type * as THREE from 'three';

/** Forest foliage is diffuse/transmissive; a sun-driven glossy lobe reads as shimmer. */
export const SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY = 0;

export type SeedThreeForestCardMotion = 'full' | 'sway' | 'static';

/**
 * Overview cards are a screen-space representation, not readable branch motion.
 * Keeping them fixed removes temporal alpha shimmer while the detailed near
 * cards continue to move normally.
 */
export const SEEDTHREE_OVERVIEW_CARD_MOTION: SeedThreeForestCardMotion = 'static';

export function resolveSeedThreeForestCardMotion(
  overview: boolean,
  crownUnderlay: boolean,
): SeedThreeForestCardMotion {
  if (overview) return SEEDTHREE_OVERVIEW_CARD_MOTION;
  // A crown underlay is a crossed pair. Per-plane flutter separates the pair
  // at its shared seam, so it may sway only as one rigid crown.
  if (crownUnderlay) return 'sway';
  return 'full';
}

type SeedThreePositionNodeMaterial = THREE.Material & {
  positionNode?: unknown;
};

/**
 * Override only the card-position node after SeedThree has built its forest
 * material. Near detail keeps the normal forest node, crown underlays reuse
 * their bake-authored rigid-sway node, and overview cards stay fixed.
 */
export function applySeedThreeForestCardMotion(
  material: THREE.Material,
  motion: SeedThreeForestCardMotion,
  sourceMaterial?: THREE.Material,
): THREE.Material {
  if (motion === 'full') return material;
  const target = material as SeedThreePositionNodeMaterial;
  const nextPositionNode = motion === 'static'
    ? null
    : (sourceMaterial as SeedThreePositionNodeMaterial | undefined)?.positionNode ?? null;
  if (target.positionNode !== nextPositionNode) {
    target.positionNode = nextPositionNode;
    material.needsUpdate = true;
  }
  material.userData.seedThreeForestCardMotion = motion;
  return material;
}

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
