import * as THREE from 'three';
import type { WorkerToolKind } from './workerTools.ts';
import { offsetMilitaryHandGrip } from './militaryHandGrip.ts';

type GripKind='spear'|'spear-shield'|'pike-kit'|'halberd'|'sidearm'|'sword-shield'|'dagger';
type Fit={fingers:THREE.Quaternion[];thumb:THREE.Quaternion};
const diagonal=new THREE.Vector3(0,Math.SQRT1_2,Math.SQRT1_2);
const transverse=new THREE.Vector3(0,0,1);
function fit(pairs:number[][],thumb:number[],left=false,upright=false):Fit {
  return {fingers:pairs.flatMap(pair=>pair.map(a=>new THREE.Quaternion().setFromAxisAngle(upright?transverse:diagonal,left?-a:a))),
    thumb:new THREE.Quaternion().setFromEuler(new THREE.Euler(thumb[0],thumb[1],thumb[2],'ZYX'))};
}

// Surface-fitted to the actual bare male hand and raider glove, including
// triangle interiors. Separate handle diameters need different knuckle curls.
// These fits are used only by melee; carrying and ranged grips retain theirs.
const right:Record<GripKind,readonly [Fit,Fit]>={
  spear:[
    fit([[.6,.3],[.6,1.5],[.3,1.95],[.9,1.2]],[0,-1.4,-.6]),
    fit([[.15,1.35],[.9,.3],[.45,1.95],[1.2,1.5]],[0,-.4,-.2]),
  ],
  'spear-shield':[
    fit([[.25,1.3],[1.05,.15],[.6,1.5],[.85,1.2]],[0,-.8,.2]),
    fit([[.4,.65],[.75,.8],[.6,1.55],[1.35,.5]],[0,-1,.2]),
  ],
  'pike-kit':[
    fit([[.6,.3],[.6,1.5],[1.2,.3],[1.2,.6]],[0,-.4,0]),
    fit([[.45,.6],[.75,1.05],[.45,1.8],[1.35,.6]],[0,-1,-.6]),
  ],
  halberd:[
    fit([[.6,.3],[.6,1.5],[1.2,.3],[1.2,.6]],[0,-.4,0]),
    fit([[.45,.6],[.75,1.05],[.45,1.8],[1.35,.6]],[0,-1,-.6]),
  ],
  sidearm:[
    fit([[.75,.3],[1.2,.45],[1.2,.75],[1.05,1.95]],[0,-1.2,-.6]),
    fit([[.75,.45],[.6,1.65],[.75,1.5],[1.35,1.35]],[0,-1.4,-.4]),
  ],
  'sword-shield':[
    fit([[.6,.3],[.6,1.8],[.6,1.65],[.75,1.8]],[0,-.6,0]),
    fit([[.6,1.35],[.9,.6],[1.2,.3],[1.5,.45]],[0,-1,-.6]),
  ],
  dagger:[
    fit([[.45,.3],[1.05,.3],[.6,1.5],[.75,1.35]],[0,-.8,.2]),
    fit([[.6,.6],[.75,1.05],[.6,1.5],[1.5,1.8]],[0,-.6,0]),
  ],
};
const support:Record<'spear'|'pike-kit'|'halberd',readonly [Fit,Fit]>={
  spear:[
    fit([[.9,.3],[.15,1.95],[.45,1.8],[1.5,1.35]],[0,-1.4,-.8],true),
    fit([[1.05,1.8],[1.05,.6],[.75,1.5],[1.2,1.2]],[0,1.4,.4],true),
  ],
  'pike-kit':[
    fit([[.75,.6],[.75,.3],[.75,.9],[.45,1.65]],[0,-1.4,-.8],true),
    fit([[1.05,.9],[1.05,.6],[1.2,1.95],[1.2,1.2]],[0,1.4,.4],true),
  ],
  halberd:[
    fit([[.3,1.35],[.45,.9],[.45,1.35],[.6,.9]],[0,-1,-.8],true),
    fit([[.3,1.8],[.9,.75],[1.2,.45],[1.05,1.35]],[0,-.2,0],true),
  ],
};

const shields:Record<'spear-shield'|'sidearm-shield'|'sword-shield',readonly [Fit,Fit]>={
  'spear-shield':[
    fit([[1.1,1.5],[.9,1.55],[1.1,.85],[.5,.55]],[0,1.4,-.4],true,true),
    fit([[1.35,1.3],[1.1,1.6],[1.2,.95],[.4,1.6]],[0,1,-.4],true,true),
  ],
  'sidearm-shield':[
    fit([[1.2,1.45],[1.3,1.15],[.65,1.6],[.4,1]],[0,1.4,-.4],true,true),
    fit([[1.35,1.35],[1.1,1.7],[.95,1.35],[.9,.85]],[0,1.4,-.6],true,true),
  ],
  'sword-shield':[
    fit([[1.15,1.55],[.85,1.75],[.5,1.75],[.55,.2]],[0,.8,-.8],true,true),
    fit([[1.45,1.45],[1.4,1.85],[.75,1.9],[1.25,1.45]],[0,-.4,-.4],true,true),
  ],
};
export const MELEE_FREE_HAND_GRIP=fit([[.5,.65],[.55,.7],[.6,.75],[.65,.8]],[0,.3,-.2],true,true);

export function meleeShieldHandGrip(hand:THREE.Bone,tool:WorkerToolKind):Fit {
  const kind=tool==='spear-shield'||tool==='sword-shield'?tool:'sidearm-shield';
  return shields[kind][Number(hand.userData.militaryGripScale??1)>.9?1:0];
}

export function meleeHandGrip(hand:THREE.Bone,tool:WorkerToolKind,left:boolean):Fit {
  const kind:GripKind=tool==='bow'||tool==='crossbow'?'dagger':tool==='sidearm-shield'?'sidearm':
    Object.hasOwn(right,tool)?tool as GripKind:'sidearm';
  const index=Number(hand.userData.militaryGripScale??1)>(left?.9:1.06)?1:0;
  return left?support[kind==='pike-kit'||kind==='halberd'?kind:'spear'][index]:right[kind][index];
}

/** The shaft sits against the palm surface, outside the thumb/index web. */
export function meleePalmLocal(hand:THREE.Bone,left:boolean,out:THREE.Vector3):THREE.Vector3 {
  out.set(left?.018:-.01,left?.0383:.044,-.0071);
  if(!left)out.multiplyScalar(Number(hand.userData.militaryGripScale??1));
  return offsetMilitaryHandGrip(hand,out);
}
