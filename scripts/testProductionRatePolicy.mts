import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PRODUCTION_RATE_PERCENT,
  isProductionRateBuilding,
  maintenanceRateMultiplier,
  normalizeProductionRatePercent,
  productionRateMultiplier,
  productionRatePlan,
} from '../src/economy/productionRatePolicy.ts';
import { withBuildingProductionRate } from '../src/resources/inspector/buildingProductionRateRenderer.ts';
import type { BuildingState } from '../src/resources/types.ts';
import type { InspectorView } from '../src/resources/inspector/renderInspectableTarget.ts';

assert.equal(DEFAULT_PRODUCTION_RATE_PERCENT, 50);
assert.equal(normalizeProductionRatePercent(undefined), 50);
assert.equal(normalizeProductionRatePercent(-10), 0);
assert.equal(normalizeProductionRatePercent(160), 100);
assert.equal(productionRateMultiplier(0), 0);
assert.equal(productionRateMultiplier(50), 1);
assert.equal(productionRateMultiplier(100), 2);
assert.equal(maintenanceRateMultiplier(0), 0);
assert.equal(maintenanceRateMultiplier(25), 0.25);
assert.equal(maintenanceRateMultiplier(50), 1);
assert.equal(maintenanceRateMultiplier(75), 2.25);
assert.equal(maintenanceRateMultiplier(100), 4);

for (const kind of [
  'lumber_mill',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'threshing_barn',
  'watermill',
  'windmill',
] as const) {
  assert.equal(isProductionRateBuilding(kind), true, `${kind} needs a rate control`);
}
assert.equal(isProductionRateBuilding('town_hall'), false);
assert.equal(isProductionRateBuilding('bakery'), false);

const normalBuilding = {
  kind: 'watermill',
  assignedLabor: 2,
  productionRatePercent: 50,
} as BuildingState;
const pausedPlan = productionRatePlan({ ...normalBuilding, productionRatePercent: 0 });
const normalPlan = productionRatePlan(normalBuilding);
const doublePlan = productionRatePlan({ ...normalBuilding, productionRatePercent: 100 });
assert.equal(pausedPlan?.ironworkPerYear, 0);
assert.ok((normalPlan?.ironworkPerYear ?? 0) > 0);
assert.ok(Math.abs(
  (doublePlan?.ironworkPerYear ?? 0) - (normalPlan?.ironworkPerYear ?? 0) * 4,
) < 1e-9);
assert.equal(doublePlan?.maintenanceMultiplier, 4);

const view: InspectorView = {
  eyebrow: 'Building',
  title: 'Watermill',
  statusText: 'Operating',
  statusState: 'active',
  detailsHtml: '',
  demolish: { visible: true, hint: '' },
  labor: {
    visible: true,
    count: 2,
    hint: '',
    decreaseDisabled: false,
    increaseDisabled: false,
  },
};
const rendered = withBuildingProductionRate(view, normalBuilding).supplementalPanelHtml ?? '';
assert.match(rendered, /type="range" data-production-rate-slider/);
assert.match(rendered, /min="0" max="100"/);
assert.match(rendered, /value="50"/);
assert.match(rendered, /Ironwork required/);
assert.match(rendered, /Production effectiveness/);
assert.match(rendered, /data-production-rate-value>100%<\/strong>/);
assert.match(rendered, /data-production-rate-maintenance>≤ \d+\.\d \/ year<\/strong>/);
assert.doesNotMatch(rendered, /× pace|× upkeep|pace squared|worker-year|range-hints/);

const table = readFileSync(new URL('../server/src/tables.rs', import.meta.url), 'utf8');
const reducer = readFileSync(new URL('../server/src/reducers/buildings.rs', import.meta.url), 'utf8');
const simulation = readFileSync(new URL('../server/src/simulation/expanded_economy.rs', import.meta.url), 'utf8');
assert.match(table, /#\[default\(50u8\)\][\s\S]*production_rate_percent: u8/);
assert.match(reducer, /pub fn set_building_production_rate/);
assert.match(simulation, /production_rate_multiplier\([\s\S]*production_rate_percent/);

console.log('Production rate policy tests passed.');
