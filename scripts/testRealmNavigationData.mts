import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RiverField } from '../src/rivers/RiverField.ts';
import { createRealmWorldLayout } from '../src/multiplayer/realmWorldLayout.ts';
import { realmCamp, realmHeight } from '../src/multiplayer/realmLandscape.ts';
import { REALM } from '../src/multiplayer/realmPolicy.ts';

const data = JSON.parse(readFileSync('server/generated/realm_navigation.json', 'utf8'));
const field = RiverField.fromLayout({ layout: createRealmWorldLayout().riverLayout,
  bounds: { minX: -REALM.size / 2, minZ: -REALM.size / 2, maxX: REALM.size / 2, maxZ: REALM.size / 2 } });
assert.equal(data.resolution, field.resolution);
assert.deepEqual([data.startX, data.startZ, data.spanX, data.spanZ],
  [field.startX, field.startZ, field.spanX, field.spanZ]);
const cells = Buffer.from(data.wetCellsHex, 'hex');
assert.equal(cells.length, Math.ceil(field.resolution ** 2 / 8));
assert.equal(data.heights.length, field.resolution ** 2);
let wet = 0;
for (let iz = 0; iz < field.resolution; iz++) for (let ix = 0; ix < field.resolution; ix++) {
  const index = iz * field.resolution + ix;
  const actual = (cells[index >> 3] & (1 << (index & 7))) !== 0;
  assert.equal(actual, field.isRenderedWetAtGrid(ix, iz));
  wet += Number(actual);
  assert.equal(data.heights[index], Math.fround(realmHeight(field.startX + ix * field.stepX, field.startZ + iz * field.stepZ)));
}
assert(wet > 0 && wet < field.resolution ** 2, 'Realm must contain both navigable land and water');
const serverWater = (x: number, z: number) => {
  const ix = Math.round((x - data.startX) / data.spanX * (data.resolution - 1));
  const iz = Math.round((z - data.startZ) / data.spanZ * (data.resolution - 1));
  const index = iz * data.resolution + ix;
  return (cells[index >> 3] & (1 << (index & 7))) !== 0;
};
for (let index = 0; index < 4000; index++) {
  const x = field.startX + (index * 79 % field.resolution + .49) * field.stepX;
  const z = field.startZ + (index * 133 % field.resolution - .49) * field.stepZ;
  if (x >= REALM.size / 2 || z < -REALM.size / 2) continue;
  assert.equal(serverWater(x, z), field.isRenderedWetAt(x, z), 'Water edges match the client nearest-cell convention');
}
for (let slot = 0; slot < 81; slot++) {
  const camp = realmCamp(slot);
  assert.equal(serverWater(camp.x + 8, camp.z), false, 'Starting surveyor has a dry location');
}
console.log(`Immutable realm navigation: ${field.resolution}² water/height cells match the rendered world, ${wet} wet cells, all 81 dry surveyor starts PASS`);
