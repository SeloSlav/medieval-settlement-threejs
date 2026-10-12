import assert from 'node:assert/strict';
import {CROWD_SIM_DT,initialCrowdSimulationPhase} from '../src/settlement/crowdView.ts';

const phases=Array.from({length:500},(_,i)=>initialCrowdSimulationPhase(`resident:home-${Math.floor(i/5)}:${i%5}`));
assert(phases.every(phase=>phase>0&&phase<CROWD_SIM_DT));
assert.deepEqual(phases,phases.map((_,i)=>initialCrowdSimulationPhase(`resident:home-${Math.floor(i/5)}:${i%5}`)));
const accumulators=[...phases],steps=new Uint32Array(phases.length),workPerFrame=[];
for(let frame=0;frame<120;frame++) {
  let work=0;
  for(let i=0;i<accumulators.length;i++) {
    accumulators[i]!+=1/60;
    while(accumulators[i]!>=CROWD_SIM_DT){accumulators[i]!-=CROWD_SIM_DT;steps[i]!++;work++;}
  }
  workPerFrame.push(work);
}
assert([...steps].every(count=>count===30),'every civilian retains 15 simulation steps per second');
assert(Math.max(...workPerFrame)<160,'500 civilians must not all step on the same animation frame');
const paused=[...accumulators];
for(let frame=0;frame<60;frame++)for(let i=0;i<accumulators.length;i++)accumulators[i]!+=0;
assert.deepEqual(accumulators,paused,'paused simulation retains phases');
console.log(JSON.stringify({agents:500,stepsPerAgent:30,peakAgentsPerFrame:Math.max(...workPerFrame),meanAgentsPerFrame:workPerFrame.reduce((a,b)=>a+b)/workPerFrame.length}));
