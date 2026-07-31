import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  createHamletForestPlacements,
  HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
  HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
  HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE,
  HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
  HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
  HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  HAMLET_FOREST_EDGE_CLUSTER_SIZE,
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
  HAMLET_FOREST_EDGE_LAYOUT_LEGACY,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS,
  HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
  HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT,
  HAMLET_FOREST_THICKET_CLUSTER_COUNT,
  HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
  HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
  HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE,
  HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
  HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
  HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
  isHamletForestBeltAllowedAt,
  measureHamletForestBeltClearance,
  resolveHamletForestEdgeLayout,
} from '../src/e2e/hamletForestEdgeLayer.ts';
import {
  createHamletRouteFrameSequenceDescriptor,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
} from '../src/e2e/hamletFixturePerformance.ts';
import { resolveSeedThreePreset } from '../src/vegetation/seedthree/gorskiKotarSpecies.ts';

assert.equal(
  resolveHamletForestEdgeLayout(null),
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
assert.equal(
  resolveHamletForestEdgeLayout(HAMLET_FOREST_EDGE_LAYOUT_LEGACY),
  HAMLET_FOREST_EDGE_LAYOUT_LEGACY,
);
assert.equal(
  resolveHamletForestEdgeLayout(HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED),
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
);
assert.equal(
  resolveHamletForestEdgeLayout(HAMLET_FOREST_EDGE_LAYOUT_TAPERED),
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
assert.equal(
  resolveHamletForestEdgeLayout(HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING),
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
);
assert.throws(
  () => resolveHamletForestEdgeLayout('expanded-slot-count'),
  /forestEdgeLayout must be/,
);

const baseline = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_LEGACY,
);
const treatment = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
);
const treatmentRepeat = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
);
const tapered = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
const taperedRepeat = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
const interlocking = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
);
const interlockingRepeat = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
);

assert.equal(baseline.placements.length, 1651);
assert.equal(treatment.placements.length, 1651);
assert.equal(tapered.placements.length, 1651);
assert.equal(interlocking.placements.length, 1651);
assert.deepEqual(treatmentRepeat, treatment);
assert.deepEqual(taperedRepeat, tapered);
assert.deepEqual(interlockingRepeat, interlocking);
assert.equal(baseline.edgeLayer.sourceSlots, 1651);
assert.equal(baseline.edgeLayer.reallocatedSlots, 0);
assert.equal(baseline.edgeLayer.retainedSlots, 1651);
assert.equal(treatment.edgeLayer.sourceSlots, 1651);
assert.equal(
  treatment.edgeLayer.reallocatedSlots,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  treatment.edgeLayer.retainedSlots,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(treatment.edgeLayer.clusterCount, 32);
assert.equal(
  treatment.edgeLayer.maximumClusterSize,
  HAMLET_FOREST_EDGE_CLUSTER_SIZE,
);
assert.equal(
  treatment.edgeLayer.seedThreeCommit,
  HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT,
);
assert.equal(treatment.edgeLayer.variants.broadleafMixedCrowns, 0);
assert.equal(treatment.edgeLayer.clearance, undefined);

const edgePlacements = treatment.placements.filter(
  (placement) => placement.edgeBand !== undefined,
);
assert.equal(edgePlacements.length, HAMLET_FOREST_EDGE_REALLOCATION_COUNT);
assert.equal(
  treatment.placements.filter(
    (placement, index) =>
      placement.edgeBand === undefined
      && placement.x === baseline.placements[index]!.x
      && placement.z === baseline.placements[index]!.z
      && placement.species === baseline.placements[index]!.species
      && placement.form === baseline.placements[index]!.form
      && placement.scale === baseline.placements[index]!.scale,
  ).length,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);

const clusterSizes = new Map<number, number>();
const variantCounts = new Map<string, number>();
for (const placement of edgePlacements) {
  const provenance = placement.edgeBand!;
  assert.ok(
    ['beech', 'hornbeam', 'sycamoreMaple', 'sessileOak']
      .includes(placement.species),
  );
  assert.equal(provenance.maximumDetail, 'overview-card');
  assert.ok(provenance.bandDistance >= HAMLET_FOREST_EDGE_MIN_DISTANCE_METERS);
  assert.ok(provenance.bandDistance <= HAMLET_FOREST_EDGE_MAX_DISTANCE_METERS);
  assert.equal(
    treatment.placements[provenance.sourceIndex]!.edgeBand,
    provenance,
  );
  assert.equal(
    treatment.placements[provenance.sourceIndex]!.species,
    baseline.placements[provenance.sourceIndex]!.species,
  );
  clusterSizes.set(
    provenance.clusterIndex,
    (clusterSizes.get(provenance.clusterIndex) ?? 0) + 1,
  );
  variantCounts.set(
    provenance.variant,
    (variantCounts.get(provenance.variant) ?? 0) + 1,
  );
}
assert.equal(clusterSizes.size, 32);
assert.ok(
  [...clusterSizes.values()].every(
    (size) => size === HAMLET_FOREST_EDGE_CLUSTER_SIZE,
  ),
);
assert.deepEqual(
  Object.fromEntries([...variantCounts].sort()),
  {
    'broadleaf-sapling': 128,
    'broadleaf-shrub-card': 128,
  },
);

assert.equal(tapered.edgeLayer.sourceSlots, 1651);
assert.equal(
  tapered.edgeLayer.reallocatedSlots,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  tapered.edgeLayer.retainedSlots,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(tapered.edgeLayer.clusterCount, 132);
assert.equal(
  tapered.edgeLayer.maximumClusterSize,
  HAMLET_FOREST_BELT_MAXIMUM_CLUSTER_SIZE,
);
assert.equal(
  tapered.edgeLayer.bandMeters.minimum,
  HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
);
assert.equal(
  tapered.edgeLayer.bandMeters.maximum,
  HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
);
assert.deepEqual(tapered.edgeLayer.variants, {
  broadleafSaplings: HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
  broadleafShrubCards: HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
  broadleafMixedCrowns: HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
});
assert.equal(
  tapered.edgeLayer.seedThreeCommit,
  HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT,
);
assert.ok(tapered.edgeLayer.clearance);
assert.equal(
  tapered.edgeLayer.clearance.roadMeters,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);
assert.equal(
  tapered.edgeLayer.clearance.settlementMeters,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
);
assert.ok(
  tapered.edgeLayer.clearance.observedRoadMinimum
    >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);
assert.ok(
  tapered.edgeLayer.clearance.observedSettlementMinimum
    >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
);

const taperedPlacements = tapered.placements.filter(
  (placement) => placement.edgeBand !== undefined,
);
assert.equal(
  taperedPlacements.length,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  tapered.placements.filter(
    (placement, index) =>
      placement.edgeBand === undefined
      && placement.x === baseline.placements[index]!.x
      && placement.z === baseline.placements[index]!.z
      && placement.species === baseline.placements[index]!.species
      && placement.form === baseline.placements[index]!.form
      && placement.scale === baseline.placements[index]!.scale,
  ).length,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);

const taperedClusterSizes = new Map<number, number>();
const taperedLayerCounts = new Map<string, number>();
const taperedVariantCounts = new Map<string, number>();
const distancesByLayer = new Map<string, number[]>();
const scalesByLayer = new Map<string, number[]>();
for (const placement of taperedPlacements) {
  const provenance = placement.edgeBand!;
  assert.equal(provenance.maximumDetail, 'overview-card');
  assert.ok(
    provenance.bandDistance >= HAMLET_FOREST_BELT_MIN_DISTANCE_METERS,
  );
  assert.ok(
    provenance.bandDistance <= HAMLET_FOREST_BELT_MAX_DISTANCE_METERS,
  );
  assert.equal(
    tapered.placements[provenance.sourceIndex]!.edgeBand,
    provenance,
  );
  assert.equal(
    tapered.placements[provenance.sourceIndex]!.species,
    baseline.placements[provenance.sourceIndex]!.species,
  );
  assert.equal(
    isHamletForestBeltAllowedAt(placement.x, placement.z),
    true,
  );
  const clearance = measureHamletForestBeltClearance(
    placement.x,
    placement.z,
  );
  assert.ok(
    clearance.roadMeters >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  );
  assert.ok(
    clearance.settlementMeters
      >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  );
  taperedClusterSizes.set(
    provenance.clusterIndex,
    (taperedClusterSizes.get(provenance.clusterIndex) ?? 0) + 1,
  );
  taperedLayerCounts.set(
    provenance.layer,
    (taperedLayerCounts.get(provenance.layer) ?? 0) + 1,
  );
  taperedVariantCounts.set(
    provenance.variant,
    (taperedVariantCounts.get(provenance.variant) ?? 0) + 1,
  );
  const layerDistances = distancesByLayer.get(provenance.layer) ?? [];
  layerDistances.push(provenance.bandDistance);
  distancesByLayer.set(provenance.layer, layerDistances);
  const layerScales = scalesByLayer.get(provenance.layer) ?? [];
  layerScales.push(placement.scale);
  scalesByLayer.set(provenance.layer, layerScales);
}
assert.equal(taperedClusterSizes.size, 132);
assert.deepEqual(
  histogram(
    [...taperedClusterSizes.values()].map((size) => String(size)),
  ),
  { 1: 64, 2: 40, 4: 28 },
);
assert.deepEqual(
  Object.fromEntries([...taperedLayerCounts].sort()),
  {
    'front-shrub': HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
    'interior-crown': HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
    'middle-sapling': HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
  },
);
assert.deepEqual(
  Object.fromEntries([...taperedVariantCounts].sort()),
  {
    'broadleaf-mixed-crown': HAMLET_FOREST_BELT_INTERIOR_CROWN_COUNT,
    'broadleaf-sapling': HAMLET_FOREST_BELT_MIDDLE_SAPLING_COUNT,
    'broadleaf-shrub-card': HAMLET_FOREST_BELT_FRONT_SHRUB_COUNT,
  },
);
const frontDistances = distancesByLayer.get('front-shrub')!;
const middleDistances = distancesByLayer.get('middle-sapling')!;
const interiorDistances = distancesByLayer.get('interior-crown')!;
assert.ok(Math.max(...frontDistances) < Math.min(...middleDistances));
assert.ok(Math.max(...middleDistances) < Math.min(...interiorDistances));
const frontScales = scalesByLayer.get('front-shrub')!;
const middleScales = scalesByLayer.get('middle-sapling')!;
const interiorScales = scalesByLayer.get('interior-crown')!;
assert.ok(Math.max(...frontScales) < Math.min(...middleScales));
assert.ok(Math.max(...middleScales) < Math.min(...interiorScales));

assert.equal(interlocking.edgeLayer.sourceSlots, 1651);
assert.equal(
  interlocking.edgeLayer.reallocatedSlots,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  interlocking.edgeLayer.retainedSlots,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  interlocking.edgeLayer.clusterCount,
  HAMLET_FOREST_THICKET_CLUSTER_COUNT,
);
assert.equal(
  interlocking.edgeLayer.maximumClusterSize,
  HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE,
);
assert.equal(
  interlocking.edgeLayer.bandMeters.minimum,
  HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
);
assert.equal(
  interlocking.edgeLayer.bandMeters.maximum,
  HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
);
assert.deepEqual(interlocking.edgeLayer.variants, {
  broadleafSaplings: HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
  broadleafShrubCards: HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
  broadleafMixedCrowns: HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
});
assert.equal(
  interlocking.edgeLayer.seedThreeCommit,
  HAMLET_FOREST_EDGE_SEEDTHREE_COMMIT,
);
assert.ok(interlocking.edgeLayer.clearance);
assert.equal(
  interlocking.edgeLayer.clearance.roadMeters,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);
assert.equal(
  interlocking.edgeLayer.clearance.settlementMeters,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
);
assert.ok(
  interlocking.edgeLayer.clearance.observedRoadMinimum
    >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);
assert.ok(
  interlocking.edgeLayer.clearance.observedSettlementMinimum
    >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
);

const interlockingPlacements = interlocking.placements.filter(
  (placement) => placement.edgeBand !== undefined,
);
assert.equal(
  interlockingPlacements.length,
  HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);
assert.equal(
  interlocking.placements.filter(
    (placement, index) =>
      placement.edgeBand === undefined
      && placement.x === baseline.placements[index]!.x
      && placement.z === baseline.placements[index]!.z
      && placement.species === baseline.placements[index]!.species
      && placement.form === baseline.placements[index]!.form
      && placement.scale === baseline.placements[index]!.scale,
  ).length,
  1651 - HAMLET_FOREST_EDGE_REALLOCATION_COUNT,
);

const interlockingClusters = new Map<number, typeof interlockingPlacements>();
const interlockingLayerCounts = new Map<string, number>();
const interlockingVariantCounts = new Map<string, number>();
const interlockingScalesByLayer = new Map<string, number[]>();
const interlockingDistancesByLayer = new Map<string, number[]>();
for (const placement of interlockingPlacements) {
  const provenance = placement.edgeBand!;
  assert.equal(provenance.maximumDetail, 'overview-card');
  assert.ok(
    provenance.bandDistance >= HAMLET_FOREST_THICKET_MIN_DISTANCE_METERS,
  );
  assert.ok(
    provenance.bandDistance <= HAMLET_FOREST_THICKET_MAX_DISTANCE_METERS,
  );
  assert.equal(
    interlocking.placements[provenance.sourceIndex]!.edgeBand,
    provenance,
  );
  assert.equal(
    interlocking.placements[provenance.sourceIndex]!.species,
    baseline.placements[provenance.sourceIndex]!.species,
  );
  assert.equal(isHamletForestBeltAllowedAt(placement.x, placement.z), true);
  const clearance = measureHamletForestBeltClearance(
    placement.x,
    placement.z,
  );
  assert.ok(
    clearance.roadMeters >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  );
  assert.ok(
    clearance.settlementMeters
      >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  );
  const cluster = interlockingClusters.get(provenance.clusterIndex) ?? [];
  cluster.push(placement);
  interlockingClusters.set(provenance.clusterIndex, cluster);
  interlockingLayerCounts.set(
    provenance.layer,
    (interlockingLayerCounts.get(provenance.layer) ?? 0) + 1,
  );
  interlockingVariantCounts.set(
    provenance.variant,
    (interlockingVariantCounts.get(provenance.variant) ?? 0) + 1,
  );
  const layerScales = interlockingScalesByLayer.get(provenance.layer) ?? [];
  layerScales.push(placement.scale);
  interlockingScalesByLayer.set(provenance.layer, layerScales);
  const layerDistances =
    interlockingDistancesByLayer.get(provenance.layer) ?? [];
  layerDistances.push(provenance.bandDistance);
  interlockingDistancesByLayer.set(provenance.layer, layerDistances);
}
assert.equal(
  interlockingClusters.size,
  HAMLET_FOREST_THICKET_CLUSTER_COUNT,
);
for (const cluster of interlockingClusters.values()) {
  assert.equal(cluster.length, HAMLET_FOREST_THICKET_MAXIMUM_CLUSTER_SIZE);
  assert.deepEqual(
    histogram(cluster.map((placement) => placement.edgeBand!.layer)),
    {
      'front-shrub': 3,
      'interior-crown': 2,
      'middle-sapling': 3,
    },
  );
}
assert.deepEqual(
  Object.fromEntries([...interlockingLayerCounts].sort()),
  {
    'front-shrub': HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
    'interior-crown': HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
    'middle-sapling': HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
  },
);
assert.deepEqual(
  Object.fromEntries([...interlockingVariantCounts].sort()),
  {
    'broadleaf-mixed-crown': HAMLET_FOREST_THICKET_INTERIOR_CROWN_COUNT,
    'broadleaf-sapling': HAMLET_FOREST_THICKET_MIDDLE_SAPLING_COUNT,
    'broadleaf-shrub-card': HAMLET_FOREST_THICKET_FRONT_SHRUB_COUNT,
  },
);
const interlockingFrontScales =
  interlockingScalesByLayer.get('front-shrub')!;
const interlockingMiddleScales =
  interlockingScalesByLayer.get('middle-sapling')!;
const interlockingInteriorScales =
  interlockingScalesByLayer.get('interior-crown')!;
assert.ok(
  Math.max(...interlockingFrontScales)
    < Math.min(...interlockingMiddleScales),
);
assert.ok(
  Math.max(...interlockingMiddleScales)
    < Math.min(...interlockingInteriorScales),
);
assert.ok(
  Math.min(...interlockingFrontScales) > Math.max(...frontScales),
  'Round 55 shrubs must be visibly larger than every tapered shrub.',
);
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
assert.ok(
  mean(interlockingDistancesByLayer.get('front-shrub')!)
    < mean(interlockingDistancesByLayer.get('middle-sapling')!),
);
assert.ok(
  mean(interlockingDistancesByLayer.get('middle-sapling')!)
    < mean(interlockingDistancesByLayer.get('interior-crown')!),
);
const canopyFootprintProxy = (
  placements: readonly { scale: number }[],
) => placements.reduce(
  (sum, placement) => sum + placement.scale * placement.scale,
  0,
);
assert.ok(
  canopyFootprintProxy(interlockingPlacements)
    > canopyFootprintProxy(taperedPlacements) * 1.2,
  'Round 55 must close more bright ground than the tapered treatment.',
);
const interlockingCentroids = [...interlockingClusters]
  .sort(([left], [right]) => left - right)
  .map(([, cluster]) => ({
    x: mean(cluster.map((placement) => placement.x)),
    z: mean(cluster.map((placement) => placement.z)),
  }));
const interlockingBayGaps = interlockingCentroids.slice(1).map(
  (centroid, index) => Math.hypot(
    centroid.x - interlockingCentroids[index]!.x,
    centroid.z - interlockingCentroids[index]!.z,
  ),
);
assert.ok(
  interlockingBayGaps.filter((distance) => distance >= 20).length >= 3,
  'The dense thickets must retain occasional irregular bays.',
);

function histogram(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

const expectedSpeciesHistogram = {
  beech: 595,
  hornbeam: 225,
  norwaySpruce: 178,
  sessileOak: 223,
  silverFir: 208,
  sycamoreMaple: 222,
};
assert.deepEqual(
  histogram(baseline.placements.map((placement) => placement.species)),
  expectedSpeciesHistogram,
);
assert.deepEqual(
  histogram(treatment.placements.map((placement) => placement.species)),
  expectedSpeciesHistogram,
);
assert.deepEqual(
  histogram(tapered.placements.map((placement) => placement.species)),
  expectedSpeciesHistogram,
);
assert.deepEqual(
  histogram(interlocking.placements.map((placement) => placement.species)),
  expectedSpeciesHistogram,
);
assert.deepEqual(
  histogram(
    treatment.placements.map(
      (placement) => resolveSeedThreePreset(placement.species),
    ),
  ),
  {
    americanBeech: 820,
    douglasFir: 208,
    loblolly: 178,
    redMaple: 222,
    whiteOak: 223,
  },
);
assert.deepEqual(
  histogram(
    tapered.placements.map(
      (placement) => resolveSeedThreePreset(placement.species),
    ),
  ),
  {
    americanBeech: 820,
    douglasFir: 208,
    loblolly: 178,
    redMaple: 222,
    whiteOak: 223,
  },
);
assert.deepEqual(
  histogram(
    interlocking.placements.map(
      (placement) => resolveSeedThreePreset(placement.species),
    ),
  ),
  {
    americanBeech: 820,
    douglasFir: 208,
    loblolly: 178,
    redMaple: 222,
    whiteOak: 223,
  },
);
assert.deepEqual(treatment.edgeLayer.budget, {
  treeSlotDelta: 0,
  speciesPresetDelta: 0,
  instanceCapacityDelta: 0,
  textureAssetDelta: 0,
  forestDrawBudget: 20,
  forestDrawDelta: 0,
  trianglePolicy:
    'all-reallocated-slots-capped-to-existing-overview-card-detail',
  maximumTriangleBudgetDelta: 'non-positive',
});
assert.deepEqual(tapered.edgeLayer.budget, treatment.edgeLayer.budget);
assert.deepEqual(interlocking.edgeLayer.budget, treatment.edgeLayer.budget);

const descriptor = createHamletRouteFrameSequenceDescriptor(
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
);
assert.equal(
  descriptor.forestEdgeLayout,
  HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED,
);
assert.ok(
  descriptor.signature.endsWith(
    `|forest-edge=${HAMLET_FOREST_EDGE_LAYOUT_CLUSTERED}`,
  ),
);
const taperedDescriptor = createHamletRouteFrameSequenceDescriptor(
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
assert.equal(
  taperedDescriptor.forestEdgeLayout,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
assert.ok(
  taperedDescriptor.signature.endsWith(
    `|forest-edge=${HAMLET_FOREST_EDGE_LAYOUT_TAPERED}`,
  ),
);
const interlockingDescriptor = createHamletRouteFrameSequenceDescriptor(
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
);
assert.equal(
  interlockingDescriptor.forestEdgeLayout,
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
);
assert.ok(
  interlockingDescriptor.signature.endsWith(
    `|forest-edge=${HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING}`,
  ),
);

const builderSource = readFileSync(
  new URL('../src/vegetation/seedthree/seedThreeForestBuilder.ts', import.meta.url),
  'utf8',
);
assert.match(
  builderSource,
  /forceOverview:\s*placement\.edgeBand\?\.maximumDetail === 'overview-card'/,
);

console.log(
  'Hamlet forest edge layer preserves 1,651 slots and reallocates exactly '
  + '256 local broadleaf slots into clearance-safe, interlocking thickets.',
);
