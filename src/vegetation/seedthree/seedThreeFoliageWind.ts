import {
  attribute,
  cameraPosition,
  cos,
  float,
  modelWorldMatrix,
  normalLocal,
  positionLocal,
  sin,
  smoothstep,
  step,
  transformNormalToView,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import * as THREE from 'three';
import { worldAnimationTime } from '../../scene/worldAnimationTime.ts';
import { chainMaterialShaderPatch } from '../../scene/materialShaderPatch.ts';

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  clamp: (minimum: unknown, maximum: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
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
  step: step as (edge: unknown, value: unknown) => IvyTslNode,
  time: worldAnimationTime as unknown as IvyTslNode,
  transformNormalToView: transformNormalToView as (value: unknown) => IvyTslNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => IvyTslNode,
  windSpeed: windSpeed as unknown as IvyTslNode,
  windStrength: windStrength as unknown as IvyTslNode,
};

export const IVY_HINGE_ACTIVE_Y_THRESHOLD = -1_000;
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
 * Individually rooted forest-floor ivy leaves. The broad carrier sheets write
 * zero hinge amplitude and remain terrain-welded; every explicit leaf repeats
 * its own root, hinge axis, phase, and maximum rotation on its vertices. This
 * is a rigid petiole hinge, so the root cannot slide and the leaf does not
 * stretch like a height-field sheet.
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
  // Hidden tree-owned ranges move only `position.y` to the sentinel. Gating
  // before rotation prevents a retained root attribute creating a 10 km arm.
  const active = ivyTsl.step(IVY_HINGE_ACTIVE_Y_THRESHOLD, local.y);
  const angle = gust.add(flutter)
    .mul(ivyTsl.windStrength)
    .mul(hinge.w)
    .mul(active)
    .clamp(-0.12, 0.28);
  const rotatedPosition = rotateAroundAxis(local.sub(rootPhase.xyz), axis, angle)
    .add(rootPhase.xyz);
  const rotatedNormal = rotateAroundAxis(ivyTsl.normalLocal, axis, angle).normalize();

  return {
    positionNode: rotatedPosition,
    normalNode: ivyTsl.transformNormalToView(rotatedNormal).normalize(),
  };
}

const IVY_HINGE_WEBGL_CACHE_KEY = 'seedthree-ivy-petiole-hinge-v1';

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

float ivyHingeAngle( vec3 objectPosition, vec4 rootPhase, vec4 hinge ) {
  float hingeLength = length( hinge.xyz );
  if ( hingeLength < 0.00001 || objectPosition.y < ${IVY_HINGE_ACTIVE_Y_THRESHOLD.toFixed(1)} ) return 0.0;
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
vec3 ivyAxis = aIvyHinge.xyz / max( length( aIvyHinge.xyz ), 0.00001 );
float ivyAngle = ivyHingeAngle( position, aIvyRootPhase, aIvyHinge );
objectNormal = rotateIvyAroundAxis( objectNormal, ivyAxis, ivyAngle );`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
transformed = aIvyRootPhase.xyz
  + rotateIvyAroundAxis( transformed - aIvyRootPhase.xyz, ivyAxis, ivyAngle );`,
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
  const windLocal = tsl.attribute('aWindVec', 'vec3');
  return tsl.vec3(
    local.x.add(windLocal.x.mul(bend)),
    local.y,
    local.z.add(windLocal.z.mul(bend)),
  );
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
  const windLocal = tsl.attribute('aWindVec', 'vec3');
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
    .add(leafPhase.mul(DOGWOOD_LEAF_PHASE_MULTIPLIER))
    .add(local.x.mul(2.1))
    .add(local.z.mul(1.7));
  const tip = tsl.uv().y.mul(tsl.uv().y);
  const gate = rootWeight.mul(DOGWOOD_LEAF_WEIGHT_GATE).clamp(0, 1);
  const flutterScale = tsl.windStrength.mul(flutterAmplitude).mul(tip).mul(gate);
  const longitudinal = tsl.sin(flutterTime)
    .add(tsl.sin(flutterTime.mul(1.31)).mul(0.35))
    .mul(flutterScale);
  const lateral = tsl.sin(flutterTime.mul(0.77)).mul(0.55).mul(flutterScale);
  const along = base.add(longitudinal);
  return tsl.vec3(
    local.x.add(windLocal.x.mul(along)).sub(windLocal.z.mul(lateral)),
    local.y,
    local.z.add(windLocal.z.mul(along)).add(windLocal.x.mul(lateral)),
  );
}

export type DogwoodFoliageWindSample = {
  baseSway: number;
  longitudinalFlutter: number;
  lateralFlutter: number;
};

/** CPU mirror used by deterministic motion regressions. */
export function sampleDogwoodFoliageWind(options: {
  timeSeconds: number;
  windSpeedValue: number;
  windStrengthValue: number;
  anchorX: number;
  anchorZ: number;
  localX: number;
  localZ: number;
  rootWeight: number;
  leafPhase: number;
  uvY: number;
  rootAmplitude?: number;
  flutterAmplitude?: number;
}): DogwoodFoliageWindSample {
  if (options.windStrengthValue === 0) {
    return { baseSway: 0, longitudinalFlutter: 0, lateralFlutter: 0 };
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
    + options.leafPhase * DOGWOOD_LEAF_PHASE_MULTIPLIER
    + options.localX * 2.1
    + options.localZ * 1.7;
  const tip = THREE.MathUtils.clamp(options.uvY, 0, 1) ** 2;
  const gate = THREE.MathUtils.clamp(options.rootWeight * DOGWOOD_LEAF_WEIGHT_GATE, 0, 1);
  const scale = options.windStrengthValue * flutterAmplitude * tip * gate;
  const longitudinalFlutter = scale === 0 ? 0 : (
    Math.sin(flutterTime) + Math.sin(flutterTime * 1.31) * 0.35
  ) * scale;
  const lateralFlutter = scale === 0
    ? 0
    : Math.sin(flutterTime * 0.77) * 0.55 * scale;
  return {
    baseSway,
    longitudinalFlutter,
    lateralFlutter,
  };
}
