import * as THREE from 'three';
import { RoadMeshBuilder } from './src/roads/RoadMeshBuilder.ts';

const terrain = {
  getHeightAt: () => 0,
  getPointAt: (x: number, z: number, yOffset = 0) => new THREE.Vector3(x, yOffset, z),
};
const materials = {
  road: new THREE.MeshBasicMaterial(),
  roadEdge: new THREE.MeshBasicMaterial(),
};
const builder = new RoadMeshBuilder(terrain as never, materials as never);

for (const degrees of [90, 100, 110, 115, 120, 125, 130, 140, 150, 160, 170]) {
  const radians = THREE.MathUtils.degToRad(degrees);
  const group = builder.buildBuildingAccessSpur([
    new THREE.Vector3(-15, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(Math.cos(radians) * 15, 0, Math.sin(radians) * 15),
  ], 2.8, `probe-${degrees}`)!;
  const results = group.children.map((child) => inspect((child as THREE.Mesh).geometry));
  console.log(degrees, results);
}

function inspect(geometry: THREE.BufferGeometry): object {
  const positions = geometry.getAttribute('position');
  const index = geometry.index!;
  let positive = 0;
  let negative = 0;
  let zero = 0;
  let min = Infinity;
  let max = -Infinity;
  const flipped: Array<{ offset: number; area: number; vertices: number[] }> = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const [a, b, c] = ids.map((id) => new THREE.Vector2(positions.getX(id), positions.getZ(id)));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    min = Math.min(min, area);
    max = Math.max(max, area);
    if (area > 1e-8) positive += 1;
    else if (area < -1e-8) {
      negative += 1;
      if (flipped.length < 8) flipped.push({ offset, area, vertices: ids });
    } else zero += 1;
  }
  return { positive, negative, zero, min, max, flipped };
}
