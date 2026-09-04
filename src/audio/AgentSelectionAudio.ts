import type { VillagerModelVariant } from '../settlement/SettlementCrowdRenderer.ts';
import {
  DOG_SELECTION_CLIP,
  OX_SELECTION_CLIPS,
  PERSON_SELECTION_CLIPS,
  UI_SOUNDS,
  type AudioClipDefinition,
  type PersonSelectionVoice,
} from './audioCatalog.ts';

export const AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE = 10;
export const AGENT_SELECTION_QUIET_ORBIT_DISTANCE = 88;
export const AGENT_SELECTION_QUIET_GAIN = 0.06;

export type AgentSelectionKind = VillagerModelVariant | 'ox' | 'dog' | 'military-company';

type SelectionGroup = PersonSelectionVoice | 'ox' | 'dog' | 'military-company';

/**
 * One-shot acknowledgement player for deliberate world clicks on people,
 * animals, and military companies.
 * A new click replaces the prior acknowledgement so rapid inspection stays legible.
 */
export class AgentSelectionAudio {
  private readonly random: () => number;
  private readonly lastClipIndex = new Map<SelectionGroup, number>();
  private audio: HTMLAudioElement | null = null;
  private enabled = true;
  private volume = 1;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  play(kind: AgentSelectionKind, zoomGain = 1): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    const group = selectionGroup(kind);
    const clips = group === 'ox'
      ? OX_SELECTION_CLIPS
      : group === 'dog'
        ? [DOG_SELECTION_CLIP]
        : group === 'military-company'
          ? [UI_SOUNDS.military_company_select]
          : PERSON_SELECTION_CLIPS[group];
    const clipIndex = pickSelectionClipIndex(
      clips.length,
      this.lastClipIndex.get(group) ?? -1,
      this.random(),
    );
    const clip = clips[clipIndex];
    if (!clip) return;
    this.lastClipIndex.set(group, clipIndex);
    this.playClip(clip, group === 'ox', zoomGain);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled || !this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
  }

  dispose(): void {
    this.setEnabled(false);
    this.audio?.removeAttribute('src');
    this.audio = null;
    this.lastClipIndex.clear();
  }

  private playClip(clip: AudioClipDefinition, isOx: boolean, zoomGain: number): void {
    const audio = this.audio ?? new Audio();
    this.audio = audio;
    audio.preload = 'auto';
    audio.pause();
    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = clamp01((clip.volume ?? 1) * this.volume * clamp01(zoomGain));
    const pitchRange = isOx ? 0.035 : 0.04;
    audio.playbackRate = 1 - pitchRange + this.random() * pitchRange * 2;
    void audio.play().catch(() => undefined);
  }
}

export function pickSelectionClipIndex(
  clipCount: number,
  previousIndex: number,
  randomValue: number,
): number {
  if (clipCount <= 1) return 0;
  const normalizedRandom = Math.max(0, Math.min(0.999999999, randomValue));
  if (previousIndex < 0 || previousIndex >= clipCount) {
    return Math.floor(normalizedRandom * clipCount);
  }
  const candidate = Math.floor(normalizedRandom * (clipCount - 1));
  return candidate >= previousIndex ? candidate + 1 : candidate;
}

function selectionGroup(kind: AgentSelectionKind): SelectionGroup {
  if (kind === 'ox') return 'ox';
  if (kind === 'dog') return 'dog';
  if (kind === 'military-company') return 'military-company';
  return kind === 'woman' ? 'female' : 'male';
}

export function agentSelectionZoomGain(
  orbitDistance: number,
  firstPersonActive = false,
): number {
  if (firstPersonActive) return 1;
  if (!Number.isFinite(orbitDistance)) return AGENT_SELECTION_QUIET_GAIN;
  if (orbitDistance <= AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE) return 1;
  if (orbitDistance >= AGENT_SELECTION_QUIET_ORBIT_DISTANCE) {
    return AGENT_SELECTION_QUIET_GAIN;
  }
  const progress = (
    orbitDistance - AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE
  ) / (
    AGENT_SELECTION_QUIET_ORBIT_DISTANCE - AGENT_SELECTION_FULL_VOLUME_ORBIT_DISTANCE
  );
  const smoothed = progress * progress * (3 - 2 * progress);
  return 1 + (AGENT_SELECTION_QUIET_GAIN - 1) * smoothed;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
