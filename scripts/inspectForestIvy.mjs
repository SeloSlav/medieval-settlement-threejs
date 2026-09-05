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
  page.on('console', message => { if (message.text().startsWith('[ivy-review]')) console.log(message.text()); });
  const cohort = await fetch('http://127.0.0.1:5187/__environment_cohort').then(r => r.json());
  writeFileSync(`${out}/source-cohort.json`, JSON.stringify(cohort, null, 2));
  if (process.argv.includes('--world')) {
    await page.goto('http://127.0.0.1:5187/environment-lineup.html', { timeout: 120000 });
    await page.waitForFunction(() => window.__ENVIRONMENT_GAUNTLET__, {}, { timeout: 300000 });
    const result = await page.evaluate(async ({ normalTrial, profile, installed, balanced }) => {
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
      let orbitDistance = 12;
      const renderFrames = async (count, dt = 0) => {
        for (let i=0; i<count; i++) { await new Promise(requestAnimationFrame); manager.render(dt, orbitDistance); }
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
      const originalNormal = ivy.mesh.material.normalNode;
      const installedVertexPrograms = [...manager.renderer._pipelines.programs.vertex]
        .filter(([,program])=>program.name?.includes('ivy')).map(([code])=>code);
      const hasNormalFix = installedVertexPrograms.some(code=>code.includes('vIvyHingeNormal'));
      if(normalTrial && hasNormalFix) throw new Error('A/B requires an archived source cohort from before the ivy normal fix');
      if(installed && !hasNormalFix) throw new Error('Installed ivy normal fix is absent from the rendered shader');
      const vertexNormal = normalTrial ? originalNormal.toVarying('vIvyInspectionNormal').normalize() : originalNormal;
      const images = {};
      const evidence = {};
      const shaders = {};
      const profiles = [];
      let gpuEvidence;
      try {
        const arms = installed ? [
          ['installed',0,'final'], ['installed-lighting',0,'lighting'], ['installed-normal',0,'normal'],
        ] : normalTrial ? [
          ['original',0,'final',false], ['vertex-normal',0,'final',true],
          ['vertex-normal-no-ao',0,'no-ao',true], ['vertex-normal-lighting',0,'lighting',true],
          ['vertex-normal-diagnostic',0,'normal',true], ['original-normal-diagnostic',0,'normal',false],
        ] : [
          ['original',0,'final'], ['gentler',.22,'final'], ['neutral',1,'final'],
          ['original-no-ao',0,'no-ao'], ['gentler-no-ao',.22,'no-ao'],
          ['original-lighting',0,'lighting'], ['normal',0,'normal'], ['ao',0,'ao'],
        ];
        for (const [name, lift, diagnostic, useVertexNormal] of arms) {
          const nextNormal = useVertexNormal ? vertexNormal : originalNormal;
          if (ivy.mesh.material.normalNode !== nextNormal) {
            ivy.mesh.material.normalNode = nextNormal;
            ivy.mesh.material.needsUpdate = true;
          }
          manager.setLightingDiagnostic(diagnostic);
          for (let i=0;i<original.length;i++) tint.array[i] = Math.round(original[i]+(255-original[i])*lift);
          tint.needsUpdate = true;
          await renderFrames(10);
          await manager.waitForSubmittedWork();
          images[name] = manager.renderer.domElement.toDataURL('image/png');
          evidence[name] = manager.getPerformanceStats();
          if ((normalTrial || installed) && diagnostic === 'final') {
            // Read the existing production-pass shaders without compiling a
            // different canvas/MRT variant merely for diagnostics.
            shaders[name] = Object.fromEntries(['vertex','fragment'].map(stage => [stage,
              [...manager.renderer._pipelines.programs[stage]].filter(([,program]) =>
                program.name?.includes('ivy')).map(([code,program]) => ({ name:program.name, code }))]));
          }
        }
        if (profile) {
          const { createVisualGpuTimestampProfiler } = await import('/src/e2e/webGpuTimestampProfiler.ts');
          const gpu = createVisualGpuTimestampProfiler({ kind: manager.rendererBackend, renderer: manager.renderer });
          const direction = manager.camera.position.clone().sub(manager.cameraTarget).normalize();
          manager.setLightingDiagnostic('final');
          const summarize = values => {
            const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
            return { count:sorted.length, median:sorted[Math.floor(sorted.length*.5)], p95:sorted[Math.floor(sorted.length*.95)] };
          };
          try {
            for (const distance of [12,42]) {
              orbitDistance = distance;
              manager.camera.position.copy(manager.cameraTarget).addScaledVector(direction,distance);
              manager.camera.lookAt(manager.cameraTarget);
              manager.camera.updateMatrixWorld(true);
              await renderFrames(360,1/60);
              for(let attempt=0;attempt<12 && !manager.grassField.isStreamSettled();attempt++) await renderFrames(60,1/60);
              if(!manager.grassField.isStreamSettled()) throw new Error('Unsettled ivy profile grass stream');
              const armCount=balanced?24:6;
              const frameCount=balanced?60:360;
              for(let arm=0;arm<armCount;arm++) {
                const corrected=balanced?[false,true,true,false][arm%4]:arm%2===1;
                ivy.mesh.material.normalNode=corrected?vertexNormal:originalNormal;
                ivy.mesh.material.needsUpdate=true;
                await renderFrames(balanced?8:60);
                const samples=[];
                let last;
                for(let frame=0;frame<frameCount;frame++) {
                  const time=await new Promise(requestAnimationFrame);
                  const start=performance.now();
                  const handle=gpu.beginFrame(time);
                  manager.render(0,orbitDistance);
                  gpu.endFrame(handle);
                  if(last!==undefined) samples.push({time,frameMs:time-last,cpuMs:performance.now()-start});
                  last=time;
                }
                await manager.waitForSubmittedWork();
                await new Promise(requestAnimationFrame);
                for(const sample of samples) sample.gpuMs=gpu.getFrameTiming(sample.time).durationMs;
                const result={distance,arm,corrected,samples,gpuMs:summarize(samples.map(s=>s.gpuMs)),
                  frameMs:summarize(samples.map(s=>s.frameMs)),cpuMs:summarize(samples.map(s=>s.cpuMs)),
                  renderer:manager.getPerformanceStats(),residents:ivy.mesh.count};
                profiles.push(result);
                images[`distance-${distance}-${corrected?'corrected':'original'}`]=manager.renderer.domElement.toDataURL('image/png');
                console.log('[ivy-review]',JSON.stringify({distance,arm,corrected,gpuMs:result.gpuMs,renderer:result.renderer}));
              }
            }
            gpuEvidence=gpu.getEvidence();
          } finally { gpu.dispose(); }
          ivy.mesh.material.normalNode=vertexNormal;
          ivy.mesh.material.needsUpdate=true;
          orbitDistance=12;
          manager.camera.position.copy(manager.cameraTarget).addScaledVector(direction,orbitDistance);
          manager.camera.lookAt(manager.cameraTarget);
          manager.camera.updateMatrixWorld(true);
          // The existing fixture owns weather, snow, clock and wind settings.
          for(const preset of ['rain','winter','daylight']) {
            await window.__ENVIRONMENT_GAUNTLET__.setConditions(preset);
            await renderFrames(180,1/60);
            await manager.waitForSubmittedWork();
            images[`corrected-${preset}`]=manager.renderer.domElement.toDataURL('image/png');
          }
          // Maximum authored wind: capture multiple phases without changing
          // roots, hinge amplitudes, streaming or distance fades.
          const { windStrength } = await import('/vendor/seedthree/src/core/wind.js');
          windStrength.value=1;
          try {
            for(let phase=0;phase<4;phase++) {
              await renderFrames(30,1/60);
              await manager.waitForSubmittedWork();
              images[`corrected-wind-${phase}`]=manager.renderer.domElement.toDataURL('image/png');
            }
          } finally { windStrength.value=0; }
        }
      } finally {
        tint.array.set(original); tint.needsUpdate = true;
        ivy.mesh.material.normalNode = originalNormal;
        ivy.mesh.material.needsUpdate = true;
        manager.setLightingDiagnostic('final');
      }
      return { placement, images, evidence, shaders, profiles, gpuEvidence, adapter:manager.getRendererAdapterEvidence(), receiveShadow: ivy.mesh.receiveShadow,
        castShadow: ivy.mesh.castShadow, shadowPolicy: ivy.mesh.userData.groundCoverShadowPolicy,
        residents: ivy.mesh.count, textureColorSpace: ivy.textures.albedo.colorSpace };
    }, { normalTrial: process.argv.includes('--normal'), profile: process.argv.includes('--profile'), installed:process.argv.includes('--installed'), balanced:process.argv.includes('--balanced') });
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
