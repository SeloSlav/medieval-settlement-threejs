import assert from 'node:assert/strict';
import {DataUtils} from 'three';
import {RiverField} from '../src/rivers/RiverField.ts';
import {RiverLayout} from '../src/rivers/RiverLayout.ts';
import {createRiverWaterShoreMaps,disposeRiverWaterShoreMaps} from '../src/rivers/riverWaterShoreMaps.ts';
import { deflectWaterAroundRock, waterBankVelocityScale } from '../src/rivers/WaterHydraulics.ts';
import { getRiverChannelRockContactRadius, type RiverChannelRockPlacement } from '../src/rivers/RiverChannelRocks.ts';
import { SpectralWaterSimulation, validateSpectralIfft } from '../src/rivers/SpectralWaterSimulation.ts';
import { acquireWaterSpectrum, updateWaterSpectra } from '../src/rivers/WaterSpectrumRuntime.ts';

const rock:RiverChannelRockPlacement={x:0,z:0,scale:1.2,flowX:1,flowZ:0,side:1,halfWidth:12,corridor:0,station:0,flowSpeed:1,rapidEnergy:0.8};
const radius=getRiverChannelRockContactRadius(rock.scale);
assert.deepEqual(deflectWaterAroundRock(1,0,0,0,rock),[0,0]);
// The boundary condition is impermeability, including oblique incident flow.
for(let i=0;i<64;i++) {
  const angle=i*Math.PI*2/64,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
  const [vx,vz]=deflectWaterAroundRock(0.8,0.35,x,z,rock);
  assert.ok(Math.abs(vx*x+vz*z)<1e-10,`normal flux at angle ${angle}`);
  assert.ok(Number.isFinite(vx)&&Number.isFinite(vz));
}
const upper=deflectWaterAroundRock(1,0,-radius,radius,rock);
const lower=deflectWaterAroundRock(1,0,-radius,-radius,rock);
assert.ok(Math.abs(upper[0]-lower[0])<1e-12);
assert.ok(Math.abs(upper[1]+lower[1])<1e-12);
assert.ok(upper[1]>0&&lower[1]<0,'incident water splits around the obstacle');
assert.ok(deflectWaterAroundRock(1,0,0,radius,rock)[0]>1.9,'shoulders accelerate');
assert.ok(deflectWaterAroundRock(1,0,radius*2,0,rock)[0]<0.75,'lee loses energy');
assert.ok(deflectWaterAroundRock(1,0,radius*2.4,0,rock)[0]<0,'separated center wake recirculates');
assert.ok(Math.abs(deflectWaterAroundRock(1,0,1000,1000,rock)[0]-1)<0.001,'far field recovers');
assert.ok(waterBankVelocityScale(0)<waterBankVelocityScale(1));
assert.ok(waterBankVelocityScale(1)<waterBankVelocityScale(5));
assert.equal(waterBankVelocityScale(5),waterBankVelocityScale(100));
const fft=validateSpectralIfft(16);
assert.ok(fft.dcMaxError<1e-6&&fft.frequencyMaxError<1e-6);
let submissions=0;
const renderer={compute(nodes:unknown[]){assert.ok(nodes.length>0);submissions++;}};
const spectrum=new SpectralWaterSimulation(renderer as never,'coastal');
const initial=spectrum.binding.cascades.map(c=>c.foam.value);
spectrum.update(1,1/60);
assert.equal(submissions,1,'all dependencies share one compute submission');
for(let i=0;i<initial.length;i++)assert.equal(spectrum.binding.cascades[i].foam.value,spectrum.binding.cascades[i].foam1);
spectrum.update(1+1/60,1/60);
for(let i=0;i<initial.length;i++)assert.equal(spectrum.binding.cascades[i].foam.value,initial[i]);
spectrum.dispose();spectrum.update(2,1/60);assert.equal(submissions,2);
let visibleSubmissions=0;
const visibilityRenderer={backend:{isWebGPUBackend:true},compute(){visibleSubmissions++;}};
const shared=acquireWaterSpectrum('coastal')!;
updateWaterSpectra(visibilityRenderer as never,0);
shared.markVisible(visibilityRenderer);
updateWaterSpectra(visibilityRenderer as never,1/60);
shared.markVisible(visibilityRenderer);
updateWaterSpectra(visibilityRenderer as never,1/60);
assert.equal(visibleSubmissions,2,'paused visible water must not dispatch');
updateWaterSpectra(visibilityRenderer as never,2/60);
updateWaterSpectra(visibilityRenderer as never,3/60);
assert.equal(visibleSubmissions,2,'offscreen water must not dispatch');
shared.markVisible(visibilityRenderer);
updateWaterSpectra(visibilityRenderer as never,4/60);
assert.equal(visibleSubmissions,3,'returning water resumes its shared spectrum');
shared.dispose();shared.dispose();
updateWaterSpectra(visibilityRenderer as never,5/60);
assert.equal(visibleSubmissions,3,'disposed spectrum has no further work');
console.log('Water boundary conditions, velocity recovery, FFT, and foam binding lifecycle passed.');

const coastBounds={minX:-80,maxX:80,minZ:-80,maxZ:80};
const coastLayout=RiverLayout.create({bounds:coastBounds,seed:42,terrainPreset:'vinodol_coast'});
const coastField=RiverField.fromLayout({bounds:coastBounds,layout:coastLayout,resolution:32});
const coastMaps=createRiverWaterShoreMaps(coastField,{terrain:{getHeightAt:x=>x<-20?-12:2}});
const coastData=coastMaps.hydraulicTexture!.image.data as Uint16Array;
assert.ok(Math.abs(DataUtils.fromHalfFloat(coastData[2]!)-7.6)<0.005,
  'absolute sea level must use the actual seabed depth, not the river fallback');
assert.equal(DataUtils.fromHalfFloat(coastData[(coastMaps.resolution!-1)*4+2]!),0,
  'dry ground above sea level must have zero water depth');
disposeRiverWaterShoreMaps(coastMaps);
console.log('Coastal seabed and dry-shore depth integration passed.');
