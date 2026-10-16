import assert from 'node:assert/strict';
import { writeWildflowerPrefixes, type CompactWildflowerData, type WildflowerPrefixLayout } from '../src/grass/wildflowerPrefixWrites.ts';
import type { WildflowerGeometryLod } from '../src/grass/wildflowerStreamBudget.ts';

let seed = 7193;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
const data = (count: number): CompactWildflowerData => ({count,
  matrices: Float32Array.from({length:count*16},()=>random()*100),
  anchors: Float32Array.from({length:count*4},()=>random()*100),
});
const records = Array.from({length:24},(_,index)=>({compactData:[data(1+index%5)] as Array<CompactWildflowerData|null>,
  wildflowerGeometryLod:(index%3?'footprint':'detail') as WildflowerGeometryLod}));
const layout: WildflowerPrefixLayout=[];
const detail={matrices:new Float32Array(256*16),anchors:new Float32Array(256*4)};
const footprint={matrices:new Float32Array(256*16),anchors:new Float32Array(256*4)};
let changedBytes=0,fullBytes=0;
for(let step=0;step<180;step++) {
  if(step>1) {
    const record=records[Math.floor(random()*records.length)]!;
    if(step%3===0)record.wildflowerGeometryLod=record.wildflowerGeometryLod==='detail'?'footprint':'detail';
    else record.compactData[0]=step%7===0?null:data(Math.floor(random()*6));
  }
  const result=writeWildflowerPrefixes(records,0,layout,detail,footprint);
  for(const [lod,target,count,ranges] of [
    ['detail',detail,result.detailCount,result.detailRanges],
    ['footprint',footprint,result.footprintCount,result.footprintRanges],
  ] as const) {
    const selected=records.filter(record=>record.wildflowerGeometryLod===lod).flatMap(record=>record.compactData[0]?[record.compactData[0]]:[]);
    assert.deepEqual(target.matrices.slice(0,count*16),Float32Array.from(selected.flatMap(slot=>Array.from(slot.matrices))));
    assert.deepEqual(target.anchors.slice(0,count*4),Float32Array.from(selected.flatMap(slot=>Array.from(slot.anchors))));
    changedBytes+=ranges.reduce((sum,range)=>sum+range.count*80,0);fullBytes+=count*80;
  }
  if(step===1)assert.equal(result.detailRanges.length+result.footprintRanges.length,0,'unchanged stream must not copy or upload any instances');
}
assert.ok(changedBytes<fullBytes*.65,'small stream edits should retain unchanged prefix runs');
console.log(JSON.stringify({frames:180,exactFlowerData:true,changedBytes,fullBytes}));
