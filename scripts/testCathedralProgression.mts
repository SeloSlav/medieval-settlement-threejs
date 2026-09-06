import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { createChapelMesh } from '../src/buildings/meshes/chapelMesh.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingFootprint.ts';
import { BuildingStaticBatches } from '../src/buildings/BuildingStaticBatches.ts';
import { batchCompletedBuildingStaticMeshes } from '../src/buildings/staticBuildingBatch.ts';
import { chapelUpgradeCost, chapelTierDefinition, normalizeChapelTier } from '../src/economy/chapelUpgrade.ts';
import { effectiveResidenceSettleTicks } from '../src/economy/chapelCommunity.ts';
import { chapelUpkeepPerDay, payableParishExpensePerDay } from '../src/economy/chapelParish.ts';
import { buildResidenceCommunityContext } from '../src/economy/economyInspectorViews.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import { findServingChapel, type RoadPathProbe } from '../src/logistics/landmarkAccess.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import { buildingMeshSignature } from '../src/buildings/buildingMarkerSignature.ts';

const plot = getBuildingFootprintHalfExtents('chapel');
assert.deepEqual(chapelUpgradeCost(3), {targetTier:4,timber:160,stone:432,ironwork:80,roofTiles:320,dressedStone:240});
assert.equal(chapelUpgradeCost(4),null);
assert.equal(normalizeChapelTier(255),4);
assert.equal(normalizeChapelTier(0),1);
assert.equal(chapelTierDefinition(4).label,'Cathedral');
assert.equal(chapelTierDefinition(4).cofferCapacity,2400);
assert.equal(chapelUpkeepPerDay(1,4),chapelUpkeepPerDay(1,1)*5);
assert.equal(payableParishExpensePerDay(1,0,4).total,0,'empty coffers cannot create gold');
assert(payableParishExpensePerDay(1,100,4).total > payableParishExpensePerDay(1,100,3).total);
for (const monastery of [false,true]) for(const sabbath of [false,true]) {
  const ordinary=effectiveResidenceSettleTicks(true,sabbath,monastery,3);
  assert.equal(effectiveResidenceSettleTicks(true,sabbath,monastery,4),Math.ceil(ordinary*.75));
  assert.equal(effectiveResidenceSettleTicks(false,sabbath,monastery,4),250,'bishop requires parish access');
}
const home={id:'home',tier:1,x:0,z:0} as ResidenceState;
const cathedral={id:'4',kind:'chapel',chapelTier:4,constructionComplete:true,assignedLabor:1,x:50,z:0} as BuildingState;
const local={...cathedral,id:'3',chapelTier:3,x:10} as BuildingState;
const route=(ax:number,az:number,bx:number,bz:number)=>Math.hypot(bx-ax,bz-az);
const ticksFor=(chapels:BuildingState[],probe:RoadPathProbe=route)=>{
  const c=buildResidenceCommunityContext(findServingChapel(home,chapels,probe),DEFAULT_PARISH_POLICY);
  return effectiveResidenceSettleTicks(c.hasChapelAccess,c.sabbathObservance,c.hasMonasteryCoverage,c.chapelTier);
};
assert.equal(ticksFor([cathedral]),132);
assert.equal(ticksFor([cathedral,local]),175,'a distant cathedral must not stack onto a nearer parish');
assert.equal(ticksFor([{...cathedral,assignedLabor:0}]),250,'unstaffed bishop office is inactive');
assert.equal(ticksFor([{...cathedral,constructionComplete:false}]),250,'unfinished cathedrals provide no bishop');
assert.equal(ticksFor([cathedral],()=>null),250,'disconnected cathedral cannot accelerate homes');
assert.notEqual(buildingMeshSignature(cathedral),buildingMeshSignature({...cathedral,chapelTier:3}));

const batches=new BuildingStaticBatches(new THREE.Group());
const sizes:THREE.Vector3[]=[];
for(const tier of [1,2,3,4] as const) {
  const raw=createChapelMesh(tier);
  const bounds=new THREE.Box3().setFromObject(raw);
  assert(bounds.min.x>=-plot.halfWidth-1e-5 && bounds.max.x<=plot.halfWidth+1e-5);
  assert(bounds.min.z>=-plot.halfDepth-1e-5 && bounds.max.z<=plot.halfDepth+1e-5);
  sizes.push(new THREE.Box3().setFromObject(raw.getObjectByName(raw.name+' procedural model')!).getSize(new THREE.Vector3()));
  const compiled=createBuildingMesh('chapel',tier);
  assert.equal(compiled.userData.proceduralBuildingPlan.developmentTier,tier);
  assert(compiled.userData.proceduralArchitectureMetrics.withinVisibleTriangleCeiling);
  assert(compiled.getObjectByName('ChapelCofferChest'));
  batchCompletedBuildingStaticMeshes(compiled);
  batches.registerBuilding('upgrade-in-place',compiled);
  const collision=compiled.getObjectByName('Building collision geometry proxy')!;
  assert(Math.abs(collision.scale.x-plot.halfWidth*2)<1e-4);
  assert(Math.abs(collision.scale.z-plot.halfDepth*2)<1e-4);
}
batches.dispose();
for(let i=1;i<4;i++) assert(sizes[i]!.y>sizes[i-1]!.y);
assert(sizes[3]!.y>29 && sizes[3]!.x>20 && sizes[3]!.z>25);
const cathedralMesh=createChapelMesh(4);cathedralMesh.updateMatrixWorld(true);
const meshesNamed=(name:string)=>{const found:THREE.Mesh[]=[];cathedralMesh.traverse(o=>{if(o.name===name)found.push(o as THREE.Mesh);});return found;};
const facade=meshesNamed('Cathedral physical west front portal and rose')[0]!;
const hits=(objects:THREE.Mesh[],origin:THREE.Vector3,dir:THREE.Vector3)=>new THREE.Raycaster(origin,dir,0,3).intersectObjects(objects,false);
assert.equal(hits([facade],new THREE.Vector3(0,8.65,12),new THREE.Vector3(0,0,-1)).length,0,'rose has a physical hole');
assert(hits([facade],new THREE.Vector3(2.4,8.65,12),new THREE.Vector3(0,0,-1)).length>0,'rose shoulder remains masonry');
const sideWalls=meshesNamed('Cathedral nave arcade and clerestory wall');
const aisleWalls=meshesNamed('Cathedral outer aisle pierced wall');
for(const side of [-1,1]) for(const z of [-10.5,-7.5,-4.5,-1.5,1.5,4.5]) {
  const direction=new THREE.Vector3(-side,0,0);
  assert.equal(hits(sideWalls,new THREE.Vector3(side*6,9.7,z),direction).length,0,'clerestory pane must align with its wall opening');
  assert.equal(hits(aisleWalls,new THREE.Vector3(side*9.5,2.7,z),direction).length,0,'aisle pane must align with its wall opening');
}
assert.equal(meshesNamed('Cathedral curved flying arch').length,14);
assert.equal(meshesNamed('Cathedral great bell').length,2);
assert(cathedralMesh.getObjectByName('Cathedral bishop cathedra seat'));
const simulation=readFileSync('server/src/simulation/residence_settlement.rs','utf8');
assert.match(simulation,/effective_settle_ticks\(\s*chapel_tier/);
console.log('Cathedral progression passed: costs, parish-only bishop benefit, upkeep, four compiled tiers, permanent footprint, batched upgrades, real apertures.');
