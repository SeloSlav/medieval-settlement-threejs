import { expect, test } from '@playwright/test';

test('recovers the world canvas after a paper-map WebGPU owner handoff', async ({ page }) => {
  await page.goto('/webgpu-render-owner.html');
  await expect.poll(async () => page.evaluate(() => (
    document.body.dataset.ready ?? document.body.dataset.error ?? null
  ))).not.toBeNull();
  const startup = await page.evaluate(() => ({
    error: document.body.dataset.errorReason ?? null,
    ready: document.body.dataset.ready ?? null,
  }));
  expect(startup.error).toBeNull();
  expect(startup.ready).toBe('true');

  const backend = await page.evaluate(
    () => window.__WEBGPU_RENDER_OWNER_FIXTURE__?.backend,
  );
  expect(backend).toBe('webgpu');

  const canvas = page.locator('canvas');
  const worldBefore = await canvas.screenshot();
  await page.evaluate(async () => {
    await window.__WEBGPU_RENDER_OWNER_FIXTURE__!.renderOwner('illustrated-map');
  });
  const map = await canvas.screenshot();
  expect(map.equals(worldBefore)).toBe(false);

  await page.evaluate(async () => {
    await window.__WEBGPU_RENDER_OWNER_FIXTURE__!.renderOwner('world');
  });
  const worldAfter = await canvas.screenshot();
  expect(worldAfter.equals(worldBefore)).toBe(true);
});
