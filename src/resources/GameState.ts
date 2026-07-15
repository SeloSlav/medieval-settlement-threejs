import {
  createEmptyStockpile,
  isBuildingKind,
  type BuildingState,
  type ForagingNodeState,
  type GameState,
  type ResourceNodeState,
  type TreeEntityState,
} from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { getBuildingDefinition } from './buildings.ts';
import type { BuildingKind } from './types.ts';

export function createInitialGameState(registry: WorldLayoutRegistry, seed: number): GameState {
  const quarries = new Map<string, ResourceNodeState>();
  const foragingNodes = new Map<string, ForagingNodeState>();
  for (const definition of registry.definitionList) {
    const nodeState = {
      nodeId: definition.id,
      kind: definition.kind,
      resource: definition.resource,
      remaining: definition.maxYield,
      maxYield: definition.maxYield,
      x: definition.x,
      z: definition.z,
    };
    if (definition.kind === 'quarry') {
      quarries.set(definition.id, nodeState);
    } else {
      foragingNodes.set(definition.id, nodeState);
    }
  }

  return {
    seed,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries,
    foragingNodes,
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: 1,
  };
}

export function initTreeEntities(state: GameState, treeRegistry: TreeRegistry): GameState {
  const trees = new Map<string, TreeEntityState>();
  for (const entry of treeRegistry.entries) {
    trees.set(entry.id, {
      treeId: entry.id,
      layoutIndex: entry.layoutIndex,
      phase: 'mature',
      growthProgress: 1,
    });
  }
  return { ...state, trees };
}

export type PlaceBuildingResult =
  | { ok: true; state: GameState; building: BuildingState }
  | { ok: false; state: GameState; error: string };

export function placeBuilding(state: GameState, kind: BuildingKind, x: number, z: number): PlaceBuildingResult {
  if (!isBuildingKind(kind)) {
    return { ok: false, state, error: 'Unknown building kind.' };
  }

  const definition = getBuildingDefinition(kind);
  const id = `building-${state.nextBuildingId}`;
  const building: BuildingState = {
    id,
    kind,
    x,
    z,
    workRadius: definition.workRadius,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    gold: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };

  const buildings = new Map(state.buildings);
  buildings.set(id, building);

  return {
    ok: true,
    building,
    state: {
      ...state,
      tick: state.tick + 1,
      nextBuildingId: state.nextBuildingId + 1,
      buildings,
    },
  };
}

export type ExtractFromQuarryResult =
  | { ok: true; state: GameState; extracted: number }
  | { ok: false; state: GameState; error: string };

export function extractFromQuarry(state: GameState, nodeId: string, amount: number): ExtractFromQuarryResult {
  const node = state.quarries.get(nodeId);
  if (!node) {
    return { ok: false, state, error: 'Unknown quarry.' };
  }
  if (amount <= 0) {
    return { ok: false, state, error: 'Amount must be positive.' };
  }

  const extracted = Math.min(amount, node.remaining);
  if (extracted <= 0) {
    return { ok: false, state, error: 'Nothing left to extract.' };
  }

  const quarries = new Map(state.quarries);
  quarries.set(nodeId, { ...node, remaining: node.remaining - extracted });

  const stockpile = { ...state.stockpile };
  stockpile[node.resource] += extracted;

  return {
    ok: true,
    extracted,
    state: {
      ...state,
      tick: state.tick + 1,
      stockpile,
      quarries,
    },
  };
}
