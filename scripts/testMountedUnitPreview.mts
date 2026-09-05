import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.WEAPON_REVIEW_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/artifacts/weapon-review.html?unit=hussars&variant=woman`);
  await page.waitForFunction(() => Boolean((window as any).weaponReview?.stats().ready), null, { timeout: 60000 });
  const stats = () => page.evaluate(() => (window as any).weaponReview.stats());
  const set = (patch: Record<string, unknown>) => page.evaluate(patch => (window as any).weaponReview.set(patch), patch);
  assert.equal((await stats()).state.unit, 'hussars');
  assert.equal((await stats()).state.variant, 'man');
  assert.equal((await stats()).state.weapon, 'spear-shield');
  assert.deepEqual(await page.getByRole('combobox', { name: 'Army unit', exact: true }).locator('option').allTextContents(),
    ['On foot', 'Hussars', 'Armored Lancers', 'Mounted Archers', 'Akıncı Raiders', 'Sipahi Raiders']);
  await mkdir('artifacts/mounted-unit-preview', { recursive: true });
  const seated = await set({ unit: 'on-foot', mode: 'sit' });
  const kneeWidth = (result: any) => result.rider.legs.L_Calf[0] - result.rider.legs.R_Calf[0];
  const footWidth = (result: any) => result.rider.legs.L_Foot[0] - result.rider.legs.R_Foot[0];

  for (const [unit, weapon, presentation, sidearm] of [
    ['hussars', 'spear-shield', 'hussar', 'sidearm-shield'],
    ['armored-lancers', 'spear', 'lancer', 'sidearm'],
    ['mounted-archers', 'bow', 'archer', 'sidearm'],
    ['akinci', 'bow', 'archer', 'sidearm-shield'],
    ['sipahi', 'spear-shield', 'lancer', 'sidearm-shield'],
  ]) {
    await page.getByRole('combobox', { name: 'Army unit', exact: true }).selectOption(unit);
    await set({ mode: 'walk', paused: true });
    let result = await stats();
    assert.equal(result.state.weapon, weapon);
    assert.equal(result.state.variant, unit==='akinci'||unit==='sipahi'?'raider':'man');
    assert.deepEqual(await page.locator('select[data-key="weapon"] option').allTextContents(), [weapon, sidearm]);
    await page.getByRole('combobox', { name: 'weapon', exact: true }).selectOption(sidearm);
    assert.equal((await stats()).state.unit, unit, 'selecting an issued sidearm keeps the rider mounted');
    assert.equal((await stats()).mounted, true);
    await page.getByRole('combobox', { name: 'weapon', exact: true }).selectOption(weapon);
    await set({ mode: 'walk', paused: true, view: 'side' });
    await page.screenshot({ path: `artifacts/mounted-unit-preview/${unit}.png` });
    await set({ view: 'front' });
    await page.screenshot({ path: `artifacts/mounted-unit-preview/${unit}-front.png` });
    for (const mode of ['idle', 'walk', 'run', 'flee', 'attack', 'fallback', 'hurt', 'hit']) {
      result = await set({ mode, time: .25, phase: .25, paused: true });
      assert.equal(result.mounted, true, `${unit}/${mode}: rider is mounted`);
      assert.equal(result.rider.action, 'sit', `${unit}/${mode}: authored riding pose`);
      assert.equal(result.horse.presentation, presentation);
      assert.equal(result.horse.mode, ['walk', 'run', 'flee'].includes(mode) ? 'walk' : 'idle');
      assert.deepEqual(result.horse.position, [0, .02, 0]);
      assert.ok(result.rider.y > .02 && result.rider.y < 1.1, 'rider root is lifted to the saddle');
      assert.ok(kneeWidth(result) > kneeWidth(seated) + .12, `${unit}/${mode}: knees clear the horse`);
      assert.ok(footWidth(result) > footWidth(seated) + .18, `${unit}/${mode}: boots hang outside the barrel`);
      assert.ok(Object.values(result.bones).every((point: any) => point.every(Number.isFinite)));
    }

    const start = await set({ mode: 'attack', phase: .2, time: .2 });
    const end = await set({ phase: .7, time: .7 });
    assert.equal(start.rider.time, end.rider.time, 'scrubbing must keep the rider seated');
    assert.notDeepEqual(start.bones, end.bones, 'mounted attacks must animate the weapon rig');
    assert.notEqual(start.horse.time, end.horse.time, 'horse clip supports scrubbing');
    const repeat = await set({ phase: .2, time: .2 });
    assert.equal(start.horse.time, repeat.horse.time, 'horse scrubbing is repeatable');
    assert.deepEqual(start.bones, repeat.bones, 'rider scrubbing is repeatable');

    const playing = await set({ mode: 'walk', paused: false });
    await page.waitForFunction(frame => (window as any).weaponReview.stats().frame > frame + 8, playing.frame);
    const advanced = await stats();
    assert.notEqual(playing.horse.time, advanced.horse.time, 'horse walking animation advances');
    assert.equal(playing.rider.time, advanced.rider.time, 'riding pose stays seated during playback');
    assert.deepEqual(playing.rider.legs, advanced.rider.legs, 'leg widening does not accumulate while playing');
    const paused = await set({ paused: true, view: 'side' });
    await page.waitForFunction(frame => (window as any).weaponReview.stats().frame > frame + 3, paused.frame);
    assert.equal((await stats()).horse.time, paused.horse.time, 'pause freezes the horse');

    result = await set({ mode: 'fall' });
    assert.equal(result.mounted, false);
    assert.equal(result.rider.action, 'fall');
    assert.equal(result.rider.y, .02);
    assert.equal(result.horse, null, 'fallen rider is no longer attached to a horse');
  }

  await set({ unit: 'mounted-archers', mode: 'walk' });
  await page.locator('input[type="range"]').fill('0.6');
  assert.equal((await stats()).state.time, .6, 'timeline scrubs both rider and horse');
  await page.getByRole('combobox', { name: 'Army unit', exact: true }).selectOption('on-foot');
  assert.equal((await stats()).horse, null, 'returning to infantry removes the horse');
  assert.equal((await stats()).rider.y, .02);
  await set({ unit: 'hussars' });
  assert.equal(await page.evaluate(() => {
    try { (window as any).weaponReview.set({ weapon: 'halberd' }); return false; }
    catch { return true; }
  }), true, 'the API rejects weapons the mounted unit does not carry');
  assert.equal((await stats()).state.unit, 'hussars');
  const restored = await set({ unit: 'on-foot', mode: 'sit' });
  assert.deepEqual(restored.rider.legs, seated.rider.legs, 'civilian sitting does not inherit the mounted leg spread');
  assert.ok((await page.locator('select[data-key="weapon"] option').allTextContents()).includes('halberd'));
  await set({ unit: 'hussars' });
  assert.equal((await set({ variant: 'raider' })).state.unit, 'on-foot', 'raiders leave player cavalry presets');
  assert.deepEqual(errors, []);
  console.log('All five mounted units verified: equipment, horses, riding poses, attacks, scrubbing, playback, fall, and return to infantry.');
} finally {
  await browser.close();
}
