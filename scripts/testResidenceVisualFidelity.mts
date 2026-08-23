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

for (const seed of seeds) {
  const residence = createResidenceMesh(seed, 1);
  const duplicate = createResidenceMesh(seed, 1);
  const bounds = new THREE.Box3().setFromObject(residence);
  const size = bounds.getSize(new THREE.Vector3());

  assert.equal(residence.userData.residenceRoof, 'brown');
  assert.ok(
    Number(residence.userData.residenceRoofPitchDegrees) >= 47,
    'tier-one cottages need a steep, wet-snow-shedding roof pitch',
  );
  assert.ok(
    Number(residence.userData.residenceRoofOverhangMeters) >= 0.5,
    'tier-one cottages need deep weatherproof eaves',
  );
  assert.ok(size.y > size.x * 0.8, 'tier-one silhouette should read compact and steep, not squat');
  assert.equal(residence.userData.residenceRoofFinish, 'bundled-thatch');
  assert.equal(residence.userData.residenceRoofTierContract, 'tier-1-thatch');

  assertNamedPart(residence, 'Residence limestone plinth');
  assertNamedPart(residence, 'Residence limestone plinth cap');
  assertNamedPart(residence, 'Residence tier-one wall shell with true apertures');
  assertNamedPart(residence, 'Residence hand-hewn corner posts');
  assertNamedPart(residence, 'Residence ventilated timber gable kingposts');
  assertNamedPart(residence, 'Residence shadowed plank door aperture');
  assertNamedPart(residence, 'Residence visible timber plank door leaf');
  assertNamedPart(residence, 'Residence door iron latch');
  assertNamedPart(residence, 'Residence deep-eave door canopy roof');
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
  assertTierOneFacadeTimbers(residence);
  assertTierOneRoofSmokeContract(residence);

  const roofSurfaces = collectRoofSurfaces(residence);
  const roofFieldSurfaces = collectRoofFieldSurfaces(residence);
  const roofEdgeSurfaces = collectRoofEdgeSurfaces(residence);
  assert.ok(
    roofSurfaces.length >= 12,
    'main, course, canopy, ridge, rake, and eave roof surfaces must be audited',
  );
  assert.deepEqual(
    new Set(roofFieldSurfaces.map(materialName)),
    new Set(['Shared building material: thatch']),
    'the short cottage roof planes, bundled courses, and canopy must share the thatch surface',
  );
  assert.equal(
    new Set(roofFieldSurfaces.map((mesh) => mesh.material)).size,
    1,
    'tier-one thatch roles must share one material instance without a field permutation',
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
    roofSurfaces.some((mesh) => mesh.name.includes('bundled-thatch')),
    'tier-one roofs need merged, overlapping bundled-thatch course geometry',
  );
  assertWeatheredRoofEdgeCraft(residence);
  assertResidenceValueSeparation(residence);
  assertTierOneThatchMaterial(residence);

  const budget = visibleBudget(residence);
  assert.ok(
    budget.meshes <= 56,
    `tier-one active draw-bearing mesh budget exceeded (${budget.meshes} > 56)`,
  );
  assert.ok(
    budget.triangles <= 1_800,
    `tier-one active triangle budget exceeded (${budget.triangles} > 1,800)`,
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

for (const tier of [1, 2, 3, 4] as const) {
  for (let seed = 0; seed < 64; seed += 1) {
    assert.equal(
      pickResidenceAppearance(seed).roof,
      'brown',
      'the appearance seed remains deterministic independently of the tier roof contract',
    );
    const residence = createResidenceMesh(seed, tier);
    assertSideWindowOpeningClearance(residence, tier);
    assert.equal(
      residence.userData.residenceRoof,
      'brown',
      'the palette seed should remain stable across tier model changes',
    );
    const expectedFieldMaterial = tier === 1
      ? 'Shared building material: thatch'
      : tier === 4
        ? 'Shared building material: clayRed'
        : 'Shared building material: shingle';
    assert.deepEqual(
      new Set(collectRoofFieldSurfaces(residence).map(materialName)),
      new Set([expectedFieldMaterial]),
      `tier-${tier} must use its authored shared roof field`,
    );
    assert.deepEqual(
      new Set(collectRoofEdgeSurfaces(residence).map(materialName)),
      new Set(['Shared building material: timberWeathered']),
      'every current residence ridge, rake, and fascia must remain explicit weathered wood',
    );
    assert.deepEqual(
      new Set(collectRoofSurfaces(residence).map(materialName)),
      new Set([
        expectedFieldMaterial,
        'Shared building material: timberWeathered',
      ]),
      `tier-${tier} roof fields and crafted timber edges must remain explicitly separated`,
    );
    assert.equal(
      residence.userData.residenceRoofFinish,
      tier === 1 ? 'bundled-thatch' : tier === 4 ? 'fired-clay-tile' : 'split-wood-shingle',
    );
    assert.equal(residence.userData.residenceBuildingPlan.tier, tier);
    if (tier === 4) {
      assert.equal(residence.userData.residenceTiledRoof, true);
      assertNamedPart(residence, 'Residence tier-four central cross-gable mass');
      assertNamedPart(residence, 'Residence tier-four ashlar upper-storey corner pier');
    }
  }
}

assertResidenceCameraContract();
assertBuildingMaterialLifecycle();

console.log(
  `residence visual-fidelity checks passed (${seeds.length} deterministic cottages, open apertures, grey thatch, roof smoke, isolated 16:9 judge)`,
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

  const wallShell = namedMesh(root, 'Residence tier-one wall shell with true apertures');
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
      raycaster.intersectObject(wallShell, false).length,
      0,
      `${String(opening.userData.facadeOpeningFace)} window must be a true wall cut-through`,
    );
  }
}

function assertTierOneFacadeTimbers(root: THREE.Object3D): void {
  assert.equal(
    root.getObjectByName('Residence hand-hewn wall courses and notched corners'),
    undefined,
    'tier-one façades must not retain the repeated horizontal timber courses',
  );
  const corners = namedMesh(root, 'Residence hand-hewn corner posts');
  assert.equal(corners.userData.residenceFacadeTimberRhythm, 'vertical-corners-only');
  assert.deepEqual(
    root.userData.residenceBuildingPlan.facadeModules,
    ['limewashed-infill', 'true-wall-apertures', 'hewn-corner-posts'],
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
  assert.equal(root.userData.residenceSmokeExit, 'through-thatch');
  const chimneyMeshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.residenceChimney === true) {
      chimneyMeshes.push(object);
    }
  });
  assert.equal(chimneyMeshes.length, 0, 'tier-one cottages must not emit chimney geometry');
  const smokeAnchor = root.getObjectByName('ChimneyEmitter');
  assert.ok(smokeAnchor && !(smokeAnchor instanceof THREE.Mesh), 'roof smoke needs one non-mesh runtime anchor');
  assert.equal(smokeAnchor.userData.residenceSmokeExit, 'through-thatch');

  root.updateMatrixWorld(true);
  const roofDirection = new THREE.Vector3(0, -1, 0).applyQuaternion(
    root.getWorldQuaternion(new THREE.Quaternion()),
  );
  const clearanceProbeHeight = 0.5;
  const hits = new THREE.Raycaster(
    smokeAnchor.getWorldPosition(new THREE.Vector3()).addScaledVector(
      roofDirection,
      -clearanceProbeHeight,
    ),
    roofDirection,
    0,
    0.75,
  ).intersectObjects(collectRoofFieldSurfaces(root), false);
  assert.ok(hits.length > 0, 'the smoke anchor must sit directly above the thatch roof field');
  const signedClearance = hits[0]!.distance - clearanceProbeHeight;
  assert.ok(
    signedClearance >= 0.015 && signedClearance <= 0.12,
    `roof smoke must emerge just above the visible thatch (${signedClearance.toFixed(3)} m clearance)`,
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
  const plaster = namedMesh(root, 'Residence tier-one wall shell with true apertures');
  const stone = namedMesh(root, 'Residence limestone plinth');
  const aperture = namedMesh(root, 'Residence shadowed plank door aperture');
  const roofPlane = namedMesh(root, 'Residence main roof plane left');
  const exposedRoof = roofMeshContaining(root, 'bundled-thatch courses');
  const structuralTimber = namedMesh(
    root,
    'Residence hand-hewn corner posts',
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
    exposedRoofLuma >= 0.24 && exposedRoofLuma <= 0.38,
    `weathered grey thatch needs a restrained middle value (${exposedRoofLuma.toFixed(3)})`,
  );
  assert.ok(
    Math.abs(roofPlaneLuma - exposedRoofLuma) <= 0.001,
    'roof plane and exposed courses must share one authored thatch value',
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
    role: 'bundled-thatch-course',
    materialName: 'Shared building material: thatch',
    ambientFill: 0.11,
    minimumRoughness: 1,
    normalScale: 0.62,
    usesDiffuseMap: true,
    weatheringProfile: 'thatch',
  });
  assertResidenceMaterialResponse(roofPlane, {
    role: 'bundled-thatch-plane',
    materialName: 'Shared building material: thatch',
    ambientFill: 0.11,
    minimumRoughness: 1,
    normalScale: 0.62,
    usesDiffuseMap: true,
    weatheringProfile: 'thatch',
  });
}

function assertTierOneThatchMaterial(root: THREE.Object3D): void {
  const roof = namedMesh(root, 'Residence main roof plane left');
  assert.equal(Array.isArray(roof.material), false);
  const material = roof.material as THREE.MeshStandardMaterial;
  assert.equal(
    material.userData.buildingUsesProceduralThatchMap,
    true,
    'Tier 1 must use the shared fibrous procedural thatch surface',
  );
  assert.equal(material.userData.metricUvMeters, 1.4);
  assert.deepEqual(
    material.userData.proceduralThatchPattern,
    {
      tileMeters: 1.4,
      fiberSpacingMeters: 1.4 / 56,
      courseExposureMeters: 1.4 / 6,
      direction: 'slope-aligned-reed-fibers',
      palette: 'weathered-grey-reed',
      channels: ['fiber-albedo', 'fiber-normal', 'fiber-roughness'],
    },
  );
  const textureContracts: Array<[
    THREE.Texture | null,
    string,
    THREE.ColorSpace,
  ]> = [
    [material.map, 'Procedural grey bundled thatch albedo', THREE.SRGBColorSpace],
    [material.normalMap, 'Procedural grey bundled thatch normal', THREE.NoColorSpace],
    [material.roughnessMap, 'Procedural grey bundled thatch roughness', THREE.NoColorSpace],
  ];
  for (const [texture, name, colorSpace] of textureContracts) {
    assert.ok(texture instanceof THREE.DataTexture, `${name} must be a shared data texture`);
    assert.equal(texture.name, name);
    assert.equal(texture.image.width, 256);
    assert.equal(texture.image.height, 256);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.colorSpace, colorSpace);
    assertTextureWrapContinuity(texture, name);
  }

  const color = material.color;
  const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  assert.ok(chroma <= 0.08, `thatch tint must stay neutral grey rather than painted yellow (${chroma.toFixed(3)} chroma)`);
  const pixels = (material.map as THREE.DataTexture).image.data as Uint8Array;
  let red = 0;
  let green = 0;
  let blue = 0;
  let minimum = 255;
  let maximum = 0;
  const pixelCount = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    red += pixels[index]!;
    green += pixels[index + 1]!;
    blue += pixels[index + 2]!;
    minimum = Math.min(minimum, pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
    maximum = Math.max(maximum, pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
  }
  const means = [red / pixelCount, green / pixelCount, blue / pixelCount];
  assert.ok(
    Math.max(...means) - Math.min(...means) <= 12,
    `procedural fibres must stay grey-balanced (${means.map((value) => value.toFixed(1)).join('/')})`,
  );
  assert.ok(maximum - minimum >= 80, 'the thatch albedo needs visible fibre and course contrast');
}

function assertTextureWrapContinuity(
  texture: THREE.DataTexture,
  label: string,
): void {
  const data = texture.image.data as Uint8Array;
  const width = texture.image.width;
  const height = texture.image.height;
  const columnDelta = (left: number, right: number): number => {
    let total = 0;
    for (let y = 0; y < height; y += 1) {
      const leftIndex = (y * width + left) * 4;
      const rightIndex = (y * width + right) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        total += Math.abs(data[leftIndex + channel]! - data[rightIndex + channel]!);
      }
    }
    return total / (height * 3);
  };
  const seamDelta = columnDelta(width - 1, 0);
  const adjacentEdgeDelta = Math.max(
    columnDelta(0, 1),
    columnDelta(width - 2, width - 1),
  );
  assert.ok(
    seamDelta <= adjacentEdgeDelta * 1.5 + 0.5,
    `${label} must wrap without a repeated vertical seam (${seamDelta.toFixed(2)} vs ${adjacentEdgeDelta.toFixed(2)})`,
  );
  const rowDelta = (top: number, bottom: number): number => {
    let total = 0;
    for (let x = 0; x < width; x += 1) {
      const topIndex = (top * width + x) * 4;
      const bottomIndex = (bottom * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        total += Math.abs(data[topIndex + channel]! - data[bottomIndex + channel]!);
      }
    }
    return total / (width * 3);
  };
  const horizontalSeamDelta = rowDelta(height - 1, 0);
  const adjacentHorizontalDelta = Math.max(
    rowDelta(0, 1),
    rowDelta(height - 2, height - 1),
  );
  assert.ok(
    horizontalSeamDelta <= adjacentHorizontalDelta * 1.5 + 0.5,
    `${label} must wrap without a repeated horizontal seam (${horizontalSeamDelta.toFixed(2)} vs ${adjacentHorizontalDelta.toFixed(2)})`,
  );
}

function assertBuildingMaterialLifecycle(): void {
  const firstThatch = sharedBuildingMaterial('thatch');
  const firstShingle = sharedBuildingMaterial('shingle');
  const firstThatchMap = firstThatch.map;
  const firstShingleMap = firstShingle.map;
  assert.ok(firstThatchMap && firstShingleMap);
  let thatchMapDisposed = false;
  let shingleMapDisposed = false;
  firstThatchMap.addEventListener('dispose', () => { thatchMapDisposed = true; });
  firstShingleMap.addEventListener('dispose', () => { shingleMapDisposed = true; });

  disposeBuildingMaterialLibrary();
  assert.equal(thatchMapDisposed, true, 'disposing the shared library must release procedural thatch maps');
  assert.equal(shingleMapDisposed, true, 'disposing the shared library must release procedural shingle maps');
  assert.deepEqual(getBuildingMaterialLibraryStats(), {
    constructionMaterials: 0,
    detailMaterials: 0,
    textures: 0,
    loaded: false,
  });

  const recreatedThatch = sharedBuildingMaterial('thatch');
  const recreatedShingle = sharedBuildingMaterial('shingle');
  assert.notStrictEqual(recreatedThatch, firstThatch, 'scene recreation needs a fresh thatch material');
  assert.notStrictEqual(recreatedShingle, firstShingle, 'scene recreation needs a fresh shingle material');
  assert.notStrictEqual(recreatedThatch.map, firstThatchMap, 'scene recreation needs fresh thatch textures');
  assert.notStrictEqual(recreatedShingle.map, firstShingleMap, 'scene recreation needs a fresh shingle texture');
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
