import * as THREE from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import {
  abs,
  distance,
  float,
  mix,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/src/Three.TSL.js';

export const FIRE_EFFECT_FLAMES_NAME = 'FireEffectFlames';
export const FIRE_EFFECT_SMOKE_NAME = 'FireEffectSmoke';
export const FIRE_EFFECT_SPARKS_NAME = 'FireEffectSparks';
export const FIRE_EFFECT_LIGHT_NAME = 'FireEffectLight';

type TslNode = {
  x: TslNode;
  y: TslNode;
  add(value: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

type ScalarUniform = {
  value: number;
};

type AnimatedFlame = {
  sprite: THREE.Sprite;
  phase: number;
  baseWidth: number;
  baseHeight: number;
  x: number;
  z: number;
};

type AnimatedSmoke = {
  sprite: THREE.Sprite;
  opacity: ScalarUniform;
  phase: number;
};

type AnimatedSpark = {
  mesh: THREE.Mesh;
  phase: number;
};

export type FireEffectOptions = {
  name?: string;
  scale?: number;
  intensity?: number;
  nightLighting?: number;
  spread?: number;
  flameCount?: number;
  smokeCount?: number;
  smokeRise?: number;
  smokeDrift?: number;
  smokeOpacity?: number;
  lightDistance?: number;
  lightIntensity?: number;
  withSparks?: boolean;
};

export type FireEffect = {
  root: THREE.Group;
  flames: AnimatedFlame[];
  smoke: AnimatedSmoke[];
  sparks: AnimatedSpark[];
  light: THREE.PointLight;
  elapsedSeconds: number;
  intensity: number;
  nightLighting: number;
  spread: number;
  smokeRise: number;
  smokeDrift: number;
  smokeOpacity: number;
  lightIntensity: number;
  active: boolean;
};

const effectsByRoot = new WeakMap<THREE.Group, FireEffect>();
const SPARK_GEOMETRY = new THREE.DodecahedronGeometry(0.035, 0);
const SPARK_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffb34d,
  toneMapped: false,
});
SPARK_MATERIAL.userData.sharedBuildingMaterial = true;

/**
 * Creates the shared fire presentation used by campfires and structural fires.
 * TSL node materials keep the procedural flame/smoke shader compatible with
 * both the native WebGPU and node-based WebGL renderer backends.
 */
export function createFireEffect(options: FireEffectOptions = {}): FireEffect {
  const root = new THREE.Group();
  root.name = options.name ?? 'Reusable fire effect';
  root.scale.setScalar(options.scale ?? 1);
  root.userData.fpNoCollision = true;

  const flamesRoot = new THREE.Group();
  flamesRoot.name = FIRE_EFFECT_FLAMES_NAME;
  root.add(flamesRoot);

  const flameCount = Math.max(1, Math.floor(options.flameCount ?? 5));
  const spread = Math.max(0.05, options.spread ?? 0.65);
  const flames: AnimatedFlame[] = [];
  for (let index = 0; index < flameCount; index += 1) {
    const phase = index * 1.913;
    const angle = index * 2.399;
    const radial = index === 0 ? 0 : spread * (0.24 + (index % 3) * 0.13);
    const baseWidth = index === 0 ? 0.92 : 0.58 + (index % 2) * 0.12;
    const baseHeight = index === 0 ? 1.65 : 0.92 + (index % 3) * 0.16;
    const sprite = new THREE.Sprite(createFlameMaterial(phase) as unknown as THREE.SpriteMaterial);
    sprite.name = 'Animated fire flame';
    sprite.center.set(0.5, 0.08);
    sprite.position.set(
      Math.cos(angle) * radial,
      0.22,
      Math.sin(angle) * radial,
    );
    sprite.scale.set(baseWidth, baseHeight, 1);
    sprite.renderOrder = 18;
    sprite.frustumCulled = false;
    flamesRoot.add(sprite);
    flames.push({
      sprite,
      phase,
      baseWidth,
      baseHeight,
      x: sprite.position.x,
      z: sprite.position.z,
    });
  }

  const smokeRoot = new THREE.Group();
  smokeRoot.name = FIRE_EFFECT_SMOKE_NAME;
  root.add(smokeRoot);

  const smokeCount = Math.max(0, Math.floor(options.smokeCount ?? 7));
  const smoke: AnimatedSmoke[] = [];
  for (let index = 0; index < smokeCount; index += 1) {
    const opacity = uniform(0) as ScalarUniform;
    const phase = index * 2.173;
    const sprite = new THREE.Sprite(
      createSmokeMaterial(phase, opacity) as unknown as THREE.SpriteMaterial,
    );
    sprite.name = 'Animated fire smoke';
    sprite.renderOrder = 17;
    sprite.frustumCulled = false;
    smokeRoot.add(sprite);
    smoke.push({ sprite, opacity, phase });
  }

  const sparksRoot = new THREE.Group();
  sparksRoot.name = FIRE_EFFECT_SPARKS_NAME;
  root.add(sparksRoot);

  const sparks: AnimatedSpark[] = [];
  if (options.withSparks !== false) {
    for (let index = 0; index < 7; index += 1) {
      const mesh = new THREE.Mesh(SPARK_GEOMETRY, SPARK_MATERIAL);
      mesh.name = 'Animated fire spark';
      mesh.renderOrder = 19;
      mesh.frustumCulled = false;
      sparksRoot.add(mesh);
      sparks.push({ mesh, phase: index * 2.17 });
    }
  }

  const light = new THREE.PointLight(
    0xff7430,
    0,
    options.lightDistance ?? 15,
    1.7,
  );
  light.name = FIRE_EFFECT_LIGHT_NAME;
  light.position.y = 0.9;
  root.add(light);

  const effect: FireEffect = {
    root,
    flames,
    smoke,
    sparks,
    light,
    elapsedSeconds: 0,
    intensity: THREE.MathUtils.clamp(options.intensity ?? 1, 0, 1),
    nightLighting: THREE.MathUtils.clamp(options.nightLighting ?? 1, 0, 1),
    spread,
    smokeRise: Math.max(0.5, options.smokeRise ?? 4.4),
    smokeDrift: Math.max(0, options.smokeDrift ?? 0.9),
    smokeOpacity: THREE.MathUtils.clamp(options.smokeOpacity ?? 0.32, 0, 1),
    lightIntensity: Math.max(0, options.lightIntensity ?? 11),
    active: true,
  };
  effectsByRoot.set(root, effect);
  updateFireEffect(effect, 0);
  return effect;
}

export function fireEffectFromRoot(root: THREE.Group): FireEffect | null {
  return effectsByRoot.get(root) ?? null;
}

export function setFireEffectNightLighting(
  effectOrRoot: FireEffect | THREE.Group,
  nightLighting: number,
): void {
  const effect = resolveEffect(effectOrRoot);
  if (!effect) return;
  effect.nightLighting = THREE.MathUtils.clamp(nightLighting, 0, 1);
}

export function setFireEffectActive(
  effectOrRoot: FireEffect | THREE.Group,
  active: boolean,
): void {
  const effect = resolveEffect(effectOrRoot);
  if (!effect) return;
  effect.active = active;
  effect.root.visible = active;
  if (!active) effect.light.intensity = 0;
}

export function updateFireEffect(
  effectOrRoot: FireEffect | THREE.Group,
  dtSeconds: number,
  intensity = resolveEffect(effectOrRoot)?.intensity ?? 1,
): void {
  const effect = resolveEffect(effectOrRoot);
  if (!effect || !effect.active) return;

  effect.elapsedSeconds += Math.max(0, dtSeconds);
  effect.intensity = THREE.MathUtils.clamp(intensity, 0, 1);
  const elapsed = effect.elapsedSeconds;
  const strength = 0.38 + effect.intensity * 0.62;

  for (const [index, flame] of effect.flames.entries()) {
    const flicker = 0.9
      + Math.sin(elapsed * (8.2 + index * 0.47) + flame.phase) * 0.105
      + Math.sin(elapsed * 13.7 + flame.phase * 1.8) * 0.045;
    const breathe = 1 + Math.sin(elapsed * 5.1 + flame.phase) * 0.06;
    flame.sprite.scale.set(
      flame.baseWidth * strength * (1.04 + (1 - flicker) * 0.34),
      flame.baseHeight * strength * Math.max(0.56, flicker) * breathe,
      1,
    );
    flame.sprite.position.set(
      flame.x + Math.sin(elapsed * 3.4 + flame.phase) * 0.045,
      0.22,
      flame.z + Math.cos(elapsed * 3.1 + flame.phase) * 0.035,
    );
  }

  for (const [index, puff] of effect.smoke.entries()) {
    const age = (
      elapsed * (0.11 + effect.intensity * 0.08)
      + index / Math.max(1, effect.smoke.length)
    ) % 1;
    const curl = age * 5.2 + puff.phase;
    puff.sprite.position.set(
      Math.sin(curl) * effect.smokeDrift * (0.08 + age * 0.58)
        + age * effect.smokeDrift * 0.28,
      0.95 + age * effect.smokeRise,
      Math.cos(curl * 0.83) * effect.smokeDrift * (0.06 + age * 0.42),
    );
    const smokeScale = (0.42 + age * 1.55) * (0.72 + effect.intensity * 0.35);
    puff.sprite.scale.set(smokeScale * 1.18, smokeScale, 1);
    puff.opacity.value = effect.smokeOpacity
      * Math.sin(Math.PI * age)
      * (0.42 + effect.intensity * 0.58)
      * (0.84 + effect.nightLighting * 0.28);
  }

  for (const [index, spark] of effect.sparks.entries()) {
    const age = (
      elapsed * (0.36 + effect.intensity * 0.22)
      + index / Math.max(1, effect.sparks.length)
    ) % 1;
    const angle = spark.phase + elapsed * 0.76;
    spark.mesh.visible = effect.intensity > 0.18 && age < 0.76;
    spark.mesh.position.set(
      Math.cos(angle) * (0.08 + age * effect.spread * 0.52),
      0.5 + age * (1.35 + effect.intensity * 0.7),
      Math.sin(angle) * (0.08 + age * effect.spread * 0.42),
    );
    spark.mesh.scale.setScalar(0.72 + (1 - age) * 0.58);
  }

  const flicker = Math.sin(elapsed * 10.9) * 0.08 + Math.sin(elapsed * 17.3) * 0.035;
  effect.light.intensity = Math.max(
    0,
    effect.lightIntensity
      * effect.intensity
      * (0.18 + effect.nightLighting * 0.82)
      * (1 + flicker),
  );
}

export function disposeFireEffect(effectOrRoot: FireEffect | THREE.Group): void {
  const effect = resolveEffect(effectOrRoot);
  if (!effect) return;
  for (const flame of effect.flames) flame.sprite.material.dispose();
  for (const puff of effect.smoke) puff.sprite.material.dispose();
  effectsByRoot.delete(effect.root);
  effect.root.removeFromParent();
}

function resolveEffect(effectOrRoot: FireEffect | THREE.Group): FireEffect | null {
  return effectOrRoot instanceof THREE.Group
    ? effectsByRoot.get(effectOrRoot) ?? null
    : effectOrRoot;
}

function createFlameMaterial(phase: number): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial();
  material.name = 'Procedural reusable fire shader';
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;

  const cardUv = uv() as TslNode;
  const animatedTime = (time as TslNode).mul(float(7.1)).add(float(phase));
  const risingWave = sin(
    cardUv.y.mul(float(13)).sub(animatedTime),
  ) as TslNode;
  const fineWave = sin(
    cardUv.y.mul(float(25)).add(animatedTime.mul(float(1.37))),
  ) as TslNode;
  const center = cardUv.x
    .sub(float(0.5))
    .sub(risingWave.mul(float(0.055)))
    .sub(fineWave.mul(float(0.018)));
  const invertedY = (float(1) as TslNode).sub(cardUv.y);
  const halfWidth = pow(invertedY, float(0.72)) as TslNode;
  const shapedWidth = halfWidth.mul(float(0.39)).add(float(0.035));
  const sideMask = smoothstep(
    shapedWidth,
    shapedWidth.sub(float(0.075)),
    abs(center),
  ) as TslNode;
  const lickingWave = sin(
    cardUv.x.mul(float(19)).add(animatedTime.mul(float(0.82))),
  ) as TslNode;
  const lickingTop = cardUv.y.add(lickingWave.mul(float(0.08)));
  const topMask = smoothstep(float(1.04), float(0.7), lickingTop) as TslNode;
  const baseMask = smoothstep(float(0), float(0.09), cardUv.y) as TslNode;
  const opacity = sideMask.mul(topMask).mul(baseMask);
  const core = pow(invertedY, float(1.55)) as TslNode;
  material.colorNode = mix(
    vec3(1, 0.12, 0.015),
    vec3(1, 0.92, 0.31),
    core,
  );
  material.opacityNode = opacity.mul(float(0.9));
  return material;
}

function createSmokeMaterial(
  phase: number,
  opacity: ScalarUniform,
): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial();
  material.name = 'Procedural reusable fire smoke shader';
  material.transparent = true;
  material.depthWrite = false;
  material.premultipliedAlpha = true;
  material.toneMapped = false;

  const cardUv = uv() as TslNode;
  const animatedTime = (time as TslNode).mul(float(0.38)).add(float(phase));
  const radial = distance(cardUv, vec2(0.5)) as TslNode;
  const edgeNoise = sin(
    cardUv.x.mul(float(18))
      .add(cardUv.y.mul(float(23)))
      .add(animatedTime),
  ) as TslNode;
  const softBody = smoothstep(
    float(0.52),
    float(0.25),
    radial.add(edgeNoise.mul(float(0.026))),
  ) as TslNode;
  const mottling = sin(
    cardUv.x.mul(float(11))
      .sub(cardUv.y.mul(float(16)))
      .sub(animatedTime.mul(float(1.7))),
  ) as TslNode;
  material.colorNode = mix(
    vec3(0.12, 0.115, 0.105),
    vec3(0.29, 0.285, 0.27),
    mottling.mul(float(0.16)).add(float(0.52)),
  );
  material.opacityNode = softBody.mul(opacity);
  return material;
}
