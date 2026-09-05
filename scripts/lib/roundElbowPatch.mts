import * as THREE from 'three';

/** Bake the fuller left elbow into the source mesh. Inflate in a relaxed
 * carrying pose, then return every vertex to bind space through its original
 * skin influences. This changes geometry only, never the rig or animations. */
export function roundElbowPatch(mesh: THREE.SkinnedMesh, originalVertices: number): THREE.BufferGeometry {
  const source = mesh.geometry;
  const positions = source.getAttribute('position');
  const index = source.index!;
  const faces: number[][] = [], retained: number[] = [];
  const points = new Map<number, THREE.Vector3>();
  const key = (p: THREE.Vector3) => p.toArray().map(v => Math.round(v * 1e7)).join(',');
  const point = (i: number) => {
    if (!points.has(i)) points.set(i, mesh.getVertexPosition(i, new THREE.Vector3()));
    return points.get(i)!;
  };
  const edges = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; count: number }>();
  const directions = new Map<string, THREE.Vector3>();
  for (let i = 0; i < index.count; i += 3) {
    const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (!face.every(v => v >= originalVertices && positions.getX(v) > 0)) { retained.push(...face); continue; }
    faces.push(face);
    const [a, b, c] = face.map(point);
    const normal = b!.clone().sub(a!).cross(c!.clone().sub(a!));
    for (let j = 0; j < 3; j++) {
      const p = point(face[j]!), q = point(face[(j + 1) % 3]!);
      const id = [key(p), key(q)].sort().join('/');
      const edge = edges.get(id) ?? { a: p, b: q, count: 0 }; edge.count++; edges.set(id, edge);
      const n = directions.get(key(p)) ?? new THREE.Vector3(); n.add(normal); directions.set(key(p), n);
    }
  }
  for (const n of directions.values()) n.normalize();
  const boundary = [...edges.values()].filter(e => e.count === 1).map(e => new THREE.Line3(e.a, e.b));
  const arrays = Object.fromEntries(Object.entries(source.attributes).map(([name, attr]) => [name, Array.from(attr.array)]));
  const joints = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
  const generated: { id: number; point: THREE.Vector3; inverseSkin: THREE.Matrix4 }[] = [];
  const vertices = new Map<string, number>();
  const normalSums = new Map<string, THREE.Vector3>();
  const added: number[][] = [];
  const closest = new THREE.Vector3();
  const subdivisions = 4;
  // Depth scales with the authored arm. Roughly 10 mm on a 1.72 m worker;
  // only the interior swells, with zero displacement on every cuff rim.
  const elbow = mesh.skeleton.bones.find(b => b.name === 'L_Forearm')!;
  const wrist = mesh.skeleton.bones.find(b => b.name === 'L_Hand')!;
  const depth = mesh.worldToLocal(elbow.getWorldPosition(new THREE.Vector3()))
    .distanceTo(mesh.worldToLocal(wrist.getWorldPosition(new THREE.Vector3()))) * .045;
  function vertex(face: number[], bary: number[]): number {
    // Keep the original 25 rim edges intact: no T-junctions against the
    // neighboring sleeve/bracer triangles and no new boundary skin weights.
    for (let c = 0; c < 3; c++) if (bary[c] === 0) {
      const a = (c + 1) % 3, b = (c + 2) % 3;
      const edge = edges.get([key(point(face[a]!)), key(point(face[b]!))].sort().join('/'));
      if (edge?.count === 1) { const nearest = bary[a]! >= bary[b]! ? a : b; bary = [0, 0, 0]; bary[nearest] = 1; break; }
    }
    const p = new THREE.Vector3(), direction = new THREE.Vector3();
    const influence = new Map<number, number>();
    for (let c = 0; c < 3; c++) {
      const src = face[c]!, amount = bary[c]!;
      p.addScaledVector(point(src), amount); direction.addScaledVector(directions.get(key(point(src)))!, amount);
      for (let s = 0; s < 4; s++) {
        const joint = joints.getComponent(src, s), weight = weights.getComponent(src, s) * amount;
        if (weight) influence.set(joint, (influence.get(joint) ?? 0) + weight);
      }
    }
    const id = key(p), existing = vertices.get(id);
    if (existing !== undefined) return existing;
    const distance = Math.min(...boundary.map(edge => edge.closestPointToPoint(p, true, closest).distanceTo(p)));
    p.addScaledVector(direction.normalize(), depth * Math.sin(Math.min(1, distance / (depth * 2)) * Math.PI / 2));
    const skin = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = skin.reduce((n, v) => n + v[1], 0); skin.forEach(v => v[1] /= sum);
    const transform = new THREE.Matrix4(); transform.elements.fill(0);
    for (const [joint, weight] of skin) {
      const bone = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.bones[joint]!.matrixWorld, mesh.skeleton.boneInverses[joint]!);
      bone.elements.forEach((v, i) => { transform.elements[i]! += v * weight; });
    }
    transform.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
    const inverseSkin = transform.clone().invert();
    const bindPoint = p.clone().applyMatrix4(inverseSkin);
    const output = arrays.position!.length / 3;
    for (const [name, attr] of Object.entries(source.attributes)) {
      const values = arrays[name]!;
      if (name === 'position') values.push(...bindPoint.toArray());
      else if (name === 'skinIndex') for (let s = 0; s < 4; s++) values.push(skin[s]?.[0] ?? 0);
      else if (name === 'skinWeight') for (let s = 0; s < 4; s++) values.push(skin[s]?.[1] ?? 0);
      else for (let s = 0; s < attr.itemSize; s++) values.push(face.reduce((n, src, c) => n + attr.getComponent(src, s) * bary[c]!, 0));
    }
    vertices.set(id, output); generated.push({ id: output, point: p, inverseSkin });
    return output;
  }
  for (const face of faces) {
    const at = (i: number, j: number) => vertex(face, [1 - (i + j) / subdivisions, i / subdivisions, j / subdivisions]);
    for (let i = 0; i < subdivisions; i++) for (let j = 0; j < subdivisions - i; j++) {
      const first = [at(i, j), at(i + 1, j), at(i, j + 1)];
      if (new Set(first).size === 3) added.push(first);
      if (i + j < subdivisions - 1) {
        const second = [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        if (new Set(second).size === 3) added.push(second);
      }
    }
  }
  const byId = new Map(generated.map(v => [v.id, v]));
  for (const face of added) {
    const [a, b, c] = face.map(id => byId.get(id)!.point);
    const normal = b!.clone().sub(a!).cross(c!.clone().sub(a!));
    for (const id of face) { const p = key(byId.get(id)!.point), n = normalSums.get(p) ?? new THREE.Vector3(); n.add(normal); normalSums.set(p, n); }
  }
  for (const v of generated) {
    const normal = normalSums.get(key(v.point))!.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(v.inverseSkin));
    normal.toArray(arrays.normal!, v.id * 3);
  }
  const geometry = source.clone();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const Type = attribute.array.constructor as new (values: number[]) => THREE.TypedArray;
    geometry.setAttribute(name, new THREE.BufferAttribute(new Type(arrays[name]!), attribute.itemSize, attribute.normalized));
  }
  geometry.setIndex([...retained, ...added.flat()]);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.elbowVolume = { firstVertex: positions.count, addedVertices: generated.length, sourceTriangles: faces.length, roundedTriangles: added.length, depth };
  return geometry;
}
