import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CompanyStandardRenderer,
  type CompanyStandardRenderAgent,
} from '../src/settlement/CompanyStandardRenderer.ts';
import {
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  type MilitaryEquipmentCombatRole,
  type MilitaryEquipmentKind,
  type MilitaryEquipmentMountSource,
  type MilitaryEquipmentSource,
} from '../src/settlement/militaryEquipment.ts';
import { createSeedThreeTuftVariants } from '../src/vegetation/seedthree/seedThreeGrass.ts';
import {
  createSeedThreeWildflowerFootprintGeometries,
  createSeedThreeWildflowerVariantGeometries,
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
} from '../src/vegetation/seedthree/seedThreeWildflowers.ts';
import {
  GRASS_STREAM_CHUNK_RADIUS,
} from '../src/grass/grassLodMath.ts';
import {
  WILDFLOWER_SLOT_CAPACITIES,
} from '../src/grass/wildflowerStreamBudget.ts';
import { TERRAIN_RESOLUTION } from '../src/terrain/terrainGeometryData.ts';
import { measureColorSubmissionBudget } from '../src/scene/colorSubmissionBudget.ts';

const browserGlobal = globalThis as typeof globalThis & {
  self?: typeof globalThis;
  createImageBitmap?: () => Promise<unknown>;
};
browserGlobal.self = globalThis;
browserGlobal.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

type Submission = {
  drawCalls: number;
  triangles: number;
  lineSegments: number;
};

const STRESS_MEMBERS_PER_COMPANY = 32;
const FRIENDLY_COMPANIES = 8;
const OTTOMAN_WARBANDS = 8;
const FRIENDLY_ACTORS = STRESS_MEMBERS_PER_COMPANY * FRIENDLY_COMPANIES;
const OTTOMAN_ACTORS = STRESS_MEMBERS_PER_COMPANY * OTTOMAN_WARBANDS;
const FLAG_BEARERS_PER_SIDE = 8;

const male = await inspectGlb(
  'public/assets/models/villagers/worker-male-common-01-v002.glb',
);
const raider = await inspectGlb(
  'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
);
const bodyTriangles = male.triangles * FRIENDLY_ACTORS
  + raider.triangles * OTTOMAN_ACTORS;

const sources = createMilitaryEquipmentSources();
const friendlyKinds: readonly MilitaryEquipmentKind[] = [
  'spear',
  'spear-shield',
  'sword-shield',
  'sidearm-shield',
  'pike-kit',
  'halberd',
  'bow',
  'crossbow',
];
const equipmentByKind = Object.fromEntries(
  Object.entries(sources).map(([kind, source]) => [
    kind,
    inspectVisibleEquipment(source),
  ]),
) as Record<MilitaryEquipmentKind, Submission>;

// Every company bearer carries the standardized sidearm rather than its
// company's ordinary kit. Ottoman troops already use sidearms, so only the
// friendly kit populations lose one member each.
const equipmentPopulation = Object.fromEntries(
  Object.keys(sources).map((kind) => [kind, 0]),
) as Record<MilitaryEquipmentKind, number>;
for (const kind of friendlyKinds) {
  equipmentPopulation[kind] += STRESS_MEMBERS_PER_COMPANY - 1;
}
equipmentPopulation.sidearm += FLAG_BEARERS_PER_SIDE + OTTOMAN_ACTORS;

const equipmentStress = emptySubmission();
let equipmentSourceRenderableInstances = 0;
let equipmentLogicalGeometryBytes = 0;
const equipmentMeshBatchKeys = new Set<string>();
const equipmentLineBatchKeys = new Set<string>();
const equipmentUniqueGeometryBytes = new Map<string, number>();
for (const kind of Object.keys(sources) as MilitaryEquipmentKind[]) {
  const population = equipmentPopulation[kind];
  if (population <= 0) continue;
  // Runtime attachment batching collapses identical source geometry/material
  // pairs across every owner. Each visible source renderable is therefore one
  // draw, while its triangles and line segments still scale by owner count.
  equipmentStress.triangles += equipmentByKind[kind].triangles * population;
  equipmentStress.lineSegments += equipmentByKind[kind].lineSegments * population;
  equipmentSourceRenderableInstances += equipmentByKind[kind].drawCalls * population;
  equipmentLogicalGeometryBytes += visibleEquipmentGeometryBytes(sources[kind]);
  collectVisibleEquipmentBatchKeys(
    sources[kind],
    equipmentMeshBatchKeys,
    equipmentLineBatchKeys,
    equipmentUniqueGeometryBytes,
  );
}
equipmentStress.drawCalls = equipmentMeshBatchKeys.size;

const standardsParent = new THREE.Group();
const standards = new CompanyStandardRenderer({
  parent: standardsParent,
  capacity: FRIENDLY_COMPANIES + OTTOMAN_WARBANDS,
  windSampler: () => ({ x: 0.7, z: 0.3, speed: 3.5 }),
});
const standardAgents: CompanyStandardRenderAgent[] = [];
for (let index = 0; index < FRIENDLY_COMPANIES; index += 1) {
  standardAgents.push({
    id: `player:${index}`,
    faction: 'player',
    x: index * 2,
    y: 0,
    z: 0,
    yaw: 0,
  });
}
for (let index = 0; index < OTTOMAN_WARBANDS; index += 1) {
  standardAgents.push({
    id: `ottoman:${index}`,
    faction: 'ottoman',
    x: index * 2,
    y: 0,
    z: 8,
    yaw: Math.PI,
  });
}
standards.sync(standardAgents, undefined, 1 / 30);
const standardsScene = new THREE.Scene();
standardsScene.add(standardsParent);
const standardsCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 500);
standardsCamera.position.set(0, 100, 0);
standardsCamera.lookAt(0, 0, 0);
const standardBudget = measureColorSubmissionBudget(standardsScene, standardsCamera);

const terrainTriangles = (TERRAIN_RESOLUTION - 1) ** 2 * 2;

// Grass uses two exact card-clump geometries and a 21x21 toroidal stream.
// The sparse fixed-slot prefix can extend to the final slot, so this is the
// exact maximum submitted prefix, not the number of live tufts.
const gridSide = GRASS_STREAM_CHUNK_RADIUS * 2 + 1;
const grassSlotCapacity = 240;
const grassPrefixInstancesPerVariant = gridSide * gridSide * grassSlotCapacity;
const grassVariants = createSeedThreeTuftVariants();
const grassMaximumTriangles = grassVariants.reduce(
  (total, variant) => total
    + geometryTriangles(variant.geometry) * grassPrefixInstancesPerVariant,
  0,
);

const wildflowerDetail = createSeedThreeWildflowerVariantGeometries(
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
);
const wildflowerFootprint = createSeedThreeWildflowerFootprintGeometries(
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
);
const wildflowerDetailMaximumTriangles = WILDFLOWER_SLOT_CAPACITIES.reduce(
  (total, capacity, index) => total + gridSide * gridSide * capacity
    * geometryTriangles(wildflowerDetail[index]!),
  0,
);
const wildflowerFootprintMaximumTriangles = WILDFLOWER_SLOT_CAPACITIES.reduce(
  (total, capacity, index) => total + gridSide * gridSide * capacity
    * geometryTriangles(wildflowerFootprint[index]!),
  0,
);

const knownMaximumBeforeForestAndOther = bodyTriangles
  + equipmentStress.triangles
  + standardBudget.categories.companyStandards.triangles
  + terrainTriangles
  + grassMaximumTriangles
  + wildflowerDetailMaximumTriangles;

console.log(JSON.stringify({
  route: {
    friendlyActors: FRIENDLY_ACTORS,
    ottomanActors: OTTOMAN_ACTORS,
    companyStandards: FRIENDLY_COMPANIES + OTTOMAN_WARBANDS,
  },
  authoredBodies: {
    male,
    raider,
    submittedTriangles: bodyTriangles,
  },
  mountedEquipment: {
    perVisibleKit: equipmentByKind,
    population: equipmentPopulation,
    sourceRenderableInstances: equipmentSourceRenderableInstances,
    activeLineDrawCalls: equipmentLineBatchKeys.size,
    logicalGeometryBytesBeforeIdentitySharing: equipmentLogicalGeometryBytes,
    uniqueGeometryBytesAfterIdentitySharing: [...equipmentUniqueGeometryBytes.values()]
      .reduce((total, bytes) => total + bytes, 0),
    submittedMaximum: equipmentStress,
  },
  companyStandards: {
    diagnostics: standards.diagnostics(),
    exactColorSubmission: standardBudget.categories.companyStandards,
  },
  terrain: {
    resolution: TERRAIN_RESOLUTION,
    submittedTriangles: terrainTriangles,
  },
  groundcoverMaximum: {
    gridSide,
    grassPrefixInstancesPerVariant,
    grassTrianglesPerInstance: grassVariants.map((variant) => (
      geometryTriangles(variant.geometry)
    )),
    grassSubmittedTriangles: grassMaximumTriangles,
    wildflowerDetailTrianglesPerInstance: wildflowerDetail.map(geometryTriangles),
    wildflowerFootprintTrianglesPerInstance: wildflowerFootprint.map(geometryTriangles),
    wildflowerFootprintOnlySubmittedTriangles: wildflowerFootprintMaximumTriangles,
    wildflowerDetailOnlySubmittedTriangles: wildflowerDetailMaximumTriangles,
    note: 'Upper bounds; live colorSubmissionBudget is authoritative for the camera.',
  },
  knownMaximumBeforeSeedThreeForestAndOther: knownMaximumBeforeForestAndOther,
}, null, 2));

standards.dispose();
for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);
for (const variant of grassVariants) variant.geometry.dispose();
for (const geometry of wildflowerDetail) geometry.dispose();
for (const geometry of wildflowerFootprint) geometry.dispose();

async function inspectGlb(path: string): Promise<Submission & { vertices: number }> {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, '');
  const result = { ...emptySubmission(), vertices: 0 };
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    result.vertices += mesh.geometry.getAttribute('position')?.count ?? 0;
    addScaled(result, inspectMesh(mesh), 1);
  });
  return result;
}

function inspectVisibleEquipment(source: MilitaryEquipmentSource): Submission {
  const stance = source.kind === 'bow' || source.kind === 'crossbow'
    ? 'ranged'
    : 'melee';
  const result = emptySubmission();
  if (roleVisible(source.primaryCombatRole, stance)) {
    addScaled(result, inspectObject(source.scene), 1);
  }
  for (const mount of source.secondaryMounts) {
    if (!roleVisible(mount.combatRole, stance)) continue;
    addScaled(result, inspectMount(mount), 1);
  }
  return result;
}

function collectVisibleEquipmentBatchKeys(
  source: MilitaryEquipmentSource,
  meshKeys: Set<string>,
  lineKeys: Set<string>,
  geometryBytes: Map<string, number>,
): void {
  const stance = source.kind === 'bow' || source.kind === 'crossbow'
    ? 'ranged'
    : 'melee';
  const roots: THREE.Object3D[] = [];
  if (roleVisible(source.primaryCombatRole, stance)) roots.push(source.scene);
  for (const mount of source.secondaryMounts) {
    if (roleVisible(mount.combatRole, stance)) roots.push(mount.scene);
  }
  for (const root of roots) {
    root.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      const line = object as THREE.Line;
      if (mesh.isMesh) {
        const material = Array.isArray(mesh.material)
          ? mesh.material.map((entry) => entry.uuid).join(',')
          : mesh.material.uuid;
        const key = [
          mesh.geometry.uuid,
          material,
          mesh.castShadow ? 1 : 0,
          mesh.receiveShadow ? 1 : 0,
          mesh.renderOrder,
          mesh.layers.mask,
        ].join('|');
        meshKeys.add(key);
        geometryBytes.set(key, bufferGeometryBytes(mesh.geometry));
      } else if (line.isLine) {
        const material = Array.isArray(line.material)
          ? line.material.map((entry) => entry.uuid).join(',')
          : line.material.uuid;
        lineKeys.add([
          material,
          line.castShadow ? 1 : 0,
          line.receiveShadow ? 1 : 0,
          line.renderOrder,
          line.layers.mask,
        ].join('|'));
      }
    });
  }
}

function visibleEquipmentGeometryBytes(source: MilitaryEquipmentSource): number {
  const stance = source.kind === 'bow' || source.kind === 'crossbow'
    ? 'ranged'
    : 'melee';
  let bytes = 0;
  const append = (root: THREE.Object3D): void => {
    root.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) bytes += bufferGeometryBytes(mesh.geometry);
    });
  };
  if (roleVisible(source.primaryCombatRole, stance)) append(source.scene);
  for (const mount of source.secondaryMounts) {
    if (roleVisible(mount.combatRole, stance)) append(mount.scene);
  }
  return bytes;
}

function bufferGeometryBytes(geometry: THREE.BufferGeometry): number {
  const arrays = new Set<ArrayBufferLike>();
  for (const attribute of Object.values(geometry.attributes)) {
    arrays.add(attribute.array.buffer);
  }
  if (geometry.index) arrays.add(geometry.index.array.buffer);
  return [...arrays].reduce((total, buffer) => total + buffer.byteLength, 0);
}

function inspectMount(mount: MilitaryEquipmentMountSource): Submission {
  return inspectObject(mount.scene);
}

function inspectObject(root: THREE.Object3D): Submission {
  const result = emptySubmission();
  root.traverseVisible((object) => {
    const line = object as THREE.Line;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) addScaled(result, inspectMesh(mesh), 1);
    else if (line.isLine) {
      const elements = line.geometry.index?.count
        ?? line.geometry.getAttribute('position')?.count
        ?? 0;
      result.drawCalls += 1;
      result.lineSegments += line.isLineSegments
        ? Math.floor(elements / 2)
        : Math.max(0, elements - 1);
    }
  });
  return result;
}

function inspectMesh(mesh: THREE.Mesh): Submission {
  const geometry = mesh.geometry;
  const elementCount = geometry.index?.count
    ?? geometry.getAttribute('position')?.count
    ?? 0;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (Array.isArray(mesh.material) && geometry.groups.length > 0) {
    let draws = 0;
    let triangles = 0;
    for (const group of geometry.groups) {
      if (!materials[group.materialIndex ?? 0]?.visible) continue;
      draws += 1;
      triangles += Math.floor(group.count / 3);
    }
    return { drawCalls: draws, triangles, lineSegments: 0 };
  }
  return {
    drawCalls: materials[0]?.visible === false || elementCount <= 0 ? 0 : 1,
    triangles: materials[0]?.visible === false ? 0 : Math.floor(elementCount / 3),
    lineSegments: 0,
  };
}

function roleVisible(
  role: MilitaryEquipmentCombatRole,
  stance: 'melee' | 'ranged',
): boolean {
  return role === 'always'
    || (role === 'melee-held' && stance === 'melee')
    || (role === 'melee-stowed' && stance === 'ranged')
    || (role === 'ranged-held' && stance === 'ranged')
    || (role === 'ranged-stowed' && stance === 'melee');
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return Math.floor((
    geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  ) / 3);
}

function emptySubmission(): Submission {
  return { drawCalls: 0, triangles: 0, lineSegments: 0 };
}

function addScaled(target: Submission, source: Submission, scale: number): void {
  target.drawCalls += source.drawCalls * scale;
  target.triangles += source.triangles * scale;
  target.lineSegments += source.lineSegments * scale;
}
