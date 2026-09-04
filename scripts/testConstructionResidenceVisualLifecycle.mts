import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import {
  constructionDeliveredRatio,
  constructionVisualSignature,
  createConstructionSiteMesh,
  getConstructionSiteMaterialLibraryStats,
  isSharedConstructionSiteMaterial,
} from '../src/buildings/ConstructionSiteMesh.ts';
import { buildingMeshSignature } from '../src/buildings/buildingMarkerSignature.ts';
import { residenceUpgradeProject } from '../src/economy/residenceUpgrade.ts';
import {
  createResidenceMesh,
  ResidenceMarkers,
} from '../src/residences/ResidenceMarkers.ts';
import { BackyardGardenMarkers } from '../src/residences/BackyardGardenMarkers.ts';
import {
  createBackyardConstructionMesh,
  disposeBackyardConstructionMesh,
} from '../src/residences/backyardConstructionMesh.ts';
import { backyardGardenPlacement } from '../src/residences/backyardPosition.ts';
import { layoutFromBurgageZone } from '../src/residences/burgageZoneLayout.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import { ResourceInspector } from '../src/resources/ResourceInspector.ts';
import { renderConstructionInspector } from '../src/resources/inspector/constructionRenderer.ts';
import type {
  BuildingState,
  BackyardGardenState,
  BurgageZoneState,
  InspectableTarget,
  ResidenceState,
} from '../src/resources/types.ts';
import { BACKYARD_GARDEN_KINDS } from '../src/generated/gameBalance.ts';

const CHECKPOINTS = [0, 0.25, 0.5, 0.75, 0.99] as const;
const COMPLETE_PROGRESS = 1;
const EXPECTED_SITE_SIGNATURES = [
  'site:0:3:3:3:3',
  'site:1:3:3:3:3',
  'site:2:2:2:2:2',
  'site:3:1:1:1:1',
  'site:4:1:1:1:1',
  'site:4:0:0:0:0',
] as const;
const EXPECTED_SITE_MESH_COUNTS = [54, 64, 56, 54, 48, 38] as const;
const EXPECTED_TIMBER_PILE_COUNTS = [9, 7, 5, 3, 1, 0] as const;
const EXPECTED_STONE_PILE_COUNTS = [10, 8, 5, 3, 1, 0] as const;
const EXPECTED_IRON_STRAP_COUNTS = [3, 3, 2, 1, 1, 0] as const;
const EXPECTED_ROOF_TILE_COUNTS = [12, 12, 8, 4, 4, 0] as const;
const EXPECTED_FOUNDATION_COUNTS = [0, 12, 12, 12, 12, 12] as const;
const EXPECTED_RESIDENCE_SEGMENTS = [8, 6, 4, 2, 1] as const;
const EXPECTED_INITIAL_FRAME_PARTS = [4, 9, 14, 18, 20] as const;

function testConstructionSiteCheckpoints(): void {
  assert.equal(constructionDeliveredRatio(0, 0), 0);
  assert.equal(constructionDeliveredRatio(4, 8), 0.5);
  const progressPoints = [...CHECKPOINTS, COMPLETE_PROGRESS];
  const sites = progressPoints.map((progress) => createConstructionSiteMesh(
    'lumber_mill',
    progress,
    1,
    1,
    1,
    1,
  ));

  assert.equal(getConstructionSiteMaterialLibraryStats().materials, 7);
  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index]!;
    const progress = progressPoints[index]!;
    assert.equal(
      constructionVisualSignature(progress, 1, 1, 1, 1),
      EXPECTED_SITE_SIGNATURES[index],
    );
    assert.equal(countMeshes(site), EXPECTED_SITE_MESH_COUNTS[index]);
    assert.equal(
      countNamed(site, 'Construction timber pile log'),
      EXPECTED_TIMBER_PILE_COUNTS[index],
    );
    assert.equal(
      countNamed(site, 'Construction stone pile piece'),
      EXPECTED_STONE_PILE_COUNTS[index],
    );
    assert.equal(
      countNamePrefix(site, 'Construction iron strap '),
      EXPECTED_IRON_STRAP_COUNTS[index],
    );
    assert.equal(
      countNamePattern(site, /^Construction roof tile \d+$/),
      EXPECTED_ROOF_TILE_COUNTS[index],
    );
    assert.equal(
      countNamePrefix(site, 'Construction installed foundation course '),
      EXPECTED_FOUNDATION_COUNTS[index],
      `installed foundations must advance monotonically from builder progress at ${progress}`,
    );
    assert.equal(site.userData.constructionProgress, progress);
    assert.equal(
      Object.values(site.userData.constructionMaterialPileRatios as Record<string, number>)
        .every((ratio) => Math.abs(ratio - (1 - progress)) <= 1e-9),
      true,
    );
  }

  const firstMaterials = collectMaterials(sites[2]!);
  const duplicate = createConstructionSiteMesh('lumber_mill', 0.5, 1, 1, 1, 1);
  const duplicateMaterials = collectMaterials(duplicate);
  assert.equal(firstMaterials.size, 7);
  assert.equal(duplicateMaterials.size, 7);
  for (const material of firstMaterials) {
    assert.equal(isSharedConstructionSiteMaterial(material), true);
    assert.equal(
      duplicateMaterials.has(material),
      true,
      'two construction sites must reuse exact pooled material identities',
    );
  }

  for (const site of sites) disposeGeometryOnly(site);
  disposeGeometryOnly(duplicate);
}

function testConstructionMarkerReplacementAndInspectorRefresh(): void {
  const parent = new THREE.Group();
  const markers = new BuildingMarkers({
    terrain: { getHeightAt: () => 0 } as never,
    parent,
  });
  const internals = markers as unknown as {
    buildingMeshes: Map<string, THREE.Group>;
  };
  const initialState = constructionBuilding(0, false);
  const inspector = createInspectorRefreshHarness(buildingTarget(initialState));
  let priorMarker: THREE.Group | null = null;

  for (let index = 0; index < CHECKPOINTS.length; index += 1) {
    const progress = CHECKPOINTS[index]!;
    const state = constructionBuilding(progress, false);
    markers.syncBuildings([state]);
    inspector.refreshTo(buildingTarget(state));
    const marker = internals.buildingMeshes.get(state.id);
    assert.ok(marker, `missing construction marker at ${progress}`);
    assert.equal(internals.buildingMeshes.size, 1);
    assert.equal(marker.name, 'Construction site');
    assert.equal(marker.userData.visualSignature, EXPECTED_SITE_SIGNATURES[index]);
    assert.equal(buildingMeshSignature(state), EXPECTED_SITE_SIGNATURES[index]);
    assert.equal(countDirectLifecycleRoots(parent, 'Construction site'), 1);
    if (priorMarker) {
      assert.equal(
        priorMarker.parent,
        null,
        `replacing ${CHECKPOINTS[index - 1]} with ${progress} must detach the old site`,
      );
    }
    priorMarker = marker;

    const view = renderConstructionInspector(
      buildingTarget(state),
      constructionInspectorContext(state) as never,
    );
    assert.equal(view.statusText, `${Math.round(progress * 100)}% built · materials ready`);
    assert.match(view.detailsHtml, new RegExp(`Builder progress</span><span>${Math.round(progress * 100)}%`));
  }

  const completed = constructionBuilding(COMPLETE_PROGRESS, true);
  markers.syncBuildings([completed]);
  inspector.refreshTo(buildingTarget(completed));
  const completedMarker = internals.buildingMeshes.get(completed.id);
  assert.ok(completedMarker);
  assert.notStrictEqual(completedMarker, priorMarker);
  assert.equal(priorMarker?.parent, null);
  assert.equal(completedMarker.name === 'Construction site', false);
  assert.equal(completedMarker.getObjectByName('Construction site'), undefined);
  assert.equal(countDirectLifecycleRoots(parent, 'Construction site'), 0);
  assert.equal(
    [...collectMaterials(completedMarker)].some(
      (material) => material.name.startsWith('Shared construction-site material:'),
    ),
    false,
    'atomic completion must leave no legacy construction-only material in the rendered building graph',
  );
  assert.equal(inspector.lastRendered(), buildingTargetSignature(completed));

  markers.syncBuildings([]);
  assert.equal(internals.buildingMeshes.size, 0);
  assert.equal(completedMarker.parent, null);
  assert.equal(countDirectLifecycleRoots(parent, 'Construction site'), 0);

  const timberOnly = {
    ...constructionBuilding(0, false),
    constructionRequiredStone: 0,
    constructionRequiredIronwork: 0,
    constructionRequiredRoofTiles: 0,
    constructionDeliveredStone: 0,
    constructionDeliveredIronwork: 0,
    constructionDeliveredRoofTiles: 0,
  };
  assert.equal(buildingMeshSignature(timberOnly), 'site:0:3:0:0:0');
  markers.syncBuildings([timberOnly]);
  const timberOnlyMarker = internals.buildingMeshes.get(timberOnly.id);
  assert.ok(timberOnlyMarker);
  assert.equal(countNamed(timberOnlyMarker, 'Construction stone pile piece'), 0);
  assert.equal(timberOnlyMarker.getObjectByName('Construction fittings crate'), undefined);
  assert.equal(timberOnlyMarker.getObjectByName('Construction roof tile stack'), undefined);
  markers.syncBuildings([]);
  markers.dispose();
}

function testResidenceMaterialOwnership(): void {
  const first = createResidenceMesh(137, 2);
  const second = createResidenceMesh(137, 2);
  const firstWorks = first.getObjectByName('ResidenceUpgradeWorks');
  const secondWorks = second.getObjectByName('ResidenceUpgradeWorks');
  assert.ok(firstWorks instanceof THREE.Group);
  assert.ok(secondWorks instanceof THREE.Group);
  const firstMaterials = collectMaterials(firstWorks);
  const secondMaterials = collectMaterials(secondWorks);
  assert.equal(firstMaterials.size, 6);
  assert.equal(secondMaterials.size, 6);
  for (const material of firstMaterials) {
    assert.equal(material.userData.sharedBuildingMaterial, true);
    assert.equal(
      secondMaterials.has(material),
      true,
      'two residence work meshes must reuse exact central building material identities',
    );
  }
  disposeResidenceGeometry(first);
  disposeResidenceGeometry(second);
}

function testResidenceCheckpointAndTierReplacement(): void {
  const parent = new THREE.Group();
  const markers = new ResidenceMarkers(parent);
  const internals = markers as unknown as {
    root: THREE.Group;
    meshes: Map<string, THREE.Group>;
  };
  const initial = residence(0, 1, 0);
  const inspector = createInspectorRefreshHarness(residenceTarget(initial));

  for (let currentTier = 0 as ResidenceState['tier']; currentTier < 4; currentTier += 1) {
    const targetTier = (currentTier + 1) as 1 | 2 | 3 | 4;
    let transitionMarker: THREE.Group | null = null;
    for (let index = 0; index < CHECKPOINTS.length; index += 1) {
      const progress = CHECKPOINTS[index]!;
      const state = residence(currentTier, targetTier, progress);
      markers.syncResidences([state], () => 0);
      inspector.refreshTo(residenceTarget(state));
      const marker = internals.meshes.get(state.id);
      assert.ok(marker, `missing tier-${currentTier} residence marker at ${progress}`);
      assert.equal(internals.meshes.size, 1);
      assert.equal(countResidenceMarkerRoots(internals.root), 1);
      assert.equal(marker.userData.residenceTier, currentTier);
      assert.equal(
        marker.userData.residenceTiledRoof,
        currentTier >= 4,
        'future tier roof semantics must not appear before atomic promotion',
      );
      if (transitionMarker) assert.strictEqual(marker, transitionMarker);
      transitionMarker = marker;

      const project = residenceUpgradeProject(state);
      assert.ok(project);
      assert.equal(project.targetTier, targetTier);
      assert.equal(project.progress, progress);
      assert.equal(inspector.lastRendered(), residenceTargetSignature(state));

      const works = marker.getObjectByName('ResidenceUpgradeWorks');
      assert.ok(works instanceof THREE.Group);
      assert.equal(isEffectivelyVisible(works, marker), true);
      assert.equal(
        countEffectivelyVisiblePrefix(works, 'UpgradeTimberSegment:'),
        EXPECTED_RESIDENCE_SEGMENTS[index],
      );
      assert.equal(
        countEffectivelyVisiblePrefix(works, 'UpgradeStoneSegment:'),
        EXPECTED_RESIDENCE_SEGMENTS[index],
      );
      assert.equal(
        countEffectivelyVisiblePrefix(works, 'UpgradeRoofTileSegment:'),
        targetTier === 4 ? EXPECTED_RESIDENCE_SEGMENTS[index] : 0,
      );
      assert.equal(
        countEffectivelyVisiblePrefix(works, 'UpgradeScaffold'),
        currentTier === 0 ? 0 : 18,
      );

      if (currentTier === 0) {
        const completedStructure = marker.getObjectByName('InitialCottageCompletedStructure');
        const frame = marker.getObjectByName('InitialCottageConstructionFrame');
        assert.ok(completedStructure instanceof THREE.Group);
        assert.ok(frame instanceof THREE.Group);
        assert.equal(
          isEffectivelyVisible(completedStructure, marker),
          false,
          'the completed tier-one cottage must remain hidden while its frame is built',
        );
        assert.equal(
          frame.children.filter((part) => isEffectivelyVisible(part, marker)).length,
          EXPECTED_INITIAL_FRAME_PARTS[index],
        );
      } else {
        assert.equal(marker.getObjectByName('InitialCottageCompletedStructure'), undefined);
        assert.equal(marker.getObjectByName('InitialCottageConstructionFrame'), undefined);
      }
    }

    const completed = residence(targetTier, 0, COMPLETE_PROGRESS);
    markers.syncResidences([completed], () => 0);
    inspector.refreshTo(residenceTarget(completed));
    const completedMarker = internals.meshes.get(completed.id);
    assert.ok(completedMarker);
    assert.notStrictEqual(completedMarker, transitionMarker);
    assert.equal(transitionMarker?.parent, null);
    assert.equal(internals.meshes.size, 1);
    assert.equal(countResidenceMarkerRoots(internals.root), 1);
    assert.equal(completedMarker.userData.residenceTier, targetTier);
    assert.equal(completedMarker.userData.residenceTiledRoof, targetTier >= 4);
    assert.equal(residenceUpgradeProject(completed), null);
    const completedWorks = completedMarker.getObjectByName('ResidenceUpgradeWorks');
    assert.ok(completedWorks instanceof THREE.Group);
    assert.equal(isEffectivelyVisible(completedWorks, completedMarker), false);
    assert.equal(
      countEffectivelyVisiblePrefix(completedWorks, 'UpgradeTimberSegment:'),
      0,
    );
    assert.equal(
      countEffectivelyVisiblePrefix(completedWorks, 'UpgradeStoneSegment:'),
      0,
    );
    assert.equal(
      countEffectivelyVisiblePrefix(completedWorks, 'UpgradeRoofTileSegment:'),
      0,
    );
    assert.equal(inspector.lastRendered(), residenceTargetSignature(completed));
  }

  markers.syncResidences([], () => 0);
  assert.equal(internals.meshes.size, 0);
  assert.equal(countResidenceMarkerRoots(internals.root), 0);
  markers.dispose();
}

function testBackyardConstructionOwnership(): void {
  const parent = new THREE.Group();
  const residenceMarkers = new ResidenceMarkers(parent);
  const backyardRoot = new THREE.Group();
  parent.add(backyardRoot);
  const backyardMarkers = Object.create(BackyardGardenMarkers.prototype) as BackyardGardenMarkers;
  const backyardInternals = backyardMarkers as unknown as {
    root: THREE.Group;
    meshes: Map<string, THREE.Group>;
    chickens: Map<string, unknown[]>;
    goats: Map<string, unknown[]>;
    pigs: Map<string, unknown[]>;
    plants: null;
    chickenSource: null;
    goatSource: null;
    pigSource: null;
    latestInput: null;
    deciduousFoliage: null;
    animationElapsedSeconds: number;
    disposed: boolean;
  };
  Object.assign(backyardInternals, {
    root: backyardRoot,
    meshes: new Map(),
    chickens: new Map(),
    goats: new Map(),
    pigs: new Map(),
    plants: null,
    chickenSource: null,
    goatSource: null,
    pigSource: null,
    latestInput: null,
    deciduousFoliage: null,
    animationElapsedSeconds: 0,
    disposed: false,
  });
  const residenceInternals = residenceMarkers as unknown as {
    meshes: Map<string, THREE.Group>;
  };
  const kind = 'animal_pen' as const;
  const kindId = BACKYARD_GARDEN_KINDS.indexOf(kind) + 1;
  let residenceMarker: THREE.Group | null = null;
  let constructionMarker: THREE.Group | null = null;

  for (const progress of CHECKPOINTS) {
    const state = backyardProjectResidence(progress, kindId);
    residenceMarkers.syncResidences([state], () => 0);
    backyardMarkers.syncGardens({
      residences: [state],
      zones: [zone],
      gardens: new Map(),
      getHeightAt: () => 0,
    });

    const house = residenceInternals.meshes.get(state.id);
    const site = backyardInternals.meshes.get(state.id);
    const placement = backyardGardenPlacement(state, zone);
    assert.ok(house);
    assert.ok(site);
    assert.ok(placement);
    if (residenceMarker) assert.strictEqual(house, residenceMarker);
    if (constructionMarker) assert.strictEqual(site, constructionMarker);
    residenceMarker = house;
    constructionMarker = site;

    const houseWorks = house.getObjectByName('ResidenceUpgradeWorks');
    assert.ok(houseWorks instanceof THREE.Group);
    assert.equal(
      isEffectivelyVisible(houseWorks, house),
      false,
      'backyard construction must never reactivate the completed house work mesh',
    );
    assert.equal(site.name, 'Backyard extension construction');
    assert.equal(site.userData.backyardProjectKind, kind);
    assert.equal(site.userData.constructionProgress, progress);
    assert.equal(site.position.x, placement.x);
    assert.equal(site.position.z, placement.z);
    assert.notEqual(
      Math.hypot(site.position.x - house.position.x, site.position.z - house.position.z),
      0,
      'the worksite must be anchored in the backyard rather than on the house',
    );
  }

  assert.ok(constructionMarker);
  const hammer = constructionMarker.getObjectByName('Backyard construction hammer');
  assert.ok(hammer);
  const hammerRotation = hammer.rotation.z;
  backyardMarkers.tick(0.08);
  assert.notEqual(
    hammer.rotation.z,
    hammerRotation,
    'assigned backyard labor must animate the construction tool at the extension',
  );

  const compactPenWorks = createBackyardConstructionMesh('animal_pen', {
    width: 4.2,
    depth: 2.4,
    seed: 1,
  });
  const broadPenWorks = createBackyardConstructionMesh('animal_pen', {
    width: 9.4,
    depth: 8.2,
    seed: 1,
  });
  const compactPlan = compactPenWorks.userData.backyardConstructionPlan as {
    profile: string;
    typology: string;
    footprint: { width: number; depth: number };
    yardFootprint: { width: number; depth: number };
    boundaryPostCount: number;
    railSegmentCount: number;
    scaffoldPostCount: number;
    scaffoldRailCount: number;
  };
  const broadPlan = broadPenWorks.userData.backyardConstructionPlan as typeof compactPlan;
  assert.equal(compactPlan.profile, 'animal-house');
  assert.equal(compactPlan.typology, 'open-gable-stock-shelter');
  assert.equal(compactPlan.boundaryPostCount, 0);
  assert.equal(broadPlan.boundaryPostCount, 0);
  assert.equal(compactPlan.railSegmentCount, 0);
  assert.equal(broadPlan.railSegmentCount, 0);
  assert.equal(compactPlan.scaffoldPostCount, 4);
  assert.equal(compactPlan.scaffoldRailCount, 6);
  assert.deepEqual(broadPlan.yardFootprint, { width: 9.4, depth: 8.2 });
  assert.ok(
    broadPlan.footprint.width < broadPlan.yardFootprint.width * 0.5
      && broadPlan.footprint.depth < broadPlan.yardFootprint.depth * 0.5,
    'animal-pen construction should frame the animal house rather than the entire yard',
  );
  assert.equal(compactPenWorks.getObjectByName('Backyard installed boundary post 0'), undefined);
  assert.ok(compactPenWorks.getObjectByName('Animal house rising fieldstone sill'));
  assert.ok(compactPenWorks.getObjectByName('Animal house ridge beam'));
  assert.ok(compactPenWorks.getObjectByName('Animal house scaffold post 0'));
  disposeBackyardConstructionMesh(compactPenWorks);
  disposeBackyardConstructionMesh(broadPenWorks);

  const completedResidence = {
    ...backyardProjectResidence(1, 0),
    backyardProjectKind: 0,
    upgradeAssignedLabor: 0,
  };
  const garden: BackyardGardenState = {
    id: 'visual-lifecycle-backyard',
    residenceId: completedResidence.id,
    kind,
    firstHarvestDay: 20,
    lastPrimaryProductionDay: 0,
    lastSecondaryProductionDay: 0,
    hideStock: 0,
    flowerLuxuryUpgraded: false,
  };
  residenceMarkers.syncResidences([completedResidence], () => 0);
  backyardMarkers.syncGardens({
    residences: [completedResidence],
    zones: [zone],
    gardens: new Map([[completedResidence.id, garden]]),
    getHeightAt: () => 0,
  });
  const completedHouse = residenceInternals.meshes.get(completedResidence.id);
  const completedBackyard = backyardInternals.meshes.get(completedResidence.id);
  assert.strictEqual(completedHouse, residenceMarker);
  assert.ok(completedBackyard);
  assert.notStrictEqual(completedBackyard, constructionMarker);
  assert.equal(constructionMarker.parent, null);
  assert.equal(completedBackyard.name, 'BackyardGarden:animal_pen');

  const plantingKind = 'vegetable_garden' as const;
  const plantingKindId = BACKYARD_GARDEN_KINDS.indexOf(plantingKind) + 1;
  const plantingResidence = {
    ...backyardProjectResidence(0.35, plantingKindId),
    id: 'visual-lifecycle-planting-preview',
  };
  residenceMarkers.syncResidences([plantingResidence], () => 0);
  backyardMarkers.syncGardens({
    residences: [plantingResidence],
    zones: [zone],
    gardens: new Map(),
    getHeightAt: () => 0,
  });
  const plantingMarker = backyardInternals.meshes.get(plantingResidence.id);
  assert.ok(plantingMarker);
  assert.equal(plantingMarker.name, 'BackyardPlantingPreview:vegetable_garden');
  assert.equal(plantingMarker.userData.backyardPlantingPreview, true);
  assert.notEqual(plantingMarker.userData.backyardConstructionSite, true);
  assert.equal(
    plantingMarker.getObjectByName('Backyard construction hammer'),
    undefined,
    'cultivated projects should place prepared ground without a building-work animation',
  );
  assert.ok(
    Number(plantingMarker.userData.backyardTerrainSurfaceCount) > 0,
    'instant planting previews should still conform their soil to the parcel terrain',
  );

  const orchardKindId = BACKYARD_GARDEN_KINDS.indexOf('orchard') + 1;
  const unselectedOrchardResidence = {
    ...backyardProjectResidence(0.35, orchardKindId),
    id: 'visual-lifecycle-empty-orchard-preview',
  };
  residenceMarkers.syncResidences([unselectedOrchardResidence], () => 0);
  backyardMarkers.syncGardens({
    residences: [unselectedOrchardResidence],
    zones: [zone],
    gardens: new Map(),
    getHeightAt: () => 0,
  });
  const orchardPreview = backyardInternals.meshes.get(unselectedOrchardResidence.id);
  assert.ok(orchardPreview);
  assert.equal(orchardPreview.name, 'BackyardPlantingPreview:orchard');
  assert.equal(orchardPreview.userData.backyardPlantingPreview, true);
  assert.equal(orchardPreview.userData.backyardConstructionSite, undefined);
  assert.equal(orchardPreview.userData.plantingLayout?.plots.length ?? 0, 0);
  const orchardPreviewBarrels = orchardPreview.children.filter(
    (child) => child.name === 'Orchard harvest barrel',
  );
  assert.equal(orchardPreviewBarrels.length, 3, 'an unselected orchard project should stage a few barrels');
  assert.ok(
    orchardPreviewBarrels.every((barrel) => (
      barrel.userData.orchardBarrelFenceSide === 'right'
      && barrel.userData.orchardBarrelFilledForSpecialization === false
    )),
    'preview barrels should remain empty and grouped beside the fence',
  );
  assert.equal(
    orchardPreview.getObjectByName('Textured garden soil bed'),
    undefined,
    'orchard barrel staging must not add soil or planting holes',
  );

  const residenceInspectorSource = readFileSync(
    'src/resources/inspector/residenceRenderer.ts',
    'utf8',
  );
  assert.doesNotMatch(residenceInspectorSource, /residenceBackyardProject/);
  assert.doesNotMatch(residenceInspectorSource, /Household works/);
  assert.match(
    residenceInspectorSource,
    /inspect the backyard parcel for construction progress/,
    'the house inspector may point to the plot but must not own its timer or materials',
  );

  residenceMarkers.dispose();
  backyardMarkers.dispose();
}

async function testInspectorHeroArtRefreshStability(): Promise<void> {
  const inspector = Object.create(ResourceInspector.prototype) as ResourceInspector;
  const artClasses = new Set<string>();
  const attributes = new Map<string, string>();
  const assignedSources: string[] = [];
  const decodeRequests: Array<{
    promise: Promise<void>;
    resolve: () => void;
    reject: () => void;
  }> = [];
  const heroImage = {
    hidden: false,
    onload: null,
    onerror: null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    get src(): string {
      return attributes.get('src') ?? '';
    },
    set src(source: string) {
      assignedSources.push(source);
      attributes.set('src', source);
    },
    decode: () => {
      let resolve!: () => void;
      let reject!: () => void;
      const promise = new Promise<void>((resolveRequest, rejectRequest) => {
        resolve = resolveRequest;
        reject = rejectRequest;
      });
      decodeRequests.push({ promise, resolve, reject });
      return promise;
    },
  };
  const heroArt = {
    dataset: {} as Record<string, string>,
    classList: {
      add: (...classes: string[]) => classes.forEach((name) => artClasses.add(name)),
      remove: (...classes: string[]) => classes.forEach((name) => artClasses.delete(name)),
    },
  };
  const internals = inspector as unknown as {
    panel: { dataset: Record<string, string> };
    heroArt: typeof heroArt;
    heroImage: typeof heroImage;
    heroSymbol: { textContent: string };
    heroImageSource: string | null;
    heroImageRequestId: number;
    applyPresentation: (target: InspectableTarget) => void;
  };
  internals.panel = { dataset: {} };
  internals.heroArt = heroArt;
  internals.heroImage = heroImage;
  internals.heroSymbol = { textContent: '' };
  internals.heroImageSource = null;
  internals.heroImageRequestId = 0;

  const lumberArt = '/assets/ui/build-menu/cards/lumber-mill.webp';
  const quarryArt = '/assets/ui/build-menu/cards/stonecutters-camp.webp';
  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'lumber-one',
  }));
  assert.deepEqual(assignedSources, [lumberArt]);
  assert.equal(heroImage.hidden, true);
  assert.equal(heroArt.dataset.artState, 'loading');

  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'lumber-two',
  }));
  assert.deepEqual(
    assignedSources,
    [lumberArt],
    'refreshing or selecting another building with the same art must not restart image decode',
  );

  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'quarry',
    kind: 'stone_quarry',
  }));
  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'lumber-three',
  }));
  assert.deepEqual(assignedSources, [lumberArt, quarryArt, lumberArt]);

  decodeRequests[0]!.reject();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    heroImage.getAttribute('src'),
    lumberArt,
    'a stale failure for an earlier request must not clear the current image',
  );
  assert.equal(heroArt.dataset.artState, 'loading');

  decodeRequests[2]!.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(heroImage.hidden, false);
  assert.equal(heroArt.dataset.artState, 'ready');
  assert.equal(artClasses.has('has-art'), true);

  decodeRequests[1]!.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(heroImage.getAttribute('src'), lumberArt);
  assert.equal(heroArt.dataset.artState, 'ready');

  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'lumber-four',
  }));
  assert.deepEqual(assignedSources, [lumberArt, quarryArt, lumberArt]);
  assert.equal(heroImage.hidden, false);
  assert.equal(heroArt.dataset.artState, 'ready');

  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'missing-quarry-art',
    kind: 'stone_quarry',
  }));
  decodeRequests[3]!.reject();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(heroImage.hidden, true);
  assert.equal(heroImage.getAttribute('src'), null);
  assert.equal(heroArt.dataset.artState, 'fallback');
  assert.equal(artClasses.has('is-art-unavailable'), true);

  internals.applyPresentation(buildingTarget({
    ...constructionBuilding(1, true),
    id: 'missing-quarry-art-refresh',
    kind: 'stone_quarry',
  }));
  assert.deepEqual(
    assignedSources,
    [lumberArt, quarryArt, lumberArt, quarryArt],
    'a failed source must keep its fallback state instead of retrying every refresh',
  );
  assert.equal(heroArt.dataset.artState, 'fallback');
}

function constructionBuilding(
  progress: number,
  constructionComplete: boolean,
): BuildingState {
  return {
    id: 'visual-lifecycle-building',
    kind: 'lumber_mill',
    x: 12,
    z: -8,
    workRadius: 20,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionComplete,
    constructionProgress: progress,
    constructionRequiredTimber: 10,
    constructionRequiredStone: 10,
    constructionRequiredIronwork: 6,
    constructionRequiredRoofTiles: 8,
    constructionDeliveredTimber: 10,
    constructionDeliveredStone: 10,
    constructionDeliveredIronwork: 6,
    constructionDeliveredRoofTiles: 8,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionReservedIronwork: 0,
    constructionReservedRoofTiles: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    constructionTreasuryIronwork: 0,
    constructionTreasuryRoofTiles: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function residence(
  tier: ResidenceState['tier'],
  upgradeTargetTier: 0 | 1 | 2 | 3 | 4,
  upgradeProgress: number,
): ResidenceState {
  const upgradeRequiredRoofTiles = upgradeTargetTier === 4 ? 8 : 0;
  return {
    id: 'visual-lifecycle-residence',
    zoneId: 'visual-lifecycle-zone',
    parcelIndex: 0,
    x: 4,
    z: 9,
    yaw: 0.35,
    population: tier === 0 ? 0 : 4,
    populationCapacity: tier === 0 ? 4 : tier * 2 + 2,
    tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 8,
    upgradeTargetTier,
    upgradeProgress,
    upgradeRequiredTimber: 8,
    upgradeRequiredStone: 8,
    upgradeRequiredGold: 0,
    upgradeRequiredRoofTiles,
    upgradeDeliveredTimber: 8,
    upgradeDeliveredStone: 8,
    upgradeDeliveredGold: 0,
    upgradeDeliveredRoofTiles: upgradeRequiredRoofTiles,
    upgradeReservedTimber: 0,
    upgradeReservedStone: 0,
    upgradeReservedGold: 0,
    upgradeReservedRoofTiles: 0,
    upgradeAssignedLabor: upgradeTargetTier > tier ? 1 : 0,
    upgradePriority: 2,
    tiledRoof: tier >= 4,
  };
}

function backyardProjectResidence(
  progress: number,
  backyardProjectKind: number,
): ResidenceState {
  const placement = layoutFromBurgageZone(zone)?.residences[0];
  assert.ok(placement);
  return {
    ...residence(1, 0, progress),
    x: placement.x,
    z: placement.z,
    yaw: placement.yaw,
    parcelIndex: placement.parcelIndex,
    backyardProjectKind,
    upgradeProgress: progress,
    upgradeRequiredTimber: 8,
    upgradeRequiredStone: 8,
    upgradeDeliveredTimber: 8,
    upgradeDeliveredStone: 8,
    upgradeAssignedLabor: backyardProjectKind > 0 ? 1 : 0,
  };
}

const zone: BurgageZoneState = {
  id: 'visual-lifecycle-zone',
  cornerA: { x: 0, z: 0 },
  cornerB: { x: 10, z: 0 },
  cornerC: { x: 10, z: 20 },
  cornerD: { x: 0, z: 20 },
  frontageEdge: 0,
  plotCount: 1,
};

function buildingTarget(
  building: BuildingState,
): Extract<InspectableTarget, { kind: 'building' }> {
  return {
    kind: 'building',
    building,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  };
}

function residenceTarget(
  candidate: ResidenceState,
): Extract<InspectableTarget, { kind: 'residence' }> {
  return {
    kind: 'residence',
    residence: candidate,
    zone,
    residenceCount: 1,
  };
}

function buildingTargetSignature(building: BuildingState): string {
  return `building:${building.id}:${building.constructionComplete ? 'complete' : Math.round(building.constructionProgress * 100)}`;
}

function residenceTargetSignature(candidate: ResidenceState): string {
  const project = residenceUpgradeProject(candidate);
  return `residence:${candidate.id}:tier-${candidate.tier}:${project ? Math.round(project.progress * 100) : 'complete'}`;
}

function inspectableSignature(target: InspectableTarget): string {
  if (target.kind === 'building') return buildingTargetSignature(target.building);
  if (target.kind === 'residence') return residenceTargetSignature(target.residence);
  return target.kind;
}

function createInspectorRefreshHarness(initial: InspectableTarget): {
  refreshTo: (target: InspectableTarget) => void;
  lastRendered: () => string;
} {
  let latest = initial;
  const renders: string[] = [];
  const inspector = Object.create(ResourceInspector.prototype) as ResourceInspector;
  const internals = inspector as unknown as {
    options: {
      worldQueries: { findInspectableTarget: () => InspectableTarget | null };
      onSelectionChange?: (target: InspectableTarget) => void;
    };
    selectedTarget: InspectableTarget | null;
    selectedX: number;
    selectedZ: number;
    renderTarget: (target: InspectableTarget) => void;
  };
  internals.options = {
    worldQueries: { findInspectableTarget: () => latest },
  };
  internals.selectedTarget = initial;
  internals.selectedX = 0;
  internals.selectedZ = 0;
  internals.renderTarget = (target) => renders.push(inspectableSignature(target));
  return {
    refreshTo: (target) => {
      latest = target;
      inspector.refreshSelection();
      assert.strictEqual(
        internals.selectedTarget,
        target,
        'inspector refresh must replace the selected snapshot with current authority',
      );
      assert.equal(renders.at(-1), inspectableSignature(target));
    },
    lastRendered: () => renders.at(-1) ?? '',
  };
}

function constructionInspectorContext(site: BuildingState): unknown {
  return {
    gameState: {
      tick: 0,
      buildings: new Map([[site.id, site]]),
      deliveryTrips: new Map(),
      fireIncidents: new Map(),
    },
    worldQueries: {
      getInboundSupplyTrip: () => null,
      getBuilding: () => null,
      getActiveDeliveryTrip: () => null,
      getRoadAccessLabel: () => 'Connected (5 m to road)',
    },
    populationStats: {
      total: 12,
      assigned: 1,
      cartAssigned: 0,
      available: 11,
      housingCapacity: 12,
      housed: 12,
      vacant: 0,
    },
    resourceTotals: {},
  };
}

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

function countNamed(root: THREE.Object3D, name: string): number {
  let count = 0;
  root.traverse((object) => {
    if (object.name === name) count += 1;
  });
  return count;
}

function countNamePrefix(root: THREE.Object3D, prefix: string): number {
  let count = 0;
  root.traverse((object) => {
    if (object.name.startsWith(prefix)) count += 1;
  });
  return count;
}

function countNamePattern(root: THREE.Object3D, pattern: RegExp): number {
  let count = 0;
  root.traverse((object) => {
    if (pattern.test(object.name)) count += 1;
  });
  return count;
}

function countDirectLifecycleRoots(root: THREE.Object3D, name: string): number {
  return root.children.reduce(
    (total, child) => total + countNamed(child, name),
    0,
  );
}

function countResidenceMarkerRoots(root: THREE.Group): number {
  return root.children.filter(
    (child) => child.userData.residenceTier !== undefined,
  ).length;
}

function isEffectivelyVisible(
  object: THREE.Object3D,
  inclusiveRoot: THREE.Object3D,
): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === inclusiveRoot) return true;
    current = current.parent;
  }
  return false;
}

function countEffectivelyVisiblePrefix(
  root: THREE.Object3D,
  prefix: string,
): number {
  let count = 0;
  root.traverse((object) => {
    if (object.name.startsWith(prefix) && isEffectivelyVisible(object, root)) count += 1;
  });
  return count;
}

function collectMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) materials.add(material);
    } else if (mesh.material) {
      materials.add(mesh.material);
    }
  });
  return materials;
}

function disposeGeometryOnly(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) geometries.add(mesh.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

function disposeResidenceGeometry(root: THREE.Group): void {
  disposeGeometryOnly(root);
  const windowMaterial = root.userData.windowMaterial as THREE.Material | undefined;
  windowMaterial?.dispose();
}

testConstructionSiteCheckpoints();
testConstructionMarkerReplacementAndInspectorRefresh();
testResidenceMaterialOwnership();
testResidenceCheckpointAndTierReplacement();
testBackyardConstructionOwnership();
await testInspectorHeroArtRefreshStability();

console.log(
  [
    'construction/residence visual lifecycle checks passed',
    `construction signatures=${EXPECTED_SITE_SIGNATURES.join(',')}`,
    `construction meshes=${EXPECTED_SITE_MESH_COUNTS.join(',')}`,
    `initial cottage frame=${EXPECTED_INITIAL_FRAME_PARTS.join(',')},completed=0`,
    `upgrade pile segments=${EXPECTED_RESIDENCE_SEGMENTS.join(',')},completed=0`,
    'backyard worksite=parcel-owned with atomic garden handoff',
    'material ownership=7 pooled construction-site + 6 pooled residence-work materials',
  ].join(' | '),
);
