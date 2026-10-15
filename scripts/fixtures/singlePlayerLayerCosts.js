/** Render-submission diagnostics, AFTER ordinary FPS cohorts. Live simulation
 * and CPU updates remain enabled. Hidden roots are never a shipping setting. */
export async function measureSinglePlayerLayerCosts(app) {
  const m = app.sceneManager, forest = m.getForestManager();
  const roots = { forest: forest.group, grass: m.grassField?.group,
    buildings: app.buildingMarkers.group, homes: app.residenceMarkers.root,
    gardens: app.backyardGardenMarkers.root };
  if (!roots.forest || !roots.buildings || !roots.homes) throw Error('Layer roots missing');
  const visibility = new Map(Object.values(roots).filter(Boolean).map(root => [root, root.visible]));
  const parents = new Map(Object.values(roots).filter(Boolean).map(root => [root, { parent: root.parent, index: root.parent?.children.indexOf(root) }]));
  const shadowAutoUpdate = m.sunLight.shadow.autoUpdate;
  const baseRender = m.render;
  const baseRendererRender = m.renderer.render;
  let hidden = [], noShadows = false;
  m.render = function (...args) {
    for (const [key, root] of Object.entries(roots)) {
      if (!root) continue;
      const origin = parents.get(root);
      if (hidden.includes(key)) root.removeFromParent();
      else if (root.parent !== origin.parent && origin.parent) origin.parent.add(root);
      root.visible = visibility.get(root);
    }
    return baseRender.apply(this, args);
  };
  // Preserve the live shadow texture and its TSL bindings. Turning castShadow
  // off disposes a map still referenced by the authored lighting nodes.
  m.renderer.render = function (...args) {
    if (noShadows) { m.sunLight.shadow.autoUpdate = false; m.sunLight.shadow.needsUpdate = false; }
    else m.sunLight.shadow.autoUpdate = shadowAutoUpdate;
    return baseRendererRender.apply(this, args);
  };
  const arms = [
    ['baseline-before', [], false],
    ['gardens-detached', ['gardens'], false],
    ['baseline-after-gardens', [], false],
    ['forest-off', ['forest'], false],
    ['baseline-after-forest', [], false],
    ['shadow-refresh-frozen', [], true],
    ['baseline-after-shadows', [], false],
    ['buildings-homes-off', ['buildings', 'homes'], false],
    ['baseline-after-buildings', [], false],
    ['forest-grass-gardens-detached-shadow-frozen', ['forest', 'grass', 'gardens'], true],
    ['baseline-restored', [], false],
  ];
  const rows = [];
  try {
    for (const [arm, off, offShadows] of arms) {
      hidden = off; noShadows = offShadows;
      m.refreshShadowMap('renderer-state');
      await window.__spLayerProgress?.({ arm, phase: 'warm' });
      await new Promise(resolve => setTimeout(resolve, 4000));
      const samples = [], start = performance.now();
      let previous = await new Promise(requestAnimationFrame);
      const tickBefore = app.gameState.tick;
      while (performance.now() - start < 8000) {
        const time = await new Promise(requestAnimationFrame);
        samples.push(time - previous); previous = time;
      }
      samples.sort((a, b) => a - b);
      const mean = samples.reduce((n, t) => n + t, 0) / samples.length;
      const row = { arm, hidden: off, shadowsOff: offShadows, frameCount: samples.length,
        meanFrameMs: mean, averageFps: 1000 / mean,
        p95FrameMs: samples[Math.ceil(samples.length * .95) - 1],
        worstFrameMs: samples.at(-1), samples,
        buildings: app.gameState.buildings.size, homes: app.gameState.residences.size,
        population: [...app.gameState.residences.values()].reduce((n, r) => n + r.population, 0),
        tickBefore, tickAfter: app.gameState.tick, render: m.getPerformanceStats(),
        forest: forest.getSeedThreeStructuralStats(),
        forestBreakdown: forest.getSeedThreeProfileBreakdown(),
        applied: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, {visible: root?.visible, attached: !!root?.parent}])),
      };
      for (const name of hidden) if (roots[name]?.parent) throw Error(`Layer ${name} was not detached`);
      rows.push(row);
      await window.__spLayerProgress?.({ arm, meanFrameMs: mean, p95FrameMs: row.p95FrameMs, render: row.render });
    }
    return { note: 'Diagnostic root detachment removes scene traversal and rendering; economy and subsystem updates continue. Forest includes undergrowth/rocks; gardens includes backyard plants and yard animals; buildings/homes excludes gardens/crops/actors. Shadow isolation freezes map refresh while retaining sampled shadows. Costs overlap and are not additive. Repeated baselines expose drift.', rows };
  } finally {
    m.render = baseRender;
    m.renderer.render = baseRendererRender;
    for (const [root, visible] of visibility) {
      const origin = parents.get(root);
      if (origin.parent && root.parent !== origin.parent) origin.parent.add(root);
      root.visible = visible;
    }
    for (const parent of new Set([...parents.values()].map(p=>p.parent).filter(Boolean))) {
      for (const [root, origin] of parents) if (origin.parent === parent) {
        const index=parent.children.indexOf(root); parent.children.splice(index,1); parent.children.splice(origin.index,0,root);
      }
    }
    m.sunLight.shadow.autoUpdate = shadowAutoUpdate;
    m.sunLight.shadow.needsUpdate = true;
  }
}
