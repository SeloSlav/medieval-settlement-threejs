import { apple } from '@seedthree/species/apple.js';
import { cherry } from '@seedthree/species/cherry.js';
import { pear } from '@seedthree/species/pear.js';
import { aronia } from '@seedthree/species/aronia.js';
import { rosehip } from '@seedthree/species/rosehip.js';
import type { SeedThreeSpeciesPreset } from './seedThreeAssets.ts';

export type BackyardPlantKind = 'apple' | 'cherry' | 'pear' | 'aronia' | 'rosehip' | 'rose';

/**
 * Apple and cherry are shared SeedThree species. The cottage rose remains a
 * Medieval Roads-specific preset and is intentionally outside the upstream PR.
 */
export const BACKYARD_PLANT_SPECIES: Record<BackyardPlantKind, SeedThreeSpeciesPreset> = {
  // Keep the historical names because SeedThree uses species.name in its RNG seed.
  apple: { ...apple, name: 'Gorski Backyard Apple' } as SeedThreeSpeciesPreset,
  cherry: { ...cherry, name: 'Gorski Backyard Cherry' } as SeedThreeSpeciesPreset,
  pear: { ...pear, name: 'Gorski Backyard Pear' } as SeedThreeSpeciesPreset,
  aronia: { ...aronia, name: 'Gorski Backyard Aronia' } as SeedThreeSpeciesPreset,
  rosehip: { ...rosehip, name: 'Gorski Backyard Rosehip' } as SeedThreeSpeciesPreset,
  rose: {
    name: 'Gorski Cottage Rose',
    bark: 'sweetgum_albedo.png',
    leaf: 'sweetgum_single_albedo.png',
    foliage: {
      mode: 'leaves',
      clustersPerBranch: 3,
      clusterSize: 0.28,
      clusterSizeVar: 0.1,
      clusterQuads: 2,
      tint: 0xb8d591,
      leavesPerBranch: 7,
      size: 0.105,
      downAngle: 58,
      bend: 0,
      trunkClearRadius: 0.03,
    },
    params: {
      scale: 1.12,
      scaleV: 0.15,
      levels: 3,
      ratio: 0.033,
      ratioPower: 1.25,
      baseSize: 0.04,
      shape: 1,
      flare: 0.18,
      attractionUp: 0.72,
      baseSplits: 4,
      baseSplitAngle: 28,
      length: [0.9, 0.72, 0.46, 0.2],
      lengthV: [0.08, 0.18, 0.14, 0.08],
      taper: [1, 1, 1, 1],
      curveRes: [6, 4, 3, 3],
      curve: [8, 34, 32, 0],
      curveBack: [0, -12, 0, 0],
      curveV: [18, 62, 58, 50],
      downAngle: [0, 38, 54, 58],
      downAngleV: [0, 26, 24, 22],
      rotate: [0, 112, 137, 137],
      rotateV: [0, 38, 34, 34],
      branches: [0, 9, 7, 0],
      radialSegments: [7, 5, 4, 3],
    },
  },
};
