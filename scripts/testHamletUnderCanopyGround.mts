import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createHamletForestPlacements,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
  HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
  HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  measureHamletForestBeltClearance,
} from '../src/e2e/hamletForestEdgeLayer.ts';
import {
  applyHamletUnderCanopyGroundTreatment,
  assertHamletUnderCanopyGroundDependencies,
  HAMLET_UNDER_CANOPY_GROUND_CONTROL,
  HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER,
  HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  resolveHamletUnderCanopyGroundTreatment,
} from '../src/e2e/hamletUnderCanopyGround.ts';

assert.equal(
  resolveHamletUnderCanopyGroundTreatment(null),
  HAMLET_UNDER_CANOPY_GROUND_CONTROL,
);
assert.equal(
  resolveHamletUnderCanopyGroundTreatment(
    HAMLET_UNDER_CANOPY_GROUND_CONTROL,
  ),
  HAMLET_UNDER_CANOPY_GROUND_CONTROL,
);
assert.equal(
  resolveHamletUnderCanopyGroundTreatment(
    HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  ),
  HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
);
assert.throws(
  () => resolveHamletUnderCanopyGroundTreatment('dark-everywhere'),
  /forestGround must be existing-terrain or shadowed-under-canopy/,
);
assert.doesNotThrow(() => assertHamletUnderCanopyGroundDependencies(
  HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
));
assert.throws(
  () => assertHamletUnderCanopyGroundDependencies(
    HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
    HAMLET_FOREST_EDGE_LAYOUT_INTERLOCKING,
  ),
  /requires forestEdgeLayout=tapered-shrub-sapling-belt-256/,
);

const tapered = createHamletForestPlacements(
  HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
);
const placementsBefore = JSON.stringify(tapered.placements);
const controlGeometry = createHamletTerrainGeometry();
const controlColors = copyAttributeArray(controlGeometry, 'color');
const controlGeometrySignature = geometryStructureSignature(controlGeometry);
const control = applyHamletUnderCanopyGroundTreatment({
  treatment: HAMLET_UNDER_CANOPY_GROUND_CONTROL,
  forestEdgeLayout: HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  geometry: controlGeometry,
  placements: tapered.placements,
});

assert.equal(
  JSON.stringify(tapered.placements),
  placementsBefore,
  'the ground treatment must never alter accepted vegetation placement data',
);
assert.deepEqual(copyAttributeArray(controlGeometry, 'color'), controlColors);
assert.deepEqual(
  geometryStructureSignature(controlGeometry),
  controlGeometrySignature,
);
assert.equal(control.query.parameter, HAMLET_UNDER_CANOPY_GROUND_QUERY_PARAMETER);
assert.equal(control.query.value, HAMLET_UNDER_CANOPY_GROUND_CONTROL);
assert.equal(
  control.mode,
  'round-55-accepted-terrain-unchanged',
);
assert.equal(control.source.forestEdgeLayout, HAMLET_FOREST_EDGE_LAYOUT_TAPERED);
assert.equal(control.source.vegetationSlots, 1651);
assert.equal(control.source.edgeSlots, 256);
assert.equal(control.footprint.modifiedVertices, 0);
assert.equal(control.footprint.bounds, null);
assert.equal(control.budget.startupColorWrites, 0);

const treatmentGeometry = createHamletTerrainGeometry();
const treatmentColorsBefore = copyAttributeArray(treatmentGeometry, 'color');
const treatmentStructureBefore =
  geometryStructureSignature(treatmentGeometry);
const treatment = applyHamletUnderCanopyGroundTreatment({
  treatment: HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  forestEdgeLayout: HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  geometry: treatmentGeometry,
  placements: tapered.placements,
});
const treatmentColorsAfter = copyAttributeArray(treatmentGeometry, 'color');

assert.equal(treatment.query.parameter, 'forestGround');
assert.equal(treatment.query.value, 'shadowed-under-canopy');
assert.equal(
  treatment.query.defaultWhenAbsent,
  HAMLET_UNDER_CANOPY_GROUND_CONTROL,
);
assert.equal(
  treatment.mode,
  'startup-only-existing-biome-weight-rebalance',
);
assert.equal(treatment.source.vegetationSlots, 1651);
assert.equal(treatment.source.edgeSlots, 256);
assert.equal(
  treatment.source.footprintBasis,
  'accepted-edge-slot-layer-scale-radial-union',
);
assert.equal(treatment.footprint.terrainVertices, 50_369);
assert.equal(treatment.footprint.candidateVertices, 1_377);
assert.equal(treatment.footprint.modifiedVertices, 1_250);
assert.deepEqual(treatment.footprint.bounds, {
  minX: -102.5,
  maxX: 102.5,
  minZ: -77.5,
  maxZ: 82.5,
});
assertNear(
  treatment.footprint.modifiedPercent,
  2.4816851634934185,
);
assertNear(
  treatment.footprint.weightedCoverageSquareMeters,
  5_981.060473869973,
);
assertNear(
  treatment.footprint.maximumRadiusMeters,
  7.755374778319149,
);
assert.equal(
  treatment.footprint.coverageMethod,
  'integrated-linear-vertex-mask-over-xz-triangles',
);
assert.equal(
  treatment.footprint.interpolationHaloMeters,
  Math.hypot(2.5, 2.5),
);
assert.ok(
  treatment.footprint.clearance.observedRoadVertexMinimumMeters!
    >= treatment.footprint.clearance.requiredRoadVertexMeters,
);
assert.ok(
  treatment.footprint.clearance.observedSettlementVertexMinimumMeters!
    >= treatment.footprint.clearance.requiredSettlementVertexMeters,
);
assert.ok(
  treatment.footprint.clearance.guaranteedRoadFragmentMinimumMeters!
    >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);
assert.ok(
  treatment.footprint.clearance.guaranteedSettlementFragmentMinimumMeters!
    >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS,
);
assertNear(
  treatment.footprint.clearance.observedRoadVertexMinimumMeters!,
  13.601470508735444,
);
assertNear(
  treatment.footprint.clearance.observedSettlementVertexMinimumMeters!,
  11.729902335502189,
);
assertNear(
  treatment.footprint.clearance.guaranteedRoadFragmentMinimumMeters!,
  10.065936602802706,
);
assertNear(
  treatment.footprint.clearance.guaranteedSettlementFragmentMinimumMeters!,
  8.194368429569451,
);
assert.ok(treatment.footprint.clearance.rejectedRoadVertices > 0);
assert.ok(treatment.footprint.clearance.rejectedSettlementVertices > 0);
assert.equal(treatment.footprint.clearance.rejectedRoadVertices, 75);
assert.equal(treatment.footprint.clearance.rejectedSettlementVertices, 60);
assert.equal(treatment.footprint.clearance.roadContaminationVertices, 0);
assert.equal(treatment.footprint.clearance.parcelContaminationVertices, 0);
assert.ok(treatment.tone.meanStableLuminanceBefore! > 0);
assert.ok(
  treatment.tone.meanStableLuminanceAfter!
    < treatment.tone.meanStableLuminanceBefore!,
);
assert.ok(treatment.tone.meanStableLuminanceReductionPercent >= 3);
assert.ok(treatment.tone.meanStableLuminanceReductionPercent <= 20);
assertNear(
  treatment.tone.meanStableLuminanceReductionPercent,
  5.9080105973370545,
);
assert.deepEqual(
  geometryStructureSignature(treatmentGeometry),
  treatmentStructureBefore,
);

let changedVertices = 0;
const position = treatmentGeometry.getAttribute(
  'position',
) as THREE.BufferAttribute;
for (let index = 0; index < position.count; index += 1) {
  const offset = index * 3;
  const changed =
    treatmentColorsAfter[offset] !== treatmentColorsBefore[offset]
    || treatmentColorsAfter[offset + 1]
      !== treatmentColorsBefore[offset + 1]
    || treatmentColorsAfter[offset + 2]
      !== treatmentColorsBefore[offset + 2];
  if (!changed) continue;
  changedVertices += 1;
  const weightSum = treatmentColorsAfter[offset]!
    + treatmentColorsAfter[offset + 1]!
    + treatmentColorsAfter[offset + 2]!;
  assert.ok(Math.abs(weightSum - 1) < 1e-6);
  const clearance = measureHamletForestBeltClearance(
    position.getX(index),
    position.getZ(index),
  );
  assert.ok(
    clearance.roadMeters
      >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
        + treatment.footprint.interpolationHaloMeters,
  );
  assert.ok(
    clearance.settlementMeters
      >= HAMLET_FOREST_BELT_SETTLEMENT_CLEARANCE_METERS
        + treatment.footprint.interpolationHaloMeters,
  );
}
assert.equal(changedVertices, treatment.footprint.modifiedVertices);
assert.equal(treatment.budget.startupColorWrites, changedVertices);
assert.deepEqual(
  {
    forestSlotDelta: treatment.budget.forestSlotDelta,
    forestDrawDelta: treatment.budget.forestDrawDelta,
    terrainDrawDelta: treatment.budget.terrainDrawDelta,
    textureAssetDelta: treatment.budget.textureAssetDelta,
    meshDelta: treatment.budget.meshDelta,
    materialDelta: treatment.budget.materialDelta,
    geometryVertexDelta: treatment.budget.geometryVertexDelta,
    geometryIndexDelta: treatment.budget.geometryIndexDelta,
    vertexAttributeDelta: treatment.budget.vertexAttributeDelta,
    colorBufferByteDelta: treatment.budget.colorBufferByteDelta,
    perFrameWorkDelta: treatment.budget.perFrameWorkDelta,
  },
  {
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
  },
);
assert.deepEqual(treatment.budget.geometry, control.budget.geometry);
assert.deepEqual(treatment.budget.geometry, {
  vertices: 50_369,
  indices: 299_520,
  attributes: 9,
  colorBufferBytes: 604_428,
});
assert.deepEqual(treatment.seedThreeAudit, {
  classification: 'hamlet-specific-terrain-weighting',
  reusableSeedThreeBehaviorAdded: false,
  gitlinkChangeRequired: false,
  reason:
    'footprint-and-clearance-depend-on-hamlet-road-parcel-and-edge-composition',
});

const repeatGeometry = createHamletTerrainGeometry();
const repeat = applyHamletUnderCanopyGroundTreatment({
  treatment: HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  forestEdgeLayout: HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  geometry: repeatGeometry,
  placements: tapered.placements,
});
assert.deepEqual(repeat, treatment);
assert.deepEqual(
  copyAttributeArray(repeatGeometry, 'color'),
  treatmentColorsAfter,
);

const stretchedGeometry = createHamletTerrainGeometry();
stretchedGeometry.scale(1.1, 1, 1);
const stretched = applyHamletUnderCanopyGroundTreatment({
  treatment: HAMLET_UNDER_CANOPY_GROUND_TREATMENT,
  forestEdgeLayout: HAMLET_FOREST_EDGE_LAYOUT_TAPERED,
  geometry: stretchedGeometry,
  placements: tapered.placements,
});
assert.ok(
  stretched.footprint.interpolationHaloMeters
    > treatment.footprint.interpolationHaloMeters,
  'the clearance halo must follow supplied triangle topology, not a fixed grid',
);
assertNear(
  stretched.footprint.interpolationHaloMeters,
  Math.hypot(2.75, 2.5),
);
assertNear(
  stretched.footprint.clearance.requiredRoadVertexMeters,
  HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS
    + stretched.footprint.interpolationHaloMeters,
);
assert.ok(
  stretched.footprint.clearance.guaranteedRoadFragmentMinimumMeters!
    >= HAMLET_FOREST_BELT_ROAD_CLEARANCE_METERS,
);

const fixtureSource = readFileSync(
  new URL('../src/e2e/hamletFixture.ts', import.meta.url),
  'utf8',
);
assert.equal(
  [...fixtureSource.matchAll(/params\.get\('forestGround'\)/g)].length,
  1,
  'the A/B treatment must read its sole explicit query gate exactly once',
);
assert.match(
  fixtureSource,
  /underCanopyGround,\s*\n\s*drawCalls:/,
  'terminal metrics must publish the exact ground-treatment evidence',
);

console.log(JSON.stringify({
  query: treatment.query,
  source: treatment.source,
  footprint: treatment.footprint,
  tone: treatment.tone,
  budget: treatment.budget,
}, null, 2));

function createHamletTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(600, 520, 240, 208);
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const gates = new Float32Array(positions.count);
  const empty = new Float32Array(positions.count);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const height = hamletHeightAt(x, z);
    positions.setY(index, height);
    const forestWeight = THREE.MathUtils.clamp(
      Math.max(
        THREE.MathUtils.smoothstep(z, 36, 72),
        THREE.MathUtils.smoothstep(Math.abs(x), 51, 86),
      ),
      0,
      1,
    );
    const dryWeight = THREE.MathUtils.clamp(
      0.13 + THREE.MathUtils.smoothstep(height, 4, 11) * 0.28,
      0.08,
      0.46,
    );
    const meadowWeight = Math.max(
      0.08,
      1 - forestWeight * 0.58 - dryWeight,
    );
    const denseWeight = Math.max(0.08, forestWeight * 0.58 + 0.08);
    const sum = meadowWeight + denseWeight + dryWeight;
    colors[index * 3] = meadowWeight / sum;
    colors[index * 3 + 1] = denseWeight / sum;
    colors[index * 3 + 2] = dryWeight / sum;
    gates[index] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
  geometry.setAttribute('shoreBlend', new THREE.BufferAttribute(empty.slice(), 1));
  geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(empty.slice(), 1));
  geometry.setAttribute('quarryPadBlend', new THREE.BufferAttribute(empty.slice(), 1));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(gates, 1));
  return geometry;
}

function hamletHeightAt(x: number, z: number): number {
  const rollingGround = Math.sin(x * 0.043) * 0.78
    + Math.cos(z * 0.038) * 0.58
    + Math.sin((x + z) * 0.026) * 0.42;
  const northRise = THREE.MathUtils.smoothstep(z, 28, 80) * 7.2;
  const edgeRise = THREE.MathUtils.smoothstep(Math.abs(x), 48, 90) * 5.8;
  const valleyTilt = z * 0.018;
  const outerDistance = Math.hypot(x * 0.82, z);
  const outerRelief = THREE.MathUtils.smoothstep(outerDistance, 92, 270)
    * (
      7.5
      + Math.sin(x * 0.018 + z * 0.011) * 2.6
      + Math.cos(z * 0.021 - x * 0.008) * 1.8
    );
  return rollingGround + northRise + edgeRise + valleyTilt + outerRelief;
}

function copyAttributeArray(
  geometry: THREE.BufferGeometry,
  name: string,
): number[] {
  return Array.from(
    (geometry.getAttribute(name) as THREE.BufferAttribute).array,
  );
}

function geometryStructureSignature(geometry: THREE.BufferGeometry) {
  return {
    vertices: geometry.getAttribute('position').count,
    indices: geometry.index?.count ?? 0,
    attributes: Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        {
          count: attribute.count,
          itemSize: attribute.itemSize,
          bytes: attribute.array.byteLength,
        },
      ]),
    ),
  };
}

function assertNear(
  actual: number,
  expected: number,
  tolerance = 1e-9,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} must remain within ${tolerance} of ${expected}`,
  );
}
