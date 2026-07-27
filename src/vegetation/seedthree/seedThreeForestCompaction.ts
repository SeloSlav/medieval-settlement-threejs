import * as THREE from 'three';

export type SeedThreeTreeSlot = {
  layoutIndex: number;
  matrix: THREE.Matrix4;
  pos: THREE.Vector3;
  visibilityCenter: THREE.Vector3;
  visibilityRadius: number;
  enabled: boolean;
};

export type SeedThreeInstancedLodSet = {
  branches: THREE.InstancedMesh | null;
  cards: Array<THREE.InstancedMesh & { userData: Record<string, unknown> }>;
};

/**
 * Compact selected tree slots into the live prefix of each InstancedMesh.
 * Disabled gameplay slots are omitted rather than written as zero-scale
 * matrices, so harvested/cleared trees do not consume vertex work.
 */
export function writeSeedThreeLodMatrices(
  lodSet: SeedThreeInstancedLodSet,
  slots: SeedThreeTreeSlot[],
  selectedSlotIndices: readonly number[],
): void {
  if (lodSet.branches) {
    const windVec = lodSet.branches.geometry.attributes.aWindVec as THREE.InstancedBufferAttribute;
    const anchorPos = lodSet.branches.geometry.attributes.aAnchorPos as THREE.InstancedBufferAttribute;
    let writeIndex = 0;
    for (const slotIndex of selectedSlotIndices) {
      const slot = slots[slotIndex];
      if (!slot?.enabled) continue;
      lodSet.branches.setMatrixAt(writeIndex, slot.matrix);
      windVec.setXYZ(writeIndex, 0, 1, 0);
      anchorPos.setXYZ(writeIndex, slot.pos.x, slot.pos.y, slot.pos.z);
      writeIndex++;
    }
    lodSet.branches.count = writeIndex;
    lodSet.branches.instanceMatrix.needsUpdate = true;
    windVec.needsUpdate = true;
    anchorPos.needsUpdate = true;
  }

  const slotMatrix = new THREE.Matrix4();
  const cardMatrix = new THREE.Matrix4();
  const outMatrix = new THREE.Matrix4();
  for (const im of lodSet.cards) {
    const cardsPerTree = im.userData.k as number;
    const srcMatrices = im.userData.srcMatrices as Float32Array;
    const weights = im.userData.weights as Float32Array | null;
    const treeOrigin = im.geometry.attributes.aTreeOrigin as THREE.InstancedBufferAttribute;
    const windVec = im.geometry.attributes.aWindVec as THREE.InstancedBufferAttribute;
    const anchorPos = im.geometry.attributes.aAnchorPos as THREE.InstancedBufferAttribute;
    let writeIndex = 0;
    for (const slotIndex of selectedSlotIndices) {
      const slot = slots[slotIndex];
      if (!slot?.enabled) continue;
      slotMatrix.copy(slot.matrix);
      for (let cardIndex = 0; cardIndex < cardsPerTree; cardIndex++) {
        cardMatrix.fromArray(srcMatrices, cardIndex * 16);
        outMatrix.multiplyMatrices(slotMatrix, cardMatrix);
        im.setMatrixAt(writeIndex, outMatrix);
        treeOrigin.setXYZ(writeIndex, slot.pos.x, slot.pos.y, slot.pos.z);
        const weight = weights?.[cardIndex] ?? 0.5;
        windVec.setXYZ(writeIndex, 0, weight, 0);
        anchorPos.setXYZ(writeIndex, slot.pos.x, slot.pos.y, slot.pos.z);
        writeIndex++;
      }
    }
    im.count = writeIndex;
    im.instanceMatrix.needsUpdate = true;
    treeOrigin.needsUpdate = true;
    windVec.needsUpdate = true;
    anchorPos.needsUpdate = true;
  }
}
