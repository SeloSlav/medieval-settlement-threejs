import type { DbConnection } from '../generated/index.ts';
import { FARM_CROP_DEFINITIONS } from '../generated/gameBalance.ts';
import { getConnection } from '../network/spacetimedbClient.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import type { FireTargetKind } from '../fires/fireIncident.ts';
import type {
  BuildingKind,
  BurgageFrontageEdge,
  FarmCrop,
  LivestockSpecies,
} from '../resources/types.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import {
  computeWorldBootstrapDataFromLayout,
  selectFoundingSite,
} from '../world/worldBootstrapData.ts';
import { settingsToConfigurePayload } from '../world/worldConfigAuthority.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import type { StorehouseCommodity } from '../economy/storehousePolicy.ts';
import { normalizeLaborStewardReserve } from '../economy/laborSteward.ts';
import type { NightPolicyCode } from '../economy/nightPolicy.ts';
import {
  parseBuildingServerId,
  parseFarmFieldServerId,
  parseGraveyardServerId,
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

export async function retrofitResidenceTileRoof(residenceId: string): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) throw new Error('Invalid residence id.');
  await callReducer(
    'retrofitResidenceTileRoof',
    'retrofit_residence_tile_roof',
    { residenceId: serverId },
  );
}

export async function repairResidenceDecay(residenceId: string): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) throw new Error('Invalid residence id.');
  await callReducer('repairResidenceDecay', 'repair_residence_decay', {
    residenceId: serverId,
  });
}

export async function setResidenceUpgradePriority(
  residenceId: string,
  priority: number,
): Promise<void> {
  const serverId = parseResidenceServerId(residenceId);
  if (serverId === null) throw new Error('Invalid residence id.');
  await callReducer(
    'setResidenceUpgradePriority',
    'set_residence_upgrade_priority',
    {
      residenceId: serverId,
      priority: Math.max(0, Math.min(3, Math.floor(priority))),
    },
  );
}

export async function repairFireDamage(
  targetKind: FireTargetKind,
  targetId: string,
): Promise<void> {
  const serverId = targetKind === 'building'
    ? parseBuildingServerId(targetId)
    : parseResidenceServerId(targetId);
  if (serverId === null) throw new Error('Invalid fire-damaged structure id.');
  await callReducer('repairFireDamage', 'repair_fire_damage', {
    targetKind: targetKind === 'building' ? 0 : 1,
    targetId: serverId,
  });
}

export async function placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
  await callReducer('placeBuilding', 'place_building', { kind, x, z });
}

export async function grantCheatResources(amount: number): Promise<void> {
  await callReducer('grantCheatResources', 'grant_cheat_resources', { amount });
}

const cropId = (crop: FarmCrop): number => FARM_CROP_DEFINITIONS[crop].id;

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

export async function setFarmFieldFollowingCrop(
  fieldId: string,
  crop: FarmCrop | null,
): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('setFarmFieldFollowingCrop', 'set_farm_field_following_crop', {
    fieldId: serverId,
    crop: crop === null ? 255 : cropId(crop),
  });
}

export async function setFarmFieldPriority(fieldId: string, priority: number): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('setFarmFieldPriority', 'set_farm_field_priority', {
    fieldId: serverId,
    priority: Math.max(0, Math.min(3, Math.floor(priority))),
  });
}

export async function startFarmFieldEarlyHarvest(fieldId: string): Promise<void> {
  const serverId = parseFarmFieldServerId(fieldId);
  if (serverId === null) throw new Error('Invalid farm field id.');
  await callReducer('startFarmFieldEarlyHarvest', 'start_farm_field_early_harvest', {
    fieldId: serverId,
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

export async function setLivestockBreedingReserve(
  buildingId: string,
  breedingReserve: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid livestock holding id.');
  await callReducer('setLivestockBreedingReserve', 'set_livestock_breeding_reserve', {
    buildingId: serverId,
    breedingReserve: Math.max(0, Math.floor(breedingReserve)),
  });
}

export async function setLivestockHaymakingPercent(
  buildingId: string,
  haymakingPercent: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid pastoral farmstead id.');
  await callReducer('setLivestockHaymakingPercent', 'set_livestock_haymaking_percent', {
    buildingId: serverId,
    haymakingPercent: Math.max(0, Math.floor(haymakingPercent)),
  });
}

export async function setEconomicActivityTaxRate(taxRate: number): Promise<void> {
  await callReducer('setEconomicActivityTaxRate', 'set_economic_activity_tax_rate', {
    taxRate,
  });
}

export async function setSeasonalLaborSteward(enabled: boolean): Promise<void> {
  await callReducer('setSeasonalLaborSteward', 'set_seasonal_labor_steward', {
    enabled,
  });
}

export async function setConstructionLaborSteward(enabled: boolean): Promise<void> {
  await callReducer('setConstructionLaborSteward', 'set_construction_labor_steward', {
    enabled,
  });
}

export async function placeGraveyard(input: {
  chapelId: string;
  corners: Array<{ x: number; z: number }>;
  averageSlopeDegrees: number;
}): Promise<void> {
  const chapelId = parseBuildingServerId(input.chapelId);
  if (chapelId === null || input.corners.length !== 4) {
    throw new Error('Invalid graveyard placement.');
  }
  const [a, b, c, d] = input.corners;
  await callReducer('placeGraveyard', 'place_graveyard', {
    chapelId,
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

export async function demolishGraveyard(graveyardId: string): Promise<void> {
  const serverId = parseGraveyardServerId(graveyardId);
  if (serverId === null) throw new Error('Invalid graveyard id.');
  await callReducer('demolishGraveyard', 'demolish_graveyard', {
    graveyardId: serverId,
  });
}

export async function setProductionLaborSteward(enabled: boolean): Promise<void> {
  await callReducer('setProductionLaborSteward', 'set_production_labor_steward', {
    enabled,
  });
}

export async function setLaborStewardReserve(laborReserve: number): Promise<void> {
  await callReducer('setLaborStewardReserve', 'set_labor_steward_reserve', {
    laborReserve: normalizeLaborStewardReserve(laborReserve),
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
  acceptsIron: boolean,
  acceptsClay: boolean,
  acceptsSalt: boolean,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village storehouse id.');
  await callReducer('setStorehousePolicy', 'set_storehouse_policy', {
    buildingId: serverId,
    acceptsTimber,
    acceptsStone,
    acceptsFirewood,
    acceptsIron,
    acceptsClay,
    acceptsSalt,
  });
}

export async function placeRemoteWorkCamp(
  worksiteId: string,
  x: number,
  z: number,
): Promise<void> {
  const serverId = parseBuildingServerId(worksiteId);
  if (serverId === null) throw new Error('Invalid rural worksite id.');
  await callReducer('placeRemoteWorkCamp', 'place_remote_work_camp', {
    worksiteId: serverId,
    x,
    z,
  });
}

export async function setStorehouseStockTarget(
  buildingId: string,
  commodity: StorehouseCommodity,
  targetPercent: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village storehouse id.');
  await callReducer('setStorehouseStockTarget', 'set_storehouse_stock_target', {
    buildingId: serverId,
    commodity,
    targetPercent,
  });
}

export async function setProcessorOutputTarget(
  buildingId: string,
  targetPercent: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid production site id.');
  await callReducer('setProcessorOutputTarget', 'set_processor_output_target', {
    buildingId: serverId,
    targetPercent,
  });
}

export async function setNightPolicies(
  watch: NightPolicyCode,
  gathering: NightPolicyCode,
  work: NightPolicyCode,
  lighting: NightPolicyCode,
  curfew: NightPolicyCode,
): Promise<void> {
  await callReducer('setNightPolicies', 'set_night_policies', {
    watchPolicy: watch,
    gatheringPolicy: gathering,
    workPolicy: work,
    lightingPolicy: lighting,
    curfewPolicy: curfew,
  });
}

export async function setWeaverInputPolicy(
  buildingId: string,
  inputPolicy: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid weaver workshop id.');
  await callReducer('setWeaverInputPolicy', 'set_weaver_input_policy', {
    buildingId: serverId,
    inputPolicy,
  });
}

export async function setPotteryDispatchPolicy(
  buildingId: string,
  dispatchPolicy: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid potter kiln id.');
  await callReducer('setPotteryDispatchPolicy', 'set_pottery_dispatch_policy', {
    buildingId: serverId,
    dispatchPolicy,
  });
}

export async function setPotterFiringPolicy(
  buildingId: string,
  firingPolicy: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid potter kiln id.');
  await callReducer('setPotterFiringPolicy', 'set_potter_firing_policy', {
    buildingId: serverId,
    firingPolicy,
  });
}

export async function setGranaryPolicy(
  buildingId: string,
  acceptsFreshFood: boolean,
  householdsFirst: boolean,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village granary id.');
  await callReducer('setGranaryPolicy', 'set_granary_policy', {
    buildingId: serverId,
    acceptsFreshFood,
    householdsFirst,
  });
}

export async function setGranaryGrainReserve(
  buildingId: string,
  grainReserve: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village granary id.');
  await callReducer('setGranaryGrainReserve', 'set_granary_grain_reserve', {
    buildingId: serverId,
    grainReserve,
  });
}

export async function setGranaryFreshFoodTarget(
  buildingId: string,
  targetPercent: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid village granary id.');
  await callReducer('setGranaryFreshFoodTarget', 'set_granary_fresh_food_target', {
    buildingId: serverId,
    targetPercent,
  });
}

export async function setWoodcutterTimberReserve(
  buildingId: string,
  timberReserve: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error("Invalid woodcutter's lodge id.");
  await callReducer('setWoodcutterTimberReserve', 'set_woodcutter_timber_reserve', {
    buildingId: serverId,
    timberReserve,
  });
}

export async function setCarpenterPolearmReserve(
  buildingId: string,
  polearmReserve: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid carpenter workshop id.');
  await callReducer('setCarpenterPolearmReserve', 'set_carpenter_polearm_reserve', {
    buildingId: serverId,
    polearmReserve: Math.max(0, Math.floor(polearmReserve)),
  });
}

export async function setCarpenterCartServiceTarget(
  buildingId: string,
  targetTrips: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid carpenter workshop id.');
  await callReducer(
    'setCarpenterCartServiceTarget',
    'set_carpenter_cart_service_target',
    {
      buildingId: serverId,
      targetTrips: Math.max(0, Math.floor(targetTrips)),
    },
  );
}

export async function setGuardhousePayPriority(
  buildingId: string,
  payPriority: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid guardhouse id.');
  await callReducer('setGuardhousePayPriority', 'set_guardhouse_pay_priority', {
    buildingId: serverId,
    payPriority: Math.max(0, Math.min(2, Math.floor(payPriority))),
  });
}

export async function setGuardhouseFoodReserve(
  buildingId: string,
  reservePerGuard: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid guardhouse id.');
  await callReducer('setGuardhouseFoodReserve', 'set_guardhouse_food_reserve', {
    buildingId: serverId,
    reservePerGuard: Math.max(0, Math.min(12, Math.floor(reservePerGuard))),
  });
}

export async function setGuardhouseMusterPost(
  buildingId: string,
  watchtowerId: string | null,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid guardhouse id.');
  const serverWatchtowerId = watchtowerId === null
    ? 0n
    : parseBuildingServerId(watchtowerId);
  if (serverWatchtowerId === null) throw new Error('Invalid watchtower id.');
  await callReducer('setGuardhouseMusterPost', 'set_guardhouse_muster_post', {
    buildingId: serverId,
    watchtowerId: serverWatchtowerId,
  });
}

export async function setMarketplaceIronworkTarget(
  buildingId: string,
  ironworkTarget: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer('setMarketplaceIronworkTarget', 'set_marketplace_ironwork_target', {
    buildingId: serverId,
    ironworkTarget: Math.max(0, Math.min(48, Math.floor(ironworkTarget))),
  });
}

export async function setMarketplaceIronTarget(
  buildingId: string,
  ironTarget: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer('setMarketplaceIronTarget', 'set_marketplace_iron_target', {
    buildingId: serverId,
    ironTarget: Math.max(0, Math.min(48, Math.floor(ironTarget))),
  });
}

export async function setMarketplaceSaltTarget(
  buildingId: string,
  saltTarget: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer('setMarketplaceSaltTarget', 'set_marketplace_salt_target', {
    buildingId: serverId,
    saltTarget: Math.max(0, Math.min(72, Math.floor(saltTarget))),
  });
}

export async function setMarketplaceGoldReserveTarget(
  buildingId: string,
  goldReserveTarget: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer(
    'setMarketplaceGoldReserveTarget',
    'set_marketplace_gold_reserve_target',
    {
      buildingId: serverId,
      goldReserveTarget: Math.max(0, Math.min(64, Math.floor(goldReserveTarget))),
    },
  );
}

export async function setMarketplaceSeedGrainTarget(
  buildingId: string,
  seedGrainTarget: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer('setMarketplaceSeedGrainTarget', 'set_marketplace_seed_grain_target', {
    buildingId: serverId,
    seedGrainTarget: Math.max(0, Math.min(96, Math.floor(seedGrainTarget))),
  });
}

export async function setMarketplaceSpecialtyExportPolicy(
  buildingId: string,
  exportPolicy: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid marketplace id.');
  await callReducer(
    'setMarketplaceSpecialtyExportPolicy',
    'set_marketplace_specialty_export_policy',
    {
      buildingId: serverId,
      exportPolicy: Math.max(0, Math.min(2, Math.floor(exportPolicy))),
    },
  );
}

export async function setHarvestReservePercent(
  buildingId: string,
  reservePercent: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error("Invalid hunter's hall or fishing camp id.");
  await callReducer('setHarvestReservePercent', 'set_harvest_reserve_percent', {
    buildingId: serverId,
    reservePercent: Math.max(0, Math.min(90, Math.round(reservePercent))),
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

export async function rotateConstructionLabor(): Promise<void> {
  await callReducer('rotateConstructionLabor', 'rotate_construction_labor', {});
}

export async function recallIdleSeasonalLabor(): Promise<void> {
  await callReducer('recallIdleSeasonalLabor', 'recall_idle_seasonal_labor', {});
}

export async function callUpActiveSeasonalLabor(): Promise<void> {
  await callReducer('callUpActiveSeasonalLabor', 'call_up_active_seasonal_labor', {});
}

export async function recallTargetIdleProcessorLabor(): Promise<void> {
  await callReducer(
    'recallTargetIdleProcessorLabor',
    'recall_target_idle_processor_labor',
    {},
  );
}

export async function callUpTargetReadyProcessorLabor(): Promise<void> {
  await callReducer(
    'callUpTargetReadyProcessorLabor',
    'call_up_target_ready_processor_labor',
    {},
  );
}

export async function callUpYearRoundLabor(): Promise<void> {
  await callReducer('callUpYearRoundLabor', 'call_up_year_round_labor', {});
}

export async function setConstructionPriority(
  buildingId: string,
  priority: number,
): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) throw new Error('Invalid building id.');
  await callReducer('setConstructionPriority', 'set_construction_priority', {
    buildingId: serverId,
    priority: Math.max(0, Math.min(3, Math.floor(priority))),
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

export async function cancelMarketplaceTradeOrder(buildingId: string): Promise<void> {
  const serverId = parseBuildingServerId(buildingId);
  if (serverId === null) {
    throw new Error('Invalid marketplace id.');
  }
  await callReducer(
    'cancelMarketplaceTradeOrder',
    'cancel_marketplace_trade_order',
    { buildingId: serverId },
  );
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

export async function setGameSpeed(speed: GameSpeed): Promise<void> {
  await callReducer('setGameSpeed', 'set_game_speed', { speed });
}

export async function configureWorld(settings: WorldGenerationSettings): Promise<void> {
  await callReducer('configureWorld', 'configure_world', settingsToConfigurePayload(settings));
}

export async function bootstrapWorld(
  registry: WorldLayoutRegistry,
  worldLayout: WorldLayout,
  getHeightAt?: (x: number, z: number) => number,
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
        isRich: definition.isRich === true,
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
      .filter((definition) =>
        definition.kind === 'game'
        || definition.kind === 'berries'
        || definition.kind === 'mushrooms'
        || definition.kind === 'fish'
      )
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
  const foundingSite = selectFoundingSite(worldLayout, getHeightAt);
  await callReducer('bootstrapFoundingSite', 'bootstrap_founding_site', foundingSite);
}

export async function syncRoadNetwork(snapshotJson: string): Promise<void> {
  await callReducer('syncRoadNetwork', 'sync_road_network', { snapshotJson });
}

export function countServerRows(connection: DbConnection, tableName: 'tree_entity' | 'quarry'): number {
  const table = connection.db[tableName];
  return table ? [...table.iter()].length : 0;
}
