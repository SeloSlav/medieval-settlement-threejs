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
        <li><span>Fire risk</span><span>Fire-safe</span></li>`,
    };
  }

  const storedFuelIncrease = Math.max(
    0,
    Math.round((assessment.storedFuelMultiplier - 1) * 100),
  );
  const riskDetail = `${fireRiskBandLabel(assessment.riskBand)} · ${assessment.currentFlammability.toFixed(2)}×${
    storedFuelIncrease > 0
      ? ` · +${storedFuelIncrease}% fuel`
      : ''
  }`;
  const riskHelp = 'Relative chance of ignition and fire spread. Stored fuel raises the current risk.';
  const inspectWell = assessment.nearestWellId
    ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${assessment.nearestWellId}" aria-label="Inspect fire-response well">Inspect well</button>`
    : '';
  const responseDetail = assessment.coverage === 'covered'
    && assessment.responseDistance != null
    && assessment.firstBucketSeconds != null
    ? `Ready · ${Math.round(assessment.responseDistance)} m · ~${Math.ceil(assessment.firstBucketSeconds)}s${inspectWell}`
    : assessment.coverage === 'unready'
      ? `Well unready · ${wellReadinessLabel(assessment.nearestWellReadiness)}${inspectWell}`
      : `No ready well in range`;
  const exposed = assessment.exposedBuildingCount + assessment.exposedHouseholdCount;
  const exposureDetail = exposed === 0
    ? 'Isolated'
    : `${assessment.exposedBuildingCount} ${
        assessment.exposedBuildingCount === 1 ? 'building' : 'buildings'
      } · ${assessment.exposedHouseholdCount} ${
        assessment.exposedHouseholdCount === 1 ? 'home' : 'homes'
      } nearby`;
  const exposureHelp = `Occupied structures within the ${FIRE_SPREAD_RADIUS} m fire-spread radius.`;
  const responsePlacement = assessment.coverage === 'covered'
    ? ' data-inspector-secondary'
    : '';

  return {
    ...view,
    detailsHtml: `${view.detailsHtml}
      <li data-inspector-detail="${riskHelp}"><span>Fire risk</span><span>${riskDetail}</span></li>
      <li${responsePlacement} data-inspector-detail="Distance and estimated time for the first bucket from the nearest usable well."><span>Fire response</span><span>${responseDetail}</span></li>
      <li data-inspector-detail="${exposureHelp}"><span>Spread exposure</span><span>${exposureDetail}</span></li>`,
  };
}
