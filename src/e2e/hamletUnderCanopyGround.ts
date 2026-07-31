import * as THREE from 'three';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import {
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  measureHamletForestBeltClearance,
  type HamletForestEdgeLayout,
} from './hamletForestEdgeLayer.ts';

export const HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER =
  'forestGround' as const;
export const HAMLET_UNDER_CANOPY_GROUND_CONTROL =
  'existing-terrain' as const;
export const HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT =
  'shadowed-under-canopy' as const;
export const HAMLET_UNDER_CANOPY_GROUND_TREATMENT =
  'mottled-dense-crown-floor' as const;

export const HAMLET_UNDER_CANOPY_ROUND_56_MAXIMUM_DENSE_BLEND = 0.3;
export const HAMLET_UNDER_CANOPY_ROUND_56_INNER_RADIUS_RATIO = 0.56;
export const HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET = Object.freeze({
  meadow: 0.08,
  dense: 0.84,
  dry: 0.08,
});
export const HAMLET_UNDER_CANOPY_MAXIMUM_BLEND = 0.9;
export const HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO = 0.2;
export const HAMLET_UNDER_CANOPY_DENSITY_START = 1.05;
export const HAMLET_UNDER_CANOPY_DENSITY_FULL = 2.65;
export const HAMLET_UNDER_CANOPY_CLEARANCE_FEATHER_METERS = 7;
export const HAMLET_UNDER_CANOPY_MINIMUM_APPLIED_BLEND = 0.025;
export const HAMLET_UNDER_CANOPY_TARGET_LUMINANCE_RATIO = 0.7;
export const HAMLET_UNDER_CANOPY_DARK_TARGET = Object.freeze({
  meadow: 0,
  dense: 1,
  dry: 0,
});
export const HAMLET_UNDER_CANOPY_LITTER_TARGET = Object.freeze({
  meadow: 0.01,
  dense: 0.75,
  dry: 0.24,
});

export type HamletUnderCanopyGroundTreatment =
  | typeof HAMLET_UNDER_CANOPY_GROUND_CONTROL
  | typeof HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT
  | typeof HAMLET_UNDER_CANOPY_GROUND_TREATMENT;

type HamletUnderCanopyBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type HamletUnderCanopyGroundEvidenceV2 = {
  schemaVersion: 2;
  query: {
    parameter: typeof HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER;
    value: HamletUnderCanopyGroundTreatment;
    defaultWhenAbsent: typeof HAMLET_UNDER_CANOPY_GROUND_CONTROL;
  };
  mode:
    | 'round-55-accepted-terrain-unchanged'
    | 'round-56-startup-only-existing-biome-weight-rebalance'
    | 'startup-only-existing-biome-weight-mottle';
  source: {
    forestEdgeLayout: HamletForestEdgeLayout;
    vegetationSlots: number;
    edgeSlots: number;
    denseCrownSlots: number;
    footprintBasis:
      | 'accepted-edge-slot-layer-scale-radial-union'
      | 'accepted-interior-crown-overlap-density-clearance-and-mottle';
  };
  footprint: {
    terrainVertices: number;
    candidateVertices: number;
    densityQualifiedVertices: number;
    modifiedVertices: number;
    modifiedPercent: number;
    weightedCoverageSquareMeters: number;
    bounds: HamletUnderCanopyBounds | null;
    maximumRadiusMeters: number;
    innerRadiusRatio: number;
    densityStart: number;
    densityFull: number;
    peakCrownDensity: number;
    requiredMinimumAdjoiningCrowns: 1 | 2;
    observedMinimumAdjoiningCrowns: number | null;
    coverageMethod:
      | 'not-applied'
      | 'integrated-linear-vertex-mask-over-xz-triangles'
      | 'integrated-linear-mottled-overlap-mask-over-xz-triangles';
    interpolationHaloMeters: number;
    clearance: {
      requiredRoadVertexMeters: number;
      requiredSettlementVertexMeters: number;
      featherMeters: number;
      observedRoadVertexMinimumMeters: number | null;
      observedSettlementVertexMinimumMeters: number | null;
      guaranteedRoadFragmentMinimumMeters: number | null;
      guaranteedSettlementFragmentMinimumMeters: number | null;
      rejectedRoadVertices: number;
      rejectedSettlementVertices: number;
      roadContaminationVertices: 0;
      parcelContaminationVertices: 0;
      roadContaminationTriangles: 0;
      parcelContaminationTriangles: 0;
    };
  };
  tone: {
    maximumBlend: number;
    targetLuminanceRatio: number;
    darkTargetWeights: {
      meadow: number;
      dense: number;
      dry: number;
    };
    litterTargetWeights: {
      meadow: number;
      dense: number;
      dry: number;
    };
    meanStableLuminanceBefore: number | null;
    meanStableLuminanceAfter: number | null;
    meanStableLuminanceReductionPercent: number;
    minimumStableLuminanceReductionPercent: number;
    maximumStableLuminanceReductionPercent: number;
    stableLuminanceReductionStandardDeviationPercent: number;
    mottling: {
      basis:
        | 'not-applied'
        | 'none-round-56-radial-union'
        | 'domain-warped-lattice-value-noise-with-irregular-light-channels';
      meanAppliedBlend: number;
      appliedBlendStandardDeviation: number;
      minimumAppliedBlend: number;
      maximumAppliedBlend: number;
      darkBasinVertices: number;
      leafLitterVertices: number;
      lighterChannelVertices: number;
    };
  };
  budget: {
    forestSlotDelta: 0;
    forestDrawDelta: 0;
    terrainDrawDelta: 0;
    textureAssetDelta: 0;
    meshDelta: 0;
    materialDelta: 0;
    geometryVertexDelta: 0;
    geometryIndexDelta: 0;
    vertexAttributeDelta: 0;
    colorBufferByteDelta: 0;
    shaderDelta: 0;
    perFrameWorkDelta: 0;
    startupColorWrites: number;
    geometry: {
      vertices: number;
      indices: number;
      attributes: number;
      colorBufferBytes: number;
    };
  };
  seedThreeAudit: {
    classification: 'hamlet-specific-terrain-weighting';
    reusableSeedThreeBehaviorAdded: false;
    gitlinkChangeRequired: false;
    reason:
      'footprint-and-clearance-depend-on-hamlet-road-parcel-and-edge-composition';
  };
};

export type HamletUnderCanopyGroundEvidence =
  | HamletUnderCanopyGroundEvidenceV2
  | ReturnType<typeof createRound56Evidence>;

const STABLE_BIOME_COLORS = [
  [0.1, 0.108, 0.04],
  [0.05, 0.055, 0.029],
  [0.18, 0.17, 0.078],
] as const;

const STABLE_BIOME_LUMINANCE = STABLE_BIOME_COLORS.map(
  ([red, green, blue]) => red * 0.2126 + green * 0.7152 + blue * 0.0722,
);

export function resolveHamletUnderCanopyGroundTreatment(
  value: string | null,
): HamletUnderCanopyGroundTreatment {
  if (
    value === null
    || value === HAMLET_UNDER_CANOPY_GROUND_CONTROL
  ) {
    return HAMLET_UNDER_CANOPY_GROUND_CONTROL;
  }
  if (value === HAMLET_UNDER_CANOPY_GROUND_TREATMENT) {
    return HAMLET_UNDER_CANOPY_GROUND_TREATMENT;
  }
  if (value === HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT) {
    return HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT;
  }
  throw new Error(
    `${HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER} must be `
    + `${HAMLET_UNDER_CANOPY_GROUND_CONTROL} or `
    + `${HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT} or `
    + `${HAMLET_UNDER_CANOPY_GROUND_TREATMENT}.`,
  );
}

export function assertHamletUnderCanopyGroundDependencies(
  treatment: HamletUnderCanopyGroundTreatment,
  forestEdgeLayout: HamletForestEdgeLayout,
): void {
  if (
    treatment !== HAMLET_UNDER_CANOPY_GROUND_CONTROL
    && forestEdgeLayout !== HAMLET_FOREST_EDGE_LAYOUT_TAPERED
  ) {
    throw new Error(
      `${HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER}=`
      + `${treatment} requires `
      + `forestEdgeLayout=${HAMLET_FOREST_EDGE_LAYOUT_TAPERED}.`,
    );
  }
}

export function applyHamletUnderCanopyGroundTreatment(input: {
  treatment: HamletUnderCanopyGroundTreatment;
  forestEdgeLayout: HamletForestEdgeLayout;
  geometry: THREE.BufferGeometry;
  placements: readonly ForestTreePlacement[];
}): HamletUnderCanopyGroundEvidence {
  assertHamletUnderCanopyGroundDependencies(
    input.treatment,
    input.forestEdgeLayout,
  );

  const position = input.geometry.getAttribute('position');
  const color = input.geometry.getAttribute('color');
  if (
    !(position instanceof THREE.BufferAttribute)
    || !(color instanceof THREE.BufferAttribute)
    || color.itemSize !== 3
    || position.count !== color.count
  ) {
    throw new Error(
      'Hamlet under-canopy treatment requires matched position and RGB color attributes.',
    );
  }

  const edgePlacements = input.placements.filter(
    (placement) => placement.edgeBand !== undefined,
  );
  const denseCrownPlacements = edgePlacements.filter(
    (placement) => placement.edgeBand?.layer === 'interior-crown',
  );
  const maximumRadiusMeters = (
    input.treatment === HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT
      ? edgePlacements
      : denseCrownPlacements
  ).reduce(
    (maximum, placement) => Math.max(
      maximum,
      input.treatment
        === HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT
        ? resolveRound56UnderCanopyRadius(placement)
        : resolveDenseCrownFloorRadius(placement),
    ),
    0,
  );
  const geometryBudget = {
    vertices: position.count,
    indices: input.geometry.index?.count ?? 0,
    attributes: Object.keys(input.geometry.attributes).length,
    colorBufferBytes: color.array.byteLength,
  };

  if (input.treatment === HAMLET_UNDER_CANOPY_GROUND_CONTROL) {
    return createEvidence({
      treatment: input.treatment,
      forestEdgeLayout: input.forestEdgeLayout,
      vegetationSlots: input.placements.length,
      edgeSlots: edgePlacements.length,
      denseCrownSlots: denseCrownPlacements.length,
      terrainVertices: position.count,
      maximumRadiusMeters,
      geometryBudget,
    });
  }
  if (
    input.placements.length !== 1651
    || edgePlacements.length !== 256
    || denseCrownPlacements.length !== 112
  ) {
    throw new Error(
      'Under-canopy ground requires the accepted '
      + '1,651-slot / 256-edge-slot / 112-dense-crown layout.',
    );
  }

  const terrainTopology = measureTerrainTopology(
    input.geometry,
    position,
  );
  if (
    input.treatment === HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT
  ) {
    return applyRound56UnderCanopyGroundTreatment({
      treatment: input.treatment,
      forestEdgeLayout: input.forestEdgeLayout,
      position,
      color,
      placements: input.placements,
      edgePlacements,
      denseCrownSlots: denseCrownPlacements.length,
      geometryBudget,
      terrainTopology,
      maximumRadiusMeters,
    });
  }

  const requiredRoadVertexMeters =
    HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    + terrainTopology.maximumTriangleEdgeMeters;
  const requiredSettlementVertexMeters =
    HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
    + terrainTopology.maximumTriangleEdgeMeters;
  let candidateVertices = 0;
  let densityQualifiedVertices = 0;
  let modifiedVertices = 0;
  let weightedCoverageSquareMeters = 0;
  let rejectedRoadVertices = 0;
  let rejectedSettlementVertices = 0;
  let peakCrownDensity = 0;
  let observedMinimumAdjoiningCrowns = Infinity;
  let observedRoadVertexMinimumMeters = Infinity;
  let observedSettlementVertexMinimumMeters = Infinity;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumZ = Infinity;
  let maximumZ = -Infinity;
  let luminanceBeforeSum = 0;
  let luminanceAfterSum = 0;
  let reductionPercentSum = 0;
  let reductionPercentSquaredSum = 0;
  let minimumReductionPercent = Infinity;
  let maximumReductionPercent = -Infinity;
  let appliedBlendSum = 0;
  let appliedBlendSquaredSum = 0;
  let minimumAppliedBlend = Infinity;
  let maximumAppliedBlend = -Infinity;
  let darkBasinVertices = 0;
  let leafLitterVertices = 0;
  let lighterChannelVertices = 0;

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const x = position.getX(vertexIndex);
    const z = position.getZ(vertexIndex);
    const crownFloor = measureDenseCrownFloorAt(
      x,
      z,
      denseCrownPlacements,
    );
    if (crownFloor.density <= 0) continue;
    candidateVertices += 1;
    peakCrownDensity = Math.max(
      peakCrownDensity,
      crownFloor.density,
    );
    const densityWeight = smootherStep(
      HAMLET_UNDER_CANOPY_DENSITY_START,
      HAMLET_UNDER_CANOPY_DENSITY_FULL,
      crownFloor.density,
    );
    if (densityWeight <= 0) continue;
    densityQualifiedVertices += 1;

    const clearance = measureHamletForestBeltClearance(x, z);
    const rejectedForRoad =
      clearance.roadMeters < requiredRoadVertexMeters;
    const rejectedForSettlement =
      clearance.settlementMeters < requiredSettlementVertexMeters;
    if (rejectedForRoad) rejectedRoadVertices += 1;
    if (rejectedForSettlement) rejectedSettlementVertices += 1;
    if (rejectedForRoad || rejectedForSettlement) continue;

    const clearanceWeight = Math.min(
      smootherStep(
        requiredRoadVertexMeters,
        requiredRoadVertexMeters
          + HAMLET_UNDER_CANOPY_CLEARANCE_FEATHER_METERS,
        clearance.roadMeters,
      ),
      smootherStep(
        requiredSettlementVertexMeters,
        requiredSettlementVertexMeters
          + HAMLET_UNDER_CANOPY_CLEARANCE_FEATHER_METERS,
        clearance.settlementMeters,
      ),
    );
    const mottle = sampleHamletFloorMottle(x, z);
    const blend = HAMLET_UNDER_CANOPY_MAXIMUM_BLEND
      * densityWeight
      * clearanceWeight
      * mottle.strength;
    if (blend < HAMLET_UNDER_CANOPY_MINIMUM_APPLIED_BLEND) continue;

    const meadowBefore = color.getX(vertexIndex);
    const denseBefore = color.getY(vertexIndex);
    const dryBefore = color.getZ(vertexIndex);
    const beforeLuminance = stableBiomeLuminance(
      meadowBefore,
      denseBefore,
      dryBefore,
    );
    const target = resolveMottledFloorTarget(
      mottle.litterMix,
      beforeLuminance,
    );
    const meadowAfter = Math.fround(THREE.MathUtils.lerp(
      meadowBefore,
      target.meadow,
      blend,
    ));
    const denseAfter = Math.fround(THREE.MathUtils.lerp(
      denseBefore,
      target.dense,
      blend,
    ));
    const dryAfter = Math.fround(THREE.MathUtils.lerp(
      dryBefore,
      target.dry,
      blend,
    ));
    if (
      meadowAfter === meadowBefore
      && denseAfter === denseBefore
      && dryAfter === dryBefore
    ) {
      continue;
    }
    color.setXYZ(vertexIndex, meadowAfter, denseAfter, dryAfter);

    const afterLuminance = stableBiomeLuminance(
      meadowAfter,
      denseAfter,
      dryAfter,
    );
    if (afterLuminance >= beforeLuminance) {
      throw new Error(
        'Mottled dense-crown floor must reduce every modified '
        + 'terrain vertex value.',
      );
    }
    const reductionPercent =
      (1 - afterLuminance / beforeLuminance) * 100;
    luminanceBeforeSum += beforeLuminance;
    luminanceAfterSum += afterLuminance;
    reductionPercentSum += reductionPercent;
    reductionPercentSquaredSum += reductionPercent * reductionPercent;
    minimumReductionPercent = Math.min(
      minimumReductionPercent,
      reductionPercent,
    );
    maximumReductionPercent = Math.max(
      maximumReductionPercent,
      reductionPercent,
    );
    appliedBlendSum += blend;
    appliedBlendSquaredSum += blend * blend;
    minimumAppliedBlend = Math.min(minimumAppliedBlend, blend);
    maximumAppliedBlend = Math.max(maximumAppliedBlend, blend);
    if (target.effectiveLitterMix <= 0.2) darkBasinVertices += 1;
    if (dryAfter >= 0.18 && mottle.litterMix >= 0.42) {
      leafLitterVertices += 1;
    }
    if (mottle.channelAttenuation <= 0.68) {
      lighterChannelVertices += 1;
    }
    modifiedVertices += 1;
    weightedCoverageSquareMeters += (
      blend / HAMLET_UNDER_CANOPY_MAXIMUM_BLEND
      * terrainTopology.vertexAreaContributions[vertexIndex]!
    );
    observedMinimumAdjoiningCrowns = Math.min(
      observedMinimumAdjoiningCrowns,
      crownFloor.contributingCrowns,
    );
    observedRoadVertexMinimumMeters = Math.min(
      observedRoadVertexMinimumMeters,
      clearance.roadMeters,
    );
    observedSettlementVertexMinimumMeters = Math.min(
      observedSettlementVertexMinimumMeters,
      clearance.settlementMeters,
    );
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumZ = Math.min(minimumZ, z);
    maximumZ = Math.max(maximumZ, z);
  }

  if (modifiedVertices === 0) {
    throw new Error(
      'Mottled dense-crown floor produced no clearance-safe terrain coverage.',
    );
  }
  color.needsUpdate = true;

  const meanStableLuminanceBefore =
    luminanceBeforeSum / modifiedVertices;
  const meanStableLuminanceAfter =
    luminanceAfterSum / modifiedVertices;
  const meanStableLuminanceReductionPercent =
    (1 - meanStableLuminanceAfter / meanStableLuminanceBefore) * 100;
  const meanReductionPercent =
    reductionPercentSum / modifiedVertices;
  const meanAppliedBlend = appliedBlendSum / modifiedVertices;

  return createEvidence({
    treatment: input.treatment,
    forestEdgeLayout: input.forestEdgeLayout,
    vegetationSlots: input.placements.length,
    edgeSlots: edgePlacements.length,
    denseCrownSlots: denseCrownPlacements.length,
    terrainVertices: position.count,
    maximumRadiusMeters,
    geometryBudget,
    interpolationHaloMeters:
      terrainTopology.maximumTriangleEdgeMeters,
    candidateVertices,
    densityQualifiedVertices,
    modifiedVertices,
    weightedCoverageSquareMeters,
    bounds: {
      minX: minimumX,
      maxX: maximumX,
      minZ: minimumZ,
      maxZ: maximumZ,
    },
    observedRoadVertexMinimumMeters,
    observedSettlementVertexMinimumMeters,
    rejectedRoadVertices,
    rejectedSettlementVertices,
    peakCrownDensity,
    observedMinimumAdjoiningCrowns,
    meanStableLuminanceBefore,
    meanStableLuminanceAfter,
    meanStableLuminanceReductionPercent,
    minimumStableLuminanceReductionPercent: minimumReductionPercent,
    maximumStableLuminanceReductionPercent: maximumReductionPercent,
    stableLuminanceReductionStandardDeviationPercent: Math.sqrt(
      Math.max(
        0,
        reductionPercentSquaredSum / modifiedVertices
          - meanReductionPercent * meanReductionPercent,
      ),
    ),
    meanAppliedBlend,
    appliedBlendStandardDeviation: Math.sqrt(
      Math.max(
        0,
        appliedBlendSquaredSum / modifiedVertices
          - meanAppliedBlend * meanAppliedBlend,
      ),
    ),
    minimumAppliedBlend,
    maximumAppliedBlend,
    darkBasinVertices,
    leafLitterVertices,
    lighterChannelVertices,
  });
}

function applyRound56UnderCanopyGroundTreatment(input: {
  treatment: typeof HAMLET_UNDER_CANOPY_GROUND_ROUND_56_TREATMENT;
  forestEdgeLayout: HamletForestEdgeLayout;
  position: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  placements: readonly ForestTreePlacement[];
  edgePlacements: readonly ForestTreePlacement[];
  denseCrownSlots: number;
  geometryBudget: HamletUnderCanopyGroundEvidenceV2['budget']['geometry'];
  terrainTopology: ReturnType<typeof measureTerrainTopology>;
  maximumRadiusMeters: number;
}): HamletUnderCanopyGroundEvidence {
  const requiredRoadVertexMeters =
    HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    + input.terrainTopology.maximumTriangleEdgeMeters;
  const requiredSettlementVertexMeters =
    HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
    + input.terrainTopology.maximumTriangleEdgeMeters;
  let candidateVertices = 0;
  let modifiedVertices = 0;
  let weightedCoverageSquareMeters = 0;
  let rejectedRoadVertices = 0;
  let rejectedSettlementVertices = 0;
  let observedRoadVertexMinimumMeters = Infinity;
  let observedSettlementVertexMinimumMeters = Infinity;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumZ = Infinity;
  let maximumZ = -Infinity;
  let luminanceBeforeSum = 0;
  let luminanceAfterSum = 0;

  for (
    let vertexIndex = 0;
    vertexIndex < input.position.count;
    vertexIndex += 1
  ) {
    const x = input.position.getX(vertexIndex);
    const z = input.position.getZ(vertexIndex);
    let footprintWeight = 0;
    for (const placement of input.edgePlacements) {
      const radius = resolveRound56UnderCanopyRadius(placement);
      const dx = x - placement.x;
      const dz = z - placement.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= radius * radius) continue;
      const innerRadius =
        radius * HAMLET_UNDER_CANOPY_ROUND_56_INNER_RADIUS_RATIO;
      const distance = Math.sqrt(distanceSquared);
      const radialWeight = distance <= innerRadius
        ? 1
        : 1 - smootherStep(innerRadius, radius, distance);
      footprintWeight = Math.max(footprintWeight, radialWeight);
      if (footprintWeight === 1) break;
    }
    if (footprintWeight <= 0) continue;
    candidateVertices += 1;

    const clearance = measureHamletForestBeltClearance(x, z);
    const rejectedForRoad =
      clearance.roadMeters < requiredRoadVertexMeters;
    const rejectedForSettlement =
      clearance.settlementMeters < requiredSettlementVertexMeters;
    if (rejectedForRoad) rejectedRoadVertices += 1;
    if (rejectedForSettlement) rejectedSettlementVertices += 1;
    if (rejectedForRoad || rejectedForSettlement) continue;

    const blend = footprintWeight
      * HAMLET_UNDER_CANOPY_ROUND_56_MAXIMUM_DENSE_BLEND;
    const meadowBefore = input.color.getX(vertexIndex);
    const denseBefore = input.color.getY(vertexIndex);
    const dryBefore = input.color.getZ(vertexIndex);
    const meadowAfter = Math.fround(THREE.MathUtils.lerp(
      meadowBefore,
      HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET.meadow,
      blend,
    ));
    const denseAfter = Math.fround(THREE.MathUtils.lerp(
      denseBefore,
      HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET.dense,
      blend,
    ));
    const dryAfter = Math.fround(THREE.MathUtils.lerp(
      dryBefore,
      HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET.dry,
      blend,
    ));
    if (
      meadowAfter === meadowBefore
      && denseAfter === denseBefore
      && dryAfter === dryBefore
    ) {
      continue;
    }
    input.color.setXYZ(
      vertexIndex,
      meadowAfter,
      denseAfter,
      dryAfter,
    );

    const beforeLuminance = stableBiomeLuminance(
      meadowBefore,
      denseBefore,
      dryBefore,
    );
    const afterLuminance = stableBiomeLuminance(
      meadowAfter,
      denseAfter,
      dryAfter,
    );
    luminanceBeforeSum += beforeLuminance;
    luminanceAfterSum += afterLuminance;
    modifiedVertices += 1;
    weightedCoverageSquareMeters += (
      footprintWeight
      * input.terrainTopology.vertexAreaContributions[vertexIndex]!
    );
    observedRoadVertexMinimumMeters = Math.min(
      observedRoadVertexMinimumMeters,
      clearance.roadMeters,
    );
    observedSettlementVertexMinimumMeters = Math.min(
      observedSettlementVertexMinimumMeters,
      clearance.settlementMeters,
    );
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumZ = Math.min(minimumZ, z);
    maximumZ = Math.max(maximumZ, z);
  }

  if (modifiedVertices === 0) {
    throw new Error(
      'Shadowed under-canopy ground produced no clearance-safe terrain coverage.',
    );
  }
  input.color.needsUpdate = true;

  const meanStableLuminanceBefore =
    luminanceBeforeSum / modifiedVertices;
  const meanStableLuminanceAfter =
    luminanceAfterSum / modifiedVertices;

  return createRound56Evidence(createEvidence({
    treatment: input.treatment,
    forestEdgeLayout: input.forestEdgeLayout,
    vegetationSlots: input.placements.length,
    edgeSlots: input.edgePlacements.length,
    denseCrownSlots: input.denseCrownSlots,
    terrainVertices: input.position.count,
    maximumRadiusMeters: input.maximumRadiusMeters,
    geometryBudget: input.geometryBudget,
    interpolationHaloMeters:
      input.terrainTopology.maximumTriangleEdgeMeters,
    candidateVertices,
    densityQualifiedVertices: candidateVertices,
    modifiedVertices,
    weightedCoverageSquareMeters,
    bounds: {
      minX: minimumX,
      maxX: maximumX,
      minZ: minimumZ,
      maxZ: maximumZ,
    },
    observedRoadVertexMinimumMeters,
    observedSettlementVertexMinimumMeters,
    rejectedRoadVertices,
    rejectedSettlementVertices,
    meanStableLuminanceBefore,
    meanStableLuminanceAfter,
    meanStableLuminanceReductionPercent:
      (1 - meanStableLuminanceAfter / meanStableLuminanceBefore) * 100,
    evidenceProfile: 'round56',
  }));
}

function resolveRound56UnderCanopyRadius(
  placement: ForestTreePlacement,
): number {
  switch (placement.edgeBand?.layer) {
    case 'front-shrub':
      return 2.6 + placement.scale * 4.4;
    case 'middle-sapling':
      return 3.3 + placement.scale * 4.3;
    case 'interior-crown':
      return 3.8 + placement.scale * 4.6;
    default:
      return 0;
  }
}

function resolveDenseCrownFloorRadius(
  placement: ForestTreePlacement,
): number {
  return placement.edgeBand?.layer === 'interior-crown'
    ? 6.3 + placement.scale * 7
    : 0;
}

function measureDenseCrownFloorAt(
  x: number,
  z: number,
  placements: readonly ForestTreePlacement[],
): {
  density: number;
  contributingCrowns: number;
} {
  let density = 0;
  let contributingCrowns = 0;
  for (const placement of placements) {
    const radius = resolveDenseCrownFloorRadius(placement);
    const distance = Math.hypot(
      x - placement.x,
      z - placement.z,
    );
    if (distance >= radius) continue;
    contributingCrowns += 1;
    density += 1 - smootherStep(
      radius * HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO,
      radius,
      distance,
    );
  }
  return { density, contributingCrowns };
}

function sampleHamletFloorMottle(
  x: number,
  z: number,
): {
  strength: number;
  litterMix: number;
  channelAttenuation: number;
} {
  const warpX = (
    sampleLatticeValueNoise(x, z, 46, 19) - 0.5
  ) * 15;
  const warpZ = (
    sampleLatticeValueNoise(x, z, 46, 43) - 0.5
  ) * 15;
  const warpedX = x + warpX;
  const warpedZ = z + warpZ;
  const broadMottle =
    sampleLatticeValueNoise(warpedX, warpedZ, 32, 67);
  const middleMottle =
    sampleLatticeValueNoise(warpedX, warpedZ, 14, 97);
  const resolvedMottle = smootherStep(
    0.16,
    0.84,
    broadMottle * 0.68 + middleMottle * 0.32,
  );

  const channelField =
    sampleLatticeValueNoise(warpedX + 11, warpedZ - 7, 24, 131);
  const channelProximity = 1 - smootherStep(
    0.035,
    0.15,
    Math.abs(channelField - 0.5),
  );
  const channelAttenuation = 1 - channelProximity * 0.62;
  const strength = (0.58 + resolvedMottle * 0.42)
    * channelAttenuation;

  const litterField =
    sampleLatticeValueNoise(warpedX - 17, warpedZ + 23, 30, 173) * 0.7
    + sampleLatticeValueNoise(warpedX + 5, warpedZ - 3, 13, 211) * 0.3;
  const litterMix = smootherStep(0.3, 0.74, litterField);
  return { strength, litterMix, channelAttenuation };
}

function sampleLatticeValueNoise(
  x: number,
  z: number,
  scale: number,
  salt: number,
): number {
  const scaledX = x / scale;
  const scaledZ = z / scale;
  const x0 = Math.floor(scaledX);
  const z0 = Math.floor(scaledZ);
  const xBlend = smootherStep(0, 1, scaledX - x0);
  const zBlend = smootherStep(0, 1, scaledZ - z0);
  const north = THREE.MathUtils.lerp(
    hashLatticePoint(x0, z0, salt),
    hashLatticePoint(x0 + 1, z0, salt),
    xBlend,
  );
  const south = THREE.MathUtils.lerp(
    hashLatticePoint(x0, z0 + 1, salt),
    hashLatticePoint(x0 + 1, z0 + 1, salt),
    xBlend,
  );
  return THREE.MathUtils.lerp(north, south, zBlend);
}

function hashLatticePoint(
  x: number,
  z: number,
  salt: number,
): number {
  let hash = Math.imul(x, 374_761_393)
    + Math.imul(z, 668_265_263)
    + Math.imul(salt, 1_442_695_047);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_295;
}

function resolveMottledFloorTarget(
  litterMix: number,
  beforeLuminance: number,
): {
  meadow: number;
  dense: number;
  dry: number;
  effectiveLitterMix: number;
} {
  const darkLuminance = stableBiomeLuminance(
    HAMLET_UNDER_CANOPY_DARK_TARGET.meadow,
    HAMLET_UNDER_CANOPY_DARK_TARGET.dense,
    HAMLET_UNDER_CANOPY_DARK_TARGET.dry,
  );
  const litterLuminance = stableBiomeLuminance(
    HAMLET_UNDER_CANOPY_LITTER_TARGET.meadow,
    HAMLET_UNDER_CANOPY_LITTER_TARGET.dense,
    HAMLET_UNDER_CANOPY_LITTER_TARGET.dry,
  );
  const maximumTargetLuminance = beforeLuminance
    * HAMLET_UNDER_CANOPY_TARGET_LUMINANCE_RATIO;
  const maximumLitterMix = THREE.MathUtils.clamp(
    (maximumTargetLuminance - darkLuminance)
      / (litterLuminance - darkLuminance),
    0,
    1,
  );
  const effectiveLitterMix = Math.min(litterMix, maximumLitterMix);
  return {
    meadow: THREE.MathUtils.lerp(
      HAMLET_UNDER_CANOPY_DARK_TARGET.meadow,
      HAMLET_UNDER_CANOPY_LITTER_TARGET.meadow,
      effectiveLitterMix,
    ),
    dense: THREE.MathUtils.lerp(
      HAMLET_UNDER_CANOPY_DARK_TARGET.dense,
      HAMLET_UNDER_CANOPY_LITTER_TARGET.dense,
      effectiveLitterMix,
    ),
    dry: THREE.MathUtils.lerp(
      HAMLET_UNDER_CANOPY_DARK_TARGET.dry,
      HAMLET_UNDER_CANOPY_LITTER_TARGET.dry,
      effectiveLitterMix,
    ),
    effectiveLitterMix,
  };
}

function stableBiomeLuminance(
  meadowWeight: number,
  denseWeight: number,
  dryWeight: number,
): number {
  return meadowWeight * STABLE_BIOME_LUMINANCE[0]!
    + denseWeight * STABLE_BIOME_LUMINANCE[1]!
    + dryWeight * STABLE_BIOME_LUMINANCE[2]!;
}

function smootherStep(edge0: number, edge1: number, value: number): number {
  const normalized = THREE.MathUtils.clamp(
    (value - edge0) / (edge1 - edge0),
    0,
    1,
  );
  return normalized * normalized * normalized
    * (normalized * (normalized * 6 - 15) + 10);
}

function createEvidence(input: {
  treatment: HamletUnderCanopyGroundTreatment;
  forestEdgeLayout: HamletForestEdgeLayout;
  vegetationSlots: number;
  edgeSlots: number;
  denseCrownSlots: number;
  terrainVertices: number;
  maximumRadiusMeters: number;
  geometryBudget: HamletUnderCanopyGroundEvidenceV2['budget']['geometry'];
  interpolationHaloMeters?: number;
  candidateVertices?: number;
  densityQualifiedVertices?: number;
  modifiedVertices?: number;
  weightedCoverageSquareMeters?: number;
  bounds?: HamletUnderCanopyBounds;
  peakCrownDensity?: number;
  observedMinimumAdjoiningCrowns?: number;
  observedRoadVertexMinimumMeters?: number;
  observedSettlementVertexMinimumMeters?: number;
  rejectedRoadVertices?: number;
  rejectedSettlementVertices?: number;
  meanStableLuminanceBefore?: number;
  meanStableLuminanceAfter?: number;
  meanStableLuminanceReductionPercent?: number;
  minimumStableLuminanceReductionPercent?: number;
  maximumStableLuminanceReductionPercent?: number;
  stableLuminanceReductionStandardDeviationPercent?: number;
  meanAppliedBlend?: number;
  appliedBlendStandardDeviation?: number;
  minimumAppliedBlend?: number;
  maximumAppliedBlend?: number;
  darkBasinVertices?: number;
  leafLitterVertices?: number;
  lighterChannelVertices?: number;
  evidenceProfile?: 'round56';
}): HamletUnderCanopyGroundEvidenceV2 {
  const modifiedVertices = input.modifiedVertices ?? 0;
  const isControl =
    input.treatment === HAMLET_UNDER_CANOPY_GROUND_CONTROL;
  const isRound56 = input.evidenceProfile === 'round56';
  const observedRoadVertexMinimumMeters =
    input.observedRoadVertexMinimumMeters ?? null;
  const observedSettlementVertexMinimumMeters =
    input.observedSettlementVertexMinimumMeters ?? null;
  const interpolationHaloMeters = input.interpolationHaloMeters ?? 0;
  return {
    schemaVersion: 2,
    query: {
      parameter: HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER,
      value: input.treatment,
      defaultWhenAbsent: HAMLET_UNDER_CANOPY_GROUND_CONTROL,
    },
    mode: isControl
      ? 'round-55-accepted-terrain-unchanged'
      : isRound56
        ? 'round-56-startup-only-existing-biome-weight-rebalance'
        : 'startup-only-existing-biome-weight-mottle',
    source: {
      forestEdgeLayout: input.forestEdgeLayout,
      vegetationSlots: input.vegetationSlots,
      edgeSlots: input.edgeSlots,
      denseCrownSlots: input.denseCrownSlots,
      footprintBasis: isRound56
        ? 'accepted-edge-slot-layer-scale-radial-union'
        : 'accepted-interior-crown-overlap-density-clearance-and-mottle',
    },
    footprint: {
      terrainVertices: input.terrainVertices,
      candidateVertices: input.candidateVertices ?? 0,
      densityQualifiedVertices:
        input.densityQualifiedVertices ?? 0,
      modifiedVertices,
      modifiedPercent: modifiedVertices / input.terrainVertices * 100,
      weightedCoverageSquareMeters:
        input.weightedCoverageSquareMeters ?? 0,
      bounds: input.bounds ?? null,
      maximumRadiusMeters: input.maximumRadiusMeters,
      innerRadiusRatio: isRound56
        ? HAMLET_UNDER_CANOPY_ROUND_56_INNER_RADIUS_RATIO
        : HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO,
      densityStart: isRound56
        ? 0
        : HAMLET_UNDER_CANOPY_DENSITY_START,
      densityFull: isRound56
        ? 1
        : HAMLET_UNDER_CANOPY_DENSITY_FULL,
      peakCrownDensity: input.peakCrownDensity ?? 0,
      requiredMinimumAdjoiningCrowns: isRound56 ? 1 : 2,
      observedMinimumAdjoiningCrowns:
        input.observedMinimumAdjoiningCrowns ?? null,
      coverageMethod:
        isControl
          ? 'not-applied'
          : isRound56
            ? 'integrated-linear-vertex-mask-over-xz-triangles'
            : 'integrated-linear-mottled-overlap-mask-over-xz-triangles',
      interpolationHaloMeters,
      clearance: {
        requiredRoadVertexMeters:
          HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
          + interpolationHaloMeters,
        requiredSettlementVertexMeters:
          HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
          + interpolationHaloMeters,
        featherMeters: isRound56
          ? 0
          : HAMLET_UNDER_CANOPY_CLEARANCE_FEATHER_METERS,
        observedRoadVertexMinimumMeters,
        observedSettlementVertexMinimumMeters,
        guaranteedRoadFragmentMinimumMeters:
          observedRoadVertexMinimumMeters === null
            ? null
            : observedRoadVertexMinimumMeters
              - interpolationHaloMeters,
        guaranteedSettlementFragmentMinimumMeters:
          observedSettlementVertexMinimumMeters === null
            ? null
            : observedSettlementVertexMinimumMeters
              - interpolationHaloMeters,
        rejectedRoadVertices: input.rejectedRoadVertices ?? 0,
        rejectedSettlementVertices:
          input.rejectedSettlementVertices ?? 0,
        roadContaminationVertices: 0,
        parcelContaminationVertices: 0,
        roadContaminationTriangles: 0,
        parcelContaminationTriangles: 0,
      },
    },
    tone: {
      maximumBlend: isRound56
        ? HAMLET_UNDER_CANOPY_ROUND_56_MAXIMUM_DENSE_BLEND
        : HAMLET_UNDER_CANOPY_MAXIMUM_BLEND,
      targetLuminanceRatio: isRound56
        ? 1
        : HAMLET_UNDER_CANOPY_TARGET_LUMINANCE_RATIO,
      darkTargetWeights: isRound56
        ? { ...HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET }
        : { ...HAMLET_UNDER_CANOPY_DARK_TARGET },
      litterTargetWeights: isRound56
        ? { ...HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET }
        : { ...HAMLET_UNDER_CANOPY_LITTER_TARGET },
      meanStableLuminanceBefore:
        input.meanStableLuminanceBefore ?? null,
      meanStableLuminanceAfter:
        input.meanStableLuminanceAfter ?? null,
      meanStableLuminanceReductionPercent:
        input.meanStableLuminanceReductionPercent ?? 0,
      minimumStableLuminanceReductionPercent:
        input.minimumStableLuminanceReductionPercent ?? 0,
      maximumStableLuminanceReductionPercent:
        input.maximumStableLuminanceReductionPercent ?? 0,
      stableLuminanceReductionStandardDeviationPercent:
        input.stableLuminanceReductionStandardDeviationPercent ?? 0,
      mottling: {
        basis: isRound56
          ? 'none-round-56-radial-union'
          : isControl
            ? 'not-applied'
            : 'domain-warped-lattice-value-noise-with-irregular-light-channels',
        meanAppliedBlend: input.meanAppliedBlend ?? 0,
        appliedBlendStandardDeviation:
          input.appliedBlendStandardDeviation ?? 0,
        minimumAppliedBlend: input.minimumAppliedBlend ?? 0,
        maximumAppliedBlend: input.maximumAppliedBlend ?? 0,
        darkBasinVertices: input.darkBasinVertices ?? 0,
        leafLitterVertices: input.leafLitterVertices ?? 0,
        lighterChannelVertices: input.lighterChannelVertices ?? 0,
      },
    },
    budget: {
      forestSlotDelta: 0,
      forestDrawDelta: 0,
      terrainDrawDelta: 0,
      textureAssetDelta: 0,
      meshDelta: 0,
      materialDelta: 0,
      geometryVertexDelta: 0,
      geometryIndexDelta: 0,
      vertexAttributeDelta: 0,
      colorBufferByteDelta: 0,
      shaderDelta: 0,
      perFrameWorkDelta: 0,
      startupColorWrites: modifiedVertices,
      geometry: { ...input.geometryBudget },
    },
    seedThreeAudit: {
      classification: 'hamlet-specific-terrain-weighting',
      reusableSeedThreeBehaviorAdded: false,
      gitlinkChangeRequired: false,
      reason:
        'footprint-and-clearance-depend-on-hamlet-road-parcel-and-edge-composition',
    },
  };
}

function createRound56Evidence(
  evidence: HamletUnderCanopyGroundEvidenceV2,
) {
  return {
    schemaVersion: 1,
    query: evidence.query,
    mode: 'startup-only-existing-biome-weight-rebalance',
    source: {
      forestEdgeLayout: evidence.source.forestEdgeLayout,
      vegetationSlots: evidence.source.vegetationSlots,
      edgeSlots: evidence.source.edgeSlots,
      footprintBasis: 'accepted-edge-slot-layer-scale-radial-union',
    },
    footprint: {
      terrainVertices: evidence.footprint.terrainVertices,
      candidateVertices: evidence.footprint.candidateVertices,
      modifiedVertices: evidence.footprint.modifiedVertices,
      modifiedPercent: evidence.footprint.modifiedPercent,
      weightedCoverageSquareMeters:
        evidence.footprint.weightedCoverageSquareMeters,
      bounds: evidence.footprint.bounds,
      maximumRadiusMeters: evidence.footprint.maximumRadiusMeters,
      innerRadiusRatio:
        HAMLET_UNDER_CANOPY_ROUND_56_INNER_RADIUS_RATIO,
      coverageMethod:
        'integrated-linear-vertex-mask-over-xz-triangles',
      interpolationHaloMeters:
        evidence.footprint.interpolationHaloMeters,
      clearance: {
        requiredRoadVertexMeters:
          evidence.footprint.clearance.requiredRoadVertexMeters,
        requiredSettlementVertexMeters:
          evidence.footprint.clearance.requiredSettlementVertexMeters,
        observedRoadVertexMinimumMeters:
          evidence.footprint.clearance.observedRoadVertexMinimumMeters,
        observedSettlementVertexMinimumMeters:
          evidence.footprint.clearance.observedSettlementVertexMinimumMeters,
        guaranteedRoadFragmentMinimumMeters:
          evidence.footprint.clearance.guaranteedRoadFragmentMinimumMeters,
        guaranteedSettlementFragmentMinimumMeters:
          evidence.footprint.clearance
            .guaranteedSettlementFragmentMinimumMeters,
        rejectedRoadVertices:
          evidence.footprint.clearance.rejectedRoadVertices,
        rejectedSettlementVertices:
          evidence.footprint.clearance.rejectedSettlementVertices,
        roadContaminationVertices: 0,
        parcelContaminationVertices: 0,
      },
    },
    tone: {
      maximumDenseBlend:
        HAMLET_UNDER_CANOPY_ROUND_56_MAXIMUM_DENSE_BLEND,
      targetWeights: HAMLET_UNDER_CANOPY_ROUND_56_DENSE_TARGET,
      meanStableLuminanceBefore:
        evidence.tone.meanStableLuminanceBefore,
      meanStableLuminanceAfter:
        evidence.tone.meanStableLuminanceAfter,
      meanStableLuminanceReductionPercent:
        evidence.tone.meanStableLuminanceReductionPercent,
    },
    budget: {
      forestSlotDelta: 0,
      forestDrawDelta: 0,
      terrainDrawDelta: 0,
      textureAssetDelta: 0,
      meshDelta: 0,
      materialDelta: 0,
      geometryVertexDelta: 0,
      geometryIndexDelta: 0,
      vertexAttributeDelta: 0,
      colorBufferByteDelta: 0,
      perFrameWorkDelta: 0,
      startupColorWrites: evidence.budget.startupColorWrites,
      geometry: { ...evidence.budget.geometry },
    },
    seedThreeAudit: evidence.seedThreeAudit,
  } as const;
}

function measureTerrainTopology(
  geometry: THREE.BufferGeometry,
  position: THREE.BufferAttribute,
): {
  maximumTriangleEdgeMeters: number;
  vertexAreaContributions: Float64Array;
} {
  const vertexAreaContributions = new Float64Array(position.count);
  let maximumTriangleEdgeMeters = 0;
  let triangleCount = 0;
  const visitTriangle = (
    indexA: number,
    indexB: number,
    indexC: number,
  ) => {
    if (
      indexA < 0
      || indexB < 0
      || indexC < 0
      || indexA >= position.count
      || indexB >= position.count
      || indexC >= position.count
    ) {
      throw new Error(
        'Hamlet terrain topology contains an out-of-range triangle index.',
      );
    }
    const ax = position.getX(indexA);
    const az = position.getZ(indexA);
    const bx = position.getX(indexB);
    const bz = position.getZ(indexB);
    const cx = position.getX(indexC);
    const cz = position.getZ(indexC);
    maximumTriangleEdgeMeters = Math.max(
      maximumTriangleEdgeMeters,
      Math.hypot(bx - ax, bz - az),
      Math.hypot(cx - bx, cz - bz),
      Math.hypot(ax - cx, az - cz),
    );
    const triangleArea = Math.abs(
      (bx - ax) * (cz - az) - (bz - az) * (cx - ax),
    ) * 0.5;
    const vertexArea = triangleArea / 3;
    vertexAreaContributions[indexA] += vertexArea;
    vertexAreaContributions[indexB] += vertexArea;
    vertexAreaContributions[indexC] += vertexArea;
    triangleCount += 1;
  };

  if (geometry.index) {
    if (geometry.index.count % 3 !== 0) {
      throw new Error(
        'Hamlet terrain index count must describe complete triangles.',
      );
    }
    for (
      let indexOffset = 0;
      indexOffset < geometry.index.count;
      indexOffset += 3
    ) {
      visitTriangle(
        geometry.index.getX(indexOffset),
        geometry.index.getX(indexOffset + 1),
        geometry.index.getX(indexOffset + 2),
      );
    }
  } else {
    if (position.count % 3 !== 0) {
      throw new Error(
        'Non-indexed Hamlet terrain must describe complete triangles.',
      );
    }
    for (
      let vertexOffset = 0;
      vertexOffset < position.count;
      vertexOffset += 3
    ) {
      visitTriangle(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
      );
    }
  }
  if (
    triangleCount === 0
    || !Number.isFinite(maximumTriangleEdgeMeters)
    || maximumTriangleEdgeMeters <= 0
  ) {
    throw new Error(
      'Hamlet under-canopy treatment requires non-degenerate XZ terrain triangles.',
    );
  }
  return {
    maximumTriangleEdgeMeters,
    vertexAreaContributions,
  };
}
