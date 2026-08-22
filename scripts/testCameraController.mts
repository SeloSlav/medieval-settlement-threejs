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
const {
  DEFAULT_FOV,
  ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT,
  RTS_ORBIT_PITCH,
  computeIllustratedMapFarPlane,
  computeIllustratedMapTerminalDistance,
  computeIllustratedMapZoomStops,
} = await import('../src/camera/CameraCurves.ts');
const {
  illustratedMapDeskMetrics,
} = await import('../src/map/illustratedMapDeskSurface.ts');

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

function scrollToLiveWorldMaximum(
  controller: CameraController,
  domElement: HTMLElement,
): void {
  for (let step = 0; step < 40 && controller.getZoomPercent() > 30; step += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
}

function assertDeskCornersInsideFrustum(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  bounds = DEFAULT_TEST_BOUNDS,
): void {
  const desk = illustratedMapDeskMetrics(bounds);
  const minX = desk.centerX - desk.width * 0.5;
  const maxX = desk.centerX + desk.width * 0.5;
  const minZ = desk.centerZ - desk.depth * 0.5;
  const maxZ = desk.centerZ + desk.depth * 0.5;
  camera.updateMatrixWorld(true);
  for (const yOffset of [-0.08, 0, 0.12]) {
    for (const x of [minX, maxX]) {
      for (const z of [minZ, maxZ]) {
        const projected = new THREE.Vector3(x, target.y + yOffset, z).project(camera);
        assert.ok(Math.abs(projected.x) <= 1 + 1e-6,
          `desk corner x=${projected.x} should fit the horizontal frustum`);
        assert.ok(Math.abs(projected.y) <= 1 + 1e-6,
          `desk corner y=${projected.y} should fit the vertical frustum`);
        assert.ok(projected.z >= -1 && projected.z <= 1,
          `desk corner z=${projected.z} should fit the owned depth range`);
      }
    }
  }
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
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  for (let index = 0; index < 7; index += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 10 }));
  }
  assert.equal(controller.getOrbitDistance(), distanceBefore,
    'trackpad micro-deltas should not zoom before the accumulated threshold');
  domElement.dispatch('wheel', wheelEvent({ deltaY: 10 }));
  assert.ok(controller.getOrbitDistance() > distanceBefore,
    'same-direction trackpad micro-deltas should zoom at the threshold');

  const afterOutwardStep = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 40 }));
  domElement.dispatch('wheel', wheelEvent({ deltaY: -40 }));
  assert.equal(controller.getOrbitDistance(), afterOutwardStep,
    'reversing a partial trackpad gesture should reset its prior accumulation');
  domElement.dispatch('wheel', wheelEvent({ deltaY: -40 }));
  assert.ok(controller.getOrbitDistance() < afterOutwardStep,
    'the reversed gesture should zoom only after reaching its own threshold');
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 4000 }));
  assert.ok(
    Math.abs(controller.getOrbitDistance() - distanceBefore * 1.18) < 1e-9,
    'one coarse wheel event must advance at most one live-world zoom step',
  );
}

{
  const { controller, domElement } = createController();
  const distanceBefore = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 3, deltaMode: 1 }));
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
  let mapReady = false;
  const mapModeChanges: boolean[] = [];
  const { controller, camera, target, domElement } = createController(
    undefined,
    false,
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
  assert.ok(Math.abs(controller.getOrbitDistance() - readyStops[1]) < 1e-9,
    'one coarse map event must advance exactly one illustrated tier');
  controller.dispose();
}

{
  const mapModeChanges: boolean[] = [];
  const { controller, camera, target, domElement } = createController(
    undefined,
    false,
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
  assert.equal(controller.getHudZoomPercent(), 29,
    'the HUD should still identify the render-owner handoff as MAP');
  assert.ok(Math.abs(camera.far - expectedMapFarPlane) < 1e-9,
    'map mode should expand the far plane for its scale-derived maximum tier');
  assert.equal(camera.near, liveWorldNearPlane,
    'map projection ownership must not alter the world near plane');
  assert.equal(camera.fov, liveWorldFov,
    'map projection ownership must not alter the world lens');
  assert.deepEqual(mapModeChanges, [true]);

  const visitedMapStops = [controller.getOrbitDistance()];
  for (let tier = 1; tier <= ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
    visitedMapStops.push(controller.getOrbitDistance());
    assert.equal(controller.isIllustratedMapActive(), true,
      `outward illustrated-map tier ${tier} should retain map render ownership`);
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
  const fullMapDistance = controller.getOrbitDistance();
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  assert.equal(controller.getOrbitDistance(), fullMapDistance,
    'outward scrolling should clamp at the full-map/desk tier');

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
      - adjustedMapStops[adjustedMapStops.length - 1]) < 1e-9,
    'the active terminal tier should recompute after orbit and pan input',
  );
  assertDeskCornersInsideFrustum(camera, target);

  for (let tier = ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT - 1; tier >= 0; tier -= 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: -120 }));
    assert.equal(controller.isIllustratedMapActive(), true,
      `returning to illustrated-map tier ${tier} should retain map render ownership`);
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
  const { controller, camera, target, domElement } = createController();
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
  domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  for (let tier = 0; tier < ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT; tier += 1) {
    domElement.dispatch('wheel', wheelEvent({ deltaY: 120 }));
  }
  const expectedWideTerminal = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: authoredPitch,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedWideTerminal) < 1e-9,
    'the terminal tier should solve the current aspect, pose, and panned target');
  assertDeskCornersInsideFrustum(camera, target);

  const wideTerminal = controller.getOrbitDistance();
  camera.aspect = 0.62;
  camera.updateProjectionMatrix();
  window.dispatchEvent({ type: 'resize' } as Event);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const expectedPortraitTerminal = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: authoredPitch,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  assert.ok(controller.getOrbitDistance() > wideTerminal,
    'a portrait resize should move the active terminal tier far enough to retain the desk');
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedPortraitTerminal) < 1e-9,
    'resize recomputation should use the exact current-aspect terminal solve');
  assertDeskCornersInsideFrustum(camera, target);

  mmbOrbit(domElement, 100, 100, 160, 170);
  releaseMouse(1);
  const rotatedPitch = THREE.MathUtils.clamp(
    authoredPitch + 70 * 0.004,
    THREE.MathUtils.degToRad(5),
    THREE.MathUtils.degToRad(70),
  );
  const expectedRotatedTerminal = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: rotatedPitch,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedRotatedTerminal) < 1e-9,
    'orbit input should recompute the active terminal desk fit');
  assertDeskCornersInsideFrustum(camera, target);

  const targetBeforePan = target.clone();
  rmbPan(domElement, 100, 100, -100, -40);
  releaseMouse(2);
  assert.ok(!target.equals(targetBeforePan),
    'the containment regression should exercise a newly panned target');
  const expectedPannedTerminal = computeIllustratedMapTerminalDistance(
    DEFAULT_TEST_BOUNDS,
    DEFAULT_FOV,
    {
      aspect: camera.aspect,
      yaw: controller.getYaw(),
      pitch: rotatedPitch,
      targetX: target.x,
      targetZ: target.z,
    },
  );
  assert.ok(Math.abs(controller.getOrbitDistance() - expectedPannedTerminal) < 1e-9,
    'pan input should recompute the active terminal desk fit');
  assertDeskCornersInsideFrustum(camera, target);
  controller.dispose();
}

{
  const mapSideLengths = [817, 1634, 817 * Math.sqrt(8)];
  const fullMapDistances: number[] = [];
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
      'each supported map scale should have the continuity stop plus three outward tiers',
    );
    for (let tier = 1; tier < stops.length; tier += 1) {
      assert.ok(stops[tier] > stops[tier - 1],
        'supported world sizes should produce strictly increasing map tiers');
    }
    fullMapDistances.push(stops[stops.length - 1]);
  }
  assert.ok(fullMapDistances[1] > fullMapDistances[0],
    'medium-map desk fit should sit farther out than small-map desk fit');
  assert.ok(fullMapDistances[2] > fullMapDistances[1],
    'large-map desk fit should sit farther out than medium-map desk fit');
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
