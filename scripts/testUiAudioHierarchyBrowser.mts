import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const projectRoot = path.resolve(import.meta.dirname, '..');
const server = await createServer({
  root: projectRoot,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0 },
});

await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === 'object');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.setContent(`
    <main id="root">
      <button id="ordinary">Ordinary utility</button>
      <button id="tab" class="build-menu-category">Housing category</button>
      <button id="toggle" aria-pressed="false">Road overlay</button>
      <button id="panel" aria-expanded="false">Resources</button>
      <button id="removed">Close report</button>
      <button id="stopped">Menu</button>
      <button id="transaction">Upgrade residence</button>
      <button id="danger">Demolish building</button>
      <button id="explicit">Save</button>
      <button id="development" data-ui-sound="development_unlock">Unlock</button>
      <label><input id="checkbox" type="checkbox" /> Audio</label>
      <select id="select"><option>One</option><option>Two</option></select>
      <input id="range" type="range" min="0" max="100" value="20" />
    </main>
  `);

  const result = await page.evaluate(async () => {
    const { UiInteractionAudio } = await import('/src/audio/UiInteractionAudio.ts');
    const root = document.querySelector<HTMLElement>('#root')!;
    const plays: Array<{ id: string; rate: number | null }> = [];
    let revision = 0;
    const fakeAudio = {
      getPlayRevision: () => revision,
      preload: () => undefined,
      play: (id: string, options?: { playbackRate?: number }) => {
        revision += 1;
        plays.push({ id, rate: options?.playbackRate ?? null });
      },
    };
    const director = new UiInteractionAudio(root, fakeAudio);
    const click = async (selector: string) => {
      document.querySelector<HTMLButtonElement>(selector)!.click();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    };

    document.querySelector('#toggle')!.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).setAttribute('aria-pressed', 'true');
    });
    document.querySelector('#panel')!.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).setAttribute('aria-expanded', 'true');
    });
    document.querySelector('#removed')!.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).remove();
    });
    document.querySelector('#stopped')!.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    document.querySelector('#explicit')!.addEventListener('click', () => {
      fakeAudio.play('confirm');
    });

    for (const selector of [
      '#ordinary',
      '#tab',
      '#toggle',
      '#panel',
      '#removed',
      '#stopped',
      '#transaction',
      '#danger',
      '#explicit',
      '#development',
    ]) await click(selector);

    const checkbox = document.querySelector<HTMLInputElement>('#checkbox')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const select = document.querySelector<HTMLSelectElement>('#select')!;
    select.value = 'Two';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const range = document.querySelector<HTMLInputElement>('#range')!;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.value = '80';
    range.dispatchEvent(new Event('input', { bubbles: true }));

    const beforeDispose = plays.length;
    director.dispose();
    await click('#ordinary');
    return { plays, beforeDispose };
  });

  assert.deepEqual(result.plays.slice(0, 10), [
    { id: 'game_press', rate: null },
    { id: 'game_tab', rate: null },
    { id: 'game_toggle', rate: 1.06 },
    { id: 'game_panel', rate: 1.06 },
    { id: 'game_panel', rate: 0.92 },
    { id: 'game_panel', rate: 1.06 },
    { id: 'game_transaction', rate: null },
    { id: 'game_danger', rate: null },
    { id: 'confirm', rate: null },
    { id: 'development_unlock', rate: null },
  ]);
  assert.deepEqual(result.plays.slice(10, 12), [
    { id: 'game_toggle', rate: 1.06 },
    { id: 'game_tab', rate: null },
  ]);
  assert.equal(result.plays[12]?.id, 'setup_adjust');
  assert(Math.abs((result.plays[12]?.rate ?? 0) - 0.952) < 1e-9);
  assert.equal(result.plays.length, result.beforeDispose);
  console.log('UI audio browser behavior tests passed');
} finally {
  await browser.close();
  await server.close();
}
