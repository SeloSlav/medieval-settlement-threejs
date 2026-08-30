import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  applyBuildingMaterialAtlas,
  applyBuildingMaterialAtlasDirectUv,
  type BuildingAtlasMaterial,
  type BuildingMaterialAtlasTile,
} from './buildingMaterialAtlas.ts';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  timberMaterial,
} from './buildingMaterials.ts';
import { addTierOneChurchRuntimeClock } from './chapelRuntimeClock.ts';
import { createLumberMillRuntimeStockpile } from './meshes/industryBuildingMeshes.ts';
import {
  addMiningCampRuntimeState,
  applyMiningCampSemanticContract,
} from './meshes/stoneQuarryMesh.ts';
import {
  addLargeQuarryRuntimeState,
  applyLargeQuarrySemanticContract,
} from './meshes/largeQuarryMesh.ts';
import {
  addMineworksRuntimeState,
  applyMineworksSemanticContract,
} from './meshes/mineralMineMesh.ts';

export const TIER_ONE_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/tier1_residence_retopo_v26.glb';
export const TIER_ONE_CHURCH_MODEL_URL =
  '/assets/models/buildings/gorski/tier1_church_delnice_v2.glb';
export const HUNTERS_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/hunters_camp_textured_v10.glb';
export const FISHING_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/fishing_camp_textured_v5.glb';
export const WAYSIDE_SHRINE_MODEL_URL =
  '/assets/models/buildings/gorski/wayside_shrine_textured_v1.glb';
export const LUMBER_MILL_MODEL_URL =
  '/assets/models/buildings/gorski/lumber_mill_textured_v1.glb';
export const MINING_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/mining_camp_textured_v1.glb';
export const LARGE_QUARRY_MODEL_URL =
  '/assets/models/buildings/gorski/large_quarry_textured_v1.glb';
export const MINEWORKS_MODEL_URL =
  '/assets/models/buildings/gorski/mineworks_textured_v1.glb';

type AuthoredArchitectureKey =
  | 'tier-one-residence'
  | 'tier-one-church'
  | 'hunters-camp'
  | 'fishing-camp'
  | 'wayside-shrine'
  | 'lumber-mill'
  | 'mining-camp'
  | 'large-quarry'
  | 'mineworks';

const MODEL_URLS: Record<AuthoredArchitectureKey, string> = {
  'tier-one-residence': TIER_ONE_RESIDENCE_MODEL_URL,
  'tier-one-church': TIER_ONE_CHURCH_MODEL_URL,
  'hunters-camp': HUNTERS_CAMP_MODEL_URL,
  'fishing-camp': FISHING_CAMP_MODEL_URL,
  'wayside-shrine': WAYSIDE_SHRINE_MODEL_URL,
  'lumber-mill': LUMBER_MILL_MODEL_URL,
  'mining-camp': MINING_CAMP_MODEL_URL,
  'large-quarry': LARGE_QUARRY_MODEL_URL,
  mineworks: MINEWORKS_MODEL_URL,
};
const AUTHORED_ARCHITECTURE_MODEL_COUNT = Object.keys(MODEL_URLS).length;

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

const sourceScenes = new Map<AuthoredArchitectureKey, THREE.Group>();
let loadPromise: Promise<void> | null = null;
const invisibleCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false });
invisibleCollisionMaterial.name = 'Invisible authored camp collision material';

/** Starts one shared GLB parse for each completed authored structure. */
export function preloadAuthoredArchitectureModels(maxAnisotropy = 8): Promise<void> {
  if (sourceScenes.size === AUTHORED_ARCHITECTURE_MODEL_COUNT) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  loadPromise = Promise.all(
    (Object.entries(MODEL_URLS) as Array<[AuthoredArchitectureKey, string]>).map(
      async ([key, url]) => {
        const gltf = await loader.loadAsync(url);
        const scene = gltf.scene;
        scene.name = `${key} authored GLB source`;
        prepareGorskiArchitectureSourceScene(scene, maxAnisotropy);
        sourceScenes.set(key, scene);
      },
    ),
  ).then(() => undefined).catch((error) => {
    sourceScenes.clear();
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

export function createAuthoredTierOneResidenceShell(): THREE.Group | null {
  const shell = cloneSourceScene('tier-one-residence');
  if (!shell) return null;
  shell.name = 'Tier 1 residence authored GLB shell';
  // Blender's public face is Y=0 and the body grows toward +Y. glTF converts
  // that public face to local +Z; centre the seven-metre depth on the marker.
  shell.position.z = 3.5;
  shell.userData.authoredGlbAsset = true;
  shell.userData.authoredGlbVersion = 'tier1-residence-v26';
  shell.userData.authoredGlbUrl = TIER_ONE_RESIDENCE_MODEL_URL;
  return shell;
}

export function createAuthoredTierOneChurchMesh(): THREE.Group | null {
  const church = cloneSourceScene('tier-one-church');
  if (!church) return null;
  church.name = 'Tier 1 parish church';
  church.userData.authoredGlbAsset = true;
  church.userData.authoredGlbVersion = 'tier1-church-delnice-v2';
  church.userData.authoredGlbUrl = TIER_ONE_CHURCH_MODEL_URL;
  addTierOneChurchRuntimeClock(church);
  return church;
}

export function createAuthoredHuntersCampMesh(): THREE.Group | null {
  const camp = cloneSourceScene('hunters-camp');
  if (!camp) return null;
  camp.name = "Hunter's camp";
  camp.userData.authoredGlbAsset = true;
  camp.userData.authoredGlbVersion = 'hunters-camp-v10';
  camp.userData.authoredGlbUrl = HUNTERS_CAMP_MODEL_URL;
  camp.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(camp, 'hc_instance', 'Hunter camp');
  addHuntersCampRuntimeInventory(camp);
  return camp;
}

export function createAuthoredFishingCampMesh(): THREE.Group | null {
  const camp = cloneSourceScene('fishing-camp');
  if (!camp) return null;
  camp.name = 'Fishing camp';
  camp.userData.authoredGlbAsset = true;
  camp.userData.authoredGlbVersion = 'fishing-camp-v5';
  camp.userData.authoredGlbUrl = FISHING_CAMP_MODEL_URL;
  camp.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(camp, 'fc_instance', 'Fishing camp');
  addFishingCampRuntimeInventory(camp);
  return camp;
}

export function createAuthoredWaysideShrineMesh(): THREE.Group | null {
  const shrine = cloneSourceScene('wayside-shrine');
  if (!shrine) return null;
  shrine.name = 'Gorski Kotar Wayside Shrine';
  shrine.userData.authoredGlbAsset = true;
  shrine.userData.authoredGlbVersion = 'wayside-shrine-v1';
  shrine.userData.authoredGlbUrl = WAYSIDE_SHRINE_MODEL_URL;
  shrine.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(shrine, 'ws_instance', 'Wayside shrine');
  return shrine;
}

export function createAuthoredLumberMillMesh(): THREE.Group | null {
  const mill = cloneSourceScene('lumber-mill');
  if (!mill) return null;
  mill.name = 'Lumber mill';
  mill.userData.authoredGlbAsset = true;
  mill.userData.authoredGlbVersion = 'lumber-mill-v1';
  mill.userData.authoredGlbUrl = LUMBER_MILL_MODEL_URL;
  mill.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(mill, 'lm_collision', 'Lumber mill');
  mill.add(createLumberMillRuntimeStockpile([
    [-5.0, -4.35],
    [-2.5, -4.35],
    [0, -4.35],
    [2.5, -4.35],
    [5.0, -4.35],
  ]));
  return mill;
}

export function createAuthoredMiningCampMesh(): THREE.Group | null {
  const camp = cloneSourceScene('mining-camp');
  if (!camp) return null;
  applyMiningCampSemanticContract(camp);
  camp.userData.authoredGlbAsset = true;
  camp.userData.authoredGlbVersion = 'mining-camp-v1';
  camp.userData.authoredGlbUrl = MINING_CAMP_MODEL_URL;
  camp.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(camp, 'mc_collision', 'Mining camp');
  addMiningCampRuntimeState(camp);
  return camp;
}

export function createAuthoredLargeQuarryMesh(): THREE.Group | null {
  const quarry = cloneSourceScene('large-quarry');
  if (!quarry) return null;
  applyLargeQuarrySemanticContract(quarry);
  quarry.userData.authoredGlbAsset = true;
  quarry.userData.authoredGlbVersion = 'large-quarry-v1';
  quarry.userData.authoredGlbUrl = LARGE_QUARRY_MODEL_URL;
  quarry.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(quarry, 'lq_collision', 'Large Quarry');
  addLargeQuarryRuntimeState(quarry);
  return quarry;
}

export function createAuthoredMineworksMesh(): THREE.Group | null {
  const mineworks = cloneSourceScene('mineworks');
  if (!mineworks) return null;
  applyMineworksSemanticContract(mineworks);
  mineworks.userData.authoredGlbAsset = true;
  mineworks.userData.authoredGlbVersion = 'mineworks-v1';
  mineworks.userData.authoredGlbUrl = MINEWORKS_MODEL_URL;
  mineworks.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(mineworks, 'mw_collision', 'Mineworks');
  addMineworksRuntimeState(mineworks);
  return mineworks;
}

export function authoredArchitectureModelsReady(): boolean {
  return sourceScenes.size === AUTHORED_ARCHITECTURE_MODEL_COUNT;
}

function cloneSourceScene(key: AuthoredArchitectureKey): THREE.Group | null {
  const source = sourceScenes.get(key);
  if (!source) return null;
  const clone = source.clone(true);
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // Local/cross-building batching owns and disposes live geometry. Each
    // marker therefore gets geometry of its own while immutable materials and
    // texture handles remain shared across every instance.
    mesh.geometry = mesh.geometry.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}

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

function addComponentCollisionProxies(
  camp: THREE.Group,
  instanceTag: 'hc_instance' | 'fc_instance' | 'ws_instance' | 'lm_collision' | 'mc_collision' | 'lq_collision' | 'mw_collision',
  label: string,
): void {
  camp.updateWorldMatrix(true, true);
  const components: THREE.Object3D[] = [];
  camp.traverse((object) => {
    if (object.userData[instanceTag] === true) components.push(object);
  });
  const inverseCamp = camp.matrixWorld.clone().invert();
  const localBounds = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const component of components) {
    localBounds.setFromObject(component).applyMatrix4(inverseCamp);
    if (localBounds.isEmpty()) continue;
    localBounds.getSize(size);
    localBounds.getCenter(center);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), invisibleCollisionMaterial);
    proxy.name = `${label} collision: ${component.name}`;
    proxy.position.copy(center);
    proxy.scale.copy(size);
    proxy.userData.fpCollisionAggregate = true;
    proxy.userData.fpCollisionAllowStep =
      component.userData.source_component_id === 'foundation_steps_limestone_1';
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    camp.add(proxy);
  }
}

function addFishingCampRuntimeInventory(camp: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FishingFoodStockpile';
  stockpile.visible = false;
  camp.add(stockpile);
  for (let index = 0; index < 3; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'FishingFoodSegment';
    // Keep runtime-owned creels in the widened east service aisle. Blender's
    // +Y depth arrives as Three.js -Z after glTF conversion.
    const x = 4.15;
    const z = -(1.5 + index * 0.55);
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.2, 0.25, 0.36, 9),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.18, z),
    ).name = 'Covered fishing creel';
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.19, 0.19, 0.045, 9),
      timberMaterial('weathered'),
      new THREE.Vector3(x, 0.38, z),
    ).name = 'Fishing creel lid';
    stockpile.add(segment);
  }
}

function addHuntersCampRuntimeInventory(camp: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'HuntersFoodStockpile';
  stockpile.visible = false;
  camp.add(stockpile);
  for (let index = 0; index < 4; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'HuntersFoodSegment';
    const row = Math.floor(index / 2);
    const column = index % 2;
    const x = 2.88 + column * 0.58;
    const z = -1.02 - row * 0.52;
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.25, 0.3, 0.26, 9),
      sharedBuildingDetailMaterial('wicker'),
      new THREE.Vector3(x, 0.14, z),
    ).name = 'Covered hunter provision basket';
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.22, 0.22, 0.055, 9),
      timberMaterial('weathered'),
      new THREE.Vector3(x, 0.3, z),
    ).name = 'Hunter provision basket lid';
    stockpile.add(segment);
  }
}
