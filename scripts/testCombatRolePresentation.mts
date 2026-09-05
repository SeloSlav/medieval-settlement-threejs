import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Requires the local Vite preview. Exercise the actual source-loading and rig
// lifecycle so a future generic humanoid path cannot silently re-arm civilians.
const baseUrl = process.env.WEAPON_REVIEW_URL ?? 'http://127.0.0.1:5175';
for (const file of readdirSync('artifacts').filter(name => /(?:weapon-qa|bow-).*cases\.json$/.test(name))) {
  const cases = JSON.parse(readFileSync(`artifacts/${file}`, 'utf8'));
  assert.ok(cases.every((entry: { variant?: string }) => entry.variant === undefined || ['man', 'raider'].includes(entry.variant)), `${file} contains a noncombatant weapon case`);
}
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/artifacts/weapon-review.html?weapon=bow&mode=attack&variant=woman`);
  await page.waitForFunction(() => Boolean((window as any).weaponReview?.stats().ready), null, { timeout: 60000 });
  assert.deepEqual(await page.locator('select[data-key="variant"] option').allTextContents(), ['man', 'raider']);
  assert.equal(await page.evaluate(() => (window as any).weaponReview.stats().state.variant), 'man');
  assert.equal(await page.evaluate(() => {
    try { (window as any).weaponReview.set({ variant: 'woman' }); return false; }
    catch { return true; }
  }), true, 'the preview API must reject noncombatants, including stale QA cases');

  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { SettlementCrowdRenderer } = await import('/src/settlement/SettlementCrowdRenderer.ts');
    const { buildCrowdViewState } = await import('/src/settlement/crowdView.ts');
    const crowd = new SettlementCrowdRenderer({ parent: new THREE.Group() });
    await crowd.ready;
    try {
      const source = crowd.sources.woman;
      const names: string[] = [];
      source.scene.traverse((object: any) => { if (object.isBone) names.push(object.name); });
      const agent = { id: 'civilian', slot: 0, x: 0, y: .02, z: 0, yaw: 0, appearanceSeed: 431,
        variant: 'woman', presentation: 'common', mode: 'walk', tool: null, movementSpeed: 1.2,
        tunicColor: 0x835f3f, skinColor: 0xc9946a, hairColor: 0x3d2b22, active: true };
      const view = buildCrowdViewState(0, 0, 25);
      const poses = [];
      for (const mode of ['walk', 'chop', 'talk', 'hurt', 'flee', 'fight']) {
        Object.assign(agent, { mode, tool: mode === 'chop' ? 'hatchet' : mode === 'fight' ? 'bow' : null,
          combatAttackCooldown: mode === 'fight' ? .2 : undefined });
        crowd.syncAgents([agent], view, .1);
        const visual = crowd.animated.get(agent.id);
        poses.push({ mode, action: visual.actionMode, combatRig: !!visual.combatRig, tool: !!visual.tool,
          clip: visual.actions[visual.actionMode].getClip().name });
      }
      return { names, clips: Object.values(source.clips).map((clip: any) => clip.name), poses };
    } finally { crowd.dispose(); }
  });
  assert.equal(result.names.length, 41, 'female civilians retain the original skeleton without the 18 combat grip bones');
  assert.ok(result.clips.every(name => !/slash|combat-fight|game-fight/.test(name)), 'no female attack clip is installed');
  for (const pose of result.poses) {
    assert.equal(pose.combatRig, false, `${pose.mode}: a civilian must not acquire a combat rig`);
    assert.equal(pose.tool, pose.mode === 'chop', `${pose.mode}: work tools remain available, weapons do not`);
    if (pose.mode === 'fight') assert.equal(pose.action, 'wait');
    else if (pose.mode === 'talk') assert.ok(['talk', 'greet', 'agree', 'laugh'].includes(pose.action));
    else assert.equal(pose.action, pose.mode);
  }
  assert.deepEqual(errors, []);
  console.log('Male-only weapon preview verified; female civilian animations retain 41 bones, work tools, and no attacks or combat rigs.');
} finally { await browser.close(); }
