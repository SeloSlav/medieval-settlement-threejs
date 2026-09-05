import type { WebGPURenderer } from 'three/webgpu';
import { SpectralWaterSimulation } from './SpectralWaterSimulation.ts';
import type { WaterSurfaceProfileId } from './WaterSurfaceProfile.ts';

type Entry = {simulation:SpectralWaterSimulation;references:number;times:WeakMap<object,number>};
const entries = new Map<WaterSurfaceProfileId,Entry>();
/** Share one spectrum across playable and distant water. A paused scene costs no dispatch. */
export function acquireWaterSpectrum(profile:WaterSurfaceProfileId) {
  if(profile==='river')return null;
  let entry=entries.get(profile);
  if(!entry){entry={simulation:new SpectralWaterSimulation(null,profile),references:0,times:new WeakMap()};entries.set(profile,entry);}
  entry.references++;
  const owned=entry;
  let disposed=false;
  return {
    binding:owned.simulation.binding,
    update(renderer:WebGPURenderer,time:number){
      const backend=(renderer as unknown as {backend:{isWebGPUBackend?:boolean}}).backend;
      if(disposed||!backend.isWebGPUBackend)return;
      const previous=owned.times.get(renderer);
      if(previous===time)return;
      owned.simulation.update(time,previous===undefined?1/60:Math.max(0,time-previous),renderer);
      owned.times.set(renderer,time);
    },
    dispose(){if(disposed)return;disposed=true;if(--owned.references===0){owned.simulation.dispose();entries.delete(profile);}},
  };
}
