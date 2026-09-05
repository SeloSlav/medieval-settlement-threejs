import * as THREE from 'three';
import {createBilinearGridSample,createVirtualPipesWetTopology,sampleBilinearGridDifference,VirtualPipesWater2D} from '../rivers/virtualPipesWater.ts';
import {RENDER_WATER_MASK_THRESHOLD,type RiverField} from '../rivers/RiverField.ts';
import {getRiverWaterColumnDepth} from '../rivers/RiverWaterLevel.ts';
import type {Terrain} from '../terrain/Terrain.ts';

// Frozen pre-gauntlet visual solver, for a complete old/new cost comparison.
// This module is imported only by QA; gameplay hydrology never used this state.
export const WATER_SIM_RENDER_DELTA_LIMIT=0.16;
export function computeRiverSimulationRenderDelta(value:number):number {
  return Number.isFinite(value)?Math.max(-0.16,Math.min(0.16,value*0.24)):0;
}
export function createWaterBaselineSimulation(terrain:Terrain,field:RiverField,geometry:THREE.BufferGeometry) {
  const nx=field.resolution,nz=nx;
  const sim=new VirtualPipesWater2D({nx,ny:nz,dx:field.stepX,dy:field.stepZ,dt:0.005,g:2.4,friction:0.06,viscosity:0.1});
  const wet=new Uint8Array(nx*nz),base=new Float32Array(nx*nz);
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const i=z*nx+x,wx=field.startX+x*field.stepX,wz=field.startZ+z*field.stepZ,bed=terrain.getHeightAt(wx,wz);
    sim.terrain[i]=bed;wet[i]=Number(field.riverMask[i]>=RENDER_WATER_MASK_THRESHOLD);
    if(wet[i]){const surface=field.layout.getWaterSurfaceOverride(wx,wz);
      base[i]=surface===null?getRiverWaterColumnDepth(field,wx,wz,field.organicSignedDistance[i]):Math.max(0.15,surface-bed);
      sim.depth[i]=base[i];}
  }
  const topology=createVirtualPipesWetTopology(nx,nz,wet),positions=geometry.getAttribute('position');
  const delta=new THREE.BufferAttribute(new Float32Array(positions.count),1);delta.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('simDelta',delta);
  const samples=Array.from({length:positions.count},(_,i)=>createBilinearGridSample((positions.getX(i)-field.startX)/field.stepX,(positions.getZ(i)-field.startZ)/field.stepZ,nx,nz));
  let accumulated=0;
  return {tick(dt:number){accumulated+=Math.min(0.1,Math.max(0,dt));if(accumulated<1/20)return;accumulated=0;
    sim.stepMasked(topology);sim.stepMasked(topology);
    const values=delta.array as Float32Array;
    for(let i=0;i<values.length;i++)values[i]=computeRiverSimulationRenderDelta(sampleBilinearGridDifference(samples[i]!,sim.depth,base));
    delta.needsUpdate=true;
  }};
}
