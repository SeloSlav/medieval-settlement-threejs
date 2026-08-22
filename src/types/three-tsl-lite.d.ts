declare module 'three/tsl' {
  import type * as THREE from 'three';

  type ComputeNode = import('three/webgpu').ComputeNode;

  export const Fn: (
    callback: (...params: any[]) => any,
  ) => ((...params: any[]) => {
    compute(count: number, workgroupSize?: number[]): ComputeNode;
  });
  export const int: (value: any) => any;
  export const cameraFar: any;
  export const cameraNear: any;
  export const ivec2: (x: any, y?: any) => any;
  export const instanceIndex: any;
  export const round: (value: any) => any;
  export const smoothstep: (edge0: any, edge1: any, value: any) => any;
  export const textureLoad: (texture: THREE.Texture, coord: any) => any;
  export const textureStore: (
    texture: import('three/webgpu').StorageTexture,
    coord: any,
    value: any,
  ) => { toWriteOnly(): any };
  export const linearDepth: (value?: any) => any;
  export const viewportDepthTexture: (uv?: any) => any;

  export const abs: (value: unknown) => unknown;
  export const cameraPosition: unknown;
  export const cameraViewMatrix: unknown;
  export const dot: (a: unknown, b: unknown) => unknown;
  export const exp: (value: unknown) => unknown;
  export const floor: (value: unknown) => unknown;
  export const fract: (value: unknown) => unknown;
  export const modelWorldMatrix: unknown;
  export const positionLocal: unknown;
  export const positionGeometry: unknown;
  export const sin: (value: unknown) => unknown;
  export const time: unknown;
  export const normalView: unknown;
  export const normalWorldGeometry: unknown;
  export const normalize: (value: unknown) => unknown;
  export const positionWorld: unknown;
  export const screenSize: unknown;
  export const screenUV: unknown;
  export const sub: (a: unknown, b: unknown) => unknown;
  export const viewportSafeUV: (uv?: unknown) => unknown;
  export const viewportSharedTexture: (uv?: unknown) => unknown;

  export function pass(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ): {
    dispose(): void;
    getTextureNode(name?: string): {
      add(value: unknown): unknown;
    };
  };

  export function uniform<T>(value: T): { value: T };
  export function uv(): unknown;
  export function wgslFn(code: string, includes?: unknown[]): (params: Record<string, unknown>) => unknown;
  export function sub(a: unknown, b: unknown): unknown;
  export function texture(texture: THREE.Texture, uvNode?: unknown): unknown;
  export function attribute(name: string, type: string): unknown;
  export function vertexColor(index?: number): unknown;
  export function normalMap(node: unknown, scaleNode?: unknown): unknown;
  export function bumpMap(node: unknown, scaleNode?: unknown): unknown;
  export function float(value: number): unknown;
  export function max(a: unknown, b: unknown): unknown;
  export function mix(a: unknown, b: unknown, t: unknown): unknown;
  export function vec2(x: unknown, y?: unknown): unknown;
  export function vec3(x: unknown, y?: unknown, z?: unknown): unknown;
  export function vec4(x: unknown, y?: unknown, z?: unknown, w?: unknown): unknown;
  export const fwidth: (value: unknown) => unknown;
}
