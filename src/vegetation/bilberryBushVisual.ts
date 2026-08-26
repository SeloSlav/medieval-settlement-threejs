import * as THREE from 'three';

/** Bilberry stays a low 0.3-0.75 m field layer but can form broad dense patches. */
export function sampleBilberryBushScale(density: number, rng: () => number): number {
  const densityMul = THREE.MathUtils.lerp(0.92, 1.04, density);
  return THREE.MathUtils.lerp(0.58, 1.02, Math.pow(rng(), 0.82)) * densityMul;
}

export function sampleBerryPatchClumpScale(rng: () => number): number {
  // Base variation for the real SeedThree Rubus skeleton. BerryPatchVisuals
  // applies its authored thicket-height multiplier independently so the
  // cluster footprint and the fruit's real-world diameter remain stable.
  return THREE.MathUtils.lerp(0.78, 1.18, Math.pow(rng(), 0.72));
}
