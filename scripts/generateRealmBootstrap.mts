import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRealmWorldLayout } from '../src/multiplayer/realmWorldLayout.ts';
import { realmCamp, realmHeight } from '../src/multiplayer/realmLandscape.ts';
import { REALM } from '../src/multiplayer/realmPolicy.ts';
import { RiverField } from '../src/rivers/RiverField.ts';
import { computeWorldBootstrapDataFromLayout } from '../src/world/worldBootstrapData.ts';

const layout = createRealmWorldLayout();
const data = computeWorldBootstrapDataFromLayout(layout);
const riverField = RiverField.fromLayout({ layout: layout.riverLayout,
  bounds: { minX: -6144, minZ: -6144, maxX: 6144, maxZ: 6144 } });
const spawns = Array.from({ length: 81 }, (_, slot) => realmCamp(slot));
const nearby = (rows: { x: number; z: number }[], x: number, z: number, radius: number) =>
  rows.filter(r => Math.hypot(r.x - x, r.z - z) <= radius);
for (const camp of spawns) {
  assert(nearby(data.trees, camp.x, camp.z, 420).length >= 200, `Spawn ${camp.slot} lacks timber`);
  assert(nearby(data.quarries, camp.x, camp.z, 400).length >= 2, `Spawn ${camp.slot} lacks stone/minerals`);
  assert(nearby(data.foragingNodes.filter(n => n.nodeKind === 'game' || n.nodeKind === 'berries'), camp.x, camp.z, 250).length >= 2);
  assert(nearby(data.foragingNodes.filter(n => n.nodeKind === 'clay'), camp.x, camp.z, 300).length === 1);
  assert.equal(nearby(data.trees, camp.x, camp.z, 48).length, 0, 'Camp clearing must be empty');
  for (const [dx, dz] of [[-20, -20], [20, -20], [20, 20], [-20, 20]]) {
    assert(Math.abs(realmHeight(camp.x + dx, camp.z + dz) - realmHeight(camp.x, camp.z)) < 0.01);
    assert(!riverField.isBlockedForProps(camp.x + dx, camp.z + dz), `Spawn ${camp.slot} intersects water`);
  }
}
assert(spawns.length >= REALM.maxPlayers + REALM.reservedOutposts);
mkdirSync('server/generated', { recursive: true });
writeFileSync('server/generated/realm_world.json', JSON.stringify({
  version: REALM.version, seed: REALM.seed, spawns, trees: data.trees, quarries: data.quarries,
  foragingNodes: data.foragingNodes, gameRespawnCandidates: data.gameRespawnCandidates,
}));
// The server owns multiplayer geography. Match the client's rendered wet-cell
// grid exactly; uploaded player road snapshots cannot replace it with dry land.
const resolution = riverField.resolution;
const wetCells = new Uint8Array(Math.ceil(resolution ** 2 / 8));
const heights = new Array<number>(resolution ** 2);
for (let iz = 0; iz < resolution; iz++) for (let ix = 0; ix < resolution; ix++) {
  const index = iz * resolution + ix;
  const x = riverField.startX + ix * riverField.stepX;
  const z = riverField.startZ + iz * riverField.stepZ;
  if (riverField.isRenderedWetAtGrid(ix, iz)) wetCells[index >> 3] |= 1 << (index & 7);
  heights[index] = Math.fround(realmHeight(x, z));
}
writeFileSync('server/generated/realm_navigation.json', JSON.stringify({ resolution,
  startX: riverField.startX, startZ: riverField.startZ, spanX: riverField.spanX, spanZ: riverField.spanZ,
  wetCellsHex: Buffer.from(wetCells).toString('hex'), heights }));
console.log(JSON.stringify({ spawns: spawns.length, trees: data.trees.length,
  quarries: data.quarries.length, foraging: data.foragingNodes.length, capacity: 50, reservedOutposts: 17 }));
