import * as THREE from 'three';
import { militaryDeploymentFromDrag, type MilitaryDeployment } from './militaryDeployment.ts';
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
  hostileCompanyStrategicKindForFaction,
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
  getAgentPosition?: (id: string) => Readonly<{ x: number; z: number }> | null;
  getAgentBodyHeight?: (id: string) => number | null;
  getZoomPercent?: () => number;
  isBlocked: () => boolean;
  isVisibilityBlocked?: () => boolean;
  isIllustratedMapActive?: () => boolean;
  getIllustratedMapY?: () => number;
  onCommand: (
    ids: string[],
    x: number,
    z: number,
    campId: string | null,
    targetAgentId: string | null,
    order: 'move' | 'attack',
    deployment?: MilitaryDeployment,
  ) => void;
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
  controllable: boolean;
  moving: boolean;
};

type UnitSelectionRing = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  agent: CombatAgentState;
};

const UNIT_SELECTION_RING_RADIUS = 0.56;
const MOUNTED_SELECTION_RING_RADIUS = 1.05;
const UNIT_SELECTION_RING_WIDTH = 0.065;
const UNIT_SELECTION_RING_LIFT = 0.025;

/** The player-facing RTS unit is a whole company. Individual agents remain
 * canonical for identity, casualties, kit, and formation spacing, but
 * selection, rings, and orders always operate on every living company member. */
export class MilitiaCommandController {
  private readonly companies = new Map<string, CompanyVisual>();
  private readonly camps = new Map<string, BanditCampState>();
  private readonly selected = new Set<string>();
  private readonly overlay = document.createElement('div');
  private readonly ringRoot = new THREE.Group();
  private readonly formationPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe0a0, depthTest: false, transparent: true, opacity: 0.85 }));
  private readonly rings = new Map<string, UnitSelectionRing>();
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private readonly hostilePositions: { id: string; x: number; z: number }[] = [];
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
    this.formationPreview.visible = false;
    options.parent.add(this.formationPreview);
    this.orderFeedback = new MilitaryOrderFeedbackRenderer(options.parent);
    this.strategicIcons = new MilitaryCompanyStrategicOverlay({
      uiRoot: options.uiRoot,
      domElement: options.domElement,
      camera: options.camera,
      getZoomPercent: options.getZoomPercent ?? (() => 100),
      getHeightAt: options.getHeightAt,
      getAgentPosition: options.getAgentPosition,
      getAgentBodyHeight: options.getAgentBodyHeight,
      isBlocked: options.isBlocked,
      isVisibilityBlocked: options.isVisibilityBlocked,
      isIllustratedMapActive: options.isIllustratedMapActive,
      getIllustratedMapY: options.getIllustratedMapY,
      onSelect: this.selectCompany,
      onHostileFocus: (marker) => options.onHostileFocus?.(marker.x, marker.z),
    });
    this.rightClick = new SecondaryClickGesture({
      onClick: this.issueOrder,
      onDrag: (x, y, event) => this.dragFormation(x, y, event, true),
      onDragMove: (x, y, event) => this.dragFormation(x, y, event, false),
      onCancel: () => { this.formationPreview.visible = false; },
    });
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
    for (const ring of this.rings.values()) this.updateRingPosition(ring);
  }

  orderFeedbackDiagnostics(timeMs = this.now()): MilitaryOrderFeedbackDiagnostics {
    return this.orderFeedback.diagnostics(timeMs);
  }

  clearSelection(notify = true): void {
    if (this.selected.size === 0) return;
    this.rightClick.cancel();
    this.selected.clear();
    this.syncRings();
    this.strategicIcons.setSelected(null);
    if (notify) this.options.onCompanySelected?.(null);
  }

  sync(agents: ReadonlyMap<string, CombatAgentState>, camps: ReadonlyMap<string, BanditCampState>): void {
    this.companies.clear();
    this.camps.clear();
    this.hostilePositions.length = 0;
    const grouped = new Map<string, CombatAgentState[]>();
    const hostileGrouped = new Map<string, CombatAgentState[]>();
    for (const agent of agents.values()) {
      if (
        agent.status !== 'downed'
      ) {
        const hostileKind = hostileCompanyStrategicKindForFaction(agent.faction);
        if (hostileKind) {
          this.hostilePositions.push({ id: agent.id, x: agent.x, z: agent.z });
          const hostileId = `hostile:${hostileKind}:${agent.raidId}`;
          const hostileMembers = hostileGrouped.get(hostileId) ?? [];
          hostileMembers.push(agent);
          hostileGrouped.set(hostileId, hostileMembers);
        }
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
      const controllable = members.some((member) => member.status !== 'returning');
      const moving = members.some((member) => (
        member.status === 'advancing'
        || member.status === 'retreating'
        || member.status === 'returning'
        || (member.routeProgress ?? 0) > 0.25
      ));
      const kind = militaryCompanyKindForAgents(members);
      if (!kind) continue;
      this.companies.set(id, { id, kind, agents: members, x, z, controllable, moving });
    }
    for (const camp of camps.values()) if (camp.active) this.camps.set(camp.id, camp);
    for (const id of [...this.selected]) if (!this.companies.has(id)) this.selected.delete(id);
    const friendlyMarkers = [...this.companies.values()].map((company) => ({
      id: company.id,
      kind: company.kind,
      agentIds: company.agents.map((agent) => agent.id),
      x: company.x,
      z: company.z,
      livingMembers: company.agents.length,
      controllable: company.controllable,
      moving: company.moving,
      hostile: false,
    }));
    const hostileMarkers = [...hostileGrouped.entries()].map(([id, members]) => ({
      id,
      kind: hostileCompanyStrategicKindForFaction(members[0]!.faction)!,
      agentIds: members.map((member) => member.id),
      x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
      z: members.reduce((sum, member) => sum + member.z, 0) / members.length,
      livingMembers: members.length,
      controllable: false,
      moving: members.some((member) => (
        member.status === 'advancing'
        || member.status === 'retreating'
        || member.status === 'returning'
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
    this.formationPreview.removeFromParent();
    this.formationPreview.geometry.dispose();
    this.formationPreview.material.dispose();
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
    }
    this.rings.clear();
    this.ringMaterial.dispose();
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.options.isBlocked() || this.companies.size === 0) return;
    if (event.button === 2) {
      if (this.selected.size > 0 && !event.altKey) this.rightClick.begin(event);
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

  getSelectedCompanyIds(): string[] {
    return [...this.selected];
  }

  shouldBlockCameraInput(event: MouseEvent): boolean {
    return event.button === 2 && !event.altKey && this.selected.size > 0 && !this.options.isBlocked();
  }

  private dragFormation(x: number, y: number, event: MouseEvent, commit: boolean): void {
    if (this.options.isBlocked() || !this.selected.size) { this.formationPreview.visible = false; return; }
    // TerrainProjector returns reusable scratch storage: preserve the first hit.
    const hit = this.options.terrainProjector.pick(x, y);
    const start = hit ? { x: hit.x, z: hit.z } : null;
    const end = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!start || !end) return;
    const companies = [...this.selected].map(id => this.companies.get(id)).filter((c): c is CompanyVisual => !!c?.controllable);
    if (!companies.length) return;
    const source = { x: companies.reduce((sum, c) => sum + c.x, 0) / companies.length, z: companies.reduce((sum, c) => sum + c.z, 0) / companies.length };
    const deployment = militaryDeploymentFromDrag(start, end, source);
    if (!commit) {
      const points = Array.from({ length: 25 }, (_, i) => {
        const px = start.x + (end.x-start.x) * i/24;
        const pz = start.z + (end.z-start.z) * i/24;
        return new THREE.Vector3(px, this.options.getHeightAt(px,pz) + 0.12, pz);
      });
      this.formationPreview.geometry.dispose();
      this.formationPreview.geometry = new THREE.BufferGeometry().setFromPoints(points);
      this.formationPreview.visible = true;
      return;
    }
    const witnesses = companies.map(c => c.agents.find(a => a.status !== 'downed')!.id);
    this.commandHandler(witnesses, deployment.x, deployment.z, null, null, 'move', deployment);
    this.orderFeedback.show(deployment.x, this.options.getHeightAt(deployment.x, deployment.z) + 0.055, deployment.z, 'move', this.now());
  }

  readonly selectCompany = (companyId: string): boolean => {
    const company = this.companies.get(companyId);
    if (!company) return false;
    this.selected.clear();
    this.selected.add(companyId);
    this.syncRings();
    this.strategicIcons.setSelected(companyId);
    this.options.onCompanySelected?.(companyId);
    if (!company.controllable) this.options.onLeavingCompanySelected?.(companyId);
    return true;
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
    let targetAgentId: string | null = null;
    for (const hostile of this.hostilePositions) {
      const distance = Math.hypot(hostile.x - point.x, hostile.z - point.z);
      if (distance <= 5.25 && distance < nearest) {
        nearest = distance;
        campId = null;
        targetAgentId = hostile.id;
      }
    }
    const agentIds = [...this.selected]
      .flatMap((companyId) => {
        const company = this.companies.get(companyId);
        const witness = company?.controllable
          ? company.agents.find((agent) => agent.status !== 'downed')
          : undefined;
        return witness ? [witness.id] : [];
      });
    if (agentIds.length === 0) return;
    const attacksHostile = campId !== null || targetAgentId !== null;
    this.commandHandler(
      agentIds,
      point.x,
      point.z,
      campId,
      targetAgentId,
      attacksHostile ? 'attack' : 'move',
    );
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
      for (const agent of company.agents) {
        visible.add(agent.id);
        let ring = this.rings.get(agent.id);
        if (!ring) {
          const mesh = new THREE.Mesh(unitSelectionRingGeometry(agent), this.ringMaterial);
          mesh.name = `Military unit selection ring: ${agent.id}`;
          mesh.renderOrder = 8;
          ring = { mesh, agent };
          this.rings.set(agent.id, ring);
          this.ringRoot.add(mesh);
        }
        ring.agent = agent;
        this.updateRingPosition(ring, true);
      }
    }
    for (const [id, ring] of this.rings) {
      if (visible.has(id)) continue;
      ring.mesh.removeFromParent();
      ring.mesh.geometry.dispose();
      this.rings.delete(id);
    }
  }

  private updateRingPosition(ring: UnitSelectionRing, force = false): void {
    const { x, z } = this.options.getAgentPosition?.(ring.agent.id) ?? ring.agent;
    const mesh = ring.mesh;
    if (!force && mesh.position.x === x && mesh.position.z === z) return;
    const groundY = this.options.getHeightAt(x, z);
    mesh.position.set(x, groundY, z);
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Keep the annulus in the ground's XZ plane and drape both edges over the
    // surface. Ordinary depth testing lets bodies and nearer terrain occlude it.
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      position.setY(vertex, this.options.getHeightAt(
        x + position.getX(vertex),
        z + position.getZ(vertex),
      ) + UNIT_SELECTION_RING_LIFT - groundY);
    }
    position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
}

function unitSelectionRingGeometry(agent: CombatAgentState): THREE.BufferGeometry {
  const mounted = agent.faction === 'hussar'
    || agent.faction === 'armored-lancer'
    || agent.faction === 'mounted-archer';
  const radius = mounted ? MOUNTED_SELECTION_RING_RADIUS : UNIT_SELECTION_RING_RADIUS;
  const ring = new THREE.RingGeometry(
    radius - UNIT_SELECTION_RING_WIDTH,
    radius,
    48,
  );
  ring.rotateX(-Math.PI / 2);
  // Dynamic overlays use a stable non-indexed buffer on both render backends.
  const geometry = ring.toNonIndexed();
  ring.dispose();
  (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  return geometry;
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
