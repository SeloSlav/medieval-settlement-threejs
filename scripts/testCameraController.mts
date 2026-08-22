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
): {
  controller: CameraController;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
} {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2600);
  const target = new THREE.Vector3(0, 0, 0);
  const domElement = createDomElement();
  const controller = new CameraController({
    camera,
    target,
    domElement,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    getHeightAt: () => 0,
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

function wheelEvent(init: { deltaY?: number }): WheelEvent {
  return {
    type: 'wheel',
    deltaY: init.deltaY ?? 0,
    deltaX: 0,
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

{
  const { controller, target, domElement } = createController();
  const startX = target.x;
  rmbPan(domElement, 100, 100, 160, 100);
  assert.equal(controller.isNavigationActive(), true,
    'RMB pan should expose active navigation to render scheduling');
  assert.notEqual(target.x, startX, 'RMB pan should move target immediately');
  releaseMouse(2);
  assert.equal(controller.isNavigationActive(), false,
    'RMB release should settle navigation before the next render');
  const afterPanX = target.x;
  controller.update(0.016);
  controller.update(0.016);
  assert.equal(target.x, afterPanX, 'target must not lag behind after pan ends');
}

{
  const { controller, domElement } = createController();
  const yawBefore = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 140, 100);
  assert.ok(
    controller.getYaw() > yawBefore,
    'dragging orbit right should increase yaw',
  );
  releaseMouse(1);
}

{
  const { controller, domElement } = createController(undefined, true);
  const yawBefore = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 140, 100);
  assert.equal(
    controller.getYaw(),
    yawBefore,
    'continuous play should defer orbit input until the render frame',
  );
  controller.update(0.016);
  assert.ok(
    controller.getYaw() > yawBefore,
    'continuous orbit dragging right should increase yaw',
  );
  releaseMouse(1);
}

{
  const { controller, target, domElement } = createController();
  rmbPan(domElement, 0, 0, 0, 120);
  const afterPanZ = target.z;
  controller.update(1);
  assert.equal(target.z, afterPanZ, 'idle update must not apply pan smoothing');
}

{
  const { controller, target } = createController();
  window.dispatchEvent(keyboardEvent('keydown', 'd'));
  assert.equal(controller.isNavigationActive(), true,
    'keyboard pan should share the camera navigation activity state');
  controller.update(0.05);
  const afterKeyX = target.x;
  controller.update(0.05);
  assert.notEqual(target.x, afterKeyX, 'keyboard pan should move target every frame');
  window.dispatchEvent(keyboardEvent('keyup', 'd'));
  assert.equal(controller.isNavigationActive(), false,
    'keyboard release should settle the camera navigation activity state');
  const settledX = target.x;
  controller.update(0.5);
  assert.equal(target.x, settledX, 'keyboard pan must not keep drifting via smoothing');
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.notEqual(controller.getOrbitDistance(), distanceBefore, 'wheel zoom should apply immediately');
  assert.equal(controller.isNavigationActive(), true,
    'wheel zoom should hold the resident forest set while the input burst settles');
  const afterWheel = controller.getOrbitDistance();
  controller.update(0.5);
  assert.equal(controller.getOrbitDistance(), afterWheel, 'zoom must not ease after wheel input');
  controller.setInputEnabled(false);
  assert.equal(controller.isNavigationActive(), false,
    'disabling camera input should clear the wheel navigation grace period');
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
  const { controller, camera, target, domElement } = createController(
    undefined,
    false,
    (active) => mapModeChanges.push(active),
  );
  for (let step = 0; step < 40 && controller.getZoomPercent() > 30; step += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
  assert.ok(
    Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'the live 3D world should still stop at the existing 30% overview',
  );
  assert.equal(controller.isIllustratedMapActive(), false);
  const liveWorldDistance = controller.getOrbitDistance();
  const liveWorldFarPlane = camera.far;

  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.isIllustratedMapActive(), true,
    'one additional outward wheel step should enter the illustrated map tier');
  assert.equal(controller.getOrbitDistance(), liveWorldDistance,
    'the map handoff should retain the existing maximum overview distance');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9,
    'the actual camera zoom should remain at the live overview scale');
  assert.equal(controller.getHudZoomPercent(), 29,
    'the HUD should still identify the render-owner handoff as MAP');
  assert.equal(camera.far, liveWorldFarPlane,
    'the map handoff should retain the existing overview projection');
  assert.deepEqual(mapModeChanges, [true]);

  const mapDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.getOrbitDistance(), mapDistance,
    'the illustrated map is one explicit final zoom tier');

  const yawBefore = controller.getYaw();
  mmbOrbit(domElement, 100, 100, 140, 100);
  assert.ok(controller.getYaw() > yawBefore,
    'ordinary orbit rotation should remain active over the illustrated map');
  releaseMouse(1);
  const targetBeforePan = target.clone();
  rmbPan(domElement, 100, 100, 140, 100);
  assert.ok(!target.equals(targetBeforePan),
    'ordinary world-space panning should remain active over the illustrated map');
  releaseMouse(2);

  domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
  assert.equal(controller.isIllustratedMapActive(), false,
    'scrolling inward should return to the live 30% overview');
  assert.ok(Math.abs(controller.getZoomPercent() - 30) < 1e-9);
  assert.ok(Math.abs(controller.getHudZoomPercent() - 30) < 1e-9);
  assert.equal(camera.far, liveWorldFarPlane,
    'leaving the illustrated map should preserve the unchanged projection far plane');
  assert.deepEqual(
    mapModeChanges,
    [true, false],
    'the render owner should receive one callback for each map handoff',
  );
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
