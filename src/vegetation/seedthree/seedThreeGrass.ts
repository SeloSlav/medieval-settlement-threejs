import * as THREE from 'three';
import {
  attribute,
  float,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import type { RendererBackendKind } from '../../scene/RendererBackend.ts';
import {
  createSeedThreeCardClumpGeometry,
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverTextures,
} from './seedThreeGroundCover.ts';
import { worldAnimationTime } from '../../scene/worldAnimationTime.ts';
import { chainMaterialShaderPatch } from '../../scene/materialShaderPatch.ts';
import type { DeciduousFoliagePresentation } from '../../world/deciduousFoliagePolicy.ts';

export { WIND_DIR as SEEDTHREE_GRASS_WIND_DIR };

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  a: TslNode;
  rgb: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  float: float as (value: number) => TslNode,
  mix: mix as (left: unknown, right: unknown, amount: unknown) => TslNode,
  positionLocal: positionLocal as TslNode,
  sin: sin as (value: unknown) => TslNode,
  smoothstep: smoothstep as (low: unknown, high: unknown, value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  time: worldAnimationTime as unknown as TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  uv: uv as () => TslNode,
  vec3: vec3 as (x: unknown, y: unknown, z: unknown) => TslNode,
  vec4: vec4 as (...values: unknown[]) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

/** World wind heading — applied in xz only after instance transform. */
const grassWindDir = tsl.uniform(WIND_DIR.clone()) as unknown as TslNode;

function swayAt(phaseWorld: TslNode, phaseScale: number): TslNode {
  const t = tsl.time.mul(tsl.windSpeed);
  const phase = phaseWorld.x.mul(0.35).add(phaseWorld.z.mul(0.27)).mul(phaseScale);
  return tsl.sin(t.mul(1.15).add(phase))
    .mul(0.72)
    .add(tsl.sin(t.mul(2.63).add(phase.mul(1.9))).mul(0.28));
}

/**
 * Rooted grass sway for instanced tufts.
 * Must bend from positionLocal (post-instance-matrix), not positionGeometry.
 */
export function createPinnedGrassWindPosition(
  weightAttribute?: string,
  anchorAttributeType: 'vec3' | 'vec4' = 'vec3',
): TslNode {
  const local = tsl.positionLocal;
  const weight = weightAttribute
    ? tsl.attribute(weightAttribute, 'float')
    : tsl.uv().y;
  const k = weight.mul(weight);
  const amp = tsl.windStrength.mul(0.16);
  const anchorAttribute = tsl.attribute('aAnchorPos', anchorAttributeType);
  const anchorWorld = anchorAttributeType === 'vec4'
    ? anchorAttribute.xyz
    : anchorAttribute;
  const gust = swayAt(anchorWorld, 2.2).mul(amp);
  const jitterT = tsl.time
    .mul(tsl.windSpeed)
    .mul(3.1)
    .add(anchorWorld.z.mul(1.7))
    .add(anchorWorld.x.mul(1.3));
  const jitter = tsl.sin(jitterT).mul(amp).mul(0.18);
  const bend = gust.add(jitter).mul(k);
  return tsl.vec3(
    local.x.add(grassWindDir.x.mul(bend)),
    local.y,
    local.z.add(grassWindDir.z.mul(bend)),
  );
}

export type SeedThreeGrassTextures = SeedThreeGroundCoverTextures;

export type SeedThreeTuftVariant = {
  geometry: THREE.BufferGeometry;
  share: number;
  tall: number;
};

export const CLOSE_MEADOW_TUFT_PATH =
  '/assets/textures/vegetation/grass/close-meadow-tuft-greener.png';

let textureCache: SeedThreeGrassTextures | null = null;

export async function loadSeedThreeGrassTextures(maxAnisotropy: number): Promise<SeedThreeGrassTextures> {
  if (textureCache) return textureCache;

  textureCache = await loadSeedThreeGroundCoverTextures({
    albedo: CLOSE_MEADOW_TUFT_PATH,
  }, maxAnisotropy);
  return textureCache;
}

export function createSeedThreeTuftVariants(): SeedThreeTuftVariant[] {
  return [
    {
      geometry: createSeedThreeCardClumpGeometry({
        quads: 2,
        width: 1.04,
        tiltMin: 0.025,
        tiltSpan: 0.1,
        heightMin: 0.94,
        heightSpan: 0.14,
        baseSpread: 0.1,
      }),
      share: 0.62,
      tall: 1,
    },
    {
      geometry: createSeedThreeCardClumpGeometry({
        quads: 3,
        width: 0.72,
        tiltMin: 0.035,
        tiltSpan: 0.13,
        heightMin: 0.98,
        heightSpan: 0.18,
        baseSpread: 0.16,
      }),
      share: 0.38,
      tall: 1.4,
    },
  ];
}

export function createSeedThreeGrassMaterial(
  textures: SeedThreeGrassTextures,
  rendererBackend: RendererBackendKind,
): THREE.Material {
  const mat = createSeedThreeGroundCoverMaterial(
    'SeedThree close meadow grass',
    textures,
    rendererBackend,
    [0.2, 0.34, 0.14],
    0.14,
    createPinnedGrassWindPosition(),
  );
  mat.alphaTest = 0.28;
  applySeedThreeGrassSeasonMaterial(mat, textures, rendererBackend);
  return mat;
}

export function setSeedThreeGrassSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
  snowCoverage: number,
): boolean {
  let changed = false;
  changed = setGrassUniform(material, 'forestSeasonalSpringFlush', presentation.springFlush) || changed;
  changed = setGrassUniform(material, 'forestSeasonalAutumnColor', presentation.autumnColor) || changed;
  changed = setGrassUniform(material, 'forestSeasonalDormancy', presentation.dormancy) || changed;
  changed = setGrassUniform(material, 'forestSnowCoverage', snowCoverage) || changed;
  return changed;
}

const GRASS_TINT_WHITE = new THREE.Color(0xffffff);
const grassTintScratch = new THREE.Color();

export function sampleSeedThreeGrassTint(rng: () => number, dry = 0): THREE.Vector3 {
  const dryAmount = THREE.MathUtils.clamp(dry, 0, 1);
  const hue = THREE.MathUtils.lerp(0.285, 0.205, dryAmount) + (rng() - 0.5) * 0.018;
  const saturation = THREE.MathUtils.lerp(0.38, 0.3, dryAmount) + rng() * 0.022;
  const lightness = THREE.MathUtils.lerp(0.3, 0.37, dryAmount) + (rng() - 0.5) * 0.032;
  grassTintScratch
    .setHSL(hue, saturation, lightness)
    .lerp(GRASS_TINT_WHITE, 0.38);
  return new THREE.Vector3(grassTintScratch.r, grassTintScratch.g, grassTintScratch.b);
}

export function disposeSeedThreeGrassTextureCache(): void {
  if (!textureCache) return;
  disposeSeedThreeGroundCoverTextures(textureCache);
  textureCache = null;
}
