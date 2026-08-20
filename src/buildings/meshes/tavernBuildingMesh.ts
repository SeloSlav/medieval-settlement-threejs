import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  shingleMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addBarrel,
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';

export type TavernFacade = 'front' | 'back' | 'left' | 'right';

export type TavernModulePlan = {
  kind: 'door' | 'window' | 'sign' | 'barrel-rack' | 'bench';
  facade: TavernFacade;
  bay: number;
};

export type TavernPlan = {
  footprint: { width: number; depth: number };
  exposedFacades: TavernFacade[];
  modules: TavernModulePlan[];
  materialSlots: ['stone', 'plaster', 'timber', 'shingle', 'iron'];
  diagnostics: { overlappingModules: number; hiddenFacadeModules: number };
};

/** Serializable planning pass: exposure and facade bays are settled before mesh emission. */
export function createTavernPlan(): TavernPlan {
  const exposedFacades: TavernFacade[] = ['front', 'back', 'left', 'right'];
  const modules: TavernModulePlan[] = [
    { kind: 'door', facade: 'front', bay: -1 },
    { kind: 'window', facade: 'front', bay: 1 },
    { kind: 'sign', facade: 'front', bay: 2 },
    { kind: 'window', facade: 'back', bay: -1 },
    { kind: 'window', facade: 'back', bay: 1 },
    { kind: 'barrel-rack', facade: 'right', bay: 1 },
    { kind: 'bench', facade: 'front', bay: 0 },
  ];
  const keys = new Set<string>();
  let overlappingModules = 0;
  let hiddenFacadeModules = 0;
  for (const module of modules) {
    if (!exposedFacades.includes(module.facade)) hiddenFacadeModules += 1;
    const key = `${module.facade}:${module.bay}:${module.kind}`;
    if (keys.has(key)) overlappingModules += 1;
    keys.add(key);
  }
  return {
    footprint: { width: 8.2, depth: 6.2 },
    exposedFacades,
    modules,
    materialSlots: ['stone', 'plaster', 'timber', 'shingle', 'iron'],
    diagnostics: { overlappingModules, hiddenFacadeModules },
  };
}

/** Compile the authored plan into a shared-material, close-inspection Tavern asset. */
export function compileTavernPlan(plan: TavernPlan): THREE.Group {
  if (plan.diagnostics.overlappingModules > 0 || plan.diagnostics.hiddenFacadeModules > 0) {
    throw new Error('Tavern plan contains invalid facade modules.');
  }
  const group = new THREE.Group();
  group.name = 'Tavern';
  group.userData.architecturePlan = plan;

  const shell = addGableShell(group, {
    width: plan.footprint.width,
    depth: plan.footprint.depth,
    stoneHeight: 1.1,
    wallHeight: 2.95,
    ridgeHeight: 2.35,
    wallMaterial: residenceFacadeMaterial('yellow'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -1.65, 1.12, shell.frontZ + 0.035, 1.18, 2.02);
  addSmallWindow(group, 1.15, 2.25, shell.frontZ + 0.035, 0.92, 1.02);
  addSmallWindow(group, -1.45, 2.2, -shell.frontZ - 0.035, 0.82, 0.96);
  addSmallWindow(group, 1.35, 2.2, -shell.frontZ - 0.035, 0.82, 0.96);

  addLeanToRoof(group, {
    width: 5.9,
    depth: 2.15,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(0.25, 2.72, shell.frontZ + 1.0),
    pitch: 0.13,
    highEdge: 'negativeZ',
    name: 'Tavern roadside porch roof',
  });
  for (const x of [-2.45, 2.7]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.2, 2.55, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.27, shell.frontZ + 1.72),
    );
    post.name = 'Tavern porch structural post';
  }

  const signPost = addMesh(
    group,
    new THREE.BoxGeometry(0.13, 1.5, 0.13),
    timberMaterial('dark'),
    new THREE.Vector3(3.15, 3.45, shell.frontZ + 0.24),
  );
  signPost.name = 'Tavern projecting sign bracket';
  const sign = addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.68, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(3.15, 2.95, shell.frontZ + 0.82),
  );
  sign.name = 'Tavern hanging cup sign';
  addMesh(
    group,
    new THREE.TorusGeometry(0.16, 0.035, 6, 12, Math.PI * 1.55),
    metalMaterial(),
    new THREE.Vector3(3.15, 2.97, shell.frontZ + 0.89),
    new THREE.Euler(Math.PI * 0.5, 0, 0.25),
  ).name = 'Tavern sign iron cup emblem';

  for (const x of [-0.45, 0.55]) addBarrel(group, x, shell.frontZ + 1.5, 0.9);
  for (const x of [-1.45, 1.7]) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.45, 0.16, 0.42),
      timberMaterial('mid'),
      new THREE.Vector3(x, 0.58, shell.frontZ + 1.64),
    ).name = 'Tavern porch bench seat';
    for (const legX of [-0.5, 0.5]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.13, 0.52, 0.13),
        timberMaterial('dark'),
        new THREE.Vector3(x + legX, 0.3, shell.frontZ + 1.64),
      ).name = 'Tavern porch bench leg';
    }
  }
  return group;
}

export function createTavernMesh(): THREE.Group {
  return compileTavernPlan(createTavernPlan());
}
