import type { GameState, TreeEntityState } from './types.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { getBuildingDefinition } from './buildings.ts';

export type SimulationStepResult = {
  state: GameState;
  changedTreeIds: string[];
};

export class Simulation {
  private readonly treeRegistry: TreeRegistry;

  constructor(treeRegistry: TreeRegistry) {
    this.treeRegistry = treeRegistry;
  }

  step(state: GameState, dt: number): SimulationStepResult {
    let nextState = state;
    const changedTreeIds = new Set<string>();

    for (const building of nextState.buildings.values()) {
      if (building.kind === 'lumber_mill') {
        const result = stepLumberMill(nextState, building.id, this.treeRegistry, dt);
        nextState = result.state;
        for (const treeId of result.changedTreeIds) changedTreeIds.add(treeId);
        continue;
      }

      if (building.kind === 'reforester') {
        const result = stepReforester(nextState, building.id, this.treeRegistry, dt);
        nextState = result.state;
        for (const treeId of result.changedTreeIds) changedTreeIds.add(treeId);
      }
    }

    if (changedTreeIds.size > 0) {
      nextState = { ...nextState, tick: nextState.tick + 1 };
    }

    return { state: nextState, changedTreeIds: [...changedTreeIds] };
  }
}

function stepLumberMill(
  state: GameState,
  buildingId: string,
  treeRegistry: TreeRegistry,
  dt: number,
): SimulationStepResult {
  const building = state.buildings.get(buildingId);
  if (!building) return { state, changedTreeIds: [] };

  const definition = getBuildingDefinition(building.kind);
  let cooldown = Math.max(0, building.actionCooldown - dt);
  const buildings = new Map(state.buildings);
  const changedTreeIds: string[] = [];

  if (cooldown > 0) {
    buildings.set(buildingId, { ...building, actionCooldown: cooldown });
    return { state: { ...state, buildings }, changedTreeIds };
  }

  const harvestTarget = findNearestMatureTree(state, treeRegistry, building.x, building.z, building.workRadius);
  if (!harvestTarget) {
    buildings.set(buildingId, { ...building, actionCooldown: definition.harvestInterval });
    return { state: { ...state, buildings }, changedTreeIds };
  }

  const trees = new Map(state.trees);
  trees.set(harvestTarget.treeId, {
    ...harvestTarget,
    phase: 'stump',
    growthProgress: 0,
  });

  const stockpile = { ...state.stockpile };
  const layoutEntry = treeRegistry.getEntry(harvestTarget.treeId);
  stockpile.wood += layoutEntry?.woodYield ?? 1;

  cooldown = definition.harvestInterval;
  buildings.set(buildingId, { ...building, actionCooldown: cooldown });
  changedTreeIds.push(harvestTarget.treeId);

  return {
    state: { ...state, stockpile, trees, buildings },
    changedTreeIds,
  };
}

function stepReforester(
  state: GameState,
  buildingId: string,
  treeRegistry: TreeRegistry,
  dt: number,
): SimulationStepResult {
  const building = state.buildings.get(buildingId);
  if (!building) return { state, changedTreeIds: [] };

  const definition = getBuildingDefinition(building.kind);
  const candidates = treeRegistry.treesInRadius(building.x, building.z, building.workRadius);
  const trees = new Map(state.trees);
  const changedTreeIds: string[] = [];

  for (const entry of candidates) {
    const entity = trees.get(entry.id);
    if (!entity) continue;

    if (entity.phase === 'stump') {
      trees.set(entry.id, {
        ...entity,
        phase: 'growing',
        growthProgress: definition.regrowRatePerSecond * dt,
      });
      changedTreeIds.push(entry.id);
      continue;
    }

    if (entity.phase !== 'growing') continue;

    const growthProgress = entity.growthProgress + definition.regrowRatePerSecond * dt;
    if (growthProgress >= 1) {
      trees.set(entry.id, { ...entity, phase: 'mature', growthProgress: 1 });
    } else {
      trees.set(entry.id, { ...entity, growthProgress });
    }
    changedTreeIds.push(entry.id);
  }

  if (changedTreeIds.length === 0) return { state, changedTreeIds: [] };
  return { state: { ...state, trees }, changedTreeIds };
}

function findNearestMatureTree(
  state: GameState,
  treeRegistry: TreeRegistry,
  x: number,
  z: number,
  radius: number,
): TreeEntityState | null {
  let best: TreeEntityState | null = null;
  let bestDistance = Infinity;

  for (const entry of treeRegistry.treesInRadius(x, z, radius)) {
    const entity = state.trees.get(entry.id);
    if (!entity || entity.phase !== 'mature') continue;
    const distance = Math.hypot(entry.x - x, entry.z - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = entity;
  }

  return best;
}
