import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  GAME_HABITAT_DISRUPTION_RADIUS,
} from '../src/generated/gameBalance.ts';
import { intersectTerrainHeightfieldRay } from '../src/terrain/TerrainProjector.ts';
import {
  BuildingTerrainLayout,
  getBuildingFootprintCorners,
  getBuildingFootprintHalfExtents,
  getBuildingSiteClearanceSearchRadius,
  pointWithinBuildingSiteClearance,
} from '../src/buildings/BuildingTerrainLayout.ts';
import {
  BUILDING_LOCAL_VISUAL_BOUNDS,
  BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
  type BuildingLocalVisualBounds,
} from '../src/buildings/BuildingVisualBounds.ts';
import {
  BUILDING_EDGE_CLEARANCE,
  BUILDING_EDGE_SNAP_DISTANCE,
  buildingFootprintEdgeDistance,
  resolveBuildingEdgeSnap,
} from '../src/buildings/BuildingSpacing.ts';
import { collectPlacedBuildingSources } from '../src/app/placedBuildingTerrainSync.ts';
import {
  buildingPlacementYaw,
  resolveRoadsideBuildingPlacement,
  resolveRoadsideBuildingPlacementCandidates,
} from '../src/buildings/buildingPlacement.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
  updateBuildingPreviewGeometry,
} from '../src/buildings/BuildingPlacementPreview.ts';
import {
  resolveBuildingPlacementWildlifePreview,
} from '../src/buildings/buildingPlacementWildlifePreview.ts';
import {
  buildingFootprintOverlapsRoadSurface,
  chooseRoadClearBuildingPlacement,
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import { PlacementClearanceSpatialIndex } from '../src/placement/PlacementClearanceSpatialIndex.ts';
import {
  polygonSegments,
  updateTerrainCircleFillGeometry,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../src/placement/TerrainOverlayGeometry.ts';
import {
  circleGridSegments,
  clampForestryWorkAreaRadius,
  FORESTRY_WORK_AREA_MAX_RADIUS,
  FORESTRY_WORK_AREA_MIN_RADIUS,
  resizeForestryWorkAreaRadius,
} from '../src/resources/ForestryWorkAreaTool.ts';
import { QuarryLayout, quarrySiteOverlapsRiver } from '../src/quarries/QuarryLayout.ts';
import {
  burgageZoneTouchesWater,
  validateBurgagePlacement,
} from '../src/residences/burgagePlacementValidation.ts';
import { BurgagePreview } from '../src/residences/BurgagePreview.ts';
import { BurgageTool } from '../src/residences/BurgageTool.ts';
import {
  backyardGardenClearancePolygon,
  backyardGardenPlacementForParcel,
} from '../src/residences/backyardPosition.ts';
import { resolveCurvedFrontageLine } from '../src/residences/burgageRoadFrontage.ts';
import { resolveRoadCenterPathForFrontage } from '../src/residences/burgageFrontagePath.ts';
import {
  MIN_ZONE_DEPTH,
  STANDARD_ZONE_DEPTH,
  cornersFromPoints,
  measureZoneSideDepths,
  resolveBurgageLayout,
} from '../src/residences/burgageLayout.ts';
import { isPointInPolygon2 } from '../src/utils/polygonGeometry.ts';
import { RiverLayout } from '../src/rivers/RiverLayout.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  BUILDING_ROAD_CONNECTION_CENTER_OFFSET,
  BUILDING_ROAD_CONNECTION_EDGE_CLEARANCE,
  BUILDING_ROAD_CONNECTION_MARKER_OUTER_RADIUS,
  getBuildingRoadConnectionPoints,
} from '../src/roads/BuildingRoadConnections.ts';
import type {
  BuildingKind,
  BuildingState,
  ForagingNodeState,
  GameState,
  ResidenceState,
  ResourceNodeState,
} from '../src/resources/types.ts';
import {
  deriveSubSeed,
  hydrologyRiverCount,
  hydrologyTributaryCount,
  MAP_SIZE_PRESETS,
  scaledRiverDrain,
} from '../src/world/worldGenerationSettings.ts';
import {
  describeBuildingPlacementBlocker,
  describeToolbarStatus,
} from '../src/ui/buildToolbarStatus.ts';

function testClearanceSpatialIndexKeepsNearbyCandidates(): void {
  const stonecutter = { kind: 'stone_quarry' as const, x: 47, z: -47 };
  const burgage = [
    { x: -72, z: -12 },
    { x: 72, z: -12 },
    { x: 72, z: 12 },
    { x: -72, z: 12 },
  ];
  const field = [
    { x: 90, z: 90 },
    { x: 160, z: 90 },
    { x: 160, z: 140 },
    { x: 90, z: 140 },
  ];
  const index = new PlacementClearanceSpatialIndex([stonecutter], [burgage], [field]);

  assert(index.buildingsNear(20, -47, 5).includes(stonecutter));
  assert(index.burgageParcelsNear(0, 13, 2).includes(burgage));
  assert(index.farmFieldsNear(88, 100, 3).includes(field));
  assert(index.someBuildingNear(20, -47, 5, (candidate) => candidate === stonecutter));
  assert(index.someBurgageParcelNear(0, 13, 2, (candidate) => candidate === burgage));
  assert(index.someFarmFieldNear(88, 100, 3, (candidate) => candidate === field));
  assert.equal(index.buildingsNear(
    stonecutter.x + getBuildingSiteClearanceSearchRadius() + 96,
    stonecutter.z,
  ).length, 0);
}

function testQuarryFootprintsAvoidRivers(): void {
  let checkedWorlds = 0;
  for (const [mapSize, dimensions] of Object.entries(MAP_SIZE_PRESETS)) {
    const halfTerrain = dimensions.terrainSize * 0.5;
    const bounds = {
      minX: -halfTerrain,
      maxX: halfTerrain,
      minZ: -halfTerrain,
      maxZ: halfTerrain,
    };
    for (let seed = 1; seed <= 12; seed++) {
      const riverLayout = RiverLayout.create({
        bounds,
        seed: deriveSubSeed(seed, 'river'),
        riverCount: hydrologyRiverCount(100),
        tributaryCount: hydrologyTributaryCount(100),
        drain: scaledRiverDrain(dimensions.playableHalf),
      });
      const quarries = QuarryLayout.create({
        bounds,
        seed,
        riverLayout,
        playableHalf: dimensions.playableHalf,
      });
      assert.equal(
        quarries.sites.length,
        3,
        `${mapSize} seed ${seed} should still produce all quarry sites`,
      );
      for (const site of quarries.sites) {
        assert.equal(
          quarrySiteOverlapsRiver(site, riverLayout),
          false,
          `${mapSize} seed ${seed} placed a ${site.kind} quarry across a river`,
        );
      }
      checkedWorlds++;
    }
  }
  assert.equal(checkedWorlds, 36);
}

function testBurgageWaterValidationSamplesTheWholeZone(): void {
  const zone = {
    a: { x: 0, z: 0 },
    b: { x: 24, z: 0 },
    c: { x: 24, z: 20 },
    d: { x: 0, z: 20 },
  };

  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => Math.abs(x - 12) <= 0.8 && z >= 4 && z <= 16),
    true,
    'water crossing only the middle of a zone must be detected',
  );
  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => Math.abs(z - 10) <= 0.8 && x >= 20 && x <= 28),
    true,
    'water crossing a zone edge between dry corners must be detected',
  );
  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => x >= 25.5 && z >= 4 && z <= 16),
    false,
    'nearby water outside the parcel must not block dry shoreline placement',
  );
}

function testOrganicBurgagePlotsAndPreviewIcons(): void {
  const authoredRearCorner = new THREE.Vector3(-3, 0, 12);
  const draftTool = Object.create(BurgageTool.prototype) as BurgageTool;
  Object.assign(draftTool as object, {
    placementStage: 3,
    points: [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(24, 0, 0),
      new THREE.Vector3(27, 0, 18),
    ],
    hoverPoint: authoredRearCorner,
    options: { getHeightAt: () => 0 },
  });
  const draftCorners = (draftTool as unknown as {
    resolvePreviewCorners: () => THREE.Vector3[];
  }).resolvePreviewCorners();
  assert.deepEqual(
    { x: draftCorners[3].x, z: draftCorners[3].z },
    { x: -3, z: 12 },
    'the fourth plot point must remain the independently picked rear corner',
  );

  const angledCorners = cornersFromPoints([
    { x: 0, z: 0 },
    { x: 24, z: 0 },
    { x: 27, z: 18 },
    { x: -3, z: 12 },
  ]);
  assert.ok(angledCorners);
  assert.deepEqual(
    measureZoneSideDepths(angledCorners, 0).map((depth) => Math.round(depth)),
    [12, 18],
    'independently authored rear corners must retain their different perpendicular depths',
  );
  const angledLayout = resolveBurgageLayout(angledCorners, 0, 3);
  assert.ok(angledLayout && angledLayout.residences.length >= 2);
  assert.notEqual(
    angledLayout.parcels[0].polygon[3].z,
    angledLayout.parcels.at(-1)?.polygon[2].z,
    'parcel subdivision must follow the angled rear boundary instead of rebuilding a rectangle',
  );
  for (const residence of angledLayout.residences) {
    const parcel = angledLayout.parcels.find((entry) => entry.index === residence.parcelIndex);
    assert.ok(parcel);
    const frontageLength = Math.hypot(
      parcel.frontRight.x - parcel.frontLeft.x,
      parcel.frontRight.z - parcel.frontLeft.z,
    );
    const frontageDirection = {
      x: (parcel.frontRight.x - parcel.frontLeft.x) / frontageLength,
      z: (parcel.frontRight.z - parcel.frontLeft.z) / frontageLength,
    };
    const houseRight = { x: Math.cos(residence.yaw), z: -Math.sin(residence.yaw) };
    assert.ok(
      Math.abs(frontageDirection.x * houseRight.x + frontageDirection.z * houseRight.z) > 0.999999,
      'the house, not a skewed side or rear fence, must author the parcel alignment',
    );

    const backyard = backyardGardenPlacementForParcel(residence, parcel);
    if (!backyard) continue;
    assert.equal(backyard.yaw, residence.yaw, 'every backyard extension must inherit the house yaw');
    assert.ok(
      Math.abs(
        (backyard.x - residence.x) * houseRight.x
        + (backyard.z - residence.z) * houseRight.z
      ) < 1e-6,
      'every backyard extension must retain the house centerline even when its fence is skewed',
    );
    for (const corner of backyardGardenClearancePolygon(backyard, 0)) {
      assert.ok(
        isPointInPolygon2(corner, parcel.polygon),
        'a house-aligned backyard footprint must remain inside its skewed parcel',
      );
    }
  }

  const shallowDepth = MIN_ZONE_DEPTH + 0.2;
  const shallowCorners = cornersFromPoints([
    { x: 0, z: 0 },
    { x: 24, z: 0 },
    { x: 24, z: shallowDepth },
    { x: 0, z: shallowDepth },
  ]);
  assert.ok(shallowCorners);
  const shallowLayout = resolveBurgageLayout(shallowCorners, 0, 3);
  assert.ok(shallowLayout && shallowLayout.residences.length === 3);
  for (const residence of shallowLayout.residences) {
    const parcel = shallowLayout.parcels.find((entry) => entry.index === residence.parcelIndex);
    assert.ok(parcel);
    assert.equal(
      backyardGardenPlacementForParcel(residence, parcel),
      null,
      'a cottage may fit while its parcel remains too shallow for a backyard attachment',
    );
  }

  const deepCorners = cornersFromPoints([
    { x: 0, z: 0 },
    { x: 24, z: 0 },
    { x: 24, z: 18 },
    { x: 0, z: 18 },
  ]);
  assert.ok(deepCorners);
  const deepLayout = resolveBurgageLayout(deepCorners, 0, 3);
  assert.ok(deepLayout && deepLayout.residences.length === 3);

  const unlimitedDepthCorners = cornersFromPoints([
    { x: 0, z: 0 },
    { x: 24, z: 0 },
    { x: 24, z: 50 },
    { x: 0, z: 50 },
  ]);
  assert.ok(unlimitedDepthCorners);
  const unlimitedDepthLayout = resolveBurgageLayout(unlimitedDepthCorners, 0, 3);
  assert.ok(
    unlimitedDepthLayout && unlimitedDepthLayout.residences.length === 3,
    'residence depth beyond the standard pricing threshold must remain buildable',
  );
  assert.ok(50 > STANDARD_ZONE_DEPTH * 2);
  assert.ok(
    unlimitedDepthLayout.depthCostMultiplier > 10,
    'extreme plot depth should carry a prohibitive quadratic site-work premium',
  );
  assert.ok(unlimitedDepthLayout.totalCost.timber > deepLayout.totalCost.timber * 10);
  const unlimitedGarden = backyardGardenPlacementForParcel(
    unlimitedDepthLayout.residences[0],
    unlimitedDepthLayout.parcels[0],
  );
  assert.ok(unlimitedGarden);
  assert.ok(
    unlimitedGarden.depth > 35,
    'garden beds must use the deep backyard instead of stopping at the former generic depth cap',
  );
  assert.ok(
    unlimitedGarden.width > 6.8,
    'garden beds must use nearly the full parcel frontage while retaining fence clearance',
  );

  const preview = new BurgagePreview();
  const shallowPreviewCorners = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(24, 0, 0),
    new THREE.Vector3(24, 0, shallowDepth),
    new THREE.Vector3(0, 0, shallowDepth),
  ];
  preview.update(
    shallowPreviewCorners,
    shallowLayout,
    true,
    () => 0,
    false,
    4,
    null,
    0,
    shallowPreviewCorners,
    2,
    shallowPreviewCorners,
    null,
  );
  const residenceIcons = preview.group.getObjectByName('Residence placement icons') as THREE.InstancedMesh;
  const backyardIcons = preview.group.getObjectByName('Backyard extension placement icons') as THREE.InstancedMesh;
  assert.equal(residenceIcons.count, 3, 'shallow plots should retain their cottage placement icons');
  assert.equal(backyardIcons.count, 0, 'shallow plots should omit backyard extension icons');

  const previewCorners = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(24, 0, 0),
    new THREE.Vector3(24, 0, 18),
    new THREE.Vector3(0, 0, 18),
  ];
  preview.update(
    previewCorners,
    deepLayout,
    false,
    () => 0,
    true,
    3,
    previewCorners[3],
    0,
    previewCorners,
    2,
    previewCorners.slice(0, 3),
    null,
  );
  const border = preview.group.getObjectByName('Residence plot dotted border') as THREE.Mesh;
  assert.equal(residenceIcons.count, 3, 'every fitting cottage should have a placement icon');
  assert.equal(backyardIcons.count, 3, 'every deep-enough parcel should have a backyard icon');
  assert.equal(
    (border.material as THREE.MeshBasicMaterial).color.getHex(),
    0xff5d50,
    'a complete hovered four-corner preview must turn red before the final click when invalid',
  );
  preview.dispose();
}

function testBurgageTerrainRulesAreLotFriendly(): void {
  const roads = new RoadNetwork();
  roads.addRoadPath([
    new THREE.Vector3(-10, 0, 0),
    new THREE.Vector3(34, 0, 0),
  ]);
  const corners = [
    new THREE.Vector3(0, 0, 2),
    new THREE.Vector3(24, 0, 2),
    new THREE.Vector3(24, 0, 20),
    new THREE.Vector3(0, 0, 20),
  ];
  const validation = validateBurgagePlacement({
    corners,
    frontageEdge: 0,
    plotCount: 3,
    stockpile: { timber: 10_000, stone: 10_000 },
    existingZones: [],
    existingBuildings: [],
    roadNetwork: roads,
    isWaterAt: () => false,
    getNaturalHeightAt: (x) => x * 0.5,
  });
  assert.equal(
    validation.ok,
    true,
    'a steep overall lot should pass when each actual cottage footprint can be leveled',
  );

  const draftTool = Object.create(BurgageTool.prototype) as BurgageTool;
  Object.assign(draftTool as object, {
    placementStage: 2,
    points: corners.slice(0, 2),
    options: { roadNetwork: roads, getHeightAt: () => 0 },
  });
  const corrected = (draftTool as unknown as {
    constrainBackPointToMinimumDepth: (point: THREE.Vector3) => THREE.Vector3;
  }).constrainBackPointToMinimumDepth(new THREE.Vector3(24, 0, 5));
  assert.ok(
    corrected.z >= 2 + MIN_ZONE_DEPTH - 1e-6,
    'a shallow rear click should auto-expand to cottage depth instead of becoming an error',
  );
}

function testBurgageBuildingOverlapUsesVisibleFootprints(): void {
  const roads = new RoadNetwork();
  roads.addRoadPath([
    new THREE.Vector3(-6, 0, 0),
    new THREE.Vector3(18, 0, 0),
  ]);
  const well = {
    id: 'well-visible-footprint-regression',
    kind: 'well',
    x: 0,
    z: 8,
  } as BuildingState;
  const gameState = {
    buildings: new Map([[well.id, well]]),
    burgageZones: new Map(),
    farmFields: new Map(),
  } as GameState;
  const context = {
    frontageEdge: 0 as const,
    plotCount: 1,
    stockpile: { timber: 10_000, stone: 10_000 },
    existingZones: [],
    existingBuildings: [well],
    roadNetwork: roads,
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
    gameState,
  };

  const clearPlacement = validateBurgagePlacement({
    ...context,
    corners: [
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(11, 0, 2),
      new THREE.Vector3(11, 0, 14),
      new THREE.Vector3(3, 0, 14),
    ],
  });
  assert.equal(
    clearPlacement.ok,
    true,
    'empty land outside the visible well footprint must not be rejected by its much larger pick radius',
  );

  const overlappingPlacement = validateBurgagePlacement({
    ...context,
    corners: [
      new THREE.Vector3(1.5, 0, 2),
      new THREE.Vector3(9.5, 0, 2),
      new THREE.Vector3(9.5, 0, 14),
      new THREE.Vector3(1.5, 0, 14),
    ],
  });
  assert.deepEqual(
    overlappingPlacement,
    { ok: false, reason: 'overlaps_building' },
    'a plot that reaches the visible well footprint must still be blocked',
  );
}

function testBurgageFrontageDirectionAndRoadSideSelection(): void {
  const roads = new RoadNetwork();
  roads.addRoadPath([
    new THREE.Vector3(-40, 0, 0),
    new THREE.Vector3(40, 0, 0),
  ]);

  const tool = Object.create(BurgageTool.prototype) as BurgageTool;
  Object.assign(tool as object, {
    options: { roadNetwork: roads, getHeightAt: () => 0 },
    placementStage: 0,
    points: [],
    frontageCenters: [],
    frontageOffsetSide: null,
    hoverOffsetSide: null,
    hoverCenter: null,
  });
  const internals = tool as unknown as {
    applyRoadSnap: (point: THREE.Vector3) => THREE.Vector3;
    recordFrontageCenter: (clientX: number, clientY: number, point: THREE.Vector3) => void;
    resolvePreviewOutline: () => { points: THREE.Vector3[] } | null;
    frontageOffsetSide: 1 | -1 | null;
  };

  const northHover = internals.applyRoadSnap(new THREE.Vector3(12, 0, 5));
  const southHover = internals.applyRoadSnap(new THREE.Vector3(12, 0, -5));
  assert(northHover.z > 0 && southHover.z < 0, 'an uncommitted frontage hover must follow either road side');
  assert.equal(
    internals.frontageOffsetSide,
    null,
    'hovering the first frontage must not permanently lock a road side',
  );
  const southPreview = internals.resolvePreviewOutline();
  assert(
    southPreview?.points.every((point) => point.z < 0),
    'the initial dotted frontage preview must render on the live cursor side',
  );

  const acceptedNorth = internals.applyRoadSnap(new THREE.Vector3(20, 0, 5));
  internals.recordFrontageCenter(0, 0, acceptedNorth);
  assert.notEqual(internals.frontageOffsetSide, null, 'the first accepted frontage point should lock its side');
  const lockedSecond = internals.applyRoadSnap(new THREE.Vector3(-20, 0, -5));
  assert(lockedSecond.z > 0, 'the second frontage point should remain on the accepted first side');

  const centerPath = resolveRoadCenterPathForFrontage(
    roads,
    { x: 20, z: 0 },
    { x: -20, z: 0 },
    { x: 20, z: 0 },
    { x: -20, z: 0 },
  );
  assert.ok(centerPath && centerPath.length >= 2);
  assert(
    Math.abs(centerPath[0].x - 20) < 0.01 && Math.abs(centerPath.at(-1)!.x + 20) < 0.01,
    'a reverse-drawn frontage must preserve A-to-B click order',
  );

  const curved = resolveCurvedFrontageLine(
    { x: acceptedNorth.x, z: acceptedNorth.z },
    { x: lockedSecond.x, z: lockedSecond.z },
    roads,
    { x: 20, z: 0 },
    { x: -20, z: 0 },
    internals.frontageOffsetSide ?? 1,
  );
  assert(
    Math.abs(curved[0].x - acceptedNorth.x) < 0.01
      && Math.abs(curved.at(-1)!.x - lockedSecond.x) < 0.01,
    'the rendered frontage must connect each accepted endpoint without crossing the plot',
  );
  assert(curved.every((point) => point.z > 0), 'reverse-drawn frontage must stay on its selected road side');
}

function testMovableBuildingsSnapToRoadSides(): void {
  const roads = new RoadNetwork();
  roads.addRoadPath([
    new THREE.Vector3(-40, 0, 0),
    new THREE.Vector3(40, 0, 0),
  ]);

  const north = resolveRoadsideBuildingPlacement('smithy', 7, 6, roads);
  const south = resolveRoadsideBuildingPlacement('smithy', -9, -5, roads);
  assert(Math.abs(north.x - 7) < 0.01, 'roadside snapping should retain distance along the road');
  assert(Math.abs(south.x + 9) < 0.01, 'roadside snapping should retain distance along the road');
  assert(north.z > 7, 'a north-side cursor should snap outside the north road verge');
  assert(south.z < -7, 'a south-side cursor should snap outside the south road verge');
  assert(
    Math.abs(Math.abs(north.z) - Math.abs(south.z)) < 0.01,
    'both road sides should use the same building-aware setback',
  );
  assert(
    Math.abs(Math.abs(buildingPlacementYaw('smithy', north.x, north.z, roads)) - Math.PI) < 0.01,
    'the snapped building entrance should face back toward the road',
  );
  assert(
    Math.abs(buildingPlacementYaw('smithy', south.x, south.z, roads)) < 0.01,
    'the entrance should face back toward the road from its opposite verge too',
  );
  assert(
    resolveRoadsideBuildingPlacement('well', 4, 5, roads).z > 5,
    'road-dependent utility buildings should also settle onto the road verge',
  );
  const reclamationPile = resolveRoadsideBuildingPlacement('salvage_pile', 13, 6, roads);
  assert(
    Math.abs(Math.abs(
      buildingPlacementYaw('salvage_pile', reclamationPile.x, reclamationPile.z, roads),
    ) - Math.PI) < 0.01,
    'every road-snapped footprint should face the road even without an authored facade flag',
  );

  const anchoredKinds = new Set<BuildingKind>([
    'large_quarry',
    'mine',
    // Retained only so loaded legacy Clay Pits keep their authored position.
    'clay_pit',
    'watermill',
  ]);
  for (const kind of BUILDING_KINDS) {
    const cursor = { x: 4, z: 6 };
    const candidates = resolveRoadsideBuildingPlacementCandidates(
      kind,
      cursor.x,
      cursor.z,
      roads,
    );
    if (anchoredKinds.has(kind)) {
      assert.deepEqual(
        candidates,
        [cursor],
        `${kind} should retain its exact shore or deposit anchor`,
      );
      continue;
    }

    assert.equal(candidates.length, 2, `${kind} should expose both road verges`);
    assert(
      candidates.every((candidate) => Math.abs(candidate.x - cursor.x) < 0.01),
      `${kind} should preserve the cursor's position along the road`,
    );
    assert(
      candidates[0].z > 0 && candidates[1].z < 0,
      `${kind} should prefer the cursor side and retain the opposite verge fallback`,
    );
    assert(
      candidates.every((candidate) =>
        !buildingFootprintOverlapsRoadSurface(kind, candidate.x, candidate.z, roads)
      ),
      `${kind} should clear the road on both snapped verges`,
    );
    assert(
      Math.abs(Math.abs(
        buildingPlacementYaw(kind, candidates[0].x, candidates[0].z, roads),
      ) - Math.PI) < 0.01,
      `${kind} should face the road from the preferred verge`,
    );
    assert.deepEqual(
      resolveRoadsideBuildingPlacement(kind, cursor.x, cursor.z, null),
      cursor,
      `${kind} should retain free placement when road snapping is disabled`,
    );
  }
  assert.deepEqual(
    resolveRoadsideBuildingPlacement('smithy', 4, 40, roads),
    { x: 4, z: 40 },
    'the roadside magnet should release distant cursor positions',
  );

  const parallelRoads = new RoadNetwork();
  parallelRoads.addRoadPath([
    new THREE.Vector3(-40, 0, 0),
    new THREE.Vector3(40, 0, 0),
  ]);
  parallelRoads.addRoadPath([
    new THREE.Vector3(-40, 0, 8.15),
    new THREE.Vector3(40, 0, 8.15),
  ]);
  const vergeCandidates = resolveRoadsideBuildingPlacementCandidates(
    'smithy',
    0,
    1,
    parallelRoads,
  );
  assert.equal(vergeCandidates.length, 2, 'road snapping should expose both verge choices');
  assert(
    buildingFootprintOverlapsRoadSurface(
      'smithy',
      vergeCandidates[0].x,
      vergeCandidates[0].z,
      parallelRoads,
    ),
    'the cursor-preferred verge may be blocked by a nearby road branch',
  );
  const clearVerge = chooseRoadClearBuildingPlacement(
    'smithy',
    vergeCandidates,
    parallelRoads,
  );
  assert.ok(clearVerge && clearVerge.z < 0, 'an obstructed preferred verge should fall across the road');
  assert.equal(
    buildingFootprintOverlapsRoadSurface('smithy', clearVerge.x, clearVerge.z, parallelRoads),
    false,
    'the selected fallback verge must clear every road surface',
  );

  const diagonalRoads = new RoadNetwork();
  diagonalRoads.addRoadPath([
    new THREE.Vector3(-30, 0, -30),
    new THREE.Vector3(30, 0, 30),
  ]);
  const diagonal = resolveRoadsideBuildingPlacement('smithy', -2, 8, diagonalRoads);
  const diagonalYaw = buildingPlacementYaw(
    'smithy',
    diagonal.x,
    diagonal.z,
    diagonalRoads,
  );
  const diagonalCorners = getBuildingFootprintCorners(
    'smithy',
    diagonal.x,
    diagonal.z,
    diagonalYaw,
  );
  const borderDx = diagonalCorners[1].x - diagonalCorners[0].x;
  const borderDz = diagonalCorners[1].z - diagonalCorners[0].z;
  const cross = borderDx - borderDz;
  assert(
    Math.abs(cross) < 1e-6,
    'the road-facing footprint border should be parallel to a diagonal road',
  );

  const mill = resolveRoadsideBuildingPlacement('lumber_mill', -2, 8, diagonalRoads);
  const millYaw = buildingPlacementYaw('lumber_mill', mill.x, mill.z, diagonalRoads);
  assert.equal(
    buildingFootprintOverlapsRoadSurface('lumber_mill', mill.x, mill.z, diagonalRoads),
    false,
    'a snapped lumber mill footprint must clear the road it faces',
  );
  const roadFacingState = {
    buildings: new Map([
      ['road-facing-mill', {
        id: 'road-facing-mill',
        kind: 'lumber_mill',
        x: mill.x,
        z: mill.z,
      }],
    ]),
  } as unknown as GameState;
  const [millTerrainSource] = collectPlacedBuildingSources(
    roadFacingState,
    diagonalRoads,
  );
  assert.ok(millTerrainSource);
  assert.ok(
    Math.abs((millTerrainSource.yaw ?? 0) - millYaw) < 1e-6,
    'placed terrain sources must retain the mesh yaw resolved from the live road network',
  );
  const [millPad] = BuildingTerrainLayout.fromBuildings(
    [millTerrainSource],
    () => 0,
  ).sites;
  assert.ok(millPad);
  assert.ok(
    Math.abs(millPad.rotation + millYaw) < 1e-6,
    'the terrain pad must use the same road-facing yaw as the rendered building',
  );
  const cos = Math.cos(millYaw);
  const sin = Math.sin(millYaw);
  assert.equal(
    pointWithinBuildingSiteClearance(
      mill.x + 8 * cos,
      mill.z - 8 * sin,
      millTerrainSource,
    ),
    true,
    'clearance must retain the long local axis of the road-facing building pad',
  );
  assert.equal(
    pointWithinBuildingSiteClearance(
      mill.x + 8 * sin,
      mill.z + 8 * cos,
      millTerrainSource,
    ),
    false,
    'clearance must not rotate the short local axis back to the fallback yaw',
  );
}

function testPlacementOverlaysFollowTerrainHeight(): void {
  const corners = [
    { x: -5, z: -4 },
    { x: 6, z: -4 },
    { x: 6, z: 5 },
    { x: -5, z: 5 },
  ] as const;
  const heightAt = (x: number, z: number) => Math.sin(x * 0.2) + Math.cos(z * 0.15);

  const fillGeometry = new THREE.BufferGeometry();
  updateTerrainQuadGeometry(fillGeometry, corners, heightAt, 0.1, 5, 5);
  const fillPositions = fillGeometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(
    fillGeometry.getIndex(),
    null,
    'live placement fills must not depend on a WebGPU index buffer',
  );
  for (let index = 0; index < fillPositions.count; index++) {
    assert.ok(
      Math.abs(
        fillPositions.getY(index)
        - (heightAt(fillPositions.getX(index), fillPositions.getZ(index)) + 0.1)
      ) < 1e-5,
      'placement fill vertices must stay just above the sampled terrain',
    );
  }
  updateTerrainQuadGeometry(
    fillGeometry,
    corners.map((point) => ({ x: point.x + 2, z: point.z - 3 })) as typeof corners,
    heightAt,
    0.1,
    5,
    5,
  );
  assert.strictEqual(
    fillGeometry.getAttribute('position'),
    fillPositions,
    'same-topology preview movement must retain the WebGPU position buffer',
  );
  assert.equal(fillGeometry.getIndex(), null);

  const borderGeometry = new THREE.BufferGeometry();
  updateTerrainRibbonGeometry(
    borderGeometry,
    polygonSegments(corners),
    heightAt,
    { width: 0.2, lift: 0.16, sampleSpacing: 0.75, dashLength: 1.4, gapLength: 0.8 },
  );
  const borderPositions = borderGeometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(
    borderGeometry.getIndex(),
    null,
    'live placement ribbons must not depend on a WebGPU index buffer',
  );
  assert.ok(borderPositions.count > 16, 'dotted footprint border should be terrain-sampled');
  for (let index = 0; index < borderPositions.count; index++) {
    assert.ok(
      Math.abs(
        borderPositions.getY(index)
        - (heightAt(borderPositions.getX(index), borderPositions.getZ(index)) + 0.16)
      ) < 1e-5,
      'placement border vertices must stay just above the sampled terrain',
    );
  }
  updateTerrainRibbonGeometry(
    borderGeometry,
    polygonSegments(corners.map(
      (point) => ({ x: point.x + 2, z: point.z - 3 }),
    ) as typeof corners),
    heightAt,
    { width: 0.2, lift: 0.16, sampleSpacing: 0.75, dashLength: 1.4, gapLength: 0.8 },
  );
  assert.strictEqual(
    borderGeometry.getAttribute('position'),
    borderPositions,
    'same-topology ribbon movement must retain the WebGPU position buffer',
  );
  assert.equal(borderGeometry.getIndex(), null);

  const workAreaCenter = { x: 13, z: -17 };
  const workAreaRadius = 40;
  const circleGeometry = new THREE.BufferGeometry();
  updateTerrainCircleFillGeometry(
    circleGeometry,
    workAreaCenter,
    workAreaRadius,
    heightAt,
    { lift: 0.105, radialSpacing: 7, segmentCount: 48 },
  );
  const circlePositions = circleGeometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(
    circleGeometry.getIndex(),
    null,
    'the forestry work-area fill must remain WebGPU-safe and non-indexed',
  );
  assert.ok(circlePositions.count > 48, 'the work-area fill should use terrain-sampled rings');
  for (let index = 0; index < circlePositions.count; index += 1) {
    const x = circlePositions.getX(index);
    const y = circlePositions.getY(index);
    const z = circlePositions.getZ(index);
    assert.ok(
      Math.hypot(x - workAreaCenter.x, z - workAreaCenter.z) <= workAreaRadius + 1e-4,
      'work-area fill vertices must stay inside the authored circle',
    );
    assert.ok(
      Math.abs(y - (heightAt(x, z) + 0.105)) < 1e-5,
      'work-area fill vertices must hug the sampled terrain',
    );
  }

  const grid = circleGridSegments(workAreaCenter, workAreaRadius, 10);
  assert.ok(grid.length >= 14, 'the forestry circle should contain a readable two-axis grid');
  for (const segment of grid) {
    for (const point of segment) {
      assert.ok(
        Math.abs(Math.hypot(point.x - workAreaCenter.x, point.z - workAreaCenter.z) - workAreaRadius) < 1e-6,
        'every planning-grid chord must terminate exactly on the circle',
      );
    }
  }
  assert.equal(clampForestryWorkAreaRadius(-100), FORESTRY_WORK_AREA_MIN_RADIUS);
  assert.equal(clampForestryWorkAreaRadius(9_999), FORESTRY_WORK_AREA_MAX_RADIUS);
  assert.equal(
    resizeForestryWorkAreaRadius(70, -120),
    80,
    'Ctrl + wheel up should enlarge the forestry circle by one step',
  );
  assert.equal(
    resizeForestryWorkAreaRadius(70, 120),
    60,
    'Ctrl + wheel down should shrink the forestry circle by one step',
  );

  fillGeometry.dispose();
  borderGeometry.dispose();
  circleGeometry.dispose();
}

function localPlacementPoint(
  point: { x: number; z: number },
  x: number,
  z: number,
  yaw: number,
): { x: number; z: number } {
  const dx = point.x - x;
  const dz = point.z - z;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function completedAuthoredRoadEnvelope(
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
): BuildingLocalVisualBounds {
  const visualBounds = BUILDING_LOCAL_VISUAL_BOUNDS[kind];
  let minX = visualBounds.minX;
  let maxX = visualBounds.maxX;
  let minZ = visualBounds.minZ;
  let maxZ = visualBounds.maxZ;
  for (const corner of getBuildingFootprintCorners(kind, x, z, yaw)) {
    const local = localPlacementPoint(corner, x, z, yaw);
    minX = Math.min(minX, local.x - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    maxX = Math.max(maxX, local.x + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    minZ = Math.min(minZ, local.z - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    maxZ = Math.max(maxZ, local.z + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
  }
  return { minX, maxX, minZ, maxZ };
}

function previewSideDistance(
  index: number,
  point: { x: number; z: number },
  bounds: BuildingLocalVisualBounds,
): number {
  if (index === 0) return point.z - bounds.maxZ;
  if (index === 1) return point.x - bounds.maxX;
  if (index === 2) return bounds.minZ - point.z;
  return bounds.minX - point.x;
}

function assertPreviewRoadAttachmentsOutsideModelAndFootprint(
  preview: THREE.Group,
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
  heightAt: (pointX: number, pointZ: number) => number,
): void {
  const footprintLocal = getBuildingFootprintCorners(kind, x, z, yaw)
    .map((corner) => localPlacementPoint(corner, x, z, yaw));
  const footprintBounds = {
    minX: Math.min(...footprintLocal.map((point) => point.x)),
    maxX: Math.max(...footprintLocal.map((point) => point.x)),
    minZ: Math.min(...footprintLocal.map((point) => point.z)),
    maxZ: Math.max(...footprintLocal.map((point) => point.z)),
  };
  const authoredEnvelope = completedAuthoredRoadEnvelope(kind, x, z, yaw);
  const connections = getBuildingRoadConnectionPoints(
    { id: `preview-${kind}`, kind, x, z, yaw },
    {
      getPointAt: (pointX: number, pointZ: number, offset = 0) =>
        new THREE.Vector3(pointX, heightAt(pointX, pointZ) + offset, pointZ),
    },
  );
  const ghostFill = preview.getObjectByName('Building placement ghost fill');
  assert(ghostFill instanceof THREE.Mesh);
  const ghostPositions = ghostFill.geometry.getAttribute('position') as THREE.BufferAttribute;
  let modelMinX = Number.POSITIVE_INFINITY;
  let modelMaxX = Number.NEGATIVE_INFINITY;
  let modelMinZ = Number.POSITIVE_INFINITY;
  let modelMaxZ = Number.NEGATIVE_INFINITY;
  for (let vertexIndex = 0; vertexIndex < ghostPositions.count; vertexIndex += 1) {
    modelMinX = Math.min(modelMinX, ghostPositions.getX(vertexIndex));
    modelMaxX = Math.max(modelMaxX, ghostPositions.getX(vertexIndex));
    modelMinZ = Math.min(modelMinZ, ghostPositions.getZ(vertexIndex));
    modelMaxZ = Math.max(modelMaxZ, ghostPositions.getZ(vertexIndex));
  }
  const authoredVisualBounds = BUILDING_LOCAL_VISUAL_BOUNDS[kind];
  const modelBoundsTolerance = 1e-4;
  assert(modelMinX >= authoredVisualBounds.minX - modelBoundsTolerance, `${kind} model minX audit`);
  assert(modelMaxX <= authoredVisualBounds.maxX + modelBoundsTolerance, `${kind} model maxX audit`);
  assert(modelMinZ >= authoredVisualBounds.minZ - modelBoundsTolerance, `${kind} model minZ audit`);
  assert(modelMaxZ <= authoredVisualBounds.maxZ + modelBoundsTolerance, `${kind} model maxZ audit`);

  const midpointX = (authoredEnvelope.minX + authoredEnvelope.maxX) * 0.5;
  const midpointZ = (authoredEnvelope.minZ + authoredEnvelope.maxZ) * 0.5;
  const expectedOffsets = [
    { x: midpointX, z: authoredEnvelope.maxZ + BUILDING_ROAD_CONNECTION_CENTER_OFFSET },
    { x: authoredEnvelope.maxX + BUILDING_ROAD_CONNECTION_CENTER_OFFSET, z: midpointZ },
    { x: midpointX, z: authoredEnvelope.minZ - BUILDING_ROAD_CONNECTION_CENTER_OFFSET },
    { x: authoredEnvelope.minX - BUILDING_ROAD_CONNECTION_CENTER_OFFSET, z: midpointZ },
  ] as const;

  for (const [index, expected] of connections.entries()) {
    const circle = preview.getObjectByName(`Building road attachment circle ${index + 1}`);
    assert(circle instanceof THREE.Mesh);
    const connectionPoint = circle.userData.connectionPoint as [number, number, number];
    assert(
      new THREE.Vector3(...connectionPoint).distanceTo(expected.point) < 1e-9,
      `${kind} preview attachment ${index + 1} should reuse the placed-building anchor`,
    );
    const localConnection = localPlacementPoint(
      { x: connectionPoint[0], z: connectionPoint[2] },
      x,
      z,
      yaw,
    );
    assert(Math.abs(localConnection.x - expectedOffsets[index].x) < 1e-9);
    assert(Math.abs(localConnection.z - expectedOffsets[index].z) < 1e-9);

    const positions = circle.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minimumFootprintDistance = Number.POSITIVE_INFINITY;
    let minimumModelDistance = Number.POSITIVE_INFINITY;
    let minimumEnvelopeDistance = Number.POSITIVE_INFINITY;
    let maximumCircleRadius = 0;
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
      const worldPoint = {
        x: positions.getX(vertexIndex),
        z: positions.getZ(vertexIndex),
      };
      const local = localPlacementPoint(worldPoint, x, z, yaw);
      minimumFootprintDistance = Math.min(
        minimumFootprintDistance,
        previewSideDistance(index, local, footprintBounds),
      );
      minimumModelDistance = Math.min(
        minimumModelDistance,
        previewSideDistance(index, local, {
          minX: modelMinX,
          maxX: modelMaxX,
          minZ: modelMinZ,
          maxZ: modelMaxZ,
        }),
      );
      minimumEnvelopeDistance = Math.min(
        minimumEnvelopeDistance,
        previewSideDistance(index, local, authoredEnvelope),
      );
      maximumCircleRadius = Math.max(
        maximumCircleRadius,
        Math.hypot(worldPoint.x - connectionPoint[0], worldPoint.z - connectionPoint[2]),
      );
    }
    assert(
      minimumFootprintDistance > 0,
      `${kind} preview attachment ${index + 1} should remain completely outside its exact footprint`,
    );
    assert(
      minimumModelDistance > 0,
      `${kind} preview attachment ${index + 1} should remain completely outside its model`,
    );
    assert(
      Math.abs(minimumEnvelopeDistance - BUILDING_ROAD_CONNECTION_EDGE_CLEARANCE) < 0.03,
      `${kind} preview attachment ${index + 1} should preserve the fixed ring-edge clearance`,
    );
    assert(
      Math.abs(maximumCircleRadius - BUILDING_ROAD_CONNECTION_MARKER_OUTER_RADIUS) < 0.025,
      `${kind} preview attachment ${index + 1} should share the placed marker outer radius`,
    );
  }
}

function testPlacementPreviewLimitsRadiusOverlaysToWildlifeWarnings(): void {
  const heightAt = (x: number, z: number) =>
    Math.sin(x * 0.018) * 3.4 + Math.cos(z * 0.021) * 2.6;
  for (const kind of BUILDING_KINDS) {
    const preview = createBuildingPreviewMesh(kind);
    assert.equal(
      preview.getObjectByName('Building placement extent'),
      undefined,
      `${kind} must not expose a placement radius`,
    );
    assert.equal(
      preview.getObjectByName('Building fire spread range'),
      undefined,
      `${kind} must not expose a fire-planning radius`,
    );
    const loggingWorkExtent = preview.getObjectByName('Lumber logging work extent warning');
    if (kind === 'lumber_mill') {
      assert(loggingWorkExtent instanceof THREE.Mesh);
      assert.equal(loggingWorkExtent.userData.extentRadius, BUILDING_DEFINITIONS.lumber_mill.workRadius);
    } else {
      assert.equal(
        loggingWorkExtent,
        undefined,
        `${kind} must not expose the Lumber Mill's logging extent`,
      );
    }
    for (const yaw of [0, 0.42, -1.09]) {
      updateBuildingPreviewGeometry(preview, kind, 35, -48, yaw, heightAt);
      assertPreviewRoadAttachmentsOutsideModelAndFootprint(
        preview,
        kind,
        35,
        -48,
        yaw,
        heightAt,
      );
    }
    if (kind === 'monastery') {
      const hatch = preview.getObjectByName('Building footprint diagonal hatch');
      assert(hatch instanceof THREE.Mesh);
      const positions = hatch.geometry.getAttribute('position') as THREE.BufferAttribute;
      let maximumRadius = 0;
      for (let index = 0; index < positions.count; index += 1) {
        maximumRadius = Math.max(
          maximumRadius,
          Math.hypot(positions.getX(index) - 35, positions.getZ(index) + 48),
        );
      }
      assert(
        maximumRadius > 40,
        'the monastery hatch should fill its complete asymmetric estate footprint',
      );
    }
    updateBuildingPreviewAppearance(preview, false);
    disposeBuildingPreviewMesh(preview);
  }
}

function gameNode(nodeId: string, x: number, z: number): ForagingNodeState {
  return {
    nodeId,
    kind: 'game',
    resource: 'game',
    remaining: 12,
    maxYield: 12,
    x,
    z,
  };
}

function testPlacementPreviewShowsAdvisoryWildlifeWarnings(): void {
  const hunterRelevant = gameNode(
    'hunter-relevant',
    BUILDING_DEFINITIONS.hunters_hall.workRadius + GAME_HABITAT_DISRUPTION_RADIUS - 1,
    0,
  );
  const hunterOutside = gameNode(
    'hunter-outside',
    BUILDING_DEFINITIONS.hunters_hall.workRadius + GAME_HABITAT_DISRUPTION_RADIUS + 1,
    0,
  );
  const hunterWildlife = resolveBuildingPlacementWildlifePreview(
    'hunters_hall',
    0,
    0,
    0,
    [hunterRelevant, hunterOutside],
  );
  assert.deepEqual(
    hunterWildlife.habitats.map((habitat) => habitat.nodeId),
    ['hunter-relevant'],
    'Hunter placement should show habitats whose grazing circle reaches its work extent',
  );
  assert.equal(hunterWildlife.habitats[0]?.radius, GAME_HABITAT_DISRUPTION_RADIUS);
  assert.equal(hunterWildlife.habitats[0]?.huntingReach, true);
  assert.equal(hunterWildlife.habitats[0]?.directBuildingRisk, false);

  const lumberRelevant = gameNode(
    'lumber-relevant',
    BUILDING_DEFINITIONS.lumber_mill.workRadius + GAME_HABITAT_DISRUPTION_RADIUS - 1,
    0,
  );
  const lumberOutside = gameNode(
    'lumber-outside',
    BUILDING_DEFINITIONS.lumber_mill.workRadius + GAME_HABITAT_DISRUPTION_RADIUS + 1,
    0,
  );
  const lumberWildlife = resolveBuildingPlacementWildlifePreview(
    'lumber_mill',
    0,
    0,
    0,
    [lumberRelevant, lumberOutside],
  );
  assert.equal(lumberWildlife.loggingWorkRadius, BUILDING_DEFINITIONS.lumber_mill.workRadius);
  assert.deepEqual(
    lumberWildlife.habitats.map((habitat) => habitat.nodeId),
    ['lumber-relevant'],
    'Lumber placement should show habitats intersected by its logging work extent',
  );
  assert.equal(lumberWildlife.habitats[0]?.loggingReach, true);
  assert.equal(lumberWildlife.habitats[0]?.directBuildingRisk, false);

  const smithyFootprint = getBuildingFootprintHalfExtents('smithy');
  const smithyRiskDistance = GAME_HABITAT_DISRUPTION_RADIUS
    + smithyFootprint.halfWidth;
  const yawSensitiveDistance = GAME_HABITAT_DISRUPTION_RADIUS
    + (smithyFootprint.halfWidth + smithyFootprint.halfDepth) * 0.5;
  const smithyWildlife = resolveBuildingPlacementWildlifePreview(
    'smithy',
    0,
    0,
    0,
    [
      gameNode('smithy-direct-risk', smithyRiskDistance - 0.1, 0),
      gameNode('smithy-clear', smithyRiskDistance + 0.1, 0),
      gameNode('smithy-yaw-sensitive', 0, yawSensitiveDistance),
    ],
  );
  assert.deepEqual(
    smithyWildlife.habitats.map((habitat) => habitat.nodeId),
    ['smithy-direct-risk'],
    'ordinary buildings should use the exact visible footprint instead of their broad pick radius',
  );
  assert.equal(smithyWildlife.habitats[0]?.directBuildingRisk, true);

  const rotatedSmithyWildlife = resolveBuildingPlacementWildlifePreview(
    'smithy',
    0,
    0,
    Math.PI * 0.5,
    [gameNode('smithy-yaw-sensitive', 0, yawSensitiveDistance)],
  );
  assert.deepEqual(
    rotatedSmithyWildlife.habitats.map((habitat) => habitat.nodeId),
    ['smithy-yaw-sensitive'],
    'the direct habitat warning should rotate with the road-facing building footprint',
  );

  const heightAt = (x: number, z: number) =>
    Math.sin(x * 0.017) * 2.1 + Math.cos(z * 0.023) * 1.6;
  const hunterPreview = createBuildingPreviewMesh('hunters_hall');
  updateBuildingPreviewGeometry(
    hunterPreview,
    'hunters_hall',
    0,
    0,
    0,
    heightAt,
    hunterWildlife,
  );
  const hunterWarnings = hunterPreview.getObjectByName('Game habitat disturbance warnings');
  assert(hunterWarnings instanceof THREE.Group);
  assert.equal(hunterWarnings.children.length, 1);
  const habitatRing = hunterWarnings.children[0];
  assert(habitatRing instanceof THREE.Mesh);
  assert.equal(habitatRing.userData.habitatRadius, GAME_HABITAT_DISRUPTION_RADIUS);
  const habitatPositions = habitatRing.geometry.getAttribute('position') as THREE.BufferAttribute;
  assert(habitatPositions.count > 120, 'the game habitat warning should be a readable terrain ribbon');
  for (let index = 0; index < habitatPositions.count; index += 1) {
    assert.ok(
      Math.abs(
        habitatPositions.getY(index)
        - (heightAt(habitatPositions.getX(index), habitatPositions.getZ(index)) + 0.19)
      ) < 1e-5,
      'game habitat warning vertices must follow the sampled terrain',
    );
  }
  const habitatMaterial = habitatRing.material as THREE.MeshBasicMaterial;
  const advisoryOpacity = habitatMaterial.opacity;
  assert.equal(habitatMaterial.color.getHex(), 0xff5d50);
  updateBuildingPreviewAppearance(hunterPreview, false);
  assert.equal(
    habitatMaterial.color.getHex(),
    0xff5d50,
    'an advisory habitat warning must stay red independently of placement validity',
  );
  assert.equal(habitatMaterial.opacity, advisoryOpacity);

  assert.deepEqual(
    validateBuildingPlacement('hunters_hall', 0, 0, {
      buildings: [],
      residences: [],
      burgageZones: [],
      farmFields: [],
      pastures: [],
      quarries: [],
      foragingNodes: [gameNode('overlapped-game', 0, 0)],
      stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000, roofTiles: 10_000 },
      isWaterAt: () => false,
      getNaturalHeightAt: () => 0,
    }),
    { ok: true },
    'the red habitat warning must not block a Hunter Hall placed inside it',
  );
  disposeBuildingPreviewMesh(hunterPreview);

  const lumberPreview = createBuildingPreviewMesh('lumber_mill');
  updateBuildingPreviewGeometry(
    lumberPreview,
    'lumber_mill',
    0,
    0,
    0,
    heightAt,
    lumberWildlife,
  );
  const loggingRing = lumberPreview.getObjectByName('Lumber logging work extent warning');
  assert(loggingRing instanceof THREE.Mesh);
  assert.equal(loggingRing.userData.dashed, true);
  assert.equal(loggingRing.userData.extentRadius, BUILDING_DEFINITIONS.lumber_mill.workRadius);
  assert.equal(
    (loggingRing.material as THREE.MeshBasicMaterial).color.getHex(),
    0xd7b463,
    'the logging reach should remain visually distinct from red habitat warnings',
  );
  const loggingPositions = loggingRing.geometry.getAttribute('position') as THREE.BufferAttribute;
  assert(loggingPositions.count > 120, 'the logging work extent should be a terrain-following dashed ribbon');
  for (let index = 0; index < loggingPositions.count; index += 1) {
    assert.ok(
      Math.abs(
        loggingPositions.getY(index)
        - (heightAt(loggingPositions.getX(index), loggingPositions.getZ(index)) + 0.18)
      ) < 1e-5,
      'logging extent vertices must follow the sampled terrain',
    );
  }
  disposeBuildingPreviewMesh(lumberPreview);
}

function testPlacementPreviewShowsHatchGhostAndRotatingRoadAttachments(): void {
  const kind = 'smithy' as const;
  const x = 18;
  const z = -27;
  const yaw = 0.63;
  const heightAt = (pointX: number, pointZ: number) =>
    Math.sin(pointX * 0.04) * 1.7 + Math.cos(pointZ * 0.035) * 1.2;
  const preview = createBuildingPreviewMesh(kind);
  updateBuildingPreviewGeometry(preview, kind, x, z, yaw, heightAt);

  const fill = preview.getObjectByName('Building footprint fill');
  const hatch = preview.getObjectByName('Building footprint diagonal hatch');
  assert(fill instanceof THREE.Mesh, 'the opaque footprint fill should remain visible');
  assert(hatch instanceof THREE.Mesh, 'building placement should add diagonal footprint hatching');
  assert(
    (hatch.geometry.getAttribute('position') as THREE.BufferAttribute).count > 12,
    'the diagonal hatch should contain terrain-sampled stripe geometry',
  );

  const attachmentGroup = preview.getObjectByName('Building road attachment circles');
  assert(attachmentGroup instanceof THREE.Group);
  assert.equal(
    attachmentGroup.children.length,
    4,
    'placement should expose all four footprint road attachments',
  );
  const authoredEnvelope = completedAuthoredRoadEnvelope(kind, x, z, yaw);
  const envelopeMidpointX = (authoredEnvelope.minX + authoredEnvelope.maxX) * 0.5;
  const envelopeMidpointZ = (authoredEnvelope.minZ + authoredEnvelope.maxZ) * 0.5;
  const localOffsets = [
    [envelopeMidpointX, authoredEnvelope.maxZ + BUILDING_ROAD_CONNECTION_CENTER_OFFSET],
    [authoredEnvelope.maxX + BUILDING_ROAD_CONNECTION_CENTER_OFFSET, envelopeMidpointZ],
    [envelopeMidpointX, authoredEnvelope.minZ - BUILDING_ROAD_CONNECTION_CENTER_OFFSET],
    [authoredEnvelope.minX - BUILDING_ROAD_CONNECTION_CENTER_OFFSET, envelopeMidpointZ],
  ] as const;
  for (const [index, [localX, localZ]] of localOffsets.entries()) {
    const circle = preview.getObjectByName(`Building road attachment circle ${index + 1}`);
    assert(circle instanceof THREE.Mesh);
    assert(
      (circle.geometry.getAttribute('position') as THREE.BufferAttribute).count >= 96,
      'each road attachment should render as a complete terrain-following circle',
    );
    const connectionPoint = circle.userData.connectionPoint as [number, number, number];
    const expectedX = x + localX * Math.cos(yaw) + localZ * Math.sin(yaw);
    const expectedZ = z - localX * Math.sin(yaw) + localZ * Math.cos(yaw);
    assert(Math.abs(connectionPoint[0] - expectedX) < 1e-9);
    assert(Math.abs(connectionPoint[1] - heightAt(expectedX, expectedZ)) < 1e-9);
    assert(Math.abs(connectionPoint[2] - expectedZ) < 1e-9);

    const positions = circle.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minimumEnvelopeDistance = Number.POSITIVE_INFINITY;
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
      const local = localPlacementPoint({
        x: positions.getX(vertexIndex),
        z: positions.getZ(vertexIndex),
      }, x, z, yaw);
      minimumEnvelopeDistance = Math.min(
        minimumEnvelopeDistance,
        previewSideDistance(index, local, authoredEnvelope),
      );
    }
    assert(
      minimumEnvelopeDistance > 0,
      `road attachment ${index + 1} should remain completely outside the authored envelope`,
    );
  }

  const ghost = preview.getObjectByName('Building placement ghost');
  assert(ghost instanceof THREE.Group, 'placement should include the selected building model');
  assert.deepEqual(ghost.position.toArray(), [x, heightAt(x, z), z]);
  assert.equal(ghost.rotation.y, yaw);
  let translucentMeshCount = 0;
  let outlineCount = 0;
  ghost.traverse((object) => {
    if (object.userData.previewRole === 'model-outline') outlineCount += 1;
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    assert(object.material instanceof THREE.MeshBasicMaterial);
    assert.equal(object.material.color.getHex(), 0xfffdf5);
    assert(object.material.transparent);
    assert(object.material.opacity <= 0.14);
    translucentMeshCount += 1;
  });
  assert.equal(
    translucentMeshCount,
    1,
    'the colorless building surfaces should be flattened into one preview draw',
  );
  assert.equal(
    outlineCount,
    1,
    'the white building edges should be flattened into one preview draw',
  );

  const originalFirstConnection = (
    preview.getObjectByName('Building road attachment circle 1') as THREE.Mesh
  ).userData.connectionPoint as [number, number, number];
  updateBuildingPreviewGeometry(preview, kind, x, z, yaw + Math.PI * 0.5, heightAt);
  const rotatedFirstConnection = (
    preview.getObjectByName('Building road attachment circle 1') as THREE.Mesh
  ).userData.connectionPoint as [number, number, number];
  assert(
    Math.hypot(
      rotatedFirstConnection[0] - originalFirstConnection[0],
      rotatedFirstConnection[2] - originalFirstConnection[2],
    ) > 1,
    'road attachment circles should move with building rotation',
  );
  assert.equal(ghost.rotation.y, yaw + Math.PI * 0.5);

  updateBuildingPreviewAppearance(preview, false);
  assert.equal(
    (hatch.material as THREE.MeshBasicMaterial).color.getHex(),
    0xfffdf5,
    'diagonal hatching should stay white while the center and border report invalid placement',
  );
  for (const circle of attachmentGroup.children as THREE.Mesh[]) {
    assert.equal((circle.material as THREE.MeshBasicMaterial).color.getHex(), 0xfffdf5);
  }
  disposeBuildingPreviewMesh(preview);
}

function testCivicAndFrontierPlacementPrerequisites(): void {
  const building = (
    kind: BuildingKind,
    id: string,
    x: number,
    z: number,
    constructionComplete = true,
    assignedLabor = 0,
  ) => ({
    id,
    kind,
    x,
    z,
    constructionComplete,
    assignedLabor,
  }) as BuildingState;
  const residence = (population: number) => ({ population }) as ResidenceState;
  const context = (
    buildings: BuildingState[],
    population: number,
    roadNetwork?: RoadNetwork,
  ) => ({
    buildings,
    residences: [residence(population)],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: [],
    stockpile: { timber: 10_000, stone: 10_000 },
    isWaterAt: () => false,
    isResourceDepositAt: () => false,
    getNaturalHeightAt: () => 0,
    roadNetwork,
    fireDisabledBuildingIds: new Set<string>(),
  });

  assert.deepEqual(
    validateBuildingPlacement(
      'guardhouse',
      0,
      0,
      context([], 24),
    ),
    { ok: false, reason: 'requires_completed_watchtower' },
  );
  assert.equal(
    validateBuildingPlacement(
      'guardhouse',
      0,
      0,
      context([building('watchtower', 'watch', 80, 0)], 24),
    ).ok,
    true,
  );

  const candidate = { x: 40, z: 12 };
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([building('town_hall', 'existing-hall', 120, 0, false)], 0),
    ),
    { ok: false, reason: 'town_hall_exists' },
  );
  const monasteryUnderConstruction = building(
    'monastery',
    'existing-monastery',
    120,
    0,
    false,
  );
  assert.deepEqual(
    validateBuildingPlacement(
      'monastery',
      candidate.x,
      candidate.z,
      context([monasteryUnderConstruction], 24),
    ),
    { ok: false, reason: 'monastery_exists' },
    'an existing monastery or construction site must block every second monastery',
  );
  assert.notDeepEqual(
    validateBuildingPlacement(
      'monastery',
      candidate.x,
      candidate.z,
      context([], 24),
    ),
    { ok: false, reason: 'monastery_exists' },
    'removing the demolished monastery row must release the unique-estate gate',
  );
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([], 23),
    ),
    { ok: false, reason: 'requires_town_hall_population' },
  );
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([], 24),
    ),
    { ok: false, reason: 'requires_completed_chapel' },
  );

  const chapel = building('chapel', 'chapel', 0, 12);
  const marketplace = building('marketplace', 'market', 80, 12);
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([chapel], 24),
    ),
    { ok: false, reason: 'requires_completed_marketplace' },
  );
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([chapel, marketplace], 24),
    ),
    { ok: false, reason: 'requires_civic_road_link' },
  );

  const civicRoad = new RoadNetwork();
  civicRoad.addRoadPath([
    new THREE.Vector3(-15, 0, 0),
    new THREE.Vector3(95, 0, 0),
  ]);
  assert.equal(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context([chapel, marketplace], 24, civicRoad),
    ).ok,
    true,
    'a unique Town Hall with population, civic landmarks, and one shared road branch should preview as valid',
  );

  const multiParishRoads = new RoadNetwork();
  multiParishRoads.addRoadPath([
    new THREE.Vector3(-15, 0, 0),
    new THREE.Vector3(95, 0, 0),
  ]);
  multiParishRoads.addRoadPath([
    new THREE.Vector3(-15, 0, 68),
    new THREE.Vector3(95, 0, 68),
  ]);
  const olderRemoteLandmarks = [
    building('chapel', 'old-chapel', 0, 80),
    building('marketplace', 'old-market', 80, 80),
  ];
  const connectedLandmarks = [
    building('chapel', 'local-chapel', 0, 12),
    building('marketplace', 'local-market', 80, 12),
  ];
  assert.deepEqual(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context(
        [...olderRemoteLandmarks, connectedLandmarks[0]],
        24,
        multiParishRoads,
      ),
    ),
    { ok: false, reason: 'requires_civic_road_link' },
    'a local chapel must not conceal that every completed marketplace is on another branch',
  );
  assert.equal(
    validateBuildingPlacement(
      'town_hall',
      candidate.x,
      candidate.z,
      context(
        [...olderRemoteLandmarks, ...connectedLandmarks],
        24,
        multiParishRoads,
      ),
    ).ok,
    true,
    'older civic landmarks on another road branch must not hide a connected chapel and marketplace',
  );

  const manyLandmarks = Array.from({ length: 500 }, (_, index) => (
    building(
      index % 2 === 0 ? 'chapel' : 'marketplace',
      `civic-${index}`,
      index % 2 === 0 ? 0 : 80,
      index < 498 ? 80 : 12,
    )
  ));
  const batchedStartedAt = performance.now();
  for (let index = 0; index < 100; index += 1) {
    assert.equal(
      validateBuildingPlacement(
        'town_hall',
        candidate.x,
        candidate.z,
        context(manyLandmarks, 24, multiParishRoads),
      ).ok,
      true,
    );
  }
  const batchedElapsedMs = performance.now() - batchedStartedAt;
  assert.ok(
    batchedElapsedMs < 1_000,
    `100 multi-parish civic checks should remain interactive (took ${batchedElapsedMs.toFixed(1)} ms)`,
  );
}

function testDenseBuildingFootprintSpacingAndEdgeSnap(): void {
  const roadNetwork = new RoadNetwork();
  roadNetwork.addRoadPath([
    new THREE.Vector3(-80, 0, 0),
    new THREE.Vector3(80, 0, 0),
  ]);
  const existing = {
    id: 'bakery-1',
    kind: 'bakery',
    x: 0,
    z: 16,
    constructionComplete: true,
    assignedLabor: 0,
  } as BuildingState;
  const bakery = getBuildingFootprintHalfExtents('bakery');
  const smokehouse = getBuildingFootprintHalfExtents('smokehouse');
  const edgeAlignedX = bakery.halfWidth
    + smokehouse.halfWidth
    + BUILDING_EDGE_CLEARANCE;
  const cursorX = edgeAlignedX + 1.4;

  const snapped = resolveBuildingEdgeSnap(
    'smokehouse',
    cursorX,
    existing.z,
    [existing],
    roadNetwork,
  );
  assert.ok(Math.abs(snapped.x - edgeAlignedX) < 1e-6);
  assert.ok(Math.abs(snapped.z - existing.z) < 1e-6);
  assert.ok(Math.abs(
    buildingFootprintEdgeDistance(
      'smokehouse',
      snapped.x,
      snapped.z,
      existing,
      roadNetwork,
    ) - BUILDING_EDGE_CLEARANCE,
  ) < 1e-6);

  const placementContext = {
    buildings: [existing],
    residences: [],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    vineyardParcels: [],
    quarries: [],
    foragingNodes: [],
    stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000 },
    isWaterAt: () => false,
    isResourceDepositAt: () => false,
    getNaturalHeightAt: () => 0,
    roadNetwork,
  };
  assert.equal(
    validateBuildingPlacement('smokehouse', snapped.x, snapped.z, placementContext).ok,
    true,
    'buildings separated by the small visible edge gap should be valid',
  );
  assert.deepEqual(
    validateBuildingPlacement(
      'smokehouse',
      edgeAlignedX - 0.2,
      existing.z,
      placementContext,
    ),
    { ok: false, reason: 'too_close' },
    'visible footprints inside the minimum edge gap should remain blocked',
  );

  const outsideMagnet = edgeAlignedX + BUILDING_EDGE_SNAP_DISTANCE + 0.1;
  assert.deepEqual(
    resolveBuildingEdgeSnap(
      'smokehouse',
      outsideMagnet,
      existing.z,
      [existing],
      roadNetwork,
    ),
    { x: outsideMagnet, z: existing.z },
    'the edge magnet should not drag buildings from across an open town square',
  );

  const stableRoadside = resolveRoadsideBuildingPlacement('stable', 0, 6, roadNetwork);
  assert.equal(
    buildingFootprintOverlapsRoadSurface(
      'stable',
      stableRoadside.x,
      stableRoadside.z,
      roadNetwork,
    ),
    false,
    'the road snap should initially put the Stable on a clear verge',
  );
  const stableExtent = getBuildingFootprintHalfExtents('stable');
  const wellExtent = getBuildingFootprintHalfExtents('well');
  const edgeSnapMovementTowardRoad = 2.5;
  const inlandWell = {
    id: 'well-inland-from-stable',
    kind: 'well',
    x: stableRoadside.x,
    z: stableRoadside.z
      - edgeSnapMovementTowardRoad
      + stableExtent.halfDepth
      + BUILDING_EDGE_CLEARANCE
      + wellExtent.halfDepth,
    constructionComplete: true,
    assignedLabor: 0,
  } as BuildingState;
  const unguardedStableSnap = resolveBuildingEdgeSnap(
    'stable',
    stableRoadside.x,
    stableRoadside.z,
    [inlandWell],
    roadNetwork,
  );
  assert.equal(
    buildingFootprintOverlapsRoadSurface(
      'stable',
      unguardedStableSnap.x,
      unguardedStableSnap.z,
      roadNetwork,
    ),
    true,
    'a nearby inland building can otherwise magnetize a road-clear Stable back onto the road',
  );
  assert.deepEqual(
    resolveBuildingEdgeSnap(
      'stable',
      stableRoadside.x,
      stableRoadside.z,
      [inlandWell],
      roadNetwork,
      (candidateX, candidateZ) => buildingFootprintOverlapsRoadSurface(
        'stable',
        candidateX,
        candidateZ,
        roadNetwork,
      ),
    ),
    stableRoadside,
    'the building-edge magnet must preserve the Stable road-clear placement',
  );
}

function testMineworksCanOccupyItsRichDeposit(): void {
  const ironDeposit: ResourceNodeState = {
    nodeId: 'deposit-iron-ordinary-0',
    kind: 'quarry',
    resource: 'iron',
    remaining: 300,
    maxYield: 300,
    x: 42,
    z: -18,
    isRich: false,
  };
  const richIronDeposit: ResourceNodeState = {
    ...ironDeposit,
    nodeId: 'deposit-iron-rich-0',
    x: 120,
    z: 35,
    isRich: true,
  };
  const richClayDeposit: ResourceNodeState = {
    ...ironDeposit,
    nodeId: 'clay-rich-0',
    resource: 'clay',
    x: -75,
    z: 90,
    isRich: true,
  };
  assert.deepEqual(
    resolveBuildingPlacementPoint(
      'mine',
      richIronDeposit.x + 18,
      richIronDeposit.z - 9,
      [ironDeposit, richIronDeposit, richClayDeposit],
    ),
    { x: richIronDeposit.x, z: richIronDeposit.z },
    'Mineworks should snap to a rich iron resource center',
  );
  assert.deepEqual(
    resolveBuildingPlacementPoint(
      'mine',
      ironDeposit.x + 18,
      ironDeposit.z - 9,
      [ironDeposit, richIronDeposit, richClayDeposit],
    ),
    { x: ironDeposit.x + 18, z: ironDeposit.z - 9 },
    'an ordinary surface deposit must not become a Mineworks snap target',
  );
  assert.deepEqual(
    resolveBuildingPlacementPoint(
      'mine',
      richClayDeposit.x - 12,
      richClayDeposit.z + 10,
      [ironDeposit, richIronDeposit, richClayDeposit],
    ),
    { x: richClayDeposit.x, z: richClayDeposit.z },
    'Mineworks should use the same centered placement contract for rich clay',
  );
  const baseContext = {
    buildings: [],
    residences: [],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [ironDeposit, richIronDeposit, richClayDeposit],
    foragingNodes: [],
    stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000 },
    isWaterAt: () => false,
    isResourceDepositAt: () => true,
    getNaturalHeightAt: () => 0,
    fireDisabledBuildingIds: new Set<string>(),
  };

  assert.equal(
    validateBuildingPlacement('mine', richIronDeposit.x, richIronDeposit.z, baseContext).ok,
    true,
    'Mineworks must be allowed to occupy its required rich deposit',
  );
  assert.deepEqual(
    validateBuildingPlacement('mine', ironDeposit.x, ironDeposit.z, baseContext),
    { ok: false, reason: 'requires_mineral_deposit' },
    'ordinary iron belongs to a nearby Mining Camp rather than Mineworks',
  );
  assert.deepEqual(
    validateBuildingPlacement('mine', richIronDeposit.x + 8, richIronDeposit.z, baseContext),
    { ok: false, reason: 'requires_mineral_deposit' },
    'Mineworks offset from the rich deposit center must remain invalid',
  );
  assert.equal(
    validateBuildingPlacement('mine', richClayDeposit.x, richClayDeposit.z, baseContext).ok,
    true,
    'Mineworks must accept centered rich clay as well as rich iron and salt',
  );
}

function testTerrainPointerPickingUsesBoundedHeightfieldWork(): void {
  let heightSamples = 0;
  const terrain = {
    size: 240,
    resolution: 769,
    getHeightAt: (x: number, z: number) => {
      heightSamples += 1;
      return 0.08 * x - 0.04 * z + 3;
    },
  };
  const ray = new THREE.Ray(
    new THREE.Vector3(38, 120, 76),
    new THREE.Vector3(-0.22, -0.82, -0.53).normalize(),
  );
  const denominator = ray.direction.y
    - 0.08 * ray.direction.x
    + 0.04 * ray.direction.z;
  const expectedT = (
    0.08 * ray.origin.x
    - 0.04 * ray.origin.z
    + 3
    - ray.origin.y
  ) / denominator;
  const expected = ray.at(expectedT, new THREE.Vector3());
  const target = new THREE.Vector3();
  const hit = intersectTerrainHeightfieldRay(ray, terrain, 500, target);
  assert.equal(hit, target, 'heightfield picking should reuse its caller-owned hit vector');
  assert.ok(hit);
  assert.ok(hit.distanceTo(expected) < 0.002, 'heightfield picking must retain sub-centimeter placement precision');
  assert.ok(
    heightSamples < terrain.resolution * 2,
    'one pointer pick must stay bounded by heightfield resolution instead of render-triangle count',
  );

  const missesTerrain = intersectTerrainHeightfieldRay(
    new THREE.Ray(new THREE.Vector3(0, 80, 0), new THREE.Vector3(0, 1, 0)),
    terrain,
    500,
  );
  assert.equal(missesTerrain, null, 'an upward ray should not invent a terrain hit');
}

testClearanceSpatialIndexKeepsNearbyCandidates();
testMovableBuildingsSnapToRoadSides();
testQuarryFootprintsAvoidRivers();
testBurgageWaterValidationSamplesTheWholeZone();
testBurgageTerrainRulesAreLotFriendly();
testBurgageBuildingOverlapUsesVisibleFootprints();
testOrganicBurgagePlotsAndPreviewIcons();
testBurgageFrontageDirectionAndRoadSideSelection();
testPlacementOverlaysFollowTerrainHeight();
testPlacementPreviewLimitsRadiusOverlaysToWildlifeWarnings();
testPlacementPreviewShowsAdvisoryWildlifeWarnings();
testPlacementPreviewShowsHatchGhostAndRotatingRoadAttachments();
testCivicAndFrontierPlacementPrerequisites();
testDenseBuildingFootprintSpacingAndEdgeSnap();
testMineworksCanOccupyItsRichDeposit();
testTerrainPointerPickingUsesBoundedHeightfieldWork();

assert.equal(
  describeBuildingPlacementBlocker('requires_shore'),
  'Blocked: This building must be placed beside open water',
);
assert.equal(
  describeToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'fishing_camp',
    statusDetail: describeBuildingPlacementBlocker('requires_shore'),
    placementBlocked: true,
    buildingCost: { timber: 20, stone: 8 },
  }),
  'Blocked: This building must be placed beside open water | Cost 20 timber, 8 stone',
);
assert.equal(
  describeBuildingPlacementBlocker('water'),
  'Blocked: Cannot build on water',
);
assert.equal(
  describeBuildingPlacementBlocker('requires_completed_watchtower'),
  'Blocked: Complete a frontier watchtower before establishing a paid guardhouse',
);
assert.equal(
  describeBuildingPlacementBlocker('requires_civic_road_link'),
  'Blocked: The Town Hall must be road-linked to both the church and marketplace',
);
assert.equal(
  describeToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'town_hall',
    statusDetail: 'Ready: population, civic buildings, and road links confirmed',
    placementReady: true,
    buildingCost: { timber: 180, stone: 120 },
  }),
  'Ready: population, civic buildings, and road links confirmed | Cost 180 timber, 120 stone',
);
assert.equal(
  describeToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'threshing_barn',
    statusDetail: 'Ready: field work extent 150 m',
    placementReady: true,
    buildingCost: { timber: 50, stone: 12 },
  }),
  'Ready: field work extent 150 m | Cost 50 timber, 12 stone',
);
assert.equal(
  describeToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'road',
  }),
  'Road · L-click start · Alt + L-click remove segment · Esc cancel',
  'road placement should use the same concise bottom status bar as other builder tools',
);
assert.equal(
  describeToolbarStatus({
    canBuild: true,
    hasDraft: true,
    mode: 'road',
  }),
  'Road ready · L-click add point · R-click undo · Enter build · Esc cancel',
  'the road status bar should surface only the most useful actions for the current state',
);

const buildingReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const placementValidation = readFileSync('server/src/placement_validation.rs', 'utf8');
const reclamationSimulation = readFileSync('server/src/simulation/reclamation.rs', 'utf8');
const residenceReducer = readFileSync('server/src/reducers/residences.rs', 'utf8');
const farmFieldReducer = readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
const livestockReducer = readFileSync('server/src/reducers/livestock.rs', 'utf8');
const graveyardReducer = readFileSync('server/src/reducers/graveyards.rs', 'utf8');
const buildingTool = readFileSync('src/buildings/BuildingTool.ts', 'utf8');
const app = readFileSync('src/app/App.ts', 'utf8');
const buildToolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const buildChrome = readFileSync('src/ui/buildChrome.css', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
const buildingPlacementPreview = readFileSync('src/buildings/BuildingPlacementPreview.ts', 'utf8');
const terrainProjector = readFileSync('src/terrain/TerrainProjector.ts', 'utf8');
const firstPersonController = readFileSync('src/camera/FirstPersonController.ts', 'utf8');
const cameraController = readFileSync('src/camera/CameraController.ts', 'utf8');
const roadTool = readFileSync('src/roads/RoadTool.ts', 'utf8');

assert.match(
  buildToolbar,
  /const buildActionGuidance = stats\.canBuild[\s\S]{0,260}describeToolbarStatus\(stats\)[\s\S]{0,180}setAttribute\('aria-label', buildActionGuidance\)/,
  'a disabled commit control must expose the same specific blocker or next placement step as the visible builder status',
);

assert.doesNotMatch(
  terrainProjector,
  /intersectObject\(this\.terrain\.mesh/,
  'pointer hover must not raycast the million-triangle render terrain',
);
assert.match(terrainProjector, /intersectTerrainHeightfieldRay/);
assert.match(terrainProjector, /setViewportRect/);
assert.match(
  firstPersonController,
  /pendingLookDeltaX \+= event\.movementX[\s\S]*pendingLookDeltaY \+= event\.movementY/,
  'first-person mouse input must accumulate raw events for the next render frame',
);
assert.match(
  firstPersonController,
  /FIRST_PERSON_CAMERA_NEAR_METERS = 0\.2[\s\S]*this\.savedNear = this\.config\.camera\.near[\s\S]*this\.config\.camera\.near = Math\.max\([\s\S]*FIRST_PERSON_CAMERA_NEAR_METERS[\s\S]*this\.config\.camera\.near = this\.savedNear/,
  'first-person mode must improve depth precision without leaking its near plane into the strategic camera',
);
assert.match(
  cameraController,
  /pendingRotateX \+= dx[\s\S]*pendingRotateY \+= dy/,
  'orbit mouse input must accumulate raw events for the next render frame',
);
assert.match(
  roadTool,
  /if \(this\.pointerDirty\)[\s\S]*this\.processPointerHover/,
  'road hover picking must run at most once per render frame',
);
assert.match(
  roadTool,
  /const rejectionReason = this\.getInvalidClickReason\(\);[\s\S]{0,220}onPlacementRejected\?\.\(\{ reason: rejectionReason, action: 'click' \}\);[\s\S]{0,80}return;/,
  'an invalid road point should be rejected without ending the placement session',
);
assert.doesNotMatch(
  roadTool,
  /if \(rejectionReason\) \{[\s\S]{0,160}setEnabled\(false\)/,
  'road placement failures must leave the road tool active for the player to cancel',
);

assert.match(
  buildingReducer,
  /civic_landmarks[\s\S]*road_path_distances_from\(x, z, &civic_points\)[\s\S]*linked_chapel[\s\S]*linked_marketplace/,
  'authoritative Town Hall placement should batch every completed civic landmark and accept any linked chapel and market',
);
const buildingResourceDepositGate = buildingReducer.slice(
  buildingReducer.indexOf('let on_rich_stone'),
  buildingReducer.indexOf('// A fresh world has no roads'),
);
assert.match(
  buildingResourceDepositGate,
  /let on_rich_stone = kind == "large_quarry" && has_rich_stone_at_center\(ctx, x, z\);[\s\S]*let on_mineworks_deposit = kind == "mine" && has_mineworks_deposit_at_center\(ctx, x, z\);[\s\S]*if !on_rich_stone[\s\S]*&& !on_mineworks_deposit[\s\S]*&& building_overlaps_resource_deposit\(ctx, owner, &kind, x, z\)/,
  'the authority must allow only a centered rich-stone Quarry or rich-mineral Mineworks to occupy its required deposit',
);
for (const [source, label] of [
  [residenceReducer, 'residences'],
  [farmFieldReducer, 'fields'],
  [livestockReducer, 'pastures'],
  [graveyardReducer, 'graveyards'],
] as const) {
  assert.match(
    source,
    /zone_overlaps_resource_deposit/,
    `authoritative ${label} placement must reject a deposit enclosed between parcel samples`,
  );
}
for (const [source, label] of [
  [buildingReducer, 'buildings'],
  [residenceReducer, 'residences'],
  [farmFieldReducer, 'fields'],
  [livestockReducer, 'pastures'],
  [graveyardReducer, 'graveyards'],
  [placementValidation, 'shared placement validation'],
  [reclamationSimulation, 'reclamation piles'],
] as const) {
  assert.doesNotMatch(
    source,
    /\bis_open_water\s*\(|\bis_near_open_water\s*\(|\bbuilding_overlaps_open_water\s*\(/,
    `authoritative ${label} placement must not mistake the fixed groundwater grid for the active rendered-water mask`,
  );
}
assert.match(
  buildingReducer,
  /Surface-water and shoreline placement is validated[\s\S]*active world's seed-aware rendered river mask/,
  'building placement must document why the active client mask owns generated surface-water validation',
);
assert.match(
  placementValidation,
  /node_kind != "clay"[\s\S]*RICH_CLAY_DEPOSIT_PROTECTION_RADIUS[\s\S]*polygon_overlaps_circle/,
  'physical-deposit protection must include generated clay rows and exact parcel overlap',
);
assert.doesNotMatch(
  buildingReducer,
  /road_path_distance\(x, z, chapel\.x, chapel\.z\)/,
  'authoritative Town Hall placement must not bind the civic gate to one arbitrary chapel',
);
assert.match(
  buildingTool,
  /if \(!validation\.ok\)[\s\S]*describePlacementFailure\?\.\([\s\S]*validation\.reason/,
  'invalid building previews should publish the canonical rejection reason',
);
assert.match(
  buildingTool,
  /private roadSnapEnabled = true[\s\S]*setRoadSnapEnabled\(enabled: boolean\)[\s\S]*const fullRoadNetwork = this\.options\.getRoadNetwork\?\.\(\);[\s\S]*this\.roadSnapEnabled \? fullRoadNetwork : null/,
  'building placement should default roadside snapping on and bypass it when the shared toggle is off',
);
assert.match(
  buildToolbar,
  /data-road-snap-control hidden[\s\S]*data-road-snap-toggle checked[\s\S]*Snap to Roads[\s\S]*roadSnapControl\.hidden = !browsing/,
  'one default-on roadside toggle should appear whenever any shared build palette is open',
);
assert.match(
  buildToolbar,
  /if \(event\.repeat\) \{[\s\S]{0,300}event\.preventDefault\(\);[\s\S]{0,120}event\.stopPropagation\(\);[\s\S]{0,80}return;/,
  'held construction hotkeys must not repeat into a newly opened or closed build menu',
);
assert.match(
  buildToolbar,
  /beginBrowsingBuildMenu[\s\S]{0,300}onCancelPlacement\(\)[\s\S]{0,120}setOverlayMenuOpen\(false\)/,
  'opening any build palette must cancel the previous placement intent before switching menus',
);
assert.match(
  buildingTool,
  /placementIntentVersion[\s\S]*this\.placementIntentVersion === placementIntentVersion/,
  'a failed request must not reactivate a building after the player has canceled or changed placement intent',
);
assert.match(
  app,
  /placementBlocked: buildingMode !== 'off'[\s\S]*isPlacementBlocked\(\)/,
  'the toolbar should receive the live building-preview warning state',
);
assert.match(
  app,
  /placementReady: buildingMode !== 'off'[\s\S]*isPlacementReady\(\)/,
  'the toolbar should receive the live valid building-preview state',
);
assert.match(
  buildToolbar,
  /stats\.placementBlocked[\s\S]*\? 'warning'[\s\S]*stats\.placementReady[\s\S]*\? 'ready'/,
  'blocked and valid previews should take precedence over the normal active tool state',
);
assert.match(
  buildChrome,
  /\.builder-status-bar\[data-state='warning'\][\s\S]*border-color[\s\S]*color/,
  'blocked placement guidance should have a distinct warning treatment',
);
assert.doesNotMatch(
  `${buildingPlacementPreview}\n${buildingMarkers}`,
  /Building placement extent|Selected building extent|Building fire spread range|Selected building fire spread range/,
  'placement and selection must keep generic gameplay radius circles absent',
);
assert.match(
  buildingPlacementPreview,
  /Game habitat disturbance warnings/,
  'building placement should expose the specific advisory wildlife warning layer',
);
assert.match(
  buildingPlacementPreview,
  /Lumber logging work extent warning/,
  'Lumber Mill placement should explain which habitat rings its logging reach intersects',
);
assert.doesNotMatch(
  buildingTool,
  /shown on terrain/,
  'placement status must not claim that a hidden radius is visible',
);

assert.match(
  buildingReducer,
  /fn overlaps_same_kind_functional_extent\([\s\S]{0,220}owner: spacetimedb::Identity[\s\S]{0,300}building\(\)\.owner\(\)\.filter\(&owner\)/,
  'functional extents from an invisible foreign settlement must not block placement',
);
assert.match(
  buildingReducer,
  /fn is_too_close_to_buildings\([\s\S]{0,260}owner: spacetimedb::Identity[\s\S]{0,360}building\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  buildingReducer,
  /building_footprints_too_close\([\s\S]{0,260}road_network/,
  'authoritative spacing must use road-aware visible footprints instead of pick-radius circles',
);
assert.doesNotMatch(
  buildingReducer,
  /candidate\.pick_radius \* 1\.85/,
  'the broad center-distance exclusion rule should not return',
);
assert.match(
  buildingReducer,
  /farm_field\(\)\.owner\(\)\.filter\(&owner\)\.any/,
);
assert.match(
  buildingReducer,
  /pasture\(\)\.owner\(\)\.filter\(&owner\)\.any/,
);
assert.match(
  placementValidation,
  /building_overlaps_residence_zone\([\s\S]{0,260}burgage_zone\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  placementValidation,
  /burgage_zone_overlaps_buildings\([\s\S]{0,260}building\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  placementValidation,
  /zone_overlaps_building_footprint\([\s\S]*road_aware_building_placement_yaw[\s\S]*pad\.radius_x \* pad\.inner_fade \* BUILDING_FOOTPRINT_SCALE/,
  'authoritative residence conflicts must use the rotated visible building footprint instead of the broad pick-radius square',
);
assert.match(
  placementValidation,
  /"stable" => BuildingPadParams \{\s*radius_x: 6\.4,\s*radius_z: 4\.2,\s*inner_fade: 0\.9,\s*outer_fade: 1\.3,/,
  'authoritative Stable placement must use the same footprint as the client instead of the oversized fallback pad',
);
assert.match(
  residenceReducer,
  /burgage_zone\(\)\.owner\(\)\.filter\(&owner\)[\s\S]*burgage_zone_overlaps_buildings\(ctx, owner, &corners\)[\s\S]*farm_field\(\)\.owner\(\)\.filter\(&owner\)/,
);
for (const [label, source] of [
  ['farm fields', farmFieldReducer],
  ['pastures', livestockReducer],
] as const) {
  assert.match(source, /building\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign buildings`);
  assert.match(source, /burgage_zone\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign homes`);
  assert.match(source, /farm_field\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign fields`);
}
assert.match(
  livestockReducer,
  /pasture\(\)\.owner\(\)\.filter\(&owner\)/,
  'pastures must ignore foreign grazing parcels',
);

console.log('Placement regression tests passed.');
