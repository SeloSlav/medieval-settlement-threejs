import type { DbConnection } from '../../generated/index.ts';
import type { Building, TreeEntity } from '../../generated/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { syncBackyardGardens } from './syncBackyardGardens.ts';
import {
  removeBuildingRow,
  syncBuildings,
  upsertBuildingRow,
} from './syncBuildings.ts';
import { syncBurgageZones } from './syncBurgageZones.ts';
import { syncDeliveryTrips } from './syncDeliveryTrips.ts';
import { syncForagingNodes } from './syncForagingNodes.ts';
import { syncFarmFields } from './syncFarmFields.ts';
import { syncLivestockHerds, syncPastures } from './syncLivestock.ts';
import { syncMarketState } from './syncMarketState.ts';
import { syncPlayerResources } from './syncPlayerResources.ts';
import { syncQuarries } from './syncQuarries.ts';
import { syncResidences } from './syncResidences.ts';
import { syncRoadNetwork } from './syncRoadNetwork.ts';
import { removeTreeRow, syncTrees, upsertTreeRow } from './syncTrees.ts';
import { syncWorldConfig } from './syncWorldConfig.ts';

type TableHandle = {
  onInsert: (cb: () => void) => void;
  onUpdate: (cb: () => void) => void;
  onDelete: (cb: () => void) => void;
};

type TableChange<Row> =
  | { type: 'insert'; row: Row }
  | { type: 'update'; oldRow: Row; row: Row }
  | { type: 'delete'; row: Row };

export class GameTableSync {
  private readonly state: GameTableSyncState;
  private readonly onChanged: () => void;

  constructor(state: GameTableSyncState, onChanged: () => void) {
    this.state = state;
    this.onChanged = onChanged;
  }

  syncAll(connection: DbConnection): void {
    const db = connection.db;

    syncWorldConfig(db.world_config ? db.world_config.iter() : [], this.state);
    syncPlayerResources(db.player_resources ? db.player_resources.iter() : [], this.state);
    syncMarketState(db.market_state ? db.market_state.iter() : [], this.state);
    this.state.quarries = syncQuarries(db.quarry ? db.quarry.iter() : []);
    this.state.foragingNodes = syncForagingNodes(db.foraging_node ? db.foraging_node.iter() : []);
    this.state.trees = syncTrees(db.tree_entity ? db.tree_entity.iter() : []);
    this.state.buildings = syncBuildings(db.building ? db.building.iter() : [], this.state.identityHex);
    this.state.farmFields = syncFarmFields(db.farm_field ? db.farm_field.iter() : [], this.state.identityHex);
    this.state.pastures = syncPastures(db.pasture ? db.pasture.iter() : [], this.state.identityHex);
    this.state.livestockHerds = syncLivestockHerds(
      db.livestock_herd ? db.livestock_herd.iter() : [],
      this.state.identityHex,
    );
    this.state.burgageZones = syncBurgageZones(
      db.burgage_zone ? db.burgage_zone.iter() : [],
      this.state.identityHex,
    );
    this.state.residences = syncResidences(
      db.residence ? db.residence.iter() : [],
      db.residence_need ? db.residence_need.iter() : [],
      this.state.identityHex,
    );
    this.state.backyardGardens = syncBackyardGardens(
      db.backyard_garden ? db.backyard_garden.iter() : [],
      this.state.identityHex,
    );
    this.state.deliveryTrips = syncDeliveryTrips(
      db.delivery_trip ? db.delivery_trip.iter() : [],
      this.state.identityHex,
    );
    this.state.roads = syncRoadNetwork(
      db.road_network_state ? db.road_network_state.iter() : [],
      this.state.identityHex,
    );

    this.onChanged();
  }

  syncBuildings(connection: DbConnection): void {
    const db = connection.db;
    this.state.buildings = syncBuildings(
      db.building ? db.building.iter() : [],
      this.state.identityHex,
    );
    this.onChanged();
  }

  attachHandlers(connection: DbConnection): void {
    const db = connection.db;
    let notifyPending = false;
    const notify = (): void => {
      if (notifyPending) return;
      notifyPending = true;
      queueMicrotask(() => {
        notifyPending = false;
        this.onChanged();
      });
    };

    const bindTable = (
      table: TableHandle | undefined,
      apply: () => void,
      withDelete = true,
    ): void => {
      if (!table) return;
      let applyPending = false;
      const handler = (): void => {
        if (applyPending) return;
        applyPending = true;
        queueMicrotask(() => {
          applyPending = false;
          apply();
          notify();
        });
      };
      table.onInsert(handler);
      table.onUpdate(handler);
      if (withDelete) {
        table.onDelete(handler);
      }
    };

    const queueTableChanges = <Row>(
      apply: (changes: ReadonlyArray<TableChange<Row>>) => void,
    ) => {
      let pending: TableChange<Row>[] = [];
      let applyPending = false;
      const schedule = (): void => {
        if (applyPending) return;
        applyPending = true;
        queueMicrotask(() => {
          applyPending = false;
          const changes = pending;
          pending = [];
          apply(changes);
          notify();
        });
      };
      return {
        insert: (row: Row): void => {
          pending.push({ type: 'insert', row });
          schedule();
        },
        update: (oldRow: Row, row: Row): void => {
          pending.push({ type: 'update', oldRow, row });
          schedule();
        },
        delete: (row: Row): void => {
          pending.push({ type: 'delete', row });
          schedule();
        },
      };
    };

    bindTable(db.world_config, () => {
      syncWorldConfig(db.world_config ? db.world_config.iter() : [], this.state);
    }, false);

    bindTable(db.player_resources, () => {
      syncPlayerResources(db.player_resources ? db.player_resources.iter() : [], this.state);
    }, false);

    bindTable(db.market_state, () => {
      syncMarketState(db.market_state ? db.market_state.iter() : [], this.state);
    }, false);

    bindTable(db.quarry, () => {
      this.state.quarries = syncQuarries(db.quarry ? db.quarry.iter() : []);
    });

    bindTable(db.foraging_node, () => {
      this.state.foragingNodes = syncForagingNodes(db.foraging_node ? db.foraging_node.iter() : []);
    });

    if (db.tree_entity) {
      const treeChanges = queueTableChanges<TreeEntity>((changes) => {
        const nextTrees = new Map(this.state.trees);
        for (const change of changes) {
          if (change.type === 'delete') {
            removeTreeRow(nextTrees, change.row);
          } else {
            if (change.type === 'update' && change.oldRow.treeId !== change.row.treeId) {
              removeTreeRow(nextTrees, change.oldRow);
            }
            upsertTreeRow(nextTrees, change.row);
          }
        }
        this.state.trees = nextTrees;
      });
      db.tree_entity.onInsert((_ctx, row) => treeChanges.insert(row));
      db.tree_entity.onUpdate((_ctx, oldRow, row) => treeChanges.update(oldRow, row));
      db.tree_entity.onDelete((_ctx, row) => treeChanges.delete(row));
    }

    if (db.building) {
      const buildingChanges = queueTableChanges<Building>((changes) => {
        const nextBuildings = new Map(this.state.buildings);
        for (const change of changes) {
          if (change.type === 'delete') {
            removeBuildingRow(nextBuildings, change.row, this.state.identityHex);
          } else {
            if (change.type === 'update') {
              removeBuildingRow(nextBuildings, change.oldRow, this.state.identityHex);
            }
            upsertBuildingRow(nextBuildings, change.row, this.state.identityHex);
          }
        }
        this.state.buildings = nextBuildings;
      });
      db.building.onInsert((_ctx, row) => buildingChanges.insert(row));
      db.building.onUpdate((_ctx, oldRow, row) => buildingChanges.update(oldRow, row));
      db.building.onDelete((_ctx, row) => buildingChanges.delete(row));
    }

    bindTable(db.farm_field, () => {
      this.state.farmFields = syncFarmFields(
        db.farm_field ? db.farm_field.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.pasture, () => {
      this.state.pastures = syncPastures(
        db.pasture ? db.pasture.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.livestock_herd, () => {
      this.state.livestockHerds = syncLivestockHerds(
        db.livestock_herd ? db.livestock_herd.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.burgage_zone, () => {
      this.state.burgageZones = syncBurgageZones(
        db.burgage_zone ? db.burgage_zone.iter() : [],
        this.state.identityHex,
      );
    });

    const applyResidenceBundle = (): void => {
      this.state.residences = syncResidences(
        db.residence ? db.residence.iter() : [],
        db.residence_need ? db.residence_need.iter() : [],
        this.state.identityHex,
      );
    };

    bindTable(db.residence, applyResidenceBundle);
    bindTable(db.residence_need, applyResidenceBundle);

    bindTable(db.backyard_garden, () => {
      this.state.backyardGardens = syncBackyardGardens(
        db.backyard_garden ? db.backyard_garden.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.delivery_trip, () => {
      this.state.deliveryTrips = syncDeliveryTrips(
        db.delivery_trip ? db.delivery_trip.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.road_network_state, () => {
      this.state.roads = syncRoadNetwork(
        db.road_network_state ? db.road_network_state.iter() : [],
        this.state.identityHex,
      );
    });
  }
}
