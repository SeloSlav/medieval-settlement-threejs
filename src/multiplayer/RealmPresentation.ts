import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { CameraController } from '../camera/CameraController.ts';
import type { DbConnection } from '../generated/index.ts';
import { getConnection, isConnected } from '../network/spacetimedbClient.ts';
import { realmFog, uploadRealmFog } from './realmVisibility.ts';
import { REALM, REALM_FOG_CELLS_PER_SIDE, worldChunk } from './realmPolicy.ts';
import { RealmTerrainStream } from './RealmTerrainStream.ts';
import { RealmNeighbors } from './RealmNeighbors.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { InstanceDrawCompaction } from '../scene/InstanceDrawCompaction.ts';

/** Independent parchment fog; it uses explored history even beyond live render interest. */
export class RealmPresentation {
  readonly terrainStream: RealmTerrainStream;
  readonly neighbors: RealmNeighbors;
  private readonly controls = document.createElement('div');
  private readonly scoutButton = document.createElement('button');
  private readonly settlementSelect = document.createElement('select');
  private settlementSignature = '';
  private readonly projector: TerrainProjector;
  private ordering = false;
  private readonly scene: SceneManager;
  private readonly camera: CameraController;
  private readonly rgba = new Uint8Array(REALM_FOG_CELLS_PER_SIDE ** 2 * 4);
  private readonly mapTexture = new THREE.DataTexture(this.rgba, REALM_FOG_CELLS_PER_SIDE, REALM_FOG_CELLS_PER_SIDE);
  private readonly veil: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private connection: DbConnection | null = null;
  private dirty = true;
  private revision = -1;
  private nextInterestAt = 0;
  private interestChunk: number | null = null;
  private focused = false;
  private errorUntil = 0;
  private readonly fogChanged = (): void => { this.dirty = true; };
  private readonly target = new THREE.Vector3();
  private readonly detailDraws: InstanceDrawCompaction[] = [];
  private readonly registeredDetailRoots = new WeakSet<THREE.Object3D>();
  constructor(scene: SceneManager, camera: CameraController) {
    this.scene = scene; this.camera = camera;
    document.documentElement.dataset.gameMode = 'multiplayer';
    this.neighbors = new RealmNeighbors(scene, camera);
    this.projector = new TerrainProjector(scene.terrain, scene.camera, scene.renderer.domElement);
    this.controls.className = 'realm-surveyor-controls';
    this.controls.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:35;display:flex;gap:8px;align-items:center;background:#181f1bea;color:#eadfbe;padding:8px 12px;border:1px solid #857958;border-radius:6px;font:13px Georgia';
    this.scoutButton.textContent = 'Send surveyor';
    this.scoutButton.dataset.realmSurveyor = '';
    this.scoutButton.addEventListener('click', () => {
      const id = BigInt(this.settlementSelect.value || '0');
      const scout = this.connection && [...this.connection.db.my_realm_scout.iter()].find(s => s.settlementId === id && s.health > 0);
      if (!scout) {
        void this.connection?.reducers.recruitRealmScout({ settlementId: id }).catch(error => {
          this.showError(error);
        });
        return;
      }
      this.ordering = !this.ordering;
      this.scoutButton.textContent = this.ordering ? 'Choose destination · Esc to cancel' : 'Send surveyor';
    });
    const home = document.createElement('button'); home.textContent = 'Return to camp';
    home.addEventListener('click', () => {
      const member = this.connection && [...this.connection.db.my_realm_member.iter()][0];
      if (member) this.camera.focusWorldPosition(member.campX, member.campZ);
    });
    this.settlementSelect.setAttribute('aria-label', 'Surveyor settlement');
    this.controls.append(this.settlementSelect, this.scoutButton, home); document.body.append(this.controls);
    window.addEventListener('pointerdown', this.orderScout, true);
    window.addEventListener('keydown', this.cancelOrder);
    this.terrainStream = new RealmTerrainStream(scene.terrain, scene.scene);
    this.mapTexture.generateMipmaps = false;
    this.mapTexture.minFilter = THREE.NearestFilter; this.mapTexture.magFilter = THREE.NearestFilter;
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(REALM.size, REALM.size),
      new THREE.MeshBasicMaterial({ map: this.mapTexture, transparent: true, depthTest: false,
        depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    this.veil.name = 'Unsurveyed parchment and remembered land';
    this.veil.rotation.x = -Math.PI / 2;
    this.veil.position.y = 2;
    this.veil.renderOrder = 10_000;
    this.veil.updateMatrixWorld(true);
    scene.getStrategicMapScene().add(this.veil);
    this.updateTextures();
  }
  update(now: number): void {
    this.registerDetailDraws();
    for (const draw of this.detailDraws) { draw.syncRenderState(); draw.prepare(this.scene.camera); }
    this.camera.getTargetPosition(this.target);
    this.terrainStream.update(this.target.x, this.target.z, this.scene.isIllustratedMapActive());
    const connection = getConnection();
    this.neighbors.update(isConnected() ? connection : null, now);
    this.scoutButton.disabled = !isConnected();
    if (!isConnected()) { realmFog.disconnect(); this.updateTextures(); return; }
    if (!connection) return;
    const settlements = [...connection.db.visible_settlement.iter()];
    const signature = settlements.map(s => `${s.id}:${s.name}`).join('|');
    if (signature !== this.settlementSignature) {
      const selected = this.settlementSelect.value;
      this.settlementSelect.replaceChildren(...settlements.map(s => new Option(s.name, String(s.id))));
      if (settlements.some(s => String(s.id) === selected)) this.settlementSelect.value = selected;
      this.settlementSignature = signature;
    }
    if (!this.ordering && performance.now() >= this.errorUntil) {
      const scout = [...connection.db.my_realm_scout.iter()].find(s => String(s.settlementId) === this.settlementSelect.value && s.health > 0);
      this.scoutButton.textContent = scout ? 'Send surveyor' : 'Recruit surveyor · 1 adult';
      this.scoutButton.title = scout ? `Health ${Math.ceil(scout.health)}/60` : 'Recruit at a camp, town hall, or occupied home. Uses one available adult.';
    }
    if (connection !== this.connection) {
      this.unbindFog();
      this.connection = connection; this.dirty = true; this.interestChunk = null;
      connection.db.my_realm_fog.onInsert(this.fogChanged);
      connection.db.my_realm_fog.onUpdate(this.fogChanged);
      connection.db.my_realm_fog.onDelete(this.fogChanged);
    }
    if (this.dirty) { realmFog.apply(connection.db.my_realm_fog.iter()); this.dirty = false; }
    if (!this.focused) {
      const member = [...connection.db.my_realm_member.iter()][0];
      if (member) { this.camera.focusWorldPosition(member.campX, member.campZ); this.focused = true; }
    }
    this.updateTextures();
    if (now < this.nextInterestAt || !this.focused) return;
    this.nextInterestAt = now + 250;
    this.camera.getTargetPosition(this.target);
    const chunk = worldChunk(this.target.x, this.target.z);
    if (chunk === null || chunk === this.interestChunk) return;
    this.interestChunk = chunk;
    void connection.reducers.setRealmInterest({ x: this.target.x, z: this.target.z }).catch(error => {
      this.interestChunk = null;
      console.warn('[Realm] Interest update failed', error);
    });
  }
  private registerDetailDraws(): void {
    // These assets arrive after RealmPresentation starts. Discover through
    // direct owner references, never a whole-scene search each frame.
    const roots = [this.scene.getBerryPatchRoot(),
      ...(this.scene.getForestManager()?.getCloseGroundGpuPrewarmRoots() ?? [])];
    for (const root of roots) {
      if (!root || this.registeredDetailRoots.has(root)) continue;
      this.registeredDetailRoots.add(root);
      root.traverse(object => {
        const mesh = object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || mesh.castShadow || mesh.instanceMatrix.count < 24
          || mesh.userData.instanceCompactionSource || mesh.userData.instanceCompactionDraw) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materials.some(material => material.transparent) || mesh.geometry.getIndirect()) return;
        // Full geometry and wind stay unchanged; only out-of-frustum instances
        // and explicitly collapsed harvest slots leave the submitted prefix.
        this.detailDraws.push(new InstanceDrawCompaction(mesh, 2, { skipCollapsed: true }));
      });
    }
  }
  dispose(): void {
    for (const draw of this.detailDraws) draw.dispose();
    this.unbindFog();
    this.neighbors.dispose(); this.controls.remove();
    window.removeEventListener('pointerdown', this.orderScout, true);
    window.removeEventListener('keydown', this.cancelOrder);
    this.terrainStream.dispose();
    this.scene.getStrategicMapScene().remove(this.veil);
    this.veil.geometry.dispose(); this.veil.material.dispose(); this.mapTexture.dispose();
  }
  private readonly cancelOrder = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { this.ordering = false; this.scoutButton.textContent = 'Send surveyor'; }
  };
  private readonly orderScout = (event: PointerEvent): void => {
    if (!this.ordering || event.button !== 0 || event.target !== this.scene.renderer.domElement || !this.connection) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.projector.setViewportRect(this.scene.renderer.domElement.getBoundingClientRect());
    const point = this.projector.pick(event.clientX, event.clientY);
    if (!point || worldChunk(point.x, point.z) === null) return;
    this.ordering = false; this.scoutButton.textContent = 'Send surveyor';
    void this.connection.reducers.orderRealmScout({ settlementId: BigInt(this.settlementSelect.value), x: point.x, z: point.z }).catch(error => {
      this.showError(error); console.warn('[Surveyor]', error);
    });
  };
  private showError(error: unknown): void {
    this.errorUntil = performance.now() + 6000;
    this.scoutButton.textContent = 'Order unavailable';
    this.scoutButton.title = String(error);
  }
  private unbindFog(): void {
    this.connection?.db.my_realm_fog.removeOnInsert(this.fogChanged);
    this.connection?.db.my_realm_fog.removeOnUpdate(this.fogChanged);
    this.connection?.db.my_realm_fog.removeOnDelete(this.fogChanged);
  }
  private updateTextures(): void {
    if (this.revision === realmFog.revision) return;
    this.revision = realmFog.revision;
    const side = REALM_FOG_CELLS_PER_SIDE;
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const sight = realmFog.pixels[z * side + x];
      const i = ((side - z - 1) * side + x) * 4;
      this.rgba[i] = 64; this.rgba[i + 1] = 55; this.rgba[i + 2] = 42;
      this.rgba[i + 3] = sight === 255 ? 0 : sight ? 115 : 255;
    }
    this.mapTexture.needsUpdate = true; uploadRealmFog();
  }
}
