import * as THREE from 'three';
import * as TSL from 'three/tsl';
import {
  attribute,
  float,
  mix,
  normalWorldGeometry,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  vec3,
} from 'three/tsl';

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

type TslNode = {
  add(value: unknown): TslNode;
  clamp(minimum: unknown, maximum: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

type TslVectorNode = TslNode & {
  a: TslNode;
  rgb: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
};

// @types/three 0.185 omits step from the three/tsl barrel even though the
// runtime build exports it. Keep the compatibility cast local to this module.
const tslStep = (TSL as unknown as {
  step(edge: unknown, value: unknown): TslNode;
}).step;

type SeedThreeOpacityNodeMaterial = THREE.Material & {
  opacityNode?: TslNode | null;
};

type SeedThreeFoliageNodeMaterial = SeedThreeOpacityNodeMaterial & {
  map?: THREE.Texture | null;
  thicknessColorNode?: TslNode | null;
};

type SeedThreeBarkNodeMaterial = THREE.Material & {
  color?: THREE.Color;
  colorNode?: TslNode | null;
  map?: THREE.Texture | null;
};

const barkSnowTsl = {
  mix: mix as (left: unknown, right: unknown, amount: unknown) => TslNode,
  normalWorldGeometry: normalWorldGeometry as unknown as TslVectorNode,
  positionWorld: positionWorld as unknown as TslVectorNode,
  sin: sin as (value: unknown) => TslNode,
  smoothstep: smoothstep as (low: unknown, high: unknown, value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslVectorNode,
  uniform: uniform as <T>(value: T) => { value: T } & TslNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => TslNode,
};

const overviewBillboardFadeOpacity = uniform(0) as { value: number } & TslNode;

/**
 * Adds one shared, upward-facing snow response to real trunks and branches.
 * The world-space breakup is deterministic and consumes no extra instance
 * attribute, texture sample, draw call, or geometry pass.
 */
export function applySeedThreeBarkSnow(
  material: THREE.Material,
): THREE.Material {
  if (material.userData.seedThreeBarkSnow === true) return material;
  const target = material as SeedThreeBarkNodeMaterial;
  if (!target.map) return material;
  const snowCoverage = barkSnowTsl.uniform(0);
  const tint = barkSnowTsl.uniform(target.color?.clone() ?? new THREE.Color(0xffffff));
  const baseSurface = barkSnowTsl.texture(target.map).rgb.mul(tint);
  const upwardExposure = barkSnowTsl.smoothstep(
    float(0.3),
    float(0.88),
    barkSnowTsl.normalWorldGeometry.y,
  );
  const snowVariation = barkSnowTsl.sin(
    barkSnowTsl.positionWorld.x.mul(0.73)
      .add(barkSnowTsl.positionWorld.z.mul(1.07)),
  ).mul(0.11).add(0.89);
  const snowAmount = snowCoverage
    .mul(upwardExposure)
    .mul(snowVariation)
    .mul(0.62);
  target.colorNode = barkSnowTsl.mix(
    baseSurface,
    barkSnowTsl.vec3(0.92, 0.955, 0.98),
    snowAmount,
  );
  material.userData.forestSnowCoverage = snowCoverage;
  material.userData.seedThreeBarkSnow = true;
  material.needsUpdate = true;
  return material;
}

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

/** Drop strategic foliage cards in stable clusters on dormant deciduous instances. */
export function applySeedThreeWholeCardDormancy(
  material: THREE.Material,
): THREE.Material {
  if (material.userData.seedThreeWholeCardDormancy === true) return material;
  const dormancy = material.userData.forestSeasonalDormancy as TslNode | undefined;
  if (!dormancy) return material;
  // aTreeOrigin.y packs the deciduous bit at +2048. The 1024 threshold matches
  // the forest compaction and SeedThree card shader without adding an attribute.
  const packedTreeOrigin = attribute('aTreeOrigin', 'vec3') as unknown as TslVectorNode;
  const deciduousInstance = tslStep(float(1024), packedTreeOrigin.y);
  const treeOriginY = packedTreeOrigin.y.sub(deciduousInstance.mul(float(2048)));
  const anchor = attribute('aAnchorPos', 'vec3') as unknown as TslVectorNode;
  const cardVariation = attribute('aThickness', 'float') as unknown as TslVectorNode;
  const phenologyOffset = barkSnowTsl.sin(
    packedTreeOrigin.x.mul(0.37).add(packedTreeOrigin.z.mul(0.53)),
  ).mul(0.13)
    .mul(dormancy)
    .mul((float(1) as TslNode).sub(dormancy));
  const effectiveDormancy = dormancy.add(phenologyOffset).clamp(0, 1);
  const clusterNoise = barkSnowTsl.sin(
    packedTreeOrigin.x.mul(0.19)
      .add(treeOriginY.mul(0.11))
      .add(packedTreeOrigin.z.mul(0.27))
      .add(anchor.x.mul(1.31))
      .add(anchor.y.mul(0.83))
      .add(anchor.z.mul(1.57))
      // Forest compaction shares one tree-root anchor across its cards.
      // Reuse the existing per-card thickness randomizer so crown cards shed
      // progressively instead of disappearing as one synchronized slab.
      .add(cardVariation.mul(7.31)),
  ).mul(0.49).add(0.5);
  const clusterRetain = tslStep(effectiveDormancy, clusterNoise);
  const retain = (float(1) as TslNode).sub(
    deciduousInstance.mul((float(1) as TslNode).sub(clusterRetain)),
  );
  const target = material as SeedThreeFoliageNodeMaterial;
  const cardAlpha = target.map
    ? (texture(target.map) as unknown as TslVectorNode).a
    : float(1) as TslNode;
  target.opacityNode = cardAlpha.mul(retain);
  if (target.thicknessColorNode) {
    target.thicknessColorNode = target.thicknessColorNode.mul(retain);
  }
  material.userData.seedThreeWholeCardDormancy = true;
  material.needsUpdate = true;
  return material;
}

/** Clone a cached forest material so fading overview geometry cannot fade near trees. */
export function createSeedThreeOverviewFadeMaterial(
  source: THREE.Material,
  wholeCardDormancy = false,
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
  // Material.clone() copies userData by value, but the restored node graph above
  // still reads the source material's live seasonal uniforms. Restore those
  // handles by reference so calendar updates reach the graph actually rendered
  // by crown-underlay clones.
  for (const property of [
    'forestSeasonalSpringFlush',
    'forestSeasonalAutumnColor',
    'forestSeasonalDormancy',
    'forestSnowCoverage',
  ]) {
    const value = source.userData[property];
    if (value !== undefined) material.userData[property] = value;
  }
  material.userData.seedThreeOwnedOverviewFadeMaterial = true;
  if (wholeCardDormancy) applySeedThreeWholeCardDormancy(material);
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
