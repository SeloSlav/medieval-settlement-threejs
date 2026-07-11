import type { ToastManager } from '../ui/ToastManager.ts';
import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';

export type InspectorSpacetimeActions = {
  onDemolishBuilding: (buildingId: string) => Promise<void>;
  onDemolishBurgageZone: (zoneId: string) => Promise<void>;
  onDemolishResidence: (residenceId: string) => Promise<void>;
  onPlaceBackyardGarden: (residenceId: string, kind: BackyardGardenKind) => Promise<void>;
  onDemolishBackyardGarden: (residenceId: string) => Promise<void>;
  onAssignBuildingLabor: (buildingId: string, labor: number) => Promise<void>;
  onMarketplaceTrade: (buildingId: string, tradeId: string) => Promise<void>;
  onCollectChapelCoffer: (buildingId: string) => Promise<void>;
};

export function createInspectorSpacetimeActions(
  getStore: () => SpacetimeGameStore | null,
  toastManager: ToastManager,
): InspectorSpacetimeActions {
  const requireConnected = (): SpacetimeGameStore | null => {
    const store = getStore();
    if (!store?.isConnected) {
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
      const store = requireConnected();
      if (!store) return;
      await runReducer(() => store.demolishBuilding(buildingId), 'Demolition failed.');
    },
    onDemolishBurgageZone: async (zoneId) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(() => store.demolishBurgageZone(zoneId), 'Residence plot demolition failed.');
    },
    onDemolishResidence: async (residenceId) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(() => store.demolishResidence(residenceId), 'Residence removal failed.');
    },
    onPlaceBackyardGarden: async (residenceId, kind) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(
        () => store.placeBackyardGarden(residenceId, kind),
        'Could not plant backyard garden.',
      );
    },
    onDemolishBackyardGarden: async (residenceId) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(
        () => store.demolishBackyardGarden(residenceId),
        'Could not remove backyard garden.',
      );
    },
    onAssignBuildingLabor: async (buildingId, labor) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(() => store.assignBuildingLabor(buildingId, labor), 'Labor assignment failed.');
    },
    onMarketplaceTrade: async (buildingId, tradeId) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(
        () => store.marketplaceTrade(buildingId, tradeId),
        'Marketplace trade failed.',
      );
    },
    onCollectChapelCoffer: async (buildingId) => {
      const store = requireConnected();
      if (!store) return;
      await runReducer(
        () => store.collectChapelCoffer(buildingId),
        'Could not collect chapel coffer.',
      );
    },
  };
}
