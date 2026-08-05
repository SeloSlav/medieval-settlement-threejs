import type { Camera, Object3D, Texture, Vector3 } from 'three';

export type EanpaSkySystem = {
  domes: Object3D[];
  uniforms: Record<string, { value: unknown }>;
  setConstellationVisibility(visibility: number): void;
  setMoonDirection(direction: Vector3): void;
  setSiderealAngle(angle: number): void;
  setSunDirection(direction: Vector3): void;
  update(time: number, camera?: Camera): void;
  dispose(): void;
};

export function makeSkySystem(options?: {
  scene: Object3D;
  textures?: {
    stars?: Texture;
    starBackdrop?: Texture;
    moon?: Texture;
    hdri?: Texture;
  };
  opts?: Record<string, unknown>;
}): Promise<EanpaSkySystem>;
