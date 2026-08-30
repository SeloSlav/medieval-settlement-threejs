import {
  COMBAT_AUDIO_CLIPS,
  COMBAT_DEATH_CLIPS,
  type AudioClipDefinition,
  type CombatAudioSoundKind,
} from './audioCatalog.ts';
import {
  getSoundEffectsVolume,
  isGameAudioEnabled,
} from './audioPreferences.ts';
import type {
  CombatAgentFaction,
  CombatAgentStatus,
  CombatTargetKind,
} from '../security/combatAgents.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';

export const COMBAT_AUDIO_MAX_ZOOM_DISTANCE = 46;
export const COMBAT_AUDIO_FULL_VOLUME_DISTANCE = 10;
export const COMBAT_AUDIO_CUTOFF_DISTANCE = 38;
/** Retained as the legacy melee-pair radius for diagnostics and old callers. */
export const COMBAT_AUDIO_MAX_PAIR_DISTANCE = 6.5;
/** Triple the original 12-per-side battle fits without an unbounded source list. */
export const COMBAT_AUDIO_MAX_SOURCES = 72;
export const COMBAT_AUDIO_WEAPON_POOL_SIZE = 18;
export const COMBAT_AUDIO_CHARGE_POOL_SIZE = 6;
export const COMBAT_AUDIO_MAX_EDGE_PLAYS_PER_TICK = 4;

const MAX_SOURCES_PER_SIDE = COMBAT_AUDIO_MAX_SOURCES / 2;
const DEATH_POOL_SIZE = 3;
const SCHEDULED_GLOBAL_INTERVAL_SECONDS = 0.065;
const CHARGE_GLOBAL_INTERVAL_SECONDS = 0.18;

type CombatAttackSoundKind = Exclude<CombatAudioSoundKind, 'charge'>;
type CombatAudioPhase = 'attack' | 'charge';

export type CombatAudioFighter = {
  id: string;
  faction: CombatAgentFaction;
  status: CombatAgentStatus;
  health: number;
  x: number;
  z: number;
  attackCooldown?: number;
  issuedPolearms?: number;
  targetKind?: CombatTargetKind;
};

export type CombatAudioSource = {
  id: string;
  x: number;
  z: number;
  phase: CombatAudioPhase;
  weaponFamily: CombatAttackSoundKind;
  secondaryWeaponFamily: CombatAttackSoundKind | null;
  defensiveImpact: boolean;
  attackCooldown: number | null;
};

export type CombatAudioSourceWorkspace = {
  guards: CombatAudioFighter[];
  raiders: CombatAudioFighter[];
  sourcePool: CombatAudioSource[];
  sources: CombatAudioSource[];
};

export type CombatAudioLoadout = {
  primary: CombatAttackSoundKind;
  secondary?: CombatAttackSoundKind;
  defensiveImpact: boolean;
};

export function createCombatAudioSourceWorkspace(): CombatAudioSourceWorkspace {
  return {
    guards: [],
    raiders: [],
    sourcePool: [],
    sources: [],
  };
}

/** Maps every currently rendered military tool family to matching Foley. */
export function combatAudioLoadoutForFighter(
  fighter: Pick<CombatAudioFighter, 'faction' | 'issuedPolearms'>,
): CombatAudioLoadout {
  switch (fighter.faction) {
    case 'guard':
      return { primary: 'spear-pike', defensiveImpact: true };
    case 'raider':
      return { primary: 'sword-sidearm', defensiveImpact: false };
    case 'bandit':
    case 'militia':
      return { primary: 'spear-pike', defensiveImpact: false };
    case 'spearman':
      return { primary: 'spear-pike', defensiveImpact: true };
    case 'man-at-arms':
    case 'footman':
      return { primary: 'sword-sidearm', defensiveImpact: true };
    case 'crossbow':
      return { primary: 'crossbow', defensiveImpact: false };
    case 'mercenary-spear':
      return {
        primary: 'spear-pike',
        secondary: 'sword-sidearm',
        defensiveImpact: false,
      };
    case 'polearm':
      return { primary: 'halberd-polearm', defensiveImpact: false };
    case 'bowman':
      return { primary: 'bow', defensiveImpact: false };
    case 'uskok':
      return {
        primary: 'arquebus',
        secondary: 'sword-sidearm',
        defensiveImpact: false,
      };
  }
}

type CombatSoundSchedule = {
  nextScheduledAt: number;
  sequence: number;
  activeGeneration: number;
  phase: CombatAudioPhase;
  previousAttackCooldown: number | null;
};

type CombatSoundCandidate = {
  source: CombatAudioSource;
  gain: number;
  attackEdge: boolean;
  scheduledDue: boolean;
  sequence: number;
};

export function combatAudioGain(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): number {
  if (
    !view
    || view.orbitDistance == null
    || view.orbitDistance > COMBAT_AUDIO_MAX_ZOOM_DISTANCE
  ) {
    return 0;
  }
  const listenerX = view.listenerX ?? view.centerX;
  const listenerZ = view.listenerZ ?? view.centerZ;
  const distance = Math.hypot(x - listenerX, z - listenerZ);
  if (distance <= COMBAT_AUDIO_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= COMBAT_AUDIO_CUTOFF_DISTANCE) return 0;
  return 1 - (
    distance - COMBAT_AUDIO_FULL_VOLUME_DISTANCE
  ) / (
    COMBAT_AUDIO_CUTOFF_DISTANCE - COMBAT_AUDIO_FULL_VOLUME_DISTANCE
  );
}

/**
 * Retains one bounded source per active attacker instead of only close melee
 * pairs. This lets bow, crossbow, and arquebus cooldown resets emit at the
 * shooter's own position while still keeping a triple-size showcase bounded.
 * Advancing fighters become charge/formation-movement sources; holding,
 * retreating, aftermath, and ordinary guard duty remain silent.
 */
export function buildCombatAudioSources(
  fighters: Iterable<CombatAudioFighter>,
  workspace?: CombatAudioSourceWorkspace,
): CombatAudioSource[] {
  const guards = workspace?.guards ?? [];
  const raiders = workspace?.raiders ?? [];
  guards.length = 0;
  raiders.length = 0;
  for (const fighter of fighters) {
    const attacking = fighter.status === 'fighting';
    const charging = fighter.status === 'advancing'
      && fighter.targetKind === 'combat-agent';
    if (
      (!attacking && !charging)
      || !Number.isFinite(fighter.health)
      || fighter.health <= 0
      || !Number.isFinite(fighter.x)
      || !Number.isFinite(fighter.z)
    ) {
      continue;
    }
    const side = fighter.faction === 'raider' || fighter.faction === 'bandit'
      ? raiders
      : guards;
    if (side.length < MAX_SOURCES_PER_SIDE) side.push(fighter);
  }

  guards.sort(compareFighterIds);
  raiders.sort(compareFighterIds);
  const sources = workspace?.sources ?? [];
  sources.length = 0;
  const maxSideLength = Math.max(guards.length, raiders.length);
  for (let index = 0; index < maxSideLength; index += 1) {
    const guard = guards[index];
    const raider = raiders[index];
    if (guard) pushCombatAudioSource(guard, sources, workspace?.sourcePool);
    if (raider) pushCombatAudioSource(raider, sources, workspace?.sourcePool);
  }
  return sources;
}

function compareFighterIds(left: CombatAudioFighter, right: CombatAudioFighter): number {
  return left.id.localeCompare(right.id);
}

function pushCombatAudioSource(
  fighter: CombatAudioFighter,
  sources: CombatAudioSource[],
  sourcePool: CombatAudioSource[] | undefined,
): void {
  const loadout = combatAudioLoadoutForFighter(fighter);
  const sourceIndex = sources.length;
  let source = sourcePool?.[sourceIndex];
  if (!source) {
    source = {
      id: fighter.id,
      x: fighter.x,
      z: fighter.z,
      phase: fighter.status === 'advancing' ? 'charge' : 'attack',
      weaponFamily: loadout.primary,
      secondaryWeaponFamily: loadout.secondary ?? null,
      defensiveImpact: loadout.defensiveImpact,
      attackCooldown: null,
    };
    sourcePool?.push(source);
  }
  source.id = fighter.id;
  source.x = fighter.x;
  source.z = fighter.z;
  source.phase = fighter.status === 'advancing' ? 'charge' : 'attack';
  source.weaponFamily = loadout.primary;
  source.secondaryWeaponFamily = loadout.secondary ?? null;
  source.defensiveImpact = loadout.defensiveImpact;
  source.attackCooldown = Number.isFinite(fighter.attackCooldown)
    ? Math.max(0, Number(fighter.attackCooldown))
    : null;
  sources.push(source);
}

/**
 * Polyphonic, weapon-routed combat Foley. Cooldown reset edges receive a small
 * simultaneous-play budget so volleys and clustered clashes can overlap.
 * Deterministic fallback cadence covers missed server edges and authored
 * showcase motion, while a shared pool and global cadence bound the mix.
 */
export class CombatAudio {
  private readonly weaponPool: HTMLAudioElement[] = [];
  private readonly chargePool: HTMLAudioElement[] = [];
  private readonly deathPool: HTMLAudioElement[] = [];
  private readonly schedules = new Map<string, CombatSoundSchedule>();
  private readonly candidatePool: CombatSoundCandidate[] = [];
  private readonly candidates: CombatSoundCandidate[] = [];
  private activeGeneration = 0;
  private elapsedSeconds = 0;
  private lastScheduledPlayAt = Number.NEGATIVE_INFINITY;
  private lastChargePlayAt = Number.NEGATIVE_INFINITY;

  tick(
    dtSeconds: number,
    sources: readonly CombatAudioSource[],
    view: CrowdViewState | undefined,
  ): void {
    const dt = Math.max(0, dtSeconds);
    this.elapsedSeconds += dt;
    const activeGeneration = ++this.activeGeneration;
    for (const source of sources) {
      const schedule = this.schedules.get(source.id);
      if (schedule) schedule.activeGeneration = activeGeneration;
    }
    for (const [id, schedule] of this.schedules) {
      if (schedule.activeGeneration !== activeGeneration) this.schedules.delete(id);
    }

    const candidates = this.candidates;
    candidates.length = 0;
    if (
      !isGameAudioEnabled()
      || !view
      || view.orbitDistance == null
      || view.orbitDistance > COMBAT_AUDIO_MAX_ZOOM_DISTANCE
    ) {
      this.stopAll();
      return;
    }

    for (const source of sources) {
      const gain = combatAudioGain(source.x, source.z, view);
      if (gain <= 0) continue;
      const candidateIndex = candidates.length;
      let candidate = this.candidatePool[candidateIndex];
      if (!candidate) {
        candidate = {
          source,
          gain,
          attackEdge: false,
          scheduledDue: false,
          sequence: 0,
        };
        this.candidatePool.push(candidate);
      }
      candidate.source = source;
      candidate.gain = gain;
      candidate.attackEdge = false;
      candidate.scheduledDue = false;
      candidate.sequence = 0;
      candidates.push(candidate);
    }
    if (candidates.length > 1) {
      candidates.sort((left, right) => (
        right.gain - left.gain
        || left.source.id.localeCompare(right.source.id)
      ));
    }
    if (candidates.length === 0) {
      this.stopAll();
      return;
    }

    for (const candidate of candidates) {
      const source = candidate.source;
      const schedule = this.scheduleFor(source);
      if (schedule.phase !== source.phase) {
        schedule.phase = source.phase;
        schedule.previousAttackCooldown = source.attackCooldown;
        schedule.nextScheduledAt = this.initialScheduleAt(source);
      }
      const attackEdge = source.phase === 'attack'
        && this.observeAttackReset(schedule, source.attackCooldown, dt);
      const scheduledDue = this.elapsedSeconds >= schedule.nextScheduledAt;
      if (!attackEdge && !scheduledDue) continue;
      candidate.attackEdge = attackEdge;
      candidate.scheduledDue = !attackEdge && scheduledDue;
      candidate.sequence = schedule.sequence;
      schedule.sequence += 1;
      schedule.nextScheduledAt = this.elapsedSeconds
        + this.cadenceSeconds(source, schedule.sequence);
    }

    let edgePlays = 0;
    for (const candidate of candidates) {
      if (!candidate.attackEdge || candidate.source.phase !== 'attack') continue;
      if (edgePlays >= COMBAT_AUDIO_MAX_EDGE_PLAYS_PER_TICK) break;
      if (this.playAttack(candidate, true)) edgePlays += 1;
    }

    for (const candidate of candidates) {
      if (!candidate.scheduledDue) continue;
      if (candidate.source.phase === 'charge') {
        if (
          this.elapsedSeconds - this.lastChargePlayAt
            < CHARGE_GLOBAL_INTERVAL_SECONDS
        ) {
          continue;
        }
        if (this.play(
          this.chargePool,
          COMBAT_AUDIO_CHARGE_POOL_SIZE,
          COMBAT_AUDIO_CLIPS.charge,
          `${candidate.source.id}:charge:${candidate.sequence}`,
          candidate.gain * 0.82,
          0.96,
          0.008,
        )) {
          this.lastChargePlayAt = this.elapsedSeconds;
        }
        continue;
      }
      if (
        this.elapsedSeconds - this.lastScheduledPlayAt
          < SCHEDULED_GLOBAL_INTERVAL_SECONDS
      ) {
        continue;
      }
      if (this.playAttack(candidate, false)) {
        this.lastScheduledPlayAt = this.elapsedSeconds;
      }
    }
  }

  dispose(): void {
    this.stopAll();
    for (const audio of this.weaponPool) audio.removeAttribute('src');
    for (const audio of this.chargePool) audio.removeAttribute('src');
    for (const audio of this.deathPool) audio.removeAttribute('src');
    this.weaponPool.length = 0;
    this.chargePool.length = 0;
    this.deathPool.length = 0;
    this.schedules.clear();
    this.candidates.length = 0;
    this.candidatePool.length = 0;
  }

  /** Event-driven casualty reaction; never part of automatic combat chatter. */
  playDeath(id: string, variant: 'man' | 'woman'): void {
    if (!isGameAudioEnabled()) return;
    this.play(
      this.deathPool,
      DEATH_POOL_SIZE,
      COMBAT_DEATH_CLIPS[variant],
      `${id}:death`,
      0.9,
      0.98,
      0.01,
    );
  }

  private playAttack(candidate: CombatSoundCandidate, edge: boolean): boolean {
    const kind = attackSoundKind(candidate.source, candidate.sequence);
    const pitch = attackPitch(kind);
    return this.play(
      this.weaponPool,
      COMBAT_AUDIO_WEAPON_POOL_SIZE,
      COMBAT_AUDIO_CLIPS[kind],
      `${candidate.source.id}:${kind}:${candidate.sequence}:${edge ? 'edge' : 'cadence'}`,
      candidate.gain * (edge ? 0.9 : 0.78),
      pitch.base,
      pitch.step,
    );
  }

  private scheduleFor(source: CombatAudioSource): CombatSoundSchedule {
    let schedule = this.schedules.get(source.id);
    if (schedule) return schedule;
    schedule = {
      nextScheduledAt: this.initialScheduleAt(source),
      sequence: 0,
      activeGeneration: this.activeGeneration,
      phase: source.phase,
      previousAttackCooldown: source.attackCooldown,
    };
    this.schedules.set(source.id, schedule);
    return schedule;
  }

  private initialScheduleAt(source: CombatAudioSource): number {
    const base = source.phase === 'charge' ? 0.16 : 0.08;
    const spread = source.phase === 'charge' ? 0.3 : 0.22;
    return this.elapsedSeconds
      + base
      + deterministicUnit(`${source.id}:${source.phase}:start`) * spread;
  }

  private cadenceSeconds(source: CombatAudioSource, sequence: number): number {
    const kind = source.phase === 'charge' ? 'charge' : source.weaponFamily;
    const [minimum, spread] = cadenceRange(kind);
    return minimum
      + deterministicUnit(`${source.id}:${kind}:cadence:${sequence}`) * spread;
  }

  private observeAttackReset(
    schedule: CombatSoundSchedule,
    currentCooldown: number | null,
    dt: number,
  ): boolean {
    if (currentCooldown == null) {
      schedule.previousAttackCooldown = null;
      return false;
    }
    const previous = schedule.previousAttackCooldown;
    schedule.previousAttackCooldown = currentCooldown;
    if (previous == null) return false;
    const resetThreshold = Math.max(0.12, Math.min(0.35, dt * 1.5));
    return currentCooldown - previous > resetThreshold;
  }

  private play(
    pool: HTMLAudioElement[],
    poolSize: number,
    clips: readonly AudioClipDefinition[],
    key: string,
    gain: number,
    baseRate: number,
    rateStep: number,
  ): boolean {
    if (typeof Audio === 'undefined' || clips.length === 0) return false;
    while (pool.length < poolSize) {
      const audio = new Audio();
      audio.preload = 'auto';
      pool.push(audio);
    }
    const audio = pool.find((candidate) => candidate.paused || candidate.ended);
    const clip = clips[deterministicIndex(`${key}:clip`, clips.length)];
    if (!audio || !clip) return false;

    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = clamp01(
      (clip.volume ?? 1) * gain * getSoundEffectsVolume(),
    );
    audio.playbackRate = baseRate
      + deterministicIndex(`${key}:pitch`, 7) * rateStep;
    void audio.play().catch(() => undefined);
    return true;
  }

  private stopAll(): void {
    this.stopPool(this.weaponPool);
    this.stopPool(this.chargePool);
  }

  private stopPool(pool: readonly HTMLAudioElement[]): void {
    for (const audio of pool) {
      if (audio.paused) continue;
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

function attackSoundKind(
  source: CombatAudioSource,
  sequence: number,
): CombatAttackSoundKind {
  if (source.defensiveImpact && sequence % 4 === 3) return 'shield-armor';
  if (!source.secondaryWeaponFamily) return source.weaponFamily;
  if (source.weaponFamily === 'arquebus') {
    return sequence % 4 === 0
      ? source.weaponFamily
      : source.secondaryWeaponFamily;
  }
  return sequence % 5 === 4
    ? source.secondaryWeaponFamily
    : source.weaponFamily;
}

function cadenceRange(kind: CombatAudioSoundKind): readonly [number, number] {
  switch (kind) {
    case 'sword-sidearm': return [0.36, 0.34];
    case 'spear-pike': return [0.44, 0.38];
    case 'halberd-polearm': return [0.52, 0.42];
    case 'bow': return [0.78, 0.42];
    case 'crossbow': return [1.2, 0.72];
    case 'arquebus': return [1.8, 1.1];
    case 'shield-armor': return [0.48, 0.4];
    case 'charge': return [0.5, 0.34];
  }
}

function attackPitch(
  kind: CombatAttackSoundKind,
): { base: number; step: number } {
  switch (kind) {
    case 'spear-pike': return { base: 0.93, step: 0.014 };
    case 'sword-sidearm': return { base: 0.95, step: 0.012 };
    case 'halberd-polearm': return { base: 0.92, step: 0.013 };
    case 'bow': return { base: 0.97, step: 0.008 };
    case 'crossbow': return { base: 0.98, step: 0.006 };
    case 'arquebus': return { base: 0.985, step: 0.004 };
    case 'shield-armor': return { base: 0.94, step: 0.012 };
  }
}

function deterministicUnit(value: string): number {
  return deterministicIndex(value, 10_000) / 9_999;
}

function deterministicIndex(value: string, count: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, count);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
