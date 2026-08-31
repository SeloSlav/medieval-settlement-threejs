import type { BattleShowcaseSite } from './battleShowcase.ts';
import type {
  CombatAgentFaction,
  CombatAgentState,
  CombatAgentStatus,
} from '../security/combatAgents.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  parseSeedHex,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../world/worldTerrainPresets.ts';
import type { MilitaryCompanyState } from '../security/militaryProgression.ts';
import { militaryCompanyKindForFaction } from '../security/militaryCompanyPresentation.ts';
import {
  CanonicalCombatSteeringGrid,
  engagementSlotAngle,
  engagementSlotRadius,
  rangedLineDepth,
  rangedLineLateral,
  rangedPreferredDistance,
  type CombatSteeringAgent,
  type CombatSteeringBounds,
} from '../security/combatSteering.ts';

export const COMBAT_PLAYTEST_QUERY_PARAMETER = 'combatPlaytest';
export const COMBAT_PLAYTEST_PRESET_PARAMETER = 'combatPreset';
export const COMBAT_PLAYTEST_SEED_PARAMETER = 'combatSeed';
export const DEFAULT_COMBAT_PLAYTEST_SEED = 0x431a_2e0d;
export const COMBAT_PLAYTEST_AGENT_PREFIX = 'combat-playtest:';
export const COMBAT_PLAYTEST_RANGED_TARGET_RETENTION_FACTOR = 1.35;

export type CombatPlaytestPreset = 'skirmish' | 'field' | 'stress';

export type CombatPlaytestRequest = {
  enabled: true;
  preset: CombatPlaytestPreset;
  seed: number;
};

export type CombatPlaytestPresetDefinition = {
  label: string;
  membersPerCompany: number;
  friendlyCount: number;
  enemyCount: number;
};

export type CombatPlaytestSummary = {
  preset: CombatPlaytestPreset;
  seed: number;
  friendlyAlive: number;
  friendlyTotal: number;
  enemyAlive: number;
  enemyTotal: number;
  outcome: 'active' | 'croatian-victory' | 'ottoman-victory';
};

export type CombatPlaytestCamera = {
  targetX: number;
  targetZ: number;
  yaw: number;
  pitch: number;
  distance: number;
};

type CombatPlaytestSimulationOptions = {
  site: Pick<BattleShowcaseSite, 'x' | 'z' | 'axisX' | 'axisZ'>;
  playableHalf: number;
  preset: CombatPlaytestPreset;
  seed: number;
};

type RuntimeAgent = CombatSteeringAgent & {
  state: CombatAgentState;
  attackCooldown: number;
  orderX: number | null;
  orderZ: number | null;
  orderMode: 'move' | 'attack' | null;
  targetRuntime: RuntimeAgent | null;
  companySize: number;
  rangedLateral: number;
  rangedDepth: number;
  rangedEngagement: RangedCompanyEngagement | null;
  meleeEngaging: boolean;
  meleeEngagementTargetId: string | null;
  meleeEngagementRank: number;
};

export type MeleeEngagementRankMember = Pick<
  CombatSteeringAgent,
  'steeringSeed' | 'steeringTeam' | 'steeringCompany' | 'steeringEnabled'
> & {
  state: { sourceSlot: number };
  meleeEngaging: boolean;
  meleeEngagementTargetId: string | null;
  meleeEngagementRank: number;
};

type RangedCompanyEngagement = {
  companyId: string;
  steeringCompany: number;
  centerX: number;
  centerZ: number;
  livingMembers: number;
  designatedTarget: RuntimeAgent | null;
  anchorX: number;
  anchorZ: number;
  awayX: number;
  awayZ: number;
  acquisitionRange: number;
};

type CombatStats = {
  health: number;
  damage: number;
  cadence: number;
  range: number;
  speed: number;
  detection: number;
  minimumRange?: number;
};

type CombatPlaytestOverlayOptions = {
  request: CombatPlaytestRequest;
  onReset: () => void;
  onPreset: (preset: CombatPlaytestPreset) => void;
};

const FRIENDLY_FACTIONS = [
  'militia',
  'spearman',
  'man-at-arms',
  'footman',
  'mercenary-spear',
  'polearm',
  'bowman',
  'crossbow',
] as const satisfies readonly CombatAgentFaction[];

const PRESETS: Readonly<Record<CombatPlaytestPreset, CombatPlaytestPresetDefinition>> = {
  skirmish: {
    label: 'Skirmish',
    membersPerCompany: 4,
    friendlyCount: 32,
    enemyCount: 32,
  },
  field: {
    label: 'Field battle',
    membersPerCompany: 8,
    friendlyCount: 64,
    enemyCount: 64,
  },
  stress: {
    label: 'Stress 512',
    membersPerCompany: 32,
    friendlyCount: 256,
    enemyCount: 256,
  },
};

const COMBAT_STATS: Readonly<Record<CombatAgentFaction, CombatStats>> = {
  guard: { health: 76, damage: 10, cadence: 1.25, range: 1.7, speed: 2, detection: 6 },
  raider: { health: 88, damage: 11, cadence: 1.12, range: 1.55, speed: 2.25, detection: 100 },
  bandit: { health: 70, damage: 8, cadence: 1.3, range: 1.55, speed: 2, detection: 8 },
  militia: { health: 68, damage: 8, cadence: 1.3, range: 1.65, speed: 1.9, detection: 6 },
  spearman: {
    health: 74, damage: 11.5, cadence: 1, range: 2.6, speed: 2.25, detection: 10,
  },
  'man-at-arms': {
    health: 96, damage: 15, cadence: 0.92, range: 2.05, speed: 2.15, detection: 12,
  },
  crossbow: {
    health: 58, damage: 18, cadence: 2.45, range: 17.5,
    speed: 2.25, detection: 19, minimumRange: 7.25,
  },
  'mercenary-spear': { health: 82, damage: 13, cadence: 1.35, range: 2.15, speed: 1.95, detection: 7 },
  footman: { health: 82, damage: 11, cadence: 1.15, range: 1.55, speed: 2, detection: 6 },
  polearm: {
    health: 70, damage: 17.5, cadence: 1.08, range: 2.85, speed: 2.3, detection: 11,
  },
  bowman: {
    health: 55, damage: 10.5, cadence: 1.55, range: 20,
    speed: 2.5, detection: 22, minimumRange: 8,
  },
  dog: { health: 80, damage: 13, cadence: 1.05, range: 1.7, speed: 3.15, detection: 52 },
  fox: { health: 34, damage: 5, cadence: 1.4, range: 1.4, speed: 3.35, detection: 14 },
  wolf: { health: 68, damage: 9, cadence: 1.15, range: 1.7, speed: 2.55, detection: 12 },
};

const ATTACK_ORDER_PICK_RADIUS = 4.5;

export function parseCombatPlaytestRequest(search: string): CombatPlaytestRequest | null {
  const params = new URLSearchParams(search);
  const requested = params.get(COMBAT_PLAYTEST_QUERY_PARAMETER);
  if (requested !== '1' && requested !== 'true') return null;
  const preset = parsePreset(params.get(COMBAT_PLAYTEST_PRESET_PARAMETER));
  const parsedSeed = parseSeedHex(params.get(COMBAT_PLAYTEST_SEED_PARAMETER) ?? '');
  return {
    enabled: true,
    preset,
    seed: parsedSeed ?? DEFAULT_COMBAT_PLAYTEST_SEED,
  };
}

/** A fixed production Delnice world; it is never published to SpacetimeDB. */
export function combatPlaytestWorldSettings(seed: number): WorldGenerationSettings {
  return applyTerrainPreset({
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: seed >>> 0,
    mapSize: 'medium',
    conflictMode: 'peaceful',
    enemyPressure: 0,
    banditCampsEnabled: false,
  }, 'delnice_meadow');
}

export function combatPlaytestPresetDefinition(
  preset: CombatPlaytestPreset,
): CombatPlaytestPresetDefinition {
  return PRESETS[preset];
}

export function combatPlaytestCamera(
  site: Pick<BattleShowcaseSite, 'x' | 'z' | 'axisX' | 'axisZ'>,
): CombatPlaytestCamera {
  const axisAngle = Math.atan2(site.axisZ, site.axisX);
  return {
    targetX: site.x,
    targetZ: site.z,
    yaw: -118 * Math.PI / 180 + axisAngle,
    pitch: 22 * Math.PI / 180,
    // Keep the sandbox close enough to inspect hand grips, bow strings and
    // hit reactions. The live camera remains player-controlled after this
    // initial framing, so the complete battlefield is still one wheel-out.
    distance: 32,
  };
}

/**
 * Disposable client-only combat authority used solely by the playtest route.
 * It owns no GameState or SpacetimeDB rows and returns fresh render snapshots.
 */
export class CombatPlaytestSimulation {
  private readonly site: CombatPlaytestSimulationOptions['site'];
  private readonly playableHalf: number;
  private readonly seed: number;
  private readonly runtime = new Map<string, RuntimeAgent>();
  private readonly runtimeList: RuntimeAgent[] = [];
  private readonly livingFriendlies: RuntimeAgent[] = [];
  private readonly livingEnemies: RuntimeAgent[] = [];
  private readonly pendingDamage = new Map<string, number>();
  private readonly rangedEngagements = new Map<string, RangedCompanyEngagement>();
  private readonly meleeRankCounts = new Map<string, number>();
  private readonly steering = new CanonicalCombatSteeringGrid(1_024);
  private readonly steeringBounds: CombatSteeringBounds;
  private preset: CombatPlaytestPreset;
  private elapsedSeconds = 0;

  constructor(options: CombatPlaytestSimulationOptions) {
    this.site = { ...options.site };
    this.playableHalf = Math.max(28, finiteOr(options.playableHalf, 248));
    this.steeringBounds = {
      minX: -this.playableHalf + 2,
      maxX: this.playableHalf - 2,
      minZ: -this.playableHalf + 2,
      maxZ: this.playableHalf - 2,
    };
    this.seed = options.seed >>> 0;
    this.preset = options.preset;
    this.reset(options.preset);
  }

  reset(preset: CombatPlaytestPreset = this.preset): void {
    this.preset = preset;
    this.elapsedSeconds = 0;
    this.runtime.clear();
    this.runtimeList.length = 0;
    this.livingFriendlies.length = 0;
    this.livingEnemies.length = 0;
    this.pendingDamage.clear();
    this.rangedEngagements.clear();
    this.meleeRankCounts.clear();
    this.spawnFriendlies(PRESETS[preset].membersPerCompany);
    this.spawnEnemies(PRESETS[preset].membersPerCompany);
  }

  getPreset(): CombatPlaytestPreset {
    return this.preset;
  }

  getSeed(): number {
    return this.seed;
  }

  rangedCompanyTarget(companyId: string): string | null {
    return this.rangedEngagements.get(companyId)?.designatedTarget?.state.id ?? null;
  }

  snapshot(): Map<string, CombatAgentState> {
    const agents = new Map<string, CombatAgentState>();
    for (const [id, runtime] of this.runtime) {
      agents.set(id, {
        ...runtime.state,
        attackCooldown: runtime.attackCooldown,
      });
    }
    return agents;
  }

  /** Mirrors the sandbox's per-agent formations into the ordinary inspector
   * shape. This keeps the playtest isolated while exercising the real unit
   * card instead of a bespoke debug panel. */
  companyStates(): Map<string, MilitaryCompanyState> {
    const grouped = new Map<string, RuntimeAgent[]>();
    for (const runtime of this.runtime.values()) {
      const companyId = runtime.state.companyId;
      if (!companyId || runtime.state.faction === 'raider') continue;
      const members = grouped.get(companyId) ?? [];
      members.push(runtime);
      grouped.set(companyId, members);
    }
    const companies = new Map<string, MilitaryCompanyState>();
    for (const [id, members] of grouped) {
      const kind = militaryCompanyKindForFaction(members[0]!.state.faction);
      if (!kind) continue;
      const living = members.filter((member) => member.state.status !== 'downed');
      const readiness = living.length > 0
        ? living.reduce((sum, member) => sum + member.state.readiness, 0) / living.length
        : 0;
      const healthFraction = living.length > 0
        ? living.reduce((sum, member) => (
          sum + member.state.health / Math.max(1, member.state.maxHealth)
        ), 0) / living.length
        : 0;
      const fightingFraction = living.length > 0
        ? living.filter((member) => member.state.status === 'fighting').length / living.length
        : 0;
      const ammunitionPerMember = kind === 'crossbows'
        ? 18
        : kind === 'bowmen' ? 24 : 0;
      const ammunitionCapacity = ammunitionPerMember * members.length;
      companies.set(id, {
        id,
        kind,
        sourceBuildingId: `${COMBAT_PLAYTEST_AGENT_PREFIX}field-command`,
        status: living.length > 0 ? 'active' : 'destroyed',
        formation: 'line',
        targetSize: members.length,
        livingMembers: living.length,
        morale: clamp(readiness * 0.7 + healthFraction * 0.3, 0, 1),
        cohesion: clamp(healthFraction, 0, 1),
        fatigue: clamp(0.12 + fightingFraction * 0.38, 0, 1),
        provisionDays: 3,
        ammunition: ammunitionCapacity,
        ammunitionCapacity,
        formedTick: 0,
        experience: 0,
        level: 1,
      });
    }
    return companies;
  }

  summary(): CombatPlaytestSummary {
    let friendlyAlive = 0;
    let friendlyTotal = 0;
    let enemyAlive = 0;
    let enemyTotal = 0;
    for (const runtime of this.runtime.values()) {
      if (runtime.state.faction === 'raider') {
        enemyTotal += 1;
        if (runtime.state.status !== 'downed') enemyAlive += 1;
      } else {
        friendlyTotal += 1;
        if (runtime.state.status !== 'downed') friendlyAlive += 1;
      }
    }
    return {
      preset: this.preset,
      seed: this.seed,
      friendlyAlive,
      friendlyTotal,
      enemyAlive,
      enemyTotal,
      outcome: friendlyAlive === 0
        ? 'ottoman-victory'
        : enemyAlive === 0 ? 'croatian-victory' : 'active',
    };
  }

  issueOrder(agentIds: readonly string[], x: number, z: number): number {
    const companyIds = new Set<string>();
    for (const id of agentIds) {
      const runtime = this.runtime.get(id);
      if (
        runtime
        && runtime.state.status !== 'downed'
        && runtime.state.faction !== 'raider'
        && runtime.state.companyId
      ) {
        companyIds.add(runtime.state.companyId);
      }
    }
    const destinationX = clamp(x, -this.playableHalf + 3, this.playableHalf - 3);
    const destinationZ = clamp(z, -this.playableHalf + 3, this.playableHalf - 3);
    const attackOrder = [...this.runtime.values()].some((runtime) =>
      runtime.state.faction === 'raider'
      && runtime.state.status !== 'downed'
      && Math.hypot(runtime.state.x - destinationX, runtime.state.z - destinationZ)
        <= ATTACK_ORDER_PICK_RADIUS
    );
    for (const companyId of companyIds) {
      const members = [...this.runtime.values()].filter((runtime) =>
        runtime.state.companyId === companyId && runtime.state.status !== 'downed'
      );
      if (members.length === 0) continue;
      const centerX = members.reduce((sum, runtime) => sum + runtime.state.x, 0) / members.length;
      const centerZ = members.reduce((sum, runtime) => sum + runtime.state.z, 0) / members.length;
      for (const runtime of members) {
        runtime.orderX = clamp(
          destinationX + runtime.state.x - centerX,
          -this.playableHalf + 2,
          this.playableHalf - 2,
        );
        runtime.orderZ = clamp(
          destinationZ + runtime.state.z - centerZ,
          -this.playableHalf + 2,
          this.playableHalf - 2,
        );
        runtime.orderMode = attackOrder ? 'attack' : 'move';
        this.setStatus(runtime, 'advancing');
        runtime.state.targetKind = 'ground';
        runtime.state.targetId = `${COMBAT_PLAYTEST_AGENT_PREFIX}ordered-ground`;
      }
    }
    return companyIds.size;
  }

  tick(deltaSeconds: number): void {
    const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.05);
    if (dt <= 0) return;
    this.elapsedSeconds += dt;
    this.livingFriendlies.length = 0;
    this.livingEnemies.length = 0;
    for (const runtime of this.runtimeList) {
      runtime.steeringEnabled = runtime.state.status !== 'downed';
      runtime.steeringGoalX = runtime.state.x;
      runtime.steeringGoalZ = runtime.state.z;
      runtime.steeringSpeed = this.statsFor(runtime).speed;
      if (!runtime.steeringEnabled) continue;
      runtime.attackCooldown = Math.max(0, runtime.attackCooldown - dt);
      if (runtime.state.faction === 'raider') {
        this.livingEnemies.push(runtime);
      } else {
        this.livingFriendlies.push(runtime);
      }
    }
    if (this.livingFriendlies.length === 0 || this.livingEnemies.length === 0) {
      for (const survivor of this.runtimeList) {
        if (!survivor.steeringEnabled) continue;
        this.setStatus(survivor, 'holding');
        survivor.state.routeProgress = 0;
      }
      return;
    }

    this.refreshRangedCompanyEngagements();
    this.refreshMeleeEngagementRanks();

    this.pendingDamage.clear();
    for (const friendly of this.livingFriendlies) {
      this.updateFriendly(friendly, this.livingEnemies, this.pendingDamage);
    }
    for (const enemy of this.livingEnemies) {
      this.updateEnemy(enemy, this.livingFriendlies, this.pendingDamage);
    }
    this.steering.update(
      this.runtimeList,
      this.runtimeList.length,
      dt,
      this.steeringBounds,
    );
    for (const [targetId, damage] of this.pendingDamage) {
      const target = this.runtime.get(targetId);
      if (!target || target.state.status === 'downed') continue;
      target.state.health = Math.max(0, target.state.health - damage);
      if (target.state.health > 0) continue;
      this.setStatus(target, 'downed');
      target.orderX = null;
      target.orderZ = null;
      target.orderMode = null;
      target.targetRuntime = null;
      target.steeringEnabled = false;
      target.steeringVelocityX = 0;
      target.steeringVelocityZ = 0;
      target.state.routeProgress = 0;
      target.state.targetKind = 'ground';
      target.state.targetId = `${COMBAT_PLAYTEST_AGENT_PREFIX}fallen`;
    }
  }

  private updateFriendly(
    runtime: RuntimeAgent,
    enemies: readonly RuntimeAgent[],
    pendingDamage: Map<string, number>,
  ): void {
    const stats = this.statsFor(runtime);
    const ordered = runtime.orderX !== null && runtime.orderZ !== null;
    if (ordered && runtime.orderMode === 'move') {
      const remaining = this.steerToward(runtime, runtime.orderX!, runtime.orderZ!, stats.speed);
      runtime.state.targetKind = 'ground';
      runtime.state.targetId = `${COMBAT_PLAYTEST_AGENT_PREFIX}ordered-ground`;
      if (remaining <= 0.08) {
        runtime.orderX = null;
        runtime.orderZ = null;
        runtime.orderMode = null;
        this.setStatus(runtime, 'holding');
        runtime.state.routeProgress = 0;
      }
      return;
    }

    const opponent = this.currentOpponent(runtime, enemies);
    if (!opponent) return;
    const opponentDistance = distanceBetween(runtime, opponent);

    if (stats.minimumRange && opponentDistance < stats.minimumRange) {
      this.setRangedEngagementGoal(runtime, opponent, stats);
      this.setStatus(runtime, 'fighting');
      runtime.state.targetKind = 'combat-agent';
      runtime.state.targetId = opponent.state.id;
      runtime.state.routeProgress = opponentDistance;
      return;
    }
    if (opponentDistance <= stats.range) {
      this.setEngagementGoal(runtime, opponent, stats);
      this.attack(runtime, opponent, stats, pendingDamage);
      return;
    }

    if (ordered && runtime.orderMode === 'attack') {
      this.chase(runtime, opponent, stats);
      return;
    }

    if (opponentDistance <= stats.detection) {
      this.chase(runtime, opponent, stats);
      return;
    }
    this.setStatus(runtime, 'holding');
    runtime.state.routeProgress = 0;
  }

  private updateEnemy(
    runtime: RuntimeAgent,
    friendlies: readonly RuntimeAgent[],
    pendingDamage: Map<string, number>,
  ): void {
    const opponent = this.currentOpponent(runtime, friendlies);
    if (!opponent) return;
    const stats = COMBAT_STATS.raider;
    if (distanceBetween(runtime, opponent) <= stats.range) {
      this.setEngagementGoal(runtime, opponent, stats);
      this.attack(runtime, opponent, stats, pendingDamage);
      return;
    }
    this.chase(runtime, opponent, stats);
  }

  private chase(
    runtime: RuntimeAgent,
    opponent: RuntimeAgent,
    stats: CombatStats,
  ): void {
    this.setEngagementGoal(runtime, opponent, stats);
    const remaining = Math.hypot(
      runtime.steeringGoalX - runtime.state.x,
      runtime.steeringGoalZ - runtime.state.z,
    );
    this.setStatus(runtime, 'advancing');
    runtime.state.targetKind = 'combat-agent';
    runtime.state.targetId = opponent.state.id;
    runtime.state.routeProgress = remaining;
  }

  private setEngagementGoal(
    runtime: RuntimeAgent,
    opponent: RuntimeAgent,
    stats: CombatStats,
  ): void {
    if (stats.minimumRange) {
      this.setRangedEngagementGoal(runtime, opponent, stats);
      return;
    }
    const angle = engagementSlotAngle(
      runtime.meleeEngagementRank,
      runtime.steeringCompany,
      opponent.steeringSeed,
    );
    const radius = engagementSlotRadius(stats.range, runtime.meleeEngagementRank);
    runtime.steeringGoalX = opponent.state.x + Math.cos(angle) * radius;
    runtime.steeringGoalZ = opponent.state.z + Math.sin(angle) * radius;
    runtime.steeringSpeed = stats.speed;
  }

  private setRangedEngagementGoal(
    runtime: RuntimeAgent,
    opponent: RuntimeAgent,
    stats: CombatStats,
  ): void {
    const engagement = runtime.rangedEngagement;
    let anchorX = opponent.state.x;
    let anchorZ = opponent.state.z;
    let awayX: number;
    let awayZ: number;
    if (engagement && engagement.designatedTarget === opponent) {
      // Every member consumes one shared company frame. Individual nearest
      // enemies may be spread widely, but cannot twist each slot into a
      // different radial fan.
      anchorX = engagement.anchorX;
      anchorZ = engagement.anchorZ;
      awayX = engagement.awayX;
      awayZ = engagement.awayZ;
    } else {
      let dx = runtime.state.x - anchorX;
      let dz = runtime.state.z - anchorZ;
      let distance = Math.hypot(dx, dz);
      if (distance <= 1e-6) {
        const angle = unitHash(this.seed ^ hashString(runtime.state.id)) * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
        distance = 1;
      }
      awayX = dx / distance;
      awayZ = dz / distance;
    }
    const preferredDistance = rangedPreferredDistance(stats.range) + runtime.rangedDepth;
    runtime.steeringGoalX = anchorX
      + awayX * preferredDistance
      - awayZ * runtime.rangedLateral;
    runtime.steeringGoalZ = anchorZ
      + awayZ * preferredDistance
      + awayX * runtime.rangedLateral;
    runtime.steeringSpeed = stats.speed;
  }

  private steerToward(
    runtime: RuntimeAgent,
    targetX: number,
    targetZ: number,
    speed: number,
  ): number {
    const dx = targetX - runtime.state.x;
    const dz = targetZ - runtime.state.z;
    const distance = Math.hypot(dx, dz);
    runtime.steeringGoalX = targetX;
    runtime.steeringGoalZ = targetZ;
    runtime.steeringSpeed = speed;
    this.setStatus(runtime, 'advancing');
    runtime.state.routeProgress = distance;
    return distance;
  }

  private currentOpponent(
    runtime: RuntimeAgent,
    candidates: readonly RuntimeAgent[],
  ): RuntimeAgent | null {
    if (runtime.rangedEngagement) {
      const companyTarget = runtime.rangedEngagement.designatedTarget;
      if (companyTarget && companyTarget.state.status !== 'downed') {
        runtime.targetRuntime = companyTarget;
        runtime.state.targetKind = 'combat-agent';
        runtime.state.targetId = companyTarget.state.id;
        return companyTarget;
      }
      runtime.targetRuntime = null;
      return null;
    }
    const current = runtime.targetRuntime;
    if (
      current
      && current.state.status !== 'downed'
      && current.steeringTeam !== runtime.steeringTeam
    ) {
      return current;
    }
    const next = nearestOpponent(runtime, candidates);
    runtime.targetRuntime = next;
    return next;
  }

  private refreshRangedCompanyEngagements(): void {
    for (const engagement of this.rangedEngagements.values()) {
      engagement.centerX = 0;
      engagement.centerZ = 0;
      engagement.livingMembers = 0;
    }
    for (const runtime of this.livingFriendlies) {
      const engagement = runtime.rangedEngagement;
      if (!engagement) continue;
      engagement.centerX += runtime.state.x;
      engagement.centerZ += runtime.state.z;
      engagement.livingMembers += 1;
    }
    for (const engagement of this.rangedEngagements.values()) {
      if (engagement.livingMembers <= 0) {
        engagement.designatedTarget = null;
        continue;
      }
      engagement.centerX /= engagement.livingMembers;
      engagement.centerZ /= engagement.livingMembers;
      let target = engagement.designatedTarget;
      const retentionRange = engagement.acquisitionRange
        * COMBAT_PLAYTEST_RANGED_TARGET_RETENTION_FACTOR;
      const targetDistanceSq = target
        ? (target.state.x - engagement.centerX) ** 2
          + (target.state.z - engagement.centerZ) ** 2
        : Number.POSITIVE_INFINITY;
      if (
        !target
        || target.state.status === 'downed'
        || targetDistanceSq > retentionRange * retentionRange
      ) {
        target = nearestOpponentPoint(
          engagement.centerX,
          engagement.centerZ,
          this.livingEnemies,
          engagement.acquisitionRange,
        );
        engagement.designatedTarget = target;
      }
      if (!target) continue;
      engagement.anchorX = target.state.x;
      engagement.anchorZ = target.state.z;
      let awayX = engagement.centerX - engagement.anchorX;
      let awayZ = engagement.centerZ - engagement.anchorZ;
      let awayLength = Math.hypot(awayX, awayZ);
      if (awayLength <= 1e-6) {
        const angle = unitHash(this.seed ^ engagement.steeringCompany) * Math.PI * 2;
        awayX = Math.cos(angle);
        awayZ = Math.sin(angle);
        awayLength = 1;
      }
      engagement.awayX = awayX / awayLength;
      engagement.awayZ = awayZ / awayLength;
    }
  }

  private refreshMeleeEngagementRanks(): void {
    for (const runtime of this.runtimeList) {
      runtime.meleeEngaging = false;
      runtime.meleeEngagementTargetId = null;
      runtime.meleeEngagementRank = 0;
      if (!runtime.steeringEnabled || runtime.rangedEngagement) continue;
      if (runtime.orderMode === 'move') continue;
      const candidates = runtime.state.faction === 'raider'
        ? this.livingFriendlies
        : this.livingEnemies;
      const target = this.currentOpponent(runtime, candidates);
      if (!target) continue;
      const stats = this.statsFor(runtime);
      const shouldEngage = runtime.state.faction === 'raider'
        || runtime.orderMode === 'attack'
        || distanceBetween(runtime, target) <= stats.detection;
      if (!shouldEngage) continue;
      runtime.meleeEngaging = true;
      runtime.meleeEngagementTargetId = target.state.id;
    }
    assignDenseMeleeEngagementRanks(this.runtimeList, this.meleeRankCounts);
  }

  private attack(
    runtime: RuntimeAgent,
    opponent: RuntimeAgent,
    stats: CombatStats,
    pendingDamage: Map<string, number>,
  ): void {
    this.setStatus(runtime, 'fighting');
    runtime.state.targetKind = 'combat-agent';
    runtime.state.targetId = opponent.state.id;
    runtime.state.routeProgress = 0;
    if (runtime.attackCooldown > 0) return;
    pendingDamage.set(
      opponent.state.id,
      (pendingDamage.get(opponent.state.id) ?? 0) + stats.damage,
    );
    const cadenceJitter = 0.92 + unitHash(
      this.seed ^ hashString(runtime.state.id) ^ Math.floor(this.elapsedSeconds * 4),
    ) * 0.16;
    runtime.attackCooldown = stats.cadence * cadenceJitter;
  }

  private statsFor(runtime: RuntimeAgent): CombatStats {
    return COMBAT_STATS[runtime.state.faction];
  }

  private setStatus(runtime: RuntimeAgent, status: CombatAgentStatus): void {
    if (runtime.state.status === status) return;
    runtime.state.status = status;
    runtime.state.stateChangedTick += 1;
  }

  private spawnFriendlies(membersPerCompany: number): void {
    FRIENDLY_FACTIONS.forEach((faction, companyIndex) => {
      const companyId = `${COMBAT_PLAYTEST_AGENT_PREFIX}company:${faction}`;
      const lane = companyIndex % 3 - 1;
      const companyRank = Math.floor(companyIndex / 3);
      const centerAxial = -10.5 - companyRank * 5.8;
      const centerLateral = lane * 7;
      const offsets = formationOffsets(membersPerCompany);
      offsets.forEach((offset, memberIndex) => {
        const id = `${COMBAT_PLAYTEST_AGENT_PREFIX}croatian:${faction}:${String(memberIndex + 1).padStart(2, '0')}`;
        const jitter = deterministicOffset(this.seed ^ hashString(id));
        const point = this.localPoint(
          centerAxial + offset.axial + jitter.axial,
          centerLateral + offset.lateral + jitter.lateral,
        );
        const runtime = this.createRuntimeAgent({
          id,
          faction,
          companyId,
          raidId: companyId,
          sourceSlot: memberIndex,
          x: point.x,
          z: point.z,
          companySize: membersPerCompany,
        });
        this.runtime.set(id, runtime);
        this.runtimeList.push(runtime);
      });
    });
  }

  private spawnEnemies(membersPerWarband: number): void {
    for (let warbandIndex = 0; warbandIndex < FRIENDLY_FACTIONS.length; warbandIndex += 1) {
      const lane = warbandIndex % 3 - 1;
      const warbandRank = Math.floor(warbandIndex / 3);
      const centerAxial = 10.5 + warbandRank * 5.8;
      const centerLateral = -lane * 7;
      const raidId = `${COMBAT_PLAYTEST_AGENT_PREFIX}ottoman-warband:${warbandIndex + 1}`;
      const offsets = formationOffsets(membersPerWarband);
      offsets.forEach((offset, memberIndex) => {
        const id = `${COMBAT_PLAYTEST_AGENT_PREFIX}ottoman:${String(warbandIndex + 1).padStart(2, '0')}:${String(memberIndex + 1).padStart(2, '0')}`;
        const jitter = deterministicOffset(this.seed ^ hashString(id));
        const point = this.localPoint(
          centerAxial - offset.axial + jitter.axial,
          centerLateral + offset.lateral + jitter.lateral,
        );
        const runtime = this.createRuntimeAgent({
          id,
          faction: 'raider',
          companyId: null,
          raidId,
          sourceSlot: memberIndex,
          x: point.x,
          z: point.z,
          companySize: membersPerWarband,
        });
        this.runtime.set(id, runtime);
        this.runtimeList.push(runtime);
      });
    }
  }

  private createRuntimeAgent(input: {
    id: string;
    faction: CombatAgentFaction;
    companyId: string | null;
    raidId: string;
    sourceSlot: number;
    x: number;
    z: number;
    companySize: number;
  }): RuntimeAgent {
    const stats = COMBAT_STATS[input.faction];
    const steeringCompany = hashString(input.companyId ?? input.raidId) || 1;
    let rangedEngagement: RangedCompanyEngagement | null = null;
    if (stats.minimumRange && input.companyId) {
      rangedEngagement = this.rangedEngagements.get(input.companyId) ?? null;
      if (!rangedEngagement) {
        rangedEngagement = {
          companyId: input.companyId,
          steeringCompany,
          centerX: input.x,
          centerZ: input.z,
          livingMembers: 0,
          designatedTarget: null,
          anchorX: input.x,
          anchorZ: input.z,
          awayX: 1,
          awayZ: 0,
          acquisitionRange: stats.detection,
        };
        this.rangedEngagements.set(input.companyId, rangedEngagement);
      }
    }
    return {
      state: {
        id: input.id,
        raidId: input.raidId,
        faction: input.faction,
        sourceBuildingId: null,
        sourceSlot: input.sourceSlot,
        targetKind: 'ground',
        targetId: `${COMBAT_PLAYTEST_AGENT_PREFIX}staging-ground`,
        x: input.x,
        z: input.z,
        homeX: input.x,
        homeZ: input.z,
        health: stats.health,
        maxHealth: stats.health,
        readiness: input.faction === 'raider' ? 0.72 : 0.82,
        status: input.faction === 'raider' ? 'advancing' : 'holding',
        attackCooldown: 0,
        lootProgress: 0,
        carryingLoot: false,
        issuedPolearms: input.faction === 'spearman' || input.faction === 'polearm' ? 1 : 0,
        raidAnchorBuildingId: null,
        banditCampId: null,
        companyId: input.companyId,
        homeResidenceId: null,
        personIdentity: null,
        stateChangedTick: 0,
        routeProgress: input.faction === 'raider' ? 18 : 0,
      },
      attackCooldown: COMBAT_STATS[input.faction].cadence
        * unitHash(this.seed ^ hashString(input.id)),
      orderX: null,
      orderZ: null,
      orderMode: null,
      targetRuntime: null,
      companySize: input.companySize,
      rangedLateral: rangedLineLateral(input.sourceSlot, input.companySize),
      rangedDepth: rangedLineDepth(input.sourceSlot, input.companySize),
      rangedEngagement,
      meleeEngaging: false,
      meleeEngagementTargetId: null,
      meleeEngagementRank: 0,
      steeringSeed: this.seed ^ hashString(input.id),
      steeringTeam: input.faction === 'raider' ? 2 : 1,
      steeringCompany,
      steeringEnabled: true,
      steeringGoalX: input.x,
      steeringGoalZ: input.z,
      steeringSpeed: stats.speed,
      steeringVelocityX: 0,
      steeringVelocityZ: 0,
    };
  }

  private localPoint(axial: number, lateral: number): { x: number; z: number } {
    return {
      x: this.site.x + this.site.axisX * axial - this.site.axisZ * lateral,
      z: this.site.z + this.site.axisZ * axial + this.site.axisX * lateral,
    };
  }
}

/**
 * Dense stable rank among living melee bodies in one company/target cohort.
 * Source slots remain the tie-breaker, but casualties no longer leave holes
 * that strand surviving attackers on outer rings beyond weapon reach.
 */
export function assignDenseMeleeEngagementRanks(
  members: readonly MeleeEngagementRankMember[],
  counts: Map<string, number>,
): void {
  let previousTeam = Number.NaN;
  let previousCompany = Number.NaN;
  for (const candidate of members) {
    if (
      candidate.steeringTeam !== previousTeam
      || candidate.steeringCompany !== previousCompany
    ) {
      counts.clear();
      previousTeam = candidate.steeringTeam;
      previousCompany = candidate.steeringCompany;
    }
    if (
      !candidate.steeringEnabled
      || !candidate.meleeEngaging
      || candidate.meleeEngagementTargetId === null
    ) {
      candidate.meleeEngagementRank = 0;
      continue;
    }
    const rank = counts.get(candidate.meleeEngagementTargetId) ?? 0;
    candidate.meleeEngagementRank = rank;
    counts.set(candidate.meleeEngagementTargetId, rank + 1);
  }
}

export class CombatPlaytestOverlay {
  readonly element: HTMLElement;
  private readonly friendly: HTMLElement;
  private readonly enemy: HTMLElement;
  private readonly outcome: HTMLElement;
  private readonly presetButtons = new Map<CombatPlaytestPreset, HTMLButtonElement>();

  constructor(parent: HTMLElement, options: CombatPlaytestOverlayOptions) {
    this.element = document.createElement('aside');
    this.element.className = 'combat-playtest-overlay';
    this.element.dataset.combatPlaytestOverlay = 'true';
    this.element.innerHTML = `
      <div class="combat-playtest-overlay__eyebrow">Local combat sandbox · save isolated</div>
      <div class="combat-playtest-overlay__header">
        <strong>Production-world battle playtest</strong>
        <button type="button" data-combat-playtest-reset>Reset</button>
      </div>
      <div class="combat-playtest-overlay__counts" aria-live="polite">
        <span data-combat-playtest-friendly></span>
        <span data-combat-playtest-enemy></span>
        <span data-combat-playtest-outcome></span>
      </div>
      <div class="combat-playtest-overlay__presets" aria-label="Spawn presets">
        <button type="button" data-combat-playtest-preset="skirmish">24 v 24</button>
        <button type="button" data-combat-playtest-preset="field">48 v 48</button>
        <button type="button" data-combat-playtest-preset="stress">256 v 256 stress</button>
      </div>
      <p>Left-click a soldier or drag-select across formations. Right-click terrain or an enemy rank to move/attack. Camera controls remain live.</p>
      <small>Seed <code>${formatSeed(options.request.seed)}</code> · no server connection, reducers, recording, or save writes.</small>
    `;
    parent.append(this.element);
    this.friendly = mustElement(this.element, '[data-combat-playtest-friendly]');
    this.enemy = mustElement(this.element, '[data-combat-playtest-enemy]');
    this.outcome = mustElement(this.element, '[data-combat-playtest-outcome]');
    mustElement<HTMLButtonElement>(this.element, '[data-combat-playtest-reset]')
      .addEventListener('click', options.onReset);
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-combat-playtest-preset]')) {
      const preset = parsePreset(button.dataset.combatPlaytestPreset ?? null);
      this.presetButtons.set(preset, button);
      button.addEventListener('click', () => options.onPreset(preset));
    }
    this.element.addEventListener('mousedown', stopPropagation);
    this.element.addEventListener('pointerdown', stopPropagation);
    this.element.addEventListener('contextmenu', preventDefault);
  }

  update(summary: CombatPlaytestSummary): void {
    this.friendly.textContent = `Croatian ${summary.friendlyAlive} / ${summary.friendlyTotal}`;
    this.enemy.textContent = `Ottoman ${summary.enemyAlive} / ${summary.enemyTotal}`;
    this.outcome.textContent = summary.outcome === 'active'
      ? PRESETS[summary.preset].label
      : summary.outcome === 'croatian-victory' ? 'Croatian victory' : 'Ottoman victory';
    for (const [preset, button] of this.presetButtons) {
      button.setAttribute('aria-pressed', String(preset === summary.preset));
    }
  }

  dispose(): void {
    this.element.removeEventListener('mousedown', stopPropagation);
    this.element.removeEventListener('pointerdown', stopPropagation);
    this.element.removeEventListener('contextmenu', preventDefault);
    this.element.parentElement?.classList.remove('combat-playtest-mode');
    this.element.remove();
  }
}

function formationOffsets(count: number): { axial: number; lateral: number }[] {
  const columns = count <= 4 ? 2 : 4;
  const rows = Math.ceil(count / columns);
  const offsets: { axial: number; lateral: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    offsets.push({
      axial: (row - (rows - 1) * 0.5) * 1.28,
      lateral: (column - (columns - 1) * 0.5) * 1.34 + (row % 2 === 1 ? 0.18 : 0),
    });
  }
  return offsets;
}

function deterministicOffset(seed: number): { axial: number; lateral: number } {
  return {
    axial: (unitHash(seed ^ 0x71ac_93d5) - 0.5) * 0.18,
    lateral: (unitHash(seed ^ 0xb529_7a4d) - 0.5) * 0.18,
  };
}

function nearestOpponent(
  runtime: RuntimeAgent,
  candidates: readonly RuntimeAgent[],
): RuntimeAgent | null {
  let nearest: RuntimeAgent | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = candidate.state.x - runtime.state.x;
    const dz = candidate.state.z - runtime.state.z;
    const distanceSquared = dx * dx + dz * dz;
    if (
      distanceSquared < nearestDistanceSquared
      || (
        distanceSquared === nearestDistanceSquared
        && nearest
        && candidate.state.id < nearest.state.id
      )
    ) {
      nearest = candidate;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function nearestOpponentPoint(
  x: number,
  z: number,
  candidates: readonly RuntimeAgent[],
  maximumDistance: number,
): RuntimeAgent | null {
  let nearest: RuntimeAgent | null = null;
  let nearestDistanceSquared = maximumDistance * maximumDistance;
  for (const candidate of candidates) {
    const dx = candidate.state.x - x;
    const dz = candidate.state.z - z;
    const distanceSquared = dx * dx + dz * dz;
    if (
      distanceSquared < nearestDistanceSquared
      || (
        distanceSquared === nearestDistanceSquared
        && (!nearest || candidate.state.id < nearest.state.id)
      )
    ) {
      nearest = candidate;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function distanceBetween(left: RuntimeAgent, right: RuntimeAgent): number {
  return Math.hypot(
    right.state.x - left.state.x,
    right.state.z - left.state.z,
  );
}

function parsePreset(value: string | null): CombatPlaytestPreset {
  if (value === 'skirmish' || value === 'stress') return value;
  return 'field';
}

function hashString(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x0100_0193);
  }
  return hash >>> 0;
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

function mustElement<T extends HTMLElement = HTMLElement>(
  root: HTMLElement,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Combat playtest overlay is missing ${selector}`);
  return element;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function preventDefault(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16).padStart(8, '0')}`;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
