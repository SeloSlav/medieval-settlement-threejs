import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { intersectTerrainHeightfieldRay } from '../src/terrain/TerrainProjector.ts';
import {
  BuildingTerrainLayout,
  getBuildingFootprintCorners,
  getBuildingSiteClearanceSearchRadius,
  pointWithinBuildingSiteClearance,
} from '../src/buildings/BuildingTerrainLayout.ts';
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
  buildingFootprintOverlapsRoadSurface,
  chooseRoadClearBuildingPlacement,
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import { buildingExtentColor } from '../src/buildings/buildingExtents.ts';
import { PlacementClearanceSpatialIndex } from '../src/placement/PlacementClearanceSpatialIndex.ts';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../src/placement/TerrainOverlayGeometry.ts';
import { QuarryLayout, quarrySiteOverlapsRiver } from '../src/quarries/QuarryLayout.ts';
import {
  burgageZoneTouchesWater,
  validateBurgagePlacement,
} from '../src/residences/burgagePlacementValidation.ts';
import { BurgagePreview } from '../src/residences/BurgagePreview.ts';
import { BurgageTool } from '../src/residences/BurgageTool.ts';
import { backyardGardenPlacementForParcel } from '../src/residences/backyardPosition.ts';
import { resolveCurvedFrontageLine } from '../src/residences/burgageRoadFrontage.ts';
import { resolveRoadCenterPathForFrontage } from '../src/residences/burgageFrontagePath.ts';
import {
  MIN_ZONE_DEPTH,
  STANDARD_ZONE_DEPTH,
  cornersFromPoints,
  measureZoneSideDepths,
  resolveBurgageLayout,
} from '../src/residences/burgageLayout.ts';
import { RiverLayout } from '../src/rivers/RiverLayout.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingKind,
  BuildingState,
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
  const context = {
    frontageEdge: 0 as const,
    plotCount: 1,
    stockpile: { timber: 10_000, stone: 10_000 },
    existingZones: [],
    existingBuildings: [well],
    roadNetwork: roads,
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
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

function testRoadFacingBuildingsSnapToRoadSides(): void {
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
  assert(
    resolveRoadsideBuildingPlacement('foragers_shed', 4, 5, roads).z > 5,
    'gathering buildings should still honor the separate road-snap toggle',
  );
  const reclamationPile = resolveRoadsideBuildingPlacement('salvage_pile', 13, 6, roads);
  assert(
    Math.abs(Math.abs(
      buildingPlacementYaw('salvage_pile', reclamationPile.x, reclamationPile.z, roads),
    ) - Math.PI) < 0.01,
    'every road-snapped footprint should face the road even without an authored facade flag',
  );

  assert.deepEqual(
    resolveRoadsideBuildingPlacement('hunters_hall', 4, 6, roads),
    { x: 4, z: 6 },
    'remote buildings without a road dependency should retain free placement',
  );
  assert.deepEqual(
    resolveRoadsideBuildingPlacement('watermill', 4, 6, roads),
    { x: 4, z: 6 },
    'shore-anchored buildings should retain precise shoreline placement',
  );
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

  fillGeometry.dispose();
  borderGeometry.dispose();
}

function testPlacementPreviewShowsTerrainFollowingExtent(): void {
  const heightAt = (x: number, z: number) =>
    Math.sin(x * 0.018) * 3.4 + Math.cos(z * 0.021) * 2.6;
  const preview = createBuildingPreviewMesh('threshing_barn');
  const extent = preview.getObjectByName('Building placement extent');
  assert.ok(extent instanceof THREE.Mesh);
  assert.equal(extent.userData.extentRadius, 250);
  assert.equal(extent.userData.extentLabel, 'Field work extent');

  updateBuildingPreviewGeometry(preview, 'threshing_barn', 35, -48, 0.42, heightAt);
  const positions = extent.geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.ok(positions.count > 120, 'the placement extent should have a readable terrain ribbon');
  for (let index = 0; index < positions.count; index++) {
    assert.ok(
      Math.abs(
        positions.getY(index)
        - (heightAt(positions.getX(index), positions.getZ(index)) + 0.165)
      ) < 1e-5,
      'placement extent vertices must follow the sampled terrain',
    );
  }

  updateBuildingPreviewAppearance(preview, false);
  const extentMaterial = extent.material as THREE.MeshBasicMaterial;
  assert.equal(extentMaterial.color.getHex(), 0xff5d50);
  assert.ok(extentMaterial.opacity < 0.4);
  updateBuildingPreviewAppearance(preview, true);
  assert.equal(extentMaterial.color.getHex(), buildingExtentColor('threshing_barn'));
  disposeBuildingPreviewMesh(preview);

  const pointBuildingPreview = createBuildingPreviewMesh('brewery');
  assert.equal(pointBuildingPreview.getObjectByName('Building placement extent'), undefined);
  disposeBuildingPreviewMesh(pointBuildingPreview);

  const largestPreview = createBuildingPreviewMesh('monastery');
  const startedAt = performance.now();
  for (let index = 0; index < 250; index++) {
    updateBuildingPreviewGeometry(
      largestPreview,
      'monastery',
      index * 0.21,
      -index * 0.17,
      0,
      heightAt,
    );
  }
  const elapsedMs = performance.now() - startedAt;
  disposeBuildingPreviewMesh(largestPreview);
  assert.ok(
    elapsedMs < 1_000,
    `250 maximum-radius preview updates should remain interactive (took ${elapsedMs.toFixed(1)} ms)`,
  );
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

function testMineralMineCanOccupyItsDeposit(): void {
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
  assert.deepEqual(
    resolveBuildingPlacementPoint(
      'mine',
      richIronDeposit.x + 18,
      richIronDeposit.z - 9,
      [ironDeposit, richIronDeposit],
    ),
    { x: richIronDeposit.x, z: richIronDeposit.z },
    'a rich deep mine should snap to the resource center',
  );
  assert.deepEqual(
    resolveBuildingPlacementPoint(
      'mine',
      ironDeposit.x + 18,
      ironDeposit.z - 9,
      [ironDeposit, richIronDeposit],
    ),
    { x: ironDeposit.x + 18, z: ironDeposit.z - 9 },
    'an ordinary surface mine should remain where the player points',
  );
  const baseContext = {
    buildings: [],
    residences: [],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [ironDeposit],
    foragingNodes: [],
    stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000 },
    isWaterAt: () => false,
    isResourceDepositAt: () => true,
    getNaturalHeightAt: () => 0,
    fireDisabledBuildingIds: new Set<string>(),
  };

  assert.equal(
    validateBuildingPlacement('mine', ironDeposit.x, ironDeposit.z, baseContext).ok,
    true,
    'a mine must be allowed to occupy the mineral pit it is required to cover',
  );
  assert.deepEqual(
    validateBuildingPlacement('mine', ironDeposit.x + 8, ironDeposit.z, baseContext),
    { ok: false, reason: 'requires_mineral_deposit' },
    'a mine offset from the deposit center must remain invalid',
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
testRoadFacingBuildingsSnapToRoadSides();
testQuarryFootprintsAvoidRivers();
testBurgageWaterValidationSamplesTheWholeZone();
testBurgageTerrainRulesAreLotFriendly();
testBurgageBuildingOverlapUsesVisibleFootprints();
testOrganicBurgagePlotsAndPreviewIcons();
testBurgageFrontageDirectionAndRoadSideSelection();
testPlacementOverlaysFollowTerrainHeight();
testPlacementPreviewShowsTerrainFollowingExtent();
testCivicAndFrontierPlacementPrerequisites();
testMineralMineCanOccupyItsDeposit();
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
const residenceReducer = readFileSync('server/src/reducers/residences.rs', 'utf8');
const farmFieldReducer = readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
const livestockReducer = readFileSync('server/src/reducers/livestock.rs', 'utf8');
const graveyardReducer = readFileSync('server/src/reducers/graveyards.rs', 'utf8');
const buildingTool = readFileSync('src/buildings/BuildingTool.ts', 'utf8');
const app = readFileSync('src/app/App.ts', 'utf8');
const buildToolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const buildChrome = readFileSync('src/ui/buildChrome.css', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
const terrainProjector = readFileSync('src/terrain/TerrainProjector.ts', 'utf8');
const firstPersonController = readFileSync('src/camera/FirstPersonController.ts', 'utf8');
const cameraController = readFileSync('src/camera/CameraController.ts', 'utf8');
const roadTool = readFileSync('src/roads/RoadTool.ts', 'utf8');

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
assert.match(
  buildingReducer,
  /let on_mineral_deposit[\s\S]{0,260}kind != "large_quarry"[\s\S]{0,180}!on_mineral_deposit[\s\S]{0,180}is_on_resource_deposit/,
  'the authority must allow a mine to occupy the mineral pit it is required to cover',
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
  /private roadSnapEnabled = true[\s\S]*setRoadSnapEnabled\(enabled: boolean\)[\s\S]*this\.roadSnapEnabled \? this\.options\.getRoadNetwork\?\.\(\) : null/,
  'building placement should default roadside snapping on and bypass it when the shared toggle is off',
);
assert.match(
  buildToolbar,
  /data-road-snap-control hidden[\s\S]*data-road-snap-toggle checked[\s\S]*Snap to Roads[\s\S]*roadSnapControl\.hidden = !browsing/,
  'one default-on roadside toggle should appear whenever any shared build palette is open',
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
assert.match(
  buildingTool,
  /getBuildingExtent\(kind, definition\.workRadius\)[\s\S]*Ready: \$\{extent\.label\.toLowerCase\(\)\} shown on terrain/,
  'valid strategic buildings should point to the visible extent without printing its data value',
);
assert.match(
  buildingMarkers,
  /updateTerrainCircleRibbonGeometry\([\s\S]*this\.terrain\.getHeightAt\.bind\(this\.terrain\)/,
  'selected building extents should use the same terrain-following geometry as placement',
);
assert.doesNotMatch(
  buildingMarkers,
  /new THREE\.RingGeometry/,
  'strategic extent rings should not remain flat planes that clip through terrain',
);

assert.match(
  buildingReducer,
  /fn overlaps_same_kind_functional_extent\([\s\S]{0,220}owner: spacetimedb::Identity[\s\S]{0,300}building\(\)\.owner\(\)\.filter\(&owner\)/,
  'functional extents from an invisible foreign settlement must not block placement',
);
assert.match(
  buildingReducer,
  /fn is_too_close_to_buildings\([\s\S]{0,220}owner: spacetimedb::Identity[\s\S]{0,300}building\(\)\.owner\(\)\.filter\(&owner\)/,
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
