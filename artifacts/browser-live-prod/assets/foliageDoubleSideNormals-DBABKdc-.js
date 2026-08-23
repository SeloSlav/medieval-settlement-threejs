import{Fr as e,Jr as t,Pr as n,Tr as r,Ur as i,Xr as a,Yr as o,_r as s,ai as c,dr as l,ei as u,fr as d,oi as f,ri as p,xr as m,yr as h}from"./seedthree-vendor-DlI6mVJ-.js";import{n as g}from"./worldAnimationTime-CvrhegUe.js";function _(e,t,n){let r=e.onBeforeCompile,i=e.customProgramCacheKey;e.customProgramCacheKey=()=>`${i?.call(e)??``}${t}`,e.onBeforeCompile=(t,i)=>{r?.call(e,t,i),n(t)}}var v={attribute:s,float:r,positionLocal:i,sin:t,time:g,uv:p,vec3:c,windSpeed:l,windStrength:d},y={attribute:s,cameraPosition:h,cos:m,float:r,modelWorldMatrix:n,normalLocal:e,positionLocal:i,sin:t,smoothstep:o,step:a,time:g,transformNormalToView:u,vec4:f,windSpeed:l,windStrength:d},b=-1e3;function x(e,t){let n=v.time.mul(v.windSpeed),r=e.x.mul(.35).add(e.z.mul(.27)).mul(t);return v.sin(n.mul(1.15).add(r)).mul(.72).add(v.sin(n.mul(2.63).add(r.mul(1.9))).mul(.28))}function S(e=.16){let t=v.positionLocal,n=v.uv().y.mul(v.uv().y),r=v.windStrength.mul(e),i=v.attribute(`aAnchorPos`,`vec3`),a=x(i,2).mul(r),o=v.time.mul(v.windSpeed).mul(3).add(i.z.mul(1.7)).add(i.x.mul(1.3)),s=v.sin(o).mul(r).mul(.18),c=a.add(s).mul(n),l=v.attribute(`aWindVec`,`vec3`);return v.vec3(t.x.add(l.x.mul(c)),t.y,t.z.add(l.z.mul(c)))}function C(e,t,n){let r=y.cos(n),i=y.sin(n);return e.mul(r).add(t.cross(e).mul(i)).add(t.mul(t.dot(e)).mul(y.float(1).sub(r)))}function w(){let e=y.positionLocal,t=y.attribute(`aIvyRootPhase`,`vec4`),n=y.attribute(`aIvyHinge`,`vec4`),r=n.xyz.length(),i=n.xyz.div(r.max(1e-5)),a=y.modelWorldMatrix.mul(y.vec4(t.xyz,1)).xyz,o=y.cameraPosition.sub(a).length(),s=y.float(1).sub(y.smoothstep(22,44,o).mul(.85)),c=y.float(1).sub(y.smoothstep(8,28,o)),l=y.smoothstep(.05,.12,n.w),u=x(a,1).mul(s),d=y.time.mul(y.windSpeed).mul(5.2).add(t.w),f=y.sin(d).mul(.18).mul(l).mul(c),p=y.step(b,e.y),m=u.add(f).mul(y.windStrength).mul(n.w).mul(p).clamp(-.12,.28),h=C(e.sub(t.xyz),i,m).add(t.xyz),g=C(y.normalLocal,i,m).normalize();return{positionNode:h,normalNode:y.transformNormalToView(g).normalize()}}var T=`seedthree-ivy-petiole-hinge-v1`,E=`
attribute vec4 aIvyRootPhase;
attribute vec4 aIvyHinge;
uniform float uIvyTime;
uniform float uIvyWindSpeed;
uniform float uIvyWindStrength;

vec3 rotateIvyAroundAxis( vec3 value, vec3 axis, float angle ) {
  float cosine = cos( angle );
  float sine = sin( angle );
  return value * cosine
    + cross( axis, value ) * sine
    + axis * dot( axis, value ) * ( 1.0 - cosine );
}

float ivyHingeAngle( vec3 objectPosition, vec4 rootPhase, vec4 hinge ) {
  float hingeLength = length( hinge.xyz );
  if ( hingeLength < 0.00001 || objectPosition.y < ${b.toFixed(1)} ) return 0.0;
  vec3 rootWorld = ( modelMatrix * vec4( rootPhase.xyz, 1.0 ) ).xyz;
  float time = uIvyTime * uIvyWindSpeed;
  float spatialPhase = rootWorld.x * 0.35 + rootWorld.z * 0.27;
  float gust = sin( time * 1.15 + spatialPhase ) * 0.72
    + sin( time * 2.63 + spatialPhase * 1.9 ) * 0.28;
  float distanceToCamera = distance( cameraPosition, rootWorld );
  float macroFade = 1.0 - smoothstep(
    ${22 .toFixed(1)},
    ${44 .toFixed(1)},
    distanceToCamera
  ) * ${.85.toFixed(2)};
  float flutterFade = 1.0 - smoothstep(
    ${8 .toFixed(1)},
    ${28 .toFixed(1)},
    distanceToCamera
  );
  float flutterGate = smoothstep( 0.05, 0.12, hinge.w );
  float flutter = sin( time * 5.2 + rootPhase.w )
    * 0.18 * flutterGate * flutterFade;
  return clamp(
    ( gust * macroFade + flutter ) * uIvyWindStrength * hinge.w,
    -0.12,
    0.28
  );
}
`;function D(e){_(e,T,e=>{e.uniforms.uIvyTime=g,e.uniforms.uIvyWindSpeed=l,e.uniforms.uIvyWindStrength=d,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${E}`),e.vertexShader=e.vertexShader.replace(`#include <beginnormal_vertex>`,`#include <beginnormal_vertex>
vec3 ivyAxis = aIvyHinge.xyz / max( length( aIvyHinge.xyz ), 0.00001 );
float ivyAngle = ivyHingeAngle( position, aIvyRootPhase, aIvyHinge );
objectNormal = rotateIvyAroundAxis( objectNormal, ivyAxis, ivyAngle );`),e.vertexShader=e.vertexShader.replace(`#include <begin_vertex>`,`#include <begin_vertex>
transformed = aIvyRootPhase.xyz
  + rotateIvyAroundAxis( transformed - aIvyRootPhase.xyz, ivyAxis, ivyAngle );`)}),e.needsUpdate=!0}function O(e=.08){let t=v.positionLocal,n=v.attribute(`aRootWeight`,`float`),r=v.windStrength.mul(e),i=v.attribute(`aAnchorPos`,`vec3`),a=x(i,2).mul(r),o=v.time.mul(v.windSpeed).mul(2.7).add(i.z.mul(1.7)).add(i.x.mul(1.3)),s=a.add(v.sin(o).mul(r).mul(.12)).mul(n),c=v.attribute(`aWindVec`,`vec3`);return v.vec3(t.x.add(c.x.mul(s)),t.y,t.z.add(c.z.mul(s)))}var k=`
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;

#ifdef FLAT_SHADED

	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );

#else

	vec3 normal = normalize( vNormal );

#endif

vec3 nonPerturbedNormal = normal;
`,A=`foliage-double-side-normals-v1`;function j(e){e.fragmentShader.includes(`#include <normal_fragment_begin>`)&&(e.fragmentShader=e.fragmentShader.replace(`#include <normal_fragment_begin>`,k))}function M(e){e.side===2&&(e.forceSinglePass=!0,_(e,A,j))}export{O as a,S as i,D as n,_ as o,w as r,M as t};