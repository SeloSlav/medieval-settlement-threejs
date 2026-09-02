import {
  UI_SOUNDS,
  type UiSoundId,
} from './audioCatalog.ts';
import { UiAudio } from './UiAudio.ts';

type UiSoundDecision = {
  id: UiSoundId;
  playbackRate?: number;
};

export type UiControlSemantics = {
  override?: string;
  disabled: boolean;
  text: string;
  role: string | null;
  hasPopup: boolean;
  expanded: string | null;
  pressed: string | null;
};

const INTERACTION_SOUND_IDS = [
  'game_press',
  'game_tab',
  'game_toggle',
  'game_panel',
  'game_transaction',
  'game_danger',
  'confirm',
  'error',
] as const satisfies readonly UiSoundId[];

const CONTROL_SELECTOR = 'button, [role="button"]';
const ADJUSTMENT_INTERVAL_MS = 45;

const DANGER_PATTERN = /\b(delete|demolish|destroy|remove|reset|abandon|disband|new world|danger)\b/;
const TRANSACTION_PATTERN = /\b(buy|sell|trade|upgrade|repair|rebuild|hire|recruit|pay|purchase|order)\b/;
const PANEL_PATTERN = /\b(open|close|back|cancel|return|menu|settings|controls|tutorial|report|inspect)\b/;
const TAB_PATTERN = /\b(tab|category|filter|formation|speed|preset|card)\b/;
const CONFIRM_PATTERN = /\b(confirm|continue|save|apply|accept|start|rename|grant|deploy|build)\b/;

function semanticText(control: HTMLElement): string {
  return [
    control.dataset.action,
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.className,
    control.textContent,
  ].filter(Boolean).join(' ').toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
}

function explicitDecision(override?: string): UiSoundDecision | null | undefined {
  if (!override) return undefined;
  if (override === 'none') return null;
  if (!(override in UI_SOUNDS)) return undefined;
  return { id: override as UiSoundId };
}

export function uiSoundForSemantics(control: UiControlSemantics): UiSoundDecision | null {
  const explicit = explicitDecision(control.override);
  if (explicit !== undefined) return explicit;
  if (control.disabled) return null;

  const semantics = control.text;
  if (DANGER_PATTERN.test(semantics)) return { id: 'game_danger' };
  if (TRANSACTION_PATTERN.test(semantics)) return { id: 'game_transaction' };

  if (
    (control.role === 'tab' || TAB_PATTERN.test(semantics))
    && !control.hasPopup
    && control.expanded === null
  ) return { id: 'game_tab' };

  if (PANEL_PATTERN.test(semantics) || control.hasPopup || control.expanded !== null) {
    const closing = control.expanded === 'false' || /\b(close|back|cancel|return)\b/.test(semantics);
    return { id: 'game_panel', playbackRate: closing ? 0.92 : 1.06 };
  }

  if (control.pressed !== null) {
    return { id: 'game_toggle', playbackRate: control.pressed === 'true' ? 1.06 : 0.94 };
  }

  if (CONFIRM_PATTERN.test(semantics)) return { id: 'confirm' };
  return { id: 'game_press' };
}

/** Classifies a control after its click handler has updated ARIA state. */
export function uiSoundForControl(control: HTMLElement): UiSoundDecision | null {
  return uiSoundForSemantics({
    override: control.dataset.uiSound,
    disabled: (
      (control instanceof HTMLButtonElement && control.disabled)
      || control.getAttribute('aria-disabled') === 'true'
    ),
    text: semanticText(control),
    role: control.getAttribute('role'),
    hasPopup: control.hasAttribute('aria-haspopup'),
    expanded: control.getAttribute('aria-expanded'),
    pressed: control.getAttribute('aria-pressed'),
  });
}

/**
 * Delegated UI feedback for the live game. Explicit UiAudio plays made by a
 * target click handler win; the revision handshake prevents a generic second
 * click from being layered on the same synchronous interaction.
 */
export class UiInteractionAudio {
  private readonly clickRevision = new WeakMap<Event, number>();
  private readonly root: HTMLElement;
  private readonly audio: UiAudio;
  private lastAdjustmentAt = Number.NEGATIVE_INFINITY;

  constructor(root: HTMLElement, audio: UiAudio) {
    this.root = root;
    this.audio = audio;
    root.addEventListener('click', this.captureClick, true);
    root.addEventListener('change', this.playChangedControl);
    root.addEventListener('input', this.playRangeAdjustment);
  }

  preload(): void {
    this.audio.preload(INTERACTION_SOUND_IDS);
  }

  dispose(): void {
    this.root.removeEventListener('click', this.captureClick, true);
    this.root.removeEventListener('change', this.playChangedControl);
    this.root.removeEventListener('input', this.playRangeAdjustment);
  }

  private readonly captureClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>(CONTROL_SELECTOR);
    if (!control || !this.root.contains(control)) return;
    this.clickRevision.set(event, this.audio.getPlayRevision());
    queueMicrotask(() => this.playCapturedClick(event, control));
  };

  private readonly playCapturedClick = (event: Event, control: HTMLElement): void => {
    if (this.clickRevision.get(event) !== this.audio.getPlayRevision()) return;
    const decision = uiSoundForControl(control);
    if (!decision) return;
    this.audio.play(decision.id, {
      playbackRate: decision.playbackRate,
      preservePitch: decision.playbackRate === undefined,
    });
  };

  private readonly playChangedControl = (event: Event): void => {
    const input = event.target;
    if (input instanceof HTMLSelectElement) {
      this.audio.play('game_tab');
      return;
    }
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type === 'checkbox') {
      this.audio.play('game_toggle', {
        playbackRate: input.checked ? 1.06 : 0.94,
        preservePitch: false,
      });
    } else if (input.type === 'radio' && input.checked) {
      this.audio.play('game_tab');
    }
  };

  private readonly playRangeAdjustment = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
    const now = performance.now();
    if (now - this.lastAdjustmentAt < ADJUSTMENT_INTERVAL_MS) return;
    this.lastAdjustmentAt = now;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const range = Math.max(1, max - min);
    const normalized = Math.max(0, Math.min(1, (Number(input.value) - min) / range));
    this.audio.play('game_toggle', {
      playbackRate: 0.9 + normalized * 0.2,
      preservePitch: false,
    });
  };
}
