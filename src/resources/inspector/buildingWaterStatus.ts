import type { BuildingState } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';

export type WellWaterAssessment = {
  required: number;
  connectedWells: BuildingState[];
  wellsWithWater: number;
  hasLinkedWell: boolean;
  hasWaterAvailable: boolean;
  storedWater: number;
  inboundWater: boolean;
  wellSummary: string;
};

export function assessWellWaterSupply(
  building: BuildingState,
  worldQueries: WorldQueries,
  requiredPerCycle: number,
): WellWaterAssessment | null {
  if (requiredPerCycle <= 0) return null;

  const connectedWells = worldQueries.getRoadConnectedWells(building);
  const wellsWithWater = connectedWells.filter((well) => well.water > 0).length;
  const inboundWater = worldQueries.getInboundSupplyTrip(building)?.cargoKind === 'water';
  const storedWater = Math.max(0, building.water);
  const nearestWell = connectedWells[0];
  const nearestWellDistance = nearestWell
    ? worldQueries.getLocalDeliveryDistance(building.x, building.z, nearestWell.x, nearestWell.z)
    : null;
  const drySuffix = connectedWells.length > 0 && wellsWithWater === 0 ? ', all dry' : '';
  const wellSummary = connectedWells.length === 0
    ? 'None staffed — build a well or assign its crew'
    : `${connectedWells.length} available${nearestWellDistance != null ? ` (nearest ${nearestWellDistance.toFixed(0)} m travel equivalent)` : ''}${drySuffix}`;

  return {
    required: requiredPerCycle,
    connectedWells,
    wellsWithWater,
    hasLinkedWell: connectedWells.length > 0,
    hasWaterAvailable: storedWater + 1e-6 >= requiredPerCycle,
    storedWater,
    inboundWater,
    wellSummary,
  };
}

export function formatWellWaterDetailRows(
  assessment: WellWaterAssessment | null,
  noneLabel?: string,
): string {
  if (!assessment) {
    return noneLabel ? `<li><span>Water use</span><span>${noneLabel}</span></li>` : '';
  }
  const inboundLabel = assessment.inboundWater ? ' · cart inbound' : '';
  return `<li><span>Supplying wells</span><span>${assessment.wellSummary}</span></li><li><span>Stored water</span><span>${assessment.storedWater.toFixed(1)} / ${assessment.required} needed${inboundLabel}</span></li><li><span>Water per cycle</span><span>${assessment.required}</span></li>`;
}

export function wellWaterStatusIssue(assessment: WellWaterAssessment | null): string | null {
  if (!assessment) return null;
  if (!assessment.hasLinkedWell) {
    return 'Idle — needs a staffed well to operate';
  }
  if (assessment.hasWaterAvailable) {
    return null;
  }
  if (assessment.inboundWater) {
    return `Water cart inbound — ${assessment.storedWater.toFixed(1)} / ${assessment.required} stored`;
  }
  if (assessment.wellsWithWater > 0) {
    return `Waiting for well cart — ${assessment.storedWater.toFixed(1)} / ${assessment.required} stored`;
  }
  return `Waiting for water — all linked wells are dry (${assessment.required} needed)`;
}
