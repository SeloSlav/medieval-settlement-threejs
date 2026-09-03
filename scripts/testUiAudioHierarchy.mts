import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  uiSoundForSemantics,
  type UiControlSemantics,
} from '../src/audio/UiInteractionAudio.ts';

function decide(overrides: Partial<UiControlSemantics> = {}) {
  return uiSoundForSemantics({
    disabled: false,
    text: '',
    role: null,
    hasPopup: false,
    expanded: null,
    pressed: null,
    ...overrides,
  });
}

assert.deepEqual(decide({ text: 'ordinary button' }), { id: 'game_press' });
assert.deepEqual(decide({ text: 'build menu', hasPopup: true, expanded: 'true' }), {
  id: 'game_panel',
  playbackRate: 1.06,
});
assert.deepEqual(decide({ text: 'close town report' }), {
  id: 'game_panel',
  playbackRate: 0.92,
});
assert.deepEqual(decide({ text: 'resources', expanded: 'false' }), {
  id: 'game_panel',
  playbackRate: 0.92,
});
assert.deepEqual(decide({ text: 'construction category card' }), { id: 'game_tab' });
assert.deepEqual(decide({ text: 'overlay', pressed: 'true' }), {
  id: 'game_toggle',
  playbackRate: 1.06,
});
assert.deepEqual(decide({ text: 'upgrade residence' }), { id: 'game_transaction' });
assert.deepEqual(decide({ text: 'demolish building' }), { id: 'game_danger' });
assert.deepEqual(decide({ text: 'confirm rename' }), { id: 'confirm' });
assert.equal(decide({ disabled: true }), null);
assert.equal(decide({ override: 'none' }), null);
assert.deepEqual(decide({ override: 'game_transaction' }), { id: 'game_transaction' });
assert.deepEqual(decide({ override: 'development_unlock' }), { id: 'development_unlock' });
assert.deepEqual(decide({ override: 'game_cancel' }), { id: 'game_cancel' });

const developmentMenu = readFileSync('src/ui/DevelopmentMenu.ts', 'utf8');
assert.match(developmentMenu, /data-development-unlock data-ui-sound="development_unlock"/);

const source = readFileSync('src/audio/UiInteractionAudio.ts', 'utf8');
assert.match(source, /getPlayRevision\(\)/);
assert.match(source, /clickRevision\.get\(event\) !== this\.audio\.getPlayRevision\(\)/);
assert.match(source, /queueMicrotask\(\(\) => this\.playCapturedClick/);
assert.match(source, /ADJUSTMENT_INTERVAL_MS = 45/);
assert.match(source, /0\.9 \+ normalized \* 0\.2/);

console.log('UI audio hierarchy tests passed');
