import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import type { ParishPolicyState } from '../../economy/chapelParish.ts';
import type { MonasteryPolicyState } from '../../economy/monasteryPolicy.ts';
import type { RoadNetworkSnapshot } from '../../roads/RoadNetwork.ts';
import type { AuthoritativeWorldGeneration } from '../../world/worldConfigAuthority.ts';
import type {
  BackyardGardenState,
  BuildingState,
  BurgageZoneState,
  ForagingNodeState,
  FarmFieldState,
  LivestockHerdState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  ResourceStockpile,
  TreeEntityState,
} from '../../resources/types.ts';
import type { GameSpeed } from '../../world/gameSpeed.ts';
import type { FireIncidentState } from '../../fires/fireIncident.ts';
import type { SettlementSecurityState } from '../../security/frontierSecurity.ts';

export type GameTableSyncState = {
  identityHex: string | null;
  simTick: number;
  gameSpeed: GameSpeed;
  worldGeneration: AuthoritativeWorldGeneration | null;
  stockpile: ResourceStockpile;
  physicalFoundingSiteEnabled: boolean;
  legacyUnhousedPopulationBonusEnabled: boolean;
  economicActivityTaxRate: number;
  seasonalLaborStewardEnabled: boolean;
  constructionLaborStewardEnabled: boolean;
  productionLaborStewardEnabled: boolean;
  laborStewardReserve: number;
  parishPolicy: ParishPolicyState;
  monasteryPolicy: MonasteryPolicyState;
  marketState: RegionalMarketState;
  quarries: Map<string, ResourceNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  farmFields: Map<string, FarmFieldState>;
  pastures: Map<string, PastureState>;
  livestockHerds: Map<string, LivestockHerdState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  fireIncidents: Map<string, FireIncidentState>;
  settlementSecurity: SettlementSecurityState;
  roads: RoadNetworkSnapshot | null;
};
