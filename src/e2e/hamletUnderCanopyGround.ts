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
export const HAMLET_UNDER_CANOPY_GROUND_TREATMENT =
  'shadowed-under-canopy' as const;

export const HAMLET_UNDER_CANOPY_MAXIMUM_DENSE_BLEND = 0.3;
export const HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO = 0.56;
export const HAMLET_UNDER_CANOPY_DENSE_TARGET = Object.freeze({
  meadow: 0.08,
  dense: 0.84,
  dry: 0.08,
});

export type HamletUnderCanopyGroundTreatment =
  | typeof HAMLET_UNDER_CANOPY_GROUND_CONTROL
  | typeof HAMLET_UNDER_CANOPY_GROUND_TREATMENT;

type HamletUnderCanopyBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type HamletUnderCanopyGroundEvidence = {
  schemaVersion: 1;
  query: {
    parameter: typeof HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER;
    value: HamletUnderCanopyGroundTreatment;
    defaultWhenAbsent: typeof HAMLET_UNDER_CANOPY_GROUND_CONTROL;
  };
  mode:
    | 'round-55-accepted-terrain-unchanged'
    | 'startup-only-existing-biome-weight-rebalance';
  source: {
    forestEdgeLayout: HamletForestEdgeLayout;
    vegetationSlots: number;
    edgeSlots: number;
    footprintBasis:
      'accepted-edge-slot-layer-scale-radial-union';
  };
  footprint: {
    terrainVertices: number;
    candidateVertices: number;
    modifiedVertices: number;
    modifiedPercent: number;
    weightedCoverageSquareMeters: number;
    bounds: HamletUnderCanopyBounds | null;
    maximumRadiusMeters: number;
    innerRadiusRatio: typeof HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO;
    coverageMethod:
      | 'not-applied'
      | 'integrated-linear-vertex-mask-over-xz-triangles';
    interpolationHaloMeters: number;
    clearance: {
      requiredRoadVertexMeters: number;
      requiredSettlementVertexMeters: number;
      observedRoadVertexMinimumMeters: number | null;
      observedSettlementVertexMinimumMeters: number | null;
      guaranteedRoadFragmentMinimumMeters: number | null;
      guaranteedSettlementFragmentMinimumMeters: number | null;
      rejectedRoadVertices: number;
      rejectedSettlementVertices: number;
      roadContaminationVertices: 0;
      parcelContaminationVertices: 0;
    };
  };
  tone: {
    maximumDenseBlend: typeof HAMLET_UNDER_CANOPY_MAXIMUM_DENSE_BLEND;
    targetWeights: typeof HAMLET_UNDER_CANOPY_DENSE_TARGET;
    meanStableLuminanceBefore: number | null;
    meanStableLuminanceAfter: number | null;
    meanStableLuminanceReductionPercent: number;
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
  throw new Error(
    `${HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER} must be `
    + `${HAMLET_UNDER_CANOPY_GROUND_CONTROL} or `
    + `${HAMLET_UNDER_CANOPY_GROUND_TREATMENT}.`,
  );
}

export function assertHamletUnderCanopyGroundDependencies(
  treatment: HamletUnderCanopyGroundTreatment,
  forestEdgeLayout: HamletForestEdgeLayout,
): void {
  if (
    treatment === HAMLET_UNDER_CANOPY_GROUND_TREATMENT
    && forestEdgeLayout !== HAMLET_FOREST_EDGE_LAYOUT_TAPERED
  ) {
    throw new Error(
      `${HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER}=`
      + `${HAMLET_UNDER_CANOPY_GROUND_TREATMENT} requires `
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
  const maximumRadiusMeters = edgePlacements.reduce(
    (maximum, placement) => Math.max(
      maximum,
      resolveHamletUnderCanopyRadius(placement),
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
      terrainVertices: position.count,
      maximumRadiusMeters,
      geometryBudget,
    });
  }
  if (
    input.placements.length !== 1651
    || edgePlacements.length !== 256
  ) {
    throw new Error(
      'Shadowed under-canopy ground requires the accepted 1,651-slot / 256-edge-slot layout.',
    );
  }

  const terrainTopology = measureTerrainTopology(
    input.geometry,
    position,
  );
  const requiredRoadVertexMeters =
    HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    + terrainTopology.maximumTriangleEdgeMeters;
  const requiredSettlementVertexMeters =
    HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
    + terrainTopology.maximumTriangleEdgeMeters;
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

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const x = position.getX(vertexIndex);
    const z = position.getZ(vertexIndex);
    let footprintWeight = 0;
    for (const placement of edgePlacements) {
      const radius = resolveHamletUnderCanopyRadius(placement);
      const dx = x - placement.x;
      const dz = z - placement.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= radius * radius) continue;
      const innerRadius = radius * HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO;
      const distance = Math.sqrt(distanceSquared);
      const radialWeight = distance <= innerRadius
        ? 1
        : 1 - smootherStep(
            innerRadius,
            radius,
            distance,
          );
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

    const blend =
      footprintWeight * HAMLET_UNDER_CANOPY_MAXIMUM_DENSE_BLEND;
    const meadowBefore = color.getX(vertexIndex);
    const denseBefore = color.getY(vertexIndex);
    const dryBefore = color.getZ(vertexIndex);
    const meadowAfter = Math.fround(THREE.MathUtils.lerp(
      meadowBefore,
      HAMLET_UNDER_CANOPY_DENSE_TARGET.meadow,
      blend,
    ));
    const denseAfter = Math.fround(THREE.MathUtils.lerp(
      denseBefore,
      HAMLET_UNDER_CANOPY_DENSE_TARGET.dense,
      blend,
    ));
    const dryAfter = Math.fround(THREE.MathUtils.lerp(
      dryBefore,
      HAMLET_UNDER_CANOPY_DENSE_TARGET.dry,
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
      * terrainTopology.vertexAreaContributions[vertexIndex]!
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
  color.needsUpdate = true;

  const meanStableLuminanceBefore =
    luminanceBeforeSum / modifiedVertices;
  const meanStableLuminanceAfter =
    luminanceAfterSum / modifiedVertices;
  const meanStableLuminanceReductionPercent =
    (1 - meanStableLuminanceAfter / meanStableLuminanceBefore) * 100;

  return createEvidence({
    treatment: input.treatment,
    forestEdgeLayout: input.forestEdgeLayout,
    vegetationSlots: input.placements.length,
    edgeSlots: edgePlacements.length,
    terrainVertices: position.count,
    maximumRadiusMeters,
    geometryBudget,
    interpolationHaloMeters:
      terrainTopology.maximumTriangleEdgeMeters,
    candidateVertices,
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
    meanStableLuminanceReductionPercent,
  });
}

function resolveHamletUnderCanopyRadius(
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
  terrainVertices: number;
  maximumRadiusMeters: number;
  geometryBudget: HamletUnderCanopyGroundEvidence['budget']['geometry'];
  interpolationHaloMeters?: number;
  candidateVertices?: number;
  modifiedVertices?: number;
  weightedCoverageSquareMeters?: number;
  bounds?: HamletUnderCanopyBounds;
  observedRoadVertexMinimumMeters?: number;
  observedSettlementVertexMinimumMeters?: number;
  rejectedRoadVertices?: number;
  rejectedSettlementVertices?: number;
  meanStableLuminanceBefore?: number;
  meanStableLuminanceAfter?: number;
  meanStableLuminanceReductionPercent?: number;
}): HamletUnderCanopyGroundEvidence {
  const modifiedVertices = input.modifiedVertices ?? 0;
  const observedRoadVertexMinimumMeters =
    input.observedRoadVertexMinimumMeters ?? null;
  const observedSettlementVertexMinimumMeters =
    input.observedSettlementVertexMinimumMeters ?? null;
  const interpolationHaloMeters = input.interpolationHaloMeters ?? 0;
  return {
    schemaVersion: 1,
    query: {
      parameter: HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER,
      value: input.treatment,
      defaultWhenAbsent: HAMLET_UNDER_CANOPY_GROUND_CONTROL,
    },
    mode: input.treatment === HAMLET_UNDER_CANOPY_GROUND_CONTROL
      ? 'round-55-accepted-terrain-unchanged'
      : 'startup-only-existing-biome-weight-rebalance',
    source: {
      forestEdgeLayout: input.forestEdgeLayout,
      vegetationSlots: input.vegetationSlots,
      edgeSlots: input.edgeSlots,
      footprintBasis: 'accepted-edge-slot-layer-scale-radial-union',
    },
    footprint: {
      terrainVertices: input.terrainVertices,
      candidateVertices: input.candidateVertices ?? 0,
      modifiedVertices,
      modifiedPercent: modifiedVertices / input.terrainVertices * 100,
      weightedCoverageSquareMeters:
        input.weightedCoverageSquareMeters ?? 0,
      bounds: input.bounds ?? null,
      maximumRadiusMeters: input.maximumRadiusMeters,
      innerRadiusRatio: HAMLET_UNDER_CANOPY_INNER_RADIUS_RATIO,
      coverageMethod:
        input.treatment === HAMLET_UNDER_CANOPY_GROUND_CONTROL
          ? 'not-applied'
          : 'integrated-linear-vertex-mask-over-xz-triangles',
      interpolationHaloMeters,
      clearance: {
        requiredRoadVertexMeters:
          HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
          + interpolationHaloMeters,
        requiredSettlementVertexMeters:
          HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
          + interpolationHaloMeters,
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
      },
    },
    tone: {
      maximumDenseBlend: HAMLET_UNDER_CANOPY_MAXIMUM_DENSE_BLEND,
      targetWeights: HAMLET_UNDER_CANOPY_DENSE_TARGET,
      meanStableLuminanceBefore:
        input.meanStableLuminanceBefore ?? null,
      meanStableLuminanceAfter:
        input.meanStableLuminanceAfter ?? null,
      meanStableLuminanceReductionPercent:
        input.meanStableLuminanceReductionPercent ?? 0,
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
