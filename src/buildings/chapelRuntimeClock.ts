import * as THREE from 'three';
import type { GameClock } from '../world/gameCalendar.ts';
import { sharedBuildingMaterial } from './buildingMaterials.ts';

export const CHAPEL_TOWER_CLOCK_NAME = 'ChapelTowerClock';
export const CHAPEL_TOWER_CLOCK_ANCHOR_NAME = 'TC_Clock_Anchor';
export const CHAPEL_TOWER_CLOCK_HOUR_HAND_NAME = 'ChapelTowerClockHourHand';
export const CHAPEL_TOWER_CLOCK_MINUTE_HAND_NAME = 'ChapelTowerClockMinuteHand';
const clockHands = new WeakMap<THREE.Object3D, { hour?: THREE.Object3D; minute?: THREE.Object3D }>();

/** Adds only the runtime-owned face and hands; the authored GLB exports an empty anchor. */
export function addTierOneChurchRuntimeClock(church: THREE.Group): void {
  clockHands.delete(church);
  const anchor = church.getObjectByName(CHAPEL_TOWER_CLOCK_ANCHOR_NAME);
  if (!anchor || anchor.getObjectByName(CHAPEL_TOWER_CLOCK_NAME)) return;

  const faceMaterial = sharedBuildingMaterial('masonryLight');
  const ironMaterial = sharedBuildingMaterial('metalIron');
  const clock = new THREE.Group();
  clock.name = CHAPEL_TOWER_CLOCK_NAME;
  clock.userData.chapelTowerClock = true;
  clock.userData.fpNoCollision = true;

  const face = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32), faceMaterial);
  face.name = 'ChapelTowerClockFace';
  face.position.z = 0.012;
  clock.add(face);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 32), ironMaterial);
  rim.name = 'ChapelTowerClockRim';
  rim.position.z = 0.035;
  clock.add(rim);

  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    const cardinal = index % 3 === 0;
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(cardinal ? 0.045 : 0.026, cardinal ? 0.105 : 0.072, 0.025),
      ironMaterial,
    );
    mark.name = `ChapelTowerClockMark${index}`;
    mark.position.set(Math.sin(angle) * 0.38, Math.cos(angle) * 0.38, 0.052);
    mark.rotation.z = -angle;
    clock.add(mark);
  }

  clock.add(createClockHand(CHAPEL_TOWER_CLOCK_HOUR_HAND_NAME, 0.255, 0.063, ironMaterial));
  clock.add(createClockHand(CHAPEL_TOWER_CLOCK_MINUTE_HAND_NAME, 0.355, 0.042, ironMaterial));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.045, 12), ironMaterial);
  hub.name = 'ChapelTowerClockHub';
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.085;
  clock.add(hub);

  clock.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.fpNoCollision = true;
  });
  anchor.add(clock);
}

export function churchClockHandAngles(
  clock: Pick<GameClock, 'hour' | 'minute' | 'preciseHour'>,
): { hour: number; minute: number } {
  const preciseHour = clock.preciseHour ?? clock.hour + clock.minute / 60;
  const normalizedDayHour = ((preciseHour % 24) + 24) % 24;
  return {
    hour: -(normalizedDayHour % 12) / 12 * Math.PI * 2,
    minute: -(normalizedDayHour % 1) * Math.PI * 2,
  };
}

/** Keeps every placed Tier 1 parish clock aligned with the simulation clock. */
export function setTierOneChurchClockTime(
  root: THREE.Object3D,
  clock: Pick<GameClock, 'hour' | 'minute' | 'preciseHour'>,
): void {
  const angles = churchClockHandAngles(clock);
  let hands = clockHands.get(root);
  if (!hands) {
    hands = { hour: root.getObjectByName(CHAPEL_TOWER_CLOCK_HOUR_HAND_NAME), minute: root.getObjectByName(CHAPEL_TOWER_CLOCK_MINUTE_HAND_NAME) };
    clockHands.set(root, hands);
  }
  const hourHand = hands.hour;
  const minuteHand = hands.minute;
  if (hourHand) hourHand.rotation.z = angles.hour;
  if (minuteHand) minuteHand.rotation.z = angles.minute;
}

function createClockHand(
  name: string,
  length: number,
  width: number,
  material: THREE.Material,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.userData.chapelClockHand = true;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(width, length, 0.035), material);
  hand.name = `${name}Blade`;
  hand.position.set(0, length * 0.41, 0.073);
  pivot.add(hand);
  return pivot;
}
