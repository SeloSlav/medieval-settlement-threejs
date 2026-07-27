import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  distance,
  dot,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  pass,
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
} from './naiveArtPostEffect.ts';
import { applyDayNightGradeUniforms, DEFAULT_DAY_NIGHT_GRADE } from './postGrade.ts';
import {
  buildGradeGlslFragmentShader,
  buildGradeGlslVertexShader,
  GRADE_LUMA_WEIGHTS,
  GRADE_NIGHT_BLUE_TINT,
  GRADE_VIGNETTE_INNER,
  GRADE_VIGNETTE_OUTER,
  GRADE_WARMTH_TINT,
} from './postGradeShader.ts';
import { supportsNodeMaterials, type RendererBackend } from './RendererBackend.ts';

type Disposable = {
  dispose(): void;
};

type PassNodeLike = Disposable & {
  getTextureNode(name?: string): {
    add(value: unknown): unknown;
  };
};

const DEFAULT_GRADE = DEFAULT_DAY_NIGHT_GRADE;

const DAYLIGHT_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: DEFAULT_GRADE.saturation },
    contrast: { value: DEFAULT_GRADE.contrast },
    warmth: { value: DEFAULT_GRADE.warmth },
    nightBlue: { value: DEFAULT_GRADE.nightBlue },
    vignette: { value: DEFAULT_GRADE.vignette },
  },
  vertexShader: buildGradeGlslVertexShader(),
  fragmentShader: buildGradeGlslFragmentShader(),
};

export type ScenePostProcessor = {
  dispose(): void;
  render(dt: number): void;
  setDayNightGrade(grade: DayNightGrade): void;
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number): void;
};

export function createPostProcessor(
  backend: RendererBackend,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): ScenePostProcessor {
  if (supportsNodeMaterials(backend.kind)) {
    return new WebGPUPostProcessor(backend.renderer as WebGPURenderer, scene, camera);
  }

  return new WebGLPostProcessor(backend.renderer as THREE.WebGLRenderer, scene, camera);
}

function applyGradeUniforms(
  uniforms: Record<string, { value: number }>,
  grade: DayNightGrade,
): void {
  applyDayNightGradeUniforms(uniforms, grade);
}

class WebGLPostProcessor implements ScenePostProcessor {
  private readonly composer: EffectComposer;
  private readonly gradePass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.38, 0.82));
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

  setDayNightGrade(grade: DayNightGrade): void {
    applyGradeUniforms(this.gradePass.uniforms, grade);
  }

  setPixelRatio(pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }
}

class WebGPUPostProcessor implements ScenePostProcessor {
  private readonly bloomPass: Disposable;
  private readonly pipeline: RenderPipeline;
  private readonly scenePass: PassNodeLike;
  private readonly gradeSaturation = uniform(DEFAULT_GRADE.saturation);
  private readonly gradeContrast = uniform(DEFAULT_GRADE.contrast);
  private readonly gradeWarmth = uniform(DEFAULT_GRADE.warmth);
  private readonly gradeNightBlue = uniform(DEFAULT_GRADE.nightBlue);
  private readonly gradeVignette = uniform(DEFAULT_GRADE.vignette);

  constructor(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = pass(scene, camera) as PassNodeLike;

    const sceneColor = this.scenePass.getTextureNode('output');
    this.bloomPass = bloom(sceneColor, 0.12, 0.38, 0.82);
    this.pipeline.outputNode = buildGradeNode(
      sceneColor.add(this.bloomPass),
      this.gradeSaturation,
      this.gradeContrast,
      this.gradeWarmth,
      this.gradeNightBlue,
      this.gradeVignette,
    );
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.bloomPass.dispose();
  }

  render(): void {
    this.pipeline.render();
  }

  setDayNightGrade(grade: DayNightGrade): void {
    applyDayNightGradeUniforms(
      {
        saturation: this.gradeSaturation,
        contrast: this.gradeContrast,
        warmth: this.gradeWarmth,
        nightBlue: this.gradeNightBlue,
        vignette: this.gradeVignette,
      },
      grade,
    );
  }

  setPixelRatio(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }

  setSize(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }
}

type TslNode = {
  a: TslNode;
  rgb: TslNode;
  add(value: unknown): TslNode;
  div(value: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

function buildGradeNode(
  inputColorValue: unknown,
  saturationValue: unknown,
  contrastValue: unknown,
  warmthValue: unknown,
  nightBlueValue: unknown,
  vignetteValue: unknown,
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
  const distanceFromCenter = distance(uv(), vec2(0.5));
  const edge = smoothstep(
    float(GRADE_VIGNETTE_INNER),
    float(GRADE_VIGNETTE_OUTER),
    distanceFromCenter,
  );
  const graded = nightTinted.mul(
    mix(float(1), (float(1) as TslNode).sub(vignetteValue), edge),
  );
  const finalColor = CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED
    ? buildCroatianNaiveArtNode(graded)
    : graded;
  return vec4(max(finalColor, vec3(0)), inputColor.a);
}

function buildCroatianNaiveArtNode(inputColorValue: unknown): TslNode {
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
    smoothstep(float(0.02), float(0.09), fwidth(originalLuma)),
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

  const paintedColorLuma = dot(paintedColor, vec3(lr, lg, lb));
  const contourSignal = fwidth(paintedColorLuma) as TslNode;
  const contour = smoothstep(
    float(style.contourStart),
    float(style.contourEnd),
    contourSignal,
  ) as TslNode;
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
