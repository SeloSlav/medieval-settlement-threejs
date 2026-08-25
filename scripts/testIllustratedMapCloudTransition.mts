import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';
import {
  ILLUSTRATED_MAP_CLOUD_TRANSITION,
  buildIllustratedMapCloudPuffs,
  illustratedMapCloudFrameAt,
} from '../src/map/IllustratedMapCloudTransition.ts';
import { LIVE_WORLD_MIN_ZOOM_PERCENT } from '../src/camera/CameraCurves.ts';

const start = illustratedMapCloudFrameAt(0);
assert.equal(start.phase, 'gather');
assert.equal(start.coverage, 0);
assert.equal(start.shouldCommitMap, false);

const gathering = illustratedMapCloudFrameAt(
  ILLUSTRATED_MAP_CLOUD_TRANSITION.gatherEnd * 0.5,
);
assert.equal(gathering.phase, 'gather');
assert.ok(gathering.coverage > 0 && gathering.coverage < 1);
assert.equal(gathering.shouldCommitMap, false);

const covered = illustratedMapCloudFrameAt(ILLUSTRATED_MAP_CLOUD_TRANSITION.gatherEnd);
assert.equal(covered.phase, 'handoff');
assert.equal(covered.coverage, 1);
assert.equal(covered.partProgress, 0);
assert.equal(covered.shouldCommitMap, true);

const parting = illustratedMapCloudFrameAt(
  (ILLUSTRATED_MAP_CLOUD_TRANSITION.handoffHoldEnd + 1) * 0.5,
);
assert.equal(parting.phase, 'part');
assert.ok(parting.coverage > 0 && parting.coverage < 1);
assert.ok(parting.partProgress > 0 && parting.partProgress < 1);
assert.equal(parting.shouldCommitMap, true);

const complete = illustratedMapCloudFrameAt(1);
assert.deepEqual(complete, {
  normalizedTime: 1,
  coverage: 0,
  partProgress: 1,
  phase: 'complete',
  shouldCommitMap: true,
});

const firstLayout = buildIllustratedMapCloudPuffs(24);
const secondLayout = buildIllustratedMapCloudPuffs(24);
assert.deepEqual(firstLayout, secondLayout, 'the authored cloud bank must be deterministic');
assert.ok(firstLayout.some((puff) => puff.side === -1));
assert.ok(firstLayout.some((puff) => puff.side === 1));
assert.ok(firstLayout.every((puff) => puff.radius > 0 && puff.depth >= 0 && puff.depth <= 1));

type WindowLike = EventEmitter & {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

const windowLike = new EventEmitter() as WindowLike;
windowLike.setMaxListeners(0);
windowLike.addEventListener = (type, listener) => windowLike.on(type, listener);
windowLike.removeEventListener = (type, listener) => windowLike.off(type, listener);
globalThis.window = windowLike as unknown as Window & typeof globalThis;
globalThis.document = { body: { style: {} } } as unknown as Document;
globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

const { CameraController } = await import('../src/camera/CameraController.ts');

function createDomElement(): HTMLElement & { dispatchWheel(): void } {
  const listeners = new Map<string, EventListener>();
  return {
    style: {},
    clientHeight: 720,
    contains: () => true,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
    dispatchWheel() {
      listeners.get('wheel')?.({
        deltaY: 120,
        deltaX: 0,
        deltaMode: 0,
        preventDefault() {},
      } as WheelEvent);
    },
  } as unknown as HTMLElement & { dispatchWheel(): void };
}

{
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2600);
  const domElement = createDomElement();
  let commitTransition: (() => void) | null = null;
  const modeChanges: boolean[] = [];
  const controller = new CameraController({
    camera,
    target: new THREE.Vector3(),
    domElement,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    getHeightAt: () => 0,
    isIllustratedMapReady: () => true,
    continuousRenderLoop: true,
    onIllustratedMapEntryTransition: (commit) => {
      commitTransition = commit;
    },
    onIllustratedMapModeChanged: (active) => modeChanges.push(active),
  });
  controller.focusWorldPositionAtZoom(0, 0, LIVE_WORLD_MIN_ZOOM_PERCENT);
  domElement.dispatchWheel();
  assert.equal(controller.isIllustratedMapActive(), false,
    'paper render ownership must wait for full cloud cover');
  assert.deepEqual(modeChanges, []);
  assert.ok(commitTransition);
  commitTransition!();
  assert.equal(controller.isIllustratedMapActive(), true,
    'the covered midpoint should commit paper render ownership');
  assert.deepEqual(modeChanges, [true]);
  controller.dispose();
}

{
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2600);
  const domElement = createDomElement();
  let commitTransition: (() => void) | null = null;
  let cancelled = false;
  const controller = new CameraController({
    camera,
    target: new THREE.Vector3(),
    domElement,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    getHeightAt: () => 0,
    isIllustratedMapReady: () => true,
    continuousRenderLoop: true,
    onIllustratedMapEntryTransition: (commit) => {
      commitTransition = commit;
      return () => { cancelled = true; };
    },
  });
  controller.focusWorldPositionAtZoom(0, 0, LIVE_WORLD_MIN_ZOOM_PERCENT);
  domElement.dispatchWheel();
  controller.focusWorldPosition(12, -8);
  assert.equal(cancelled, true, 'a direct world focus should cancel cloud gather');
  commitTransition!();
  assert.equal(controller.isIllustratedMapActive(), false,
    'a cancelled cloud handoff must ignore its stale commit callback');
  controller.dispose();
}

console.log('test:map-cloud-transition passed');
