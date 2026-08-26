import * as THREE from 'three';
import * as TSL from 'three/tsl';
import {
  isPainterlyVegetationEnabled,
  subscribePainterlyVegetationPreference,
} from '../../scene/painterlyVegetationPreference.ts';
import {
  createPaintTexture,
  type PaintTextureMetadata,
  type PaintTextureResult,
} from './paintTexture.ts';

export type PainterlyVegetationRole =
  | 'bark'
  | 'deciduous-leaf'
  | 'evergreen-leaf'
  | 'shrub-leaf'
  | 'ground-cover'
  | 'twig'
  | 'terrain-ground'
  | 'road-ground'
  | 'river-bank'
  | 'grass-blade';

export type PainterlyVegetationOptions = {
  textureScale?: number;
  nativeLightWeight?: number;
  /** Lower-cost AO used while paint owns the terrain's micro-occlusion response. */
  aoNodeWhilePainted?: unknown;
};

type TslNode = {
  a: TslNode; b: TslNode; g: TslNode; r: TslNode; rgb: TslNode;
  x: TslNode; y: TslNode; z: TslNode;
  abs(): TslNode;
  add(value: unknown): TslNode;
  clamp(minimum?: unknown, maximum?: unknown): TslNode;
  div(value: unknown): TslNode;
  dot(value: unknown): TslNode;
  max(value: unknown): TslNode;
  mul(value: unknown): TslNode;
  oneMinus(): TslNode;
  pow(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};
type TslUniform<T> = TslNode & { value: T };

type PainterlyNodeMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  roughness?: number;
  colorNode?: TslNode | null;
  normalNode?: TslNode | null;
  roughnessNode?: TslNode | null;
  aoNode?: TslNode | null;
  setupOutput?: (builder: unknown, outputNode: TslNode) => TslNode;
};
type OriginalMaterialState = {
  colorNode: TslNode | null;
  normalNode: TslNode | null;
  roughnessNode: TslNode | null;
  aoNode: TslNode | null;
  setupOutput: ((builder: unknown, outputNode: TslNode) => TslNode) | undefined;
  hadOwnSetupOutput: boolean;
};
type PainterlyRecord = {
  material: PainterlyNodeMaterial;
  role: PainterlyVegetationRole;
  options: PainterlyVegetationOptions;
  original: OriginalMaterialState;
  installed: boolean;
  disposeListener: () => void;
};
type PainterlyProfile = {
  dark: THREE.Color;
  light: THREE.Color;
  rim: THREE.Color;
  reflectionDark: THREE.Color;
  reflectionLight: THREE.Color;
  paletteWeight: number;
  normalWeight: number;
  strokeWeight: number;
  textureScale: number;
  nativeLightWeight: number;
  treatment: 'vegetation' | 'ground';
  coordinateSpace: 'uv' | 'world-ground';
};

const tsl = TSL as unknown as {
  TBNViewMatrix: TslNode;
  float(value: unknown): TslNode;
  floor(value: unknown): TslNode;
  instanceIndex: TslNode;
  materialNormal: TslNode;
  materialRoughness: TslNode;
  mix(left: unknown, right: unknown, amount: unknown): TslNode;
  normalize(value: unknown): TslNode;
  normalView: TslNode;
  normalWorld: TslNode;
  positionWorld: TslNode;
  positionViewDirection: TslNode;
  sin(value: unknown): TslNode;
  smoothstep(low: unknown, high: unknown, value: unknown): TslNode;
  texture(map: THREE.Texture, uvNode?: unknown): TslNode;
  uniform<T>(value: T): TslUniform<T>;
  uv(): TslNode;
  vec2(x: unknown, y?: unknown): TslNode;
  vec3(x: unknown, y?: unknown, z?: unknown): TslNode;
  vec4(x: unknown, y?: unknown, z?: unknown, w?: unknown): TslNode;
};

const paintTextureSettings = Object.freeze({
  size: 512,
  seed: 73021,
  broadStrokeCount: 56,
  detailStrokeCount: 184,
  bristleDensity: 1,
  normalStrength: 3.8,
});
export const PAINTERLY_GROUND_SETTINGS = Object.freeze({
  brushScale: 2.2,
  sourceAlbedoWeight: 1,
  normalStrength: 1.16,
  strokeContrast: 0.92,
  detailStrength: 1.5,
  shadowThreshold: -0.61,
  lightThreshold: 0.36,
  bandSoftness: 0.075,
  shadowValue: 0.16,
  midtoneValue: 0.33,
  oilStrength: 0.06,
  oilThreshold: 0.34,
  nativeSheen: 0.04,
  roughnessVariation: 0.32,
  rimStrength: 0.18,
  rimPower: 5,
});
let paintTextureResult: PaintTextureResult | null = null;

const lightDirection = tsl.uniform(new THREE.Vector3(-0.45, 0.82, 0.34).normalize());
const profiles: Record<PainterlyVegetationRole, PainterlyProfile> = {
  bark: profile('#17171a', '#9d9589', '#f0bd85', 0.64, 0.82, 0.9, 1.7, 0.08),
  twig: profile('#17171a', '#9d9589', '#e5c6a2', 0.58, 0.72, 0.84, 2.4, 0.08),
  'deciduous-leaf': profile('#0b2012', '#6f9d3b', '#f6bd5d', 0.38, 0.46, 0.72, 1.18, 0.22),
  'evergreen-leaf': profile('#0a1710', '#55713b', '#d7c769', 0.34, 0.4, 0.64, 1.28, 0.24),
  'shrub-leaf': profile('#0b2012', '#6f9d3b', '#f6bd5d', 0.42, 0.48, 0.76, 1.34, 0.24),
  'ground-cover': profile('#0a1a0e', '#648b39', '#e1dc78', 0.34, 0.38, 0.66, 1.46, 0.28),
  // The texture-study export uses palette three but sourceAlbedoWeight=1.
  // These profiles therefore preserve the authored terrain/road pigments and
  // use the palette only for the very light oil/rim response.
  'terrain-ground': groundProfile('world-ground'),
  'road-ground': groundProfile('world-ground'),
  'river-bank': groundProfile('world-ground'),
  'grass-blade': groundProfile('uv'),
};
const records = new Set<PainterlyRecord>();
const recordsByMaterial = new WeakMap<THREE.Material, PainterlyRecord>();
let enabled = isPainterlyVegetationEnabled();

subscribePainterlyVegetationPreference((nextEnabled) => {
  if (enabled === nextEnabled) return;
  enabled = nextEnabled;
  for (const record of records) {
    if (enabled) installPainterlyGraph(record);
    else restoreNativeGraph(record);
  }
});

/**
 * Register one shared vegetation material. While disabled this only records
 * the native nodes, so the default-off path compiles no painter texture work.
 */
export function applyPainterlyVegetationMaterial(
  material: THREE.Material,
  role: PainterlyVegetationRole,
  options: PainterlyVegetationOptions = {},
): THREE.Material {
  if (recordsByMaterial.has(material)) return material;
  const target = material as PainterlyNodeMaterial;
  const record: PainterlyRecord = {
    material: target,
    role,
    options: { ...options },
    original: captureOriginalState(target),
    installed: false,
    disposeListener: () => unregisterMaterial(material),
  };
  records.add(record);
  recordsByMaterial.set(material, record);
  material.addEventListener('dispose', record.disposeListener);
  material.userData.painterlyVegetationRole = role;
  material.userData.painterlyVegetationRegistered = true;
  if (enabled) installPainterlyGraph(record);
  return material;
}

/** Give a NodeMaterial clone a clean native recipe and its source paint role. */
export function inheritPainterlyVegetationMaterial(
  source: THREE.Material,
  clone: THREE.Material,
): THREE.Material {
  const sourceRecord = recordsByMaterial.get(source);
  if (!sourceRecord) return clone;
  const target = clone as PainterlyNodeMaterial;
  target.colorNode = sourceRecord.original.colorNode;
  target.normalNode = sourceRecord.original.normalNode;
  target.roughnessNode = sourceRecord.original.roughnessNode;
  target.aoNode = sourceRecord.original.aoNode;
  if (sourceRecord.original.hadOwnSetupOutput) target.setupOutput = sourceRecord.original.setupOutput;
  else delete target.setupOutput;
  return applyPainterlyVegetationMaterial(clone, sourceRecord.role, sourceRecord.options);
}

export function setPainterlyVegetationLightDirection(direction: THREE.Vector3): void {
  if (direction.lengthSq() < 1e-8) return;
  lightDirection.value.copy(direction).normalize();
}

export function getPainterlyVegetationDiagnostics(): {
  enabled: boolean;
  registeredMaterials: number;
  installedMaterials: number;
  roles: Record<string, number>;
  texture: PaintTextureMetadata | null;
} {
  const roles: Record<string, number> = {};
  let installedMaterials = 0;
  for (const record of records) {
    roles[record.role] = (roles[record.role] ?? 0) + 1;
    if (record.installed) installedMaterials += 1;
  }
  return {
    enabled,
    registeredMaterials: records.size,
    installedMaterials,
    roles,
    texture: paintTextureResult?.metadata ?? null,
  };
}

function profile(
  dark: THREE.ColorRepresentation,
  light: THREE.ColorRepresentation,
  rim: THREE.ColorRepresentation,
  paletteWeight: number,
  normalWeight: number,
  strokeWeight: number,
  textureScale: number,
  nativeLightWeight: number,
): PainterlyProfile {
  return {
    dark: new THREE.Color(dark),
    light: new THREE.Color(light),
    rim: new THREE.Color(rim),
    reflectionDark: new THREE.Color(dark),
    reflectionLight: new THREE.Color(light),
    paletteWeight,
    normalWeight,
    strokeWeight,
    textureScale,
    nativeLightWeight,
    treatment: 'vegetation',
    coordinateSpace: 'uv',
  };
}

function groundProfile(
  coordinateSpace: PainterlyProfile['coordinateSpace'],
): PainterlyProfile {
  return {
    dark: new THREE.Color('#4a858c'),
    light: new THREE.Color('#e16b72'),
    reflectionDark: new THREE.Color('#e42a23'),
    reflectionLight: new THREE.Color('#ffa55a'),
    rim: new THREE.Color('#ffd188'),
    // sourceAlbedoWeight=1 in paint-lab-texture-terrain.json.
    paletteWeight: 0,
    normalWeight: PAINTERLY_GROUND_SETTINGS.normalStrength,
    strokeWeight: 1,
    textureScale: 1,
    nativeLightWeight: PAINTERLY_GROUND_SETTINGS.nativeSheen,
    treatment: 'ground',
    coordinateSpace,
  };
}

function captureOriginalState(material: PainterlyNodeMaterial): OriginalMaterialState {
  return {
    colorNode: material.colorNode ?? null,
    normalNode: material.normalNode ?? null,
    roughnessNode: material.roughnessNode ?? null,
    aoNode: material.aoNode ?? null,
    setupOutput: material.setupOutput,
    hadOwnSetupOutput: Object.prototype.hasOwnProperty.call(material, 'setupOutput'),
  };
}

function unregisterMaterial(material: THREE.Material): void {
  const record = recordsByMaterial.get(material);
  if (!record) return;
  records.delete(record);
  recordsByMaterial.delete(material);
  material.removeEventListener('dispose', record.disposeListener);
}

function installPainterlyGraph(record: PainterlyRecord): void {
  if (record.installed) return;
  const material = record.material;
  const authored = profiles[record.role];
  const textureScale = authored.textureScale * (record.options.textureScale ?? 1);
  const nativeLightWeight = record.options.nativeLightWeight ?? authored.nativeLightWeight;
  const one = tsl.float(1);
  const paintTexture = getPaintTexture();

  // UVs stay on undeformed vegetation so wind cannot make paint swim. Ground
  // materials share one rotated world-XZ field, keeping marks continuous at
  // terrain/road/bank boundaries without another geometry attribute.
  const phaseXBase = tsl.sin(tsl.float(tsl.instanceIndex).mul(12.9898).add(78.233))
    .mul(43758.5453);
  const phaseYBase = tsl.sin(tsl.float(tsl.instanceIndex).mul(39.3467).add(11.135))
    .mul(24634.6345);
  const phase = tsl.vec2(
    phaseXBase.sub(tsl.floor(phaseXBase)),
    phaseYBase.sub(tsl.floor(phaseYBase)),
  );
  const world = tsl.positionWorld;
  const groundCoordinate = tsl.vec2(
    world.x.mul(0.67).sub(world.z.mul(0.74)),
    world.x.mul(0.74).add(world.z.mul(0.67)),
  );
  const paintUv = authored.coordinateSpace === 'world-ground'
    ? groundCoordinate.mul((PAINTERLY_GROUND_SETTINGS.brushScale / 48) * textureScale)
    : authored.treatment === 'ground'
      ? tsl.uv().mul(PAINTERLY_GROUND_SETTINGS.brushScale * textureScale).add(phase)
      : tsl.uv().mul(textureScale / 0.7).add(phase);
  const packed = tsl.texture(paintTexture, paintUv);
  const groundStrokeInset = (1 - PAINTERLY_GROUND_SETTINGS.strokeContrast) * 0.22;
  const broad = authored.treatment === 'ground'
    ? tsl.smoothstep(0.16 + groundStrokeInset, 0.84 - groundStrokeInset, packed.b)
    : tsl.smoothstep(0.2, 0.82, packed.b);
  const detail = tsl.smoothstep(0.16, 0.74, packed.a);

  const source = resolveSourceColor(material, record.original.colorNode);
  const sourceRgb = source.rgb;
  const sourceLuma = sourceRgb.x.mul(0.2126)
    .add(sourceRgb.y.mul(0.7152))
    .add(sourceRgb.z.mul(0.0722));
  const palette = tsl.mix(
    tsl.uniform(authored.dark),
    tsl.uniform(authored.light),
    tsl.smoothstep(0.05, 0.86, sourceLuma),
  );
  let pigment = tsl.mix(sourceRgb, palette, authored.paletteWeight);
  const strokeLoad = broad.mul(0.72).add(detail.mul(0.28));
  if (authored.treatment === 'ground') {
    // Matches the texture demo's PAINT_PRESERVE_SOURCE_ALBEDO branch.
    pigment = sourceRgb.mul(tsl.mix(0.58, 1.18, broad)).clamp(0, 1);
  } else {
    const strokeGain = tsl.mix(0.72, 1.16, strokeLoad);
    pigment = pigment
      .mul(tsl.mix(1, strokeGain, authored.strokeWeight))
      .max(sourceRgb.mul(0.14))
      .clamp(0, 1);
  }
  material.colorNode = tsl.vec4(pigment, source.a);

  const nx = packed.r.mul(2).sub(1);
  const ny = packed.g.mul(2).sub(1);
  const nz = one.sub(nx.mul(nx).add(ny.mul(ny))).max(0.001).pow(0.5);
  const paintNormalView = tsl.TBNViewMatrix.mul(tsl.vec3(
    nx.mul(authored.treatment === 'ground'
      ? PAINTERLY_GROUND_SETTINGS.normalStrength
      : 0.9),
    ny.mul(authored.treatment === 'ground'
      ? PAINTERLY_GROUND_SETTINGS.normalStrength
      : 0.9),
    authored.treatment === 'ground' ? 0.95 : nz,
  ));
  const mixedNormal = tsl.mix(
    record.original.normalNode ?? tsl.materialNormal,
    paintNormalView,
    authored.treatment === 'ground'
      ? authored.normalWeight
      : authored.normalWeight * 0.9,
  );
  material.normalNode = authored.treatment === 'ground'
    ? tsl.normalize(mixedNormal)
    : mixedNormal;
  material.roughnessNode = (record.original.roughnessNode
    ?? tsl.materialRoughness)
    .add(packed.a.sub(0.5).mul(authored.treatment === 'ground'
      ? PAINTERLY_GROUND_SETTINGS.roughnessVariation
      : 0.16))
    .clamp(0.12, 1);
  if (authored.treatment === 'ground' && record.options.aoNodeWhilePainted) {
    // The full terrain graph sits at WebGPU's portable sixteen-texture limit.
    // Its painter ramp owns micro-occlusion, so swap the three grass AO maps
    // for a sampler-free node while enabled. World shadows and the supplied
    // canopy AO remain active, and the native graph is restored on disable.
    material.aoNode = record.options.aoNodeWhilePainted as TslNode;
  }

  const originalSetupOutput = record.original.setupOutput;
  material.setupOutput = function setupPainterlyVegetationOutput(
    builder: unknown,
    basicOutput: TslNode,
  ): TslNode {
    if (authored.treatment === 'ground') {
      const lightFacing = tsl.normalWorld.dot(lightDirection);
      const bandNoise = packed.a.sub(0.5)
        .mul(PAINTERLY_GROUND_SETTINGS.detailStrength * 0.24);
      const noisyFacing = lightFacing.add(bandNoise);
      const midBand = tsl.smoothstep(
        PAINTERLY_GROUND_SETTINGS.shadowThreshold
          - PAINTERLY_GROUND_SETTINGS.bandSoftness,
        PAINTERLY_GROUND_SETTINGS.shadowThreshold
          + PAINTERLY_GROUND_SETTINGS.bandSoftness,
        noisyFacing,
      );
      const lightBand = tsl.smoothstep(
        PAINTERLY_GROUND_SETTINGS.lightThreshold
          - PAINTERLY_GROUND_SETTINGS.bandSoftness,
        PAINTERLY_GROUND_SETTINGS.lightThreshold
          + PAINTERLY_GROUND_SETTINGS.bandSoftness,
        noisyFacing,
      );
      const penumbraBand = tsl.smoothstep(
        PAINTERLY_GROUND_SETTINGS.shadowThreshold
          + PAINTERLY_GROUND_SETTINGS.bandSoftness * 0.35,
        PAINTERLY_GROUND_SETTINGS.shadowThreshold
          + PAINTERLY_GROUND_SETTINGS.bandSoftness * 3.2,
        noisyFacing,
      );
      const penumbraValue = tsl.mix(
        PAINTERLY_GROUND_SETTINGS.shadowValue,
        PAINTERLY_GROUND_SETTINGS.midtoneValue,
        0.46,
      );
      let toonBand = tsl.mix(
        PAINTERLY_GROUND_SETTINGS.shadowValue,
        penumbraValue,
        midBand,
      );
      toonBand = tsl.mix(
        toonBand,
        PAINTERLY_GROUND_SETTINGS.midtoneValue,
        penumbraBand,
      );
      toonBand = tsl.mix(toonBand, 0.94, lightBand);
      const shadowedPigment = pigment.mul(toonBand);
      const litPigment = pigment.mul(tsl.mix(0.92, 1.02, broad));
      const paintedDiffuse = tsl.mix(
        shadowedPigment,
        litPigment,
        lightBand.mul(0.72),
      );

      const baseLuma = pigment.x.mul(0.2126)
        .add(pigment.y.mul(0.7152))
        .add(pigment.z.mul(0.0722));
      const physicalLuma = basicOutput.rgb.x.mul(0.2126)
        .add(basicOutput.rgb.y.mul(0.7152))
        .add(basicOutput.rgb.z.mul(0.0722));
      const receiverLight = physicalLuma
        .div(baseLuma.max(0.025))
        .clamp(0, 1.6);
      const receiverModulation = tsl.mix(
        0.66,
        1.08,
        tsl.smoothstep(0.1, 1.05, receiverLight),
      );
      let resolved = tsl.mix(
        paintedDiffuse.mul(receiverModulation),
        basicOutput.rgb,
        authored.nativeLightWeight,
      );

      const oilTone = strokeLoad.clamp(0, 1);
      const oilColor = tsl.mix(
        tsl.uniform(authored.reflectionDark),
        tsl.uniform(authored.reflectionLight),
        oilTone,
      );
      const oilCoverage = tsl.smoothstep(
        PAINTERLY_GROUND_SETTINGS.oilThreshold,
        0.82,
        packed.a,
      ).mul(PAINTERLY_GROUND_SETTINGS.oilStrength);
      resolved = tsl.mix(
        resolved,
        oilColor.mul(tsl.mix(0.76, 1.24, oilTone)),
        oilCoverage,
      );
      const rim = tsl.normalWorld.dot(tsl.positionViewDirection)
        .abs().oneMinus().clamp(0, 1)
        .pow(PAINTERLY_GROUND_SETTINGS.rimPower)
        .mul(PAINTERLY_GROUND_SETTINGS.rimStrength)
        .mul(tsl.smoothstep(-0.2, 0.7, lightFacing));
      resolved = resolved.add(tsl.uniform(authored.rim).mul(rim)).clamp(0, 16);
      const finalOutput = tsl.vec4(resolved, basicOutput.a);
      return originalSetupOutput
        ? originalSetupOutput.call(this, builder, finalOutput)
        : finalOutput;
    }

    // Existing light, shadow, snow, and SSS remain the receiver. The exported
    // thresholds only shape broad bands and the warm grazing-angle rim.
    const lightFacing = tsl.normalWorld.dot(lightDirection);
    const shadowBand = tsl.smoothstep(-0.675, -0.605, lightFacing);
    const lightBand = tsl.smoothstep(0.225, 0.295, lightFacing);
    let bandGain = tsl.mix(0.62, 0.9, shadowBand);
    bandGain = tsl.mix(bandGain, 1.08, lightBand);
    const brushGain = tsl.mix(0.9, 1.08, strokeLoad);
    const banded = basicOutput.rgb.mul(bandGain).mul(brushGain);
    let resolved = tsl.mix(banded, basicOutput.rgb, nativeLightWeight);
    const rim = tsl.normalWorld.dot(tsl.positionViewDirection)
      .abs().oneMinus().clamp(0, 1).pow(5).mul(0.48)
      .mul(tsl.smoothstep(-0.2, 0.7, lightFacing));
    resolved = resolved.add(tsl.uniform(authored.rim).mul(rim)).clamp(0, 16);
    const finalOutput = tsl.vec4(resolved, basicOutput.a);
    return originalSetupOutput
      ? originalSetupOutput.call(this, builder, finalOutput)
      : finalOutput;
  };

  material.userData.painterlyVegetationInstalled = true;
  material.userData.painterlyVegetationTexture = paintTexture;
  material.userData.painterlyVegetationUsesReducedAo =
    authored.treatment === 'ground' && Boolean(record.options.aoNodeWhilePainted);
  material.needsUpdate = true;
  record.installed = true;
}

function restoreNativeGraph(record: PainterlyRecord): void {
  if (!record.installed) return;
  const { material, original } = record;
  material.colorNode = original.colorNode;
  material.normalNode = original.normalNode;
  material.roughnessNode = original.roughnessNode;
  material.aoNode = original.aoNode;
  if (original.hadOwnSetupOutput) material.setupOutput = original.setupOutput;
  else delete material.setupOutput;
  material.userData.painterlyVegetationInstalled = false;
  delete material.userData.painterlyVegetationTexture;
  delete material.userData.painterlyVegetationUsesReducedAo;
  material.needsUpdate = true;
  record.installed = false;
}

function getPaintTexture(): THREE.DataTexture {
  if (!paintTextureResult) {
    paintTextureResult = createPaintTexture(paintTextureSettings);
    paintTextureResult.texture.name = 'Shared painterly vegetation packed brush field';
  }
  return paintTextureResult.texture;
}

function resolveSourceColor(
  material: PainterlyNodeMaterial,
  originalColorNode: TslNode | null,
): TslNode {
  if (originalColorNode) {
    const alpha = material.map ? tsl.texture(material.map).a : tsl.float(1);
    return tsl.vec4(originalColorNode.rgb, alpha);
  }
  const tint = tsl.uniform(material.color?.clone() ?? new THREE.Color(0xffffff));
  if (!material.map) return tsl.vec4(tint, 1);
  const texel = tsl.texture(material.map);
  return tsl.vec4(texel.rgb.mul(tint), texel.a);
}
