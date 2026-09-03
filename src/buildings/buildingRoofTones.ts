import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { hashStringSeed } from '../utils/random.ts';

export type BuildingRoofTone = 'earth-brown' | 'smoke-brown' | 'mossed-brown';
type RoofTint = readonly [number, number, number];

export const ROOF_TONE_VARIANTS: readonly BuildingRoofTone[] = [
  'earth-brown',
  'earth-brown',
  'smoke-brown',
  'mossed-brown',
];

// Shared with residence tiers 1–3 and tier 4 respectively. These multiply the
// weathered vertex colours, preserving the shared atlas and material batches.
export const SHINGLE_TONE_TINTS: Record<BuildingRoofTone, RoofTint> = {
  'earth-brown': [0.8, 0.68, 0.53],
  'smoke-brown': [0.66, 0.58, 0.5],
  'mossed-brown': [0.69, 0.67, 0.5],
};

export const FIRED_CLAY_TONE_TINTS: Record<BuildingRoofTone, RoofTint> = {
  'earth-brown': [0.6, 0.38, 0.25],
  'smoke-brown': [0.48, 0.3, 0.24],
  'mossed-brown': [0.54, 0.35, 0.23],
};

export function applyRoofToneTint(geometry: THREE.BufferGeometry, tint: RoofTint): void {
  const colors = geometry.getAttribute('color');
  if (!colors) return;
  for (let index = 0; index < colors.count; index += 1) {
    colors.setXYZ(
      index,
      colors.getX(index) * tint[0],
      colors.getY(index) * tint[1],
      colors.getZ(index) * tint[2],
    );
  }
  colors.needsUpdate = true;
}

/** Apply residence roof colours before placeable buildings are batched. */
export function applyBuildingRoofTones(
  root: THREE.Group,
  kind: BuildingKind,
  seed: number,
): void {
  // The canonical seed is shared by all placeables, so include the kind to
  // distribute the residence variations while keeping previews consistent.
  const shingleTone = ROOF_TONE_VARIANTS[
    hashStringSeed(`${kind}:${seed}`) % ROOF_TONE_VARIANTS.length
  ]!;
  const tintedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const key = object.material.userData.buildingMaterialKey;
    if (key !== 'shingle' && key !== 'clayRed' && key !== 'clayDark') return;
    const tone = key !== 'shingle' && (kind === 'chapel' || kind === 'monastery')
      ? 'smoke-brown'
      : shingleTone;
    const tint = key === 'shingle' ? SHINGLE_TONE_TINTS[tone] : FIRED_CLAY_TONE_TINTS[tone];
    if (!tintedGeometries.has(object.geometry)) {
      applyRoofToneTint(object.geometry, tint);
      tintedGeometries.add(object.geometry);
      object.geometry.userData.buildingRoofTone = tone;
      object.geometry.userData.buildingRoofToneTint = [...tint];
    }
    object.userData.buildingRoofTone = tone;
  });
}
