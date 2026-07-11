import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import type { ParishPolicyState } from '../../economy/chapelParish.ts';
import type { RoadNetworkSnapshot } from '../../roads/RoadNetwork.ts';
import type {
  BackyardGardenState,
  BuildingState,
  BurgageZoneState,
  ForagingNodeState,
  QuarryNodeState,
  ResidenceState,
  ResourceStockpile,
  TreeEntityState,
} from '../../resources/types.ts';

export type GameTableSyncState = {
  identityHex: string | null;
  simTick: number;
  stockpile: ResourceStockpile;
  economicActivityTaxRate: number;
  parishPolicy: ParishPolicyState;
  quarries: Map<string, QuarryNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  roads: RoadNetworkSnapshot | null;
};
