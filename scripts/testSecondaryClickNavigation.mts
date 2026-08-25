import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

type WindowLike = EventEmitter & {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
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

const { SecondaryClickGesture } = await import('../src/input/SecondaryClickGesture.ts');

function mouseEvent(
  type: 'mousedown' | 'mousemove' | 'mouseup',
  button: number,
  clientX: number,
  clientY: number,
  buttons = type === 'mousemove' ? 2 : 0,
): MouseEvent {
  return {
    type,
    button,
    clientX,
    clientY,
    buttons,
    preventDefault() {},
  } as MouseEvent;
}

let clickCount = 0;
const gesture = new SecondaryClickGesture({
  onClick: () => {
    clickCount += 1;
  },
});

assert.equal(
  gesture.begin(mouseEvent('mousedown', 0, 10, 10)),
  false,
  'primary clicks must remain owned by the placement tool',
);
assert.equal(
  gesture.begin(mouseEvent('mousedown', 2, 10, 10)),
  true,
  'secondary down should begin tracking without running its click action',
);
assert.equal(clickCount, 0);
window.dispatchEvent(mouseEvent('mousemove', 0, 13, 14));
window.dispatchEvent(mouseEvent('mouseup', 2, 13, 14));
assert.equal(
  clickCount,
  1,
  'movement at the click threshold should retain the stationary right-click action',
);

gesture.begin(mouseEvent('mousedown', 2, 20, 20));
window.dispatchEvent(mouseEvent('mousemove', 0, 30, 20));
window.dispatchEvent(mouseEvent('mousemove', 0, 20, 20));
window.dispatchEvent(mouseEvent('mouseup', 2, 20, 20));
assert.equal(
  clickCount,
  1,
  'a drag that returns to its starting point must still preserve placement intent',
);

gesture.begin(mouseEvent('mousedown', 2, 30, 30));
window.dispatchEvent({ type: 'blur' } as Event);
window.dispatchEvent(mouseEvent('mouseup', 2, 30, 30));
assert.equal(clickCount, 1, 'window blur must clear a pending secondary-click action');

gesture.begin(mouseEvent('mousedown', 2, 40, 40));
window.dispatchEvent(mouseEvent('mousemove', 0, 40, 40, 0));
window.dispatchEvent(mouseEvent('mouseup', 2, 40, 40));
assert.equal(clickCount, 1, 'a lost secondary-button release must clear the pending action');
gesture.dispose();

const buildToolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.match(
  buildToolbar,
  /buildMenuOutsideSecondaryClick\.begin\(event\)\) return;[\s\S]{0,100}closeAllBuildMenus\(\)/,
  'the open palette must defer its outside right-click dismissal until drag intent is known',
);

const placementTools = [
  'src/buildings/BuildingTool.ts',
  'src/residences/BurgageTool.ts',
  'src/farming/FarmFieldTool.ts',
  'src/roads/RoadTool.ts',
  'src/resources/ForestryWorkAreaTool.ts',
] as const;

for (const path of placementTools) {
  const source = readFileSync(path, 'utf8');
  assert.match(
    source,
    /secondaryClickGesture\.begin\(event\)/,
    `${path} must distinguish a right-click from a right-button camera drag`,
  );
  assert.doesNotMatch(
    source,
    /if \(event\.button === 2\)/,
    `${path} must not cancel placement on right-button down`,
  );
}

for (const path of [
  'src/roads/RoadTool.ts',
  'src/resources/ForestryWorkAreaTool.ts',
] as const) {
  assert.match(
    readFileSync(path, 'utf8'),
    /event instanceof WheelEvent && event\.ctrlKey/,
    `${path} must retain Ctrl+wheel ownership while releasing right-drag to the camera`,
  );
}

console.log('Secondary-click navigation checks passed.');
