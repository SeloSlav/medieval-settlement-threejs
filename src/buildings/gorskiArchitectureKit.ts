import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareGorskiArchitectureSourceScene } from './gorskiArchitectureSourcePreparation.ts';

export const GORSKI_ARCHITECTURE_KIT_VERSION = '1.1.0';
export const GORSKI_ARCHITECTURE_KIT_ROOT =
  '/assets/models/buildings/gorski/architecture-kit-v1';
export const GORSKI_ARCHITECTURE_KIT_MANIFEST_URL =
  `${GORSKI_ARCHITECTURE_KIT_ROOT}/manifest.json`;

export const GORSKI_ARCHITECTURE_FAMILIES = [
  'foundations',
  'walls',
  'frames',
  'openings',
  'roofs',
  'enclosures',
  'siteworks',
  'extraction',
  'production',
  'agriculture',
  'civic',
  'props',
] as const;

export type GorskiArchitectureFamily = (typeof GORSKI_ARCHITECTURE_FAMILIES)[number];

export type GorskiArchitectureKitPartManifest = {
  id: string;
  family: GorskiArchitectureFamily;
  label: string;
  tags: string[];
  seams: string[];
  snapSockets: string[];
  openingContract: string;
  originContract: string;
  triangleBudget: number;
  triangles: number;
  dimensionsM: [number, number, number];
  materials: string[];
  vertexHash: string;
};

export type GorskiArchitectureKitManifest = {
  schemaVersion: number;
  kit: {
    name: string;
    version: string;
    region: string;
    era: string;
    unit: 'metre';
    gridM: number;
    vegetationOwner: string;
  };
  summary: {
    partCount: number;
    familyCount: number;
    totalTriangles: number;
    buildingCategories: number;
    supplementalCategories: number;
  };
  families: Record<GorskiArchitectureFamily, number>;
  runtime: {
    delivery: string;
    manifestUrl: string;
    families: Record<GorskiArchitectureFamily, {
      url: string;
      partCount: number;
      triangles: number;
      bytes: number;
    }>;
  };
  coverage: Record<string, unknown>;
  parts: GorskiArchitectureKitPartManifest[];
};

const FAMILY_URLS = Object.freeze(Object.fromEntries(
  GORSKI_ARCHITECTURE_FAMILIES.map((family) => [
    family,
    `${GORSKI_ARCHITECTURE_KIT_ROOT}/${family}.glb`,
  ]),
) as Record<GorskiArchitectureFamily, string>);

const sourcePartsByFamily = new Map<
  GorskiArchitectureFamily,
  ReadonlyMap<string, THREE.Object3D>
>();
const familyLoadPromises = new Map<GorskiArchitectureFamily, Promise<void>>();
let manifestPromise: Promise<GorskiArchitectureKitManifest> | null = null;

/** Loads and indexes one family bundle. No other family pays an I/O or parse cost. */
export function preloadGorskiArchitectureFamily(
  family: GorskiArchitectureFamily,
  maxAnisotropy = 8,
): Promise<void> {
  if (sourcePartsByFamily.has(family)) return Promise.resolve();
  const pending = familyLoadPromises.get(family);
  if (pending) return pending;

  const loader = new GLTFLoader();
  const load = loader.loadAsync(FAMILY_URLS[family]).then((gltf) => {
    const scene = gltf.scene;
    prepareGorskiArchitectureSourceScene(scene, maxAnisotropy);
    const parts = new Map<string, THREE.Object3D>();
    for (const child of [...scene.children]) {
      const partId = child.userData.gk_id;
      if (typeof partId !== 'string' || partId.length === 0) {
        throw new Error(`${family} architecture bundle contains a root without gk_id`);
      }
      if (child.userData.gk_family !== family) {
        throw new Error(`${partId} belongs to ${String(child.userData.gk_family)}, not ${family}`);
      }
      if (parts.has(partId)) throw new Error(`Duplicate Gorski architecture part ${partId}`);

      // Blender stores only contact-sheet translation on each component node.
      // Geometry is already authored around the canonical local origin.
      child.position.set(0, 0, 0);
      child.rotation.set(0, 0, 0);
      child.scale.set(1, 1, 1);
      child.updateMatrix();
      child.updateMatrixWorld(true);
      parts.set(partId, child);
    }
    if (parts.size === 0) throw new Error(`${family} architecture bundle contains no parts`);
    sourcePartsByFamily.set(family, parts);
  }).catch((error) => {
    familyLoadPromises.delete(family);
    throw error;
  });
  familyLoadPromises.set(family, load);
  return load;
}

export function gorskiArchitectureFamilyReady(family: GorskiArchitectureFamily): boolean {
  return sourcePartsByFamily.has(family);
}

/**
 * Creates a canonical, independently placeable component from an already
 * loaded family. Geometry is instance-owned; prepared atlas materials remain
 * shared so building batching and disposal cannot invalidate another marker.
 */
export function createGorskiArchitecturePart(
  family: GorskiArchitectureFamily,
  partId: string,
): THREE.Group | null {
  const source = sourcePartsByFamily.get(family)?.get(partId);
  if (!source) return null;
  const component = source.clone(true);
  component.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  component.position.set(0, 0, 0);
  component.rotation.set(0, 0, 0);
  component.scale.set(1, 1, 1);
  const instance = new THREE.Group();
  instance.name = `Gorski architecture part: ${partId}`;
  instance.userData.gorskiArchitectureKitVersion = GORSKI_ARCHITECTURE_KIT_VERSION;
  instance.userData.gorskiArchitectureFamily = family;
  instance.userData.gorskiArchitecturePartId = partId;
  instance.add(component);
  return instance;
}

export async function loadGorskiArchitecturePart(
  family: GorskiArchitectureFamily,
  partId: string,
  maxAnisotropy = 8,
): Promise<THREE.Group> {
  await preloadGorskiArchitectureFamily(family, maxAnisotropy);
  const part = createGorskiArchitecturePart(family, partId);
  if (!part) throw new Error(`Unknown ${family} architecture part ${partId}`);
  return part;
}

export function loadGorskiArchitectureKitManifest(): Promise<GorskiArchitectureKitManifest> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch(GORSKI_ARCHITECTURE_KIT_MANIFEST_URL).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Architecture-kit manifest request failed (${response.status})`);
    }
    const manifest = await response.json() as GorskiArchitectureKitManifest;
    if (
      manifest.kit?.version !== GORSKI_ARCHITECTURE_KIT_VERSION
      || manifest.summary?.partCount !== 638
      || manifest.summary?.familyCount !== GORSKI_ARCHITECTURE_FAMILIES.length
    ) {
      throw new Error('Architecture-kit manifest does not match the integrated runtime contract');
    }
    return manifest;
  }).catch((error) => {
    manifestPromise = null;
    throw error;
  });
  return manifestPromise;
}
