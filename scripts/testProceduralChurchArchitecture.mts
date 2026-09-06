import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createChapelMesh } from '../src/buildings/meshes/chapelMesh.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { BUILDING_PAD_PARAMS, getBuildingFootprintHalfExtents } from '../src/buildings/BuildingFootprint.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { batchCompletedBuildingStaticMeshes } from '../src/buildings/staticBuildingBatch.ts';
import { BuildingStaticBatches } from '../src/buildings/BuildingStaticBatches.ts';

const plot = getBuildingFootprintHalfExtents('chapel');
const heights: number[] = [];
const serverPlacement = readFileSync('server/src/placement_validation.rs', 'utf8');
const serverPad = serverPlacement.match(/"chapel" => BuildingPadParams \{([^}]+)\}/)?.[1] ?? '';
for (const [serverName, clientName] of [
  ['radius_x', 'radiusX'], ['radius_z', 'radiusZ'],
  ['inner_fade', 'innerFade'], ['outer_fade', 'outerFade'],
] as const) {
  assert(Number(serverPad.match(new RegExp(`${serverName}: ([0-9.]+)`))?.[1]) === BUILDING_PAD_PARAMS.chapel[clientName],
    `Server church ${serverName} must match the client's permanent plot`);
}

for (const tier of [1, 2, 3] as const) {
  const church = createChapelMesh(tier);
  church.updateMatrixWorld(true);
  const churchBounds = new THREE.Box3().setFromObject(church);
  heights.push(churchBounds.max.y - churchBounds.min.y);
  assert(churchBounds.min.x >= -plot.halfWidth - 1e-5 && churchBounds.max.x <= plot.halfWidth + 1e-5
    && churchBounds.min.z >= -plot.halfDepth - 1e-5 && churchBounds.max.z <= plot.halfDepth + 1e-5,
  `Church tier ${tier} must fit its permanent collision footprint`);
  const fence = requiredObject(church, 'Churchyard permanent footprint fence');
  const fenceBounds = new THREE.Box3().setFromObject(fence);
  assert(Math.abs(fenceBounds.min.x + plot.halfWidth) < 1e-5
    && Math.abs(fenceBounds.max.x - plot.halfWidth) < 1e-5
    && Math.abs(fenceBounds.min.z + plot.halfDepth) < 1e-5
    && Math.abs(fenceBounds.max.z - plot.halfDepth) < 1e-5,
  `Church tier ${tier} fence must mark all four edges of the reserved footprint`);
  assert(fence.parent === church && fence.scale.equals(new THREE.Vector3(1, 1, 1)),
    'The churchyard must remain independent of tier-model scaling');
  const fenceMeshes: THREE.Mesh[] = [];
  fence.traverse((object) => { if (object instanceof THREE.Mesh) fenceMeshes.push(object); });
  assert(new THREE.Raycaster(new THREE.Vector3(0, 0.6, plot.halfDepth + 1), new THREE.Vector3(0, 0, -1), 0, 2)
    .intersectObjects(fenceMeshes, false).length === 0, 'The front entrance must stay open');
  const modelName = tier === 1
    ? 'Small Wooden Church'
    : tier === 2
      ? 'Small Stone Church'
      : 'Large Stone Church';
  const rightWall = requiredMesh(
    church,
    `${modelName} right physical window wall`,
  );
  const leftWall = requiredMesh(
    church,
    `${modelName} left physical window wall`,
  );
  const frontWall = requiredMesh(
    church,
    `${modelName} physical front wall apertures`,
  );
  const pane = tier === 1
    ? requiredObject(church, 'Small wooden church right window pane 1')
    : requiredObject(church, 'Chapel clear lancet window pane');
  const paneWorld = pane.getWorldPosition(new THREE.Vector3());
  assertRayMisses(
    rightWall,
    paneWorld.clone().add(new THREE.Vector3(2, 0, 0)),
    new THREE.Vector3(-1, 0, 0),
    `${modelName} side window`,
  );

  const door = tier === 1
    ? requiredObject(church, 'Small wooden church timber plank door leaf')
    : requiredObject(church, 'Chapel visible arched timber door leaf');
  const doorWorld = door.getWorldPosition(new THREE.Vector3());
  assertRayMisses(
    frontWall,
    doorWorld.clone().add(new THREE.Vector3(0, 0, 2)),
    new THREE.Vector3(0, 0, -1),
    `${modelName} front door`,
  );

  const roofPlanes: THREE.Mesh[] = [];
  church.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      mesh.isMesh
      && mesh.userData.proceduralRoofShell === true
      && mesh.name.startsWith('Church joined') && mesh.name.includes('roof plane')
    ) {
      roofPlanes.push(mesh);
    }
  });
  assert(roofPlanes.length === 2, `${modelName} does not have exactly two joined nave roof planes`);
  for (const roof of roofPlanes) {
    assert(
      roof.geometry.userData.proceduralGeometryWriter === 'semantic-physical-uv-v1',
      `${modelName} roof lost semantic physical UV geometry`,
    );
  }
  const capName = tier === 1
    ? 'Compact church timber belfry joined roof cap'
    : tier === 2
      ? 'Compact church stone belfry joined roof cap'
      : 'Parish church joined belfry roof cap';
  const belfryCap = requiredMesh(church, capName);
  assert(
    belfryCap.geometry.userData.proceduralGeometryWriter === 'semantic-physical-uv-v1',
    `${modelName} belfry cap lost semantic physical UV geometry`,
  );
  assert(belfryCap.userData.proceduralPrimitiveCount === 4, `${modelName} belfry cap is not joined`);
  assert((belfryCap.geometry.getIndex()?.count ?? 0) / 3 === 32, `${modelName} belfry cap topology changed`);

  const naveRidge = requiredMesh(church, 'Church low-profile roof-covering ridge cap');
  const naveRoofBounds = boundsOf([...roofPlanes, naveRidge]);
  if (tier === 1) {
    const wallPosts: THREE.Mesh[] = [];
    church.traverse((object) => {
      if (
        object instanceof THREE.Mesh
        && /^Small wooden church (?:left|right) wall post \d+$/.test(object.name)
      ) {
        wallPosts.push(object);
      }
    });
    assert(wallPosts.length === 6, 'Small Wooden Church must retain six wall-frame posts');
    for (const post of wallPosts) {
      assertSharedBrownTimber(post);
      const postBounds = new THREE.Box3().setFromObject(post);
      const center = postBounds.getCenter(new THREE.Vector3());
      const coveringRoofHit = new THREE.Raycaster(
        new THREE.Vector3(center.x, naveRoofBounds.max.y + 1, center.z),
        new THREE.Vector3(0, -1, 0),
        0,
        10,
      ).intersectObjects(roofPlanes, false)[0];
      assert(coveringRoofHit, `${post.name} has no covering roof plane`);
      assert(
        postBounds.max.y <= coveringRoofHit.point.y + 1e-4,
        `${post.name} protrudes through the diagonal roof skin`,
      );
    }
  }
  const supportPosts = tier === 3
    ? requiredMeshes(church, 'Parish church belfry timber support post', 4)
    : requiredMeshes(
        church,
        `Compact church belfry ${tier === 1 ? 'timber' : 'stone'} support post`,
        4,
      );
  const upperBeams = tier === 3
    ? [
        ...requiredMeshes(church, 'Parish church belfry transverse upper beam', 2),
        ...requiredMeshes(church, 'Parish church belfry longitudinal upper beam', 2),
      ]
    : requiredMeshes(church, 'Compact church belfry upper beam', 4);
  const lowerSupport = requiredMesh(
    church,
    tier === 3
      ? 'Parish church belfry ridge footing'
      : 'Compact church belfry lower sill beam',
  );
  const lowerSupportBounds = new THREE.Box3().setFromObject(lowerSupport);
  const upperBeamBounds = boundsOf(upperBeams);
  const capBounds = new THREE.Box3().setFromObject(belfryCap);
  const roofBase = requiredMesh(church, 'Church roof-fitted belfry base');
  const roofBaseBounds = new THREE.Box3().setFromObject(roofBase);
  assert(roofBaseBounds.intersectsBox(lowerSupportBounds), `${modelName} tower plinth must join its sill`);
  // At every support corner, verify real triangles connect the base to the
  // sloping roof. A box resting on the ridge alone fails these vertical probes.
  for (const post of supportPosts) {
    const corner = post.getWorldPosition(new THREE.Vector3());
    const roofHit = new THREE.Raycaster(new THREE.Vector3(corner.x, naveRoofBounds.max.y + 1, corner.z),
      new THREE.Vector3(0, -1, 0)).intersectObjects(roofPlanes, false)[0];
    assert(roofHit, `${modelName} tower corner must sit over the nave roof`);
    const undersideHit = new THREE.Raycaster(roofHit.point.clone().add(new THREE.Vector3(0, -2, 0)),
      new THREE.Vector3(0, 1, 0)).intersectObject(roofBase, false)[0];
    assert(undersideHit && undersideHit.point.y <= roofHit.point.y + 1e-4,
      `${modelName} tower corner floats above the roof`);
  }

  assert(
    lowerSupportBounds.max.y > naveRoofBounds.max.y + 0.08,
    `${modelName} bell opening is still cut by the diagonal nave roof`,
  );
  assert(
    capBounds.min.y >= upperBeamBounds.min.y - 1e-4,
    `${modelName} belfry cap descends into its open steeple window`,
  );
  for (const post of supportPosts) {
    const postBounds = new THREE.Box3().setFromObject(post).expandByScalar(1e-4);
    assert(
      postBounds.intersectsBox(lowerSupportBounds),
      `${modelName} belfry post is disconnected from its lower support`,
    );
    const joinedUpperBeams = upperBeams.filter((beam) =>
      postBounds.intersectsBox(new THREE.Box3().setFromObject(beam))
    );
    assert(
      joinedUpperBeams.length >= 1,
      `${modelName} belfry post is disconnected from its upper beam`,
    );
  }
  for (const beam of upperBeams) {
    assert(
      new THREE.Box3().setFromObject(beam).intersectsBox(capBounds),
      `${modelName} belfry roof no longer bears on its upper frame`,
    );
  }

  const postSpan = boundsOf(supportPosts);
  assert(
    lowerSupportBounds.min.x <= postSpan.min.x + 1e-4
      && lowerSupportBounds.max.x >= postSpan.max.x - 1e-4,
    `${modelName} lower belfry cross member does not reach both supporting edges`,
  );
  if (tier === 1 || tier === 3) {
    for (const member of [...supportPosts, ...upperBeams, lowerSupport]) {
      if (tier === 3 && member === lowerSupport) continue;
      assertSharedBrownTimber(member);
    }
  }

  const bellOpeningCenter = supportPosts
    .reduce(
      (sum, post) => sum.add(post.getWorldPosition(new THREE.Vector3())),
      new THREE.Vector3(),
    )
    .multiplyScalar(1 / supportPosts.length);
  bellOpeningCenter.y = (lowerSupportBounds.max.y + upperBeamBounds.min.y) * 0.5;
  const roofHitsAcrossBellOpening = new THREE.Raycaster(
    bellOpeningCenter.clone().add(new THREE.Vector3(-2, 0, 0)),
    new THREE.Vector3(1, 0, 0),
    0,
    4,
  ).intersectObjects([...roofPlanes, belfryCap], false);
  assert(
    roofHitsAcrossBellOpening.length === 0,
    `${modelName} bell opening is crossed by diagonal roof geometry`,
  );

  if (tier >= 2) {
    const lancetPanes = objectsNamed(church, 'Chapel clear lancet window pane');
    assert(lancetPanes.length === (tier === 3 ? 6 : 4), `${modelName} must retain four curved lancet panes`);
    for (const lancetPane of lancetPanes) {
      const paneBounds = new THREE.Box3().setFromObject(lancetPane);
      const center = paneBounds.getCenter(new THREE.Vector3());
      const height = paneBounds.max.y - paneBounds.min.y;
      const width = paneBounds.max.z - paneBounds.min.z;
      const onRight = center.x > 0;
      const wall = onRight ? rightWall : leftWall;
      const direction = new THREE.Vector3(onRight ? -1 : 1, 0, 0);
      for (const point of [
        center.clone().setY(paneBounds.min.y + height * 0.2),
        center.clone(),
        center.clone().setY(paneBounds.max.y - height * 0.08),
      ]) {
        assertRayMisses(
          wall,
          point.clone().addScaledVector(direction, -2),
          direction,
          `${modelName} curved lancet aperture`,
        );
      }
      assertRayHits(
        wall,
        center.clone()
          .setY(paneBounds.max.y - height * 0.08)
          .setZ(center.z + width * 0.35)
          .addScaledVector(direction, -2),
        direction,
        `${modelName} lancet arch shoulder`,
      );
    }
  }

  if (tier === 3) {
    const gable = requiredMesh(church, 'Large Stone Church physical oculus gable wall');
    const oculus = requiredObject(church, 'Chapel clear oculus window pane');
    const oculusWorld = oculus.getWorldPosition(new THREE.Vector3());
    assertRayMisses(
      gable,
      oculusWorld.clone().add(new THREE.Vector3(0, 0, 2)),
      new THREE.Vector3(0, 0, -1),
      'Large Stone Church oculus',
    );
    const oculusBounds = new THREE.Box3().setFromObject(oculus);
    const outsideOculus = oculusBounds.getCenter(new THREE.Vector3());
    outsideOculus.x = oculusBounds.max.x + 0.08;
    assertRayHits(
      gable,
      outsideOculus.add(new THREE.Vector3(0, 0, 2)),
      new THREE.Vector3(0, 0, -1),
      'Large Stone Church oculus perimeter',
    );
  }
}

for (const seed of [0, 6, 8, 9, 17, 42]) {
  const homeHeight = new THREE.Box3().setFromObject(createResidenceMesh(seed, 1)).getSize(new THREE.Vector3()).y;
  assert(Math.abs(heights[0]! / homeHeight - 2) < 0.02,
    `Tier 1 church must remain approximately twice the height of tier 1 residence seed ${seed}`);
}
assert(heights[0]! < heights[1]! && heights[1]! < heights[2]!, 'Church upgrades must increase height');
// Exercise the production replacement path: geometry moves out of the marker
// into shared batches, leaving a proxy that must reserve the same churchyard.
const batches = new BuildingStaticBatches(new THREE.Group());
for (const tier of [1, 2, 3] as const) {
  const marker = createBuildingMesh('chapel', tier);
  batchCompletedBuildingStaticMeshes(marker);
  batches.registerBuilding('church-upgrade', marker);
  const collision = requiredMesh(marker, 'Building collision geometry proxy');
  assert(Math.abs(collision.scale.x - plot.halfWidth * 2) < 1e-4
    && Math.abs(collision.scale.z - plot.halfDepth * 2) < 1e-4
    && Math.abs(collision.position.x) < 1e-4 && Math.abs(collision.position.z) < 1e-4,
  `Church tier ${tier} batching must preserve the permanent collision footprint`);
}
batches.dispose();
console.log(`procedural church architecture passed (3 fitted towers, fixed fenced plot and batched collision, server parity, 2x residence height; church heights ${heights.map(h => h.toFixed(3)).join(', ')} m)`);

function requiredObject(parent: THREE.Object3D, name: string): THREE.Object3D {
  const object = parent.getObjectByName(name);
  if (!object) throw new Error(`Missing ${name}.`);
  return object;
}

function requiredMesh(parent: THREE.Object3D, name: string): THREE.Mesh {
  const object = requiredObject(parent, name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`${name} is not a mesh.`);
  return object;
}

function objectsNamed(parent: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  parent.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

function requiredMeshes(parent: THREE.Object3D, name: string, count: number): THREE.Mesh[] {
  const matches = objectsNamed(parent, name).map((object) => {
    if (!(object instanceof THREE.Mesh)) throw new Error(`${name} is not a mesh.`);
    return object;
  });
  if (matches.length !== count) {
    throw new Error(`Expected ${count} ${name} meshes, received ${matches.length}.`);
  }
  return matches;
}

function boundsOf(objects: readonly THREE.Object3D[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const object of objects) bounds.union(new THREE.Box3().setFromObject(object));
  return bounds;
}

function assertRayMisses(
  target: THREE.Mesh,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  label: string,
): void {
  const hits = new THREE.Raycaster(origin, direction.normalize(), 0, 5)
    .intersectObject(target, false);
  assert(hits.length === 0, `${label} is not physically cut through its wall`);
}

function assertRayHits(
  target: THREE.Mesh,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  label: string,
): void {
  const hits = new THREE.Raycaster(origin, direction.normalize(), 0, 5)
    .intersectObject(target, false);
  assert(hits.length > 0, `${label} removed too much supporting wall`);
}

function assertSharedBrownTimber(mesh: THREE.Mesh): void {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const key = material.userData.buildingMaterialKey;
  assert(
    material.userData.sharedBuildingMaterial === true
      && material.userData.buildingWeatheringProfile === 'timber'
      && ['timberDark', 'timberMid', 'timberLight', 'timberWeathered', 'stackedTimber'].includes(key),
    `${mesh.name} does not use the shared brown timber family`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
