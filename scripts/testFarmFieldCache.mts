import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FarmFieldMarkers} from '../src/farming/FarmFieldMarkers.ts';
import type {FarmFieldState} from '../src/resources/types.ts';

let heightQueries=0, heightRevision=0;
const height=(x:number,z:number)=>{heightQueries++;return x*0.003+Math.sin(z*0.02)*0.08+heightRevision*0.1;};
const field=(i:number):FarmFieldState=>({id:`cache-${i}`,farmsteadId:'barn',
  corners:[{x:(i%10)*12,z:Math.floor(i/10)*12},{x:(i%10)*12+8,z:Math.floor(i/10)*12},
    {x:(i%10)*12+8,z:Math.floor(i/10)*12+8},{x:(i%10)*12,z:Math.floor(i/10)*12+8}],
  area:64,averageSlopeDegrees:0,moisture:0.5,fertility:0.8,crop:'fallow',nextCrop:'rye',
  stage:'ploughing',stageProgress:0.5,priority:1,harvestCount:0,lastYield:0,currentYield:0});
let fields=Array.from({length:100},(_,i)=>field(i));
const parent=new THREE.Group(),markers=new FarmFieldMarkers(parent,height,{getHeightRevision:()=>[heightRevision]});
const group=(id:string)=>parent.getObjectByName(`Field ${id}`)!;
const resources=(node:THREE.Object3D)=>{const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  node.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)geometry.add(m.geometry);
    if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])materials.add(mat);});return {geometry,materials};};
let floatChecks=0;
function compare(a:THREE.Object3D,b:THREE.Object3D){
  assert.equal(a.name,b.name);assert.equal(a.type,b.type);assert.equal(a.children.length,b.children.length);
  assert.deepEqual(a.position.toArray(),b.position.toArray());assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());
  assert.deepEqual(a.scale.toArray(),b.scale.toArray());assert.equal(a.visible,b.visible);
  const am=a as THREE.Mesh,bm=b as THREE.Mesh;
  if(am.geometry){assert.deepEqual(Object.keys(am.geometry.attributes),Object.keys(bm.geometry.attributes));
    for(const name of Object.keys(am.geometry.attributes)){
      const x=am.geometry.getAttribute(name),y=bm.geometry.getAttribute(name);assert.equal(x.itemSize,y.itemSize);
      assert.deepEqual(x.array,y.array,name);floatChecks+=x.array.length;
    }
    assert.deepEqual(am.geometry.index?.array,bm.geometry.index?.array);assert.deepEqual(am.geometry.groups,bm.geometry.groups);
    assert.equal(am.castShadow,bm.castShadow);assert.equal(am.receiveShadow,bm.receiveShadow);assert.equal(am.renderOrder,bm.renderOrder);
    const ai=am as THREE.InstancedMesh,bi=bm as THREE.InstancedMesh;
    if(ai.isInstancedMesh){assert.equal(ai.count,bi.count);assert.deepEqual(ai.instanceMatrix.array,bi.instanceMatrix.array);
      assert.deepEqual(ai.instanceColor?.array,bi.instanceColor?.array);}
  }
  for(let i=0;i<a.children.length;i++)compare(a.children[i]!,b.children[i]!);
}
function freshParity(){const referenceParent=new THREE.Group(),reference=new FarmFieldMarkers(referenceParent,height);
  reference.syncFields(fields);compare(parent.children[0]!,referenceParent.children[0]!);reference.dispose();}
markers.syncFields(fields);const initialQueries=heightQueries;
const originals=new Map(fields.map(f=>[f.id,group(f.id)]));let removals=0;
for(const g of originals.values())g.addEventListener('removed',()=>removals++);
heightQueries=0;markers.syncFields(fields);assert.equal(heightQueries,0,'Unchanged fields must skip model generation');assert.equal(removals,0);
const retiring=resources(group(fields[0]!.id));let disposedGeometry=0,disposedMaterials=0;
for(const g of retiring.geometry)g.addEventListener('dispose',()=>disposedGeometry++);
for(const m of retiring.materials)m.addEventListener('dispose',()=>disposedMaterials++);
fields=fields.map((f,i)=>i===0?{...f,stageProgress:0.8}:f);markers.syncFields(fields);
const changedQueries=heightQueries;assert(changedQueries>0&&changedQueries<initialQueries/20);
assert.equal(removals,1);assert.equal(disposedGeometry,retiring.geometry.size);assert.equal(disposedMaterials,retiring.materials.size);
assert.notEqual(group(fields[0]!.id),originals.get(fields[0]!.id));
for(const f of fields.slice(1))assert.equal(group(f.id),originals.get(f.id));freshParity();
// Fractional inputs below their visual bands are caught when another field
// triggers the former global cadence; the unchanged 98 models stay intact.
fields=fields.map((f,i)=>i===1?{...f,stageProgress:0.5001}:i===2?{...f,stageProgress:0.9}:f);
markers.syncFields(fields);assert.notEqual(group(fields[1]!.id),originals.get(fields[1]!.id));freshParity();
fields=fields.map((f,i)=>i===3?{...f,crop:'rye',stage:'growing',stageProgress:0.76}:f);
markers.syncFields(fields);freshParity();
fields=fields.map((f,i)=>i===3?{...f,stage:'harvesting',stageProgress:0.6}:f);
markers.syncFields(fields);freshParity();
fields=[...fields.slice(1).reverse(),{...field(100),id:'new-field'}];markers.syncFields(fields);freshParity();
heightRevision++;markers.syncFields(fields);freshParity();
const final=resources(parent);const counts=new Map<object,number>();
for(const r of [...final.geometry,...final.materials])r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));
markers.syncFields([]);assert.equal(parent.children[0]!.children.length,0);
for(const r of [...final.geometry,...final.materials])assert.equal(counts.get(r),1);
markers.dispose();markers.dispose();markers.syncFields(fields);assert.equal(parent.children.length,0);
console.log(JSON.stringify({fields:100,initialHeightQueries:initialQueries,oneFieldHeightQueries:changedQueries,unchangedModelsRetained:99,floatChecks,disposalAndTerrainRevision:true}));
