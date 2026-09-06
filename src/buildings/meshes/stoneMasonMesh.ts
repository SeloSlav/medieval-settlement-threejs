import * as THREE from 'three';
import { addMesh, metalMaterial, sharedBuildingMaterial, stoneMaterial, timberMaterial } from '../buildingMaterials.ts';
import { addLeanToRoof } from './buildingMeshKit.ts';

/** Metre-authored, road-facing yard: covered bankers behind an open loading apron. */
export const STONE_MASON_PLAN = {
  signature: 'stone-mason-banker-yard-v1',
  footprint: { width: 12.9, depth: 10.76 },
  canopy: { width: 8.8, depth: 4.6, eave: 2.9, ridge: 4.45, z: -1.75 },
  bankers: [-2.35, 1.05],
  rawStock: { x: -4.2, z: 2.65, segments: 8 },
  dressedStock: { x: 3.5, z: 2.6, segments: 8 },
  modules: ['braced-post-frame', 'open-banker-bays', 'lifting-shear', 'chisel-rack', 'raw-stone', 'ashlar-stacks'],
} as const;

export function createStoneMasonMesh(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'StonemasonsYard';
  root.userData.architecturePlan = { ...STONE_MASON_PLAN, deterministic: true, roadFace: 'positive-z', embeddedVegetationGeometry: false };
  const oak = timberMaterial('dark'), wood = timberMaterial('weathered');
  const limestone = stoneMaterial('light'), rubble = stoneMaterial('mid'), iron = metalMaterial('iron');
  const box = (name: string, size: readonly number[], at: readonly number[], material: THREE.Material, group = root) => {
    const mesh = addMesh(group, new THREE.BoxGeometry(size[0], size[1], size[2]), material, new THREE.Vector3(at[0], at[1], at[2]));
    mesh.name = name; return mesh;
  };
  const beam = (name: string, a: number[], b: number[], width: number, material = oak) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
    const mesh = box(name, [width, delta.length(), width], from.clone().add(to).multiplyScalar(.5).toArray(), material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
  };
  box('Raised stone banker floor', [8.4, .18, 4.3], [0, .09, -1.75], rubble);
  // Three open bays, mortised posts, knee braces, and king-post roof trusses.
  for (const x of [-4, 0, 4]) {
    for (const z of [-3.8, .3]) {
      box('Stone post shoe', [.48, .3, .48], [x, .15, z], limestone);
      box('Oak canopy post', [.24, 2.8, .24], [x, 1.65, z], oak);
      for (const direction of x === 0 ? [-1, 1] : [x < 0 ? 1 : -1]) {
        beam('Mortised knee brace', [x, 2.12, z], [x + direction * .72, 2.91, z], .13);
      }
    }
    beam('Tie beam', [x, 2.9, -3.9], [x, 2.9, .4], .19);
    beam('King post', [x, 2.9, -1.75], [x, 4.38, -1.75], .16);
    beam('Rear principal rafter', [x, 2.91, -4], [x, 4.4, -1.75], .16);
    beam('Front principal rafter', [x, 4.4, -1.75], [x, 2.91, .5], .16);
  }
  for (const z of [-3.8, .3]) beam('Continuous wall plate', [-4.22, 2.94, z], [4.22, 2.94, z], .22);
  beam('Ridge purlin', [-4.45, 4.41, -1.75], [4.45, 4.41, -1.75], .17);
  for (const side of [-1, 1]) addLeanToRoof(root, {
    width: 8.9, depth: 2.78, thickness: .14, material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(0, 3.69, -1.75 + side * 1.17), pitch: .56,
    highEdge: side < 0 ? 'positiveZ' : 'negativeZ', name: 'Weathered shingle roof slope',
  });
  // Rear boarding leaves ventilation above the tool rail; the work faces are open geometry.
  for (let i = 0; i < 28; i++) box('Rear windbreak board', [.27, 1.95, .08], [-3.9 + i * .29, 1.27, -3.87], wood);
  box('Tool rack rail', [5.8, .12, .15], [0, 1.9, -3.73], oak);
  for (let i = 0; i < 7; i++) {
    box('Hanging iron chisel', [.045, .38, .055], [-2.5 + i * .67, 1.6, -3.6], iron);
  }
  for (const x of STONE_MASON_PLAN.bankers) {
    box('Heavy banker slab', [2, .2, 1.12], [x, 1.04, -1.45], wood);
    for (const dx of [-.72, .72]) {
      box('Banker trestle leg', [.2, .9, .78], [x + dx, .56, -1.45], oak);
    }
    box('Banker cross rail', [1.65, .12, .14], [x, .47, -1.45], oak);
    box('Partly dressed block on banker', [1.18, .55, .7], [x - .13, 1.43, -1.46], limestone);
    const chisel = box('Point chisel on banker', [.04, .38, .04], [x + .25, 1.85, -1.35], iron);
    chisel.rotation.z = -.4;
    beam('Mallet handle', [x + .66, 1.19, -1.7], [x + .66, 1.19, -1.05], .06, wood);
    box('Wooden mallet head', [.29, .2, .17], [x + .66, 1.25, -1.06], oak);
    for (let i = 0; i < 8; i++) {
      const chip = addMesh(root, new THREE.TetrahedronGeometry(.075 + (i % 3) * .025), limestone, new THREE.Vector3(x - .7 + i * .2, .22, -.6 + (i % 2) * .16));
      chip.name = 'Banker stone chips'; chip.rotation.set(i, i * 2, .2);
    }
  }
  // Small shear legs and suspended iron lifting tongs; clear of the delivery aisle.
  beam('Shear left leg', [4.8, .05, -3.1], [4.75, 3.4, -1.7], .21);
  beam('Shear right leg', [4.8, .05, -.2], [4.75, 3.4, -1.7], .21);
  beam('Lifting shear stay', [3.8, .1, -1.7], [4.75, 3.4, -1.7], .15);
  const pulley = addMesh(root, new THREE.TorusGeometry(.17, .045, 5, 12), iron, new THREE.Vector3(4.75, 3.1, -1.7));
  pulley.name = 'Lifting pulley'; pulley.rotation.y = Math.PI / 2;
  beam('Hemp lifting rope', [4.75, 3.08, -1.7], [4.75, 1.05, -1.7], .025, wood);
  beam('Iron lifting tong left', [4.75, 1.15, -1.7], [4.4, .63, -1.7], .035, iron);
  beam('Iron lifting tong right', [4.75, 1.15, -1.7], [5.1, .63, -1.7], .035, iron);
  for (let i = 0; i < 8; i++) {
    const raw = new THREE.Group(); raw.name = `MasonRawStoneStock${i}`; raw.visible = false; root.add(raw);
    const rock = addMesh(raw, new THREE.DodecahedronGeometry(.52, 0), rubble, new THREE.Vector3(-4.9 + (i % 3) * .8, .45 + Math.floor(i / 6) * .6, 2 + (Math.floor(i / 3) % 2) * .85));
    rock.scale.set(1.05, .8, .83); rock.rotation.set(i * .3, i * 1.13, .12);
    const dressed = new THREE.Group(); dressed.name = `MasonDressedStoneStock${i}`; dressed.visible = false; root.add(dressed);
    box('Dressed ashlar block', [.82, .44, .59], [2.65 + (i % 3) * .87, .29 + Math.floor(i / 6) * .46, 2.2 + (Math.floor(i / 3) % 2) * .65], limestone, dressed);
  }
  for (const x of [-5.55, 5.5]) {
    box('Yard boundary post', [.18, .95, .18], [x, .47, 3.75], oak);
    beam('Yard side rail', [x, .7, .8], [x, .7, 3.85], .1, wood);
  }
  root.userData.embeddedVegetationGeometry = false;
  return root;
}
