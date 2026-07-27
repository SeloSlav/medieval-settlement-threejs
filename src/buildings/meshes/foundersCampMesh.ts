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

export const FOUNDERS_CAMPFIRE_NAME = 'FoundingCampfire';
const FOUNDERS_CAMPFIRE_FLAMES_NAME = 'FoundingCampfireFlames';
const FOUNDERS_CAMPFIRE_SMOKE_NAME = 'FoundingCampfireSmoke';
const FOUNDERS_CAMPFIRE_SPARKS_NAME = 'FoundingCampfireSparks';
const FOUNDERS_CAMPFIRE_EMBERS_NAME = 'FoundingCampfireEmbers';
const FOUNDERS_CAMPFIRE_LIGHT_NAME = 'FoundingCampfireLight';

function addAFrameShelter(
  parent: THREE.Group,
  x: number,
  z: number,
  yaw: number,
): void {
  const shelter = new THREE.Group();
  shelter.position.set(x, 0, z);
  shelter.rotation.y = yaw;
  for (const side of [-1, 1]) {
    addMesh(
      shelter,
      new THREE.BoxGeometry(2.75, 0.1, 3.5),
      sharedBuildingMaterial('plasterGrey'),
      new THREE.Vector3(side * 0.82, 1.28, 0),
      new THREE.Euler(0, 0, side * -0.61),
    );
  }
  for (const zEnd of [-1.58, 1.58]) {
    for (const side of [-1, 1]) {
      addMesh(
        shelter,
        new THREE.CylinderGeometry(0.065, 0.085, 2.75, 6),
        timberMaterial('dark'),
        new THREE.Vector3(side * 0.74, 1.25, zEnd),
        new THREE.Euler(0, 0, side * -0.61),
      );
    }
  }
  addMesh(
    shelter,
    new THREE.CylinderGeometry(0.07, 0.08, 3.72, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 2.24, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  parent.add(shelter);
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
  const campfire = new THREE.Group();
  campfire.name = FOUNDERS_CAMPFIRE_NAME;
  campfire.position.set(0.55, 0, -0.6);
  campfire.userData.elapsedSeconds = 0;
  campfire.userData.nightLighting = 1;

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

  const flames = new THREE.Group();
  flames.name = FOUNDERS_CAMPFIRE_FLAMES_NAME;
  const flameSpecs = [
    { x: 0, z: 0, radius: 0.34, height: 1.18, phase: 0 },
    { x: -0.26, z: 0.09, radius: 0.23, height: 0.84, phase: 1.7 },
    { x: 0.25, z: 0.14, radius: 0.21, height: 0.78, phase: 3.1 },
    { x: 0.1, z: -0.23, radius: 0.18, height: 0.68, phase: 4.6 },
  ];
  for (const [index, spec] of flameSpecs.entries()) {
    const flame = addMesh(
      flames,
      new THREE.ConeGeometry(spec.radius, spec.height, 7),
      sharedBuildingDetailMaterial(index === 0 ? 'paintOchre' : 'paintRed'),
      new THREE.Vector3(spec.x, 0.38 + spec.height * 0.5, spec.z),
    );
    flame.name = 'Animated founding campfire flame';
    flame.renderOrder = 18;
    flame.userData.baseScale = flame.scale.clone();
    flame.userData.flickerPhase = spec.phase;
  }
  campfire.add(flames);

  const smoke = new THREE.Group();
  smoke.name = FOUNDERS_CAMPFIRE_SMOKE_NAME;
  for (let index = 0; index < 5; index += 1) {
    const puff = addMesh(
      smoke,
      new THREE.SphereGeometry(0.2, 7, 5),
      sharedBuildingDetailMaterial('smoke'),
      new THREE.Vector3(0, 0.9 + index * 0.35, 0),
    );
    puff.name = 'Animated founding campfire smoke';
    puff.renderOrder = 17;
  }
  campfire.add(smoke);

  const sparks = new THREE.Group();
  sparks.name = FOUNDERS_CAMPFIRE_SPARKS_NAME;
  for (let index = 0; index < 6; index += 1) {
    const spark = addMesh(
      sparks,
      new THREE.DodecahedronGeometry(0.035, 0),
      sharedBuildingDetailMaterial('brass'),
      new THREE.Vector3(0, 0.6, 0),
    );
    spark.name = 'Animated founding campfire spark';
  }
  campfire.add(sparks);

  const light = new THREE.PointLight(0xff7a32, 10, 12, 1.7);
  light.name = FOUNDERS_CAMPFIRE_LIGHT_NAME;
  light.position.y = 0.9;
  campfire.add(light);

  parent.add(campfire);
  return campfire;
}

export function setFoundersCampfireNightLighting(
  campfire: THREE.Group,
  nightLighting: number,
): void {
  campfire.userData.nightLighting = THREE.MathUtils.clamp(nightLighting, 0, 1);
}

export function animateFoundersCampfire(
  campfire: THREE.Group,
  dtSeconds: number,
): void {
  const elapsed = (Number(campfire.userData.elapsedSeconds) || 0)
    + Math.max(0, dtSeconds);
  campfire.userData.elapsedSeconds = elapsed;
  const nightLighting = THREE.MathUtils.clamp(
    Number(campfire.userData.nightLighting) || 0,
    0,
    1,
  );

  const flames = campfire.getObjectByName(FOUNDERS_CAMPFIRE_FLAMES_NAME);
  if (flames instanceof THREE.Group) {
    for (const [index, child] of flames.children.entries()) {
      if (!(child instanceof THREE.Mesh)) continue;
      const phase = Number(child.userData.flickerPhase) || index;
      const baseScale = child.userData.baseScale instanceof THREE.Vector3
        ? child.userData.baseScale
        : new THREE.Vector3(1, 1, 1);
      const flicker = 0.88
        + Math.sin(elapsed * (8.4 + index * 0.65) + phase) * 0.13
        + Math.sin(elapsed * 14.7 + phase * 1.9) * 0.045;
      child.scale.set(
        baseScale.x * (1.03 + (1 - flicker) * 0.38),
        baseScale.y * flicker,
        baseScale.z * (1.03 + (1 - flicker) * 0.38),
      );
      child.rotation.y = Math.sin(elapsed * 2.2 + phase) * 0.16;
    }
  }

  const smoke = campfire.getObjectByName(FOUNDERS_CAMPFIRE_SMOKE_NAME);
  if (smoke instanceof THREE.Group) {
    for (const [index, child] of smoke.children.entries()) {
      const age = (elapsed * 0.13 + index / Math.max(1, smoke.children.length)) % 1;
      child.position.set(
        Math.sin(age * 4.8 + index * 1.7) * (0.08 + age * 0.38) + age * 0.22,
        0.82 + age * 2.15,
        Math.cos(age * 4.1 + index * 2.1) * (0.06 + age * 0.24),
      );
      child.scale.setScalar(0.55 + age * 1.35);
    }
  }

  const sparks = campfire.getObjectByName(FOUNDERS_CAMPFIRE_SPARKS_NAME);
  if (sparks instanceof THREE.Group) {
    for (const [index, child] of sparks.children.entries()) {
      const age = (elapsed * 0.42 + index / Math.max(1, sparks.children.length)) % 1;
      const angle = index * 2.17 + elapsed * 0.8;
      child.visible = age < 0.78;
      child.position.set(
        Math.cos(angle) * (0.08 + age * 0.38),
        0.5 + age * 1.45,
        Math.sin(angle) * (0.08 + age * 0.3),
      );
    }
  }

  const embers = campfire.getObjectByName(FOUNDERS_CAMPFIRE_EMBERS_NAME);
  if (embers instanceof THREE.Mesh) {
    const pulse = 0.96 + Math.sin(elapsed * 5.7) * 0.045;
    embers.scale.set(pulse, 1, pulse);
  }

  const light = campfire.getObjectByName(FOUNDERS_CAMPFIRE_LIGHT_NAME);
  if (light instanceof THREE.PointLight) {
    const baseIntensity = 1.8 + nightLighting * 9.2;
    light.intensity = Math.max(
      0,
      baseIntensity + Math.sin(elapsed * 10.9) * (0.22 + nightLighting * 0.9),
    );
  }
}

export function createFoundersCampMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Founders' camp and open stockyard";

  const shelters = new THREE.Group();
  shelters.name = 'FoundingShelters';
  addAFrameShelter(shelters, -2.9, 2.8, 0.16);
  addAFrameShelter(shelters, 0.5, 3.25, -0.08);
  addAFrameShelter(shelters, 3.7, 2.65, -0.2);
  group.add(shelters);

  addCampfire(shelters);
  addMesh(
    shelters,
    new THREE.BoxGeometry(2.4, 0.18, 0.42),
    timberMaterial('weathered'),
    new THREE.Vector3(-1.9, 0.52, -0.15),
  );

  addTimberStock(group);
  addStoneStock(group);
  addTreasuryChest(group);
  return group;
}
