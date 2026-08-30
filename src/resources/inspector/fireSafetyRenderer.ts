import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  assessBuildingFireSafety,
  fireRiskBandLabel,
  wellReadinessLabel,
  type FireSafetyAssessment,
} from '../../fires/fireRiskPolicy.ts';
import { FIRE_SPREAD_RADIUS } from '../../generated/gameBalance.ts';
import type { BuildingState } from '../types.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';
import type { InspectorDetailState } from './detailRowPresentation.ts';

export function fireSafetyInspectorState(
  assessment: Pick<FireSafetyAssessment, 'riskBand' | 'coverage'>,
): Exclude<InspectorDetailState, null> {
  if (assessment.riskBand === 'fireproof') return 'positive';
  if (
    assessment.riskBand === 'elevated'
    || assessment.riskBand === 'severe'
  ) {
    return 'danger';
  }
  if (assessment.riskBand === 'standard') return 'warning';
  return assessment.coverage === 'covered' ? 'positive' : 'warning';
}

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
        <li data-inspector-primary data-fire-safety data-inspector-state="positive" data-inspector-detail="This structure cannot ignite, so fire-response well coverage is not required."><span>Fire safety</span><span>Fire-safe · no well required</span></li>`,
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
  const responseDetail = assessment.coverage === 'covered'
    && assessment.responseDistance != null
    && assessment.firstBucketSeconds != null
    ? `Ready · ${Math.round(assessment.responseDistance)} m · ~${Math.ceil(assessment.firstBucketSeconds)}s`
    : assessment.coverage === 'unready'
      ? `Well unready · ${wellReadinessLabel(assessment.nearestWellReadiness)}`
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
  const safetyHelp = `${riskHelp} Fire response shows the nearest usable well's distance and estimated time to first bucket. Green marks low risk with a ready response, yellow marks standard risk or a response gap, and red marks elevated or severe risk.`;
  const safetyState = fireSafetyInspectorState(assessment);

  return {
    ...view,
    detailsHtml: `${view.detailsHtml}
      <li data-inspector-primary data-fire-safety data-inspector-state="${safetyState}" data-inspector-detail="${safetyHelp}"><span>Fire safety</span><span>${riskDetail} · ${responseDetail}</span></li>
      <li data-inspector-secondary data-inspector-detail="${exposureHelp}"><span>Spread exposure</span><span>${exposureDetail}</span></li>`,
  };
}
