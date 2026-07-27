import {
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  CROATIAN_NAIVE_ART_STYLE,
} from './naiveArtPostEffect.ts';

/** Shared grade math constants for WebGL + WebGPU post pipelines. */
export const GRADE_LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
export const GRADE_WARMTH_TINT = [1.03, 1.01, 0.97] as const;
export const GRADE_NIGHT_BLUE_TINT = [0.82, 0.9, 1.12] as const;
export const GRADE_VIGNETTE_INNER = 0.18;
export const GRADE_VIGNETTE_OUTER = 0.78;

export function buildGradeGlslVertexShader(): string {
  return `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
}

export function buildGradeGlslFragmentShader(
  naiveArtEnabled = CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
): string {
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const [wr, wg, wb] = GRADE_WARMTH_TINT;
  const [nr, ng, nb] = GRADE_NIGHT_BLUE_TINT;
  const naiveArtFunctions = naiveArtEnabled ? buildNaiveArtGlslFunctions() : '';
  const naiveArtApplication = naiveArtEnabled ? 'color = applyCroatianNaiveArt(color, vUv);' : '';
  return `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    uniform float nightBlue;
    uniform float vignette;
    varying vec2 vUv;

    vec3 adjustSaturation(vec3 color, float amount) {
      float luma = dot(color, vec3(${lr}, ${lg}, ${lb}));
      return mix(vec3(luma), color, amount);
    }

    ${naiveArtFunctions}

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      color = (color - 0.5) * contrast + 0.5;
      color = adjustSaturation(color, saturation);
      color = mix(color, color * vec3(${wr}, ${wg}, ${wb}), warmth);
      color = mix(color, color * vec3(${nr}, ${ng}, ${nb}), nightBlue);
      float distanceFromCenter = distance(vUv, vec2(0.5));
      float edge = smoothstep(${GRADE_VIGNETTE_INNER}, ${GRADE_VIGNETTE_OUTER}, distanceFromCenter);
      color *= mix(1.0, 1.0 - vignette, edge);
      ${naiveArtApplication}
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }
  `;
}

function buildNaiveArtGlslFunctions(): string {
  const style = CROATIAN_NAIVE_ART_STYLE;
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const [shadowR, shadowG, shadowB] = style.shadowTint;
  const [underpaintR, underpaintG, underpaintB] = style.shadowUnderpaint;
  return `
    float naiveArtPaperNoise(vec2 frameUv) {
      vec2 pigmentCell = floor(frameUv * vec2(${style.grainScaleX}.0, ${style.grainScaleY}.0));
      return fract(sin(dot(pigmentCell, vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec3 applyCroatianNaiveArt(vec3 inputColor, vec2 frameUv) {
      vec3 positiveColor = max(inputColor, vec3(0.0));
      float originalLuma = dot(positiveColor, vec3(${lr}, ${lg}, ${lb}));
      vec3 openColor = mix(vec3(originalLuma), positiveColor, ${style.colorfulness});

      float safeLuma = max(originalLuma, 0.025);
      float paintedLuma = floor(safeLuma * ${style.paletteSteps}.0 + 0.5) / ${style.paletteSteps}.0;
      float paletteEdgeGuard =
        1.0 - smoothstep(0.02, 0.09, fwidth(originalLuma));
      float lumaScale = mix(
        1.0,
        paintedLuma / safeLuma,
        ${style.paletteStrength} * paletteEdgeGuard
      );
      vec3 paintedColor = openColor * lumaScale;

      float shadow = 1.0 - smoothstep(${style.shadowStart}, ${style.shadowEnd}, originalLuma);
      vec3 underpaintedShadow =
        paintedColor * vec3(${shadowR}, ${shadowG}, ${shadowB})
        + vec3(${underpaintR}, ${underpaintG}, ${underpaintB});
      paintedColor = mix(
        paintedColor,
        underpaintedShadow,
        shadow * ${style.shadowUnderpaintStrength}
      );

      float paintedColorLuma = dot(paintedColor, vec3(${lr}, ${lg}, ${lb}));
      float contourSignal = fwidth(paintedColorLuma);
      float contour = smoothstep(
        ${style.contourStart},
        ${style.contourEnd},
        contourSignal
      );
      vec3 chromaticInk = paintedColor * vec3(0.19, 0.17, 0.14) + vec3(0.018, 0.013, 0.009);
      paintedColor = mix(paintedColor, chromaticInk, contour * ${style.contourStrength});

      float pigment = (naiveArtPaperNoise(frameUv) - 0.5) * ${style.grainStrength};
      vec3 pigmentTint = vec3(pigment * 1.0, pigment * 0.94, pigment * 0.82);
      return max(paintedColor + pigmentTint * (1.0 - contour * 0.65), vec3(0.0));
    }
  `;
}

export function buildGradeWgslFunctionBody(): string {
  const [lr, lg, lb] = GRADE_LUMA_WEIGHTS;
  const [wr, wg, wb] = GRADE_WARMTH_TINT;
  const [nr, ng, nb] = GRADE_NIGHT_BLUE_TINT;
  return `
      let luma = dot(inputColor.rgb, vec3<f32>(${lr}, ${lg}, ${lb}));
      let saturated = mix(vec3<f32>(luma), inputColor.rgb, gradeSaturation);
      let contrasted = (saturated - vec3<f32>(0.5)) * gradeContrast + vec3<f32>(0.5);
      let warmed = mix(contrasted, contrasted * vec3<f32>(${wr}, ${wg}, ${wb}), gradeWarmth);
      let nightTinted = mix(warmed, warmed * vec3<f32>(${nr}, ${ng}, ${nb}), gradeNightBlue);
      let distanceFromCenter = distance(frameUv, vec2<f32>(0.5));
      let edge = smoothstep(${GRADE_VIGNETTE_INNER}, ${GRADE_VIGNETTE_OUTER}, distanceFromCenter);
      let graded = nightTinted * mix(1.0, 1.0 - gradeVignette, edge);
      return vec4<f32>(max(graded, vec3<f32>(0.0)), inputColor.a);
  `;
}
