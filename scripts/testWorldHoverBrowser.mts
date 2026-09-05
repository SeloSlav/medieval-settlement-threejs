import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const checks: string[] = [];
const check = (description: string) => checks.push(description);
try {
  await page.goto(`${process.env.WORLD_HOVER_URL ?? 'http://127.0.0.1:5182'}/scripts/fixtures/world-hover.html`);
  await page.waitForFunction(() => Boolean((window as any).fixture));
  const label = page.locator('.world-hover-label');
  const wheel = page.locator('[data-construction-id="building:mill"]');
  const moveTo = async (x: number, z = 0) => {
    const position = await page.evaluate(({ x, z }) => (window as any).fixture.project(x,z), {x,z});
    await page.mouse.move(position.x, position.y);
  };
  const expectLabel = async (text: string) => {
    await page.waitForFunction(expected => {
      const el = document.querySelector<HTMLElement>('.world-hover-label');
      return el && !el.hidden && el.textContent === expected;
    }, text);
  };
  await moveTo(-30);
  await expectLabel('Lumber mill (under construction)');
  assert.equal(await wheel.evaluate(el => (el as HTMLElement).style.getPropertyValue('--resource-stock-angle')), '126.0deg');
  check('Construction label and authoritative 35% wheel');
  await page.evaluate(() => { (window as any).fixture.building.constructionProgress = 0.8; });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.construction-map-icon')?.style.getPropertyValue('--resource-stock-angle') === '288.0deg');
  check('Progress refreshes without moving the pointer');
  await page.evaluate(() => { (window as any).fixture.building.constructionComplete = true; });
  await expectLabel('Lumber mill');
  await wheel.waitFor({state:'detached'});
  check('Completion removes the wheel and construction suffix');
  await moveTo(0);
  await expectLabel('Residence (Tier 1)');
  await page.evaluate(() => { (window as any).fixture.home.tier = 3; });
  await expectLabel('Residence (Tier 3)');
  await page.evaluate(() => { Object.assign((window as any).fixture.home,{tier:0,upgradeTargetTier:1,upgradeProgress:0.5}); });
  await expectLabel('Residence (under construction)');
  await page.locator('[data-construction-id="residence:home"]').waitFor();
  check('Residence tiers and new-home construction update live');
  await moveTo(30);
  const crops = await page.evaluate(() => (window as any).fixture.FARM_CROPS);
  for (const crop of crops) {
    await page.evaluate(crop => { (window as any).fixture.state.farmFields.get('field').crop = crop; }, crop);
    await expectLabel(`Field (${crop === 'wheat' ? 'Wheat–rye maslin' : crop[0].toUpperCase() + crop.slice(1)})`);
  }
  check('Every crop, including fallow, uses the current crop');
  await moveTo(60);
  for (const species of ['cattle','sheep','swine','horses']) {
    await page.evaluate(species => { (window as any).fixture.state.livestockHerds.get('pasture').species = species; }, species);
    await expectLabel(`Pasture (${species[0].toUpperCase()}${species.slice(1)})`);
  }
  await page.evaluate(() => { (window as any).fixture.state.livestockHerds.clear(); });
  await expectLabel('Pasture');
  check('Every animal type and an unstocked pasture');
  await page.evaluate(() => (window as any).fixture.setOffset(1000));
  await label.waitFor({state:'hidden'});
  await page.evaluate(() => (window as any).fixture.setOffset(0));
  await expectLabel('Pasture');
  check('World movement beneath a stationary pointer re-picks the hover target');
  await page.evaluate(() => (window as any).fixture.setBlocked(true));
  await label.waitFor({state:'hidden'});
  await page.locator('.construction-map-icons').waitFor({state:'hidden'});
  await page.evaluate(() => (window as any).fixture.setBlocked(false));
  await expectLabel('Pasture');
  check('Menus, placement gates and view changes suppress overlays');
  await page.mouse.down({button:'middle'});
  await label.waitFor({state:'hidden'});
  await page.mouse.up({button:'middle'});
  await expectLabel('Pasture');
  await page.locator('#hud').hover();
  await label.waitFor({state:'hidden'});
  check('Dragging and entering HUD dismiss the hover label');
  await moveTo(0);
  await expectLabel('Residence (under construction)');
  const wheelPosition = await page.locator('[data-construction-id="residence:home"]').boundingBox();
  const projected = await page.evaluate(() => (window as any).fixture.project(0,0,2.4));
  assert.ok(wheelPosition);
  assert.ok(Math.abs(wheelPosition.x + wheelPosition.width/2 - projected.x) < 1);
  assert.ok(Math.abs(wheelPosition.y + wheelPosition.height/2 - projected.y) < 1);
  assert.equal(await page.locator('.construction-map-icon').first().evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  check('Wheel stays centered on its projected world anchor and cannot intercept clicks');
  const cursor = await page.locator('#renderer').evaluate(el => getComputedStyle(el).cursor);
  assert.match(cursor, /medieval-pointer\.png.*2 2/);
  const cursorImage = await page.evaluate(async () => {
    const image = new Image(); image.src='/assets/ui/cursors/medieval-pointer.png'; await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
    return {width:image.width,height:image.height,alpha:context.getImageData(0,0,1,1).data[3]};
  });
  assert.deepEqual(cursorImage, {width:40,height:40,alpha:0});
  check('Cursor loads as 40px PNG with real alpha and correct CSS hotspot');
  await page.evaluate(() => {
    const f=(window as any).fixture;
    for (const kind of f.BUILDING_KINDS) {
      f.building.kind=kind;
      if (!f.find({x:-30,z:0})?.label) throw new Error(`Missing label for ${kind}`);
    }
    f.building.kind='lumber_mill';f.building.constructionComplete=false;
  });
  check('All building kinds resolve their catalog name');
  await moveTo(-30);
  await expectLabel('Lumber mill (under construction)');
  if (process.env.WORLD_HOVER_CAPTURE === '1') {
    await mkdir('artifacts/world-hover', {recursive:true});
    await page.screenshot({path:'artifacts/world-hover/browser-check.png'});
  }
  await page.evaluate(() => (window as any).fixture.dispose());
  assert.equal(await page.locator('.world-hover-label, .construction-map-icons').count(),0);
  assert.deepEqual(errors,[]);
  check('Disposal removes overlays; no browser exceptions');
  console.log(checks.map(description=>`PASS ${description}`).join('\n'));
} catch (error) {
  console.error({checks,errors, state: await page.evaluate(() => {
    const label = document.querySelector<HTMLElement>('.world-hover-label');
    return {label:label?.textContent,hidden:label?.hidden,building:(window as any).fixture?.building};
  })});
  throw error;
} finally {
  await browser.close();
}
