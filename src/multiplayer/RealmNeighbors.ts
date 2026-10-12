import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { CameraController } from '../camera/CameraController.ts';
import type { DbConnection } from '../generated/index.ts';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { createConstructionSiteMesh } from '../buildings/ConstructionSiteMesh.ts';
import { createResidenceMesh } from '../residences/ResidenceMarkers.ts';
import type { BuildingKind } from '../resources/types.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { SettlementCrowdRenderer, type CrowdRenderAgent } from '../settlement/SettlementCrowdRenderer.ts';
import { buildCrowdViewState } from '../settlement/crowdView.ts';
import { isWorldPointVisible } from './realmVisibility.ts';
import { pickVillagerAppearanceSeed, pickVillagerColors, pickVillagerHairColor, pickVillagerModelVariant } from '../settlement/villagerPaths.ts';

type Appearance = { id: string; kind: string; x: number; z: number; yaw: number; tier: number; complete: boolean; personIdentity?: string };
type Cached = { mesh: THREE.Group; signature: string; lastUsed: number };

/** Public appearances are kept separate from the local player's selectable/economic state. */
export class RealmNeighbors {
  readonly group = new THREE.Group();
  private readonly cache = new Map<string, Cached>();
  private crowd: SettlementCrowdRenderer | null = null;
  private readonly actors = new Map<string, CrowdRenderAgent>();
  private previousTime = 0;
  private readonly target = new THREE.Vector3();
  private readonly scene: SceneManager;
  private readonly camera: CameraController;
  constructor(scene: SceneManager, camera: CameraController) {
    this.scene = scene; this.camera = camera;
    this.group.name = 'Visible neighboring settlements'; scene.scene.add(this.group);
  }
  update(connection: DbConnection | null, now: number): void {
    const paper = this.scene.isIllustratedMapActive();
    this.group.visible = !paper;
    this.camera.getTargetPosition(this.target);
    const radius = Math.min(1024, Math.max(180, this.camera.getOrbitDistance() * 1.5));
    const rows: Appearance[] = connection ? [...connection.db.visible_realm_entity.iter()] : [];
    const scouts = connection ? [...connection.db.my_realm_scout.iter()] : [];
    for (const ownScout of scouts.filter(s => s.health > 0)) rows.push({ id: `own-surveyor:${ownScout.settlementId}`, kind: 'scout', x: ownScout.x, z: ownScout.z,
      yaw: Math.atan2(ownScout.targetX - ownScout.x, ownScout.targetZ - ownScout.z), tier: 0, complete: true,
      personIdentity: ownScout.residenceId === 0n ? `starting-population:${ownScout.residentSlot}` : `${ownScout.residenceId}:person:${ownScout.residentSlot}` });
    const distance = (a: Appearance) => (a.x - this.target.x) ** 2 + (a.z - this.target.z) ** 2;
    const visible = rows.filter(a => !paper && isWorldPointVisible(a.x, a.z) && distance(a) < radius ** 2)
      .sort((a, b) => distance(a) - distance(b)).slice(0, 512);
    const ids = new Set(visible.map(a => a.id));
    for (const [id, item] of this.cache) item.mesh.visible = ids.has(id);
    const agents: CrowdRenderAgent[] = [];
    const start = performance.now();
    const dt = Math.min(0.08, Math.max(0, (now - this.previousTime) / 1000)); this.previousTime = now;
    for (const row of visible) {
      if (row.kind === 'unit' || row.kind === 'scout') {
        const appearanceSeed = pickVillagerAppearanceSeed(row.personIdentity ?? row.id, 0);
        const colors = pickVillagerColors(appearanceSeed);
        let actor = this.actors.get(row.id);
        if (!actor || actor.appearanceSeed !== appearanceSeed) {
          actor = { id: row.id, slot: this.actors.size, x: row.x, y: 0, z: row.z, yaw: row.yaw,
            appearanceSeed, variant: row.kind === 'unit' ? 'man' : pickVillagerModelVariant(appearanceSeed),
            mode: 'idle', tunicColor: colors.tunic, skinColor: colors.skin,
            hairColor: pickVillagerHairColor(appearanceSeed), tool: null, movementSpeed: 0, active: true };
          this.actors.set(row.id, actor);
        }
        const d = Math.hypot(row.x - actor.x, row.z - actor.z);
        const alpha = 1 - Math.exp(-dt * 14);
        actor.x += (row.x - actor.x) * alpha; actor.z += (row.z - actor.z) * alpha;
        actor.y = this.scene.terrain.getHeightAt(actor.x, actor.z); actor.yaw = row.yaw;
        actor.mode = d > 0.03 ? 'walk' : 'idle'; actor.movementSpeed = d > 0.03 ? 4 : 0;
        agents.push(actor); continue;
      }
      const signature = `${row.kind}:${row.tier}:${row.complete}`;
      let item = this.cache.get(row.id);
      if (item && item.signature !== signature) {
        item.mesh.removeFromParent(); disposeObject3D(item.mesh); this.cache.delete(row.id); item = undefined;
      }
      if (!item && performance.now() - start < 2) {
        const mesh = row.kind === 'residence'
          ? createResidenceMesh(Number(row.id.split(':')[1]) || 1, Math.max(1, Math.min(4, row.tier)) as 1 | 2 | 3 | 4)
          : row.complete ? createBuildingMesh(row.kind as BuildingKind, row.tier as 0 | 1 | 2 | 3 | 4)
            : createConstructionSiteMesh(row.kind as BuildingKind, 0, 0, 0);
        mesh.position.set(row.x, this.scene.terrain.getHeightAt(row.x, row.z), row.z);
        mesh.rotation.y = row.yaw; mesh.name = `Neighbor ${row.id}`;
        this.group.add(mesh); mesh.updateMatrixWorld(true);
        item = { mesh, signature, lastUsed: now }; this.cache.set(row.id, item);
      }
      if (item) item.lastUsed = now;
    }
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    if (agents.length && !this.crowd) this.crowd = new SettlementCrowdRenderer({ parent: this.group });
    const view = buildCrowdViewState(this.target.x, this.target.z, this.camera.getOrbitDistance());
    view.renderCamera = this.scene.camera;
    view.renderPixelHeight = this.scene.renderer.domElement.height;
    this.crowd?.syncAgents(agents, view, dt);
    // Hidden appearances form a bounded LRU; leaving sight removes them immediately.
    const hidden = [...this.cache.entries()].filter(([id]) => !ids.has(id)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, item] of hidden.slice(0, Math.max(0, hidden.length - 128))) {
      item.mesh.removeFromParent(); disposeObject3D(item.mesh); this.cache.delete(id);
    }
  }
  dispose(): void {
    this.crowd?.dispose(); for (const item of this.cache.values()) disposeObject3D(item.mesh);
    this.cache.clear(); this.actors.clear(); this.group.removeFromParent();
  }
}
