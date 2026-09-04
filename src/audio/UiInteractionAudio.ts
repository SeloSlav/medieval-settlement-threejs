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
  'game_cancel',
  'game_transaction',
  'setup_adjust',
  'chicken_coop_select',
  'goat_pen_select',
  'pig_pen_select',
  'development_unlock',
  'game_danger',
  'confirm',
  'error',
] as const satisfies readonly UiSoundId[];

const CONTROL_SELECTOR = 'button, [role="button"]';
const ADJUSTMENT_INTERVAL_MS = 45;

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
    this.audio.play('setup_adjust', {
      playbackRate: 0.92 + normalized * 0.16,
      preservePitch: false,
    });
  };
}
