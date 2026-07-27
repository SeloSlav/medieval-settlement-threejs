import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  createFireEffect,
  setFireEffectNightLighting,
  updateFireEffect,
} from '../../fires/FireEffect.ts';
import { markBuildingDetailShadowCaster } from '../buildingShadowProxy.ts';

export const FOUNDERS_CAMPFIRE_NAME = 'FoundingCampfire';
const FOUNDERS_CAMPFIRE_EMBERS_NAME = 'FoundingCampfireEmbers';
const TENT_HALF_WIDTH = 1.62;
const TENT_HALF_DEPTH = 1.92;
const TENT_EAVE_Y = 0.2;
const TENT_RIDGE_Y = 2.32;

function addAFrameShelter(
  parent: THREE.Group,
  x: number,
  z: number,
  yaw: number,
): void {
  const shelter = new THREE.Group();
  shelter.name = 'Founding canvas tent';
  shelter.position.set(x, 0, z);
  shelter.rotation.y = yaw;
  shelter.userData.fpCollisionAggregate = true;

  for (const side of [-1, 1] as const) {
    const panel = addMesh(
      shelter,
      createTentSideGeometry(side),
      sharedBuildingDetailMaterial('canvas'),
      new THREE.Vector3(),
    );
    panel.name = 'Weathered tent side';
  }

  const back = addMesh(
    shelter,
    createTentTriangleGeometry(
      -TENT_HALF_WIDTH,
      TENT_HALF_WIDTH,
      TENT_HALF_DEPTH,
    ),
    sharedBuildingDetailMaterial('canvas'),
    new THREE.Vector3(),
  );
  back.name = 'Tent rear canvas';

  const interior = addMesh(
    shelter,
    createTentTriangleGeometry(
      -TENT_HALF_WIDTH + 0.07,
      TENT_HALF_WIDTH - 0.07,
      -TENT_HALF_DEPTH + 0.035,
    ),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(),
  );
  interior.name = 'Open tent interior';
  interior.userData.fpNoCollision = true;

  for (const side of [-1, 1] as const) {
    const front = addMesh(
      shelter,
      createTentFrontPanelGeometry(side),
      sharedBuildingDetailMaterial('canvas'),
      new THREE.Vector3(),
    );
    front.name = side < 0 ? 'Left tied tent flap' : 'Right tied tent flap';
  }

  for (const zEnd of [-TENT_HALF_DEPTH, TENT_HALF_DEPTH]) {
    addPoleBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.08, zEnd),
      new THREE.Vector3(-TENT_HALF_WIDTH - 0.08, 0.04, zEnd),
      0.065,
    );
    addPoleBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.08, zEnd),
      new THREE.Vector3(TENT_HALF_WIDTH + 0.08, 0.04, zEnd),
      0.065,
    );
  }
  addPoleBetween(
    shelter,
    new THREE.Vector3(0, TENT_RIDGE_Y + 0.1, -TENT_HALF_DEPTH - 0.18),
    new THREE.Vector3(0, TENT_RIDGE_Y + 0.1, TENT_HALF_DEPTH + 0.18),
    0.07,
  );

  for (const zEnd of [-TENT_HALF_DEPTH, TENT_HALF_DEPTH]) {
    const outwardZ = zEnd + Math.sign(zEnd) * 1.32;
    addRopeBetween(
      shelter,
      new THREE.Vector3(0, TENT_RIDGE_Y + 0.04, zEnd),
      new THREE.Vector3(0, 0.08, outwardZ),
    );
    addTentStake(shelter, 0, outwardZ);
  }
  for (const side of [-1, 1]) {
    for (const zEnd of [-TENT_HALF_DEPTH * 0.86, TENT_HALF_DEPTH * 0.86]) {
      const stakeX = side * (TENT_HALF_WIDTH + 0.68);
      const stakeZ = zEnd + Math.sign(zEnd) * 0.44;
      addRopeBetween(
        shelter,
        new THREE.Vector3(side * TENT_HALF_WIDTH, TENT_EAVE_Y + 0.06, zEnd),
        new THREE.Vector3(stakeX, 0.08, stakeZ),
      );
      addTentStake(shelter, stakeX, stakeZ);
    }
  }

  const bedroll = addMesh(
    shelter,
    new THREE.CylinderGeometry(0.22, 0.22, 1.5, 12),
    sharedBuildingDetailMaterial('paintRed'),
    new THREE.Vector3(-0.62, 0.24, -0.82),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  bedroll.name = 'Rolled wool blanket';
  bedroll.userData.fpNoCollision = true;

  parent.add(shelter);
}

function createTentSideGeometry(side: -1 | 1): THREE.BufferGeometry {
  const acrossSegments = 4;
  const lengthSegments = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
    const v = lengthIndex / lengthSegments;
    const z = THREE.MathUtils.lerp(-TENT_HALF_DEPTH, TENT_HALF_DEPTH, v);
    const endTension = Math.sin(v * Math.PI);
    for (let acrossIndex = 0; acrossIndex <= acrossSegments; acrossIndex += 1) {
      const u = acrossIndex / acrossSegments;
      const x = side * TENT_HALF_WIDTH * (1 - u);
      const sag = Math.sin(u * Math.PI) * endTension * 0.065;
      const y = THREE.MathUtils.lerp(TENT_EAVE_Y, TENT_RIDGE_Y, u) - sag;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const row = acrossSegments + 1;
  for (let v = 0; v < lengthSegments; v += 1) {
    for (let u = 0; u < acrossSegments; u += 1) {
      const a = v * row + u;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }
  return createTentGeometry(positions, indices, uvs);
}

function createTentTriangleGeometry(
  minX: number,
  maxX: number,
  z: number,
): THREE.BufferGeometry {
  const positions = [
    minX, TENT_EAVE_Y, z,
    maxX, TENT_EAVE_Y, z,
    0, TENT_RIDGE_Y, z,
  ];
  return createTentGeometry(
    positions,
    z > 0 ? [0, 1, 2] : [0, 2, 1],
    [0, 0, 1, 0, 0.5, 1],
  );
}

function createTentFrontPanelGeometry(side: -1 | 1): THREE.BufferGeometry {
  const outerX = side * TENT_HALF_WIDTH;
  const doorX = side * 0.48;
  const z = -TENT_HALF_DEPTH - 0.015;
  const positions = [
    outerX, TENT_EAVE_Y, z,
    doorX, TENT_EAVE_Y, z,
    side * 0.13, TENT_RIDGE_Y - 0.08, z,
  ];
  return createTentGeometry(
    positions,
    side > 0 ? [0, 2, 1] : [0, 1, 2],
    [0, 0, 1, 0, 0.55, 1],
  );
}

function createTentGeometry(
  positions: number[],
  indices: number[],
  uvs: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addPoleBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
): THREE.Mesh {
  const pole = addCylinderBetween(
    parent,
    from,
    to,
    radius,
    timberMaterial('dark'),
    7,
  );
  pole.name = 'Tent frame pole';
  return pole;
}

function addRopeBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const rope = addCylinderBetween(
    parent,
    from,
    to,
    0.018,
    timberMaterial('weathered'),
    5,
  );
  rope.name = 'Taut tent guy rope';
  rope.userData.fpNoCollision = true;
}

function addCylinderBetween(
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments: number,
): THREE.Mesh {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius * 1.08, length, radialSegments),
    material,
    from.clone().add(to).multiplyScalar(0.5),
  );
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

function addTentStake(parent: THREE.Group, x: number, z: number): void {
  const stake = addMesh(
    parent,
    new THREE.CylinderGeometry(0.035, 0.055, 0.42, 6),
    timberMaterial('weathered'),
    new THREE.Vector3(x, 0.12, z),
    new THREE.Euler(0.17, 0, -0.12),
  );
  stake.name = 'Tent stake';
  stake.userData.fpNoCollision = true;
}

function addTimberStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingTimberStockpile';
  for (let segmentIndex = 0; segmentIndex < FOUNDING_TIMBER_VISUAL_SEGMENTS; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'FoundingTimberSegment';
    const row = Math.floor(segmentIndex / 4);
    const column = segmentIndex % 4;
    segment.position.set(-5.7 + column * 0.62, 0, -2.55 + row * 0.48);
    for (let log = 0; log < 3; log += 1) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.13, 0.16, 2.55, 7),
        timberMaterial(log === 1 ? 'light' : 'mid'),
        new THREE.Vector3(0, 0.18 + log * 0.26, 0),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    stockpile.add(segment);
  }
  parent.add(stockpile);
}

function addStoneStock(parent: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'FoundingStoneStockpile';
  for (let index = 0; index < FOUNDING_STONE_VISUAL_SEGMENTS; index += 1) {
    const stone = addMesh(
      stockpile,
      new THREE.DodecahedronGeometry(0.42 + (index % 3) * 0.08, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        3.8 + (index % 4) * 0.62,
        0.34 + Math.floor(index / 4) * 0.42,
        -2.8,
      ),
      new THREE.Euler(index * 0.23, index * 0.41, index * 0.17),
    );
    stone.name = 'FoundingStoneSegment';
  }
  parent.add(stockpile);
}

function addTreasuryChest(parent: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'FoundingTreasuryChest';
  addMesh(
    chest,
    new THREE.BoxGeometry(1.25, 0.68, 0.75),
    timberMaterial('dark'),
    new THREE.Vector3(5.1, 0.4, 2.8),
  );
  addMesh(
    chest,
    new THREE.CylinderGeometry(0.38, 0.38, 1.25, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(5.1, 0.78, 2.8),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.12, 0.72, 0.8),
    metalMaterial('iron'),
    new THREE.Vector3(5.1, 0.53, 2.8),
  );
  parent.add(chest);
}

function addCampfire(parent: THREE.Group): THREE.Group {
  const fire = createFireEffect({
    name: FOUNDERS_CAMPFIRE_NAME,
    scale: 0.74,
    intensity: 0.82,
    nightLighting: 1,
    spread: 0.58,
    flameCount: 5,
    smokeCount: 7,
    smokeRise: 3.5,
    smokeDrift: 0.62,
    smokeOpacity: 0.27,
    lightDistance: 13,
    lightIntensity: 12,
  });
  const campfire = fire.root;
  campfire.position.set(0.55, 0, -0.6);

  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    const stone = addMesh(
      campfire,
      new THREE.DodecahedronGeometry(0.22 + (index % 2) * 0.04, 0),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(Math.cos(angle) * 0.82, 0.2, Math.sin(angle) * 0.82),
      new THREE.Euler(index * 0.13, angle, index * 0.19),
    );
    stone.name = 'Founding campfire hearth stone';
  }

  const embers = addMesh(
    campfire,
    new THREE.CylinderGeometry(0.58, 0.67, 0.1, 12),
    sharedBuildingDetailMaterial('paintRed'),
    new THREE.Vector3(0, 0.14, 0),
  );
  embers.name = FOUNDERS_CAMPFIRE_EMBERS_NAME;

  for (const [index, yaw] of [Math.PI * 0.25, -Math.PI * 0.25].entries()) {
    const log = addMesh(
      campfire,
      new THREE.CylinderGeometry(0.12, 0.15, 1.55, 7),
      timberMaterial(index === 0 ? 'dark' : 'weathered'),
      new THREE.Vector3(0, 0.28 + index * 0.05, 0),
      new THREE.Euler(Math.PI * 0.5, yaw, 0),
    );
    log.name = 'Founding campfire crossed log';
  }

  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2 + 0.35;
    addPoleBetween(
      campfire,
      new THREE.Vector3(Math.cos(angle) * 0.66, 0.08, Math.sin(angle) * 0.66),
      new THREE.Vector3(Math.cos(angle + Math.PI) * 0.08, 1.65, Math.sin(angle + Math.PI) * 0.08),
      0.035,
    ).name = 'Campfire cooking tripod';
  }

  const pot = addMesh(
    campfire,
    new THREE.CylinderGeometry(0.28, 0.36, 0.34, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0.84, 0),
  );
  pot.name = 'Hanging camp cookpot';
  const potHandle = addMesh(
    campfire,
    new THREE.TorusGeometry(0.3, 0.025, 5, 12, Math.PI),
    metalMaterial('iron'),
    new THREE.Vector3(0, 1.03, 0),
    new THREE.Euler(0, 0, Math.PI),
  );
  potHandle.name = 'Camp cookpot handle';
  addRopeBetween(
    campfire,
    new THREE.Vector3(0, 1.58, 0),
    new THREE.Vector3(0, 1.18, 0),
  );

  parent.add(campfire);
  return campfire;
}

export function setFoundersCampfireNightLighting(
  campfire: THREE.Group,
  nightLighting: number,
): void {
  setFireEffectNightLighting(campfire, nightLighting);
}

export function animateFoundersCampfire(
  campfire: THREE.Group,
  dtSeconds: number,
): void {
  updateFireEffect(campfire, dtSeconds, 0.82);
}

export function createFoundersCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Founders' camp and open stockyard";
  group.userData.fpCollisionChildrenOnly = true;

  const shelters = new THREE.Group();
  shelters.name = 'FoundingShelters';
  addAFrameShelter(shelters, -3.7, 2.7, 0.3);
  addAFrameShelter(shelters, -0.1, 4.15, 0);
  addAFrameShelter(shelters, 3.7, 2.7, -0.3);
  group.add(shelters);

  addCampfire(shelters);
  const benchSeat = addMesh(
    shelters,
    new THREE.BoxGeometry(2.4, 0.18, 0.42),
    timberMaterial('weathered'),
    new THREE.Vector3(-1.9, 0.52, -0.15),
  );
  benchSeat.name = 'Camp bench seat';
  for (const x of [-2.72, -1.08]) {
    const leg = addMesh(
      shelters,
      new THREE.BoxGeometry(0.18, 0.48, 0.34),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.25, -0.15),
    );
    leg.name = 'Camp bench leg';
  }

  addTimberStock(group);
  addStoneStock(group);
  addTreasuryChest(group);
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      mesh.isMesh
      && !mesh.name.startsWith('Animated fire')
    ) {
      markBuildingDetailShadowCaster(mesh);
    }
  });
  return group;
}
