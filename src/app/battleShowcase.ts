import type { GameState, TreeEntityState } from '../resources/types.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import type {
  CombatAgentFaction,
  CombatAgentState,
  CombatAgentStatus,
} from '../security/combatAgents.ts';

export const BATTLE_SHOWCASE_QUERY_PARAMETER = 'battleShowcase';
export const BATTLE_SHOWCASE_ID = 'croatian-ottoman-live-world-v1';
export const BATTLE_SHOWCASE_DURATION_SECONDS = 30;
export const BATTLE_SHOWCASE_FRIENDLY_COUNT = 24;
export const BATTLE_SHOWCASE_HOSTILE_COUNT = 24;
export const BATTLE_SHOWCASE_AGENT_PREFIX = 'battle-showcase:';
export const BATTLE_SHOWCASE_FORMATION_COLUMNS = 6;
export const BATTLE_SHOWCASE_FORMATION_ROWS = 4;
export const BATTLE_SHOWCASE_CHARGE_END_SECONDS = 8;

export type BattleShowcasePhase =
  | 'charge'
  | 'clash'
  | 'rout'
  | 'aftermath';

export type BattleShowcaseShot = 'wide' | 'croatian' | 'ottoman' | 'clash';

export type BattleShowcaseCamera = {
  targetX: number;
  targetZ: number;
  yaw: number;
  pitch: number;
  distance: number;
};

export type BattleShowcaseRequest = {
  enabled: true;
  loop: boolean;
  shot: BattleShowcaseShot;
};

export type BattleShowcasePoint = {
  x: number;
  z: number;
};

export type BattleShowcaseSite = BattleShowcasePoint & {
  /** Unit vector from the Croatian line toward the Ottoman line. */
  axisX: number;
  axisZ: number;
  terrainHeight: number;
  terrainRelief: number;
  innerTreeCount: number;
  backdropTreeCount: number;
  nearestHoldingDistance: number | null;
  source: 'tree-registry-clearing' | 'deterministic-terrain-fallback';
};

export type BattleShowcaseWorldInput = {
  seed: number;
  playableHalf: number;
  getTerrainHeight: (x: number, z: number) => number;
  isWaterAt?: (x: number, z: number) => boolean;
  treeRegistry?: Pick<TreeRegistry, 'entries' | 'treesInRadius'> | null;
  treeStates?: ReadonlyMap<string, TreeEntityState> | null;
  buildings?: Iterable<BattleShowcasePoint>;
  residences?: Iterable<BattleShowcasePoint>;
  settlementAnchors?: Iterable<BattleShowcasePoint>;
  terrainPreset?: string;
  rendererBackend?: string;
  connectedServer?: boolean;
};

export type BattleShowcaseDiagnostics = {
  id: typeof BATTLE_SHOWCASE_ID;
  durationSeconds: typeof BATTLE_SHOWCASE_DURATION_SECONDS;
  combatants: {
    total: number;
    croatian: typeof BATTLE_SHOWCASE_FRIENDLY_COUNT;
    ottoman: typeof BATTLE_SHOWCASE_HOSTILE_COUNT;
  };
  worldSeed: number;
  terrainPreset: string;
  rendererBackend: string;
  connectedServer: boolean;
  productionTerrain: true;
  seedThreeForestReady: boolean;
  treeRegistryEntries: number;
  serverStateMutated: false;
  combatAuthority: 'deterministic-client-showcase';
  croatianSourceModel: '/assets/models/villagers/worker-male-common-01-v002.glb';
  ottomanSourceModel: '/assets/models/villagers/ottoman-raider-common-01-v001.glb';
  site: BattleShowcaseSite;
};

export type BattleShowcase = {
  readonly site: BattleShowcaseSite;
  readonly diagnostics: BattleShowcaseDiagnostics;
  sample(elapsedSeconds: number): Map<string, CombatAgentState>;
};

type SiteCandidate = BattleShowcaseSite & {
  score: number;
};

const FRIENDLY_FACTIONS: readonly ('spearman' | 'polearm' | 'footman')[] = [
  'spearman',
  'spearman',
  'spearman',
  'spearman',
  'polearm',
  'polearm',
  'polearm',
  'polearm',
  'footman',
  'footman',
  'footman',
  'footman',
];

const FORMATION_LATERAL_SPACING = 1.92;
const FORMATION_RANK_SPACING = 1.35;
const FORMATION_CONTACT_RANK_SPACING = 0.48;
const FORMATION_FRONT_DISTANCE = 12.4;
const FORMATION_CONTACT_DISTANCE = 1.12;
const FORMATION_FRONTAGE = (BATTLE_SHOWCASE_FORMATION_COLUMNS - 1)
  * FORMATION_LATERAL_SPACING;
const FORMATION_OPENING_HALF_LENGTH = FORMATION_FRONT_DISTANCE
  + (BATTLE_SHOWCASE_FORMATION_ROWS - 1) * FORMATION_RANK_SPACING;
const CROATIAN_PURSUER_COUNT = Math.round(BATTLE_SHOWCASE_FRIENDLY_COUNT * 2 / 3);

const FRIENDLY_MAX_HEALTH: Readonly<Record<'spearman' | 'polearm' | 'footman', number>> = {
  spearman: 74,
  polearm: 70,
  footman: 78,
};

const CROATIAN_CASUALTY_AT: Readonly<Record<number, number>> = {
  1: 18.4,
  7: 15.8,
  14: 20.7,
  20: 17.6,
};

const OTTOMAN_CASUALTY_AT: Readonly<Record<number, number>> = {
  2: 13.7,
  5: 17.1,
  10: 20.3,
  13: 15.2,
  18: 18.9,
  22: 21.1,
};

const SITE_RADII = [48, 64, 80, 98, 118, 138] as const;
const SITE_ANGLES = 20;
const BATTLE_INNER_TREE_RADIUS = 19;
const BATTLE_BACKDROP_TREE_RADIUS = 58;
const BATTLE_HOLDING_CLEARANCE = 27;
const BATTLE_FOOTPRINT_HALF_LENGTH = FORMATION_OPENING_HALF_LENGTH + 0.9;
const BATTLE_FOOTPRINT_HALF_WIDTH = FORMATION_FRONTAGE * 0.5 + 0.9;
const BATTLE_FOOTPRINT_SAMPLES: readonly BattleShowcasePoint[] = [
  { x: 0, z: 0 },
  { x: -BATTLE_FOOTPRINT_HALF_LENGTH, z: 0 },
  { x: BATTLE_FOOTPRINT_HALF_LENGTH, z: 0 },
  { x: 0, z: -BATTLE_FOOTPRINT_HALF_WIDTH },
  { x: 0, z: BATTLE_FOOTPRINT_HALF_WIDTH },
  { x: -BATTLE_FOOTPRINT_HALF_LENGTH, z: -BATTLE_FOOTPRINT_HALF_WIDTH },
  { x: BATTLE_FOOTPRINT_HALF_LENGTH, z: -BATTLE_FOOTPRINT_HALF_WIDTH },
  { x: -BATTLE_FOOTPRINT_HALF_LENGTH, z: BATTLE_FOOTPRINT_HALF_WIDTH },
  { x: BATTLE_FOOTPRINT_HALF_LENGTH, z: BATTLE_FOOTPRINT_HALF_WIDTH },
];

export function parseBattleShowcaseRequest(search: string): BattleShowcaseRequest | null {
  const params = new URLSearchParams(search);
  const raw = params.get(BATTLE_SHOWCASE_QUERY_PARAMETER);
  if (raw !== '1' && raw !== 'true') return null;
  const requestedShot = params.get('battleShot');
  const shot: BattleShowcaseShot = requestedShot === 'croatian'
    || requestedShot === 'ottoman'
    || requestedShot === 'clash'
    ? requestedShot
    : 'wide';
  return {
    enabled: true,
    loop: params.get('battleLoop') !== '0',
    shot,
  };
}

/**
 * Authors every shot in the battle site's local formation frame. Distances
 * derive from the four-rank footprint, so doubling the actors deepens the
 * formations without forcing the close camera back to the old wide framing.
 */
export function battleShowcaseCamera(
  site: Pick<BattleShowcaseSite, 'x' | 'z' | 'axisX' | 'axisZ'>,
  shot: BattleShowcaseShot,
  elapsedSeconds = 0,
): BattleShowcaseCamera {
  const time = normalizeTimelineTime(elapsedSeconds);
  const charge = chargeProgressAt(time);
  const rout = smoothstep(22, 27, time);
  const clashOrbit = smoothstep(BATTLE_SHOWCASE_CHARGE_END_SECONDS, 22, time);
  const axisAngle = Math.atan2(site.axisZ, site.axisX);
  // The clash shot is intentionally intimate: it may crop the rear corners
  // of the four-rank formations so individual weapon work and hit reactions
  // read clearly, while the opening and wide shots retain full-unit framing.
  const closeDistance = Math.max(9, FORMATION_FRONTAGE * 0.94);
  const sideDistance = FORMATION_FRONTAGE * 1.72;
  const openingDistance = FORMATION_OPENING_HALF_LENGTH * 1.64;

  let axialTarget = 0;
  let lateralTarget = 0;
  let yawDegrees = -104;
  let pitchDegrees = 8.5;
  let distance = openingDistance;

  switch (shot) {
    case 'croatian':
      axialTarget = formationCenterDistanceAt('croatian', time);
      yawDegrees = -112;
      pitchDegrees = 10;
      distance = sideDistance;
      break;
    case 'ottoman':
      axialTarget = formationCenterDistanceAt('ottoman', time);
      yawDegrees = -82;
      pitchDegrees = 10;
      distance = sideDistance;
      break;
    case 'clash':
      axialTarget = lerp(0, 11.4, rout);
      lateralTarget = time >= BATTLE_SHOWCASE_CHARGE_END_SECONDS && time < 22
        ? Math.sin((time - BATTLE_SHOWCASE_CHARGE_END_SECONDS) * 0.42) * 0.55
        : lerp(0, 0.6, rout);
      yawDegrees = lerp(-104, -92, clashOrbit);
      pitchDegrees = lerp(8.5, 6, charge);
      distance = time < 22
        ? lerp(openingDistance, closeDistance, charge)
        : lerp(closeDistance, FORMATION_FRONTAGE * 1.96, rout);
      break;
    case 'wide':
      axialTarget = lerp(0, 4.5, rout);
      yawDegrees = -132;
      pitchDegrees = 13;
      distance = FORMATION_OPENING_HALF_LENGTH * 1.78;
      break;
  }

  return {
    targetX: site.x + site.axisX * axialTarget - site.axisZ * lateralTarget,
    targetZ: site.z + site.axisZ * axialTarget + site.axisX * lateralTarget,
    yaw: degreesToRadians(yawDegrees) + axisAngle,
    pitch: degreesToRadians(pitchDegrees),
    distance,
  };
}

export function createBattleShowcase(input: BattleShowcaseWorldInput): BattleShowcase {
  const site = selectBattleShowcaseSite(input);
  const diagnostics: BattleShowcaseDiagnostics = {
    id: BATTLE_SHOWCASE_ID,
    durationSeconds: BATTLE_SHOWCASE_DURATION_SECONDS,
    combatants: {
      total: BATTLE_SHOWCASE_FRIENDLY_COUNT + BATTLE_SHOWCASE_HOSTILE_COUNT,
      croatian: BATTLE_SHOWCASE_FRIENDLY_COUNT,
      ottoman: BATTLE_SHOWCASE_HOSTILE_COUNT,
    },
    worldSeed: input.seed >>> 0,
    terrainPreset: input.terrainPreset ?? 'unknown',
    rendererBackend: input.rendererBackend ?? 'unknown',
    connectedServer: input.connectedServer === true,
    productionTerrain: true,
    seedThreeForestReady: Boolean(
      input.treeRegistry && input.treeRegistry.entries.length > 0,
    ),
    treeRegistryEntries: input.treeRegistry?.entries.length ?? 0,
    serverStateMutated: false,
    combatAuthority: 'deterministic-client-showcase',
    croatianSourceModel: '/assets/models/villagers/worker-male-common-01-v002.glb',
    ottomanSourceModel: '/assets/models/villagers/ottoman-raider-common-01-v001.glb',
    site,
  };
  return {
    site,
    diagnostics,
    sample: (elapsedSeconds) => sampleBattleShowcase(site, elapsedSeconds),
  };
}

export function battleShowcaseWorldInput(
  state: Pick<GameState, 'seed' | 'buildings' | 'residences' | 'settlements' | 'trees'>,
  input: Omit<BattleShowcaseWorldInput, 'seed' | 'buildings' | 'residences' | 'settlementAnchors' | 'treeStates'>,
): BattleShowcaseWorldInput {
  return {
    ...input,
    seed: state.seed,
    buildings: state.buildings.values(),
    residences: state.residences.values(),
    settlementAnchors: [...state.settlements.values()].map((settlement) => ({
      x: settlement.anchorX,
      z: settlement.anchorZ,
    })),
    treeStates: state.trees,
  };
}

/**
 * Finds a genuine meadow in the loaded world rather than manufacturing a
 * fixture clearing. Candidate scoring uses the authoritative SeedThree tree
 * layout when it is ready, the live terrain sampler, real water, and current
 * holdings. The deterministic terrain-only fallback keeps the debug view
 * usable while the forest is still hydrating without changing the map.
 */
export function selectBattleShowcaseSite(input: BattleShowcaseWorldInput): BattleShowcaseSite {
  const playableHalf = Math.max(42, finiteOr(input.playableHalf, 248));
  const buildings = [...(input.buildings ?? [])];
  const residences = [...(input.residences ?? [])];
  const holdings = [...buildings, ...residences];
  const anchors = [...(input.settlementAnchors ?? [])];
  const anchor = averagePoint(
    anchors.length > 0 ? anchors : buildings.length > 0 ? buildings : [{ x: 0, z: 0 }],
  );
  const seedAngle = unitHash(input.seed ^ 0x5bd1_e995) * Math.PI * 2;
  const candidates: SiteCandidate[] = [];

  // The production world grammar authors the origin as its stable central
  // meadow. Prefer that audited clearing when the live tree/water/holding
  // evidence still agrees, keeping recordings repeatable across reloads.
  const central = evaluateSite(input, 0, 0, anchor, holdings);
  if (central) {
    return {
      ...withoutScore(central),
      axisX: 1,
      axisZ: 0,
    };
  }

  for (const radius of SITE_RADII) {
    if (radius > playableHalf - 26) continue;
    for (let angleIndex = 0; angleIndex < SITE_ANGLES; angleIndex += 1) {
      const angleJitter = (
        unitHash(input.seed ^ Math.imul(radius, 0x45d9_f3b) ^ angleIndex)
        - 0.5
      ) * 0.11;
      const angle = seedAngle + angleIndex / SITE_ANGLES * Math.PI * 2 + angleJitter;
      const x = anchor.x + Math.cos(angle) * radius;
      const z = anchor.z + Math.sin(angle) * radius;
      const candidate = evaluateSite(input, x, z, anchor, holdings);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((left, right) =>
    left.score - right.score
    || left.x - right.x
    || left.z - right.z
  );
  const best = candidates[0];
  if (best) return withoutScore(best);

  return fallbackSite(input, anchor, holdings, playableHalf, seedAngle);
}

export function battleShowcasePhaseAt(elapsedSeconds: number): BattleShowcasePhase {
  const time = normalizeTimelineTime(elapsedSeconds);
  if (time < BATTLE_SHOWCASE_CHARGE_END_SECONDS) return 'charge';
  if (time < 22) return 'clash';
  if (time < 27) return 'rout';
  return 'aftermath';
}

export function sampleBattleShowcase(
  site: BattleShowcaseSite,
  elapsedSeconds: number,
): Map<string, CombatAgentState> {
  const time = normalizeTimelineTime(elapsedSeconds);
  const phase = battleShowcasePhaseAt(time);
  const agents = new Map<string, CombatAgentState>();

  for (let index = 0; index < BATTLE_SHOWCASE_FRIENDLY_COUNT; index += 1) {
    const id = croatianId(index);
    const faction = FRIENDLY_FACTIONS[index % FRIENDLY_FACTIONS.length]!;
    const pairId = ottomanId(index);
    const position = combatantPosition(site, index, 'croatian', time);
    const casualtyAt = CROATIAN_CASUALTY_AT[index];
    const downed = casualtyAt !== undefined && time >= casualtyAt;
    const status = statusFor('croatian', phase, downed, index);
    const maxHealth = FRIENDLY_MAX_HEALTH[faction];
    const health = downed
      ? 0
      : quantizedHealth(maxHealth, time, 9.4 + index * 0.07, 1.65, 5.2 + index % 3);
    agents.set(id, makeAgent({
      id,
      faction,
      side: 'croatian',
      index,
      position,
      site,
      status,
      health,
      maxHealth,
      targetId: pairId,
      phase,
      time,
    }));
  }

  for (let index = 0; index < BATTLE_SHOWCASE_HOSTILE_COUNT; index += 1) {
    const id = ottomanId(index);
    const pairId = croatianId(index);
    const position = combatantPosition(site, index, 'ottoman', time);
    const casualtyAt = OTTOMAN_CASUALTY_AT[index];
    const downed = casualtyAt !== undefined && time >= casualtyAt;
    const status = statusFor('ottoman', phase, downed, index);
    const maxHealth = 88 + index % 4 * 2;
    const health = downed
      ? 0
      : quantizedHealth(maxHealth, time, 9.1 + index * 0.09, 1.48, 6.4 + index % 4);
    agents.set(id, makeAgent({
      id,
      faction: 'raider',
      side: 'ottoman',
      index,
      position,
      site,
      status,
      health,
      maxHealth,
      targetId: pairId,
      phase,
      time,
    }));
  }

  return agents;
}

export function mergeBattleShowcaseAgents(
  authoritative: ReadonlyMap<string, CombatAgentState>,
  showcase: ReadonlyMap<string, CombatAgentState>,
): Map<string, CombatAgentState> {
  if (authoritative.size === 0) return new Map(showcase);
  const merged = new Map(authoritative);
  for (const [id, agent] of showcase) merged.set(id, agent);
  return merged;
}

export function countBattleShowcaseAgents(
  agents: ReadonlyMap<string, CombatAgentState>,
): number {
  let count = 0;
  for (const id of agents.keys()) {
    if (id.startsWith(BATTLE_SHOWCASE_AGENT_PREFIX)) count += 1;
  }
  return count;
}

function evaluateSite(
  input: BattleShowcaseWorldInput,
  x: number,
  z: number,
  anchor: BattleShowcasePoint,
  holdings: readonly BattleShowcasePoint[],
): SiteCandidate | null {
  const border = Math.max(26, input.playableHalf - 26);
  if (Math.abs(x) > border || Math.abs(z) > border) return null;
  const radialX = x - anchor.x;
  const radialZ = z - anchor.z;
  const radialLength = Math.hypot(radialX, radialZ);
  const fallbackAngle = unitHash(input.seed ^ 0xa53a_9e37) * Math.PI * 2;
  const axisX = radialLength > 1e-5 ? radialX / radialLength : Math.cos(fallbackAngle);
  const axisZ = radialLength > 1e-5 ? radialZ / radialLength : Math.sin(fallbackAngle);
  const perpX = -axisZ;
  const perpZ = axisX;

  const heights: number[] = [];
  for (const local of BATTLE_FOOTPRINT_SAMPLES) {
    const sampleX = x + axisX * local.x + perpX * local.z;
    const sampleZ = z + axisZ * local.x + perpZ * local.z;
    if (input.isWaterAt?.(sampleX, sampleZ) === true) return null;
    const height = input.getTerrainHeight(sampleX, sampleZ);
    if (!Number.isFinite(height)) return null;
    heights.push(height);
  }
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const terrainRelief = maxHeight - minHeight;
  if (terrainRelief > 3.8) return null;

  const nearestHoldingDistance = nearestDistance(holdings, x, z);
  if (nearestHoldingDistance !== null && nearestHoldingDistance < BATTLE_HOLDING_CLEARANCE) {
    return null;
  }

  const innerTrees = activeTreesInRadius(
    input.treeRegistry,
    input.treeStates,
    x,
    z,
    BATTLE_INNER_TREE_RADIUS,
  );
  // More than two live trunks inside the formation envelope ceases to read as
  // a woodland-edge battle and starts producing clipping/occlusion.
  if (innerTrees > 2) return null;
  const backdropTrees = Math.max(
    0,
    activeTreesInRadius(
      input.treeRegistry,
      input.treeStates,
      x,
      z,
      BATTLE_BACKDROP_TREE_RADIUS,
    ) - innerTrees,
  );
  const registryReady = Boolean(input.treeRegistry && input.treeRegistry.entries.length > 0);
  const backdropPenalty = registryReady
    ? Math.abs(Math.min(backdropTrees, 42) - 24) * 0.18
    : 7;
  const score = innerTrees * 46
    + terrainRelief * 17
    + backdropPenalty
    + (nearestHoldingDistance === null
      ? 4
      : Math.max(0, 42 - nearestHoldingDistance) * 0.34)
    + Math.abs(radialLength - 82) * 0.045;

  return {
    x,
    z,
    axisX,
    axisZ,
    terrainHeight: heights[0],
    terrainRelief,
    innerTreeCount: innerTrees,
    backdropTreeCount: backdropTrees,
    nearestHoldingDistance,
    source: registryReady
      ? 'tree-registry-clearing'
      : 'deterministic-terrain-fallback',
    score,
  };
}

function fallbackSite(
  input: BattleShowcaseWorldInput,
  anchor: BattleShowcasePoint,
  holdings: readonly BattleShowcasePoint[],
  playableHalf: number,
  seedAngle: number,
): BattleShowcaseSite {
  const radius = Math.min(54, playableHalf - 28);
  const x = clamp(anchor.x + Math.cos(seedAngle) * radius, -playableHalf + 28, playableHalf - 28);
  const z = clamp(anchor.z + Math.sin(seedAngle) * radius, -playableHalf + 28, playableHalf - 28);
  const axis = normalize2(x - anchor.x, z - anchor.z, Math.cos(seedAngle), Math.sin(seedAngle));
  return {
    x,
    z,
    axisX: axis.x,
    axisZ: axis.z,
    terrainHeight: finiteOr(input.getTerrainHeight(x, z), 0),
    terrainRelief: 0,
    innerTreeCount: activeTreesInRadius(
      input.treeRegistry,
      input.treeStates,
      x,
      z,
      BATTLE_INNER_TREE_RADIUS,
    ),
    backdropTreeCount: activeTreesInRadius(
      input.treeRegistry,
      input.treeStates,
      x,
      z,
      BATTLE_BACKDROP_TREE_RADIUS,
    ),
    nearestHoldingDistance: nearestDistance(holdings, x, z),
    source: 'deterministic-terrain-fallback',
  };
}

function combatantPosition(
  site: BattleShowcaseSite,
  index: number,
  side: 'croatian' | 'ottoman',
  time: number,
): BattleShowcasePoint {
  const downAt = side === 'croatian'
    ? CROATIAN_CASUALTY_AT[index]
    : OTTOMAN_CASUALTY_AT[index];
  // Once a casualty starts the fall clip, keep his authoritative XZ fixed.
  // Letting later clash noise move a downed body causes visible ground sliding.
  const motionTime = downAt !== undefined ? Math.min(time, downAt) : time;
  const axisSign = side === 'croatian' ? -1 : 1;
  const row = Math.floor(index / BATTLE_SHOWCASE_FORMATION_COLUMNS);
  const column = index % BATTLE_SHOWCASE_FORMATION_COLUMNS;
  const lateral = (
    column - (BATTLE_SHOWCASE_FORMATION_COLUMNS - 1) * 0.5
  ) * FORMATION_LATERAL_SPACING + (row % 2 === 1 ? 0.42 : 0);
  const rankDepth = row * FORMATION_RANK_SPACING;
  const initialDistance = FORMATION_FRONT_DISTANCE + rankDepth;
  const charge = chargeProgressAt(motionTime);
  const contactDistance = FORMATION_CONTACT_DISTANCE
    + row * FORMATION_CONTACT_RANK_SPACING;
  let axialDistance = lerp(initialDistance, contactDistance, charge);

  if (motionTime >= BATTLE_SHOWCASE_CHARGE_END_SECONDS && motionTime < 22) {
    const clashTime = motionTime - BATTLE_SHOWCASE_CHARGE_END_SECONDS;
    const contactBlend = smoothstep(
      BATTLE_SHOWCASE_CHARGE_END_SECONDS,
      BATTLE_SHOWCASE_CHARGE_END_SECONDS + 0.5,
      motionTime,
    );
    const lunge = Math.sin(
      clashTime * (2.15 + index % 3 * 0.09) + index * 0.82,
    ) * 0.38 * contactBlend;
    axialDistance = contactDistance + lunge * axisSign;
  } else if (motionTime >= 22) {
    const rout = smoothstep(22, 27, motionTime);
    if (side === 'ottoman' && OTTOMAN_CASUALTY_AT[index] === undefined) {
      axialDistance = lerp(contactDistance, 21 + index % 3 * 1.7, rout);
    } else if (side === 'croatian' && CROATIAN_CASUALTY_AT[index] === undefined) {
      axialDistance = lerp(contactDistance, -1.7 - index % 2 * 0.65, rout);
    }
  }

  const clashScatter = motionTime >= BATTLE_SHOWCASE_CHARGE_END_SECONDS
    ? Math.sin(index * 4.17 + motionTime * 0.72) * 0.24
      * smoothstep(
        BATTLE_SHOWCASE_CHARGE_END_SECONDS,
        BATTLE_SHOWCASE_CHARGE_END_SECONDS + 0.7,
        motionTime,
      )
    : 0;
  const fallDrift = downAt !== undefined && time >= downAt
    ? Math.sin(index * 8.3 + motionTime) * 0.22
    : 0;
  return {
    x: site.x
      + site.axisX * axialDistance * axisSign
      - site.axisZ * (lateral + clashScatter + fallDrift),
    z: site.z
      + site.axisZ * axialDistance * axisSign
      + site.axisX * (lateral + clashScatter + fallDrift),
  };
}

function statusFor(
  side: 'croatian' | 'ottoman',
  phase: BattleShowcasePhase,
  downed: boolean,
  index: number,
): CombatAgentStatus {
  if (downed) return 'downed';
  switch (phase) {
    case 'charge':
      return 'advancing';
    case 'clash':
      return 'fighting';
    case 'rout':
      return side === 'ottoman'
        ? 'retreating'
        : index < CROATIAN_PURSUER_COUNT ? 'advancing' : 'holding';
    case 'aftermath':
      return side === 'ottoman' ? 'retreating' : 'holding';
  }
}

function makeAgent(input: {
  id: string;
  faction: CombatAgentFaction;
  side: 'croatian' | 'ottoman';
  index: number;
  position: BattleShowcasePoint;
  site: BattleShowcaseSite;
  status: CombatAgentStatus;
  health: number;
  maxHealth: number;
  targetId: string;
  phase: BattleShowcasePhase;
  time: number;
}): CombatAgentState {
  const facing = input.side === 'croatian' ? 1 : -1;
  const moving = input.status === 'advancing' || input.status === 'retreating';
  const fighting = input.status === 'fighting';
  const engagingOpponent = input.phase === 'charge' || fighting;
  const phaseTick = input.phase === 'charge'
    ? 1
    : input.phase === 'clash'
      ? 2
      : input.phase === 'rout'
        ? 3
        : 4;
  return {
    id: input.id,
    raidId: input.side === 'croatian'
      ? `${BATTLE_SHOWCASE_AGENT_PREFIX}croatian-company`
      : `${BATTLE_SHOWCASE_AGENT_PREFIX}ottoman-warband`,
    faction: input.faction,
    sourceBuildingId: null,
    sourceSlot: input.index,
    // The opening advance is an actual mutual charge, not a generic move
    // order. Keeping the paired opponent authoritative lets animation and
    // audio distinguish a charge from a bandit simply walking toward storage.
    targetKind: engagingOpponent ? 'combat-agent' : 'ground',
    targetId: engagingOpponent ? input.targetId : `${BATTLE_SHOWCASE_AGENT_PREFIX}ground`,
    x: input.position.x,
    z: input.position.z,
    homeX: input.position.x - input.site.axisX * facing,
    homeZ: input.position.z - input.site.axisZ * facing,
    health: input.health,
    maxHealth: input.maxHealth,
    readiness: input.side === 'croatian' ? 0.78 : 0.72,
    status: input.status,
    attackCooldown: fighting ? (input.index * 0.17 + input.time) % 1.4 : 0,
    lootProgress: 0,
    carryingLoot: false,
    issuedPolearms: input.faction === 'spearman' || input.faction === 'polearm' ? 1 : 0,
    raidAnchorBuildingId: null,
    banditCampId: null,
    companyId: input.side === 'croatian'
      ? `${BATTLE_SHOWCASE_AGENT_PREFIX}croatian-${Math.floor(input.index / 4)}`
      : null,
    homeResidenceId: null,
    personIdentity: null,
    stateChangedTick: phaseTick,
    // VillagerRenderer selects the run clip above fourteen route units. Keep
    // the full authored movement in that state instead of walking into melee.
    routeProgress: moving ? 18 : 0,
  };
}

function quantizedHealth(
  maxHealth: number,
  time: number,
  firstHitAt: number,
  interval: number,
  damage: number,
): number {
  if (time < firstHitAt) return maxHealth;
  const hits = 1 + Math.floor((time - firstHitAt) / interval);
  return Math.max(1, maxHealth - hits * damage);
}

function activeTreesInRadius(
  registry: BattleShowcaseWorldInput['treeRegistry'],
  states: BattleShowcaseWorldInput['treeStates'],
  x: number,
  z: number,
  radius: number,
): number {
  if (!registry) return 0;
  let count = 0;
  for (const tree of registry.treesInRadius(x, z, radius)) {
    const phase = states?.get(tree.id)?.phase;
    if (phase !== 'stump') count += 1;
  }
  return count;
}

function croatianId(index: number): string {
  return `${BATTLE_SHOWCASE_AGENT_PREFIX}croatian:${String(index + 1).padStart(2, '0')}`;
}

function ottomanId(index: number): string {
  return `${BATTLE_SHOWCASE_AGENT_PREFIX}ottoman:${String(index + 1).padStart(2, '0')}`;
}

function normalizeTimelineTime(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds)) return 0;
  return clamp(elapsedSeconds, 0, BATTLE_SHOWCASE_DURATION_SECONDS);
}

/** Linear closing motion begins with a non-zero velocity on the first frame. */
function chargeProgressAt(time: number): number {
  return clamp(time / BATTLE_SHOWCASE_CHARGE_END_SECONDS, 0, 1);
}

function formationCenterDistanceAt(
  side: 'croatian' | 'ottoman',
  time: number,
): number {
  const initial = FORMATION_FRONT_DISTANCE
    + (BATTLE_SHOWCASE_FORMATION_ROWS - 1) * FORMATION_RANK_SPACING * 0.5;
  const contact = FORMATION_CONTACT_DISTANCE
    + (BATTLE_SHOWCASE_FORMATION_ROWS - 1) * FORMATION_CONTACT_RANK_SPACING * 0.5;
  if (time < 22) {
    const distance = lerp(initial, contact, chargeProgressAt(time));
    return side === 'croatian' ? -distance : distance;
  }
  const rout = smoothstep(22, 27, time);
  return side === 'croatian'
    ? lerp(-contact, 2.05, rout)
    : lerp(contact, 22.7, rout);
}

function averagePoint(points: readonly BattleShowcasePoint[]): BattleShowcasePoint {
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    z += point.z;
  }
  return points.length > 0
    ? { x: x / points.length, z: z / points.length }
    : { x: 0, z: 0 };
}

function nearestDistance(
  points: readonly BattleShowcasePoint[],
  x: number,
  z: number,
): number | null {
  let nearest = Number.POSITIVE_INFINITY;
  for (const point of points) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z));
  return Number.isFinite(nearest) ? nearest : null;
}

function withoutScore(candidate: SiteCandidate): BattleShowcaseSite {
  const { score: _score, ...site } = candidate;
  return site;
}

function normalize2(
  x: number,
  z: number,
  fallbackX: number,
  fallbackZ: number,
): BattleShowcasePoint {
  const length = Math.hypot(x, z);
  return length > 1e-8
    ? { x: x / length, z: z / length }
    : { x: fallbackX, z: fallbackZ };
}

function unitHash(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb_352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846c_a68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-8, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
