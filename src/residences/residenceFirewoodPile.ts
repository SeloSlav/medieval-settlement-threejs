import * as THREE from 'three';
import { addLogPile } from '../buildings/logPile.ts';
import { RESIDENCE_FIREWOOD_CAPACITY } from '../generated/gameBalance.ts';

// Fill from a supported central triangle outwards, then upwards. Each visible
// piece represents stored fuel, not one literal inventory unit (capacity 60).
const LOG_FILL_ORDER = [1, 2, 5, 0, 3, 4, 6, 7, 8, 9] as const;
const LOG_HALF_LENGTH = 2.15 / 2;
const PILE_HALF_DEPTH = (3 * 0.19 * 1.72) / 2 + 0.19 * 1.05;
const GROUND_SAMPLES = [
  [0, 0],
  [-LOG_HALF_LENGTH, -PILE_HALF_DEPTH],
  [-LOG_HALF_LENGTH, PILE_HALF_DEPTH],
  [LOG_HALF_LENGTH, -PILE_HALF_DEPTH],
  [LOG_HALF_LENGTH, PILE_HALF_DEPTH],
] as const;

export function createResidenceFirewoodPile(x: number, z: number): THREE.Group {
  const pile = new THREE.Group();
  pile.name = 'FirewoodPile';
  pile.visible = false;
  pile.position.set(x, 0, z);
  pile.rotation.y = Math.PI / 2;
  addLogPile(pile, 0, 0, 0, 4, 2.15, 0.19);
  return pile;
}

/** Inventory changes the number of logs, never their physical size. */
export function syncFirewoodPile(
  marker: THREE.Group,
  firewoodStock: number,
  getHeightAt?: (x: number, z: number) => number,
): boolean {
  const pile = marker.getObjectByName('FirewoodPile');
  if (!(pile instanceof THREE.Group)) return false;

  const stocked = Number.isFinite(firewoodStock) && firewoodStock > 0;
  let changed = pile.visible !== stocked;
  pile.visible = stocked;
  if (!stocked) return changed;

  const fill = Math.min(1, firewoodStock / RESIDENCE_FIREWOOD_CAPACITY);
  const logCount = Math.max(3, Math.ceil(fill * LOG_FILL_ORDER.length));
  for (let rank = 0; rank < LOG_FILL_ORDER.length; rank += 1) {
    const log = pile.children[LOG_FILL_ORDER[rank]!];
    if (!log) continue;
    const visible = rank < logCount;
    changed = changed || log.visible !== visible;
    log.visible = visible;
  }

  if (getHeightAt && pile.parent) {
    // Side yards can sit outside the level foundation pad. Ground the whole
    // pile footprint in world space, including yaw and condition transforms.
    const previousY = pile.position.y;
    pile.position.y = 0;
    pile.updateWorldMatrix(true, false);
    const upY = pile.parent.matrixWorld.elements[5]!;
    const point = new THREE.Vector3();
    let localGroundY = -Infinity;
    for (const [x, z] of GROUND_SAMPLES) {
      point.set(x, 0, z).applyMatrix4(pile.matrixWorld);
      localGroundY = Math.max(
        localGroundY,
        (getHeightAt(point.x, point.z) + 0.02 - point.y) / upY,
      );
    }
    pile.position.y = localGroundY;
    changed = changed || Math.abs(previousY - localGroundY) > 1e-6;
  }
  return changed;
}
