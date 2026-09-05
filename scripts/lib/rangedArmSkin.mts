import * as THREE from 'three';

/** Measure the visible sleeve/bracer centerlines from deformed vertices. */
export function rangedArmSkinAxes(model: THREE.Object3D): () => THREE.Vector3[] {
 const parts: {mesh:THREE.SkinnedMesh,ids:number[]}[][]=[[],[]];
 model.traverse(mesh=>{if(mesh instanceof THREE.SkinnedMesh){
  const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
  for(let group=0;group<2;group++){
   const names=group===0?['L_Upperarm','L_UpperarmTwist01','L_UpperarmTwist02']:['L_Forearm','L_ForearmTwist01','L_ForearmTwist02'];
   const ids:number[]=[];for(let v=0;v<indices.count;v++){let weight=0;for(let s=0;s<4;s++)if(names.includes(mesh.skeleton.bones[indices.getComponent(v,s)]!.name))weight+=weights.getComponent(v,s);if(weight>.8)ids.push(v);}parts[group]!.push({mesh,ids});
  }
 }});
 return()=>parts.map(group=>{
  const points=group.flatMap(({mesh,ids})=>ids.map(v=>mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)));
  const center=points.reduce((a,p)=>a.add(p),new THREE.Vector3()).divideScalar(points.length);
  const covariance=new Array<number>(9).fill(0);
  for(const p of points){p.sub(center);const v=p.toArray();for(let i=0;i<3;i++)for(let j=0;j<3;j++)covariance[i*3+j]!+=v[i]!*v[j]!;}
  const axis=new THREE.Vector3(0,.1,1),matrix=new THREE.Matrix3().set(...covariance as [number,number,number,number,number,number,number,number,number]);
  for(let i=0;i<40;i++)axis.applyMatrix3(matrix).normalize();
  if(axis.z<0)axis.negate();return axis;
 });
}
