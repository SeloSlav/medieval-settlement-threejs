import * as THREE from 'three';
import {
  attribute,
  float,
  materialOpacity,
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
  materialOpacity: materialOpacity as TslNode,
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
  '/assets/textures/vegetation/grass/close-meadow-tuft-fuller-v2.png';

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

function applySeedThreeGrassSeasonMaterial(
  material: THREE.Material,
  textures: SeedThreeGrassTextures,
  rendererBackend: RendererBackendKind,
): void {
  const spring = tsl.uniform(0) as { value: number } & TslNode;
  const autumn = tsl.uniform(0) as { value: number } & TslNode;
  const dormancy = tsl.uniform(0) as { value: number } & TslNode;
  const snowCoverage = tsl.uniform(0) as { value: number } & TslNode;
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  material.userData.forestSnowCoverage = snowCoverage;

  if (rendererBackend !== 'webgpu') {
    chainMaterialShaderPatch(material, 'seedthree-grass-season-snow-v1', (shader) => {
      shader.uniforms.uGrassSpring = spring;
      shader.uniforms.uGrassAutumn = autumn;
      shader.uniforms.uGrassDormancy = dormancy;
      shader.uniforms.uGrassSnowCoverage = snowCoverage;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uGrassSpring;',
          'uniform float uGrassAutumn;',
          'uniform float uGrassDormancy;',
          'uniform float uGrassSnowCoverage;',
        ].join('\n'),
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'float grassValue = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
          'vec3 grassSpring = clamp( vec3( 0.56, 0.86, 0.22 ) * grassValue * 1.35, 0.0, 1.0 );',
          'vec3 grassAutumn = clamp( vec3( 0.72, 0.43, 0.13 ) * grassValue * 1.55, 0.0, 1.0 );',
          'vec3 grassDormant = clamp( vec3( 0.43, 0.34, 0.19 ) * grassValue * 1.65, 0.0, 1.0 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, grassSpring, uGrassSpring * 0.34 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, grassAutumn, uGrassAutumn * 0.78 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, grassDormant, uGrassDormancy * 0.9 );',
          'float grassSnowBurial = uGrassSnowCoverage * 0.64;',
          'diffuseColor.a *= ( 1.0 - uGrassDormancy * 0.24 ) * ( 1.0 - grassSnowBurial );',
          'float grassSnowTip = smoothstep( 0.54, 1.0, vMapUv.y );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.955, 0.98 ), uGrassSnowCoverage * grassSnowTip * 0.52 );',
        ].join('\n'),
      );
    });
    material.needsUpdate = true;
    return;
  }

  const target = material as THREE.Material & {
    colorNode?: unknown;
    opacityNode?: unknown;
    thicknessColorNode?: TslNode;
  };
  const texel = tsl.texture(textures.albedo);
  const base = texel.mul(tsl.vec4(tsl.attribute('aTint', 'vec3'), tsl.float(1)));
  const value = base.rgb.x.mul(0.2126)
    .add(base.rgb.y.mul(0.7152))
    .add(base.rgb.z.mul(0.0722));
  const springGrass = tsl.vec3(0.56, 0.86, 0.22).mul(value.mul(1.35));
  const autumnGrass = tsl.vec3(0.72, 0.43, 0.13).mul(value.mul(1.55));
  const dormantGrass = tsl.vec3(0.43, 0.34, 0.19).mul(value.mul(1.65));
  let seasonal = tsl.mix(base.rgb, springGrass, spring.mul(0.34));
  seasonal = tsl.mix(seasonal, autumnGrass, autumn.mul(0.78));
  seasonal = tsl.mix(seasonal, dormantGrass, dormancy.mul(0.9));
  const snowTip = tsl.smoothstep(tsl.float(0.54), tsl.float(1), tsl.uv().y);
  const snowAmount = snowCoverage.mul(snowTip).mul(0.52);
  target.colorNode = tsl.vec4(
    tsl.mix(seasonal, tsl.vec3(0.92, 0.955, 0.98), snowAmount),
    base.a,
  );
  target.opacityNode = base.a
    // A custom opacityNode replaces Three's materialOpacity path. Keep the
    // live zoom fade owned by GrassBladeField alongside seasonal attenuation.
    .mul(tsl.materialOpacity)
    .mul(tsl.float(1).sub(dormancy.mul(0.24)))
    .mul(tsl.float(1).sub(snowCoverage.mul(0.64)));
  if (target.thicknessColorNode) {
    target.thicknessColorNode = target.thicknessColorNode
      .mul(tsl.float(1).sub(dormancy.mul(0.58)))
      .mul(tsl.float(1).sub(snowAmount.mul(0.82)));
  }
}

function setGrassUniform(material: THREE.Material, key: string, value: number): boolean {
  const target = material.userData[key] as { value: number } | undefined;
  if (!target) return false;
  const next = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
  if (Math.abs(target.value - next) <= 1e-6) return false;
  target.value = next;
  return true;
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
