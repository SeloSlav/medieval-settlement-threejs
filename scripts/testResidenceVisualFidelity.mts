import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  HAMLET_FIXTURE_SEED,
  HAMLET_RESIDENCE_VIEW_NEAREST_NEIGHBOR,
  HAMLET_RESIDENCE_VIEW_SUBJECT,
  HAMLET_VIEW_SPECS,
} from '../src/e2e/hamletFixtureConfig.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { pickResidenceAppearance } from '../src/residences/residenceAppearance.ts';

const seeds = [0, 1, 2, 7, 19, 101] as const;

for (const seed of seeds) {
  const residence = createResidenceMesh(seed, 1);
  const duplicate = createResidenceMesh(seed, 1);
  const bounds = new THREE.Box3().setFromObject(residence);
  const size = bounds.getSize(new THREE.Vector3());

  assert.equal(residence.userData.residenceRoof, 'brown');
  assert.ok(
    Number(residence.userData.residenceRoofPitchDegrees) >= 50,
    'tier-one cottages need a steep, wet-snow-shedding roof pitch',
  );
  assert.ok(
    Number(residence.userData.residenceRoofOverhangMeters) >= 0.5,
    'tier-one cottages need deep weatherproof eaves',
  );
  assert.ok(size.y > size.x * 0.84, 'tier-one silhouette should read tall and steep, not squat');

  assertNamedPart(residence, 'Residence limestone plinth');
  assertNamedPart(residence, 'Residence limestone plinth cap');
  assertNamedPart(residence, 'Residence hand-hewn timber wall core');
  assertNamedPart(residence, 'Residence limewashed plaster infill shell');
  assertNamedPart(residence, 'Residence hand-hewn wall courses and notched corners');
  assertNamedPart(residence, 'Residence ventilated timber gable screen');
  assertNamedPart(residence, 'Residence shadowed plank door aperture');
  assertNamedPart(residence, 'Residence door iron latch');
  assertNamedPart(residence, 'Residence deep-eave door canopy roof');
  assert.equal(
    residence.userData.residenceYardWork,
    undefined,
    'residence yards must not retain the removed axe/chopping-block marker',
  );

  assert.equal(
    residence.userData.residenceYardDetail,
    undefined,
    'tier-one cottages must keep the front-window wall clear of freestanding props',
  );
  assertResidenceFrontWallHasNoYardDetail(residence);
  assertResidenceYardHasNoChoppingBlock(residence);
  assertSideWindowClearance(residence, 1);

  const roofSurfaces = collectRoofSurfaces(residence);
  const roofFieldSurfaces = collectRoofFieldSurfaces(residence);
  const roofEdgeSurfaces = collectRoofEdgeSurfaces(residence);
  assert.ok(
    roofSurfaces.length >= 12,
    'main, course, canopy, ridge, rake, and eave roof surfaces must be audited',
  );
  assert.deepEqual(
    new Set(roofFieldSurfaces.map(materialName)),
    new Set(['Shared building material: shingle']),
    'the accepted main roof planes, split courses, and canopy must stay on the exact shared shingle surface',
  );
  assert.equal(
    new Set(roofFieldSurfaces.map((mesh) => mesh.material)).size,
    1,
    'main pre-tile roof roles must share one material instance without a field permutation',
  );
  assert.deepEqual(
    new Set(roofEdgeSurfaces.map(materialName)),
    new Set(['Shared building material: timberWeathered']),
    'ridge, rake, and fascia boards must use the existing desaturated weathered-wood surface',
  );
  assert.equal(
    new Set(roofEdgeSurfaces.map((mesh) => mesh.material)).size,
    1,
    'crafted roof edges must share one weathered-timber material instance',
  );
  assert.ok(
    roofSurfaces.some((mesh) => mesh.name.includes('split-wood shingle courses')),
    'wood roofs need merged, overlapping shingle-course geometry',
  );
  assertSplitShingleWeathering(residence);
  assertWarmShingleBackFaceFinish(residence);
  assertWeatheredRoofEdgeCraft(residence);
  assertResidenceValueSeparation(residence);

  const budget = visibleBudget(residence);
  assert.ok(
    budget.meshes <= 56,
    `tier-one active draw-bearing mesh budget exceeded (${budget.meshes} > 56)`,
  );
  assert.ok(
    budget.triangles <= 3_200,
    `tier-one active triangle budget exceeded (${budget.triangles} > 3,200)`,
  );
  assert.ok(
    budget.materials <= 10,
    `tier-one active material budget exceeded (${budget.materials} > 10)`,
  );
  assert.equal(
    budget.unsharedMaterials,
    1,
    'only the independently animated window material may be per-residence',
  );

  assert.deepEqual(
    staticSignature(residence),
    staticSignature(duplicate),
    'the same seed must reproduce exactly the same static residence construction',
  );
}

for (const tier of [1, 2, 3] as const) {
  for (let seed = 0; seed < 64; seed += 1) {
    assert.equal(
      pickResidenceAppearance(seed).roof,
      'brown',
      'without explicit physical per-residence retrofit state, appearance must stay wood',
    );
    const residence = createResidenceMesh(seed, tier);
    assertSideWindowClearance(residence, tier);
    assert.equal(
      residence.userData.residenceRoof,
      'brown',
      'current residence construction must expose no global fired-tile unlock',
    );
    assert.deepEqual(
      new Set(collectRoofFieldSurfaces(residence).map(materialName)),
      new Set(['Shared building material: shingle']),
      'every current residence main roof field must remain on the exact shared shingle surface',
    );
    assert.deepEqual(
      new Set(collectRoofEdgeSurfaces(residence).map(materialName)),
      new Set(['Shared building material: timberWeathered']),
      'every current residence ridge, rake, and fascia must remain explicit weathered wood',
    );
    assert.deepEqual(
      new Set(collectRoofSurfaces(residence).map(materialName)),
      new Set([
        'Shared building material: shingle',
        'Shared building material: timberWeathered',
      ]),
      'residences must expose only split-shingle and weathered-timber roof surfaces until a physical per-home tile retrofit exists',
    );
  }
}

assertResidenceCameraContract();

console.log(
  `residence visual-fidelity checks passed (${seeds.length} deterministic cottages, clear front-window walls, isolated 16:9 judge)`,
);

function assertNamedPart(root: THREE.Object3D, name: string): void {
  assert.ok(root.getObjectByName(name), `missing structural/material judge: ${name}`);
}

function assertResidenceYardHasNoChoppingBlock(root: THREE.Object3D): void {
  root.traverse((object) => {
    assert.equal(
      object.userData.residenceYardWork,
      undefined,
      `${object.name || object.type} must not retain removed axe/stump geometry metadata`,
    );
    assert.doesNotMatch(
      object.name,
      /axe|stump|chopping[- ]block/i,
      'the residence model must not contain a front-yard axe or stump mesh',
    );
  });
}

function assertResidenceFrontWallHasNoYardDetail(root: THREE.Object3D): void {
  root.traverse((object) => {
    assert.equal(
      object.userData.residenceYardDetail,
      undefined,
      `${object.name || object.type} must not retain the removed front-window prop metadata`,
    );
    assert.doesNotMatch(
      object.name,
      /Residence lived-in yard detail:/i,
      'tier-one cottages must not place a bench, drying rail, or kindling rack under the front window',
    );
  });
}

function assertSideWindowClearance(
  root: THREE.Object3D,
  tier: 1 | 2 | 3,
): void {
  const panes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name === 'Residence side window pane') {
      panes.push(object);
    }
  });
  assert.equal(
    panes.length,
    tier === 1 ? 2 : 4,
    `tier-${tier} must retain one side-window pane per wall and storey`,
  );
  assert.ok(
    panes.every((pane) => Math.abs(Math.abs(pane.position.z) - 1.25) <= 1e-9),
    'side windows must sit 1.25 m from the center posts',
  );
  assert.deepEqual(
    new Set(panes.map((pane) => Math.sign(pane.position.z))),
    tier === 1 ? new Set([-1]) : new Set([-1, 1]),
    'higher tiers must split their lower and upper side windows across the center post',
  );
  const widestPane = Math.max(
    ...panes.map((pane) => (pane.geometry as THREE.BoxGeometry).parameters.depth),
  );
  const openShutterClearance = 1.25
    - widestPane * 0.5
    - 0.08 // casing beyond the aperture
    - widestPane * 0.5 // one half-window-wide shutter folded flat
    - 0.075; // half of the 0.15 m center post
  assert.ok(
    openShutterClearance >= 0.3,
    `open side shutters need roughly 0.33 m of visual clearance (${openShutterClearance.toFixed(3)} m)`,
  );
}

function collectRoofSurfaces(root: THREE.Object3D): THREE.Mesh[] {
  const surfaces: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.residenceRoofSurface === true) {
      surfaces.push(object);
    }
  });
  return surfaces;
}

function collectRoofFieldSurfaces(root: THREE.Object3D): THREE.Mesh[] {
  return collectRoofSurfaces(root).filter(
    (mesh) => mesh.userData.residenceRoofEdgeRole === undefined,
  );
}

function collectRoofEdgeSurfaces(root: THREE.Object3D): THREE.Mesh[] {
  return collectRoofSurfaces(root).filter(
    (mesh) => mesh.userData.residenceRoofEdgeRole !== undefined,
  );
}

function materialName(mesh: THREE.Mesh): string {
  assert.equal(Array.isArray(mesh.material), false, `${mesh.name} should use one shared roof material`);
  return (mesh.material as THREE.Material).name;
}

function assertWeatheredRoofEdgeCraft(root: THREE.Object3D): void {
  assert.equal(root.userData.residenceRoofEdgeFinish, 'muted-weathered-wood');
  assert.equal(root.userData.residenceRoofEdgeVariantCount, 4);
  const edges = collectRoofEdgeSurfaces(root);
  assert.equal(edges.length, 7, 'one ridge, four rake, and two fascia meshes must replace the mechanical edge bars');
  const roles = edges.reduce<Record<string, number>>((counts, mesh) => {
    const role = String(mesh.userData.residenceRoofEdgeRole);
    counts[role] = (counts[role] ?? 0) + 1;
    assert.equal(mesh.userData.residenceRoofFinish, 'weathered-split-wood-edge');
    assert.equal(mesh.userData.residenceRoofEdgeVariantPalette, 'muted-weathered-wood-4');
    return counts;
  }, {});
  assert.deepEqual(roles, {
    ridge: 1,
    'gable-rake': 4,
    'eave-fascia': 2,
  });
  const ridge = edges.find((mesh) => mesh.userData.residenceRoofEdgeRole === 'ridge');
  assert.ok(ridge, 'segmented weathered-wood ridge must remain visible');
  assert.equal(ridge.userData.residenceRoofEdgePartCount, 3);
  for (const rake of edges.filter((mesh) => mesh.userData.residenceRoofEdgeRole === 'gable-rake')) {
    assert.equal(rake.userData.residenceRoofEdgePartCount, 2);
    assert.equal(rake.userData.residenceRoofEdgeButtGapMeters, 0.026);
  }
  for (const fascia of edges.filter((mesh) => mesh.userData.residenceRoofEdgeRole === 'eave-fascia')) {
    assert.equal(fascia.userData.residenceRoofEdgePartCount, 3);
    assert.equal(fascia.userData.residenceRoofEdgeButtGapMeters, 0.02);
    assert.ok(
      Number(fascia.userData.residenceRoofEdgeVerticalVariationMeters) >= 0.02,
      'fascia segments must interrupt the ruler-straight lower edge',
    );
  }

  const tints = new Set<string>();
  let edgeTriangles = 0;
  for (const edge of edges) {
    const colors = edge.geometry.getAttribute('color');
    assert.ok(colors, `${edge.name} must carry deterministic weathered-wood variants`);
    for (let index = 0; index < colors.count; index += 1) {
      tints.add(
        [
          colors.getX(index).toFixed(3),
          colors.getY(index).toFixed(3),
          colors.getZ(index).toFixed(3),
        ].join(','),
      );
    }
    const positions = edge.geometry.getAttribute('position');
    edgeTriangles += edge.geometry.index
      ? edge.geometry.index.count / 3
      : positions.count / 3;
  }
  assert.equal(tints.size, 4, 'roof edge craft must use exactly four bounded muted wood tints');
  assert.equal(
    edgeTriangles,
    94,
    'open-backed segmented edge craft must stay within the exact 94-triangle contract',
  );
}

function assertResidenceValueSeparation(root: THREE.Object3D): void {
  const plaster = namedMesh(root, 'Residence limewashed plaster infill shell');
  const stone = namedMesh(root, 'Residence limestone plinth');
  const aperture = namedMesh(root, 'Residence shadowed plank door aperture');
  const roofPlane = namedMesh(root, 'Residence main roof plane left');
  const exposedRoof = roofMeshContaining(root, 'split-wood shingle courses');
  const structuralTimber = namedMesh(
    root,
    'Residence hand-hewn wall courses and notched corners',
  );
  const plasterLuma = materialLinearLuma(plaster);
  const stoneLuma = materialLinearLuma(stone);
  const apertureLuma = materialLinearLuma(aperture);
  const roofPlaneLuma = materialLinearLuma(roofPlane);
  const exposedRoofLuma = materialLinearLuma(exposedRoof);
  const structuralTimberLuma = materialLinearLuma(structuralTimber);

  assert.ok(plasterLuma >= 0.85, `lime plaster must remain a bright exposure anchor (${plasterLuma.toFixed(3)})`);
  assert.ok(stoneLuma >= 0.55, `limestone must remain readable under production exposure (${stoneLuma.toFixed(3)})`);
  assert.ok(apertureLuma <= 0.02, `door aperture must read as a deep shadow (${apertureLuma.toFixed(3)})`);
  assert.ok(
    exposedRoofLuma >= 0.25 && exposedRoofLuma <= 0.31,
    `wood shingles need a restrained silver-brown middle value (${exposedRoofLuma.toFixed(3)})`,
  );
  assert.ok(
    Math.abs(roofPlaneLuma - exposedRoofLuma) <= 0.001,
    'roof plane and exposed courses must share one authored shingle value',
  );
  assert.ok(
    structuralTimberLuma >= 0.15 && structuralTimberLuma <= 0.35,
    `structural timber must separate from plaster without becoming black (${structuralTimberLuma.toFixed(3)})`,
  );
  assert.ok(plasterLuma - apertureLuma >= 0.8, 'plaster and apertures need decisive value separation');
  assertResidenceMaterialResponse(plaster, {
    role: 'lime-plaster',
    materialName: 'Shared building material: plasterWhite',
    ambientFill: 0.11,
    minimumRoughness: 0.94,
    normalScale: 0.3,
    usesDiffuseMap: false,
  });
  assertResidenceMaterialResponse(stone, {
    role: 'foundation-stone',
    materialName: 'Shared building material: masonryMid',
    ambientFill: 0.11,
    minimumRoughness: 0.95,
    normalScale: 0.82,
    usesDiffuseMap: true,
  });
  assertResidenceMaterialResponse(structuralTimber, {
    role: 'structural-timber',
    materialName: 'Shared building material: timberDark',
    ambientFill: 0.11,
    minimumRoughness: 0.92,
    normalScale: 0.76,
    usesDiffuseMap: true,
  });
  assertResidenceMaterialResponse(exposedRoof, {
    role: 'split-wood-shingle-course',
    materialName: 'Shared building material: shingle',
    ambientFill: 0.11,
    minimumRoughness: 0.98,
    normalScale: 1.05,
    usesDiffuseMap: false,
    weatheringProfile: 'shingle',
    textureFamily: 'woodPlanks',
  });
  assertResidenceMaterialResponse(roofPlane, {
    role: 'split-wood-shingle-plane',
    materialName: 'Shared building material: shingle',
    ambientFill: 0.11,
    minimumRoughness: 0.98,
    normalScale: 1.05,
    usesDiffuseMap: false,
    weatheringProfile: 'shingle',
    textureFamily: 'woodPlanks',
  });
  assertSplitShingleMap(exposedRoof);
}

function assertSplitShingleWeathering(root: THREE.Object3D): void {
  const courseMeshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh
      && object.name.includes('split-wood shingle courses')
    ) {
      courseMeshes.push(object);
    }
  });
  assert.equal(courseMeshes.length, 2, 'both roof slopes need audited split-shingle courses');
  for (const course of courseMeshes) {
    const componentVertexCount =
      course.geometry.userData.buildingWeatheringComponentVertexCount;
    assert.equal(
      componentVertexCount,
      24,
      `${course.name} must retain one independently weathered BoxGeometry vertex block per board`,
    );
    const colors = course.geometry.getAttribute('color');
    assert.ok(colors, `${course.name} must carry shared shingle weathering colors`);
    const positions = course.geometry.getAttribute('position');
    const normals = course.geometry.getAttribute('normal');
    assert.equal(
      course.geometry.userData.residenceRoofCourseOpenGableEnds,
      true,
      `${course.name} must reveal the warm continuous roof backing instead of repeated gable caps`,
    );
    assert.equal(
      course.geometry.index,
      null,
      `${course.name} open board faces must retain a compact non-indexed merge`,
    );
    assert.equal(
      positions.count / 3,
      640,
      `${course.name} must retain exactly four faces and eight triangles per board`,
    );
    let gableEndVertices = 0;
    let topVertices = 0;
    for (let index = 0; index < normals.count; index += 1) {
      if (Math.abs(normals.getZ(index)) >= 0.9) gableEndVertices += 1;
      if (
        normals.getY(index) > 0.5
        && Math.abs(normals.getX(index)) > Math.abs(normals.getY(index))
      ) {
        topVertices += 1;
      }
    }
    assert.equal(
      gableEndVertices,
      0,
      `${course.name} must not rebuild the eight machine-even gable-end bands`,
    );
    assert.equal(
      topVertices / 3,
      160,
      `${course.name} must preserve both accepted top triangles on all eighty boards`,
    );
    const distinctBoardTints = new Set<string>();
    for (
      let index = 0;
      index < colors.count;
      index += componentVertexCount
    ) {
      distinctBoardTints.add(
        [
          colors.getX(index).toFixed(3),
          colors.getY(index).toFixed(3),
          colors.getZ(index).toFixed(3),
        ].join(','),
      );
    }
    assert.ok(
      distinctBoardTints.size >= 8,
      `${course.name} needs restrained per-board silver/brown variation`,
    );
  }
}

function assertWarmShingleBackFaceFinish(root: THREE.Object3D): void {
  const roofFields = collectRoofFieldSurfaces(root);
  const expectedGrainPhases = [
    -0.24,
    -0.15,
    -0.07,
    0,
    0.08,
    0.16,
    0.22,
  ] as const;
  assert.ok(roofFields.length >= 5, 'every accepted shingle field role must be audited');
  for (const field of roofFields) {
    assert.equal(
      field.userData.residenceRoofBackFaceFinish,
      'warm-weathered-gray-brown',
      `${field.name} must keep its exposed backs out of the cold tile palette`,
    );
    assert.equal(
      field.userData.residenceRoofBackFaceGrain,
      'shared-shingle-longitudinal-phase-staggered-calm-strip',
      `${field.name} must reuse the calm shared grain with hand-worked phase breakup`,
    );
    assert.deepEqual(
      field.geometry.userData.residenceRoofBackFaceTint,
      [2.1025, 1.914, 1.682],
      `${field.name} must use the bounded raised warm-wood tint`,
    );

    const position = field.geometry.getAttribute('position');
    const normal = field.geometry.getAttribute('normal');
    const uv = field.geometry.getAttribute('uv');
    const color = field.geometry.getAttribute('color');
    assert.ok(position && normal && uv && color, `${field.name} needs complete face attributes`);
    const calmU = Number(field.geometry.userData.residenceRoofBackFaceUvColumn);
    assert.ok(Math.abs(calmU - 70.5 / 256) <= 1e-7);
    assert.deepEqual(
      field.geometry.userData.residenceRoofBackFacePhaseOffsets,
      expectedGrainPhases,
      `${field.name} must use only the bounded seven-phase calm-strip breakup`,
    );
    let authoredVertices = 0;
    let minimumV = Number.POSITIVE_INFINITY;
    let maximumV = Number.NEGATIVE_INFINITY;
    const authoredGrainPhases = new Set<number>();
    for (let index = 0; index < position.count; index += 1) {
      const isGableBack = Math.abs(normal.getZ(index)) >= 0.9;
      const isUnderside = normal.getY(index) <= -0.9;
      if (!isGableBack && !isUnderside) continue;
      authoredVertices += 1;
      assert.ok(
        Math.abs(uv.getX(index) - calmU) <= 1e-7,
        `${field.name} back faces must avoid the shared map's hard course edges`,
      );
      const grainPhase = uv.getY(index) - position.getX(index) / 2;
      const expectedPhase = expectedGrainPhases.find(
        (phase) => Math.abs(grainPhase - phase) <= 1e-6,
      );
      assert.notEqual(
        expectedPhase,
        undefined,
        `${field.name} back faces must shift only along the accepted calm grain strip`,
      );
      authoredGrainPhases.add(expectedPhase!);
      minimumV = Math.min(minimumV, uv.getY(index));
      maximumV = Math.max(maximumV, uv.getY(index));
      assert.ok(
        color.getX(index) > color.getZ(index),
        `${field.name} back faces must remain warm gray-brown, never cold charcoal`,
      );
    }
    assert.equal(
      authoredVertices,
      field.userData.residenceRoofBackFaceVertexCount,
      `${field.name} must expose an exact face-local material audit count`,
    );
    const hasOpenCourseEnds =
      field.geometry.userData.residenceRoofCourseOpenGableEnds === true;
    assert.equal(
      authoredVertices > 0,
      !hasOpenCourseEnds,
      `${field.name} must author warm backs exactly when exposed back faces remain`,
    );
    assert.equal(
      authoredGrainPhases.size,
      field.userData.residenceRoofBackFacePhaseVariantCount,
      `${field.name} must expose its exact deterministic grain-phase count`,
    );
    if (hasOpenCourseEnds) {
      assert.equal(
        authoredGrainPhases.size,
        0,
        `${field.name} must leave its omitted gable ends to the warm backing plane`,
      );
    } else {
      assert.ok(
        authoredGrainPhases.size >= 3,
        `${field.name} needs coarse phase breakup across its gable and underside faces`,
      );
      assert.ok(
        maximumV - minimumV >= 0.4,
        `${field.name} needs visible longitudinal split grain`,
      );
    }
  }

  const rightCourses = namedMesh(
    root,
    'Residence split-wood shingle courses right',
  );
  const rightCourseNormal = rightCourses.geometry.getAttribute('normal');
  assert.equal(
    Array.from(
      { length: rightCourseNormal.count },
      (_, index) => Math.abs(rightCourseNormal.getZ(index)) >= 0.9,
    ).some(Boolean),
    false,
    'the visible right-gable courses must leave no repeated end-cap banding',
  );

  const rightPlane = namedMesh(root, 'Residence main roof plane right');
  const rightPlanePosition = rightPlane.geometry.getAttribute('position');
  const rightPlaneNormal = rightPlane.geometry.getAttribute('normal');
  const rightPlaneUv = rightPlane.geometry.getAttribute('uv');
  const rightPlaneGableGrainPhases = new Set<number>();
  for (let index = 0; index < rightPlanePosition.count; index += 1) {
    if (rightPlaneNormal.getZ(index) < 0.9) continue;
    const grainPhase =
      rightPlaneUv.getY(index) - rightPlanePosition.getX(index) / 2;
    const expectedPhase = expectedGrainPhases.find(
      (phase) => Math.abs(grainPhase - phase) <= 1e-6,
    );
    assert.notEqual(expectedPhase, undefined);
    rightPlaneGableGrainPhases.add(expectedPhase!);
  }
  assert.equal(
    rightPlaneGableGrainPhases.size,
    4,
    'the visible right-gable roof slab must warp its calm grain across four coarse hand-worked corner phases',
  );

  const mainPlane = namedMesh(root, 'Residence main roof plane left');
  const mainPosition = mainPlane.geometry.getAttribute('position');
  const mainNormal = mainPlane.geometry.getAttribute('normal');
  const mainUv = mainPlane.geometry.getAttribute('uv');
  let acceptedTopVertices = 0;
  for (let index = 0; index < mainPosition.count; index += 1) {
    if (mainNormal.getY(index) < 0.9) continue;
    acceptedTopVertices += 1;
    assert.ok(
      Math.abs(mainUv.getX(index) - mainPosition.getX(index) / 2) <= 1e-7
        && Math.abs(mainUv.getY(index) + mainPosition.getZ(index) / 2) <= 1e-7,
      'the accepted main roof field UVs must remain byte-for-byte on their metric projection',
    );
  }
  assert.equal(acceptedTopVertices, 4);

  assert.equal(Array.isArray(mainPlane.material), false);
  const material = mainPlane.material as THREE.MeshStandardMaterial;
  assert.ok(material.map instanceof THREE.DataTexture);
  const pixels = material.map.image.data as Uint8Array;
  const width = material.map.image.width;
  const height = material.map.image.height;
  const column = Math.floor((70.5 / 256) * width);
  let calmDarkest = 255;
  let calmLightest = 0;
  let fullDarkest = 255;
  for (let index = 0; index < pixels.length; index += 4) {
    fullDarkest = Math.min(fullDarkest, pixelLuma(pixels, index));
  }
  for (let row = 0; row < height; row += 1) {
    const luma = pixelLuma(pixels, (row * width + column) * 4);
    calmDarkest = Math.min(calmDarkest, luma);
    calmLightest = Math.max(calmLightest, luma);
  }
  assert.ok(
    calmDarkest >= 120 && calmDarkest - fullDarkest >= 45,
    `back-face joints must be materially softer than top-field cuts (${calmDarkest.toFixed(1)} vs ${fullDarkest.toFixed(1)})`,
  );
  assert.ok(
    calmLightest - calmDarkest >= 80,
    'the calm shared-map strip must retain readable longitudinal grain variation',
  );
}

function pixelLuma(pixels: Uint8Array, index: number): number {
  return pixels[index] * 0.2126
    + pixels[index + 1] * 0.7152
    + pixels[index + 2] * 0.0722;
}

function assertResidenceCameraContract(): void {
  const view = HAMLET_VIEW_SPECS.find((candidate) => candidate.id === 'residence');
  assert.ok(view, 'fixture must expose the deterministic residence judge');
  const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.1, 500);
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const subject = createFixtureResidence(HAMLET_RESIDENCE_VIEW_SUBJECT);
  const neighbor = createFixtureResidence(HAMLET_RESIDENCE_VIEW_NEAREST_NEIGHBOR);
  const subjectFrame = projectedBounds(
    subject,
    camera,
  );
  const neighborFrame = projectedBounds(neighbor, camera);

  assert.ok(
    subjectFrame.minX >= -0.85
      && subjectFrame.maxX <= 0.85
      && subjectFrame.minY >= -0.98
      && subjectFrame.maxY <= 0.98,
    `residence judge must preserve the full silhouette (${JSON.stringify(subjectFrame)})`,
  );
  assert.ok(
    subjectFrame.maxX - subjectFrame.minX >= 1
      && subjectFrame.maxY - subjectFrame.minY >= 1.6,
    `residence judge must devote useful frame area to its subject (${JSON.stringify(subjectFrame)})`,
  );
  assert.ok(
    neighborFrame.maxX < -1.2,
    `nearest residence must stay fully outside the judge frame (${JSON.stringify(neighborFrame)})`,
  );
}

type FixtureResidenceTransform = {
  residenceIndex: number;
  position: readonly [number, number, number];
  yaw: number;
};

function createFixtureResidence(transform: FixtureResidenceTransform): THREE.Group {
  const seed = (
    HAMLET_FIXTURE_SEED
    ^ Math.imul(transform.residenceIndex + 1, 0x45d9f3b)
  ) >>> 0;
  const residence = createResidenceMesh(seed, 1);
  residence.position.set(...transform.position);
  residence.rotation.y = transform.yaw;
  residence.updateMatrixWorld(true);
  return residence;
}

function projectedBounds(
  root: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  include: (mesh: THREE.Mesh) => boolean = () => true,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const frame = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh)
      || !visibleInHierarchy(object)
      || !include(object)
    ) {
      return;
    }
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) {
      const projected = new THREE.Vector3(
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      )
        .applyMatrix4(object.matrixWorld)
        .project(camera);
      frame.minX = Math.min(frame.minX, projected.x);
      frame.maxX = Math.max(frame.maxX, projected.x);
      frame.minY = Math.min(frame.minY, projected.y);
      frame.maxY = Math.max(frame.maxY, projected.y);
    }
  });
  assert.ok(Number.isFinite(frame.minX), 'camera subject must contain visible geometry');
  return frame;
}

function assertResidenceMaterialResponse(
  mesh: THREE.Mesh,
  expected: {
    role: string;
    materialName: string;
    ambientFill: number;
    minimumRoughness: number;
    normalScale: number;
    usesDiffuseMap: boolean;
    weatheringProfile?: string;
    textureFamily?: string;
  },
): void {
  assert.equal(Array.isArray(mesh.material), false, `${mesh.name} must use one material`);
  const material = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(material.name, expected.materialName);
  assert.equal(
    material.userData.buildingUsesDiffuseMap,
    expected.usesDiffuseMap,
    `${expected.role} diffuse-map policy must be explicit`,
  );
  assert.equal(
    material.userData.buildingUniformIndirectLight,
    true,
    `${expected.role} indirect fill must not be darkened by its diffuse texture`,
  );
  if (expected.weatheringProfile) {
    assert.equal(
      material.userData.buildingWeatheringProfile,
      expected.weatheringProfile,
      `${expected.role} must use its dedicated weathering profile`,
    );
  }
  if (expected.textureFamily) {
    assert.equal(
      material.userData.buildingTextureFamily,
      expected.textureFamily,
      `${expected.role} must retain its shared texture source`,
    );
  }
  assert.ok(
    Math.abs(material.emissiveIntensity - expected.ambientFill) <= 0.001,
    `${expected.role} production ambient fill must remain ${expected.ambientFill.toFixed(2)} ±0.001 (got ${material.emissiveIntensity.toFixed(3)})`,
  );
  assert.ok(
    material.roughness >= expected.minimumRoughness,
    `${expected.role} must retain a matte weathered response`,
  );
  assert.ok(
    Math.abs(material.normalScale.x - expected.normalScale) < 0.001
      && Math.abs(material.normalScale.y - expected.normalScale) < 0.001,
    `${expected.role} normal strength must remain authored`,
  );
}

function assertSplitShingleMap(mesh: THREE.Mesh): void {
  assert.equal(Array.isArray(mesh.material), false, `${mesh.name} must use one material`);
  const material = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(
    material.userData.buildingUsesProceduralShingleMap,
    true,
    'the shared shingle surface must use its deterministic short-shingle albedo',
  );
  assert.ok(
    material.map instanceof THREE.DataTexture,
    'the shingle pattern must remain one shared procedural data texture',
  );
  assert.equal(material.map.name, 'Procedural split-wood shingles');
  assert.equal(material.map.image.width, 256);
  assert.equal(material.map.image.height, 256);
  assert.equal(material.map.wrapS, THREE.RepeatWrapping);
  assert.equal(material.map.wrapT, THREE.RepeatWrapping);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.deepEqual(
    material.userData.splitShinglePattern,
    {
      tileMeters: 2,
      courseExposureMeters: 1 / 3,
      shingleWidthMeters: 0.4,
      buttLengthVariation: 0.1,
      stagger: 'alternating-half-width',
      details: [
        'butt-joints',
        'irregular-lower-edges',
        'longitudinal-split-grain',
      ],
    },
    'the shared roof map must retain short staggered split-shingle proportions',
  );

  const pixels = material.map.image.data as Uint8Array;
  let darkest = 255;
  let lightest = 0;
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luma =
      pixels[index] * 0.2126
      + pixels[index + 1] * 0.7152
      + pixels[index + 2] * 0.0722;
    darkest = Math.min(darkest, luma);
    lightest = Math.max(lightest, luma);
    if (luma < 145) darkPixels += 1;
  }
  const pixelCount = pixels.length / 4;
  assert.ok(
    darkest <= 75,
    `butt and lower-edge cuts need deep definition (${darkest.toFixed(1)})`,
  );
  assert.ok(
    lightest >= 220,
    `weathered shingle faces need readable midtones (${lightest.toFixed(1)})`,
  );
  assert.ok(
    darkPixels / pixelCount >= 0.04 && darkPixels / pixelCount <= 0.25,
    `dark joints must remain legible but restrained (${(darkPixels / pixelCount * 100).toFixed(1)}%)`,
  );
}

function namedMesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = root.getObjectByName(name);
  assert.ok(object instanceof THREE.Mesh, `missing material-value judge: ${name}`);
  return object;
}

function roofMeshContaining(root: THREE.Object3D, text: string): THREE.Mesh {
  let match: THREE.Mesh | undefined;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.includes(text)) match ??= object;
  });
  assert.ok(match, `missing roof material-value judge containing: ${text}`);
  return match;
}

function materialLinearLuma(mesh: THREE.Mesh): number {
  assert.equal(Array.isArray(mesh.material), false, `${mesh.name} must use one material`);
  const material = mesh.material as THREE.Material & { color?: THREE.Color };
  assert.ok(material.color, `${mesh.name} material must expose a color`);
  return material.color.r * 0.2126
    + material.color.g * 0.7152
    + material.color.b * 0.0722;
}

function visibleBudget(root: THREE.Object3D): {
  meshes: number;
  triangles: number;
  materials: number;
  unsharedMaterials: number;
} {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  const unsharedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !visibleInHierarchy(object)) return;
    meshes += 1;
    const positions = object.geometry.getAttribute('position');
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : (positions?.count ?? 0) / 3;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      if (material.userData.sharedBuildingMaterial !== true) {
        unsharedMaterials.add(material);
      }
    }
  });
  return {
    meshes,
    triangles,
    materials: materials.size,
    unsharedMaterials: unsharedMaterials.size,
  };
}

function visibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function staticSignature(root: THREE.Object3D): unknown[] {
  const signature: unknown[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    signature.push({
      name: object.name,
      parent: object.parent?.name ?? '',
      visible: object.visible,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
      vertices: positions?.count ?? 0,
      indices: object.geometry.index?.count ?? 0,
      materials: (Array.isArray(object.material) ? object.material : [object.material]).map(
        (material) => material.name,
      ),
    });
  });
  return signature;
}
