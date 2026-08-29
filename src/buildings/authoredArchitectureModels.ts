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

export const TIER_ONE_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/tier1_residence_retopo_v25.glb';
export const HUNTERS_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/hunters_camp_textured_v6.glb';

type AuthoredArchitectureKey = 'tier-one-residence' | 'hunters-camp';

const MODEL_URLS: Record<AuthoredArchitectureKey, string> = {
  'tier-one-residence': TIER_ONE_RESIDENCE_MODEL_URL,
  'hunters-camp': HUNTERS_CAMP_MODEL_URL,
};

const sourceScenes = new Map<AuthoredArchitectureKey, THREE.Group>();
let loadPromise: Promise<void> | null = null;
const invisibleCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false });
invisibleCollisionMaterial.name = 'Invisible authored camp collision material';

/** Starts one shared GLB parse for each completed authored structure. */
export function preloadAuthoredArchitectureModels(maxAnisotropy = 8): Promise<void> {
  if (sourceScenes.size === 2) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  loadPromise = Promise.all(
    (Object.entries(MODEL_URLS) as Array<[AuthoredArchitectureKey, string]>).map(
      async ([key, url]) => {
        const gltf = await loader.loadAsync(url);
        const scene = gltf.scene;
        scene.name = `${key} authored GLB source`;
        prepareSourceScene(scene, maxAnisotropy);
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
  shell.userData.authoredGlbVersion = 'tier1-residence-v25';
  shell.userData.authoredGlbUrl = TIER_ONE_RESIDENCE_MODEL_URL;
  return shell;
}

export function createAuthoredHuntersCampMesh(): THREE.Group | null {
  const camp = cloneSourceScene('hunters-camp');
  if (!camp) return null;
  camp.name = "Hunter's camp";
  camp.userData.authoredGlbAsset = true;
  camp.userData.authoredGlbVersion = 'hunters-camp-v6';
  camp.userData.authoredGlbUrl = HUNTERS_CAMP_MODEL_URL;
  camp.userData.fpCollisionChildrenOnly = true;
  addComponentCollisionProxies(camp);
  addHuntersCampRuntimeInventory(camp);
  return camp;
}

export function authoredArchitectureModelsReady(): boolean {
  return sourceScenes.size === 2;
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

function prepareSourceScene(scene: THREE.Group, maxAnisotropy: number): void {
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
  const material = createNodeMaterialFromSource(source);
  material.userData.sharedBuildingMaterial = true;
  if (atlasId === 'gorski-building-atlas-v1') {
    const tile = source.userData.atlas_tile as BuildingMaterialAtlasTile;
    material.roughness = authoredRoughness(tile);
    material.metalness = tile === 'wrought-iron' ? 0.68 : 0;
    if (source.userData.atlas_uv_mode === 'final tile coordinates baked into GK_UV0') {
      applyBuildingMaterialAtlasDirectUv(material, {
        tile,
        tintStrength: 0,
        normalStrength: 0.82,
      });
    } else {
      applyBuildingMaterialAtlas(material, {
        tile,
        tintStrength: 0,
        normalStrength: 0.82,
      });
    }
  } else {
    // Canvas and stitched hide keep their dedicated authored albedo/normal.
    // Their packed map uses the game's R/G/B contract rather than glTF's G/B
    // metallic-roughness convention, so scalar values are deliberately used.
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

function addComponentCollisionProxies(camp: THREE.Group): void {
  camp.updateWorldMatrix(true, true);
  const components: THREE.Object3D[] = [];
  camp.traverse((object) => {
    if (object.userData.hc_instance === true) components.push(object);
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
    proxy.name = `Hunter camp collision: ${component.name}`;
    proxy.position.copy(center);
    proxy.scale.copy(size);
    proxy.userData.fpCollisionAggregate = true;
    proxy.userData.fpCollisionAllowStep = false;
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    camp.add(proxy);
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
