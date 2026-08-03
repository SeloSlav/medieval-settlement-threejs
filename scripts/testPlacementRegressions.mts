import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { getBuildingSiteClearanceSearchRadius } from '../src/buildings/BuildingTerrainLayout.ts';
import {
  buildingPlacementYaw,
  resolveRoadsideBuildingPlacement,
} from '../src/buildings/buildingPlacement.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
  updateBuildingPreviewGeometry,
} from '../src/buildings/BuildingPlacementPreview.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { buildingExtentColor } from '../src/buildings/buildingExtents.ts';
import { PlacementClearanceSpatialIndex } from '../src/placement/PlacementClearanceSpatialIndex.ts';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../src/placement/TerrainOverlayGeometry.ts';
import { QuarryLayout, quarrySiteOverlapsRiver } from '../src/quarries/QuarryLayout.ts';
import { burgageZoneTouchesWater } from '../src/residences/burgagePlacementValidation.ts';
import { RiverLayout } from '../src/rivers/RiverLayout.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingKind,
  BuildingState,
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
  assert.equal(extent.userData.extentRadius, 150);
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

testClearanceSpatialIndexKeepsNearbyCandidates();
testRoadFacingBuildingsSnapToRoadSides();
testQuarryFootprintsAvoidRivers();
testBurgageWaterValidationSamplesTheWholeZone();
testPlacementOverlaysFollowTerrainHeight();
testPlacementPreviewShowsTerrainFollowingExtent();
testCivicAndFrontierPlacementPrerequisites();
testMineralMineCanOccupyItsDeposit();

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
  /getBuildingExtent\(kind, definition\.workRadius\)[\s\S]*Ready: \$\{extent\.label\.toLowerCase\(\)\} \$\{extent\.radius\} m/,
  'valid strategic buildings should identify the visible extent in the live status',
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
