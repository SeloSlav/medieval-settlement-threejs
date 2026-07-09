import * as THREE from 'three';

export type TextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  ao?: THREE.Texture;
  height?: THREE.Texture;
  edgeMask?: THREE.Texture;
  rutMask?: THREE.Texture;
};

export type TerrainBlendTextureSet = {
  grass: TextureSet;
  deadGrass: TextureSet;
  dirt: TextureSet;
  gravel: TextureSet;
};

export class RoadTextureLoader {
  private readonly maxAnisotropy: number;
  private readonly loader = new THREE.TextureLoader();

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
  }

  async loadRoadTextures(): Promise<TextureSet> {
    const base = '/assets/textures/roads/medieval_dirt';
    const [albedo, normal, roughness, ao, height, edgeMask, rutMask] = await Promise.all([
      this.load(`${base}/albedo.png`, true),
      this.load(`${base}/normal.png`, false),
      this.load(`${base}/roughness.png`, false),
      this.load(`${base}/ao.png`, false),
      this.load(`${base}/height.png`, false),
      this.load(`${base}/edge_mask.png`, false),
      this.load(`${base}/rut_mask.png`, false),
    ]);
    return { albedo, normal, roughness, ao, height, edgeMask, rutMask };
  }

  async loadTerrainTextures(): Promise<TextureSet> {
    const base = '/assets/textures/terrain/grass_ground';
    const [albedo, normal, roughness, ao, height] = await Promise.all([
      this.load(`${base}/albedo.png`, true),
      this.load(`${base}/normal.png`, false),
      this.load(`${base}/roughness.png`, false),
      this.load(`${base}/ao.png`, false),
      this.load(`${base}/height.png`, false),
    ]);
    return { albedo, normal, roughness, ao, height };
  }

  async loadTerrainBlendTextures(): Promise<TerrainBlendTextureSet> {
    const [grass, deadGrass, dirt, gravel] = await Promise.all([
      this.loadTerrainBlendSet('/assets/textures/terrain/mammoth_grass_ground'),
      this.loadTerrainBlendSet('/assets/textures/terrain/mammoth_dead_grass_ground'),
      this.loadTerrainBlendSet('/assets/textures/terrain/mammoth_terrain_dirt'),
      this.loadTerrainBlendSet('/assets/textures/terrain/mammoth_terrain_gravel'),
    ]);
    return { grass, deadGrass, dirt, gravel };
  }

  private async loadTerrainBlendSet(base: string): Promise<TextureSet> {
    const [albedo, normal, roughness, height] = await Promise.all([
      this.load(`${base}/albedo.png`, true),
      this.load(`${base}/normal.png`, false),
      this.load(`${base}/roughness.png`, false),
      this.load(`${base}/height.png`, false),
    ]);
    return { albedo, normal, roughness, height };
  }

  private async load(url: string, srgb: boolean): Promise<THREE.Texture> {
    const texture = await this.loader.loadAsync(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.max(1, Math.min(16, this.maxAnisotropy));
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}

