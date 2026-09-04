import * as THREE from 'three';
// Three's WebGPURenderer declarations omit these common Renderer methods.
export type CompileStateRenderer = {
  getRenderTarget(): THREE.RenderTarget | null;
  setRenderTarget(target: THREE.RenderTarget | null): void;
  getMRT(): unknown;
  setMRT(mrt: unknown): void;
  toneMapping: THREE.ToneMapping;
  outputColorSpace: string;
  _callDepth: number;
  _renderContexts: {
    get(target?: THREE.RenderTarget | null, mrt?: unknown, callDepth?: number): unknown;
  };
};
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
  const callDepth = renderer._callDepth;
  const contexts = renderer._renderContexts;
  const getContext = contexts.get;
  // Three 0.185's compileAsync omits callDepth when requesting a context.
  // RenderObject includes context.id in its shader cache key, so matching
  // only MRT/formats still recompiles every shader at the nested live pass.
  // The output quad renders at depth 0, this scene pass at 1, its shadows at 2.
  if (callDepth !== -1) throw new Error('Startup compilation requires an idle renderer');
  try {
    renderer._callDepth = 1;
    contexts.get = function (target, mrt, depth) {
      return getContext.call(this, target, mrt,
        depth === undefined && target === pass.renderTarget ? 1 : depth);
    };
    renderer.setRenderTarget(pass.renderTarget);
    renderer.setMRT(pass.getMRT());
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
    await compile();
  } finally {
    contexts.get = getContext;
    renderer._callDepth = callDepth;
    renderer.setRenderTarget(target);
    renderer.setMRT(mrt);
    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;
  }
}
