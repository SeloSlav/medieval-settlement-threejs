import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  assessBuildingFireSafety,
  fireRiskBandLabel,
  wellReadinessLabel,
} from '../../fires/fireRiskPolicy.ts';
import { FIRE_SPREAD_RADIUS } from '../../generated/gameBalance.ts';
import type { BuildingState } from '../types.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';

/**
 * Adds pre-incident planning information to every completed building
 * inspector. It is intentionally derived from current state: no duplicate
 * coverage, risk, or ETA fields are stored in saves.
 */
export function withBuildingFireSafety(
  view: InspectorView,
  building: BuildingState,
  context: InspectorRenderContext,
): InspectorView {
  const fireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  );
  const assessment = assessBuildingFireSafety(building, {
    buildings: context.gameState.buildings.values(),
    residences: context.gameState.residences.values(),
    fireDisabledBuildingIds: fireDisabled,
    freeHaulersAvailable: context.populationStats?.available,
    roadPathDistance: (ax, az, bx, bz) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    travelSpeedMultiplierForWell: (well) =>
      context.worldQueries.getDeliveryTravelSpeedMultiplier(well),
  });

  if (assessment.riskBand === 'fireproof') {
    return {
      ...view,
      detailsHtml: `${view.detailsHtml}
        <li><span>Fire risk</span><span>Structurally fire-safe</span></li>`,
    };
  }

  const storedFuelIncrease = Math.max(
    0,
    Math.round((assessment.storedFuelMultiplier - 1) * 100),
  );
  const riskDetail = `${fireRiskBandLabel(assessment.riskBand)} · ${assessment.currentFlammability.toFixed(2)}× ignition/spread susceptibility${
    storedFuelIncrease > 0
      ? ` · current fuel stores add ${storedFuelIncrease}%`
      : ''
  }`;
  const inspectWell = assessment.nearestWellId
    ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${assessment.nearestWellId}" aria-label="Inspect fire-response well">Inspect well</button>`
    : '';
  const responseDetail = assessment.coverage === 'covered'
    && assessment.responseDistance != null
    && assessment.firstBucketSeconds != null
    ? `Ready · ${Math.round(assessment.responseDistance)} m route · ~${Math.ceil(assessment.firstBucketSeconds)}s to first bucket${inspectWell}`
    : assessment.coverage === 'unready'
      ? `Extent covered, but ${wellReadinessLabel(assessment.nearestWellReadiness)}${inspectWell}`
      : `Uncovered · no ready well extent reaches this structure`;
  const exposed = assessment.exposedBuildingCount + assessment.exposedHouseholdCount;
  const exposureDetail = exposed === 0
    ? `Isolated · no other occupied structure within ${FIRE_SPREAD_RADIUS} m`
    : `${assessment.exposedBuildingCount} operational ${
        assessment.exposedBuildingCount === 1 ? 'building' : 'buildings'
      } + ${assessment.exposedHouseholdCount} occupied ${
        assessment.exposedHouseholdCount === 1 ? 'home' : 'homes'
      } within ${FIRE_SPREAD_RADIUS} m`;

  return {
    ...view,
    detailsHtml: `${view.detailsHtml}
      <li><span>Fire risk</span><span>${riskDetail}</span></li>
      <li><span>Fire response</span><span>${responseDetail}</span></li>
      <li><span>Spread exposure</span><span>${exposureDetail}</span></li>`,
  };
}
