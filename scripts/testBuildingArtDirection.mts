import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  STABLE_ARCHITECTURE_PLAN,
  STABLE_OX_REST_ANCHORS,
} from '../src/buildings/meshes/stableMesh.ts';
import { createConstructionSiteMesh } from '../src/buildings/ConstructionSiteMesh.ts';
import {
  getBuildingMaterialLibraryStats,
  setBuildingIndirectLightIntensity,
} from '../src/buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import {
  getBackyardGardenMaterialLibraryStats,
  isSharedBackyardGardenMaterial,
} from '../src/residences/backyardGardenMesh.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { BUILD_MENU_ENTRIES, renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';
import { disposeObject3D } from '../src/utils/dispose.ts';

type SharpDecodeResult = {
  data: Uint8Array;
  info: { width: number; height: number; channels: number };
};
type SharpImage = {
  raw(): {
    toBuffer(options: { resolveWithObject: true }): Promise<SharpDecodeResult>;
  };
};
const vendorRequire = createRequire(resolve('vendor/seedthree/package.json'));
const sharp = vendorRequire('sharp') as (input: Uint8Array) => SharpImage;

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
  const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== 320
    || decoded.info.height !== 480
    || decoded.info.channels < 3
    || decoded.data.byteLength !== decoded.info.width * decoded.info.height * decoded.info.channels
  ) {
    throw new Error(`${url} does not decode as a complete 320x480 RGB/RGBA card.`);
  }

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
const pooledBackyardMaterials = new Set<THREE.Material>();
const monasteryBackyardMaterials = new Set<THREE.Material>();
let texturedMeshCount = 0;
let largestMetricUvSpan = 0;
let churchHeight = 0;
const buildingsExpectedToHaveOpenings = new Set<string>([
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'smithy',
  'potter_kiln',
  'chandlery',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'chapel',
  'town_hall',
  'village_storehouse',
  'guardhouse',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
  'brewery',
  'tavern',
  'smokehouse',
  'granary',
  'bakery',
  'apiary',
  'watermill',
  'windmill',
  'carpenter',
  'weaver',
]);
const legacyOpeningCrossPart = /Small window (?:vertical mullion|horizontal transom)|Residence (?:front|side) window (?:vertical mullion|horizontal transom)|Residence door cross brace/;
type WindowOpeningContract = 'generic-glazed' | 'residence-open' | 'residence-glazed';

function auditFacadeOpenings(
  root: THREE.Object3D,
  label: string,
  openingRequired: boolean,
  windowContract: WindowOpeningContract = 'generic-glazed',
): void {
  let openingCount = 0;
  root.traverse((object) => {
    if (legacyOpeningCrossPart.test(object.name)) {
      throw new Error(`${label} retains the legacy cross-shaped opening part “${object.name}”.`);
    }
    const kind = object.userData.facadeOpeningKind as string | undefined;
    if (kind !== 'door' && kind !== 'window') return;
    openingCount += 1;
    if (object.userData.hasCrossBars !== false) {
      throw new Error(`${label} ${kind} must explicitly disable cross bars.`);
    }
    if (
      !(Number(object.userData.facadeOpeningWidth) > 0)
      || !(Number(object.userData.facadeOpeningHeight) > 0)
    ) {
      throw new Error(`${label} ${kind} is missing procedural opening dimensions.`);
    }
    const roles = new Set<string>();
    object.traverse((part) => {
      const role = part.userData.facadeOpeningRole;
      if (typeof role === 'string') roles.add(role);
    });
    if (kind === 'window') {
      const openResidenceAperture = windowContract === 'residence-open';
      if (openResidenceAperture) {
        if (roles.has('window-pane')) {
          throw new Error(`${label} tier-one aperture must not retain a glazed pane.`);
        }
        if (!roles.has('window-interior')) {
          throw new Error(`${label} tier-one aperture is missing its recessed lit interior.`);
        }
      } else {
        if (!roles.has('window-pane')) {
          throw new Error(`${label} window is missing its glazed pane.`);
        }
        if (roles.has('window-interior')) {
          throw new Error(`${label} glazed window must not use the open-cottage interior surface.`);
        }
      }
      if (!roles.has('window-frame') && !roles.has('window-jamb')) {
        throw new Error(`${label} window is missing its perimeter frame.`);
      }
      if (windowContract !== 'generic-glazed') {
        if (object.userData.residenceWallCutThrough !== openResidenceAperture) {
          throw new Error(
            `${label} residence window wall-cut metadata does not match its authored construction.`,
          );
        }
        const expectedGlazing = openResidenceAperture ? 'open-aperture' : 'glazed-pane';
        if (object.userData.residenceWindowGlazing !== expectedGlazing) {
          throw new Error(`${label} residence window must identify as ${expectedGlazing}.`);
        }
      }
    } else {
      for (const requiredRole of ['door-leaf', 'door-hinge', 'door-latch']) {
        if (!roles.has(requiredRole)) {
          throw new Error(`${label} door is missing its ${requiredRole} surface.`);
        }
      }
    }
  });
  if (openingRequired && openingCount === 0) {
    throw new Error(`${label} must use the shared procedural façade-opening kit.`);
  }
}

function auditResidenceDynamicWindowSurfaces(
  root: THREE.Object3D,
  tier: 1 | 2 | 3,
  windowMaterial: THREE.Material,
  label: string,
): void {
  const expectedRole = tier === 1 ? 'window-interior' : 'window-pane';
  let surfaceCount = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.facadeOpeningRole !== expectedRole) return;
    surfaceCount += 1;
    if (mesh.material !== windowMaterial) {
      throw new Error(`${label} ${expectedRole} does not share the per-residence light material.`);
    }
    if (tier === 1) {
      if (
        mesh.userData.residenceWindowInteriorDepthMeters !== 0.34
        || mesh.position.z >= -0.3
      ) {
        throw new Error(`${label} open aperture does not retain its 0.34 m recessed interior.`);
      }
    }
  });
  if (surfaceCount === 0) {
    throw new Error(`${label} is missing its dynamic ${expectedRole} surfaces.`);
  }
}

const expectedLeanToRoofs = new Map<string, number>([
  ['lumber_mill', 1],
  ['woodcutters_lodge', 1],
  ['hunters_hall', 1],
  ['foragers_shed', 1],
  ['trading_post', 1],
  ['village_storehouse', 1],
  ['guardhouse', 1],
  ['palisaded_refuge', 1],
  ['pastoral_farmstead', 1],
  // Four cloister walks plus the mead bay and the later orchard-cider press.
  ['monastery', 6],
  ['windmill', 1],
  ['brewery', 1],
  ['tavern', 1],
  ['smokehouse', 1],
  ['carpenter', 1],
  ['weaver', 1],
  ['tannery', 1],
  ['cobbler', 1],
  ['clay_pit', 1],
  ['charcoal_burner', 1],
  ['smithy', 1],
  ['potter_kiln', 1],
  ['chandlery', 2],
]);
const leanToRoofCounts = new Map<string, number>();
for (const kind of BUILDING_KINDS) {
  const model = createBuildingMesh(kind);
  if (!model.name) throw new Error(`${kind} must have a named, dedicated model.`);
  if (modelNames.has(model.name)) throw new Error(`${kind} reuses the model identity “${model.name}”.`);
  modelNames.add(model.name);
  if (kind === 'tavern') {
    const plan = model.userData.architecturePlan as {
      exposedFacades?: string[];
      diagnostics?: { overlappingModules?: number; hiddenFacadeModules?: number };
    } | undefined;
    if (
      plan?.exposedFacades?.length !== 4
      || plan.diagnostics?.overlappingModules !== 0
      || plan.diagnostics?.hiddenFacadeModules !== 0
    ) {
      throw new Error('Tavern must compile from a clean, four-facade architecture plan.');
    }
  }
  if (kind === 'chandlery') {
    const plan = model.userData.architecturePlan as {
      signature?: string;
      deterministic?: boolean;
      roadFace?: string;
      masses?: unknown[];
      facadeEdges?: unknown[];
      placements?: unknown[];
      diagnostics?: Record<string, unknown[]>;
    } | undefined;
    const diagnostics = model.userData.architectureDiagnostics as {
      facadeOwnershipCount?: number;
      exposedFacadeCount?: number;
      plannedModuleCount?: number;
      compiledModuleCount?: number;
      meshCount?: number;
      triangleCount?: number;
    } | undefined;
    const diagnosticLists = plan?.diagnostics == null
      ? []
      : Object.values(plan.diagnostics);
    if (
      plan?.signature !== 'gorski-chandlery-v1'
      || plan.deterministic !== true
      || plan.roadFace !== 'positive-z'
      || plan.masses?.length !== 2
      || plan.facadeEdges?.length !== 4
      || diagnosticLists.some((entries) => entries.length !== 0)
      || diagnostics?.facadeOwnershipCount !== 4
      || diagnostics.exposedFacadeCount !== 4
      || diagnostics.plannedModuleCount !== plan.placements?.length
      || diagnostics.compiledModuleCount !== plan.placements?.length
      || (diagnostics.meshCount ?? 0) < 20
      || (diagnostics.triangleCount ?? 0) < 100
    ) {
      throw new Error('Chandlery must compile deterministically from a clean two-mass, four-facade semantic architecture plan.');
    }
    if (
      model.getObjectByName('WaxStock') == null
      || model.getObjectByName('CandlesStock') == null
      || model.getObjectByName('Chandlery roadside dipping porch roof') == null
      || model.getObjectByName('Chandlery heated melt-bay lean-to roof') == null
    ) {
      throw new Error('Chandlery must expose semantic wax, candle-dipping, and heated-bay presentation modules.');
    }
  }
  if (kind === 'monastery') {
    const plan = model.userData.architecturePlan as {
      typology?: string;
      reservedUpgradeZoneIds?: string[];
      diagnostics?: {
        pastureArea?: number;
        outOfBoundsZoneIds?: string[];
        overlappingZonePairs?: string[];
      };
    } | undefined;
    if (
      plan?.typology !== 'fortified-rural-monastery'
      || plan.reservedUpgradeZoneIds?.length !== 1
      || (plan.diagnostics?.pastureArea ?? 0) < 350
      || plan.diagnostics?.outOfBoundsZoneIds?.length !== 0
      || plan.diagnostics?.overlappingZonePairs?.length !== 0
    ) {
      throw new Error('Monastery must compile from a clean stone-precinct plan with protected pasture and upgrade parcels.');
    }
  }
  if (kind === 'stable') {
    const plan = model.userData.architecturePlan as typeof STABLE_ARCHITECTURE_PLAN | undefined;
    const diagnostics = plan?.diagnostics;
    if (
      STABLE_OX_REST_ANCHORS.length !== 3
      || plan?.typology !== 'three-bay-open-ox-stable'
      || plan.bayCount !== 3
      || plan.oxRestAnchorIds.length !== 3
      || diagnostics?.overlappingBayPairs.length !== 0
      || diagnostics.duplicateAnchorIds.length !== 0
      || diagnostics.outOfBoundsAnchorIds.length !== 0
      || diagnostics.misalignedAnchorIds.length !== 0
      || Math.abs(diagnostics.minimumAnchorSpacing - 3) > 1e-9
    ) {
      throw new Error('Stable must compile from a clean three-bay plan with exactly three separated ox rest anchors.');
    }
    for (const anchor of STABLE_OX_REST_ANCHORS) {
      const marker = model.getObjectByName(`Stable ox rest anchor ${anchor.slotIndex + 1}`);
      if (
        !(marker instanceof THREE.Group)
        || marker.userData.stableOxRestAnchorId !== anchor.id
        || marker.userData.stableOxSlotIndex !== anchor.slotIndex
        || marker.position.distanceTo(new THREE.Vector3().fromArray(anchor.localPosition)) > 1e-9
        || Math.abs(marker.rotation.y - anchor.localYaw) > 1e-9
      ) {
        throw new Error(`Stable ox rest anchor ${anchor.slotIndex + 1} diverged from its exported semantic layout.`);
      }
    }
  }
  auditFacadeOpenings(model, kind, buildingsExpectedToHaveOpenings.has(kind));

  let meshCount = 0;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    if (object.geometry instanceof THREE.CylinderGeometry) {
      const { radiusTop, radiusBottom, height } = object.geometry.parameters;
      const radius = Math.max(radiusTop, radiusBottom);
      if (
        radius >= 4
        && height <= 0.35
        && object.userData.functionalGroundOpening !== true
      ) {
        throw new Error(`${kind} contains a broad flat model base (${object.name || 'unnamed cylinder'}).`);
      }
    }
    const objectBounds = new THREE.Box3().setFromObject(object);
    const objectSize = objectBounds.getSize(new THREE.Vector3());
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (
      material?.name === 'Shared building material: timberDark'
      && object.geometry instanceof THREE.BoxGeometry
      && objectBounds.min.y <= 2
      && objectSize.y <= 0.2
      && objectSize.x >= 3
      && objectSize.z >= 3
      && objectSize.x * objectSize.z >= 12
    ) {
      throw new Error(`${kind} contains a full-footprint dark timber slab (${object.name || 'unnamed mesh'}).`);
    }
    if (
      kind === 'chapel'
      && material?.name === 'Shared building material: masonryDark'
      && object.geometry instanceof THREE.BoxGeometry
      && objectBounds.min.y <= 0.8
      && objectSize.y <= 0.25
      && objectSize.x >= 3
      && objectSize.z >= 3
      && objectSize.x * objectSize.z >= 12
    ) {
      throw new Error(`chapel contains the raised full-footprint ash slab (${object.name || 'unnamed mesh'}).`);
    }
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
      if (material.userData.sharedBuildingMaterial === true) {
        sharedMaterials.add(material);
      } else if (isSharedBackyardGardenMaterial(material)) {
        pooledBackyardMaterials.add(material);
        if (kind === 'monastery') monasteryBackyardMaterials.add(material);
      } else {
        throw new Error(`${kind} contains a per-instance building material (${material.name || material.type}).`);
      }
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
  if (kind === 'well') {
    const outerWall = model.getObjectByName('Well outer masonry wall');
    const innerWall = model.getObjectByName('Well inner masonry wall');
    const crownSeal = model.getObjectByName('Well masonry crown seal');
    const water = model.getObjectByName('Well water surface');
    if (
      !(outerWall instanceof THREE.Mesh)
      || !(innerWall instanceof THREE.Mesh)
      || !(crownSeal instanceof THREE.Mesh)
      || !(water instanceof THREE.Mesh)
    ) {
      throw new Error('Well must provide named outer/inner skins, crown seal, and water surface.');
    }
    const radialNormalSign = (mesh: THREE.Mesh): number => {
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      if (!position || !normal || position.count !== normal.count) {
        throw new Error(`${mesh.name} must have matching positions and normals.`);
      }
      let sum = 0;
      for (let index = 0; index < position.count; index++) {
        sum += position.getX(index) * normal.getX(index)
          + position.getZ(index) * normal.getZ(index);
      }
      return sum / position.count;
    };
    if (radialNormalSign(outerWall) <= 0 || radialNormalSign(innerWall) >= 0) {
      throw new Error('Well masonry normals must face outward outside and inward inside.');
    }
    model.updateMatrixWorld(true);
    const insideWallHits = new THREE.Raycaster(
      new THREE.Vector3(0, 0.69, 0),
      new THREE.Vector3(1, 0, 0),
    ).intersectObject(innerWall, false);
    const outsideWallHits = new THREE.Raycaster(
      new THREE.Vector3(3, 0.69, 0),
      new THREE.Vector3(-1, 0, 0),
    ).intersectObject(outerWall, false);
    if (insideWallHits.length === 0 || outsideWallHits.length === 0) {
      throw new Error('Well wall must render through front-face culling from both viewing sides.');
    }
    // The previous edge-only torus/cylinder contact opened into bright wedges
    // between segment angles. A full sweep at the old seam radius proves the
    // overlapping annular seal remains continuous from exterior viewpoints.
    for (let angleIndex = 0; angleIndex < 32; angleIndex += 1) {
      const angle = angleIndex / 32 * Math.PI * 2;
      const crownHits = new THREE.Raycaster(
        new THREE.Vector3(Math.cos(angle) * 1.015, 2, Math.sin(angle) * 1.015),
        new THREE.Vector3(0, -1, 0),
      ).intersectObject(crownSeal, false);
      if (crownHits.length === 0) {
        throw new Error(`Well crown seal left an angular gap at sample ${angleIndex}.`);
      }
    }

    const waterMaterial = Array.isArray(water.material) ? water.material[0] : water.material;
    if (
      !waterMaterial
      || waterMaterial.name !== 'Shared bounded well water'
      || waterMaterial.userData.sharedBuildingMaterial !== true
      || waterMaterial.userData.waterVisualFamily !== 'river-derived'
      || waterMaterial.userData.waterQualityTier !== 'bounded-normal-only'
      || waterMaterial.transparent !== true
      || waterMaterial.depthWrite !== false
      || !('transmission' in waterMaterial)
      || typeof waterMaterial.transmission !== 'number'
      || waterMaterial.transmission < 0.5
      || !('normalNode' in waterMaterial)
      || waterMaterial.normalNode == null
      || !('backdropNode' in waterMaterial)
      || waterMaterial.backdropNode == null
    ) {
      throw new Error('Well water must retain the shared animated river-derived optical tier.');
    }

    const posts: THREE.Mesh[] = [];
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name === 'Well windlass post') posts.push(object);
    });
    if (posts.length !== 2) throw new Error(`Well must have two audited windlass posts; found ${posts.length}.`);
    for (const post of posts) {
      const clearance = post.userData.roofClearance;
      if (typeof clearance !== 'number' || clearance < 0.075) {
        throw new Error(`Well windlass post penetrates its roof (clearance ${String(clearance)}).`);
      }
    }
  }
  if (meshCount < 4) throw new Error(`${kind} is missing a sufficiently legible procedural model (${meshCount} meshes).`);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`${kind} produced invalid model bounds.`);
  }
  if (kind === 'granary') {
    const groundedStore = model.getObjectByName('GranaryGroundedStore');
    if (!(groundedStore instanceof THREE.Group) || Math.abs(groundedStore.position.y) > 1e-6) {
      throw new Error('Granary store must sit directly at terrain level.');
    }
    let hasContinuousFoundation = false;
    groundedStore.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const foundationBounds = new THREE.Box3().setFromObject(object);
      const foundationSize = foundationBounds.getSize(new THREE.Vector3());
      if (
        Math.abs(foundationBounds.min.y) <= 1e-6
        && foundationBounds.max.y <= 0.5
        && foundationSize.x >= 9.5
        && foundationSize.z >= 6.3
      ) {
        hasContinuousFoundation = true;
      }
    });
    if (!hasContinuousFoundation) {
      throw new Error('Granary must have a continuous ground-contact foundation.');
    }

    const roofSilo = groundedStore.getObjectByName('Granary roof grain silo');
    const siloBody = groundedStore.getObjectByName('Granary roof silo body');
    const siloCap = groundedStore.getObjectByName('Granary roof silo shingle cap');
    if (
      !(roofSilo instanceof THREE.Group)
      || roofSilo.userData.architectureRole !== 'roof-grain-silo'
      || !(siloBody instanceof THREE.Mesh)
      || !(siloCap instanceof THREE.Mesh)
    ) {
      throw new Error('Granary must expose its authored roof-breaking grain-silo mass.');
    }
    const siloBodyBounds = new THREE.Box3().setFromObject(siloBody);
    const siloBounds = new THREE.Box3().setFromObject(roofSilo);
    if (
      siloBodyBounds.min.y > 4.2
      || siloBodyBounds.max.y < 7.2
      || siloBounds.max.y < 8.8
      || Math.abs(roofSilo.position.x) < 1.2
    ) {
      throw new Error('Granary roof silo must intersect the roof and hold an offset skyline silhouette.');
    }
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

for (const kind of BUILDING_KINDS) {
  const constructionSite = createConstructionSiteMesh(kind, 0.75, 0.9, 1, 0.65);
  constructionSite.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BoxGeometry)) return;
    const { width, height, depth } = object.geometry.parameters;
    if (width >= 2 && depth >= 2 && height <= 0.15) {
      throw new Error(
        `${kind} construction site contains a broad flat footprint pad (${object.name || 'unnamed box'}).`,
      );
    }
  });
  disposeObject3D(constructionSite);
}

const stats = getBuildingMaterialLibraryStats();
if (stats.constructionMaterials > 20) {
  throw new Error(`Shared construction palette grew beyond 20 materials (${stats.constructionMaterials}).`);
}
if (stats.detailMaterials > 10) {
  throw new Error(`Shared building-detail palette grew beyond 10 materials (${stats.detailMaterials}).`);
}
const backyardMaterialStats = getBackyardGardenMaterialLibraryStats();
if (backyardMaterialStats.meshMaterials > 34 || backyardMaterialStats.spriteMaterials > 3) {
  throw new Error(
    `Shared backyard palette grew beyond 34 mesh + 3 sprite materials (${backyardMaterialStats.meshMaterials} + ${backyardMaterialStats.spriteMaterials}).`,
  );
}
if (monasteryBackyardMaterials.size === 0) {
  throw new Error('Monastery must identify its embedded backyard palette as pooled module-owned materials.');
}
// The founding camp's feathered ground and pooled fire sparks plus the well's
// node water are three global materials outside the opaque construction library.
const externalSharedMaterialAllowance = 3;
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
  const duplicateMonasteryBackyardMaterials = new Set<THREE.Material>();
  duplicate.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!sharedMaterials.has(material) && !pooledBackyardMaterials.has(material)) {
        throw new Error(`${kind} allocated a different material on its second construction.`);
      }
      if (kind === 'monastery' && isSharedBackyardGardenMaterial(material)) {
        duplicateMonasteryBackyardMaterials.add(material);
      }
    }
  });
  if (
    kind === 'monastery'
    && (
      duplicateMonasteryBackyardMaterials.size !== monasteryBackyardMaterials.size
      || [...duplicateMonasteryBackyardMaterials].some(
        (material) => !monasteryBackyardMaterials.has(material),
      )
    )
  ) {
    throw new Error('Monastery allocated a different embedded backyard palette on its second construction.');
  }
  disposeObject3D(duplicate);
}

let residenceCount = 0;
let tallestResidenceHeight = 0;
for (const tier of [1, 2, 3] as const) {
  for (let seed = 0; seed < 18; seed++) {
    const residence = createResidenceMesh(seed, tier);
    const residenceLabel = `residence ${seed}/${tier}`;
    auditFacadeOpenings(
      residence,
      residenceLabel,
      true,
      tier === 1 ? 'residence-open' : 'residence-glazed',
    );
    const windowMaterial = residence.userData.windowMaterial as THREE.Material | undefined;
    if (!windowMaterial || windowMaterial.userData.sharedBuildingMaterial !== false) {
      throw new Error(`Residence ${seed}/${tier} is missing its independently animated window material.`);
    }
    auditResidenceDynamicWindowSurfaces(residence, tier, windowMaterial, residenceLabel);
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

console.log(`building art-direction tests passed (${urls.length} cards, ${BUILDING_KINDS.length} models, ${residenceCount} residence variants, ${sharedMaterials.size} shared building materials, ${monasteryBackyardMaterials.size} pooled monastery backyard materials reused by identity, ${texturedMeshCount} metric-UV meshes)`);
