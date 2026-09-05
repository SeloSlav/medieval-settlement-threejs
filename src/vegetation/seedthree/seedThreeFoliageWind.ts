import {
  attribute,
  cameraPosition,
  cos,
  float,
  modelWorldMatrix,
  normalLocal,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  transformNormalToView,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import * as THREE from 'three';
import { worldAnimationTime } from '../../scene/worldAnimationTime.ts';
import { chainMaterialShaderPatch } from '../../scene/materialShaderPatch.ts';

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
};

type ClampedTslNode = TslNode & {
  clamp: (minimum: unknown, maximum: unknown) => TslNode;
};

type SeedThreeTreeTslNode = {
  mul: (value: unknown) => SeedThreeTreeTslNode;
  add: (value: unknown) => SeedThreeTreeTslNode;
  max: (value: unknown) => SeedThreeTreeTslNode;
  clamp: (minimum: unknown, maximum: unknown) => SeedThreeTreeTslNode;
  length: () => SeedThreeTreeTslNode;
  x: SeedThreeTreeTslNode;
  y: SeedThreeTreeTslNode;
  z: SeedThreeTreeTslNode;
  xyz: SeedThreeTreeTslNode;
};

type IvyTslNode = {
  mul: (value: unknown) => IvyTslNode;
  add: (value: unknown) => IvyTslNode;
  sub: (value: unknown) => IvyTslNode;
  div: (value: unknown) => IvyTslNode;
  max: (value: unknown) => IvyTslNode;
  clamp: (minimum: unknown, maximum: unknown) => IvyTslNode;
  cross: (value: unknown) => IvyTslNode;
  dot: (value: unknown) => IvyTslNode;
  length: () => IvyTslNode;
  normalize: () => IvyTslNode;
  toVarying: (name: string) => IvyTslNode;
  x: IvyTslNode;
  y: IvyTslNode;
  z: IvyTslNode;
  w: IvyTslNode;
  xyz: IvyTslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  float: float as (value: number) => TslNode,
  positionLocal: positionLocal as TslNode,
  sin: sin as (value: unknown) => TslNode,
  time: worldAnimationTime as unknown as TslNode,
  uv: uv as () => TslNode,
  vec3: vec3 as (x: unknown, y: unknown, z: unknown) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

const ivyTsl = {
  attribute: attribute as (name: string, type: string) => IvyTslNode,
  cameraPosition: cameraPosition as IvyTslNode,
  cos: cos as (value: unknown) => IvyTslNode,
  float: float as (value: number) => IvyTslNode,
  modelWorldMatrix: modelWorldMatrix as IvyTslNode,
  normalLocal: normalLocal as IvyTslNode,
  positionLocal: positionLocal as IvyTslNode,
  sin: sin as (value: unknown) => IvyTslNode,
  smoothstep: smoothstep as (
    edge0: unknown,
    edge1: unknown,
    value: unknown,
  ) => IvyTslNode,
  time: worldAnimationTime as unknown as IvyTslNode,
  transformNormalToView: transformNormalToView as (value: unknown) => IvyTslNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => IvyTslNode,
  windSpeed: windSpeed as unknown as IvyTslNode,
  windStrength: windStrength as unknown as IvyTslNode,
};

const seedThreeTreeTsl = {
  attribute: attribute as (name: string, type: string) => SeedThreeTreeTslNode,
  modelWorldMatrix: modelWorldMatrix as unknown as SeedThreeTreeTslNode,
  positionGeometry: positionGeometry as unknown as SeedThreeTreeTslNode,
  positionLocal: positionLocal as unknown as SeedThreeTreeTslNode,
  sin: sin as (value: unknown) => SeedThreeTreeTslNode,
  vec3: vec3 as (
    x: unknown,
    y: unknown,
    z: unknown,
  ) => SeedThreeTreeTslNode,
  vec4: vec4 as (
    x: unknown,
    y?: unknown,
    z?: unknown,
    w?: unknown,
  ) => SeedThreeTreeTslNode,
  windStrength: windStrength as unknown as SeedThreeTreeTslNode,
};

export const IVY_HINGE_MACRO_FADE_START = 22;
export const IVY_HINGE_MACRO_FADE_END = 44;
export const IVY_HINGE_MACRO_FAR_SCALE = 0.15;
export const IVY_HINGE_FLUTTER_FADE_START = 8;
export const IVY_HINGE_FLUTTER_FADE_END = 28;

export type IvyLeafHingeWindNodes = {
  positionNode: IvyTslNode;
  normalNode: IvyTslNode;
};

export const DOGWOOD_ROOT_SWAY_AMPLITUDE = 0.35;
export const DOGWOOD_LEAF_FLUTTER_AMPLITUDE = 0.055;
export const DOGWOOD_LEAF_PHASE_MULTIPLIER = 37.7;
export const DOGWOOD_LEAF_WEIGHT_GATE = 10;

function swayAt(phaseWorld: TslNode, phaseScale: number): TslNode {
  const t = tsl.time.mul(tsl.windSpeed);
  const phase = phaseWorld.x.mul(0.35).add(phaseWorld.z.mul(0.27)).mul(phaseScale);
  return tsl.sin(t.mul(1.15).add(phase))
    .mul(0.72)
    .add(tsl.sin(t.mul(2.63).add(phase.mul(1.9))).mul(0.28));
}

/**
 * Card foliage wind. Must bend from positionLocal (post-instance-matrix), not
 * positionGeometry — a custom positionNode replaces positionLocal after instancing.
 */
export function createRootedFoliageWindPosition(ampScale = 0.16): TslNode {
  const local = tsl.positionLocal;
  const k = tsl.uv().y.mul(tsl.uv().y);
  const amp = tsl.windStrength.mul(ampScale);
  const anchorWorld = tsl.attribute('aAnchorPos', 'vec3');
  const gust = swayAt(anchorWorld, 2).mul(amp);
  const jitterT = tsl.time
    .mul(tsl.windSpeed)
    .mul(3)
    .add(anchorWorld.z.mul(1.7))
    .add(anchorWorld.x.mul(1.3));
  const jitter = tsl.sin(jitterT).mul(amp).mul(0.18);
  const bend = gust.add(jitter).mul(k);
  const windLocal = tsl.attribute('aWindVec', 'vec3');
  return tsl.vec3(
    local.x.add(windLocal.x.mul(bend)),
    local.y,
    local.z.add(windLocal.z.mul(bend)),
  );
}

/** Pause-aware equivalent of SeedThree's authored hero-tree branch wind. */
export function createSeedThreeTreeBarkWindPosition(): SeedThreeTreeTslNode {
  const stemCenter = seedThreeTreeTsl.attribute('aStemCenter', 'vec3');
  const centerWorld = seedThreeTreeTsl.modelWorldMatrix
    .mul(seedThreeTreeTsl.vec4(stemCenter, 1)).xyz;
  const amplitude = seedThreeTreeTsl.windStrength
    .mul(0.35)
    .mul(seedThreeTreeTsl.attribute('aWind', 'float'));
  const displacement = swayAt(centerWorld as unknown as TslNode, 1)
    .mul(amplitude) as unknown as SeedThreeTreeTslNode;
  const windDirection = seedThreeTreeTsl.vec3(WIND_DIR.x, WIND_DIR.y, WIND_DIR.z);
  return seedThreeTreeTsl.positionLocal.add(windDirection.mul(displacement));
}

/** Pause-aware equivalent of SeedThree's instanced forest-branch wind. */
export function createSeedThreeForestBarkWindPosition(): SeedThreeTreeTslNode {
  const anchor = seedThreeTreeTsl.attribute('aAnchorPos', 'vec3');
  const anchorWorld = seedThreeTreeTsl.modelWorldMatrix
    .mul(seedThreeTreeTsl.vec4(anchor, 1)).xyz;
  const amplitude = seedThreeTreeTsl.windStrength
    .mul(0.35)
    .mul(seedThreeTreeTsl.attribute('aWind', 'float'));
  const displacement = swayAt(anchorWorld as unknown as TslNode, 1)
    .mul(amplitude) as unknown as SeedThreeTreeTslNode;
  return seedThreeTreeTsl.positionLocal.add(
    seedThreeTreeTsl.attribute('aWindVec', 'vec3').mul(displacement),
  );
}

/**
 * SeedThree's full card recipe driven by the pause-aware world clock. The
 * anchor remains welded to its branch while UV/local-height flutter affects
 * only the leaf tip.
 */
export function createSeedThreeTreeCardWindPosition(
  withFlutter = true,
  flutterScale = 1,
): SeedThreeTreeTslNode {
  const local = seedThreeTreeTsl.positionLocal;
  const windLocal = seedThreeTreeTsl.attribute('aWindVec', 'vec3');
  const anchor = seedThreeTreeTsl.attribute('aAnchorPos', 'vec3');
  const anchorWorld = seedThreeTreeTsl.modelWorldMatrix
    .mul(seedThreeTreeTsl.vec4(anchor, 1)).xyz;
  const base = windLocal.mul(
    swayAt(anchorWorld as unknown as TslNode, 1)
      .mul(seedThreeTreeTsl.windStrength.mul(0.35)),
  );
  if (!withFlutter) return local.add(base);

  const random = seedThreeTreeTsl.attribute('aThickness', 'float');
  const localHeight = seedThreeTreeTsl.positionGeometry.y.max(0);
  const flutterTime = (tsl.time as unknown as SeedThreeTreeTslNode)
    .mul(tsl.windSpeed)
    .mul(5.2)
    .add(random.mul(37.7));
  const gate = windLocal.length().mul(2.5).clamp(0, 1);
  const flutter = seedThreeTreeTsl.vec3(
    seedThreeTreeTsl.sin(flutterTime),
    seedThreeTreeTsl.sin(flutterTime.mul(1.31)).mul(0.6),
    seedThreeTreeTsl.sin(flutterTime.mul(0.77)),
  )
    .mul(seedThreeTreeTsl.windStrength.mul(0.05 * flutterScale))
    .mul(random)
    .mul(localHeight)
    .mul(gate);
  return local.add(base).add(flutter);
}

function rotateAroundAxis(
  vector: IvyTslNode,
  axis: IvyTslNode,
  angle: IvyTslNode,
): IvyTslNode {
  const cosine = ivyTsl.cos(angle);
  const sine = ivyTsl.sin(angle);
  return vector.mul(cosine)
    .add(axis.cross(vector).mul(sine))
    .add(axis.mul(axis.dot(vector)).mul(ivyTsl.float(1).sub(cosine)));
}

/**
 * Individually rooted forest-floor ivy leaves. Every resident instance
 * supplies its object-space root, hinge axis, phase, and maximum rotation.
 * Placement visibility is owned by the camera-local resident stream, avoiding
 * another vertex buffer on WebGPU's portable eight-buffer limit.
 */
export function createIvyLeafHingeWindNodes(): IvyLeafHingeWindNodes {
  const local = ivyTsl.positionLocal;
  const rootPhase = ivyTsl.attribute('aIvyRootPhase', 'vec4');
  const hinge = ivyTsl.attribute('aIvyHinge', 'vec4');
  const hingeLength = hinge.xyz.length();
  const axis = hinge.xyz.div(hingeLength.max(0.00001));
  const rootWorld = ivyTsl.modelWorldMatrix.mul(ivyTsl.vec4(rootPhase.xyz, 1)).xyz;
  const distanceToCamera = ivyTsl.cameraPosition.sub(rootWorld).length();
  const macroFade = ivyTsl.float(1).sub(
    ivyTsl.smoothstep(
      IVY_HINGE_MACRO_FADE_START,
      IVY_HINGE_MACRO_FADE_END,
      distanceToCamera,
    ).mul(1 - IVY_HINGE_MACRO_FAR_SCALE),
  );
  const flutterFade = ivyTsl.float(1).sub(
    ivyTsl.smoothstep(
      IVY_HINGE_FLUTTER_FADE_START,
      IVY_HINGE_FLUTTER_FADE_END,
      distanceToCamera,
    ),
  );
  const flutterGate = ivyTsl.smoothstep(0.05, 0.12, hinge.w);
  const gust = (swayAt(rootWorld, 1.0) as unknown as IvyTslNode).mul(macroFade);
  const flutterTime = ivyTsl.time
    .mul(ivyTsl.windSpeed)
    .mul(5.2)
    .add(rootPhase.w);
  const flutter = ivyTsl.sin(flutterTime)
    .mul(0.18)
    .mul(flutterGate)
    .mul(flutterFade);
  const angle = gust.add(flutter)
    .mul(ivyTsl.windStrength)
    .mul(hinge.w)
    .clamp(-0.12, 0.28);
  const rotatedPosition = rotateAroundAxis(local.sub(rootPhase.xyz), axis, angle)
    .add(rootPhase.xyz);
  const rotatedNormal = rotateAroundAxis(ivyTsl.normalLocal, axis, angle).normalize();

  return {
    positionNode: rotatedPosition,
    // normalLocal receives the leaf's instance basis in the vertex stage.
    // Evaluating this expression in the fragment stage instead reads the
    // prototype's +Z normal, shading upward leaves as vertical surfaces.
    // Carry the hinged, instanced normal across and normalize interpolation.
    normalNode: ivyTsl.transformNormalToView(rotatedNormal).normalize()
      .toVarying('vIvyHingeNormal').normalize(),
  };
}

const IVY_HINGE_WEBGL_CACHE_KEY = 'seedthree-ivy-petiole-hinge-v2';

const IVY_HINGE_WEBGL_DECLARATIONS = `
attribute vec4 aIvyRootPhase;
attribute vec4 aIvyHinge;
uniform float uIvyTime;
uniform float uIvyWindSpeed;
uniform float uIvyWindStrength;

vec3 rotateIvyAroundAxis( vec3 value, vec3 axis, float angle ) {
  float cosine = cos( angle );
  float sine = sin( angle );
  return value * cosine
    + cross( axis, value ) * sine
    + axis * dot( axis, value ) * ( 1.0 - cosine );
}

float ivyHingeAngle( vec4 rootPhase, vec4 hinge ) {
  float hingeLength = length( hinge.xyz );
  if ( hingeLength < 0.00001 ) return 0.0;
  vec3 rootWorld = ( modelMatrix * vec4( rootPhase.xyz, 1.0 ) ).xyz;
  float time = uIvyTime * uIvyWindSpeed;
  float spatialPhase = rootWorld.x * 0.35 + rootWorld.z * 0.27;
  float gust = sin( time * 1.15 + spatialPhase ) * 0.72
    + sin( time * 2.63 + spatialPhase * 1.9 ) * 0.28;
  float distanceToCamera = distance( cameraPosition, rootWorld );
  float macroFade = 1.0 - smoothstep(
    ${IVY_HINGE_MACRO_FADE_START.toFixed(1)},
    ${IVY_HINGE_MACRO_FADE_END.toFixed(1)},
    distanceToCamera
  ) * ${(1 - IVY_HINGE_MACRO_FAR_SCALE).toFixed(2)};
  float flutterFade = 1.0 - smoothstep(
    ${IVY_HINGE_FLUTTER_FADE_START.toFixed(1)},
    ${IVY_HINGE_FLUTTER_FADE_END.toFixed(1)},
    distanceToCamera
  );
  float flutterGate = smoothstep( 0.05, 0.12, hinge.w );
  float flutter = sin( time * 5.2 + rootPhase.w )
    * 0.18 * flutterGate * flutterFade;
  return clamp(
    ( gust * macroFade + flutter ) * uIvyWindStrength * hinge.w,
    -0.12,
    0.28
  );
}
`;

/** Classic WebGL fallback for the same SeedThree clock and hinge attributes. */
export function applyIvyLeafHingeWebGLWind(material: THREE.Material): void {
  chainMaterialShaderPatch(material, IVY_HINGE_WEBGL_CACHE_KEY, (shader) => {
    shader.uniforms.uIvyTime = worldAnimationTime as unknown as THREE.IUniform;
    shader.uniforms.uIvyWindSpeed = windSpeed as unknown as THREE.IUniform;
    shader.uniforms.uIvyWindStrength = windStrength as unknown as THREE.IUniform;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n${IVY_HINGE_WEBGL_DECLARATIONS}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
float ivyAngle = ivyHingeAngle( aIvyRootPhase, aIvyHinge );
objectNormal = rotateIvyAroundAxis( objectNormal, vec3( 1.0, 0.0, 0.0 ), ivyAngle );`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
transformed = rotateIvyAroundAxis(
  transformed,
  vec3( 1.0, 0.0, 0.0 ),
  ivyAngle
);`,
    );
  });
  material.needsUpdate = true;
}

/**
 * Full procedural shrub wind. The prototype baker writes aRootWeight from the
 * plant's ground contact to its crown, so wood and spray groups share one
 * coherent rooted bend even after the SeedThree foliage instances are baked.
 */
export function createRootedGeometryWindPosition(ampScale = 0.08): TslNode {
  const local = tsl.positionLocal;
  const rootWeight = tsl.attribute('aRootWeight', 'float');
  const amp = tsl.windStrength.mul(ampScale);
  const anchorWorld = tsl.attribute('aAnchorPos', 'vec3');
  const gust = swayAt(anchorWorld, 2).mul(amp);
  const jitterT = tsl.time
    .mul(tsl.windSpeed)
    .mul(2.7)
    .add(anchorWorld.z.mul(1.7))
    .add(anchorWorld.x.mul(1.3));
  const bend = gust.add(tsl.sin(jitterT).mul(amp).mul(0.12)).mul(rootWeight);
  // NodeMaterial evaluates positionNode after the instance matrix. Use the
  // world-facing direction directly; classic WebGL still consumes the
  // inverse-instance aWindVec before its instance matrix is applied.
  const windWorld = tsl.vec3(WIND_DIR.x, WIND_DIR.y, WIND_DIR.z);
  return tsl.vec3(
    local.x.add(windWorld.x.mul(bend)),
    local.y,
    local.z.add(windWorld.z.mul(bend)),
  );
}

/** Classic WebGL parity for the rooted SeedThree shrub bend. */
export function applyRootedGeometryWebGLWind(
  material: THREE.Material,
  amplitude = 0.08,
): void {
  const cacheAmplitude = amplitude.toFixed(3);
  chainMaterialShaderPatch(
    material,
    `seedthree-rooted-geometry-wind-${cacheAmplitude}`,
    (shader) => {
      shader.uniforms.uRootedWindTime = worldAnimationTime as unknown as THREE.IUniform;
      shader.uniforms.uRootedWindSpeed = windSpeed as unknown as THREE.IUniform;
      shader.uniforms.uRootedWindStrength = windStrength as unknown as THREE.IUniform;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
attribute float aRootWeight;
attribute vec3 aAnchorPos;
attribute vec3 aWindVec;
uniform float uRootedWindTime;
uniform float uRootedWindSpeed;
uniform float uRootedWindStrength;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float rootedWindTime = uRootedWindTime * uRootedWindSpeed;
float rootedWindPhase = aAnchorPos.x * 0.70 + aAnchorPos.z * 0.54;
float rootedWindGust = sin( rootedWindTime * 1.15 + rootedWindPhase ) * 0.72
  + sin( rootedWindTime * 2.63 + rootedWindPhase * 1.9 ) * 0.28;
float rootedWindJitter = sin(
  rootedWindTime * 2.7 + aAnchorPos.z * 1.7 + aAnchorPos.x * 1.3
) * 0.12;
float rootedWindBend = ( rootedWindGust + rootedWindJitter )
  * uRootedWindStrength * ${cacheAmplitude} * aRootWeight;
transformed.x += aWindVec.x * rootedWindBend;
transformed.z += aWindVec.z * rootedWindBend;`,
      );
    },
  );
  material.needsUpdate = true;
}

/**
 * Baked dogwood foliage keeps SeedThree's fork-continuous anchor weight and
 * per-leaf random phase. Base sway exactly matches the woody group; the two
 * detuned tip terms are multiplied by UV.y², so the petiole edge remains
 * welded while the blade visibly responds to gusts.
 */
export function createRootedDogwoodFoliageWindPosition(
  rootAmplitude = DOGWOOD_ROOT_SWAY_AMPLITUDE,
  flutterAmplitude = DOGWOOD_LEAF_FLUTTER_AMPLITUDE,
): TslNode {
  const local = tsl.positionLocal;
  const rootWeight = tsl.attribute('aRootWeight', 'float');
  const leafPhase = tsl.attribute('aLeafPhase', 'float');
  const anchorWorld = tsl.attribute('aAnchorPos', 'vec3');
  const windWorld = tsl.vec3(WIND_DIR.x, WIND_DIR.y, WIND_DIR.z);
  const time = tsl.time.mul(tsl.windSpeed);
  const rootScale = tsl.windStrength.mul(rootAmplitude);
  const rootJitterTime = time
    .mul(2.7)
    .add(anchorWorld.z.mul(1.7))
    .add(anchorWorld.x.mul(1.3));
  const base = swayAt(anchorWorld, 2)
    .mul(rootScale)
    .add(tsl.sin(rootJitterTime).mul(rootScale).mul(0.12))
    .mul(rootWeight);
  const flutterTime = time
    .mul(5.2)
    .add(leafPhase.mul(DOGWOOD_LEAF_PHASE_MULTIPLIER));
  const tip = tsl.uv().y.mul(tsl.uv().y);
  const gate = (rootWeight.mul(DOGWOOD_LEAF_WEIGHT_GATE) as ClampedTslNode).clamp(0, 1);
  // aLeafPhase is SeedThree's original 0.4..1 aThickness random. It drives
  // both detuned timing and amplitude, while normalized card UV replaces the
  // source card's pre-bake local height.
  const flutterScale = tsl.windStrength
    .mul(flutterAmplitude)
    .mul(leafPhase)
    .mul(tip)
    .mul(gate);
  const longitudinal = tsl.sin(flutterTime).mul(flutterScale);
  const vertical = tsl.sin(flutterTime.mul(1.31)).mul(0.6).mul(flutterScale);
  const lateral = tsl.sin(flutterTime.mul(0.77)).mul(flutterScale);
  const along = base.add(longitudinal);
  return tsl.vec3(
    local.x.add(windWorld.x.mul(along)).add(windWorld.z.mul(lateral).mul(-1)),
    local.y.add(vertical),
    local.z.add(windWorld.z.mul(along)).add(windWorld.x.mul(lateral)),
  );
}

export type DogwoodFoliageWindSample = {
  baseSway: number;
  longitudinalFlutter: number;
  verticalFlutter: number;
  lateralFlutter: number;
};

/** CPU mirror used by deterministic motion regressions. */
export function sampleDogwoodFoliageWind(options: {
  timeSeconds: number;
  windSpeedValue: number;
  windStrengthValue: number;
  anchorX: number;
  anchorZ: number;
  rootWeight: number;
  leafPhase: number;
  uvY: number;
  rootAmplitude?: number;
  flutterAmplitude?: number;
}): DogwoodFoliageWindSample {
  if (options.windStrengthValue === 0) {
    return {
      baseSway: 0,
      longitudinalFlutter: 0,
      verticalFlutter: 0,
      lateralFlutter: 0,
    };
  }
  const time = options.timeSeconds * options.windSpeedValue;
  const phase = (options.anchorX * 0.35 + options.anchorZ * 0.27) * 2;
  const gust = Math.sin(time * 1.15 + phase) * 0.72
    + Math.sin(time * 2.63 + phase * 1.9) * 0.28;
  const rootAmplitude = options.rootAmplitude ?? DOGWOOD_ROOT_SWAY_AMPLITUDE;
  const flutterAmplitude = options.flutterAmplitude ?? DOGWOOD_LEAF_FLUTTER_AMPLITUDE;
  const jitter = Math.sin(
    time * 2.7 + options.anchorZ * 1.7 + options.anchorX * 1.3,
  ) * 0.12;
  const baseSway = (gust + jitter)
    * options.windStrengthValue * rootAmplitude * options.rootWeight;
  const flutterTime = time * 5.2
    + options.leafPhase * DOGWOOD_LEAF_PHASE_MULTIPLIER;
  const tip = THREE.MathUtils.clamp(options.uvY, 0, 1) ** 2;
  const gate = THREE.MathUtils.clamp(options.rootWeight * DOGWOOD_LEAF_WEIGHT_GATE, 0, 1);
  const scale = options.windStrengthValue
    * flutterAmplitude * options.leafPhase * tip * gate;
  const longitudinalFlutter = scale === 0 ? 0 : Math.sin(flutterTime) * scale;
  const verticalFlutter = scale === 0
    ? 0
    : Math.sin(flutterTime * 1.31) * 0.6 * scale;
  const lateralFlutter = scale === 0
    ? 0
    : Math.sin(flutterTime * 0.77) * scale;
  return {
    baseSway,
    longitudinalFlutter,
    verticalFlutter,
    lateralFlutter,
  };
}
