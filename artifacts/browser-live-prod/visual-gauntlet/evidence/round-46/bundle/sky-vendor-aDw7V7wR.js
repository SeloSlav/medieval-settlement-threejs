import{$r as e,Br as t,Dr as n,Er as r,Fr as i,Jr as a,Ka as o,Kr as s,Ni as c,Oi as l,Or as u,Pi as d,Qr as f,Sr as p,Ur as m,Va as h,Wa as g,Wr as _,Za as v,Zr as y,ar as b,br as x,co as S,fo as C,gr as w,hr as T,ir as E,kr as D,lr as ee,mo as O,no as k,nr as A,oi as j,or as M,po as N,pr as P,qr as F,rr as I,sa as L,sr as R,ur as te,va as z,vr as B,xr as ne,yr as V,zr as re}from"./seedthree-vendor--BaV3WQw.js";var H=96,U=5,W=4,G=.55,K=43758.5453123,ie=Math.PI*2,q=22,ae=56,oe=5,J={cloudAbsorption:1.03,cloudCoverage:.58,cloudHeight:600,cloudThickness:45,hazeStrength:.12,maxCloudDistance:1e4,mieCoefficient:.0022,mieDirectionalG:.64,rayleigh:.95,turbidity:1.35,windSpeedX:5,windSpeedZ:3},Y={cloudAbsorption:`uCloudAbsorption`,cloudCoverage:`uCloudCoverage`,cloudHeight:`uCloudHeight`,cloudThickness:`uCloudThickness`,dawnAmount:`uDawnAmount`,duskAmount:`uDuskAmount`,hazeStrength:`uHazeStrength`,maxCloudDistance:`uMaxCloudDistance`,mieCoefficient:`uMieCoefficient`,mieDirectionalG:`uMieDirectionalG`,rayleigh:`uRayleigh`,turbidity:`uTurbidity`,windSpeedX:`uWindSpeedX`,windSpeedZ:`uWindSpeedZ`};function se(e){return e-Math.floor(e)}function X(e,t,n){return e+(t-e)*n}function ce(e,t,n){let r=Math.max(0,Math.min(1,(n-e)/Math.max(t-e,1e-6)));return r*r*(3-2*r)}function le(e){return e*e*e*(e*(e*6-15)+10)}function ue(e){return Math.max(0,Math.min(255,Math.round(e)))}function de(e,t,n){return se(Math.sin(e*127.1+t*311.7+n*74.7)*K)}function fe(e,t){let n=new Float32Array(e*e*e*3);for(let r=0;r<e;r++)for(let i=0;i<e;i++)for(let a=0;a<e;a++){let o=ie*de(a+r*17,i+t*13,t),s=ie*de(i+a*11,r+t*7,t+29),c=Math.sin(s),l=(r*e*e+i*e+a)*3;n[l]=Math.cos(o)*c,n[l+1]=Math.sin(o)*c,n[l+2]=Math.cos(s)}return n}function Z(e,t,n,r,i,a,o,s){let c=(n%t+t)%t,l=(r%t+t)%t,u=((i%t+t)%t*t*t+l*t+c)*3,d=a-n,f=o-r,p=s-i;return d*e[u]+f*e[u+1]+p*e[u+2]}function pe(e,t,n,r,i){let a=Math.floor(e),o=Math.floor(t),s=Math.floor(n),c=a+1,l=o+1,u=s+1,d=le(e-a),f=le(t-o),p=le(n-s),m=Z(i,r,a,o,s,e,t,n),h=Z(i,r,c,o,s,e,t,n),g=Z(i,r,a,l,s,e,t,n),_=Z(i,r,c,l,s,e,t,n),v=Z(i,r,a,o,u,e,t,n),y=Z(i,r,c,o,u,e,t,n),b=Z(i,r,a,l,u,e,t,n),x=Z(i,r,c,l,u,e,t,n),S=X(m,h,d),C=X(g,_,d),w=X(v,y,d),T=X(b,x,d);return X(X(S,C,f),X(w,T,f),p)*.5+.5}function me(e=H){let t=new Uint8Array(e*e*e),n=[],r=0;for(let e=0;e<U-1;e++){let t=W<<e,i=G**+e;n.push({amplitude:i,gradients:fe(t,23+e*37),period:t}),r+=i}for(let i=0;i<e;i++)for(let a=0;a<e;a++)for(let o=0;o<e;o++){let s=0;for(let t of n){let n=o/e*t.period,r=a/e*t.period,c=i/e*t.period;s+=t.amplitude*pe(n,r,c,t.period,t.gradients)}s/=r,s=ce(.16,.88,s);let c=i*e*e+a*e+o;t[c]=ue(s*255)}return t}function he(e,t=!1){return e&&(e.wrapS=o,e.wrapT=o,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,e.flipY=!1,e.colorSpace=``,e.userData={...e.userData,isSkyCloudManagedNoiseTexture:t},e.needsUpdate=!0,e)}function ge(e,t=!1){return e&&(e.wrapS=o,e.wrapT=o,e.wrapR=o,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,e.flipY=!1,e.unpackAlignment=1,e.colorSpace=``,e.userData={...e.userData,isSkyCloudManagedNoiseTexture:t},e.needsUpdate=!0,e)}function _e(){let e=new d(new Uint8Array([128,128,128,255]),1,1,h);return e.wrapS=l,e.wrapT=l,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,e.flipY=!1,e.colorSpace=``,e.needsUpdate=!0,e}function ve(){let e=new d(new Uint8Array([0,0,0,255]),1,1,h);return e.wrapS=o,e.wrapT=l,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,e.flipY=!1,e.colorSpace=``,e.userData={...e.userData,isSkyCloudManagedStarTexture:!0},e.needsUpdate=!0,e}function ye(e,t){let n=new c(e,t,t,t);return n.format=g,n.type=C,ge(n,!0)}function be(){return ye(me(H),H)}function Q(e,t){return e in J?Number.isFinite(t)?t:J[e]:t}function xe(e={}){let t=he(e.perlinTexture??_e(),!e.perlinTexture),n=ge(e.volumeNoiseTexture??be(),!e.volumeNoiseTexture),r=e.starMap??ve(),i=+!e.perlinTexture;return{t_PerlinNoise:s(t),t_PerlinNoise3D:F(n),t_StarMap:s(r),uCloudAbsorption:a(Q(`cloudAbsorption`,e.cloudAbsorption??J.cloudAbsorption)),uCloudCoverage:a(Q(`cloudCoverage`,e.cloudCoverage??J.cloudCoverage)),uCloudHeight:a(Q(`cloudHeight`,e.cloudHeight??J.cloudHeight)),uCloudThickness:a(Q(`cloudThickness`,e.cloudThickness??J.cloudThickness)),uConstellationVisibility:a(e.constellationVisibility??0),uDawnAmount:a(e.dawnAmount??0),uDuskAmount:a(e.duskAmount??0),uHazeStrength:a(Q(`hazeStrength`,e.hazeStrength??J.hazeStrength)),uMaxCloudDistance:a(Q(`maxCloudDistance`,e.maxCloudDistance??J.maxCloudDistance)),uMieCoefficient:a(Q(`mieCoefficient`,e.mieCoefficient??J.mieCoefficient)),uMieDirectionalG:a(Q(`mieDirectionalG`,e.mieDirectionalG??J.mieDirectionalG)),uNoiseMode:a(i),uRayleigh:a(Q(`rayleigh`,e.rayleigh??J.rayleigh)),uResolution:a(new N(e.width??1920,e.height??1080)),uSiderealAngle:a(e.siderealAngle??0),uSunDirection:a((e.sunDirection??new O(.5,.5,-.5)).clone().normalize()),uTime:a(e.time??0),uTurbidity:a(Q(`turbidity`,e.turbidity??J.turbidity)),uWindSpeedX:a(Q(`windSpeedX`,e.windSpeedX??J.windSpeedX)),uWindSpeedZ:a(Q(`windSpeedZ`,e.windSpeedZ??J.windSpeedZ))}}function Se(e,t){e.userData={...e.userData,isSkyCloudMaterial:!0,skyCloudNodes:t},e.uniforms=t}function $(e){return e?.userData?.skyCloudNodes??null}function Ce(a){let o=f(0,1,0),s=f(5804542996261093e-21,13562911419845635e-21,30265902468824876e-21),c=f(183999185144339.78,277980239196605.28,407904795438610.94),l=x(4e5),d=x(1.6110731556870734),h=x(1.5),g=x(850),v=x(8400),S=x(1250),C=x(.9999566769464484),O=x(.05968310365946075),k=x(.07957747154594767),j=x(57.29577951308232),N=I(([e])=>{let t=R(T(e,-1,1).toVar()).toVar(),r=V(d.sub(t).div(h).negate()).toVar();return n(0,x(1).sub(r)).mul(g)}),F=I(()=>{let e=a.uTurbidity.mul(2e-18).mul(.434);return c.mul(e)}),L=I(([e])=>O.mul(x(1).add(t(e,2)))),z=I(([e])=>{let n=a.uMieDirectionalG,r=t(n,2).toVar(),i=t(x(1).sub(n.mul(e).mul(2)).add(r),-1.5).toVar();return k.mul(x(1).sub(r)).mul(i)}),H=I(([e])=>{let r=f(e),c=i(a.uSunDirection).toVar(),u=c.y.mul(l).toVar(),d=x(1).sub(T(x(1).sub(V(u.div(45e4))),0,1)).toVar(),p=T(x(1).sub(_(-.04,.22,c.y)),0,1).toVar(),m=_(.04,.38,c.y).toVar(),h=x(1).sub(_(.015,.22,r.y)).toVar(),g=h.mul(m).mul(a.uHazeStrength).toVar(),y=a.uRayleigh.sub(x(1).sub(d)).toVar(),b=s.mul(y).toVar(),w=F().mul(a.uMieCoefficient).toVar(),E=n(0,B(o,r)).toVar(),ee=R(E).toVar(),O=x(1).div(E.add(x(.15).mul(t(x(93.885).sub(ee.mul(j)),-1.253)))).toVar(),k=v.mul(O).toVar(),A=S.mul(O).toVar(),M=V(b.mul(k).add(w.mul(A)).negate()).toVar(),P=B(r,c).toVar(),I=L(P.mul(.5).add(.5)).toVar(),te=b.mul(I).toVar(),ne=z(P).toVar(),re=D(x(1).sub(g.mul(.92)),1,_(.09,.28,r.y)).toVar(),H=w.mul(ne).mul(re).toVar(),U=N(B(c,o)).toVar(),W=te.add(H).div(b.add(w)).toVar(),G=t(f(U).mul(W).mul(f(1).sub(M)).toVar(),f(1.5)).toVar(),K=T(t(x(1).sub(B(o,c)),5),0,1).toVar(),ie=t(f(U).mul(W).mul(M),f(.5)).toVar(),q=f(.1).mul(M).toVar(),ae=_(C,C.add(2e-5),P).toVar(),oe=D(9e3,19e3,x(1).sub(p.mul(.65))).toVar(),J=G.mul(D(f(1),ie,K.mul(.72))).toVar(),Y=D(J,f(B(J,f(.2126,.7152,.0722)).toVar()),p.mul(.18)).toVar(),se=_(-.08,.22,r.y).toVar(),X=_(.05,.2,r.y).toVar();q.addAssign(M.mul(U.mul(oe)).mul(ae)),Y.addAssign(q),Y.assign(Y.div(Y.add(f(25)))),Y.addAssign(f(6e-5,9e-5,12e-5)),Y.assign(D(f(.48,.56,.64),Y,se));let ce=B(Y,f(.2126,.7152,.0722)).toVar(),le=D(.22,0,m),ue=D(f(ce),f(.62,.64,.66),le).toVar(),de=D(X,1,m);Y.assign(D(ue,Y,de));let fe=h.mul(D(.04,.06,m)).mul(a.uHazeStrength.mul(1.6)).toVar(),Z=f(ce).mul(f(.6,.64,.68)).toVar();return Y.assign(D(Y,Z,fe)),n(Y,f(0))}),U=r(0,.968,.726,-.968,.4356,-.5808,-.726,-.5808,.7744),W=I(([e])=>{let t=f(e),n=a.t_PerlinNoise.sample(t.xz.mul(.01)).x,r=a.t_PerlinNoise3D.sample(t.mul(f(.0075,.005,.0075))).x;return D(n,r,a.uNoiseMode)}),G=I(([e])=>{let t=f(e).toVar(),n=x(0).toVar(),r=x(2.76434);return n.addAssign(W(t).mul(.51749673)),t.assign(U.mul(t).mul(r)),n.addAssign(W(t).mul(.25584929)),t.assign(U.mul(t).mul(r)),n.addAssign(W(t).mul(.12527603)),t.assign(U.mul(t).mul(r)),n.addAssign(W(t).mul(.06255931)),n}),K=I(([e,t])=>{let r=f(e),i=f(t),o=G(r.mul(.0212242).add(i)).toVar(),s=_(.22,.78,G(r.mul(.034).add(i.mul(1.47)).add(f(19.1,0,7.3))).toVar()).toVar(),c=x(1).sub(a.uCloudCoverage),l=n(a.uCloudThickness,1e-4),u=r.y.sub(a.uCloudHeight),d=s.sub(.5).mul(.08).toVar(),p=T(u.div(l).add(d),0,1).toVar(),m=_(.03,.28,p).toVar(),h=x(1).sub(_(.5,.92,p)).toVar(),g=m.mul(h).toVar(),v=s.sub(.5).mul(.035);return o.addAssign(v),o.assign(_(c.sub(.04),c.add(.12),o)),o.mulAssign(_(.05,.72,o)),o.mulAssign(g),T(o,0,1)}),J=I(([e,t,n])=>{let r=f(e).toVar(),i=f(t),o=f(n),s=x(1).toVar();return b(oe,()=>{let e=K(r,o),t=V(a.uCloudAbsorption.negate().mul(e));s.mulAssign(t),r.addAssign(i)}),s}),Y=I(([r,i])=>{let o=f(r),s=f(i),c=f(0).toVar(),l=x(0).toVar(),d=x(1e-4);return E(M(s.y).greaterThan(d),()=>{let e=a.uCloudHeight,r=a.uCloudHeight.add(a.uCloudThickness),i=e.sub(o.y).div(s.y),h=r.sub(o.y).div(s.y),g=n(u(i,h),0).toVar(),v=u(n(i,h),a.uMaxCloudDistance).toVar();E(v.greaterThan(g),()=>{let r=_(.035,.16,s.y).toVar(),i=x(1).sub(_(a.uMaxCloudDistance.mul(.52),a.uMaxCloudDistance,g)).mul(r).toVar(),u=D(.72,1,i).toVar(),h=v.sub(g),y=x(1).sub(M(s.y)).toVar(),S=T(x(q).add(y.mul(18)).add(h.div(n(a.uCloudThickness,d)).mul(2)),x(q),x(ae)).toVar(),C=h.div(S).toVar(),w=s.mul(C),ee=a.uSunDirection.mul(5),O=f(a.uTime.mul(a.uWindSpeedX).negate(),0,a.uTime.mul(a.uWindSpeedZ).negate()),k=p(m(B(s.add(o.mul(1e-4)),f(12.9898,78.233,37.719))).mul(43758.5453123)).toVar(),j=o.add(s.mul(g.add(C.mul(k.sub(.5))))).toVar(),N=x(1).toVar(),P=f(0).toVar(),F=x(0).toVar(),I=n(a.uCloudThickness,d);b(ae,({i:r})=>{E(x(r).greaterThanEqual(S),()=>{A()});let i=K(j,O).toVar();E(i.greaterThan(.012),()=>{let r=V(a.uCloudAbsorption.negate().mul(i).mul(C)).toVar(),o=J(j,ee,O),c=V(T(j.y.sub(e).div(I),0,1).toVar()).div(1.95),l=_(.1,.42,i).toVar(),u=t(n(0,B(s,a.uSunDirection)),3.2).mul(l),d=D(f(.86,.86,.88),f(1,.86,.68),T(u.mul(.42).add(o.mul(.24)),0,1)),p=T(o.mul(c).add(u.mul(.08)),0,1).mul(D(.78,1,l)),m=D(f(.58,.6,.63),d,p);N.mulAssign(r),P.addAssign(m.mul(N).mul(i).mul(C).mul(1.18)),F.addAssign(x(1).sub(r).mul(x(1).sub(F)))}),j.addAssign(w),E(N.lessThan(.01),()=>{A()})});let L=D(f(.78,.8,.82),f(.92,.78,.62),t(n(0,B(s,a.uSunDirection)),2.5).mul(.28)),R=P.mul(L).mul(u).mul(i).toVar(),te=_(-.03,.16,T(a.uSunDirection.y,-1,1).toVar()).toVar(),z=T(a.uDawnAmount.add(a.uDuskAmount),0,1).toVar(),ne=a.uDuskAmount.div(n(.001,a.uDawnAmount.add(a.uDuskAmount))).toVar(),re=D(f(1,.45,.2),f(.76,.12,.05),ne).toVar(),H=z.mul(D(.48,.68,ne)).toVar(),U=D(R,re.mul(F).mul(i),H).toVar(),W=D(f(.012,.017,.03),f(.72,.75,.78),te).toVar();W.assign(D(W,re.mul(.54),z.mul(.7)));let G=W.mul(F).mul(i).toVar();c.assign(n(U,G)),l.assign(F.mul(i))})}),e(c,l)});return I(()=>{let r=i(re.sub(P)).toVar(),o=H(r).toVar(),s=Y(P,r).toVar(),c=o.mul(x(1).sub(s.a)).add(s.rgb).toVar(),l=T(a.uSunDirection.y,-1,1).toVar(),u=_(-.14,.12,l).toVar(),d=T(a.uDawnAmount.add(a.uDuskAmount),0,1).toVar(),h=a.uDuskAmount.div(n(.001,a.uDawnAmount.add(a.uDuskAmount))).toVar(),g=T(r.y.mul(.92).add(.08),0,1).toVar(),v=D(D(f(.035,.052,.105),f(.006,.012,.042),t(g,.62)).toVar().mul(x(1).sub(s.a)).add(f(.012,.017,.03).mul(s.a)).toVar(),c,u).toVar(),b=T(B(i(f(r.x,.001,r.z)).toVar(),i(f(a.uSunDirection.x,.001,a.uSunDirection.z)).toVar()).mul(.5).add(.5),0,1).toVar(),S=t(x(1).sub(g),1.7).toVar().mul(D(.16,1,t(b,.72))).toVar(),C=D(D(f(1,.42,.17),f(.82,.12,.045),h).toVar(),D(f(.31,.28,.48),f(.25,.12,.27),h).toVar(),t(g,.58)).toVar(),E=d.mul(S).mul(D(.78,1,h)).toVar();v.assign(D(v,C,E));let O=x(1).sub(_(-.25,-.08,l)).toVar(),k=x(.79587013891),A=m(k).toVar(),j=w(k).toVar(),M=m(a.uSiderealAngle).toVar(),N=w(a.uSiderealAngle).toVar(),F=j.mul(r.y).sub(A.mul(r.z)).toVar(),I=A.mul(r.y).add(j.mul(r.z)).toVar(),L=i(f(F.mul(N).sub(r.x.mul(M)),I,F.mul(M).add(r.x.mul(N)))).toVar(),R=y(p(te(L.z,L.x).div(ie).add(1)),x(.5).sub(ee(T(L.y,-1,1)).div(Math.PI))).toVar(),z=a.t_StarMap.sample(R).toVar(),V=z.rgb.toVar(),U=m(a.uTime.mul(.07).add(B(ne(R.mul(1024)),y(.067,.113)))).mul(.03).add(.97).toVar(),W=O.mul(_(.035,.18,r.y)).mul(x(1).sub(s.a)).toVar();v.addAssign(V.mul(W).mul(U).mul(1.55)),v.addAssign(f(.31,.45,.67).mul(z.a).mul(W).mul(a.uConstellationVisibility).mul(1.55));let G=i(a.uSunDirection.negate()).toVar(),K=n(0,B(r,G)).toVar(),q=_(-.035,.09,G.y).toVar(),ae=_(.99972,.99988,K).toVar(),oe=t(K,320).mul(.16).toVar(),J=O.mul(q).mul(x(1).sub(s.a)).toVar();return v.addAssign(f(.76,.84,1).mul(ae.mul(.92).add(oe)).mul(J)),e(n(v,f(0)),1)})()}function we(e={}){let t=new j,n=xe(e);return t.name=`SkyCloudNodeMaterial`,t.side=1,t.depthWrite=!1,t.fog=!1,t.toneMapped=!0,t.colorNode=Ce(n),Se(t,n),t}function Te(e,t=!1){return new Promise((n,r)=>{new S().load(e,e=>n(he(e,t)),void 0,r)})}function Ee(e,t){!e||e===t||e.userData?.isSkyCloudManagedNoiseTexture&&e.dispose()}function De(e){let t=$(e);t&&(Ee(t.t_PerlinNoise?.value),Ee(t.t_PerlinNoise3D?.value),t.t_StarMap?.value?.userData?.isSkyCloudManagedStarTexture&&t.t_StarMap.value.dispose())}function Oe(e,t,n=!1){let r=$(e);if(!r||!t)return e;let i=t.isData3DTexture===!0,a=i?ge(t,n):he(t,n);if(i){let t=r.t_PerlinNoise3D.value;return r.t_PerlinNoise3D.value=a,r.uNoiseMode.value=1,e.needsUpdate=!0,Ee(t,a),e}let o=r.t_PerlinNoise.value;return r.t_PerlinNoise.value=a,r.uNoiseMode.value=0,e.needsUpdate=!0,Ee(o,a),e}var ke=class extends z{constructor(e={}){let{radius:t=2e4,widthSegments:n=64,heightSegments:r=32,...i}=e,a=new k(t,n,r),o=we(i);super(a,o),this.isSkyCloudMesh=!0,this.frustumCulled=!1,this.renderOrder=-1e3,this._disposed=!1,this.ready=Promise.resolve(this),i.perlinTexture?Oe(this.material,i.perlinTexture):i.perlinTextureUrl&&(this.ready=Te(i.perlinTextureUrl,!0).then(e=>this._disposed||!this.material?(Ee(e),this):(this.material&&Oe(this.material,e,!0),this)).catch(e=>(console.warn(`SkyCloudMesh: failed to load perlin texture, keeping fallback texture.`,e),this)))}updateSun(e){let t=$(this.material);t?.uSunDirection&&e&&t.uSunDirection.value.copy(e).normalize()}updateTime(e){let t=$(this.material);t?.uTime&&(t.uTime.value=e)}updateSiderealAngle(e){let t=$(this.material);t?.uSiderealAngle&&(t.uSiderealAngle.value=e)}updateConstellationVisibility(e){let t=$(this.material);t?.uConstellationVisibility&&(t.uConstellationVisibility.value=Math.max(0,Math.min(1,e??0)))}updateAtmosphere(e,t){let n=$(this.material);n?.uDawnAmount&&(n.uDawnAmount.value=Math.max(0,Math.min(1,e??0))),n?.uDuskAmount&&(n.uDuskAmount.value=Math.max(0,Math.min(1,t??0)))}updateResolution(e,t){let n=$(this.material);n?.uResolution&&n.uResolution.value.set(e,t)}updateCamera(e){e?.position&&this.position.copy(e.position)}setParameter(e,t){let n=$(this.material);if(!n)return;if(e===`sunDirection`&&t?.isVector3){n.uSunDirection.value.copy(t).normalize();return}if(e===`perlinTexture`&&t){Oe(this.material,t);return}if(e===`volumeNoiseTexture`&&t){Oe(this.material,t);return}if(e===`resolution`&&t?.isVector2){n.uResolution.value.copy(t);return}let r=Y[e];r&&n[r]&&(n[r].value=Q(e,t))}dispose(){this._disposed||(this._disposed=!0,De(this.material),this.geometry?.dispose?.(),this.material?.dispose?.())}};function Ae(e={}){let t=new v({vertexShader:`
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        void main() {
            vUv = uv;
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `,fragmentShader:`
        precision highp float;
        precision highp int;
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform sampler2D t_PerlinNoise;
        uniform sampler2D t_StarMap;
        uniform float uSiderealAngle;
        uniform float uConstellationVisibility;
        uniform vec2 uResolution;
        uniform float uCloudCoverage;
        uniform float uCloudHeight;
        uniform float uCloudThickness;
        uniform float uCloudAbsorption;
        uniform float uHazeStrength;
        uniform float uDawnAmount;
        uniform float uDuskAmount;
        uniform float uWindSpeedX;
        uniform float uWindSpeedZ;
        uniform float uMaxCloudDistance;
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        #define PI 3.14159265359
        #define TWO_PI 6.28318530718
        #define OBSERVER_LATITUDE 0.79587013891
        #define STEPS          22
        #define LIGHT_STEPS    5
        vec3 Get_Sky_Color(vec3 rayDir) {
            float up = clamp(rayDir.y * 0.92 + 0.08, 0.0, 1.0);
            float sunHeight = clamp(uSunDirection.y, -1.0, 1.0);
            float dayAmount = smoothstep(-0.14, 0.12, sunHeight);
            float nightAmount = 1.0 - smoothstep(-0.25, -0.08, sunHeight);
            float twilightAmount = clamp(uDawnAmount + uDuskAmount, 0.0, 1.0);
            float duskBias = uDuskAmount / max(0.001, uDawnAmount + uDuskAmount);
            float sunAmount = max(0.0, dot(rayDir, uSunDirection));
            vec3 nightHorizon = vec3(0.035, 0.052, 0.105);
            vec3 nightZenith = vec3(0.006, 0.012, 0.042);
            vec3 dayHorizon = vec3(0.58, 0.76, 0.94);
            vec3 dayZenith = vec3(0.12, 0.43, 0.9);
            vec3 nightSky = mix(nightHorizon, nightZenith, pow(up, 0.62));
            vec3 daySky = mix(dayHorizon, dayZenith, pow(up, 0.58));
            vec3 skyColor = mix(nightSky, daySky, dayAmount);

            vec3 rayAzimuth = normalize(vec3(rayDir.x, 0.001, rayDir.z));
            vec3 sunAzimuth = normalize(vec3(uSunDirection.x, 0.001, uSunDirection.z));
            float sunFacing = clamp(dot(rayAzimuth, sunAzimuth) * 0.5 + 0.5, 0.0, 1.0);
            float horizonBand = pow(1.0 - up, 1.7);
            float twilightReach = horizonBand * mix(0.16, 1.0, pow(sunFacing, 0.72));
            vec3 dawnHorizon = vec3(1.0, 0.42, 0.17);
            vec3 duskHorizon = vec3(0.82, 0.12, 0.045);
            vec3 dawnUpper = vec3(0.31, 0.28, 0.48);
            vec3 duskUpper = vec3(0.25, 0.12, 0.27);
            vec3 twilightHorizon = mix(dawnHorizon, duskHorizon, duskBias);
            vec3 twilightUpper = mix(dawnUpper, duskUpper, duskBias);
            vec3 twilightSky = mix(twilightHorizon, twilightUpper, pow(up, 0.58));
            skyColor = mix(
                skyColor,
                twilightSky,
                twilightAmount * twilightReach * mix(0.78, 1.0, duskBias)
            );

            vec3 hazeColor = mix(vec3(0.18, 0.24, 0.36), vec3(0.7, 0.8, 0.9), dayAmount);
            hazeColor = mix(hazeColor, twilightHorizon, twilightAmount * 0.62);
            skyColor = mix(skyColor, hazeColor, pow(1.0 - up, 3.0) * uHazeStrength);

            float sunVisible = smoothstep(-0.035, 0.02, sunHeight);
            vec3 sunGlow = mix(vec3(1.0, 0.64, 0.28), vec3(1.0, 0.27, 0.07), duskBias);
            sunGlow = mix(vec3(1.0, 0.86, 0.58), sunGlow, twilightAmount);
            skyColor += sunGlow * pow(sunAmount, 18.0)
                * sunVisible * mix(0.22, 0.78, twilightAmount);
            skyColor += sunGlow * pow(sunAmount, 900.0)
                * sunVisible * mix(1.7, 3.2, twilightAmount);

            float sinLatitude = sin(OBSERVER_LATITUDE);
            float cosLatitude = cos(OBSERVER_LATITUDE);
            float sinSidereal = sin(uSiderealAngle);
            float cosSidereal = cos(uSiderealAngle);
            float meridian = cosLatitude * rayDir.y - sinLatitude * rayDir.z;
            float celestialNorth = sinLatitude * rayDir.y + cosLatitude * rayDir.z;
            vec3 equatorialDirection = normalize(vec3(
                meridian * cosSidereal - rayDir.x * sinSidereal,
                celestialNorth,
                meridian * sinSidereal + rayDir.x * cosSidereal
            ));
            vec2 starUv = vec2(
                fract(atan(equatorialDirection.z, equatorialDirection.x) / TWO_PI + 1.0),
                0.5 - asin(clamp(equatorialDirection.y, -1.0, 1.0)) / PI
            );
            vec4 catalogSample = texture(t_StarMap, starUv);
            vec3 catalogStars = catalogSample.rgb;
            float twinkle = 0.97 + 0.03 * sin(
                uTime * 0.07 + dot(floor(starUv * 1024.0), vec2(0.067, 0.113))
            );
            float starVisibility = nightAmount * smoothstep(0.035, 0.18, rayDir.y);
            skyColor += catalogStars * starVisibility * twinkle * 1.55;
            skyColor += vec3(0.31, 0.45, 0.67)
                * catalogSample.a * starVisibility * uConstellationVisibility * 1.55;

            vec3 moonDirection = normalize(-uSunDirection);
            float moonDot = max(0.0, dot(rayDir, moonDirection));
            float moonAboveHorizon = smoothstep(-0.035, 0.09, moonDirection.y);
            float moonDisk = smoothstep(0.99972, 0.99988, moonDot);
            float moonHalo = pow(moonDot, 320.0) * 0.16;
            float moonVisibility = nightAmount * moonAboveHorizon;
            vec3 moonColor = vec3(0.76, 0.84, 1.0);
            skyColor += moonColor * (moonDisk * 0.92 + moonHalo) * moonVisibility;
            return skyColor;
        }
        float noise3D(in vec3 p) {
            vec2 uv = p.xz * 0.01;
            return texture(t_PerlinNoise, uv).x;
        }
        const mat3 m = 1.21 * mat3(0.00, 0.80, 0.60,
                                  -0.80, 0.36, -0.48,
                                  -0.60, -0.48, 0.64);
        float fbm(vec3 p) {
            float t;
            float mult = 2.76434;
            t  = 0.51749673 * noise3D(p); p = m * p * mult;
            t += 0.25584929 * noise3D(p); p = m * p * mult;
            t += 0.12527603 * noise3D(p); p = m * p * mult;
            t += 0.06255931 * noise3D(p);
            return t;
        }
        float cloud_density(vec3 pos, vec3 offset, float h) {
            vec3 p = pos * 0.0212242 + offset;
            float dens = fbm(p);
            float cov = 1.0 - uCloudCoverage;
            dens *= smoothstep(cov, cov + 0.05, dens);
            float height = pos.y - uCloudHeight;
            float heightAttenuation = 1.0 - clamp(height / uCloudThickness, 0.0, 1.0);
            heightAttenuation = heightAttenuation * heightAttenuation;
            dens *= heightAttenuation;
            return clamp(dens, 0.0, 1.0);
        }
        float cloud_light(vec3 pos, vec3 dir_step, vec3 offset, float cov) {
            float T = 1.0;
            for (int i = 0; i < LIGHT_STEPS; i++) {
                float dens = cloud_density(pos, offset, 0.0);
                float T_i = exp(-uCloudAbsorption * dens);
                T *= T_i;
                pos += dir_step;
            }
            return T;
        }
        vec4 render_clouds(vec3 rayOrigin, vec3 rayDirection) {
            float t = (uCloudHeight - rayOrigin.y) / rayDirection.y;
            if (t < 0.0) return vec4(0.0);
            if (t > uMaxCloudDistance) return vec4(0.0);
            float horizonFade = smoothstep(0.035, 0.16, rayDirection.y);
            float distanceFade = (1.0 - smoothstep(uMaxCloudDistance * 0.6, uMaxCloudDistance, t)) * horizonFade;
            vec3 startPos = rayOrigin + rayDirection * t;
            vec3 windOffset = vec3(uTime * -uWindSpeedX, 0.0, uTime * -uWindSpeedZ);
            vec3 pos = startPos;
            float march_step = uCloudThickness / float(STEPS);
            vec3 dir_step = rayDirection * march_step;
            vec3 light_step = uSunDirection * 5.0;
            float covAmount = (sin(mod(uTime * 0.02, TWO_PI))) * 0.1 + 0.5;
            float coverage = mix(0.4, 0.6, clamp(covAmount, 0.0, 1.0));
            float sunHeight = clamp(uSunDirection.y, -1.0, 1.0);
            float dayAmount = smoothstep(-0.03, 0.16, sunHeight);
            float twilightAmount = clamp(uDawnAmount + uDuskAmount, 0.0, 1.0);
            float duskBias = uDuskAmount / max(0.001, uDawnAmount + uDuskAmount);
            vec3 twilightColor = mix(
                vec3(1.0, 0.45, 0.2),
                vec3(0.83, 0.16, 0.065),
                duskBias
            );
            float T = 1.0;
            vec3 C = vec3(0);
            float alpha = 0.0;
            for (int i = 0; i < STEPS; i++) {
                if (pos.y < uCloudHeight || pos.y > uCloudHeight + uCloudThickness) {
                    pos += dir_step;
                    continue;
                }
                float h = float(i) / float(STEPS);
                float dens = cloud_density(pos, windOffset, h);
                if (dens > 0.01) {
                    float T_i = exp(-uCloudAbsorption * dens * march_step);
                    T *= T_i;
                    float cloudLight = cloud_light(pos, light_step, windOffset, coverage);
                    float lightFactor = (exp(h) / 1.75);
                    float sunContribution = pow(max(0.0, dot(rayDirection, uSunDirection)), 2.0);
                    vec3 edgeColor = mix(
                        vec3(0.025, 0.032, 0.052),
                        mix(vec3(1.0), vec3(1.0, 0.8, 0.5), sunContribution),
                        dayAmount
                    );
                    edgeColor = mix(
                        edgeColor,
                        twilightColor,
                        twilightAmount * (0.28 + sunContribution * 0.62)
                    );
                    vec3 cloudShade = mix(vec3(0.014, 0.02, 0.036), vec3(0.62, 0.64, 0.67), dayAmount);
                    cloudShade = mix(cloudShade, twilightColor * 0.34, twilightAmount * 0.44);
                    vec3 cloudColor = mix(
                        cloudShade,
                        edgeColor,
                        cloudLight * lightFactor
                    );
                    C += T * cloudColor * dens * march_step * 1.5;
                    alpha += (1.0 - T_i) * (1.0 - alpha);
                }
                pos += dir_step;
                if (T < 0.01) break;
            }
            vec3 sunColor = mix(vec3(0.022, 0.029, 0.05), vec3(0.9, 0.7, 0.5), dayAmount);
            sunColor = mix(sunColor, twilightColor, twilightAmount * 0.7);
            vec3 skyColor = mix(vec3(0.012, 0.018, 0.032), vec3(0.4, 0.5, 0.6), dayAmount);
            C = C * mix(skyColor, sunColor, 0.5 * pow(max(0.0, dot(rayDirection, uSunDirection)), 2.0));
            alpha *= distanceFade;
            C *= distanceFade;
            vec3 cloudFloor = mix(vec3(0.012, 0.017, 0.03), vec3(0.72, 0.75, 0.78), dayAmount);
            cloudFloor = mix(cloudFloor, twilightColor * 0.52, twilightAmount * 0.64);
            C = max(C, alpha * cloudFloor);
            return vec4(C, alpha);
        }
        void main() {
            vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
            vec3 skyColor = Get_Sky_Color(rayDirection);
            vec4 clouds = vec4(0.0);
            if (rayDirection.y > 0.0) {
                clouds = render_clouds(cameraPosition, rayDirection);
            }
            vec3 finalColor = skyColor * (1.0 - clouds.a) + clouds.rgb;
            float sunHeight = clamp(uSunDirection.y, -1.0, 1.0);
            float dayAmount = smoothstep(-0.14, 0.12, sunHeight);
            float twilightAmount = clamp(uDawnAmount + uDuskAmount, 0.0, 1.0);
            float duskBias = uDuskAmount / max(0.001, uDawnAmount + uDuskAmount);
            float t = pow(1.0 - max(0.0, rayDirection.y), 5.0);
            vec3 horizonColor = mix(vec3(0.035, 0.05, 0.09), vec3(0.54, 0.66, 0.76), dayAmount);
            horizonColor = mix(
                horizonColor,
                mix(vec3(0.86, 0.34, 0.16), vec3(0.68, 0.105, 0.045), duskBias),
                twilightAmount * 0.7
            );
            finalColor = mix(finalColor, horizonColor, 0.32 * t);
            vec3 belowHorizonColor = mix(vec3(0.025, 0.035, 0.068), vec3(0.5, 0.61, 0.72), dayAmount);
            belowHorizonColor = mix(belowHorizonColor, horizonColor * 0.72, twilightAmount);
            finalColor = mix(belowHorizonColor, finalColor, smoothstep(-0.08, 0.18, rayDirection.y));
            finalColor = pow(max(finalColor, vec3(0.0)), vec3(0.92));
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `,uniforms:{uTime:{value:0},uSunDirection:{value:new O(.5,.5,-.5).normalize()},t_PerlinNoise:{value:null},t_StarMap:{value:e.starMap??Pe()},uSiderealAngle:{value:e.siderealAngle??0},uConstellationVisibility:{value:e.constellationVisibility??0},uResolution:{value:new N(1920,1080)},uCloudCoverage:{value:e.cloudCoverage??.65},uCloudHeight:{value:e.cloudHeight??600},uCloudThickness:{value:e.cloudThickness??45},uCloudAbsorption:{value:e.cloudAbsorption??1.03},uHazeStrength:{value:e.hazeStrength??.08},uDawnAmount:{value:e.dawnAmount??0},uDuskAmount:{value:e.duskAmount??0},uWindSpeedX:{value:e.windSpeedX??5},uWindSpeedZ:{value:e.windSpeedZ??3},uMaxCloudDistance:{value:e.maxCloudDistance??1e4}},side:1}),n=new d(new Uint8Array([128,128,128,255]),1,1,h);return n.needsUpdate=!0,t.uniforms.t_PerlinNoise.value=n,t}function je(e,t){e&&e.uniforms&&e.uniforms.t_PerlinNoise&&(e.uniforms.t_PerlinNoise.value=t,e.needsUpdate=!0)}async function Me(e={}){let t=Ae(e),n=null;if(e.perlinTextureUrl)try{n=await new Promise((t,n)=>{new S().load(e.perlinTextureUrl,e=>{e.wrapS=e.wrapT=o,e.flipY=!1,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,t(e)},void 0,e=>n(e))})}catch{n=Ne()}else n=Ne();return je(t,n),t}function Ne(){let e=new Uint8Array(256*256*4);for(let t=0;t<256*256*4;t+=4){let n=Math.random()*255;e[t]=n,e[t+1]=n,e[t+2]=n,e[t+3]=255}let t=new d(e,256,256,h);return t.needsUpdate=!0,t}function Pe(){let e=new d(new Uint8Array([0,0,0,255]),1,1,h);return e.wrapS=o,e.wrapT=l,e.minFilter=L,e.magFilter=L,e.generateMipmaps=!1,e.flipY=!1,e.colorSpace=``,e.needsUpdate=!0,e}var Fe=class extends z{constructor(e={}){let{radius:t=2e4,widthSegments:n=64,heightSegments:r=32,...i}=e,a=new k(t,n,r),o=new v;super(a,o),this.isSkyCloudMesh=!0,Me(i).then(e=>{this.material.dispose(),this.material=e})}updateSun(e){this.material&&this.material.uniforms&&this.material.uniforms.uSunDirection&&this.material.uniforms.uSunDirection.value.copy(e)}updateTime(e){this.material&&this.material.uniforms&&this.material.uniforms.uTime&&(this.material.uniforms.uTime.value=e)}updateSiderealAngle(e){this.material&&this.material.uniforms&&this.material.uniforms.uSiderealAngle&&(this.material.uniforms.uSiderealAngle.value=e)}updateConstellationVisibility(e){this.material&&this.material.uniforms&&this.material.uniforms.uConstellationVisibility&&(this.material.uniforms.uConstellationVisibility.value=Math.max(0,Math.min(1,e??0)))}updateAtmosphere(e,t){this.material&&this.material.uniforms&&(this.material.uniforms.uDawnAmount&&(this.material.uniforms.uDawnAmount.value=e),this.material.uniforms.uDuskAmount&&(this.material.uniforms.uDuskAmount.value=t))}};export{ke as n,Fe as t};