import * as THREE from 'three';
import * as TSL from 'three/tsl';
const {
  Fn, If, Loop, abs, attribute, cameraPosition, cameraProjectionMatrix,
  cameraProjectionMatrixInverse, cameraViewMatrix, cameraWorldMatrix, clamp, cross, dFdx, dFdy,
  dot, exp, float, fract, fwidth, getScreenPosition, getViewPosition, length,
  max, min, mix, normalize, normalWorldGeometry, positionLocal, positionView, positionWorld, pow, reflect,
  screenUV, sin, smoothstep, texture, uniform, vec2, vec3, vec4,
  viewportDepthTexture, viewportSharedTexture,
} = TSL as unknown as Record<string, any>;
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';
import type { WaterSurfaceProfile } from './WaterSurfaceProfile.ts';
import { getWaterSurfaceNoise } from './WaterSurfaceNoise.ts';
import type { SpectralWaterBinding } from './SpectralWaterSimulation.ts';

export const WATER_OPTICAL_MODES = ['final', 'normal', 'fresnel', 'surface-response',
  'flow-presence', 'foam-field', 'velocity', 'depth', 'reflection', 'refraction', 'shore'] as const;
export type WaterOpticalMode = typeof WATER_OPTICAL_MODES[number];

/** One daylight state for the water's reflected sky and its glint. */
export const waterLight = {
  direction: uniform(new THREE.Vector3(-0.55, 0.72, 0.42).normalize()),
  sun: uniform(new THREE.Color(1, 0.86, 0.65)),
  horizon: uniform(new THREE.Color(0.45, 0.59, 0.61)),
  zenith: uniform(new THREE.Color(0.17, 0.34, 0.49)),
  intensity: uniform(3),
  night: uniform(0),
};

// TSL arithmetic overloads are still incomplete in @types/three. Keep dynamic
// node expressions inside this renderer module; external contracts stay typed.
type N = any;

function waveHeight(p: N, time: N, energy: N, river: boolean): N {
  let h: N = float(0);
  const bands = river
    ? [[0.84,0.54,2.5,0.026,0.22],[-0.38,0.925,4.7,0.012,-0.15],[0.96,-0.28,8.1,0.004,0.31]]
    : [[0.84,0.54,0.72,0.075,2.66],[-0.38,0.925,1.27,0.042,3.53],[0.96,-0.28,3.8,0.012,6.1]];
  for (const [x,z,k,a,w] of bands) {
    const phase: N = dot(p, vec2(x,z)).mul(k).sub(time.mul(w));
    const aa: N = float(1).sub(smoothstep(0.45,2.2,fwidth(phase)));
    h = h.add(sin(phase).mul(a).mul(aa));
  }
  return h.mul(energy);
}

/** Shared opaque framebuffer, bounded ray search, no second scene render. */
function traceReflection(depth: N, normalView: N): N {
  return Fn(() => {
    const origin: N = positionView.add(normalView.mul(0.09));
    const ray: N = reflect(normalize(positionView), normalView);
    const result: N = vec3(0).toVar();
    const previous: N = float(0.15).toVar();
    const found: N = float(0).toVar();
    Loop(24, ({i}: {i:N}) => {
      const travel: N = float(i).add(1).pow(1.7).mul(0.65);
      const p: N = origin.add(ray.mul(travel));
      const uv: N = getScreenPosition(p, cameraProjectionMatrix);
      const valid: N = uv.x.greaterThan(0.002).and(uv.x.lessThan(0.998))
        .and(uv.y.greaterThan(0.002)).and(uv.y.lessThan(0.998)).and(p.z.lessThan(-0.1));
      If(valid.and(found.lessThan(0.5)), () => {
        const sceneP: N = getViewPosition(uv,depth.sample(uv).r,cameraProjectionMatrixInverse);
        const gap: N = sceneP.z.sub(p.z);
        If(gap.greaterThan(0).and(gap.lessThan(travel.sub(previous).mul(1.5).add(0.3))), () => {
          const lo: N = previous.toVar(), hi: N = travel.toVar();
          Loop(5, () => {
            const mid: N = lo.add(hi).mul(0.5);
            const q: N = origin.add(ray.mul(mid));
            const qUv: N = getScreenPosition(q,cameraProjectionMatrix);
            const qScene: N = getViewPosition(qUv,depth.sample(qUv).r,cameraProjectionMatrixInverse);
            If(qScene.z.greaterThan(q.z),()=>hi.assign(mid)).Else(()=>lo.assign(mid));
          });
          const hit: N = origin.add(ray.mul(hi));
          const hitUv: N = getScreenPosition(hit,cameraProjectionMatrix);
          const hitP: N = getViewPosition(hitUv,depth.sample(hitUv).r,cameraProjectionMatrixInverse);
          const error: N = abs(hitP.z.sub(hit.z));
          const edge: N = min(min(hitUv.x,float(1).sub(hitUv.x)),min(hitUv.y,float(1).sub(hitUv.y)));
          const worldHit: N = cameraWorldMatrix.mul(vec4(hitP,1)).xyz;
          const aboveSurface: N = smoothstep(-0.05,0.12,worldHit.y.sub(positionWorld.y));
          result.assign(vec3(hitUv,smoothstep(0.005,0.08,edge)
            .mul(float(1).sub(smoothstep(0.1,1.4,error))).mul(aboveSurface)));
          found.assign(1);
        });
      });
      previous.assign(travel);
    });
    return result;
  })();
}

export function buildWaterOptics(maps: RiverWaterShoreMaps, profile: WaterSurfaceProfile, spectrum?:SpectralWaterBinding) {
  const p: N = positionWorld;
  const t: N = worldAnimationTime;
  const mapUv: N = p.xz.sub(vec2(maps.originX,maps.originZ)).mul(vec2(maps.invSpanX,maps.invSpanZ));
  const shore: N = texture(maps.shoreTexture,mapUv);
  const hydraulics: N = maps.hydraulicTexture ? texture(maps.hydraulicTexture,mapUv)
    : vec4(shore.ba.mul(2).sub(1).mul(0.9),1.4,shore.r.mul(8));
  const velocity: N = hydraulics.rg;
  const speed: N = length(velocity);
  // Topology and velocity are distinct: stagnation behind a rock stays river.
  const flowing: N = smoothstep(0.04,0.2,length(shore.ba.mul(2).sub(1)));
  const sdf: N = hydraulics.a;
  const wet: N = min(shore.r,attribute('featherAlpha','float'));
  const turbulence: N = shore.g;
  // Two bounded advection phases crossfade at their resets. World positions
  // never rotate by a varying flow vector, so bends cannot introduce UV seams.
  const cycle: N = t.mul(0.16);
  const phaseA: N = fract(cycle), phaseB: N = fract(cycle.add(0.5));
  const blend: N = abs(phaseA.mul(2).sub(1));
  const energy: N = speed.mul(0.22).add(0.14).mul(turbulence.mul(3.8).add(1));
  const noise = getWaterSurfaceNoise();
  const parcelA: N = texture(noise,p.xz.sub(velocity.mul(phaseA).mul(6.25)).mul(0.045));
  const parcelB: N = texture(noise,p.xz.sub(velocity.mul(phaseB).mul(6.25)).mul(0.045));
  const turbulenceNoise: N = mix(parcelA,parcelB,blend);
  const riverA: N = waveHeight(p.xz.sub(velocity.mul(phaseA).mul(6.25)),t,energy,true);
  const riverB: N = waveHeight(p.xz.sub(velocity.mul(phaseB).mul(6.25)),t,energy,true);
  const riverHeight: N = mix(riverA,riverB,blend);
  const openHeight: N = waveHeight(p.xz,t,float(profile.openWaterWaveScale),false);
  const lapPeriod = profile.id === 'coastal' ? 1.45 : profile.id === 'inland' ? 2.3 : 2.8;
  const lapAmplitude = profile.id === 'coastal' ? 0.085 : profile.id === 'inland' ? 0.016 : 0.007;
  const lapPhase: N = max(sdf,0).mul(profile.id === 'coastal' ? 1.7 : 3.8).add(t.mul(lapPeriod))
    .add(sin(p.x.mul(0.11).add(p.z.mul(0.09))).mul(0.6));
  const lapEnvelope: N = exp(max(sdf,0).mul(profile.id === 'coastal' ? -0.24 : -0.8)).mul(smoothstep(-0.3,0.4,sdf));
  const lap: N = sin(lapPhase).mul(lapAmplitude).mul(lapEnvelope);
  const h: N = mix(openHeight,riverHeight.mul(0.3).add(turbulenceNoise.r.sub(0.5).mul(0.16).mul(energy)),flowing)
    .add(lap).mul(smoothstep(-0.5,0.8,sdf));
  let spectralSlope: N = vec2(0), spectralHeight: N = float(0), spectralFoam: N = float(0);
  if(spectrum){
    for(const cascade of spectrum.cascades){
      const uv:N=p.xz.div(cascade.config.lengthScale);
      const field:N=texture(cascade.field1,uv);
      const footprint:N=max(length(dFdx(p.xz)),length(dFdy(p.xz)));
      const aa:N=float(1).sub(smoothstep(cascade.config.shortestWavelength*0.2,cascade.config.shortestWavelength*0.7,footprint));
      const scale=profile.id==='inland'?0.12:0.72;
      spectralSlope=spectralSlope.add(field.rg.mul(aa).mul(scale));
      if(cascade.config.displacesMesh) {
        const localUv:N=positionLocal.xz.div(cascade.config.lengthScale);
        spectralHeight=spectralHeight.add(texture(cascade.field0,localUv).b.mul(scale));
      }
      const foam0:N=texture(cascade.foam0,uv).r,foam1:N=texture(cascade.foam1,uv).r;
      spectralFoam=max(spectralFoam,mix(foam0,foam1,spectrum.foamPing).mul(aa));
    }
  }
  const spectralGate:N=float(1).sub(flowing).mul(smoothstep(0.4,3,hydraulics.b));
  const virtualP: N = vec3(p.x,h,p.z);
  const geometric: N = normalize(cross(dFdy(virtualP),dFdx(virtualP)));
  const detailN:N=geometric.mul(geometric.y.lessThan(0).select(-1,1));
  const n: N = normalize(vec3(detailN.x.add(normalWorldGeometry.x.mul(flowing)).sub(spectralSlope.x.mul(spectralGate)),
    detailN.y,detailN.z.add(normalWorldGeometry.z.mul(flowing)).sub(spectralSlope.y.mul(spectralGate))));
  const nv: N = normalize(cameraViewMatrix.mul(vec4(n,0)).xyz);
  const v: N = normalize(cameraPosition.sub(p));
  const ndv: N = clamp(dot(n,v),0,1);
  const fresnel: N = pow(float(1).sub(ndv),5).mul(0.9796).add(0.0204);
  const depth: N = viewportDepthTexture();
  const color: N = viewportSharedTexture();
  const sceneAtPixel: N = getViewPosition(screenUV,depth.r,cameraProjectionMatrixInverse);
  const rayDepth: N = max(positionView.z.sub(sceneAtPixel.z),0);
  const thickness: N = min(rayDepth,max(hydraulics.b,0.05).div(max(ndv,0.18)));
  const offset: N = nv.xy.mul(0.023).mul(min(thickness,2.5));
  const refractUv: N = clamp(screenUV.add(offset),0.002,0.998);
  const behindOffset: N = getViewPosition(refractUv,depth.sample(refractUv).r,cameraProjectionMatrixInverse);
  const validRefraction: N = smoothstep(0.015,0.16,positionView.z.sub(behindOffset.z));
  const safeUv: N = mix(screenUV,refractUv,validRefraction);
  const transmitted: N = color.sample(safeUv).rgb;
  const absorption: N = profile.id === 'coastal' ? vec3(0.24,0.065,0.04)
    : profile.id === 'inland' ? vec3(0.39,0.13,0.19) : vec3(0.26,0.09,0.145);
  const transmittance: N = exp(absorption.mul(thickness).negate());
  const bodyTint: N = profile.id === 'coastal' ? vec3(0.025,0.17,0.22) : vec3(0.035,0.20,0.155);
  const body: N = transmitted.mul(transmittance).add(bodyTint.mul(float(1).sub(transmittance)))
    .mul(mix(1,0.3,waterLight.night));
  const reflectedDir: N = reflect(v.negate(),n);
  const sky: N = mix(waterLight.horizon,waterLight.zenith,pow(max(reflectedDir.y,0),0.45));
  const hit: N = traceReflection(depth,nv);
  const reflectedScene: N = color.sample(hit.xy).rgb;
  const reflection: N = mix(sky,reflectedScene,hit.z);
  const half: N = normalize(v.add(waterLight.direction));
  const ndh: N = max(dot(n,half),0);
  const roughness: N = mix(0.07,0.19,turbulence).add(min(fwidth(n.x).add(fwidth(n.z)),0.25));
  const alpha2: N = pow(roughness,4);
  const denom: N = ndh.mul(ndh).mul(alpha2.sub(1)).add(1);
  const ggx: N = alpha2.div(denom.mul(denom).mul(Math.PI));
  const sun: N = waterLight.sun.mul(min(ggx.mul(0.007),3)).mul(waterLight.intensity)
    .mul(max(dot(n,waterLight.direction),0)).mul(float(1).sub(waterLight.night));
  const foamNoise: N = turbulenceNoise.g;
  const lace: N = smoothstep(0.43,0.69,foamNoise);
  const rapidFoam: N = turbulence.mul(lace.mul(0.65).add(0.10)).mul(flowing);
  const breaker: N = smoothstep(0.60,0.98,sin(lapPhase)).mul(lapEnvelope)
    .mul(profile.shoreBreakStrength).mul(lace.mul(0.6).add(0.25));
  const foam: N = min(max(max(rapidFoam,breaker),spectralFoam.mul(spectralGate).mul(profile.id==='inland'?0.08:0.45).mul(lace)),0.86);
  const foamLight: N = waterLight.horizon.mul(0.5).add(waterLight.sun.mul(0.45))
    .mul(mix(1,0.24,waterLight.night));
  const final: N = mix(mix(body,reflection,fresnel).add(sun),foamLight,foam);
  const alpha: N = wet.mul(smoothstep(0,0.09,rayDepth));
  const colors: Record<WaterOpticalMode,N> = {
    final, normal:n.mul(0.5).add(0.5), fresnel:vec3(fresnel),
    'surface-response':vec3(h.mul(3).add(0.5),turbulence,ndv),
    'flow-presence':vec3(flowing,float(1).sub(flowing),wet),
    'foam-field':vec3(turbulence,foam,lapEnvelope),
    velocity:vec3(velocity.mul(0.22).add(0.5),speed.mul(0.3)),
    depth:vec3(transmittance),reflection,refraction:body,shore:vec3(lapEnvelope,breaker,wet),
  };
  const localMapUv:N=positionLocal.xz.sub(vec2(maps.originX,maps.originZ)).mul(vec2(maps.invSpanX,maps.invSpanZ));
  const localShore:N=texture(maps.shoreTexture,localMapUv);
  const localOpen:N=float(1).sub(smoothstep(0.04,0.2,length(localShore.ba.mul(2).sub(1))));
  const displaced:N=spectralHeight.mul(localOpen).mul(attribute('featherAlpha','float')).mul(localShore.r);
  return { colors, alpha, normal:nv,
    position:vec3(positionLocal.x,positionLocal.y.add(attribute('simDelta','float')).add(displaced),positionLocal.z) };
}
