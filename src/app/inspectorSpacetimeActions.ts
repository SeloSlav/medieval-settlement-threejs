import type { ToastManager } from '../ui/ToastManager.ts';
import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import {
  residenceHasActiveProject,
  type FarmCrop,
  type GameState,
  type LivestockSpecies,
} from '../resources/types.ts';
import { describeBackyardGardenShortfall } from '../resources/buildingEconomy.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import type { FireTargetKind } from '../fires/fireIncident.ts';
import type { StorehouseCommodity } from '../economy/storehousePolicy.ts';
import type { NightPolicyCode } from '../economy/nightPolicy.ts';
import type { PantrySafeguardPolicyCode } from '../economy/pantrySafeguardPolicy.ts';

export type InspectorSpacetimeActions = {
  onDemolishBuilding: (buildingId: string) => Promise<void>;
  onDemolishBurgageZone: (zoneId: string) => Promise<void>;
  onDemolishResidence: (residenceId: string) => Promise<void>;
  onUpgradeResidence: (residenceId: string) => Promise<void>;
  onRetrofitResidenceTileRoof: (residenceId: string) => Promise<void>;
  onDemolishGraveyard: (graveyardId: string) => Promise<void>;
  onSetResidenceUpgradePriority: (residenceId: string, priority: number) => Promise<void>;
  onRepairFireDamage: (targetKind: FireTargetKind, targetId: string) => Promise<void>;
  onPlaceBackyardGarden: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onDemolishBackyardGarden: (residenceId: string) => Promise<void>;
  onAssignBuildingLabor: (buildingId: string, labor: number) => Promise<void>;
  onRotateConstructionLabor: () => Promise<void>;
  onRecallIdleSeasonalLabor: () => Promise<void>;
  onCallUpActiveSeasonalLabor: () => Promise<void>;
  onRecallTargetIdleProcessorLabor: () => Promise<void>;
  onCallUpTargetReadyProcessorLabor: () => Promise<void>;
  onBalanceYearRoundLabor: () => Promise<void>;
  onSetConstructionPriority: (buildingId: string, priority: number) => Promise<void>;
  onSetTradingPostTradeRule: (
    buildingId: string,
    commodityKind: number,
    mode: number,
    targetSurplus: number,
  ) => Promise<void>;
  onUpgradeChapel: (buildingId: string) => Promise<void>;
  onDemolishFarmField: (fieldId: string) => Promise<void>;
  onSetFarmFieldCrop: (fieldId: string, crop: FarmCrop) => Promise<void>;
  onSetFarmFieldFollowingCrop: (fieldId: string, crop: FarmCrop | null) => Promise<void>;
  onSetFarmFieldPriority: (fieldId: string, priority: number) => Promise<void>;
  onSetThreshingPriority: (buildingId: string, priority: number) => Promise<void>;
  onStartFarmFieldEarlyHarvest: (fieldId: string) => Promise<void>;
  onDemolishPasture: (pastureId: string) => Promise<void>;
  onSetLivestockSpecies: (buildingId: string, species: Exclude<LivestockSpecies, 'swine'>) => Promise<void>;
  onSetLivestockBreedingReserve: (buildingId: string, breedingReserve: number) => Promise<void>;
  onSetLivestockHaymakingPercent: (buildingId: string, haymakingPercent: number) => Promise<void>;
  onSetEconomicActivityTaxRate: (taxRate: number) => Promise<void>;
  onSetPantrySafeguardPolicy: (policy: PantrySafeguardPolicyCode) => Promise<void>;
  onSetFiscalPolicy: (
    landLevyRate: number,
    importDutyRate: number,
    exportDutyRate: number,
  ) => Promise<void>;
  onSetSeasonalLaborSteward: (enabled: boolean) => Promise<void>;
  onSetConstructionLaborSteward: (enabled: boolean) => Promise<void>;
  onSetProductionLaborSteward: (enabled: boolean) => Promise<void>;
  onSetLaborStewardReserve: (laborReserve: number) => Promise<void>;
  onSetChapelParishPolicy: (sabbathObservanceEnabled: boolean) => Promise<void>;
  onSetMonasteryPolicy: (titheShare: number, feastsEnabled: boolean) => Promise<void>;
  onSetNightPolicies: (
    watch: NightPolicyCode,
    gathering: NightPolicyCode,
    work: NightPolicyCode,
    lighting: NightPolicyCode,
    curfew: NightPolicyCode,
  ) => Promise<void>;
  onSetStorehousePolicy: (
    buildingId: string,
    acceptsTimber: boolean,
    acceptsStone: boolean,
    acceptsFirewood: boolean,
    acceptsCharcoal: boolean,
    acceptsIron: boolean,
    acceptsClay: boolean,
    acceptsSalt: boolean,
  ) => Promise<void>;
  onSetStorehouseStockTarget: (
    buildingId: string,
    commodity: StorehouseCommodity,
    targetPercent: number,
  ) => Promise<void>;
  onSetProcessorOutputTarget: (
    buildingId: string,
    targetPercent: number,
  ) => Promise<void>;
  onSetWeaverInputPolicy: (
    buildingId: string,
    inputPolicy: number,
  ) => Promise<void>;
  onSetPotteryDispatchPolicy: (
    buildingId: string,
    dispatchPolicy: number,
  ) => Promise<void>;
  onSetPotterFiringPolicy: (
    buildingId: string,
    firingPolicy: number,
  ) => Promise<void>;
  onSetGranaryPolicy: (
    buildingId: string,
    acceptsFreshFood: boolean,
    householdsFirst: boolean,
  ) => Promise<void>;
  onSetGranaryGrainReserve: (buildingId: string, grainReserve: number) => Promise<void>;
  onSetGranaryFreshFoodTarget: (buildingId: string, targetPercent: number) => Promise<void>;
  onSetWoodcutterTimberReserve: (buildingId: string, timberReserve: number) => Promise<void>;
  onSetCarpenterPolearmReserve: (buildingId: string, polearmReserve: number) => Promise<void>;
  onSetCarpenterCartServiceTarget: (buildingId: string, targetTrips: number) => Promise<void>;
  onSetGuardhousePayPriority: (buildingId: string, payPriority: number) => Promise<void>;
  onSetGuardhouseFoodReserve: (buildingId: string, reservePerGuard: number) => Promise<void>;
  onSetGuardhouseMusterPost: (
    buildingId: string,
    watchtowerId: string | null,
  ) => Promise<void>;
  onSetMarketplaceIronworkTarget: (buildingId: string, ironworkTarget: number) => Promise<void>;
  onSetMarketplaceIronTarget: (buildingId: string, ironTarget: number) => Promise<void>;
  onSetMarketplaceSaltTarget: (buildingId: string, saltTarget: number) => Promise<void>;
  onSetMarketplaceGoldReserveTarget: (
    buildingId: string,
    goldReserveTarget: number,
  ) => Promise<void>;
  onSetMarketplaceSeedGrainTarget: (
    buildingId: string,
    seedGrainTarget: number,
  ) => Promise<void>;
  onSetMarketplaceSpecialtyExportPolicy: (
    buildingId: string,
    exportPolicy: number,
  ) => Promise<void>;
  onSetMarketplaceSpecialtyFamilyExportPolicy: (
    buildingId: string,
    family: number,
    exportPolicy: number,
  ) => Promise<void>;
  onSetVineyardProductionPolicy: (buildingId: string, productionPolicy: number) => Promise<void>;
  onSetApiaryHarvestPolicy: (buildingId: string, harvestPolicy: number) => Promise<void>;
  onSetHarvestReservePercent: (buildingId: string, reservePercent: number) => Promise<void>;
};

export function createInspectorSpacetimeActions(
  getStore: () => SpacetimeGameStore | null,
  getGameState: () => GameState,
  isSessionReady: () => boolean,
  toastManager: ToastManager,
): InspectorSpacetimeActions {
  const requireReady = (): SpacetimeGameStore | null => {
    const store = getStore();
    if (!store || !isSessionReady()) {
      toastManager.show('SpacetimeDB is not connected.', { variant: 'error' });
      return null;
    }
    return store;
  };

  const runReducer = async (
    action: () => Promise<void>,
    fallbackMessage: string,
  ): Promise<void> => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      toastManager.show(message, { variant: 'error' });
    }
  };

  return {
    onDemolishBuilding: async (buildingId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishBuilding(buildingId), 'Demolition failed.');
    },
    onDemolishBurgageZone: async (zoneId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishBurgageZone(zoneId), 'Residence plot demolition failed.');
    },
    onDemolishResidence: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishResidence(residenceId), 'Residence removal failed.');
    },
    onUpgradeResidence: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.upgradeResidence(residenceId), 'Residence upgrade failed.');
    },
    onRetrofitResidenceTileRoof: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.retrofitResidenceTileRoof(residenceId),
        'Roof retrofit failed.',
      );
    },
    onSetResidenceUpgradePriority: async (residenceId, priority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setResidenceUpgradePriority(residenceId, priority),
        'Could not change household works priority.',
      );
    },
    onRepairFireDamage: async (targetKind, targetId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.repairFireDamage(targetKind, targetId),
        'Could not begin fire-damage recovery.',
      );
    },
    onPlaceBackyardGarden: async (residenceId, kind) => {
      const store = requireReady();
      if (!store) return;

      const state = getGameState();
      const residence = state.residences.get(residenceId);
      if (!residence) {
        toastManager.show('Residence not found.', { variant: 'error' });
        return;
      }
      if (state.backyardGardens.has(residenceId)) {
        toastManager.show('This backyard already has a garden.', { variant: 'error' });
        return;
      }
      if (residenceHasActiveProject(residence)) {
        toastManager.show('This household already has improvement works underway.', {
          variant: 'error',
        });
        return;
      }

      const shortfall = describeBackyardGardenShortfall(computeResourceTotals(state), kind);
      if (shortfall) {
        toastManager.show(shortfall, { variant: 'error' });
        return;
      }

      await runReducer(
        () => store.placeBackyardGarden(residenceId, kind),
        'Could not plant backyard garden.',
      );
    },
    onDemolishBackyardGarden: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.demolishBackyardGarden(residenceId),
        'Could not remove backyard garden.',
      );
    },
    onAssignBuildingLabor: async (buildingId, labor) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.assignBuildingLabor(buildingId, labor), 'Labor assignment failed.');
    },
    onRotateConstructionLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const result = await store.rotateConstructionLabor();
        if (result.recalledWorkers > 0 && result.calledWorkers > 0) {
          toastManager.show(
            `${result.recalledWorkers} blocked ${result.recalledWorkers === 1 ? 'builder' : 'builders'} released; ${result.calledWorkers} ${result.calledWorkers === 1 ? 'worker' : 'workers'} deployed to ready sites.`,
          );
        } else if (result.recalledWorkers > 0) {
          toastManager.show(
            `${result.recalledWorkers} blocked ${result.recalledWorkers === 1 ? 'builder returned' : 'builders returned'} to the free labor pool.`,
          );
        } else if (result.calledWorkers > 0) {
          toastManager.show(
            `${result.calledWorkers} ${result.calledWorkers === 1 ? 'builder deployed' : 'builders deployed'} to ready construction sites.`,
          );
        }
      }, 'Could not rotate construction crews.');
    },
    onRecallIdleSeasonalLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const recalled = await store.recallIdleSeasonalLabor();
        if (recalled > 0) {
          toastManager.show(
            `${recalled} seasonal ${recalled === 1 ? 'worker' : 'workers'} returned to the free labor pool.`,
          );
        }
      }, 'Could not recall idle seasonal crews.');
    },
    onCallUpActiveSeasonalLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const calledUp = await store.callUpActiveSeasonalLabor();
        if (calledUp > 0) {
          toastManager.show(
            `${calledUp} seasonal ${calledUp === 1 ? 'worker' : 'workers'} called to active work.`,
          );
        }
      }, 'Could not call up active seasonal crews.');
    },
    onRecallTargetIdleProcessorLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const recalled = await store.recallTargetIdleProcessorLabor();
        if (recalled > 0) {
          toastManager.show(
            `${recalled} stalled production ${recalled === 1 ? 'worker' : 'workers'} returned to the free labor pool.`,
          );
        }
      }, 'Could not recall stalled production crews.');
    },
    onCallUpTargetReadyProcessorLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const calledUp = await store.callUpTargetReadyProcessorLabor();
        if (calledUp > 0) {
          toastManager.show(
            `${calledUp} production ${calledUp === 1 ? 'worker' : 'workers'} deployed to ready worksites.`,
          );
        }
      }, 'Could not deploy production crews.');
    },
    onBalanceYearRoundLabor: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const result = await store.balanceYearRoundLabor();
        if (result.recalledWorkers > 0) {
          toastManager.show(
            `${result.recalledWorkers} lower-priority ${result.recalledWorkers === 1 ? 'worker' : 'workers'} reassigned; ${result.calledWorkers} year-round ${result.calledWorkers === 1 ? 'post filled' : 'posts filled'}.`,
          );
        } else if (result.calledWorkers > 0) {
          toastManager.show(
            `${result.calledWorkers} year-round ${result.calledWorkers === 1 ? 'worker deployed' : 'workers deployed'} by priority.`,
          );
        }
      }, 'Could not balance year-round crews.');
    },
    onSetConstructionPriority: async (buildingId, priority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setConstructionPriority(buildingId, priority),
        'Could not change construction priority.',
      );
    },
    onSetTradingPostTradeRule: async (buildingId, commodityKind, mode, targetSurplus) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setTradingPostTradeRule(buildingId, commodityKind, mode, targetSurplus),
        'Could not update the monthly trade rule.',
      );
    },
    onDemolishFarmField: async (fieldId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishFarmField(fieldId), 'Could not remove field.');
    },
    onSetFarmFieldCrop: async (fieldId, crop) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.setFarmFieldCrop(fieldId, crop), 'Could not change field crop.');
    },
    onSetFarmFieldFollowingCrop: async (fieldId, crop) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setFarmFieldFollowingCrop(fieldId, crop),
        'Could not change the field rotation.',
      );
    },
    onUpgradeChapel: async (buildingId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.upgradeChapel(buildingId),
        'Could not upgrade the church.',
      );
    },
    onSetFarmFieldPriority: async (fieldId, priority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.setFarmFieldPriority(fieldId, priority), 'Could not change field priority.');
    },
    onSetThreshingPriority: async (buildingId, priority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setThreshingPriority(buildingId, priority),
        'Could not change threshing priority.',
      );
    },
    onStartFarmFieldEarlyHarvest: async (fieldId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.startFarmFieldEarlyHarvest(fieldId);
        toastManager.show('Early harvest ordered. The reduced yield is now locked.');
      }, 'Could not begin early harvest.');
    },
    onDemolishPasture: async (pastureId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishPasture(pastureId), 'Could not remove pasture.');
    },
    onDemolishGraveyard: async (graveyardId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.demolishGraveyard(graveyardId),
        'Could not remove burial ground.',
      );
    },
    onSetLivestockSpecies: async (buildingId, species) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockSpecies(buildingId, species),
        'Could not change livestock specialization.',
      );
    },
    onSetLivestockBreedingReserve: async (buildingId, breedingReserve) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockBreedingReserve(buildingId, breedingReserve),
        'Could not change the herd breeding reserve.',
      );
    },
    onSetLivestockHaymakingPercent: async (buildingId, haymakingPercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockHaymakingPercent(buildingId, haymakingPercent),
        'Could not change the summer hay meadow allocation.',
      );
    },
    onSetEconomicActivityTaxRate: async (taxRate) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setEconomicActivityTaxRate(taxRate),
        'Could not update the Town Hall tax policy.',
      );
    },
    onSetSeasonalLaborSteward: async (enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setSeasonalLaborSteward(enabled);
          updated = true;
        },
        'Could not update the seasonal labor steward policy.',
      );
      if (!updated) return;
      toastManager.show(
        enabled
          ? 'Town Hall steward enabled. Seasonal crews were reviewed now and will be reviewed daily while a clerk is assigned.'
          : 'Town Hall steward disabled. Seasonal crew changes are manual.',
      );
    },
    onSetConstructionLaborSteward: async (enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setConstructionLaborSteward(enabled);
          updated = true;
        },
        'Could not update the construction labor steward policy.',
      );
      if (!updated) return;
      toastManager.show(
        enabled
          ? 'Town Hall construction steward enabled. Builders were rotated now and will be reviewed daily while a clerk is assigned.'
          : 'Town Hall construction steward disabled. Builder rotation is manual.',
      );
    },
    onSetPantrySafeguardPolicy: async (policy) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setPantrySafeguardPolicy(policy);
          updated = true;
        },
        'Could not update the Town Hall pantry safeguard.',
      );
      if (updated) {
        toastManager.show('Pantry safeguard posted. Weekly issues and automatic market checks will follow the new rule.');
      }
    },
    onSetFiscalPolicy: async (landLevyRate, importDutyRate, exportDutyRate) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setFiscalPolicy(landLevyRate, importDutyRate, exportDutyRate),
        'Could not update the Town Hall land or customs policy.',
      );
    },
    onSetProductionLaborSteward: async (enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setProductionLaborSteward(enabled);
          updated = true;
        },
        'Could not update the production labor steward policy.',
      );
      if (!updated) return;
      toastManager.show(
        enabled
          ? 'Town Hall production steward enabled. Stalled crews were released and supplied production was staffed now; the review will repeat daily while a clerk is assigned.'
          : 'Town Hall production steward disabled. Production crew rotation is manual.',
      );
    },
    onSetLaborStewardReserve: async (laborReserve) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setLaborStewardReserve(laborReserve);
          updated = true;
        },
        'Could not update the automatic labor reserve.',
      );
      if (!updated) return;
      toastManager.show(
        laborReserve === 0
          ? 'Town Hall stewards may use all free villagers at dawn.'
          : `Town Hall stewards will leave ${laborReserve} ${laborReserve === 1 ? 'villager' : 'villagers'} free for explicit orders. Productive crews remain assigned.`,
      );
    },
    onSetChapelParishPolicy: async (sabbathObservanceEnabled) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setChapelParishPolicy(sabbathObservanceEnabled),
        'Could not update chapel policy.',
      );
    },
    onSetMonasteryPolicy: async (titheShare, feastsEnabled) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMonasteryPolicy(titheShare, feastsEnabled),
        'Could not update monastery policy.',
      );
    },
    onSetNightPolicies: async (watch, gathering, work, lighting, curfew) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setNightPolicies(watch, gathering, work, lighting, curfew);
          updated = true;
        },
        'Could not update the settlement night policy.',
      );
      if (updated) {
        toastManager.show('Night orders posted. They take effect this evening.');
      }
    },
    onSetStorehousePolicy: async (
      buildingId,
      acceptsTimber,
      acceptsStone,
      acceptsFirewood,
      acceptsCharcoal,
      acceptsIron,
      acceptsClay,
      acceptsSalt,
    ) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setStorehousePolicy(
          buildingId,
          acceptsTimber,
          acceptsStone,
          acceptsFirewood,
          acceptsCharcoal,
          acceptsIron,
          acceptsClay,
          acceptsSalt,
        ),
        'Could not update storehouse intake filters.',
      );
    },
    onSetStorehouseStockTarget: async (buildingId, commodity, targetPercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setStorehouseStockTarget(buildingId, commodity, targetPercent),
        'Could not update the storehouse stock target.',
      );
    },
    onSetProcessorOutputTarget: async (buildingId, targetPercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setProcessorOutputTarget(buildingId, targetPercent),
        'Could not update the production stock target.',
      );
    },
    onSetWeaverInputPolicy: async (buildingId, inputPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setWeaverInputPolicy(buildingId, inputPolicy),
        'Could not update the weaver input policy.',
      );
    },
    onSetPotteryDispatchPolicy: async (buildingId, dispatchPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setPotteryDispatchPolicy(buildingId, dispatchPolicy),
        'Could not update the pottery dispatch policy.',
      );
    },
    onSetPotterFiringPolicy: async (buildingId, firingPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setPotterFiringPolicy(buildingId, firingPolicy),
        'Could not update the kiln firing order.',
      );
    },
    onSetGranaryPolicy: async (buildingId, acceptsFreshFood, householdsFirst) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGranaryPolicy(buildingId, acceptsFreshFood, householdsFirst),
        'Could not update granary policy.',
      );
    },
    onSetGranaryGrainReserve: async (buildingId, grainReserve) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGranaryGrainReserve(buildingId, grainReserve),
        'Could not update the granary grain reserve.',
      );
    },
    onSetGranaryFreshFoodTarget: async (buildingId, targetPercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGranaryFreshFoodTarget(buildingId, targetPercent),
        'Could not update the granary fresh-food target.',
      );
    },
    onSetWoodcutterTimberReserve: async (buildingId, timberReserve) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setWoodcutterTimberReserve(buildingId, timberReserve),
        'Could not update the lodge timber reserve.',
      );
    },
    onSetCarpenterPolearmReserve: async (buildingId, polearmReserve) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setCarpenterPolearmReserve(buildingId, polearmReserve),
        'Could not update the carpenter armory reserve.',
      );
    },
    onSetCarpenterCartServiceTarget: async (buildingId, targetTrips) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setCarpenterCartServiceTarget(buildingId, targetTrips),
        'Could not update the carpenter cart-service depth.',
      );
    },
    onSetGuardhousePayPriority: async (buildingId, payPriority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGuardhousePayPriority(buildingId, payPriority),
        'Could not update the guardhouse company priority.',
      );
    },
    onSetGuardhouseFoodReserve: async (buildingId, reservePerGuard) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGuardhouseFoodReserve(buildingId, reservePerGuard),
        'Could not update the guardhouse ration reserve.',
      );
    },
    onSetGuardhouseMusterPost: async (buildingId, watchtowerId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setGuardhouseMusterPost(buildingId, watchtowerId),
        'Could not update the guardhouse muster post.',
      );
    },
    onSetMarketplaceIronworkTarget: async (buildingId, ironworkTarget) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceIronworkTarget(buildingId, ironworkTarget),
        'Could not update the Trading Post ironwork target.',
      );
    },
    onSetMarketplaceIronTarget: async (buildingId, ironTarget) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceIronTarget(buildingId, ironTarget),
        'Could not update the Trading Post iron target.',
      );
    },
    onSetMarketplaceSaltTarget: async (buildingId, saltTarget) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceSaltTarget(buildingId, saltTarget),
        'Could not update the Trading Post salt target.',
      );
    },
    onSetMarketplaceGoldReserveTarget: async (buildingId, goldReserveTarget) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceGoldReserveTarget(buildingId, goldReserveTarget),
        'Could not update the Trading Post cash reserve.',
      );
    },
    onSetMarketplaceSeedGrainTarget: async (buildingId, seedGrainTarget) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceSeedGrainTarget(buildingId, seedGrainTarget),
        'Could not update the Trading Post seed-grain target.',
      );
    },
    onSetMarketplaceSpecialtyExportPolicy: async (buildingId, exportPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceSpecialtyExportPolicy(buildingId, exportPolicy),
        'Could not update the Trading Post specialty export policy.',
      );
    },
    onSetMarketplaceSpecialtyFamilyExportPolicy: async (buildingId, family, exportPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMarketplaceSpecialtyFamilyExportPolicy(buildingId, family, exportPolicy),
        'Could not update this Trading Post export family.',
      );
    },
    onSetVineyardProductionPolicy: async (buildingId, productionPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setVineyardProductionPolicy(buildingId, productionPolicy),
        'Could not update the vineyard grape allocation.',
      );
    },
    onSetApiaryHarvestPolicy: async (buildingId, harvestPolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setApiaryHarvestPolicy(buildingId, harvestPolicy),
        'Could not update the apiary harvest policy.',
      );
    },
    onSetHarvestReservePercent: async (buildingId, reservePercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setHarvestReservePercent(buildingId, reservePercent),
        'Could not update the wild-stock reserve.',
      );
    },
  };
}
