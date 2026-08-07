import type * as THREE from 'three';
import { float, uniform } from 'three/tsl';
import { foliageWindPosition } from '@seedthree/core/wind.js';

/** Forest foliage is diffuse/transmissive; a sun-driven glossy lobe reads as shimmer. */
export const SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY = 0;

export type SeedThreeForestCardMotion = 'full' | 'sway' | 'static';

/**
 * Overview cards are a screen-space representation, not readable branch motion.
 * Keeping them fixed removes temporal alpha shimmer while the detailed near
 * cards continue to move normally.
 */
export const SEEDTHREE_OVERVIEW_CARD_MOTION: SeedThreeForestCardMotion = 'static';

/**
 * Forest branch cards move as rigid clusters. Per-vertex flutter changes the
 * alpha-tested silhouette at high frequency, which aliases into black flashes
 * as a first-person camera translates, retreats, or pitches.
 */
export const SEEDTHREE_NEAR_CARD_MOTION: SeedThreeForestCardMotion = 'sway';

const rigidForestCardSwayPositionNode = foliageWindPosition(false);

export function resolveSeedThreeForestCardMotion(
  overview: boolean,
  crownUnderlay: boolean,
): SeedThreeForestCardMotion {
  if (overview) return SEEDTHREE_OVERVIEW_CARD_MOTION;
  // Both crossed underlays and detailed branch cards keep coherent whole-card
  // sway. Only the high-frequency silhouette-changing flutter is removed.
  return crownUnderlay ? 'sway' : SEEDTHREE_NEAR_CARD_MOTION;
}

type SeedThreePositionNodeMaterial = THREE.Material & {
  positionNode?: unknown;
};

type TslNode = {
  mul(value: unknown): TslNode;
};

type SeedThreeOpacityNodeMaterial = THREE.Material & {
  opacityNode?: TslNode | null;
};

const overviewBillboardFadeOpacity = uniform(0) as { value: number } & TslNode;

/** Smoothly blend the far-card overlay over an always-resident real tree. */
export function applySeedThreeOverviewBillboardFade(
  material: THREE.Material,
): THREE.Material {
  if (material.userData.seedThreeOverviewBillboardFade === true) return material;
  const target = material as SeedThreeOpacityNodeMaterial;
  const baseOpacity = target.opacityNode ?? (float(1) as TslNode);
  target.opacityNode = baseOpacity.mul(overviewBillboardFadeOpacity);
  // Both alpha hashing and an animated alpha-test threshold change foliage
  // coverage discontinuously while zooming. The overview layer is small and
  // temporary, so conventional blending is the stable crossfade here.
  material.alphaTest = 0;
  material.alphaHash = false;
  material.alphaToCoverage = false;
  material.transparent = true;
  material.depthWrite = false;
  material.userData.seedThreeOverviewBillboardFade = true;
  material.needsUpdate = true;
  return material;
}

/** Clone a cached forest material so fading overview geometry cannot fade near trees. */
export function createSeedThreeOverviewFadeMaterial(
  source: THREE.Material,
): THREE.Material {
  const material = source.clone();
  // NodeMaterial.clone() omits these standard texture/node properties in the
  // current Three WebGPU path, so restore the complete forest material recipe.
  for (const property of [
    'map',
    'normalMap',
    'roughnessMap',
    'colorNode',
    'normalNode',
    'roughnessNode',
    'metalnessNode',
    'positionNode',
    'opacityNode',
    'thicknessColorNode',
    'thicknessDistortionNode',
    'thicknessAmbientNode',
    'thicknessAttenuationNode',
    'thicknessPowerNode',
    'thicknessScaleNode',
  ]) {
    const value = Reflect.get(source, property);
    if (value !== undefined) Reflect.set(material, property, value);
  }
  material.userData.seedThreeOwnedOverviewFadeMaterial = true;
  return applySeedThreeOverviewBillboardFade(material);
}

export const createSeedThreeOverviewBarkFadeMaterial = createSeedThreeOverviewFadeMaterial;

export function setSeedThreeOverviewBillboardFadeOpacity(opacity: number): void {
  overviewBillboardFadeOpacity.value = Math.max(
    0,
    Math.min(1, Number.isFinite(opacity) ? opacity : 0),
  );
}

/**
 * Override only the card-position node after SeedThree has built its forest
 * material. Detailed cards and crown underlays use one coherent rigid-sway
 * node, while overview cards stay fixed.
 */
export function applySeedThreeForestCardMotion(
  material: THREE.Material,
  motion: SeedThreeForestCardMotion,
): THREE.Material {
  if (motion === 'full') return material;
  const target = material as SeedThreePositionNodeMaterial;
  const nextPositionNode = motion === 'static'
    ? null
    : rigidForestCardSwayPositionNode;
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
