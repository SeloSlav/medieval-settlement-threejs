import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  combatBaseActionMode,
  createClericClipSet,
  retargetVillagerAnimationClip,
  villagerSocialActionMode,
  villagerStandingActionMode,
  type CrowdRenderAgent,
} from '../src/settlement/SettlementCrowdRenderer.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;
(globalThis as typeof globalThis & {
  createImageBitmap: (blob: Blob) => Promise<ImageBitmap>;
}).createImageBitmap = async () => ({
  width: 1,
  height: 1,
  close() {},
} as ImageBitmap);

async function loadGlb(path: string) {
  const bytes = readFileSync(path);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}

const [worker, cleric] = await Promise.all([
  loadGlb('public/assets/models/villagers/worker-male-common-01-v002.glb'),
  loadGlb('public/assets/models/villagers/cleric-monk-common-01-v001.glb'),
]);
const clericClips = createClericClipSet(cleric.animations);
const socialSources = {
  talk: clericClips.sermon,
  greet: clericClips.greet,
  agree: clericClips.agree,
  laugh: clericClips.laugh,
} as const;

for (const [mode, sourceClip] of Object.entries(socialSources)) {
  const clip = retargetVillagerAnimationClip(
    cleric.scene,
    worker.scene,
    sourceClip,
    `${sourceClip.name}:worker-${mode}`,
  );
  assert.ok(clip.duration > 0, `${mode} must retain authored duration`);
  assert.ok(clip.tracks.length > 0, `${mode} must retain authored tracks`);
  for (const track of clip.tracks) {
    const boneName = track.name.slice(0, track.name.lastIndexOf('.'));
    assert.ok(
      worker.scene.getObjectByName(boneName),
      `${mode} targets worker bone ${boneName}`,
    );
  }
}

const socialModes = new Set(
  Array.from({ length: 256 }, (_, seed) => villagerSocialActionMode(seed * 2_654_435_761 >>> 0)),
);
assert.deepEqual(
  [...socialModes].sort(),
  ['agree', 'greet', 'laugh', 'talk'],
  'seeded camp conversations must exercise every shipped social role',
);

const standingModes = new Set(
  Array.from({ length: 256 }, (_, seed) => villagerStandingActionMode(seed * 2_654_435_761 >>> 0)),
);
assert.deepEqual(
  [...standingModes].sort(),
  ['look', 'relax', 'wait'],
  'unpaired standing founders must use every calm worker take instead of plain idle',
);

const commonTalker = {
  mode: 'talk',
  presentation: 'common',
  appearanceSeed: 0x72ac_4109,
} as CrowdRenderAgent;
assert.equal(
  combatBaseActionMode(commonTalker),
  villagerSocialActionMode(commonTalker.appearanceSeed),
  'a common standing talker must choose a social action instead of neutral idle',
);
assert.equal(
  combatBaseActionMode({ ...commonTalker, presentation: 'cleric' }),
  'talk',
  'clerics retain their directly authored talk mapping',
);

const crowdSource = readFileSync('src/settlement/SettlementCrowdRenderer.ts', 'utf8');
const villagerSource = readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
assert.match(crowdSource, /installWorkerSocialClips\(cleric, man\)/);
assert.match(crowdSource, /installWorkerSocialClips\(cleric, woman\)/);
assert.match(
  villagerSource,
  /assignment\.kind === 'idle'[\s\S]{0,120}villagerStandingActionMode\(agent\.pathSeed\)/,
  'ambient hearth-idle assignments must publish a varied standing render mode',
);

console.log('Villager social animation reuse and deterministic camp roles verified.');
