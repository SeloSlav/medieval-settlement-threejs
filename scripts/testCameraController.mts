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
const { SecondaryClickGesture } = await import('../src/input/SecondaryClickGesture.ts');
const { shouldDismissVillagerSelection } = await import('../src/ui/VillagerInspector.ts');
const { resolveSceneRenderOwner } = await import('../src/scene/sceneRenderOwnership.ts');
const {
  BASELINE_ORBIT_DISTANCE,
  LIVE_WORLD_MIN_ZOOM_PERCENT,
  LIVE_WORLD_OVERVIEW_ZOOM_PERCENT,
  DEFAULT_FOV,
  ILLUSTRATED_MAP_MIN_PITCH,
  ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT,
  RTS_ORBIT_YAW,
  RTS_ORBIT_PITCH,
  computeCloseCurveStartDistance,
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

{
  const { controller, camera, target } = createController();
  assert.equal(controller.getYaw(), RTS_ORBIT_YAW,
    'the default RTS camera should face the paper map from its authored bottom edge');
  assert.ok(camera.position.z > target.z,
    'the default camera should keep the canvas top edge at the top of the paper-map view');
  controller.dispose();
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

function measureOrbitPitch(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  return Math.atan2(dy, Math.hypot(dx, dz));
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
  for (
    let step = 0;
    step < 40 && controller.getZoomPercent() > LIVE_WORLD_MIN_ZOOM_PERCENT;
    step += 1
  ) {
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
  const defaultScreenRightX = -Math.sin(RTS_ORBIT_YAW);
  assert.ok((firstFrameX - startX) * defaultScreenRightX > 0,
    'RMB panning should begin on the next render frame');
  releaseMouse(2);
  assert.equal(controller.isNavigationActive(), true,
    'the short RMB glide should remain active after release until it settles');
  settleNavigation(controller);
  assert.ok((target.x - firstFrameX) * defaultScreenRightX > 0,
    'RMB panning should smoothly converge after the raw drag ends');
  assert.equal(controller.isNavigationActive(), false,
    'RMB navigation should become idle once the glide is exact');
  const settledX = target.x;
  controller.update(0.2);
  assert.equal(target.x, settledX,
    'a settled RMB pan must not keep drifting');
}

{
  const { controller, target, domElement } = createController(undefined, true);
  let stationarySecondaryClicks = 0;
  const secondaryClickGesture = new SecondaryClickGesture({
    onClick: () => {
      stationarySecondaryClicks += 1;
    },
  });
  domElement.addEventListener('mousedown', (event) => {
    secondaryClickGesture.begin(event as MouseEvent);
  }, { capture: true });

  const startX = target.x;
  domElement.dispatch('mousedown', mouseEvent({
    type: 'mousedown',
    button: 2,
    clientX: 100,
    clientY: 100,
  }));
  assert.equal(stationarySecondaryClicks, 0,
    'secondary down must defer the placement action until drag intent is known');
  window.dispatchEvent(mouseEvent({
    type: 'mousemove',
    clientX: 160,
    clientY: 100,
    buttons: 2,
  }));
  window.dispatchEvent(mouseEvent({
    type: 'mouseup',
    button: 2,
    clientX: 160,
    clientY: 100,
  }));
  settleNavigation(controller);
  assert.ok((target.x - startX) * -Math.sin(RTS_ORBIT_YAW) > 0,
    'RMB drag must continue to reach the camera while a placement gesture is armed');
  assert.equal(stationarySecondaryClicks, 0,
    'RMB camera drag must preserve the placement action');

  domElement.dispatch('mousedown', mouseEvent({
    type: 'mousedown',
    button: 2,
    clientX: 200,
    clientY: 200,
  }));
  window.dispatchEvent(mouseEvent({
    type: 'mouseup',
    button: 2,
    clientX: 200,
    clientY: 200,
  }));
  assert.equal(stationarySecondaryClicks, 1,
    'a stationary RMB release must retain the existing placement cancel or undo action');

  secondaryClickGesture.dispose();
  controller.dispose();
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
  assert.ok((firstFrameX - startX) * Math.sin(RTS_ORBIT_YAW) > 0,
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
  assert.ok((target.x - secondFrameX) * Math.sin(RTS_ORBIT_YAW) > 0,
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
  const measureArrowPanAtZoom = (zoomPercent: number): number => {
    const { controller, target } = createController(undefined, true);
    controller.focusWorldPositionAtZoom(0, 0, zoomPercent);
    window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
    controller.update(0.25);
    window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
    const travel = target.length();
    controller.dispose();
    return travel;
  };
  const measureMousePanAtZoom = (zoomPercent: number): number => {
    const { controller, domElement, target } = createController(undefined, true);
    controller.focusWorldPositionAtZoom(0, 0, zoomPercent);
    rmbPan(domElement, 100, 100, 140, 100);
    controller.update(0.25);
    releaseMouse(2);
    const travel = target.length();
    controller.dispose();
    return travel;
  };

  const arrowTravelAtCurveStart = measureArrowPanAtZoom(350);
  const arrowTravelAtMaxZoom = measureArrowPanAtZoom(1000);
  assert.ok(
    arrowTravelAtMaxZoom >= arrowTravelAtCurveStart,
    'arrow-key pan speed should remain responsive from 350% through maximum zoom',
  );

  const mouseTravelAtCurveStart = measureMousePanAtZoom(350);
  const mouseTravelAtMaxZoom = measureMousePanAtZoom(1000);
  assert.ok(
    mouseTravelAtMaxZoom < mouseTravelAtCurveStart * 0.5,
    'close-zoom keyboard acceleration must not change precise RMB drag scaling',
  );
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
  assert.ok(
    diagonal.target.x * Math.sin(RTS_ORBIT_YAW) > 0
      && diagonal.target.z * -Math.sin(RTS_ORBIT_YAW) > 0,
    'combined arrows should smoothly pan along both requested axes');
  diagonal.controller.dispose();
}

{
  const directions = [
    { key: 'ArrowUp', axis: 'z' as const, sign: Math.sign(-Math.sin(RTS_ORBIT_YAW)) },
    { key: 'ArrowDown', axis: 'z' as const, sign: Math.sign(Math.sin(RTS_ORBIT_YAW)) },
    { key: 'ArrowLeft', axis: 'x' as const, sign: Math.sign(-Math.sin(RTS_ORBIT_YAW)) },
    { key: 'ArrowRight', axis: 'x' as const, sign: Math.sign(Math.sin(RTS_ORBIT_YAW)) },
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
  assert.ok((target.z - startZ) * -Math.sin(RTS_ORBIT_YAW) > 0,
    'demand-rendered arrow panning should start its own navigation frame');
  assert.ok(viewChangeCount > 0,
    'demand-rendered arrow panning should invalidate the visible scene');
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  controller.setInputEnabled(false);
  controller.dispose();
}

{
  let viewChangeCount = 0;
  const { controller } = createController(() => {
    viewChangeCount += 1;
  });
  const yawBefore = controller.getYaw();
  window.dispatchEvent(keyboardEvent('keydown', 'q'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(controller.getYaw() < yawBefore,
    'demand-rendered keyboard rotation should use the shared navigation frame');
  assert.ok(viewChangeCount > 0,
    'demand-rendered keyboard rotation should invalidate the visible scene');
  window.dispatchEvent(keyboardEvent('keyup', 'q'));
  controller.dispose();
}

{
  let viewChangeCount = 0;
  const { controller, target } = createController(() => {
    viewChangeCount += 1;
  });
  const targetBeforeOpposingKeys = target.clone();
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowUp'));
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowDown'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(target.equals(targetBeforeOpposingKeys),
    'opposing arrow keys should resolve to zero movement');
  assert.equal(controller.isNavigationActive(), false,
    'opposing arrow keys should not retain a no-op navigation owner');
  assert.equal(viewChangeCount, 0,
    'opposing arrow keys should not invalidate an unchanged view');
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowUp'));
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowDown'));
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
  const minimumDistance = BASELINE_ORBIT_DISTANCE / 10;
  const pitchDegrees = [5, 14, THREE.MathUtils.radToDeg(RTS_ORBIT_PITCH), 70];
  for (const pitchDegree of pitchDegrees) {
    const { controller, camera, target } = createController(undefined, true);
    const pitch = THREE.MathUtils.degToRad(pitchDegree);
    const closeCurveStartDistance = computeCloseCurveStartDistance(
      minimumDistance,
      pitch,
      4,
    );
    const outwardPositions: THREE.Vector3[] = [];
    let previousBackDistance = Number.NEGATIVE_INFINITY;
    let previousHeight = Number.NEGATIVE_INFINITY;

    for (let sample = 0; sample <= 120; sample += 1) {
      const distance = THREE.MathUtils.lerp(
        minimumDistance,
        closeCurveStartDistance,
        sample / 120,
      );
      controller.applyShowcaseView(0, 0, -Math.PI / 2, pitch, distance);
      const backDistance = Math.hypot(
        camera.position.x - target.x,
        camera.position.z - target.z,
      );
      assert.ok(
        backDistance >= previousBackDistance - 1e-8,
        `the ${pitchDegree.toFixed(0)}° close-exit curve must not dogleg toward the target`,
      );
      assert.ok(
        camera.position.y >= previousHeight - 1e-8,
        `the ${pitchDegree.toFixed(0)}° close-exit curve must climb monotonically`,
      );
      outwardPositions.push(camera.position.clone());
      previousBackDistance = backDistance;
      previousHeight = camera.position.y;
    }

    for (let sample = 120; sample >= 0; sample -= 1) {
      const distance = THREE.MathUtils.lerp(
        minimumDistance,
        closeCurveStartDistance,
        sample / 120,
      );
      controller.applyShowcaseView(0, 0, -Math.PI / 2, pitch, distance);
      assert.ok(
        camera.position.distanceTo(outwardPositions[sample]) < 1e-9,
        `the ${pitchDegree.toFixed(0)}° inward camera path should exactly retrace its outward curve`,
      );
    }
    controller.dispose();
  }
}

{
  const baseline = createController(undefined, true);
  const dragged = createController(undefined, true);
  const minimumDistance = BASELINE_ORBIT_DISTANCE / 10;
  baseline.controller.applyShowcaseView(
    0,
    0,
    -Math.PI / 2,
    RTS_ORBIT_PITCH,
    minimumDistance,
  );
  dragged.controller.applyShowcaseView(
    0,
    0,
    -Math.PI / 2,
    RTS_ORBIT_PITCH,
    minimumDistance,
  );

  mmbOrbit(dragged.domElement, 100, 500, 100, 0);
  // Queue the outward wheel before either controller renders. Pitch input
  // authored while fully close must not become active merely because zoom is
  // processed first on the shared navigation frame.
  baseline.domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  dragged.domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  releaseMouse(1);
  settleZoom(baseline.controller);
  settleZoom(dragged.controller);
  assert.ok(
    dragged.camera.position.distanceTo(baseline.camera.position) < 1e-9,
    'leaving ground-eye zoom should retrace the authored curve instead of revealing hidden pitch drift',
  );
  assert.ok(
    dragged.camera.quaternion.angleTo(baseline.camera.quaternion) < 1e-7,
    'the close-zoom exit orientation should remain on the same authored curve',
  );
  baseline.controller.dispose();
  dragged.controller.dispose();
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
  const { controller, domElement } = createController(undefined, true);
  for (
    let step = 0;
    step < 40 && controller.getZoomPercent() > LIVE_WORLD_OVERVIEW_ZOOM_PERCENT;
    step += 1
  ) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
    settleZoom(controller);
  }
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_OVERVIEW_ZOOM_PERCENT) < 1e-9,
    'outward navigation should retain the established 30% live-world stop',
  );
  assert.equal(controller.isIllustratedMapActive(), false);

  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  settleZoom(controller);
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
    'one more outward detent should reach the new outer live-world tier',
  );
  assert.equal(controller.isIllustratedMapActive(), false,
    'the added outer tier must still render the live 3D world');

  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.isIllustratedMapActive(), true,
    'only the following outward detent should hand ownership to the paper map');
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  assert.equal(controller.isIllustratedMapActive(), false,
    'the first inward detent should return to the new outer live tier');
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  settleZoom(controller);
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_OVERVIEW_ZOOM_PERCENT) < 1e-9,
    'inward navigation should retrace the exact 30% overview stop',
  );
  controller.dispose();
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
    'the queued map handoff should complete once the outer live view is exact');
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
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
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  settleZoom(controller);
  assert.equal(controller.isIllustratedMapActive(), false,
    'one reciprocal step should cancel a pending map handoff');
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
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
  const { controller, target } = createController(undefined, true);
  window.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
  controller.update(0.05);
  controller.focusWorldPosition(10, 15);
  const targetAfterFocus = target.clone();
  assert.equal(controller.isNavigationActive(), false,
    'a scripted camera focus should clear held keyboard navigation');
  controller.update(0.5);
  assert.ok(target.equals(targetAfterFocus),
    'pre-focus keyboard momentum must not pull the scripted camera pose');
  window.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  controller.dispose();
}

{
  const mapModeChanges: boolean[] = [];
  let callbackCamera: THREE.PerspectiveCamera | null = null;
  let exitCallbackCameraPosition: THREE.Vector3 | null = null;
  let exitCallbackMatrixPosition: THREE.Vector3 | null = null;
  let exitCallbackFarPlane = Number.NaN;
  const created = createController(
    undefined,
    true,
    (active) => {
      mapModeChanges.push(active);
      if (active || !callbackCamera) return;
      exitCallbackCameraPosition = callbackCamera.position.clone();
      exitCallbackMatrixPosition = new THREE.Vector3().setFromMatrixPosition(
        callbackCamera.matrixWorld,
      );
      exitCallbackFarPlane = callbackCamera.far;
    },
  );
  const { controller, camera, target, domElement } = created;
  callbackCamera = camera;
  scrollToLiveWorldMaximum(controller, domElement);
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
    'the live 3D world should include one tier beyond the former 30% overview',
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
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
    'the actual camera zoom should remain at the live overview scale');
  assert.ok(
    Math.abs(controller.getHudZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
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
    assert.ok(Math.abs(camera.far - adjustedMapFarPlane) <= 0.01,
      'the map far plane should remain owned within its projection epsilon until the handoff ends');
  }
  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  assert.equal(controller.isIllustratedMapActive(), false,
    'scrolling inward from the entry map tier should return to the outer live overview');
  assert.ok(
    Math.abs(controller.getZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
  );
  assert.ok(
    Math.abs(controller.getHudZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
  );
  assert.equal(camera.far, liveWorldFarPlane,
    'leaving the illustrated map should restore the exact world far plane');
  assert.equal(camera.near, liveWorldNearPlane);
  assert.equal(camera.fov, liveWorldFov);
  assert.ok(
    exitCallbackCameraPosition?.distanceTo(camera.position)! < 1e-9,
    'the exit callback should observe the final world camera position',
  );
  assert.ok(
    exitCallbackMatrixPosition?.distanceTo(camera.position)! < 1e-9,
    'the exit callback should observe a synchronized world camera matrix',
  );
  assert.equal(exitCallbackFarPlane, liveWorldFarPlane,
    'the exit callback should observe the restored world projection');
  assert.deepEqual(
    mapModeChanges,
    [true, false],
    'the render owner should receive one callback for each map handoff',
  );
}

{
  const mapModeChanges: boolean[] = [];
  let sceneManagerMapActive = false;
  const { controller, domElement } = createController(
    undefined,
    true,
    (active) => {
      mapModeChanges.push(active);
      sceneManagerMapActive = active;
    },
  );
  scrollToLiveWorldMaximum(controller, domElement);
  const liveWorldDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(
    resolveSceneRenderOwner(sceneManagerMapActive, true),
    'illustrated-map',
    'the SceneManager selector should take paper ownership on the entry callback',
  );
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
  assert.equal(
    resolveSceneRenderOwner(sceneManagerMapActive, true),
    'illustrated-map',
    'the paper scene should remain the selected renderer while exit is pending',
  );
  controller.setInputEnabled(true);
  assert.equal(controller.isNavigationActive(), true,
    're-enabling input should resume the preserved map destination');
  settleNavigation(controller);
  assert.equal(controller.isIllustratedMapActive(), false,
    'the paper render owner should release only after reaching the exact continuity stop');
  assert.equal(
    resolveSceneRenderOwner(sceneManagerMapActive, true),
    'world',
    'the same update that completes camera exit should restore world render ownership',
  );
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
  assert.ok(Math.abs(measureOrbitPitch(camera, target) - authoredPitch) < 1e-9,
    'the live world should retain low-angle terrain inspection before the map handoff');
  const mapEntryDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.ok(
    Math.abs(measureOrbitPitch(camera, target) - ILLUSTRATED_MAP_MIN_PITCH) < 1e-9,
    'entering the paper map from a low world angle should lift it to the map-only floor',
  );
  const yawBeforeFlattenAttempt = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 100, -900);
  releaseMouse(1);
  settleNavigation(controller);
  assert.ok(
    Math.abs(measureOrbitPitch(camera, target) - ILLUSTRATED_MAP_MIN_PITCH) < 1e-9,
    'paper-map vertical orbit input must not flatten the table below its authored floor',
  );
  assert.equal(controller.getYaw(), yawBeforeFlattenAttempt,
    'vertical-only paper-map orbit input should not alter yaw');
  for (let tier = 0; tier < ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
  settleZoom(controller);
  const wideFrame = {
    aspect: camera.aspect,
    yaw: controller.getYaw(),
    pitch: ILLUSTRATED_MAP_MIN_PITCH,
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
    pitch: ILLUSTRATED_MAP_MIN_PITCH,
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
    ILLUSTRATED_MAP_MIN_PITCH + 70 * 0.004,
    ILLUSTRATED_MAP_MIN_PITCH,
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

  for (let step = 0; step <= ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; step += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
    settleZoom(controller);
  }
  assert.equal(controller.isIllustratedMapActive(), false,
    'returning inward from the paper map should restore live-world camera ownership');
  mmbOrbit(domElement, 100, 100, 100, -300);
  releaseMouse(1);
  settleNavigation(controller);
  assert.ok(
    measureOrbitPitch(camera, target) < ILLUSTRATED_MAP_MIN_PITCH - 1e-3,
    'the live world should remain free to orbit below the paper-map-only floor',
  );
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
  const { controller, camera, target } = createController();
  controller.applyShowcaseView(0, 0, 0.42, RTS_ORBIT_PITCH, 70);
  const yawBefore = controller.getYaw();
  const orientationBefore = camera.quaternion.clone();

  controller.focusWorldPositionAtZoom(45, -32, 25);

  assert.equal(target.x, 45, 'report focus should center the requested world x');
  assert.equal(target.z, -32, 'report focus should center the requested world z');
  assert.ok(
    Math.abs(controller.getHudZoomPercent() - LIVE_WORLD_MIN_ZOOM_PERCENT) < 1e-9,
    'report focus should clamp an approximately 25% request to the live-world minimum',
  );
  assert.equal(controller.getYaw(), yawBefore,
    'report focus should preserve the authored orbit yaw');
  assert.ok(camera.quaternion.angleTo(orientationBefore) < 1e-9,
    'report focus should preserve the authored orbit orientation');
  controller.dispose();
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

{
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
  const target = new THREE.Vector3();
  const domElement = createDomElement();
  const controller = new CameraController({
    camera,
    target,
    domElement,
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    getHeightAt: () => 4,
    isIllustratedMapReady: () => false,
    continuousRenderLoop: true,
    orbitOnly: true,
    orbitFov: 34,
    minimumOrbitDistance: 2,
    maximumOrbitDistance: 120,
  });
  controller.applyShowcaseView(0, 0, 0.7, THREE.MathUtils.degToRad(5), 2);
  assert.ok(Math.abs(camera.position.distanceTo(target) - 2) < 1e-9,
    'inspection orbit must retain its authored close distance instead of entering the ground-eye curve');
  assert.equal(camera.fov, 34,
    'inspection orbit must preserve the lineup lens while navigating');
  controller.applyShowcaseView(0, 0, 0.7, THREE.MathUtils.degToRad(70), 999);
  assert.equal(controller.getOrbitDistance(), 120,
    'inspection orbit must retain its scale-aware maximum distance');
  assert.ok(Math.abs(measureOrbitPitch(camera, target) - THREE.MathUtils.degToRad(70)) < 1e-9,
    'inspection orbit must preserve the full live-game pitch envelope');
  controller.dispose();
}

console.log('test:camera-controller passed');
