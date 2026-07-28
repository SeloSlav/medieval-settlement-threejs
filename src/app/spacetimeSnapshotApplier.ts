import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { buildingMarkerSignatures } from '../buildings/buildingMarkerSignature.ts';
import type { BurgageFencing } from '../residences/BurgageFencing.ts';
import type { ForestVisualSync } from '../resources/ForestVisualSync.ts';
import type { GameState } from '../resources/types.ts';
import {
  issuedGuardPolearmsByCompany,
  type CombatAgentState,
} from '../security/combatAgents.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { TerrainMinimapOverlay } from '../map/TerrainMinimapOverlay.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import { collectOccupiedParcelPolygons } from '../residences/burgageZoneLayout.ts';
import { syncSettlementWorld, type SettlementWorldSyncTargets } from './settlementWorldSync.ts';
import {
  collectPlacedBuildingSources,
  getForestClearanceSignature,
  getPlacedTerrainSignature,
  syncPlacedBuildingTerrain,
} from './placedBuildingTerrainSync.ts';

export type SpacetimeSnapshotApplierDeps = {
  sceneManager: SceneManager | null;
  buildingMarkers: BuildingMarkers | null;
  terrainMinimap: TerrainMinimapOverlay | null;
  burgageFencing: BurgageFencing | null;
  forestVisualSync: ForestVisualSync | null;
  settlementWorld: SettlementWorldSyncTargets;
  onForestClearanceChanged?: () => void;
  onFirstPersonCollisionChanged?: () => void;
};

export class SpacetimeSnapshotApplier {
  private lastPlacedBuildingSignature = '';
  private lastBuildingMarkerSignature = '';
  private lastBuildingColliderSignature = '';
  private lastIssuedGuardPolearmSignature = '';
  private lastForestClearanceSignature = '';
  private readonly previousTreePhases = new Map<string, string>();
  private readonly previousTreeGrowth = new Map<string, number>();

  apply(
    deps: SpacetimeSnapshotApplierDeps,
    state: GameState,
    previous: GameState | null,
    combatAgents: Iterable<CombatAgentState> = [],
  ): void {
    const buildingsChanged = !previous || state.buildings !== previous.buildings;
    const issuedGuardPolearms = issuedGuardPolearmsByCompany(combatAgents);
    const issuedGuardPolearmSignature = [...issuedGuardPolearms.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([buildingId, amount]) => `${buildingId}:${amount.toFixed(3)}`)
      .join('|');
    const issuedGuardPolearmsChanged =
      issuedGuardPolearmSignature !== this.lastIssuedGuardPolearmSignature;
    this.lastIssuedGuardPolearmSignature = issuedGuardPolearmSignature;
    const livestockHerdsChanged = !previous
      || state.livestockHerds !== previous.livestockHerds;
    const residencesChanged = !previous || state.residences !== previous.residences;
    const burgageZonesChanged = !previous || state.burgageZones !== previous.burgageZones;
    const farmFieldsChanged = !previous || state.farmFields !== previous.farmFields;
    const quarriesChanged = !previous || state.quarries !== previous.quarries;
    const foragingChanged = !previous
      || state.foragingNodes !== previous.foragingNodes
      || state.tick !== previous.tick;
    const residenceCollidersChanged = !previous || !mapEntriesMatch(
      state.residences,
      previous.residences,
      (current, prior) =>
        current.x === prior.x
        && current.z === prior.z
        && current.yaw === prior.yaw
        && current.tier === prior.tier,
    );
    const burgageFenceCollidersChanged = !previous || !mapEntriesMatch(
      state.burgageZones,
      previous.burgageZones,
      (current, prior) =>
        current.frontageEdge === prior.frontageEdge
        && current.plotCount === prior.plotCount
        && pointMatches(current.cornerA, prior.cornerA)
        && pointMatches(current.cornerB, prior.cornerB)
        && pointMatches(current.cornerC, prior.cornerC)
        && pointMatches(current.cornerD, prior.cornerD),
    );
    const pastureFenceCollidersChanged = !previous || !mapEntriesMatch(
      state.pastures,
      previous.pastures,
      (current, prior) => cornersMatch(current.corners, prior.corners),
    );
    const backyardCollidersChanged = !previous || !mapEntriesMatch(
      state.backyardGardens,
      previous.backyardGardens,
      (current, prior) =>
        current.residenceId === prior.residenceId
        && current.kind === prior.kind,
    );
    let buildingCollidersChanged = false;
    const quarryCollidersChanged = quarriesChanged
      ? (deps.sceneManager?.syncQuarryNodes(state.quarries.values()) ?? false)
      : false;
    if (foragingChanged) {
      deps.sceneManager?.syncForagingNodes(state.foragingNodes.values(), state.tick);
    }
    const treesChanged = !previous || !mapEntriesShareValues(state.trees, previous.trees);
    if (treesChanged) {
      const changedTreeIds: string[] = [];
      for (const [treeId, entity] of state.trees) {
        const previousPhase = this.previousTreePhases.get(treeId);
        const previousGrowth = this.previousTreeGrowth.get(treeId);
        const phaseChanged = previousPhase !== entity.phase || previousPhase === undefined;
        const growthChanged = previousGrowth !== entity.growthProgress;
        if (phaseChanged || growthChanged) {
          changedTreeIds.push(treeId);
        }
        this.previousTreePhases.set(treeId, entity.phase);
        this.previousTreeGrowth.set(treeId, entity.growthProgress);
      }

      if (previous && state.trees.size < previous.trees.size) {
        for (const treeId of previous.trees.keys()) {
          if (state.trees.has(treeId)) continue;
          this.previousTreePhases.delete(treeId);
          this.previousTreeGrowth.delete(treeId);
        }
      }

      if (!previous) {
        deps.forestVisualSync?.syncAll(state.trees);
      } else {
        if (deps.forestVisualSync && state.trees.size !== previous.trees.size) {
          deps.forestVisualSync.syncAuthoritativeTreeLayouts(state.trees);
        }
        if (changedTreeIds.length > 0) {
          deps.forestVisualSync?.syncTrees(state.trees, changedTreeIds);
        }
      }
    }

    if (buildingsChanged || livestockHerdsChanged || issuedGuardPolearmsChanged) {
      const markerSignatures = buildingMarkerSignatures(
        state.buildings,
        state.livestockHerds,
        issuedGuardPolearms,
      );
      if (markerSignatures.visual !== this.lastBuildingMarkerSignature) {
        this.lastBuildingMarkerSignature = markerSignatures.visual;
        deps.buildingMarkers?.syncBuildings(
          state.buildings.values(),
          state.livestockHerds,
          issuedGuardPolearms,
        );
      }
      if (markerSignatures.collider !== this.lastBuildingColliderSignature) {
        this.lastBuildingColliderSignature = markerSignatures.collider;
        buildingCollidersChanged = true;
      }
    }

    if (buildingsChanged || residencesChanged) {
      const terrainSignature = getPlacedTerrainSignature(state);
      if (terrainSignature !== this.lastPlacedBuildingSignature) {
        this.lastPlacedBuildingSignature = terrainSignature;
        if (buildingsChanged) {
          deps.terrainMinimap?.syncBuildings(buildBuildingWorldMapMarkers(state.buildings.values()));
        }
        syncPlacedBuildingTerrain({
          sceneManager: deps.sceneManager,
          gameState: state,
          // Terrain pads are rebuilt before this second marker sync so newly
          // placed buildings and nearby residence changes use the final height.
          buildingMarkers: deps.buildingMarkers,
          forceMeshUpdate: true,
          onSignatureUpdate: (signature) => {
            this.lastPlacedBuildingSignature = signature;
          },
        });
      }
    }

    syncSettlementWorld(deps.settlementWorld, state, previous);
    if (burgageZonesChanged || residencesChanged || buildingsChanged) {
      deps.burgageFencing?.syncZones(
        state.burgageZones.values(),
        state.residences.values(),
        (x, z) => deps.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
      );
    }

    if (buildingsChanged || residencesChanged || farmFieldsChanged) {
      const forestSignature = getForestClearanceSignature(state);
      if (forestSignature !== this.lastForestClearanceSignature) {
        this.lastForestClearanceSignature = forestSignature;
        deps.onForestClearanceChanged?.();
      }
    }

    if (
      buildingCollidersChanged
      || residenceCollidersChanged
      || burgageFenceCollidersChanged
      || pastureFenceCollidersChanged
      || backyardCollidersChanged
      || quarryCollidersChanged
    ) {
      deps.onFirstPersonCollisionChanged?.();
    }
  }

  syncForestClearance(deps: SpacetimeSnapshotApplierDeps, gameState: GameState): void {
    if (!deps.sceneManager) return;
    deps.sceneManager.setForestClearanceSources(
      collectPlacedBuildingSources(gameState),
      collectOccupiedParcelPolygons(gameState.burgageZones.values(), gameState.residences.values()),
      [...gameState.farmFields.values()].map((field) => field.corners),
    );
  }

  reset(): void {
    this.lastPlacedBuildingSignature = '';
    this.lastBuildingMarkerSignature = '';
    this.lastBuildingColliderSignature = '';
    this.lastIssuedGuardPolearmSignature = '';
    this.lastForestClearanceSignature = '';
    this.previousTreePhases.clear();
    this.previousTreeGrowth.clear();
  }
}

function mapEntriesShareValues<K, V>(
  current: ReadonlyMap<K, V>,
  previous: ReadonlyMap<K, V>,
): boolean {
  if (current === previous) return true;
  if (current.size !== previous.size) return false;
  for (const [key, value] of current) {
    if (previous.get(key) !== value) return false;
  }
  return true;
}

function mapEntriesMatch<K, V>(
  current: ReadonlyMap<K, V>,
  previous: ReadonlyMap<K, V>,
  matches: (current: V, previous: V) => boolean,
): boolean {
  if (current === previous) return true;
  if (current.size !== previous.size) return false;
  for (const [key, value] of current) {
    const prior = previous.get(key);
    if (prior === undefined || !matches(value, prior)) return false;
  }
  return true;
}

function pointMatches(
  current: { x: number; z: number },
  previous: { x: number; z: number },
): boolean {
  return current.x === previous.x && current.z === previous.z;
}

function cornersMatch(
  current: readonly { x: number; z: number }[],
  previous: readonly { x: number; z: number }[],
): boolean {
  return current.length === previous.length
    && current.every((point, index) => pointMatches(point, previous[index]));
}
