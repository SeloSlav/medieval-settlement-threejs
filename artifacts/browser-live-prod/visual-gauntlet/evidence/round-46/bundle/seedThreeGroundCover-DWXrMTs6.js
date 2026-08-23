import{A as e,D as t,E as n,Jr as r,O as i,Qr as a,Rr as o,Sa as s,Ur as c,Xr as l,br as u,dr as d,er as f,j as p,k as m,tr as h}from"./seedthree-vendor--BaV3WQw.js";var g=r(0);function _(e){g.value=Math.max(0,e)}var v={attribute:d,float:u,positionLocal:o,sin:c,time:g,uv:l,vec3:a,windSpeed:f,windStrength:h};function y(e,t){let n=v.time.mul(v.windSpeed),r=e.x.mul(.35).add(e.z.mul(.27)).mul(t);return v.sin(n.mul(1.15).add(r)).mul(.72).add(v.sin(n.mul(2.63).add(r.mul(1.9))).mul(.28))}function b(e=.16){let t=v.positionLocal,n=v.uv().y.mul(v.uv().y),r=v.windStrength.mul(e),i=v.attribute(`aAnchorPos`,`vec3`),a=y(i,2).mul(r),o=v.time.mul(v.windSpeed).mul(3).add(i.z.mul(1.7)).add(i.x.mul(1.3)),s=v.sin(o).mul(r).mul(.18),c=a.add(s).mul(n),l=v.attribute(`aWindVec`,`vec3`);return v.vec3(t.x.add(l.x.mul(c)),t.y,t.z.add(l.z.mul(c)))}function x(e,t,n){let r=e.onBeforeCompile,i=e.customProgramCacheKey;e.customProgramCacheKey=()=>`${i?.call(e)??``}${t}`,e.onBeforeCompile=(t,i)=>{r?.call(e,t,i),n(t)}}var S=`
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;

#ifdef FLAT_SHADED

	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );

#else

	vec3 normal = normalize( vNormal );

#endif

vec3 nonPerturbedNormal = normal;
`,C=`foliage-double-side-normals-v1`;function w(e){e.fragmentShader.includes(`#include <normal_fragment_begin>`)&&(e.fragmentShader=e.fragmentShader.replace(`#include <normal_fragment_begin>`,S))}function T(e){e.side===2&&(e.forceSinglePass=!0,x(e,C,w))}function E(e,t){return p(e,t)}function D(e,t,n,r,a=.16,o){if(n!==`webgpu`){let n=new s({name:e,map:t.albedo,normalMap:t.normal,roughnessMap:t.roughness,alphaTest:.38,side:2,roughness:.96,metalness:0,vertexColors:!0});return n.forceSinglePass=!0,n.normalScale.set(.42,.42),T(n),n}return i({name:e,textures:t,transmit:r,windAmount:a,positionNode:o??b(a)})}function O(e){return t(e)}function k(e,t){return n(e,t)}function A(t,n,r){return e(t,n,r)}function j(e){m(e)}export{E as a,x as c,g as d,j as i,b as l,O as n,A as o,D as r,T as s,k as t,_ as u};