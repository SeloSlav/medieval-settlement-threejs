import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import BloomNode from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  abs,
  distance,
  dot,
  exp,
  float,
  floor,
  fract,
  max,
  mix,
  pass,
  pow,
  screenSize,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { DayNightGrade } from '../world/dayNightPresentation.ts';
import {
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  CROATIAN_NAIVE_ART_STYLE,
  naiveArtRainTreatmentRetention,
} from './naiveArtPostEffect.ts';
import { applyDayNightGradeUniforms, DEFAULT_DAY_NIGHT_GRADE } from './postGrade.ts';
import {
  buildGradeGlslFragmentShader,
  buildGradeGlslVertexShader,
  GRADE_LUMA_WEIGHTS,
  GRADE_HIGHLIGHT_DESATURATION,
  GRADE_HIGHLIGHT_ROLLOFF_END,
  GRADE_HIGHLIGHT_ROLLOFF_START,
  GRADE_FILMIC_BLEND,
  GRADE_FILMIC_PIVOT,
  GRADE_FILMIC_POWER,
  GRADE_FOLIAGE_DESATURATION,
  GRADE_FOLIAGE_DOMINANCE_END,
  GRADE_FOLIAGE_DOMINANCE_START,
  GRADE_FOLIAGE_OLIVE_TINT,
  GRADE_GRAIN_STRENGTH,
  GRADE_NIGHT_BLUE_TINT,
  GRADE_SHADOW_LIFT_END,
  GRADE_SHADOW_LIFT_EXPONENT,
  GRADE_SHADOW_LIFT_START,
  GRADE_SHADOW_LIFT_STRENGTH,
  GRADE_SPLIT_HIGHLIGHT_END,
  GRADE_SPLIT_HIGHLIGHT_START,
  GRADE_SPLIT_HIGHLIGHT_STRENGTH,
  GRADE_SPLIT_HIGHLIGHT_TINT,
  GRADE_SPLIT_SHADOW_END,
  GRADE_SPLIT_SHADOW_STRENGTH,
  GRADE_SPLIT_SHADOW_TINT,
  GRADE_VIGNETTE_INNER,
  GRADE_VIGNETTE_OUTER,
  GRADE_WARMTH_TINT,
} from './postGradeShader.ts';
import { supportsNodeMaterials, type RendererBackend } from './RendererBackend.ts';

type Disposable = {
  dispose(): void;
};

type PassNodeLike = Disposable & {
  getTextureNode(name?: string): TextureNodeLike;
};

const DEFAULT_GRADE = DEFAULT_DAY_NIGHT_GRADE;
const DEFAULT_BLOOM = Object.freeze({
  radius: 0.38,
  strength: 0.12,
  threshold: 0.82,
});
const ACTIVE_BLOOM = CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED
  ? {
      radius: CROATIAN_NAIVE_ART_STYLE.bloomRadius,
      strength: CROATIAN_NAIVE_ART_STYLE.bloomStrength,
      threshold: CROATIAN_NAIVE_ART_STYLE.bloomThreshold,
    }
  : DEFAULT_BLOOM;

/**
 * Native fullscreen submissions made after the scene pass: bloom high-pass,
 * five horizontal/vertical blur pairs, bloom composite, and final grade/output.
 */
export const WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT = 12;
export const WEBGPU_POST_FULLSCREEN_PASS_COUNT = WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT + 1;

const DAYLIGHT_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    inverseResolution: { value: new THREE.Vector2(1, 1) },
    saturation: { value: DEFAULT_GRADE.saturation },
    contrast: { value: DEFAULT_GRADE.contrast },
    warmth: { value: DEFAULT_GRADE.warmth },
    nightBlue: { value: DEFAULT_GRADE.nightBlue },
    vignette: { value: DEFAULT_GRADE.vignette },
    naiveArtStrength: { value: 1 },
  },
  vertexShader: buildGradeGlslVertexShader(),
  fragmentShader: buildGradeGlslFragmentShader(),
};

export type ScenePostProcessor = {
  dispose(): void;
  render(dt: number): void;
  renderIllustratedMap(): void;
  setDayNightGrade(grade: DayNightGrade): void;
  setWeatherWetness(wetness: number): void;
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number): void;
};

export function createPostProcessor(
  backend: RendererBackend,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  illustratedMapScene: THREE.Scene = scene,
): ScenePostProcessor {
  if (supportsNodeMaterials(backend.kind)) {
    return new WebGPUPostProcessor(
      backend.renderer as WebGPURenderer,
      scene,
      camera,
      illustratedMapScene,
    );
  }

  return new WebGLPostProcessor(
    backend.renderer as THREE.WebGLRenderer,
    scene,
    camera,
    illustratedMapScene,
  );
}

function applyGradeUniforms(
  uniforms: Record<string, { value: number }>,
  grade: DayNightGrade,
): void {
  applyDayNightGradeUniforms(uniforms, grade);
}

class WebGLPostProcessor implements ScenePostProcessor {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly illustratedMapScene: THREE.Scene;
  private readonly composer: EffectComposer;
  private readonly gradePass: ShaderPass;
  private pixelRatio = 1;
  private width = 1;
  private height = 1;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    illustratedMapScene: THREE.Scene,
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.illustratedMapScene = illustratedMapScene;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        ACTIVE_BLOOM.strength,
        ACTIVE_BLOOM.radius,
        ACTIVE_BLOOM.threshold,
      ),
    );
    this.gradePass = new ShaderPass(DAYLIGHT_GRADE_SHADER);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
  }

  dispose(): void {
    this.composer.dispose();
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  renderIllustratedMap(): void {
    this.renderer.render(this.illustratedMapScene, this.camera);
  }

  setDayNightGrade(grade: DayNightGrade): void {
    applyGradeUniforms(this.gradePass.uniforms, grade);
  }

  setWeatherWetness(wetness: number): void {
    this.gradePass.uniforms.naiveArtStrength.value = naiveArtRainTreatmentRetention(wetness);
  }

  setPixelRatio(pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.updateInverseResolution();
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height);
    this.updateInverseResolution();
  }

  private updateInverseResolution(): void {
    (this.gradePass.uniforms.inverseResolution.value as THREE.Vector2).set(
      1 / Math.max(this.width * this.pixelRatio, 1),
      1 / Math.max(this.height * this.pixelRatio, 1),
    );
  }
}

class WebGPUPostProcessor implements ScenePostProcessor {
  private readonly renderer: WebGPURenderer;
  private readonly bloomPass: Disposable;
  private readonly pipeline: RenderPipeline;
  private readonly scenePass: PassNodeLike;
  private readonly illustratedMapPipeline: RenderPipeline;
  private readonly illustratedMapPass: PassNodeLike;
  private readonly gradeSaturation = uniform(DEFAULT_GRADE.saturation);
  private readonly gradeContrast = uniform(DEFAULT_GRADE.contrast);
  private readonly gradeWarmth = uniform(DEFAULT_GRADE.warmth);
  private readonly gradeNightBlue = uniform(DEFAULT_GRADE.nightBlue);
  private readonly gradeVignette = uniform(DEFAULT_GRADE.vignette);
  private readonly gradeUniforms = {
    saturation: this.gradeSaturation,
    contrast: this.gradeContrast,
    warmth: this.gradeWarmth,
    nightBlue: this.gradeNightBlue,
    vignette: this.gradeVignette,
  };
  private readonly weatherNaiveArtRetention = uniform(1);

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    illustratedMapScene: THREE.Scene,
  ) {
    this.renderer = renderer;
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = pass(scene, camera) as PassNodeLike;
    this.illustratedMapPipeline = new RenderPipeline(renderer);
    this.illustratedMapPass = pass(illustratedMapScene, camera) as PassNodeLike;
    this.illustratedMapPipeline.outputNode = this.illustratedMapPass.getTextureNode('output');

    const sceneColor = this.scenePass.getTextureNode('output');
    this.bloomPass = new StableSizeBloomNode(
      sceneColor,
      ACTIVE_BLOOM.strength,
      ACTIVE_BLOOM.radius,
      ACTIVE_BLOOM.threshold,
    );
    const naiveArtBasis = CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED
      ? buildCroatianNaiveArtBasisNode(sceneColor)
      : null;
    const gradeInput = naiveArtBasis
      ? naiveArtBasis.color.add(this.bloomPass)
      : sceneColor.add(this.bloomPass);
    this.pipeline.outputNode = buildGradeNode(
      gradeInput,
      this.gradeSaturation,
      this.gradeContrast,
      this.gradeWarmth,
      this.gradeNightBlue,
      this.gradeVignette,
      naiveArtBasis?.structureEdge ?? null,
      this.weatherNaiveArtRetention,
    );
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.bloomPass.dispose();
    this.illustratedMapPipeline.dispose();
    this.illustratedMapPass.dispose();
  }

  render(): void {
    this.renderPipelineToCanvas(this.pipeline);
  }

  renderIllustratedMap(): void {
    this.renderPipelineToCanvas(this.illustratedMapPipeline);
  }

  setDayNightGrade(grade: DayNightGrade): void {
    applyDayNightGradeUniforms(this.gradeUniforms, grade);
  }

  setWeatherWetness(wetness: number): void {
    this.weatherNaiveArtRetention.value = naiveArtRainTreatmentRetention(wetness);
  }

  setPixelRatio(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }

  setSize(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }

  private renderPipelineToCanvas(pipeline: RenderPipeline): void {
    // RenderPipeline's final fullscreen draw targets the renderer's current
    // target. Reclaim the swap chain explicitly at every scene-owner boundary
    // so a leaked offscreen target/MRT cannot strand the visible canvas on the
    // last parchment clear frame.
    this.renderer.setRenderTarget(null);
    this.renderer.setMRT(null);
    pipeline.render();
  }
}

/**
 * BloomNode checks and resizes eleven render targets every frame even when the
 * drawing buffer is unchanged. Keep its exact stock render path and cache only
 * that idempotent size work. A real resize still reaches the stock method.
 */
class StableSizeBloomNode extends BloomNode {
  private width = -1;
  private height = -1;

  override setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    super.setSize(width, height);
  }
}

type TslNode = {
  a: TslNode;
  b: TslNode;
  g: TslNode;
  r: TslNode;
  rgb: TslNode;
  add(value: unknown): TslNode;
  div(value: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

type TextureNodeLike = TslNode & {
  sample(uvNode: unknown): TslNode;
};

function buildGradeNode(
  inputColorValue: unknown,
  saturationValue: unknown,
  contrastValue: unknown,
  warmthValue: unknown,
  nightBlueValue: unknown,
  vignetteValue: unknown,
  naiveArtStructureEdge: TslNode | null,
  naiveArtStrengthValue: unknown,
): unknown {
  const inputColor = inputColorValue as TslNode;
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const [wr, wg, wb] = GRADE_WARMTH_TINT;
  const [nr, ng, nb] = GRADE_NIGHT_BLUE_TINT;
  const luma = dot(inputColor.rgb, vec3(lr, lg, lb));
  const saturated = mix(vec3(luma), inputColor.rgb, saturationValue) as TslNode;
  const contrasted = saturated.sub(float(0.5)).mul(contrastValue).add(float(0.5));
  const warmed = mix(
    contrasted,
    contrasted.mul(vec3(wr, wg, wb)),
    warmthValue,
  ) as TslNode;
  const nightTinted = mix(
    warmed,
    warmed.mul(vec3(nr, ng, nb)),
    nightBlueValue,
  ) as TslNode;
  const shadowLuma = dot(nightTinted, vec3(lr, lg, lb)) as TslNode;
  const shadowLiftDrive = max(
    nightBlueValue,
    (warmthValue as TslNode).mul(float(0.45)),
  ) as TslNode;
  const shadowLift = (float(1) as TslNode)
    .sub(smoothstep(
      float(GRADE_SHADOW_LIFT_START),
      float(GRADE_SHADOW_LIFT_END),
      shadowLuma,
    ))
    .mul(shadowLiftDrive)
    .mul(float(GRADE_SHADOW_LIFT_STRENGTH));
  const shadowCurve = pow(
    max(nightTinted, vec3(0)),
    vec3(GRADE_SHADOW_LIFT_EXPONENT),
  ) as TslNode;
  const shadowLifted = mix(nightTinted, shadowCurve, shadowLift) as TslNode;
  const highlightLuma = dot(shadowLifted, vec3(lr, lg, lb)) as TslNode;
  const highlightRolloff = smoothstep(
    float(GRADE_HIGHLIGHT_ROLLOFF_START),
    float(GRADE_HIGHLIGHT_ROLLOFF_END),
    highlightLuma,
  ) as TslNode;
  const highlightManaged = mix(
    shadowLifted,
    vec3(highlightLuma),
    highlightRolloff.mul(float(GRADE_HIGHLIGHT_DESATURATION)),
  ) as TslNode;
  const foliageDominance = highlightManaged.g.sub(max(highlightManaged.r, highlightManaged.b));
  const foliageMask = (smoothstep(
    float(GRADE_FOLIAGE_DOMINANCE_START),
    float(GRADE_FOLIAGE_DOMINANCE_END),
    foliageDominance,
  ) as TslNode).mul(smoothstep(float(0.035), float(0.2), highlightLuma)) as TslNode;
  const foliageLuma = dot(highlightManaged, vec3(lr, lg, lb));
  const foliageDesaturated = mix(
    highlightManaged,
    vec3(foliageLuma),
    foliageMask.mul(float(GRADE_FOLIAGE_DESATURATION)),
  ) as TslNode;
  const foliageManaged = mix(
    foliageDesaturated,
    foliageDesaturated.mul(vec3(...GRADE_FOLIAGE_OLIVE_TINT)),
    foliageMask,
  ) as TslNode;
  const splitLuma = dot(foliageManaged, vec3(lr, lg, lb)) as TslNode;
  const shadowTone = (float(1) as TslNode).sub(smoothstep(
    float(0.055),
    float(GRADE_SPLIT_SHADOW_END),
    splitLuma,
  ));
  const highlightTone = smoothstep(
    float(GRADE_SPLIT_HIGHLIGHT_START),
    float(GRADE_SPLIT_HIGHLIGHT_END),
    splitLuma,
  ) as TslNode;
  const shadowToned = mix(
    foliageManaged,
    foliageManaged.mul(vec3(...GRADE_SPLIT_SHADOW_TINT)),
    shadowTone.mul(float(GRADE_SPLIT_SHADOW_STRENGTH)),
  ) as TslNode;
  const splitToned = mix(
    shadowToned,
    shadowToned.mul(vec3(...GRADE_SPLIT_HIGHLIGHT_TINT)),
    highlightTone.mul(float(GRADE_SPLIT_HIGHLIGHT_STRENGTH)),
  ) as TslNode;
  const filmicInput = (max(splitToned, vec3(0)) as TslNode).div(float(GRADE_FILMIC_PIVOT));
  const filmicColor = (pow(
    filmicInput,
    vec3(GRADE_FILMIC_POWER),
  ) as TslNode).mul(float(GRADE_FILMIC_PIVOT)) as TslNode;
  const filmicManaged = mix(splitToned, filmicColor, float(GRADE_FILMIC_BLEND)) as TslNode;
  const grainLuma = dot(filmicManaged, vec3(lr, lg, lb)) as TslNode;
  const grainVisibility = (smoothstep(float(0.08), float(0.28), grainLuma) as TslNode)
    .mul((float(1) as TslNode).sub(smoothstep(float(0.62), float(1), grainLuma)));
  const grainCell = floor((uv() as TslNode).mul(screenSize));
  const gradeGrain = (fract(
    (sin(dot(grainCell, vec2(12.9898, 78.233))) as TslNode).mul(float(43758.5453)),
  ) as TslNode).sub(float(0.5)).mul(float(GRADE_GRAIN_STRENGTH));
  const textured = filmicManaged.add(vec3(gradeGrain.mul(grainVisibility)));
  const distanceFromCenter = distance(uv(), vec2(0.5));
  const edge = smoothstep(
    float(GRADE_VIGNETTE_INNER),
    float(GRADE_VIGNETTE_OUTER),
    distanceFromCenter,
  );
  const graded = textured.mul(
    mix(float(1), (float(1) as TslNode).sub(vignetteValue), edge),
  );
  const finalColor = naiveArtStructureEdge
    ? mix(
        graded,
        buildCroatianNaiveArtToneNode(graded, naiveArtStructureEdge),
        naiveArtStrengthValue,
      )
    : graded;
  return vec4(max(finalColor, vec3(0)), inputColor.a);
}

function buildCroatianNaiveArtBasisNode(
  sceneTexture: TextureNodeLike,
): { color: TslNode; structureEdge: TslNode } {
  const style = CROATIAN_NAIVE_ART_STYLE;
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const frameUv = uv() as TslNode;
  const texel = (vec2(1) as TslNode)
    .div(screenSize)
    .mul(float(style.filterRadiusPixels));
  const sample = (x: number, y: number): TslNode => sceneTexture
    .sample(frameUv.add(texel.mul(vec2(x, y))))
    .rgb;
  const luma = (color: TslNode): TslNode => dot(color, vec3(lr, lg, lb)) as TslNode;

  const center = sample(0, 0);
  const north = sample(0, 1);
  const east = sample(1, 0);
  const south = sample(0, -1);
  const west = sample(-1, 0);
  const centerLuma = luma(center);
  const n = luma(north);
  const e = luma(east);
  const s = luma(south);
  const w = luma(west);

  let colorSum = center.mul(float(style.centerWeight));
  let weightSum = float(style.centerWeight) as TslNode;
  const weightedNeighbors = [
    [north, n, style.cardinalWeight],
    [east, e, style.cardinalWeight],
    [south, s, style.cardinalWeight],
    [west, w, style.cardinalWeight],
  ] as const;
  for (const [neighbor, neighborLuma, spatialWeight] of weightedNeighbors) {
    const rangeWeight = exp(
      (abs(neighborLuma.sub(centerLuma)) as TslNode)
        .mul(float(-style.bilateralSharpness)),
    ) as TslNode;
    const weight = rangeWeight.mul(float(spatialWeight));
    colorSum = colorSum.add(neighbor.mul(weight));
    weightSum = weightSum.add(weight);
  }

  const filtered = colorSum.div(max(weightSum, float(0.0001)));
  const color = mix(
    center,
    filtered,
    float(style.painterlySmoothing),
  ) as TslNode;

  const gradientX = e.sub(w);
  const gradientY = s.sub(n);
  const gradientMagnitude = pow(
    gradientX.mul(gradientX).add(gradientY.mul(gradientY)),
    float(0.5),
  ) as TslNode;
  const structureSignal = gradientMagnitude
    .mul(float(0.5))
    .add(
      (abs(centerLuma.sub(luma(filtered))) as TslNode).mul(float(0.8)),
    );
  const structureEdge = smoothstep(
    float(style.contourStart),
    float(style.contourEnd),
    structureSignal,
  ) as TslNode;

  return { color, structureEdge };
}

function buildCroatianNaiveArtToneNode(
  inputColorValue: unknown,
  structureEdge: TslNode,
): TslNode {
  const style = CROATIAN_NAIVE_ART_STYLE;
  const inputColor = inputColorValue as TslNode;
  const positiveColor = max(inputColor, vec3(0)) as TslNode;
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const originalLuma = dot(positiveColor, vec3(lr, lg, lb)) as TslNode;
  const openColor = mix(vec3(originalLuma), positiveColor, float(style.colorfulness)) as TslNode;

  const safeLuma = max(originalLuma, float(0.025)) as TslNode;
  const paintedLuma = (floor(
    safeLuma.mul(float(style.paletteSteps)).add(float(0.5)),
  ) as TslNode).div(float(style.paletteSteps));
  const paletteEdgeGuard = (float(1) as TslNode).sub(
    structureEdge.mul(float(0.72)),
  );
  const lumaScale = mix(
    float(1),
    paintedLuma.div(safeLuma),
    paletteEdgeGuard.mul(float(style.paletteStrength)),
  ) as TslNode;
  let paintedColor = openColor.mul(lumaScale);

  const shadow = (float(1) as TslNode).sub(
    smoothstep(float(style.shadowStart), float(style.shadowEnd), originalLuma),
  );
  const underpaintedShadow = paintedColor
    .mul(vec3(...style.shadowTint))
    .add(vec3(...style.shadowUnderpaint));
  paintedColor = mix(
    paintedColor,
    underpaintedShadow,
    shadow.mul(float(style.shadowUnderpaintStrength)),
  ) as TslNode;

  const contour = structureEdge;
  const chromaticInk = paintedColor
    .mul(vec3(0.19, 0.17, 0.14))
    .add(vec3(0.018, 0.013, 0.009));
  paintedColor = mix(
    paintedColor,
    chromaticInk,
    contour.mul(float(style.contourStrength)),
  ) as TslNode;

  const pigmentCell = floor(
    (uv() as TslNode).mul(vec2(style.grainScaleX, style.grainScaleY)),
  );
  const pigment = (fract(
    (sin(dot(pigmentCell, vec2(12.9898, 78.233))) as TslNode).mul(float(43758.5453)),
  ) as TslNode)
    .sub(float(0.5))
    .mul(float(style.grainStrength));
  const pigmentTint = vec3(
    pigment,
    pigment.mul(float(0.94)),
    pigment.mul(float(0.82)),
  ) as TslNode;
  const pigmentVisibility = (float(1) as TslNode).sub(contour.mul(float(0.65)));
  return max(
    paintedColor.add(pigmentTint.mul(pigmentVisibility)),
    vec3(0),
  ) as TslNode;
}
