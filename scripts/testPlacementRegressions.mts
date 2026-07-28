import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { getBuildingSiteClearanceSearchRadius } from '../src/buildings/BuildingTerrainLayout.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
  updateBuildingPreviewGeometry,
} from '../src/buildings/BuildingPlacementPreview.ts';
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
  for (let index = 0; index < fillPositions.count; index++) {
    assert.ok(
      Math.abs(
        fillPositions.getY(index)
        - (heightAt(fillPositions.getX(index), fillPositions.getZ(index)) + 0.1)
      ) < 1e-5,
      'placement fill vertices must stay just above the sampled terrain',
    );
  }

  const borderGeometry = new THREE.BufferGeometry();
  updateTerrainRibbonGeometry(
    borderGeometry,
    polygonSegments(corners),
    heightAt,
    { width: 0.2, lift: 0.16, sampleSpacing: 0.75, dashLength: 1.4, gapLength: 0.8 },
  );
  const borderPositions = borderGeometry.getAttribute('position') as THREE.BufferAttribute;
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

testClearanceSpatialIndexKeepsNearbyCandidates();
testQuarryFootprintsAvoidRivers();
testBurgageWaterValidationSamplesTheWholeZone();
testPlacementOverlaysFollowTerrainHeight();
testPlacementPreviewShowsTerrainFollowingExtent();

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

const buildingReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const placementValidation = readFileSync('server/src/placement_validation.rs', 'utf8');
const residenceReducer = readFileSync('server/src/reducers/residences.rs', 'utf8');
const farmFieldReducer = readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
const livestockReducer = readFileSync('server/src/reducers/livestock.rs', 'utf8');
const buildingTool = readFileSync('src/buildings/BuildingTool.ts', 'utf8');
const app = readFileSync('src/app/App.ts', 'utf8');
const buildToolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const buildChrome = readFileSync('src/ui/buildChrome.css', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');

assert.match(
  buildingTool,
  /if \(!validation\.ok\)[\s\S]*describePlacementFailure\?\.\([\s\S]*validation\.reason/,
  'invalid building previews should publish the canonical rejection reason',
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
