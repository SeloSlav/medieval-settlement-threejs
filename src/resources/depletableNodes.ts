import type { ResourceNodeKind, ResourceNodeState } from './types.ts';

export function findNearestResourceNodeWithRemaining(
  nodes: Iterable<ResourceNodeState>,
  x: number,
  z: number,
  radius: number,
  nodeKind?: ResourceNodeKind,
): ResourceNodeState | null {
  let best: ResourceNodeState | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    if (node.remaining <= 0) continue;
    if (nodeKind && node.kind !== nodeKind) continue;
    const distance = Math.hypot(x - node.x, z - node.z);
    if (distance > radius || distance >= bestDistance) continue;
    bestDistance = distance;
    best = node;
  }

  return best;
}
