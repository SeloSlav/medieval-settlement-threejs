import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  assignMarketplaceStallRoster,
} from '../src/economy/marketStallAssignments.ts';
import {
  MARKETPLACE_SUPPLY_LINK_COLOR,
  MARKETPLACE_SUPPLY_LINK_MIN_ARC_RISE,
  MarketplaceSupplyLinks,
  marketplaceResidenceServiceArcPoints,
  marketplaceResidenceServiceLinks,
  marketplaceSupplyArcPoints,
  marketplaceSupplyLinksForSelection,
} from '../src/buildings/MarketplaceSupplyLinks.ts';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { BuildingState, GameState, ResidenceState } from '../src/resources/types.ts';

const marketNear = stallBuilding('market-10', 'marketplace', 10, 0, 0);
const marketFar = stallBuilding('market-20', 'marketplace', 100, 0, 0);
const granary = stallBuilding('granary-30', 'granary', 0, 0, 2, {
  ryeBread: 20,
});
const storehouse = stallBuilding(
  'storehouse-40',
  'village_storehouse',
  2,
  4,
  2,
  {
    firewood: 12,
    pottery: 8,
  },
);
const unrelated = stallBuilding('bakery-50', 'bakery', 4, -3, 1);
const buildings = [marketNear, marketFar, granary, storehouse, unrelated];
const distance = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(bx - ax, bz - az);
const roster = assignMarketplaceStallRoster(buildings, distance);

assert.deepEqual(
  marketplaceSupplyLinksForSelection(granary, buildings, roster.stalls)
    .map((link) => [link.sourceId, link.marketplaceId, link.stallCount]),
  [
    ['granary-30', 'market-10', 1],
    ['granary-30', 'market-20', 1],
  ],
  'a selected Granary should link to every Marketplace where one of its active stalls is set up',
);
assert.deepEqual(
  marketplaceSupplyLinksForSelection(storehouse, buildings, roster.stalls)
    .map((link) => [link.sourceId, link.marketplaceId, link.stallCount]),
  [['storehouse-40', 'market-10', 2]],
  'multiple goods stalls from one Storehouse at one market should collapse to one line',
);
assert.deepEqual(
  marketplaceSupplyLinksForSelection(marketNear, buildings, roster.stalls)
    .map((link) => [link.sourceId, link.marketplaceId, link.stallCount]),
  [
    ['granary-30', 'market-10', 1],
    ['storehouse-40', 'market-10', 2],
  ],
  'a selected Marketplace should link once to every Granary or Storehouse supplying its active stalls',
);
assert.deepEqual(
  marketplaceSupplyLinksForSelection(unrelated, buildings, roster.stalls),
  [],
  'unrelated building selections should not retain supply links',
);

const standbyOnlyBuildings = [
  marketNear,
  { ...granary, ryeBread: 0 },
];
const standbyOnlyRoster = assignMarketplaceStallRoster(
  standbyOnlyBuildings,
  distance,
);
assert.ok(standbyOnlyRoster.workers.length > 0);
assert.equal(standbyOnlyRoster.stalls.length, 0);
assert.deepEqual(
  marketplaceSupplyLinksForSelection(
    marketNear,
    standbyOnlyBuildings,
    standbyOnlyRoster.stalls,
  ),
  [],
  'an empty standby table is not an actively supplied stall and should not draw a link',
);

const disabledRoster = assignMarketplaceStallRoster(
  buildings,
  distance,
  new Set([granary.id]),
);
assert.deepEqual(
  marketplaceSupplyLinksForSelection(marketNear, buildings, disabledRoster.stalls)
    .map((link) => link.sourceId),
  ['storehouse-40'],
  'fire-disabled suppliers should not remain connected by an active supply line',
);

const terrain = {
  getHeightAt: (x: number, z: number) => 7 + x * 0.025 - z * 0.04,
};
const marketLinks = marketplaceSupplyLinksForSelection(
  marketNear,
  buildings,
  roster.stalls,
);
const arc = marketplaceSupplyArcPoints(marketLinks[0], terrain.getHeightAt);
const start = arc[0];
const midpoint = arc[Math.floor(arc.length * 0.5)];
const end = arc[arc.length - 1];
assert.equal(start.x, marketLinks[0].sourceX);
assert.equal(start.z, marketLinks[0].sourceZ);
assert.equal(end.x, marketLinks[0].marketplaceX);
assert.equal(end.z, marketLinks[0].marketplaceZ);
assert.ok(
  midpoint.y >= Math.max(start.y, end.y) + MARKETPLACE_SUPPLY_LINK_MIN_ARC_RISE - 1e-9,
  'the connection midpoint must rise into 3D space instead of following a straight chord',
);
assert.ok(Math.abs(midpoint.x - (start.x + end.x) * 0.5) < 1e-9);
assert.ok(Math.abs(midpoint.z - (start.z + end.z) * 0.5) < 1e-9);

const residences = [
  { id: 'home-20', x: 14, z: 8 },
  { id: 'home-10', x: 7, z: -6 },
  { id: 'home-unserved', x: -20, z: 2 },
] as ResidenceState[];
const residenceServiceLinks = marketplaceResidenceServiceLinks(
  marketNear,
  residences,
  new Set(['home-10', 'home-20']),
);
assert.deepEqual(
  residenceServiceLinks.map((link) => [link.marketplaceId, link.residenceId]),
  [
    ['market-10', 'home-10'],
    ['market-10', 'home-20'],
  ],
  'Marketplace coverage should produce one stable link to every home it actually serves',
);
const residenceArc = marketplaceResidenceServiceArcPoints(
  residenceServiceLinks[0],
  terrain.getHeightAt,
);
assert.equal(residenceArc[0].x, marketNear.x);
assert.equal(residenceArc[0].z, marketNear.z);
assert.equal(residenceArc.at(-1)?.x, residences[1].x);
assert.equal(residenceArc.at(-1)?.z, residences[1].z);
assert.ok(
  residenceArc[Math.floor(residenceArc.length * 0.5)].y
    >= Math.max(residenceArc[0].y, residenceArc.at(-1)?.y ?? -Infinity)
      + MARKETPLACE_SUPPLY_LINK_MIN_ARC_RISE - 1e-9,
  'Marketplace-to-home service links should use the same lifted curve as supply links',
);

const parent = new THREE.Group();
const overlay = new MarketplaceSupplyLinks({ parent, terrain });
overlay.sync(marketNear, buildings, roster.stalls);
overlay.syncResidenceService(
  marketNear,
  residences,
  new Set(['home-10', 'home-20']),
);
const root = parent.getObjectByName('Selected marketplace supply links');
const lines = root?.getObjectByName('Selected marketplace supply arcs');
const residenceLines = root?.getObjectByName('Marketplace residence service arcs');
assert.ok(root instanceof THREE.Group);
assert.ok(lines instanceof THREE.LineSegments);
assert.ok(residenceLines instanceof THREE.LineSegments);
assert.equal(lines.visible, true);
assert.equal(residenceLines.visible, true);
assert.equal(
  (lines.material as THREE.LineBasicMaterial).color.getHex(),
  MARKETPLACE_SUPPLY_LINK_COLOR,
  'market supply connections must use the requested yellow',
);
assert.equal(
  (residenceLines.material as THREE.LineBasicMaterial).color.getHex(),
  MARKETPLACE_SUPPLY_LINK_COLOR,
  'Marketplace-to-home connections must use the same yellow as depot supply links',
);
assert.deepEqual(
  residenceLines.userData.marketplaceResidenceServiceLinks,
  [
    { marketplaceId: 'market-10', residenceId: 'home-10' },
    { marketplaceId: 'market-10', residenceId: 'home-20' },
  ],
);
assert.deepEqual(
  lines.userData.marketplaceSupplyLinks,
  [
    { sourceId: 'granary-30', marketplaceId: 'market-10', stallCount: 1 },
    { sourceId: 'storehouse-40', marketplaceId: 'market-10', stallCount: 2 },
  ],
);
assert.ok(
  lines.geometry.getAttribute('position').count > marketLinks.length * 2,
  'each relationship should be tessellated into an arc rather than one straight segment',
);
const stableGeometry = lines.geometry;
const material = lines.material as THREE.LineBasicMaterial;
let geometryDisposed = false;
let materialDisposed = false;
stableGeometry.addEventListener('dispose', () => { geometryDisposed = true; });
material.addEventListener('dispose', () => { materialDisposed = true; });
overlay.sync(marketNear, buildings, roster.stalls);
assert.equal(
  lines.geometry,
  stableGeometry,
  'an unchanged selected roster should retain its GPU geometry',
);
overlay.sync(null, buildings, roster.stalls);
assert.equal(lines.visible, false, 'clearing or changing selection should hide the arcs');
overlay.syncResidenceService(null, residences, new Set());
assert.equal(
  residenceLines.visible,
  false,
  'releasing Marketplace coverage should hide its residence arcs',
);
overlay.dispose();
assert.equal(parent.getObjectByName('Selected marketplace supply links'), undefined);
assert.equal(geometryDisposed, true);
assert.equal(materialDisposed, true);

const integrationParent = new THREE.Group();
const roadNetwork = new RoadNetwork();
roadNetwork.addRoadPath([
  new THREE.Vector3(-10, 0, 0),
  new THREE.Vector3(110, 0, 0),
]);
const buildingMarkers = new BuildingMarkers({
  terrain: terrain as never,
  parent: integrationParent,
  getRoadNetwork: () => roadNetwork,
});
const integrationState = {
  buildings: new Map(buildings.map((building) => [building.id, building])),
  residences: new Map(residences.map((residence) => [residence.id, residence])),
  fireIncidents: new Map(),
} as GameState;
buildingMarkers.setBuildingSelectionOverlays(marketNear, integrationState);
const integratedLines = integrationParent
  .getObjectByName('Selected marketplace supply arcs');
assert.ok(integratedLines instanceof THREE.LineSegments);
assert.equal(integratedLines.visible, true);
assert.equal(integratedLines.userData.marketplaceSupplyLinks.length, 2);
buildingMarkers.setMarketplaceServiceCoverage(
  marketNear.id,
  new Set(['home-10', 'home-20']),
  integrationState,
);
const integratedResidenceLines = integrationParent
  .getObjectByName('Marketplace residence service arcs');
assert.ok(integratedResidenceLines instanceof THREE.LineSegments);
assert.equal(integratedResidenceLines.visible, true);
assert.equal(
  integratedResidenceLines.userData.marketplaceResidenceServiceLinks.length,
  2,
);
const fireDisabledIntegrationState = {
  ...integrationState,
  fireIncidents: new Map([[
    'granary-fire',
    {
      id: 'granary-fire',
      targetKind: 'building',
      targetId: granary.id,
    } as never,
  ]]),
} as GameState;
buildingMarkers.setBuildingSelectionOverlays(
  marketNear,
  fireDisabledIntegrationState,
);
assert.deepEqual(
  integratedLines.userData.marketplaceSupplyLinks.map(
    (link: { sourceId: string }) => link.sourceId,
  ),
  ['storehouse-40'],
  'refreshing the same selected market should immediately remove a disabled supplier',
);
buildingMarkers.setBuildingSelectionOverlays(null);
assert.equal(integratedLines.visible, false);
buildingMarkers.setMarketplaceServiceCoverage(null, new Set(), integrationState);
assert.equal(integratedResidenceLines.visible, false);
buildingMarkers.dispose();
assert.equal(integrationParent.getObjectByName('Building markers'), undefined);

console.log('Marketplace supply selection and 3D arc overlay checks passed.');

function stallBuilding(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  assignedLabor: number,
  stock: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    assignedLabor,
    constructionComplete: true,
    food: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    firewood: 0,
    water: 0,
    timber: 0,
    stone: 0,
    gold: 0,
    waterCapacity: 0,
    actionCooldown: 0,
    workRadius: 0,
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
    ...stock,
  } as BuildingState;
}
