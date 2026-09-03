import * as THREE from 'three';
import {
  CompanyStandardRenderer,
  type CompanyStandardRenderAgent,
  type CompanyStandardArtwork,
} from './CompanyStandardRenderer.ts';
import {
  createCompanyStandardTextures,
  createBanditCampStandardTexture,
  type CompanyStandardTextureSet,
} from './companyStandardTextures.ts';

export const CAMP_STANDARD_ANCHOR_NAME = 'Planted camp standard anchor';

export function createCampStandardAnchor(faction: 'player' | 'bandit'): THREE.Group {
  const anchor = new THREE.Group();
  anchor.name = CAMP_STANDARD_ANCHOR_NAME;
  anchor.userData.campStandardFaction = faction;
  anchor.userData.fpNoCollision = true;
  return anchor;
}

/** Ground-mounted clients of the military cloth solver. The dynamic batch lives
 * outside immutable building/shadow batches; removing a camp also removes its
 * cloth state. Artwork and hardware are shared across this renderer's camps. */
export class CampStandardRenderer {
  private readonly parent: THREE.Group;
  private readonly getGroundHeight?: (x: number, z: number) => number;
  private renderer: CompanyStandardRenderer | null = null;
  private playerTextures: CompanyStandardTextureSet | null = null;
  private banditTexture: THREE.Texture | null = null;
  private readonly artwork: CompanyStandardArtwork = {};
  private readonly anchors = new WeakMap<THREE.Object3D, THREE.Object3D | null>();
  private readonly agents: CompanyStandardRenderAgent[] = [];
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly frame = new THREE.Matrix4();
  private readonly parentInverse = new THREE.Matrix4();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(parent: THREE.Object3D, getGroundHeight?: (x: number, z: number) => number) {
    this.getGroundHeight = getGroundHeight;
    this.parent = new THREE.Group();
    this.parent.name = 'Planted camp standards';
    this.parent.userData.fpNoCollision = true;
    parent.add(this.parent);
  }

  sync(camps: Iterable<THREE.Object3D>, dtSeconds = 0): void {
    this.parent.updateWorldMatrix(true, false);
    this.parentInverse.copy(this.parent.matrixWorld).invert();
    let count = 0;
    let needsPlayer = false;
    let needsBandit = false;
    for (const camp of camps) {
      if (!this.anchors.has(camp)) {
        this.anchors.set(camp, camp.getObjectByName(CAMP_STANDARD_ANCHOR_NAME) ?? null);
      }
      const anchor = this.anchors.get(camp);
      if (!anchor) continue;
      let visible = true;
      for (let object: THREE.Object3D | null = anchor; object; object = object.parent) {
        if (!object.visible) { visible = false; break; }
      }
      if (!visible) continue;
      anchor.updateWorldMatrix(true, false);
      this.frame.multiplyMatrices(this.parentInverse, anchor.matrixWorld);
      this.frame.decompose(this.position, this.quaternion, this.scale);
      this.euler.setFromQuaternion(this.quaternion, 'YXZ');
      if (this.getGroundHeight) {
        this.position.setFromMatrixPosition(anchor.matrixWorld);
        this.position.y = this.getGroundHeight(this.position.x, this.position.z);
        this.position.applyMatrix4(this.parentInverse);
      }
      const faction = anchor.userData.campStandardFaction === 'bandit' ? 'bandit' : 'player';
      needsPlayer ||= faction === 'player';
      needsBandit ||= faction === 'bandit';
      const agent = this.agents[count] ??= {
        id: '', faction, x: 0, y: 0, z: 0, yaw: 0, planted: true,
      };
      agent.id = anchor.uuid;
      agent.faction = faction;
      agent.x = this.position.x;
      // Bury the ferrule slightly so the pole visibly enters the ground.
      agent.y = this.position.y - 0.08;
      agent.z = this.position.z;
      agent.yaw = this.euler.y;
      agent.appearanceSeed = faction === 'bandit' ? 711 : 317;
      count += 1;
    }
    this.agents.length = count;
    if (count === 0 && !this.renderer) return;
    let artworkChanged = false;
    if (typeof document !== 'undefined') {
      if (needsPlayer && !this.playerTextures) {
        this.playerTextures = createCompanyStandardTextures();
        this.artwork.playerHeraldry = this.playerTextures.artwork.playerHeraldry;
        this.artwork.playerCroatian = this.playerTextures.artwork.playerCroatian;
        artworkChanged = true;
      }
      if (needsBandit && !this.banditTexture) {
        this.banditTexture = createBanditCampStandardTexture();
        this.artwork.bandit = this.banditTexture;
        artworkChanged = true;
      }
    }
    this.renderer ??= new CompanyStandardRenderer({
      parent: this.parent, artwork: this.artwork, clothCastShadow: true,
    });
    if (artworkChanged) this.renderer.setArtwork(this.artwork);
    // No crowd-view gate: a camp flag remains visible when people are hidden.
    this.renderer.sync(this.agents, undefined, dtSeconds);
  }

  diagnostics() { return this.renderer?.diagnostics() ?? null; }

  dispose(): void {
    this.renderer?.dispose();
    this.playerTextures?.dispose();
    this.banditTexture?.dispose();
    this.renderer = null;
    this.playerTextures = null;
    this.banditTexture = null;
    this.agents.length = 0;
    this.parent.removeFromParent();
  }
}
