import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { optimizeTriangleIndices, triangleSet, vertexCacheMisses } from './lib/meshIndexOptimization.mjs';

const check = process.argv.includes('--check');
const report = [];
for (const file of ['worker-male-common-01-v002.glb', 'worker-female-common-01-v001.glb']) {
  const path = `public/assets/models/villagers/${file}`, original = readFileSync(path), output = Buffer.from(original);
  assert.equal(original.readUInt32LE(0), 0x46546c67);
  const jsonBytes = original.readUInt32LE(12), json = JSON.parse(original.subarray(20, 20 + jsonBytes)), binStart = 28 + jsonBytes;
  const done = new Set(); const ranges = [];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'The authored asset must contain only triangle primitives');
    if (done.has(primitive.indices)) continue; done.add(primitive.indices);
    const accessor = json.accessors[primitive.indices], view = json.bufferViews[accessor.bufferView];
    assert.ok(!accessor.sparse && !view.byteStride && (view.buffer ?? 0) === 0);
    assert.ok([5123, 5125].includes(accessor.componentType));
    const Type = accessor.componentType === 5123 ? Uint16Array : Uint32Array;
    const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const before = new Type(original.buffer, original.byteOffset + start, accessor.count);
    const after = await optimizeTriangleIndices(before);
    assert.deepEqual(triangleSet(after), triangleSet(before), 'Every oriented authored triangle must be retained');
    const beforeMisses = vertexCacheMisses(before), afterMisses = vertexCacheMisses(after);
    report.push({ file, vertices:json.accessors[primitive.attributes.POSITION].count, triangles:accessor.count/3, simulatedCacheSize:32, beforeMisses, afterMisses });
    if (check) assert.ok(beforeMisses <= afterMisses * 1.05, `${file}: unoptimized vertex-cache order`);
    Buffer.from(after.buffer, after.byteOffset, after.byteLength).copy(output, start);
    ranges.push([start, after.byteLength]);
  }
  const untouchedBefore = Buffer.from(original), untouchedAfter = Buffer.from(output);
  for (const [start, count] of ranges) { untouchedBefore.fill(0,start,start+count);untouchedAfter.fill(0,start,start+count); }
  assert.ok(untouchedBefore.equals(untouchedAfter), 'Vertices, normals, UVs, skinning, materials, textures, animation keys and GLB metadata must be byte-identical');
  const untouchedSha256 = createHash('sha256').update(untouchedBefore).digest('hex');
  for(const row of report.filter(r=>r.file===file))row.untouchedSha256=untouchedSha256;
  if (!check) {
    const backup = 'artifacts/city-performance/model-index-baseline';mkdirSync(backup,{recursive:true});
    if(!existsSync(`${backup}/${file}`))copyFileSync(path,`${backup}/${file}`);
    writeFileSync(path,output);
  }
}
mkdirSync('artifacts/city-performance',{recursive:true});
writeFileSync(`artifacts/city-performance/model-index-${check?'check':'optimization'}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
