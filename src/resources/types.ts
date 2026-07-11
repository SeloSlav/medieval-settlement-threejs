import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';

export const RESOURCE_KINDS = ['timber', 'stone', 'firewood', 'water', 'game', 'berries', 'food'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_NODE_KINDS = ['quarry', 'game', 'berries'] as const;
export type ResourceNodeKind = (typeof RESOURCE_NODE_KINDS)[number];

export const TREE_PHASES = ['stump', 'growing', 'mature'] as const;
export type TreePhase = (typeof TREE_PHASES)[number];

import { BUILDING_KINDS, type BuildingKind } from '../generated/gameBalance.ts';
import type { ResidenceNeedsState } from '../residences/residenceNeedState.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';

export type { BuildingKind };
export { BUILDING_KINDS };

export type ResourceNodeDefinition = {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  x: number;
  z: number;
  label: string;
  maxYield: number;
  pickRadius: number;
  quarryKind?: 'large' | 'small';
};

export type ResourceNodeState = {
  nodeId: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  remaining: number;
  maxYield: number;
  x: number;
  z: number;
};

/** @deprecated Use ResourceNodeState */
export type QuarryNodeState = ResourceNodeState;

export type ForagingNodeState = ResourceNodeState;

export type TreeLayoutEntry = {
  id: string;
  layoutIndex: number;
  x: number;
  z: number;
  woodYield: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  species: string;
  scale: number;
};

export type TreeEntityState = {
  treeId: string;
  layoutIndex: number;
  phase: TreePhase;
  growthProgress: number;
};

export type BuildingState = {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  workRadius: number;
  actionCooldown: number;
  timber: number;
  firewood: number;
  stone: number;
  water: number;
  food: number;
  gold: number;
  waterCapacity: number;
  assignedLabor: number;
};

export type BurgageFrontageEdge = 0 | 1 | 2 | 3;

export type BurgageZoneState = {
  id: string;
  cornerA: { x: number; z: number };
  cornerB: { x: number; z: number };
  cornerC: { x: number; z: number };
  cornerD: { x: number; z: number };
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type ResidenceState = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
  population: number;
  populationCapacity: number;
  settlementTicks: number;
  needs: ResidenceNeedsState;
  abandoned: boolean;
  householdWealth: number;
};

export type BackyardGardenState = {
  id: string;
  residenceId: string;
  kind: import('../generated/gameBalance.ts').BackyardGardenKind;
};

export type ResourceStockpile = Record<ResourceKind, number> & { gold: number };

export type GameStateSnapshotV1 = {
  version: 1;
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  nodes: QuarryNodeState[];
  roads: RoadNetworkSnapshot;
};

export type GameStateSnapshot = {
  version: 2;
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  quarries: QuarryNodeState[];
  foragingNodes: ForagingNodeState[];
  trees: TreeEntityState[];
  buildings: BuildingState[];
  roads: RoadNetworkSnapshot;
};

export type GameState = {
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  quarries: Map<string, QuarryNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  nextBuildingId: number;
};

export type InspectableTarget =
  | {
      kind: 'quarry';
      definition: ResourceNodeDefinition;
      state: QuarryNodeState;
    }
  | {
      kind: 'foraging';
      definition: ResourceNodeDefinition;
      state: ForagingNodeState;
    }
  | {
      kind: 'building';
      building: BuildingState;
      matureTrees: number;
      stumpTrees: number;
      growingTrees: number;
    }
  | {
      kind: 'river';
      x: number;
      z: number;
      shoreDistance: number;
      onWater: boolean;
    }
  | {
      kind: 'residence';
      residence: ResidenceState;
      zone: BurgageZoneState;
      residenceCount: number;
    }
  | {
      kind: 'backyard';
      residence: ResidenceState;
      zone: BurgageZoneState;
      garden: BackyardGardenState | null;
    };

export function createEmptyStockpile(): ResourceStockpile {
  return { timber: 0, stone: 0, firewood: 0, water: 0, game: 0, berries: 0, food: 0, gold: 0 };
}

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isBuildingKind(value: string): value is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(value);
}

export function isTreePhase(value: string): value is TreePhase {
  return (TREE_PHASES as readonly string[]).includes(value);
}
