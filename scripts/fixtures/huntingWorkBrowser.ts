// Let Vite resolve the same Three.js and TSL module instances used by the game.
// Importing raw build URLs in a page creates a second node-material registry.
export * as THREE from 'three';
export { WebGPURenderer } from 'three/webgpu';
