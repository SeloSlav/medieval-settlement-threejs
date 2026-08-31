import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  applyBuildingMaterialAtlas,
  applyBuildingMaterialAtlasDirectUv,
  type BuildingAtlasMaterial,
  type BuildingMaterialAtlasTile,
} from './buildingMaterialAtlas.ts';

const GORSKI_KIT_ATLAS_TILE_BY_MATERIAL_KEY: Readonly<
  Partial<Record<string, BuildingMaterialAtlasTile>>
> = Object.freeze({
  limestone_warm: 'limestone-ashlar',
  fieldstone: 'fieldstone-mortar',
  quarry_stone: 'quarry-stone',
  limewash: 'lime-plaster',
  limewash_faded: 'lime-plaster',
  limewash_damp: 'lime-plaster',
  limewash_ochre: 'lime-plaster',
  limewash_grey: 'lime-plaster',
  plaster_inside: 'lime-plaster',
  oak_dark: 'rough-hewn-timber',
  timber_cut: 'rough-hewn-timber',
  timber_weathered: 'weathered-planks',
  devotional_blue: 'sawn-planks',
  shingles: 'split-shingles',
  shingles_aged: 'split-shingles',
  shingles_light: 'split-shingles',
  terracotta: 'clay-roof-tiles',
  terracotta_dark: 'clay-roof-tiles',
  terracotta_worn: 'clay-roof-tiles',
  thatch: 'thatch-roof',
  thatch_dark: 'thatch-roof',
  thatch_light: 'thatch-roof',
  straw_dry: 'thatch-roof',
  iron: 'wrought-iron',
  brass: 'aged-brass',
  icon_gold: 'aged-brass',
  earth: 'packed-earth',
  charcoal: 'packed-earth',
  clay: 'fired-clay',
  canvas: 'linen-canvas',
  canvas_red: 'linen-canvas',
  rope: 'wicker-weave',
});

/**
 * Converts Blender-authored Gorski architecture materials into the game's
 * shared node-material and atlas contracts. This is intentionally independent
 * of every model URL, source-scene cache, and runtime building semantic so QA
 * component lineups do not import the legacy finished-building GLB loader.
 */
export function prepareGorskiArchitectureSourceScene(
  scene: THREE.Group,
  maxAnisotropy: number,
): void {
  const preparedMaterials = new Map<THREE.Material, THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sourceMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    normalizeAuthoredMetricUvs(mesh, sourceMaterials);
    const materials = sourceMaterials.map((material) => {
      const cached = preparedMaterials.get(material);
      if (cached) return cached;
      const prepared = prepareMaterial(material, maxAnisotropy);
      preparedMaterials.set(material, prepared);
      return prepared;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function prepareMaterial(
  source: THREE.Material,
  maxAnisotropy: number,
): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source;
  const atlasId = source.userData.atlas_id as string | undefined;
  const kitMaterialKey = source.userData.gk_material_key as string | undefined;
  const kitAtlasTile = kitMaterialKey
    ? GORSKI_KIT_ATLAS_TILE_BY_MATERIAL_KEY[kitMaterialKey]
    : undefined;
  const material = createNodeMaterialFromSource(source);
  material.userData.sharedBuildingMaterial = true;
  if (atlasId === 'gorski-building-atlas-v1') {
    const tile = source.userData.atlas_tile as BuildingMaterialAtlasTile;
    const authoredTint = readAuthoredAtlasTint(source);
    const weatheringProfile = readAuthoredWeatheringProfile(source);
    material.color.copy(authoredTint.color);
    material.roughness = authoredRoughness(tile);
    material.metalness = tile === 'wrought-iron' ? 0.68 : 0;
    if (source.userData.atlas_uv_mode === 'final tile coordinates baked into GK_UV0') {
      applyBuildingMaterialAtlasDirectUv(material, {
        tile,
        tintStrength: authoredTint.strength,
        normalStrength: authoredTint.normalStrength,
        weatheringProfile,
      });
    } else {
      applyBuildingMaterialAtlas(material, {
        tile,
        tintStrength: authoredTint.strength,
        normalStrength: authoredTint.normalStrength,
        weatheringProfile,
      });
    }
  } else if (kitAtlasTile) {
    // Reusable component GLBs carry metric GK_UV0 coordinates and a semantic
    // material key. The game owns the PBR atlas, so no texture is duplicated
    // in any family bundle.
    material.userData.gorskiArchitectureKitMaterial = kitMaterialKey;
    material.roughness = source.roughness;
    material.metalness = source.metalness;
    applyBuildingMaterialAtlas(material, {
      tile: kitAtlasTile,
      tintStrength: 0.24,
      normalStrength: kitAtlasTile === 'wrought-iron' ? 0.42 : 0.78,
    });
  } else if (kitMaterialKey) {
    // Optical and specialty surfaces without a truthful atlas cell retain the
    // Blender-authored scalar contract. In particular, do not turn water or
    // glass into a generic rough camp fabric merely to force atlas coverage.
    material.userData.gorskiArchitectureKitMaterial = kitMaterialKey;
    material.roughness = source.roughness;
    material.metalness = source.metalness;
  } else {
    // Canvas and stitched hide keep their dedicated authored albedo/normal.
    // Their packed map uses the game's R/G/B contract rather than glTF's G/B
    // metallic-roughness convention, so scalar values are deliberately used.
    const surfaceTint = readAuthoredSurfaceTint(source);
    if (surfaceTint) material.color.copy(surfaceTint);
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.aoMap = null;
    material.roughness = atlasId === 'gorski-camp-canvas-v1' ? 0.97 : 0.94;
    material.metalness = 0;
    for (const texture of [material.map, material.normalMap]) {
      if (texture) texture.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
    }
  }
  material.needsUpdate = true;
  return material;
}

function readAuthoredSurfaceTint(source: THREE.MeshStandardMaterial): THREE.Color | null {
  const encoded = source.userData.surface_tint;
  if (
    !Array.isArray(encoded)
    || encoded.length < 3
    || !encoded.slice(0, 3).every((channel) => Number.isFinite(Number(channel)))
  ) {
    return null;
  }
  return new THREE.Color().setRGB(
    Number(encoded[0]),
    Number(encoded[1]),
    Number(encoded[2]),
  );
}

function readAuthoredWeatheringProfile(
  source: THREE.MeshStandardMaterial,
): 'tier1-daub' | 'tier1-fieldstone' | undefined {
  const profile = source.userData.weathering_profile;
  return profile === 'tier1-daub' || profile === 'tier1-fieldstone'
    ? profile
    : undefined;
}

function readAuthoredAtlasTint(source: THREE.MeshStandardMaterial): {
  color: THREE.Color;
  strength: number;
  normalStrength: number;
} {
  const encoded = source.userData.atlas_tint;
  const color = source.color.clone();
  if (
    Array.isArray(encoded)
    && encoded.length >= 3
    && encoded.slice(0, 3).every((channel) => Number.isFinite(Number(channel)))
  ) {
    color.setRGB(Number(encoded[0]), Number(encoded[1]), Number(encoded[2]));
  }
  const strength = Number(source.userData.atlas_tint_strength);
  const normalStrength = Number(source.userData.atlas_normal_strength);
  return {
    color,
    strength: Number.isFinite(strength) ? THREE.MathUtils.clamp(strength, 0, 1) : 0,
    normalStrength: Number.isFinite(normalStrength) ? Math.max(0, normalStrength) : 0.82,
  };
}

function createNodeMaterialFromSource(
  source: THREE.MeshStandardMaterial,
): BuildingAtlasMaterial {
  const material = new MeshStandardNodeMaterial() as BuildingAtlasMaterial;
  material.name = source.name;
  material.color.copy(source.color);
  material.emissive.copy(source.emissive);
  material.emissiveIntensity = source.emissiveIntensity;
  material.roughness = source.roughness;
  material.metalness = source.metalness;
  material.map = source.map;
  material.normalMap = source.normalMap;
  material.emissiveMap = source.emissiveMap;
  material.alphaMap = source.alphaMap;
  material.normalScale.copy(source.normalScale);
  material.opacity = source.opacity;
  material.transparent = source.transparent;
  material.alphaTest = source.alphaTest;
  material.side = source.side;
  material.depthTest = source.depthTest;
  material.depthWrite = source.depthWrite;
  material.vertexColors = source.vertexColors;
  material.userData = { ...source.userData };
  return material;
}

function normalizeAuthoredMetricUvs(
  mesh: THREE.Mesh,
  materials: THREE.Material[],
): void {
  if (materials.length !== 1) return;
  const material = materials[0];
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  if (material.userData.atlas_id !== 'gorski-building-atlas-v1') return;
  if (material.userData.atlas_uv_mode === 'final tile coordinates baked into GK_UV0') return;
  const metres = Number(material.userData.metres_per_tile);
  const sourceUv = mesh.geometry.getAttribute('uv');
  if (!(sourceUv instanceof THREE.BufferAttribute) || !(metres > 0)) return;
  mesh.geometry = mesh.geometry.clone();
  const uv = sourceUv.clone();
  const rotate = material.userData.uv_orientation === 'horizontal-board rotation';
  for (let index = 0; index < uv.count; index += 1) {
    const u = sourceUv.getX(index) / metres;
    const v = sourceUv.getY(index) / metres;
    uv.setXY(index, rotate ? v : u, rotate ? u : v);
  }
  uv.needsUpdate = true;
  mesh.geometry.setAttribute('uv', uv);
}

function authoredRoughness(tile: unknown): number {
  if (tile === 'wrought-iron') return 0.58;
  if (tile === 'split-shingles') return 0.99;
  if (tile === 'lime-plaster' || tile === 'fieldstone-mortar') return 0.97;
  return 0.94;
}
