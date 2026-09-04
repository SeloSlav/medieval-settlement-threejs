// @ts-nocheck -- Opt-in diagnostics, injected only by camp-placement-debug-server.
import * as THREE from 'three';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BanditCampRenderer } from '../security/BanditCampRenderer.ts';
import { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import { createVisualGpuTimestampProfiler } from './webGpuTimestampProfiler.ts';

export function installFireTransitionControls(app, controls, record, setPhase) {
  const parity = document.createElement('button');
  parity.textContent = 'Verify light pixels';
  controls.append(parity);
  parity.onclick = async () => {
    if (parity.disabled) return;
    parity.disabled = true;
    parity.textContent = 'Comparing light pixels…';
    try {
      const { verifyFireLightingPixels } = await import('./fireLightingParityProbe.ts');
      await verifyFireLightingPixels(app.sceneManager.renderer.backend.device, record);
      parity.textContent = 'Light pixels match';
    } catch (error) {
      record('fire-pixel-error', { message: String(error), stack: error?.stack });
      parity.textContent = 'Light pixel test FAILED';
    }
  };
  const button = document.createElement('button');
  button.textContent = 'Test fire transitions';
  controls.append(button);
  button.onclick = async () => {
    const camp = [...app.gameState.buildings.values()].find(b => b.kind === 'founders_camp');
    if (!camp || button.disabled) return;
    button.disabled = true;
    const manager = app.sceneManager;
    const renderer = manager.renderer;
    const gpu = createVisualGpuTimestampProfiler({ kind: 'webgpu', renderer });
    const timedFrames = [];
    let phase = 'warmup';
    const originalRender = manager.render;
    manager.render = function (...args) {
      const start = performance.now();
      const handle = gpu.beginFrame(start);
      try { return originalRender.apply(this, args); }
      finally {
        gpu.endFrame(handle);
        timedFrames.push({ phase, t: start, cpuMs: performance.now() - start });
      }
    };
    const root = new THREE.Group();
    root.name = 'Isolated fire lifecycle test';
    manager.scene.add(root);
    const markers = new BuildingMarkers({ terrain: manager.terrain, parent: root });
    const bandits = new BanditCampRenderer(manager.terrain, root);
    const disasters = new FireEffectsRenderer(manager.terrain, root);
    const hunter = { ...camp, id: 'probe-hunter', kind: 'hunters_hall', x: camp.x + 17, z: camp.z, assignedLabor: 1 };
    const bandit = { id: 'probe-bandit-1', x: camp.x - 18, z: camp.z, active: true, health: 100, maxHealth: 100 };
    const incident = { id: 'probe-incident', targetKind: 'building', targetId: hunter.id,
      x: camp.x, z: camp.z + 18, status: 'burning', intensity: 0.8, damage: 0.1 };
    const extraCamp = { ...camp, id: 'probe-extra-camp', x: camp.x, z: camp.z - 24 };
    const syncIncident = status => disasters.syncIncidents([{ ...incident, status }], new Map(), new Map());
    const frames = async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
    const sample = async (name, change) => {
      phase = name;
      setPhase(name);
      const start = performance.now();
      record('fire-phase-start', { phase: name });
      change();
      // These isolated renderers aren't owned by App's regular animation loop.
      // In production this tick relights a reactivated incident next frame.
      disasters.tick(0);
      const changeMs = performance.now() - start;
      await frames(2);
      const submittedMs = performance.now() - start;
      await renderer.backend.device.queue.onSubmittedWorkDone();
      const fenceMs = performance.now() - start;
      await frames(10);
      const data = renderer.lighting.getNode(manager.scene).data;
      record('fire-phase-complete', { phase: name, changeMs, submittedMs, fenceMs,
        activeLights: data.count, lightBufferBytes: data.attribute.array.byteLength,
        stats: manager.getPerformanceStats() });
      setPhase(null);
    };
    try {
      record('fire-test-manifest', { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
        camera: manager.camera.matrixWorld.toArray(), projection: manager.camera.projectionMatrix.toArray(),
        adapter: manager.getRendererAdapterEvidence() });
      button.textContent = 'Warming test models…';
      // Compile model/VFX variants before timing lighting-only transitions.
      // No server reducers are called; these are disposable local visuals.
      markers.syncBuildings([hunter, extraCamp]);
      bandits.sync([bandit]);
      syncIncident('burning');
      await frames(30);
      await renderer.backend.device.queue.onSubmittedWorkDone();
      button.textContent = 'Measuring fires…';
      await sample('hunter-unassign', () => markers.syncBuildings([{ ...hunter, assignedLabor: 0 }, extraCamp]));
      await sample('hunter-assign', () => markers.syncBuildings([hunter, extraCamp]));
      await sample('bandit-destroy', () => bandits.sync([]));
      await sample('bandit-respawn', () => bandits.sync([bandit]));
      await sample('structural-extinguish', () => syncIncident('extinguished'));
      await sample('structural-relight', () => syncIncident('burning'));
      await sample('founder-pack', () => markers.syncBuildings([hunter, { ...extraCamp, foundingShelterActive: false }]));
      await sample('founder-unpack', () => markers.syncBuildings([hunter, extraCamp]));
      const stress = new THREE.Group();
      for (let i = 0; i < 257; i++) {
        const light = new THREE.PointLight(0xff7430, 0.05, 23, 1.7);
        light.userData.runtimeFireLight = true;
        light.position.set(camp.x + Math.sin(i) * 12, manager.terrain.getHeightAt(camp.x, camp.z) + 1, camp.z + Math.cos(i) * 12);
        stress.add(light);
      }
      await sample('stress-257-grow', () => root.add(stress));
      await sample('stress-257-remove', () => stress.removeFromParent());
      await sample('all-test-fires-remove', () => {
        markers.dispose(); bandits.dispose(); disasters.dispose(); root.removeFromParent();
      });
      record('fire-test-complete');
      button.textContent = 'Fire tests complete';
    } catch (error) {
      record('fire-test-error', { message: String(error), stack: error?.stack });
      button.textContent = 'Fire test FAILED';
    } finally {
      manager.render = originalRender;
      await renderer.backend.device.queue.onSubmittedWorkDone();
      record('fire-gpu-timings', { evidence: gpu.getEvidence(), frames: timedFrames.map(frame => ({
        ...frame, gpu: gpu.getFrameTiming(frame.t),
      })) });
      gpu.dispose();
      setPhase(null);
      root.removeFromParent();
    }
  };
}
