import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE_BATTLE_CAPTURE_BITRATE,
  DEFAULT_LIVE_BATTLE_CAPTURE_DURATION_MS,
  DEFAULT_LIVE_BATTLE_CAPTURE_FPS,
  isLiveBattleCaptureEnabled,
  isLiveBattleCaptureRequested,
  liveBattleCaptureFilename,
} from '../src/app/liveBattleCapture.ts';

assert.equal(isLiveBattleCaptureRequested('?recordBattle=1'), true);
assert.equal(isLiveBattleCaptureRequested('?recordBattle=true&showcase=1'), true);
assert.equal(isLiveBattleCaptureRequested('?recordBattle=0'), false);
assert.equal(isLiveBattleCaptureRequested('?showcase=1'), false);
assert.equal(isLiveBattleCaptureEnabled('?recordBattle=1', true), true);
assert.equal(isLiveBattleCaptureEnabled('?recordBattle=1', false), false);
assert.equal(
  liveBattleCaptureFilename(DEFAULT_LIVE_BATTLE_CAPTURE_DURATION_MS),
  'selo-empire-live-battle-30s.webm',
);
assert.equal(DEFAULT_LIVE_BATTLE_CAPTURE_FPS, 60);
assert.equal(DEFAULT_LIVE_BATTLE_CAPTURE_BITRATE, 20_000_000);

console.log('Live battle capture gate, defaults, and deterministic filename passed.');
