import * as THREE from 'three';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  positionWorld,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { foliageWindPosition } from '@seedthree/core/wind.js';
import type { BranchCardsSet } from '@seedthree/core/branch-cards.js';
import type { SeedThreeBranchCards } from './seedThreeBranchCards.ts';
import { seedThreePersistentBranchCardCacheKey } from './seedThreeBranchCardPolicy.ts';

const DATABASE_NAME = 'medieval-road-system-generated-vegetation';
const DATABASE_VERSION = 1;
const STORE_NAME = 'branch-cards';
const TRANSMIT = [0.42, 0.62, 0.24] as const;

type CachedTextureChannels = {
  albedo: Blob;
  normal: Blob;
  rough: Blob;
  trans: Blob;
};

type CachedVariant = {
  attributes: Record<string, {
    values: number[];
    itemSize: number;
    normalized: boolean;
    instanced: boolean;
  }>;
  indices: number[];
  chordLen: number;
  textures: CachedTextureChannels;
};

type CachedSet = {
  key: string;
  foliageOnly: boolean;
  noFlutter: boolean;
  variants: CachedVariant[];
};

type CacheRecord = {
  key: string;
  sets: CachedSet[];
};

export async function readSeedThreeBranchCards(cacheKey: string): Promise<SeedThreeBranchCards | null> {
  if (typeof indexedDB === 'undefined') return null;
  const key = seedThreePersistentBranchCardCacheKey(cacheKey);
  try {
    const database = await openDatabase();
    const record = await requestResult<CacheRecord | undefined>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key),
    );
    database.close();
    if (!record?.sets.length) return null;

    const byLevel = new Map<string, BranchCardsSet>();
    for (const cachedSet of record.sets) {
      const centerUniform = uniform(new THREE.Vector3()) as unknown as { value: THREE.Vector3 };
      const variants: BranchCardsSet['variants'] = [];
      for (const cached of cachedSet.variants) {
        const textures = await restoreTextures(cached.textures);
        const geometry = new THREE.BufferGeometry();
        for (const [name, attributeData] of Object.entries(cached.attributes)) {
          const values = new Float32Array(attributeData.values);
          const attribute = attributeData.instanced
            ? new THREE.InstancedBufferAttribute(values, attributeData.itemSize, attributeData.normalized)
            : new THREE.BufferAttribute(values, attributeData.itemSize, attributeData.normalized);
          geometry.setAttribute(name, attribute);
        }
        geometry.setIndex(cached.indices);
        geometry.userData.shared = true;
        geometry.userData.crownUnderlay = cachedSet.key === '0:underlay';
        variants.push({
          geometry,
          material: createCardMaterial(textures, centerUniform, cachedSet.noFlutter),
          textures,
          chordLen: cached.chordLen,
        });
      }
      byLevel.set(cachedSet.key, {
        variants,
        centerUniform,
        foliageOnly: cachedSet.foliageOnly,
      });
    }
    const near = [...byLevel.values()][0];
    if (!near) return null;
    return { byLevel, variants: near.variants, centerUniform: near.centerUniform };
  } catch (error) {
    console.warn('[SeedThree] persisted branch-card cache could not be restored:', error);
    return null;
  }
}

export async function writeSeedThreeBranchCards(
  cacheKey: string,
  cards: SeedThreeBranchCards,
  noFlutterByLevel: ReadonlyMap<string, boolean>,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const sets: CachedSet[] = [];
  for (const [key, set] of cards.byLevel) {
    const variants: CachedVariant[] = [];
    for (const variant of set.variants) {
      const index = variant.geometry.getIndex();
      if (!index) continue;
      const attributes: CachedVariant['attributes'] = {};
      for (const [name, attribute] of Object.entries(variant.geometry.attributes)) {
        attributes[name] = {
          values: Array.from(attribute.array),
          itemSize: attribute.itemSize,
          normalized: attribute.normalized,
          instanced: attribute instanceof THREE.InstancedBufferAttribute,
        };
      }
      variants.push({
        attributes,
        indices: Array.from(index.array),
        chordLen: variant.chordLen,
        textures: await serializeTextures(variant.textures),
      });
    }
    if (variants.length > 0) {
      sets.push({
        key,
        foliageOnly: set.foliageOnly ?? key.endsWith(':fol'),
        noFlutter: noFlutterByLevel.get(key) ?? false,
        variants,
      });
    }
  }
  if (sets.length === 0) return;

  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      key: seedThreePersistentBranchCardCacheKey(cacheKey),
      sets,
    } satisfies CacheRecord);
    await transactionDone(transaction);
    database.close();
  } catch (error) {
    console.warn('[SeedThree] branch-card cache could not be saved:', error);
  }
}

async function serializeTextures(textures: Record<string, THREE.Texture>): Promise<CachedTextureChannels> {
  return {
    albedo: await textureBlob(textures.albedo),
    normal: await textureBlob(textures.normal),
    rough: await textureBlob(textures.rough),
    trans: await textureBlob(textures.trans),
  };
}

function textureBlob(textureValue: THREE.Texture | undefined): Promise<Blob> {
  const canvas = textureValue?.image as HTMLCanvasElement | undefined;
  if (!canvas?.toBlob) return Promise.reject(new Error('Branch-card texture is not backed by a canvas.'));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Branch-card canvas could not be encoded.'));
    }, 'image/png');
  });
}

async function restoreTextures(blobs: CachedTextureChannels): Promise<Record<string, THREE.Texture>> {
  const [albedo, normal, rough, trans] = await Promise.all([
    textureFromBlob(blobs.albedo, true),
    textureFromBlob(blobs.normal, false),
    textureFromBlob(blobs.rough, false),
    textureFromBlob(blobs.trans, false),
  ]);
  return { albedo, normal, rough, trans };
}

async function textureFromBlob(blob: Blob, srgb: boolean): Promise<THREE.Texture> {
  const bitmap = await createImageBitmap(blob);
  const result = new THREE.Texture(bitmap);
  result.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.anisotropy = 8;
  result.needsUpdate = true;
  result.addEventListener('dispose', () => bitmap.close());
  return result;
}

function createCardMaterial(
  textures: Record<string, THREE.Texture>,
  centerUniform: { value: THREE.Vector3 },
  noFlutter: boolean,
): THREE.Material {
  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    normalMap: textures.normal,
    roughnessMap: textures.rough,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  } as any);
  const centerNode = centerUniform as unknown as ReturnType<typeof uniform>;
  const worldPositionNode = positionWorld as any;
  const cameraViewNode = cameraViewMatrix as any;
  const base = worldPositionNode.sub(centerNode).normalize().add(vec3(0, 0.45, 0));
  const detail = (texture(textures.normal) as any).xyz.mul(2).sub(1);
  const normalWorld = base.add(detail.mul(0.45)).normalize();
  material.normalNode = cameraViewNode.mul(vec4(normalWorld, 0)).xyz.normalize();
  material.positionNode = foliageWindPosition(!noFlutter) as never;
  const transmit = uniform(new THREE.Color().setRGB(...TRANSMIT));
  material.thicknessColorNode = (texture(textures.trans) as any).r
    .mul(attribute('aThickness', 'float'))
    .mul(transmit);
  material.thicknessDistortionNode = uniform(0.3);
  material.thicknessAmbientNode = uniform(0.16);
  material.thicknessAttenuationNode = uniform(1);
  material.thicknessPowerNode = uniform(6);
  material.thicknessScaleNode = uniform(3);
  material.userData.gltfDiffuseTransmission = {
    factor: 1,
    color: TRANSMIT,
    map: textures.trans,
  };
  return material;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
