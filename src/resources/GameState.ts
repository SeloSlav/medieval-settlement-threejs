import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import {
  createEmptyStockpile,
  isBuildingKind,
  RESOURCE_KINDS,
  type BuildingState,
  type GameState,
  type GameStateSnapshot,
  type GameStateSnapshotV1,
  type QuarryNodeState,
  type ResourceStockpile,
  type TreeEntityState,
} from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { getBuildingDefinition } from './buildings.ts';
import type { BuildingKind } from './types.ts';

export function createInitialGameState(registry: WorldLayoutRegistry, seed: number): GameState {
  const quarries = new Map<string, QuarryNodeState>();
  const foragingNodes = new Map<string, QuarryNodeState>();
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

export function gameStateToSnapshot(state: GameState, roads: RoadNetworkSnapshot): GameStateSnapshot {
  return {
    version: 2,
    seed: state.seed,
    tick: state.tick,
    stockpile: { ...state.stockpile },
    quarries: [...state.quarries.values()],
    foragingNodes: [...state.foragingNodes.values()],
    trees: [...state.trees.values()],
    buildings: [...state.buildings.values()],
    roads,
  };
}

export function restoreGameState(
  snapshot: GameStateSnapshot | GameStateSnapshotV1,
  registry: WorldLayoutRegistry,
  treeRegistry?: TreeRegistry | null,
): GameState {
  if (snapshot.version === 1) {
    return restoreFromV1(snapshot, registry, treeRegistry);
  }
  if (snapshot.version !== 2) {
    throw new Error(`Unsupported game state version: ${String((snapshot as GameStateSnapshot).version)}`);
  }

  const quarries = restoreQuarries(snapshot.quarries, registry);
  const foragingNodes = restoreForagingNodes(snapshot.foragingNodes ?? [], registry);
  const trees = restoreTrees(snapshot.trees, treeRegistry);
  const buildings = restoreBuildings(snapshot.buildings);

  return {
    seed: snapshot.seed,
    tick: Math.max(0, snapshot.tick),
    stockpile: normalizeStockpile(snapshot.stockpile),
    quarries,
    foragingNodes,
    trees,
    buildings,
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: inferNextBuildingId(buildings),
  };
}

export function serializeGameState(snapshot: GameStateSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function deserializeGameState(raw: string): GameStateSnapshot | GameStateSnapshotV1 {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Game state must be a JSON object.');
  }
  return validateSnapshot(parsed as Partial<GameStateSnapshot | GameStateSnapshotV1>);
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
    waterCapacity: 0,
    assignedLabor: 0,
    gold: 0,
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

function restoreFromV1(
  snapshot: GameStateSnapshotV1,
  registry: WorldLayoutRegistry,
  treeRegistry?: TreeRegistry | null,
): GameState {
  const quarries = restoreQuarries(snapshot.nodes, registry);
  const trees = treeRegistry ? restoreTrees([], treeRegistry, true) : new Map<string, TreeEntityState>();

  return {
    seed: snapshot.seed,
    tick: Math.max(0, snapshot.tick),
    stockpile: normalizeStockpile(snapshot.stockpile),
    quarries,
    foragingNodes: restoreForagingNodes([], registry),
    trees,
    buildings: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: 1,
  };
}

function restoreQuarries(nodes: QuarryNodeState[], registry: WorldLayoutRegistry): Map<string, QuarryNodeState> {
  const quarries = new Map<string, QuarryNodeState>();
  for (const node of nodes) {
    const definition = registry.getDefinition(node.nodeId);
    if (!definition) continue;
    quarries.set(node.nodeId, {
      nodeId: node.nodeId,
      kind: definition.kind,
      resource: definition.resource,
      remaining: clamp(node.remaining, 0, definition.maxYield),
      maxYield: definition.maxYield,
      x: node.x ?? definition.x,
      z: node.z ?? definition.z,
    });
  }

  for (const definition of registry.definitionList) {
    if (quarries.has(definition.id)) continue;
    quarries.set(definition.id, {
      nodeId: definition.id,
      kind: definition.kind,
      resource: definition.resource,
      remaining: definition.maxYield,
      maxYield: definition.maxYield,
      x: definition.x,
      z: definition.z,
    });
  }

  return quarries;
}

function restoreForagingNodes(
  nodes: QuarryNodeState[],
  registry: WorldLayoutRegistry,
  fillMissing = true,
): Map<string, QuarryNodeState> {
  const foragingNodes = new Map<string, QuarryNodeState>();
  for (const node of nodes) {
    const definition = registry.getDefinition(node.nodeId);
    if (!definition || (definition.kind !== 'game' && definition.kind !== 'berries')) continue;
    foragingNodes.set(node.nodeId, {
      nodeId: node.nodeId,
      kind: definition.kind,
      resource: definition.resource,
      remaining: Math.max(0, node.remaining),
      maxYield: definition.maxYield,
      x: definition.x,
      z: definition.z,
    });
  }

  if (fillMissing) {
    for (const definition of registry.definitionList) {
      if (definition.kind !== 'game' && definition.kind !== 'berries') continue;
      if (foragingNodes.has(definition.id)) continue;
      foragingNodes.set(definition.id, {
        nodeId: definition.id,
        kind: definition.kind,
        resource: definition.resource,
        remaining: definition.maxYield,
        maxYield: definition.maxYield,
        x: definition.x,
        z: definition.z,
      });
    }
  }

  return foragingNodes;
}

function restoreTrees(
  nodes: Array<TreeEntityState & { regrowProgress?: number }>,
  treeRegistry?: TreeRegistry | null,
  fillMissing = false,
): Map<string, TreeEntityState> {
  const trees = new Map<string, TreeEntityState>();
  if (!treeRegistry) return trees;

  for (const node of nodes) {
    const entry = treeRegistry.getEntry(node.treeId);
    if (!entry) continue;
    const normalized = normalizeTreeEntity(node);
    trees.set(node.treeId, {
      treeId: node.treeId,
      layoutIndex: entry.layoutIndex,
      phase: normalized.phase,
      growthProgress: normalized.growthProgress,
    });
  }

  if (fillMissing || nodes.length === 0) {
    for (const entry of treeRegistry.entries) {
      if (trees.has(entry.id)) continue;
      trees.set(entry.id, {
        treeId: entry.id,
        layoutIndex: entry.layoutIndex,
        phase: 'mature',
        growthProgress: 1,
      });
    }
  }

  return trees;
}

function normalizeTreeEntity(node: { phase: string; growthProgress?: number; regrowProgress?: number }): Pick<TreeEntityState, 'phase' | 'growthProgress'> {
  const progress = node.growthProgress ?? node.regrowProgress ?? 0;
  switch (node.phase) {
    case 'mature':
      return { phase: 'mature', growthProgress: 1 };
    case 'growing':
      return { phase: 'growing', growthProgress: clamp01(progress) };
    case 'stump':
      return { phase: 'stump', growthProgress: 0 };
    case 'standing':
      return { phase: 'mature', growthProgress: 1 };
    case 'felled':
    case 'felling':
      return { phase: 'stump', growthProgress: 0 };
    case 'regrowing':
      return { phase: 'growing', growthProgress: clamp01(progress || 0.1) };
    default:
      return { phase: 'mature', growthProgress: 1 };
  }
}

function restoreBuildings(buildings: BuildingState[]): Map<string, BuildingState> {
  const map = new Map<string, BuildingState>();
  for (const building of buildings) {
    if (!isBuildingKind(building.kind)) continue;
    const definition = getBuildingDefinition(building.kind);
    map.set(building.id, {
      id: building.id,
      kind: building.kind,
      x: building.x,
      z: building.z,
      workRadius: definition.workRadius,
      actionCooldown: Math.max(0, building.actionCooldown),
      timber: building.timber ?? 0,
      firewood: building.firewood ?? 0,
      stone: building.stone ?? 0,
      water: building.water ?? 0,
      food: building.food ?? 0,
      waterCapacity: building.waterCapacity ?? 0,
      assignedLabor: building.assignedLabor ?? 0,
      gold: building.gold ?? 0,
    });
  }
  return map;
}

function inferNextBuildingId(buildings: Map<string, BuildingState>): number {
  let maxId = 0;
  for (const building of buildings.values()) {
    const match = /^building-(\d+)$/.exec(building.id);
    if (!match) continue;
    maxId = Math.max(maxId, Number.parseInt(match[1], 10));
  }
  return maxId + 1;
}

function validateSnapshot(value: Partial<GameStateSnapshot | GameStateSnapshotV1>): GameStateSnapshot | GameStateSnapshotV1 {
  if (value.version === 1) {
    if (typeof value.seed !== 'number') throw new Error('Missing seed.');
    if (typeof value.tick !== 'number') throw new Error('Missing tick.');
    if (!value.stockpile) throw new Error('Missing stockpile.');
    if (!Array.isArray(value.nodes)) throw new Error('Missing nodes.');
    if (!value.roads) throw new Error('Missing roads.');
    return {
      version: 1,
      seed: value.seed,
      tick: value.tick,
      stockpile: normalizeStockpile(value.stockpile as Partial<ResourceStockpile>),
      nodes: value.nodes as QuarryNodeState[],
      roads: value.roads as RoadNetworkSnapshot,
    };
  }

  if (value.version !== 2) throw new Error('Unsupported game state version.');
  if (typeof value.seed !== 'number') throw new Error('Missing seed.');
  if (typeof value.tick !== 'number') throw new Error('Missing tick.');
  if (!value.stockpile) throw new Error('Missing stockpile.');
  if (!Array.isArray(value.quarries)) throw new Error('Missing quarries.');
  if (!Array.isArray(value.trees)) throw new Error('Missing trees.');
  if (!Array.isArray(value.buildings)) throw new Error('Missing buildings.');
  if (!value.roads) throw new Error('Missing roads.');

  return {
    version: 2,
    seed: value.seed,
    tick: value.tick,
    stockpile: normalizeStockpile(value.stockpile as Partial<ResourceStockpile>),
    quarries: value.quarries as QuarryNodeState[],
    foragingNodes: (value.foragingNodes ?? []) as QuarryNodeState[],
    trees: value.trees as TreeEntityState[],
    buildings: value.buildings as BuildingState[],
    roads: value.roads as RoadNetworkSnapshot,
  };
}

function normalizeStockpile(value: Partial<ResourceStockpile> & { wood?: number }): ResourceStockpile {
  const stockpile = createEmptyStockpile();
  for (const kind of RESOURCE_KINDS) {
    const amount = value[kind];
    stockpile[kind] = typeof amount === 'number' && Number.isFinite(amount) ? Math.max(0, amount) : 0;
  }
  if (typeof value.wood === 'number' && Number.isFinite(value.wood) && stockpile.timber === 0) {
    stockpile.timber = Math.max(0, value.wood);
  }
  if (typeof value.gold === 'number' && Number.isFinite(value.gold)) {
    stockpile.gold = Math.max(0, value.gold);
  }
  return stockpile;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
