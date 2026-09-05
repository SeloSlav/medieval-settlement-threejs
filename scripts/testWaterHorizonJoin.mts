import assert from 'node:assert/strict';
import {TerrainHorizonWorld} from '../src/terrain/TerrainHorizonWorld.ts';
import {RiverLayout} from '../src/rivers/RiverLayout.ts';

const extent=500,bounds={minX:-extent,maxX:extent,minZ:-extent,maxZ:extent};
const layout=RiverLayout.create({bounds,seed:42,terrainPreset:'vinodol_coast'});
const world=new TerrainHorizonWorld({innerHalfExtent:extent,outerHalfExtent:1500,
  settings:{seed:42,terrainPreset:'vinodol_coast',topography:50,hydrology:50,forestDensity:0},
  riverLayout:layout,sampleBaseHeight:()=>-7.2});
const geometry=world.waterMesh!.geometry,p=geometry.getAttribute('position'),indices=geometry.index!;
function coverage(x:number,z:number){
  let hits=0;
  for(let i=0;i<indices.count;i+=3){
    const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2);
    const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c);
    const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if(Math.abs(den)<1e-8)continue;
    const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
    if(u>1e-7&&v>1e-7&&u+v<1-1e-7)hits++;
  }
  return hits;
}
try{
  for(const z of [-220.371,-61.371,80.371,231.371]){
    assert.equal(coverage(-extent-0.25,z),1,`one sea surface outside west join at ${z}`);
    assert.equal(coverage(-extent+0.25,z),0,`no overlapping horizon sea inside west join at ${z}`);
  }
  for(const z of [-extent,extent]){
    assert.equal(coverage(-450.371,z+Math.sign(z)*0.25),1,'one sea surface outside north/south join');
    assert.equal(coverage(-450.371,z-Math.sign(z)*0.25),0,'no overlapping sea inside north/south join');
  }
  console.log('Coastal horizon join has exact coverage without overlap or gaps.');
}finally{world.dispose();}
