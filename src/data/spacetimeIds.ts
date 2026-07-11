export function buildingClientId(serverId: bigint | number): string {
  return `building-${serverId}`;
}

export function zoneClientId(serverId: bigint | number): string {
  return `zone-${serverId}`;
}

export function residenceClientId(serverId: bigint | number): string {
  return `residence-${serverId}`;
}

export function tripClientId(serverId: bigint | number): string {
  return `trip-${serverId}`;
}

export function gardenClientId(serverId: bigint | number): string {
  return `garden-${serverId}`;
}

export function parseBuildingServerId(buildingId: string): bigint | null {
  const match = /^building-(\d+)$/.exec(buildingId);
  if (!match) return null;
  return BigInt(match[1]);
}

export function parseZoneServerId(zoneId: string): bigint | null {
  const match = /^zone-(\d+)$/.exec(zoneId);
  if (!match) return null;
  return BigInt(match[1]);
}

export function parseResidenceServerId(residenceId: string): bigint | null {
  const match = /^residence-(\d+)$/.exec(residenceId);
  if (!match) return null;
  return BigInt(match[1]);
}

export function inferNextBuildingId(buildings: Map<string, { id: string }>): number {
  let maxId = 0;
  for (const building of buildings.values()) {
    const match = /^building-(\d+)$/.exec(building.id);
    if (!match) continue;
    maxId = Math.max(maxId, Number.parseInt(match[1], 10));
  }
  return maxId + 1;
}
