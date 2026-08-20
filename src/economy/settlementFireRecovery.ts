import { fireDisabledBuildingIds, type FireIncidentState } from '../fires/fireIncident.ts';
import {
  buildingFireRecoveryQuote,
  fireRecoveryCoolingSeconds,
  residenceFireRecoveryQuote,
  type FireRecoveryQuote,
} from '../fires/fireRecovery.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import {
  CONSTRUCTION_PRIORITY_NORMAL,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../logistics/constructionPriority.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';

type RoadPoint = { x: number; z: number };

export type SettlementFireRecoveryTarget = {
  targetKind: FireIncidentState['targetKind'];
  targetId: string;
  buildingKind: BuildingKind | null;
  residenceParcelIndex: number | null;
  status: FireIncidentState['status'];
  intensity: number;
  damage: number;
  responseWellId: string | null;
  coolingSeconds: number;
  recovery: FireRecoveryQuote;
  recoveryActive: boolean;
  workPriority: ConstructionPriority;
  affectedPeopleOrWorkers: number;
};

export type SettlementFireRecoveryPlan = {
  incidentCount: number;
  burningCount: number;
  respondedBurningCount: number;
  unrespondedBurningCount: number;
  responseWaterRemaining: number;
  extinguishedCount: number;
  destroyedCount: number;
  activeRecoveryCount: number;
  readyRecoveryCount: number;
  coolingRecoveryCount: number;
  buildingOutages: number;
  residenceOutages: number;
  suspendedWorkers: number;
  affectedResidents: number;
  offlineHousingCapacity: number;
  carpenterSupportedTargets: number;
  estimatedTimberCost: number;
  estimatedStoneCost: number;
  estimatedIronworkCost: number;
  readyTimberCost: number;
  readyStoneCost: number;
  readyIronworkCost: number;
  timberShortfall: number;
  stoneShortfall: number;
  ironworkShortfall: number;
  missingTargetCount: number;
  firstActiveTarget: SettlementFireRecoveryTarget | null;
  firstRecoveryTarget: SettlementFireRecoveryTarget | null;
};

export type SettlementFireRecoveryInput = {
  state: Pick<
    GameState,
    'tick' | 'buildings' | 'residences' | 'fireIncidents'
  >;
  resources: Pick<ResourceTotals, 'timber' | 'stone' | 'ironwork'>;
  roadComponentIdsFor?: (target: RoadPoint) => readonly number[];
  hasCarpenterSupportAt?: (target: RoadPoint) => boolean;
  scriptoriumRecoveryMultiplierAt?: (target: RoadPoint) => number;
};

export function computeSettlementFireRecoveryPlan(
  input: SettlementFireRecoveryInput,
): SettlementFireRecoveryPlan {
  const incidents = [...input.state.fireIncidents.values()];
  const plan: SettlementFireRecoveryPlan = {
    incidentCount: incidents.length,
    burningCount: 0,
    respondedBurningCount: 0,
    unrespondedBurningCount: 0,
    responseWaterRemaining: 0,
    extinguishedCount: 0,
    destroyedCount: 0,
    activeRecoveryCount: 0,
    readyRecoveryCount: 0,
    coolingRecoveryCount: 0,
    buildingOutages: 0,
    residenceOutages: 0,
    suspendedWorkers: 0,
    affectedResidents: 0,
    offlineHousingCapacity: 0,
    carpenterSupportedTargets: 0,
    estimatedTimberCost: 0,
    estimatedStoneCost: 0,
    estimatedIronworkCost: 0,
    readyTimberCost: 0,
    readyStoneCost: 0,
    readyIronworkCost: 0,
    timberShortfall: 0,
    stoneShortfall: 0,
    ironworkShortfall: 0,
    missingTargetCount: 0,
    firstActiveTarget: null,
    firstRecoveryTarget: null,
  };
  if (incidents.length === 0) return plan;

  const fireDisabled = fireDisabledBuildingIds(incidents);
  const carpenterComponents = operationalCarpenterComponents(
    input.state.buildings.values(),
    fireDisabled,
    input.roadComponentIdsFor,
  );

  for (const incident of incidents) {
    const target = resolveTarget(input, incident);
    if (target === null) {
      plan.missingTargetCount += 1;
      continue;
    }
    const carpenterSupported = targetHasCarpenterSupport(
      incident,
      carpenterComponents,
      input,
    );
    const scriptoriumRecoveryMultiplier = input.scriptoriumRecoveryMultiplierAt?.(incident) ?? 1;
    const recovery = target.kind === 'building'
      ? buildingFireRecoveryQuote(
          target.building,
          incident,
          carpenterSupported,
          scriptoriumRecoveryMultiplier,
        )
      : residenceFireRecoveryQuote(
          target.residence,
          incident,
          carpenterSupported,
          scriptoriumRecoveryMultiplier,
        );
    const coolingSeconds = fireRecoveryCoolingSeconds(incident, input.state.tick);
    const summary: SettlementFireRecoveryTarget = {
      targetKind: incident.targetKind,
      targetId: incident.targetId,
      buildingKind: target.building?.kind ?? null,
      residenceParcelIndex: target.residence?.parcelIndex ?? null,
      status: incident.status,
      intensity: Math.max(0, incident.intensity),
      damage: Math.max(0, incident.damage),
      responseWellId: incident.responseWellId,
      coolingSeconds,
      recovery,
      recoveryActive: target.kind === 'residence'
        && target.residence.fireRepairActive === true,
      workPriority: target.kind === 'building'
        ? CONSTRUCTION_PRIORITY_NORMAL
        : normalizeConstructionPriority(target.residence.upgradePriority),
      affectedPeopleOrWorkers: target.kind === 'building'
        ? Math.max(0, target.building.assignedLabor)
        : Math.max(0, target.residence.population),
    };

    if (!summary.recoveryActive) {
      plan.estimatedTimberCost += recovery.cost.timber;
      plan.estimatedStoneCost += recovery.cost.stone;
      plan.estimatedIronworkCost += recovery.cost.ironwork ?? 0;
    }
    if (carpenterSupported) plan.carpenterSupportedTargets += 1;
    if (target.kind === 'building') {
      plan.buildingOutages += 1;
      plan.suspendedWorkers += Math.max(0, target.building.assignedLabor);
    } else {
      plan.residenceOutages += 1;
      plan.affectedResidents += Math.max(0, target.residence.population);
      plan.offlineHousingCapacity += Math.max(0, target.residence.populationCapacity);
    }

    if (incident.status === 'burning') {
      plan.burningCount += 1;
      plan.responseWaterRemaining += Math.max(
        0,
        incident.requiredWater - incident.waterDelivered,
      );
      if (incident.responseWellId === null) {
        plan.unrespondedBurningCount += 1;
      } else {
        plan.respondedBurningCount += 1;
      }
      if (shouldReplaceActiveTarget(summary, plan.firstActiveTarget)) {
        plan.firstActiveTarget = summary;
      }
      continue;
    }

    if (incident.status === 'destroyed') {
      plan.destroyedCount += 1;
    } else {
      plan.extinguishedCount += 1;
    }
    if (summary.recoveryActive) {
      plan.activeRecoveryCount += 1;
      if (shouldReplaceRecoveryTarget(summary, plan.firstRecoveryTarget)) {
        plan.firstRecoveryTarget = summary;
      }
      continue;
    }
    if (coolingSeconds <= 1e-6) {
      plan.readyRecoveryCount += 1;
      plan.readyTimberCost += recovery.cost.timber;
      plan.readyStoneCost += recovery.cost.stone;
      plan.readyIronworkCost += recovery.cost.ironwork ?? 0;
    } else {
      plan.coolingRecoveryCount += 1;
    }
    if (shouldReplaceRecoveryTarget(summary, plan.firstRecoveryTarget)) {
      plan.firstRecoveryTarget = summary;
    }
  }

  plan.timberShortfall = Math.max(
    0,
    plan.estimatedTimberCost - Math.max(0, input.resources.timber),
  );
  plan.stoneShortfall = Math.max(
    0,
    plan.estimatedStoneCost - Math.max(0, input.resources.stone),
  );
  plan.ironworkShortfall = Math.max(
    0,
    plan.estimatedIronworkCost - Math.max(0, input.resources.ironwork),
  );
  return plan;
}

function resolveTarget(
  input: SettlementFireRecoveryInput,
  incident: FireIncidentState,
): {
  kind: 'building';
  building: BuildingState;
  residence: null;
} | {
  kind: 'residence';
  building: null;
  residence: ResidenceState;
} | null {
  if (incident.targetKind === 'building') {
    const building = input.state.buildings.get(incident.targetId);
    return building ? { kind: 'building', building, residence: null } : null;
  }
  const residence = input.state.residences.get(incident.targetId);
  return residence ? { kind: 'residence', building: null, residence } : null;
}

function operationalCarpenterComponents(
  buildings: Iterable<BuildingState>,
  fireDisabled: ReadonlySet<string>,
  roadComponentIdsFor: SettlementFireRecoveryInput['roadComponentIdsFor'],
): ReadonlySet<number> | null {
  if (!roadComponentIdsFor) return null;
  const components = new Set<number>();
  for (const building of buildings) {
    if (
      building.kind !== 'carpenter'
      || building.constructionComplete === false
      || building.assignedLabor <= 0
      || fireDisabled.has(building.id)
    ) continue;
    for (const component of roadComponentIdsFor(building)) {
      components.add(component);
    }
  }
  return components;
}

function targetHasCarpenterSupport(
  target: RoadPoint,
  carpenterComponents: ReadonlySet<number> | null,
  input: SettlementFireRecoveryInput,
): boolean {
  if (carpenterComponents !== null && input.roadComponentIdsFor) {
    for (const component of input.roadComponentIdsFor(target)) {
      if (carpenterComponents.has(component)) return true;
    }
    return false;
  }
  return input.hasCarpenterSupportAt?.(target) ?? false;
}

function shouldReplaceActiveTarget(
  candidate: SettlementFireRecoveryTarget,
  current: SettlementFireRecoveryTarget | null,
): boolean {
  if (current === null) return true;
  const candidateUnanswered = candidate.responseWellId === null;
  const currentUnanswered = current.responseWellId === null;
  if (candidateUnanswered !== currentUnanswered) return candidateUnanswered;
  if (candidate.intensity !== current.intensity) {
    return candidate.intensity > current.intensity;
  }
  if (candidate.damage !== current.damage) return candidate.damage > current.damage;
  if (candidate.affectedPeopleOrWorkers !== current.affectedPeopleOrWorkers) {
    return candidate.affectedPeopleOrWorkers > current.affectedPeopleOrWorkers;
  }
  return compareTargetIds(candidate, current) < 0;
}

function shouldReplaceRecoveryTarget(
  candidate: SettlementFireRecoveryTarget,
  current: SettlementFireRecoveryTarget | null,
): boolean {
  if (current === null) return true;
  if (candidate.recoveryActive !== current.recoveryActive) {
    return candidate.recoveryActive;
  }
  const candidateReady = candidate.coolingSeconds <= 1e-6;
  const currentReady = current.coolingSeconds <= 1e-6;
  if (candidateReady !== currentReady) return candidateReady;
  if (!candidateReady && candidate.coolingSeconds !== current.coolingSeconds) {
    return candidate.coolingSeconds < current.coolingSeconds;
  }
  if (candidate.workPriority !== current.workPriority) {
    return candidate.workPriority > current.workPriority;
  }
  if (candidate.affectedPeopleOrWorkers !== current.affectedPeopleOrWorkers) {
    return candidate.affectedPeopleOrWorkers > current.affectedPeopleOrWorkers;
  }
  const candidateDestroyed = candidate.status === 'destroyed';
  const currentDestroyed = current.status === 'destroyed';
  if (candidateDestroyed !== currentDestroyed) return candidateDestroyed;
  if (candidate.damage !== current.damage) return candidate.damage > current.damage;
  return compareTargetIds(candidate, current) < 0;
}

function compareTargetIds(
  left: SettlementFireRecoveryTarget,
  right: SettlementFireRecoveryTarget,
): number {
  const idOrder = compareStableEntityIds(left.targetId, right.targetId);
  if (idOrder !== 0) return idOrder;
  return left.targetKind.localeCompare(right.targetKind);
}
