import {
  COMBAT_AUDIO_CLIPS,
  type AudioClipDefinition,
} from './audioCatalog.ts';
import { isGameAudioEnabled } from './audioPreferences.ts';
import type { CombatAgentFaction, CombatAgentStatus } from '../security/combatAgents.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';

export const COMBAT_AUDIO_MAX_ZOOM_DISTANCE = 46;
export const COMBAT_AUDIO_FULL_VOLUME_DISTANCE = 10;
export const COMBAT_AUDIO_CUTOFF_DISTANCE = 38;
export const COMBAT_AUDIO_MAX_PAIR_DISTANCE = 6.5;
export const COMBAT_AUDIO_MAX_SOURCES = 12;

const WEAPON_POOL_SIZE = 5;
const VOICE_POOL_SIZE = 3;
const WEAPON_GLOBAL_INTERVAL_SECONDS = 0.18;
const VOICE_GLOBAL_INTERVAL_SECONDS = 0.9;

export type CombatAudioFighter = {
  id: string;
  faction: CombatAgentFaction;
  status: CombatAgentStatus;
  health: number;
  x: number;
  z: number;
};

export type CombatAudioSource = {
  id: string;
  x: number;
  z: number;
};

export type CombatAudioSourceWorkspace = {
  guards: CombatAudioFighter[];
  raiders: CombatAudioFighter[];
  sourcePool: CombatAudioSource[];
  sourceFirstIds: string[];
  sourceSecondIds: string[];
  sources: CombatAudioSource[];
};

export function createCombatAudioSourceWorkspace(): CombatAudioSourceWorkspace {
  return {
    guards: [],
    raiders: [],
    sourcePool: [],
    sourceFirstIds: [],
    sourceSecondIds: [],
    sources: [],
  };
}

type CombatSoundSchedule = {
  nextWeaponAt: number;
  nextVoiceAt: number;
  weaponSequence: number;
  voiceSequence: number;
  activeGeneration: number;
};

type CombatSoundCandidate = {
  id: string;
  gain: number;
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
 * Produces one stable sound source per actively fighting raider, anchored to
 * their nearest fighting guard. Both combatants must still be alive, so
 * approach, retreat, aftermath, and ordinary guard duty remain silent.
 *
 * The authoritative raid party is capped at twelve. Using those raiders as
 * anchors keeps this presentation pass linear in the number of defenders
 * instead of comparing every fighter with every other fighter.
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
    if (
      fighter.status !== 'fighting'
      || !Number.isFinite(fighter.health)
      || fighter.health <= 0
      || !Number.isFinite(fighter.x)
      || !Number.isFinite(fighter.z)
    ) {
      continue;
    }
    (fighter.faction === 'raider' ? raiders : guards).push(fighter);
  }
  const sources = workspace?.sources ?? [];
  sources.length = 0;
  if (guards.length === 0 || raiders.length === 0) return sources;

  raiders.sort((left, right) => left.id.localeCompare(right.id));
  const maxDistanceSquared =
    COMBAT_AUDIO_MAX_PAIR_DISTANCE * COMBAT_AUDIO_MAX_PAIR_DISTANCE;

  for (
    let raiderIndex = 0;
    raiderIndex < raiders.length
      && sources.length < COMBAT_AUDIO_MAX_SOURCES;
    raiderIndex += 1
  ) {
    const fighter = raiders[raiderIndex];
    if (!fighter) continue;
    let nearest: CombatAudioFighter | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const candidate of guards) {
      const dx = candidate.x - fighter.x;
      const dz = candidate.z - fighter.z;
      const distanceSquared = dx * dx + dz * dz;
      if (
        distanceSquared > maxDistanceSquared
        || distanceSquared > nearestDistanceSquared
        || (
          distanceSquared === nearestDistanceSquared
          && nearest != null
          && candidate.id.localeCompare(nearest.id) >= 0
        )
      ) {
        continue;
      }
      nearest = candidate;
      nearestDistanceSquared = distanceSquared;
    }
    if (!nearest) continue;
    const fighterFirst = fighter.id <= nearest.id;
    const firstId = fighterFirst ? fighter.id : nearest.id;
    const secondId = fighterFirst ? nearest.id : fighter.id;
    const sourceIndex = sources.length;
    let source = workspace?.sourcePool[sourceIndex];
    const id = (
      source
      && workspace?.sourceFirstIds[sourceIndex] === firstId
      && workspace.sourceSecondIds[sourceIndex] === secondId
    )
      ? source.id
      : `${firstId}:${secondId}`;
    if (!source) {
      source = { id, x: 0, z: 0 };
      workspace?.sourcePool.push(source);
    }
    if (workspace) {
      workspace.sourceFirstIds[sourceIndex] = firstId;
      workspace.sourceSecondIds[sourceIndex] = secondId;
    }
    source.id = id;
    source.x = (fighter.x + nearest.x) * 0.5;
    source.z = (fighter.z + nearest.z) * 0.5;
    sources.push(source);
  }

  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Sparse close-range pike impacts and human exertion for live melee only.
 * Global cadence and small shared pools keep a large raid from becoming an
 * undifferentiated wall of noise.
 */
export class CombatAudio {
  private readonly weaponPool: HTMLAudioElement[] = [];
  private readonly voicePool: HTMLAudioElement[] = [];
  private readonly schedules = new Map<string, CombatSoundSchedule>();
  private readonly candidatePool: CombatSoundCandidate[] = [];
  private readonly candidates: CombatSoundCandidate[] = [];
  private activeGeneration = 0;
  private elapsedSeconds = 0;
  private lastWeaponPlayAt = Number.NEGATIVE_INFINITY;
  private lastVoicePlayAt = Number.NEGATIVE_INFINITY;

  tick(
    dtSeconds: number,
    sources: readonly CombatAudioSource[],
    view: CrowdViewState | undefined,
  ): void {
    this.elapsedSeconds += Math.max(0, dtSeconds);
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
        candidate = { id: source.id, gain };
        this.candidatePool.push(candidate);
      } else {
        candidate.id = source.id;
        candidate.gain = gain;
      }
      candidates.push(candidate);
    }
    if (candidates.length > 1) {
      candidates.sort((left, right) => (
        right.gain - left.gain
        || left.id.localeCompare(right.id)
      ));
    }
    if (candidates.length === 0) {
      this.stopAll();
      return;
    }

    for (const candidate of candidates) {
      const schedule = this.scheduleFor(candidate.id);
      if (
        this.elapsedSeconds >= schedule.nextWeaponAt
        && this.elapsedSeconds - this.lastWeaponPlayAt
          >= WEAPON_GLOBAL_INTERVAL_SECONDS
      ) {
        this.play(
          this.weaponPool,
          WEAPON_POOL_SIZE,
          COMBAT_AUDIO_CLIPS.pike,
          `${candidate.id}:weapon:${schedule.weaponSequence}`,
          candidate.gain,
          0.93,
          0.018,
        );
        schedule.weaponSequence += 1;
        schedule.nextWeaponAt = this.elapsedSeconds
          + 0.5
          + deterministicUnit(
            `${candidate.id}:weapon-cadence:${schedule.weaponSequence}`,
          ) * 0.34;
        this.lastWeaponPlayAt = this.elapsedSeconds;
        break;
      }
    }

    for (const candidate of candidates) {
      const schedule = this.scheduleFor(candidate.id);
      if (
        this.elapsedSeconds >= schedule.nextVoiceAt
        && this.elapsedSeconds - this.lastVoicePlayAt
          >= VOICE_GLOBAL_INTERVAL_SECONDS
      ) {
        this.play(
          this.voicePool,
          VOICE_POOL_SIZE,
          COMBAT_AUDIO_CLIPS.voices,
          `${candidate.id}:voice:${schedule.voiceSequence}`,
          candidate.gain,
          0.96,
          0.012,
        );
        schedule.voiceSequence += 1;
        schedule.nextVoiceAt = this.elapsedSeconds
          + 2.8
          + deterministicUnit(
            `${candidate.id}:voice-cadence:${schedule.voiceSequence}`,
          ) * 2.4;
        this.lastVoicePlayAt = this.elapsedSeconds;
        break;
      }
    }
  }

  dispose(): void {
    this.stopAll();
    for (const audio of this.weaponPool) audio.removeAttribute('src');
    for (const audio of this.voicePool) audio.removeAttribute('src');
    this.weaponPool.length = 0;
    this.voicePool.length = 0;
    this.schedules.clear();
    this.candidates.length = 0;
    this.candidatePool.length = 0;
  }

  private scheduleFor(id: string): CombatSoundSchedule {
    let schedule = this.schedules.get(id);
    if (schedule) return schedule;
    schedule = {
      nextWeaponAt: this.elapsedSeconds
        + 0.08
        + deterministicUnit(`${id}:weapon-start`) * 0.2,
      nextVoiceAt: this.elapsedSeconds
        + 0.7
        + deterministicUnit(`${id}:voice-start`) * 1.8,
      weaponSequence: 0,
      voiceSequence: 0,
      activeGeneration: this.activeGeneration,
    };
    this.schedules.set(id, schedule);
    return schedule;
  }

  private play(
    pool: HTMLAudioElement[],
    poolSize: number,
    clips: readonly AudioClipDefinition[],
    key: string,
    gain: number,
    baseRate: number,
    rateStep: number,
  ): void {
    if (typeof Audio === 'undefined' || clips.length === 0) return;
    while (pool.length < poolSize) {
      const audio = new Audio();
      audio.preload = 'auto';
      pool.push(audio);
    }
    let audio: HTMLAudioElement | undefined;
    for (const candidate of pool) {
      if (!candidate.paused) continue;
      audio = candidate;
      break;
    }
    audio ??= pool[deterministicIndex(`${key}:pool`, pool.length)];
    const clip = clips[deterministicIndex(`${key}:clip`, clips.length)];
    if (!audio || !clip) return;

    audio.pause();
    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = clamp01((clip.volume ?? 1) * gain);
    audio.playbackRate = baseRate
      + deterministicIndex(`${key}:pitch`, 7) * rateStep;
    void audio.play().catch(() => undefined);
  }

  private stopAll(): void {
    this.stopPool(this.weaponPool);
    this.stopPool(this.voicePool);
  }

  private stopPool(pool: readonly HTMLAudioElement[]): void {
    for (const audio of pool) {
      if (audio.paused) continue;
      audio.pause();
      audio.currentTime = 0;
    }
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
