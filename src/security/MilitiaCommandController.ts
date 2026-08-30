import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { isPlayerMilitaryFaction, type CombatAgentState } from './combatAgents.ts';
import type { BanditCampState } from './banditState.ts';
import { SecondaryClickGesture } from '../input/SecondaryClickGesture.ts';

type Options = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  camera: THREE.Camera;
  terrainProjector: TerrainProjector;
  parent: THREE.Group;
  getHeightAt: (x: number, z: number) => number;
  isBlocked: () => boolean;
  onCommand: (ids: string[], x: number, z: number, campId: string | null) => void;
  onLeavingCompanySelected?: (companyId: string) => void;
};

export type MilitiaCommandHandler = Options['onCommand'];

type CompanyVisual = {
  id: string;
  agents: CombatAgentState[];
  x: number;
  z: number;
  radius: number;
  controllable: boolean;
};

/** The player-facing RTS unit is a whole company. Individual agents remain
 * authoritative for identity, casualties, kit, and formation spacing, but
 * selection, rings, and orders always operate on every living company member. */
export class MilitiaCommandController {
  private readonly companies = new Map<string, CompanyVisual>();
  private readonly camps = new Map<string, BanditCampState>();
  private readonly selected = new Set<string>();
  private readonly overlay = document.createElement('div');
  private readonly ringRoot = new THREE.Group();
  private readonly rings = new Map<string, THREE.Mesh>();
  private dragStart: { x: number; y: number } | null = null;
  private readonly rightClick: SecondaryClickGesture;
  private readonly options: Options;
  private commandHandler: MilitiaCommandHandler;
  private companyGuidesVisible = false;

  constructor(options: Options) {
    this.options = options;
    this.commandHandler = options.onCommand;
    this.overlay.className = 'militia-selection-box';
    Object.assign(this.overlay.style, {
      position: 'fixed', display: 'none', pointerEvents: 'none', zIndex: '80',
      border: '1px solid rgba(225, 181, 56, .95)', background: 'rgba(225, 181, 56, .12)',
    });
    options.uiRoot.append(this.overlay);
    this.ringRoot.name = 'Military company selection rings';
    options.parent.add(this.ringRoot);
    this.rightClick = new SecondaryClickGesture({ onClick: this.issueOrder });
    options.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  /** Allows an isolated local sandbox to reuse selection without a reducer. */
  setCommandHandler(handler: MilitiaCommandHandler): void {
    this.commandHandler = handler;
  }

  /** Faint formation footprints make dense playtest companies easy to select. */
  setCompanyGuidesVisible(visible: boolean): void {
    if (this.companyGuidesVisible === visible) return;
    this.companyGuidesVisible = visible;
    this.syncRings();
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.syncRings();
  }

  sync(agents: ReadonlyMap<string, CombatAgentState>, camps: ReadonlyMap<string, BanditCampState>): void {
    this.companies.clear();
    this.camps.clear();
    const grouped = new Map<string, CombatAgentState[]>();
    for (const agent of agents.values()) {
      if (
        !isPlayerMilitaryFaction(agent.faction)
        || !agent.companyId
        || agent.status === 'downed'
        || agent.status === 'mustering'
        || agent.status === 'wounded-returning'
        || agent.status === 'recovering'
      ) continue;
      const members = grouped.get(agent.companyId) ?? [];
      members.push(agent);
      grouped.set(agent.companyId, members);
    }
    for (const [id, members] of grouped) {
      members.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
      const x = members.reduce((sum, member) => sum + member.x, 0) / members.length;
      const z = members.reduce((sum, member) => sum + member.z, 0) / members.length;
      const radius = Math.max(
        1.7,
        ...members.map((member) => Math.hypot(member.x - x, member.z - z) + 0.9),
      );
      const controllable = members.some((member) => member.status !== 'returning');
      this.companies.set(id, { id, agents: members, x, z, radius, controllable });
    }
    for (const camp of camps.values()) if (camp.active) this.camps.set(camp.id, camp);
    for (const id of [...this.selected]) if (!this.companies.has(id)) this.selected.delete(id);
    this.syncRings();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.rightClick.dispose();
    this.overlay.remove();
    this.ringRoot.removeFromParent();
    for (const ring of this.rings.values()) {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.rings.clear();
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.options.isBlocked() || this.companies.size === 0) return;
    if (event.button === 2) {
      if (this.selected.size > 0) this.rightClick.begin(event);
      return;
    }
    if (event.button !== 0 || event.target !== this.options.domElement) return;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.overlay.style.display = 'block';
    this.updateOverlay(event.clientX, event.clientY);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.dragStart) return;
    if ((event.buttons & 1) === 0) { this.cancelDrag(); return; }
    this.updateOverlay(event.clientX, event.clientY);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.dragStart || event.button !== 0) return;
    const start = this.dragStart;
    const minX = Math.min(start.x, event.clientX);
    const maxX = Math.max(start.x, event.clientX);
    const minY = Math.min(start.y, event.clientY);
    const maxY = Math.max(start.y, event.clientY);
    const click = Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5;
    this.selected.clear();
    const rect = this.options.domElement.getBoundingClientRect();
    const projected = new THREE.Vector3();
    let nearest: { companyId: string; distance: number } | null = null;
    for (const company of this.companies.values()) {
      let intersectsBox = false;
      for (const agent of company.agents) {
        projected.set(agent.x, this.options.getHeightAt(agent.x, agent.z) + 1.2, agent.z).project(this.options.camera);
        const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
        const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
        if (click) {
          const distance = Math.hypot(x - event.clientX, y - event.clientY);
          if (distance <= 28 && (!nearest || distance < nearest.distance)) {
            nearest = { companyId: company.id, distance };
          }
        } else if (x >= minX && x <= maxX && y >= minY && y <= maxY && projected.z < 1) {
          intersectsBox = true;
        }
      }
      if (intersectsBox) this.selected.add(company.id);
    }
    if (nearest) this.selected.add(nearest.companyId);
    this.cancelDrag();
    this.syncRings();
    if (this.selected.size === 1) {
      const companyId = this.selected.values().next().value as string | undefined;
      const company = companyId ? this.companies.get(companyId) : undefined;
      if (company && !company.controllable) this.options.onLeavingCompanySelected?.(company.id);
    }
  };

  private readonly issueOrder = (event: MouseEvent): void => {
    if (this.options.isBlocked() || this.selected.size === 0) return;
    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;
    let campId: string | null = null;
    let nearest = 12;
    for (const camp of this.camps.values()) {
      const distance = Math.hypot(camp.x - point.x, camp.z - point.z);
      if (distance < nearest) { nearest = distance; campId = camp.id; }
    }
    const agentIds = [...this.selected]
      .flatMap((companyId) => {
        const company = this.companies.get(companyId);
        return company?.controllable ? company.agents.map((agent) => agent.id) : [];
      });
    if (agentIds.length > 0) this.commandHandler(agentIds, point.x, point.z, campId);
  };

  private updateOverlay(x: number, y: number): void {
    if (!this.dragStart) return;
    this.overlay.style.left = `${Math.min(this.dragStart.x, x)}px`;
    this.overlay.style.top = `${Math.min(this.dragStart.y, y)}px`;
    this.overlay.style.width = `${Math.abs(x - this.dragStart.x)}px`;
    this.overlay.style.height = `${Math.abs(y - this.dragStart.y)}px`;
  }

  private cancelDrag(): void { this.dragStart = null; this.overlay.style.display = 'none'; }

  private syncRings(): void {
    const visibleCompanyIds = this.companyGuidesVisible
      ? this.companies.keys()
      : this.selected.values();
    const visible = new Set<string>();
    for (const id of visibleCompanyIds) {
      const company = this.companies.get(id);
      if (!company) continue;
      visible.add(id);
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.88, 1, 48),
          new THREE.MeshBasicMaterial({
            color: 0xe1b538,
            transparent: true,
            opacity: 0.86,
            depthWrite: false,
            depthTest: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 90;
        this.rings.set(id, ring);
        this.ringRoot.add(ring);
      }
      ring.position.set(company.x, this.options.getHeightAt(company.x, company.z) + 0.06, company.z);
      ring.scale.setScalar(company.radius);
      const selected = this.selected.has(id);
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.setHex(selected ? 0xe1b538 : company.controllable ? 0x86b96e : 0xd9782d);
      material.opacity = selected ? 0.86 : 0.22;
      ring.visible = true;
    }
    for (const [id, ring] of this.rings) if (!visible.has(id)) ring.visible = false;
  }
}
