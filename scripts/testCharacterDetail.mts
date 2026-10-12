import assert from 'node:assert/strict';
import { selectCharacterDetail } from '../src/scene/AuthoredCharacterDetail.ts';

// Approach, retreat and small oscillations use the same state a live actor keeps.
let level = selectCharacterDetail(120);
assert.equal(level, 0);
for (const height of [55, 46, 43]) { level = selectCharacterDetail(height, level); assert.equal(level, 0); }
level = selectCharacterDetail(40, level); assert.equal(level, 1);
for (const height of [44, 42, 49, 40]) { level = selectCharacterDetail(height, level); assert.equal(level, 1); }
level = selectCharacterDetail(16, level); assert.equal(level, 2);
for (const height of [19, 22, 18, 20]) { level = selectCharacterDetail(height, level); assert.equal(level, 2); }
level = selectCharacterDetail(30, level); assert.equal(level, 1);
level = selectCharacterDetail(90, level); assert.equal(level, 0);
assert.equal(selectCharacterDetail(400, 2), 0, 'Camera teleport restores close geometry immediately');
for (const value of [NaN, Infinity, -Infinity]) assert.equal(selectCharacterDetail(value, 2), 0);
console.log('Character detail camera envelope, hysteresis and close-view restoration passed.');
