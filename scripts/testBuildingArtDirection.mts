import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  getBuildingMaterialLibraryStats,
  setBuildingIndirectLightIntensity,
} from '../src/buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { BUILD_MENU_ENTRIES, renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';
import { disposeObject3D } from '../src/utils/dispose.ts';

const html = renderBuildMenuCards();
const urls = [...html.matchAll(/<img class="construction-card__art" data-src="([^"]+)"/g)].map((match) => match[1]);

if (urls.length !== BUILD_MENU_ENTRIES.length) {
  throw new Error(`Expected ${BUILD_MENU_ENTRIES.length} build-card images, found ${urls.length}.`);
}

const uniqueUrls = new Set(urls);
if (uniqueUrls.size !== urls.length) {
  throw new Error('Every construction-menu entry must reference its own named art asset.');
}

const hashes = new Map<string, string>();
for (const url of urls) {
  const file = resolve('public', url.replace(/^\//, '').replace(/^assets\//, 'assets/'));
  const bytes = readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${url} is not a WebP.`);
  }
  if (bytes.length > 100_000) throw new Error(`${url} is too large for lazy menu art (${bytes.length} bytes).`);

  const hash = createHash('sha256').update(bytes).digest('hex');
  const duplicate = hashes.get(hash);
  if (duplicate) throw new Error(`${url} duplicates ${duplicate}; every building needs bespoke card art.`);
  hashes.set(hash, url);
}
if (!html.includes('width="320" height="480"') || !html.includes('loading="lazy"')) {
  throw new Error('Construction-menu cards must reserve their 320x480 layout and lazy-load.');
}
if (/<img class="construction-card__art" src=/.test(html)) {
  throw new Error('Hidden construction menus must not assign image src until opened.');
}

const modelNames = new Set<string>();
const sharedMaterials = new Set<THREE.Material>();
let texturedMeshCount = 0;
let largestMetricUvSpan = 0;
let churchHeight = 0;
const expectedLeanToRoofs = new Map<string, number>([
  ['lumber_mill', 1],
  ['woodcutters_lodge', 1],
  ['hunters_hall', 1],
  ['foragers_shed', 1],
  ['village_storehouse', 1],
  ['guardhouse', 1],
  ['palisaded_refuge', 1],
  ['pastoral_farmstead', 1],
  ['monastery', 1],
  ['brewery', 1],
  ['smokehouse', 1],
  ['carpenter', 1],
  ['weaver', 1],
]);
const leanToRoofCounts = new Map<string, number>();
for (const kind of BUILDING_KINDS) {
  const model = createBuildingMesh(kind);
  if (!model.name) throw new Error(`${kind} must have a named, dedicated model.`);
  if (modelNames.has(model.name)) throw new Error(`${kind} reuses the model identity “${model.name}”.`);
  modelNames.add(model.name);
  if (kind === 'vineyard' && !model.getObjectByName('SeedThree cultivated grapevine cards')) {
    throw new Error('Vineyard must use the shared SeedThree instanced vine-card renderer.');
  }

  let meshCount = 0;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const highEdge = object.userData.leanToHighEdge as string | undefined;
    if (highEdge) {
      const geometry = object.geometry as THREE.BoxGeometry;
      const width = geometry.parameters.width;
      const depth = geometry.parameters.depth;
      let highPoint: THREE.Vector3;
      let lowPoint: THREE.Vector3;
      switch (highEdge) {
        case 'negativeX':
          highPoint = new THREE.Vector3(-width * 0.5, 0, 0);
          lowPoint = new THREE.Vector3(width * 0.5, 0, 0);
          break;
        case 'positiveX':
          highPoint = new THREE.Vector3(width * 0.5, 0, 0);
          lowPoint = new THREE.Vector3(-width * 0.5, 0, 0);
          break;
        case 'negativeZ':
          highPoint = new THREE.Vector3(0, 0, -depth * 0.5);
          lowPoint = new THREE.Vector3(0, 0, depth * 0.5);
          break;
        case 'positiveZ':
          highPoint = new THREE.Vector3(0, 0, depth * 0.5);
          lowPoint = new THREE.Vector3(0, 0, -depth * 0.5);
          break;
        default:
          throw new Error(`${kind} has an invalid lean-to high edge (${highEdge}).`);
      }
      highPoint.applyEuler(object.rotation);
      lowPoint.applyEuler(object.rotation);
      if (highPoint.y <= lowPoint.y + 0.01) {
        throw new Error(`${kind} has a lean-to roof that does not drain away from ${highEdge}.`);
      }
      if (!object.name) throw new Error(`${kind} has an unnamed lean-to roof.`);
      leanToRoofCounts.set(kind, (leanToRoofCounts.get(kind) ?? 0) + 1);
      if (kind === 'foragers_shed' && object.position.y < 2.5) {
        throw new Error("Forager's herb porch roof must clear the door and drying rail.");
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.userData.sharedBuildingMaterial !== true) {
        throw new Error(`${kind} contains a per-instance building material (${material.name || material.type}).`);
      }
      sharedMaterials.add(material);
      if (typeof material.userData.metricUvMeters !== 'number') continue;
      const uv = object.geometry.getAttribute('uv');
      if (!uv || uv.count === 0) throw new Error(`${kind} has a textured mesh without UVs.`);
      texturedMeshCount += 1;
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let index = 0; index < uv.count; index++) {
        minU = Math.min(minU, uv.getX(index));
        maxU = Math.max(maxU, uv.getX(index));
        minV = Math.min(minV, uv.getY(index));
        maxV = Math.max(maxV, uv.getY(index));
      }
      largestMetricUvSpan = Math.max(largestMetricUvSpan, maxU - minU, maxV - minV);
    }
  });
  if (meshCount < 4) throw new Error(`${kind} is missing a sufficiently legible procedural model (${meshCount} meshes).`);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`${kind} produced invalid model bounds.`);
  }
  if (kind === 'chapel') churchHeight = size.y;
}

for (const [kind, expectedCount] of expectedLeanToRoofs) {
  const actualCount = leanToRoofCounts.get(kind) ?? 0;
  if (actualCount !== expectedCount) {
    throw new Error(`${kind} should have ${expectedCount} audited lean-to roof(s); found ${actualCount}.`);
  }
}
if (leanToRoofCounts.size !== expectedLeanToRoofs.size) {
  throw new Error(`Expected lean-to roofs on ${expectedLeanToRoofs.size} building kinds; found ${leanToRoofCounts.size}.`);
}

const stats = getBuildingMaterialLibraryStats();
if (stats.constructionMaterials > 20) {
  throw new Error(`Shared construction palette grew beyond 20 materials (${stats.constructionMaterials}).`);
}
if (stats.detailMaterials > 10) {
  throw new Error(`Shared building-detail palette grew beyond 10 materials (${stats.detailMaterials}).`);
}
// The instanced vineyard foliage and founding camp's feathered ground each need
// one globally shared material outside the opaque construction/detail library.
const externalSharedMaterialAllowance = 2;
const buildingMaterialCeiling =
  stats.constructionMaterials + stats.detailMaterials + externalSharedMaterialAllowance;
if (sharedMaterials.size > buildingMaterialCeiling) {
  throw new Error(`All buildings should use at most ${buildingMaterialCeiling} shared materials; found ${sharedMaterials.size}.`);
}
if (texturedMeshCount === 0 || largestMetricUvSpan <= 1.5) {
  throw new Error('Building meshes are not receiving repeatable metric UV coordinates.');
}

for (const kind of BUILDING_KINDS) {
  const duplicate = createBuildingMesh(kind);
  duplicate.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!sharedMaterials.has(material)) {
        throw new Error(`${kind} allocated a different material on its second construction.`);
      }
    }
  });
  disposeObject3D(duplicate);
}

let residenceCount = 0;
let tallestResidenceHeight = 0;
for (const tier of [1, 2, 3] as const) {
  for (let seed = 0; seed < 18; seed++) {
    const residence = createResidenceMesh(seed, tier);
    const windowMaterial = residence.userData.windowMaterial as THREE.Material | undefined;
    if (!windowMaterial || windowMaterial.userData.sharedBuildingMaterial !== false) {
      throw new Error(`Residence ${seed}/${tier} is missing its independently animated window material.`);
    }
    residence.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material === windowMaterial) continue;
        if (material.userData.sharedBuildingMaterial !== true) {
          throw new Error(`Residence ${seed}/${tier} contains an unshared construction material.`);
        }
        sharedMaterials.add(material);
      }
    });
    tallestResidenceHeight = Math.max(
      tallestResidenceHeight,
      new THREE.Box3().setFromObject(residence).getSize(new THREE.Vector3()).y,
    );
    residenceCount += 1;
    disposeObject3D(residence);
    windowMaterial.dispose();
  }
}

const finalStats = getBuildingMaterialLibraryStats();
if (finalStats.constructionMaterials < 15 || finalStats.constructionMaterials > 20 || finalStats.detailMaterials !== 10) {
  throw new Error(`Expected a 15–20 construction + 10 detail shared palette; found ${finalStats.constructionMaterials} + ${finalStats.detailMaterials}.`);
}
const finalMaterialCeiling =
  finalStats.constructionMaterials
  + finalStats.detailMaterials
  + externalSharedMaterialAllowance;
if (sharedMaterials.size > finalMaterialCeiling) {
  throw new Error(`Buildings and residences exceeded the ${finalMaterialCeiling} shared material ceiling (${sharedMaterials.size}).`);
}
if (churchHeight < tallestResidenceHeight * 1.2) {
  throw new Error(
    `Parish church must stand at least 20% above the residence skyline (${churchHeight.toFixed(2)} vs ${tallestResidenceHeight.toFixed(2)}).`,
  );
}

const indirectConstructionMaterials = [...sharedMaterials].filter(
  (material): material is THREE.MeshStandardMaterial =>
    material instanceof THREE.MeshStandardMaterial
    && material.name.startsWith('Shared building material:'),
);
if (indirectConstructionMaterials.length < 15) {
  throw new Error(`Expected at least 15 indirect-lit construction materials; found ${indirectConstructionMaterials.length}.`);
}
if (indirectConstructionMaterials.some((material) =>
  material.userData.buildingIndirectLight !== true
  || material.emissiveIntensity < 0.1
  || material.emissive.equals(new THREE.Color(0x000000))
)) {
  throw new Error('Every shared construction material must retain a visible daylight bounce contribution.');
}
setBuildingIndirectLightIntensity(0.025);
if (indirectConstructionMaterials.some((material) => material.emissiveIntensity !== 0.025)) {
  throw new Error('Day/night lighting must update every shared construction material.');
}

console.log(`building art-direction tests passed (${urls.length} cards, ${BUILDING_KINDS.length} models, ${residenceCount} residence variants, ${sharedMaterials.size} shared materials, ${texturedMeshCount} metric-UV meshes)`);
