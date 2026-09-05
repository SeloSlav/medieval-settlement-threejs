import type { WebGPURenderer } from 'three/webgpu';
import type { WebGLRenderer } from 'three';
import { SpectralWaterSimulation } from './SpectralWaterSimulation.ts';
import type { WaterSurfaceProfileId } from './WaterSurfaceProfile.ts';

type Entry = {simulation:SpectralWaterSimulation;references:number;times:WeakMap<object,number>;visibleFrames:WeakMap<object,number>};
const entries = new Map<WaterSurfaceProfileId,Entry>();
const rendererFrames = new WeakMap<object,number>();
/** Submit before renderer.render; nested compute invalidates Three's node frame. */
export function updateWaterSpectra(renderer:WebGPURenderer | WebGLRenderer,time:number):void {
  const backend=(renderer as unknown as {backend:{isWebGPUBackend?:boolean}}).backend;
  if(!backend?.isWebGPUBackend)return;
  const frame = (rendererFrames.get(renderer) ?? 0) + 1;
  rendererFrames.set(renderer,frame);
  for(const entry of entries.values()) {
    const previous=entry.times.get(renderer);
    // Object updates record actual visibility, including the distant mesh.
    // Keep the first initialization, then stop dispatching offscreen spectra.
    if(previous!==undefined && (entry.visibleFrames.get(renderer) ?? 0) < frame-1)continue;
    if(previous===time)continue;
    entry.simulation.update(time,previous===undefined?1/60:time<previous?60:time-previous,renderer as WebGPURenderer);
    entry.times.set(renderer,time);
  }
}
/** Share one spectrum across playable and distant water. A paused scene costs no dispatch. */
export function acquireWaterSpectrum(profile:WaterSurfaceProfileId) {
  if(profile==='river')return null;
  let entry=entries.get(profile);
  if(!entry){entry={simulation:new SpectralWaterSimulation(null,profile),references:0,times:new WeakMap(),visibleFrames:new WeakMap()};entries.set(profile,entry);}
  entry.references++;
  const owned=entry;
  let disposed=false;
  return {
    binding:owned.simulation.binding,
    markVisible(renderer:object){owned.visibleFrames.set(renderer,rendererFrames.get(renderer) ?? 0);},
    dispose(){if(disposed)return;disposed=true;if(--owned.references===0){owned.simulation.dispose();entries.delete(profile);}},
  };
}
