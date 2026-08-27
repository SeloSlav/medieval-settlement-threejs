import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  snapLandParcelDraftPoint,
  snapLandParcelPoint,
} from '../src/farming/landParcelSnap.ts';
import {
  snapBurgageBoundaryDraftPoint,
  snapBurgageBoundaryPoint,
  snapBurgageFrontagePoint,
} from '../src/residences/burgagePlotSnap.ts';
import type { BurgageZoneState } from '../src/resources/types.ts';
import { convexPolygonsOverlap2 } from '../src/utils/polygonGeometry.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const parcel = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
  { x: 0, z: 20 },
] as const;

assert.deepEqual(
  snapLandParcelPoint({ x: 10, z: -3 }, [parcel], 6),
  { x: 10, z: 0 },
  'a nearby point should snap to the middle of a linked parcel edge',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 22, z: 22 }, [parcel], 6),
  { x: 20, z: 20 },
  'a nearby point should snap to a linked parcel corner',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 15, z: 21 }, [parcel], 6),
  { x: 15, z: 20 },
  'corner preference should not pull an obvious mid-edge point sideways',
);
assert.deepEqual(
  snapLandParcelPoint({ x: 30, z: 30 }, [parcel], 6),
  { x: 30, z: 30 },
  'a distant point should remain free-form',
);

const rawLandExtension = [
  { x: 23, z: -2 },
  { x: 40, z: 0 },
  { x: 40, z: 20 },
  { x: 17, z: 23 },
] as const;
const acceptedLandExtension = rawLandExtension
  .slice(0, 3)
  .map((point) => snapLandParcelPoint(point, [parcel], 6));
const coherentLandJoin = snapLandParcelDraftPoint(
  rawLandExtension[3],
  acceptedLandExtension,
  [parcel],
  6,
);
assert.deepEqual(
  coherentLandJoin,
  { x: 20, z: 20 },
  'the final field-style corner should prefer a coherent join over the nearer perpendicular edge',
);
const attachedLandExtension = [...acceptedLandExtension, coherentLandJoin];
assert.equal(
  convexPolygonsOverlap2([...parcel], attachedLandExtension),
  false,
  'a magnetically attached land extension should share a boundary without entering the old parcel',
);
const sharedEdgeFirstLandExtension = [
  snapLandParcelPoint({ x: 17, z: 23 }, [parcel], 6),
  snapLandParcelPoint({ x: 23, z: -2 }, [parcel], 6),
  snapLandParcelPoint({ x: 40, z: 0 }, [parcel], 6),
];
sharedEdgeFirstLandExtension.push(snapLandParcelDraftPoint(
  { x: 40, z: 20 },
  sharedEdgeFirstLandExtension,
  [parcel],
  6,
));
assert.deepEqual(
  sharedEdgeFirstLandExtension,
  [
    { x: 20, z: 20 },
    { x: 20, z: 0 },
    { x: 40, z: 0 },
    { x: 40, z: 20 },
  ],
  'land joining must remain coherent when the player draws the shared edge first',
);
assert.equal(
  convexPolygonsOverlap2([...parcel], sharedEdgeFirstLandExtension),
  false,
  'shared-edge-first authoring must be as placeable as final-corner joining',
);
assert.equal(
  convexPolygonsOverlap2([...parcel], [
    { x: 20, z: 0 },
    { x: 40, z: 0 },
    { x: 40, z: 20 },
    { x: 17, z: 20 },
  ]),
  true,
  'the overlap guard must detect the snapped wedge that previously fell through to a building error',
);

const burgage: BurgageZoneState = {
  id: 'burgage-1',
  cornerA: { x: 0, z: 0 },
  cornerB: { x: 20, z: 0 },
  cornerC: { x: 20, z: 18 },
  cornerD: { x: 0, z: 18 },
  frontageEdge: 0,
  plotCount: 2,
};
assert.deepEqual(
  snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]),
  { x: 20, z: 0 },
  'new road frontage should magnetize to the end of an existing burgage row',
);
assert.deepEqual(
  snapBurgageFrontagePoint({ x: 10, z: -2 }, [burgage]),
  { x: 10, z: -2 },
  'frontage should not snap into the middle of an existing occupied row',
);
assert.deepEqual(
  snapBurgageBoundaryPoint({ x: 23, z: 11 }, [burgage]),
  { x: 20, z: 11 },
  'a rear corner should magnetize to an existing burgage outer boundary',
);
assert.deepEqual(
  snapBurgageBoundaryPoint({ x: 23, z: 4 }, [burgage], 6, (point) => point.z >= 6),
  { x: 23, z: 4 },
  'a boundary target that would violate the new plot constraints should be ignored',
);

const burgageFrontageJoin = snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]);
const coherentBurgageJoin = snapBurgageBoundaryDraftPoint(
  { x: 17, z: 21 },
  [burgageFrontageJoin, { x: 40, z: 0 }, { x: 40, z: 18 }],
  [burgage],
  6,
  (point) => point.z >= 12,
);
assert.deepEqual(
  coherentBurgageJoin,
  { x: 20, z: 18 },
  'a burgage rear corner should complete the attached side instead of cutting across the old rear edge',
);
assert.equal(
  convexPolygonsOverlap2(
    [burgage.cornerA, burgage.cornerB, burgage.cornerC, burgage.cornerD],
    [burgageFrontageJoin, { x: 40, z: 0 }, { x: 40, z: 18 }, coherentBurgageJoin],
  ),
  false,
  'an attached burgage extension should remain placeable after magnetic snapping',
);
const reverseBurgageFrontage = [
  { x: 40, z: 0 },
  snapBurgageFrontagePoint({ x: 23, z: -2 }, [burgage]),
];
const reverseBurgageRear = snapBurgageBoundaryDraftPoint(
  { x: 17, z: 21 },
  reverseBurgageFrontage,
  [burgage],
  6,
  (point) => point.z >= 12,
);
assert.deepEqual(
  reverseBurgageRear,
  { x: 20, z: 18 },
  'the first rear corner should pair with a snapped frontage endpoint when the row is drawn in reverse',
);
assert.equal(
  convexPolygonsOverlap2(
    [burgage.cornerA, burgage.cornerB, burgage.cornerC, burgage.cornerD],
    [...reverseBurgageFrontage, reverseBurgageRear, { x: 40, z: 18 }],
  ),
  false,
  'reverse-drawn burgage extensions must share the intended side without clipping the old plot',
);

const tool = source('src/farming/FarmFieldTool.ts');
for (const link of [
  /parcel\.farmsteadId === this\.farmsteadId/,
  /parcel\.chapelId === this\.farmsteadId/,
  /parcel\.monasteryId === this\.farmsteadId/,
]) assert.match(tool, link);
assert.match(tool, /snapLandParcelDraftPoint\([\s\S]*this\.points[\s\S]*linked/);
assert.match(
  tool,
  /this\.mode !== 'graveyard'[\s\S]*originFootprintPreview\.show\(null\)/,
  'only graveyard placement should retain the linked building exclusion footprint',
);
assert.match(
  tool,
  /buildingFootprintPolygonFromState\([\s\S]*originFootprintPreview\.show/,
  'graveyard placement should show the exact placed church footprint',
);
assert.doesNotMatch(tool, /GRAVEYARD_ADJACENCY_DISTANCE/);
assert.doesNotMatch(tool, /VINEYARD_MONASTERY_ADJACENCY_DISTANCE/);

const burgageTool = source('src/residences/BurgageTool.ts');
assert.match(burgageTool, /snapBurgageFrontagePoint/);
assert.match(burgageTool, /snapBurgageBoundaryDraftPoint/);
assert.match(burgageTool, /backPointMeetsMinimumDepth/);

const fields = source('server/src/reducers/farm_fields.rs');
assert.match(fields, /point[\s\S]*farmstead\.work_radius/);
assert.doesNotMatch(fields, /already has[\s\S]*field/i);

const pastures = source('server/src/reducers/livestock.rs');
assert.match(pastures, /point[\s\S]*farmstead\.work_radius/);
assert.doesNotMatch(pastures.match(/pub fn place_pasture[\s\S]*?\n\}/)?.[0] ?? '', /already has/i);

const graveyards = source('server/src/reducers/graveyards.rs');
assert.match(graveyards, /GRAVEYARD_MAX_DISTANCE/);
assert.doesNotMatch(graveyards, /GRAVEYARD_ADJACENCY_DISTANCE|must directly adjoin/);

const vineyards = source('server/src/reducers/vineyards.rs');
assert.match(vineyards, /VINEYARD_MONASTERY_MAX_DISTANCE/);
assert.doesNotMatch(vineyards, /VINEYARD_MONASTERY_ADJACENCY_DISTANCE|already has a vineyard/);

const vineyardTable = source('server/src/tables.rs');
assert.match(vineyardTable, /accessor = vineyard_parcel[\s\S]*index\(accessor = building_id[\s\S]*#\[auto_inc\]/);

const economy = source('server/src/simulation/expanded_economy.rs');
assert.match(economy, /Aggregate before applying the diminishing area curve/);
assert.match(economy, /vineyard_site \/ vineyard_area[\s\S]*vineyard_shape \/ vineyard_area/);

console.log('unlimited linked land parcels, range-only placement, and same-origin snapping checks passed');
