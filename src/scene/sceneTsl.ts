import * as TSL from 'three/tsl';

// This project intentionally uses a small three/tsl ambient declaration. Keep
// the extra r185 runtime surface used by the lighting graph typed locally.
export type SceneNode = {
  x: SceneNode; y: SceneNode; z: SceneNode; r: SceneNode; a: SceneNode; rgb: SceneNode;
  add(...v: unknown[]): SceneNode; sub(...v: unknown[]): SceneNode;
  mul(...v: unknown[]): SceneNode; div(...v: unknown[]): SceneNode;
  negate(): SceneNode; exp(): SceneNode; oneMinus(): SceneNode;
  clamp(low: unknown, high: unknown): SceneNode; sample(uv: unknown): SceneNode;
};
type NodeFunction = (...args: unknown[]) => SceneNode;
export const sceneTsl = TSL as unknown as {
  cameraPosition: SceneNode; positionWorld: SceneNode; normalWorld: SceneNode;
  normalView: SceneNode; diffuseColor: SceneNode; materialAO: SceneNode; output: SceneNode;
  float: NodeFunction; vec3: NodeFunction; vec4: NodeFunction; exp: NodeFunction;
  distance: NodeFunction; max: NodeFunction; min: NodeFunction; mix: NodeFunction;
  smoothstep: NodeFunction; fog: NodeFunction; reference: NodeFunction;
  mrt: NodeFunction; renderOutput: NodeFunction;
  uniform<T>(value: T): SceneNode & { value: T };
  Fn(callback: (args: SceneNode[], builder: { material: unknown }) => SceneNode): () => SceneNode;
};
