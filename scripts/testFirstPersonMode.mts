import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const controller = readFileSync('src/camera/FirstPersonController.ts', 'utf8');
const placement = readFileSync('src/camera/FirstPersonPlacement.ts', 'utf8');
const bootstrap = readFileSync('src/app/appBootstrap.ts', 'utf8');
const controls = readFileSync('src/ui/gameControlsReference.ts', 'utf8');

assert.match(
  controller,
  /if \(this\.active\) this\.deactivate\(\);[\s\S]{0,240}else if \(this\.isPlacementActive\(\)\) this\.endPlacement\(\);[\s\S]{0,240}else this\.beginPlacement\(\);/,
  'the tilde toggle must exit active walking, cancel pending placement, or begin placement from RTS',
);
assert.doesNotMatch(
  controller,
  /event\.code === 'Escape'[\s\S]{0,180}(?:deactivate|toggle)\(/,
  'Escape must not deactivate first-person mode',
);
assert.match(
  controller,
  /onPointerLockChange[\s\S]{0,260}resetTransientInputState\(\)[\s\S]{0,80}\};/,
  'pointer-lock loss must clear movement without changing camera mode',
);
assert.doesNotMatch(
  controller,
  /onPointerLockChange[\s\S]{0,260}this\.deactivate\(\)/,
  'pointer-lock loss must never be treated as a first-person exit command',
);
assert.match(
  controller,
  /onMenuOpenChange\(open: boolean\)[\s\S]{0,260}exitPointerLock\(\)[\s\S]{0,180}requestPointerLock\(\)/,
  'the settings menu must temporarily release and then restore first-person pointer ownership',
);

assert.match(
  placement,
  /pickGround\(event\.clientX, event\.clientY\)[\s\S]{0,500}this\.selectedPoint\.copy\(hit\)[\s\S]{0,240}this\.cursor\.hidden = true[\s\S]{0,180}this\.confirmButton\.disabled = false/,
  'a terrain click must lock a world point before confirmation is enabled',
);
assert.match(
  controller,
  /onContextMenu[\s\S]{0,180}isPlacementActive\(\)[\s\S]{0,180}endPlacement\(\)/,
  'right-click must cancel the pending first-person placement flow',
);
assert.match(
  bootstrap,
  /hasLockedPlacement\(\) \? 'default' : 'none'/,
  'the native cursor must return as soon as the world pin is locked',
);
assert.match(
  placement,
  /Drop into first person/,
  'the placement surface must expose an explicit confirmation action',
);
assert.match(
  bootstrap,
  /placementParent: sceneManager\.scene[\s\S]{0,220}terrainProjector\.pick\(clientX, clientY\)/,
  'RTS placement must use the shared terrain projector and a world-space marker parent',
);
assert.doesNotMatch(
  bootstrap,
  /canOpenMenuFromKeyboard:[\s\S]{0,120}!firstPersonController\.isActive\(\)/,
  'Escape must be allowed to open settings while first-person is active',
);
assert.match(controls, /Toggle walk mode', keys: '~'/);
assert.match(controls, /Settings', keys: 'Esc'/);
assert.doesNotMatch(controls, /Exit walk mode', keys: 'Esc'/);

console.log('test:first-person-mode passed');
