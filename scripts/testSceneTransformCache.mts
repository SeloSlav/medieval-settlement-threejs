import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installSceneTransformCache } from '../src/scene/SceneTransformCache.ts';
import { VisibleUpdateGroup } from '../src/scene/VisibleUpdateGroup.ts';

const roots = [new THREE.Scene(), new THREE.Scene()];
const nodes = roots.map(root => {
  const result: THREE.Object3D[] = [root];
  for (let i = 1; i < 1000; i++) {
    const node = new THREE.Group(); node.name = String(i);
    node.position.set(Math.sin(i), i % 7, Math.cos(i));
    node.rotation.set(i * .01, i * .02, i * .03);
    result[Math.floor((i - 1) / 5)]!.add(node); result.push(node);
  }
  return result;
});
installSceneTransformCache(roots[0]!);
for (let frame = 0; frame < 240; frame++) {
  for (const list of nodes) {
    for (let k = 0; k < 8; k++) list[200 + k * 71]!.rotation.y = Math.sin(frame * .03 + k);
    list[50]!.visible = frame % 3 !== 0;
    list[11]!.scale.set(1 + frame * .001, 1, .9);
    if (frame === 40) list[3]!.add(list[57]!);
    if (frame === 80) { list[82]!.matrixAutoUpdate = false; list[82]!.matrix.makeTranslation(7, 8, 9); }
    if (frame === 120) list[82]!.matrixAutoUpdate = true;
    if (frame === 150) { list[13]!.matrixWorldAutoUpdate = false; list[13]!.matrixWorld.makeTranslation(3, 7, 4); }
    if (frame >= 150) list[13]!.matrixWorld.elements[12] = frame * .04;
    if (frame === 190) list[13]!.matrixWorldAutoUpdate = true;
    if (frame % 7 === 0) list[2]!.updateWorldMatrix(true, true);
  }
  roots.forEach(root => root.updateMatrixWorld(frame % 23 === 0));
  for (let i = 0; i < nodes[0]!.length; i++) {
    const a = nodes[0]![i]!, b = nodes[1]![i]!;
    for (let j = 0; j < 16; j++) assert.ok(Math.abs(a.matrixWorld.elements[j]! - b.matrixWorld.elements[j]!) < 1e-10, `${frame}/${i}/${j}`);
  }
}
const dormant = new VisibleUpdateGroup(), child = new THREE.Object3D();
dormant.add(child); roots[0]!.add(dormant); dormant.visible = false;
child.position.set(3, 9, 7); roots[0]!.updateMatrixWorld();
dormant.position.x = 15; dormant.visible = true; roots[0]!.updateMatrixWorld();
assert.equal(child.matrixWorld.elements[12], 18);
console.log('Scene transform parity: 1,000 nodes, 240 frames, live reparenting, manual transforms, hidden descendants and explicit updates.');
