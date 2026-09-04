import { loadingPercentForPhase, type LoadingPhase } from './loadingProgress.ts';

export type LoadingProgress = {
  label: string;
  detail?: string;
  recoveryHint?: string;
  phase?: LoadingPhase;
  fraction?: number;
  percent?: number;
};

export type LoadingRecoveryAction = {
  label: string;
  handler: () => void;
};

const LOADING_ROOT_ID = 'app-loading';

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly percentEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly progressBarEl: HTMLElement;
  private readonly spinnerEl: HTMLElement | null;
  private readonly retryButton: HTMLButtonElement;
  private readonly recoveryHintEl: HTMLElement;
  private readonly recoveryButton: HTMLButtonElement;
  private dismissed = false;
  private retryHandler: (() => void) | null = null;
  private recoveryHandler: (() => void) | null = null;
  private displayedPercent = 0;
  private renderedPercent = -1;
  private renderedRoundedPercent = -1;

  constructor() {
    const root = document.getElementById(LOADING_ROOT_ID);
    if (!root) {
      throw new Error(`Missing #${LOADING_ROOT_ID} element.`);
    }

    const percentEl = root.querySelector<HTMLElement>('[data-loading-percent]');
    const labelEl = root.querySelector<HTMLElement>('[data-loading-label]');
    const detailEl = root.querySelector<HTMLElement>('[data-loading-detail]');
    const progressBarEl = root.querySelector<HTMLElement>('[data-loading-bar]');
    const retryButton = root.querySelector<HTMLButtonElement>('[data-loading-retry]');
    const recoveryHintEl = root.querySelector<HTMLElement>('[data-loading-recovery-hint]');
    const recoveryButton = root.querySelector<HTMLButtonElement>('[data-loading-recovery]');
    if (!percentEl || !labelEl || !detailEl || !progressBarEl || !retryButton || !recoveryHintEl || !recoveryButton) {
      throw new Error('Loading screen markup is missing percent, label, detail, bar, retry, or recovery elements.');
    }

    this.root = root;
    this.percentEl = percentEl;
    this.labelEl = labelEl;
    this.detailEl = detailEl;
    this.progressBarEl = progressBarEl;
    this.spinnerEl = root.querySelector<HTMLElement>('.app-loading-spinner');
    this.retryButton = retryButton;
    this.recoveryHintEl = recoveryHintEl;
    this.recoveryButton = recoveryButton;
    this.retryButton.addEventListener('click', () => {
      this.retryHandler?.();
    });
    this.recoveryButton.addEventListener('click', () => {
      this.recoveryHandler?.();
    });
    this.renderPercent(0);
  }

  static tryCreate(): LoadingScreen | null {
    if (!document.getElementById(LOADING_ROOT_ID)) return null;
    return new LoadingScreen();
  }

  setProgress(progress: LoadingProgress): void {
    // Asset hydration runs independently of the authoritative session. Once a
    // connection/bootstrap error is actionable, late texture progress must not
    // erase its Retry controls and leave a misleading 100% loading screen.
    if (this.dismissed || this.retryHandler !== null) return;
    // Error recovery is explicit. Rewriting hidden/aria state on every asset
    // callback needlessly invalidates the spinner's surrounding card.
    if (this.labelEl.textContent !== progress.label) this.labelEl.textContent = progress.label;
    const detail = progress.detail ?? '';
    if (this.detailEl.textContent !== detail) this.detailEl.textContent = detail;

    const nextPercent = this.resolvePercent(progress);
    if (nextPercent != null) {
      this.displayedPercent = Math.max(this.displayedPercent, nextPercent);
      this.renderPercent(this.displayedPercent);
    }
  }

  setErrorState(
    progress: LoadingProgress,
    onRetry: () => void,
    recovery?: LoadingRecoveryAction,
  ): void {
    if (this.dismissed) return;
    this.labelEl.textContent = progress.label;
    this.detailEl.textContent = progress.detail ?? '';
    this.recoveryHintEl.textContent = progress.recoveryHint ?? '';
    this.recoveryHintEl.hidden = !progress.recoveryHint;
    this.retryHandler = onRetry;
    this.recoveryHandler = recovery?.handler ?? null;
    this.recoveryButton.textContent = recovery?.label ?? 'Start new world…';
    this.spinnerEl?.classList.add('is-hidden');
    this.retryButton.hidden = false;
    this.recoveryButton.hidden = recovery === undefined;
    this.root.setAttribute('aria-busy', 'false');
  }

  clearErrorState(): void {
    this.retryHandler = null;
    this.recoveryHandler = null;
    this.recoveryHintEl.textContent = '';
    this.recoveryHintEl.hidden = true;
    this.spinnerEl?.classList.remove('is-hidden');
    this.retryButton.hidden = true;
    this.recoveryButton.hidden = true;
    this.root.setAttribute('aria-busy', 'true');
  }

  dismiss(): void {
    if (this.dismissed || this.retryHandler !== null) return;
    this.displayedPercent = 100;
    this.renderPercent(100);
    this.dismissed = true;
    this.root.classList.add('is-dismissed');
    window.setTimeout(() => {
      this.root.remove();
    }, 420);
  }

  private resolvePercent(progress: LoadingProgress): number | null {
    if (progress.percent != null) {
      return Math.min(100, Math.max(0, progress.percent));
    }
    if (progress.phase != null) {
      return loadingPercentForPhase(progress.phase, progress.fraction ?? 0);
    }
    return null;
  }

  private renderPercent(percent: number): void {
    if (percent === this.renderedPercent) return;
    this.renderedPercent = percent;
    const rounded = Math.round(percent);
    if (rounded !== this.renderedRoundedPercent) {
      this.renderedRoundedPercent = rounded;
      this.percentEl.textContent = `${rounded}%`;
      this.progressBarEl.setAttribute('aria-valuenow', String(rounded));
    }
    this.progressBarEl.style.setProperty('--loading-progress', String(percent / 100));
  }
}
