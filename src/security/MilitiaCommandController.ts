import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import {
  selectablePlayerMilitaryCompanyId,
  type CombatAgentState,
} from './combatAgents.ts';
import type { BanditCampState } from './banditState.ts';
import { SecondaryClickGesture } from '../input/SecondaryClickGesture.ts';
import {
  MilitaryOrderFeedbackRenderer,
  type MilitaryOrderFeedbackDiagnostics,
} from './MilitaryOrderFeedbackRenderer.ts';
import { MilitaryCompanyStrategicOverlay } from './MilitaryCompanyStrategicOverlay.ts';
import {
  militaryCompanyKindForAgents,
} from './militaryCompanyPresentation.ts';
import type { MilitaryCompanyKind } from './militaryProgression.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';

type Options = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  camera: THREE.Camera;
  terrainProjector: TerrainProjector;
  parent: THREE.Group;
  getHeightAt: (x: number, z: number) => number;
  getZoomPercent?: () => number;
  isBlocked: () => boolean;
  onCommand: (ids: string[], x: number, z: number, campId: string | null) => void;
  onCompanySelected?: (companyId: string | null) => void;
  onLeavingCompanySelected?: (companyId: string) => void;
  onHostileFocus?: (x: number, z: number) => void;
  now?: () => number;
};

export type MilitiaCommandHandler = Options['onCommand'];

type CompanyVisual = {
  id: string;
  kind: MilitaryCompanyKind;
  agents: CombatAgentState[];
  x: number;
  z: number;
  radius: number;
  controllable: boolean;
  moving: boolean;
};

type CompanySelectionRing = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  radius: number;
};

const MIN_COMPANY_SELECTION_RADIUS = 1.7;
const MAX_COMPANY_SELECTION_RADIUS = 8;
const COMPANY_SELECTION_RING_WIDTH = 0.18;

/** A tactical selection affordance, not a live bounding circle. Deriving this
 * from the logical formation keeps casualties and distant melee stragglers
 * from stretching the marker across the battlefield. */
export function companySelectionFootprintRadius(memberCount: number): number {
  const count = Math.max(1, Math.floor(memberCount));
  const columns = count <= 4 ? 2 : 4;
  const rows = Math.ceil(count / columns);
  const occupiedColumns = Math.min(count, columns);
  const halfWidth = Math.max(0, occupiedColumns - 1) * 1.34 * 0.5 + 0.18;
  const halfDepth = Math.max(0, rows - 1) * 1.28 * 0.5;
  return THREE.MathUtils.clamp(
    Math.hypot(halfWidth, halfDepth) + 0.9,
    MIN_COMPANY_SELECTION_RADIUS,
    MAX_COMPANY_SELECTION_RADIUS,
  );
}

/** The player-facing RTS unit is a whole company. Individual agents remain
 * canonical for identity, casualties, kit, and formation spacing, but
 * selection, rings, and orders always operate on every living company member. */
export class MilitiaCommandController {
  private readonly companies = new Map<string, CompanyVisual>();
  private readonly camps = new Map<string, BanditCampState>();
  private readonly selected = new Set<string>();
  private readonly overlay = document.createElement('div');
  private readonly ringRoot = new THREE.Group();
  private readonly rings = new Map<string, CompanySelectionRing>();
  private readonly hostilePositions: { x: number; z: number }[] = [];
  private dragStart: { x: number; y: number } | null = null;
  private readonly rightClick: SecondaryClickGesture;
  private readonly orderFeedback: MilitaryOrderFeedbackRenderer;
  private readonly strategicIcons: MilitaryCompanyStrategicOverlay;
  private readonly options: Options;
  private commandHandler: MilitiaCommandHandler;

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
    this.orderFeedback = new MilitaryOrderFeedbackRenderer(options.parent);
    this.strategicIcons = new MilitaryCompanyStrategicOverlay({
      uiRoot: options.uiRoot,
      domElement: options.domElement,
      camera: options.camera,
      getZoomPercent: options.getZoomPercent ?? (() => 100),
      getHeightAt: options.getHeightAt,
      isBlocked: options.isBlocked,
      onSelect: this.selectCompany,
      onHostileFocus: (marker) => options.onHostileFocus?.(marker.x, marker.z),
    });
    this.rightClick = new SecondaryClickGesture({ onClick: this.issueOrder });
    options.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  /** Allows an isolated local sandbox to reuse selection without a reducer. */
  setCommandHandler(handler: MilitiaCommandHandler): void {
    this.commandHandler = handler;
  }

  /** Advances the short order acknowledgement on the ordinary render clock. */
  update(timeMs: number, crowdView?: CrowdViewState): void {
    this.orderFeedback.update(timeMs);
    this.strategicIcons.update(timeMs, crowdView);
  }

  orderFeedbackDiagnostics(timeMs = this.now()): MilitaryOrderFeedbackDiagnostics {
    return this.orderFeedback.diagnostics(timeMs);
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.syncRings();
    this.strategicIcons.setSelected(null);
    this.options.onCompanySelected?.(null);
  }

  sync(agents: ReadonlyMap<string, CombatAgentState>, camps: ReadonlyMap<string, BanditCampState>): void {
    this.companies.clear();
    this.camps.clear();
    this.hostilePositions.length = 0;
    const grouped = new Map<string, CombatAgentState[]>();
    const hostileGrouped = new Map<string, CombatAgentState[]>();
    for (const agent of agents.values()) {
      if (
        (agent.faction === 'raider' || agent.faction === 'bandit')
        && agent.status !== 'downed'
      ) {
        this.hostilePositions.push({ x: agent.x, z: agent.z });
        const hostileId = `hostile:${agent.faction}:${agent.raidId}`;
        const hostileMembers = hostileGrouped.get(hostileId) ?? [];
        hostileMembers.push(agent);
        hostileGrouped.set(hostileId, hostileMembers);
      }
      const companyId = selectablePlayerMilitaryCompanyId(agent);
      if (!companyId) continue;
      const members = grouped.get(companyId) ?? [];
      members.push(agent);
      grouped.set(companyId, members);
    }
    for (const [id, members] of grouped) {
      members.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
      const x = members.reduce((sum, member) => sum + member.x, 0) / members.length;
      const z = members.reduce((sum, member) => sum + member.z, 0) / members.length;
      const radius = companySelectionFootprintRadius(members.length);
      const controllable = members.some((member) => member.status !== 'returning');
      const moving = members.some((member) => (
        member.status === 'advancing'
        || member.status === 'retreating'
        || member.status === 'returning'
        || (member.routeProgress ?? 0) > 0.25
      ));
      const kind = militaryCompanyKindForAgents(members);
      if (!kind) continue;
      this.companies.set(id, { id, kind, agents: members, x, z, radius, controllable, moving });
    }
    for (const camp of camps.values()) if (camp.active) this.camps.set(camp.id, camp);
    for (const id of [...this.selected]) if (!this.companies.has(id)) this.selected.delete(id);
    const friendlyMarkers = [...this.companies.values()].map((company) => ({
      id: company.id,
      kind: company.kind,
      x: company.x,
      z: company.z,
      livingMembers: company.agents.length,
      controllable: company.controllable,
      moving: company.moving,
      hostile: false,
    }));
    const hostileMarkers = [...hostileGrouped.entries()].map(([id, members]) => ({
      id,
      kind: members[0]!.faction === 'bandit' ? 'bandits' as const : 'raiders' as const,
      x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
      z: members.reduce((sum, member) => sum + member.z, 0) / members.length,
      livingMembers: members.length,
      controllable: false,
      moving: members.some((member) => (
        member.status === 'advancing'
        || member.status === 'retreating'
        || (member.routeProgress ?? 0) > 0.25
      )),
      hostile: true,
    }));
    this.strategicIcons.sync([...friendlyMarkers, ...hostileMarkers]);
    this.strategicIcons.setSelected(this.selected.size === 1
      ? this.selected.values().next().value ?? null
      : null);
    this.syncRings();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.rightClick.dispose();
    this.orderFeedback.dispose();
    this.strategicIcons.dispose();
    this.overlay.remove();
    this.ringRoot.removeFromParent();
    for (const ring of this.rings.values()) {
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
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
        if (click) {
          const distance = projectedCombatantHitDistance(
            event.clientX,
            event.clientY,
            agent.x,
            this.options.getHeightAt(agent.x, agent.z),
            agent.z,
            this.options.camera,
            rect,
            projected,
          );
          if (distance !== null && (!nearest || distance < nearest.distance)) {
            nearest = { companyId: company.id, distance };
          }
        } else {
          projected
            .set(agent.x, this.options.getHeightAt(agent.x, agent.z) + 1.2, agent.z)
            .project(this.options.camera);
          const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
          const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
          if (x >= minX && x <= maxX && y >= minY && y <= maxY && projected.z < 1) {
            intersectsBox = true;
          }
        }
      }
      if (intersectsBox) this.selected.add(company.id);
    }
    if (nearest) this.selected.add(nearest.companyId);
    this.cancelDrag();
    this.syncRings();
    this.strategicIcons.setSelected(this.selected.size === 1
      ? this.selected.values().next().value ?? null
      : null);
    if (this.selected.size === 1) {
      const companyId = this.selected.values().next().value as string | undefined;
      const company = companyId ? this.companies.get(companyId) : undefined;
      this.options.onCompanySelected?.(company?.id ?? null);
      if (company && !company.controllable) this.options.onLeavingCompanySelected?.(company.id);
    } else {
      this.options.onCompanySelected?.(null);
    }
  };

  private readonly selectCompany = (companyId: string): void => {
    const company = this.companies.get(companyId);
    if (!company) return;
    this.selected.clear();
    this.selected.add(companyId);
    this.syncRings();
    this.strategicIcons.setSelected(companyId);
    this.options.onCompanySelected?.(companyId);
    if (!company.controllable) this.options.onLeavingCompanySelected?.(companyId);
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
    if (agentIds.length === 0) return;
    this.commandHandler(agentIds, point.x, point.z, campId);
    const attacksHostile = campId !== null || this.hostilePositions.some((hostile) => (
      Math.hypot(hostile.x - point.x, hostile.z - point.z) <= 5.25
    ));
    this.orderFeedback.show(
      point.x,
      this.options.getHeightAt(point.x, point.z) + 0.055,
      point.z,
      attacksHostile ? 'attack' : 'move',
      this.now(),
    );
  };

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private updateOverlay(x: number, y: number): void {
    if (!this.dragStart) return;
    this.overlay.style.left = `${Math.min(this.dragStart.x, x)}px`;
    this.overlay.style.top = `${Math.min(this.dragStart.y, y)}px`;
    this.overlay.style.width = `${Math.abs(x - this.dragStart.x)}px`;
    this.overlay.style.height = `${Math.abs(y - this.dragStart.y)}px`;
  }

  private cancelDrag(): void { this.dragStart = null; this.overlay.style.display = 'none'; }

  private syncRings(): void {
    const visible = new Set<string>();
    for (const id of this.selected) {
      const company = this.companies.get(id);
      if (!company) continue;
      visible.add(id);
      let pooled = this.rings.get(id);
      if (!pooled) {
        const ring = new THREE.Mesh(
          companySelectionRingGeometry(company.radius),
          new THREE.MeshBasicMaterial({
            color: 0xe1b538,
            transparent: true,
            opacity: 0.78,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 8;
        pooled = { mesh: ring, radius: company.radius };
        this.rings.set(id, pooled);
        this.ringRoot.add(ring);
      } else if (Math.abs(pooled.radius - company.radius) > 0.001) {
        const previous = pooled.mesh.geometry;
        pooled.mesh.geometry = companySelectionRingGeometry(company.radius);
        pooled.radius = company.radius;
        previous.dispose();
      }
      const ring = pooled.mesh;
      ring.position.set(company.x, this.options.getHeightAt(company.x, company.z) + 0.06, company.z);
      ring.visible = true;
    }
    for (const [id, ring] of this.rings) if (!visible.has(id)) ring.mesh.visible = false;
  }
}

function companySelectionRingGeometry(radius: number): THREE.RingGeometry {
  return new THREE.RingGeometry(
    Math.max(0.05, radius - COMPANY_SELECTION_RING_WIDTH),
    radius,
    64,
  );
}

function projectedCombatantHitDistance(
  clientX: number,
  clientY: number,
  x: number,
  groundY: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
  projected: THREE.Vector3,
): number | null {
  projected.set(x, groundY + 0.08, z).project(camera);
  if (!isVisibleProjection(projected)) return null;
  const feetX = bounds.left + (projected.x * 0.5 + 0.5) * bounds.width;
  const feetY = bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height;

  projected.set(x, groundY + 1.72, z).project(camera);
  if (!isVisibleProjection(projected)) return null;
  const headX = bounds.left + (projected.x * 0.5 + 0.5) * bounds.width;
  const headY = bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height;
  const projectedHeight = Math.hypot(feetX - headX, feetY - headY);
  const hitRadius = Math.min(30, Math.max(11, projectedHeight * 0.34));
  const distance = distanceToScreenSegment(
    clientX,
    clientY,
    feetX,
    feetY,
    headX,
    headY,
  );
  return distance <= hitRadius ? distance : null;
}

function isVisibleProjection(projected: THREE.Vector3): boolean {
  return Number.isFinite(projected.x)
    && Number.isFinite(projected.y)
    && Number.isFinite(projected.z)
    && projected.z >= -1
    && projected.z <= 1;
}

function distanceToScreenSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 0.0001) return Math.hypot(pointX - startX, pointY - startY);
  const t = Math.min(1, Math.max(0, (
    (pointX - startX) * segmentX + (pointY - startY) * segmentY
  ) / lengthSquared));
  return Math.hypot(
    pointX - (startX + segmentX * t),
    pointY - (startY + segmentY * t),
  );
}
