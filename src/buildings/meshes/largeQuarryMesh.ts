import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  quarryRockMaterial,
  sharedBuildingMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addDarkOpening, addGableShell, addPlankDoor } from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A broad, stepped rich-stone face. Keeping the dominant mass low and
 * horizontal makes the quarry read as an open cut even when its terrain decal
 * or rich-deposit marker is occluded by the camera.
 */
function addSteppedStoneCut(group: THREE.Group): void {
  const cut = new THREE.Group();
  cut.name = 'Rich stone quarry stepped cut';

  const rearBenches = [
    { width: 17.2, height: 0.72, depth: 2.55, y: 0.36, z: -6.75, material: 'dark' as const },
    { width: 14.8, height: 0.82, depth: 1.95, y: 1.03, z: -7.52, material: 'mid' as const },
    { width: 11.6, height: 0.92, depth: 1.42, y: 1.79, z: -8.14, material: 'light' as const },
  ];
  for (const [index, bench] of rearBenches.entries()) {
    const mesh = addMesh(
      cut,
      new THREE.BoxGeometry(bench.width, bench.height, bench.depth),
      quarryRockMaterial(bench.material),
      new THREE.Vector3(0.15 - index * 0.18, bench.y, bench.z),
      new THREE.Euler(0, index % 2 === 0 ? 0.025 : -0.018, 0),
    );
    mesh.name = `Rich stone rear bench ${index + 1}`;
  }

  for (const side of [-1, 1] as const) {
    const lower = addMesh(
      cut,
      new THREE.BoxGeometry(3.05, 0.72, 7.1),
      quarryRockMaterial(side < 0 ? 'dark' : 'mid'),
      new THREE.Vector3(side * 7.15, 0.36, -3.45),
      new THREE.Euler(0, side * -0.055, 0),
    );
    lower.name = 'Rich stone side return';
    const upper = addMesh(
      cut,
      new THREE.BoxGeometry(1.9, 0.78, 4.9),
      quarryRockMaterial(side < 0 ? 'mid' : 'light'),
      new THREE.Vector3(side * 7.82, 1.1, -5.0),
      new THREE.Euler(0, side * -0.07, 0),
    );
    upper.name = 'Rich stone upper side return';
  }

  // Thin exposed bands break the large face into unmistakable sedimentary cuts.
  for (const [index, y] of [0.68, 1.34, 2.08].entries()) {
    addMesh(
      cut,
      new THREE.BoxGeometry(15.5 - index * 2.3, 0.11, 0.18),
      quarryRockMaterial(index % 2 === 0 ? 'cut' : 'dark'),
      new THREE.Vector3(0, y, -5.49 - index * 1.18),
    ).name = 'Quarry exposed stone course';
  }

  const faceRubble = [
    [-7.8, -7.8, 0.82], [-5.9, -6.0, 0.58], [-3.5, -5.55, 0.72],
    [4.5, -5.75, 0.64], [6.35, -6.7, 0.88], [8.0, -7.75, 0.68],
  ] as const;
  faceRubble.forEach(([x, z, scale], index) => {
    addMesh(
      cut,
      new THREE.DodecahedronGeometry(0.72, 0),
      quarryRockMaterial(index % 3 === 0 ? 'light' : index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(x, 0.3 + scale * 0.12, z),
      new THREE.Euler(index * 0.31, index * 0.47, index * 0.16),
      new THREE.Vector3(scale * 1.35, scale * 0.72, scale),
    ).name = 'Fresh quarry face rubble';
  });
  group.add(cut);
}

function addBeamBetween(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const beam = addMesh(
    group,
    new THREE.BoxGeometry(thickness, direction.length(), thickness),
    material,
    start.clone().add(end).multiplyScalar(0.5),
  );
  beam.quaternion.setFromUnitVectors(UP, direction.normalize());
  beam.name = name;
  return beam;
}

/** A single-mast lifting crane, deliberately unlike an underground headframe. */
function addStoneLiftingCrane(group: THREE.Group): void {
  const crane = new THREE.Group();
  crane.name = 'Quarry stone lifting crane';
  crane.position.set(3.4, 0, 0.8);
  crane.rotation.y = -0.16;
  const darkTimber = timberMaterial('dark');
  const weatheredTimber = timberMaterial('weathered');

  addBeamBetween(
    crane,
    new THREE.Vector3(0, 0.15, 0),
    new THREE.Vector3(0, 7.25, 0),
    0.48,
    darkTimber,
    'Quarry crane mast',
  );
  addBeamBetween(
    crane,
    new THREE.Vector3(0, 6.72, 0),
    new THREE.Vector3(-5.9, 5.3, -1.65),
    0.38,
    weatheredTimber,
    'Quarry crane lifting boom',
  );
  addBeamBetween(
    crane,
    new THREE.Vector3(0, 6.42, 0),
    new THREE.Vector3(3.55, 0.2, 0.55),
    0.22,
    darkTimber,
    'Quarry crane rear stay',
  );
  addBeamBetween(
    crane,
    new THREE.Vector3(0, 6.82, 0),
    new THREE.Vector3(-5.9, 5.48, -1.65),
    0.075,
    metalMaterial('iron'),
    'Quarry crane boom cable',
  );

  addMesh(
    crane,
    new THREE.TorusGeometry(0.34, 0.07, 7, 14),
    metalMaterial('iron'),
    new THREE.Vector3(-5.82, 5.18, -1.62),
    new THREE.Euler(0, Math.PI * 0.5, 0),
  ).name = 'Quarry crane pulley';
  addBeamBetween(
    crane,
    new THREE.Vector3(-5.82, 5.1, -1.62),
    new THREE.Vector3(-5.82, 1.0, -1.62),
    0.055,
    metalMaterial('iron'),
    'Quarry crane lifting rope',
  );
  addMesh(
    crane,
    new THREE.BoxGeometry(1.35, 0.72, 1.2),
    quarryRockMaterial('cut'),
    new THREE.Vector3(-5.82, 0.58, -1.62),
    new THREE.Euler(0, 0.08, -0.035),
  ).name = 'Suspended dressed stone block';

  for (const x of [-0.72, 0.72]) {
    addMesh(
      crane,
      new THREE.BoxGeometry(1.1, 0.58, 1.35),
      quarryRockMaterial(x < 0 ? 'dark' : 'mid'),
      new THREE.Vector3(2.8 + x, 0.29, 0.45),
    ).name = 'Quarry crane counterweight';
  }
  group.add(crane);
}

function addCuttersShelter(group: THREE.Group): void {
  const house = new THREE.Group();
  house.name = 'Quarry cutters shelter';
  house.position.set(7.2, 0, 4.15);
  house.rotation.y = -Math.PI * 0.5;
  const shell = addGableShell(house, {
    width: 5.4,
    depth: 4.5,
    stoneHeight: 1.05,
    wallHeight: 2.35,
    ridgeHeight: 1.75,
    wallMaterial: quarryRockMaterial('light'),
    roofMaterial: sharedBuildingMaterial('slate'),
    stoneGroundFloor: true,
  });
  addPlankDoor(house, -1.35, 1.03, shell.frontZ + 0.02, 0.95, 1.95);
  addDarkOpening(house, 1.18, 2.18, shell.frontZ + 0.04, 0.95, 0.82);
  group.add(house);
}

function addBenchWalkway(group: THREE.Group): void {
  const walkway = new THREE.Group();
  walkway.name = 'Quarry face access walkway';
  addMesh(
    walkway,
    new THREE.BoxGeometry(10.6, 0.25, 1.6),
    timberMaterial('weathered'),
    new THREE.Vector3(-0.9, 0.82, -4.15),
  );
  for (const x of [-5.7, -3.05, -0.4, 2.25, 4.9]) {
    addMesh(
      walkway,
      new THREE.BoxGeometry(0.28, 1.2, 0.28),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.43, -4.15),
    );
  }
  group.add(walkway);
}

function addLargeQuarryStoneStockpile(group: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'LargeQuarryStockpile';
  stockpile.visible = false;
  const stacks = [
    [-8.4, -3.6, 0],
    [-7.4, -1.8, Math.PI * 0.5],
    [7.6, -3.5, 0.08],
    [9.1, -1.8, Math.PI * 0.5],
  ] as const;
  for (const [x, z, yaw] of stacks) {
    const stack = new THREE.Group();
    stack.name = 'LargeQuarryStockSegment';
    stack.visible = false;
    stack.position.set(x, 0, z);
    stack.rotation.y = yaw;
    for (const [bx, by] of [[-0.65, 0.38], [0.65, 0.38], [0, 1.08]] as const) {
      addMesh(
        stack,
        new THREE.BoxGeometry(1.15, 0.72, 1.55),
        quarryRockMaterial(by > 1 ? 'light' : bx < 0 ? 'dark' : 'mid'),
        new THREE.Vector3(bx, by, 0),
      ).name = 'Dressed rich-stone block';
    }
    stockpile.add(stack);
  }
  group.add(stockpile);
}

function addFixedQuarrySpoil(group: THREE.Group): void {
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2 + 0.16;
    const radius = 10.4 + (index % 3) * 0.42;
    addMesh(
      group,
      new THREE.DodecahedronGeometry(0.6 + (index % 4) * 0.1, 0),
      quarryRockMaterial(index % 3 === 0 ? 'light' : index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(Math.sin(angle) * radius, 0.3, Math.cos(angle) * radius),
      new THREE.Euler(index * 0.19, index * 0.37, index * 0.11),
      new THREE.Vector3(1.2, 0.7, 0.95),
    ).name = 'Quarry spoil stone';
  }
}

function addLargeQuarrySupportStockpile(group: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'LargeQuarrySupportStockpile';
  stockpile.visible = false;
  stockpile.position.set(-8.8, 0, 3.5);
  stockpile.rotation.y = 0.12;

  for (let segmentIndex = 0; segmentIndex < 6; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'LargeQuarrySupportSegment';
    segment.visible = false;
    segment.position.set(
      (segmentIndex % 3) * 2.25,
      0,
      Math.floor(segmentIndex / 3) * 1.0,
    );
    for (let beamIndex = 0; beamIndex < 3; beamIndex += 1) {
      const beam = addMesh(
        segment,
        new THREE.BoxGeometry(1.95, 0.22, 0.28),
        timberMaterial(beamIndex === 1 ? 'dark' : 'weathered'),
        new THREE.Vector3(
          0,
          0.24 + beamIndex * 0.22,
          (beamIndex - 1) * 0.11,
        ),
        new THREE.Euler(0, (beamIndex - 1) * 0.03, 0),
      );
      beam.name = 'Prepared quarry support beam';
    }
    stockpile.add(segment);
  }
  group.add(stockpile);
}

/** Applies the simulation-facing identity shared by procedural and GLB variants. */
export function applyLargeQuarrySemanticContract(group: THREE.Group): void {
  group.name = 'Quarry';
  group.userData.semanticRole = 'rich-stone-quarry';
  group.userData.silhouette = 'broad-stepped-open-cut';
}

/** Adds only simulation-owned stores; the authored GLB stays a neutral fixed shell. */
export function addLargeQuarryRuntimeState(group: THREE.Group): void {
  addLargeQuarryStoneStockpile(group);
  addLargeQuarrySupportStockpile(group);
  group.add(createCivilianToolStockpile(new THREE.Vector3(7.8, 0, 6.1), -0.18));
}

/** Open, terraced extraction works for the underground source of rich stone. */
export function createLargeQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  applyLargeQuarrySemanticContract(group);
  addSteppedStoneCut(group);
  addStoneLiftingCrane(group);
  addCuttersShelter(group);
  addBenchWalkway(group);
  addFixedQuarrySpoil(group);
  addLargeQuarryRuntimeState(group);
  return group;
}
