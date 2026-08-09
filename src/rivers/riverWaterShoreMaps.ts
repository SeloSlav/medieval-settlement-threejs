import * as THREE from 'three';
import type { RiverField } from './RiverField.ts';

export const WATER_CLIP_FEATHER = -0.62;
export const WATER_ALPHA_FEATHER_IN = 0.46;
export const WATER_FOAM_REACH = 1.3;

export type RiverWaterShoreMaps = {
  shoreTexture: THREE.DataTexture;
  originX: number;
  originZ: number;
  invSpanX: number;
  invSpanZ: number;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function computeWaterFeatherAlpha(signed: number): number {
  return smoothstep(
    WATER_CLIP_FEATHER - 0.08,
    WATER_ALPHA_FEATHER_IN + 0.12,
    signed,
  );
}

export function computeWaterFoamBase(foamSigned: number): number {
  return foamSigned >= 0
    ? 1 - smoothstep(0.08, WATER_FOAM_REACH, foamSigned)
    : 1 - smoothstep(-0.24, 0.1, foamSigned);
}

export function encodeFlowComponent(value: number): number {
  return Math.round(Math.max(0, Math.min(255, (value * 0.5 + 0.5) * 255)));
}

export function encodeWaterFlowDirection(
  flow: Readonly<{ dx: number; dz: number }> | null,
): readonly [number, number] {
  // The neutral encoding is meaningful: the material uses vector magnitude to
  // distinguish still/open water from a river current. Its shader supplies the
  // fallback direction only after making that classification.
  return [
    encodeFlowComponent(flow?.dx ?? 0),
    encodeFlowComponent(flow?.dz ?? 0),
  ];
}

export function createRiverWaterShoreMaps(riverField: RiverField): RiverWaterShoreMaps {
  const { resolution, startX, startZ, spanX, spanZ, organicSignedDistance, layout } = riverField;
  const stepX = spanX / (resolution - 1);
  const stepZ = spanZ / (resolution - 1);
  const data = new Uint8Array(resolution * resolution * 4);

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const i = iz * resolution + ix;
      const wx = startX + ix * stepX;
      const wz = startZ + iz * stepZ;
      const foamSigned = organicSignedDistance[i] ?? 0;
      const feather = computeWaterFeatherAlpha(foamSigned);
      const foamBase = Math.min(1, computeWaterFoamBase(foamSigned));
      const flow = layout.sampleFlowDirection(wx, wz);
      const [flowX, flowZ] = encodeWaterFlowDirection(flow);
      const offset = i * 4;
      data[offset] = Math.round(feather * 255);
      data[offset + 1] = Math.round(foamBase * 255);
      data[offset + 2] = flowX;
      data[offset + 3] = flowZ;
    }
  }

  const shoreTexture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  shoreTexture.colorSpace = THREE.NoColorSpace;
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.generateMipmaps = false;
  shoreTexture.needsUpdate = true;

  return {
    shoreTexture,
    originX: startX,
    originZ: startZ,
    invSpanX: 1 / spanX,
    invSpanZ: 1 / spanZ,
  };
}

export function disposeRiverWaterShoreMaps(maps: RiverWaterShoreMaps): void {
  maps.shoreTexture.dispose();
}
