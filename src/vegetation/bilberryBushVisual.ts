import * as THREE from 'three';

/**
 * Bilberry reads as a knee-to-waist shrub layer: clearly above grass tufts,
 * well below tree trunks and juniper scrub.
 */
export function sampleBilberryBushScale(density: number, rng: () => number): number {
  const densityMul = THREE.MathUtils.lerp(1.04, 1.18, density) * 1.18;
  return THREE.MathUtils.lerp(0.9, 1.42, Math.pow(rng(), 0.74)) * densityMul;
}

export function sampleBerryPatchClumpScale(rng: () => number): number {
  // The previous range scaled a complete crossed-card clump. The real
  // SeedThree Rubus skeleton is already life-sized, so keep mature canes in
  // the roughly 0.8–1.5 m range before the small per-instance height jitter.
  return THREE.MathUtils.lerp(0.78, 1.18, Math.pow(rng(), 0.72));
}
