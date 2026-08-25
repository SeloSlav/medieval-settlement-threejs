export function buildingClientId(serverId: bigint | number): string {
  return `building-${serverId}`;
}

export function zoneClientId(serverId: bigint | number): string {
  return `zone-${serverId}`;
}

export function residenceClientId(serverId: bigint | number): string {
  return `residence-${serverId}`;
}

export function settlementClientId(serverId: bigint | number): string {
  return `settlement-${serverId}`;
}

export function parseSettlementServerId(settlementId: string): bigint | null {
  const match = /^settlement-(\d+)$/.exec(settlementId);
  return match ? BigInt(match[1]) : null;
}

export function tripClientId(serverId: bigint | number): string {
  return `trip-${serverId}`;
}

export function fireIncidentClientId(serverId: bigint | number): string {
  return `fire-${serverId}`;
}

export function gardenClientId(serverId: bigint | number): string {
  return `garden-${serverId}`;
}

export function farmFieldClientId(serverId: bigint | number): string {
  return `farm-field-${serverId}`;
}

export function pastureClientId(serverId: bigint | number): string {
  return `pasture-${serverId}`;
}

export function vineyardClientId(serverId: bigint | number): string {
  return `vineyard-${serverId}`;
}

export function graveyardClientId(serverId: bigint | number): string {
  return `graveyard-${serverId}`;
}

export function corpseClientId(serverId: bigint | number): string {
  return `corpse-${serverId}`;
}

export function stableOxClientId(serverId: bigint | number): string {
  return `stable-ox-${serverId}`;
}

export function parseStableOxServerId(stableOxId: string): bigint | null {
  const match = /^stable-ox-(\d+)$/.exec(stableOxId);
  return match ? BigInt(match[1]) : null;
}

export function parsePastureServerId(pastureId: string): bigint | null {
  const match = /^pasture-(\d+)$/.exec(pastureId);
  return match ? BigInt(match[1]) : null;
}

export function parseGraveyardServerId(graveyardId: string): bigint | null {
  const match = /^graveyard-(\d+)$/.exec(graveyardId);
  return match ? BigInt(match[1]) : null;
}

export function parseFarmFieldServerId(fieldId: string): bigint | null {
  const match = /^farm-field-(\d+)$/.exec(fieldId);
  return match ? BigInt(match[1]) : null;
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
