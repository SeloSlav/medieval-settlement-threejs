import {
  MONASTERY_ESTATE_FRONT_DEPTH,
  MONASTERY_ESTATE_HALF_WIDTH,
  MONASTERY_ESTATE_REAR_DEPTH,
  normalizeMonasteryEstateLevel,
  type MonasteryEstateLevel,
} from '../monasteryEstate.ts';

export type MonasteryPlanPoint = Readonly<{ x: number; z: number }>;

export type MonasteryPlanRect = Readonly<{
  id: string;
  label: string;
  role:
    | 'cloister-core'
    | 'working-building'
    | 'garden'
    | 'animal-yard'
    | 'pasture'
    | 'upgrade-reserve';
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  activeFromLevel: MonasteryEstateLevel;
}>;

export type MonasteryCoreModule = Readonly<{
  id: 'church-range' | 'scriptorium-wing' | 'infirmary-wing' | 'cloister-court';
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}>;

export type MonasteryWallRun = Readonly<{
  id: string;
  name: string;
  start: MonasteryPlanPoint;
  end: MonasteryPlanPoint;
}>;

export type MonasteryTowerPlan = Readonly<{
  id: string;
  name: string;
  centerX: number;
  centerZ: number;
  radius: number;
  wallHeight: number;
}>;

export type MonasteryCirculationRun = Readonly<{
  id: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}>;

export type MonasteryPrecinctPlan = {
  version: 1;
  typology: 'fortified-rural-monastery';
  level: MonasteryEstateLevel;
  bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  enclosure: Readonly<{
    material: 'rubble-stone';
    wallHeight: number;
    wallThickness: number;
    wallRuns: readonly MonasteryWallRun[];
    towers: readonly MonasteryTowerPlan[];
  }>;
  gatehouse: Readonly<{
    id: 'east-gatehouse';
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
    wallHeight: number;
    archWidth: number;
    archSpringHeight: number;
  }>;
  coreModules: readonly MonasteryCoreModule[];
  zones: readonly MonasteryPlanRect[];
  circulation: readonly MonasteryCirculationRun[];
  reservedUpgradeZoneIds: readonly string[];
  diagnostics: {
    wallRunCount: number;
    towerCount: number;
    moduleCount: number;
    pastureArea: number;
    outOfBoundsZoneIds: string[];
    overlappingZonePairs: string[];
    estateMeshTriangles?: number;
    triangleCount?: number;
    meshCount?: number;
  };
};

const GATE_CENTER_X = 16.5;
const GATE_OPENING_WIDTH = 8;

function rectEdges(rect: MonasteryPlanRect): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  return {
    minX: rect.centerX - rect.width * 0.5,
    maxX: rect.centerX + rect.width * 0.5,
    minZ: rect.centerZ - rect.depth * 0.5,
    maxZ: rect.centerZ + rect.depth * 0.5,
  };
}

function rectsOverlap(a: MonasteryPlanRect, b: MonasteryPlanRect): boolean {
  const ae = rectEdges(a);
  const be = rectEdges(b);
  const tolerance = 0.05;
  return ae.minX < be.maxX - tolerance
    && ae.maxX > be.minX + tolerance
    && ae.minZ < be.maxZ - tolerance
    && ae.maxZ > be.minZ + tolerance;
}

/**
 * Creates the authoritative, serializable layout before any Three.js geometry
 * is emitted. The protected meadow and inactive investment parcels therefore
 * cannot be consumed accidentally by later architectural additions.
 */
export function createMonasteryPrecinctPlan(rawLevel: number): MonasteryPrecinctPlan {
  const level = normalizeMonasteryEstateLevel(rawLevel);
  const rear = -MONASTERY_ESTATE_REAR_DEPTH;
  const front = MONASTERY_ESTATE_FRONT_DEPTH;
  const half = MONASTERY_ESTATE_HALF_WIDTH;
  const gateLeft = GATE_CENTER_X - GATE_OPENING_WIDTH * 0.5;
  const gateRight = GATE_CENTER_X + GATE_OPENING_WIDTH * 0.5;

  const wallRuns: MonasteryWallRun[] = [
    { id: 'rear-wall', name: 'Monastery precinct rear wall', start: { x: -half, z: rear }, end: { x: half, z: rear } },
    { id: 'west-wall', name: 'Monastery precinct west wall', start: { x: -half, z: rear }, end: { x: -half, z: front } },
    { id: 'east-wall', name: 'Monastery precinct east wall', start: { x: half, z: rear }, end: { x: half, z: front } },
    { id: 'front-west-wall', name: 'Monastery precinct front wall west', start: { x: -half, z: front }, end: { x: gateLeft, z: front } },
    { id: 'front-east-wall', name: 'Monastery precinct front wall east', start: { x: gateRight, z: front }, end: { x: half, z: front } },
  ];

  const towers: MonasteryTowerPlan[] = [
    { id: 'northwest-tower', name: 'Monastery northwest round tower', centerX: -32, centerZ: rear + 2, radius: 2, wallHeight: 4.05 },
    { id: 'northeast-tower', name: 'Monastery northeast round tower', centerX: 32, centerZ: rear + 2, radius: 2, wallHeight: 4.05 },
    { id: 'southwest-tower', name: 'Monastery southwest round tower', centerX: -32, centerZ: front - 2, radius: 2, wallHeight: 4.15 },
    { id: 'southeast-tower', name: 'Monastery southeast round tower', centerX: 32, centerZ: front - 2, radius: 2, wallHeight: 4.15 },
  ];

  const coreModules: MonasteryCoreModule[] = [
    { id: 'church-range', centerX: -2.1, centerZ: -5, width: 14.4, depth: 6.8 },
    { id: 'scriptorium-wing', centerX: -11.7, centerZ: 0.7, width: 4.8, depth: 11.4 },
    { id: 'infirmary-wing', centerX: 7.1, centerZ: 0.4, width: 5.4, depth: 10.8 },
    { id: 'cloister-court', centerX: -2.3, centerZ: 2.15, width: 12.8, depth: 6.1 },
  ];

  const zones: MonasteryPlanRect[] = [
    { id: 'cloister-core', label: 'Church, conventual wings, and cloister', role: 'cloister-core', centerX: -2.15, centerZ: -1, width: 24.3, depth: 15.2, activeFromLevel: 0 },
    { id: 'brewhouse', label: 'Brewhouse and cellar yard', role: 'working-building', centerX: -17.8, centerZ: -12, width: 8.2, depth: 6.3, activeFromLevel: 0 },
    { id: 'orchard', label: 'Apple orchard', role: 'garden', centerX: -23, centerZ: -35.25, width: 18, depth: 15.5, activeFromLevel: 0 },
    { id: 'apiary', label: 'Bee garden', role: 'garden', centerX: -26, centerZ: -22, width: 11, depth: 7, activeFromLevel: 0 },
    { id: 'vegetable-garden', label: 'Kitchen vegetable garden', role: 'garden', centerX: -7, centerZ: -18.75, width: 13, depth: 8, activeFromLevel: 0 },
    { id: 'herb-garden', label: 'Physic herb garden', role: 'garden', centerX: 3.5, centerZ: -19, width: 7, depth: 6, activeFromLevel: 0 },
    { id: 'flower-garden', label: 'Pollinator garden', role: 'garden', centerX: -5, centerZ: -29.75, width: 10, depth: 6, activeFromLevel: 0 },
    { id: 'hen-yard', label: 'Chicken yard', role: 'animal-yard', centerX: 26, centerZ: -12, width: 10, depth: 8, activeFromLevel: 0 },
    { id: 'small-stock-yard', label: 'Goat and pig enclosure', role: 'animal-yard', centerX: 24, centerZ: -25, width: 12, depth: 9, activeFromLevel: 0 },
    { id: 'agricultural-archive', label: 'Agricultural archive and seed vault', role: 'working-building', centerX: 1, centerZ: -37, width: 9, depth: 6, activeFromLevel: 0 },
    { id: 'pasture', label: 'Protected cattle pasture', role: 'pasture', centerX: 19.25, centerZ: -37, width: 26.5, depth: 14, activeFromLevel: 0 },
    { id: 'dairy-upgrade', label: 'Reserved dairy plot', role: 'upgrade-reserve', centerX: 13.5, centerZ: -17, width: 7, depth: 5.5, activeFromLevel: 1 },
    { id: 'apple-press-upgrade', label: 'Reserved cider-press plot', role: 'upgrade-reserve', centerX: -17, centerZ: -23.5, width: 5, depth: 5, activeFromLevel: 3 },
  ];

  const circulation: MonasteryCirculationRun[] = [
    { id: 'gate-lane', centerX: GATE_CENTER_X, centerZ: 0.25, width: 3.4, depth: 14.5 },
    { id: 'cloister-service-turn', centerX: 12.25, centerZ: -6.8, width: 11.9, depth: 2.8 },
    { id: 'estate-spine', centerX: 8.5, centerZ: -18.15, width: 2.8, depth: 20.7 },
    { id: 'pasture-threshold', centerX: 12.25, centerZ: -29.2, width: 10.3, depth: 2.4 },
  ];

  const bounds = { minX: -half, maxX: half, minZ: rear, maxZ: front };
  const outOfBoundsZoneIds = zones
    .filter((zone) => {
      const edges = rectEdges(zone);
      return edges.minX < bounds.minX
        || edges.maxX > bounds.maxX
        || edges.minZ < bounds.minZ
        || edges.maxZ > bounds.maxZ;
    })
    .map((zone) => zone.id);
  const overlappingZonePairs: string[] = [];
  for (let first = 0; first < zones.length; first += 1) {
    for (let second = first + 1; second < zones.length; second += 1) {
      if (rectsOverlap(zones[first], zones[second])) {
        overlappingZonePairs.push(`${zones[first].id}:${zones[second].id}`);
      }
    }
  }

  const pasture = zones.find((zone) => zone.id === 'pasture');
  if (!pasture) throw new Error('Monastery precinct plan is missing its protected pasture.');
  const diagnostics = {
    wallRunCount: wallRuns.length,
    towerCount: towers.length,
    moduleCount: wallRuns.length + towers.length + coreModules.length + zones.length + 1,
    pastureArea: pasture.width * pasture.depth,
    outOfBoundsZoneIds,
    overlappingZonePairs,
  };
  if (outOfBoundsZoneIds.length > 0 || overlappingZonePairs.length > 0) {
    throw new Error(
      `Invalid monastery precinct plan (outside: ${outOfBoundsZoneIds.join(', ') || 'none'}; overlaps: ${overlappingZonePairs.join(', ') || 'none'}).`,
    );
  }

  return {
    version: 1,
    typology: 'fortified-rural-monastery',
    level,
    bounds,
    enclosure: {
      material: 'rubble-stone',
      wallHeight: 2.7,
      wallThickness: 0.62,
      wallRuns,
      towers,
    },
    gatehouse: {
      id: 'east-gatehouse',
      centerX: GATE_CENTER_X,
      centerZ: front - 1.8,
      width: 7.4,
      depth: 3.6,
      wallHeight: 4.4,
      archWidth: 3.3,
      archSpringHeight: 2.05,
    },
    coreModules,
    zones,
    circulation,
    reservedUpgradeZoneIds: ['dairy-upgrade', 'apple-press-upgrade'],
    diagnostics,
  };
}

export function monasteryPlanZone(plan: MonasteryPrecinctPlan, id: string): MonasteryPlanRect {
  const zone = plan.zones.find((entry) => entry.id === id);
  if (!zone) throw new Error(`Monastery precinct plan is missing zone “${id}”.`);
  return zone;
}

export function monasteryCoreModule(
  plan: MonasteryPrecinctPlan,
  id: MonasteryCoreModule['id'],
): MonasteryCoreModule {
  const module = plan.coreModules.find((entry) => entry.id === id);
  if (!module) throw new Error(`Monastery precinct plan is missing core module “${id}”.`);
  return module;
}
