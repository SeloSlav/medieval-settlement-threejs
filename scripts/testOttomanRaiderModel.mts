import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modelPath = 'public/assets/models/villagers/ottoman-raider-common-01-v001.glb';
const mapPath = 'public/assets/models/villagers/ottoman-raider-common-01-v001.animation-map.json';

const expectedLabels = [
  'lift_heavy',
  'chop',
  'slash',
  'idle',
  'standing_relax',
  'walk',
  'angry_01',
  'fall',
  'hit_to_body_01',
  'wait',
  'run',
  'look_around',
  'cheer',
  'flee_01',
] as const;

const document = readGlbDocument(modelPath);
const animationNames = (document.animations ?? []).map((animation) => animation.name ?? '');
assert.deepEqual(animationNames, expectedLabels, 'the installed raider GLB must retain all 14 semantic labels');
assert.equal(document.skins?.length, 1, 'the raider must retain one authored skin');
assert.equal(document.skins?.[0]?.joints?.length, 41, 'the installed Tripo raider rig must retain all 41 joints');

const mapping = JSON.parse(readFileSync(mapPath, 'utf8')) as {
  animations: Array<{ index: number; semanticName: string | null }>;
};
assert.deepEqual(
  mapping.animations.map((animation) => animation.semanticName),
  expectedLabels,
  'the provenance map must agree with the installed GLB animation table',
);

const crowdRenderer = readFileSync('src/settlement/SettlementCrowdRenderer.ts', 'utf8');
const villagerRenderer = readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
const license = readFileSync('public/assets/models/villagers/LICENSE.txt', 'utf8');

assert.match(crowdRenderer, /raider:\s*'\/assets\/models\/villagers\/ottoman-raider-common-01-v001\.glb'/);
assert.match(crowdRenderer, /raiderPromise = loadVillagerSource\([\s\S]{0,220}createRaiderClipSet/);
for (const [mode, clip] of [
  ['fight', 'slash'],
  ['chop', 'chop'],
  ['gather', 'lift_heavy'],
  ['hurt', 'hit_to_body_01'],
  ['fall', 'fall'],
  ['flee', 'flee_01'],
  ['run', 'run'],
  ['talk', 'angry_01'],
  ['laugh', 'cheer'],
] as const) {
  assert.match(
    crowdRenderer,
    new RegExp(`${mode}: '${clip}'`),
    `${mode} must use the authored ${clip} raider clip`,
  );
}
assert.match(villagerRenderer, /presentation = combat\.faction === 'raider' \? 'raider' : 'common'/);
assert.match(villagerRenderer, /reactingToHit\) return 'hurt'/);
assert.match(villagerRenderer, /combat\.raidAnchorBuildingId\) return 'chop'/);
assert.match(villagerRenderer, /combat\.targetKind === 'cart'\) return 'gather'/);
assert.match(villagerRenderer, /RAIDER_LOOT_CHEER_START_SECONDS\) return 'laugh'/);
assert.match(villagerRenderer, /case 'retreating': return combat\.faction === 'raider' \? 'flee' : 'walk'/);
assert.match(villagerRenderer, /case 'raider': \{/);
assert.match(villagerRenderer, /ottomanRaiderIsRanged\(combat\.sourceSlot\)\) return 'bow'/);
assert.match(villagerRenderer, /combat\.ottomanRole === 'azab'\) return 'spear'/);
assert.match(villagerRenderer, /combat\.ottomanRole === 'sipahi'\) return 'spear-shield'/);
assert.match(license, /ottoman-raider-common-01-v001\.glb/);

console.log('Ottoman raider model contract passed: dedicated rig, 14 semantic clips, combat-state mapping, role-specific arms, and provenance.');

type GlbDocument = {
  animations?: Array<{ name?: string }>;
  skins?: Array<{ joints?: number[] }>;
};

function readGlbDocument(path: string): GlbDocument {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${path} must be a binary glTF`);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'JSON') {
      return JSON.parse(
        bytes.toString('utf8', offset + 8, offset + 8 + length).replace(/[\u0000\u0020]+$/g, ''),
      ) as GlbDocument;
    }
    offset += 8 + length;
  }
  throw new Error(`${path} does not contain a JSON chunk`);
}
