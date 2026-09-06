import assert from 'node:assert/strict';
import { createTerrainGridIndices } from '../src/terrain/terrainGridIndices.ts';
import { vertexCacheMisses } from './lib/meshIndexOptimization.mjs';

for (const resolution of [2,3,8,9,10,17,257,769]) {
  const indices=createTerrainGridIndices(resolution),cells=resolution-1,seen=new Uint8Array(cells*cells);
  assert.equal(indices.length,cells*cells*6);
  for(let i=0;i<indices.length;i+=6) {
    const a=indices[i]!,x=a%resolution,z=Math.floor(a/resolution),b=a+1,c=a+resolution,d=c+1;
    assert.ok(x<cells&&z<cells);assert.equal(seen[z*cells+x],0);seen[z*cells+x]=1;
    assert.deepEqual(Array.from(indices.subarray(i,i+6)),[a,c,b,b,c,d]);
  }
  assert.ok(seen.every(value=>value===1),'Every original terrain cell, diagonal and winding occurs exactly once');
  if(resolution===769) {
    const misses=vertexCacheMisses(indices),rowMajorMisses=cells*resolution*2;
    assert.ok(misses<rowMajorMisses*.7);
    console.log({resolution,triangles:indices.length/3,rowMajorMisses,tiledMisses:misses});
  }
}
console.log('Terrain grid cache order PASS: exact triangles, partial tiles and original vertex IDs');
