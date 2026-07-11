import type { DbConnection } from '../generated/index.ts';
import { getConnection } from '../network/spacetimedbClient.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import type { BuildingKind, BurgageFrontageEdge } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import {
  parseBuildingServerId,
  parseResidenceServerId,
  parseZoneServerId,
} from './spacetimeIds.ts';

async function callReducer(
  camelName: string,
  snakeName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const connection = getConnection();
  if (!connection) throw new Error('Not connected to SpacetimeDB.');
  const reducers = connection.reducers as unknown as Record<
    string,
    ((payload: Record<string, unknown>) => Promise<void>) | undefined
  >;
  const fn = reducers[camelName] ?? reducers[snakeName];
  if (!fn) {
    throw new Error(`Reducer ${camelName} is missing from generated bindings.`);
  }
  await fn(args);
}

export async function placeBackyardGarden(
  residenceId: string,
  kind: BackyardGardenKind,
): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) {
    throw new Error('Invalid residence id.');
  }
  await callReducer('placeBackyardGarden', 'place_backyard_garden', {
    residenceId: serverId,
    kind,
  });
}

export async function demolishBackyardGarden(residenceId: string): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) {
    throw new Error('Invalid residence id.');
  }
  await callReducer('demolishBackyardGarden', 'demolish_backyard_garden', {
    residenceId: serverId,
  });
}

export async function placeBurgageZone(input: {
  corners: Array<{ x: number; z: number }>;
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
}): Promise<void> {
  const [a, b, c, d] = input.corners;
  await callReducer('placeBurgageZone', 'place_burgage_zone', {
    cornerAx: a.x,
    cornerAz: a.z,
    cornerBx: b.x,
    cornerBz: b.z,
    cornerCx: c.x,
    cornerCz: c.z,
    cornerDx: d.x,
    cornerDz: d.z,
    frontageEdge: input.frontageEdge,
    plotCount: input.plotCount,
  });
}

export async function demolishBurgageZone(zoneId: string): Promise<void> {
  const serverId = parseZoneServerId(zoneId);
  if (serverId === null) {
    throw new Error('Invalid residence zone id.');
  }
  await callReducer('demolishBurgageZone', 'demolish_burgage_zone', { zoneId: serverId });
}

export async function demolishResidence(residenceId: string): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) {
    throw new Error('Invalid residence id.');
  }
  await callReducer('demolishResidence', 'demolish_residence', { residenceId: serverId });
}

export async function placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
  await callReducer('placeBuilding', 'place_building', { kind, x, z });
}

export async function setEconomicActivityTaxRate(taxRate: number): Promise<void> {
  await callReducer('setEconomicActivityTaxRate', 'set_economic_activity_tax_rate', {
    taxRate,
  });
}

export async function setChapelParishPolicy(
  autoSweepEnabled: boolean,
  cofferReserveGold: number,
): Promise<void> {
  await callReducer('setChapelParishPolicy', 'set_chapel_parish_policy', {
    autoSweepEnabled,
    cofferReserveGold,
  });
}

export async function assignBuildingLabor(buildingId: string, labor: number): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) {
    throw new Error('Invalid building id.');
  }
  await callReducer('assignBuildingLabor', 'assign_building_labor', {
    buildingId: serverId,
    labor: Math.max(0, Math.floor(labor)),
  });
}

export async function marketplaceTrade(buildingId: string, tradeId: string): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) {
    throw new Error('Invalid building id.');
  }
  await callReducer('marketplaceTrade', 'marketplace_trade', {
    buildingId: serverId,
    tradeId,
  });
}

export async function collectChapelCoffer(buildingId: string): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) {
    throw new Error('Invalid building id.');
  }
  await callReducer('collectChapelCoffer', 'collect_chapel_coffer', { buildingId: serverId });
}

export async function demolishBuilding(buildingId: string): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) {
    throw new Error('Invalid building id.');
  }
  await callReducer('demolishBuilding', 'demolish_building', { buildingId: serverId });
}

export async function bootstrapWorld(registry: WorldLayoutRegistry): Promise<void> {
  const quarries = registry.definitionList
    .filter((definition) => definition.kind === 'quarry')
    .map((definition) => ({
      quarryId: definition.id,
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
    }));
  const nodes = registry.definitionList
    .filter((definition) => definition.kind === 'game' || definition.kind === 'berries')
    .map((definition) => ({
      nodeId: definition.id,
      nodeKind: definition.kind,
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
      anchorX: definition.x,
      anchorZ: definition.z,
    }));
  await callReducer('bootstrapQuarries', 'bootstrap_quarries', { quarries });
  await callReducer('bootstrapForaging', 'bootstrap_foraging', { nodes });
}

export async function syncRoadNetwork(snapshotJson: string): Promise<void> {
  await callReducer('syncRoadNetwork', 'sync_road_network', { snapshotJson });
}

export function countServerRows(connection: DbConnection, tableName: 'tree_entity' | 'quarry'): number {
  const table = connection.db[tableName];
  return table ? [...table.iter()].length : 0;
}
