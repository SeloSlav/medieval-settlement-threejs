import * as THREE from 'three';
import type { Matrix3RowMajor } from './celestialPrecession.ts';
import { GORSKI_KOTAR_LATITUDE_DEG } from './gorskiKotarCelestial.ts';

export type OpenSkyFallbackOptions = {
  cloudCoverage: number;
  constellationVisibility: number;
  epochToJ2000Precession: Matrix3RowMajor;
  observerLatitudeDeg?: number;
  radius: number;
  siderealAngle?: number;
  starBackdrop?: THREE.Texture;
  starMap: THREE.Texture;
  sunDirection: THREE.Vector3;
};

/**
 * Small MIT-project fallback for browsers that cannot run Eanpa's WebGPU/TSL
 * engine. Native WebGPU and Three's node-WebGL backend both use Eanpa; this
 * shader only prevents the final legacy WebGL fallback from losing the sky.
 */
export class OpenSkyFallback extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(options: OpenSkyFallbackOptions) {
    const precession = options.epochToJ2000Precession;
    const uniforms = {
      uCloudCoverage: { value: options.cloudCoverage },
      uConstellationVisibility: { value: options.constellationVisibility },
      uDawnAmount: { value: 0 },
      uDuskAmount: { value: 0 },
      uEpochToJ2000: {
        value: new THREE.Matrix3().set(
          precession[0], precession[1], precession[2],
          precession[3], precession[4], precession[5],
          precession[6], precession[7], precession[8],
        ),
      },
      uHasStarBackdrop: { value: options.starBackdrop ? 1 : 0 },
      uObserverLatitude: {
        value: THREE.MathUtils.degToRad(
          options.observerLatitudeDeg ?? GORSKI_KOTAR_LATITUDE_DEG,
        ),
      },
      uSiderealAngle: { value: options.siderealAngle ?? 0 },
      uStarBackdrop: { value: options.starBackdrop ?? options.starMap },
      uStarMap: { value: options.starMap },
      uSunDirection: { value: options.sunDirection.clone().normalize() },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      depthTest: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      toneMapped: true,
      uniforms,
      vertexShader: `
        varying vec3 vSkyDirection;

        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;

        uniform float uCloudCoverage;
        uniform float uConstellationVisibility;
        uniform float uDawnAmount;
        uniform float uDuskAmount;
        uniform mat3 uEpochToJ2000;
        uniform float uHasStarBackdrop;
        uniform float uObserverLatitude;
        uniform float uSiderealAngle;
        uniform sampler2D uStarBackdrop;
        uniform sampler2D uStarMap;
        uniform vec3 uSunDirection;
        uniform float uTime;
        varying vec3 vSkyDirection;

        const float PI = 3.141592653589793;
        const float TWO_PI = 6.283185307179586;

        float hash21(vec2 point) {
          vec3 p3 = fract(vec3(point.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float valueNoise(vec2 point) {
          vec2 cell = floor(point);
          vec2 local = fract(point);
          vec2 curve = local * local * (3.0 - 2.0 * local);
          float a = hash21(cell);
          float b = hash21(cell + vec2(1.0, 0.0));
          float c = hash21(cell + vec2(0.0, 1.0));
          float d = hash21(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
        }

        float cloudFbm(vec2 point) {
          float sum = 0.0;
          float weight = 0.55;
          mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
          for (int octave = 0; octave < 5; octave += 1) {
            sum += valueNoise(point) * weight;
            point = turn * point * 2.03 + vec2(7.1, -3.8);
            weight *= 0.5;
          }
          return sum;
        }

        void main() {
          vec3 ray = normalize(vSkyDirection);
          float up = clamp(ray.y, 0.0, 1.0);
          float sunHeight = clamp(uSunDirection.y, -1.0, 1.0);
          float dayAmount = smoothstep(-0.14, 0.12, sunHeight);
          float nightAmount = 1.0 - smoothstep(-0.25, -0.08, sunHeight);
          float twilight = max(uDawnAmount, uDuskAmount);

          vec3 nightHorizon = vec3(0.028, 0.045, 0.095);
          vec3 nightZenith = vec3(0.008, 0.014, 0.050);
          vec3 dayHorizon = vec3(0.58, 0.75, 0.90);
          vec3 dayZenith = vec3(0.11, 0.34, 0.78);
          vec3 sky = mix(
            mix(nightHorizon, nightZenith, pow(up, 0.58)),
            mix(dayHorizon, dayZenith, pow(up, 0.58)),
            dayAmount
          );
          vec3 duskColor = mix(vec3(1.0, 0.50, 0.25), vec3(0.45, 0.22, 0.32), up);
          sky = mix(sky, duskColor, twilight * pow(1.0 - up, 2.2) * 0.72);

          float sunDot = max(dot(ray, uSunDirection), 0.0);
          sky += mix(vec3(1.0, 0.68, 0.28), vec3(1.0, 0.94, 0.82), dayAmount)
            * (pow(sunDot, 700.0) * 2.5 + pow(sunDot, 28.0) * 0.16)
            * smoothstep(-0.04, 0.02, sunHeight);

          float sinLatitude = sin(uObserverLatitude);
          float cosLatitude = cos(uObserverLatitude);
          float sinSidereal = sin(uSiderealAngle);
          float cosSidereal = cos(uSiderealAngle);
          float meridian = cosLatitude * ray.y - sinLatitude * ray.z;
          float celestialNorth = sinLatitude * ray.y + cosLatitude * ray.z;
          vec3 equatorialDirection = normalize(vec3(
            meridian * cosSidereal - ray.x * sinSidereal,
            celestialNorth,
            meridian * sinSidereal + ray.x * cosSidereal
          ));
          vec2 starUv = vec2(
            fract(atan(equatorialDirection.z, equatorialDirection.x) / TWO_PI + 1.0),
            0.5 - asin(clamp(equatorialDirection.y, -1.0, 1.0)) / PI
          );
          vec3 j2000Direction = normalize(uEpochToJ2000 * equatorialDirection);
          vec2 backdropUv = vec2(
            fract(0.5 - atan(j2000Direction.z, j2000Direction.x) / TWO_PI),
            0.5 - asin(clamp(j2000Direction.y, -1.0, 1.0)) / PI
          );
          vec3 backdrop = texture2D(uStarBackdrop, backdropUv).rgb;
          backdrop = backdrop * backdrop * uHasStarBackdrop * 1.6;
          vec4 catalog = texture2D(uStarMap, starUv);
          float starVisibility = nightAmount * smoothstep(0.035, 0.18, ray.y);
          float twinkle = 0.97 + 0.03 * sin(
            uTime * 0.07 + dot(floor(starUv * 1024.0), vec2(0.067, 0.113))
          );
          vec3 historicalStars = catalog.rgb * catalog.rgb * twinkle * 1.48;
          sky += max(backdrop, historicalStars) * starVisibility;
          sky += vec3(0.31, 0.45, 0.67) * catalog.a * starVisibility
            * uConstellationVisibility * 1.55;

          vec3 moonDirection = normalize(-uSunDirection);
          float moonFacing = max(dot(ray, moonDirection), 0.0);
          float moonVisibility = nightAmount * smoothstep(-0.035, 0.09, moonDirection.y);
          sky += vec3(0.78, 0.85, 1.0)
            * (smoothstep(0.99972, 0.99988, moonFacing) + pow(moonFacing, 320.0) * 0.14)
            * moonVisibility;

          float horizonGate = smoothstep(0.015, 0.14, ray.y);
          vec2 cloudRay = ray.xz / max(ray.y + 0.22, 0.10);
          vec2 cloudPoint = cloudRay * 1.35
            + vec2(uTime * 0.0075, uTime * 0.0042);
          float cloudNoise = cloudFbm(cloudPoint);
          float threshold = mix(0.78, 0.48, clamp(uCloudCoverage, 0.0, 1.0));
          float cloud = smoothstep(threshold, threshold + 0.13, cloudNoise) * horizonGate;
          float cloudLight = 0.42 + 0.58 * smoothstep(-0.15, 0.55, dot(
            normalize(vec3(ray.x, max(ray.y, 0.08), ray.z)),
            uSunDirection
          ));
          vec3 cloudDay = mix(vec3(0.57, 0.62, 0.68), vec3(1.08, 1.04, 0.96), cloudLight);
          vec3 cloudNight = vec3(0.085, 0.105, 0.16) * (0.72 + cloudLight * 0.28);
          sky = mix(sky, mix(cloudNight, cloudDay, dayAmount), cloud * 0.88);

          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    super(new THREE.SphereGeometry(options.radius, 48, 24), material);
    this.name = 'Eanpa Sky legacy WebGL compatibility fallback';
    this.frustumCulled = false;
    this.renderOrder = -100;
    this.userData.isSkyCloudMesh = true;
  }

  updateAtmosphere(dawnAmount: number, duskAmount: number): void {
    this.material.uniforms.uDawnAmount.value = dawnAmount;
    this.material.uniforms.uDuskAmount.value = duskAmount;
  }

  updateCamera(camera: THREE.Camera): void {
    this.position.copy(camera.position);
  }

  updateConstellationVisibility(visibility: number): void {
    this.material.uniforms.uConstellationVisibility.value = visibility;
  }

  updateSiderealAngle(angle: number): void {
    this.material.uniforms.uSiderealAngle.value = angle;
  }

  updateSun(direction: THREE.Vector3): void {
    (this.material.uniforms.uSunDirection.value as THREE.Vector3)
      .copy(direction)
      .normalize();
  }

  updateTime(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
