import * as THREE from 'three';

type SkyCloudOptions = {
  cloudAbsorption?: number;
  cloudCoverage?: number;
  cloudHeight?: number;
  cloudThickness?: number;
  hazeStrength?: number;
  maxCloudDistance?: number;
  radius?: number;
  sunDirection?: THREE.Vector3;
  windSpeedX?: number;
  windSpeedZ?: number;
  width?: number;
  height?: number;
  widthSegments?: number;
  heightSegments?: number;
};

const DEFAULTS = {
  cloudAbsorption: 0.56,
  cloudCoverage: 0.56,
  cloudHeight: 150,
  cloudThickness: 78,
  hazeStrength: 0.12,
  maxCloudDistance: 4200,
  radius: 1100,
  windSpeedX: 0.16,
  windSpeedZ: 0.1,
  width: 1280,
  height: 720,
  widthSegments: 48,
  heightSegments: 24,
};

/**
 * WebGL-compatible sky/cloud mesh adapted from the open-source sky-cloud-3d package
 * used by The Mammoth. This version is tuned for a bright blue, partly cloudy day.
 */
export class SkyCloudMesh extends THREE.Mesh {
  readonly isSkyCloudMesh = true;
  readonly ready: Promise<SkyCloudMesh>;
  private readonly skyMaterial: THREE.ShaderMaterial;

  constructor(options: SkyCloudOptions = {}) {
    const config = { ...DEFAULTS, ...options };
    const material = createSkyMaterial(config);
    const geometry = new THREE.SphereGeometry(config.radius, config.widthSegments, config.heightSegments);
    super(geometry, material);
    this.name = 'Blue partly cloudy sky';
    this.renderOrder = -1000;
    this.frustumCulled = false;
    this.skyMaterial = material;
    this.ready = Promise.resolve(this);
    if (options.sunDirection) this.updateSun(options.sunDirection);
  }

  updateSun(direction: THREE.Vector3): void {
    this.skyMaterial.uniforms.uSunDirection.value.copy(direction).normalize();
  }

  updateTime(time: number): void {
    this.skyMaterial.uniforms.uTime.value = time;
  }

  updateResolution(width: number, height: number): void {
    this.skyMaterial.uniforms.uResolution.value.set(width, height);
  }

  updateCamera(camera: THREE.Camera): void {
    this.position.copy(camera.position);
  }

  dispose(): void {
    this.geometry.dispose();
    this.skyMaterial.dispose();
  }
}

function createSkyMaterial(config: typeof DEFAULTS & SkyCloudOptions): THREE.ShaderMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: new THREE.Vector3(0.42, 0.72, -0.56).normalize() },
    uResolution: { value: new THREE.Vector2(config.width, config.height) },
    uCloudCoverage: { value: config.cloudCoverage },
    uCloudHeight: { value: config.cloudHeight },
    uCloudThickness: { value: config.cloudThickness },
    uCloudAbsorption: { value: config.cloudAbsorption },
    uHazeStrength: { value: config.hazeStrength },
    uMaxCloudDistance: { value: config.maxCloudDistance },
    uWindSpeedX: { value: config.windSpeedX },
    uWindSpeedZ: { value: config.windSpeedZ },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec2 uResolution;
      uniform float uCloudCoverage;
      uniform float uCloudHeight;
      uniform float uCloudThickness;
      uniform float uCloudAbsorption;
      uniform float uHazeStrength;
      uniform float uMaxCloudDistance;
      uniform float uWindSpeedX;
      uniform float uWindSpeedZ;

      varying vec3 vWorldPosition;

      #define CLOUD_STEPS 20
      #define LIGHT_STEPS 4

      float saturate(float value) {
        return clamp(value, 0.0, 1.0);
      }

      float rand2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise2d(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = rand2(i);
        float b = rand2(i + vec2(1.0, 0.0));
        float c = rand2(i + vec2(0.0, 1.0));
        float d = rand2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec3 p) {
        float total = 0.0;
        float amplitude = 0.52;
        float norm = 0.0;
        mat3 warp = mat3(
          0.00, 0.80, 0.60,
         -0.80, 0.36,-0.48,
         -0.60,-0.48, 0.64
        );
        for (int i = 0; i < 4; i++) {
          total += noise2d(p.xz * 0.012 + p.y * 0.002) * amplitude;
          norm += amplitude;
          p = warp * p * 2.04 + vec3(13.1, 4.7, -9.4);
          amplitude *= 0.5;
        }
        return total / max(norm, 0.0001);
      }

      vec3 getSkyColor(vec3 rayDir) {
        float up = saturate(rayDir.y * 0.92 + 0.08);
        float sunAmount = saturate(dot(rayDir, uSunDirection));
        vec3 horizon = vec3(0.52, 0.74, 0.98);
        vec3 zenith = vec3(0.11, 0.38, 0.84);
        vec3 sky = mix(horizon, zenith, pow(up, 0.62));
        vec3 sunWarmth = vec3(1.0, 0.76, 0.42) * pow(sunAmount, 18.0) * 0.55;
        vec3 sunDisk = vec3(1.0, 0.86, 0.58) * pow(sunAmount, 900.0) * 4.5;
        float horizonMist = pow(1.0 - up, 3.0) * uHazeStrength;
        sky = mix(sky, vec3(0.78, 0.86, 0.94), horizonMist);
        return sky + sunWarmth + sunDisk;
      }

      float cloudDensity(vec3 pos, vec3 windOffset) {
        vec3 p = pos * 0.0095 + windOffset;
        float broad = fbm(p);
        float detail = fbm(p * 2.7 + vec3(31.7, -5.1, 18.4));
        float density = broad * 0.78 + detail * 0.22;
        float cutoff = mix(0.78, 0.38, uCloudCoverage);
        density = smoothstep(cutoff, cutoff + 0.12, density);
        float height01 = saturate((pos.y - uCloudHeight) / max(uCloudThickness, 1.0));
        float vertical = smoothstep(0.0, 0.24, height01) * (1.0 - smoothstep(0.72, 1.0, height01));
        return density * vertical;
      }

      float cloudLight(vec3 pos, vec3 windOffset) {
        float transmittance = 1.0;
        vec3 lightStep = uSunDirection * (uCloudThickness / float(LIGHT_STEPS)) * 0.85;
        for (int i = 0; i < LIGHT_STEPS; i++) {
          pos += lightStep;
          transmittance *= exp(-uCloudAbsorption * cloudDensity(pos, windOffset) * 0.55);
        }
        return transmittance;
      }

      vec4 renderClouds(vec3 rayOrigin, vec3 rayDir) {
        if (rayDir.y <= 0.006) return vec4(0.0);
        float t = (uCloudHeight - rayOrigin.y) / rayDir.y;
        if (t < 0.0 || t > uMaxCloudDistance) return vec4(0.0);

        vec3 pos = rayOrigin + rayDir * t;
        float stepSize = uCloudThickness / float(CLOUD_STEPS);
        vec3 rayStep = rayDir * stepSize;
        vec3 wind = vec3(uTime * -uWindSpeedX, 0.0, uTime * -uWindSpeedZ);
        float transmittance = 1.0;
        float alpha = 0.0;
        vec3 color = vec3(0.0);

        for (int i = 0; i < CLOUD_STEPS; i++) {
          float density = cloudDensity(pos, wind);
          if (density > 0.01) {
            float light = cloudLight(pos, wind);
            float sunFacing = pow(saturate(dot(rayDir, uSunDirection)), 2.0);
            vec3 shaded = mix(vec3(0.66, 0.70, 0.77), vec3(1.0, 0.97, 0.88), light);
            vec3 rim = vec3(1.0, 0.82, 0.54) * sunFacing * 0.45;
            float absorb = exp(-density * stepSize * uCloudAbsorption * 0.18);
            color += transmittance * (shaded + rim) * density * 0.1;
            alpha += (1.0 - absorb) * (1.0 - alpha);
            transmittance *= absorb;
          }
          pos += rayStep;
        }

        float distanceFade = 1.0 - smoothstep(uMaxCloudDistance * 0.78, uMaxCloudDistance, t);
        alpha = saturate(alpha * distanceFade * 1.32);
        vec3 cloudColor = color / max(alpha, 0.035);
        cloudColor = mix(vec3(0.70, 0.75, 0.82), cloudColor, 0.78);
        cloudColor = clamp(cloudColor, vec3(0.54, 0.58, 0.66), vec3(1.15, 1.08, 0.98));
        return vec4(cloudColor, alpha);
      }

      vec4 renderDistantClouds(vec3 rayDir) {
        float up = saturate(rayDir.y * 0.9 + 0.16);
        if (rayDir.y <= -0.34) return vec4(0.0);

        float azimuth = atan(rayDir.x, rayDir.z) * 0.42;
        vec2 wind = vec2(uTime * -uWindSpeedX, uTime * -uWindSpeedZ) * 0.025;
        vec2 cloudUv = vec2(azimuth, (rayDir.y + 0.18) * 1.55) + wind;
        float large = fbm(vec3(cloudUv.x * 36.0, 18.0, cloudUv.y * 36.0));
        vec2 detailUv = cloudUv * 96.0 + vec2(12.7, -31.4);
        float detail = fbm(vec3(detailUv.x, 41.0, detailUv.y));
        float shape = large * 0.72 + detail * 0.28;
        float wave = sin(azimuth * 18.0 + rayDir.y * 9.0 + large * 3.4) * 0.5 + 0.5;
        float breakup = sin(azimuth * -31.0 + rayDir.y * 21.0 + detail * 5.2) * 0.5 + 0.5;
        float cutoff = mix(0.54, 0.26, uCloudCoverage);
        float billow = smoothstep(cutoff, cutoff + 0.16, shape * 0.58 + wave * 0.28 + breakup * 0.14);
        float lowerFade = smoothstep(-0.3, -0.035, rayDir.y);
        float upperFade = 1.0 - smoothstep(0.55, 0.92, up);
        float horizonBand = lowerFade * upperFade;
        float alpha = saturate(billow * horizonBand * 0.92);
        vec3 base = mix(vec3(0.67, 0.72, 0.82), vec3(1.0, 0.985, 0.94), smoothstep(cutoff, cutoff + 0.2, shape));
        float sunRim = pow(saturate(dot(rayDir, uSunDirection)), 6.0);
        base += vec3(1.0, 0.78, 0.45) * sunRim * 0.12;
        return vec4(base, alpha);
      }

      void main() {
        vec3 rayDir = normalize(vWorldPosition - cameraPosition);
        vec3 sky = getSkyColor(rayDir);
        vec4 clouds = renderClouds(cameraPosition, rayDir);
        vec4 distantClouds = renderDistantClouds(rayDir);
        float combinedAlpha = saturate(distantClouds.a + clouds.a * (1.0 - distantClouds.a));
        vec3 cloudColor = mix(distantClouds.rgb, clouds.rgb, clouds.a);
        cloudColor = mix(cloudColor, vec3(1.0, 0.98, 0.94), combinedAlpha * 0.1);
        vec3 finalColor = mix(sky, cloudColor, combinedAlpha);
        finalColor = pow(max(finalColor, vec3(0.0)), vec3(0.88));
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}
