export const FIRE_TARGET_KINDS = ['building', 'residence'] as const;
export type FireTargetKind = (typeof FIRE_TARGET_KINDS)[number];

export const FIRE_INCIDENT_STATES = ['burning', 'extinguished', 'destroyed'] as const;
export type FireIncidentStatus = (typeof FIRE_INCIDENT_STATES)[number];

export const FIRE_IGNITION_SOURCES = ['lightning', 'accident', 'spread', 'raid'] as const;
export type FireIgnitionSource = (typeof FIRE_IGNITION_SOURCES)[number];

export type FireIncidentState = {
  id: string;
  targetKind: FireTargetKind;
  targetId: string;
  x: number;
  z: number;
  ignitionSource: FireIgnitionSource;
  status: FireIncidentStatus;
  intensity: number;
  damage: number;
  waterDelivered: number;
  requiredWater: number;
  extinguishChance: number;
  startedTick: number;
  lastWaterTick: number;
  resolvedTick: number;
  responseWellId: string | null;
};

export function fireTargetKindFromId(value: number): FireTargetKind | null {
  return FIRE_TARGET_KINDS[value] ?? null;
}

export function fireStatusFromId(value: number): FireIncidentStatus | null {
  return FIRE_INCIDENT_STATES[value] ?? null;
}

export function fireSourceFromId(value: number): FireIgnitionSource | null {
  return FIRE_IGNITION_SOURCES[value] ?? null;
}

export function activeFireCount(incidents: Iterable<FireIncidentState>): number {
  let count = 0;
  for (const incident of incidents) {
    if (incident.status === 'burning') count++;
  }
  return count;
}

export function fireDisabledBuildingIds(
  incidents: Iterable<FireIncidentState>,
): Set<string> {
  const ids = new Set<string>();
  for (const incident of incidents) {
    if (incident.targetKind === 'building') ids.add(incident.targetId);
  }
  return ids;
}

export function fireForTarget(
  incidents: Iterable<FireIncidentState>,
  targetKind: FireTargetKind,
  targetId: string,
): FireIncidentState | null {
  for (const incident of incidents) {
    if (incident.targetKind === targetKind && incident.targetId === targetId) {
      return incident;
    }
  }
  return null;
}

export function fireSourceLabel(source: FireIgnitionSource): string {
  switch (source) {
    case 'lightning': return 'Lightning strike';
    case 'accident': return 'Hearth or workshop accident';
    case 'spread': return 'Fire spread from a nearby structure';
    case 'raid': return 'Raiders set the holding alight';
  }
}
