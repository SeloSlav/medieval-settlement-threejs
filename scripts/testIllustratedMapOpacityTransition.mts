import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';
import {
  ILLUSTRATED_MAP_OPACITY_TRANSITION,
  IllustratedMapOpacityTransition,
} from '../src/map/IllustratedMapOpacityTransition.ts';
import { LIVE_WORLD_MIN_ZOOM_PERCENT } from '../src/camera/CameraCurves.ts';

assert.ok(ILLUSTRATED_MAP_OPACITY_TRANSITION.fadeOutMs <= 85,
  'the outgoing view should fade in only a few frames');
assert.ok(ILLUSTRATED_MAP_OPACITY_TRANSITION.fadeInMs <= 100,
  'the incoming view should return in only a few frames');

type FakeAnimation = Animation & { finish(): void; cancelled: boolean };
const animations: FakeAnimation[] = [];
const element = {
  style: { opacity: '', willChange: '' },
  animate(_frames: Keyframe[], _options: KeyframeAnimationOptions) {
    const animation = {
      cancelled: false,
      onfinish: null,
      cancel() { this.cancelled = true; },
      finish() { this.onfinish?.(new Event('finish')); },
    } as unknown as FakeAnimation;
    animations.push(animation);
    return animation;
  },
} as unknown as HTMLElement;
const opacityTransition = new IllustratedMapOpacityTransition(element);
let opacityHandoffs = 0;
opacityTransition.play(() => { opacityHandoffs += 1; });
assert.equal(animations.length, 1);
assert.equal(opacityHandoffs, 0, 'the render owner must not swap before zero opacity');
animations[0].finish();
assert.equal(opacityHandoffs, 1, 'the transparent midpoint should swap render owners once');
assert.equal(animations.length, 2, 'the new render owner should fade straight back in');
animations[1].finish();
assert.equal(element.style.opacity, '');
assert.equal(element.style.willChange, '');
opacityTransition.dispose();

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

function createDomElement(): HTMLElement & { dispatchWheel(deltaY: number): void } {
  const listeners = new Map<string, EventListener>();
  return {
    style: {},
    clientHeight: 720,
    contains: () => true,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
    dispatchWheel(deltaY: number) {
      listeners.get('wheel')?.({
        deltaY,
        deltaX: 0,
        deltaMode: 0,
        preventDefault() {},
      } as WheelEvent);
    },
  } as unknown as HTMLElement & { dispatchWheel(deltaY: number): void };
}

{
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2600);
  const domElement = createDomElement();
  const requestedModes: boolean[] = [];
  const commits: Array<() => void> = [];
  const modeChanges: boolean[] = [];
  const controller = new CameraController({
    camera,
    target: new THREE.Vector3(),
    domElement,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    getHeightAt: () => 0,
    isIllustratedMapReady: () => true,
    continuousRenderLoop: true,
    onIllustratedMapModeTransition: (active, commit) => {
      requestedModes.push(active);
      commits.push(commit);
    },
    onIllustratedMapModeChanged: (active) => modeChanges.push(active),
  });
  controller.focusWorldPositionAtZoom(0, 0, LIVE_WORLD_MIN_ZOOM_PERCENT);
  domElement.dispatchWheel(120);
  assert.deepEqual(requestedModes, [true]);
  assert.equal(controller.isIllustratedMapActive(), false,
    'world ownership should remain until the opacity midpoint');
  commits.shift()!();
  assert.equal(controller.isIllustratedMapActive(), true);

  domElement.dispatchWheel(-120);
  assert.deepEqual(requestedModes, [true, false]);
  assert.equal(controller.isIllustratedMapActive(), true,
    'paper ownership should remain until the reverse opacity midpoint');
  commits.shift()!();
  assert.equal(controller.isIllustratedMapActive(), false);
  assert.deepEqual(modeChanges, [true, false]);
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
    onIllustratedMapModeTransition: (_active, commit) => {
      commitTransition = commit;
      return () => { cancelled = true; };
    },
  });
  controller.focusWorldPositionAtZoom(0, 0, LIVE_WORLD_MIN_ZOOM_PERCENT);
  domElement.dispatchWheel(120);
  controller.focusWorldPosition(12, -8);
  assert.equal(cancelled, true, 'a direct world focus should cancel an uncommitted fade');
  commitTransition!();
  assert.equal(controller.isIllustratedMapActive(), false,
    'a cancelled fade must ignore its stale commit callback');
  controller.dispose();
}

console.log('test:map-opacity-transition passed');
