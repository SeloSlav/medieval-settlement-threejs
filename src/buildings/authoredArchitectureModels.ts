import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  timberMaterial,
} from './buildingMaterials.ts';
import { prepareGorskiArchitectureSourceScene } from './gorskiArchitectureSourcePreparation.ts';
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

export { prepareGorskiArchitectureSourceScene } from './gorskiArchitectureSourcePreparation.ts';

export const TIER_ONE_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/tier1_residence_retopo_v28.glb';
export const TIER_TWO_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/residence_tier_2_kit_v1.glb';
export const TIER_THREE_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/residence_tier_3_kit_v1.glb';
export const TIER_FOUR_RESIDENCE_MODEL_URL =
  '/assets/models/buildings/gorski/residence_tier_4_kit_v1.glb';
export const TIER_ONE_CHURCH_MODEL_URL =
  '/assets/models/buildings/gorski/tier1_church_delnice_v2.glb';
export const HUNTERS_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/hunters_camp_textured_v10.glb';
export const FISHING_CAMP_MODEL_URL =
  '/assets/models/buildings/gorski/fishing_camp_textured_v7.glb';
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
  | 'tier-two-residence'
  | 'tier-three-residence'
  | 'tier-four-residence'
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
  'tier-two-residence': TIER_TWO_RESIDENCE_MODEL_URL,
  'tier-three-residence': TIER_THREE_RESIDENCE_MODEL_URL,
  'tier-four-residence': TIER_FOUR_RESIDENCE_MODEL_URL,
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

type AuthoredResidenceTier = 1 | 2 | 3 | 4;

const AUTHORED_RESIDENCE_KEYS: Record<AuthoredResidenceTier, AuthoredArchitectureKey> = {
  1: 'tier-one-residence',
  2: 'tier-two-residence',
  3: 'tier-three-residence',
  4: 'tier-four-residence',
};

const AUTHORED_RESIDENCE_DEPTHS: Record<AuthoredResidenceTier, number> = {
  1: 7,
  2: 8,
  3: 8,
  4: 10,
};

const AUTHORED_RESIDENCE_VERSIONS: Record<AuthoredResidenceTier, string> = {
  1: 'tier1-residence-v28',
  2: 'residence-tier-2-kit-v1',
  3: 'residence-tier-3-kit-v1',
  4: 'residence-tier-4-kit-v1',
};

export function createAuthoredResidenceShell(tier: AuthoredResidenceTier): THREE.Group | null {
  const shell = cloneSourceScene(AUTHORED_RESIDENCE_KEYS[tier]);
  if (!shell) return null;
  shell.name = `Tier ${tier} residence authored GLB shell`;
  // Kit assemblies use Blender +Y for depth and export to Three.js -Z. Their
  // public facade is authored at depth zero, so this centres each shell on the
  // residence marker without changing its canonical metre scale.
  shell.position.z = AUTHORED_RESIDENCE_DEPTHS[tier] * 0.5;
  shell.userData.authoredGlbAsset = true;
  shell.userData.authoredGlbVersion = AUTHORED_RESIDENCE_VERSIONS[tier];
  shell.userData.authoredGlbUrl = MODEL_URLS[AUTHORED_RESIDENCE_KEYS[tier]];
  return shell;
}

export function createAuthoredTierOneResidenceShell(): THREE.Group | null {
  return createAuthoredResidenceShell(1);
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
  camp.userData.authoredGlbVersion = 'fishing-camp-v7';
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
