declare module 'three/examples/jsm/tsl/display/BloomNode.js' {
  export default class BloomNode {
    readonly radius: unknown;
    readonly strength: unknown;
    constructor(inputNode: unknown, strength?: number, radius?: number, threshold?: number);
    dispose(): void;
    setSize(width: number, height: number): void;
  }

  export function bloom(inputNode: unknown, strength?: number, radius?: number, threshold?: number): {
    dispose(): void;
  };
}
