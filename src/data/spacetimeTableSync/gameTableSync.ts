import type { DbConnection } from '../../generated/index.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { syncBackyardGardens } from './syncBackyardGardens.ts';
import { syncBuildings } from './syncBuildings.ts';
import { syncBurgageZones } from './syncBurgageZones.ts';
import { syncDeliveryTrips } from './syncDeliveryTrips.ts';
import { syncForagingNodes } from './syncForagingNodes.ts';
import { syncPlayerResources } from './syncPlayerResources.ts';
import { syncQuarries } from './syncQuarries.ts';
import { syncResidences } from './syncResidences.ts';
import { syncRoadNetwork } from './syncRoadNetwork.ts';
import { syncTrees } from './syncTrees.ts';
import { syncWorldConfig } from './syncWorldConfig.ts';

type TableHandle = {
  onInsert: (cb: () => void) => void;
  onUpdate: (cb: () => void) => void;
  onDelete: (cb: () => void) => void;
};

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
    this.state.quarries = syncQuarries(db.quarry ? db.quarry.iter() : []);
    this.state.foragingNodes = syncForagingNodes(db.foraging_node ? db.foraging_node.iter() : []);
    this.state.trees = syncTrees(db.tree_entity ? db.tree_entity.iter() : []);
    this.state.buildings = syncBuildings(db.building ? db.building.iter() : [], this.state.identityHex);
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
    const notify = (): void => {
      this.onChanged();
    };

    const bindTable = (
      table: TableHandle | undefined,
      apply: () => void,
      withDelete = true,
    ): void => {
      if (!table) return;
      const handler = (): void => {
        apply();
        notify();
      };
      table.onInsert(handler);
      table.onUpdate(handler);
      if (withDelete) {
        table.onDelete(handler);
      }
    };

    bindTable(db.world_config, () => {
      syncWorldConfig(db.world_config ? db.world_config.iter() : [], this.state);
    }, false);

    bindTable(db.player_resources, () => {
      syncPlayerResources(db.player_resources ? db.player_resources.iter() : [], this.state);
    }, false);

    bindTable(db.quarry, () => {
      this.state.quarries = syncQuarries(db.quarry ? db.quarry.iter() : []);
    });

    bindTable(db.foraging_node, () => {
      this.state.foragingNodes = syncForagingNodes(db.foraging_node ? db.foraging_node.iter() : []);
    });

    bindTable(db.tree_entity, () => {
      this.state.trees = syncTrees(db.tree_entity ? db.tree_entity.iter() : []);
    });

    bindTable(db.building, () => {
      this.state.buildings = syncBuildings(db.building ? db.building.iter() : [], this.state.identityHex);
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
