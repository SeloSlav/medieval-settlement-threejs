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
import type { StorageCommodity } from '../economy/storageAcceptancePolicy.ts';
import type { PantrySafeguardPolicyCode } from '../economy/pantrySafeguardPolicy.ts';

export type InspectorSpacetimeActions = {
  onDemolishBuilding: (buildingId: string) => Promise<void>;
  onDemolishBurgageZone: (zoneId: string) => Promise<void>;
  onDemolishResidence: (residenceId: string) => Promise<void>;
  onUpgradeResidence: (residenceId: string) => Promise<void>;
  onConvertResidenceToSmallholding: (residenceId: string) => Promise<void>;
  onRetrofitResidenceTileRoof: (residenceId: string) => Promise<void>;
  onDemolishGraveyard: (graveyardId: string) => Promise<void>;
  onSetResidenceUpgradePriority: (residenceId: string, priority: number) => Promise<void>;
  onRepairFireDamage: (targetKind: FireTargetKind, targetId: string) => Promise<void>;
  onPlaceBackyardGarden: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onSpecializeOrchard: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onSpecializeAnimalPen: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onSpecializeVegetableGarden: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onUpgradeFlowerGardenLuxury: (residenceId: string) => Promise<void>;
  onDemolishBackyardGarden: (residenceId: string) => Promise<void>;
  onAssignBuildingLabor: (buildingId: string, labor: number) => Promise<void>;
  onRotateConstructionLabor: (townHallId: string) => Promise<void>;
  onRecallIdleSeasonalLabor: (townHallId: string) => Promise<void>;
  onCallUpActiveSeasonalLabor: (townHallId: string) => Promise<void>;
  onRecallTargetIdleProcessorLabor: (townHallId: string) => Promise<void>;
  onCallUpTargetReadyProcessorLabor: (townHallId: string) => Promise<void>;
  onBalanceYearRoundLabor: (townHallId: string) => Promise<void>;
  onRaiseMilitia: (townHallId: string, requested: number) => Promise<void>;
  onDisbandMilitia: () => Promise<void>;
  onRecruitMilitaryCompany: (sourceBuildingId: string, kind: number) => Promise<void>;
  onHireMercenaryCompany: (townHallId: string) => Promise<void>;
  onDisbandMilitaryCompany: (companyId: string) => Promise<void>;
  onDisbandCavalryCompanySellMounts: (companyId: string) => Promise<void>;
  onRenewMercenaryContract: (companyId: string) => Promise<void>;
  onResupplyMilitaryCompany: (companyId: string) => Promise<void>;
  onSetMilitaryFormation: (companyId: string, formation: number) => Promise<void>;
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
  onSetLivestockSpecies: (pastureId: string, species: Exclude<LivestockSpecies, 'swine'>) => Promise<void>;
  onTradeLivestock: (pastureId: string, headDelta: number) => Promise<void>;
  onPurchaseStableOx: (stableId: string) => Promise<void>;
  onPurchaseCavalryHorse: (cavalryYardId: string) => Promise<void>;
  onPurchaseKennelDog: (kennelId: string) => Promise<void>;
  onSetBuildingOxen: (buildingId: string, assignedOxen: number) => Promise<void>;
  onSetBuildingDogs: (buildingId: string, assignedDogs: number) => Promise<void>;
  onSetLivestockBreedingReserve: (pastureId: string, breedingReserve: number) => Promise<void>;
  onSetLivestockHaymakingPercent: (pastureId: string, haymakingPercent: number) => Promise<void>;
  onSetEconomicActivityTaxRate: (townHallId: string, taxRate: number) => Promise<void>;
  onSetPantrySafeguardPolicy: (
    townHallId: string,
    policy: PantrySafeguardPolicyCode,
  ) => Promise<void>;
  onSetFiscalPolicy: (
    townHallId: string,
    landLevyRate: number,
    importDutyRate: number,
    exportDutyRate: number,
  ) => Promise<void>;
  onSetSeasonalLaborSteward: (townHallId: string, enabled: boolean) => Promise<void>;
  onSetConstructionLaborSteward: (townHallId: string, enabled: boolean) => Promise<void>;
  onSetProductionLaborSteward: (townHallId: string, enabled: boolean) => Promise<void>;
  onSetLaborStewardReserve: (townHallId: string, laborReserve: number) => Promise<void>;
  onSetChapelParishPolicy: (sabbathObservanceEnabled: boolean) => Promise<void>;
  onSetMonasteryPolicy: (titheShare: number, feastsEnabled: boolean) => Promise<void>;
  onSetMonasteryCharter: (levyRate: number) => Promise<void>;
  onSetMonasteryNextExtension: (buildingId: string, extension: number) => Promise<void>;
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
  onSetStorageCommodityAcceptance: (
    buildingId: string,
    commodity: StorageCommodity,
    accepts: boolean,
  ) => Promise<void>;
  onSetAllStorageAcceptance: (buildingId: string, accepts: boolean) => Promise<void>;
  onSetStorehouseStockTarget: (
    buildingId: string,
    commodity: StorehouseCommodity,
    targetPercent: number,
  ) => Promise<void>;
  onSetLivestockMilkUsePolicy: (
    buildingId: string,
    milkUsePolicy: number,
  ) => Promise<void>;
  onSetBreweryRecipePolicy: (
    buildingId: string,
    recipePolicy: number,
  ) => Promise<void>;
  onSetBuildingProductionRate: (
    buildingId: string,
    ratePercent: number,
  ) => Promise<void>;
  onSetSmokehouseRecipePolicy: (
    buildingId: string,
    recipePolicy: number,
  ) => Promise<void>;
  onSetWeaverInputPolicy: (
    buildingId: string,
    inputPolicy: number,
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
    onConvertResidenceToSmallholding: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.convertResidenceToSmallholding(residenceId),
        'Smallholding specialization failed.',
      );
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
    onRotateConstructionLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const result = await store.rotateConstructionLabor(townHallId);
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
    onRecallIdleSeasonalLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const recalled = await store.recallIdleSeasonalLabor(townHallId);
        if (recalled > 0) {
          toastManager.show(
            `${recalled} seasonal ${recalled === 1 ? 'worker' : 'workers'} returned to the free labor pool.`,
          );
        }
      }, 'Could not recall idle seasonal crews.');
    },
    onCallUpActiveSeasonalLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const calledUp = await store.callUpActiveSeasonalLabor(townHallId);
        if (calledUp > 0) {
          toastManager.show(
            `${calledUp} seasonal ${calledUp === 1 ? 'worker' : 'workers'} called to active work.`,
          );
        }
      }, 'Could not call up active seasonal crews.');
    },
    onRecallTargetIdleProcessorLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const recalled = await store.recallTargetIdleProcessorLabor(townHallId);
        if (recalled > 0) {
          toastManager.show(
            `${recalled} stalled production ${recalled === 1 ? 'worker' : 'workers'} returned to the free labor pool.`,
          );
        }
      }, 'Could not recall stalled production crews.');
    },
    onCallUpTargetReadyProcessorLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const calledUp = await store.callUpTargetReadyProcessorLabor(townHallId);
        if (calledUp > 0) {
          toastManager.show(
            `${calledUp} production ${calledUp === 1 ? 'worker' : 'workers'} deployed to ready worksites.`,
          );
        }
      }, 'Could not deploy production crews.');
    },
    onBalanceYearRoundLabor: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        const result = await store.balanceYearRoundLabor(townHallId);
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
        'Could not update the regional trade rule.',
      );
    },
    onRaiseMilitia: async (townHallId, requested) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.raiseMilitia(townHallId, requested);
        toastManager.show('Militia raised. Drag-select the spearmen and right-click to move or attack.');
      }, 'Could not raise militia.');
    },
    onDisbandMilitia: async () => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.disbandMilitia();
        toastManager.show('Militia disbanded and returned to the free labor pool.');
      }, 'Could not disband militia.');
    },
    onRecruitMilitaryCompany: async (sourceBuildingId, kind) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        if (kind >= 8) {
          await store.recruitCavalryCompany(sourceBuildingId, kind);
        } else {
          await store.recruitMilitaryCompany(sourceBuildingId, kind);
        }
        toastManager.show('Military company recruited. Drag-select its soldiers and right-click to command them.');
      }, 'Could not recruit the military company.');
    },
    onHireMercenaryCompany: async (townHallId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.hireMercenaryCompany(townHallId);
        toastManager.show('Mercenary spear company hired and ready at the Town Hall.');
      }, 'Could not hire the mercenary company.');
    },
    onDisbandMilitaryCompany: async (companyId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.disbandMilitaryCompany(companyId);
        toastManager.show('Company is leaving service. Mercenaries march to their original map edge; residents return equipment and walk home.');
      }, 'Could not disband the company.');
    },
    onDisbandCavalryCompanySellMounts: async (companyId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.disbandCavalryCompanySellMounts(companyId);
        toastManager.show('The mounted company is returning. Each surviving horse will be sold only after it physically reaches the Cavalry Yard.');
      }, 'Could not disband and sell this company’s mounts.');
    },
    onRenewMercenaryContract: async (companyId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.renewMercenaryContract(companyId);
        toastManager.show('Mercenary retainer paid. The company has halted its departure and accepts orders again.');
      }, 'Could not renew the mercenary contract.');
    },
    onResupplyMilitaryCompany: async (companyId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(async () => {
        await store.resupplyMilitaryCompany(companyId);
        toastManager.show('Company field supplies issued from settlement stores.');
      }, 'Could not resupply the company.');
    },
    onSetMilitaryFormation: async (companyId, formation) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMilitaryFormation(companyId, formation),
        'Could not change the company formation.',
      );
    },
    onSpecializeOrchard: async (residenceId, kind) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.specializeOrchard(residenceId, kind),
        'Could not plant this orchard.',
      );
    },
    onSpecializeAnimalPen: async (residenceId, kind) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.specializeAnimalPen(residenceId, kind),
        'Could not stock this animal pen.',
      );
    },
    onSpecializeVegetableGarden: async (residenceId, kind) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.specializeVegetableGarden(residenceId, kind),
        'Could not purchase seed for this vegetable garden.',
      );
    },
    onUpgradeFlowerGardenLuxury: async (residenceId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.upgradeFlowerGardenLuxury(residenceId),
        'Could not cultivate luxury cut flowers.',
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
    onSetLivestockSpecies: async (pastureId, species) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockSpecies(pastureId, species),
        'Could not change livestock specialization.',
      );
    },
    onTradeLivestock: async (pastureId, headDelta) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.tradeLivestock(pastureId, headDelta),
        headDelta > 0 ? 'Could not purchase livestock.' : 'Could not sell livestock.',
      );
    },
    onPurchaseStableOx: async (stableId) => {
      const store = requireReady();
      if (!store) return;
      let purchased = false;
      await runReducer(
        async () => {
          await store.purchaseStableOx(stableId);
          purchased = true;
        },
        'Could not purchase a stable ox.',
      );
      if (purchased) {
        toastManager.show(
          'Draft ox purchased. It joins automatic assistance until you post it to a workplace.',
        );
      }
    },
    onPurchaseCavalryHorse: async (cavalryYardId) => {
      const store = requireReady();
      if (!store) return;
      let purchased = false;
      await runReducer(
        async () => {
          await store.purchaseCavalryHorse(cavalryYardId);
          purchased = true;
        },
        'Could not purchase the remount.',
      );
      if (purchased) {
        toastManager.show('Remount purchased. Cavalry-yard hands will now train it while feed, oats, and water are available.');
      }
    },
    onPurchaseKennelDog: async (kennelId) => {
      const store = requireReady();
      if (!store) return;
      let purchased = false;
      await runReducer(
        async () => {
          await store.purchaseKennelDog(kennelId);
          purchased = true;
        },
        'Could not purchase a guard dog.',
      );
      if (purchased) {
        toastManager.show('Guard dog purchased. It has begun an autonomous settlement patrol.');
      }
    },
    onSetBuildingOxen: async (buildingId, assignedOxen) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setBuildingOxen(buildingId, assignedOxen),
        'Could not change the ox posting.',
      );
    },
    onSetBuildingDogs: async (buildingId, assignedDogs) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setBuildingDogs(buildingId, assignedDogs),
        'Could not change the hunting-dog posting.',
      );
    },
    onSetLivestockBreedingReserve: async (pastureId, breedingReserve) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockBreedingReserve(pastureId, breedingReserve),
        'Could not change the herd breeding reserve.',
      );
    },
    onSetLivestockHaymakingPercent: async (pastureId, haymakingPercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockHaymakingPercent(pastureId, haymakingPercent),
        'Could not change the summer hay meadow allocation.',
      );
    },
    onSetEconomicActivityTaxRate: async (townHallId, taxRate) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setEconomicActivityTaxRate(townHallId, taxRate),
        'Could not update the Town Hall tax policy.',
      );
    },
    onSetSeasonalLaborSteward: async (townHallId, enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setSeasonalLaborSteward(townHallId, enabled);
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
    onSetConstructionLaborSteward: async (townHallId, enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setConstructionLaborSteward(townHallId, enabled);
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
    onSetPantrySafeguardPolicy: async (townHallId, policy) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setPantrySafeguardPolicy(townHallId, policy);
          updated = true;
        },
        'Could not update the Town Hall pantry safeguard.',
      );
      if (updated) {
        toastManager.show('Pantry safeguard posted. Daily issues continue; critical food and heat will use the new buffer.');
      }
    },
    onSetFiscalPolicy: async (townHallId, landLevyRate, importDutyRate, exportDutyRate) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setFiscalPolicy(townHallId, landLevyRate, importDutyRate, exportDutyRate),
        'Could not update the Town Hall land or customs policy.',
      );
    },
    onSetProductionLaborSteward: async (townHallId, enabled) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setProductionLaborSteward(townHallId, enabled);
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
    onSetLaborStewardReserve: async (townHallId, laborReserve) => {
      const store = requireReady();
      if (!store) return;
      let updated = false;
      await runReducer(
        async () => {
          await store.setLaborStewardReserve(townHallId, laborReserve);
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
    onSetMonasteryCharter: async (levyRate) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMonasteryCharter(levyRate),
        'Could not update the monastic charter.',
      );
    },
    onSetMonasteryNextExtension: async (buildingId, extension) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setMonasteryNextExtension(buildingId, extension),
        'Could not reserve the next monastery extension.',
      );
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
    onSetLivestockMilkUsePolicy: async (buildingId, milkUsePolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockMilkUsePolicy(buildingId, milkUsePolicy),
        'Could not update the milk-use recipe.',
      );
    },
    onSetStorageCommodityAcceptance: async (buildingId, commodity, accepts) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setStorageCommodityAcceptance(buildingId, commodity, accepts),
        'Could not update the storage acceptance filter.',
      );
    },
    onSetAllStorageAcceptance: async (buildingId, accepts) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setAllStorageAcceptance(buildingId, accepts),
        'Could not update all storage acceptance filters.',
      );
    },
    onSetBreweryRecipePolicy: async (buildingId, recipePolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setBreweryRecipePolicy(buildingId, recipePolicy),
        'Could not update the Brewery recipe.',
      );
    },
    onSetBuildingProductionRate: async (buildingId, ratePercent) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setBuildingProductionRate(buildingId, ratePercent),
        'Could not update the production rate.',
      );
    },
    onSetSmokehouseRecipePolicy: async (buildingId, recipePolicy) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setSmokehouseRecipePolicy(buildingId, recipePolicy),
        'Could not update the Smokehouse recipe.',
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
