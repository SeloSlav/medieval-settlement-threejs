import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MARKETPLACE_ARCHITECTURE_PLAN,
  MARKET_RECEIPT_VISUAL_SEGMENTS,
  MARKET_STAGING_VISUAL_SEGMENTS,
  createMarketplaceMesh,
} from '../src/buildings/meshes/marketplaceMesh.ts';
import {
  MARKET_ALE_VISUAL_SEGMENTS,
  MARKET_CLOTH_VISUAL_SEGMENTS,
  MARKET_HONEY_VISUAL_SEGMENTS,
  MARKET_IRON_VISUAL_SEGMENTS,
  MARKET_POTTERY_VISUAL_SEGMENTS,
  MARKET_SALT_VISUAL_SEGMENTS,
  MARKET_WINE_VISUAL_SEGMENTS,
} from '../src/buildings/marketplaceSpecialtyStockpileVisuals.ts';
import {
  MARKETPLACE_STALL_DISPLAY_KINDS,
  MARKETPLACE_STALL_WORKER_ANCHOR_NAME,
  marketStallDisplayName,
} from '../src/buildings/marketplaceStallLayout.ts';
import { PROCEDURAL_BUILDING_CATALOG } from '../src/buildings/proceduralArchitecture/catalog.ts';

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) found.push(object);
  });
  return found;
}

function meshAndTriangleCounts(root: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return { meshes, triangles };
}

function effectiveVisibleMeshCount(root: THREE.Object3D): number {
  let visibleMeshes = 0;
  const visit = (object: THREE.Object3D, ancestorsVisible: boolean): void => {
    const visible = ancestorsVisible && object.visible;
    if (visible && object instanceof THREE.Mesh) visibleMeshes += 1;
    for (const child of object.children) visit(child, visible);
  };
  visit(root, true);
  return visibleMeshes;
}

function deterministicSignature(root: THREE.Object3D): string {
  const bounds = new THREE.Box3().setFromObject(root);
  const names: string[] = [];
  root.traverse((object) => names.push(object.name));
  return JSON.stringify({
    names,
    counts: meshAndTriangleCounts(root),
    bounds: [...bounds.min.toArray(), ...bounds.max.toArray()]
      .map((value) => Number(value.toFixed(4))),
  });
}

const marketplace = createMarketplaceMesh();
marketplace.updateMatrixWorld(true);
assert.equal(marketplace.name, 'Marketplace');
assert.equal(marketplace.userData.architecturePlan, MARKETPLACE_ARCHITECTURE_PLAN);
assert.equal(MARKETPLACE_ARCHITECTURE_PLAN.typology, 'open-periodic-market-lane');
assert.deepEqual(MARKETPLACE_ARCHITECTURE_PLAN.diagnostics.duplicatePlacementIds, []);
assert.deepEqual(MARKETPLACE_ARCHITECTURE_PLAN.diagnostics.overlappingStallPairs, []);
assert.deepEqual(MARKETPLACE_ARCHITECTURE_PLAN.diagnostics.missingCatalogModules, []);
assert.ok(
  MARKETPLACE_ARCHITECTURE_PLAN.diagnostics.centralAccessLaneClearance >= 0.6,
  'market must preserve a traversable central access lane',
);

const foodTables = Array.from({ length: 3 }, (_, index) => (
  marketplace.getObjectByName(`MarketFoodStall${index}`)
));
const goodsTables = Array.from({ length: 4 }, (_, index) => (
  marketplace.getObjectByName(`MarketGoodsStall${index}`)
));
for (const [stallGroup, tables] of [
  ['food', foodTables],
  ['goods', goodsTables],
] as const) {
  for (const [slotIndex, table] of tables.entries()) {
    assert.ok(table instanceof THREE.Group, `${stallGroup} stall ${slotIndex} must remain a named group`);
    assert.equal(table.visible, false, 'stall occupancy remains runtime-owned');
    assert.equal(table.userData.marketStallGroup, stallGroup);
    assert.equal(table.userData.marketStallSlotIndex, slotIndex);
    assert.equal(objectsNamed(table, MARKETPLACE_STALL_WORKER_ANCHOR_NAME).length, 1);
    assert.equal(
      table.userData.marketStallArchitecture.typology,
      'reversible-timber-counter-with-linen-awning',
    );

    const frameMeshes: THREE.Mesh[] = [];
    const canvasMeshes: THREE.Mesh[] = [];
    table.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.proceduralMaterialRole === 'rough-timber') frameMeshes.push(object);
      if (object.userData.proceduralMaterialRole === 'linen-canvas') canvasMeshes.push(object);
    });
    assert.equal(frameMeshes.length, 1, 'each reversible stall must compile to one brown timber frame draw');
    assert.equal(canvasMeshes.length, 1, 'each reversible stall must compile to one physical canvas draw');
    assert.equal(frameMeshes[0]!.material.userData.buildingMaterialKey, 'timberMid');
    assert.equal(canvasMeshes[0]!.material.userData.buildingDetailMaterialKey, 'canvas');
    assert.equal(canvasMeshes[0]!.userData.proceduralPhysicalUv, true);
    assert.equal(canvasMeshes[0]!.userData.fabricSurface, 'sewn-linen-awning');

    const expectedKinds = MARKETPLACE_STALL_DISPLAY_KINDS[stallGroup];
    for (const displayKind of expectedKinds) {
      const display = table.getObjectByName(marketStallDisplayName(displayKind));
      assert.ok(display instanceof THREE.Group, `${stallGroup} stall must retain ${displayKind} display`);
      assert.equal(display.visible, false, 'merchandise visibility remains runtime-owned');
      assert.equal(display.userData.marketDisplayKind, displayKind);
      assert.ok(display.userData.marketSourceMeshCount > display.userData.marketCompiledMeshCount);
      assert.ok(
        display.userData.marketCompiledMeshCount <= 4,
        `${displayKind} display must remain a bounded material-slot assembly`,
      );
    }
  }
}

assert.equal(objectsNamed(marketplace, MARKETPLACE_STALL_WORKER_ANCHOR_NAME).length, 7);
assert.equal(
  marketplace.userData.architectureCompiler.sharedDisplayPrototypeCount,
  21,
  'each product kind should compile once and share geometry across repeated stall slots',
);
assert.equal(
  [...foodTables, ...goodsTables].reduce((sum, table) => {
    let displays = 0;
    table!.traverse((object) => {
      if (object.name.startsWith('MarketStallDisplay:')) displays += 1;
    });
    return sum + displays;
  }, 0),
  69,
  'all named food/goods display variants must survive batching',
);

const roof = marketplace.getObjectByName('Marketplace joined split-shingle toll-shelter roof');
assert.ok(roof instanceof THREE.Mesh, 'small toll shelter must have one joined roof material slot');
assert.equal(roof.userData.proceduralMaterialRole, 'split-shingles');
assert.equal(roof.userData.proceduralPhysicalUv, true);
assert.equal(roof.userData.proceduralRoofAttachment, 'joined-small-gable');
const roofSize = new THREE.Box3().setFromObject(roof).getSize(new THREE.Vector3());
assert.ok(roofSize.x < 2.2 && roofSize.z < 1.6, 'roof must remain a small toll shelter, not a market hall');
assert.ok(
  roof.geometry.type !== 'BoxGeometry',
  'joined roof surfaces must not regress to repeated BoxGeometry roof strips',
);
assert.equal(marketplace.getObjectByName('Gable shell joined left roof plane'), undefined);
assert.equal(marketplace.getObjectByName('Gable shell joined right roof plane'), undefined);

const specialtyContracts = [
  ['MarketAleStockpile', 'MarketAleSegment', MARKET_ALE_VISUAL_SEGMENTS],
  ['MarketHoneyStockpile', 'MarketHoneySegment', MARKET_HONEY_VISUAL_SEGMENTS],
  ['MarketWineStockpile', 'MarketWineSegment', MARKET_WINE_VISUAL_SEGMENTS],
  ['MarketClothStockpile', 'MarketClothSegment', MARKET_CLOTH_VISUAL_SEGMENTS],
  ['MarketIronStockpile', 'MarketIronSegment', MARKET_IRON_VISUAL_SEGMENTS],
  ['MarketSaltStockpile', 'MarketSaltSegment', MARKET_SALT_VISUAL_SEGMENTS],
  ['MarketPotteryStockpile', 'MarketPotterySegment', MARKET_POTTERY_VISUAL_SEGMENTS],
] as const;
for (const [containerName, segmentName, expectedSegments] of specialtyContracts) {
  const container = marketplace.getObjectByName(containerName);
  assert.ok(container instanceof THREE.Group, `${containerName} runtime anchor must remain a group`);
  assert.equal(container.visible, false);
  assert.equal(objectsNamed(container, segmentName).length, expectedSegments);
}
assert.equal(objectsNamed(marketplace, 'MarketReceiptSegment').length, MARKET_RECEIPT_VISUAL_SEGMENTS);
for (const prefix of ['MarketTimberStageSegment', 'MarketStoneStageSegment', 'MarketCratedStageSegment']) {
  let count = 0;
  marketplace.traverse((object) => {
    if (object.name.startsWith(prefix)) count += 1;
  });
  assert.equal(count, MARKET_STAGING_VISUAL_SEGMENTS, `${prefix} runtime segments must remain intact`);
}

marketplace.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  assert.equal(materials.length, 1, 'marketplace compiler must retain one material per mesh');
  const material = materials[0]!;
  assert.notEqual(material.userData.buildingMaterialKey, 'timberLight');
  assert.notEqual(material.userData.buildingDetailMaterialKey, 'foliage');
  assert.notEqual(material.userData.buildingDetailMaterialKey, 'crop');
});

const counts = meshAndTriangleCounts(marketplace);
assert.ok(counts.meshes <= 220, `marketplace source mesh budget regressed (${counts.meshes})`);
assert.ok(counts.triangles <= 14_500, `marketplace optimized source triangle budget regressed (${counts.triangles})`);
assert.ok(
  counts.triangles <= PROCEDURAL_BUILDING_CATALOG.marketplace.triangleCeiling,
  `marketplace exceeds catalog ceiling (${counts.triangles})`,
);
assert.ok(
  marketplace.userData.architectureCompiler.staticDrawCalls
    <= PROCEDURAL_BUILDING_CATALOG.marketplace.drawCallTarget,
  'permanent marketplace architecture exceeds its material-slot draw target',
);
assert.equal(effectiveVisibleMeshCount(marketplace), 4, 'idle marketplace must draw only permanent material slots');
assert.equal(
  deterministicSignature(marketplace),
  deterministicSignature(createMarketplaceMesh()),
  'marketplace compilation must be deterministic',
);

console.log(
  `marketplace architecture passed: ${counts.meshes} source meshes, ${counts.triangles} tris, `
    + `${marketplace.userData.architectureCompiler.staticDrawCalls} idle draws`,
);
