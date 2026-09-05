import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = `artifacts/environment-pass/${process.argv[2] ?? 'ivy-material-inspection-02'}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  const cohort = await fetch('http://127.0.0.1:5187/__environment_cohort').then(r => r.json());
  writeFileSync(`${out}/source-cohort.json`, JSON.stringify(cohort, null, 2));
  if (process.argv.includes('--world')) {
    await page.goto('http://127.0.0.1:5187/environment-lineup.html', { timeout: 120000 });
    await page.waitForFunction(() => window.__ENVIRONMENT_GAUNTLET__, {}, { timeout: 300000 });
    const result = await page.evaluate(async () => {
      const manager = window.__ENVIRONMENT_GAUNTLET__.manager;
      const ivy = manager.getForestManager().forestFloorIvy;
      await window.__ENVIRONMENT_GAUNTLET__.capture({view:'ground', sampleCount:1});
      // Placement plans include patches later removed for roads/buildings.
      // Frame a real resident leaf, not a cleared plan's former position.
      const matrices = ivy.mesh.instanceMatrix.array;
      let placement; let nearest = Infinity;
      for (let i=0; i<ivy.mesh.count; i++) {
        const offset=i*16;
        const x=matrices[offset+12], z=matrices[offset+14];
        if (manager.getRoadNetwork().nearestPointDistance(x,z)<5) continue;
        const distance=Math.hypot(x-190,z+20);
        if(distance<nearest) { nearest=distance; placement={x,z,leaf:i}; }
      }
      if (!placement) throw new Error('No resident forest ivy leaf for inspection');
      const renderFrames = async (count, dt = 0) => {
        for (let i=0; i<count; i++) { await new Promise(requestAnimationFrame); manager.render(dt, 12); }
      };
      manager.cameraTarget.set(placement.x, manager.terrain.getHeightAt(placement.x,placement.z)+.16, placement.z);
      manager.camera.position.copy(manager.cameraTarget).add(manager.camera.position.clone().set(3.5,7.5,8.7));
      manager.camera.lookAt(manager.cameraTarget);
      manager.camera.updateMatrixWorld(true);
      await renderFrames(360, 1/60);
      for(let attempt=0;attempt<12 && !manager.grassField.isStreamSettled();attempt++) await renderFrames(60,1/60);
      if(!manager.grassField.isStreamSettled()) throw new Error('Grass stream did not settle for ivy inspection');
      const tint = ivy.mesh.geometry.getAttribute('aTint');
      const original = new Uint8Array(tint.array);
      const images = {};
      const evidence = {};
      try {
        for (const [name, lift] of [['original',0], ['gentler',.22], ['neutral',1]]) {
          for (let i=0;i<original.length;i++) tint.array[i] = Math.round(original[i]+(255-original[i])*lift);
          tint.needsUpdate = true;
          await renderFrames(10);
          await manager.waitForSubmittedWork();
          images[name] = manager.renderer.domElement.toDataURL('image/png');
          evidence[name] = manager.getPerformanceStats();
        }
      } finally { tint.array.set(original); tint.needsUpdate = true; }
      return { placement, images, evidence, receiveShadow: ivy.mesh.receiveShadow,
        castShadow: ivy.mesh.castShadow, shadowPolicy: ivy.mesh.userData.groundCoverShadowPolicy,
        residents: ivy.mesh.count, textureColorSpace: ivy.textures.albedo.colorSpace };
    });
    for (const [name,png] of Object.entries(result.images)) writeFileSync(`${out}/world-${name}.png`, Buffer.from(png.split(',')[1],'base64'));
    delete result.images;
    writeFileSync(`${out}/world.json`, JSON.stringify(result,null,2));
  } else for (const view of ['near', 'design']) {
    await page.goto(`http://127.0.0.1:5187/forest-floor-lineup.html?clean=1&view=${view}&time=0`, { timeout: 120000 });
    await page.waitForFunction(() => window.__FOREST_FLOOR_LINEUP_READY__, {}, { timeout: 120000 });
    for (const [name, tintLift, sunFactor] of [
      ['original-sun', 0, 1], ['original-ambient', 0, 0],
      ['neutral-tint-sun', 1, 1], ['gentler-tint-sun', 0.22, 1], ['gentler-tint-ambient', 0.22, 0],
    ]) {
      const { png, ...evidence } = await page.evaluate(({ tintLift, sunFactor }) =>
        window.__FOREST_FLOOR_INSPECT_MATERIAL__(tintLift, sunFactor), { tintLift, sunFactor });
      writeFileSync(`${out}/${view}-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
      writeFileSync(`${out}/${view}-${name}.json`, JSON.stringify({ view, tintLift, sunFactor, ...evidence }, null, 2));
      console.log(`${view}-${name}`, { calls: evidence.calls, triangles: evidence.triangles });
    }
  }
  writeFileSync(`${out}/runtime.json`, JSON.stringify({ errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
