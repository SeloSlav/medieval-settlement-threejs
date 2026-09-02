import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import * as THREE from 'three';
import { BuildingTool } from '../src/buildings/BuildingTool.ts';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { createInitialGameState, placeBuilding } from '../src/resources/GameState.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { buildingPlacementYaw, resolvedPlacedBuildingYaw, resolveRoadsideBuildingPlacement } from '../src/buildings/buildingPlacement.ts';
import { getBuildingFootprintCorners, getBuildingFootprintHalfExtents } from '../src/buildings/BuildingTerrainLayout.ts';
import { buildingFootprintPolygonFromState } from '../src/placement/placementConflicts.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';
import type { TerrainProjector } from '../src/terrain/TerrainProjector.ts';
import type { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import type { BuildingKind } from '../src/resources/types.ts';

class EventSurface extends EventEmitter {
  addEventListener(type: string, listener: (...args: any[]) => void): void { this.on(type, listener); }
  removeEventListener(type: string, listener: (...args: any[]) => void): void { this.off(type, listener); }
  contains(target: unknown): boolean { return target === this; }
}
const windowSurface = new EventSurface();
globalThis.window = windowSurface as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0) as unknown as number;

function close(a: number, b: number, message: string): void {
  assert.ok(Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6, message);
}
function fixture(roads = new RoadNetwork()) {
  const surface = new EventSurface();
  const parent = new THREE.Group();
  const terrain = { getHeightAt: () => 0 } as unknown as Terrain;
  const markers = new BuildingMarkers({ terrain, parent, getRoadNetwork: () => roads });
  let state = createInitialGameState({ definitionList: [] } as unknown as WorldLayoutRegistry, 1);
  Object.assign(state.stockpile, { timber: 10000, stone: 10000, ironwork: 10000, roofTiles: 10000, gold: 10000 });
  const placed: Array<{ kind: BuildingKind; x: number; z: number; yaw: number }> = [];
  let blocked = false;
  let rejected = 0;
  const tool = new BuildingTool({
    domElement: surface as unknown as HTMLElement,
    terrainProjector: { pick: (x: number, z: number) => new THREE.Vector3(x, 0, z) } as unknown as TerrainProjector,
    markers,
    getState: () => state,
    onPlaceBuilding(kind, x, z, yaw) {
      placed.push({ kind, x, z, yaw });
      const result = placeBuilding(state, kind, x, z);
      assert.ok(result.ok);
      result.building.yaw = yaw;
      state = result.state;
    },
    onDemolishBuilding(id) { state.buildings.delete(id); },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
    getRoadNetwork: () => roads,
    getMapSize: () => 'medium',
    mapBounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },
    onModeChanged() {},
    onPlacementRejected() { rejected++; },
    isBlocked: () => blocked,
  });
  function mouse(type: string, x: number, y: number, button = 0, buttons = type === 'mouseup' ? 0 : 1, inside = true) {
    const event = { type, clientX: x, clientY: y, button, buttons, target: inside ? surface : windowSurface,
      preventDefault() {}, stopPropagation() {} };
    if (inside) surface.emit(type, event);
    windowSurface.emit(type, event);
    tool.update();
  }
  function hover(x: number, z: number) { mouse('mousemove', x, z, 0, 0); }
  function activate(x = 100, z = 100) {
    surface.emit('mouseenter'); hover(x, z); tool.setMode('village_storehouse'); tool.update();
  }
  function ghost() { return parent.getObjectByName('Building placement ghost')!; }
  function key(key: string, ctrlKey = false) {
    windowSurface.emit('keydown', { key, ctrlKey, preventDefault() {}, stopPropagation() {} });
  }
  function dispose() { tool.dispose(); markers.dispose(); }
  return { tool, parent, surface, placed, mouse, hover, activate, ghost, key, dispose,
    state: () => state, block: () => { blocked = true; }, rejected: () => rejected };
}

// Exercise the actual tool, preview mesh, footprint geometry, and placement callback together.
{
  const f = fixture(); f.activate();
  const originalYaw = f.ghost().rotation.y;
  const footprint = f.parent.getObjectByName('Building footprint fill') as THREE.Mesh;
  const beforePositions = Array.from(footprint.geometry.getAttribute('position').array);
  f.mouse('mousedown', 100, 100);
  assert.equal(f.placed.length, 0, 'pressing must not place');
  f.mouse('mousemove', 180, 100);
  const yaw = f.ghost().rotation.y;
  assert.notEqual(yaw, originalYaw, 'left drag must rotate the ghost');
  assert.notDeepEqual(Array.from(footprint.geometry.getAttribute('position').array), beforePositions, 'rotation must update the footprint even at the same position');
  assert.deepEqual(f.ghost().position.toArray(), [100, 0, 100], 'rotation must keep its world pivot');
  f.mouse('mouseup', 180, 100);
  assert.equal(f.placed.length, 0, 'releasing a drag must leave placement uncommitted');
  assert.equal(f.tool.getMode(), 'village_storehouse');
  close(f.ghost().rotation.y, yaw, 'released preview must retain rotation');
  f.mouse('mousedown', 180, 100);
  f.mouse('mouseup', 180, 100);
  const pending = f.parent.getObjectByName('Pending building placement')!;
  close(pending.rotation.y, yaw, 'optimistic construction mesh must match preview');
  await delay(20);
  assert.equal(f.placed.length, 1, 'a separate plain click must place exactly once');
  assert.deepEqual(f.placed[0], { kind: 'village_storehouse', x: 100, z: 100, yaw });
  const building = [...f.state().buildings.values()][0];
  close(resolvedPlacedBuildingYaw(building), yaw, 'placed facing must remain persisted');
  assert.deepEqual(buildingFootprintPolygonFromState(building), getBuildingFootprintCorners('village_storehouse', 100, 100, yaw), 'later parcel checks must respect placed orientation');
  f.key('z', true); await delay(0);
  assert.equal(f.state().buildings.size, 0);
  f.key('y', true); await delay(0);
  assert.equal(f.placed.length, 2);
  close(f.placed[1].yaw, yaw, 'redo must restore the chosen angle');
  f.dispose();
}
{
  const roads = new RoadNetwork();
  roads.addRoadPath([new THREE.Vector3(-500, 0, 0), new THREE.Vector3(500, 0, 0)]);
  const f = fixture(roads); f.activate();
  f.mouse('mousedown', 100, 100); f.mouse('mousemove', 170, 100); f.mouse('mouseup', 170, 100);
  const manualYaw = f.ghost().rotation.y;
  f.hover(60, 8);
  const snapped = resolveRoadsideBuildingPlacement('village_storehouse', 60, 8, roads);
  assert.deepEqual(f.ghost().position.toArray(), [snapped.x, 0, snapped.z], 'default road snapping must retain the same verge');
  const roadYaw = buildingPlacementYaw('village_storehouse', snapped.x, snapped.z, roads);
  close(f.ghost().rotation.y, roadYaw, 'road snap must override manual yaw so doors face the road');
  close(roadYaw, Math.PI, 'doors on the north verge face south toward the road');
  f.hover(100, 100);
  close(f.ghost().rotation.y, manualYaw, 'moving away from roads must restore manual facing');
  f.hover(60, 8);
  f.mouse('mousedown', 60, 8); f.mouse('mousemove', 100, 8); f.mouse('mouseup', 100, 8);
  close(f.ghost().rotation.y, roadYaw, 'dragging a road-snapped preview must preserve door alignment');
  assert.equal(f.placed.length, 0);
  f.tool.setRoadSnapEnabled(false);
  f.mouse('mousedown', 100, 8); f.mouse('mousemove', 150, 8); f.mouse('mouseup', 150, 8);
  assert.notEqual(f.ghost().rotation.y, roadYaw, 'disabling road snap permits manual facing near roads');
  f.dispose();
}
{
  const f = fixture();
  for (const cancel of ['return-drag', 'coalesced-drag', 'escape', 'blur', 'outside', 'lost-button', 'blocked']) {
    f.activate(); f.mouse('mousedown', 100, 100);
    if (cancel === 'return-drag') { f.mouse('mousemove', 140, 100); f.mouse('mousemove', 100, 100); }
    if (cancel === 'escape') f.key('Escape');
    if (cancel === 'blur') windowSurface.emit('blur');
    if (cancel === 'lost-button') f.mouse('mousemove', 100, 100, 0, 0);
    if (cancel === 'blocked') { f.block(); f.tool.update(); }
    f.mouse('mouseup', cancel === 'coalesced-drag' ? 160 : 100, 100, 0, 0, cancel !== 'outside');
    await delay(0);
    assert.equal(f.placed.length, 0, cancel + ' must not accidentally place');
  }
  f.dispose();
}
{
  const f = fixture(); f.activate();
  f.mouse('mousedown', 100, 100); f.mouse('mousemove', 103, 102); f.mouse('mouseup', 103, 102);
  await delay(20);
  assert.equal(f.placed.length, 1, 'minor click jitter must remain a plain click');
  f.dispose();
}
// The same center can be valid at one angle and collide at another.
{
  const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents('village_storehouse');
  assert.notEqual(halfWidth, halfDepth);
  const edge = (halfWidth + halfDepth) / 2;
  const context = {
    buildings: [], residences: [], burgageZones: [], quarries: [], foragingNodes: [],
    stockpile: { timber: 10000, stone: 10000, ironwork: 10000, roofTiles: 10000, gold: 10000 },
    isWaterAt: () => false, getNaturalHeightAt: () => 0,
    farmFields: [{ corners: [{ x: edge, z: -1 }, { x: edge + 2, z: -1 }, { x: edge + 2, z: 1 }, { x: edge, z: 1 }] }],
  } as unknown as Parameters<typeof validateBuildingPlacement>[3];
  const wideYaw = halfWidth > halfDepth ? 0 : Math.PI / 2;
  assert.deepEqual(validateBuildingPlacement('village_storehouse', 0, 0, { ...context, yaw: wideYaw }), { ok: false, reason: 'within_farm_field' });
  assert.deepEqual(validateBuildingPlacement('village_storehouse', 0, 0, { ...context, yaw: wideYaw + Math.PI / 2 }), { ok: true });
}
assert.equal(windowSurface.eventNames().length, 0, 'disposing tools must release all window listeners');
console.log('Building rotation: preview, click/drag, road facing, cancellation, collisions, and undo/redo passed.');
