import * as THREE from 'three';
import * as TSL from 'three/tsl';
const {
  Fn, If, Loop, Break, abs, attribute, cameraPosition, cameraNear, cameraFar, cameraProjectionMatrix,
  cameraProjectionMatrixInverse, cameraViewMatrix, cameraWorldMatrix, clamp, cross, dFdx, dFdy,
  dot, exp, float, floor, fract, fwidth, getScreenPosition, getViewPosition, length,
  max, min, mix, normalize, normalWorldGeometry, positionLocal, positionView, positionWorld, pow, reflect, refract,
  screenUV, screenSize, sin, smoothstep, texture, uniform, vec2, vec3, vec4, perspectiveDepthToViewZ,
  viewportDepthTexture, viewportTexture,
} = TSL as unknown as Record<string, any>;
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';
import type { RiverWaterShoreMaps } from './riverWaterShoreMaps.ts';
import type { WaterSurfaceProfile } from './WaterSurfaceProfile.ts';
import { getWaterSurfaceNoise } from './WaterSurfaceNoise.ts';
import type { SpectralWaterBinding } from './SpectralWaterSimulation.ts';

export const WATER_OPTICAL_MODES = ['final', 'normal', 'fresnel', 'surface-response',
  'flow-presence', 'foam-field', 'velocity', 'depth', 'reflection', 'refraction', 'shore', 'caustics'] as const;
export type WaterOpticalMode = typeof WATER_OPTICAL_MODES[number];

/** One daylight state for the water's reflected sky and its glint. */
export const waterLight = {
  direction: uniform(new THREE.Vector3(-0.55, 0.72, 0.42).normalize()),
  sun: uniform(new THREE.Color(1, 0.86, 0.65)),
  horizon: uniform(new THREE.Color(0.45, 0.59, 0.61)),
  zenith: uniform(new THREE.Color(0.17, 0.34, 0.49)),
  intensity: uniform(3),
  night: uniform(0),
  rain: uniform(0),
};

// TSL arithmetic overloads are still incomplete in @types/three. Keep dynamic
// node expressions inside this renderer module; external contracts stay typed.
type N = any;
// Share the node as well as its texture. ViewportSharedTextureNode updates by
// node identity, so each .sample clone can otherwise copy the framebuffer.
// ViewportTextureNode deduplicates references by render-target texture; these
// two owners take one opaque snapshot for playable and horizon water together.
const opaqueColor:N=viewportTexture();
const opaqueDepth:N=viewportDepthTexture();
opaqueColor.defaultFramebuffer.minFilter=THREE.LinearFilter;

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

function rainHeight(p:N,t:N):N {
  return Fn(()=>{
    const height:N=float(0).toVar();
    // Uniform branch removes the drop work during fair weather. Both rings
    // share the normal/optical field and fade below the pixel footprint.
    If(waterLight.rain.greaterThan(0.001),()=>{
      for(const shift of [0,0.47]) {
        const uv:N=p.mul(1.45).add(shift),cell:N=floor(uv);
        const hash:N=fract(sin(dot(cell,vec2(127.1,311.7))).mul(43758.5453));
        const age:N=fract(t.mul(1.7).add(hash));
        const radius:N=length(fract(uv).sub(0.5)).div(1.45);
        const front:N=radius.sub(age.mul(0.38));
        const phase:N=front.mul(115);
        const aa:N=float(1).sub(smoothstep(0.5,2.3,fwidth(phase)));
        height.addAssign(sin(phase).mul(exp(front.mul(front).mul(-1100)))
          .mul(smoothstep(0,0.1,age)).mul(float(1).sub(age)).mul(aa).mul(0.0018));
      }
    });
    return height.mul(waterLight.rain);
  })();
}

/** Incoming shallow waves slow into the bank; one function owns geometry and normals. */
function shoreWave(sdf:N,p:N,t:N,profile:WaterSurfaceProfile) {
  const phase:N=max(sdf,0).mul(profile.shoreWavenumber).add(t.mul(profile.shoreFrequency))
    .add(sin(p.x.mul(0.11).add(p.y.mul(0.09))).mul(0.6));
  const envelope:N=exp(max(sdf,0).mul(-profile.shoreDecay)).mul(smoothstep(-0.3,0.4,sdf));
  return {phase,envelope,height:sin(phase).mul(profile.shoreAmplitude).mul(envelope)};
}

/** Shared opaque framebuffer, bounded ray search, no second scene render. */
function traceReflection(depth: N, normalView: N, coastal: boolean): N {
  return Fn(() => {
    const origin: N = positionView.add(normalView.mul(0.09));
    const ray: N = reflect(normalize(positionView), normalView);
    const result: N = vec3(0).toVar();
    const previous: N = float(0.15).toVar();
    const found: N = float(0).toVar();
    Loop(coastal ? 12 : 16, ({i}: {i:N}) => {
      const travel: N = pow(2,float(i).mul(coastal ? 0.7 : 0.5)).mul(0.85);
      const p: N = origin.add(ray.mul(travel));
      const uv: N = getScreenPosition(p, cameraProjectionMatrix);
      const valid: N = uv.x.greaterThan(0.002).and(uv.x.lessThan(0.998))
        .and(uv.y.greaterThan(0.002)).and(uv.y.lessThan(0.998)).and(p.z.lessThan(-0.1));
      If(valid.not(),()=>{ Break(); });
      If(valid.and(found.lessThan(0.5)), () => {
        const sceneZ: N = perspectiveDepthToViewZ(depth.sample(uv).r,cameraNear,cameraFar);
        const gap: N = sceneZ.sub(p.z);
        If(gap.greaterThan(0).and(gap.lessThan(travel.sub(previous).mul(1.5).add(0.3))), () => {
          const lo: N = previous.toVar(), hi: N = travel.toVar();
          Loop(5, () => {
            const mid: N = lo.add(hi).mul(0.5);
            const q: N = origin.add(ray.mul(mid));
            const qUv: N = getScreenPosition(q,cameraProjectionMatrix);
            const qSceneZ: N = perspectiveDepthToViewZ(depth.sample(qUv).r,cameraNear,cameraFar);
            If(qSceneZ.greaterThan(q.z),()=>{ hi.assign(mid); }).Else(()=>{ lo.assign(mid); });
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
      If(found.greaterThan(0.5),()=>{ Break(); });
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
  const velocity: N = maps.hasFlow===false ? vec2(0) : hydraulics.rg;
  const speed: N = length(velocity);
  // Topology and velocity are distinct: stagnation behind a rock stays river.
  const flowing: N = maps.hasFlow===false ? float(0) : smoothstep(0.04,0.2,length(shore.ba.mul(2).sub(1)));
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
  const parcelB: N = maps.hasFlow===false ? parcelA : texture(noise,p.xz.sub(velocity.mul(phaseB).mul(6.25)).mul(0.045));
  const turbulenceNoise: N = mix(parcelA,parcelB,blend);
  const riverA: N = waveHeight(p.xz.sub(velocity.mul(phaseA).mul(6.25)),t,energy,true);
  const riverB: N = waveHeight(p.xz.sub(velocity.mul(phaseB).mul(6.25)),t,energy,true);
  const riverHeight: N = mix(riverA,riverB,blend);
  const openHeight: N = spectrum
    ? waveHeight(p.xz.mul(40),t.mul(Math.sqrt(40)),float(profile.openWaterWaveScale*0.015),false)
    : waveHeight(p.xz,t,float(profile.openWaterWaveScale),false);
  const shorelineWave=shoreWave(sdf,p.xz,t,profile);
  const lapPhase:N=shorelineWave.phase,lapEnvelope:N=shorelineWave.envelope,lap:N=shorelineWave.height;
  const h: N = mix(openHeight,riverHeight.mul(0.3).add(turbulenceNoise.r.sub(0.5).mul(0.16).mul(energy)),flowing)
    .add(lap).add(rainHeight(p.xz,t)).mul(smoothstep(-0.5,0.8,sdf));
  const restXZ:N=attribute('position','vec3').xz;
  const pixelAngle:N=float(2).div(cameraProjectionMatrix.element(1).element(1).mul(screenSize.y));
  const localDistance:N=length(cameraPosition.sub(attribute('position','vec3')));
  const pixelFootprint:N=localDistance.mul(localDistance).mul(pixelAngle)
    .div(max(abs(cameraPosition.y.sub(attribute('position','vec3').y)),0.3));
  let spectralSlope: N = vec2(0), spectralOffset: N = vec3(0), spectralFoam: N = float(0), horizontalDerivative:N=vec3(0);
  if(spectrum){
    for(const cascade of spectrum.cascades){
      const uv:N=restXZ.div(cascade.config.lengthScale);
      const field:N=texture(cascade.field1,uv);
      const field0:N=texture(cascade.field0,uv);
      const footprint:N=pixelFootprint;
      const aa:N=float(1).sub(smoothstep(cascade.config.shortestWavelength*0.2,cascade.config.shortestWavelength*0.7,footprint));
      const scale=profile.spectralHeightScale;
      spectralSlope=spectralSlope.add(field.rg.mul(aa).mul(scale));
      horizontalDerivative=horizontalDerivative.add(vec3(field.b,field.a,field0.a).mul(cascade.config.choppiness*scale).mul(aa));
      if(cascade.config.displacesMesh) {
        const localUv:N=positionLocal.xz.div(cascade.config.lengthScale);
        const vertexField:N=texture(cascade.field0,localUv);
        const spacing=maps.meshSpacing ?? 1;
        const meshBand=THREE.MathUtils.smoothstep(cascade.config.shortestWavelength,spacing*2,spacing*4);
        spectralOffset=spectralOffset.add(vec3(vertexField.r.mul(cascade.config.choppiness),vertexField.b,vertexField.g.mul(cascade.config.choppiness)).mul(scale*meshBand).mul(aa));
      }
      spectralFoam=max(spectralFoam,cascade.foam.sample(uv).r.mul(aa));
    }
  }
  const spectralGate:N=float(1).sub(flowing).mul(smoothstep(0.4,3,hydraulics.b));
  const jxx:N=horizontalDerivative.x.mul(spectralGate).add(1),jzz:N=horizontalDerivative.y.mul(spectralGate).add(1),jxz:N=horizontalDerivative.z.mul(spectralGate);
  const jacobian:N=jxx.mul(jzz).sub(jxz.mul(jxz));
  const inverseJ:N=float(1).div(max(jacobian,0.2));
  const correctedSlope:N=vec2(spectralSlope.x.mul(jzz).sub(spectralSlope.y.mul(jxz)),spectralSlope.y.mul(jxx).sub(spectralSlope.x.mul(jxz))).mul(inverseJ).mul(spectralGate);
  const virtualP: N = vec3(p.x,h,p.z);
  const geometric: N = normalize(cross(dFdy(virtualP),dFdx(virtualP)));
  const detailN:N=geometric.mul(geometric.y.lessThan(0).select(-1,1));
  const n: N = normalize(vec3(detailN.x.add(normalWorldGeometry.x.mul(flowing)).sub(correctedSlope.x),
    detailN.y,detailN.z.add(normalWorldGeometry.z.mul(flowing)).sub(correctedSlope.y)));
  const nv: N = normalize(cameraViewMatrix.mul(vec4(n,0)).xyz);
  const v: N = normalize(cameraPosition.sub(p));
  const ndv: N = clamp(dot(n,v),0,1);
  const fresnel: N = pow(float(1).sub(ndv),5).mul(0.9796).add(0.0204);
  const depth: N = opaqueDepth;
  const color: N = opaqueColor;
  const sceneAtPixel: N = getViewPosition(screenUV,depth.r,cameraProjectionMatrixInverse);
  const rayDepth: N = max(positionView.z.sub(sceneAtPixel.z),0);
  const thickness: N = min(rayDepth,max(hydraulics.b,0.05).div(max(ndv,0.18)));
  const offset: N = nv.xy.mul(0.023).mul(min(thickness,2.5));
  const refractUv: N = clamp(screenUV.add(offset),0.002,0.998);
  const behindOffset: N = getViewPosition(refractUv,depth.sample(refractUv).r,cameraProjectionMatrixInverse);
  const validRefraction: N = smoothstep(0.015,0.16,positionView.z.sub(behindOffset.z));
  const safeUv: N = mix(screenUV,refractUv,validRefraction);
  const transmitted: N = color.sample(safeUv).rgb;
  const absorption: N = vec3(...profile.absorption);
  const transmittance: N = exp(absorption.mul(thickness).negate());
  const bodyTint: N = vec3(...profile.scatteringColor);
  // Differential-area focusing at the local bed plane, driven by the same
  // surface normal used by optics. Finite footprint and bounded gain suppress
  // singular fold flashes; this is local focusing, not a multi-bounce caustic solve.
  const solarRay:N=refract(waterLight.direction.negate(),n,1/1.333);
  const solarBed:N=p.xz.add(solarRay.xz.mul(min(hydraulics.b,5)).div(max(solarRay.y.negate(),0.2)));
  const bx:N=dFdx(solarBed),bz:N=dFdy(solarBed),px:N=dFdx(p.xz),pz:N=dFdy(p.xz);
  const area:N=max(abs(px.x.mul(pz.y).sub(px.y.mul(pz.x))),0.000001);
  const projectedArea:N=abs(bx.x.mul(bz.y).sub(bx.y.mul(bz.x)));
  const focus:N=clamp(area.div(max(projectedArea,area.mul(0.32))),0.55,2.6);
  const causticStrength:N=exp(hydraulics.b.mul(-0.25)).mul(max(waterLight.direction.y,0))
    .mul(float(1).sub(smoothstep(0.12,0.7,max(length(px),length(pz)))))
    .mul(float(1).sub(waterLight.night)).mul(0.32);
  const caustic:N=mix(1,focus,causticStrength);
  const body: N = transmitted.mul(caustic).mul(transmittance).add(bodyTint.mul(float(1).sub(transmittance)))
    .mul(mix(1,0.3,waterLight.night));
  const reflectedDir: N = reflect(v.negate(),n);
  const sky: N = mix(waterLight.horizon,waterLight.zenith,pow(max(reflectedDir.y,0),0.45));
  // Resolve the stable macro interface, then distort its radiance by the
  // sub-grid ripple. Marching every capillary normal independently causes
  // binary hit/miss shimmer along the reflected tree line.
  const macroView:N=normalize(cameraViewMatrix.mul(vec4(0,1,0,0)).xyz);
  const hit: N = traceReflection(depth,macroView,profile.id==='coastal');
  const reflectionUv:N=clamp(hit.xy.add(nv.xy.sub(macroView.xy).mul(0.036)),0.002,0.998);
  const reflectedScene: N = color.sample(reflectionUv).rgb;
  const reflection: N = mix(sky,reflectedScene,hit.z);
  const half: N = normalize(v.add(waterLight.direction));
  const ndh: N = max(dot(n,half),0);
  const roughness: N = mix(profile.roughness*0.25,0.19,turbulence).add(min(fwidth(n.x).add(fwidth(n.z)),0.25));
  const alpha2: N = pow(roughness,4);
  const denom: N = ndh.mul(ndh).mul(alpha2.sub(1)).add(1);
  const ggx: N = alpha2.div(denom.mul(denom).mul(Math.PI));
  const sun: N = waterLight.sun.mul(min(ggx.mul(0.007*profile.specularIntensity/0.54),3)).mul(waterLight.intensity)
    .mul(max(dot(n,waterLight.direction),0)).mul(float(1).sub(waterLight.night));
  const foamNoise: N = turbulenceNoise.g;
  const lace: N = smoothstep(0.43,0.69,foamNoise);
  const rapidFoam: N = turbulence.mul(lace.mul(0.65).add(0.10)).mul(flowing);
  const breaker: N = smoothstep(0.60,0.98,sin(lapPhase)).mul(lapEnvelope)
    .mul(profile.shoreBreakStrength).mul(lace.mul(0.6).add(0.25));
  const foam: N = min(max(max(rapidFoam,breaker),spectralFoam.mul(spectralGate).mul(profile.id==='inland'?0.08:0.22).mul(lace)),0.86);
  const foamLight: N = waterLight.horizon.mul(0.5).add(waterLight.sun.mul(0.45))
    .mul(mix(1,0.24,waterLight.night));
  const final: N = mix(mix(body,reflection,fresnel).add(sun),foamLight,foam);
  const runup:N=smoothstep(-0.28,0.35,sdf.add(lap.mul(profile.id==='coastal'?6:3)));
  const alpha: N = wet.mul(smoothstep(0,0.09,rayDepth)).mul(runup);
  const colors: Record<WaterOpticalMode,N> = {
    final, normal:n.mul(0.5).add(0.5), fresnel:vec3(fresnel),
    'surface-response':vec3(h.mul(3).add(0.5),turbulence,ndv),
    'flow-presence':vec3(flowing,float(1).sub(flowing),wet),
    'foam-field':vec3(turbulence,foam,lapEnvelope),
    velocity:vec3(velocity.mul(0.22).add(0.5),speed.mul(0.3)),
    depth:vec3(transmittance),reflection,refraction:body,shore:vec3(lapEnvelope,breaker,wet),caustics:vec3(caustic.mul(0.5)),
  };
  const localMapUv:N=positionLocal.xz.sub(vec2(maps.originX,maps.originZ)).mul(vec2(maps.invSpanX,maps.invSpanZ));
  const localShore:N=texture(maps.shoreTexture,localMapUv);
  const localOpen:N=float(1).sub(smoothstep(0.04,0.2,length(localShore.ba.mul(2).sub(1))));
  const localHydraulics:N=maps.hydraulicTexture?texture(maps.hydraulicTexture,localMapUv):vec4(0,0,5,localShore.r.mul(8));
  const localDepth:N=localHydraulics.b;
  const mapEdgeMeters:N=min(min(localMapUv.x,float(1).sub(localMapUv.x)).div(maps.invSpanX),
    min(localMapUv.y,float(1).sub(localMapUv.y)).div(maps.invSpanZ));
  const horizonJoin:N=maps.displacementEdgeFade ? smoothstep(0,maps.displacementEdgeFade,mapEdgeMeters) : float(1);
  const displaced:N=spectralOffset.mul(localOpen).mul(attribute('featherAlpha','float')).mul(localShore.r).mul(smoothstep(0.4,3,localDepth)).mul(horizonJoin);
  const shoreDisplacement:N=shoreWave(localHydraulics.a,positionLocal.xz,t,profile).height.mul(attribute('featherAlpha','float'));
  return { colors, alpha, normal:nv,
    position:vec3(positionLocal.x,positionLocal.y.add(shoreDisplacement),positionLocal.z).add(displaced) };
}
