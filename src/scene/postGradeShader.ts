import {
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  CROATIAN_NAIVE_ART_STYLE,
} from './naiveArtPostEffect.ts';

/** Shared grade math constants for WebGL + WebGPU post pipelines. */
export const GRADE_LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
export const GRADE_WARMTH_TINT = [1.025, 1.005, 0.975] as const;
export const GRADE_NIGHT_BLUE_TINT = [0.9, 0.96, 1.08] as const;
export const GRADE_VIGNETTE_INNER = 0.32;
export const GRADE_VIGNETTE_OUTER = 0.9;
export const GRADE_HIGHLIGHT_ROLLOFF_START = 0.68;
export const GRADE_HIGHLIGHT_ROLLOFF_END = 1.25;
export const GRADE_HIGHLIGHT_DESATURATION = 0.085;
export const GRADE_SHADOW_LIFT_START = 0.035;
export const GRADE_SHADOW_LIFT_END = 0.28;
export const GRADE_SHADOW_LIFT_EXPONENT = 0.76;
export const GRADE_SHADOW_LIFT_STRENGTH = 0.52;

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
  const sourceColorInitialization = naiveArtEnabled
    ? 'vec3 sourceColor;'
    : 'vec3 sourceColor = texture2D(tDiffuse, vUv).rgb;';
  const naiveArtBasisApplication = naiveArtEnabled
    ? 'sourceColor = buildCroatianNaiveArtBasis(tDiffuse, vUv, inverseResolution, naiveArtStructureEdge);'
    : '';
  const naiveArtToneApplication = naiveArtEnabled
    ? 'color = applyCroatianNaiveArtTone(color, vUv, naiveArtStructureEdge);'
    : '';
  return `
    uniform sampler2D tDiffuse;
    uniform vec2 inverseResolution;
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
      ${sourceColorInitialization}
      float naiveArtStructureEdge = 0.0;
      ${naiveArtBasisApplication}
      vec3 color = sourceColor;
      color = adjustSaturation(color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      color = mix(color, color * vec3(${wr}, ${wg}, ${wb}), warmth);
      color = mix(color, color * vec3(${nr}, ${ng}, ${nb}), nightBlue);
      float shadowLuma = dot(color, vec3(${lr}, ${lg}, ${lb}));
      float shadowLiftDrive = max(nightBlue, warmth * 0.45);
      float shadowLift = (1.0 - smoothstep(
        ${GRADE_SHADOW_LIFT_START},
        ${GRADE_SHADOW_LIFT_END},
        shadowLuma
      )) * shadowLiftDrive * ${GRADE_SHADOW_LIFT_STRENGTH};
      vec3 shadowCurve = pow(
        max(color, vec3(0.0)),
        vec3(${GRADE_SHADOW_LIFT_EXPONENT})
      );
      color = mix(color, shadowCurve, shadowLift);
      float highlightLuma = dot(color, vec3(${lr}, ${lg}, ${lb}));
      float highlightRolloff = smoothstep(
        ${GRADE_HIGHLIGHT_ROLLOFF_START},
        ${GRADE_HIGHLIGHT_ROLLOFF_END},
        highlightLuma
      );
      color = mix(
        color,
        vec3(highlightLuma),
        highlightRolloff * ${GRADE_HIGHLIGHT_DESATURATION}
      );
      float distanceFromCenter = distance(vUv, vec2(0.5));
      float edge = smoothstep(${GRADE_VIGNETTE_INNER}, ${GRADE_VIGNETTE_OUTER}, distanceFromCenter);
      color *= mix(1.0, 1.0 - vignette, edge);
      ${naiveArtToneApplication}
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
    float naiveArtLuma(vec3 color) {
      return dot(color, vec3(${lr}, ${lg}, ${lb}));
    }

    float naiveArtBilateralWeight(float centerLuma, float sampleLuma, float spatialWeight) {
      float lumaDifference = abs(sampleLuma - centerLuma);
      return spatialWeight * exp(-lumaDifference * ${style.bilateralSharpness});
    }

    void naiveArtAccumulate(
      inout vec3 colorSum,
      inout float weightSum,
      float centerLuma,
      vec3 sampleColor,
      float sampleLuma,
      float spatialWeight
    ) {
      float weight = naiveArtBilateralWeight(centerLuma, sampleLuma, spatialWeight);
      colorSum += sampleColor * weight;
      weightSum += weight;
    }

    vec3 buildCroatianNaiveArtBasis(
      sampler2D sourceTexture,
      vec2 frameUv,
      vec2 inverseFrameSize,
      out float structureEdge
    ) {
      vec2 texel = inverseFrameSize * ${style.filterRadiusPixels};
      vec3 center = texture2D(sourceTexture, frameUv).rgb;
      vec3 north = texture2D(sourceTexture, frameUv + texel * vec2( 0.0,  1.0)).rgb;
      vec3 east = texture2D(sourceTexture, frameUv + texel * vec2( 1.0,  0.0)).rgb;
      vec3 south = texture2D(sourceTexture, frameUv + texel * vec2( 0.0, -1.0)).rgb;
      vec3 west = texture2D(sourceTexture, frameUv + texel * vec2(-1.0,  0.0)).rgb;
      float centerLuma = naiveArtLuma(center);
      float n = naiveArtLuma(north);
      float e = naiveArtLuma(east);
      float s = naiveArtLuma(south);
      float w = naiveArtLuma(west);

      vec3 colorSum = center * ${style.centerWeight};
      float weightSum = ${style.centerWeight};
      naiveArtAccumulate(colorSum, weightSum, centerLuma, north, n, ${style.cardinalWeight});
      naiveArtAccumulate(colorSum, weightSum, centerLuma, east, e, ${style.cardinalWeight});
      naiveArtAccumulate(colorSum, weightSum, centerLuma, south, s, ${style.cardinalWeight});
      naiveArtAccumulate(colorSum, weightSum, centerLuma, west, w, ${style.cardinalWeight});

      vec3 filtered = colorSum / max(weightSum, 0.0001);
      vec3 painterlyColor = mix(center, filtered, ${style.painterlySmoothing});
      float gradientX = e - w;
      float gradientY = s - n;
      float structureSignal =
        length(vec2(gradientX, gradientY)) * 0.5
        + abs(centerLuma - naiveArtLuma(filtered)) * 0.8;
      structureEdge = smoothstep(
        ${style.contourStart},
        ${style.contourEnd},
        structureSignal
      );
      return painterlyColor;
    }

    float naiveArtPaperNoise(vec2 frameUv) {
      vec2 pigmentCell = floor(frameUv * vec2(${style.grainScaleX}.0, ${style.grainScaleY}.0));
      return fract(sin(dot(pigmentCell, vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec3 applyCroatianNaiveArtTone(
      vec3 inputColor,
      vec2 frameUv,
      float structureEdge
    ) {
      vec3 positiveColor = max(inputColor, vec3(0.0));
      float originalLuma = dot(positiveColor, vec3(${lr}, ${lg}, ${lb}));
      vec3 openColor = mix(vec3(originalLuma), positiveColor, ${style.colorfulness});

      float safeLuma = max(originalLuma, 0.025);
      float paintedLuma = floor(safeLuma * ${style.paletteSteps}.0 + 0.5) / ${style.paletteSteps}.0;
      float paletteEdgeGuard = 1.0 - structureEdge * 0.72;
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

      float contour = structureEdge;
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
      let shadowLuma = dot(nightTinted, vec3<f32>(${lr}, ${lg}, ${lb}));
      let shadowLiftDrive = max(gradeNightBlue, gradeWarmth * 0.45);
      let shadowLift = (
        1.0 - smoothstep(${GRADE_SHADOW_LIFT_START}, ${GRADE_SHADOW_LIFT_END}, shadowLuma)
      ) * shadowLiftDrive * ${GRADE_SHADOW_LIFT_STRENGTH};
      let shadowCurve = pow(
        max(nightTinted, vec3<f32>(0.0)),
        vec3<f32>(${GRADE_SHADOW_LIFT_EXPONENT})
      );
      let shadowLifted = mix(nightTinted, shadowCurve, shadowLift);
      let highlightLuma = dot(shadowLifted, vec3<f32>(${lr}, ${lg}, ${lb}));
      let highlightRolloff = smoothstep(
        ${GRADE_HIGHLIGHT_ROLLOFF_START},
        ${GRADE_HIGHLIGHT_ROLLOFF_END},
        highlightLuma
      );
      let highlightManaged = mix(
        shadowLifted,
        vec3<f32>(highlightLuma),
        highlightRolloff * ${GRADE_HIGHLIGHT_DESATURATION}
      );
      let distanceFromCenter = distance(frameUv, vec2<f32>(0.5));
      let edge = smoothstep(${GRADE_VIGNETTE_INNER}, ${GRADE_VIGNETTE_OUTER}, distanceFromCenter);
      let graded = highlightManaged * mix(1.0, 1.0 - gradeVignette, edge);
      return vec4<f32>(max(graded, vec3<f32>(0.0)), inputColor.a);
  `;
}
