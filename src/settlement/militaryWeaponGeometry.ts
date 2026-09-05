import * as THREE from 'three';
import type { MilitaryEquipmentMaterials } from './militaryEquipmentMaterials.ts';

/** Shared authored crossbow frame: +Y points downrange, +Z is the top.
 * Lengths are metres before the equipment mount's uniform size fit. */
export const CROSSBOW_FRAME = {
  rear: -0.26, front: 0.38, prodY: 0.3, prodZ: 0.005, halfSpan: 0.39,
  stringTipY: 0.19, nutY: -0.055, deckZ: 0.031, stringZ: 0.041,
  grip: [0, -0.18, -0.023] as const,
  support: [0, 0.06, -0.027] as const,
  muzzle: [0, 0.345, 0.047] as const,
};

function part(group:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,name:string,
  position:readonly[number,number,number]=[0,0,0],rotation:readonly[number,number,number]=[0,0,0]):THREE.Mesh{
 const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.userData.semanticWeaponPart=name;
 mesh.position.set(...position);mesh.rotation.set(...rotation);group.add(mesh);return mesh;
}

/** A narrow, chamfered tiller with a constant bolt deck and a tapered underside. */
function tillerGeometry():THREE.BufferGeometry{
 // Cut the butt square across the existing taper, leaving the trigger grip
 // and the complete forward stock/deck in their authored positions.
 const stations=[[CROSSBOW_FRAME.rear,.0216666667,.029,-.0303333333],[-.14,.029,.031,-.037],
  [.025,.03,.031,-.035],[.18,.025,.031,-.028],[.30,.024,.026,-.028],[.38,.019,.021,-.021]];
 const vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(const[y,w,top,bottom]of stations){
  const bevel=.004;
  const ring=[[-w!+bevel,top!],[w!-bevel,top!],[w!,top!-bevel],[w!,bottom!+bevel],
   [w!-bevel,bottom!],[-w!+bevel,bottom!],[-w!,bottom!+bevel],[-w!,top!-bevel]];
  for(let i=0;i<8;i++){vertices.push(ring[i]![0]!,y!,ring[i]![1]!);uvs.push(i/8,(y!+.46)/.84);}
 }
 for(let s=0;s<stations.length-1;s++)for(let i=0;i<8;i++){
  const a=s*8+i,b=s*8+(i+1)%8,c=a+8,d=b+8;indices.push(a,b,c,b,d,c);
 }
 for(let i=1;i<7;i++){indices.push(0,i+1,i);const last=(stations.length-1)*8;indices.push(last,last+i,last+i+1);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
 geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

/** Flattened steel limb, with its width and thickness tapering toward the nocks. */
function prodGeometry():THREE.BufferGeometry{
 const vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
 const count=32;
 for(let i=0;i<=count;i++){
  const x=(i/count*2-1)*CROSSBOW_FRAME.halfSpan,t=Math.abs(x)/CROSSBOW_FRAME.halfSpan;
  const y=THREE.MathUtils.lerp(CROSSBOW_FRAME.prodY,CROSSBOW_FRAME.stringTipY,t*t);
  const width=THREE.MathUtils.lerp(.022,.007,t**.75),depth=THREE.MathUtils.lerp(.006,.003,t);
  for(const[a,b]of [[-1,-1],[1,-1],[1,1],[-1,1]]){vertices.push(x,y+a!*width,b!*depth+CROSSBOW_FRAME.prodZ);uvs.push(i/count,(a!+b!+2)/4);}
 }
 for(let i=0;i<count;i++)for(let j=0;j<4;j++){const a=i*4+j,b=i*4+(j+1)%4;indices.push(a,b,a+4,b,b+4,a+4);}
 indices.push(0,2,1,0,3,2);const end=count*4;indices.push(end,end+1,end+2,end,end+2,end+3);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function tube(points:readonly(readonly[number,number,number])[],radius:number,closed=false):THREE.TubeGeometry{
 return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed),24,radius,6,closed);
}

export function createRealisticCrossbow(materials:MilitaryEquipmentMaterials):THREE.Group{
 const group=new THREE.Group();group.name='Procedural military crossbow';group.userData.equipmentIdentity='armor-piercing-crossbow';
 group.userData.modelGripLocal=CROSSBOW_FRAME.grip;
 part(group,tillerGeometry(),materials.walnut,'Crossbow · tapered walnut tiller');
 part(group,prodGeometry(),materials.bluedSteel,'Crossbow · tapered flat steel prod');
 // Two narrow deck strips leave an actual central guide for the bolt.
 for(const x of [-.007,.007])part(group,new THREE.BoxGeometry(.004,.36,.003),materials.bone,
  'Crossbow · inset bone bolt guide',[x,.12,CROSSBOW_FRAME.deckZ+.0015]);
 part(group,new THREE.CylinderGeometry(.022,.022,.052,16),materials.bone,
  'Crossbow · antler rotating nut',[0,CROSSBOW_FRAME.nutY,.025],[0,0,Math.PI/2]);
 for(const x of [-.029,.029]){
  part(group,new THREE.CylinderGeometry(.007,.007,.003,10),materials.bluedSteel,
   'Crossbow · flush nut axle',[x,CROSSBOW_FRAME.nutY,.025],[0,0,Math.PI/2]);
 }
 part(group,tube([[0,-.055,-.028],[0,-.10,-.055],[0,-.21,-.067],[0,-.25,-.045]],.0045),
  materials.bluedSteel,'Crossbow · long underside release lever');
 part(group,tube([[-.021,.345,-.005],[-.047,.397,-.005],[-.046,.49,-.005],
  [.046,.49,-.005],[.047,.397,-.005],[.021,.345,-.005]],.006,true),materials.bluedSteel,'Crossbow · closed spanning stirrup');
 for(let i=0;i<4;i++){
  const y=.282+i*.012;
  part(group,tube([[-.03,y,-.027],[-.036,y,.011],[-.021,y,.033],[.021,y,.033],
   [.036,y,.011],[.03,y,-.027]],.0025,true),materials.leather,'Crossbow · bound prod bridle');
 }
 part(group,new THREE.BoxGeometry(.006,.09,.002),materials.steel,'Crossbow · spring bolt retainer',[0,.015,.048],[.1,0,0]);
 const string=new THREE.Line(new THREE.BufferGeometry().setFromPoints([
  // Anchor on the steel end faces; only the center rises to the bolt deck.
  new THREE.Vector3(-CROSSBOW_FRAME.halfSpan,CROSSBOW_FRAME.stringTipY,CROSSBOW_FRAME.prodZ),
  new THREE.Vector3(0,CROSSBOW_FRAME.nutY,CROSSBOW_FRAME.stringZ),
  new THREE.Vector3(CROSSBOW_FRAME.halfSpan,CROSSBOW_FRAME.stringTipY,CROSSBOW_FRAME.prodZ),
 ]),materials.cord);string.name='Crossbow · drawn cord';string.userData.semanticWeaponPart=string.name;group.add(string);
 return group;
}

// Seat both ends inside the guard collar so separate material meshes form
// one fitted sword, without daylight between blade, guard and leather grip.
const SWORD_JOINTS = { guardTop: .0235, guardBottom: -.012, overlap: .002 } as const;

/** A continuous thin blade with raised shoulders around a shallow forged fuller.
 * The edge is part of the cross-section, rather than a thick extruded plate. */
export function swordBladeGeometry(length:number,width:number):THREE.BufferGeometry{
 const stations=[[SWORD_JOINTS.guardTop-SWORD_JOINTS.overlap,width],[.10,width],[length*.55,width*.83],[length*.84,width*.57],[length,0.0003]];
 const section=[[-1,0],[-.82,.0025],[-.28,.003],[-.18,.0018],[.18,.0018],[.28,.003],[.82,.0025],[1,0],
  [.82,-.0025],[.28,-.003],[.18,-.0018],[-.18,-.0018],[-.28,-.003],[-.82,-.0025]];
 const p:number[]=[],uv:number[]=[],ix:number[]=[];
 for(const[y,w]of stations)for(const[x,z]of section){p.push(x!*w!,y!,z!*(.4+.6*w!/width));uv.push((x!+1)*.5,y!/length);}
 const n=section.length;
 for(let j=0;j<stations.length-1;j++)for(let i=0;i<n;i++){
  const a=j*n+i,b=j*n+(i+1)%n;ix.push(a,b,a+n,b,b+n,a+n);
 }
 for(let i=1;i<n-1;i++){ix.push(0,i+1,i);const end=(stations.length-1)*n;ix.push(end,end+i,end+i+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}

export function createRealisticSword(materials:MilitaryEquipmentMaterials,longSword:boolean):THREE.Group{
 const group=new THREE.Group();group.name=longSword?'Procedural longsword':'Procedural arming sword';
 // Roll the complete hilt/blade about its +Y handle axis so the cutting edge
 // leads the slash. Assembly batching bakes this without changing the palm fit.
 group.rotation.y=Math.PI/2;
 group.userData.equipmentIdentity=longSword?'mail-company-longsword':'infantry-sidearm';
 const gripLength=longSword?.20:.17,span=longSword?.14:.115;
 const gripTop=SWORD_JOINTS.guardBottom+SWORD_JOINTS.overlap;
 group.userData.modelGripLocal=[0,-.028-gripLength*.5,0];
 part(group,swordBladeGeometry(longSword?.92:.77,longSword?.027:.024),materials.steel,
  longSword?'Longsword · tapered double-edged blade':'Sidearm · tapered double-edged blade');
 part(group,tube([[-span,-.012,0],[-span*.7,.006,0],[0,.012,0],[span*.7,.006,0],[span,-.012,0]],.008),
  materials.bluedSteel,'Sword · forged quillon guard');
 part(group,new THREE.BoxGeometry(.055,SWORD_JOINTS.guardTop-SWORD_JOINTS.guardBottom,.03),materials.bluedSteel,
  'Sword · fitted guard collar',[0,(SWORD_JOINTS.guardTop+SWORD_JOINTS.guardBottom)*.5,0]);
 const grip=part(group,new THREE.CylinderGeometry(.016,.019,gripLength,12),materials.leather,
  'Sword · leather-bound grip',[0,gripTop-gripLength*.5,0]);grip.scale.z=.84;
 const wrap:THREE.Vector3[]=[];
 for(let i=0;i<=64;i++){
  const t=i/64,angle=t*Math.PI*10,r=THREE.MathUtils.lerp(.0165,.0195,t);
  wrap.push(new THREE.Vector3(Math.cos(angle)*r,gripTop-.005-t*(gripLength-.01),Math.sin(angle)*r*.84));
 }
 part(group,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wrap),64,.0012,4,false),materials.oxblood,'Sword · fine leather grip seam');
 const pommelRadius=longSword?.037:.033,pommelY=gripTop-gripLength-.029,pommelDepth=.35;
 const pommel=part(group,new THREE.SphereGeometry(pommelRadius,12,8),materials.bluedSteel,
  'Sword · wheel pommel',[0,pommelY,0]);pommel.scale.z=pommelDepth;
 const pinLength=.003,pinInset=.001;
 for(const sign of [-1,1])part(group,new THREE.CylinderGeometry(.006,.006,pinLength,8),materials.steel,
  'Sword · peened tang',[0,pommelY,sign*(pommelRadius*pommelDepth+pinLength*.5-pinInset)],[Math.PI/2,0,0]);
 return group;
}
