import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';

type WindowLike = EventEmitter & {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
};

function ensureBrowserGlobals(): void {
  if (typeof globalThis.window !== 'undefined') return;
  const windowLike = new EventEmitter() as WindowLike;
  windowLike.setMaxListeners(0);
  windowLike.addEventListener = (type, listener) => {
    windowLike.on(type, listener);
  };
  windowLike.removeEventListener = (type, listener) => {
    windowLike.off(type, listener);
  };
  windowLike.dispatchEvent = (event) => {
    windowLike.emit(event.type, event);
    return true;
  };
  globalThis.window = windowLike as unknown as Window & typeof globalThis;
  globalThis.document = {
    body: { style: {} },
  } as unknown as Document;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(performance.now()), 0) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
}

ensureBrowserGlobals();

const { CameraController } = await import('../src/camera/CameraController.ts');
const { shouldDismissVillagerSelection } = await import('../src/ui/VillagerInspector.ts');
const {
  DEFAULT_FOV,
  ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT,
  RTS_ORBIT_PITCH,
  computeIllustratedMapFarPlane,
  computeIllustratedMapTerminalDistance,
  computeIllustratedMapZoomStops,
} = await import('../src/camera/CameraCurves.ts');

assert.equal(
  shouldDismissVillagerSelection(2, false, true),
  false,
  'RMB camera panning should preserve the selected villager route',
);
assert.equal(
  shouldDismissVillagerSelection(1, false, true),
  false,
  'middle-button camera rotation should preserve the selected villager route',
);
assert.equal(
  shouldDismissVillagerSelection(0, false, true),
  true,
  'left-clicking elsewhere should dismiss the selected villager route',
);
assert.equal(
  shouldDismissVillagerSelection(0, true, true),
  false,
  'outside clicks should be ignored when no villager panel is open',
);
assert.equal(
  shouldDismissVillagerSelection(0, false, false),
  false,
  'clicking inside the villager panel should preserve the selected route',
);

const DEFAULT_TEST_BOUNDS = {
  minX: -500,
  maxX: 500,
  minZ: -500,
  maxZ: 500,
};

function createDomElement(): HTMLElement {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, listener: EventListener, _options?: unknown) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: Event) {
      for (const listener of listeners.get(type) ?? []) {
        listener.call(this, event);
      }
    },
    contains: () => true,
    style: {},
  } as unknown as HTMLElement;
}

function createController(
  onViewChanged?: () => void,
  continuousRenderLoop = false,
  onIllustratedMapModeChanged?: (active: boolean) => void,
  bounds = DEFAULT_TEST_BOUNDS,
  cameraFar = 2600,
  isIllustratedMapReady: () => boolean = () => true,
): {
  controller: CameraController;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
} {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, cameraFar);
  const target = new THREE.Vector3(0, 0, 0);
  const domElement = createDomElement();
  const controller = new CameraController({
    camera,
    target,
    domElement,
    bounds,
    getHeightAt: () => 0,
    isIllustratedMapReady,
    onViewChanged,
    continuousRenderLoop,
    onIllustratedMapModeChanged,
  });
  return { controller, camera, target, domElement };
}

function mouseEvent(init: {
  type: string;
  button?: number;
  clientX?: number;
  clientY?: number;
  buttons?: number;
}): MouseEvent {
  return {
    type: init.type,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    buttons: init.buttons ?? 0,
    bubbles: true,
    preventDefault() {},
  } as MouseEvent;
}

function wheelEvent(init: {
  deltaY?: number;
  deltaX?: number;
  deltaMode?: number;
}): WheelEvent {
  return {
    type: 'wheel',
    deltaY: init.deltaY ?? 0,
    deltaX: init.deltaX ?? 0,
    deltaMode: init.deltaMode ?? 0,
    bubbles: true,
    cancelable: true,
    preventDefault() {},
  } as WheelEvent;
}

function keyboardEvent(type: 'keydown' | 'keyup', key: string): KeyboardEvent {
  return {
    type,
    key,
    bubbles: true,
    preventDefault() {},
  } as KeyboardEvent;
}

function rmbPan(domElement: HTMLElement, fromX: number, fromY: number, toX: number, toY: number): void {
  domElement.dispatch('mousedown', mouseEvent({
    type: 'mousedown',
    button: 2,
    clientX: fromX,
    clientY: fromY,
  }));
  window.dispatchEvent(mouseEvent({
    type: 'mousemove',
    clientX: toX,
    clientY: toY,
    buttons: 2,
  }));
}

function mmbOrbit(domElement: HTMLElement, fromX: number, fromY: number, toX: number, toY: number): void {
  domElement.dispatch('mousedown', mouseEvent({
    type: 'mousedown',
    button: 1,
    clientX: fromX,
    clientY: fromY,
  }));
  window.dispatchEvent(mouseEvent({
    type: 'mousemove',
    clientX: toX,
    clientY: toY,
    buttons: 4,
  }));
}

function releaseMouse(button: number): void {
  window.dispatchEvent(mouseEvent({
    type: 'mouseup',
    button,
  }));
}

function advanceController(
  controller: CameraController,
  seconds: number,
  frameDt = 1 / 60,
): void {
  const frameCount = Math.ceil(seconds / frameDt);
  for (let frame = 0; frame < frameCount; frame += 1) {
    controller.update(frameDt);
  }
}

function settleZoom(controller: CameraController): void {
  advanceController(controller, 0.6);
}

function settleNavigation(controller: CameraController): void {
  advanceController(controller, 0.8);
}

function scrollToLiveWorldMaximum(
  controller: CameraController,
  domElement: HTMLElement,
): void {
  for (let step = 0; step < 40 && controller.getZoomPercent() > 30; step += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
    settleZoom(controller);
  }
}

{
  const { controller, target, domElement } = createController(undefined, true);
  const startX = target.x;
  rmbPan(domElement, 100, 100, 160, 100);
  assert.equal(controller.isNavigationActive(), true,
    'RMB pan should expose active navigation to render scheduling');
  assert.equal(target.x, startX,
    'raw RMB movement should set a smooth destination instead of moving immediately');
  controller.update(1 / 60);
  const firstFrameX = target.x;
  assert.ok(firstFrameX > startX,
    'RMB panning should begin on the next render frame');
  releaseMouse(2);
  assert.equal(controller.isNavigationActive(), true,
    'the short RMB glide should remain active after release until it settles');
  settleNavigation(controller);
  assert.ok(target.x > firstFrameX,
    'RMB panning should smoothly converge after the raw drag ends');
  assert.equal(controller.isNavigationActive(), false,
    'RMB navigation should become idle once the glide is exact');
  const settledX = target.x;
  controller.update(0.2);
  assert.equal(target.x, settledX,
    'a settled RMB pan must not keep drifting');
}

{
  const { controller, domElement } = createController(undefined, true);
  const yawBefore = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 140, 100);
  assert.equal(controller.getYaw(), yawBefore,
    'raw middle-drag movement should set a smooth orbit destination');
  controller.update(1 / 60);
  const firstFrameYaw = controller.getYaw();
  assert.ok(firstFrameYaw > yawBefore,
    'middle-drag orbit should begin on the next render frame');
  releaseMouse(1);
  settleNavigation(controller);
  assert.ok(controller.getYaw() > firstFrameYaw,
    'middle-drag orbit should smoothly converge after release');
  assert.ok(Math.abs(controller.getYaw() - (yawBefore + 40 * 0.005)) < 1e-9,
    'middle-drag smoothing must preserve the complete authored orbit delta');
}

{
  const coarse = createController(undefined, true);
  const fine = createController(undefined, true);
  mmbOrbit(coarse.domElement, 100, 100, 140, 130);
  mmbOrbit(fine.domElement, 100, 100, 140, 130);
  coarse.controller.update(0.1);
  for (let frame = 0; frame < 10; frame += 1) fine.controller.update(0.01);
  assert.ok(
    Math.abs(coarse.controller.getYaw() - fine.controller.getYaw()) < 1e-9,
    'middle-drag damping should produce the same response across frame rates',
  );
  coarse.controller.dispose();
  fine.controller.dispose();
}

{
  const { controller, target } = createController(undefined, true);
  const startX = target.x;
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
  assert.equal(controller.isNavigationActive(), true,
    'keyboard pan should share the camera navigation activity state');
  controller.update(0.05);
  const firstFrameX = target.x;
  assert.ok(firstFrameX < startX,
    'right-arrow panning should begin smoothly on the first frame');
  controller.update(0.05);
  const secondFrameX = target.x;
  assert.ok(
    Math.abs(secondFrameX - firstFrameX) > Math.abs(firstFrameX - startX),
    'held arrow panning should accelerate toward its authored speed',
  );
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  assert.equal(controller.isNavigationActive(), true,
    'keyboard release should retain navigation activity during the short glide');
  controller.update(1 / 60);
  assert.ok(target.x < secondFrameX,
    'released arrow panning should decelerate instead of stopping abruptly');
  settleNavigation(controller);
  assert.equal(controller.isNavigationActive(), false,
    'keyboard navigation should become idle after its velocity settles');
  const settledX = target.x;
  controller.update(0.2);
  assert.equal(target.x, settledX,
    'settled keyboard panning must not keep drifting');
  controller.dispose();
}

{
  const coarse = createController(undefined, true);
  const fine = createController(undefined, true);
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  coarse.controller.update(0.1);
  for (let frame = 0; frame < 10; frame += 1) fine.controller.update(0.01);
  assert.ok(
    coarse.target.distanceTo(fine.target) < 1e-9,
    'arrow-key acceleration should produce the same travel across frame rates',
  );
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  coarse.controller.update(0.1);
  for (let frame = 0; frame < 10; frame += 1) fine.controller.update(0.01);
  assert.ok(
    coarse.target.distanceTo(fine.target) < 1e-9,
    'arrow-key deceleration should produce the same travel across frame rates',
  );
  coarse.controller.dispose();
  fine.controller.dispose();
}

{
  const straight = createController(undefined, true);
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  straight.controller.update(0.1);
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  const straightDistance = straight.target.length();
  straight.controller.dispose();

  const diagonal = createController(undefined, true);
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
  diagonal.controller.update(0.1);
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  assert.ok(
    Math.abs(diagonal.target.length() - straightDistance) < 1e-9,
    'diagonal arrow panning should retain the authored cardinal movement speed',
  );
  assert.ok(diagonal.target.x < 0 && diagonal.target.z > 0,
    'combined arrows should smoothly pan along both requested axes');
  diagonal.controller.dispose();
}

{
  const directions = [
    { key: 'ArrowUp', axis: 'z' as const, sign: 1 },
    { key: 'ArrowDown', axis: 'z' as const, sign: -1 },
    { key: 'ArrowLeft', axis: 'x' as const, sign: 1 },
    { key: 'ArrowRight', axis: 'x' as const, sign: -1 },
  ];
  for (const direction of directions) {
    const { controller, target } = createController(undefined, true);
    window.dispatchEvent(keyboardEvent('keydown', direction.key));
    controller.update(0.1);
    window.dispatchEvent(keyboardEvent('keyup', direction.key));
    settleNavigation(controller);
    assert.ok(
      Math.sign(target[direction.axis]) === direction.sign,
      `${direction.key} should pan along its expected map axis`,
    );
    controller.dispose();
  }
}

{
  let viewChangeCount = 0;
  const { controller, target } = createController(() => {
    viewChangeCount += 1;
  });
  const startZ = target.z;
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(target.z > startZ,
    'demand-rendered arrow panning should start its own navigation frame');
  assert.ok(viewChangeCount > 0,
    'demand-rendered arrow panning should invalidate the visible scene');
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  controller.setInputEnabled(false);
  controller.dispose();
}

{
  const { controller, target } = createController(undefined, true);
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowLeft'));
  controller.update(0.05);
  const targetBeforeBlur = target.clone();
  window.dispatchEvent({ type: 'blur' } as Event);
  assert.equal(controller.isNavigationActive(), false,
    'window blur should clear held keyboard navigation state');
  controller.update(0.5);
  assert.ok(target.equals(targetBeforeBlur),
    'window blur should prevent a released focus from leaving keyboard drift');
  controller.dispose();
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.getOrbitDistance(), distanceBefore,
    'wheel input should set a destination instead of teleporting the camera');
  assert.equal(controller.isNavigationActive(), true,
    'wheel zoom should hold the resident forest set while the input burst settles');
  controller.update(1 / 60);
  const firstFrameDistance = controller.getOrbitDistance();
  assert.ok(firstFrameDistance > distanceBefore,
    'outward zoom should begin moving on the next render frame');
  assert.ok(firstFrameDistance < distanceBefore * 1.18,
    'the first frame should remain between the old and requested zoom stops');
  settleZoom(controller);
  assert.ok(Math.abs(controller.getOrbitDistance() - distanceBefore * 1.18) < 1e-9,
    'the damped zoom should converge exactly to its requested stop');
  await new Promise<void>((resolve) => setTimeout(resolve, 230));
  assert.equal(controller.isNavigationActive(), false,
    'navigation activity should clear after the glide and wheel grace both settle');
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  controller.setInputEnabled(false);
  assert.equal(controller.isNavigationActive(), false,
    'disabling camera input should clear the wheel navigation grace period');
  const disabledDistance = controller.getOrbitDistance();
  controller.update(0.5);
  assert.equal(controller.getOrbitDistance(), disabledDistance,
    'disabling input mid-glide should cancel the queued zoom motion');
}

{
  const coarse = createController(undefined, true);
  const fine = createController(undefined, true);
  coarse.domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  fine.domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  coarse.controller.update(0.1);
  for (let frame = 0; frame < 10; frame += 1) fine.controller.update(0.01);
  assert.ok(
    Math.abs(coarse.controller.getOrbitDistance() - fine.controller.getOrbitDistance()) < 1e-9,
    'zoom damping should produce the same response across different frame rates',
  );
  coarse.controller.dispose();
  fine.controller.dispose();
}

{
  const { controller, domElement } = createController(undefined, true);
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  controller.update(0.05);
  const outwardDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  controller.update(0.05);
  const reversedDistance = controller.getOrbitDistance();
  assert.ok(outwardDistance > distanceBefore,
    'the reversal regression should begin during an outward glide');
  assert.ok(reversedDistance < outwardDistance,
    'reversing the wheel should redirect the in-flight glide without overshoot');
  assert.ok(reversedDistance >= distanceBefore,
    'a reversed glide should stay inside its newly requested stop');
  settleZoom(controller);
  assert.ok(Math.abs(controller.getOrbitDistance() - distanceBefore) < 1e-9,
    'the reversed glide should converge to the reciprocal starting stop');
}

{
  const { controller, domElement } = createController(undefined, true);
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  assert.equal(controller.getOrbitDistance(), distanceBefore,
    'rapid wheel input should keep composing destinations without moving between events');
  controller.update(1 / 60);
  assert.ok(controller.getOrbitDistance() < distanceBefore,
    'a rapid inward burst should begin as one continuous glide');
  settleZoom(controller);
  assert.ok(
    Math.abs(controller.getOrbitDistance() - distanceBefore / (1.18 * 1.18)) < 1e-9,
    'rapid wheel steps should compose from the requested target, not the in-flight distance',
  );
}

{
  const outward = createController(undefined, true);
  const inward = createController(undefined, true);
  outward.controller.applyShowcaseView(0, 0, undefined, undefined, 100);
  inward.controller.applyShowcaseView(0, 0, undefined, undefined, 118);
  outward.domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  inward.domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  outward.controller.update(0.05);
  inward.controller.update(0.05);
  const outwardLogProgress = Math.log(outward.controller.getOrbitDistance() / 100)
    / Math.log(1.18);
  const inwardLogProgress = Math.log(118 / inward.controller.getOrbitDistance())
    / Math.log(1.18);
  assert.ok(Math.abs(outwardLogProgress - inwardLogProgress) < 1e-9,
    'reciprocal zoom directions should cover equal logarithmic distance per frame');
  outward.controller.dispose();
  inward.controller.dispose();
}

{
  let viewChangeCount = 0;
  const { controller, domElement } = createController(() => {
    viewChangeCount += 1;
  });
  const distanceBefore = controller.getOrbitDistance();
  rmbPan(domElement, 0, 0, 20, 0);
  releaseMouse(2);
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(controller.getOrbitDistance() > distanceBefore,
    'non-continuous camera owners should receive an internal zoom animation frame');
  assert.equal(viewChangeCount, 1,
    'pan and zoom should coalesce into one non-continuous render frame');
  controller.setInputEnabled(false);
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  for (let index = 0; index < 7; index += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 10 }));
  }
  assert.equal(controller.getOrbitDistance(), distanceBefore,
    'trackpad micro-deltas should not zoom before the accumulated threshold');
  domElement.dispatch('wheel', wheelEvent({ deltaY: 10 }));
  controller.update(1 / 60);
  assert.ok(controller.getOrbitDistance() > distanceBefore,
    'same-direction trackpad micro-deltas should zoom at the threshold');

  settleZoom(controller);
  const afterOutwardStep = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 40 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: -40 }));
  assert.equal(controller.getOrbitDistance(), afterOutwardStep,
    'reversing a partial trackpad gesture should reset its prior accumulation');
  domElement.dispatch('wheel', wheelEvent({ deltaY: -40 }));
  controller.update(1 / 60);
  assert.ok(controller.getOrbitDistance() < afterOutwardStep,
    'the reversed gesture should zoom only after reaching its own threshold');
  settleZoom(controller);
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 4000 }));
  settleZoom(controller);
  assert.ok(
    Math.abs(controller.getOrbitDistance() - distanceBefore * 1.18) < 1e-9,
    'one coarse wheel event must advance at most one live-world zoom step',
  );
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 3, deltaMode: 1 }));
  controller.update(1 / 60);
  assert.ok(controller.getOrbitDistance() > distanceBefore,
    'line-mode mouse wheels should normalize into one thresholded zoom step');
}

{
  const { controller } = createController();
  const navigationKeys = [
    'w',
    'a',
    's',
    'd',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'q',
    'e',
  ];
  for (const key of navigationKeys) {
    window.dispatchEvent(keyboardEvent('keydown', key));
    assert.equal(controller.isNavigationActive(), true,
      `${key} should mark keyboard navigation active`);
    window.dispatchEvent(keyboardEvent('keyup', key));
    assert.equal(controller.isNavigationActive(), false,
      `${key} release should clear keyboard navigation activity`);
  }
  window.dispatchEvent(keyboardEvent('keydown', 'f'));
  assert.equal(controller.isNavigationActive(), false,
    'non-navigation shortcuts should not hold forest interaction work');
  window.dispatchEvent(keyboardEvent('keyup', 'f'));
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, domElement } = createController(
    undefined,
    true,
    (active) => mapModeChanges.push(active),
  );
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.getOrbitDistance(), distanceBefore,
    'a rapid map-entry burst should remain on the rendered live-world glide');
  assert.equal(controller.isIllustratedMapActive(), false,
    'map render ownership should wait for the camera to reach the continuity stop');
  controller.update(0.05);
  assert.equal(controller.isIllustratedMapActive(), false,
    'the map handoff must remain pending while the live camera is still moving');
  settleZoom(controller);
  assert.equal(controller.isIllustratedMapActive(), true,
    'the queued map handoff should complete once the 30% live view is exact');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'the queued handoff should preserve the exact live/map continuity pose');
  assert.deepEqual(mapModeChanges, [true]);
}

{
  const { controller, domElement } = createController(undefined, true);
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  controller.update(0.05);
  controller.applyShowcaseView(30, -40, undefined, undefined, 70);
  assert.ok(Math.abs(controller.getOrbitDistance() - 70) < 1e-9,
    'a scripted view should replace an in-flight wheel destination immediately');
  settleZoom(controller);
  assert.ok(Math.abs(controller.getOrbitDistance() - 70) < 1e-9,
    'a stale wheel destination must not pull after a scripted camera reset');
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, domElement } = createController(
    undefined,
    true,
    (active) => mapModeChanges.push(active),
  );
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  settleZoom(controller);
  assert.equal(controller.isIllustratedMapActive(), false,
    'one reciprocal step should cancel a pending map handoff');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'cancelling the pending handoff should remain at the live overview stop');
  assert.deepEqual(mapModeChanges, []);
}

{
  let mapReady = false;
  const mapModeChanges: boolean[] = [];
  const { controller, camera, target, domElement } = createController(
    undefined,
    true,
    (active) => mapModeChanges.push(active),
    DEFAULT_TEST_BOUNDS,
    2600,
    () => mapReady,
  );
  scrollToLiveWorldMaximum(controller, domElement);
  const liveWorldDistance = controller.getOrbitDistance();
  const liveWorldFar = camera.far;
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.isIllustratedMapActive(), false,
    'the camera must not hand render ownership to an unready illustrated plane');
  assert.equal(controller.getOrbitDistance(), liveWorldDistance,
    'a denied map handoff should remain at the live-world overview boundary');
  assert.equal(camera.far, liveWorldFar,
    'a denied map handoff must not take projection ownership');
  assert.deepEqual(mapModeChanges, []);

  mapReady = true;
  domElement.dispatch('wheel', wheelEvent({ deltaY: 4000 }));
  assert.equal(controller.isIllustratedMapActive(), true,
    'one coarse event should enter, but not skip beyond, the map handoff tier');
  assert.equal(controller.getOrbitDistance(), liveWorldDistance,
    'the coarse entry event must retain the continuity stop');
  assert.deepEqual(mapModeChanges, [true]);
  const readyStops = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    liveWorldDistance,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: RTS_ORBIT_PITCH,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  domElement.dispatch('wheel', wheelEvent({ deltaY: 4000 }));
  assert.equal(controller.getOrbitDistance(), liveWorldDistance,
    'one coarse map event should set a destination without teleporting tiers');
  controller.update(1 / 60);
  assert.ok(
    controller.getOrbitDistance() > liveWorldDistance
      && controller.getOrbitDistance() < readyStops[1],
    'coarse paper-map zoom should glide between its continuity and authored stops',
  );
  settleZoom(controller);
  assert.ok(Math.abs(controller.getOrbitDistance() - readyStops[1]) < 1e-9,
    'one coarse map event must advance exactly one illustrated tier');
  controller.dispose();
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, camera, target, domElement } = createController(
    undefined,
    true,
    (active) => mapModeChanges.push(active),
  );
  scrollToLiveWorldMaximum(controller, domElement);
  assert.ok(
    Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'the live 3D world should still stop at the existing 30% overview',
  );
  assert.equal(controller.isIllustratedMapActive(), false);
  const liveWorldDistance = controller.getOrbitDistance();
  const liveWorldCameraPosition = camera.position.clone();
  const liveWorldCameraQuaternion = camera.quaternion.clone();
  const liveWorldFarPlane = camera.far;
  const liveWorldNearPlane = camera.near;
  const liveWorldFov = camera.fov;
  const expectedMapStops = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    liveWorldDistance,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: RTS_ORBIT_PITCH,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  const expectedMapFarPlane = computeIllustratedMapFarPlane(
    DEFAULT_TEST_BOUNDS,
    expectedMapStops[expectedMapStops.length - 1],
    liveWorldFarPlane,
  );

  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.isIllustratedMapActive(), true,
    'one additional outward wheel step should enter the illustrated map tier');
  assert.equal(controller.getOrbitDistance(), liveWorldDistance,
    'the map handoff should retain the existing maximum overview distance');
  assert.ok(camera.position.distanceTo(liveWorldCameraPosition) < 1e-9,
    'the render-owner handoff must not introduce a camera-position cut');
  assert.ok(camera.quaternion.angleTo(liveWorldCameraQuaternion) < 1e-7,
    'the render-owner handoff must not introduce a camera-orientation cut');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'the actual camera zoom should remain at the live overview scale');
  assert.ok(Math.abs(controller.getHudZoomPercent() - 30) < 1e-9,
    'the HUD should retain the actual zoom percentage across the map handoff');
  assert.ok(Math.abs(camera.far - expectedMapFarPlane) < 1e-9,
    'map mode should expand the far plane for its scale-derived maximum tier');
  assert.equal(camera.near, liveWorldNearPlane,
    'map projection ownership must not alter the world near plane');
  assert.equal(camera.fov, liveWorldFov,
    'map projection ownership must not alter the world lens');
  assert.deepEqual(mapModeChanges, [true]);

  const visitedMapStops = [controller.getOrbitDistance()];
  for (let tier = 1; tier <= ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    const distanceBeforeTier = controller.getOrbitDistance();
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
    assert.equal(controller.isIllustratedMapActive(), true,
      `outward illustrated-map tier ${tier} should retain map render ownership`);
    assert.equal(controller.getOrbitDistance(), distanceBeforeTier,
      `outward illustrated-map tier ${tier} should begin from the rendered pose`);
    controller.update(1 / 60);
    assert.ok(
      controller.getOrbitDistance() > distanceBeforeTier
        && controller.getOrbitDistance() < expectedMapStops[tier],
      `outward illustrated-map tier ${tier} should move smoothly on its first frame`,
    );
    settleZoom(controller);
    visitedMapStops.push(controller.getOrbitDistance());
    assert.ok(
      Math.abs(controller.getOrbitDistance() - expectedMapStops[tier]) < 1e-9,
      `outward illustrated-map tier ${tier} should use its authored geometric stop`,
    );
    assert.ok(
      visitedMapStops[tier] > visitedMapStops[tier - 1],
      `outward illustrated-map tier ${tier} should be meaningfully farther out`,
    );
  }
  const tierRatios = visitedMapStops.slice(1).map(
    (distance, index) => distance / visitedMapStops[index],
  );
  assert.ok(
    Math.max(...tierRatios) - Math.min(...tierRatios) < 1e-9,
    'illustrated-map stops should be geometrically spaced',
  );
  const outerRegionalDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.getOrbitDistance(), outerRegionalDistance,
    'outward scrolling should clamp at the outer regional tier');

  const yawBefore = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 140, 100);
  assert.equal(controller.getYaw(), yawBefore,
    'paper-map middle drag should retain its current pose until the render frame');
  controller.update(1 / 60);
  assert.ok(controller.getYaw() > yawBefore,
    'smooth orbit rotation should remain active over the illustrated map');
  releaseMouse(1);
  settleNavigation(controller);
  const targetBeforePan = target.clone();
  rmbPan(domElement, 100, 100, 140, 100);
  assert.ok(target.equals(targetBeforePan),
    'paper-map RMB drag should retain its current pose until the render frame');
  controller.update(1 / 60);
  assert.ok(!target.equals(targetBeforePan),
    'smooth world-space panning should remain active over the illustrated map');
  releaseMouse(2);
  settleNavigation(controller);
  const targetBeforeArrowPan = target.clone();
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  controller.update(1 / 60);
  assert.ok(!target.equals(targetBeforeArrowPan),
    'smooth arrow-key panning should remain active over the outer paper-map tier');
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  settleNavigation(controller);
  const adjustedMapStops = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    liveWorldDistance,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: RTS_ORBIT_PITCH,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  const adjustedMapFarPlane = computeIllustratedMapFarPlane(
    DEFAULT_TEST_BOUNDS,
    adjustedMapStops[adjustedMapStops.length - 1],
    liveWorldFarPlane,
  );
  assert.ok(
    Math.abs(controller.getOrbitDistance()
      - adjustedMapStops.at(-1)!) < 1e-9,
    'the active outer regional tier should recompute after orbit and pan input',
  );

  for (let tier = ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT - 1; tier >= 0; tier -= 1) {
    const distanceBeforeTier = controller.getOrbitDistance();
    domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
    assert.equal(controller.isIllustratedMapActive(), true,
      `returning to illustrated-map tier ${tier} should retain map render ownership`);
    assert.equal(controller.getOrbitDistance(), distanceBeforeTier,
      `returning to illustrated-map tier ${tier} should not teleport`);
    controller.update(1 / 60);
    assert.ok(
      controller.getOrbitDistance() < distanceBeforeTier
        && controller.getOrbitDistance() > adjustedMapStops[tier],
      `returning to illustrated-map tier ${tier} should glide on its first frame`,
    );
    settleZoom(controller);
    assert.ok(
      Math.abs(controller.getOrbitDistance() - adjustedMapStops[tier]) < 1e-9,
      `inward scrolling should revisit illustrated-map tier ${tier}`,
    );
    assert.equal(camera.far, adjustedMapFarPlane,
      'the map far plane should remain owned until the render-owner handoff ends');
  }
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  assert.equal(controller.isIllustratedMapActive(), false,
    'scrolling inward from the entry map tier should return to the live 30% overview');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9);
  assert.ok(Math.abs(controller.getHudZoomPercent() - 30) < 1e-9);
  assert.equal(camera.far, liveWorldFarPlane,
    'leaving the illustrated map should restore the exact world far plane');
  assert.equal(camera.near, liveWorldNearPlane);
  assert.equal(camera.fov, liveWorldFov);
  assert.deepEqual(
    mapModeChanges,
    [true, false],
    'the render owner should receive one callback for each map handoff',
  );
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, domElement } = createController(
    undefined,
    true,
    (active) => mapModeChanges.push(active),
  );
  scrollToLiveWorldMaximum(controller, domElement);
  const liveWorldDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  for (let tier = 0; tier < ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
  settleZoom(controller);
  const outerMapDistance = controller.getOrbitDistance();

  for (let step = 0; step <= ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; step += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  }
  assert.equal(controller.isIllustratedMapActive(), true,
    'a rapid inward burst should keep paper render ownership during the glide');
  assert.equal(controller.getOrbitDistance(), outerMapDistance,
    'a rapid inward burst should not cut directly from the outer map pose');
  controller.update(1 / 60);
  assert.ok(
    controller.getOrbitDistance() < outerMapDistance
      && controller.getOrbitDistance() > liveWorldDistance,
    'the queued map exit should move smoothly toward the continuity stop',
  );
  const interruptedDistance = controller.getOrbitDistance();
  controller.setInputEnabled(false);
  assert.equal(controller.isNavigationActive(), false,
    'temporarily disabled input should hide the paused map glide from navigation state');
  controller.update(0.5);
  assert.equal(controller.getOrbitDistance(), interruptedDistance,
    'temporarily disabled input should pause the in-flight map handoff');
  assert.equal(controller.isIllustratedMapActive(), true,
    'pausing input must preserve paper render ownership mid-handoff');
  controller.setInputEnabled(true);
  assert.equal(controller.isNavigationActive(), true,
    're-enabling input should resume the preserved map destination');
  settleNavigation(controller);
  assert.equal(controller.isIllustratedMapActive(), false,
    'the paper render owner should release only after reaching the exact continuity stop');
  assert.ok(Math.abs(controller.getOrbitDistance() - liveWorldDistance) < 1e-9);
  assert.deepEqual(mapModeChanges, [true, false]);
  controller.dispose();
}

{
  const { controller, camera, target, domElement } = createController(undefined, false);
  camera.aspect = 1.8;
  camera.updateProjectionMatrix();
  const authoredPitch = THREE.MathUtils.degToRad(18);
  controller.applyShowcaseView(
    430,
    -470,
    THREE.MathUtils.degToRad(23),
    authoredPitch,
    100_000,
  );
  const mapEntryDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  for (let tier = 0; tier < ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
  settleZoom(controller);
  const wideFrame = {
    aspect: camera.aspect,
    yaw: controller.getYaw(),
    pitch: authoredPitch,
    targetX: target.x,
    targetZ: target.z,
  };
  const expectedWideOuterStop = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    mapEntryDistance,
    wideFrame,
  ).at(-1)!;
  const wideFullDeskFit = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    wideFrame,
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedWideOuterStop) < 1e-9,
    'the outer regional tier should solve the current aspect, pose, and panned target');
  assert.ok(controller.getOrbitDistance() < wideFullDeskFit,
    'the outer regional tier should stop before the removed full-desk fit');

  const wideOuterStop = controller.getOrbitDistance();
  camera.aspect = 0.62;
  camera.updateProjectionMatrix();
  window.dispatchEvent({ type: 'resize' } as Event);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const portraitFrame = {
    aspect: camera.aspect,
    yaw: controller.getYaw(),
    pitch: authoredPitch,
    targetX: target.x,
    targetZ: target.z,
  };
  const expectedPortraitOuterStop = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    mapEntryDistance,
    portraitFrame,
  ).at(-1)!;
  const portraitFullDeskFit = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    portraitFrame,
  );
  assert.equal(controller.getOrbitDistance(), wideOuterStop,
    'a portrait resize should retarget without teleporting the rendered map pose');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(
    controller.getOrbitDistance() > wideOuterStop
      && controller.getOrbitDistance() < expectedPortraitOuterStop,
    'demand rendering should animate a resized outer regional tier',
  );
  settleZoom(controller);
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedPortraitOuterStop) < 1e-9,
    'resize recomputation should use the exact current-aspect outer regional stop');
  assert.ok(controller.getOrbitDistance() < portraitFullDeskFit,
    'portrait recomputation should remain below the removed full-desk fit');

  mmbOrbit(domElement, 100, 100, 160, 170);
  controller.update(1 / 60);
  releaseMouse(1);
  settleNavigation(controller);
  const rotatedPitch = THREE.MathUtils.clamp(
    authoredPitch + 70 * 0.004,
    THREE.MathUtils.degToRad(5),
    THREE.MathUtils.degToRad(70),
  );
  const rotatedFrame = {
    aspect: camera.aspect,
    yaw: controller.getYaw(),
    pitch: rotatedPitch,
    targetX: target.x,
    targetZ: target.z,
  };
  const expectedRotatedOuterStop = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    mapEntryDistance,
    rotatedFrame,
  ).at(-1)!;
  const rotatedFullDeskFit = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    rotatedFrame,
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedRotatedOuterStop) < 1e-9,
    'orbit input should recompute the active outer regional stop');
  assert.ok(controller.getOrbitDistance() < rotatedFullDeskFit,
    'rotated recomputation should remain below the removed full-desk fit');

  const targetBeforePan = target.clone();
  rmbPan(domElement, 100, 100, -100, -40);
  controller.update(1 / 60);
  releaseMouse(2);
  settleNavigation(controller);
  assert.ok(!target.equals(targetBeforePan),
    'the regional-stop regression should exercise a newly panned target');
  const pannedFrame = {
    aspect: camera.aspect,
    yaw: controller.getYaw(),
    pitch: rotatedPitch,
    targetX: target.x,
    targetZ: target.z,
  };
  const expectedPannedOuterStop = computeIllustratedMapZoomStops(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    mapEntryDistance,
    pannedFrame,
  ).at(-1)!;
  const pannedFullDeskFit = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    pannedFrame,
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedPannedOuterStop) < 1e-9,
    'pan input should recompute the active outer regional stop');
  assert.ok(controller.getOrbitDistance() < pannedFullDeskFit,
    'panned recomputation should remain below the removed full-desk fit');
  controller.dispose();
}

{
  const mapSideLengths = [817, 1634, 817 * Math.sqrt(8)];
  const outerRegionalDistances: number[] = [];
  for (const sideLength of mapSideLengths) {
    const half = sideLength * 0.5;
    const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    const stops = computeIllustratedMapZoomStops(
      bounds,
      DEFAULT_FOV,
      88 / 0.3,
      {
        aspect: 16 / 9,
        yaw: -Math.PI / 2,
        pitch: RTS_ORBIT_PITCH,
        targetX: 0,
        targetZ: 0,
      },
    );
    assert.equal(
      stops.length,
      ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT + 1,
      'each supported map scale should have the continuity stop plus two outward tiers',
    );
    for (let tier = 1; tier < stops.length; tier += 1) {
      assert.ok(stops[tier] > stops[tier - 1],
        'supported world sizes should produce strictly increasing map tiers');
    }
    outerRegionalDistances.push(stops.at(-1)!);
  }
  assert.ok(outerRegionalDistances[1] > outerRegionalDistances[0],
    'medium-map outer regional tier should sit farther out than the small-map tier');
  assert.ok(outerRegionalDistances[2] > outerRegionalDistances[1],
    'large-map outer regional tier should sit farther out than the medium-map tier');
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, camera, domElement } = createController(
    undefined,
    false,
    (active) => mapModeChanges.push(active),
    DEFAULT_TEST_BOUNDS,
    1400,
  );
  scrollToLiveWorldMaximum(controller, domElement);
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.ok(camera.far > 1400,
    'entering the map should expand an undersized world far plane');
  controller.dispose();
  assert.equal(camera.far, 1400,
    'disposing during map mode should restore the projection owner snapshot');
  assert.deepEqual(mapModeChanges, [true, false],
    'disposing during map mode should release map render ownership once');
}

{
  let viewChangeCount = 0;
  const { controller, target } = createController(() => {
    viewChangeCount += 1;
  });
  controller.focusWorldPosition(800, -700);
  assert.equal(target.x, 500, 'focused targets should remain inside the playable bounds');
  assert.equal(target.z, -500, 'focused targets should remain inside the playable bounds');
  assert.ok(
    controller.getOrbitDistance() <= 90,
    'inspector focus should bring a distant bottleneck into a readable view',
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(viewChangeCount, 1, 'inspector focus should notify scene dependents once');
}

{
  let viewChangeCount = 0;
  const { domElement } = createController(() => {
    viewChangeCount += 1;
  });
  rmbPan(domElement, 0, 0, 40, 0);
  assert.equal(viewChangeCount, 0, 'view callback should be coalesced to rAF');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(viewChangeCount, 1, 'view callback should fire once per frame');
  rmbPan(domElement, 40, 0, 80, 0);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(viewChangeCount, 2, 'subsequent pans should schedule another frame callback');
}

{
  let renderCount = 0;
  const { controller, domElement, target } = createController(() => {
    renderCount += 1;
  }, true);
  const targetBeforeInput = target.clone();
  requestAnimationFrame(() => {
    // This is the single continuous App render for the display frame.
    renderCount += 1;
  });
  rmbPan(domElement, 0, 0, 40, 0);
  rmbPan(domElement, 40, 0, 80, 0);
  assert.ok(
    target.equals(targetBeforeInput),
    'continuous play must not mutate the camera once per raw mouse event',
  );
  controller.update(0.016);
  assert.ok(
    !target.equals(targetBeforeInput),
    'continuous play must apply the coalesced pointer delta on the render frame',
  );
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(
    renderCount,
    1,
    'continuous play must render exactly once despite repeated view changes in one frame',
  );
}

console.log('test:camera-controller passed');
