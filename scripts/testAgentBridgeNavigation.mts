import assert from 'node:assert/strict';
import { localDeliveryRoute } from '../src/logistics/roadLogistics.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { encodeCombatRiverNavigation } from '../src/security/combatRiverNavigation.ts';

const riverNavigation = encodeCombatRiverNavigation({
  resolution: 512,
  startX: -10,
  startZ: -10,
  spanX: 20,
  spanZ: 20,
  isRenderedWetAt: (_x: number, z: number) => Math.abs(z) <= 1,
} as never);
const bridgeNetwork = new RoadNetwork();
bridgeNetwork.restore({
  nextNodeId: 3,
  nextEdgeId: 2,
  nodes: [
    { id: 'south-bank', position: [0, 0, -4] },
    { id: 'north-bank', position: [0, 0, 4] },
  ],
  edges: [{
    id: 'bridge',
    startNodeId: 'south-bank',
    endNodeId: 'north-bank',
    width: 4.2,
    controlPoints: [[0, 0, -4], [0, 0, 4]],
    sampledPath: [[0, 0, -4], [0, 0, 4]],
    length: 8,
    revision: 1,
  }],
  riverNavigation,
});

const bridgeOnlyRoute = localDeliveryRoute(bridgeNetwork, 5, -4, 5, 4);
assert.ok(bridgeOnlyRoute && !bridgeOnlyRoute.offroad);
assert.ok(
  bridgeOnlyRoute.distance > 8,
  'a cart must reject the shorter wet line beside a bridge',
);
assert.ok(
  bridgeOnlyRoute.polyline.some((point, index, path) => {
    const next = path[index + 1];
    return next != null
      && Math.abs(point.x) < 0.1
      && Math.abs(next.x) < 0.1
      && point.z < -1
      && next.z > 1;
  }),
  'cart crews and their attached oxen must cross on the bridge centerline',
);
for (let index = 0; index < bridgeOnlyRoute.polyline.length - 1; index += 1) {
  const start = bridgeOnlyRoute.polyline[index];
  const end = bridgeOnlyRoute.polyline[index + 1];
  assert.equal(
    bridgeNetwork.segmentAvoidsOpenWater(start.x, start.z, end.x, end.z),
    true,
    'every authoritative delivery leg must avoid open water',
  );
}

const waterOnlyNetwork = new RoadNetwork();
waterOnlyNetwork.restore({
  nextNodeId: 1,
  nextEdgeId: 1,
  nodes: [],
  edges: [],
  riverNavigation,
});
assert.equal(
  localDeliveryRoute(waterOnlyNetwork, 5, -4, 5, 4),
  null,
  'without a bridge, civilian logistics must not cross the river at all',
);

console.log('test:agent-bridge-navigation passed');
