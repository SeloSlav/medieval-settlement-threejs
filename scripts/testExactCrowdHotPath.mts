import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import {
  setMilitaryEquipmentCombatStance,
  setMilitaryEquipmentDropped,
  setMilitaryEquipmentVisible,
} from '../src/settlement/militaryEquipment.ts';

type FakeBatch = {
  materialSlots(): readonly Array<{ index: number; name: string }>;
  setMaterialColorAt(slot: number, materialSlot: number, color: number): void;
};

type AppearanceHarness = {
  authoredSlotAppearances: Map<object, Array<{
    agentId: string;
    tunicColor: number;
    skinColor: number;
    hairColor: number;
  }>>;
  lastAppearanceColorWrites: number;
  lastAppearanceColorReuses: number;
  updateAuthoredSlotAppearance(
    batch: FakeBatch,
    slot: number,
    agent: CrowdRenderAgent,
  ): void;
};

const harness = Object.create(SettlementCrowdRenderer.prototype) as AppearanceHarness;
harness.authoredSlotAppearances = new Map();
harness.lastAppearanceColorWrites = 0;
harness.lastAppearanceColorReuses = 0;
let materialWrites = 0;
const batch: FakeBatch = {
  materialSlots: () => [
    { index: 0, name: 'Skin' },
    { index: 1, name: 'Shirt' },
    { index: 2, name: 'Hair' },
  ],
  setMaterialColorAt: () => {
    materialWrites += 1;
  },
};
harness.authoredSlotAppearances.set(batch, []);

const agent: CrowdRenderAgent = {
  id: 'soldier:1',
  slot: 0,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  appearanceSeed: 1,
  variant: 'man',
  mode: 'fight',
  tunicColor: 0x8b3028,
  skinColor: 0xc9946a,
  hairColor: 0x35251c,
  tool: 'spear',
  movementSpeed: 0,
  active: true,
};

harness.updateAuthoredSlotAppearance(batch, 0, agent);
assert.equal(materialWrites, 3);
assert.equal(harness.lastAppearanceColorWrites, 1);
harness.updateAuthoredSlotAppearance(batch, 0, agent);
assert.equal(materialWrites, 3, 'stable authored appearance must not be rewritten each frame');
assert.equal(harness.lastAppearanceColorReuses, 1);
agent.hairColor = 0x221913;
harness.updateAuthoredSlotAppearance(batch, 0, agent);
assert.equal(materialWrites, 6, 'an actual appearance change must refresh every authored material slot');
assert.equal(harness.lastAppearanceColorWrites, 2);

const tool = new THREE.Group();
const mount = new THREE.Group();
tool.add(mount);
tool.userData.workerToolMounts = [mount];
tool.userData.workerToolVisible = true;
tool.userData.workerToolCombatStance = 'melee';
tool.userData.workerToolDropped = false;
mount.userData.workerToolCombatRole = 'melee-held';
let visibilityWrites = 0;
let mountVisible = true;
Object.defineProperty(mount, 'visible', {
  configurable: true,
  get: () => mountVisible,
  set: (value: boolean) => {
    visibilityWrites += 1;
    mountVisible = value;
  },
});

setMilitaryEquipmentVisible(tool, true);
setMilitaryEquipmentCombatStance(tool, 'melee');
setMilitaryEquipmentDropped(tool, false);
assert.equal(visibilityWrites, 0, 'unchanged equipment state must not rescan and rewrite mounts');
setMilitaryEquipmentDropped(tool, true);
assert.equal(visibilityWrites, 1);
assert.equal(mountVisible, false);
setMilitaryEquipmentDropped(tool, true);
assert.equal(visibilityWrites, 1, 'repeated casualty state must be a zero-write fast path');
setMilitaryEquipmentVisible(tool, false);
assert.equal(visibilityWrites, 2);
setMilitaryEquipmentVisible(tool, false);
assert.equal(visibilityWrites, 2, 'repeated hidden state must be a zero-write fast path');

const source = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
for (const required of [
  /authoredSlotAppearances/,
  /appearanceColorReuses/,
  /locomotionRateRefreshes/,
  /mountedAttachments\.unregisterTool\(visual\.tool\)/,
  /private readonly authoredBatchRequired = new Map/,
]) {
  assert.match(source, required);
}
assert.doesNotMatch(
  source.match(/private updateAuthoredBatches[\s\S]*?\n  }\n\n  \/\*\*/)?.[0] ?? '',
  /const required = new Map/,
  'the frame loop must reuse authored batch bookkeeping',
);

console.log(
  'Exact crowd hot path passed: stable colors, locomotion state, equipment visibility, '
    + 'attachment registrations, and batch bookkeeping reuse without visual substitution.',
);
