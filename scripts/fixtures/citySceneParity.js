/** Compare the real world's compacted draws with their unchanged canonical data. */
export async function checkCitySceneParity() {
  const { THREE } = await import('./webgpuTestImports.ts');
  const app = window.__cityApp, manager = app.sceneManager, renderer = manager.renderer;
  const loop = renderer.getAnimationLoop(); await renderer.setAnimationLoop(null);
  const camera = manager.camera, position = camera.position.clone(), quaternion = camera.quaternion.clone();
  const sources = [];
  manager.scene.traverse(source => {
    if (!source.userData.instanceCompactionSource) return;
    const draw = source.children.find(child => child.userData.instanceCompactionDraw);
    sources.push({ source, draw, layers: draw.layers.mask, visible: draw.visible });
  });
  if (!sources.length) throw new Error('Full-scene parity requires the real forest compactions');
  const target = new THREE.RenderTarget(640, 360), savedTarget = renderer.getRenderTarget(), savedMrt = renderer.getMRT();
  const frames = [];
  const terrainIndex = manager.terrain.mesh.geometry.index, optimizedTerrain = terrainIndex.array.slice();
  const rowMajorTerrain = new terrainIndex.array.constructor(terrainIndex.count), resolution = manager.terrain.resolution;
  let indexOffset = 0;
  for(let z=0;z<resolution-1;z++)for(let x=0;x<resolution-1;x++) {
    const a=z*resolution+x,b=a+1,c=a+resolution,d=c+1;
    rowMajorTerrain.set([a,c,b,b,c,d],indexOffset);indexOffset+=6;
  }
  const render = async compact => {
    for (const {source, draw, layers, visible} of sources) { source.layers.mask = compact ? 0 : layers; draw.visible = compact && visible; }
    terrainIndex.array.set(compact ? optimizedTerrain : rowMajorTerrain);terrainIndex.needsUpdate=true;
    renderer.setMRT(null); renderer.setRenderTarget(target);
    // Freeze simulation and shader time, but advance the render-frame identity
    // so FRAME update nodes and shadow refreshes execute for each comparison.
    renderer._nodes.nodeFrame.frameId++;
    manager.sunLight.shadow.needsUpdate = true;
    manager.scene.updateMatrixWorld(); renderer.render(manager.scene, camera);
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, 640, 360);
  };
  try {
    for (let view = 0; view < 6; view++) {
      const angle = .7 + view * Math.PI / 3;
      camera.position.set(Math.sin(angle) * 200, 160, Math.cos(angle) * 200);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      await render(true); await render(false);
      const actual = await render(true), expected = await render(false);
      let changedPixels = 0, maximumRgbError = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const error = Math.abs(actual[i] - expected[i]) + Math.abs(actual[i + 1] - expected[i + 1]) + Math.abs(actual[i + 2] - expected[i + 2]);
        maximumRgbError = Math.max(maximumRgbError, error); if (error > 12) changedPixels++;
      }
      const frame = {view,compactedMeshes:sources.length,changedPixels,maximumRgbError,totalPixels:640*360};
      if(changedPixels>150) {
        const encode = data => {const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),640,360),0,0);return c.toDataURL();};
        frame.images={actual:encode(actual),expected:encode(expected)};
      }
      frames.push(frame);
    }
    return frames;
  } finally {
    for (const {source, draw, visible} of sources) { source.layers.mask = 0; draw.visible = visible; }
    terrainIndex.array.set(optimizedTerrain);terrainIndex.needsUpdate=true;
    camera.position.copy(position); camera.quaternion.copy(quaternion); camera.updateMatrixWorld(true);
    renderer.setRenderTarget(savedTarget); renderer.setMRT(savedMrt); target.dispose();
    await renderer.setAnimationLoop(loop);
  }
}
