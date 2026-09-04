import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';
import type { CombatAgentState } from '../src/security/combatAgents.ts';
import type { BanditCampState } from '../src/security/banditState.ts';
import {
  MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS,
  MilitaryOrderFeedbackRenderer,
  sampleMilitaryOrderFeedback,
} from '../src/security/MilitaryOrderFeedbackRenderer.ts';
import { CombatPlaytestSimulation } from '../src/app/combatPlaytest.ts';
import { sampleTerrainMeshSurfaceHeight } from '../src/terrain/TerrainMeshHeight.ts';

type Listener = (event: Event) => void;
type ListenerEntry = {
  listener: Listener;
  capture: boolean;
};

class FakeElement {
  private readonly classes = new Set<string>();
  readonly style = {
    setProperty(name: string, value: string): void {
      (this as unknown as Record<string, string>)[name] = value;
    },
  } as CSSStyleDeclaration;
  readonly children: unknown[] = [];
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, enabled?: boolean) => {
      const active = enabled ?? !this.classes.has(name);
      if (active) this.classes.add(name);
      else this.classes.delete(name);
      return active;
    },
  };
  className = '';
  hidden = false;
  innerHTML = '';
  textContent = '';
  type = '';
  alt = '';
  draggable = false;
  private readonly listeners = new Map<string, ListenerEntry[]>();
  private readonly attributes = new Map<string, string>();

  append(...children: unknown[]): void {
    this.children.push(...children);
  }

  appendChild<T>(child: T): T {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector<T>(selector: string): T | null {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return (this.children.find((child) => (
      child instanceof FakeElement
      && child.className.split(/\s+/).includes(className)
    )) ?? null) as T | null;
  }

  remove(): void {}

  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({
      listener,
      capture: typeof options === 'boolean' ? options : options?.capture === true,
    });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(type, listeners.filter((entry) => entry.listener !== listener));
  }

  dispatch(type: string, event: MouseEvent): void {
    const ordered = [...(this.listeners.get(type) ?? [])]
      .sort((left, right) => Number(right.capture) - Number(left.capture));
    for (const entry of ordered) {
      entry.listener(event);
      if ((event as MouseEvent & { immediatePropagationStopped?: boolean })
        .immediatePropagationStopped) return;
    }
  }

  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }
}

type WindowLike = EventEmitter & {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  dispatchEvent(event: Event): boolean;
};

const windowLike = new EventEmitter() as WindowLike;
windowLike.addEventListener = (type, listener) => windowLike.on(type, listener);
windowLike.removeEventListener = (type, listener) => windowLike.off(type, listener);
windowLike.dispatchEvent = (event) => {
  windowLike.emit(event.type, event);
  return true;
};
globalThis.window = windowLike as unknown as Window & typeof globalThis;
globalThis.document = {
  createElement: () => new FakeElement(),
} as unknown as Document;

const { MilitiaCommandController } = await import(
  '../src/security/MilitiaCommandController.ts'
);
const { shouldYieldDirectAgentClickToMilitaryCompany } = await import(
  '../src/ui/VillagerInspector.ts'
);
const { isHostileCombatFaction, selectablePlayerMilitaryCompanyId } = await import(
  '../src/security/combatAgents.ts'
);

assert.equal(
  shouldYieldDirectAgentClickToMilitaryCompany({ militaryCompanyId: 'company-a' }),
  true,
  'the individual-person inspector must yield a player company member click to RTS selection',
);
assert.equal(
  shouldYieldDirectAgentClickToMilitaryCompany({ militaryCompanyId: null }),
  false,
  'ordinary villagers and player-aligned non-company defenders remain individually inspectable',
);
for (const faction of ['bandit', 'raider', 'fox', 'wolf'] as const) {
  assert.equal(
    isHostileCombatFaction(faction),
    true,
    `${faction} actors must stay outside the player-unit selection path`,
  );
}
for (const faction of ['guard', 'dog', 'militia'] as const) {
  assert.equal(
    isHostileCombatFaction(faction),
    false,
    `${faction} actors should keep their player-aligned selection behavior`,
  );
}

const selectableMilitia = combatAgent('selection-active', 'militia', 'company-a', 0, 0);
assert.equal(selectablePlayerMilitaryCompanyId(selectableMilitia), 'company-a');
for (const status of ['downed', 'mustering', 'wounded-returning', 'recovering'] as const) {
  assert.equal(
    selectablePlayerMilitaryCompanyId({ ...selectableMilitia, status }),
    null,
    `${status} actors must remain with individual inspection because command selection excludes them`,
  );
}
assert.equal(
  selectablePlayerMilitaryCompanyId({ ...selectableMilitia, status: 'returning' }),
  'company-a',
  'a leaving company remains selectable so the player can pay it to stay',
);

const start = sampleMilitaryOrderFeedback(0);
const middle = sampleMilitaryOrderFeedback(MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS * 0.5);
const expired = sampleMilitaryOrderFeedback(MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS);
assert.equal(start.visible, true);
assert.ok(start.ringScale > middle.ringScale, 'the pickup ring should contract onto the order');
assert.ok(middle.opacity > 0.9, 'the destination must remain readable through the hold');
assert.deepEqual(expired, {
  visible: false,
  opacity: 0,
  ringScale: 1.3,
  chevronScale: 1.08,
  lift: 0.035,
});

const markerParent = new THREE.Group();
const marker = new MilitaryOrderFeedbackRenderer(markerParent);
marker.update(0);
assert.equal(marker.group.visible, false, 'an unused pooled marker must stay hidden');
marker.show(7, 2, -4, 'move', 1_000);
marker.update(1_400);
assert.equal(marker.group.visible, true);
assert.deepEqual(
  [marker.diagnostics(1_400).x, marker.diagnostics(1_400).y, marker.diagnostics(1_400).z],
  [7, 2, -4],
);
marker.update(1_000 + MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS * 1_000);
assert.equal(marker.group.visible, false, 'the feedback timeline must remove itself');
marker.dispose();
assert.equal(markerParent.children.length, 0);

const canvas = new FakeElement();
const uiRoot = new FakeElement();
const scene = new THREE.Group();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 10, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

let pickedPoint = { x: 12, z: -6 };
let dragPicking = false;
const dragHitScratch = new THREE.Vector3();
const deployments: { facingX: number; facingZ: number; frontage: number }[] = [];
let terrainHeight = (_x: number, _z: number): number => 2;
const renderedPositions = new Map<string, { x: number; z: number }>();
let nowMs = 4_000;
const orders: {
  ids: string[];
  x: number;
  z: number;
  campId: string | null;
  targetAgentId: string | null;
}[] = [];
let selectedCompany: string | null = null;
let selectedCompanyChanges = 0;
let ordinaryVillagerInspections = 0;
let capturedInspection: { militaryCompanyId: string | null } | null = {
  militaryCompanyId: 'company-a',
};

// Production constructs VillagerInspector first with a capture listener and
// MilitiaCommandController later with a bubbling listener. Reproduce that
// ordering so an individual-inspection regression cannot hide behind the
// controller's isolated click-selection coverage.
canvas.addEventListener('mousedown', (rawEvent) => {
  const event = rawEvent as MouseEvent;
  if (event.button !== 0 || !capturedInspection) return;
  if (shouldYieldDirectAgentClickToMilitaryCompany(capturedInspection)) return;
  ordinaryVillagerInspections += 1;
  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true });

const controller = new MilitiaCommandController({
  domElement: canvas as unknown as HTMLElement,
  uiRoot: uiRoot as unknown as HTMLElement,
  camera,
  terrainProjector: {
    pick: (x: number, y: number) => dragPicking ? dragHitScratch.set(x, 0, y) : ({ x: pickedPoint.x, y: 0, z: pickedPoint.z }),
  } as never,
  parent: scene,
  getHeightAt: (x, z) => terrainHeight(x, z),
  getAgentPosition: (id) => renderedPositions.get(id) ?? null,
  getZoomPercent: () => 100,
  isBlocked: () => false,
  onCommand: (ids, x, z, campId, targetAgentId, _kind, deployment) => {
    if (deployment) deployments.push(deployment);
    orders.push({
    ids,
    x,
    z,
    campId,
    targetAgentId,
    });
  },
  onCompanySelected: (companyId) => {
    selectedCompany = companyId;
    selectedCompanyChanges += 1;
  },
  now: () => nowMs,
});

const agents = new Map<string, CombatAgentState>([
  ['friendly-1', combatAgent('friendly-1', 'militia', 'company-a', 0, 0)],
  ['friendly-2', combatAgent('friendly-2', 'militia', 'company-a', 1, 0)],
  ['other-company-1', combatAgent('other-company-1', 'spearman', 'company-b', 8, 0)],
  ['raider-1', combatAgent('raider-1', 'raider', null, 12, -6)],
]);
controller.sync(agents, new Map<string, BanditCampState>());

const companyRingRoot = scene.getObjectByName('Military company selection rings');
assert.ok(companyRingRoot, 'the company selection-ring pool should be attached to the scene');
assert.equal(
  companyRingRoot.children.filter((ring) => ring.visible).length,
  0,
  'company selection rings must remain hidden until the player selects a company',
);

const screen = new THREE.Vector3(0, 3.2, 0).project(camera);
const selectX = (screen.x * 0.5 + 0.5) * 200;
const selectY = (-screen.y * 0.5 + 0.5) * 200;
canvas.dispatch('mousedown', mouseEvent('mousedown', 0, selectX, selectY, 1, canvas));
window.dispatchEvent(mouseEvent('mouseup', 0, selectX, selectY, 0, canvas));
assert.equal(selectedCompany, 'company-a', 'left-click must select the whole company');
assert.equal(
  companyRingRoot.children.filter((ring) => ring.visible).length,
  2,
  'selecting a company must ring every member, without marking the other company or enemies',
);
for (const child of companyRingRoot.children) {
  const ring = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  assert.equal(ring.material.color.getHex(), 0xffffff);
  assert.equal(ring.material.depthTest, true, 'soldiers and terrain must occlude the rings');
  assert.equal(ring.material.depthWrite, false);
}

controller.clearSelection();
assert.equal(
  companyRingRoot.children.filter((ring) => ring.visible).length,
  0,
  'clearing selection must immediately hide every pooled company selection ring',
);
selectedCompany = null;
selectedCompanyChanges = 0;
camera.position.set(0, 3.5, 4.5);
camera.lookAt(0, 2.9, 0);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();
const projectedFeet = new THREE.Vector3(0, 2.08, 0).project(camera);
const feetX = (projectedFeet.x * 0.5 + 0.5) * 200;
const feetY = (-projectedFeet.y * 0.5 + 0.5) * 200;
canvas.dispatch('mousedown', mouseEvent('mousedown', 0, feetX, feetY, 1, canvas));
window.dispatchEvent(mouseEvent('mouseup', 0, feetX, feetY, 0, canvas));
assert.equal(
  selectedCompany,
  'company-a',
  'clicking the visible feet or lower body must select the whole company, not require the chest pivot',
);
assert.equal(selectedCompanyChanges, 1, 'a direct soldier click must open exactly one company selection');
assert.equal(ordinaryVillagerInspections, 0, 'a player soldier must not show the individual villager marker');

// Scattered soldiers keep their own compact markers at their feet.
agents.set('friendly-2', combatAgent('friendly-2', 'militia', 'company-a', 120, 0));
controller.sync(agents, new Map<string, BanditCampState>());
assert.deepEqual(companyRingRoot.children.map((ring) => ring.position.x), [0, 120]);
const movingRing = companyRingRoot.children[1] as THREE.Mesh<THREE.BufferGeometry>;
const movingGeometry = movingRing.geometry;
const movingAttribute = movingGeometry.getAttribute('position');
terrainHeight = (x, z) => 2 + x * 0.3 + z * 0.2 + Math.abs(z) * 0.4;
renderedPositions.set('friendly-2', { x: 119.25, z: 0.15 });
controller.update(nowMs);
assert.equal(movingRing.position.x, 119.25, 'rings follow interpolated motion between simulation ticks');
assert.equal(movingRing.position.z, 0.15);
assert.equal(movingRing.geometry, movingGeometry, 'motion must reuse the uploaded geometry');
assert.equal(movingGeometry.getAttribute('position'), movingAttribute);
let lowestY = Infinity;
let highestY = -Infinity;
for (let vertex = 0; vertex < movingAttribute.count; vertex += 1) {
  const x = movingRing.position.x + movingAttribute.getX(vertex);
  const z = movingRing.position.z + movingAttribute.getZ(vertex);
  const y = movingRing.position.y + movingAttribute.getY(vertex);
  assert.ok(Math.abs(y - terrainHeight(x, z) - 0.025) < 1e-5, 'both ring edges must hug the terrain');
  assert.ok(Math.hypot(movingAttribute.getX(vertex), movingAttribute.getZ(vertex)) < 0.57);
  lowestY = Math.min(lowestY, y);
  highestY = Math.max(highestY, y);
}
assert.ok(highestY - lowestY > 0.3, 'the ring must wrap the ridge instead of using one flat elevation');
agents.set('friendly-2', { ...agents.get('friendly-2')!, status: 'downed' });
controller.sync(agents, new Map());
assert.equal(companyRingRoot.children.length, 1, 'casualties immediately lose their selection ring');
assert.equal(movingRing.parent, null, 'removed rings must leave the scene');
terrainHeight = () => 2;

// Surface decals must agree with actual mesh triangles on non-planar cells.
const terrainGeometry = new THREE.BufferGeometry();
terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(
  [-1, 0, -1, 1, 2, -1, -1, 1, 1, 1, 5, 1], 3,
));
terrainGeometry.setIndex([0, 2, 1, 1, 2, 3]);
const terrainMaterial = new THREE.MeshBasicMaterial();
const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrainMesh.updateMatrixWorld(true);
const terrainRay = new THREE.Raycaster();
for (const [x, z] of [[-0.8, -0.5], [0.7, 0.5], [0, 0], [1, 1]]) {
  terrainRay.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
  const hit = terrainRay.intersectObject(terrainMesh)[0];
  assert.ok(hit);
  assert.ok(Math.abs(sampleTerrainMeshSurfaceHeight(terrainGeometry, x, z, 2, 2) - hit.point.y) < 1e-6);
}
assert.equal(
  sampleTerrainMeshSurfaceHeight(terrainGeometry, 2, 2, 2, 2), 5,
  'surface sampling clamps to the terrain edge',
);
terrainGeometry.dispose();
terrainMaterial.dispose();

capturedInspection = { militaryCompanyId: null };
canvas.dispatch('mousedown', mouseEvent('mousedown', 0, 20, 20, 1, canvas));
window.dispatchEvent(mouseEvent('mouseup', 0, 20, 20, 0, canvas));
assert.equal(ordinaryVillagerInspections, 1, 'an ordinary villager must remain directly inspectable');
assert.equal(
  selectedCompanyChanges,
  1,
  'the ordinary villager capture listener must keep its click away from company selection',
);
capturedInspection = null;

canvas.dispatch('mousedown', mouseEvent('mousedown', 2, 70, 70, 2, canvas));
window.dispatchEvent(mouseEvent('mouseup', 2, 70, 70, 0, canvas));
assert.equal(orders.length, 1, 'stationary secondary click must issue exactly one order');
assert.deepEqual(orders[0], {
  ids: ['friendly-1'],
  x: 12,
  z: -6,
  campId: null,
  targetAgentId: 'raider-1',
});
assert.equal(
  controller.orderFeedbackDiagnostics().kind,
  'attack',
  'orders picked on a hostile rank should receive attack feedback',
);
assert.equal(controller.orderFeedbackDiagnostics().visible, true);

pickedPoint = { x: -18, z: 9 };
nowMs += 250;
canvas.dispatch('mousedown', { ...mouseEvent('mousedown', 2, 90, 90, 2, canvas), altKey: true } as MouseEvent);
window.dispatchEvent(mouseEvent('mousemove', 0, 102, 90, 2, canvas));
window.dispatchEvent(mouseEvent('mouseup', 2, 102, 90, 0, canvas));
assert.equal(
  orders.length,
  1,
  'Alt plus right-drag pans without emitting a company order',
);

canvas.dispatch('mousedown', mouseEvent('mousedown', 2, 90, 90, 2, canvas));
window.dispatchEvent(mouseEvent('mouseup', 2, 90, 90, 0, canvas));
assert.equal(orders.length, 2);
assert.deepEqual(orders[1]?.ids, ['friendly-1']);
assert.equal(controller.orderFeedbackDiagnostics().kind, 'move');
assert.deepEqual(
  [controller.orderFeedbackDiagnostics().x, controller.orderFeedbackDiagnostics().z],
  [-18, 9],
);
controller.update(nowMs + MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS * 1_000);
assert.equal(controller.orderFeedbackDiagnostics(
  nowMs + MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS * 1_000,
).visible, false);

const targetCamp: BanditCampState = {
  id: 'bandit-camp-77',
  x: 44,
  z: 18,
  health: 180,
  maxHealth: 180,
  active: true,
  stolenGoods: 0,
  spawnedTick: 0,
  nextTheftTick: 0,
  lastTheftTick: 0,
  destroyedTick: 0,
};
controller.sync(agents, new Map([[targetCamp.id, targetCamp]]));
pickedPoint = { x: 50.5, z: 20 };
nowMs += 500;
canvas.dispatch('mousedown', mouseEvent('mousedown', 2, 96, 96, 2, canvas));
window.dispatchEvent(mouseEvent('mouseup', 2, 96, 96, 0, canvas));
assert.equal(orders.length, 3, 'right-clicking anywhere in the physical camp footprint should issue an order');
assert.equal(orders[2]?.campId, targetCamp.id, 'the order must carry the authoritative bandit camp target id');
assert.equal(
  controller.orderFeedbackDiagnostics().kind,
  'attack',
  'targeted bandit camps should use attack-order feedback',
);

dragPicking = true;
const deploymentOrderCount = orders.length;
assert.equal(controller.shouldBlockCameraInput(mouseEvent('mousedown', 2, 30, 40, 2, canvas)), true);
assert.equal(controller.shouldBlockCameraInput({ ...mouseEvent('mousedown', 2, 30, 40, 2, canvas), altKey: true } as MouseEvent), false);
canvas.dispatch('mousedown', mouseEvent('mousedown', 2, 30, 40, 2, canvas));
window.dispatchEvent(mouseEvent('mousemove', 0, 50, 40, 2, canvas));
assert.equal(deployments.length, 0, 'the formation preview must not issue orders before release');
window.dispatchEvent(mouseEvent('mouseup', 2, 50, 40, 0, canvas));
assert.equal(orders.length, deploymentOrderCount + 1);
assert.deepEqual(deployments[0], { x: 40, z: 40, facingX: -0, facingZ: 1, frontage: 20 });
assert.equal(orders.at(-1)?.x, 40, 'reused terrain-hit scratch must not collapse the drag to its endpoint');
dragPicking = false;

camera.position.set(4, 12, 18);
camera.lookAt(4, 2, 0);
camera.updateMatrixWorld(true);
const otherCompanyScreen = new THREE.Vector3(8, 3.2, 0).project(camera);
const otherX = (otherCompanyScreen.x * 0.5 + 0.5) * 200;
const otherY = (-otherCompanyScreen.y * 0.5 + 0.5) * 200;
canvas.dispatch('mousedown', mouseEvent('mousedown', 0, otherX, otherY, 1, canvas));
window.dispatchEvent(mouseEvent('mouseup', 0, otherX, otherY, 0, canvas));
assert.equal(selectedCompany, 'company-b');
assert.deepEqual(
  companyRingRoot.children.map((ring) => ring.position.x), [8],
  'switching companies must remove every previous member ring',
);
assert.equal(controller.selectCompany('company-a'), true, 'a tray card must select through the same controller as a world click');
assert.equal(selectedCompany, 'company-a');
assert.deepEqual(controller.getSelectedCompanyIds(), ['company-a']);
assert.equal(controller.selectCompany('missing-company'), false);
assert.deepEqual(controller.getSelectedCompanyIds(), ['company-a'], 'stale card clicks must not replace a valid selection');
const changesBeforeBuildingSelection = selectedCompanyChanges;
controller.clearSelection(false);
assert.deepEqual(controller.getSelectedCompanyIds(), []);
assert.equal(selectedCompanyChanges, changesBeforeBuildingSelection, 'switching to building inspection must not clear that new inspector through a selection callback');
controller.dispose();
assert.equal(companyRingRoot.parent, null);
for (const type of ['mousemove', 'mouseup', 'blur']) {
  assert.equal(windowLike.listenerCount(type), 0, `dispose should release ${type} listeners`);
}

const moveSimulation = createPlaytestSimulation();
const movingIds = [...moveSimulation.snapshot().values()]
  .filter((agent) => agent.faction === 'man-at-arms')
  .map((agent) => agent.id);
const moveStartX = average(movingIds.map((id) => moveSimulation.snapshot().get(id)!.x));
assert.equal(moveSimulation.issueOrder(movingIds, -42, 18), 1);
for (let step = 0; step < 10; step += 1) moveSimulation.tick(0.05);
const moveFrame = moveSimulation.snapshot();
assert.ok(
  average(movingIds.map((id) => moveFrame.get(id)!.x)) < moveStartX - 0.35,
  'a terrain order must move the selected company toward its formation destination',
);
assert.ok(movingIds.every((id) => moveFrame.get(id)!.targetKind === 'ground'));

const attackSimulation = createPlaytestSimulation();
const attackOpening = attackSimulation.snapshot();
const attackingIds = [...attackOpening.values()]
  .filter((agent) => agent.faction === 'polearm')
  .map((agent) => agent.id);
const pickedRaider = [...attackOpening.values()].find((agent) => agent.faction === 'raider')!;
assert.equal(
  attackSimulation.issueOrder(attackingIds, pickedRaider.x, pickedRaider.z),
  1,
  'an enemy-rank pick should arm an attack order for the whole company',
);
attackSimulation.tick(0.05);
const attackFrame = attackSimulation.snapshot();
assert.ok(
  attackingIds.every((id) => attackFrame.get(id)!.targetKind === 'combat-agent'),
  'attack-ordered company members should acquire individual nearby hostile targets',
);

console.log('Military company selection, terrain-hugging unit rings, and order feedback passed.');

function mouseEvent(
  type: 'mousedown' | 'mousemove' | 'mouseup',
  button: number,
  clientX: number,
  clientY: number,
  buttons: number,
  target: FakeElement,
): MouseEvent {
  const event = {
    type,
    button,
    clientX,
    clientY,
    buttons,
    target,
    preventDefault() {},
    stopImmediatePropagation() {
      (event as typeof event & { immediatePropagationStopped?: boolean })
        .immediatePropagationStopped = true;
    },
  };
  return event as unknown as MouseEvent;
}

function combatAgent(
  id: string,
  faction: CombatAgentState['faction'],
  companyId: string | null,
  x: number,
  z: number,
): CombatAgentState {
  return {
    id,
    raidId: companyId ?? 'raid-a',
    faction,
    sourceBuildingId: null,
    sourceSlot: id.endsWith('2') ? 1 : 0,
    targetKind: 'ground',
    targetId: 'ground-1',
    x,
    z,
    homeX: x,
    homeZ: z,
    health: 100,
    maxHealth: 100,
    readiness: 1,
    status: faction === 'raider' ? 'advancing' : 'holding',
    attackCooldown: 0,
    lootProgress: 0,
    carryingLoot: false,
    issuedPolearms: 0,
    raidAnchorBuildingId: null,
    banditCampId: null,
    companyId,
    homeResidenceId: null,
    personIdentity: null,
    stateChangedTick: 0,
    routeProgress: 0,
  };
}

function createPlaytestSimulation(): CombatPlaytestSimulation {
  return new CombatPlaytestSimulation({
    site: { x: 0, z: 0, axisX: 1, axisZ: 0 },
    playableHalf: 248,
    preset: 'field',
    seed: 0x431a_2e0d,
  });
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
