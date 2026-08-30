import * as THREE from 'three';
import {
  createFieldCropGeometry,
  fieldCropComponents,
} from '@seedthree/core/field-crops.js';
import { FIELD_CROP_SPECIES } from '@seedthree/species/field-crops.js';
import type { FarmCrop } from '../../resources/types.ts';
import type { RendererBackendKind } from '../../scene/RendererBackend.ts';
import {
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverTextures,
} from './seedThreeGroundCover.ts';

const cropTextureModules = import.meta.glob(
  '../../../vendor/seedthree/assets/crops/*.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>;

type SeedThreeFieldCropPhasePreset = {
  textures: {
    albedo: string;
    normal: string;
    roughness: string;
    translucency: string;
  };
  referenceHeightMeters: number;
  card: Record<string, number>;
};

type SeedThreeFieldCropPreset = {
  key: string;
  name: string;
  latin: string;
  category: 'field-crop';
  young: SeedThreeFieldCropPhasePreset;
  mature: SeedThreeFieldCropPhasePreset;
  windAmount: number;
  transmit: readonly [number, number, number];
};

type SeedThreeFieldCropMixture = {
  key: 'maslin';
  name: string;
  category: 'field-crop-mixture';
  components: ReadonlyArray<{
    preset: SeedThreeFieldCropPreset;
    share: number;
  }>;
};

export type FieldCropPhaseAsset = {
  phase: 'young' | 'mature';
  speciesKey: string;
  speciesName: string;
  latin: string;
  referenceHeightMeters: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  textureFiles: SeedThreeFieldCropPhasePreset['textures'];
};

export type FieldCropComponentAsset = {
  share: number;
  young: FieldCropPhaseAsset;
  mature: FieldCropPhaseAsset;
};

export type FieldCropCatalog = {
  components(crop: Exclude<FarmCrop, 'fallow'>): readonly FieldCropComponentAsset[];
  dispose(): void;
};

function cropTextureUrl(fileName: string): string | undefined {
  const entry = Object.entries(cropTextureModules).find(([path]) => path.endsWith(`/${fileName}`));
  return entry?.[1];
}

function gameCropPreset(crop: Exclude<FarmCrop, 'fallow'>): SeedThreeFieldCropPreset | SeedThreeFieldCropMixture {
  const key = crop === 'wheat' ? 'maslin' : crop;
  const preset = FIELD_CROP_SPECIES[key] as SeedThreeFieldCropPreset | SeedThreeFieldCropMixture | undefined;
  if (!preset) throw new Error(`Missing SeedThree field-crop preset for ${key}`);
  return preset;
}

function textureKey(files: SeedThreeFieldCropPhasePreset['textures']): string {
  return [files.albedo, files.normal, files.roughness, files.translucency].join('|');
}

export async function createFieldCropCatalog(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind = 'webgl',
): Promise<FieldCropCatalog> {
  const presets = new Map<string, SeedThreeFieldCropPreset>();
  for (const crop of ['rye', 'oats', 'barley', 'flax', 'wheat'] as const) {
    for (const component of fieldCropComponents(gameCropPreset(crop))) {
      const preset = component.preset as SeedThreeFieldCropPreset;
      presets.set(preset.key, preset);
    }
  }

  const texturePromises = new Map<string, Promise<SeedThreeGroundCoverTextures>>();
  const textures = new Map<string, SeedThreeGroundCoverTextures>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  const loadPhaseTextures = (phase: SeedThreeFieldCropPhasePreset) => {
    const key = textureKey(phase.textures);
    let request = texturePromises.get(key);
    if (!request) {
      request = loadSeedThreeGroundCoverTextures({
        albedo: cropTextureUrl(phase.textures.albedo),
        normal: cropTextureUrl(phase.textures.normal),
        roughness: cropTextureUrl(phase.textures.roughness),
        translucency: cropTextureUrl(phase.textures.translucency),
      }, maxAnisotropy).then((loaded) => {
        textures.set(key, loaded);
        return loaded;
      });
      texturePromises.set(key, request);
    }
    return request;
  };

  const assets = new Map<string, { young: FieldCropPhaseAsset; mature: FieldCropPhaseAsset }>();
  await Promise.all([...presets.values()].map(async (preset) => {
    const buildPhase = async (phase: 'young' | 'mature'): Promise<FieldCropPhaseAsset> => {
      const phasePreset = preset[phase];
      const phaseTextures = await loadPhaseTextures(phasePreset);
      const geometry = createFieldCropGeometry(preset, phase === 'mature' ? 1 : 0);
      const material = createSeedThreeGroundCoverMaterial(
        `SeedThree ${preset.name} ${phase}`,
        phaseTextures,
        rendererBackend,
        [...preset.transmit],
        preset.windAmount,
      );
      material.alphaTest = 0.28;
      material.userData.fieldCropSharedResource = true;
      material.userData.seedThreeSpecies = preset.name;
      material.userData.seedThreeLatin = preset.latin;
      material.userData.seedThreeCropPhase = phase;
      material.userData.pbrTextureFiles = { ...phasePreset.textures };
      geometry.userData.seedThreeSpecies = preset.name;
      geometry.userData.seedThreeLatin = preset.latin;
      geometry.userData.seedThreeCropPhase = phase;
      materials.add(material);
      geometries.add(geometry);
      return {
        phase,
        speciesKey: preset.key,
        speciesName: preset.name,
        latin: preset.latin,
        referenceHeightMeters: phasePreset.referenceHeightMeters,
        geometry,
        material,
        textureFiles: phasePreset.textures,
      };
    };
    const [young, mature] = await Promise.all([buildPhase('young'), buildPhase('mature')]);
    assets.set(preset.key, { young, mature });
  }));

  return {
    components(crop) {
      return fieldCropComponents(gameCropPreset(crop)).map((component) => {
        const preset = component.preset as SeedThreeFieldCropPreset;
        const asset = assets.get(preset.key);
        if (!asset) throw new Error(`SeedThree crop asset was not loaded: ${preset.key}`);
        return { share: component.share, ...asset };
      });
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const loaded of textures.values()) disposeSeedThreeGroundCoverTextures(loaded);
      geometries.clear();
      materials.clear();
      textures.clear();
      texturePromises.clear();
      assets.clear();
    },
  };
}
