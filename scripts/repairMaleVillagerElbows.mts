import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Vector3 } from 'three';

// Repair the authored male worker itself so every animation and renderer uses
// the same closed elbows. The original atlas, rig and animation bytes survive.
const asset = 'public/assets/models/villagers/worker-male-common-01-v002.glb';
const bytes = fs.readFileSync(process.argv[2] ?? asset);
const jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
if (doc.meshes[0].extras?.elbowRepair) {
  console.log('Male villager elbows are already repaired.');
  process.exit(0);
}
const binary = bytes.subarray(28 + jsonLength);
const primitive = doc.meshes[0].primitives[0];
const types = { 5121: Uint8Array, 5123: Uint16Array, 5126: Float32Array } as const;
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;
const attributes = Object.fromEntries(
  [...Object.entries(primitive.attributes), ['indices', primitive.indices]].map(([name, id]) => {
    const accessor = doc.accessors[id as number], view = doc.bufferViews[accessor.bufferView];
    assert.equal(view.byteStride, undefined);
    assert.equal(accessor.sparse, undefined);
    const Type = types[accessor.componentType as keyof typeof types];
    const width = widths[accessor.type as keyof typeof widths];
    const start = view.byteOffset + (accessor.byteOffset ?? 0);
    const data = binary.subarray(start, start + accessor.count * width * Type.BYTES_PER_ELEMENT);
    return [name, { accessor, width, Type, values: Array.from(new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))) }];
  }),
);
const position = (i: number) => new Vector3().fromArray(attributes.POSITION!.values, i * 3);
const key = (i: number) => position(i).toArray().map(n => Math.round(n * 1e5)).join(',');
const edges = new Map<string, { count: number; a: number; b: number }>();
const indices = attributes.indices!.values;
for (let i = 0; i < indices.length; i += 3) {
  for (let j = 0; j < 3; j++) {
    const a = indices[i + j]!, b = indices[i + (j + 1) % 3]!;
    const id = [key(a), key(b)].sort().join('/');
    const edge = edges.get(id) ?? { count: 0, a, b };
    edge.count++;
    edges.set(id, edge);
  }
}
function atElbow(i: number, side: number): boolean {
  const p = position(i);
  return p.x * side > .275 && p.x * side < .305
    && p.y > .76 && p.y < .82 && p.z > -.045 && p.z < .012;
}
const originalVertices = attributes.POSITION!.accessor.count;
const originalTriangles = indices.length / 3;
const repairs = [];
for (const side of [-1, 1]) {
  // Reverse the existing boundary edges so new faces meet their neighbors
  // with consistent winding. Position keys join UV splits for topology only.
  const boundary = [...edges.values()].filter(e => e.count === 1 && atElbow(e.a, side) && atElbow(e.b, side));
  assert.equal(boundary.length, 25, 'Unexpected source elbow topology; inspect the replacement asset before repairing it.');
  const remaining = boundary.map(e => ({ a: e.b, b: e.a }));
  const loops: number[][] = [];
  while (remaining.length) {
    const first = remaining.pop()!;
    const walk = [first.a, first.b];
    while (walk.length > 1) {
      const last = walk.at(-1)!;
      const repeated = walk.slice(0, -1).findIndex(i => key(i) === key(last));
      if (repeated >= 0) {
        loops.push(walk.slice(repeated, -1));
        walk.splice(repeated + 1);
        continue;
      }
      const next = remaining.findIndex(e => key(e.a) === key(last));
      assert.ok(next >= 0, 'Elbow boundary must form closed directed loops.');
      walk.push(remaining.splice(next, 1)[0]!.b);
    }
  }
  let added = 0;
  for (const loop of loops) {
    // The cuff rims fold back on themselves in 3D. A 2D projection loses
    // boundary vertices; instead choose a minimum-area triangulated surface
    // directly in 3D, with a small preference for shorter interior edges.
    const points = loop.map(position);
    const cost = points.map(() => points.map(() => Infinity));
    const split = points.map(() => points.map(() => -1));
    for (let i = 0; i < points.length - 1; i++) cost[i]![i + 1] = 0;
    for (let span = 2; span < points.length; span++) {
      for (let i = 0; i + span < points.length; i++) {
        const j = i + span;
        for (let k = i + 1; k < j; k++) {
          const area = points[k]!.clone().sub(points[i]!).cross(points[j]!.clone().sub(points[i]!)).length();
          if (area < 1e-8) continue;
          const candidate = cost[i]![k]! + cost[k]![j]! + area
            + .01 * (points[i]!.distanceToSquared(points[k]!) + points[k]!.distanceToSquared(points[j]!));
          if (candidate < cost[i]![j]!) { cost[i]![j] = candidate; split[i]![j] = k; }
        }
      }
    }
    const triangles: number[][] = [];
    function emit(i: number, j: number): void {
      if (j <= i + 1) return;
      const k = split[i]![j]!;
      assert.ok(k > i && k < j, 'Every boundary vertex must belong to a nondegenerate patch.');
      triangles.push([i, k, j]); emit(i, k); emit(k, j);
    }
    emit(0, points.length - 1);
    assert.equal(triangles.length, loop.length - 2);
    const normals = points.map(() => new Vector3());
    for (const [i, j, k] of triangles) {
      const normal = points[j!]!.clone().sub(points[i!]!).cross(points[k!]!.clone().sub(points[i!]!));
      for (const vertex of [i!, j!, k!]) normals[vertex]!.add(normal);
    }
    normals.forEach(normal => normal.normalize());
    for (const triangle of triangles) {
      const source = triangle.map(i => loop[i]!);
      const [a, b, c] = source.map(position);
      const normal = b!.clone().sub(a!).cross(c!.clone().sub(a!));
      assert.ok(normal.lengthSq() > 1e-15, 'Elbow repair cannot contain degenerate triangles.');
      normal.normalize();
      for (let corner = 0; corner < source.length; corner++) {
        const i = source[corner]!;
        const p = position(i);
        const vertex = attributes.POSITION!.values.length / 3;
        for (const [name, attribute] of Object.entries(attributes)) {
          if (name === 'indices') continue;
          if (name === 'NORMAL') attribute.values.push(...normals[triangle[corner]!]!.toArray());
          // A small, unmarked skin patch from the existing hand atlas. The
          // elbow is exposed between rolled linen and the leather guard.
          else if (name === 'TEXCOORD_0') attribute.values.push(.657 + (p.y - .79) * .25, .182 + (p.z + .0175) * .25);
          else attribute.values.push(...attribute.values.slice(i * attribute.width, (i + 1) * attribute.width));
        }
        indices.push(vertex);
      }
      added++;
    }
  }
  repairs.push({ side: side < 0 ? 'right' : 'left', boundaryEdges: boundary.length, loops: loops.map(l => l.length), triangles: added });
}
const replacements = new Map<number, Buffer>();
for (const attribute of Object.values(attributes)) {
  attribute.accessor.count = attribute.values.length / attribute.width;
  const typed = new attribute.Type(attribute.values);
  replacements.set(attribute.accessor.bufferView, Buffer.from(typed.buffer));
}
const chunks: Buffer[] = [];
let length = 0;
for (let i = 0; i < doc.bufferViews.length; i++) {
  const view = doc.bufferViews[i];
  const data = replacements.get(i) ?? binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  view.byteOffset = length;
  view.byteLength = data.length;
  chunks.push(data);
  length += data.length;
  const padding = (4 - length % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
}
doc.buffers[0].byteLength = length;
doc.meshes[0].extras = { ...doc.meshes[0].extras, elbowRepair: {
  version: 1, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  originalVertices, originalTriangles, repairs,
} };
const json = Buffer.from(JSON.stringify(doc));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.write('glTF'); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonPadded.length + length, 8);
header.writeUInt32LE(jsonPadded.length, 12); header.write('JSON', 16);
binHeader.writeUInt32LE(length); binHeader.write('BIN\0', 4);
fs.writeFileSync(asset, Buffer.concat([header, jsonPadded, binHeader, ...chunks]));
console.log(JSON.stringify({ originalVertices, originalTriangles, vertices: attributes.POSITION!.accessor.count, triangles: indices.length / 3, repairs }, null, 2));
