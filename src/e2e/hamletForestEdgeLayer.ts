import {
  createForestEdgeBandReallocation,
  type ForestEdgeBandAssignment,
  type ForestEdgeBandSample,
} from '@seedthree/core/forest-edge-band.js';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import { mulberry32 } from '../utils/random.ts';
import {
  HAMLET_FIELD_SPECS,
  HAMLET_FIXTURE_SEED,
  HAMLET_LANDMARKS,
  HAMLET_ROAD_ARMS,
  HAMLET_ZONE_SPECS,
  type HamletZoneSpec,
} from './hamletFixtureConfig.ts';

export const HAMLET_FOREST_EDGE_LAYOUT_LEGACY =
  'legacy-perimeter' as const;
export const HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED =
  'clustered-sapling-shrub-256' as const;
export const HAMLET_FOREST_EDGE_LAYOUT_TAPERED =
  'tapered-shrub-sapling-belt-256' as const;
export const HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING =
  'interlocking-midstory-thicket-256' as const;
export const HAMLET_FOREST_EDGE_REALLOCATION_COUNT = 256;
export const HAMLET_FOREST_EDGE_CLUSTER_SIZE = 8;
export const HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS = 12;
export const HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS = 20;
export const HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT = 64;
export const HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT = 80;
export const HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT = 112;
export const HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE = 4;
export const HAMLET_FOREST_BELT_MIN_DISTANCE_METERS = 2.75;
export const HAMLET_FOREST_BELT_MAX_DISTANCE_METERS = 20;
export const HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS = 10;
export const HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS = 8;
export const HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT = 96;
export const HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT = 96;
export const HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT = 64;
export const HAMLET_FOREST_THICKET_CLUSTER_COUNT = 32;
export const HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE = 8;
export const HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS = 3;
export const HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS = 18.5;
export const HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT =
  '4182accfc1fb7a66815e963b5355ca4996418cf3' as const;

export type HamletForestEdgeLayout =
  | typeof HAMLET_FOREST_EDGE_LAYOUT_LEGACY
  | typeof HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED
  | typeof HAMLET_FOREST_EDGE_LAYOUT_TAPERED
  | typeof HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING;

export type HamletForestEdgeLayerEvidence = {
  layout: HamletForestEdgeLayout;
  seedThreeCommit: typeof HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT;
  sourceSlots: 1651;
  reallocatedSlots: number;
  retainedSlots: number;
  eligibleBroadleafDonors: number;
  clusterCount: number;
  maximumClusterSize: number;
  bandMeters: {
    minimum: number;
    maximum: number;
    observedMinimum: number | null;
    observedMaximum: number | null;
  };
  variants: {
    broadleafSaplings: number;
    broadleafShrubCards: number;
    broadleafMixedCrowns: number;
  };
  clearance?: {
    roadMeters: typeof HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS;
    settlementMeters:
      typeof HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS;
    observedRoadMinimum: number;
    observedSettlementMinimum: number;
  };
  budget: {
    treeSlotDelta: 0;
    speciesPresetDelta: 0;
    instanceCapacityDelta: 0;
    textureAssetDelta: 0;
    forestDrawBudget: 20;
    forestDrawDelta: 0;
    trianglePolicy:
      'all-reallocated-slots-capped-to-existing-overview-card-detail';
    maximumTriangleBudgetDelta: 'non-positive';
  };
};

const BROADLEAF_SPECIES = new Set<ForestTreePlacement['species']>([
  'beech',
  'hornbeam',
  'sycamoreMaple',
  'sessileOak',
]);

type ForestBeltVariant =
  | 'broadleaf-shrub-card'
  | 'broadleaf-sapling'
  | 'broadleaf-mixed-crown';

type ForestBeltLayer =
  | 'front-shrub'
  | 'middle-sapling'
  | 'interior-crown';

type TaperedForestBeltLayerSpec = {
  layer: ForestBeltLayer;
  variant: ForestBeltVariant;
  count: number;
  minimumDistance: number;
  maximumDistance: number;
  maximumClusterSize: number;
  tangentSpread: number;
  depthSpread: number;
  scaleMinimum: number;
  scaleMaximum: number;
  scaleSalt: number;
  form: ForestTreePlacement['form'];
};

const TAPERED_FOREST_BELT_LAYERS:
readonly TaperedForestBeltLayerSpec[] = [
  {
    layer: 'front-shrub',
    variant: 'broadleaf-shrub-card',
    count: HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
    minimumDistance: HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
    maximumDistance: 6.25,
    maximumClusterSize: 1,
    tangentSpread: 2.2,
    depthSpread: 0.75,
    scaleMinimum: 0.18,
    scaleMaximum: 0.28,
    scaleSalt: 53,
    form: 'midstory',
  },
  {
    layer: 'middle-sapling',
    variant: 'broadleaf-sapling',
    count: HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
    minimumDistance: 7,
    maximumDistance: 12.25,
    maximumClusterSize: 2,
    tangentSpread: 3.4,
    depthSpread: 1.35,
    scaleMinimum: 0.36,
    scaleMaximum: 0.54,
    scaleSalt: 71,
    form: 'young',
  },
  {
    layer: 'interior-crown',
    variant: 'broadleaf-mixed-crown',
    count: HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
    minimumDistance: 13,
    maximumDistance: HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
    maximumClusterSize: HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE,
    tangentSpread: 4.5,
    depthSpread: 1.9,
    scaleMinimum: 0.62,
    scaleMaximum: 0.86,
    scaleSalt: 89,
    form: 'broad',
  },
] as const;

type InterlockingForestThicketLayerSpec = Pick<
  TaperedForestBeltLayerSpec,
  | 'layer'
  | 'variant'
  | 'scaleMinimum'
  | 'scaleMaximum'
  | 'scaleSalt'
  | 'form'
> & {
  depthOffset: number;
};

const INTERLOCKING_FOREST_THICKET_LAYERS:
readonly InterlockingForestThicketLayerSpec[] = [
  {
    layer: 'front-shrub',
    variant: 'broadleaf-shrub-card',
    scaleMinimum: 0.32,
    scaleMaximum: 0.46,
    scaleSalt: 107,
    form: 'midstory',
    depthOffset: -2.5,
  },
  {
    layer: 'middle-sapling',
    variant: 'broadleaf-sapling',
    scaleMinimum: 0.5,
    scaleMaximum: 0.72,
    scaleSalt: 109,
    form: 'young',
    depthOffset: 0,
  },
  {
    layer: 'interior-crown',
    variant: 'broadleaf-mixed-crown',
    scaleMinimum: 0.76,
    scaleMaximum: 1.02,
    scaleSalt: 113,
    form: 'broad',
    depthOffset: 2.5,
  },
] as const;

const INTERLOCKING_FOREST_THICKET_MEMBER_LAYERS = [
  0,
  1,
  2,
  0,
  1,
  2,
  0,
  1,
] as const;

type HamletPoint2 = {
  x: number;
  z: number;
};

const HAMLET_LANDMARK_CLEARANCE_RADIUS_METERS = 6;
const HAMLET_SETTLEMENT_POLYGONS: readonly (
  readonly HamletPoint2[]
)[] = [
  ...HAMLET_ZONE_SPECS.map(createHamletZonePolygon),
  ...HAMLET_FIELD_SPECS.map((field) => (
    field.corners.map(([x, z]) => ({ x, z }))
  )),
];

export function resolveHamletForestEdgeLayout(
  value: string | null,
): HamletForestEdgeLayout {
  if (value === HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING) {
    return HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING;
  }
  if (value === null || value === HAMLET_FOREST_EDGE_LAYOUT_TAPERED) {
    return HAMLET_FOREST_EDGE_LAYOUT_TAPERED;
  }
  if (value === HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED) {
    return HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED;
  }
  if (value === HAMLET_FOREST_EDGE_LAYOUT_LEGACY) {
    return HAMLET_FOREST_EDGE_LAYOUT_LEGACY;
  }
  throw new Error(
    `forestEdgeLayout must be ${HAMLET_FOREST_EDGE_LAYOUT_LEGACY}, `
    + `${HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED}, `
    + `${HAMLET_FOREST_EDGE_LAYOUT_TAPERED}, or `
    + `${HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING}.`,
  );
}

export function createHamletForestPlacements(
  layout: HamletForestEdgeLayout =
    HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
): {
  placements: ForestTreePlacement[];
  edgeLayer: HamletForestEdgeLayerEvidence;
} {
  const baseline = createLegacyHamletForestPlacements();
  if (baseline.length !== 1651) {
    throw new Error(
      `Hamlet perimeter forest drifted from 1,651 slots to ${baseline.length}.`,
    );
  }
  const distantBroadleafSourceIndices = baseline
    .map((placement, index) => (
      BROADLEAF_SPECIES.has(placement.species)
      && isDistantPerimeterDonor(placement)
        ? index
        : -1
    ))
    .filter((index) => index >= 0);
  if (
    distantBroadleafSourceIndices.length
    < HAMLET_FOREST_EDGE_REALLOCATION_COUNT
  ) {
    throw new Error(
      'Hamlet edge layer no longer has 256 distant broadleaf donor slots.',
    );
  }

  if (layout === HAMLET_FOREST_EDGE_LAYOUT_LEGACY) {
    return {
      placements: baseline,
      edgeLayer: createEdgeEvidence({
        layout,
        eligibleBroadleafDonors: distantBroadleafSourceIndices.length,
        reallocatedSlots: 0,
        clusterCount: 0,
        maximumClusterSize: HAMLET_FOREST_EDGE_CLUSTER_SIZE,
        minimumBandDistance: HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS,
        maximumBandDistance: HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS,
        observedMinimum: null,
        observedMaximum: null,
        broadleafSaplings: 0,
        broadleafShrubCards: 0,
        broadleafMixedCrowns: 0,
      }),
    };
  }

  const edgeSamples = createSettlementEdgeSamples();
  if (layout === HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING) {
    return createInterlockingHamletForestThickets(baseline, edgeSamples);
  }
  if (layout === HAMLET_FOREST_EDGE_LAYOUT_TAPERED) {
    return createTaperedHamletForestBelt(baseline, edgeSamples);
  }
  return createClusteredHamletForestEdge(
    baseline,
    edgeSamples,
    distantBroadleafSourceIndices,
  );
}

function createClusteredHamletForestEdge(
  baseline: ForestTreePlacement[],
  edgeSamples: readonly ForestEdgeBandSample[],
  eligibleSourceIndices: readonly number[],
): {
  placements: ForestTreePlacement[];
  edgeLayer: HamletForestEdgeLayerEvidence;
} {
  const reallocation = createForestEdgeBandReallocation(
    baseline,
    edgeSamples,
    {
      targetCount: HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
      sourceIndices: eligibleSourceIndices,
      minBandDistance: HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS,
      maxBandDistance: HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS,
      maxClusterSize: HAMLET_FOREST_EDGE_CLUSTER_SIZE,
      clusterTangentSpread: 3.6,
      clusterDepthSpread: 1.35,
      variantCount: 2,
      seed: `${HAMLET_FIXTURE_SEED}:round-48:settlement-edge`,
    },
  );
  const assignmentBySourceIndex = new Map(
    reallocation.assignments.map((assignment) => [
      assignment.sourceIndex,
      assignment,
    ]),
  );
  let broadleafSaplings = 0;
  let broadleafShrubCards = 0;
  const placements = reallocation.items.map((placement, sourceIndex) => {
    const assignment = assignmentBySourceIndex.get(sourceIndex);
    if (!assignment) return placement;
    const variant = assignment.variantIndex === 0
      ? 'broadleaf-sapling'
      : 'broadleaf-shrub-card';
    if (variant === 'broadleaf-sapling') broadleafSaplings++;
    else broadleafShrubCards++;
    return {
      ...placement,
      form: variant === 'broadleaf-sapling' ? 'young' : 'midstory',
      scale: variant === 'broadleaf-sapling'
        ? 0.32 + deterministicVariation(sourceIndex, 11) * 0.14
        : 0.18 + deterministicVariation(sourceIndex, 23) * 0.1,
      edgeBand: {
        variant,
        layer: variant === 'broadleaf-sapling'
          ? 'middle-sapling'
          : 'front-shrub',
        sourceIndex,
        clusterIndex: assignment.clusterIndex,
        bandDistance: assignment.bandDistance,
        maximumDetail: 'overview-card',
      },
    } satisfies ForestTreePlacement;
  });
  return {
    placements,
    edgeLayer: createEdgeEvidence({
      layout: HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
      eligibleBroadleafDonors: eligibleSourceIndices.length,
      reallocatedSlots: reallocation.stats.reallocatedCount,
      clusterCount: reallocation.stats.clusterCount,
      maximumClusterSize: HAMLET_FOREST_EDGE_CLUSTER_SIZE,
      minimumBandDistance: HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS,
      maximumBandDistance: HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS,
      observedMinimum: reallocation.stats.observedMinBandDistance,
      observedMaximum: reallocation.stats.observedMaxBandDistance,
      broadleafSaplings,
      broadleafShrubCards,
      broadleafMixedCrowns: 0,
    }),
  };
}

function createTaperedHamletForestBelt(
  baseline: ForestTreePlacement[],
  edgeSamples: readonly ForestEdgeBandSample[],
): {
  placements: ForestTreePlacement[];
  edgeLayer: HamletForestEdgeLayerEvidence;
} {
  const eligibleSourceIndices = selectBoundaryBroadleafDonors(
    baseline,
    edgeSamples,
  );
  if (eligibleSourceIndices.length < HAMLET_FOREST_EDGE_REALLOCATION_COUNT) {
    throw new Error(
      'Hamlet tapered forest belt no longer has 256 local broadleaf donors.',
    );
  }

  const selectedSourceIndices = eligibleSourceIndices.slice(
    0,
    HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
  );
  let sourceOffset = 0;
  let clusterOffset = 0;
  let items = baseline;
  const assignments: Array<{
    assignment: ForestEdgeBandAssignment;
    layerSpec: TaperedForestBeltLayerSpec;
  }> = [];

  for (const layerSpec of TAPERED_FOREST_BELT_LAYERS) {
    const sourceIndices = selectedSourceIndices.slice(
      sourceOffset,
      sourceOffset + layerSpec.count,
    );
    sourceOffset += layerSpec.count;
    const reallocation = createForestEdgeBandReallocation(
      items,
      edgeSamples,
      {
        targetCount: layerSpec.count,
        sourceIndices,
        minBandDistance: layerSpec.minimumDistance,
        maxBandDistance: layerSpec.maximumDistance,
        maxClusterSize: layerSpec.maximumClusterSize,
        clusterTangentSpread: layerSpec.tangentSpread,
        clusterDepthSpread: layerSpec.depthSpread,
        variantCount: 1,
        maxPlacementAttempts: 28,
        isAllowedAt: isHamletForestBeltAllowedAt,
        seed: `${HAMLET_FIXTURE_SEED}:round-53:${layerSpec.layer}`,
      },
    );
    items = reallocation.items;
    for (const assignment of reallocation.assignments) {
      assignments.push({
        assignment: {
          ...assignment,
          clusterIndex: clusterOffset + assignment.clusterIndex,
        },
        layerSpec,
      });
    }
    clusterOffset += reallocation.stats.clusterCount;
  }
  if (
    sourceOffset !== HAMLET_FOREST_EDGE_REALLOCATION_COUNT
    || assignments.length !== HAMLET_FOREST_EDGE_REALLOCATION_COUNT
  ) {
    throw new Error('Hamlet tapered forest belt layer counts drifted.');
  }

  const assignmentBySourceIndex = new Map(
    assignments.map((entry) => [entry.assignment.sourceIndex, entry]),
  );
  const placements = items.map((placement, sourceIndex) => {
    const entry = assignmentBySourceIndex.get(sourceIndex);
    if (!entry) return placement;
    const { assignment, layerSpec } = entry;
    return {
      ...placement,
      form: layerSpec.form,
      scale: layerSpec.scaleMinimum
        + deterministicVariation(sourceIndex, layerSpec.scaleSalt)
          * (layerSpec.scaleMaximum - layerSpec.scaleMinimum),
      edgeBand: {
        variant: layerSpec.variant,
        layer: layerSpec.layer,
        sourceIndex,
        clusterIndex: assignment.clusterIndex,
        bandDistance: assignment.bandDistance,
        maximumDetail: 'overview-card',
      },
    } satisfies ForestTreePlacement;
  });
  const observedBandDistances = assignments.map(
    ({ assignment }) => assignment.bandDistance,
  );
  const observedClearances = assignments.map(({ assignment }) => (
    measureHamletForestBeltClearance(assignment.x, assignment.z)
  ));
  return {
    placements,
    edgeLayer: createEdgeEvidence({
      layout: HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
      eligibleBroadleafDonors: eligibleSourceIndices.length,
      reallocatedSlots: assignments.length,
      clusterCount: clusterOffset,
      maximumClusterSize: HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE,
      minimumBandDistance: HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
      maximumBandDistance: HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
      observedMinimum: Math.min(...observedBandDistances),
      observedMaximum: Math.max(...observedBandDistances),
      broadleafShrubCards: HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
      broadleafSaplings: HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
      broadleafMixedCrowns: HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
      clearance: {
        roadMeters: HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
        settlementMeters:
          HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
        observedRoadMinimum: Math.min(
          ...observedClearances.map(({ roadMeters }) => roadMeters),
        ),
        observedSettlementMinimum: Math.min(
          ...observedClearances.map(
            ({ settlementMeters }) => settlementMeters,
          ),
        ),
      },
    }),
  };
}

function createInterlockingHamletForestThickets(
  baseline: ForestTreePlacement[],
  edgeSamples: readonly ForestEdgeBandSample[],
): {
  placements: ForestTreePlacement[];
  edgeLayer: HamletForestEdgeLayerEvidence;
} {
  const eligibleSourceIndices = selectBoundaryBroadleafDonors(
    baseline,
    edgeSamples,
  );
  if (eligibleSourceIndices.length < HAMLET_FOREST_EDGE_REALLOCATION_COUNT) {
    throw new Error(
      'Hamlet interlocking forest thickets no longer have 256 local broadleaf donors.',
    );
  }

  const selectedSourceIndices = eligibleSourceIndices.slice(
    0,
    HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
  );
  // One shared eight-slot cluster pass makes every thicket mix low shrubs,
  // saplings, and crowns around the same anchor instead of drawing three
  // translucent, evenly spaced layers across the whole settlement edge.
  const reallocation = createForestEdgeBandReallocation(
    baseline,
    edgeSamples,
    {
      targetCount: HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
      sourceIndices: selectedSourceIndices,
      minBandDistance: 5.5,
      maxBandDistance: 16,
      maxClusterSize: HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE,
      clusterTangentSpread: 4.2,
      clusterDepthSpread: 1.9,
      variantCount: 1,
      maxPlacementAttempts: 28,
      isAllowedAt: isHamletForestBeltAllowedAt,
      seed:
        `${HAMLET_FIXTURE_SEED}:round-55:interlocking-midstory-thickets`,
    },
  );
  const assignments = reallocation.assignments.map((assignment) => {
    const layerSpec = INTERLOCKING_FOREST_THICKET_LAYERS[
      INTERLOCKING_FOREST_THICKET_MEMBER_LAYERS[assignment.memberIndex]!
    ]!;
    return {
      assignment: offsetInterlockingThicketDepth(
        assignment,
        layerSpec.depthOffset,
        edgeSamples,
      ),
      layerSpec,
    };
  });
  if (
    reallocation.stats.clusterCount !== HAMLET_FOREST_THICKET_CLUSTER_COUNT
    || assignments.length !== HAMLET_FOREST_EDGE_REALLOCATION_COUNT
  ) {
    throw new Error(
      'Hamlet interlocking forest thicket cluster alignment drifted.',
    );
  }

  const assignmentBySourceIndex = new Map(
    assignments.map((entry) => [entry.assignment.sourceIndex, entry]),
  );
  const placements = reallocation.items.map((placement, sourceIndex) => {
    const entry = assignmentBySourceIndex.get(sourceIndex);
    if (!entry) return placement;
    const { assignment, layerSpec } = entry;
    return {
      ...placement,
      x: assignment.x,
      z: assignment.z,
      form: layerSpec.form,
      scale: layerSpec.scaleMinimum
        + deterministicVariation(sourceIndex, layerSpec.scaleSalt)
          * (layerSpec.scaleMaximum - layerSpec.scaleMinimum),
      edgeBand: {
        variant: layerSpec.variant,
        layer: layerSpec.layer,
        sourceIndex,
        clusterIndex: assignment.clusterIndex,
        bandDistance: assignment.bandDistance,
        maximumDetail: 'overview-card',
      },
    } satisfies ForestTreePlacement;
  });
  const observedBandDistances = assignments.map(
    ({ assignment }) => assignment.bandDistance,
  );
  const observedClearances = assignments.map(({ assignment }) => (
    measureHamletForestBeltClearance(assignment.x, assignment.z)
  ));
  return {
    placements,
    edgeLayer: createEdgeEvidence({
      layout: HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
      eligibleBroadleafDonors: eligibleSourceIndices.length,
      reallocatedSlots: assignments.length,
      clusterCount: HAMLET_FOREST_THICKET_CLUSTER_COUNT,
      maximumClusterSize: HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE,
      minimumBandDistance: HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
      maximumBandDistance: HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
      observedMinimum: Math.min(...observedBandDistances),
      observedMaximum: Math.max(...observedBandDistances),
      broadleafShrubCards: HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
      broadleafSaplings: HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
      broadleafMixedCrowns: HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
      clearance: {
        roadMeters: HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
        settlementMeters:
          HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
        observedRoadMinimum: Math.min(
          ...observedClearances.map(({ roadMeters }) => roadMeters),
        ),
        observedSettlementMinimum: Math.min(
          ...observedClearances.map(
            ({ settlementMeters }) => settlementMeters,
          ),
        ),
      },
    }),
  };
}

function offsetInterlockingThicketDepth(
  assignment: ForestEdgeBandAssignment,
  requestedOffset: number,
  edgeSamples: readonly ForestEdgeBandSample[],
): ForestEdgeBandAssignment {
  // This stays consumer-side: every fallback is evaluated against Hamlet's
  // road, parcel, field, and landmark clearance geometry.
  const sample = edgeSamples[assignment.edgeSampleIndex]!;
  const normalLength = Math.hypot(sample.outwardX, sample.outwardZ);
  const outwardX = sample.outwardX / normalLength;
  const outwardZ = sample.outwardZ / normalLength;
  const tangentX = -outwardZ;
  const tangentZ = outwardX;
  for (const fraction of [1, 0.75, 0.5, 0.25, 0] as const) {
    const bandDistance = Math.max(
      HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
      Math.min(
        HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
        assignment.bandDistance + requestedOffset * fraction,
      ),
    );
    const x = sample.x
      + outwardX * bandDistance
      + tangentX * assignment.tangentOffset;
    const z = sample.z
      + outwardZ * bandDistance
      + tangentZ * assignment.tangentOffset;
    if (!isHamletForestBeltAllowedAt(x, z)) continue;
    return { ...assignment, x, z, bandDistance };
  }
  throw new Error(
    `Hamlet interlocking forest thicket slot ${assignment.sourceIndex} `
    + 'lost its clearance-safe base placement.',
  );
}

function createLegacyHamletForestPlacements(): ForestTreePlacement[] {
  const rng = mulberry32(HAMLET_FIXTURE_SEED);
  const species: ForestTreePlacement['species'][] = [
    'beech',
    'beech',
    'beech',
    'hornbeam',
    'sycamoreMaple',
    'sessileOak',
    'silverFir',
    'norwaySpruce',
  ];
  const placements: ForestTreePlacement[] = [];

  for (let z = -190; z <= 230; z += 10.2) {
    for (let x = -250; x <= 250; x += 10.2) {
      const northForest = z > 46 + Math.sin(x * 0.055) * 11;
      const sideForest =
        Math.abs(x) > 68 + Math.sin(z * 0.047) * 10 && z > -78;
      const distantSouthForest =
        z < -105 + Math.sin(x * 0.038) * 9 && Math.abs(x) > 48;
      const backgroundCanopy = z > 145 || Math.abs(x) > 185;
      const woodland =
        northForest || sideForest || distantSouthForest || backgroundCanopy;
      if (!woodland) continue;

      const innerEdge = z < 92 && Math.abs(x) < 112;
      const thinning = innerEdge ? 0.14 : 0.05;
      if (rng() < thinning) continue;

      const placedX = x + (rng() - 0.5) * 6.4;
      const placedZ = z + (rng() - 0.5) * 6.4;
      const selectedSpecies =
        species[Math.floor(rng() * species.length)]!;
      placements.push({
        x: placedX,
        z: placedZ,
        species: selectedSpecies,
        form: rng() < 0.2 ? 'midstory' : 'broad',
        scale: 0.62 + rng() * 0.36,
      });
    }
  }
  return placements;
}

function createSettlementEdgeSamples(): ForestEdgeBandSample[] {
  const samples: ForestEdgeBandSample[] = [];
  const sideSamples = 32;
  const northSamples = 64;
  for (let index = 0; index < sideSamples; index++) {
    const z = -76 + index / (sideSamples - 1) * 122;
    const side = 68 + Math.sin(z * 0.047) * 10;
    const edgeSlope = 0.47 * Math.cos(z * 0.047);
    samples.push({
      x: -side,
      z,
      outwardX: -1,
      outwardZ: -edgeSlope,
    });
  }
  for (let index = 0; index < northSamples; index++) {
    const x = -72 + index / (northSamples - 1) * 144;
    samples.push({
      x,
      z: 46 + Math.sin(x * 0.055) * 11,
      outwardX: -0.605 * Math.cos(x * 0.055),
      outwardZ: 1,
    });
  }
  for (let index = sideSamples - 1; index >= 0; index--) {
    const z = -76 + index / (sideSamples - 1) * 122;
    const side = 68 + Math.sin(z * 0.047) * 10;
    const edgeSlope = 0.47 * Math.cos(z * 0.047);
    samples.push({
      x: side,
      z,
      outwardX: 1,
      outwardZ: -edgeSlope,
    });
  }
  return samples;
}

function selectBoundaryBroadleafDonors(
  placements: readonly ForestTreePlacement[],
  edgeSamples: readonly ForestEdgeBandSample[],
): number[] {
  return placements
    .map((placement, sourceIndex) => ({
      sourceIndex,
      placement,
      relation: measureNearestBoundaryRelation(placement, edgeSamples),
    }))
    .filter(({ placement, relation }) => (
      BROADLEAF_SPECIES.has(placement.species)
      && relation.outwardDistance >= 0
      && relation.euclideanDistance <= 75
    ))
    .sort((left, right) => (
      left.relation.euclideanDistance
        - right.relation.euclideanDistance
      || left.sourceIndex - right.sourceIndex
    ))
    .map(({ sourceIndex }) => sourceIndex);
}

function measureNearestBoundaryRelation(
  point: HamletPoint2,
  edgeSamples: readonly ForestEdgeBandSample[],
): {
  euclideanDistance: number;
  outwardDistance: number;
} {
  let euclideanDistance = Infinity;
  let outwardDistance = -Infinity;
  for (const sample of edgeSamples) {
    const dx = point.x - sample.x;
    const dz = point.z - sample.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= euclideanDistance) continue;
    const normalLength = Math.hypot(sample.outwardX, sample.outwardZ);
    euclideanDistance = distance;
    outwardDistance = (
      dx * sample.outwardX + dz * sample.outwardZ
    ) / normalLength;
  }
  return { euclideanDistance, outwardDistance };
}

export function measureHamletForestBeltClearance(
  x: number,
  z: number,
): {
  roadMeters: number;
  settlementMeters: number;
} {
  let roadMeters = Infinity;
  for (const arm of HAMLET_ROAD_ARMS) {
    for (let index = 0; index < arm.points.length - 1; index++) {
      const [startX, startZ] = arm.points[index]!;
      const [endX, endZ] = arm.points[index + 1]!;
      roadMeters = Math.min(
        roadMeters,
        distanceToSegment(x, z, startX, startZ, endX, endZ),
      );
    }
  }

  let settlementMeters = Infinity;
  for (const polygon of HAMLET_SETTLEMENT_POLYGONS) {
    settlementMeters = Math.min(
      settlementMeters,
      distanceToPolygon(x, z, polygon),
    );
  }
  for (const landmark of HAMLET_LANDMARKS) {
    settlementMeters = Math.min(
      settlementMeters,
      Math.max(
        0,
        Math.hypot(
          x - landmark.position[0],
          z - landmark.position[1],
        ) - HAMLET_LANDMARK_CLEARANCE_RADIUS_METERS,
      ),
    );
  }
  return { roadMeters, settlementMeters };
}

export function isHamletForestBeltAllowedAt(
  x: number,
  z: number,
): boolean {
  const clearance = measureHamletForestBeltClearance(x, z);
  return clearance.roadMeters >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    && clearance.settlementMeters
      >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS;
}

function createHamletZonePolygon(
  spec: HamletZoneSpec,
): readonly HamletPoint2[] {
  const [startX, startZ] = spec.axisStart;
  const [endX, endZ] = spec.axisEnd;
  const length = Math.hypot(endX - startX, endZ - startZ);
  const tangentX = (endX - startX) / length;
  const tangentZ = (endZ - startZ) / length;
  const normalX = -tangentZ * spec.side;
  const normalZ = tangentX * spec.side;
  const frontOffset = spec.frontageOffset;
  const backOffset = spec.frontageOffset + spec.depth;
  return [
    {
      x: startX + normalX * frontOffset,
      z: startZ + normalZ * frontOffset,
    },
    {
      x: endX + normalX * frontOffset,
      z: endZ + normalZ * frontOffset,
    },
    {
      x: endX + normalX * backOffset,
      z: endZ + normalZ * backOffset,
    },
    {
      x: startX + normalX * backOffset,
      z: startZ + normalZ * backOffset,
    },
  ];
}

function distanceToPolygon(
  x: number,
  z: number,
  polygon: readonly HamletPoint2[],
): number {
  if (pointInPolygon(x, z, polygon)) return 0;
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    distance = Math.min(
      distance,
      distanceToSegment(x, z, start.x, start.z, end.x, end.z),
    );
  }
  return distance;
}

function pointInPolygon(
  x: number,
  z: number,
  polygon: readonly HamletPoint2[],
): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index++
  ) {
    const current = polygon[index]!;
    const previous = polygon[previousIndex]!;
    const crosses = (current.z > z) !== (previous.z > z)
      && x < (
        (previous.x - current.x) * (z - current.z)
          / (previous.z - current.z)
        + current.x
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) {
    return Math.hypot(x - startX, z - startZ);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - startX) * dx + (z - startZ) * dz) / lengthSquared,
    ),
  );
  return Math.hypot(
    x - (startX + dx * t),
    z - (startZ + dz * t),
  );
}

function isDistantPerimeterDonor(
  placement: ForestTreePlacement,
): boolean {
  return placement.z > 98
    || placement.z < -138
    || Math.abs(placement.x) > 132;
}

function deterministicVariation(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(salt + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}

function createEdgeEvidence(options: {
  layout: HamletForestEdgeLayout;
  eligibleBroadleafDonors: number;
  reallocatedSlots: number;
  clusterCount: number;
  maximumClusterSize: number;
  minimumBandDistance: number;
  maximumBandDistance: number;
  observedMinimum: number | null;
  observedMaximum: number | null;
  broadleafSaplings: number;
  broadleafShrubCards: number;
  broadleafMixedCrowns: number;
  clearance?: HamletForestEdgeLayerEvidence['clearance'];
}): HamletForestEdgeLayerEvidence {
  return {
    layout: options.layout,
    seedThreeCommit: HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT,
    sourceSlots: 1651,
    reallocatedSlots: options.reallocatedSlots,
    retainedSlots: 1651 - options.reallocatedSlots,
    eligibleBroadleafDonors: options.eligibleBroadleafDonors,
    clusterCount: options.clusterCount,
    maximumClusterSize: options.maximumClusterSize,
    bandMeters: {
      minimum: options.minimumBandDistance,
      maximum: options.maximumBandDistance,
      observedMinimum: options.observedMinimum,
      observedMaximum: options.observedMaximum,
    },
    variants: {
      broadleafSaplings: options.broadleafSaplings,
      broadleafShrubCards: options.broadleafShrubCards,
      broadleafMixedCrowns: options.broadleafMixedCrowns,
    },
    ...(options.clearance ? { clearance: options.clearance } : {}),
    budget: {
      treeSlotDelta: 0,
      speciesPresetDelta: 0,
      instanceCapacityDelta: 0,
      textureAssetDelta: 0,
      forestDrawBudget: 20,
      forestDrawDelta: 0,
      trianglePolicy:
        'all-reallocated-slots-capped-to-existing-overview-card-detail',
      maximumTriangleBudgetDelta: 'non-positive',
    },
  };
}
