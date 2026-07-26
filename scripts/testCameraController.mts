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

function createController(onViewChanged?: () => void): {
  controller: CameraController;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
} {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  const target = new THREE.Vector3(0, 0, 0);
  const domElement = createDomElement();
  const controller = new CameraController({
    camera,
    target,
    domElement,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    getHeightAt: () => 0,
    onViewChanged,
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

{
  const { controller, target, domElement } = createController();
  const startX = target.x;
  rmbPan(domElement, 100, 100, 160, 100);
  assert.notEqual(target.x, startX, 'RMB pan should move target immediately');
  const afterPanX = target.x;
  controller.update(0.016);
  controller.update(0.016);
  assert.equal(target.x, afterPanX, 'target must not lag behind after pan ends');
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
  controller.update(0.05);
  const afterKeyX = target.x;
  controller.update(0.05);
  assert.notEqual(target.x, afterKeyX, 'keyboard pan should move target every frame');
  window.dispatchEvent(keyboardEvent('keyup', 'd'));
  const settledX = target.x;
  controller.update(0.5);
  assert.equal(target.x, settledX, 'keyboard pan must not keep drifting via smoothing');
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.notEqual(controller.getOrbitDistance(), distanceBefore, 'wheel zoom should apply immediately');
  const afterWheel = controller.getOrbitDistance();
  controller.update(0.5);
  assert.equal(controller.getOrbitDistance(), afterWheel, 'zoom must not ease after wheel input');
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

console.log('test:camera-controller passed');
