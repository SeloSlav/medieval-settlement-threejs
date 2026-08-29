import * as THREE from 'three';

/**
 * A restrained albedo-matched fill for the texture-baked villager asset.
 *
 * The worker GLB has no normal/AO/roughness maps and its color texture already
 * contains deep painted values. Reusing that texture as a low-energy emissive
 * map restores broad outdoor bounce without lifting terrain exposure or
 * replacing the model's authored color separation with a flat white wash.
 */
export const VILLAGER_ALBEDO_BOUNCE_INTENSITY = 0.18;

export function configureVillagerMaterialLighting(
  material: THREE.MeshStandardMaterial,
): void {
  material.roughness = 0.9;
  material.metalness = 0;
  material.emissiveMap = material.map;
  material.emissive.copy(material.map ? WHITE_BOUNCE : material.color);
  material.emissiveIntensity = VILLAGER_ALBEDO_BOUNCE_INTENSITY;
  material.userData.villagerAlbedoBounce = true;
  material.needsUpdate = true;
}

const WHITE_BOUNCE = new THREE.Color(0xffffff);
