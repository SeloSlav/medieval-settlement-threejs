import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

type CompileStateRenderer = Pick<WebGPURenderer,
  'getRenderTarget' | 'setRenderTarget' | 'getMRT' | 'setMRT'
  | 'toneMapping' | 'outputColorSpace'>;
type CompilePass = {
  renderTarget: ReturnType<CompileStateRenderer['getRenderTarget']>;
  getMRT(): ReturnType<CompileStateRenderer['getMRT']>;
};

/** Match RenderPipeline + PassNode, not the canvas's display-output variant. */
export async function withScenePassCompileState(
  renderer: CompileStateRenderer,
  pass: CompilePass,
  compile: () => Promise<void>,
): Promise<void> {
  const target = renderer.getRenderTarget();
  const mrt = renderer.getMRT();
  const toneMapping = renderer.toneMapping;
  const outputColorSpace = renderer.outputColorSpace;
  try {
    renderer.setRenderTarget(pass.renderTarget);
    renderer.setMRT(pass.getMRT());
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
    await compile();
  } finally {
    renderer.setRenderTarget(target);
    renderer.setMRT(mrt);
    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;
  }
}
