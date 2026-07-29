import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
  updateBuildingPreviewGeometry,
} from '../src/buildings/BuildingPlacementPreview.ts';
import {
  assessBuildingFireSafety,
  buildingBaseFlammability,
  buildingFlammability,
  describePlacementFireSafety,
  fireCoverageColor,
} from '../src/fires/fireRiskPolicy.ts';
import {
  FIRE_MINIMUM_BUCKET_WATER,
  FIRE_SPREAD_RADIUS,
} from '../src/generated/gameBalance.ts';
import type {
  BuildingKind,
  BuildingState,
  ResidenceState,
} from '../src/resources/types.ts';
import { withBuildingFireSafety } from '../src/resources/inspector/fireSafetyRenderer.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from '../src/resources/inspector/renderInspectableTarget.ts';

assert.equal(buildingBaseFlammability('founders_camp'), 0);
assert.equal(buildingBaseFlammability('town_hall'), 0);
assert.equal(buildingBaseFlammability('charcoal_burner'), 2.2);
assert.equal(buildingBaseFlammability('smokehouse'), 2.2);
assert.equal(buildingBaseFlammability('smithy'), 1.8);
assert.equal(buildingBaseFlammability('potter_kiln'), 1.8);
assert.equal(buildingBaseFlammability('salvage_pile'), 1);

const target = building('hot-yard', 'charcoal_burner', 0, 0, {
  firewood: 80,
});
assert.ok(buildingFlammability(target) > buildingBaseFlammability(target.kind));

const readyWell = building('10', 'well', 40, 0, {
  assignedLabor: 1,
  water: 12,
  workRadius: 80,
});
const nearbyKiln = building('kiln', 'potter_kiln', 18, 0);
const fireSafeMarket = building('market', 'marketplace', 8, 0);
const nearbyHome = residence('home', 12, 2, 4);
const covered = assessBuildingFireSafety(target, {
  buildings: [target, readyWell, nearbyKiln, fireSafeMarket],
  residences: [nearbyHome, residence('far-home', 200, 0, 4)],
  roadPathDistance: (ax, az, bx, bz) =>
    Math.hypot(bx - ax, bz - az) + 8,
  travelSpeedMultiplierForWell: () => 1.18,
});
assert.equal(covered.riskBand, 'severe');
assert.equal(covered.coverage, 'covered');
assert.equal(covered.nearestWellId, readyWell.id);
assert.equal(covered.nearestWellReadiness, 'ready');
assert.ok((covered.responseDistance ?? 0) > 35);
assert.ok((covered.firstBucketSeconds ?? 0) > 10);
assert.equal(covered.exposedBuildingCount, 1);
assert.equal(covered.exposedHouseholdCount, 1);
assert.match(
  describePlacementFireSafety(covered) ?? '',
  /Severe fire risk · ready well .* first bucket · 2 structures/,
);

const dryWell = building('11', 'well', 35, 0, {
  assignedLabor: 1,
  water: FIRE_MINIMUM_BUCKET_WATER - 0.01,
  workRadius: 80,
});
const unready = assessBuildingFireSafety(
  { kind: 'smithy', x: 0, z: 0 },
  { buildings: [dryWell] },
);
assert.equal(unready.coverage, 'unready');
assert.equal(unready.nearestWellReadiness, 'dry');
assert.equal(unready.firstBucketSeconds, null);
assert.match(
  describePlacementFireSafety(unready) ?? '',
  /well extent reaches here but it holds less than/,
);
const busy = assessBuildingFireSafety(
  { kind: 'smokehouse', x: 0, z: 0 },
  {
    buildings: [readyWell],
    busyBuildingIds: new Set([readyWell.id]),
  },
);
assert.equal(busy.coverage, 'unready');
assert.equal(busy.nearestWellReadiness, 'busy');
assert.match(
  describePlacementFireSafety(busy) ?? '',
  /bucket carrier is still away/,
);

const uncovered = assessBuildingFireSafety(
  { kind: 'potter_kiln', x: 0, z: 0 },
  { buildings: [building('far-well', 'well', 200, 0, { workRadius: 80 })] },
);
assert.equal(uncovered.coverage, 'uncovered');
assert.match(
  describePlacementFireSafety(uncovered) ?? '',
  /no ready well extent reaches here/,
);

const fireSafe = assessBuildingFireSafety(
  { kind: 'town_hall', x: 0, z: 0 },
  { buildings: [] },
);
assert.equal(fireSafe.riskBand, 'fireproof');
assert.equal(fireSafe.coverage, 'fireproof');
assert.equal(describePlacementFireSafety(fireSafe), null);

const preview = createBuildingPreviewMesh('smithy');
const fireRing = preview.getObjectByName('Building fire spread range');
assert.ok(fireRing instanceof THREE.Mesh);
assert.equal(fireRing.userData.extentRadius, FIRE_SPREAD_RADIUS);
updateBuildingPreviewGeometry(
  preview,
  'smithy',
  0,
  0,
  0,
  (x, z) => Math.sin(x * 0.05) + Math.cos(z * 0.04),
);
assert.ok(
  (fireRing.geometry.getAttribute('position') as THREE.BufferAttribute).count > 24,
  'fire spread preview must be a readable terrain-following dashed ring',
);
updateBuildingPreviewAppearance(preview, true, 'covered');
assert.equal(
  (fireRing.material as THREE.MeshBasicMaterial).color.getHex(),
  fireCoverageColor('covered'),
);
updateBuildingPreviewAppearance(preview, true, 'unready');
assert.equal(
  (fireRing.material as THREE.MeshBasicMaterial).color.getHex(),
  fireCoverageColor('unready'),
);
updateBuildingPreviewAppearance(preview, false, 'covered');
assert.equal(
  (fireRing.material as THREE.MeshBasicMaterial).color.getHex(),
  0xff5d50,
);
disposeBuildingPreviewMesh(preview);
const chapelPreview = createBuildingPreviewMesh('chapel');
assert.equal(
  chapelPreview.getObjectByName('Building fire spread range'),
  undefined,
  'low-risk civic buildings should not clutter placement with a spread ring',
);
disposeBuildingPreviewMesh(chapelPreview);

const baseView: InspectorView = {
  eyebrow: 'Industry',
  title: 'Charcoal yard',
  statusText: 'Working',
  statusState: 'positive',
  detailsHtml: '<li><span>Output</span><span>Charcoal</span></li>',
  demolish: { visible: true, hint: '' },
  labor: {
    visible: true,
    count: 1,
    hint: '',
    decreaseDisabled: false,
    increaseDisabled: false,
  },
};
const inspectorView = withBuildingFireSafety(
  baseView,
  target,
  {
    gameState: {
      buildings: new Map([
        [target.id, target],
        [readyWell.id, readyWell],
        [nearbyKiln.id, nearbyKiln],
      ]),
      residences: new Map([[nearbyHome.id, nearbyHome]]),
      fireIncidents: new Map(),
      deliveryTrips: new Map(),
    },
    worldQueries: {
      getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
        Math.hypot(bx - ax, bz - az) + 8,
      getDeliveryTravelSpeedMultiplier: () => 1.18,
    },
  } as unknown as InspectorRenderContext,
);
assert.match(inspectorView.detailsHtml, /Fire risk[\s\S]*Severe/);
assert.match(inspectorView.detailsHtml, /Fire response[\s\S]*first bucket/);
assert.match(inspectorView.detailsHtml, /Spread exposure[\s\S]*occupied home/);
assert.match(inspectorView.detailsHtml, /data-inspect-building="10"/);

const perfBuildings = Array.from({ length: 100_000 }, (_, index) =>
  building(
    String(index + 100),
    index % 8 === 0 ? 'well' : index % 3 === 0 ? 'smithy' : 'granary',
    (index % 500) * 2,
    Math.floor(index / 500) * 2,
    index % 8 === 0
      ? { assignedLabor: 1, water: 20, workRadius: 90 }
      : { firewood: index % 40 },
  ));
const startedAt = performance.now();
const perfAssessment = assessBuildingFireSafety(
  { kind: 'charcoal_burner', x: 500, z: 200 },
  { buildings: perfBuildings },
);
const elapsedMs = performance.now() - startedAt;
assert.equal(perfAssessment.coverage, 'covered');
assert.ok(
  elapsedMs < 120,
  `100,000-building fire-safety scan took ${elapsedMs.toFixed(1)} ms`,
);

console.log(
  `fire-safety planning tests passed (${elapsedMs.toFixed(1)} ms / 100k buildings)`,
);

function building(
  id: string,
  kind: BuildingKind,
  x: number,
  z: number,
  patch: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    ...patch,
  };
}

function residence(
  id: string,
  x: number,
  z: number,
  population: number,
): ResidenceState {
  return {
    id,
    zoneId: 'zone',
    parcelIndex: Number(id.replace(/\D/g, '')) || 0,
    x,
    z,
    tier: 1,
    population,
    firewood: 0,
    water: 0,
    food: 0,
    preservedFood: 0,
    ale: 0,
    cloth: 0,
    wealth: 0,
    settlementTicks: 0,
    abandonmentTicks: 0,
    abandoned: false,
    upgradeTargetTier: 0,
    upgradeProgress: 0,
    upgradeRequiredTimber: 0,
    upgradeRequiredStone: 0,
    upgradeRequiredGold: 0,
    upgradeDeliveredTimber: 0,
    upgradeDeliveredStone: 0,
    upgradeDeliveredGold: 0,
    upgradeReservedTimber: 0,
    upgradeReservedStone: 0,
    upgradeReservedGold: 0,
    backyardProjectKind: 0,
    backyardProjectProgress: 0,
    fireRepairActive: false,
  };
}
