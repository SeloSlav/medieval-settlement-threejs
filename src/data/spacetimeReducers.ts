import type { DbConnection } from '../generated/index.ts';
import { getConnection } from '../network/spacetimedbClient.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import type {
  BuildingKind,
  BurgageFrontageEdge,
  FarmCrop,
  LivestockSpecies,
} from '../resources/types.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import { computeWorldBootstrapDataFromLayout } from '../world/worldBootstrapData.ts';
import { settingsToConfigurePayload } from '../world/worldConfigAuthority.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import {
  parseBuildingServerId,
  parseFarmFieldServerId,
  parsePastureServerId,
  parseResidenceServerId,
  parseZoneServerId,
} from './spacetimeIds.ts';

function formatReducerError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (typeof record.value === 'string' && record.value.trim()) {
      return record.value;
    }
  }
  return fallback;
}

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
  try {
    await fn(args);
  } catch (error) {
    throw new Error(formatReducerError(error, `Reducer ${camelName} failed.`));
  }
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

export async function upgradeResidence(residenceId: string): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) throw new Error('Invalid residence id.');
  await callReducer('upgradeResidence', 'upgrade_residence', { residenceId: serverId });
}

export async function placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
  await callReducer('placeBuilding', 'place_building', { kind, x, z });
}

export async function grantCheatResources(amount: number): Promise<void> {
  await callReducer('grantCheatResources', 'grant_cheat_resources', { amount });
}

const cropId = (crop: FarmCrop): number => crop === 'oats' ? 1 : crop === 'fallow' ? 2 : 0;

export async function placeFarmField(input: {
  farmsteadId: string;
  corners: Array<{ x: number; z: number }>;
  crop: FarmCrop;
  averageSlopeDegrees: number;
}): Promise<void> {
  const farmsteadId = parseBuildingServerId(input.farmsteadId);
  if (farmsteadId === null || input.corners.length !== 4) {
    throw new Error('Invalid farm field placement.');
  }
  const [a, b, c, d] = input.corners;
  await callReducer('placeFarmField', 'place_farm_field', {
    farmsteadId,
    cornerAx: a.x, cornerAz: a.z,
    cornerBx: b.x, cornerBz: b.z,
    cornerCx: c.x, cornerCz: c.z,
    cornerDx: d.x, cornerDz: d.z,
    crop: cropId(input.crop),
    averageSlopeDegrees: input.averageSlopeDegrees,
  });
}

export async function setFarmFieldCrop(fieldId: string, crop: FarmCrop): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('setFarmFieldCrop', 'set_farm_field_crop', { fieldId: serverId, crop: cropId(crop) });
}

export async function setFarmFieldPriority(fieldId: string, priority: number): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('setFarmFieldPriority', 'set_farm_field_priority', {
    fieldId: serverId,
    priority: Math.max(0, Math.min(3, Math.floor(priority))),
  });
}

export async function demolishFarmField(fieldId: string): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('demolishFarmField', 'demolish_farm_field', { fieldId: serverId });
}

export async function placePasture(input: {
  farmsteadId: string;
  corners: Array<{ x: number; z: number }>;
  averageSlopeDegrees: number;
}): Promise<void> {
  const farmsteadId = parseBuildingServerId(input.farmsteadId);
  if (farmsteadId === null || input.corners.length !== 4) {
    throw new Error('Invalid pasture placement.');
  }
  const [a, b, c, d] = input.corners;
  await callReducer('placePasture', 'place_pasture', {
    farmsteadId,
    cornerAx: a.x,
    cornerAz: a.z,
    cornerBx: b.x,
    cornerBz: b.z,
    cornerCx: c.x,
    cornerCz: c.z,
    cornerDx: d.x,
    cornerDz: d.z,
    averageSlopeDegrees: input.averageSlopeDegrees,
  });
}

export async function demolishPasture(pastureId: string): Promise<void> {
  const serverId = parsePastureServerId(pastureId);
  if (serverId === null) throw new Error('Invalid pasture id.');
  await callReducer('demolishPasture', 'demolish_pasture', { pastureId: serverId });
}

export async function setLivestockSpecies(
  buildingId: string,
  species: Exclude<LivestockSpecies, 'swine'>,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid pastoral farmstead id.');
  await callReducer('setLivestockSpecies', 'set_livestock_species', {
    buildingId: serverId,
    species: species === 'sheep' ? 1 : 0,
  });
}

export async function setEconomicActivityTaxRate(taxRate: number): Promise<void> {
  await callReducer('setEconomicActivityTaxRate', 'set_economic_activity_tax_rate', {
    taxRate,
  });
}

export async function setChapelParishPolicy(
  autoSweepEnabled: boolean,
  cofferReserveGold: number,
  sabbathObservanceEnabled: boolean,
): Promise<void> {
  await callReducer('setChapelParishPolicy', 'set_chapel_parish_policy', {
    autoSweepEnabled,
    cofferReserveGold,
    sabbathObservanceEnabled,
  });
}

export async function setMonasteryPolicy(
  titheShare: number,
  feastsEnabled: boolean,
): Promise<void> {
  await callReducer('setMonasteryPolicy', 'set_monastery_policy', {
    titheShare,
    feastsEnabled,
  });
}

export async function setStorehousePolicy(
  buildingId: string,
  acceptsTimber: boolean,
  acceptsStone: boolean,
  acceptsFirewood: boolean,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village storehouse id.');
  await callReducer('setStorehousePolicy', 'set_storehouse_policy', {
    buildingId: serverId,
    acceptsTimber,
    acceptsStone,
    acceptsFirewood,
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

export async function resetWorld(): Promise<void> {
  await callReducer('resetWorld', 'reset_world', {});
}

export async function configureWorld(settings: WorldGenerationSettings): Promise<void> {
  await callReducer('configureWorld', 'configure_world', settingsToConfigurePayload(settings));
}

export async function bootstrapWorld(
  registry: WorldLayoutRegistry,
  worldLayout: WorldLayout,
): Promise<void> {
  const bootstrap = computeWorldBootstrapDataFromLayout(worldLayout);
  const quarries = bootstrap.quarries.length > 0
    ? bootstrap.quarries
    : registry.definitionList
      .filter((definition) => definition.kind === 'quarry')
      .map((definition) => ({
        quarryId: definition.id,
        x: definition.x,
        z: definition.z,
        maxYield: definition.maxYield,
      }));
  const nodes = bootstrap.foragingNodes.length > 0
    ? bootstrap.foragingNodes.map((node) => ({
      nodeId: node.nodeId,
      nodeKind: node.nodeKind,
      x: node.x,
      z: node.z,
      maxYield: node.maxYield,
      anchorX: node.anchorX,
      anchorZ: node.anchorZ,
    }))
    : registry.definitionList
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
  const trees = bootstrap.trees.map((tree) => ({
    treeId: tree.treeId,
    layoutIndex: tree.layoutIndex,
    x: tree.x,
    z: tree.z,
    woodYield: tree.woodYield,
  }));
  await callReducer('bootstrapQuarries', 'bootstrap_quarries', { quarries });
  await callReducer('bootstrapForaging', 'bootstrap_foraging', { nodes });
  await callReducer('bootstrapTrees', 'bootstrap_trees', { trees });
}

export async function syncRoadNetwork(snapshotJson: string): Promise<void> {
  await callReducer('syncRoadNetwork', 'sync_road_network', { snapshotJson });
}

export function countServerRows(connection: DbConnection, tableName: 'tree_entity' | 'quarry'): number {
  const table = connection.db[tableName];
  return table ? [...table.iter()].length : 0;
}
