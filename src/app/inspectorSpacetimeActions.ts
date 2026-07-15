import type { ToastManager } from '../ui/ToastManager.ts';
import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import type { FarmCrop, GameState, LivestockSpecies } from '../resources/types.ts';
import { describeBackyardGardenShortfall } from '../resources/buildingEconomy.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';

export type InspectorSpacetimeActions = {
  onDemolishBuilding: (buildingId: string) => Promise<void>;
  onDemolishBurgageZone: (zoneId: string) => Promise<void>;
  onDemolishResidence: (residenceId: string) => Promise<void>;
  onUpgradeResidence: (residenceId: string) => Promise<void>;
  onPlaceBackyardGarden: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onDemolishBackyardGarden: (residenceId: string) => Promise<void>;
  onAssignBuildingLabor: (buildingId: string, labor: number) => Promise<void>;
  onMarketplaceTrade: (buildingId: string, tradeId: string) => Promise<void>;
  onCollectChapelCoffer: (buildingId: string) => Promise<void>;
  onDemolishFarmField: (fieldId: string) => Promise<void>;
  onSetFarmFieldCrop: (fieldId: string, crop: FarmCrop) => Promise<void>;
  onSetFarmFieldPriority: (fieldId: string, priority: number) => Promise<void>;
  onDemolishPasture: (pastureId: string) => Promise<void>;
  onSetLivestockSpecies: (buildingId: string, species: Exclude<LivestockSpecies, 'swine'>) => Promise<void>;
  onSetEconomicActivityTaxRate: (taxRate: number) => Promise<void>;
  onSetChapelParishPolicy: (autoSweepEnabled: boolean, cofferReserveGold: number, sabbathObservanceEnabled: boolean) => Promise<void>;
  onSetMonasteryPolicy: (titheShare: number, feastsEnabled: boolean) => Promise<void>;
  onSetStorehousePolicy: (buildingId: string, acceptsTimber: boolean, acceptsStone: boolean, acceptsFirewood: boolean) => Promise<void>;
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
    onPlaceBackyardGarden: async (residenceId, kind) => {
      const store = requireReady();
      if (!store) return;

      const state = getGameState();
      const residence = state.residences.get(residenceId);
      if (!residence) {
        toastManager.show('Residence not found.', { variant: 'error' });
        return;
      }
      if (residence.abandoned) {
        toastManager.show('Cannot plant a backyard garden at an abandoned residence.', { variant: 'error' });
        return;
      }
      if (state.backyardGardens.has(residenceId)) {
        toastManager.show('This backyard already has a garden.', { variant: 'error' });
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
    onMarketplaceTrade: async (buildingId, tradeId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.marketplaceTrade(buildingId, tradeId),
        'Marketplace trade failed.',
      );
    },
    onCollectChapelCoffer: async (buildingId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.collectChapelCoffer(buildingId),
        'Could not collect chapel coffer.',
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
    onSetFarmFieldPriority: async (fieldId, priority) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.setFarmFieldPriority(fieldId, priority), 'Could not change field priority.');
    },
    onDemolishPasture: async (pastureId) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(() => store.demolishPasture(pastureId), 'Could not remove pasture.');
    },
    onSetLivestockSpecies: async (buildingId, species) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setLivestockSpecies(buildingId, species),
        'Could not change livestock specialization.',
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
    onSetChapelParishPolicy: async (autoSweepEnabled, cofferReserveGold, sabbathObservanceEnabled) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setChapelParishPolicy(autoSweepEnabled, cofferReserveGold, sabbathObservanceEnabled),
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
    onSetStorehousePolicy: async (buildingId, acceptsTimber, acceptsStone, acceptsFirewood) => {
      const store = requireReady();
      if (!store) return;
      await runReducer(
        () => store.setStorehousePolicy(buildingId, acceptsTimber, acceptsStone, acceptsFirewood),
        'Could not update storehouse intake filters.',
      );
    },
  };
}
