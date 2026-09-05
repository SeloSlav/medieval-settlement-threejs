import * as THREE from 'three';
let shared: THREE.DataTexture | null = null;
let references = 0;

export function retainWaterSurfaceNoise(): () => void {
  references++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--references === 0) { shared?.dispose(); shared = null; }
  };
}

/** Tileable, seeded scalar turbulence. Generated once, then hardware mip filtered. */
export function getWaterSurfaceNoise(): THREE.DataTexture {
  if (shared) return shared;
  const size = 256, data = new Uint8Array(size * size * 4);
  const hash = (x:number,z:number,n:number):number => {
    let h = Math.imul((x+n) ^ 0x51f15e,374761393) ^ Math.imul(z+7,668265263);
    h = Math.imul(h ^ (h >>> 13),1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x:number,z:number,n:number):number => {
    const ix=Math.floor(x), iz=Math.floor(z), a=x-ix,b=z-iz;
    const u=a*a*(3-2*a),v=b*b*(3-2*b);
    const at=(xx:number,zz:number)=>hash((xx+n)%n,(zz+n)%n,n);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix,iz),at(ix+1,iz),u),THREE.MathUtils.lerp(at(ix,iz+1),at(ix+1,iz+1),u),v);
  };
  for(let z=0;z<size;z++)for(let x=0;x<size;x++) {
    const u=x/size,v=z/size;
    const warpX=noise(u*8,v*8,8)*0.07, warpZ=noise(u*8+3,v*8+1,8)*0.07;
    const f=(a:number,b:number)=>noise(a*16,b*16,16)*0.53+noise(a*32,b*32,32)*0.29+noise(a*64,b*64,64)*0.18;
    const i=(z*size+x)*4;
    data[i]=Math.round(f(u+warpX,v+warpZ)*255);
    data[i+1]=Math.round(f(u+0.37+warpZ,v+0.71+warpX)*255);
    data[i+2]=Math.round(noise(u*8,v*8,8)*255);
    data[i+3]=Math.round(f(u+0.81,v+0.23)*255);
  }
  shared=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  shared.name='Water scalar turbulence and foam';
  shared.wrapS=shared.wrapT=THREE.RepeatWrapping;
  shared.minFilter=THREE.LinearMipmapLinearFilter;
  shared.magFilter=THREE.LinearFilter;
  shared.generateMipmaps=true;
  shared.needsUpdate=true;
  return shared;
}
