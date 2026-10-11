import type { DbConnection } from '../../generated/index.ts';
import type { Building, CombatAgent, TreeEntity } from '../../generated/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { syncBackyardGardens } from './syncBackyardGardens.ts';
import {
  removeBuildingRow,
  syncBuildings,
  upsertBuildingRow,
} from './syncBuildings.ts';
import { syncBurgageZones } from './syncBurgageZones.ts';
import { syncDeliveryTrips } from './syncDeliveryTrips.ts';
import { syncFireIncidents } from './syncFireIncidents.ts';
import { syncCombatAgents } from './syncCombatAgents.ts';
import { syncMilitaryCompanies } from '../../security/militaryProgression.ts';
import { syncBanditCamps, syncBanditIncidents } from '../../security/banditState.ts';
import { syncActiveRaid } from '../../security/activeRaid.ts';
import { syncForagingNodes } from './syncForagingNodes.ts';
import { syncFarmFields } from './syncFarmFields.ts';
import { syncCorpses, syncGraveyards } from './syncBurials.ts';
import { syncLivestockHerds, syncPastures } from './syncLivestock.ts';
import { syncStableOxen, type StableOxRow } from './syncStableOxen.ts';
import { syncCavalryHorses, type CavalryHorseRow } from './syncCavalryHorses.ts';
import { syncVineyardParcels } from './syncVineyards.ts';
import { syncMarketState } from './syncMarketState.ts';
import { syncPlayerResources } from './syncPlayerResources.ts';
import { syncQuarries } from './syncQuarries.ts';
import { syncResidences } from './syncResidences.ts';
import { syncRoadNetwork } from './syncRoadNetwork.ts';
import { syncSettlementSecurity } from './syncSettlementSecurity.ts';
import { syncSettlements, type SettlementRow } from './syncSettlements.ts';
import { removeTreeRow, syncTrees, upsertTreeRow } from './syncTrees.ts';
import { syncWorldConfig } from './syncWorldConfig.ts';
import { syncTradingPostTradeRules } from './syncTradingPostTradeRules.ts';

type TableHandle = {
  onInsert: (cb: () => void) => void;
  onUpdate: (cb: () => void) => void;
  onDelete: (cb: () => void) => void;
};

type SettlementTableHandle = TableHandle & {
  iter: () => Iterable<SettlementRow>;
};

type StableOxTableHandle = TableHandle & {
  iter: () => Iterable<StableOxRow>;
};

type CavalryHorseTableHandle = TableHandle & {
  iter: () => Iterable<CavalryHorseRow>;
};

function settlementTableFromDb(db: unknown): SettlementTableHandle | undefined {
  return (db as { visible_settlement?: SettlementTableHandle }).visible_settlement;
}

function stableOxTableFromDb(db: unknown): StableOxTableHandle | undefined {
  return (db as { visible_stable_ox?: StableOxTableHandle }).visible_stable_ox;
}

function cavalryHorseTableFromDb(db: unknown): CavalryHorseTableHandle | undefined {
  return (db as { visible_cavalry_horse?: CavalryHorseTableHandle }).visible_cavalry_horse;
}

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
    const settlementTable = settlementTableFromDb(db);
    const stableOxTable = stableOxTableFromDb(db);
    const cavalryHorseTable = cavalryHorseTableFromDb(db);

    syncWorldConfig(db.world_config ? db.world_config.iter() : [], this.state);
    syncPlayerResources(db.visible_player_resources ? db.visible_player_resources.iter() : [], this.state);
    this.state.settlements = syncSettlements(
      settlementTable ? settlementTable.iter() : [],
      this.state.identityHex,
    );
    syncMarketState(db.visible_market_state ? db.visible_market_state.iter() : [], this.state);
    this.state.tradingPostTradeRules = syncTradingPostTradeRules(
      db.visible_trading_post_trade_rule ? db.visible_trading_post_trade_rule.iter() : [],
      this.state.identityHex,
    );
    syncSettlementSecurity(
      db.visible_settlement_security ? db.visible_settlement_security.iter() : [],
      this.state,
    );
    this.state.quarries = syncQuarries(
      db.visible_quarry ? db.visible_quarry.iter() : [],
      db.visible_foraging_node ? db.visible_foraging_node.iter() : [],
    );
    this.state.foragingNodes = syncForagingNodes(db.visible_foraging_node ? db.visible_foraging_node.iter() : []);
    this.state.trees = syncTrees(db.visible_tree_entity ? db.visible_tree_entity.iter() : []);
    this.state.buildings = syncBuildings(db.visible_building ? db.visible_building.iter() : [], this.state.identityHex);
    this.state.farmFields = syncFarmFields(db.visible_farm_field ? db.visible_farm_field.iter() : [], this.state.identityHex);
    this.state.pastures = syncPastures(db.visible_pasture ? db.visible_pasture.iter() : [], this.state.identityHex);
    this.state.vineyardParcels = syncVineyardParcels(
      db.visible_vineyard_parcel ? db.visible_vineyard_parcel.iter() : [],
      this.state.identityHex,
    );
    this.state.graveyards = syncGraveyards(
      db.visible_graveyard ? db.visible_graveyard.iter() : [],
      this.state.identityHex,
    );
    this.state.corpses = syncCorpses(
      db.visible_corpse ? db.visible_corpse.iter() : [],
      this.state.identityHex,
    );
    this.state.livestockHerds = syncLivestockHerds(
      db.visible_pasture_herd ? db.visible_pasture_herd.iter() : [],
      this.state.identityHex,
    );
    this.state.stableOxen = syncStableOxen(
      stableOxTable ? stableOxTable.iter() : [],
      this.state.identityHex,
    );
    this.state.cavalryHorses = syncCavalryHorses(
      cavalryHorseTable ? cavalryHorseTable.iter() : [],
      this.state.identityHex,
    );
    this.state.burgageZones = syncBurgageZones(
      db.visible_burgage_zone ? db.visible_burgage_zone.iter() : [],
      this.state.identityHex,
    );
    this.state.residences = syncResidences(
      db.visible_residence ? db.visible_residence.iter() : [],
      db.visible_residence_need ? db.visible_residence_need.iter() : [],
      this.state.identityHex,
      db.world_config?.id.find(0)?.householdTick ?? 0n,
    );
    this.state.backyardGardens = syncBackyardGardens(
      db.visible_backyard_garden ? db.visible_backyard_garden.iter() : [],
      this.state.identityHex,
    );
    this.state.deliveryTrips = syncDeliveryTrips(
      db.visible_delivery_trip ? db.visible_delivery_trip.iter() : [],
      this.state.identityHex,
    );
    this.state.fireIncidents = syncFireIncidents(
      db.visible_fire_incident ? db.visible_fire_incident.iter() : [],
      this.state.identityHex,
      this.state.simTick,
    );
    this.state.combatAgents = syncCombatAgents(
      db.visible_combat_agent ? db.visible_combat_agent.iter() : [],
      this.state.identityHex,
      db.visible_military_company ? db.visible_military_company.iter() : [],
    );
    this.state.militaryCompanies = syncMilitaryCompanies(
      db.visible_military_company ? db.visible_military_company.iter() : [],
      this.state.identityHex,
    );
    this.state.banditCamps = syncBanditCamps(
      db.visible_bandit_camp ? db.visible_bandit_camp.iter() : [],
      this.state.identityHex,
    );
    this.state.banditIncidents = syncBanditIncidents(
      db.visible_bandit_incident ? db.visible_bandit_incident.iter() : [],
      this.state.identityHex,
    );
    this.state.activeRaid = syncActiveRaid(
      db.visible_active_raid ? db.visible_active_raid.iter() : [],
      this.state.identityHex,
    );
    this.state.roads = syncRoadNetwork(
      db.visible_road_network_state ? db.visible_road_network_state.iter() : [],
      this.state.identityHex,
    );

    this.onChanged();
  }

  syncBuildings(connection: DbConnection): void {
    const db = connection.db;
    this.state.buildings = syncBuildings(
      db.visible_building ? db.visible_building.iter() : [],
      this.state.identityHex,
    );
    this.onChanged();
  }

  syncResidences(connection: DbConnection): void {
    const db = connection.db;
    this.state.residences = syncResidences(
      db.visible_residence ? db.visible_residence.iter() : [],
      db.visible_residence_need ? db.visible_residence_need.iter() : [],
      this.state.identityHex,
      db.world_config?.id.find(0)?.householdTick ?? 0n,
    );
    this.onChanged();
  }

  attachHandlers(connection: DbConnection): void {
    const db = connection.db;
    const settlementTable = settlementTableFromDb(db);
    const stableOxTable = stableOxTableFromDb(db);
    const cavalryHorseTable = cavalryHorseTableFromDb(db);
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
      scheduleResidenceBundle();
      this.state.fireIncidents = syncFireIncidents(
        db.visible_fire_incident ? db.visible_fire_incident.iter() : [],
        this.state.identityHex,
        this.state.simTick,
      );
    }, false);

    bindTable(db.visible_player_resources, () => {
      syncPlayerResources(db.visible_player_resources ? db.visible_player_resources.iter() : [], this.state);
    }, false);

    bindTable(settlementTable, () => {
      this.state.settlements = syncSettlements(
        settlementTable ? settlementTable.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_market_state, () => {
      syncMarketState(db.visible_market_state ? db.visible_market_state.iter() : [], this.state);
    }, false);

    bindTable(db.visible_trading_post_trade_rule, () => {
      this.state.tradingPostTradeRules = syncTradingPostTradeRules(
        db.visible_trading_post_trade_rule ? db.visible_trading_post_trade_rule.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_settlement_security, () => {
      syncSettlementSecurity(
        db.visible_settlement_security ? db.visible_settlement_security.iter() : [],
        this.state,
      );
    }, false);

    let quarryRowsChanged = false;
    let foragingRowsChanged = false;
    let resourceNodesPending = false;
    const scheduleResourceNodes = (): void => {
      if (resourceNodesPending) return;
      resourceNodesPending = true;
      queueMicrotask(() => {
        resourceNodesPending = false;
        if (foragingRowsChanged) {
          this.state.foragingNodes = syncForagingNodes(
            db.visible_foraging_node ? db.visible_foraging_node.iter() : [],
          );
        }
        if (quarryRowsChanged || foragingRowsChanged) {
          this.state.quarries = syncQuarries(
            db.visible_quarry ? db.visible_quarry.iter() : [],
            db.visible_foraging_node ? db.visible_foraging_node.iter() : [],
          );
        }
        quarryRowsChanged = false;
        foragingRowsChanged = false;
        notify();
      });
    };
    const bindResourceNodeTable = (
      table: TableHandle | undefined,
      markChanged: () => void,
    ): void => {
      if (!table) return;
      const handler = (): void => {
        markChanged();
        scheduleResourceNodes();
      };
      table.onInsert(handler);
      table.onUpdate(handler);
      table.onDelete(handler);
    };
    bindResourceNodeTable(db.visible_quarry, () => {
      quarryRowsChanged = true;
    });
    bindResourceNodeTable(db.visible_foraging_node, () => {
      foragingRowsChanged = true;
    });

    if (db.visible_tree_entity) {
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
      db.visible_tree_entity.onInsert((_ctx, row) => treeChanges.insert(row));
      db.visible_tree_entity.onUpdate((_ctx, oldRow, row) => treeChanges.update(oldRow, row));
      db.visible_tree_entity.onDelete((_ctx, row) => treeChanges.delete(row));
    }

    if (db.visible_building) {
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
      db.visible_building.onInsert((_ctx, row) => buildingChanges.insert(row));
      db.visible_building.onUpdate((_ctx, oldRow, row) => buildingChanges.update(oldRow, row));
      db.visible_building.onDelete((_ctx, row) => buildingChanges.delete(row));
    }

    bindTable(db.visible_farm_field, () => {
      this.state.farmFields = syncFarmFields(
        db.visible_farm_field ? db.visible_farm_field.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_pasture, () => {
      this.state.pastures = syncPastures(
        db.visible_pasture ? db.visible_pasture.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_vineyard_parcel, () => {
      this.state.vineyardParcels = syncVineyardParcels(
        db.visible_vineyard_parcel ? db.visible_vineyard_parcel.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_graveyard, () => {
      this.state.graveyards = syncGraveyards(
        db.visible_graveyard ? db.visible_graveyard.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_corpse, () => {
      this.state.corpses = syncCorpses(
        db.visible_corpse ? db.visible_corpse.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_pasture_herd, () => {
      this.state.livestockHerds = syncLivestockHerds(
        db.visible_pasture_herd ? db.visible_pasture_herd.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(stableOxTable, () => {
      this.state.stableOxen = syncStableOxen(
        stableOxTable ? stableOxTable.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(cavalryHorseTable, () => {
      this.state.cavalryHorses = syncCavalryHorses(
        cavalryHorseTable ? cavalryHorseTable.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_burgage_zone, () => {
      this.state.burgageZones = syncBurgageZones(
        db.visible_burgage_zone ? db.visible_burgage_zone.iter() : [],
        this.state.identityHex,
      );
    });

    let residenceBundlePending = false;
    const scheduleResidenceBundle = (): void => {
      if (residenceBundlePending) return;
      residenceBundlePending = true;
      queueMicrotask(() => {
        residenceBundlePending = false;
        this.state.residences = syncResidences(
          db.visible_residence ? db.visible_residence.iter() : [],
          db.visible_residence_need ? db.visible_residence_need.iter() : [],
          this.state.identityHex,
          db.world_config?.id.find(0)?.householdTick ?? 0n,
        );
        notify();
      });
    };
    const bindResidenceBundleTable = (table: TableHandle | undefined): void => {
      if (!table) return;
      table.onInsert(scheduleResidenceBundle);
      table.onUpdate(scheduleResidenceBundle);
      table.onDelete(scheduleResidenceBundle);
    };
    bindResidenceBundleTable(db.visible_residence);
    bindResidenceBundleTable(db.visible_residence_need);

    bindTable(db.visible_backyard_garden, () => {
      this.state.backyardGardens = syncBackyardGardens(
        db.visible_backyard_garden ? db.visible_backyard_garden.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_delivery_trip, () => {
      this.state.deliveryTrips = syncDeliveryTrips(
        db.visible_delivery_trip ? db.visible_delivery_trip.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_fire_incident, () => {
      this.state.fireIncidents = syncFireIncidents(
        db.visible_fire_incident ? db.visible_fire_incident.iter() : [],
        this.state.identityHex,
        this.state.simTick,
      );
    });

    if (db.visible_combat_agent) {
      const combatChanges = queueTableChanges<CombatAgent>(() => {
        this.state.combatAgents = syncCombatAgents(
          db.visible_combat_agent ? db.visible_combat_agent.iter() : [],
          this.state.identityHex,
          db.visible_military_company ? db.visible_military_company.iter() : [],
        );
      });
      db.visible_combat_agent.onInsert((_ctx, row) => combatChanges.insert(row));
      db.visible_combat_agent.onUpdate((_ctx, oldRow, row) =>
        combatChanges.update(oldRow, row)
      );
      db.visible_combat_agent.onDelete((_ctx, row) => combatChanges.delete(row));
    }

    bindTable(db.visible_military_company, () => {
      this.state.militaryCompanies = syncMilitaryCompanies(
        db.visible_military_company ? db.visible_military_company.iter() : [],
        this.state.identityHex,
      );
      // A pace/facing order can arrive without any soldier moving this tick.
      const orders = new Map([...(db.visible_military_company?.iter() ?? [])].map(row => [row.id.toString(), row]));
      let agents = this.state.combatAgents;
      for (const [id, agent] of agents) {
        const company = agent.companyId ? orders.get(agent.companyId) : undefined;
        if (!company) continue;
        const running = company.running && company.fatigue < 0.95;
        if (agent.running === running && agent.companyFacingX === company.facingX && agent.companyFacingZ === company.facingZ) continue;
        if (agents === this.state.combatAgents) agents = new Map(agents);
        agents.set(id, { ...agent, running, companyFacingX: company.facingX, companyFacingZ: company.facingZ });
      }
      this.state.combatAgents = agents;
    });

    bindTable(db.visible_bandit_camp, () => {
      this.state.banditCamps = syncBanditCamps(
        db.visible_bandit_camp ? db.visible_bandit_camp.iter() : [],
        this.state.identityHex,
      );
    });
    bindTable(db.visible_bandit_incident, () => {
      this.state.banditIncidents = syncBanditIncidents(
        db.visible_bandit_incident ? db.visible_bandit_incident.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_active_raid, () => {
      this.state.activeRaid = syncActiveRaid(
        db.visible_active_raid ? db.visible_active_raid.iter() : [],
        this.state.identityHex,
      );
    });

    bindTable(db.visible_road_network_state, () => {
      this.state.roads = syncRoadNetwork(
        db.visible_road_network_state ? db.visible_road_network_state.iter() : [],
        this.state.identityHex,
      );
    });
  }
}
