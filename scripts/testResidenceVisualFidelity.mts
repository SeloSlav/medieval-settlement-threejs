import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  HAMLET_FIXTURE_SEED,
  HAMLET_RESIDENCE_VIEW_NEAREST_NEIGHBOR,
  HAMLET_RESIDENCE_VIEW_SUBJECT,
  HAMLET_VIEW_SPECS,
} from '../src/e2e/hamletFixtureConfig.ts';
import {
  disposeBuildingMaterialLibrary,
  getBuildingMaterialLibraryStats,
  sharedBuildingMaterial,
} from '../src/buildings/buildingMaterials.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { pickResidenceAppearance } from '../src/residences/residenceAppearance.ts';

const seeds = [0, 1, 2, 7, 19, 101] as const;
const appearanceSweep = Array.from({ length: 64 }, (_, seed) => pickResidenceAppearance(seed));

assert.equal(new Set(appearanceSweep.map((appearance) => appearance.roofTone)).size, 3);
assert.equal(new Set(appearanceSweep.map((appearance) => appearance.footprint)).size, 3);
assert.equal(new Set(appearanceSweep.map((appearance) => appearance.tierThreeFeature)).size, 3);
assert.equal(new Set(appearanceSweep.map((appearance) => appearance.tierTwoUpperFinish)).size, 2);
assert.equal(new Set(appearanceSweep.map((appearance) => (
  JSON.stringify(appearance.tierOneWalls)
))).size, 5);
assert.deepEqual(
  new Set(appearanceSweep.map((appearance) => appearance.tierFourGablePosition)),
  new Set([-1, 0, 1]),
);

for (const seed of seeds) {
  const appearance = pickResidenceAppearance(seed);
  const residence = createResidenceMesh(seed, 1);
  const duplicate = createResidenceMesh(seed, 1);
  const bounds = new THREE.Box3().setFromObject(residence);
  const size = bounds.getSize(new THREE.Vector3());

  assert.equal(residence.userData.residenceRoof, 'brown');
  assert.ok(
    Number(residence.userData.residenceRoofPitchDegrees) >= 47 - 1e-9,
    'tier-one cottages need a steep, wet-snow-shedding roof pitch',
  );
  assert.ok(
    Number(residence.userData.residenceRoofOverhangMeters) >= 0.5,
    'tier-one cottages need deep weatherproof eaves',
  );
  assert.ok(size.y > size.x * 0.8, 'tier-one silhouette should read compact and steep, not squat');
  assert.equal(residence.userData.residenceRoofFinish, 'split-wood-shingle');
  assert.equal(
    residence.userData.residenceRoofTierContract,
    'tier-1-earth-toned-split-softwood-shingle',
  );
  assert.equal(residence.userData.residenceRoofTone, appearance.roofTone);
  assert.equal(residence.userData.residenceFootprintProfile, appearance.footprint);

  assertNamedPart(residence, 'Residence low rubble fieldstone footing');
  assertNamedPart(residence, 'Residence tier-one wall shell with true apertures');
  assertNamedPart(residence, 'Residence hand-hewn sill post and brace frame');
  assertNamedPart(residence, 'Residence rough kingpost and collar gables');
  assertNamedPart(residence, 'Residence shadowed plank door aperture');
  assertNamedPart(residence, 'Residence visible timber plank door leaf');
  assertNamedPart(residence, 'Residence door iron latch');
  assert.equal(
    residence.getObjectByName('Residence deep-eave door canopy roof'),
    undefined,
    'the deep front shingle verge must shelter the doorway without a modern-looking canopy slab',
  );
  assert.equal(
    residence.getObjectByName('Residence raised stone entrance stair'),
    undefined,
    'the low rubble footing must keep the cottage threshold at packed-earth level',
  );
  assertNoLegacyOpeningCrosses(residence);
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
  assert.equal(
    residence.getObjectByName('UpgradeCoinLockbox'),
    undefined,
    'residence works must not stage an isolated wooden lockbox in the backyard',
  );
  assertResidenceFrontWallHasNoYardDetail(residence);
  assertResidenceYardHasNoChoppingBlock(residence);
  assertSideWindowOpeningClearance(residence, 1);
  assertTierOneWindowCutouts(residence);
  assertTierOneWallVariation(residence, appearance.tierOneWalls);
  assertTierOneFacadeTimbers(residence);
  assertTierOneRoofSmokeContract(residence);
  assertJoinedSemanticResidenceRoof(residence, 1);

  const roofSurfaces = collectRoofSurfaces(residence);
  const roofFieldSurfaces = collectRoofFieldSurfaces(residence);
  const roofEdgeSurfaces = collectRoofEdgeSurfaces(residence);
  assert.ok(
    roofSurfaces.length >= 10,
    'joined shingle backing, courses, ridge, rakes, and eave fascia must all be audited',
  );
  assert.deepEqual(
    new Set(roofFieldSurfaces.map(materialName)),
    new Set(['Shared building material: shingle']),
    'the cottage roof backing and courses must share the split-shingle surface',
  );
  assert.equal(
    new Set(roofFieldSurfaces.map((mesh) => mesh.material)).size,
    1,
    'tier-one shingle roles must share one material instance without a field permutation',
  );
  assert.deepEqual(
    new Set(roofEdgeSurfaces.map(materialName)),
    new Set(['Shared building material: timberWeathered']),
    'the ridge, rake, and eave dressing must be explicit weathered wood',
  );
  assert.equal(
    new Set(roofEdgeSurfaces.map((mesh) => mesh.material)).size,
    1,
    'all dressed shingle edges must share the same weathered timber material instance',
  );
  assert.ok(
    roofSurfaces.some((mesh) => mesh.name.includes('split-wood shingle courses')),
    'tier-one roofs need explicit irregular overlapping split-shingle courses',
  );
  assertSplitShingleWeathering(residence);
  assertResidenceValueSeparation(residence);
  assertSplitShingleMap(namedMesh(residence, 'Residence joined semantic main roof'));

  const budget = visibleBudget(residence);
  assert.ok(
    budget.meshes <= 130,
    `tier-one pre-batch mesh budget exceeded (${budget.meshes} > 130)`,
  );
  assert.ok(
    budget.triangles <= 4_000,
    `tier-one active triangle budget exceeded (${budget.triangles} > 4,000)`,
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

const auditedWoodResidence = createResidenceMesh(7, 2);
assertSplitShingleWeathering(auditedWoodResidence);
assertWarmShingleBackFaceFinish(auditedWoodResidence);
assertNamedPart(auditedWoodResidence, 'Residence door hewn jamb');
assertNamedPart(auditedWoodResidence, 'Residence door hewn lintel');
assertNamedPart(auditedWoodResidence, 'Residence door threshold');

for (const tier of [1, 2, 3, 4] as const) {
  for (let seed = 0; seed < 64; seed += 1) {
    const appearance = pickResidenceAppearance(seed);
    assert.equal(
      appearance.roof,
      'brown',
      'the appearance seed remains deterministic independently of the tier roof contract',
    );
    const residence = createResidenceMesh(seed, tier);
    if (tier === 1) {
      assertTierOneWallVariation(residence, appearance.tierOneWalls);
      assert.ok(
        Number(residence.userData.residenceRoofPitchDegrees) >= 47 - 1e-9,
        'even broad-footprint cottages must retain a steep weather roof',
      );
    }
    assertSideWindowOpeningClearance(residence, tier);
    assertJoinedSemanticResidenceRoof(residence, tier);
    assert.equal(
      residence.userData.residenceRoof,
      'brown',
      'the palette seed should remain stable across tier model changes',
    );
    assert.equal(residence.userData.residenceRoofTone, appearance.roofTone);
    assert.equal(
      residence.userData.residenceBuildingPlan.appearance.roofTone,
      appearance.roofTone,
    );
    const expectedFieldMaterial = tier === 4
        ? 'Shared building material: clayDark'
        : 'Shared building material: shingle';
    assert.deepEqual(
      new Set(collectRoofFieldSurfaces(residence).map(materialName)),
      new Set([expectedFieldMaterial]),
      `tier-${tier} must use its authored shared roof field`,
    );
    const expectedEdgeMaterial = 'Shared building material: timberWeathered';
    assert.deepEqual(
      new Set(collectRoofEdgeSurfaces(residence).map(materialName)),
      new Set([expectedEdgeMaterial]),
      'ridge, rake, and fascia craft must remain explicit weathered wood',
    );
    assert.deepEqual(
      new Set(collectRoofSurfaces(residence).map(materialName)),
      new Set([expectedFieldMaterial, 'Shared building material: timberWeathered']),
      `tier-${tier} roof fields and crafted timber edges must remain explicitly separated`,
    );
    assert.equal(
      residence.userData.residenceRoofFinish,
      tier === 4 ? 'fired-clay-tile' : 'split-wood-shingle',
    );
    assert.equal(residence.userData.residenceBuildingPlan.tier, tier);
    for (const field of collectRoofFieldSurfaces(residence)) {
      assert.equal(field.userData.residenceRoofTone, appearance.roofTone);
      assert.deepEqual(
        field.geometry.userData.residenceRoofToneTint,
        tier === 4
          ? firedClayTint(appearance.roofTone)
          : shingleTint(appearance.roofTone),
      );
    }
    if (tier === 2) {
      const upperWall = namedMesh(residence, 'Residence upper wall core');
      assert.equal(residence.userData.residenceTierTwoUpperFinish, appearance.tierTwoUpperFinish);
      if (appearance.tierTwoUpperFinish === 'boarded') {
        assert.equal(materialName(upperWall), 'Shared building material: timberWeathered');
        assertNamedPart(residence, 'Residence tier-two boarded upper-storey frame');
      } else {
        assert.match(materialName(upperWall), /plaster/);
      }
    }
    if (tier === 3) assertTierThreeFeature(residence, appearance.tierThreeFeature);
    if (tier === 4) {
      assert.equal(residence.userData.residenceTiledRoof, true);
      assertNamedPart(residence, 'Residence tier-four cross-gable mass');
      assertNamedPart(residence, 'Residence tier-four ashlar upper-storey corner pier');
      const gable = residence.getObjectByName('Residence tier-four cross-gable feature');
      assert.equal(gable?.userData.residenceTierFourGablePosition, appearance.tierFourGablePosition);
    }
  }
}

assertResidenceCameraContract();
assertBuildingMaterialLifecycle();

console.log(
  `residence visual-fidelity checks passed (64 seeds × 4 tiers, ${seeds.length} duplicate cottage checks, mixed wall plans, earthy roofs, distinct tier features, open apertures, roof smoke, isolated 16:9 judge)`,
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

function assertNoLegacyOpeningCrosses(root: THREE.Object3D): void {
  root.traverse((object) => {
    assert.doesNotMatch(
      object.name,
      /Residence (?:front|side) window (?:vertical mullion|horizontal transom)|Residence door cross brace/,
      'residence doors and windows must not retain generic cross-shaped bars',
    );
    if (object.userData.facadeOpeningKind === 'door' || object.userData.facadeOpeningKind === 'window') {
      assert.equal(object.userData.hasCrossBars, false);
    }
  });
}

function assertSideWindowOpeningClearance(
  root: THREE.Object3D,
  tier: 1 | 2 | 3 | 4,
): void {
  const openings: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (
      object.userData.facadeOpeningKind === 'window'
      && object.userData.facadeOpeningFace !== 'positive-z'
    ) {
      openings.push(object);
    }
  });
  assert.equal(
    openings.length,
    tier === 1 ? 2 : 4,
    `tier-${tier} must retain one side-window opening per wall and storey`,
  );
  assert.ok(
    openings.every((opening) => {
      const worldPosition = opening.getWorldPosition(new THREE.Vector3());
      return Math.abs(Math.abs(worldPosition.z) - 1.25) <= 1e-9;
    }),
    'side windows must sit 1.25 m from the center posts',
  );
  assert.deepEqual(
    new Set(openings.map((opening) => Math.sign(opening.getWorldPosition(new THREE.Vector3()).z))),
    tier === 1 ? new Set([-1]) : new Set([-1, 1]),
    'higher tiers must split their lower and upper side windows across the center post',
  );
  const widestPane = Math.max(
    ...openings.map((opening) => Number(opening.userData.facadeOpeningWidth)),
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
  assert.ok(
    openings.every((opening) => (
      opening.userData.residenceWindowGlazing === (tier === 1 ? 'open-aperture' : 'glazed-pane')
    )),
    `tier-${tier} side-window glazing contract must match its construction tier`,
  );
}

function assertTierOneWindowCutouts(root: THREE.Object3D): void {
  const openings: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object.userData.facadeOpeningKind === 'window') openings.push(object);
  });
  assert.equal(openings.length, 3, 'tier-one cottages need one front and two side window openings');
  assert.deepEqual(
    new Set(openings.map((opening) => opening.userData.facadeOpeningFace)),
    new Set(['positive-z', 'positive-x', 'negative-x']),
    'tier-one open windows must cover the front and both side walls',
  );

  const wallSurfaces = collectTierOneWallSurfaces(root);
  assert.equal(wallSurfaces.length, 4, 'tier-one wall assembly needs one owned mesh per face');
  for (const opening of openings) {
    const roles = new Set<string>();
    opening.traverse((part) => {
      const role = part.userData.facadeOpeningRole;
      if (typeof role === 'string') roles.add(role);
    });
    assert.equal(roles.has('window-pane'), false, 'tier-one open windows must not contain glass panes');
    assert.ok(roles.has('window-interior'), 'tier-one openings need a recessed visible interior');
    assert.equal(opening.userData.residenceWallCutThrough, true);
    assert.equal(opening.userData.residenceWindowGlazing, 'open-aperture');
    const interior = opening.children.find(
      (child) => child.userData.facadeOpeningRole === 'window-interior',
    );
    assert.ok(interior, 'open windows must retain a recessed household-light surface');
    assert.ok(
      Number(interior.userData.residenceWindowInteriorDepthMeters) >= 0.3,
      'the visible interior must sit behind the wall rather than masquerading as a pane',
    );

    const worldCenter = opening.getWorldPosition(new THREE.Vector3());
    const outward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      opening.getWorldQuaternion(new THREE.Quaternion()),
    );
    const raycaster = new THREE.Raycaster(
      worldCenter.clone().addScaledVector(outward, 0.32),
      outward.clone().negate(),
      0,
      0.55,
    );
    assert.equal(
      raycaster.intersectObjects(wallSurfaces, false).length,
      0,
      `${String(opening.userData.facadeOpeningFace)} window must be a true wall cut-through`,
    );
  }
}

function collectTierOneWallSurfaces(root: THREE.Object3D): THREE.Mesh[] {
  const surfaces: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && typeof object.userData.residenceWallFace === 'string') {
      surfaces.push(object);
    }
  });
  return surfaces;
}

function assertTierOneWallVariation(
  root: THREE.Object3D,
  expected: Readonly<Record<'front' | 'rear' | 'left' | 'right', string>>,
): void {
  const shell = root.getObjectByName('Residence tier-one wall shell with true apertures');
  assert.ok(shell instanceof THREE.Group);
  assert.deepEqual(shell.userData.residenceWallPlan, expected);
  assert.deepEqual(root.userData.residenceTierOneWallPlan, expected);

  const surfaces = collectTierOneWallSurfaces(root);
  assert.deepEqual(
    new Set(surfaces.map((surface) => surface.userData.residenceWallFace)),
    new Set(['front', 'rear', 'left', 'right']),
  );
  assert.deepEqual(
    new Set(surfaces.map((surface) => surface.userData.residenceWallFinish)),
    new Set(['earthy-daub', 'fieldstone', 'weathered-timber']),
    'every rough cottage must visibly mix all three local wall systems',
  );
  const stoneWallCount = surfaces.filter(
    (surface) => surface.userData.residenceWallFinish === 'fieldstone',
  ).length;
  assert.ok(stoneWallCount >= 1 && stoneWallCount <= 2);
  const timberGables: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.residenceGableFinish === 'weathered-timber') {
      timberGables.push(object);
    }
  });
  assert.equal(timberGables.length, 2, 'both tier-one gable fields must remain timber');
  assert.deepEqual(
    new Set(timberGables.map(materialName)),
    new Set(['Shared building material: timberWeathered']),
  );
}

function assertTierOneFacadeTimbers(root: THREE.Object3D): void {
  assert.equal(
    root.getObjectByName('Residence hand-hewn wall courses and notched corners'),
    undefined,
    'tier-one façades must not retain the repeated horizontal timber courses',
  );
  const frame = namedMesh(root, 'Residence hand-hewn sill post and brace frame');
  assert.equal(
    frame.userData.residenceFacadeTimberRhythm,
    'sill-post-side-brace-frame',
  );
  assert.equal(frame.userData.residenceFacadeTimberRole, 'load-bearing-frame');
  assert.equal(
    frame.userData.residenceFrontRearDiagonalBraceCount,
    0,
    'tier-one doors and windows must not be crossed by front/rear diagonal braces',
  );
  assert.equal(frame.userData.residenceSideDiagonalBraceCount, 4);
  assert.ok(
    Number(frame.userData.residenceSideFrameRoofClearanceMeters) >= 0.24,
    'side framing must stop below the shingle roof rather than poke through it',
  );
  const tieBeam = namedMesh(root, 'Residence hewn timber wall plate');
  assert.ok(
    Math.abs(
      Number(tieBeam.userData.residenceFrontRearTieBeamY)
        - Number(tieBeam.userData.residenceWallColorTransitionY),
    ) <= 0.05,
    'front/rear tie beams must align with the upper wall color transition',
  );
  assert.ok(
    Number(tieBeam.userData.residenceDoorHeadClearanceMeters) >= 0.1,
    'the front/rear tie beam must clear the top of the tier-one door opening',
  );
  const sidePlates = namedMesh(root, 'Residence recessed side wall plates below shingles');
  assert.ok(
    Number(sidePlates.userData.residenceSideFrameRoofClearanceMeters) >= 0.24,
    'side wall plates must remain recessed beneath the shingle edge',
  );
  const doorFrameRoles = new Set(['door-jamb', 'door-lintel', 'door-threshold']);
  const retainedDoorFrameParts: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (doorFrameRoles.has(String(object.userData.facadeOpeningRole))) {
      retainedDoorFrameParts.push(object);
    }
  });
  assert.equal(
    retainedDoorFrameParts.length,
    0,
    'tier-one doors must omit the complete pale jamb, lintel, and threshold surround',
  );
  assert.equal(
    frame.geometry.userData.residenceHewnTimberTint,
    'smoke-darkened-oak',
  );
  assert.deepEqual(
    root.userData.residenceBuildingPlan.facadeModules,
    [
      'rough-rubble-footing',
      'mixed-daub-fieldstone-timber-wall-faces',
      'true-wall-apertures',
      'hewn-sill-post-side-brace-frame',
      'weathered-timber-gables',
    ],
  );
  root.traverse((object) => {
    assert.notEqual(
      object.userData.residenceFacadeTimberRole,
      'horizontal-course',
      `${object.name || object.type} must not reintroduce a Tier 1 façade course`,
    );
  });
}

function assertTierOneRoofSmokeContract(root: THREE.Object3D): void {
  assert.equal(root.userData.residenceHasChimney, false);
  assert.equal(root.userData.residenceSmokeExit, 'through-shingle-roof');
  const chimneyMeshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.residenceChimney === true) {
      chimneyMeshes.push(object);
    }
  });
  assert.equal(chimneyMeshes.length, 0, 'tier-one cottages must not emit chimney geometry');
  const smokeAnchor = root.getObjectByName('ChimneyEmitter');
  assert.ok(smokeAnchor && !(smokeAnchor instanceof THREE.Mesh), 'roof smoke needs one non-mesh runtime anchor');
  assert.equal(smokeAnchor.userData.residenceSmokeExit, 'through-shingle-roof');
}

function assertJoinedSemanticResidenceRoof(
  root: THREE.Object3D,
  tier: 1 | 2 | 3 | 4,
): void {
  const joinedRoofs = collectRoofFieldSurfaces(root).filter(
    (mesh) => mesh.userData.residenceJoinedSemanticRoof === true,
  );
  assert.equal(
    joinedRoofs.length,
    1,
    `tier-${tier} needs exactly one joined semantic main-roof material slot`,
  );
  const roof = joinedRoofs[0]!;
  assert.equal(roof.name, 'Residence joined semantic main roof');
  assert.equal(roof.geometry.type, 'BufferGeometry');
  assert.notEqual(
    roof.geometry.type,
    'BoxGeometry',
    'main roof skins must not regress to rotated rectangular solids',
  );
  assert.equal(roof.userData.residenceRoofLogicalPanelCount, 2);
  assert.equal(roof.userData.residenceRoofMaterialSlotCount, 1);
  assert.equal(roof.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
  assert.equal(
    roof.geometry.userData.proceduralMaterialRole,
    tier === 4 ? 'clay-tiles' : 'split-shingles',
  );
  assert.deepEqual(
    roof.geometry.userData.proceduralPhysicalUv,
    {
      projection: 'roof-course-aligned',
      uAxis: 'roof-eave',
      vAxis: 'roof-slope',
      metersPerRepeat: [2.2, 2.2],
      course: {
        mode: 'overlapping-roof-courses',
        nominalHeightMeters: tier === 4 ? [0.25, 0.38] : [0.16, 0.26],
        overlapMeters: tier === 4 ? 0.08 : 0.09,
        stagger: tier === 4 ? 'half' : 'irregular',
      },
    },
    'joined roof UVs must remain metric and roof-course aligned',
  );
  assert.deepEqual(roof.position.toArray(), [0, 0, 0]);
  assert.deepEqual([roof.rotation.x, roof.rotation.y, roof.rotation.z], [0, 0, 0]);
  assert.deepEqual(roof.scale.toArray(), [1, 1, 1]);

  const primitiveDiagnostics = (
    roof.geometry.userData.proceduralGeometryDiagnostics as
      | { primitives?: readonly { semanticId?: string }[] }
      | undefined
  )?.primitives ?? [];
  assert.equal(
    primitiveDiagnostics.length,
    tier === 1 ? 5 : 2,
    `tier-${tier} semantic roof needs the exact bounded panel plan`,
  );

  if (tier !== 1) {
    assert.equal(roof.userData.residenceRoofAperture, undefined);
    return;
  }

  const aperture = roof.userData.residenceRoofAperture as {
    side: -1 | 1;
    slopeSizeMeters: number;
    zSizeMeters: number;
    surfaceCenter: readonly [number, number, number];
    surfaceNormal: readonly [number, number, number];
    topology: string;
  } | undefined;
  assert.ok(aperture, 'tier-one joined roof needs an inspectable aperture plan');
  assert.equal(aperture.topology, 'four-field-physical-cutout');
  assert.ok(aperture.slopeSizeMeters >= 0.46 && aperture.slopeSizeMeters <= 0.54);
  assert.ok(aperture.zSizeMeters >= 0.5 && aperture.zSizeMeters <= 0.58);
  assert.deepEqual(
    primitiveDiagnostics.map((primitive) => primitive.semanticId).sort(),
    [
      `main-slope-${aperture.side < 0 ? 'right' : 'left'}`,
      'smoke-opening-eave-field',
      'smoke-opening-front-field',
      'smoke-opening-rear-field',
      'smoke-opening-ridge-field',
    ].sort(),
  );

  const trimmedCourses = collectRoofFieldSurfaces(root).filter(
    (mesh) => mesh.userData.residenceRoofApertureTrimmed === true,
  );
  assert.equal(trimmedCourses.length, 1, 'only the shingle slope containing the opening is trimmed');
  assert.equal(
    trimmedCourses[0]!.userData.residenceRoofApertureContract,
    'shared-roof-local-rectangle',
  );

  root.updateMatrixWorld(true);
  const center = new THREE.Vector3(...aperture.surfaceCenter).applyMatrix4(roof.matrixWorld);
  const normal = new THREE.Vector3(...aperture.surfaceNormal)
    .transformDirection(roof.matrixWorld)
    .normalize();
  const smokeAnchor = root.getObjectByName('ChimneyEmitter')!;
  const emitter = smokeAnchor.getWorldPosition(new THREE.Vector3());
  const emitterOffset = emitter.clone().sub(center);
  assert.ok(
    emitterOffset.dot(normal) >= 0.08,
    'the runtime smoke emitter must be outside the physical roof opening',
  );
  assert.ok(
    Math.abs(emitter.z - center.z) <= 1e-6 && Math.abs(emitter.x - center.x) <= 1e-6,
    'the physical cutout must be centred at the existing smoke-emitter location',
  );

  const throughOpening = new THREE.Raycaster(
    center.clone().addScaledVector(normal, 0.45),
    normal.clone().negate(),
    0,
    0.9,
  ).intersectObject(roof, false);
  assert.equal(
    throughOpening.length,
    0,
    'a ray through the tier-one smoke opening must cross no roof triangles',
  );

  const slopeAxis = new THREE.Vector3(
    -aperture.side * normal.y,
    Math.abs(normal.x),
    0,
  ).normalize();
  const eaveAxis = new THREE.Vector3(0, 0, 1);
  const perimeterSamples = [
    center.clone().addScaledVector(slopeAxis, aperture.slopeSizeMeters * 0.5 + 0.08),
    center.clone().addScaledVector(slopeAxis, -aperture.slopeSizeMeters * 0.5 - 0.08),
    center.clone().addScaledVector(eaveAxis, aperture.zSizeMeters * 0.5 + 0.08),
    center.clone().addScaledVector(eaveAxis, -aperture.zSizeMeters * 0.5 - 0.08),
  ];
  for (const sample of perimeterSamples) {
    const hits = new THREE.Raycaster(
      sample.clone().addScaledVector(normal, 0.45),
      normal.clone().negate(),
      0,
      0.9,
    ).intersectObject(roof, false);
    assert.ok(hits.length > 0, 'the physical opening must be bounded by roof triangles on all four sides');
  }
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

function assertResidenceValueSeparation(root: THREE.Object3D): void {
  const plaster = collectTierOneWallSurfaces(root).find(
    (surface) => surface.userData.residenceWallFinish === 'earthy-daub',
  );
  assert.ok(plaster, 'mixed tier-one wall plan must retain an earthy daub face');
  const stone = namedMesh(root, 'Residence low rubble fieldstone footing');
  const aperture = namedMesh(root, 'Residence shadowed plank door aperture');
  const roofPlane = namedMesh(root, 'Residence joined semantic main roof');
  const exposedRoof = namedMesh(root, 'Residence wooden ridge cap');
  const structuralTimber = namedMesh(
    root,
    'Residence hand-hewn sill post and brace frame',
  );
  const plasterLuma = materialLinearLuma(plaster);
  const stoneLuma = materialLinearLuma(stone);
  const apertureLuma = materialLinearLuma(aperture);
  const roofPlaneLuma = materialLinearLuma(roofPlane);
  const exposedRoofLuma = materialLinearLuma(exposedRoof);
  const structuralTimberLuma = materialLinearLuma(structuralTimber);

  assert.ok(
    plasterLuma >= 0.42 && plasterLuma <= 0.62,
    `clay-lime daub needs a muted earthen middle value (${plasterLuma.toFixed(3)})`,
  );
  assert.ok(
    stoneLuma >= 0.2 && stoneLuma <= 0.32,
    `rough footing stone must stay darker than the daub (${stoneLuma.toFixed(3)})`,
  );
  assert.ok(apertureLuma <= 0.02, `door aperture must read as a deep shadow (${apertureLuma.toFixed(3)})`);
  assert.ok(
    exposedRoofLuma >= 0.1 && exposedRoofLuma <= 0.18,
    `weathered ridge timber must stay in the shared brown range (${exposedRoofLuma.toFixed(3)})`,
  );
  assert.ok(
    roofPlaneLuma - exposedRoofLuma >= 0.1,
    'brown ridge/rake craft must separate from the silvered split-shingle field',
  );
  assert.ok(
    structuralTimberLuma >= 0.04 && structuralTimberLuma <= 0.18,
    `structural timber must separate from plaster without becoming black (${structuralTimberLuma.toFixed(3)})`,
  );
  assert.ok(plasterLuma - apertureLuma >= 0.4, 'daub and apertures need decisive value separation');
  assertResidenceMaterialResponse(plaster, {
    role: 'clay-lime-daub',
    materialName: 'Shared building material: plasterGrey',
    ambientFill: 0.11,
    minimumRoughness: 0.94,
    normalScale: 0.46,
    usesDiffuseMap: true,
    uniformIndirectLight: false,
  });
  assertResidenceMaterialResponse(stone, {
    role: 'rough-rubble-footing',
    materialName: 'Shared building material: masonryDark',
    ambientFill: 0.11,
    minimumRoughness: 0.95,
    normalScale: 0.82,
    usesDiffuseMap: true,
    uniformIndirectLight: false,
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
    role: 'weathered-shingle-ridge',
    materialName: 'Shared building material: timberWeathered',
    ambientFill: 0.11,
    minimumRoughness: 0.96,
    normalScale: 0.86,
    usesDiffuseMap: true,
    weatheringProfile: 'timber',
    textureFamily: 'woodPlanks',
  });
  assertResidenceMaterialResponse(roofPlane, {
    role: 'split-shingle-plane',
    materialName: 'Shared building material: shingle',
    ambientFill: 0.11,
    minimumRoughness: 0.99,
    normalScale: 1.05,
    usesDiffuseMap: false,
    weatheringProfile: 'shingle',
    textureFamily: 'woodPlanks',
  });
}

function shingleTint(tone: string): readonly [number, number, number] {
  if (tone === 'smoke-brown') return [0.66, 0.58, 0.5];
  if (tone === 'mossed-brown') return [0.69, 0.67, 0.5];
  return [0.8, 0.68, 0.53];
}

function firedClayTint(tone: string): readonly [number, number, number] {
  if (tone === 'smoke-brown') return [0.48, 0.3, 0.24];
  if (tone === 'mossed-brown') return [0.54, 0.35, 0.23];
  return [0.6, 0.38, 0.25];
}

function assertTierThreeFeature(root: THREE.Object3D, feature: string): void {
  if (feature === 'offset-dormer') {
    assertNamedPart(root, 'Residence tier-three offset roof dormer');
    assertNamedPart(root, 'Residence tier-three dormer wall mass');
    const dormer = root.getObjectByName('Residence tier-three offset roof dormer')!;
    assert.equal(dormer.userData.residenceDormerHost, 'side-roof-slope');
    assert.equal(Math.abs(dormer.rotation.y), Math.PI * 0.5);
    root.updateMatrixWorld(true);
    const pane = namedMesh(dormer, 'Residence front window pane');
    const paneCenter = pane.getWorldPosition(new THREE.Vector3());
    const outward = new THREE.Vector3(Math.sign(dormer.position.x), 0, 0);
    const ray = new THREE.Raycaster(
      paneCenter.clone().addScaledVector(outward, 10),
      outward.clone().negate(),
    );
    const hits = ray.intersectObjects([...collectRoofFieldSurfaces(root), pane], false);
    assert.equal(hits[0]?.object, pane, 'the dormer window must stand clear of the main roof');
    return;
  }
  if (feature === 'covered-gallery') {
    assertNamedPart(root, 'Residence tier-three covered front gallery');
    assertNamedPart(root, 'Residence tier-three covered-gallery shingle roof');
    assert.equal(
      root.getObjectByName('Residence stone-portal porch roof'),
      undefined,
      'the full-width gallery replaces the small portal canopy instead of overlapping it',
    );
    return;
  }
  assert.equal(feature, 'twin-annex');
  assertNamedPart(root, 'Residence tier-three twin working annexes');
  assert.equal(
    root.getObjectsByProperty('name', 'Residence working-annex roof').length,
    2,
    'the twin-annex tier-three plan needs one working wing on each side',
  );
}

function assertBuildingMaterialLifecycle(): void {
  const firstShingle = sharedBuildingMaterial('shingle');
  const firstShingleMap = firstShingle.map;
  assert.ok(firstShingleMap);
  let atlasMapDisposed = false;
  firstShingleMap.addEventListener('dispose', () => { atlasMapDisposed = true; });

  disposeBuildingMaterialLibrary();
  assert.equal(atlasMapDisposed, true, 'disposing the shared library must release the building atlas');
  assert.deepEqual(getBuildingMaterialLibraryStats(), {
    constructionMaterials: 0,
    detailMaterials: 0,
    textures: 0,
    loaded: false,
  });

  const recreatedShingle = sharedBuildingMaterial('shingle');
  assert.deepEqual(
    getBuildingMaterialLibraryStats(),
    {
      constructionMaterials: 1,
      detailMaterials: 0,
      textures: 1,
      loaded: false,
    },
    'before atlas hydration, split shingles may allocate only their one deterministic fallback tile',
  );
  assert.notStrictEqual(recreatedShingle, firstShingle, 'scene recreation needs a fresh shingle material');
  assert.notStrictEqual(recreatedShingle.map, firstShingleMap, 'scene recreation needs a fresh shingle texture');
  assert.equal(recreatedShingle.userData.buildingMaterialAtlasTile, 'split-shingles');
  disposeBuildingMaterialLibrary();
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
    const boardCount = positions.count / componentVertexCount;
    assert.equal(
      positions.count / 3,
      boardCount * 8,
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
      boardCount * 2,
      `${course.name} must preserve both accepted top triangles on every board`,
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
  assert.ok(roofFields.length >= 4, 'every accepted shingle field role must be audited');
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
      const grainPhase = uv.getY(index) - position.getX(index) / 2.2;
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

  const mainPlane = namedMesh(root, 'Residence joined semantic main roof');
  const mainPosition = mainPlane.geometry.getAttribute('position');
  const mainNormal = mainPlane.geometry.getAttribute('normal');
  const mainUv = mainPlane.geometry.getAttribute('uv');
  const gableGrainPhases = new Set<number>();
  for (let index = 0; index < mainPosition.count; index += 1) {
    if (Math.abs(mainNormal.getZ(index)) < 0.9) continue;
    const grainPhase =
      mainUv.getY(index) - mainPosition.getX(index) / 2.2;
    const expectedPhase = expectedGrainPhases.find(
      (phase) => Math.abs(grainPhase - phase) <= 1e-6,
    );
    assert.notEqual(expectedPhase, undefined);
    gableGrainPhases.add(expectedPhase!);
  }
  assert.ok(
    gableGrainPhases.size >= 4,
    'the joined roof slab must retain coarse hand-worked calm-grain phase variation at its exposed edges',
  );

  assert.deepEqual(
    mainPlane.geometry.userData.proceduralPhysicalUv,
    {
      projection: 'roof-course-aligned',
      uAxis: 'roof-eave',
      vAxis: 'roof-slope',
      metersPerRepeat: [2.2, 2.2],
      course: {
        mode: 'overlapping-roof-courses',
        nominalHeightMeters: [0.16, 0.26],
        overlapMeters: 0.09,
        stagger: 'irregular',
      },
    },
    'the joined field must keep the semantic writer roof-local metric UV contract',
  );

  assert.equal(Array.isArray(mainPlane.material), false);
  const material = mainPlane.material as THREE.MeshStandardMaterial;
  if (!(material.map instanceof THREE.DataTexture)) {
    assert.equal(
      material.userData.buildingMaterialAtlasTile,
      'split-shingles',
      'the unchanged tier-two roof may retain the shared split-shingle atlas source',
    );
    return;
  }
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
      && subjectFrame.maxY - subjectFrame.minY >= 1.48,
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
    uniformIndirectLight?: boolean;
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
    expected.uniformIndirectLight ?? true,
    `${expected.role} indirect-light policy must remain explicit`,
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
  assert.equal(material.userData.metricUvMeters, 2.2);
  assert.equal(material.userData.buildingMaterialAtlasTile, 'split-shingles');
  assert.deepEqual(
    material.userData.splitShinglePattern,
    {
      tileMeters: 2.2,
      courseExposureMeters: 2.2 / 6,
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

  if (!(material.map instanceof THREE.DataTexture)) {
    assert.ok(material.map instanceof THREE.Texture, 'hydrated shingles need the shared atlas albedo');
    assert.ok(material.normalMap instanceof THREE.Texture, 'hydrated shingles need the shared atlas normal');
    assert.ok(material.roughnessMap instanceof THREE.Texture, 'hydrated shingles need the packed atlas material map');
    return;
  }
  assert.equal(material.map.name, 'Procedural split-wood shingles');
  assert.equal(material.map.image.width, 256);
  assert.equal(material.map.image.height, 256);
  assert.equal(material.map.wrapS, THREE.RepeatWrapping);
  assert.equal(material.map.wrapT, THREE.RepeatWrapping);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);

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
